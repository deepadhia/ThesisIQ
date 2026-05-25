import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../config/dataDir.js";
import { runHistorical } from "../../node_downloader/src/nseDownloader.js";
import { runScreenerScraper } from "../../node_downloader/src/screenerScraper.js";
import { runMerge } from "../../node_downloader/src/mergeScreenerIntoNse.js";
import { verifyOutput } from "../../node_downloader/src/verifyDownloads.js";
import {
  FILING_CATEGORIES,
  getCategoriesPresentInQuarterDir,
} from "../../node_downloader/src/quarterDirCategories.js";
import {
  getAllTickers,
  getTickersByIds,
  getWatchlistTickers,
  getTickersWithScreenerSlug,
} from "./stocks.service.js";
import { pool } from "../db/pool.js";
import { deleteDriveFile, isDriveConfigured, uploadAnnouncementsToDrive } from "./drive.service.js";
import { logger } from "../utils/logger.js";
import { fetchAndStoreXbrlMetrics } from "./xbrl.service.js";

const LOG = "Transcripts";
const WINDOW_TO_QUARTERS = { "6m": 2, "1y": 4, "2y": 8, "3y": 12, "3q": 3 };

/** Expected quarter labels for the window (e.g. 1y -> last 4 quarters from current). */
function getExpectedQuarters(window) {
  const n = WINDOW_TO_QUARTERS[window] ?? 3;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const fyYear = month >= 4 ? year + 1 : year;
  let q;
  if (month >= 4 && month <= 6) q = 1;
  else if (month >= 7 && month <= 9) q = 2;
  else if (month >= 10 && month <= 12) q = 3;
  else q = 4;
  const quarters = [];
  let y = fyYear;
  let qq = q;
  for (let i = 0; i < n; i++) {
    quarters.push(`FY${String(y).slice(-2)}-Q${qq}`);
    qq -= 1;
    if (qq === 0) {
      qq = 4;
      y -= 1;
    }
  }
  return quarters;
}

/** For each symbol, return list of { quarter, missing: string[] } (missing categories: earnings_result, investor_presentation, concall_transcript). */
function getMissingPerSymbol(dataDir, tickers, window) {
  const expectedQuarters = getExpectedQuarters(window);
  const required = FILING_CATEGORIES; // includes raw_xbrl now
  const result = new Map();

  for (const symbol of tickers) {
    const symbolDir = path.join(dataDir, symbol);
    const missingList = [];
    for (const quarter of expectedQuarters) {
      const quarterDir = path.join(symbolDir, quarter);
      let metaArr = [];
      const metaPath = path.join(quarterDir, "meta.json");
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          if (Array.isArray(meta)) metaArr = meta;
        } catch (_) {}
      }
      const existing = getCategoriesPresentInQuarterDir(quarterDir, metaArr);
      const missing = required.filter((c) => !existing.has(c));
      if (missing.length) missingList.push({ quarter, missing });
    }
    if (missingList.length) result.set(symbol, missingList);
  }
  return result;
}

export async function downloadTranscriptsPipeline({
  window = "3q",
  symbols,
  stockIds,
  useWatchlist = true,
  onlyMissing = false,
  uploadAfterDownload = false,
} = {}) {
  let tickers = [];

  if (Array.isArray(symbols) && symbols.length > 0) {
    tickers = [...new Set(symbols.map((s) => String(s).toUpperCase()))];
  } else if (Array.isArray(stockIds) && stockIds.length > 0) {
    tickers = await getTickersByIds(stockIds);
  } else if (useWatchlist) {
    tickers = await getWatchlistTickers();
  } else {
    tickers = await getAllTickers();
  }

  tickers = [...new Set(tickers)];

  if (tickers.length === 0) {
    const err = new Error("No symbols resolved from request");
    err.code = "NO_SYMBOLS";
    throw err;
  }

  const screenerSlugByTicker = await getTickersWithScreenerSlug(tickers);
  const dataDir = getDataDir();

  let toDownload = tickers;
  let missingReport = null;
  if (onlyMissing) {
    missingReport = getMissingPerSymbol(dataDir, tickers, window);
    toDownload = [...missingReport.keys()];
    if (toDownload.length === 0) {
      let uploadResult = { uploaded: 0, errors: [] };
      if (uploadAfterDownload && isDriveConfigured()) {
        logger.info(LOG, "Upload-after-download: starting for symbols", tickers.join(", "));
        for (const symbol of tickers) {
          const alreadyUploadedKeys = await getAlreadyUploadedKeys(symbol);
          logger.info(LOG, `Upload-after-download: uploading for ${symbol} (${alreadyUploadedKeys?.size ?? 0} already on Drive)`);
          const result = await uploadAnnouncementsToDrive(symbol, alreadyUploadedKeys);
          if (result.uploaded?.length) await saveFilingDriveLinks(result.uploaded);
          uploadResult.uploaded += result.uploaded?.length ?? 0;
          if (result.errors?.length) uploadResult.errors.push(...result.errors);
        }
      }
      return {
        ok: true,
        window,
        symbols: tickers,
        skipped: true,
        message: "No missing files; all quarters have earnings, presentation, and concall.",
        report: "",
        uploadAfterDownload: uploadAfterDownload ? uploadResult : undefined,
      };
    }
  }

  for (const symbol of toDownload) {
    await runHistorical({ symbolFilter: symbol, historyWindow: window, dataDir });
  }

  await runScreenerScraper(toDownload, screenerSlugByTicker);

  await runMerge({ window, dataDir, symbols: toDownload });

  // Trigger XBRL extraction for all processed stocks
  for (const symbol of tickers) {
    try {
      const { rows: stockRows } = await pool.query("SELECT id, bse_scrip_code FROM stocks WHERE UPPER(ticker) = $1", [symbol.toUpperCase()]);
      if (stockRows[0]) {
        logger.info(LOG, `Triggering XBRL extraction for ${symbol}`);
        await fetchAndStoreXbrlMetrics({
          stock_id: stockRows[0].id,
          ticker: symbol,
          bse_scrip_code: stockRows[0].bse_scrip_code
        });
      }
    } catch (e) {
      logger.error(LOG, `Failed to trigger XBRL extraction for ${symbol}: ${e.message}`);
    }
  }

  const { ok, report } = verifyOutput(dataDir);

  let uploadResult = { uploaded: 0, errors: [] };
  if (uploadAfterDownload && isDriveConfigured()) {
    logger.info(LOG, "Upload-after-download: starting for symbols", toDownload.join(", "));
    for (const symbol of toDownload) {
      const alreadyUploadedKeys = await getAlreadyUploadedKeys(symbol);
      logger.info(LOG, `Upload-after-download: uploading for ${symbol} (${alreadyUploadedKeys?.size ?? 0} already on Drive)`);
      const result = await uploadAnnouncementsToDrive(symbol, alreadyUploadedKeys);
      if (result.uploaded?.length) await saveFilingDriveLinks(result.uploaded);
      uploadResult.uploaded += result.uploaded?.length ?? 0;
      if (result.errors?.length) uploadResult.errors.push(...result.errors);
    }
  }

  return {
    ok,
    window,
    symbols: tickers,
    downloadedSymbols: toDownload,
    missingReport: missingReport ? Object.fromEntries(missingReport) : undefined,
    report,
    uploadAfterDownload: uploadAfterDownload ? uploadResult : undefined,
  };
}

const CATEGORY_LABELS = {
  earnings_result: "Earnings result",
  concall_transcript: "Concall transcript",
  investor_presentation: "Investor presentation",
  raw_xbrl: "XBRL Data",
  order_win_or_ca_filing: "Order Win or Important Filing",
};

function getCategoryAndLabel(filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const lower = filename.toLowerCase();
  
  let category = "other";
  if (lower.includes("concall_transcript")) category = "concall_transcript";
  else if (lower.includes("earnings_result")) category = "earnings_result";
  else if (lower.includes("investor_presentation")) category = "investor_presentation";
  else if (lower.includes("order_win_or_ca_filing")) category = "order_win_or_ca_filing";
  else if (lower.includes("raw_xbrl") || ext === ".xml") category = "raw_xbrl";

  const label = CATEGORY_LABELS[category] || base.replace(/_/g, " ");
  return { category, label };
}

function readMetaForFile(quarterDir, filename) {
  try {
    const metaPath = path.join(quarterDir, "meta.json");
    if (!fs.existsSync(metaPath)) return null;
    const raw = fs.readFileSync(metaPath, "utf8");
    const arr = JSON.parse(raw);
    const entry = Array.isArray(arr) ? arr.find((m) => m.filename === filename) : null;
    return entry || null;
  } catch {
    return null;
  }
}

export async function listDownloadedFilesForSymbol(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  const dataDir = getDataDir();
  const symbolDir = path.join(dataDir, normalized);
  const files = [];
  const symbolDirExists = fs.existsSync(symbolDir) && fs.statSync(symbolDir).isDirectory();

  const isQuarterAllowedUI = (q) => {
    const match = String(q || "").match(/^FY(\d{2})-Q[1-4]$/i);
    if (!match) return false;
    const fy = Number(match[1]);
    return fy >= 24; // Strictly allow FY24 onwards (FY24, FY25, FY26, etc.)
  };

  if (symbolDirExists) {
    for (const quarterName of fs.readdirSync(symbolDir)) {
      if (!isQuarterAllowedUI(quarterName)) continue;
      const quarterDir = path.join(symbolDir, quarterName);
      if (!fs.statSync(quarterDir).isDirectory()) continue;

      const entries = fs.readdirSync(quarterDir).filter((f) => {
        const ext = f.toLowerCase();
        return ext.endsWith(".pdf") || ext.endsWith(".xml");
      });

      for (const filename of entries) {
        const meta = readMetaForFile(quarterDir, filename);
        // Categorisation: use meta.json category when present, else infer from filename (earnings_result, concall_transcript, investor_presentation)
        const fromMeta = meta?.category && ["earnings_result", "concall_transcript", "investor_presentation", "order_win_or_ca_filing", "other"].includes(meta.category)
          ? meta.category
          : null;
        const { category, label } = fromMeta
          ? { category: fromMeta, label: CATEGORY_LABELS[fromMeta] || fromMeta }
          : getCategoryAndLabel(filename);
        let announcementDate = meta?.announcement_date || meta?.sort_date || null;
        // Screener files often have empty meta; parse YYYY-MM-DD from filename (e.g. *_2026-03-15_screener.pdf)
        if (!announcementDate && /_\d{4}-\d{2}-\d{2}_/.test(filename)) {
          const match = filename.match(/_(\d{4}-\d{2}-\d{2})_/);
          if (match) announcementDate = match[1];
        }
        // Fallback: file mtime as ISO date
        if (!announcementDate) {
          try {
            const stat = fs.statSync(path.join(quarterDir, filename));
            if (stat.mtime) announcementDate = stat.mtime.toISOString().slice(0, 10);
          } catch (_) {}
        }

        files.push({
          symbol: normalized,
          quarter: quarterName,
          filename,
          category,
          label,
          announcement_date: announcementDate || undefined,
          description: meta?.description || undefined,
          url: `/files/${normalized}/${quarterName}/${filename}`,
        });
      }
    }
  }

  files.sort((a, b) => {
    const q = a.quarter.localeCompare(b.quarter);
    if (q !== 0) return q;
    return (a.category || "").localeCompare(b.category || "");
  });

  const driveLinks = await getFilingDriveLinks(normalized);
  const driveLinksFull = await getFilingDriveLinksRows(normalized);
  
  // Clean up out-of-window filing links from Google Drive / database
  const outOfWindowRows = driveLinksFull.filter((row) => !isQuarterAllowedUI(row.quarter));
  if (outOfWindowRows.length > 0) {
    for (const row of outOfWindowRows) {
      pool.query("DELETE FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3", [normalized, row.quarter, row.filename]).catch((e) => {
        console.error(`Failed to delete out-of-window database record: ${e.message}`);
      });
      // Try to clean up from Google Drive if it has file id
      if (row.drive_file_id) {
        deleteDriveFile(row.drive_file_id).catch(() => {});
      }
    }
  }

  const onDiskKeys = new Set(files.map((f) => `${f.quarter}\0${f.filename}`));
  for (const f of files) {
    const key = `${f.quarter}\0${f.filename}`;
    if (driveLinks[key]) {
      f.drive_web_link = driveLinks[key].drive_web_link;
      f.drive_file_id = driveLinks[key].drive_file_id;
    }
  }
  // Include filings that exist only in DB (e.g. local file was deleted after Drive upload) so announcements list stays complete.
  for (const row of driveLinksFull) {
    if (!isQuarterAllowedUI(row.quarter)) continue;
    const key = `${row.quarter}\0${row.filename}`;
    if (onDiskKeys.has(key)) continue;
    const { category, label } = getCategoryAndLabel(row.filename);
    files.push({
      symbol: normalized,
      quarter: row.quarter,
      filename: row.filename,
      category,
      label,
      announcement_date: undefined,
      url: `/files/${normalized}/${row.quarter}/${row.filename}`,
      drive_web_link: row.drive_web_link || undefined,
      drive_file_id: row.drive_file_id || undefined,
      localMissing: true,
    });
  }
  files.sort((a, b) => {
    const q = a.quarter.localeCompare(b.quarter);
    if (q !== 0) return q;
    return (a.category || "").localeCompare(b.category || "");
  });

  return { symbol: normalized, files };
}

/** Get drive links for a symbol from DB. Returns map of "quarter\0filename" -> { drive_web_link, drive_file_id }. */
async function getFilingDriveLinks(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  const map = {};
  try {
    const res = await pool.query(
      "SELECT quarter, filename, drive_file_id, drive_web_link FROM filing_drive_links WHERE symbol = $1",
      [normalized]
    );
    for (const row of res.rows || []) {
      map[`${row.quarter}\0${row.filename}`] = {
        drive_file_id: row.drive_file_id || undefined,
        drive_web_link: row.drive_web_link || undefined,
      };
    }
  } catch (_) {}
  return map;
}

/** Get full rows from filing_drive_links for a symbol (for merging drive-only filings into listing). */
async function getFilingDriveLinksRows(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  try {
    const res = await pool.query(
      "SELECT quarter, filename, drive_file_id, drive_web_link FROM filing_drive_links WHERE symbol = $1 ORDER BY quarter, filename",
      [normalized]
    );
    return res.rows || [];
  } catch (_) {
    return [];
  }
}

/** Returns Set of "quarter|filename" for files already uploaded to Drive for this symbol. Used to skip re-upload. */
export async function getAlreadyUploadedKeys(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  const set = new Set();
  try {
    const res = await pool.query(
      "SELECT quarter, filename FROM filing_drive_links WHERE symbol = $1",
      [normalized]
    );
    for (const row of res.rows || []) {
      if (row.quarter != null && row.filename) set.add(`${row.quarter}|${row.filename}`);
    }
  } catch (_) {}
  return set;
}

/**
 * Debug: return stock row(s) and filing_drive_links for a symbol (e.g. TIMETECHNO).
 * Use GET /api/transcripts/debug/:symbol to inspect what the DB has.
 */
export async function getSymbolDebugInfo(symbol) {
  const normalized = String(symbol || "").toUpperCase().trim();
  if (!normalized) return { symbol: "", stock: null, filing_drive_links: [], error: "symbol required" };
  try {
    const stockRes = await pool.query(
      "SELECT id, company_name, ticker, sector, category, screener_slug FROM stocks WHERE UPPER(TRIM(ticker)) = $1",
      [normalized]
    );
    const stock = stockRes.rows?.[0] || null;
    const linksRes = await pool.query(
      "SELECT quarter, filename, drive_file_id, drive_web_link IS NOT NULL AS has_link, uploaded_at FROM filing_drive_links WHERE symbol = $1 ORDER BY quarter, filename",
      [normalized]
    );
    const filing_drive_links = linksRes.rows || [];
    return {
      symbol: normalized,
      stock: stock ? { id: stock.id, company_name: stock.company_name, ticker: stock.ticker, sector: stock.sector, category: stock.category, screener_slug: stock.screener_slug } : null,
      filing_drive_links,
      summary: {
        stock_found: !!stock,
        drive_links_count: filing_drive_links.length,
      },
    };
  } catch (err) {
    return {
      symbol: normalized,
      stock: null,
      filing_drive_links: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Debug: read screener_links_node.json and return links for symbol by section (earnings, presentation, concall). Run download first to generate the file. */
export function getScreenerLinksDebug(symbol) {
  const normalized = String(symbol || "").toUpperCase().trim();
  const screenerPath = path.join(process.cwd(), "screener_links_node.json");
  const result = {
    symbol: normalized,
    fileExists: false,
    earnings: [],
    presentation: [],
    concall: [],
    other: [],
    hint: "Run Download filings (or Download & upload) once to generate screener_links_node.json, then call this again.",
  };
  if (!fs.existsSync(screenerPath)) {
    return result;
  }
  result.fileExists = true;
  let links = [];
  try {
    const raw = fs.readFileSync(screenerPath, "utf8");
    links = JSON.parse(raw);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
  const forSymbol = Array.isArray(links)
    ? links.filter((l) => (l.symbol || "").toUpperCase() === normalized)
    : [];
  for (const l of forSymbol) {
    const section = l.section || "other";
    const entry = { link_text: l.link_text, label: l.label?.slice(0, 120), section, href: (l.href || "").slice(0, 80) };
    if (section === "earnings") result.earnings.push(entry);
    else if (section === "presentation") result.presentation.push(entry);
    else if (section === "concall") result.concall.push(entry);
    else result.other.push(entry);
  }
  result.totalForSymbol = forSymbol.length;
  result.hint =
    result.earnings.length === 0
      ? "No earnings links found. Screener page may use different wording, or run Download to refresh the scrape."
      : undefined;
  return result;
}

/** Save or update Drive links after upload. uploaded: { id, webViewLink, name, symbol, quarter }[]. */
export async function saveFilingDriveLinks(uploaded) {
  if (!Array.isArray(uploaded) || uploaded.length === 0) return;
  try {
    for (const u of uploaded) {
      const symbol = String(u.symbol || "").toUpperCase();
      const filename = u.name || u.filename;
      if (!symbol || !filename) continue;
      await pool.query(
        `INSERT INTO filing_drive_links (symbol, quarter, filename, drive_file_id, drive_web_link, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (symbol, quarter, filename)
         DO UPDATE SET drive_file_id = EXCLUDED.drive_file_id, drive_web_link = EXCLUDED.drive_web_link, uploaded_at = now()`,
        [symbol, u.quarter || "", filename, u.id || null, u.webViewLink || null]
      );
    }
  } catch (err) {
    console.error("saveFilingDriveLinks error:", err);
    throw err;
  }
}

const PERIOD_MS = { "3m": 90 * 24 * 60 * 60 * 1000, "6m": 182 * 24 * 60 * 60 * 1000, "1y": 365 * 24 * 60 * 60 * 1000 };

/**
 * Delete downloaded transcript/filing files (and empty dirs) whose mtime is within the last period.
 * Also deletes corresponding files from Google Drive (if configured) and removes rows from filing_drive_links.
 * period: "3m" | "6m" | "1y". symbolFilter: optional, only reset this symbol.
 * Returns { deleted: number, deletedFromDrive: number, errors: string[] }.
 */
export async function resetTranscriptFilesByPeriod(period, symbolFilter = null) {
  const ms = PERIOD_MS[period];
  if (!ms) return { deleted: 0, deletedFromDrive: 0, errors: [`Unknown period: ${period}. Use 3m, 6m, or 1y.`] };
  const cutoff = Date.now() - ms;
  const errors = [];
  let deleted = 0;
  let deletedFromDrive = 0;
  const dataDir = getDataDir();

  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    return { deleted: 0, deletedFromDrive: 0, errors: [] };
  }

  const symbols = symbolFilter
    ? [String(symbolFilter).toUpperCase()]
    : fs.readdirSync(dataDir).filter((name) => {
        const full = path.join(dataDir, name);
        return fs.statSync(full).isDirectory() && !["download_log.json", "watcher_state.json"].includes(name);
      });

  const driveConfigured = isDriveConfigured();

  for (const symbol of symbols) {
    const symbolDir = path.join(dataDir, symbol);
    if (!fs.statSync(symbolDir).isDirectory()) continue;

    for (const quarterName of fs.readdirSync(symbolDir)) {
      const quarterDir = path.join(symbolDir, quarterName);
      if (!fs.statSync(quarterDir).isDirectory()) continue;

      const entries = fs.readdirSync(quarterDir).filter((f) => f.toLowerCase().endsWith(".pdf"));
      for (const filename of entries) {
        const filePath = path.join(quarterDir, filename);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs >= cutoff) {
            try {
              const linkRes = await pool.query(
                "SELECT drive_file_id FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
                [symbol, quarterName, filename]
              );
              const row = linkRes.rows?.[0];
              if (row?.drive_file_id && driveConfigured) {
                await deleteDriveFile(row.drive_file_id);
                deletedFromDrive++;
              }
              await pool.query(
                "DELETE FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
                [symbol, quarterName, filename]
              );
            } catch (driveErr) {
              errors.push(`Drive/DB: ${symbol}/${quarterName}/${filename}: ${driveErr instanceof Error ? driveErr.message : String(driveErr)}`);
            }
            fs.unlinkSync(filePath);
            deleted++;
          }
        } catch (err) {
          errors.push(`${symbol}/${quarterName}/${filename}: ${err.message}`);
        }
      }

      const remaining = fs.readdirSync(quarterDir);
      const hasPdfs = remaining.some((f) => f.toLowerCase().endsWith(".pdf"));
      if (!hasPdfs) {
        try {
          const metaPath = path.join(quarterDir, "meta.json");
          if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
          fs.rmdirSync(quarterDir);
        } catch (_) {}
      }
    }

    try {
      if (fs.readdirSync(symbolDir).length === 0) fs.rmdirSync(symbolDir);
    } catch (_) {}

    // Also remove from Drive and DB any filing_drive_links for this symbol uploaded within the period (e.g. local was already deleted earlier).
    if (driveConfigured) {
      try {
        const cutoffDate = new Date(cutoff);
        const driveOnlyRes = await pool.query(
          "SELECT quarter, filename, drive_file_id FROM filing_drive_links WHERE symbol = $1 AND uploaded_at >= $2 AND drive_file_id IS NOT NULL",
          [symbol, cutoffDate]
        );
        for (const row of driveOnlyRes.rows || []) {
          try {
            await deleteDriveFile(row.drive_file_id);
            await pool.query(
              "DELETE FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
              [symbol, row.quarter, row.filename]
            );
            deletedFromDrive++;
          } catch (e) {
            errors.push(`Drive (orphan): ${symbol}/${row.quarter}/${row.filename}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch (_) {}
    }
  }

  return { deleted, deletedFromDrive, errors: errors.length ? errors : undefined };
}

/**
 * Hard reset: delete *all* downloaded transcript/filing PDFs and their Drive copies,
 * for all symbols and all periods. Also cleans up filing_drive_links rows.
 * Returns { deleted, deletedFromDrive, errors? }.
 */
export async function resetAllTranscriptFiles() {
  const errors = [];
  let deleted = 0;
  let deletedFromDrive = 0;
  const dataDir = getDataDir();

  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    return { deleted: 0, deletedFromDrive: 0, errors: [] };
  }

  const symbols = fs.readdirSync(dataDir).filter((name) => {
    const full = path.join(dataDir, name);
    return fs.statSync(full).isDirectory() && !["download_log.json", "watcher_state.json"].includes(name);
  });

  const driveConfigured = isDriveConfigured();

  for (const symbol of symbols) {
    const symbolDir = path.join(dataDir, symbol);
    if (!fs.statSync(symbolDir).isDirectory()) continue;

    for (const quarterName of fs.readdirSync(symbolDir)) {
      const quarterDir = path.join(symbolDir, quarterName);
      if (!fs.statSync(quarterDir).isDirectory()) continue;

      const entries = fs.readdirSync(quarterDir).filter((f) => f.toLowerCase().endsWith(".pdf"));
      for (const filename of entries) {
        const filePath = path.join(quarterDir, filename);
        try {
          try {
            const linkRes = await pool.query(
              "SELECT drive_file_id FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
              [symbol, quarterName, filename],
            );
            const row = linkRes.rows?.[0];
            if (row?.drive_file_id && driveConfigured) {
              await deleteDriveFile(row.drive_file_id);
              deletedFromDrive++;
            }
            await pool.query(
              "DELETE FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
              [symbol, quarterName, filename],
            );
          } catch (driveErr) {
            errors.push(
              `Drive/DB: ${symbol}/${quarterName}/${filename}: ${
                driveErr instanceof Error ? driveErr.message : String(driveErr)
              }`,
            );
          }
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
            deleted++;
          }
        } catch (err) {
          errors.push(`${symbol}/${quarterName}/${filename}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Remove meta.json and empty quarter dir
      try {
        const metaPath = path.join(quarterDir, "meta.json");
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
        const remaining = fs.readdirSync(quarterDir);
        if (remaining.length === 0) {
          fs.rmdirSync(quarterDir);
        }
      } catch (_) {}
    }

    // Remove empty symbol dir
    try {
      if (fs.readdirSync(symbolDir).length === 0) fs.rmdirSync(symbolDir);
    } catch (_) {}

    // Also remove any remaining Drive-only links for this symbol
    if (driveConfigured) {
      try {
        const driveOnlyRes = await pool.query(
          "SELECT quarter, filename, drive_file_id FROM filing_drive_links WHERE symbol = $1",
          [symbol],
        );
        for (const row of driveOnlyRes.rows || []) {
          try {
            if (row.drive_file_id) {
              await deleteDriveFile(row.drive_file_id);
              deletedFromDrive++;
            }
            await pool.query(
              "DELETE FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
              [symbol, row.quarter, row.filename],
            );
          } catch (e) {
            errors.push(
              `Drive (orphan): ${symbol}/${row.quarter}/${row.filename}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
          }
        }
      } catch (_) {}
    }
  }

  return { deleted, deletedFromDrive, errors: errors.length ? errors : undefined };
}

/**
 * Hard reset for a single symbol: delete *all* downloaded transcript/filing PDFs and their Drive copies.
 */
export async function resetAllFilesForSymbol(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  const errors = [];
  let deleted = 0;
  let deletedFromDrive = 0;
  const dataDir = getDataDir();
  const symbolDir = path.join(dataDir, normalized);

  if (!fs.existsSync(symbolDir) || !fs.statSync(symbolDir).isDirectory()) {
    return { deleted: 0, deletedFromDrive: 0, errors: [] };
  }

  const driveConfigured = isDriveConfigured();

  for (const quarterName of fs.readdirSync(symbolDir)) {
    const quarterDir = path.join(symbolDir, quarterName);
    if (!fs.statSync(quarterDir).isDirectory()) continue;

    const entries = fs.readdirSync(quarterDir);
    for (const filename of entries) {
      if (filename === "meta.json") continue;
      const filePath = path.join(quarterDir, filename);
      try {
        const linkRes = await pool.query(
          "SELECT drive_file_id FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
          [normalized, quarterName, filename]
        );
        const row = linkRes.rows?.[0];
        if (row?.drive_file_id && driveConfigured) {
          await deleteDriveFile(row.drive_file_id);
          deletedFromDrive++;
        }
        await pool.query(
          "DELETE FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
          [normalized, quarterName, filename]
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch (err) {
        errors.push(`${normalized}/${quarterName}/${filename}: ${err.message}`);
      }
    }
    try {
      const metaPath = path.join(quarterDir, "meta.json");
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      fs.rmdirSync(quarterDir);
    } catch (_) {}
  }

  try {
    if (fs.readdirSync(symbolDir).length === 0) fs.rmdirSync(symbolDir);
  } catch (_) {}

  return { deleted, deletedFromDrive, errors: errors.length ? errors : undefined };
}


/**
 * Delete a single filing: local file (if any), from Drive (if uploaded), and from filing_drive_links.
 * Also removes the entry from meta.json.
 * Returns { ok, deletedLocal, deletedFromDrive, error? }.
 */
export async function deleteFilingFile(symbol, quarter, filename) {
  const normalized = String(symbol || "").toUpperCase();
  const q = String(quarter || "").trim();
  const fname = String(filename || "").trim();
  if (!normalized || !q || !fname) {
    return { ok: false, deletedLocal: false, deletedFromDrive: false, error: "symbol, quarter, and filename are required" };
  }

  const dataDir = getDataDir();
  const filePath = path.join(dataDir, normalized, q, fname);
  let deletedLocal = false;
  let deletedFromDrive = false;

  try {
    const linkRes = await pool.query(
      "SELECT drive_file_id FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
      [normalized, q, fname]
    );
    const row = linkRes.rows?.[0];
    if (row?.drive_file_id && isDriveConfigured()) {
      await deleteDriveFile(row.drive_file_id);
      deletedFromDrive = true;
    }
    await pool.query(
      "DELETE FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
      [normalized, q, fname]
    );
  } catch (err) {
    return {
      ok: false,
      deletedLocal: false,
      deletedFromDrive: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    try {
      fs.unlinkSync(filePath);
      deletedLocal = true;
    } catch (err) {
      return {
        ok: true,
        deletedLocal: false,
        deletedFromDrive,
        error: `Local file delete failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const metaPath = path.join(dataDir, normalized, q, "meta.json");
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (Array.isArray(meta)) {
        const updated = meta.filter((m) => m.filename !== fname);
        fs.writeFileSync(metaPath, JSON.stringify(updated, null, 2));
      }
    } catch (_) {}
  }

  return { ok: true, deletedLocal, deletedFromDrive };
}

