import { pool } from "../db/pool.js";

async function check() {
  try {
    const res = await pool.query(
      "SELECT title, summary, priority, status, processed_at FROM corporate_announcements WHERE ticker = 'ANANTRAJ' ORDER BY processed_at DESC"
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

check();
