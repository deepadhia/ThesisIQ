import { pool } from '../backend/db/pool.js';

async function check() {
  const res = await pool.query("SELECT source_url FROM xbrl_filings WHERE ticker = 'SJS' ORDER BY quarter DESC LIMIT 1");
  console.log(res.rows);
  process.exit(0);
}
check();
