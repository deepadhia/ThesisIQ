import { scan } from "./scan-announcements.js";
import { pool } from "../db/pool.js";

async function catchup() {
  const ticker = process.argv[2];
  const isDryRun = process.argv.includes("--dry-run");

  console.log(`[CATCHUP] Starting catchup for ${ticker || "ALL STOCKS"}... ${isDryRun ? "[DRY RUN]" : ""}`);

  if (ticker) {
    const originalQuery = pool.query;
    pool.query = (text, params) => {
      if (text.includes("SELECT id, ticker, bse_scrip_code, investment_thesis, category FROM stocks")) {
        return originalQuery.call(pool, "SELECT id, ticker, bse_scrip_code, investment_thesis, category FROM stocks WHERE ticker = $1", [ticker]);
      }
      return originalQuery.call(pool, text, params);
    };
  }

  try {
    await scan({ isDryRun });
  } catch (err) {
    console.error("[CATCHUP ERROR]", err);
  } finally {
    process.exit(0);
  }
}

catchup();
