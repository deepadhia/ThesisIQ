import { pool } from "../db/pool.js";

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT quarter, gdrive_url 
      FROM xbrl_filings 
      WHERE ticker = 'QPOWER' 
      ORDER BY quarter DESC 
      LIMIT 10
    `);
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
