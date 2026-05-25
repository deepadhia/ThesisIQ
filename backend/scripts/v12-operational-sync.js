import { fetchAndStoreXbrlMetrics } from "../services/xbrl.service.js";
import { fetchAndStoreFinancials } from "../services/financials.service.js";
import { syncAnnouncementsForTicker } from "../services/announcement.service.js";
import { pool } from "../db/pool.js";

async function runOperationalSync() {
  console.log("====================================================");
  console.log("V12 OPERATIONAL SYNC: FY25, FY26, and Future Prep");
  console.log("====================================================");
  console.log(`Current Time: ${new Date().toLocaleString()}`);
  
  // Fetch all active stocks
  const stocksRes = await pool.query("SELECT id, ticker, bse_scrip_code, screener_slug FROM stocks ORDER BY ticker ASC");
  const stocks = stocksRes.rows;

  console.log(`Targeting ${stocks.length} stocks for deep backfill.`);
  console.log("----------------------------------------------------");

  for (const stock of stocks) {
    const { id, ticker, bse_scrip_code, screener_slug } = stock;
    console.log(`\n>>> Processing ${ticker}...`);

    // 1. Sync Announcements (Lookback: 730 days to cover FY25 and FY26)
    try {
      const annRes = await syncAnnouncementsForTicker(id, ticker, 730);
      console.log(`   [Ann] NSE: ${annRes.nse}, BSE: ${annRes.bse} | Saved: ${annRes.saved}, Skipped: ${annRes.skipped}`);
    } catch (err) {
      console.error(`   [Ann] FAILED: ${err.message}`);
    }

    // 2. Fetch XBRL (Up to 12 quarters - covers 3 full years)
    try {
      const xbrlResult = await fetchAndStoreXbrlMetrics({
        stock_id: id,
        ticker: ticker,
        bse_scrip_code: bse_scrip_code
      });
      if (xbrlResult.ok) {
        console.log(`   [XBRL] ${xbrlResult.quarters} quarters synchronized.`);
      } else {
        console.warn(`   [XBRL] ${xbrlResult.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error(`   [XBRL] FAILED: ${err.message}`);
    }

    // 3. Sync Screener & Shareholding
    if (screener_slug) {
      try {
        // Polite delay
        await new Promise(res => setTimeout(res, 1500));
        const finResult = await fetchAndStoreFinancials({
          stock_id: id,
          ticker: ticker,
          screener_slug: screener_slug
        });
        if (finResult.success) {
          console.log(`   [Screener] Synchronized successfully.`);
        } else {
          console.warn(`   [Screener] ${finResult.error || "Unknown error"}`);
        }
      } catch (err) {
        console.error(`   [Screener] FAILED: ${err.message}`);
      }
    } else {
      console.log(`   [Screener] Skipped: No slug found.`);
    }
  }

  console.log("\n----------------------------------------------------");
  console.log("V12 Operational Sync Completed.");
  console.log("====================================================");
  process.exit(0);
}

runOperationalSync().catch(err => {
  console.error("Fatal Script Error:", err);
  process.exit(1);
});
