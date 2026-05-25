import { pool } from "../db/pool.js";

async function verify() {
  const { rows } = await pool.query(`SELECT * FROM xbrl_metrics_quarterly WHERE ticker='GRAVITA' ORDER BY period_end_date DESC LIMIT 1`);
  console.log(rows[0]);
  process.exit(0);
}

verify();
