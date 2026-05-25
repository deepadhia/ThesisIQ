import { pool } from "../db/pool.js";

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT title, attachment_url, created_at 
      FROM corporate_announcements 
      WHERE ticker = 'QPOWER' 
      ORDER BY created_at DESC 
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
