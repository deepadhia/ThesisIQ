import { pool } from '../backend/db/pool.js';

async function run() {
  const ticker = 'QPOWER';
  const stockRes = await pool.query("SELECT * FROM stocks WHERE UPPER(ticker) = $1", [ticker.toUpperCase()]);
  if (stockRes.rows.length === 0) {
    console.log("Stock not found");
    await pool.end();
    return;
  }
  const stock = stockRes.rows[0];
  console.log(`Stock ID: ${stock.id}, Name: ${stock.company_name}`);

  const quarter = 'FY25-Q2';
  const cutoffDate = '2024-09-30'; // end of FY25-Q2 (fiscal year ends Mar 2025, Q2 is Sep 2024)
  
  // Check XBRL Metrics
  const xbrl = await pool.query(
    "SELECT count(*), json_agg(quarter) FROM xbrl_metrics_quarterly WHERE stock_id = $1 AND period_end_date <= $2",
    [stock.id, cutoffDate]
  );
  console.log(`XBRL Metrics <= ${cutoffDate}:`, xbrl.rows[0]);

  // Check Valuation
  const val = await pool.query(
    "SELECT count(*) FROM financial_metrics WHERE stock_id = $1 AND created_at <= $2",
    [stock.id, cutoffDate]
  );
  console.log(`Valuation records <= ${cutoffDate}:`, val.rows[0]);

  // Check Shareholding
  const sh = await pool.query(
    "SELECT count(*) FROM shareholding WHERE stock_id = $1 AND created_at <= $2",
    [stock.id, cutoffDate]
  );
  console.log(`Shareholding records <= ${cutoffDate}:`, sh.rows[0]);

  // Check existing snapshots
  const snaps = await pool.query(
    "SELECT count(*), json_agg(quarter) FROM quarterly_snapshots WHERE stock_id = $1",
    [stock.id]
  );
  console.log(`Existing Snapshots:`, snaps.rows[0]);

  await pool.end();
}

run();
