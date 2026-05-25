import { fetchAndStoreXbrlMetrics } from '../backend/services/xbrl.service.js';
import { pool } from '../backend/db/pool.js';

async function run() {
  try {
    const ticker = 'GRAVITA';
    const r = await pool.query(
      "SELECT id, bse_scrip_code FROM stocks WHERE UPPER(TRIM(ticker)) = $1",
      [ticker.toUpperCase().trim()]
    );
    if (!r.rows[0]) {
      console.log(`Stock not found: ${ticker}`);
      return;
    }
    const { id: stock_id, bse_scrip_code } = r.rows[0];
    
    console.log(`Starting extraction for ${ticker}...`);
    const result = await fetchAndStoreXbrlMetrics({ stock_id, ticker, bse_scrip_code });
    console.log("Extraction Result:", JSON.stringify(result, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

run();
