import { pool } from "../db/pool.js";

async function run() {
  const ticker = "QPOWER";
  try {
    const res = await pool.query(`
      DELETE FROM xbrl_metrics_quarterly 
      WHERE ticker = $1 
      AND (quarter = 'FY27-Q1' OR quarter = 'FY20-Q3' OR quarter LIKE '%NaN%' OR quarter = 'FY26-Q4')
    `, [ticker]);
    
    console.log(`Deleted ${res.rowCount} phantom rows for ${ticker}.`);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
