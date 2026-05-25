import { uploadAnnouncementsToDrive } from "../backend/services/drive.service.js";
import { getAlreadyUploadedKeys, saveFilingDriveLinks } from "../backend/services/transcripts.service.js";
import { pool } from "../backend/db/pool.js";

async function syncSkipper() {
  console.log("=========================================");
  console.log("SYNCING SKIPPER FILINGS TO GOOGLE DRIVE");
  console.log("=========================================");

  try {
    const symbol = "SKIPPER";
    const alreadyUploadedKeys = await getAlreadyUploadedKeys(symbol);
    console.log(`Loaded already uploaded keys: ${alreadyUploadedKeys.size}`);

    console.log("Starting Google Drive upload. This might take a few moments...");
    const result = await uploadAnnouncementsToDrive(symbol, alreadyUploadedKeys);
    console.log("Drive upload complete.");
    console.log(`  Uploaded: ${result.uploaded?.length || 0}`);
    console.log(`  Skipped: ${result.skipped || 0}`);
    console.log(`  Errors: ${result.errors?.length || 0}`);

    if (result.uploaded && result.uploaded.length > 0) {
      console.log(`Saving ${result.uploaded.length} new filing links to database...`);
      await saveFilingDriveLinks(result.uploaded);
      console.log("Links saved successfully!");
    } else {
      console.log("No new files needed to be uploaded.");
    }

  } catch (err) {
    console.error("Sync failed:", err.message);
  } finally {
    await pool.end();
  }
}

syncSkipper();
