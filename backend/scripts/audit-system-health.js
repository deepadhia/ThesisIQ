import { pool } from '../db/pool.js';
import { flushPendingAlerts } from '../workers/quarterly-deepdive-worker.js';

async function audit() {
  console.log('================================================================');
  console.log('              THESISIQ SYSTEM DEEP DIVE AUDIT                   ');
  console.log('================================================================\n');

  // 1. Audit Pending / Stuck Deep Dives
  const stuckRes = await pool.query(`
    SELECT id, ticker, title, filing_category, deep_dive_status, created_at,
           event_analysis->>'pipeline_error' AS error,
           event_analysis->>'deep_dive_attempts' AS attempts,
           event_analysis->>'alert_pending' AS alert_pending
    FROM corporate_announcements
    WHERE deep_dive_status IN ('pending_stage1', 'pending_stage2', 'pending_audio', 'needs_review', 'failed')
    ORDER BY created_at DESC
  `);
  console.log(`[AUDIT 1] Stalled / Pending / Review Filings: ${stuckRes.rows.length}`);
  for (const r of stuckRes.rows) {
    console.log(` - [${r.ticker}] ${r.title} | Date: ${r.created_at?.toISOString()?.slice(0, 10)}`);
    console.log(`   ID: ${r.id} | Status: ${r.deep_dive_status} | Attempts: ${r.attempts || 0} | PendingAlert: ${r.alert_pending}`);
    if (r.error) console.log(`   Error: ${r.error}`);
  }
  console.log('');

  // 2. Audit Parked Alerts (alert_pending = true)
  const parkedRes = await pool.query(`
    SELECT id, ticker, title, created_at,
           event_analysis->>'pending_alert_text' AS txt,
           event_analysis->>'alert_error' AS alert_error
    FROM corporate_announcements
    WHERE event_analysis->>'alert_pending' = 'true'
  `);
  console.log(`[AUDIT 2] Parked Telegram Alerts Waiting to be Flushed: ${parkedRes.rows.length}`);
  for (const p of parkedRes.rows) {
    console.log(` - [${p.ticker}] ${p.title} | Error: ${p.alert_error}`);
  }
  console.log('');

  // 3. Audit Scan Lease in system_settings
  const leaseRes = await pool.query(`
    SELECT key, value, updated_at
    FROM system_settings
    WHERE key IN ('scan_lease', 'last_bse_time', 'last_nse_time', 'market_holidays')
  `);
  console.log('[AUDIT 3] System Settings & Concurrency Lease:');
  for (const l of leaseRes.rows) {
    console.log(` - Key: ${l.key} | UpdatedAt: ${l.updated_at?.toISOString()}`);
    if (l.key === 'scan_lease') console.log(`   Value:`, JSON.stringify(l.value));
  }
  console.log('');

  // 4. Audit Market Data Snapshots Freshness (Rule 7)
  const mktRes = await pool.query(`
    SELECT count(*) AS total,
           count(CASE WHEN market_data_retrieved_at >= NOW() - INTERVAL '7 days' THEN 1 END) AS fresh_7d,
           count(CASE WHEN pe_ratio IS NULL OR pe_ratio <= 0 THEN 1 END) AS invalid_pe,
           count(CASE WHEN share_price IS NULL OR share_price <= 0 THEN 1 END) AS invalid_cmp,
           count(CASE WHEN roce_pct IS NULL THEN 1 END) AS missing_roce
    FROM market_data_snapshots
  `);
  console.log('[AUDIT 4] Market Data Freshness (20 Equities):');
  console.log(` - Total rows: ${mktRes.rows[0].total}`);
  console.log(` - Fresh (<=7d): ${mktRes.rows[0].fresh_7d}`);
  console.log(` - Invalid PE (<=0 or null): ${mktRes.rows[0].invalid_pe}`);
  console.log(` - Invalid CMP (<=0 or null): ${mktRes.rows[0].invalid_cmp}`);
  console.log(` - Missing ROCE: ${mktRes.rows[0].missing_roce}`);
  console.log('');

  // 5. Audit Quarterly Snapshots Coverage for Q2_FY27 and Q1_FY27
  const snapRes = await pool.query(`
    SELECT quarter, count(*) AS count
    FROM quarterly_snapshots
    GROUP BY quarter
    ORDER BY quarter DESC
    LIMIT 6
  `);
  console.log('[AUDIT 5] Quarterly Snapshots in Database:');
  for (const s of snapRes.rows) {
    console.log(` - Quarter: ${s.quarter} | Snapshots: ${s.count}`);
  }
  console.log('');

  // 6. Audit Database Row Bloat: Invariant I14 (_raw_text persistence)
  const bloatRes = await pool.query(`
    SELECT count(*) AS bloat_count
    FROM corporate_announcements
    WHERE event_analysis::text LIKE '%_raw_text%'
  `);
  console.log(`[AUDIT 6] Invariant I14 - Rows with _raw_text persisted in event_analysis: ${bloatRes.rows[0].bloat_count}`);
  console.log('');

  // 7. Audit Management Commitments Hygiene
  const commRes = await pool.query(`
    SELECT status, count(*) AS count
    FROM management_commitments
    GROUP BY status
    ORDER BY count DESC
  `);
  console.log('[AUDIT 7] Management Commitments Status Distribution:');
  for (const c of commRes.rows) {
    console.log(` - Status: ${c.status} | Count: ${c.count}`);
  }
  console.log('');

  await pool.end();
}

audit().catch(console.error);
