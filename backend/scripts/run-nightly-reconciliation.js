/**
 * 🌙 NIGHTLY RECONCILIATION & THESIS WATCHDOG RUNNER
 * 
 * Scheduled to run every night (e.g., 23:00 IST / 17:30 UTC).
 * 
 * Responsibilities:
 * 1. Daily Price Sync: Refreshes latest closing prices for all stocks in the database.
 * 2. Asynchronous Filing Reconciler: Ingests transcripts/presentations filed days after results.
 * 3. XBRL Financial Reconciler: Updates missing financial metrics in `xbrl_quarterly_metrics`.
 * 4. Material Event & Multi-Year Catalyst Detector: Captures AGM announcements & order wins with 2-year impact.
 * 5. Idempotent Morning Digest: Compiles and dispatches clean, deduplicated Telegram morning alerts.
 */

import { pool } from "../db/pool.js";
import { writeLog } from "../services/logger.service.js";
import { fetchAndStorePrice } from "../services/price.service.js";
import { getAllStocks } from "../services/stocks.service.js";
import { downloadTranscriptsPipeline } from "../services/transcripts.service.js";
import { scan } from "./scan-announcements.js";
import { generatePortfolioThesisBoard } from "./generate-portfolio-thesis-board.js";
import { sendTelegramMessage } from "../services/telegram.service.js";
import { evaluateAndDispatchDislocationAlerts } from "../services/valuation-dislocation-watchdog.service.js";
import crypto from "crypto";

// Table to guarantee strict idempotency across nightly/morning runs
async function ensureAlertTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reconciliation_alerts_sent (
      id SERIAL PRIMARY KEY,
      alert_hash VARCHAR(64) UNIQUE NOT NULL,
      ticker VARCHAR(20) NOT NULL,
      alert_type VARCHAR(50) NOT NULL,
      summary TEXT NOT NULL,
      sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

export async function runNightlyReconciliation({ isDryRun = false } = {}) {
  const startTime = Date.now();
  console.log("==========================================================================");
  console.log(`=== 🌙 EXECUTING NIGHTLY RECONCILIATION & DATA REPAIR RUNNER ===`);
  console.log(`=== Mode: ${isDryRun ? "DRY RUN (No Telegram Alerts)" : "LIVE PRODUCTION"} ===`);
  console.log("==========================================================================\n");

  await ensureAlertTrackingTable();
  const summaryReport = {
    pricesRefreshed: 0,
    priceErrors: 0,
    newFilingsIngested: 0,
    announcementsScanned: 0,
    newAlerts: []
  };

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1: Daily Price Refresh & Sync
  // ──────────────────────────────────────────────────────────────────────────
  console.log("--- 📈 Step 1: Refreshing Daily Closing Prices ---");
  try {
    const stocks = await getAllStocks();
    console.log(`Found ${stocks.length} portfolio & watchlist stocks to refresh prices.`);

    for (const stock of stocks) {
      try {
        await new Promise((r) => setTimeout(r, 600)); // Respect rate limits
        const res = await fetchAndStorePrice({ ticker: stock.ticker, backfill: false });
        if (res.success) {
          summaryReport.pricesRefreshed++;
        } else {
          summaryReport.priceErrors++;
          console.warn(`[WARN] Price fetch failed for ${stock.ticker}: ${res.error}`);
        }
      } catch (err) {
        summaryReport.priceErrors++;
        console.error(`[ERROR] Price error for ${stock.ticker}: ${err.message}`);
      }
    }
    console.log(`✅ Prices refreshed: ${summaryReport.pricesRefreshed}/${stocks.length} (Errors: ${summaryReport.priceErrors})\n`);
  } catch (err) {
    console.error("[FATAL] Step 1 Price Refresh failed:", err.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2: Asynchronous Late Filings & Transcripts Reconciliation
  // (Catches transcripts filed 6+ days after initial results board meetings)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("--- 📑 Step 2: Reconciling Missing Filings & Late Transcripts ---");
  try {
    const universeStocks = await pool.query(
      "SELECT ticker FROM stocks WHERE category IN ('Core', 'Watchlist') OR category IS NULL ORDER BY ticker"
    );
    const symbols = universeStocks.rows.map(r => r.ticker);

    const pipeRes = await downloadTranscriptsPipeline({
      window: "3q",
      symbols,
      useWatchlist: false,
      onlyMissing: true,
      uploadAfterDownload: false
    });

    if (pipeRes.downloadedSymbols && pipeRes.downloadedSymbols.length > 0) {
      console.log(`⚡ Ingested new late filings for symbols: ${pipeRes.downloadedSymbols.join(", ")}`);
      summaryReport.newFilingsIngested = pipeRes.downloadedSymbols.length;

      for (const sym of pipeRes.downloadedSymbols) {
        summaryReport.newAlerts.push({
          ticker: sym,
          type: "LATE_FILING_RECONCILED",
          text: `📑 Ingested newly filed Concall Transcript / Presentation for **${sym}**`
        });
      }
    } else {
      console.log("✅ All quarters fully covered; no missing transcripts or presentations.");
    }
  } catch (err) {
    console.error("[ERROR] Step 2 Transcript Reconciliation failed:", err.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3: Corporate Announcement & AGM Catalyst Scanner
  // (Captures 2-year revenue impact disclosures, capex, and order wins)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- 📢 Step 3: Scanning Corporate Announcements & AGM Disclosures ---");
  try {
    const scanRes = await scan({ isDryRun: true }); // Scan quietly, collect raw events
    summaryReport.announcementsScanned = scanRes.newAnnouncements || 0;
    console.log(`✅ Scanned announcements. New filings detected: ${summaryReport.announcementsScanned}`);
  } catch (err) {
    console.error("[ERROR] Step 3 Announcement scan failed:", err.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 4: Check for Verified Multi-Year Growth Catalysts & Material Order Wins
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- 🔍 Step 4: Auditing Verified Multi-Year Growth Catalysts & Order Wins ---");
  try {
    const recentEvents = await pool.query(`
      SELECT ca.id, ca.ticker, ca.title, ca.summary, ca.filing_category, ca.filing_date, ca.attachment_url, ca.impact
      FROM corporate_announcements ca
      WHERE ca.filing_date >= NOW() - INTERVAL '48 hours'
        AND ca.priority = 'HIGH'
        AND ca.impact IN ('POSITIVE', 'NEGATIVE')
        AND ca.title NOT ILIKE '%shareholders meeting%'
        AND ca.title NOT ILIKE '%record date%'
        AND ca.title NOT ILIKE '%newspaper publication%'
        AND ca.title NOT ILIKE '%loss of share%'
        AND ca.title NOT ILIKE '%trading window%'
        AND (
          ca.filing_category IN ('ORDER_WIN', 'CAPEX_COMMISSIONING', 'SCHEME_OF_ARRANGEMENT', 'REGULATORY_ACTION', 'CREDIT_EVENT')
          OR (ca.title ILIKE '%order win%' OR ca.title ILIKE '%contract award%' OR ca.title ILIKE '%commercial operation%')
        )
      ORDER BY ca.filing_date DESC
    `);

    for (const ev of recentEvents.rows) {
      const icon = ev.impact === 'NEGATIVE' ? '⚠️' : '🚀';
      summaryReport.newAlerts.push({
        ticker: ev.ticker,
        type: "MATERIAL_GROWTH_CATALYST",
        text: `${icon} **${ev.ticker}**: ${ev.title}\n   ${ev.summary ? `_${ev.summary.substring(0, 180)}..._` : ""}`
      });
    }
  } catch (err) {
    console.error("[ERROR] Step 4 Multi-Year Catalyst Audit failed:", err.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 5: Update Portfolio Thesis State Board
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- 📊 Step 5: Updating Portfolio Thesis State Board ---");
  try {
    await generatePortfolioThesisBoard();
    console.log("✅ Portfolio Thesis State Board synchronized with latest market & operational data.");
  } catch (err) {
    console.error("[ERROR] Step 5 Portfolio Thesis State Board update failed:", err.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 5b: Asymmetric Valuation Dislocation Watchdog (HBL/Time Techno Alert with 7-Day Cooldown)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- 🎯 Step 5b: Auditing Asymmetric Valuation Dislocations (7-Day Anti-Spam Cooldown) ---");
  try {
    const dislocationRes = await evaluateAndDispatchDislocationAlerts({
      pool,
      isDryRun
    });
    console.log(`✅ Valuation Dislocation Watchdog: ${dislocationRes.alertsDispatched} dispatched, ${dislocationRes.alertsSuppressed} suppressed under 7-day cooldown.`);
  } catch (err) {
    console.error("[ERROR] Step 5b Valuation Dislocation Watchdog failed:", err.message);
  }


  // ──────────────────────────────────────────────────────────────────────────
  // STEP 6: Idempotent Morning Alert Compilation & Dispatch
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- 📬 Step 6: Generating Idempotent Morning Digest ---");
  let dispatchedCount = 0;
  const pendingMorningDigest = [];

  for (const alert of summaryReport.newAlerts) {
    const hash = crypto.createHash("sha256")
      .update(`${alert.ticker}_${alert.type}_${alert.text}`)
      .digest("hex");

    // Check if this exact alert was already dispatched previously
    const check = await pool.query("SELECT id FROM reconciliation_alerts_sent WHERE alert_hash = $1", [hash]);
    if (check.rows.length === 0) {
      // New unsent alert
      pendingMorningDigest.push(alert);
      if (!isDryRun) {
        await pool.query(
          "INSERT INTO reconciliation_alerts_sent (alert_hash, ticker, alert_type, summary) VALUES ($1, $2, $3, $4)",
          [hash, alert.ticker, alert.type, alert.text]
        );
      }
      dispatchedCount++;
    }
  }

  console.log(`Found ${pendingMorningDigest.length} fresh deduplicated alerts (Filtered ${summaryReport.newAlerts.length - pendingMorningDigest.length} duplicates).`);

  if (pendingMorningDigest.length > 0 && !isDryRun) {
    const dateStr = new Date().toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric"
    });

    let msg = `🌅 *Morning Thesis Reconciliation Digest (${dateStr})*\n\n`;
    msg += `📊 *Summary*: ${summaryReport.pricesRefreshed} prices synced | ${summaryReport.newFilingsIngested} late filings reconciled\n\n`;

    for (const item of pendingMorningDigest.slice(0, 10)) {
      msg += `• ${item.text}\n\n`;
    }

    try {
      await sendTelegramMessage(msg);
      console.log("✅ Sent Morning Reconciliation Digest to Telegram.");
    } catch (err) {
      console.warn("[WARN] Could not send Telegram digest:", err.message);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n==========================================================================`);
  console.log(`=== ✅ NIGHTLY RECONCILIATION COMPLETED IN ${durationSec}s ===`);
  console.log(`==========================================================================\n`);

  return {
    success: true,
    durationSec,
    ...summaryReport,
    dispatchedAlerts: dispatchedCount
  };
}

// Execute directly when run as CLI script
if (process.argv[1] && (process.argv[1].replace(/\\/g, "/").endsWith("run-nightly-reconciliation.js") || process.argv[1].includes("run-nightly-reconciliation"))) {
  const isDryRun = process.argv.includes("--dry-run");
  runNightlyReconciliation({ isDryRun })
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      pool.end();
      process.exit(1);
    });
}
