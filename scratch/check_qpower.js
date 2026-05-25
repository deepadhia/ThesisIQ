import { pool } from '../backend/db/pool.js';

async function checkQpower() {
  console.log("Querying QPOWER filings from filing_drive_links...");
  try {
    const res = await pool.query(
      "SELECT id, symbol, quarter, filename, drive_file_id, drive_web_link FROM filing_drive_links WHERE UPPER(symbol) = 'QPOWER' ORDER BY quarter, filename"
    );
    console.log(`Total rows found: ${res.rows.length}`);
    res.rows.forEach(r => {
      console.log(`  - [${r.quarter}] ${r.filename} (ID: ${r.id}, Drive: ${r.drive_file_id ? 'Yes' : 'No'})`);
    });
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await pool.end();
  }
}
checkQpower();
