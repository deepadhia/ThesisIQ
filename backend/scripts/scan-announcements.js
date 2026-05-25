import { 
  fetchBseAnnouncements, 
  fetchNseAnnouncements,
  shouldProcessAnnouncement, 
  generateAnnouncementHash, 
  isAnnouncementProcessed,
  saveAnnouncement,
  updateStockResultDate,
  resetStuckPending,
  isHeartbeatNeeded,
  markHeartbeatSent,
  extractTextFromPdfUrl,
  isConcallOrTranscript,
  getConcallType
} from "../services/announcement.service.js";
import { classifyAnnouncementWithNim } from "../services/nim.service.js";
import { sendAnnouncementAlert, sendRunSummary, sendTelegramMessage, buildBseDocumentUrl } from "../services/telegram.service.js";
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
    const today = new Date().toLocaleDateString("en-IN", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    await sendTelegramMessage(`🟢 *System Heartbeat*\n\nScanner is active and monitoring watchlist.\nDate: ${today}`);
    await markHeartbeatSent();
    console.log("Heartbeat sent.");
  }
}

/**
 * Main Scanning Orchestrator
 */
export async function scan({ isDryRun = false, runUrl = null } = {}) {
  console.log(`Starting Corporate Announcement Scan... ${isDryRun ? "[DRY RUN]" : ""}`);
  const startTime = Date.now();

  // 0. System Cleanup & Heartbeat
  await resetStuckPending();
  await sendHeartbeat();

  // 1. Get all stocks from DB
  const { rows: stocks } = await pool.query("SELECT id, ticker, bse_scrip_code, investment_thesis, category FROM stocks");
  console.log(`Scanning ${stocks.length} stocks...`);

  // ── Run-level stats (for end-of-run summary) ──
  let alertsSent        = 0;
  let newAnnouncements  = 0;
  let bseErrors         = 0;
  let nseErrors         = 0;

  for (const stock of stocks) {
    try {
      console.log(`Checking ${stock.ticker} (${stock.bse_scrip_code})...`);
      
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
        nseList = await fetchNseAnnouncements(stock.ticker);
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
        const processed = await isAnnouncementProcessed(ticker, sourceId, hash);
        if (processed) {
          continue;
        }

        const GENERIC_TITLES = ["General Updates", "Updates", "Corporate Announcement", "Press Release"];
        const isGenericTitle = GENERIC_TITLES.includes(title);

        if (!isGenericTitle) {
          const fuzzyResult = await pool.query(
            `SELECT id FROM corporate_announcements 
             WHERE ticker = $1 
             AND (title ILIKE $2 OR $3 ILIKE '%' || title || '%')
             AND status = 'sent' 
             AND processed_at > NOW() - interval '24 hours'`,
            [ticker, `%${title.split(' ')[0]}%`, title]
          );
          if (fuzzyResult.rows.length > 0) {
            console.log(`[SKIP] Fuzzy duplicate detected for ${ticker}: ${title}`);
            continue;
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

        if (ann.attachment_text) {
          console.log(`[TEXT] Using provided attachment text for ${ticker}`);
          announcementText = `TITLE: ${title}\n\nSUMMARY:\n${ann.attachment_text}`;
        } else if (docUrl) {
          console.log(`[PDF] Extracting text from: ${docUrl}`);
          const extractedText = await extractTextFromPdfUrl(docUrl);
          if (extractedText && extractedText.trim().length > 50) {
            announcementText = `TITLE: ${title}\n\nCONTENT:\n${extractedText}`;
            console.log(`[PDF] Successfully extracted ${extractedText.length} chars.`);
          } else {
            announcementText = `TITLE: ${title}\n\nCONTENT:\n[NO TEXT EXTRACTED: The PDF filing is either a scanned image, routine template, or unreadable.]`;
            console.log(`[PDF] Extraction failed or returned empty text. Passing error guard to AI.`);
          }
        } else {
          announcementText = `TITLE: ${title}\n\nCONTENT:\n[NO FILING TEXT AVAILABLE: Pure title intimation only.]`;
        }

        // 6. NVIDIA NIM AI Classify (Stage 2) with Retry
        let aiResult;
        try {
          aiResult = await withRetry(() => classifyAnnouncementWithNim(ticker, announcementText, title, stock.investment_thesis), "AI Classification");
        } catch (err) {
          console.error(`AI Classification permanently failed for ${ticker}:`, err.message);
          continue;
        }

        // 7. Alert if High Priority or Earnings Release or Concall/Transcript
        let sentToTelegram = false;
        const concallType = getConcallType(title, announcementText);
        if (concallType || aiResult.is_earnings_release || aiResult.priority === "HIGH" || (aiResult.priority === "MEDIUM" && aiResult.impact !== "NEUTRAL")) {
          if (alertsSent >= MAX_ALERTS_PER_RUN) {
            console.warn(`[LIMIT] Max alerts reached for this run. Skipping telegram for ${ticker}`);
          } else if (isDryRun) {
            console.log(`[DRY RUN] Would send alert for ${ticker}: ${title}`);
          } else {
            try {
              await withRetry(() => sendAnnouncementAlert({
                ticker,
                title,
                priority: aiResult.priority,
                impact: aiResult.impact,
                summary: aiResult.summary,
                confidence: aiResult.confidence,
                key_data: aiResult.key_data,
                deep_dive_indicator: aiResult.deep_dive_indicator,
                result_date: aiResult.result_date,
                is_earnings_release: aiResult.is_earnings_release,
                concall_type: concallType,
                concall_date: aiResult.concall_date,
                concall_time: aiResult.concall_time,
                is_rescheduled: aiResult.is_rescheduled,
                category: stock.category,
                exchangeTimestamp: timestamp,
                docUrl,
                source: annSource,
              }), "Telegram Alert");
              sentToTelegram = true;
              alertsSent++;
            } catch (err) {
              console.error(`Telegram alert permanently failed for ${ticker}:`, err.message);
            }
          }
        }

        // 8. Save to DB
        await saveAnnouncement({
          stock_id: stock.id,
          ticker,
          source_id: sourceId,
          title_hash: hash,
          title,
          raw_text: title,
          priority: aiResult.priority,
          impact: aiResult.impact,
          confidence: aiResult.confidence,
          summary: aiResult.summary,
          status: sentToTelegram ? "sent" : "ignored",
          sent_to_telegram: sentToTelegram,
          is_earnings_release: aiResult.is_earnings_release || false,
          attachment_url: docUrl,
          filing_date: timestamp
        });

        // 9. Update Result Date if found
        if (aiResult.result_date) {
          await updateStockResultDate(stock.id, aiResult.result_date, aiResult.confidence);
        }
      }
    } catch (err) {
      console.error(`Failed to scan ${stock.ticker}:`, err.message);
    }
  }

  console.log("Scan complete.");

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

  return { stocksScanned: stocks.length, newAnnouncements, alertsSent, bseErrors, nseErrors, durationMs };
}

// Check if run directly
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  scan().then(() => {
    console.log("Process finished.");
    process.exit(0);
  }).catch(err => {
    console.error("Fatal error during scan:", err);
    process.exit(1);
  });
}
