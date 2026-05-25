import { pool } from "../backend/db/pool.js";

async function dumpPressRelease() {
  console.log("=========================================");
  console.log("DUMPING ANANTRAJ PRESS RELEASE");
  console.log("=========================================");

  try {
    const res = await pool.query(
      `SELECT filing_date, title, source_id, raw_text 
       FROM corporate_announcements 
       WHERE ticker = 'ANANTRAJ' AND source_id = '106325240'`
    );

    if (res.rows[0]) {
      console.log(`Date: ${res.rows[0].filing_date}`);
      console.log(`Title: ${res.rows[0].title}`);
      console.log(`Source ID: ${res.rows[0].source_id}`);
      console.log("\nRaw Text:");
      console.log(res.rows[0].raw_text);
    } else {
      console.log("Press release not found.");
    }

  } catch (err) {
    console.error("Query failed:", err.message);
  } finally {
    await pool.end();
  }
}

dumpPressRelease();
