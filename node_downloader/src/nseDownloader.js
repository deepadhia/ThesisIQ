/**
 * NSE earnings + investor presentation downloader. Logic mirrors Python nse_filing_downloader:
 * - Same relevance filter (positive/negative keywords), same classification, same quarter inference.
 * - Only earnings_result and investor_presentation from NSE; concall comes from Screener.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import axios from "axios";
import dayjs from "dayjs";
import {
  DATA_DIR,
  WATCHLIST,
  DEFAULT_HISTORY_DAYS,
  HISTORY_WINDOWS,
  NSE_HEADERS,
  REQUEST_DELAY_MS,
} from "./config.js";
import { ensureDirSync, readJsonSync, writeJsonSync, sleep } from "./utils.js";
import { eventDateToResultsQuarter } from "./quarterFromEventDate.js";
import { quarterDirHasCategory } from "./quarterDirCategories.js";

// Same categories and logic as Python nse_filing_downloader (earnings + presentation only; concall from Screener)
const ALLOWED_CATEGORIES = new Set(["earnings_result", "investor_presentation", "order_win_or_ca_filing"]);

// NSE API uses attchmntText (Python spelling); support both
function getAttachmentText(ann) {
  return (ann.attchmntText ?? ann.attachmentText ?? "").trim();
}

/**
 * Mirror of Python is_relevant(): only keep PDFs that look like actual
 * transcripts/results/presentations, not intimation/schedule noise.
 */
function isRelevant(ann) {
  const attachUrl = (ann.attchmntFile ?? "").trim();
  if (
    !attachUrl ||
    attachUrl === "-" ||
    (!attachUrl.startsWith("http") && !attachUrl.includes("xml") && !attachUrl.includes("zip"))
  ) {
    return false;
  }
  const desc = (ann.desc ?? "").trim();
  const attText = getAttachmentText(ann);
  const combined = `${desc} ${attText}`.toLowerCase();

  // Keep this list fairly broad so we don't miss genuine
  // results / presentations, but rely on classifyFiling()
  // and ALLOWED_CATEGORIES to decide the final category.
  const positiveKeywords = [
    "concall",
    "con call",
    "con. call",
    "conference call",
    "earnings call",
    "transcript",
    "financial results",
    "financial result",
    "results for the quarter",
    "results for quarter",
    "quarterly results",
    "quarterly result",
    "annual results",
    "annual result",
    "outcome of board meeting",
    "outcome of the board meeting",
    "outcome of meeting",
    "board meeting held",
    "considered and approved the financial",
    "investor presentation",
    "earnings presentation",
    "presentation on financial results",
    "results presentation",
    "presentation",
    "xbrl",
    // Premium Corporate Announcements (Patent Wins, capex, plants, etc.)
    "order", "contract", "work order", "order win", "loa", "letter of award",
    "tender", "project", "agreement", "strategic", "patent", "commissioning",
    "expansion", "capacity expansion", "capex", "investment", "plant",
    "commercial production", "secures", "secured", "received order", "award", "received"
  ];
  if (!positiveKeywords.some((kw) => combined.includes(kw))) {
    return false;
  }

  const negativeSnippets = [
    "schedule of meet",
    "schedule of meeting",
    "investor meet intimation",
    "intimation of investor meet",
    "intimation regarding investor meet",
    "intimation regarding analysts/ institutional investors meet",
    "invitation to investor meet",
    // Newspaper / statutory publication ads — not the actual results PDF (common on NSE, e.g. Lumax)
    "newspaper",
    "newspaper advertisement",
    "advertisement for publication",
    "advertisement for financial",
    "advertisement of financial",
    "publication of financial results in newspaper",
    "publication of results in newspaper",
    "publication in newspaper",
    "submission of newspaper",
    "published in newspaper",
    "pursuant to regulation 47", // SEBI newspaper publication requirement
    "regulation 47 of sebi",
  ];
  if (negativeSnippets.some((bad) => combined.includes(bad))) {
    return false;
  }

  return true;
}

/**
 * Same classification as Python classify_filing(); we only use
 * earnings_result and investor_presentation (concall comes from Screener).
 */
/** True if NSE text is a newspaper-ad / publication notice, not substantive results/presentation. */
function isNewspaperOrPublicationAd(text) {
  const t = text.toLowerCase();
  return [
    "newspaper",
    "newspaper advertisement",
    "advertisement for publication",
    "advertisement for financial",
    "advertisement of financial",
    "publication of financial results in newspaper",
    "publication of results in newspaper",
    "publication in newspaper",
    "submission of newspaper",
    "published in newspaper",
    "pursuant to regulation 47",
    "regulation 47 of sebi",
  ].some((x) => t.includes(x));
}

export function classifyFiling(ann) {
  const desc = (ann.desc ?? "").toLowerCase();
  const text = `${desc} ${getAttachmentText(ann).toLowerCase()}`;

  if (isNewspaperOrPublicationAd(text)) {
    return null;
  }

  if (
    ["transcript", "concall", "con call", "conference call", "earnings call"].some(
      (k) => text.includes(k),
    )
  ) {
    return "concall_transcript"; // filtered out by ALLOWED_CATEGORIES
  }

  // Classify patent, plant, order wins, capacity expansions & capex first to prevent false classification under general categories
  if (
    [
      "patent", "order win", "work order", "loa", "letter of award",
      "capacity expansion", "capex", "commissioning", "commercial production",
      "new plant", "plant execution", "project award", "secures order"
    ].some((k) => text.includes(k)) ||
    (
      ["order", "contract", "tender", "project", "agreement", "strategic", "expansion", "investment", "plant", "secures", "secured", "received", "award"].some((k) => text.includes(k)) &&
      !["schedule of meet", "investor meet", "analyst meet", "newspaper", "advertisement"].some((k) => text.includes(k))
    )
  ) {
    return "order_win_or_ca_filing";
  }

  if (text.includes("investor presentation") || text.includes("presentation")) {
    return "investor_presentation";
  }
  if (text.includes("xbrl")) {
    return "raw_xbrl";
  }
  if (
    [
      "financial result",
      "quarterly result",
      "annual result",
      "board meeting",
    ].some((k) => text.includes(k))
  ) {
    return "earnings_result";
  }
  return null;
}

function calendarDateToQuarter(dateInput) {
  if (dateInput == null) return "UNKNOWN";
  const d = dayjs(dateInput);
  if (!d.isValid()) return "UNKNOWN";
  const year = d.year();
  const month = d.month() + 1; // 1-12
  let q;
  let fyYear;
  if (month >= 4 && month <= 6) {
    q = 1; fyYear = year + 1;
  } else if (month >= 7 && month <= 9) {
    q = 2; fyYear = year + 1;
  } else if (month >= 10 && month <= 12) {
    q = 3; fyYear = year + 1;
  } else {
    q = 4; fyYear = year;
  }
  return `FY${String(fyYear).slice(-2)}-Q${q}`;
}

function inferQuarterForAnnouncement(ann) {
  const desc = (ann.desc ?? "").toLowerCase();
  const attText = getAttachmentText(ann).toLowerCase();
  const combined = `${desc} ${attText}`;

  // Patterns like "Q2 FY26" or "Q2FY26"
  const m1 = combined.match(/q([1-4])\s*fy\s*(\d{2}|\d{4})/i) || combined.match(/q([1-4])fy(\d{2}|\d{4})/i);
  if (m1) {
    const qNum = Number(m1[1]);
    const fy = m1[2].length === 2 ? m1[2] : String(m1[2]).slice(-2);
    if (qNum >= 1 && qNum <= 4) {
      return `FY${fy}-Q${qNum}`;
    }
  }

  // Patterns like "Quarter 3 FY2026" or "quarter 1 of FY26"
  const m2 = combined.match(/quarter\s*([1-4])\s*(?:of\s*)?fy\s*(\d{2}|\d{4})/i);
  if (m2) {
    const qNum = Number(m2[1]);
    const fy = m2[2].length === 2 ? m2[2] : String(m2[2]).slice(-2);
    if (qNum >= 1 && qNum <= 4) {
      return `FY${fy}-Q${qNum}`;
    }
  }

  // "Quarter ended 30 June 2025" / "quarter ended June 30, 2025" → Q1 FY26 (Indian FY)
  const quarterEnded = combined.match(/quarter\s+ended\s+(?:(\d{1,2})\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:,\s*)?(\d{4})/i);
  if (quarterEnded) {
    const monthStr = (quarterEnded[2] || "").toLowerCase();
    const year = Number(quarterEnded[3]);
    const monthMap = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const month = monthMap[monthStr];
    if (month && year) {
      const fyYear = month >= 4 ? year + 1 : year;
      let q = month >= 4 && month <= 6 ? 1 : month >= 7 && month <= 9 ? 2 : month >= 10 && month <= 12 ? 3 : 4;
      return `FY${String(fyYear).slice(-2)}-Q${q}`;
    }
  }

  // Fallback: use calendar date for order wins, event-date fallback for earnings/presentations
  const category = classifyFiling(ann);
  if (category === "order_win_or_ca_filing") {
    return calendarDateToQuarter(ann.sort_date || "");
  }
  return eventDateToResultsQuarter(ann.sort_date || "");
}

/**
 * NSE requires a valid cookie/session from the homepage before API calls work.
 * Warm up the session like the Python version.
 */
async function createNseSession() {
  const session = axios.create({
    headers: { ...NSE_HEADERS },
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  let cookieStr = "";

  function applySetCookie(res) {
    const setCookie = res.headers["set-cookie"];
    if (setCookie) {
      const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
      const newPart = parts.map((c) => c.split(";")[0].trim()).join("; ");
      cookieStr = cookieStr ? `${cookieStr}; ${newPart}` : newPart;
      session.defaults.headers.common["Cookie"] = cookieStr;
    }
  }

  try {
    const r1 = await session.get("https://www.nseindia.com");
    applySetCookie(r1);
    await sleep(1000);
    const r2 = await session.get(
      "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
    );
    applySetCookie(r2);
    await sleep(REQUEST_DELAY_MS);
  } catch (e) {
    console.warn("NSE session warm-up issue (may still work):", e.message);
  }

  session.defaults.validateStatus = undefined;
  const hasCookie = !!session.defaults.headers?.common?.Cookie;
  console.log(`[NSE] Session ready. Cookie present: ${hasCookie}`);
  return session;
}

async function downloadFile(session, url, savePath) {
  ensureDirSync(path.dirname(savePath));
  try {
    const res = await session.get(url, { responseType: "arraybuffer" });
    if (res.status !== 200) {
      console.warn(`[NSE] Download HTTP ${res.status}: ${url.slice(0, 80)}...`);
      return null;
    }
    const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data);
    
    // Safety check for PDFs only
    if (savePath.toLowerCase().endsWith(".pdf")) {
      if (buf.length < 100 || buf[0] !== 0x25 || buf[1] !== 0x50) {
        console.warn(`[NSE] Response not a PDF (size=${buf.length}, magic=${buf.slice(0, 4).toString("ascii")}): ${url.slice(0, 60)}...`);
        return null;
      }
    }
    
    fs.writeFileSync(savePath, buf);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    console.log(`[NSE] Saved: ${path.basename(savePath)} (hash=${hash.slice(0, 8)}...)`);
    return { success: true, hash };
  } catch (err) {
    console.error(`[NSE] Failed to download: ${err.message}. URL: ${url.slice(0, 80)}...`);
    return null;
  }
}

function updateMetaJson(folderPath, ann, filename, category, hash) {
  const metaPath = path.join(folderPath, "meta.json");
  const existing = readJsonSync(metaPath, []);
  existing.push({
    filename: path.basename(filename),
    category,
    description: ann.desc ?? "",
    attachment_text: getAttachmentText(ann),
    announcement_date: ann.announcementDate ?? "",
    sort_date: ann.sort_date ?? "",
    seq_id: ann.seq_id ?? "",
    source_url: ann.attchmntFile ?? "",
    file_size: ann.attachmentSize ?? "",
    hash: hash || null,
  });
  writeJsonSync(metaPath, existing);
}

async function fetchAnnouncements(session, symbol, fromStr, toStr) {
  const params = new URLSearchParams({
    index: "equities",
    symbol,
    from_date: fromStr,
    to_date: toStr,
  });
  const url = `https://www.nseindia.com/api/corporate-announcements?${params.toString()}`;
  console.log(`[NSE] Fetching ${symbol} ${fromStr}..${toStr}: ${url}`);
  const res = await session.get(url);
  if (res.status !== 200) {
    console.error(`[NSE] API error: status=${res.status} ${res.statusText || ""}`);
    throw new Error(`NSE API returned ${res.status} ${res.statusText || ""}`);
  }
  if (!Array.isArray(res.data)) {
    console.warn(`[NSE] Response is not an array (type=${typeof res.data}). Raw: ${JSON.stringify(res.data)?.slice(0, 200)}`);
    return [];
  }
  const count = res.data.length;
  console.log(`[NSE] ${symbol} ${fromStr}..${toStr}: API returned ${count} raw announcement(s)`);
  if (count === 0) {
    console.warn(`[NSE] No announcements from NSE for ${symbol} in ${fromStr}–${toStr}. Symbol may be delisted, or no filings in this range.`);
  }
  return res.data;
}

async function processSymbol(session, symbol, fromStr, toStr, downloadLog, dataDir) {
  const baseDir = dataDir || DATA_DIR;
  console.log(
    `[NSE] Processing ${symbol} from ${fromStr} to ${toStr}...`,
  );
  let downloaded = 0;
  let anns;
  try {
    anns = await fetchAnnouncements(session, symbol, fromStr, toStr);
    // HBL is a special case: some historical announcements are filed under
    // HBLENGINE on NSE. If we get *no* announcements for HBL in this window,
    // try once more with HBLENGINE so we don't silently miss results.
    if ((!anns || anns.length === 0) && symbol === "HBL") {
      console.warn(
        `[NSE] ${symbol} returned 0 announcements. Retrying this window with HBLENGINE (alternate NSE symbol)`,
      );
      anns = await fetchAnnouncements(session, "HBLENGINE", fromStr, toStr);
    }
  } catch (err) {
    console.error(
      `[NSE] Error fetching announcements for ${symbol} (${fromStr}–${toStr}): ${err.message}`,
    );
    return 0;
  }

  let relevant = 0;
  let classified = 0;
  let allowed = 0;
  let skippedNoUrl = 0;
  let skippedInLog = 0;
  let skippedDupQuarter = 0;
  let skippedAlreadyOnDisk = 0;
  let attempted = 0;
  let recoveredFromMissing = 0;

  const seenQuarterCategory = new Set();

  for (const ann of anns) {
    if (!isRelevant(ann)) continue;
    relevant += 1;
    const category = classifyFiling(ann);
    if (!category) continue;
    classified += 1;
    if (!ALLOWED_CATEGORIES.has(category)) {
      continue; // concall_transcript etc. — we only want earnings_result, investor_presentation
    }
    allowed += 1;

    const pdfUrl = (ann.attchmntFile ?? "").trim();
    const seqId = ann.seq_id;
    if (!pdfUrl || !seqId) {
      skippedNoUrl += 1;
      continue;
    }

    if (downloadLog[seqId]) {
      const existingPath = downloadLog[seqId].filename;
      if (existingPath && fs.existsSync(existingPath)) {
        skippedInLog += 1;
        continue;
      }
      delete downloadLog[seqId];
      recoveredFromMissing += 1;
    }

    const sortDate = ann.sort_date || "";
    const quarter = inferQuarterForAnnouncement(ann);
    const key = `${quarter}|${category}`;
    
    // Deduplication constraint only applies to earnings results and investor presentations
    const isSinglePerQuarter = ["earnings_result", "investor_presentation"].includes(category);

    if (isSinglePerQuarter) {
      if (seenQuarterCategory.has(key)) {
        skippedDupQuarter += 1;
        continue;
      }
    }

    const quarterFolder = path.join(baseDir, symbol, quarter);
    if (isSinglePerQuarter && quarterDirHasCategory(quarterFolder, category)) {
      skippedAlreadyOnDisk += 1;
      seenQuarterCategory.add(key);
      continue;
    }
    
    if (isSinglePerQuarter) {
      seenQuarterCategory.add(key);
    }

    const datePart = sortDate ? sortDate.slice(0, 10) : "unknown";
    // Include symbol (share), quarter, and category in filename for easier identification on disk
    let ext = ".pdf";
    if (pdfUrl.toLowerCase().includes(".xml")) ext = ".xml";
    if (pdfUrl.toLowerCase().includes(".zip")) ext = ".zip";
    
    const filename = `${symbol}_${quarter}_${category}_${datePart}_${seqId}${ext}`;
    const folder = quarterFolder;
    const savePath = path.join(folder, filename);

    attempted += 1;
    const result = await downloadFile(session, pdfUrl, savePath);
    if (result && result.success) {
      downloadLog[seqId] = {
        symbol,
        category,
        quarter,
        filename: savePath,
        url: pdfUrl,
        hash: result.hash,
        downloaded_at: new Date().toISOString(),
      };
      updateMetaJson(folder, ann, filename, category, result.hash);
      downloaded += 1;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  // ENRICHMENT: Download Integrated Filings (XBRL)
  const integratedDownloaded = await downloadIntegratedFilings(symbol, fromStr, toStr, baseDir);
  downloaded += integratedDownloaded;

  if (recoveredFromMissing > 0) {
    console.log(`[NSE] ${symbol}: ${recoveredFromMissing} entry(ies) in log had missing file on disk; will re-download.`);
  }
  console.log(
    `[NSE] ${symbol} ${fromStr}..${toStr}: raw=${anns.length} relevant=${relevant} classified=${classified} allowed=${allowed} ` +
      `skipNoUrl=${skippedNoUrl} skipInLog=${skippedInLog} skipDupQ=${skippedDupQuarter} skipOnDisk=${skippedAlreadyOnDisk} attempted=${attempted} downloaded=${downloaded} (incl. ${integratedDownloaded} XBRL)`,
  );
  return downloaded;
}

async function downloadIntegratedFilings(symbol, fromStr, toStr, baseDir) {
  const url = `https://www.nseindia.com/api/integrated-filing-results?index=equities&from_date=${fromStr}&to_date=${toStr}&symbol=${symbol}&type=Integrated%20Filing-%20Financials`;
  
  const session = axios.create({ headers: NSE_HEADERS });
  try {
    const response = await session.get(url);
    const filings = response.data.data || [];
    let downloaded = 0;

    // Deduplicate by quarter: only keep the latest one for each FY-QX
    const latestByQuarter = new Map();
    for (const f of filings) {
      if (!f.xbrl || f.xbrl === "-" || f.xbrl.includes("null")) continue;
      const qeDate = f.qe_Date || f.periodEnded || "unknown";
      const quarter = inferQuarterFromDate(qeDate);
      if (quarter === "UNKNOWN") continue;

      // Use filename as a proxy for 'latest' if we have multiple (usually higher ID means later)
      const xbrlBase = f.xbrl.split('/').pop();
      const existing = latestByQuarter.get(quarter);
      if (!existing || xbrlBase > existing.xbrlBase) {
        latestByQuarter.set(quarter, { ...f, quarter, xbrlBase, qeDate });
      }
    }

    for (const f of latestByQuarter.values()) {
      const { quarter, qeDate, xbrlBase, xbrl } = f;
      const folder = path.join(baseDir, symbol, quarter);
      ensureDirSync(folder);

      const filename = `${symbol}_${quarter}_raw_xbrl_${qeDate}_${xbrlBase}`;
      const savePath = path.join(folder, filename);

      if (fs.existsSync(savePath)) continue;

      console.log(`[NSE] Downloading Latest Integrated XBRL for ${symbol} (${quarter}): ${xbrl}`);
      const result = await downloadFile(session, xbrl, savePath);
      if (result && result.success) {
        downloaded += 1;
      }
    }
    return downloaded;
  } catch (error) {
    console.error(`[NSE] Error fetching integrated filings for ${symbol}:`, error.message);
    return 0;
  }
}

function inferQuarterFromDate(dateStr) {
  if (!dateStr || dateStr === "unknown" || dateStr === "undefined") return "UNKNOWN";
  const d = dayjs(dateStr, ["DD-MMM-YYYY", "DD-MM-YYYY", "YYYY-MM-DD"]);
  if (!d.isValid()) return "UNKNOWN";
  
  const month = d.month() + 1;
  const year = d.year();
  let q, fy;
  if (month >= 4 && month <= 6) { q = 1; fy = year + 1; }
  else if (month >= 7 && month <= 9) { q = 2; fy = year + 1; }
  else if (month >= 10 && month <= 12) { q = 3; fy = year + 1; }
  else { q = 4; fy = year; }
  return `FY${String(fy).slice(-2)}-Q${q}`;
}

async function runHistorical({ symbolFilter, historyWindow, dataDir }) {
  const baseDir = dataDir || DATA_DIR;
  const symbols = symbolFilter ? [symbolFilter.toUpperCase()] : WATCHLIST;
  const historyDays =
    HISTORY_WINDOWS[historyWindow] ?? DEFAULT_HISTORY_DAYS;

  const today = dayjs();
  const start = today.subtract(historyDays, "day");

  console.log("[NSE] " + "=".repeat(50));
  console.log(
    `[NSE] Historical mode: last ${historyDays} days (${start.format("DD-MM-YYYY")} -> ${today.format("DD-MM-YYYY")})`,
  );
  console.log(`[NSE] Data directory: ${baseDir}`);
  console.log(`[NSE] Symbols: ${symbols.join(", ")}`);

  const downloadLogPath = path.join(baseDir, "download_log.json");
  let downloadLog = {};
  if (fs.existsSync(downloadLogPath)) {
    try {
      downloadLog = readJsonSync(downloadLogPath, {});
      console.log(`[NSE] Loaded download_log.json: ${Object.keys(downloadLog).length} existing entry(ies)`);
    } catch (e) {
      console.warn(`[NSE] Could not read download_log.json: ${e.message}`);
    }
  } else {
    ensureDirSync(baseDir);
    console.log(`[NSE] No existing download_log.json; will create.`);
  }

  const session = await createNseSession();
  let totalNew = 0;

  for (const symbol of symbols) {
    let chunkStart = start;
    let chunks = 0;
    let symbolNew = 0;
    while (chunkStart.isBefore(today, "day")) {
      const tentativeEnd = chunkStart.add(89, "day");
      const chunkEnd = tentativeEnd.isAfter(today, "day") ? today : tentativeEnd;
      const fromStr = chunkStart.format("DD-MM-YYYY");
      const toStr = chunkEnd.format("DD-MM-YYYY");

      const newly = await processSymbol(
        session,
        symbol,
        fromStr,
        toStr,
        downloadLog,
        baseDir
      );
      symbolNew += newly;
      totalNew += newly;
      chunks += 1;
      writeJsonSync(downloadLogPath, downloadLog);

      chunkStart = chunkEnd.add(1, "day");
      await sleep(1000);
    }
    console.log(`[NSE] ${symbol}: ${chunks} chunk(s), ${symbolNew} new file(s) this run`);
    await sleep(1000);
  }

  console.log("[NSE] " + "=".repeat(50));
  console.log(
    `[NSE] Historical download complete. Total new files: ${totalNew}. Log: ${downloadLogPath}`,
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  let mode = "historical";
  let symbol = null;
  let historyWindow = "3q";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--mode" && i + 1 < args.length) {
      mode = args[++i];
    } else if (a === "--symbol" && i + 1 < args.length) {
      symbol = args[++i];
    } else if (a === "--history-window" && i + 1 < args.length) {
      historyWindow = args[++i];
    }
  }
  return { mode, symbol, historyWindow };
}

export { runHistorical };

async function main() {
  console.log("Starting NSE Downloader...");
  const { mode, symbol, historyWindow } = parseArgs();
  ensureDirSync(DATA_DIR);
  console.log("NSE data directory:", DATA_DIR);

  if (mode === "historical") {
    await runHistorical({ symbolFilter: symbol, historyWindow });
  } else {
    console.error("Only historical mode is implemented for Node NSE downloader.");
    process.exit(1);
  }
}

const isMain = process.argv[1] && (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

