import { pool } from "../db/pool.js";

async function verify() {
  const { rows } = await pool.query(`SELECT quarter, updated_at FROM xbrl_metrics_quarterly WHERE ticker='GRAVITA' ORDER BY period_end_date DESC`);
  console.log(rows);
  process.exit(0);
}

verify();
