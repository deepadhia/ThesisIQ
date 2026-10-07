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
  isHeartbeatNeeded,
  markHeartbeatSent,
  extractTextFromPdfUrl,
  extractResultDateFromText,
  isConcallOrTranscript,
  getConcallType,
  isNightlyQuietSummaryNeeded,
  sendNightlyQuietSummary,
  recordScannerSuccess,
  recordScannerFailure
} from "../services/announcement.service.js";
import { classifyAnnouncementWithNim } from "../services/nim.service.js";
import { classifyFilingCategory, extractCorporateActionDetails, isRoutineCreditRatingReaffirmation } from "../services/filing-classifier.service.js";
import { processPendingDeepDives } from "../workers/quarterly-deepdive-worker.js";
import { sendAnnouncementAlert, sendRunSummary, sendTelegramMessage, buildBseDocumentUrl } from "../services/telegram.service.js";
import { 
  evaluateAndDispatchDislocationAlerts,
  isDailyValuationWatchdogNeeded,
  markDailyValuationWatchdogExecuted
} from "../services/valuation-dislocation-watchdog.service.js";
import { syncAllPortfolioValuations } from "../services/portfolio-market-valuation.service.js";
import { pool } from "../db/pool.js";

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

const MAX_ALERTS_PER_RUN = 10;

/**
 * Daily Heartbeat to confirm the system is alive.
 * Sent at ~9:30 AM (handled by cron or manual run check).
 */
async function sendHeartbeat() {
  const needed = await isHeartbeatNeeded();
  if (needed) {
    const today = new Date().toLocaleDateString("en-IN", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });
    const time = new Date().toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    const msg = `🟢 *SYSTEM HEARTBEAT ACTIVE*\n` +
      `──────────────────────────────\n` +
      `📡 *Status:* 24/7 Corporate Filing Scanner Online\n` +
      `📅 *Date:* ${today} (${time} IST)\n` +
      `🎯 *Scope:* BSE & NSE Watchlist Filings\n` +
      `──────────────────────────────\n` +
      `_ThesisIQ Monitoring Engine Active_`;
    await sendTelegramMessage(msg);
    await markHeartbeatSent();
    console.log("Heartbeat sent.");
  }
}

/**
 * Main Scanning Orchestrator
 */
export async function scan({ isDryRun = false, runUrl = null, targetTicker = null, forceReevaluate = false } = {}) {
  writeLog("SCANNER", `🟢 Starting Corporate Announcement Scan... ${isDryRun ? "[DRY RUN]" : "[LIVE DAEMON]"}${forceReevaluate ? " [FORCE REEVALUATE]" : ""}`);
  const startTime = Date.now();

  // 0. System Cleanup & Heartbeat
  await resetStuckPending();
  if (!targetTicker) {
    await sendHeartbeat();
  }

  // 1. Get portfolio & watchlist stocks dynamically from DB
  let query = "SELECT id, ticker, company_name, COALESCE(nse_symbol, ticker) AS nse_symbol, bse_scrip_code, investment_thesis, category FROM stocks WHERE (category IN ('Core', 'Watchlist') OR category IS NULL)";
  const params = [];
  if (targetTicker) {
    query += " AND UPPER(TRIM(ticker)) = $1";
    params.push(targetTicker.toUpperCase().trim());
  }
  query += " ORDER BY ticker";
  const { rows: stocks } = await pool.query(query, params);
  writeLog("SCANNER", `🔍 Monitoring ${stocks.length} stock(s) across NSE & BSE${targetTicker ? ` (Filtered: ${targetTicker})` : ''}`);

  // ── Run-level stats (for end-of-run summary) ──
  let alertsSent        = 0;
  let newAnnouncements  = 0;
  let bseErrors         = 0;
  let nseErrors         = 0;

  for (const stock of stocks) {
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
        const hash = generateAnnouncementHash(stock.ticker, title, timestamp);
        if (!mergedMap.has(hash)) {
          mergedMap.set(hash, { ...ann, hash, _source: "BSE" });
        }
      });
      nseList.forEach(ann => {
        const title = ann.NEWSSUB;
        const timestamp = ann.DT_TM;
        const hash = generateAnnouncementHash(stock.ticker, title, timestamp);
        if (!mergedMap.has(hash)) {
          mergedMap.set(hash, { ...ann, hash, _source: "NSE" });
        }
      });

      const uniqueAnnouncements = Array.from(mergedMap.values());
      console.log(`Merged to ${uniqueAnnouncements.length} unique announcements for ${stock.ticker}`);

      for (const ann of uniqueAnnouncements) {
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
          const isGenericTitle = GENERIC_TITLES.includes(title);

          if (!isGenericTitle) {
            // Use first 3 words for the fuzzy prefix (single-word is too broad for common words like "Award")
            const prefixWords = title.split(' ').slice(0, 3).join(' ');
            const fuzzyResult = await pool.query(
              `SELECT id FROM corporate_announcements 
               WHERE ticker = $1 
               AND (title ILIKE $2 OR $3 ILIKE '%' || title || '%')
               AND status = 'sent' 
               AND processed_at > NOW() - interval '24 hours'`,
              [ticker, `%${prefixWords}%`, title]
            );
            if (fuzzyResult.rows.length > 0) {
              console.log(`[SKIP] Fuzzy duplicate detected for ${ticker}: ${title}`);
              continue;
            }
          }
        }

        newAnnouncements++;

        console.log(`[NEW] Found potential announcement for ${ticker}: ${title}`);

        // 5c. Fetch PDF Content for Deep Analysis
        let announcementText = title; // Default to title
        let docUrl = null;

        if (annSource === "BSE" && newsId) {
          docUrl = buildBseDocumentUrl(newsId, pdfFlag);
        } else if (annSource === "NSE" && ann.attachment) {
          // NSE API usually provides a direct attachment path
          docUrl = ann.attachment.startsWith('http') ? ann.attachment : `https://nsearchives.nseindia.com/corporate/${ann.attachment}`;
        }

        let extractedText = "";
        if (docUrl) {
          console.log(`[PDF] Extracting text from: ${docUrl}`);
          extractedText = await extractTextFromPdfUrl(docUrl);
        }

        const isMaterialActionText = 
          title.toLowerCase().includes("rights issue") ||
          title.toLowerCase().includes("preferential") ||
          title.toLowerCase().includes("qip") ||
          title.toLowerCase().includes("acquisition") ||
          title.toLowerCase().includes("merger") ||
          title.toLowerCase().includes("demerger") ||
          title.toLowerCase().includes("amalgamation") ||
          (ann.attachment_text && (
            ann.attachment_text.toLowerCase().includes("rights issue") ||
            ann.attachment_text.toLowerCase().includes("preferential") ||
            ann.attachment_text.toLowerCase().includes("qip") ||
            ann.attachment_text.toLowerCase().includes("acquisition") ||
            ann.attachment_text.toLowerCase().includes("subsidiary")
          ));

        if (extractedText && extractedText.trim().length > 50) {
          announcementText = `TITLE: ${title}\n\nCONTENT:\n${extractedText}`;
          console.log(`[PDF] Successfully extracted ${extractedText.length} chars.`);
        } else if (docUrl && isMaterialActionText && (!extractedText || extractedText.trim().length <= 50)) {
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

        // 6. NVIDIA NIM AI Classify (Stage 2) with Retry
        let aiResult;
        try {
          aiResult = await withRetry(() => classifyAnnouncementWithNim(ticker, announcementText, title, stock.investment_thesis), "AI Classification");
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
          "xbrl"
        ];
        const titleLower = title.toLowerCase();
        if (aiResult.is_earnings_release && NEVER_EARNINGS_TITLES.some(p => titleLower.includes(p))) {
          console.warn(`[OVERRIDE] is_earnings_release forced false by title pattern: ${ticker} - ${title}`);
          aiResult.is_earnings_release = false;
        }

        // 6e. Specialized Filing Category Classification & Detail Extraction
        const filingCategory = classifyFilingCategory(title, announcementText);
        let eventAnalysis = null;
        if (filingCategory !== "GENERAL" && filingCategory !== "ROUTINE_COMPLIANCE") {
          eventAnalysis = await extractCorporateActionDetails(filingCategory, ticker, announcementText, stock.investment_thesis);
        }

        // Determine deep_dive_status queue state for Quarterly Engine
        let deepDiveStatus = "not_required";
        const concallType = getConcallType(title, announcementText);
        const isExcludedFromEarnings = NEVER_EARNINGS_TITLES.some(p => titleLower.includes(p)) || filingCategory === "ROUTINE_COMPLIANCE";
        if ((aiResult.is_earnings_release || filingCategory === "QUARTERLY_EARNINGS") && !isExcludedFromEarnings) {
          deepDiveStatus = "pending_stage1";
        } else if (concallType === "audio" && !isExcludedFromEarnings) {
          deepDiveStatus = "pending_audio";
        } else if (concallType === "transcript" && !isExcludedFromEarnings) {
          // If transcript arrives, check if Stage 1 already ran for this stock
          const prevCompleted = await pool.query(
            "SELECT id FROM corporate_announcements WHERE ticker = $1 AND deep_dive_status = 'completed' LIMIT 1",
            [ticker]
          );
          deepDiveStatus = prevCompleted.rows.length > 0 ? "pending_stage2" : "pending_stage1";
        }

        // 7. Alert ONLY if non-earnings routine/regulatory event (Earnings Results & Concalls/Audio are deferred to Quarterly Deep-Dive Worker for verified full-page/audio audit)
        let sentToTelegram = false;
        const isRegulatoryOrCredit = ["REGULATORY_ACTION", "CREDIT_EVENT"].includes(filingCategory);
        
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
          (ann.attachment && (ann.attachment.toLowerCase().includes("outcome") || ann.attachment.toLowerCase().includes("proceedings")))
        );

        // Defer Stage 1 results, Stage 2 concall, and audio deep dives to quarterly-deepdive-worker.js
        const isQueuedForDeepDive = deepDiveStatus === "pending_stage1" || deepDiveStatus === "pending_stage2" || deepDiveStatus === "pending_audio";
        
        // AGM filings must only alert if they contain genuine substantive business insights (e.g. Chairman speech, capacity roadmap, order pipeline)
        // Routine procedural voting cover letters (ordinary business, dividend confirmation, director rotation) are LOW priority and must be suppressed.
        const isAgmFiling = isAgm || isAgmCompleted;
        const hasMaterialAgmHighlights = isAgmFiling && Boolean(
          aiResult?.has_substantive_business_insights ||
          (aiResult?.agm_highlights && (Array.isArray(aiResult.agm_highlights) ? aiResult.agm_highlights.length > 0 : (aiResult.agm_highlights.trim().length > 20 && !aiResult.agm_highlights.toLowerCase().includes("null"))))
        );

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

        // Procedural AGM voting tallies and scrutinizer reports must NEVER alert
        const isProceduralAgm = isAgmFiling && !hasMaterialAgmHighlights && !aiResult?.has_substantive_business_insights;

        const shouldHaveAlerted = !isQueuedForDeepDive && !isUnparsedZipFallback && !isProceduralAgm && !isRoutineCreditReaffirmation && (
          (aiResult.priority === "HIGH" && !isAgmFiling) ||
          (isMajorCorporateAction && aiResult.priority !== "LOW") ||
          (isAgmFiling && aiResult.priority !== "LOW" && hasMaterialAgmHighlights) ||
          (aiResult.priority === "MEDIUM" && (aiResult.has_substantive_business_insights || hasMaterialAgmHighlights))
        );

        // 7a. Event-level Deduplication Guard (Check if alert sent recently for same ticker & event identity)
        let isDuplicateEvent = false;
        if (shouldHaveAlerted && !forceReevaluate) {
          isDuplicateEvent = await isEventAlertRecentlySent({
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
              await withRetry(() => sendAnnouncementAlert({
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
                source: annSource,
                is_agm: isAgm,
                is_egm: isEgm,
                is_postal_ballot: isPostalBallot,
                agm_status: isAgmCompleted ? "completed" : (aiResult.agm_status || "scheduled"),
                agm_highlights: aiResult.agm_highlights,
                has_substantive_business_insights: aiResult.has_substantive_business_insights,
                eventAnalysis
              }), "Telegram Alert");
              sentToTelegram = true;
              alertsSent++;
            } catch (err) {
              console.error(`Telegram alert permanently failed for ${ticker}:`, err.message);
            }
          }
        }

        // 8. Save to DB (Skipped entirely during dry runs to prevent poisoning deduplication checks)
        if (isDryRun) {
          continue;
        }

        const dbStatus = sentToTelegram
          ? "sent"
          : (shouldHaveAlerted && !isDuplicateEvent && alertsSent >= MAX_ALERTS_PER_RUN ? "pending" : "ignored");

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

  // Trigger queued quarterly deep-dives
  try {
    if (!isDryRun) {
      console.log("[SCAN] Triggering queued quarterly deep-dives...");
      await processPendingDeepDives();
    }
  } catch (err) {
    console.error("[SCAN WARN] Deep-dive worker execution failed:", err.message);
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
      await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false });
      await markDailyValuationWatchdogExecuted(pool);
    }
  } catch (err) {
    console.error("[SCAN WARN] Market-hours valuation watchdog failed:", err.message);
  }

  // ── Nightly quiet-day summary ─────────────────────────────────────────────
  // Sends once per day at >= 21:00 IST, only when zero Telegram alerts fired.
  try {
    if (!isDryRun && await isNightlyQuietSummaryNeeded()) {
      console.log("[SCAN] Sending nightly quiet-day summary...");
      await sendNightlyQuietSummary(stocks.length);
    }
  } catch (err) {
    console.error("[WARN] Failed to send nightly quiet summary:", err.message);
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
  scan().then(() => {
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
