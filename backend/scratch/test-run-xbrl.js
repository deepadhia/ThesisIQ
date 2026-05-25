import { fetchAndStoreXbrlMetrics } from "../services/xbrl.service.js";
import { pool } from "../db/pool.js";

async function runTestSync() {
  console.log("====================================================");
  console.log("TEST XBRL SYNC FOR SELECTED SHARES");
  console.log("====================================================");
  
  // You can add more tickers to this array
  const selectedTickers = ['GRAVITA']; 

  const stocksRes = await pool.query(
    "SELECT id, ticker, bse_scrip_code FROM stocks WHERE ticker = ANY($1)",
    [selectedTickers]
  );
  
  const stocks = stocksRes.rows;

  if (stocks.length === 0) {
      console.log("No stocks found for the selected tickers.");
      process.exit(0);
  }

  for (const stock of stocks) {
    const { id, ticker, bse_scrip_code } = stock;
    console.log(`\n>>> Fetching XBRL Metrics for ${ticker}...`);

    try {
      const xbrlResult = await fetchAndStoreXbrlMetrics({
        stock_id: id,
        ticker: ticker,
        bse_scrip_code: bse_scrip_code
      });
      
      if (xbrlResult.ok) {
        console.log(`   ✅ [XBRL] ${xbrlResult.quarters} quarters synchronized and stored successfully.`);
      } else {
        console.warn(`   ⚠️ [XBRL] ${xbrlResult.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error(`   ❌ [XBRL] FAILED: ${err.message}`);
    }
  }

  console.log("\n====================================================");
  console.log("Test Sync Completed.");
  console.log("====================================================");
  process.exit(0);
}

runTestSync().catch(err => {
  console.error("Fatal Script Error:", err);
  process.exit(1);
});
