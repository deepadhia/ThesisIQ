import { pool } from "../backend/db/pool.js";

async function checkAllLinks() {
  console.log(`Checking all records in filing_drive_links...`);
  try {
    const res = await pool.query(
      "SELECT symbol, COUNT(*) as count FROM filing_drive_links GROUP BY symbol"
    );
    if (res.rows.length === 0) {
      console.log("No records found in filing_drive_links table.");
    } else {
      console.log(`Found records for ${res.rows.length} symbols:`);
      res.rows.forEach(r => {
        console.log(` - ${r.symbol}: ${r.count} records`);
      });
    }
  } catch (err) {
    console.error("Error checking links:", err);
  } finally {
    await pool.end();
  }
}

checkAllLinks();
