import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../config/dataDir.js";
import {
  downloadTranscriptsPipeline,
  listDownloadedFilesForSymbol,
  resetTranscriptFilesByPeriod,
  resetAllTranscriptFiles,
  saveFilingDriveLinks,
  getAlreadyUploadedKeys,
  getSymbolDebugInfo,
  getScreenerLinksDebug,
  deleteFilingFile,
  resetAllFilesForSymbol,
} from "../services/transcripts.service.js";
import { uploadAnnouncementsToDrive, isDriveConfigured, getDriveStatus, getDriveClient } from "../services/drive.service.js";
import { syncAnnouncementsForTicker } from "../services/announcement.service.js";
import { pool } from "../db/pool.js";

export async function downloadTranscriptsHandler(req, res) {
  const { window = "3q", symbols, stockIds, useWatchlist = true, onlyMissing = false, uploadAfterDownload = false } = req.body ?? {};

  try {
    const result = await downloadTranscriptsPipeline({
      window,
      symbols,
      stockIds,
      useWatchlist,
      onlyMissing: Boolean(onlyMissing),
      uploadAfterDownload: Boolean(uploadAfterDownload),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("transcripts/download error:", err);
    if (err && err.code === "NO_SYMBOLS") {
      return res.status(400).json({ ok: false, error: err.message });
    }
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export async function listTranscriptFilesHandler(req, res) {
  try {
    const { symbol, files } = await listDownloadedFilesForSymbol(req.params.symbol);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, symbol, files });
  } catch (err) {
    console.error("transcripts/files error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export async function uploadToDriveHandler(req, res) {
  try {
    const symbol = req.body?.symbol ? String(req.body.symbol).toUpperCase() : null;

    if (!isDriveConfigured()) {
      return res.status(503).json({
        ok: false,
        error: "Google Drive upload is not configured. See docs/GOOGLE_DRIVE_SETUP.md",
      });
    }

    const alreadyUploadedKeys = symbol ? await getAlreadyUploadedKeys(symbol) : null;
    const result = await uploadAnnouncementsToDrive(symbol, alreadyUploadedKeys);
    if (result.uploaded?.length > 0) {
      await saveFilingDriveLinks(result.uploaded);
    }
    res.json({
      ok: true,
      uploaded: result.uploaded.length,
      total: result.uploaded.length + (result.errors?.length || 0) + result.skipped,
      files: result.uploaded,
      errors: result.errors,
    });
  } catch (err) {
    console.error("transcripts/upload-to-drive error:", err);
    if (err?.code === "DRIVE_NOT_CONFIGURED") {
      return res.status(503).json({ ok: false, error: err.message });
    }
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export function driveStatusHandler(_req, res) {
  try {
    const { driveConfigured, needsConnect, isOAuthConfigured, oauthPath } = getDriveStatus();
    res.set("Cache-Control", "no-store");
    res.json({ 
      ok: true, 
      driveConfigured, 
      needsConnect: needsConnect || false,
      isOAuthConfigured: isOAuthConfigured || false,
      oauthPath
    });
  } catch {
    res.json({ ok: true, driveConfigured: false, needsConnect: false, isOAuthConfigured: false });
  }
}

/** GET /api/transcripts/debug/:symbol - inspect DB data for a ticker (e.g. TIMETECHNO). */
export async function debugSymbolHandler(req, res) {
  try {
    const symbol = req.params.symbol;
    const info = await getSymbolDebugInfo(symbol);
    if (info.error) {
      return res.status(500).json({ ok: false, ...info });
    }
    res.json({ ok: true, ...info });
  } catch (err) {
    console.error("transcripts/debug error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/** GET /api/transcripts/debug/screener-links/:symbol - inspect what Screener scrape captured (earnings vs presentation vs concall). */
export function debugScreenerLinksHandler(req, res) {
  try {
    const symbol = req.params.symbol;
    const info = getScreenerLinksDebug(symbol);
    res.json({ ok: true, ...info });
  } catch (err) {
    console.error("transcripts/debug/screener-links error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export async function resetTranscriptsHandler(req, res) {
  try {
    const { period, symbol } = req.body ?? {};
    if (!["3m", "6m", "1y"].includes(period)) {
      return res.status(400).json({ ok: false, error: "period must be 3m, 6m, or 1y" });
    }
    const result = await resetTranscriptFilesByPeriod(period, symbol || null);
    res.json({
      ok: true,
      deleted: result.deleted,
      deletedFromDrive: result.deletedFromDrive ?? 0,
      errors: result.errors,
    });
  } catch (err) {
    console.error("transcripts/reset error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/** POST /api/transcripts/reset-all - delete all local + Drive transcript/filing files for all symbols. */
export async function resetAllTranscriptsHandler(_req, res) {
  try {
    const result = await resetAllTranscriptFiles();
    res.json({
      ok: true,
      deleted: result.deleted,
      deletedFromDrive: result.deletedFromDrive ?? 0,
      errors: result.errors,
    });
  } catch (err) {
    console.error("transcripts/reset-all error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/** DELETE a single filing: local file, Drive (if uploaded), and DB row. Body: { symbol, quarter, filename }. */
export async function deleteFilingHandler(req, res) {
  try {
    const { symbol, quarter, filename } = req.body ?? {};
    const result = await deleteFilingFile(symbol, quarter, filename);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({
      ok: true,
      deletedLocal: result.deletedLocal,
      deletedFromDrive: result.deletedFromDrive,
    });
  } catch (err) {
    console.error("transcripts/delete-filing error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/**
 * POST /api/transcripts/super-sync
 * Nuclear option: deletes all announcements, all files, then resyncs news and downloads all PDFs/XBRLs.
 */
export async function superSyncHandler(req, res) {
  const { stockId, ticker } = req.body ?? {};
  if (!stockId || !ticker) {
    return res.status(400).json({ ok: false, error: "stockId and ticker are required" });
  }

  const normalizedTicker = String(ticker).toUpperCase();

  try {
    // 1. Delete all corporate announcements for this stock
    await pool.query("DELETE FROM corporate_announcements WHERE stock_id = $1 OR ticker = $2", [stockId, normalizedTicker]);
    
    // 2. Delete all local files and Drive copies
    const resetResult = await resetAllFilesForSymbol(normalizedTicker);
    
    // 3. Sync Announcements (730 days lookback - FY2024+)
    const annSync = await syncAnnouncementsForTicker(stockId, normalizedTicker, 730);
    
    // 4. Download Filings (2y window) + XBRL Extraction (triggered inside pipeline)
    const pipelineResult = await downloadTranscriptsPipeline({
      symbols: [normalizedTicker],
      window: "3y",
      uploadAfterDownload: true
    });

    res.json({
      ok: true,
      message: `Super sync completed for ${normalizedTicker}`,
      deletedFiles: resetResult.deleted,
      deletedFromDrive: resetResult.deletedFromDrive,
      announcementsSynced: annSync.saved,
      pipeline: pipelineResult
    });
  } catch (err) {
    console.error("transcripts/super-sync error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/**
 * POST /api/transcripts/bulk-super-sync
 * The "Big Red Button": wipes EVERY announcement and EVERY file for EVERY stock, then resyncs all.
 * Runs in background.
 */
export async function bulkSuperSyncHandler(_req, res) {
  try {
    // Return immediately because this will take a long time
    res.json({ ok: true, message: "Bulk Master Sync initiated in background. This will take several minutes." });

    (async () => {
      try {
        console.log("[BULK SYNC] Starting system-wide nuclear reset...");
        
        // 1. Wipe all corporate announcements
        await pool.query("DELETE FROM corporate_announcements");
        
        // 2. Wipe all local files and Drive copies for all symbols
        const resetResult = await resetAllTranscriptFiles();
        console.log(`[BULK SYNC] Reset done. Deleted ${resetResult.deleted} local files, ${resetResult.deletedFromDrive} Drive files.`);
        
        // 3. Get all tickers
        const { rows: stocks } = await pool.query("SELECT id, ticker FROM stocks");
        
        // 4. Sync Announcements for all (730 days - FY2024+)
        console.log(`[BULK SYNC] Syncing news for ${stocks.length} stocks...`);
        for (const stock of stocks) {
          try {
            await syncAnnouncementsForTicker(stock.id, stock.ticker, 730);
          } catch (e) {
            console.error(`[BULK SYNC] News sync failed for ${stock.ticker}:`, e.message);
          }
        }
        
        // 5. Download all filings + XBRL for all (2y window)
        console.log("[BULK SYNC] Starting download pipeline for all stocks...");
        await downloadTranscriptsPipeline({
          useWatchlist: false,
          window: "3y",
          uploadAfterDownload: true
        });
        
        console.log("[BULK SYNC] Bulk master sync completed successfully.");
      } catch (err) {
        console.error("[BULK SYNC] Fatal error in background task:", err);
      }
    })();
  } catch (err) {
    console.error("transcripts/bulk-super-sync error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

function getCategoryFromFilename(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes("concall_transcript")) return "concall_transcript";
  if (lower.includes("earnings_result")) return "earnings_result";
  if (lower.includes("investor_presentation")) return "investor_presentation";
  if (lower.includes("order_win_or_ca_filing")) return "order_win_or_ca_filing";
  return "other";
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

export async function downloadZipHandler(req, res) {
  const symbol = String(req.params.symbol).toUpperCase();
  const dataDir = getDataDir();
  const symbolDir = path.join(dataDir, symbol);

  // Target all available quarters from FY24 through FY27 to ensure all historical and current filings/order wins are bundled
  const targetQuarters = [
    "FY24-Q1",
    "FY24-Q2",
    "FY24-Q3",
    "FY24-Q4",
    "FY25-Q1",
    "FY25-Q2",
    "FY25-Q3",
    "FY25-Q4",
    "FY26-Q1",
    "FY26-Q2",
    "FY26-Q3",
    "FY26-Q4",
    "FY27-Q1",
    "FY27-Q2",
    "FY27-Q3",
    "FY27-Q4"
  ];

  const filesToZip = [];



  function createSimpleZip(files) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of files) {
      const filenameBuf = Buffer.from(file.name, 'utf-8');
      const dataBuf = file.buffer;
      const crc = crc32(dataBuf);
      const size = dataBuf.length;

      const dosTime = 0x0021;
      const dosDate = 0x0000;

      const lfHeader = Buffer.alloc(30);
      lfHeader.writeUInt32LE(0x04034b50, 0);
      lfHeader.writeUInt16LE(10, 4);
      lfHeader.writeUInt16LE(0, 6);
      lfHeader.writeUInt16LE(0, 8);
      lfHeader.writeUInt16LE(dosTime, 10);
      lfHeader.writeUInt16LE(dosDate, 12);
      lfHeader.writeUInt32LE(crc, 14);
      lfHeader.writeUInt32LE(size, 18);
      lfHeader.writeUInt32LE(size, 22);
      lfHeader.writeUInt16LE(filenameBuf.length, 26);
      lfHeader.writeUInt16LE(0, 28);

      const localFileRecord = Buffer.concat([lfHeader, filenameBuf, dataBuf]);
      localHeaders.push(localFileRecord);

      const cdHeader = Buffer.alloc(46);
      cdHeader.writeUInt32LE(0x02014b50, 0);
      cdHeader.writeUInt16LE(10, 4);
      cdHeader.writeUInt16LE(10, 6);
      cdHeader.writeUInt16LE(0, 8);
      cdHeader.writeUInt16LE(0, 10);
      cdHeader.writeUInt16LE(dosTime, 12);
      cdHeader.writeUInt16LE(dosDate, 14);
      cdHeader.writeUInt32LE(crc, 16);
      cdHeader.writeUInt32LE(size, 20);
      cdHeader.writeUInt32LE(size, 24);
      cdHeader.writeUInt16LE(filenameBuf.length, 28);
      cdHeader.writeUInt16LE(0, 30);
      cdHeader.writeUInt16LE(0, 32);
      cdHeader.writeUInt16LE(0, 34);
      cdHeader.writeUInt16LE(0, 36);
      cdHeader.writeUInt32LE(0, 38);
      cdHeader.writeUInt32LE(offset, 42);

      const centralFileRecord = Buffer.concat([cdHeader, filenameBuf]);
      centralHeaders.push(centralFileRecord);

      offset += localFileRecord.length;
    }

    const localBuffer = Buffer.concat(localHeaders);
    const centralBuffer = Buffer.concat(centralHeaders);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralBuffer.length, 12);
    eocd.writeUInt32LE(localBuffer.length, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([localBuffer, centralBuffer, eocd]);
  }

  function getCleanSuffixForFiling(entry, index) {
    const desc = (entry.description || entry.attachment_text || "").toLowerCase();
    const filenameLower = (entry.filename || "").toLowerCase();

    if (desc.includes("patent") || filenameLower.includes("patent")) return `_Patent_Win.pdf`;
    if (desc.includes("capex") || desc.includes("capacity") || filenameLower.includes("capex") || filenameLower.includes("capacity")) return `_Capex_Expansion.pdf`;
    if (desc.includes("plant") || desc.includes("commissioning") || desc.includes("facility") || filenameLower.includes("plant") || filenameLower.includes("commissioning") || filenameLower.includes("facility")) return `_Plant_Execution.pdf`;
    if (
      desc.includes("order") || desc.includes("contract") || desc.includes("loa") || desc.includes("award") ||
      filenameLower.includes("order_win") || filenameLower.includes("order") || filenameLower.includes("contract")
    ) {
      return `_Order_Win_${index}.pdf`;
    }
    const cleanDesc = (entry.description || "Important_Filing")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `_${cleanDesc}.pdf`;
  }

  const filingsMap = new Map();

  // 1. Scan local disk files
  if (fs.existsSync(symbolDir)) {
    for (const quarter of targetQuarters) {
      const quarterDir = path.join(symbolDir, quarter);
      const metaPath = path.join(quarterDir, "meta.json");

      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          for (const entry of meta) {
            const category = entry.category;
            if (category === "raw_xbrl" || !["earnings_result", "investor_presentation", "concall_transcript", "order_win_or_ca_filing"].includes(category)) {
              continue;
            }
            const key = `${quarter}|${entry.filename}`;
            filingsMap.set(key, {
              quarter,
              filename: entry.filename,
              category,
              description: entry.description || "",
              attachment_text: entry.attachment_text || "",
              localPath: path.join(quarterDir, entry.filename)
            });
          }
        } catch (err) {
          console.error(`Error processing meta in ${quarterDir}:`, err);
        }
      }
    }
  }

  function getSourceIdFromFilename(filename) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    const parts = base.split("_");
    return parts[parts.length - 1];
  }

  // 2. Scan DB links (Google Drive tracking)
  try {
    const linksRes = await pool.query(
      "SELECT quarter, filename, drive_file_id, drive_web_link FROM filing_drive_links WHERE symbol = $1 ORDER BY quarter, filename",
      [symbol]
    );
    const dbFilings = linksRes.rows || [];
    for (const row of dbFilings) {
      if (!targetQuarters.includes(row.quarter)) continue;

      const lowerFile = row.filename.toLowerCase();
      if (lowerFile.endsWith(".xml") || lowerFile.endsWith(".zip") || lowerFile.includes("xbrl")) {
        continue;
      }

      const key = `${row.quarter}|${row.filename}`;
      const category = getCategoryFromFilename(row.filename);

      if (!["earnings_result", "investor_presentation", "concall_transcript", "order_win_or_ca_filing"].includes(category)) {
        continue;
      }

      // Try to enrich description and attachment text from corporate_announcements table
      let description = "";
      let attachment_text = "";
      try {
        const sourceId = getSourceIdFromFilename(row.filename);
        if (sourceId && !isNaN(Number(sourceId))) {
          const annRes = await pool.query(
            "SELECT title, raw_text FROM corporate_announcements WHERE ticker = $1 AND source_id = $2 LIMIT 1",
            [symbol, sourceId]
          );
          if (annRes.rows[0]) {
            description = annRes.rows[0].title || "";
            attachment_text = annRes.rows[0].raw_text || "";
          }
        }
      } catch (annErr) {
        console.error(`[ZIP] Error enriching details for ${row.filename}:`, annErr.message);
      }

      if (filingsMap.has(key)) {
        const existing = filingsMap.get(key);
        existing.drive_file_id = row.drive_file_id;
        if (description) existing.description = description;
        if (attachment_text) existing.attachment_text = attachment_text;
      } else {
        filingsMap.set(key, {
          quarter: row.quarter,
          filename: row.filename,
          category,
          description,
          attachment_text,
          localPath: path.join(symbolDir, row.quarter, row.filename),
          drive_file_id: row.drive_file_id
        });
      }
    }
  } catch (dbErr) {
    console.error(`[ZIP] Error querying filing_drive_links for ${symbol}:`, dbErr.message);
  }

  // 3. Warm up Drive client if configured
  let drive = null;
  if (isDriveConfigured()) {
    try {
      drive = await getDriveClient();
    } catch (e) {
      console.warn("Could not get Google Drive client for ZIP compilation:", e.message);
    }
  }

  // 4. Retrieve buffers and compile
  let orderWinCounter = 1;
  for (const filing of filingsMap.values()) {
    const { quarter, filename, category, localPath, drive_file_id } = filing;
    let fileBuffer = null;

    if (localPath && fs.existsSync(localPath)) {
      try {
        fileBuffer = fs.readFileSync(localPath);
      } catch (readErr) {
        console.error(`Failed to read local file ${localPath}:`, readErr.message);
      }
    }

    if (!fileBuffer && drive && drive_file_id) {
      try {
        console.log(`[ZIP] Downloading ${filename} from Google Drive ID: ${drive_file_id}`);
        const driveRes = await drive.files.get(
          { fileId: drive_file_id, alt: "media" },
          { responseType: "arraybuffer" }
        );
        fileBuffer = Buffer.from(driveRes.data);
      } catch (driveErr) {
        console.error(`[ZIP] Failed to download ${filename} from Google Drive:`, driveErr.message);
      }
    }

    if (fileBuffer) {
      let zipName = "";
      if (category === "earnings_result") {
        zipName = `${symbol}_${quarter}_Earnings_Result.pdf`;
      } else if (category === "investor_presentation") {
        zipName = `${symbol}_${quarter}_Investor_Presentation.pdf`;
      } else if (category === "concall_transcript") {
        zipName = `${symbol}_${quarter}_Concall_Transcript.pdf`;
      } else {
        zipName = `${symbol}_${quarter}${getCleanSuffixForFiling(filing, orderWinCounter++)}`;
      }

      filesToZip.push({
        name: zipName,
        buffer: fileBuffer
      });
    }
  }

  if (filesToZip.length === 0) {
    return res.status(404).json({ ok: false, error: `No relevant filings found for ${symbol} under FY24 to FY27` });
  }

  try {
    const zipBuffer = createSimpleZip(filesToZip);
    res.setHeader("Content-Disposition", `attachment; filename=${symbol}_Filings.zip`);
    res.setHeader("Content-Type", "application/zip");
    res.send(zipBuffer);
  } catch (err) {
    console.error("Error creating zip file:", err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Error creating zip file" });
    }
  }
}



