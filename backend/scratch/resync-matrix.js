import { pool } from '../db/pool.js';
import { fetchAndStoreXbrlMetrics } from '../services/xbrl.service.js';

async function resync() {
  const tickers = ['TIMETECHNO', 'INOXINDIA', 'CCL', 'HBLENGINE'];
  
  const { rows: stocks } = await pool.query(
    "SELECT id, ticker, bse_scrip_code FROM stocks WHERE ticker = ANY($1)",
    [tickers]
  );

  console.log(`Starting Resync for ${stocks.length} stocks...`);

  for (const stock of stocks) {
    console.log(`\nResyncing ${stock.ticker}...`);
    try {
      const result = await fetchAndStoreXbrlMetrics({
        stock_id: stock.id,
        ticker: stock.ticker,
        bse_scrip_code: stock.bse_scrip_code
      });
      console.log(`Result: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`Failed to resync ${stock.ticker}:`, err);
    }
  }

  console.log("\nResync Complete.");
  process.exit(0);
}

resync();
