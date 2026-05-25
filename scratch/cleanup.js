import { pool } from '../backend/db/pool.js';

async function runCleanup() {
  console.log("Starting DB cleanup for mismatched filing links...");
  try {
    const res = await pool.query(`
      DELETE FROM filing_drive_links
      WHERE filename LIKE '%_raw_xbrl_%'
        AND split_part(filename, '_', 2) != quarter
    `);
    console.log(`Successfully cleaned up ${res.rowCount} mismatched XBRL filing links!`);
  } catch (err) {
    console.error("Cleanup failed:", err);
  } finally {
    await pool.end();
  }
}
runCleanup();
