import { fetchAndStoreXbrlMetrics } from '../backend/services/xbrl.service.js';
import { pool } from '../backend/db/pool.js';

async function run() {
  const stocksRes = await pool.query("SELECT id, ticker, bse_scrip_code FROM stocks WHERE ticker IN ('SJS', 'TIMETECHNO', 'GRAVITA')");
  for (const stock of stocksRes.rows) {
    console.log('Fetching XBRL for', stock.ticker);
    await fetchAndStoreXbrlMetrics({
      stock_id: stock.id,
      ticker: stock.ticker,
      bse_scrip_code: stock.bse_scrip_code
    });
  }
  process.exit(0);
}
run();
