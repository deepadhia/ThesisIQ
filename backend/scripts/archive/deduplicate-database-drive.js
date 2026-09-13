import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db/pool.js";
import { deleteDriveFile } from "../services/drive.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target data directory
const DATA_DIR = path.resolve(__dirname, "..", "..", "data_node");

// Helper to extract category from filename
function getCategory(filename) {
  const lower = String(filename || "").toLowerCase();
  if (lower.includes("concall_transcript")) return "concall_transcript";
  if (lower.includes("investor_presentation")) return "investor_presentation";
  if (lower.includes("earnings_result")) return "earnings_result";
  if (lower.includes("order_win_or_ca_filing")) return "order_win_or_ca_filing";
  if (lower.includes("raw_xbrl")) return "raw_xbrl";
  return "other";
}

async function deduplicate() {
  console.log("=== Starting Global Duplicate File & DB Deduplication ===");
  console.log("Data Directory:", DATA_DIR);

  // 1. Fetch all records from database
  let dbRows = [];
  try {
    const { rows } = await pool.query(
      "SELECT id, symbol, quarter, filename, drive_file_id FROM filing_drive_links"
    );
    dbRows = rows;
    console.log(`[DB] Loaded ${dbRows.length} database records.`);
  } catch (err) {
    console.error("[DB] Failed to load database records:", err.message);
    process.exit(1);
  }

  // 2. Scan all files on disk
  const diskFiles = [];
  if (fs.existsSync(DATA_DIR)) {
    const symbols = fs.readdirSync(DATA_DIR);
    for (const symbol of symbols) {
      const symbolDir = path.join(DATA_DIR, symbol);
      if (!fs.statSync(symbolDir).isDirectory()) continue;

      const quarters = fs.readdirSync(symbolDir);
      for (const q of quarters) {
        const qDir = path.join(symbolDir, q);
        if (!fs.statSync(qDir).isDirectory()) continue;

        const files = fs.readdirSync(qDir);
        for (const filename of files) {
          const filePath = path.join(qDir, filename);
          if (!fs.statSync(filePath).isFile()) continue;
          if (filename === "meta.json") continue;

          diskFiles.push({
            symbol,
            quarter: q,
            filename,
            filePath,
            category: getCategory(filename)
          });
        }
      }
    }
  }
  console.log(`[Disk] Loaded ${diskFiles.length} files from disk.`);

  // 3. Map all items (disk + DB) by unique key: symbol | quarter | category
  const grouped = new Map();

  // Add DB items
  for (const row of dbRows) {
    const key = `${row.symbol.toUpperCase()}|${row.quarter}|${getCategory(row.filename)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      source: "db",
      id: row.id,
      symbol: row.symbol.toUpperCase(),
      quarter: row.quarter,
      filename: row.filename,
      driveFileId: row.drive_file_id
    });
  }

  // Add Disk items
  for (const f of diskFiles) {
    const key = `${f.symbol.toUpperCase()}|${f.quarter}|${f.category}`;
    if (!grouped.has(key)) grouped.set(key, []);
    // Avoid double counting if DB row and Disk file have EXACTLY the same filename
    const existing = grouped.get(key).find(item => item.filename === f.filename);
    if (existing) {
      existing.source = "both";
      existing.filePath = f.filePath;
    } else {
      grouped.get(key).push({
        source: "disk",
        symbol: f.symbol.toUpperCase(),
        quarter: f.quarter,
        filename: f.filename,
        filePath: f.filePath
      });
    }
  }

  // 4. Deduplicate each group
  let diskDeletedCount = 0;
  let dbPurgedCount = 0;
  let drivePurgedCount = 0;

  for (const [key, items] of grouped.entries()) {
    if (items.length <= 1) continue;

    console.log(`\n[Deduplicate] Found ${items.length} items for key: ${key}`);

    // Sort items to pick the "best" one to keep
    // Preference order:
    // 1. Items that exist on both disk and DB ("both")
    // 2. Items that have a parsed static date (e.g. YYYY-MM-15_screener or YYYY-MM-DD_10662)
    // 3. Most recently named filename lexicographically
    items.sort((a, b) => {
      // Preference 1: both > disk > db
      const score = (x) => (x.source === "both" ? 3 : x.source === "disk" ? 2 : 1);
      if (score(a) !== score(b)) return score(b) - score(a);

      // Preference 2: parsed static date in filename vs generic format
      const hasStaticDate = (name) => {
        const clean = String(name || "");
        return /_\d{4}-\d{2}-\d{2}_/.test(clean) && !/_screener\.pdf$/.test(clean);
      };
      if (hasStaticDate(a.filename) && !hasStaticDate(b.filename)) return -1;
      if (!hasStaticDate(a.filename) && hasStaticDate(b.filename)) return 1;

      // Preference 3: lexicographical sort
      return b.filename.localeCompare(a.filename);
    });

    const keep = items[0];
    const duplicates = items.slice(1);

    console.log(`  -> KEEPING: ${keep.filename} (${keep.source})`);

    for (const dup of duplicates) {
      console.log(`  -> PURGING DUPLICATE: ${dup.filename} (${dup.source})`);

      // Delete from Disk
      if ((dup.source === "disk" || dup.source === "both") && dup.filePath && fs.existsSync(dup.filePath)) {
        try {
          fs.unlinkSync(dup.filePath);
          diskDeletedCount++;
          console.log(`    [Disk] Unlinked file: ${dup.filePath}`);
        } catch (err) {
          console.error(`    [Disk] Failed to unlink file: ${dup.filePath}: ${err.message}`);
        }
      }

      // Delete from DB & Drive
      if (dup.source === "db" || dup.source === "both") {
        if (dup.driveFileId) {
          try {
            await deleteDriveFile(dup.driveFileId);
            drivePurgedCount++;
            console.log(`    [Drive] Deleted file: ${dup.driveFileId}`);
          } catch (err) {
            console.warn(`    [Drive] Failed to delete file: ${dup.driveFileId} (${err.message})`);
          }
        }

        if (dup.id) {
          try {
            await pool.query("DELETE FROM filing_drive_links WHERE id = $1", [dup.id]);
            dbPurgedCount++;
            console.log(`    [DB] Deleted record ID: ${dup.id}`);
          } catch (err) {
            console.error(`    [DB] Failed to delete record ID: ${dup.id}: ${err.message}`);
          }
        }
      }
    }
  }

  console.log("\n=== Deduplication Complete ===");
  console.log(`- Disk duplicates deleted: ${diskDeletedCount}`);
  console.log(`- Database duplicate records purged: ${dbPurgedCount}`);
  console.log(`- Google Drive duplicate files deleted: ${drivePurgedCount}`);
  process.exit(0);
}

deduplicate().catch((err) => {
  console.error("Deduplication script failed:", err);
  process.exit(1);
});
