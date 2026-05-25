import fs from "fs";
import { pool } from "../db/pool.js";

/**
 * Utility to extract BSE scrip codes from screener_links_node.json 
 * and update the stocks table.
 */
async function mapScripCodes() {
  const jsonPath = "d:/nse downloader/nse_downloader/screener_links_node.json";
  if (!fs.existsSync(jsonPath)) {
    console.error("JSON file not found at", jsonPath);
    return;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const tickerMap = new Map();

  // Extract scrip code from BSE links (usually 6 digits)
  // Format: https://www.bseindia.com/bseplus/AnnualReport/515055/73214515055.pdf
  // or https://www.bseindia.com/xml-data/corpfiling/AttachHis/...
  // (The latter doesn't contain the scrip code usually)
  
  // Actually, looking at the user's sample:
  // href: "https://www.bseindia.com/bseplus/AnnualReport/515055/73214515055.pdf"
  // Here 515055 is the scrip code.

  for (const item of data) {
    if (item.href && item.href.includes("AnnualReport")) {
      const match = item.href.match(/\/AnnualReport\/(\d{6})\//);
      if (match) {
        tickerMap.set(item.symbol, match[1]);
      }
    }
  }

  console.log(`Found ${tickerMap.size} unique ticker-to-scrip mappings.`);

  for (const [ticker, scripCode] of tickerMap) {
    const res = await pool.query(
      "UPDATE stocks SET bse_scrip_code = $1 WHERE UPPER(TRIM(ticker)) = $2 AND bse_scrip_code IS NULL",
      [scripCode, ticker.toUpperCase()]
    );
    if (res.rowCount > 0) {
      console.log(`Mapped ${ticker} -> ${scripCode}`);
    }
  }

  console.log("Mapping complete.");
  process.exit(0);
}

mapScripCodes().catch(console.error);
