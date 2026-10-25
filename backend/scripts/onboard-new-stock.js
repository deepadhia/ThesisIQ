/**
 * onboard-new-stock.js — General-Purpose New Stock Backfill Pipeline
 *
 * Backfills a newly-added stock to the latest quarter end-to-end:
 *   1. Validate stock exists in DB
 *   2. Price history backfill (3Y Yahoo Finance)
 *   3. XBRL quarterly financials
 *   4. Screener annual fundamentals
 *   5. Filing downloads (concalls, results, investor presentations)
 *   6. Announcement scan (BSE/NSE historical)
 *   7. Queue deep-dive processing for downloaded filings
 *   8. Summary report
 *
 * Usage:
 *   node --env-file=.env.local backend/scripts/onboard-new-stock.js --ticker HSCL
 *   node --env-file=.env.local backend/scripts/onboard-new-stock.js --ticker GRAVITA --window 2y
 *   node --env-file=.env.local backend/scripts/onboard-new-stock.js --ticker HSCL --dry-run
 *
 * Options:
 *   --ticker   <TICKER>      Required. NSE ticker as stored in DB (e.g. HSCL)
 *   --window   <6m|1y|2y|3y> Filing download window (default: 3y)
 *   --dry-run                Print what would be done; no DB writes or downloads
 */

import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });

import { pool } from '../db/pool.js';
import { fetchAndStorePrice } from '../services/price.service.js';
import { fetchAndStoreXbrlMetrics } from '../services/xbrl.service.js';
import { fetchAndStoreFinancials } from '../services/financials.service.js';
import { downloadTranscriptsPipeline } from '../services/transcripts.service.js';
import { processPendingDeepDives } from '../workers/quarterly-deepdive-worker.js';

// ── CLI argument parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const TICKER    = (getArg('--ticker') || '').toUpperCase();
const WINDOW    = getArg('--window') || '3y';
const DRY_RUN   = args.includes('--dry-run');

const VALID_WINDOWS = ['6m', '1y', '2y', '3y'];

// ── Constants ───────────────────────────────────────────────────────────────

// Max deep-dive batches to run in one onboarding run (safety ceiling)
const MAX_DEEPDIVE_BATCHES = 30;

// Polite delay between API calls to avoid rate-limiting
const RATE_DELAY_MS = 800;

// ── Utilities ───────────────────────────────────────────────────────────────

function divider(label = '') {
  const line = '─'.repeat(64);
  if (label) {
    console.log(`\n${line}`);
    console.log(`  ${label}`);
    console.log(line);
  } else {
    console.log(line);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function logStep(phase, status, detail = '') {
  const icon = status === 'OK'    ? '✅'
             : status === 'SKIP'  ? '⏭️ '
             : status === 'WARN'  ? '⚠️ '
             : status === 'DRY'   ? '🔵'
             :                      '❌';
  console.log(`${icon} [Phase ${phase}] ${detail}`);
}

// ── Phase 0: Validate ────────────────────────────────────────────────────────

async function validateStock(ticker) {
  const { rows } = await pool.query(
    `SELECT id, company_name, ticker, category, screener_slug, bse_scrip_code
     FROM stocks
     WHERE UPPER(TRIM(ticker)) = $1
     LIMIT 1`,
    [ticker]
  );
  return rows[0] ?? null;
}

// ── Phase 1: Price History ───────────────────────────────────────────────────

async function runPriceBackfill(stock, dryRun) {
  if (dryRun) {
    logStep(1, 'DRY', `Would backfill 3Y price history for ${stock.ticker} via Yahoo Finance`);
    return { success: true, dry: true };
  }
  try {
    const result = await fetchAndStorePrice({ ticker: stock.ticker, backfill: true });
    if (result.success) {
      const priceText = result.price ? ` — latest: ₹${result.price} on ${result.date}` : '';
      const insertText = result.inserted !== undefined ? ` (${result.inserted} rows inserted)` : '';
      logStep(1, 'OK', `Price history synced${priceText}${insertText}`);
    } else {
      logStep(1, 'WARN', `Price backfill partial: ${result.error || result.message || 'unknown'}`);
    }
    return result;
  } catch (err) {
    logStep(1, 'ERR', `Price backfill failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ── Phase 2: XBRL Quarterly Financials ───────────────────────────────────────

async function runXbrlBackfill(stock, dryRun) {
  if (dryRun) {
    logStep(2, 'DRY', `Would fetch XBRL quarterly metrics for ${stock.ticker} (BSE: ${stock.bse_scrip_code ?? 'unknown'})`);
    return { ok: true, dry: true };
  }
  if (!stock.bse_scrip_code) {
    logStep(2, 'WARN', `No bse_scrip_code set for ${stock.ticker} — XBRL fetch skipped. Add scrip code to DB first.`);
    return { ok: false, error: 'missing_bse_scrip_code' };
  }
  try {
    await sleep(RATE_DELAY_MS);
    const result = await fetchAndStoreXbrlMetrics({
      stock_id:      stock.id,
      ticker:        stock.ticker,
      bse_scrip_code: stock.bse_scrip_code,
    });
    if (result.ok) {
      logStep(2, 'OK', `XBRL: ${result.quarters} quarters fetched/updated`);
    } else {
      logStep(2, 'WARN', `XBRL partial: ${result.error || 'unknown'}`);
    }
    return result;
  } catch (err) {
    logStep(2, 'ERR', `XBRL failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Phase 3: Screener Annual Fundamentals ────────────────────────────────────

async function runScreenerFundamentals(stock, dryRun) {
  const slug = stock.screener_slug || stock.ticker;
  if (dryRun) {
    logStep(3, 'DRY', `Would fetch Screener fundamentals for ${stock.ticker} (slug: ${slug})`);
    return { success: true, dry: true };
  }
  try {
    await sleep(RATE_DELAY_MS * 2); // Screener needs more breathing room
    const result = await fetchAndStoreFinancials({
      stock_id:      stock.id,
      ticker:        stock.ticker,
      screener_slug: slug,
    });
    if (result.success) {
      logStep(3, 'OK', `Screener fundamentals synced (${slug})`);
    } else {
      logStep(3, 'WARN', `Screener partial: ${result.error || 'unknown'}`);
    }
    return result;
  } catch (err) {
    logStep(3, 'ERR', `Screener fundamentals failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ── Phase 4: Filing Downloads ─────────────────────────────────────────────────

async function runFilingDownloads(stock, window, dryRun) {
  if (dryRun) {
    logStep(4, 'DRY', `Would download filings (concalls, results, presentations) for ${stock.ticker} — window: ${window}`);
    return { ok: true, dry: true };
  }
  try {
    const result = await downloadTranscriptsPipeline({
      symbols:             [stock.ticker],
      window,
      useWatchlist:        false,
      onlyMissing:         false, // full backfill: download everything for window
      uploadAfterDownload: false, // Drive upload is a separate step
    });
    if (result.ok) {
      if (result.skipped) {
        logStep(4, 'SKIP', `All filings already present for ${window} window — nothing to download`);
      } else {
        logStep(4, 'OK', `Filings downloaded for ${stock.ticker} (${window} window)`);
      }
    } else {
      logStep(4, 'WARN', `Filing download returned non-ok result`);
    }
    return result;
  } catch (err) {
    // NO_SYMBOLS error is non-fatal but should be reported
    if (err.code === 'NO_SYMBOLS') {
      logStep(4, 'WARN', `Filing download skipped: No symbols resolved`);
      return { ok: false, error: 'NO_SYMBOLS' };
    }
    logStep(4, 'ERR', `Filing download failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Phase 5: Announcement Scan ────────────────────────────────────────────────

async function runAnnouncementScan(stock, dryRun) {
  if (dryRun) {
    logStep(5, 'DRY', `Would scan BSE/NSE announcements for ${stock.ticker} (BSE: ${stock.bse_scrip_code ?? 'unknown'})`);
    return;
  }

  try {
    const { rows: before } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM corporate_announcements WHERE ticker = $1`,
      [stock.ticker]
    );
    const countBefore = parseInt(before[0].cnt, 10);

    // Import the scan function dynamically and pass targetTicker
    const { scan } = await import('./scan-announcements.js');
    await scan({ isDryRun: false, targetTicker: stock.ticker });

    const { rows: after } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM corporate_announcements WHERE ticker = $1`,
      [stock.ticker]
    );
    const countAfter = parseInt(after[0].cnt, 10);
    const newCount = countAfter - countBefore;

    logStep(5, 'OK', `Announcement scan complete — ${newCount} new announcements ingested for ${stock.ticker} (${countAfter} total)`);
  } catch (err) {
    logStep(5, 'WARN', `Announcement scan warning: ${err.message} — this is non-fatal, scanning can be run separately`);
  }
}

// ── Phase 6: Queue Deep-Dive Processing ──────────────────────────────────────

async function runDeepDiveQueue(stock, dryRun) {
  if (dryRun) {
    logStep(6, 'DRY', `Would activate pending corporate_announcements for ${stock.ticker} and trigger deep-dive worker`);
    return { processed: 0, dry: true };
  }

  // Activate all earnings releases for this stock that haven't been deep-dived yet
  const { rowCount: activated } = await pool.query(`
    UPDATE corporate_announcements
    SET deep_dive_status = 'pending_stage1'
    WHERE ticker = $1
      AND is_earnings_release = true
      AND deep_dive_status IN ('not_required', 'pending_stage1')
  `, [stock.ticker]);

  if (activated === 0) {
    logStep(6, 'SKIP', `No earnings announcements found for ${stock.ticker} to deep-dive. Run announcement scan first or check if filings are downloaded.`);
    return { processed: 0 };
  }

  logStep(6, 'OK', `${activated} earnings filings activated for deep-dive processing`);

  let totalProcessed = 0;
  let batchNum = 1;

  while (batchNum <= MAX_DEEPDIVE_BATCHES) {
    const { rows: pending } = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM corporate_announcements ca
      JOIN stocks s ON s.id = ca.stock_id
      WHERE ca.ticker = $1
        AND ca.deep_dive_status IN ('pending_stage1', 'pending_stage2')
    `, [stock.ticker]);

    const pendingCount = parseInt(pending[0].cnt, 10);
    if (pendingCount === 0) break;

    console.log(`   [Deep-Dive Batch ${batchNum}] ${pendingCount} filings pending for ${stock.ticker}...`);
    const result = await processPendingDeepDives({ tickers: [stock.ticker], suppressTelegram: true, batchSize: 2 });
    totalProcessed += result?.processed ?? 0;
    batchNum++;
  }

  if (batchNum > MAX_DEEPDIVE_BATCHES) {
    logStep(6, 'WARN', `Reached max batch ceiling (${MAX_DEEPDIVE_BATCHES}). Run deep-dive worker separately for remaining filings.`);
  } else {
    logStep(6, 'OK', `Deep-dive processing complete — ${totalProcessed} filings analysed`);
  }

  return { processed: totalProcessed };
}

// ── Summary ───────────────────────────────────────────────────────────────────

async function printSummary(stock, results, window, dryRun) {
  divider('ONBOARDING SUMMARY');

  console.log(`  Stock   : ${stock.company_name} (${stock.ticker})`);
  console.log(`  Category: ${stock.category}`);
  console.log(`  Window  : ${window}`);
  console.log(`  Mode    : ${dryRun ? 'DRY RUN — no changes made' : 'LIVE'}`);
  console.log('');

  const phases = [
    { name: 'Price History',        result: results.price },
    { name: 'XBRL Financials',      result: results.xbrl },
    { name: 'Screener Fundamentals',result: results.screener },
    { name: 'Filing Downloads',     result: results.filings },
    { name: 'Announcement Scan',    result: results.announcements },
    { name: 'Deep-Dive Processing', result: results.deepdive },
  ];

  for (const [i, p] of phases.entries()) {
    const r = p.result ?? {};
    const ok = r.ok ?? r.success ?? true;
    const icon = r.dry ? '🔵' : ok ? '✅' : '⚠️ ';
    console.log(`  ${icon} Phase ${i + 1}: ${p.name}`);
  }

  console.log('');
  console.log('  Next Steps:');
  console.log('  ─────────────────────────────────────────────────────');
  console.log(`  1. Verify DB: SELECT ticker, category FROM stocks WHERE ticker = '${stock.ticker}';`);
  console.log(`  2. Check XBRL: SELECT quarter, revenue FROM xbrl_metrics_quarterly WHERE ticker = '${stock.ticker}' ORDER BY period_end DESC LIMIT 8;`);
  console.log(`  3. Run ranking update once all stocks are current:`);
  console.log(`     npm run ranks:quarterly:apply`);
  console.log(`  4. Check the thesis state in quarterly_snapshots for ${stock.ticker}`);
  divider();
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

async function main() {
  divider();
  console.log(`  🚀 NEW STOCK ONBOARDING PIPELINE`);
  console.log(`  Ticker  : ${TICKER || '(none provided)'}`);
  console.log(`  Window  : ${WINDOW}`);
  console.log(`  Mode    : ${DRY_RUN ? '🔵 DRY RUN' : '🟢 LIVE'}`);
  divider();

  // ── Validate inputs ──────────────────────────────────────────────────────
  if (!TICKER) {
    console.error('❌ ERROR: --ticker is required. Example: --ticker HSCL');
    process.exit(2);
  }
  if (!VALID_WINDOWS.includes(WINDOW)) {
    console.error(`❌ ERROR: --window must be one of: ${VALID_WINDOWS.join(', ')}`);
    process.exit(2);
  }

  // ── Phase 0: Validate stock exists in DB ─────────────────────────────────
  divider('Phase 0 · Validate');
  const stock = await validateStock(TICKER);
  if (!stock) {
    console.error(`❌ Stock "${TICKER}" not found in database.`);
    console.error(`   Run the SQL migration first to add it, then re-run this script.`);
    console.error(`   Example: node backend/scripts/run-migration.js supabase/migrations/20260822180000_add_hscl_stock.sql`);
    process.exit(2);
  }
  logStep(0, 'OK', `Found: ${stock.company_name} (${stock.ticker}) — category: ${stock.category}, screener_slug: ${stock.screener_slug ?? 'N/A'}, BSE: ${stock.bse_scrip_code ?? 'N/A'}`);

  const results = {};

  // ── Phase 1: Price History ───────────────────────────────────────────────
  divider('Phase 1 · Price History Backfill');
  results.price = await runPriceBackfill(stock, DRY_RUN);

  // ── Phase 2: XBRL Quarterly Financials ──────────────────────────────────
  divider('Phase 2 · XBRL Quarterly Financials');
  results.xbrl = await runXbrlBackfill(stock, DRY_RUN);

  // ── Phase 3: Screener Fundamentals ──────────────────────────────────────
  divider('Phase 3 · Screener Annual Fundamentals');
  results.screener = await runScreenerFundamentals(stock, DRY_RUN);

  // ── Phase 4: Filing Downloads ────────────────────────────────────────────
  divider(`Phase 4 · Filing Downloads (window: ${WINDOW})`);
  results.filings = await runFilingDownloads(stock, WINDOW, DRY_RUN);

  // ── Phase 5: Announcement Scan ───────────────────────────────────────────
  divider('Phase 5 · BSE/NSE Announcement Scan');
  await runAnnouncementScan(stock, DRY_RUN);
  results.announcements = { ok: true };

  // ── Phase 6: Deep-Dive Queue ─────────────────────────────────────────────
  divider('Phase 6 · Deep-Dive Processing');
  results.deepdive = await runDeepDiveQueue(stock, DRY_RUN);

  // ── Summary ──────────────────────────────────────────────────────────────
  await printSummary(stock, results, WINDOW, DRY_RUN);

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ FATAL ERROR in onboard-new-stock pipeline:', err.message);
  console.error(err.stack);
  pool.end().finally(() => process.exit(1));
});
