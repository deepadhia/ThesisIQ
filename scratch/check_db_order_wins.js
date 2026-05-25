import { pool } from "../backend/db/pool.js";

async function checkOrderWins() {
  console.log("=========================================");
  console.log("DIAGNOSTIC: Database Order Wins Search");
  console.log("=========================================");

  try {
    const res = await pool.query(
      `SELECT symbol, quarter, filename, drive_file_id 
       FROM filing_drive_links 
       WHERE filename LIKE '%order_win_or_ca_filing%' 
          OR filename LIKE '%order_win%'
       ORDER BY symbol, quarter`
    );

    console.log(`Found ${res.rows.length} order win filings in database:\n`);
    res.rows.forEach((r, idx) => {
      console.log(`${idx + 1}. Symbol: ${r.symbol} | Quarter: ${r.quarter}`);
      console.log(`   Filename: ${r.filename}`);
      console.log(`   Drive ID: ${r.drive_file_id}`);
      console.log("-----------------------------------------");
    });

  } catch (err) {
    console.error("Diagnostic failed:", err.message);
  } finally {
    await pool.end();
  }
}

checkOrderWins();
