import { pool } from '../db/pool.js';

async function check() {
  const tickers = ['TIMETECHNO', 'INOXINDIA', 'CCL'];
  const { rows } = await pool.query("SELECT id, ticker, bse_scrip_code FROM stocks WHERE ticker = ANY($1) OR ticker LIKE '%HBL%'", [tickers]);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

check();
