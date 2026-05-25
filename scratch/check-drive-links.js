import { pool } from "../backend/db/pool.js";

async function checkLinks(symbol) {
  const s = String(symbol).toUpperCase();
  console.log(`Checking filing_drive_links for ${s}...`);
  try {
    const res = await pool.query(
      "SELECT id, quarter, filename, drive_file_id, drive_web_link IS NOT NULL as has_link FROM filing_drive_links WHERE symbol = $1",
      [s]
    );
    console.log(`Found ${res.rows.length} records.`);
    res.rows.forEach(r => {
      console.log(` - ${r.quarter}/${r.filename}: ${r.has_link ? 'LINKED' : 'NO LINK'} (ID: ${r.drive_file_id})`);
    });
  } catch (err) {
    console.error("Error checking links:", err);
  } finally {
    await pool.end();
  }
}

const symbol = process.argv[2] || 'HBL'; // Example
checkLinks(symbol);
