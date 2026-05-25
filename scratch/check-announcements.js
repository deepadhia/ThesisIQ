import { pool } from "../backend/db/pool.js";

async function checkAnnouncements() {
  console.log(`Checking corporate_announcements table...`);
  try {
    const res = await pool.query(
      "SELECT ticker, COUNT(*) as count FROM corporate_announcements GROUP BY ticker"
    );
    if (res.rows.length === 0) {
      console.log("No records found in corporate_announcements table.");
    } else {
      console.log(`Found announcements for ${res.rows.length} tickers:`);
      res.rows.forEach(r => {
        console.log(` - ${r.ticker}: ${r.count} announcements`);
      });
    }
  } catch (err) {
    console.error("Error checking announcements:", err);
  } finally {
    await pool.end();
  }
}

checkAnnouncements();
