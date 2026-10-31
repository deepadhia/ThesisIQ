import { writeLog } from "../services/logger.service.js";
import { 
  fetchBseAnnouncements, 
  fetchNseAnnouncements,
  shouldProcessAnnouncement, 
  generateAnnouncementHash, 
  isAnnouncementProcessed,
  isEventAlertRecentlySent,
  saveAnnouncement,
  updateStockResultDate,
  resetStuckPending,
  isWeeklyHeartbeatNeeded,
  sendWeeklyHeartbeat,
  isHeartbeatNeeded,
  markHeartbeatSent,
  extractTextFromPdfUrl,
  extractResultDateFromText,
  sanitizeResultDate,
  isConcallOrTranscript,
  getConcallType,
  recordScannerSuccess,
  recordScannerFailure,
  isFuzzyDuplicateTitle,
  isEarningsConcallInvite,
  extractConcallSchedule,
  findContentDuplicate,
  getFilingAgeHours,
  acquireScanLease,
  releaseScanLease,
  recordClassificationFailure
} from "../services/announcement.service.js";
import { CLASSIFICATION_ALERT_AFTER_FAILURES, buildClassificationStuckMessage } from "../services/retry-policy.service.js";
import { classifyAnnouncementWithNim } from "../services/nim.service.js";
import { classifyFilingCategory, extractCorporateActionDetails, isRoutineCreditRatingReaffirmation, isNewspaperPublicationFiling } from "../services/filing-classifier.service.js";
import { processPendingDeepDives } from "../workers/quarterly-deepdive-worker.js";
import { sendAnnouncementAlert, sendConcallScheduleAlert, sendRunSummary, sendTelegramMessage, buildBseDocumentUrl } from "../services/telegram.service.js";
import { 
  evaluateAndDispatchDislocationAlerts,
  isDailyValuationWatchdogNeeded,
  markDailyValuationWatchdogExecuted
} from "../services/valuation-dislocation-watchdog.service.js";
import { syncAllPortfolioValuations } from "../services/portfolio-market-valuation.service.js";
import { pool } from "../db/pool.js";
import { findThesisGaps } from "../services/thesis-driver-context.service.js";
import { getConfiguredProviders, initModelRegistry, settleModelRegistry, markModelsDirty } from "../services/llm.service.js";
import { reportLlmHealth, dbStore } from "../services/llm-health.service.js";

/**
 * Retry wrapper for flaky APIs.
 */
async function withRetry(fn, label = "Operation", retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        const delay = 1000 * (i + 1);
        console.warn(`[RETRY] ${label} failed (attempt ${i+1}/${retries+1}): ${e.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

const MAX_ALERTS_PER_RUN = 25;

// Filings older than this are archived silently unless they are earnings material (results / concall / deck),
// so switching a feed on (or recovering from downtime) never floods Telegram with stale duplicates.
const MAX_ALERT_AGE_HOURS = 72;
const MAX_EARNINGS_AGE_HOURS = 24 * 10;
// A material PDF that is not readable yet is retried each cycle, but never deferred forever.
const MAX_PDF_DEFER_HOURS = 6;
const EARNINGS_MATERIAL_RE = /result|outcome of board|transcript|con\.?\s?call|conference call|earnings|investor presentation|audio recording|analyst|presentation/i;

// The daemon is restarted by PM2 cron every 5 minutes: stop starting new work well before that.
const SCAN_PHASE_BUDGET_MS = 150 * 1000;
const WORKER_DEADLINE_MS = 270 * 1000;

/**
 * Weekly Heartbeat to confirm the system is alive.
 * Dispatched strictly once per week (Sunday 10-12 IST) ONLY IF 0 alerts fired in the past 7 days.
 */
async function sendHeartbeat(stocksCount = 20) {
  const needed = await isWeeklyHeartbeatNeeded();
  if (needed) {
    await sendWeeklyHeartbeat(stocksCount);
  }
}

/**
 * Main Scanning Orchestrator
 */
export async function scan({ isDryRun = false, runUrl = null, targetTicker = null, forceReevaluate = false } = {}) {
  writeLog("SCANNER", `🟢 Starting Corporate Announcement Scan... ${isDryRun ? "[DRY RUN]" : "[LIVE DAEMON]"}${forceReevaluate ? " [FORCE REEVALUATE]" : ""}`);
  const startTime = Date.now();

  // Oracle PM2 and the GitHub Actions failover share one database: only one scan may run at a time,
  // otherwise both alert for the same filing. (Dry runs / single-ticker debug runs never take the lease.)
  const useLease = !isDryRun && !targetTicker;
  let lease = null;
  if (useLease) {
    lease = await acquireScanLease();
    if (!lease) {
      writeLog("SCANNER", "⏭️ Another scan holds the lease. Skipping this run.");
      return { stocksScanned: 0, newAnnouncements: 0, alertsSent: 0, bseErrors: 0, nseErrors: 0, durationMs: Date.now() - startTime, skipped: true };
    }
  }
  try {
    return await runScan({ isDryRun, runUrl, targetTicker, forceReevaluate, startTime });
  } finally {
    if (lease) await releaseScanLease(lease);
  }
}

async function runScan({ isDryRun, runUrl, targetTicker, forceReevaluate, startTime }) {

  // The AI models are discovered, not hard-coded: load the cached list now (fast) and refresh it in the background when it
  // is stale, so a retired model or a newer better one never needs a code change. Dry runs read nothing and write nothing.
  if (!isDryRun) {
    try {
      await initModelRegistry({ store: dbStore(pool) });
    } catch (err) {
      console.warn("[MODELS WARN] Could not initialise the model registry; using the built-in seed models:", err.message);
    }
  }

  // 0. System Cleanup & Heartbeat
  await resetStuckPending();
  // 1. Get portfolio & watchlist stocks dynamically from DB
  let query = "SELECT id, ticker, company_name, COALESCE(nse_symbol, ticker) AS nse_symbol, bse_scrip_code, investment_thesis, category FROM stocks WHERE (category IN ('Core', 'Watchlist') OR category IS NULL)";
  const params = [];
  if (targetTicker) {
    query += " AND UPPER(TRIM(ticker)) = $1";
    params.push(targetTicker.toUpperCase().trim());
  }
  query += " ORDER BY ticker";
  const { rows: allStocks } = await pool.query(query, params);
  // Rotate the starting point every cycle so a time-limited run never starves the same tail of the list
  const rotation = allStocks.length > 0 ? Math.floor(Date.now() / 300000) % allStocks.length : 0;
  const stocks = targetTicker ? allStocks : [...allStocks.slice(rotation), ...allStocks.slice(0, rotation)];
  writeLog("SCANNER", `🔍 Monitoring ${stocks.length} stock(s) across NSE & BSE${targetTicker ? ` (Filtered: ${targetTicker})` : ''}`);
  const thesisGaps = findThesisGaps(stocks);
  if (thesisGaps.length > 0) {
    writeLog("SCANNER", `⚠️ No usable thesis (placeholder text and no driver contract) for: ${thesisGaps.join(", ")}. Run backend/scripts/seed-stock-theses.js or add a contract.`);
  }

  if (!targetTicker) {
    await sendHeartbeat(stocks.length);
  }

  // ── Run-level stats (for end-of-run summary) ──
  let alertsSent        = 0;
  let newAnnouncements  = 0;
  let bseErrors         = 0;
  let nseErrors         = 0;

  for (const stock of stocks) {
    if (!targetTicker && Date.now() - startTime > SCAN_PHASE_BUDGET_MS) {
      console.log(`[SCAN] Scan-phase time budget used. Remaining stocks continue next cycle (rotation keeps this fair).`);
      break;
    }
    try {
      console.log(`Checking ${stock.ticker} (BSE: ${stock.bse_scrip_code}, NSE: ${stock.nse_symbol})...`);
      
      // 2. Fetch from BOTH BSE and NSE
      let bseList = [];
      let nseList = [];

      try {
        bseList = await fetchBseAnnouncements(stock.bse_scrip_code);
        console.log(`Found ${bseList.length} raw announcements for ${stock.ticker} (BSE)`);
      } catch (err) {
        console.error(`[ERROR] BSE fetch failed for ${stock.ticker}:`, err.message);
        bseErrors++;
      }

      try {
        nseList = await fetchNseAnnouncements(stock.nse_symbol);
        console.log(`Found ${nseList.length} raw announcements for ${stock.ticker} (NSE)`);
      } catch (err) {
        console.error(`[ERROR] NSE fetch failed for ${stock.ticker}:`, err.message);
        nseErrors++;
      }

      // 3. Merge and Deduplicate by Title Hash
      // Preserve source metadata so we can build document links later.
      const mergedMap = new Map();
      bseList.forEach(ann => {
        const title = ann.NEWSSUB;
        const timestamp = ann.DT_TM;
        const hash = generateAnnouncementHash(stock.ticker, title, timestamp, ann.NEWS_ID);
        if (!mergedMap.has(hash)) {
          mergedMap.set(hash, { ...ann, hash, _source: "BSE" });
        }
      });
      nseList.forEach(ann => {
        const title = ann.NEWSSUB;
        const timestamp = ann.DT_TM;
        const hash = generateAnnouncementHash(stock.ticker, title, timestamp, ann.NEWS_ID);
        if (!mergedMap.has(hash)) {
          mergedMap.set(hash, { ...ann, hash, _source: "NSE" });
        }
      });

      const uniqueAnnouncements = Array.from(mergedMap.values());
      console.log(`Merged to ${uniqueAnnouncements.length} unique announcements for ${stock.ticker}`);

      // Newest filings first, so a time-limited run always handles the freshest results/concalls before older items
      uniqueAnnouncements.sort((a, b) => new Date(b.DT_TM || 0) - new Date(a.DT_TM || 0));

      for (const ann of uniqueAnnouncements) {
        if (!targetTicker && Date.now() - startTime > SCAN_PHASE_BUDGET_MS + 30000) {
          console.log(`[SCAN] Time budget reached mid-stock; remaining filings for ${stock.ticker} continue next cycle.`);
          break;
        }
        const title    = ann.NEWSSUB;
        const hash     = ann.hash;
        const sourceId = ann.NEWS_ID;
        const ticker   = stock.ticker;
        const annSource = ann._source || "BSE";
        const timestamp = ann.DT_TM;
        // BSE-specific document metadata
        const newsId   = ann.NEWS_ID;
        const pdfFlag  = ann.PDFFLAG ?? 0;

        // 4. Keyword Filter (Stage 1)
        if (!shouldProcessAnnouncement(title)) {
          continue;
        }

        // 5. Deduplicate against DB
        if (!forceReevaluate) {
          const processed = await isAnnouncementProcessed(ticker, sourceId, hash);
          if (processed) {
            continue;
          }

          const GENERIC_TITLES = ["General Updates", "Updates", "Corporate Announcement", "Press Release"];
          if (!GENERIC_TITLES.includes(title) && await isFuzzyDuplicateTitle(ticker, title)) {
            console.log(`[SKIP] Fuzzy duplicate detected for ${ticker}: ${title}`);
            continue;
          }
        }

        newAnnouncements++;

        console.log(`[NEW] Found potential announcement for ${ticker}: ${title}`);

        // 5c. Fetch PDF Content for Deep Analysis
        let announcementText = title; // Default to title
        let docUrl = null;

        const ageHrs = getFilingAgeHours(timestamp);

        // Archive stale non-earnings filings without spending AI time or sending alerts (feed backfill / downtime recovery)
        if (!forceReevaluate && ageHrs > MAX_ALERT_AGE_HOURS && !EARNINGS_MATERIAL_RE.test(`${title} ${ann.attachment || ""}`)) {
          if (!isDryRun) {
            await saveAnnouncement({
              stock_id: stock.id, ticker, source_id: sourceId, title_hash: hash, title, raw_text: title,
              priority: "LOW", impact: "NEUTRAL", confidence: "LOW",
              summary: `Archived without alert (filed ${Math.round(ageHrs)}h ago, beyond the ${MAX_ALERT_AGE_HOURS}h alert window).`,
              status: "ignored", sent_to_telegram: false, is_earnings_release: false,
              attachment_url: null, filing_date: timestamp
            });
          }
          continue;
        }
        if (!forceReevaluate && ageHrs > MAX_EARNINGS_AGE_HOURS) {
          if (!isDryRun) {
            await saveAnnouncement({
              stock_id: stock.id, ticker, source_id: sourceId, title_hash: hash, title, raw_text: title,
              priority: "LOW", impact: "NEUTRAL", confidence: "LOW",
              summary: `Archived without alert (filed ${Math.round(ageHrs / 24)}d ago).`,
              status: "ignored", sent_to_telegram: false, is_earnings_release: false,
              attachment_url: null, filing_date: timestamp
            });
          }
          continue;
        }

        if (annSource === "BSE" && ann.ATTACHMENTNAME) {
          docUrl = buildBseDocumentUrl(newsId, pdfFlag, ann.ATTACHMENTNAME);
        } else if (annSource === "NSE" && ann.attachment) {
          // NSE API usually provides a direct attachment path
          docUrl = ann.attachment.startsWith('http') ? ann.attachment : `https://nsearchives.nseindia.com/corporate/${ann.attachment}`;
        }

        let extractedText = "";
        if (docUrl) {
          console.log(`[PDF] Extracting text from: ${docUrl}`);
          extractedText = await extractTextFromPdfUrl(docUrl);
        }

        // The same PDF is published on NSE and BSE under different ids/titles: analyse and alert it once.
        if (!forceReevaluate && extractedText && extractedText.length >= 1200) {
          const dup = await findContentDuplicate(ticker, extractedText);
          if (dup) {
            console.log(`[SKIP CONTENT-DUP] ${ticker} "${title}" is the same document as "${dup.title}" already processed.`);
            if (!isDryRun) {
              await saveAnnouncement({
                stock_id: stock.id, ticker, source_id: sourceId, title_hash: hash, title, raw_text: title,
                priority: "LOW", impact: "NEUTRAL", confidence: "LOW",
                summary: `Duplicate of an already processed filing (${dup.title}).`,
                status: "ignored", sent_to_telegram: false, is_earnings_release: false,
                attachment_url: docUrl, filing_date: timestamp
              });
            }
            continue;
          }
        }

        const isMaterialActionText = 
          title.toLowerCase().includes("rights issue") ||
          title.toLowerCase().includes("preferential") ||
          title.toLowerCase().includes("qip") ||
          title.toLowerCase().includes("acquisition") ||
          title.toLowerCase().includes("merger") ||
          title.toLowerCase().includes("demerger") ||
          title.toLowerCase().includes("amalgamation") ||
          title.toLowerCase().includes("transcript") ||
          title.toLowerCase().includes("concall") ||
          title.toLowerCase().includes("audio recording") ||
          title.toLowerCase().includes("financial result") ||
          (ann.attachment && (
            ann.attachment.toLowerCase().includes("rights issue") ||
            ann.attachment.toLowerCase().includes("preferential") ||
            ann.attachment.toLowerCase().includes("qip") ||
            ann.attachment.toLowerCase().includes("acquisition") ||
            ann.attachment.toLowerCase().includes("transcript") ||
            ann.attachment.toLowerCase().includes("audio") ||
            ann.attachment.toLowerCase().includes("result") ||
            ann.attachment.toLowerCase().includes("financial")
          )) ||
          (ann.attachment_text && (
            ann.attachment_text.toLowerCase().includes("rights issue") ||
            ann.attachment_text.toLowerCase().includes("preferential") ||
            ann.attachment_text.toLowerCase().includes("qip") ||
            ann.attachment_text.toLowerCase().includes("acquisition") ||
            ann.attachment_text.toLowerCase().includes("subsidiary") ||
            ann.attachment_text.toLowerCase().includes("transcript")
          ));

        if (extractedText && extractedText.trim().length > 50) {
          announcementText = `TITLE: ${title}\n\nCONTENT:\n${extractedText}`;
          console.log(`[PDF] Successfully extracted ${extractedText.length} chars.`);
        } else if (docUrl && isMaterialActionText && (!extractedText || extractedText.trim().length <= 50) && ageHrs < MAX_PDF_DEFER_HOURS) {
          console.log(`[PDF DEFER] Material corporate action PDF not replicated yet on CDN (${ticker} - ${title}). Deferring to next scan cycle for full extraction.`);
          continue;
        } else if (ann.attachment_text) {
          console.log(`[TEXT] Using provided attachment text for ${ticker}`);
          announcementText = `TITLE: ${title}\n\nSUMMARY:\n${ann.attachment_text}`;
        } else if (docUrl) {
          announcementText = `TITLE: ${title}\n\nCONTENT:\n[NO TEXT EXTRACTED: The PDF filing is either a scanned image, routine template, or unreadable.]`;
          console.log(`[PDF] Extraction failed or returned empty text. Passing error guard to AI.`);
        } else {
          announcementText = `TITLE: ${title}\n\nCONTENT:\n[NO FILING TEXT AVAILABLE: Pure title intimation only.]`;
        }

        // 6. AI Classify (Stage 2) via the shared LLM failover chain
        let aiResult;
        try {
          aiResult = await withRetry(() => classifyAnnouncementWithNim(ticker, announcementText, title, stock.investment_thesis), "AI Classification", 0);
        } catch (err) {
          console.error(`AI Classification permanently failed for ${ticker}:`, err.message);
          // Save as 'failed' to skip re-download on next runs; will still be retried
          // because isAnnouncementProcessed excludes 'failed' status.
          await saveAnnouncement({
            stock_id: stock.id,
            ticker,
            source_id: sourceId,
            title_hash: hash,
            title,
            raw_text: title,
            priority: "LOW",
            impact: "NEUTRAL",
            confidence: "LOW",
            summary: `AI classification failed: ${err.message}`,
            status: "failed",
            sent_to_telegram: false,
            is_earnings_release: false,
            attachment_url: docUrl,
            filing_date: timestamp
          });
          // Back off instead of re-running the whole chain every cycle, and tell the user once if it keeps failing.
          try {
            const failure = await recordClassificationFailure(ticker, sourceId, hash);
            console.warn(`[RETRY] ${ticker}: classification failure #${failure.failures}; next try after ${failure.nextRetryAt ? failure.nextRetryAt.toISOString() : "the next cycle"}.`);
            if (failure.failures === CLASSIFICATION_ALERT_AFTER_FAILURES && !isDryRun) {
              await sendTelegramMessage(buildClassificationStuckMessage({ ticker, title, failures: failure.failures, docUrl }));
            }
          } catch (retryErr) {
            console.warn(`[RETRY WARN] Could not record the classification failure for ${ticker}:`, retryErr.message);
          }
          continue;
        }

        // 6b. Self-contradiction guard
        if (aiResult.priority === "LOW" && aiResult.is_earnings_release) {
          console.warn(`[OVERRIDE] is_earnings_release forced false for LOW priority: ${ticker} - ${title}`);
          aiResult.is_earnings_release = false;
        }

        // 6c. Title pattern override (defence-in-depth)
        const NEVER_EARNINGS_TITLES = [
          "postal ballot", "agm notice", "agm", "egm",
          "shareholders meeting", "general meeting",
          "newspaper publication", "newspaper advertisement",
          "voting results", "scrutinizer report",
          "compliance certificate", "loss of share certificate",
          "duplicate share certificate",
          "board meeting notice", "board meeting intimation",
          "prior intimation", "closure of trading window",
          "trading window", "trading window closure",
          "schedule of analyst", "schedule of institutional",
          "analysts/institutional", "investor meet", "con. call updates",
          "conference call", "earnings call intimation",
          "xbrl"
        ];
        const titleLower = title.toLowerCase();
        if (aiResult.is_earnings_release && NEVER_EARNINGS_TITLES.some(p => titleLower.includes(p))) {
          console.warn(`[OVERRIDE] is_earnings_release forced false by title pattern: ${ticker} - ${title}`);
          aiResult.is_earnings_release = false;
        }

        // 6e. Specialized Filing Category Classification & Detail Extraction
        const filingCategory = classifyFilingCategory(title, announcementText, ann.attachment || docUrl);
        let eventAnalysis = null;
        if (filingCategory !== "GENERAL" && filingCategory !== "ROUTINE_COMPLIANCE") {
          eventAnalysis = await extractCorporateActionDetails(filingCategory, ticker, announcementText, stock.investment_thesis);
        }

        // Determine deep_dive_status queue state for Quarterly Engine
        let deepDiveStatus = "not_required";
        const concallType = getConcallType(title, announcementText, ann.attachment || docUrl);
        // "Outcome of Board Meeting - Financial Results ... and AGM date" must not be excluded just because it mentions an AGM:
        // generic meeting words only exclude when the title is NOT a results/presentation/transcript title and not an intimation.
        const titleHasResultSignal = /financial\s+results?|un-?audited|audited\s+financial|quarterly\s+results?|transcript|investor\s+presentation|earnings\s+presentation/.test(titleLower);
        const titleIsIntimation = /intimation|prior\s+intimation|schedule\s+of|notice\s+of|trading\s+window|closure\s+of|invite|invitation/.test(titleLower);
        const EXCLUSION_OVERRIDABLE = new Set(["agm", "egm", "general meeting", "shareholders meeting", "voting results", "xbrl", "investor meet"]);
        const isExcludedFromEarnings =
          NEVER_EARNINGS_TITLES.some(p => titleLower.includes(p) && !(EXCLUSION_OVERRIDABLE.has(p) && titleHasResultSignal && !titleIsIntimation)) ||
          filingCategory === "ROUTINE_COMPLIANCE";
        if (concallType === "audio") {
          deepDiveStatus = "pending_audio";
        } else if (concallType === "transcript") {
          // If transcript arrives, check if Stage 1 already ran for this stock
          const prevCompleted = await pool.query(
            "SELECT id FROM corporate_announcements WHERE ticker = $1 AND deep_dive_status = 'completed' LIMIT 1",
            [ticker]
          );
          deepDiveStatus = prevCompleted.rows.length > 0 ? "pending_stage2" : "pending_stage1";
        } else if ((aiResult.is_earnings_release || filingCategory === "QUARTERLY_EARNINGS") && !isExcludedFromEarnings) {
          deepDiveStatus = "pending_stage1";
        }

        // 7. Alert ONLY if non-earnings routine/regulatory event (Earnings Results & Concalls/Audio are deferred to Quarterly Deep-Dive Worker for verified full-page/audio audit)
        let sentToTelegram = false;
        let telegramFailed = false;
        const isRegulatoryOrCredit = ["REGULATORY_ACTION", "CREDIT_EVENT"].includes(filingCategory);
        
        // 7a. Clerical Corrigendums & Erratas Gate (Clerical amendments to meeting notices, agendas, disclosures)
        const isCorrigendumOrErrata = Boolean(
          titleLower.includes("corrigendum") ||
          titleLower.includes("errata") ||
          (ann.attachment && (ann.attachment.toLowerCase().includes("corrigendum") || ann.attachment.toLowerCase().includes("errata")))
        );

        if (isCorrigendumOrErrata && !titleLower.includes("financial result") && !announcementText.toLowerCase().includes("un-audited financial")) {
          aiResult.priority = "LOW";
          console.log(`[CORRIGENDUM/ERRATA] Routine clerical corrigendum/errata for ${ticker}. Downgraded priority to LOW.`);
        }

        // 7b. Statutory Voting Results & Scrutinizer Reports Gate
        const isVotingOrScrutinizerFiling = Boolean(
          titleLower.includes("voting result") ||
          titleLower.includes("voting results") ||
          titleLower.includes("scrutinizer") ||
          titleLower.includes("regulation 44") ||
          titleLower.includes("reg 44") ||
          (ann.attachment && (
            ann.attachment.toLowerCase().includes("votingresult") ||
            ann.attachment.toLowerCase().includes("voting_result") ||
            ann.attachment.toLowerCase().includes("scrutinizer") ||
            ann.attachment.toLowerCase().includes("reg44") ||
            ann.attachment.toLowerCase().includes("regulation44")
          )) ||
          announcementText.toLowerCase().includes("scrutinizer's report") ||
          announcementText.toLowerCase().includes("scrutinizer report")
        );

        const isEgm = Boolean(
          aiResult?.is_egm ||
          eventAnalysis?.is_egm ||
          title.toUpperCase().includes("EGM") ||
          title.toUpperCase().includes("EXTRAORDINARY GENERAL MEETING") ||
          (ann.attachment && ann.attachment.toLowerCase().includes("egm"))
        );

        const isPostalBallot = Boolean(
          aiResult?.is_postal_ballot ||
          eventAnalysis?.is_postal_ballot ||
          title.toLowerCase().includes("postal ballot") ||
          (ann.attachment && ann.attachment.toLowerCase().includes("postalballot"))
        );

        const isAgm = !isEgm && !isPostalBallot && Boolean(
          aiResult?.is_agm || 
          eventAnalysis?.is_agm || 
          title.toUpperCase().includes("AGM") || 
          title.toUpperCase().includes("ANNUAL GENERAL MEETING") ||
          (title.toLowerCase().includes("shareholders meeting") && !title.toUpperCase().includes("EGM")) ||
          (ann.attachment && ann.attachment.toLowerCase().includes("agm"))
        );

        const isAgmCompleted = isAgm && (
          aiResult?.agm_status === "completed" ||
          title.toUpperCase().includes("OUTCOME") || 
          title.toUpperCase().includes("PROCEEDINGS") || 
          title.toUpperCase().includes("VOTING RESULTS") ||
          isVotingOrScrutinizerFiling ||
          (ann.attachment && (
            ann.attachment.toLowerCase().includes("outcome") || 
            ann.attachment.toLowerCase().includes("proceedings") ||
            ann.attachment.toLowerCase().includes("votingresult") ||
            ann.attachment.toLowerCase().includes("scrutinizer")
          ))
        );

        // Defer Stage 1 results, Stage 2 concall, and audio deep dives to quarterly-deepdive-worker.js
        const isQueuedForDeepDive = deepDiveStatus === "pending_stage1" || deepDiveStatus === "pending_stage2" || deepDiveStatus === "pending_audio";
        
        // AGM filings must only alert if they contain genuine substantive business insights (e.g. Chairman speech, capacity roadmap, order pipeline)
        // Routine procedural voting cover letters (ordinary business, dividend confirmation, director rotation, scrutinizer reports) are LOW priority and must be suppressed.
        const isAgmFiling = isAgm || isAgmCompleted;
        const agmHighlightStr = typeof aiResult?.agm_highlights === "string" ? aiResult.agm_highlights.toLowerCase() : JSON.stringify(aiResult?.agm_highlights || "").toLowerCase();
        const isProceduralResolutionText = 
          agmHighlightStr.includes("adoption of audited") ||
          agmHighlightStr.includes("adoption of financial") ||
          agmHighlightStr.includes("re-appointment of") ||
          agmHighlightStr.includes("reappointment of") ||
          agmHighlightStr.includes("appointment of director") ||
          agmHighlightStr.includes("ordinary resolution") ||
          agmHighlightStr.includes("ordinary business") ||
          agmHighlightStr.includes("requisite majority") ||
          agmHighlightStr.includes("scrutinizer");

        const hasSubstantiveAgmAddress = Boolean(
          titleLower.includes("speech") ||
          titleLower.includes("address") ||
          titleLower.includes("presentation") ||
          announcementText.toLowerCase().includes("chairman's speech") ||
          announcementText.toLowerCase().includes("chairmans speech") ||
          announcementText.toLowerCase().includes("managing director's address")
        );

        const hasMaterialAgmHighlights = isAgmFiling && (
          hasSubstantiveAgmAddress ||
          (Boolean(aiResult?.has_substantive_business_insights) && !isProceduralResolutionText && !isVotingOrScrutinizerFiling)
        );

        if (isVotingOrScrutinizerFiling && !hasSubstantiveAgmAddress) {
          aiResult.priority = "LOW";
          console.log(`[VOTING/SCRUTINIZER] Procedural voting results / scrutinizer report for ${ticker}. Downgraded priority to LOW.`);
        }

        // Check routine credit rating reaffirmation (annual surveillance reaffirming existing limits with stable outlook has zero price impact)
        const isRoutineCreditReaffirmation = filingCategory === "CREDIT_EVENT" && isRoutineCreditRatingReaffirmation({
          title,
          text: announcementText,
          summary: aiResult?.summary,
          extractedData: aiResult?.corporate_actions
        });

        if (isRoutineCreditReaffirmation) {
          aiResult.priority = "LOW";
          console.log(`[CREDIT SURVEILLANCE] Routine credit rating reaffirmation for ${ticker} (no upgrade/downgrade/negative watch). Downgraded priority to LOW.`);
        }

        // Alert only on genuine business/thesis catalysts & material risks (Strict zero-suppression gate for all price-sensitive events)
        const isMajorCorporateAction = [
          "CAPEX_COMMISSIONING",
          "ORDER_WIN",
          "CAPITAL_RAISE",
          "CAPITAL_RETURN",
          "RESTRUCTURING",
          "REGULATORY_ACTION",
          "GOVERNANCE_RISK",
          "CREDIT_EVENT",
          "ACQUISITION"
        ].includes(filingCategory) && !isRoutineCreditReaffirmation;

        const isUnparsedZipFallback = (
          (docUrl && docUrl.endsWith(".zip")) || 
          announcementText.includes("[NO TEXT EXTRACTED") || 
          announcementText.includes("[NO FILING TEXT AVAILABLE")
        ) && (
          aiResult.summary?.toLowerCase().includes("no further details") || 
          aiResult.confidence === "LOW"
        );

        // Meeting filings (AGM, EGM, Postal Ballot) are permanently suppressed from Telegram per user mandate.
        // They are silently logged and archived into the database without alerting the user.
        const isMeetingFiling = isAgm || isAgmCompleted || isEgm || isPostalBallot;

        const isSuppressedCorrigendum = isCorrigendumOrErrata && (
          filingCategory === "ROUTINE_COMPLIANCE" || 
          aiResult.priority === "LOW" || 
          String(aiResult?.impact || "").includes("NEUTRAL")
        );

        // Earnings-call invitations are filed as routine "Con. Call Updates"; the user still wants the date/time heads-up.
        const concallSchedule = (concallType === "scheduled" && !isMeetingFiling && isEarningsConcallInvite(title, announcementText))
          ? extractConcallSchedule(`${title}\n${announcementText}`, { date: aiResult.concall_date, time: aiResult.concall_time })
          : null;
        const isConcallScheduleAlert = Boolean(concallSchedule) && ageHrs <= MAX_ALERT_AGE_HOURS &&
          // an invitation whose date is known and already past is stale news
          !(concallSchedule.date === null && /held\s+on|was\s+held|concluded/i.test(announcementText.slice(0, 1500)));

        // A newspaper clipping repeats results that are analysed from the full filing; alone it is a thin, number-free alert.
        const isNewspaperClipping = isNewspaperPublicationFiling(title, ann.attachment || docUrl);
        if (isNewspaperClipping) {
          console.log(`[SKIP NEWSPAPER] Statutory newspaper publication for ${ticker} is not alerted on its own: ${title}`);
        }

        const shouldHaveAlerted = isConcallScheduleAlert || ageHrs <= MAX_ALERT_AGE_HOURS && !isQueuedForDeepDive &&
          !isNewspaperClipping &&
          !isUnparsedZipFallback &&
          !isMeetingFiling && 
          !isRoutineCreditReaffirmation && 
          !isSuppressedCorrigendum && (
          (aiResult.priority === "HIGH") ||
          (isMajorCorporateAction && aiResult.priority !== "LOW" && !String(aiResult?.impact || "").includes("NEUTRAL")) ||
          (aiResult.priority === "MEDIUM" && !String(aiResult?.impact || "").includes("NEUTRAL") && aiResult.has_substantive_business_insights)
        );

        // 7a. Event-level Deduplication Guard (Check if alert sent recently for same ticker & event identity)
        let isDuplicateEvent = false;
        if (shouldHaveAlerted && !forceReevaluate) {
          // A rescheduled call must go out even though the original invitation was alerted
          isDuplicateEvent = !(isConcallScheduleAlert && aiResult.is_rescheduled) && await isEventAlertRecentlySent({
            ticker,
            title,
            summary: aiResult.summary,
            concall_type: concallType,
            is_earnings_release: aiResult.is_earnings_release,
            attachment_url: docUrl,
            filing_category: filingCategory,
            raw_text: announcementText
          });
          if (isDuplicateEvent) {
            console.log(`[SKIP DUP] Event alert already sent for ${ticker} ("${title}"). Skipping duplicate Telegram alert.`);
          }
        }

        if (shouldHaveAlerted && !isDuplicateEvent) {
          if (alertsSent >= MAX_ALERTS_PER_RUN) {
            // Save as 'pending' so the next scheduled run re-evaluates it — never permanently drop.
            console.warn(`[LIMIT] Max alerts reached. Saving ${ticker} announcement as 'pending' for next run.`);
          } else if (isDryRun) {
            console.log(`[DRY RUN] Would send alert for ${ticker}: ${title}`);
          } else {
            try {
              const sendResult = isConcallScheduleAlert
                ? await withRetry(() => sendConcallScheduleAlert({
                    ticker,
                    companyName: stock.company_name,
                    schedule: concallSchedule,
                    isRescheduled: Boolean(aiResult.is_rescheduled),
                    docUrl,
                    summary: aiResult.summary,
                    resultDate: sanitizeResultDate(aiResult.result_date, timestamp) || sanitizeResultDate(extractResultDateFromText(announcementText), timestamp)
                  }), "Concall Schedule Alert")
                : await withRetry(() => sendAnnouncementAlert({
                ticker,
                companyName: stock.company_name,
                title,
                priority: aiResult.priority,
                impact: aiResult.impact,
                summary: aiResult.summary,
                forward_catalysts: aiResult.forward_catalysts,
                financial_metrics: aiResult.financial_metrics,
                corporate_actions: aiResult.corporate_actions,
                confidence: aiResult.confidence,
                key_data: aiResult.key_data,
                deep_dive_indicator: aiResult.deep_dive_indicator,
                promises_reconciliation: aiResult.promises_reconciliation,
                thesis_strengthened: aiResult.thesis_strengthened,
                key_omissions_or_risks: aiResult.key_omissions_or_risks,
                result_date: aiResult.result_date,
                is_earnings_release: aiResult.is_earnings_release,
                concall_type: concallType,
                concall_date: aiResult.concall_date,
                concall_time: aiResult.concall_time,
                is_routine_credit_reaffirmation: isRoutineCreditReaffirmation,
                is_rescheduled: aiResult.is_rescheduled,
                category: stock.category,
                filing_category: filingCategory,
                exchangeTimestamp: timestamp,
                docUrl,
                attachment_url: docUrl,
                source: annSource,
                is_agm: isAgm,
                is_egm: isEgm,
                is_postal_ballot: isPostalBallot,
                agm_status: isAgmCompleted ? "completed" : (aiResult.agm_status || "scheduled"),
                agm_highlights: aiResult.agm_highlights,
                has_substantive_business_insights: aiResult.has_substantive_business_insights,
                eventAnalysis
              }), "Telegram Alert");
              // sendAnnouncementAlert returns false when its own gate suppressed the alert (AGM / corrigendum / routine);
              // that must not be recorded as "sent".
              if (sendResult) {
                sentToTelegram = true;
                alertsSent++;
              } else {
                console.log(`[SUPPRESSED] Sender gate suppressed alert for ${ticker}: ${title}`);
              }
            } catch (err) {
              telegramFailed = true;
              console.error(`Telegram alert permanently failed for ${ticker}:`, err.message);
            }
          }
        }

        // 8. Save to DB (Skipped entirely during dry runs to prevent poisoning deduplication checks)
        if (isDryRun) {
          continue;
        }

        // A delivery failure must be retried next scan ('failed' rows are re-evaluated), never archived as 'ignored'.
        const dbStatus = sentToTelegram
          ? "sent"
          : (telegramFailed && ageHrs <= MAX_ALERT_AGE_HOURS
              ? "failed"
              : (shouldHaveAlerted && !isDuplicateEvent && alertsSent >= MAX_ALERTS_PER_RUN ? "pending" : "ignored"));

        await saveAnnouncement({
          stock_id: stock.id,
          ticker,
          source_id: sourceId,
          title_hash: hash,
          title,
          raw_text: (announcementText && announcementText.length > 50) ? announcementText.substring(0, 4000) : title,
          priority: aiResult.priority,
          impact: aiResult.impact,
          confidence: aiResult.confidence,
          summary: aiResult.summary,
          status: dbStatus,
          sent_to_telegram: sentToTelegram,
          is_earnings_release: aiResult.is_earnings_release || false,
          attachment_url: docUrl,
          filing_date: timestamp,
          filing_category: (isAgmCompleted || (isAgm && hasMaterialAgmHighlights)) ? "AGM_DISCLOSURE" : filingCategory,
          event_analysis: eventAnalysis,
          deep_dive_status: deepDiveStatus,
          key_data: aiResult.key_data,
          deep_dive_indicator: aiResult.deep_dive_indicator
        });

        // 8b. Ingest into interquarter_events if completed AGM contains strategic commentary
        if ((isAgmCompleted || isAgm) && hasMaterialAgmHighlights && !isDryRun) {
          try {
            const eventTitle = `AGM Proceedings: ${ticker} (${new Date().getFullYear()})`;
            const existing = await pool.query(
              `SELECT id FROM interquarter_events WHERE stock_id = $1 AND title = $2 LIMIT 1`,
              [stock.id, eventTitle]
            );
            const highlightsText = Array.isArray(aiResult.agm_highlights)
              ? aiResult.agm_highlights.map(h => `• ${h}`).join("\n")
              : (aiResult.agm_highlights || aiResult.key_data || "");

            if (existing.rows.length === 0) {
              await pool.query(
                `INSERT INTO interquarter_events 
                  (stock_id, ticker, event_date, event_type, title, description, bse_filing_url)
                 VALUES ($1, $2, $3, 'AGM_DISCLOSURE', $4, $5, $6)`,
                [
                  stock.id,
                  ticker,
                  timestamp ? new Date(timestamp) : new Date(),
                  eventTitle,
                  `${aiResult.summary}\n\nKey Highlights:\n${highlightsText}`,
                  docUrl
                ]
              );
              console.log(`[AGM] Recorded interquarter AGM disclosure for ${ticker}`);
            }
          } catch (e) {
            console.warn(`[AGM] Failed to record interquarter event for ${ticker}:`, e.message);
          }
        }

        // 9. Update Result Date if found (AI extraction or deterministic board meeting pattern)
        const detectedResultDate = aiResult.result_date || extractResultDateFromText(announcementText);
        if (detectedResultDate) {
          await updateStockResultDate(stock.id, detectedResultDate, "HIGH");
        }
      }
    } catch (err) {
      console.error(`Failed to scan ${stock.ticker}:`, err.message);
    }
  }

  console.log("Scan complete.");

  // Trigger queued quarterly deep-dives (results / presentations / concalls). The worker is deadline-aware: it never starts
  // new filings after the budget, sends each alert BEFORE slow optional work, and parks undeliverable alerts for retry.
  try {
    if (!isDryRun) {
      console.log("[SCAN] Triggering queued quarterly deep-dives...");
      const workerDeadline = startTime + WORKER_DEADLINE_MS;
      for (let round = 0; round < 6; round++) {
        if (Date.now() > workerDeadline) break;
        const r = await processPendingDeepDives({ deadlineAt: workerDeadline });
        // Keep draining only while the queue is deep and nothing is failing (failures retry next cycle)
        if (!r || !r.found || r.found < 4 || r.failed > 0 || r.processed === 0) break;
      }
    }
  } catch (err) {
    console.error("[SCAN WARN] Deep-dive worker execution failed:", err.message);
  }

  // ── AI health guard: tell the user when the LLM chain is down / a provider is retired (never throws) ──
  if (!isDryRun && !targetTicker) {
    // let a running model refresh finish and persist before the process exits (the daemon restarts every 5 minutes)
    await settleModelRegistry(60000);
    await reportLlmHealth({ store: dbStore(pool), send: sendTelegramMessage, providers: getConfiguredProviders(), onBroken: markModelsDirty });
    await settleModelRegistry(60000);
  }

  // ── End-of-run summary to Telegram ───────────────────────────────────────
  const durationMs = Date.now() - startTime;
  try {
    await sendRunSummary({
      stocksScanned: stocks.length,
      newAnnouncements,
      alertsSent,
      bseErrors,
      nseErrors,
      durationMs,
      runUrl,
      isDryRun,
    });
  } catch (err) {
    console.error("[WARN] Failed to send run summary:", err.message);
  }

  // ── Market-Hours Midday Valuation Dislocation Watchdog (1:00 PM IST) ─────
  // Evaluates universe daily at 1:00 PM IST during active market hours
  try {
    if (!isDryRun && await isDailyValuationWatchdogNeeded(pool)) {
      console.log("[SCAN] 🎯 1:00 PM IST Market Hours: Syncing live prices & running Valuation Dislocation Watchdog...");
      try {
        await syncAllPortfolioValuations(pool);
      } catch (syncErr) {
        console.warn("[SCAN WARN] Midday market price sync before watchdog encountered an issue:", syncErr.message);
      }
      const watchdog = await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false });
      if (watchdog?.alertsFailed) {
        // A delivery failure leaves the day unmarked so the next scan cycle retries (failed rows do not start a cooldown).
        console.warn(`[SCAN WARN] Valuation alert delivery failed for ${watchdog.failedTickers.join(", ")}; will retry next cycle.`);
      } else {
        await markDailyValuationWatchdogExecuted(pool);
      }
    }
  } catch (err) {
    console.error("[SCAN WARN] Market-hours valuation watchdog failed:", err.message);
  }



  // ── Health & Uptime Circuit Breaker ────────────────────────────────────────
  if (!isDryRun && !targetTicker) {
    await recordScannerSuccess();
  }

  return { stocksScanned: stocks.length, newAnnouncements, alertsSent, bseErrors, nseErrors, durationMs };
}

// Check if run directly
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const forceReevaluate = args.includes("--force-reevaluate");
  const tickerIdx = args.indexOf("--ticker");
  const targetTicker = tickerIdx !== -1 && args[tickerIdx + 1] ? args[tickerIdx + 1] : null;

  scan({ isDryRun, forceReevaluate, targetTicker }).then(() => {
    console.log("Process finished.");
    process.exit(0);
  }).catch(async (err) => {
    console.error("Fatal error during scan:", err);
    try {
      await recordScannerFailure(err, { environment: "Server PM2 Daemon" });
    } catch (recErr) {
      console.error("Failed to record failure in DB:", recErr.message);
    }
    process.exit(1);
  });
}
