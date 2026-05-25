import { pool } from '../backend/db/pool.js';

async function compare() {
  const stocks = await pool.query("SELECT id, ticker FROM stocks");
  
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
       // Convert "Dec 2024" to "FY25-Q3" format if needed, but our DB might store "Dec 2024" as quarter in financial_results?
       // Let's print exactly what's in the DB to see how they align.
       screenerMap[row.quarter] = row.revenue;
    }
    
    console.log("XBRL Data (converted to Cr):");
    for (const row of xbrlRes.rows) {
       const inCr = (parseFloat(row.revenue_from_ops) / 100).toFixed(2);
       console.log(`  ${row.quarter}: ${inCr} Cr (Raw: ${row.revenue_from_ops})`);
    }
    
    console.log("Screener Data:");
    for (const [q, rev] of Object.entries(screenerMap)) {
       console.log(`  ${q}: ${rev} Cr`);
    }
  }
  process.exit(0);
}
compare();
