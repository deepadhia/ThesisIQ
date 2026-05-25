import "dotenv/config";
import { pool } from "../backend/db/pool.js";
import { deleteDriveFile } from "../backend/services/drive.service.js";

async function deleteWrongTranscript() {
  console.log("Searching for QPOWER FY26-Q4 incorrect transcript records in database...");
  const { rows } = await pool.query(
    "SELECT id, drive_file_id, filename FROM filing_drive_links WHERE symbol = 'QPOWER' AND quarter = 'FY26-Q4' AND filename LIKE '%concall_transcript%'"
  );

  console.log(`Found ${rows.length} record(s).`);
  for (const row of rows) {
    console.log(`Deleting record: ${row.filename} (ID: ${row.id})`);
    if (row.drive_file_id) {
      try {
        await deleteDriveFile(row.drive_file_id);
        console.log(`  [Drive] Deleted file: ${row.drive_file_id}`);
      } catch (err) {
        console.warn(`  [Drive] Failed to delete file: ${row.drive_file_id} (${err.message})`);
      }
    }
    await pool.query("DELETE FROM filing_drive_links WHERE id = $1", [row.id]);
    console.log(`  [DB] Deleted record ID: ${row.id}`);
  }

  console.log("Database clean complete.");
  process.exit(0);
}

deleteWrongTranscript().catch((err) => {
  console.error(err);
  process.exit(1);
});
