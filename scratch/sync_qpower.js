import { pool } from '../backend/db/pool.js';
import { fetchAndStoreXbrlMetrics } from '../backend/services/xbrl.service.js';

async function runSync() {
  console.log("Triggering fresh V3/V2 sync for QPOWER...");
  try {
    const r = await pool.query(
      "SELECT id, bse_scrip_code FROM stocks WHERE UPPER(TRIM(ticker)) = 'QPOWER'"
    );
    if (!r.rows[0]) {
      console.error("Stock QPOWER not found in database.");
      return;
    }
    const { id: stock_id, bse_scrip_code } = r.rows[0];
    console.log(`Found QPOWER: stock_id = ${stock_id}, bse_scrip_code = ${bse_scrip_code}`);
    
    // First, let's reset the metric_metadata and metrics fields that were corrupted (fallback values)
    // to make sure getFromHistory starts with a clean slate!
    // Since we are going to re-parse all local quarters, we can safely reset these columns.
    console.log("Resetting existing quarterly metrics to ensure clean-slate V3 recalculation...");
    await pool.query(
      `UPDATE xbrl_metrics_quarterly
       SET cash_and_bank = CASE WHEN metric_metadata->'cash_and_bank'->>'source' = 'fallback' THEN NULL ELSE cash_and_bank END,
           borrowings = CASE WHEN metric_metadata->'borrowings'->>'source' = 'fallback' THEN NULL ELSE borrowings END,
           receivables = CASE WHEN metric_metadata->'receivables'->>'source' = 'fallback' THEN NULL ELSE receivables END,
           inventory = CASE WHEN metric_metadata->'inventory'->>'source' = 'fallback' THEN NULL ELSE inventory END,
           trade_payables = CASE WHEN metric_metadata->'trade_payables'->>'source' = 'fallback' THEN NULL ELSE trade_payables END,
           cfo = CASE WHEN metric_metadata->'cfo'->>'source' = 'fallback' THEN NULL ELSE cfo END,
           capex = CASE WHEN metric_metadata->'capex'->>'source' = 'fallback' THEN NULL ELSE capex END,
           equity = CASE WHEN metric_metadata->'equity'->>'source' = 'fallback' THEN NULL ELSE equity END
       WHERE stock_id = $1`,
      [stock_id]
    );

    const result = await fetchAndStoreXbrlMetrics({ stock_id, ticker: 'QPOWER', bse_scrip_code });
    console.log("Sync result:", JSON.stringify(result, null, 2));
    console.log("Successfully completed fresh sync for QPOWER!");
  } catch (err) {
    console.error("Sync failed:", err);
  } finally {
    await pool.end();
  }
}
runSync();
