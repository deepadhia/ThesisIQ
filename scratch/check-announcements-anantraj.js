import { pool } from "../backend/db/pool.js";

async function checkAnnouncementsForStock(id) {
  try {
    const res = await pool.query(
      "SELECT COUNT(*) FROM corporate_announcements WHERE stock_id = $1",
      [id]
    );
    console.log(`Announcements for stock_id ${id}: ${res.rows[0].count}`);

    const res2 = await pool.query(
      "SELECT COUNT(*) FROM corporate_announcements WHERE ticker = 'ANANTRAJ'"
    );
    console.log(`Announcements for ticker ANANTRAJ: ${res2.rows[0].count}`);
    
    const res3 = await pool.query(
      "SELECT COUNT(*) FROM corporate_announcements WHERE stock_id = $1 OR ticker = 'ANANTRAJ'",
      [id]
    );
    console.log(`Announcements for ID OR Ticker: ${res3.rows[0].count}`);
  } catch (err) {
    console.error("Error checking announcements:", err);
  } finally {
    await pool.end();
  }
}

checkAnnouncementsForStock('a35dd629-755a-451a-a9b6-a38ff532ef69');
