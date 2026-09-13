import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { processPendingDeepDives } from '../workers/quarterly-deepdive-worker.js';

async function runHistoricalDeepDiveBackfill() {
  console.log('────────────────────────────────────────────────────────────');
  console.log('📦 HISTORICAL DEEP-DIVE BACKFILL WORKFLOW');
  console.log('────────────────────────────────────────────────────────────');

  // Set all Core stock pending deep-dives to pending_stage1 if they were marked not_required
  const { rowCount: resetCount } = await pool.query(`
    UPDATE corporate_announcements ca
    SET deep_dive_status = 'pending_stage1'
    FROM stocks s
    WHERE ca.stock_id = s.id
      AND s.category = 'Core'
      AND ca.deep_dive_status = 'not_required'
      AND ca.is_earnings_release = true
  `);
  console.log(`[BACKFILL] Reactivated ${resetCount} earnings disclosures for historical deep-dive backfill.`);

  let totalProcessed = 0;
  let batchNum = 1;

  while (true) {
    console.log(`\n[BACKFILL BATCH ${batchNum}] Processing pending historical deep-dives...`);
    // Run processPendingDeepDives with suppressTelegram: true and ignore 30-day date limit for backfill
    const { rows: pendingList } = await pool.query(`
      SELECT ca.id, ca.stock_id, ca.ticker, ca.title, ca.attachment_url, ca.filing_date, ca.deep_dive_status,
             s.investment_thesis, s.company_name
      FROM corporate_announcements ca
      JOIN stocks s ON s.id = ca.stock_id
      WHERE ca.deep_dive_status IN ('pending_stage1', 'pending_stage2')
        AND s.category = 'Core'
      ORDER BY ca.filing_date ASC, ca.created_at ASC
      LIMIT 4
    `);

    if (pendingList.length === 0) {
      console.log('✅ [BACKFILL COMPLETE] All historical deep-dives for Core stocks processed successfully!');
      break;
    }

    console.log(`[BACKFILL BATCH ${batchNum}] Found ${pendingList.length} filings to process.`);
    const result = await processPendingDeepDives({ suppressTelegram: true, batchSize: 4 });
    totalProcessed += (result?.processed || 0);
    batchNum++;
    
    // Safety break after 20 batches
    if (batchNum > 20) {
      console.log('⚠️ [BACKFILL] Reached maximum batch safety limit (20 batches). Stopping backfill.');
      break;
    }
  }

  console.log('────────────────────────────────────────────────────────────');
  console.log(`✅ Backfill completed. Total historical filings processed: ${totalProcessed}`);
  console.log('────────────────────────────────────────────────────────────');
  process.exit(0);
}

runHistoricalDeepDiveBackfill().catch(err => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
