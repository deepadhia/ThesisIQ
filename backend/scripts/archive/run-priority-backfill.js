import { fetchAndStoreXbrlMetrics } from "../services/xbrl.service.js";
import { fetchAndStoreFinancials } from "../services/financials.service.js";
import { pool } from "../db/pool.js";

const PRIORITY_STOCKS = [
  "TIMETECHNO",
  "SKIPPER",
  "HBLENGINE",
  "CCL",
  "INOXINDIA"
];

async function runBackfill() {
  console.log("Starting Priority Backfill Workflow...");
  console.log("Targeting:", PRIORITY_STOCKS.join(", "));
  console.log("----------------------------------------");

  for (const ticker of PRIORITY_STOCKS) {
    try {
      // Resolve stock details
      const r = await pool.query("SELECT id, ticker, bse_scrip_code, screener_slug FROM stocks WHERE UPPER(ticker) = $1", [ticker.toUpperCase()]);
      if (r.rows.length === 0) {
        console.log(`${ticker}: FAILED | Stock not found in database.`);
        continue;
      }
      const stock = r.rows[0];

      let xbrlLog = "";
      let screenerLog = "";

      // 1. Fetch XBRL (Minimum 4 quarters)
      try {
        const xbrlResult = await fetchAndStoreXbrlMetrics({
          stock_id: stock.id,
          ticker: stock.ticker,
          bse_scrip_code: stock.bse_scrip_code
        });
        
        if (xbrlResult.ok) {
          xbrlLog = `${xbrlResult.quarters} XBRL quarters fetched`;
        } else {
          xbrlLog = `XBRL FAILED: ${xbrlResult.error}`;
        }
      } catch (err) {
        xbrlLog = `XBRL FAILED: ${err.message}`;
      }

      // 2. Fetch Screener Fundamentals & Shareholding
      try {
        if (!stock.screener_slug) {
          screenerLog = "Screener FAILED: No screener_slug found.";
        } else {
          // Wait 2 seconds to be polite to Screener
          await new Promise(res => setTimeout(res, 2000));
          const finResult = await fetchAndStoreFinancials({
            stock_id: stock.id,
            ticker: stock.ticker,
            screener_slug: stock.screener_slug
          });
          if (finResult.success) {
            screenerLog = "Screener Ready";
          } else {
            screenerLog = `Screener FAILED: ${finResult.error || 'Unknown error'}`;
          }
        }
      } catch (err) {
        screenerLog = `Screener FAILED: ${err.message}`;
      }

      console.log(`${ticker}: ${xbrlLog} | ${screenerLog}`);

    } catch (err) {
      console.error(`${ticker}: FATAL ERROR - ${err.message}`);
    }
  }

  console.log("----------------------------------------");
  console.log("Backfill Workflow Completed.");
  process.exit(0);
}

runBackfill().catch(err => {
  console.error("Workflow failed:", err);
  process.exit(1);
});
