import { pool } from '../backend/db/pool.js';
import { fetchAndStoreFinancials } from '../backend/services/financials.service.js';

async function test() {
  const res = await pool.query("SELECT id, ticker FROM stocks WHERE ticker = 'SJS'");
  if (res.rows.length > 0) {
    const stockId = res.rows[0].id;
    await fetchAndStoreFinancials({ stock_id: stockId, ticker: res.rows[0].ticker });
    
    // Fetch what got saved
    const fins = await pool.query("SELECT quarter, revenue_from_ops, pat, receivables, inventory, cfo FROM xbrl_metrics_quarterly WHERE ticker = 'SJS' ORDER BY quarter DESC LIMIT 4");
    console.log(JSON.stringify(fins.rows, null, 2));
  }
  process.exit(0);
}
test();
