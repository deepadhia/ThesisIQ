import { pool } from "../db/pool.js";

async function verify() {
  const { rows } = await pool.query(`SELECT * FROM xbrl_metrics_quarterly WHERE ticker='GRAVITA' AND quarter='FY25-Q3'`);
  console.log(rows[0]);
  process.exit(0);
}

verify();
