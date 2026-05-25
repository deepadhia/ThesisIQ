import { pool } from "../backend/db/pool.js";

async function checkSkipperAnns() {
  console.log("=========================================");
  console.log("DIAGNOSTIC: Skipper Announcements Search");
  console.log("=========================================");

  try {
    const res = await pool.query(
      `SELECT id, title, filing_date, attachment_url, raw_text
       FROM corporate_announcements 
       WHERE UPPER(ticker) = 'SKIPPER' 
         AND (
           LOWER(title) LIKE '%order%' OR 
           LOWER(title) LIKE '%win%' OR 
           LOWER(title) LIKE '%capex%' OR 
           LOWER(title) LIKE '%mou%' OR 
           LOWER(title) LIKE '%contract%' OR 
           LOWER(title) LIKE '%award%' OR 
           LOWER(title) LIKE '%secures%' OR 
           LOWER(title) LIKE '%agreement%' OR
           LOWER(title) LIKE '%sign%'
         )
       ORDER BY filing_date DESC`
    );

    console.log(`Found ${res.rows.length} announcements with matching terms for SKIPPER:\n`);
    res.rows.slice(0, 30).forEach((r, idx) => {
      console.log(`${idx + 1}. Date: ${r.filing_date}`);
      console.log(`   Title: ${r.title}`);
      console.log(`   URL: ${r.attachment_url}`);
      console.log(`   Raw Text (truncated): ${r.raw_text ? r.raw_text.slice(0, 150).replace(/\s+/g, ' ') : "None"}`);
      console.log("-----------------------------------------");
    });

  } catch (err) {
    console.error("Diagnostic failed:", err.message);
  } finally {
    await pool.end();
  }
}

checkSkipperAnns();
