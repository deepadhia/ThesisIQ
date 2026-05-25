import { pool } from '../backend/db/pool.js';

async function compare() {
  const stocks = await pool.query("SELECT id, ticker FROM stocks WHERE ticker IN ('SJS', 'TIMETECHNO', 'GRAVITA')");
  
  for (const stock of stocks.rows) {
    console.log(`\n=== Comparing ${stock.ticker} ===`);
    
    const xbrlRes = await pool.query(
      "SELECT quarter, revenue_from_ops FROM xbrl_metrics_quarterly WHERE ticker = $1 ORDER BY quarter DESC LIMIT 6",
      [stock.ticker]
    );
    
    const screenerRes = await pool.query(
      "SELECT quarter, revenue FROM financial_results WHERE stock_id = $1 ORDER BY quarter DESC LIMIT 6",
      [stock.id]
    );
    
    const screenerMap = {};
    for (const row of screenerRes.rows) {
       screenerMap[row.quarter] = row.revenue;
    }
    
    console.log("XBRL Data (converted from Absolute to Cr):");
    for (const row of xbrlRes.rows) {
       console.log(`  ${row.quarter}: ${(row.revenue_from_ops / 10000000).toFixed(2)} Cr (Raw DB: ${row.revenue_from_ops})`);
    }
    
    console.log("Screener Data:");
    for (const [q, rev] of Object.entries(screenerMap)) {
       console.log(`  ${q}: ${rev} Cr`);
    }
  }
  process.exit(0);
}
compare();
