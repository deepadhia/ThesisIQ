import { pool } from "../backend/db/pool.js";

async function checkStock() {
  try {
    const res = await pool.query(
      "SELECT id, ticker, company_name FROM stocks WHERE ticker = 'ANANTRAJ'"
    );
    console.log(`Found ${res.rows.length} stocks for ANANTRAJ:`);
    res.rows.forEach(r => {
      console.log(` - ID: ${r.id}, Name: ${r.company_name}`);
    });
  } catch (err) {
    console.error("Error checking stock:", err);
  } finally {
    await pool.end();
  }
}

checkStock();
