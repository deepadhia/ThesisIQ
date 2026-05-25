import { pool } from "../backend/db/pool.js";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../backend/config/dataDir.js";
import { getDriveClient, isDriveConfigured } from "../backend/services/drive.service.js";

function getCategoryFromFilename(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes("concall_transcript")) return "concall_transcript";
  if (lower.includes("earnings_result")) return "earnings_result";
  if (lower.includes("investor_presentation")) return "investor_presentation";
  if (lower.includes("order_win_or_ca_filing")) return "order_win_or_ca_filing";
  return "other";
}

async function testZipCompilation(symbol) {
  console.log(`\n=========================================`);
  console.log(`TESTING ZIP COMPILATION FOR: ${symbol}`);
  console.log(`=========================================`);

  const dataDir = getDataDir();
  const symbolDir = path.join(dataDir, symbol);

  const targetQuarters = [
    "FY24-Q1", "FY24-Q2", "FY24-Q3", "FY24-Q4",
    "FY25-Q1", "FY25-Q2", "FY25-Q3", "FY25-Q4",
    "FY26-Q1", "FY26-Q2", "FY26-Q3", "FY26-Q4",
    "FY27-Q1", "FY27-Q2", "FY27-Q3", "FY27-Q4"
  ];

  const filingsMap = new Map();

  // 1. Scan DB links
  try {
    const linksRes = await pool.query(
      "SELECT quarter, filename, drive_file_id FROM filing_drive_links WHERE symbol = $1 ORDER BY quarter, filename",
      [symbol]
    );
    const dbFilings = linksRes.rows || [];
    console.log(`Found ${dbFilings.length} total filings in DB for ${symbol}`);
    
    for (const row of dbFilings) {
      if (!targetQuarters.includes(row.quarter)) continue;
      const lowerFile = row.filename.toLowerCase();
      if (lowerFile.endsWith(".xml") || lowerFile.endsWith(".zip") || lowerFile.includes("xbrl")) {
        continue;
      }

      const key = `${row.quarter}|${row.filename}`;
      const category = getCategoryFromFilename(row.filename);

      if (!["earnings_result", "investor_presentation", "concall_transcript", "order_win_or_ca_filing"].includes(category)) {
        console.log(`  - File ignored (wrong category: ${category}): ${row.filename}`);
        continue;
      }

      filingsMap.set(key, {
        quarter: row.quarter,
        filename: row.filename,
        category,
        drive_file_id: row.drive_file_id
      });
    }
  } catch (dbErr) {
    console.error("DB Error:", dbErr.message);
  }

  console.log(`\nFilings Map has ${filingsMap.size} entry(ies) to package:`);
  let orderWins = 0;
  for (const filing of filingsMap.values()) {
    if (filing.category === "order_win_or_ca_filing") {
      orderWins++;
      console.log(`  * [ORDER WIN] Quarter: ${filing.quarter} | Filename: ${filing.filename} | Drive ID: ${filing.drive_file_id}`);
    }
  }
  console.log(`Total Order Wins/Announcements mapped: ${orderWins}`);
}

async function run() {
  await testZipCompilation("SKIPPER");
  await testZipCompilation("ANANTRAJ");
  await pool.end();
}

run();
