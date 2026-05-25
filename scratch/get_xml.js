import { pool } from '../backend/db/pool.js';

async function check() {
  const res = await pool.query("SELECT attachment_url FROM corporate_announcements WHERE ticker = 'SJS' AND attachment_url ILIKE '%.xml%' ORDER BY filing_date DESC LIMIT 1");
  console.log(res.rows);
  process.exit(0);
}
check();
