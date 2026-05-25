/**
 * Merge Screener into NSE download structure — same flow as Python merge_screener_into_nse.py:
 * 1. Earnings + Investor presentation: from NSE first; if missing for a quarter, backfill from Screener (same fiscal quarter).
 * 2. Concall transcript: from Screener only.
 */
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import dayjs from "dayjs";
import https from "node:https";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./config.js";
import { getCategoriesPresentInQuarterDir } from "./quarterDirCategories.js";
import { ensureDirSync, readJsonSync, writeJsonSync, sleep } from "./utils.js";
import { extractQuarterFromPdf } from "./pdfQuarterParser.js";
import { eventDateToResultsQuarter } from "./quarterFromEventDate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Node-specific Screener links file so we don't overwrite Python's
const SCREENER_LINKS_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "screener_links_node.json",
);

const ALLOWED_CATEGORIES = new Set([
  "concall_transcript",
  "earnings_result",
  "investor_presentation",
]);

const DOWNLOAD_DELAY_MS = 1000;

const PDF_MAGIC = Buffer.from("%PDF", "ascii");
function isPdfBuffer(buf) {
  if (!buf || !(buf instanceof Buffer)) return false;
  return buf.length >= 4 && buf.slice(0, 4).equals(PDF_MAGIC);
}

/**
 * Screener sometimes lists earnings-call *recordings* (mp3/mp4) instead of a PDF transcript.
 * We only store PDFs here — skip these early to avoid SSL noise and wasted downloads.
 */
function isNonPdfMediaUrl(href) {
  if (!href || typeof href !== "string") return false;
  const lower = href.trim().toLowerCase();
  if (lower.includes("youtube.com/") || lower.includes("youtu.be/")) return true;
  if (lower.includes("audio-recording")) return true;
  const bare = lower.split(/[?#]/)[0];
  return /\.(mp3|mp4|m4a|wav|webm|ogg|aac|mov|mkv|flv)$/i.test(bare);
}

/**
 * Direct BSE corporate-filing PDFs (AttachHis / AttachLive). Text-based quarter detection
 * often disagrees (prior-year tables, scanned PDFs). We still keep the file under the
 * Screener-mapped quarter instead of deleting it.
 */
function isBseCorpFilingDirectPdf(href) {
  if (!href || typeof href !== "string") return false;
  const pathOnly = href.trim().split(/[?#]/)[0].toLowerCase();
  if (!pathOnly.endsWith(".pdf")) return false;
  return pathOnly.includes("bseindia.com/xml-data/corpfiling/attach");
}

/** If response is HTML (e.g. BSE attachment page), try to find a direct PDF link. Returns first candidate URL or null. */
function extractPdfUrlFromHtml(htmlBuffer, baseUrl) {
  if (!htmlBuffer || htmlBuffer.length < 100) return null;
  const str = htmlBuffer.toString("utf8", 0, Math.min(htmlBuffer.length, 50000));
  const base = baseUrl ? new URL(baseUrl) : null;
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  const candidates = [];
  let m;
  while ((m = hrefRe.exec(str)) !== null) {
    const href = m[1].trim();
    const lower = href.toLowerCase();
    if (lower.endsWith(".pdf")) {
      try {
        const url = base ? new URL(href, base).href : href;
        if (url.startsWith("http")) candidates.push(url);
      } catch (_) {}
    } else if (
      (lower.includes("bseindia.com") || lower.includes("nseindia.com")) &&
      (lower.includes("attach") || lower.includes("corpfiling") || lower.includes("annual") || lower.includes("pdf"))
    ) {
      try {
        const url = base ? new URL(href, base).href : href;
        if (url.startsWith("http")) candidates.push(url);
      } catch (_) {}
    }
  }
  return candidates.length > 0 ? candidates[0] : null;
}

// Map history window to max quarters to backfill, roughly matching Python:
// 6m ≈ 2 quarters, 1y ≈ 4, 2y ≈ 8, 3q = 3.
const WINDOW_TO_QUARTERS = {
  "6m": 2,
  "1y": 4,
  "2y": 8,
  "3y": 12,
  "3q": 3,
};

function parseLabelDate(labelOrLink) {
  const text =
    typeof labelOrLink === "string"
      ? labelOrLink
      : [labelOrLink?.label, labelOrLink?.link_text]
          .filter(Boolean)
          .join(" ");
  if (!text) return null;
  const m = text.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i,
  );
  if (!m) return null;
  const monthStr = m[1].toLowerCase();
  const year = Number(m[2]);
  const monthMap = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const month = monthMap[monthStr];
  if (!month) return null;
  return dayjs(`${year}-${String(month).padStart(2, "0")}-01`);
}

/** Try to parse explicit quarter from label text (e.g. "Q2 FY26", "Quarter 1 FY26"). Returns null if not found. */
function parseExplicitQuarterFromLabel(link) {
  const text = [link?.label, link?.link_text].filter(Boolean).join(" ");
  if (!text) return null;
  const m1 = text.match(/q([1-4])\s*fy\s*(\d{2}|\d{4})/i) || text.match(/q([1-4])fy(\d{2}|\d{4})/i);
  if (m1) {
    const qNum = Number(m1[1]);
    const fy = m1[2].length === 2 ? m1[2] : String(m1[2]).slice(-2);
    if (qNum >= 1 && qNum <= 4) return `FY${fy}-Q${qNum}`;
  }
  const m2 = text.match(/quarter\s*([1-4])\s*(?:of\s*)?fy\s*(\d{2}|\d{4})/i);
  if (m2) {
    const qNum = Number(m2[1]);
    const fy = m2[2].length === 2 ? m2[2] : String(m2[2]).slice(-2);
    if (qNum >= 1 && qNum <= 4) return `FY${fy}-Q${qNum}`;
  }
  return null;
}

function parseQuarterEndedFromLabel(link) {
  const text = [link?.label, link?.link_text].filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;
  if (text.includes("ended") || text.includes("ending") || text.includes("quarterly results")) {
    const m = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i) || 
              text.match(/(\d{4})-(03|06|09|12)/i);
    if (m) {
      let month = 0;
      let year = 0;
      if (m[2] && (m[2] === "03" || m[2] === "06" || m[2] === "09" || m[2] === "12")) {
        year = Number(m[1]);
        month = Number(m[2]);
      } else {
        const monthStr = m[1].toLowerCase();
        year = Number(m[2]);
        const monthMap = {
          jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
          jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
        };
        month = monthMap[monthStr] || 0;
      }
      
      if (month && year) {
        let q = 0;
        let fyYear = year;
        if (month >= 2 && month <= 4) {
          q = 4;
          fyYear = year;
        } else if (month >= 5 && month <= 7) {
          q = 1;
          fyYear = year + 1;
        } else if (month >= 8 && month <= 10) {
          q = 2;
          fyYear = year + 1;
        } else if (month >= 11 || month <= 1) {
          q = 3;
          fyYear = month === 12 ? year + 1 : year;
        }
        if (q && fyYear) {
          return `FY${String(fyYear).slice(-2)}-Q${q}`;
        }
      }
    }
  }
  return null;
}

function mapLinkToQuarter(link) {
  const explicit = parseExplicitQuarterFromLabel(link);
  if (explicit) return explicit;
  const ended = parseQuarterEndedFromLabel(link);
  if (ended) return ended;
  const d = parseLabelDate(link);
  if (!d) return null;
  // Label date is event date (call/announcement). Use shared rule: Jan→Q3, Apr→Q4, Jul→Q1, Oct→Q2.
  return eventDateToResultsQuarter(d);
}

function groupLinksBySymbolQuarter(links) {
  const bySymbolQuarter = new Map();
  for (const link of links) {
    const quarter = mapLinkToQuarter(link);
    if (!quarter) continue;
    const key = `${link.symbol}|${quarter}`;
    if (!bySymbolQuarter.has(key)) {
      bySymbolQuarter.set(key, []);
    }
    bySymbolQuarter.get(key).push({ ...link, fiscal_quarter: quarter });
  }
  return bySymbolQuarter;
}

function buildHttpClient(referrer) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/122.0.0.0 Safari/537.36",
    Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
  };
  if (referrer) {
    headers.Referer = referrer;
  }
  return axios.create({
    headers,
    timeout: 25000,
    maxRedirects: 5,
  });
}

// Very low-level fallback for broken BSE responses that Node's HTTP parser rejects.
// Opens a raw TLS socket, sends a manual HTTP GET, and extracts the body bytes.
async function downloadViaRawTls(url, referer, savePath) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 443;
  const pathWithQuery = parsed.pathname + (parsed.search || "");

  const headers = [
    `GET ${pathWithQuery} HTTP/1.1`,
    `Host: ${host}`,
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/122.0.0.0 Safari/537.36",
    "Accept: application/pdf,application/octet-stream,*/*",
    "Connection: close",
  ];
  if (referer) {
    headers.push(`Referer: ${referer}`);
  }
  const requestText = headers.join("\r\n") + "\r\n\r\n";

  const bodyBuffer = await new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false, // we already handle security at higher level
      },
      () => {
        socket.write(requestText);
      },
    );

    const chunks = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", (err) => reject(err));
    socket.on("end", () => {
      const buf = Buffer.concat(chunks);
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return reject(new Error("No header/body separator in raw response"));
      }
      const headerPart = buf.slice(0, headerEnd).toString("latin1");
      let bodyPart = buf.slice(headerEnd + 4);

      // Handle simple chunked transfer-encoding if present
      const lowerHeaders = headerPart.toLowerCase();
      if (lowerHeaders.includes("transfer-encoding: chunked")) {
        try {
          const out = [];
          let i = 0;
          while (i < bodyPart.length) {
            const lineEnd = bodyPart.indexOf("\r\n", i);
            if (lineEnd === -1) break;
            const sizeHex = bodyPart
              .slice(i, lineEnd)
              .toString("ascii")
              .trim();
            const size = parseInt(sizeHex, 16);
            if (!Number.isFinite(size)) break;
            if (size === 0) {
              break;
            }
            const chunkStart = lineEnd + 2;
            const chunkEnd = chunkStart + size;
            out.push(bodyPart.slice(chunkStart, chunkEnd));
            i = chunkEnd + 2; // skip trailing CRLF
          }
          bodyPart = Buffer.concat(out);
        } catch {
          // If de-chunking fails, fall back to raw bodyPart
        }
      }

      resolve(bodyPart);
    });
  });

  if (!isPdfBuffer(bodyBuffer)) {
    console.warn(`Raw TLS response is not a PDF, skipping: ${linkHref.slice(0, 80)}`);
    return null;
  }
  fs.writeFileSync(savePath, bodyBuffer);
  console.log(`Saved via raw TLS: ${savePath}`);
  return savePath;
}

function parseDateFromLabel(label) {
  const clean = String(label || "").replace(/\s+/g, " ");
  // Match DDth Month YYYY (e.g. 14th May 2026 or 14 May 2026)
  const ddMonthYyyy = clean.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (ddMonthYyyy) {
    const day = ddMonthYyyy[1].padStart(2, "0");
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const month = months[ddMonthYyyy[2].toLowerCase().slice(0, 3)];
    const year = ddMonthYyyy[3];
    return `${year}-${month}-${day}`;
  }
  
  // Match Month YYYY (e.g. May 2026)
  const monthYyyy = clean.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (monthYyyy) {
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const month = months[monthYyyy[1].toLowerCase().slice(0, 3)];
    const year = monthYyyy[2];
    return `${year}-${month}-15`; // Use 15th of the month as a standard middle day
  }

  // Fallback: search for YYYY-MM-DD in text
  const yyyyMmDd = clean.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (yyyyMmDd) return yyyyMmDd[0];

  return null;
}

async function downloadFile(link, folderPath, category) {
  if (isNonPdfMediaUrl(link.href)) {
    console.warn(
      `[Merge] Skipping URL (audio/video, not a PDF transcript): ${String(link.href).slice(0, 120)}`,
    );
    return null;
  }
  ensureDirSync(folderPath);
  const quarter = link.fiscal_quarter;
  
  const datePart = parseDateFromLabel(link.label) || "screener";
  const baseName = `${link.symbol}_${quarter}_${category}_${datePart}_screener.pdf`;
  const savePath = path.join(folderPath, baseName);

  if (fs.existsSync(savePath)) {
    console.log(`[Merge] File already exists, skipping download: ${savePath}`);
    return savePath;
  }

  const isBse = link.href.includes("bseindia.com");
  const client = buildHttpClient(isBse ? link.company_url : undefined);

  let lastError = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let res;
      try {
        res = await client.get(link.href, { responseType: "arraybuffer" });
      } catch (err) {
        // Rough SSL fallback like Python download_file
        if (err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
          console.warn(
            `SSL verify failed for ${link.href.slice(
              0,
              80,
            )}, retrying with insecure TLS...`,
          );
          const insecureClient = axios.create({
            ...client.defaults,
            httpsAgent: new https.Agent({
              rejectUnauthorized: false,
            }),
          });
          res = await insecureClient.get(link.href, {
            responseType: "arraybuffer",
          });
        } else if (
          typeof err.message === "string" &&
          err.message.includes("Parse Error")
        ) {
          // Node HTTP parser rejected the response (e.g. whitespace in headers).
          // Fall back to raw TLS and manual parsing.
          if (isBse) {
            return await downloadViaRawTls(
              link.href,
              link.company_url,
              savePath,
            );
          }
          throw err;
        } else {
          throw err;
        }
      }

      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data);
      if (!isPdfBuffer(data)) {
        if (category === "earnings_result") {
          const pdfUrl = extractPdfUrlFromHtml(data, link.href);
          if (pdfUrl && pdfUrl !== link.href) {
            await sleep(DOWNLOAD_DELAY_MS);
            try {
              const res2 = await client.get(pdfUrl, { responseType: "arraybuffer" });
              if (res2.status >= 200 && res2.status < 300) {
                const data2 = Buffer.isBuffer(res2.data) ? res2.data : Buffer.from(res2.data);
                if (isPdfBuffer(data2)) {
                  fs.writeFileSync(savePath, data2);
                  console.log(`Saved (earnings fallback URL): ${savePath}`);
                  return savePath;
                }
              }
            } catch (_) {}
          }
        }
        console.warn(
          `Response is not a PDF (got ${data.length} bytes), skipping: ${link.href.slice(0, 80)}`,
        );
        return null;
      }
      fs.writeFileSync(savePath, data);
      console.log(`Saved: ${savePath}`);
      return savePath;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(DOWNLOAD_DELAY_MS * 2);
      }
    }
  }

  console.error(
    `Failed to download ${link.href.slice(
      0,
      80,
    )}: ${lastError && lastError.message ? lastError.message : lastError}`,
  );
  return null;
}

function removeCorruptedPdfsInFolder(folder, meta) {
  if (!fs.existsSync(folder)) return meta;
  const names = fs.readdirSync(folder);
  let metaOut = meta;
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".pdf")) continue;
    const filePath = path.join(folder, name);
    try {
      const buf = Buffer.alloc(4);
      const fd = fs.openSync(filePath, "r");
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      if (!buf.equals(PDF_MAGIC)) {
        fs.unlinkSync(filePath);
        metaOut = metaOut.filter((m) => m.filename !== name);
        console.warn(`Removed corrupted (non-PDF) file: ${path.join(folder, name)}`);
      }
    } catch (_) {
      // ignore read errors
    }
  }
  return metaOut;
}

async function backfillQuarterForSymbol(symbol, quarter, links, allowedQuartersForSymbol = null, dataRoot = DATA_DIR) {
  const folder = path.join(dataRoot, symbol, quarter);
  ensureDirSync(folder);

  const metaPath = path.join(folder, "meta.json");
  let meta = readJsonSync(metaPath, []);
  meta = removeCorruptedPdfsInFolder(folder, meta);
  if (meta.length > 0) writeJsonSync(metaPath, meta);

  const allowedSet = allowedQuartersForSymbol instanceof Set ? allowedQuartersForSymbol : null;

  const existingCats = getCategoriesPresentInQuarterDir(folder, meta);
  let hasEarnings = existingCats.has("earnings_result");
  let hasPpt = existingCats.has("investor_presentation");
  let hasConcall = existingCats.has("concall_transcript");

  const earningsLinks = links
    .filter((l) => l.section === "earnings")
    .sort((a, b) => {
      const order = (href) => {
        const h = (href || "").toLowerCase();
        if (h.includes("nseindia.com")) return 0;
        if (h.includes("bseindia.com")) return 1;
        return 2;
      };
      return order(a.href) - order(b.href);
    });
  const presentationLinks = links.filter((l) => l.section === "presentation");
  const concallLinks = links.filter((l) => l.section === "concall");

  async function validatePdfQuarterAndKeep(savePath, expectedQuarter, categoryLabel, linkForMeta = null) {
    if (!savePath || !fs.existsSync(savePath)) return false;
    try {
      const detectedQuarter = await extractQuarterFromPdf(savePath);
      if (detectedQuarter == null || detectedQuarter === expectedQuarter) return true;
      // Mismatch: PDF content is for a different quarter (often Screener link points to old doc).
      const moveToCorrectQuarter =
        allowedSet && allowedSet.has(detectedQuarter) && path.dirname(savePath) !== path.join(dataRoot, symbol, detectedQuarter);
      if (moveToCorrectQuarter) {
        const targetDir = path.join(dataRoot, symbol, detectedQuarter);
        ensureDirSync(targetDir);
        const baseName = path.basename(savePath);
        const newName = baseName.replace(expectedQuarter, detectedQuarter);
        const targetPath = path.join(targetDir, newName);
        if (targetPath !== savePath) {
          fs.renameSync(savePath, targetPath);
          const targetMetaPath = path.join(targetDir, "meta.json");
          const targetMeta = readJsonSync(targetMetaPath, []);
          const hasAlready = targetMeta.some((m) => m.category === categoryLabel);
          if (!hasAlready && linkForMeta) {
            targetMeta.push({
              filename: newName,
              category: categoryLabel,
              description: linkForMeta.link_text,
              attachment_text: linkForMeta.label,
              announcement_date: "",
              sort_date: "",
              seq_id: "",
              source_url: linkForMeta.href,
              file_size: "",
            });
            writeJsonSync(targetMetaPath, targetMeta);
          }
          console.log(`[Merge] Moved to correct quarter: ${path.basename(savePath)} → ${symbol}/${detectedQuarter}/${newName} (content was ${detectedQuarter}, not ${expectedQuarter})`);
        }
        return false;
      }
      const sourceHref = linkForMeta && linkForMeta.href ? String(linkForMeta.href) : "";
      if (isBseCorpFilingDirectPdf(sourceHref)) {
        console.warn(
          `[Merge] Quarter from PDF text (${detectedQuarter}) ≠ expected folder (${expectedQuarter}); keeping BSE filing PDF: ${path.basename(savePath)} (${categoryLabel}).`,
        );
        return true;
      }
      fs.unlinkSync(savePath);
      console.warn(
        `[Merge] Quarter mismatch: PDF content is ${detectedQuarter} but link was for ${expectedQuarter}. Link may point to old document. Discarded: ${path.basename(savePath)} (${categoryLabel}).`,
      );
      return false;
    } catch (err) {
      console.warn(`[Merge] Could not parse PDF for quarter check (${path.basename(savePath)}): ${err.message}. Keeping file.`);
      return true;
    }
  }

  for (const link of earningsLinks) {
    if (hasEarnings) break;
    const savePath = await downloadFile(link, folder, "earnings_result");
    if (savePath && (await validatePdfQuarterAndKeep(savePath, quarter, "earnings_result", link))) {
      meta.push({
        filename: path.basename(savePath),
        category: "earnings_result",
        description: link.link_text,
        attachment_text: link.label,
        announcement_date: "",
        sort_date: "",
        seq_id: "",
        source_url: link.href,
        file_size: "",
      });
      hasEarnings = true;
    }
    await sleep(DOWNLOAD_DELAY_MS);
  }
  for (const link of presentationLinks) {
    if (hasPpt) break;
    const savePath = await downloadFile(link, folder, "investor_presentation");
    if (savePath && (await validatePdfQuarterAndKeep(savePath, quarter, "investor_presentation", link))) {
      meta.push({
        filename: path.basename(savePath),
        category: "investor_presentation",
        description: link.link_text,
        attachment_text: link.label,
        announcement_date: "",
        sort_date: "",
        seq_id: "",
        source_url: link.href,
        file_size: "",
      });
      hasPpt = true;
    }
    await sleep(DOWNLOAD_DELAY_MS);
  }
  for (const link of concallLinks) {
    if (hasConcall) break;
    const savePath = await downloadFile(link, folder, "concall_transcript");
    if (savePath && (await validatePdfQuarterAndKeep(savePath, quarter, "concall_transcript", link))) {
      meta.push({
        filename: path.basename(savePath),
        category: "concall_transcript",
        description: link.link_text,
        attachment_text: link.label,
        announcement_date: "",
        sort_date: "",
        seq_id: "",
        source_url: link.href,
        file_size: "",
      });
      hasConcall = true;
    }
    await sleep(DOWNLOAD_DELAY_MS);
  }

  writeJsonSync(metaPath, meta);
}

export async function runMerge({ window = "3q", dataDir, symbols } = {}) {
  const root = dataDir || DATA_DIR;

  if (!fs.existsSync(SCREENER_LINKS_PATH)) {
    throw new Error(
      `Missing ${SCREENER_LINKS_PATH}. Run Screener scraper first.`,
    );
  }

  const symbolFilterSet = Array.isArray(symbols)
    ? new Set(symbols.map((s) => String(s).toUpperCase()))
    : null;

  const links = readJsonSync(SCREENER_LINKS_PATH, []);
  const bySymbolQuarter = groupLinksBySymbolQuarter(links);

  const isQuarterInLookbackWindow = (quarter, win) => {
    const match = quarter.match(/^FY(\d{2})-Q[1-4]$/i);
    if (!match) return false;
    const fyYear = Number(match[1]);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const currentFy = currentMonth >= 4 ? (currentYear + 1) : currentYear;
    const currentFyShort = currentFy % 100;
    
    let minFy = currentFyShort - 2; // Default to 2y
    if (win === "3y") minFy = currentFyShort - 3;
    else if (win === "2y") minFy = currentFyShort - 2;
    else if (win === "1y" || win === "6m") minFy = currentFyShort - 1;
    else if (win === "3q") minFy = currentFyShort - 2;
    
    return fyYear >= minFy;
  };

  // Cleanup step: delete any local directories that are older than our minFy
  if (fs.existsSync(root)) {
    for (const symbolName of fs.readdirSync(root)) {
      if (symbolFilterSet && !symbolFilterSet.has(symbolName.toUpperCase())) {
        continue;
      }
      const symbolDir = path.join(root, symbolName);
      if (!fs.statSync(symbolDir).isDirectory()) continue;
      for (const q of fs.readdirSync(symbolDir)) {
        const qDir = path.join(symbolDir, q);
        if (!fs.statSync(qDir).isDirectory()) continue;
        if (!q.startsWith("FY")) continue;
        if (!isQuarterInLookbackWindow(q, window)) {
          console.log(`[Merge Cleanup] Removing out-of-window historical folder: ${symbolName}/${q}`);
          try {
            fs.rmSync(qDir, { recursive: true, force: true });
          } catch (e) {
            console.error(`[Merge Cleanup] Failed to remove ${qDir}: ${e.message}`);
          }
        }
      }
    }
  }

  // Limit how many quarters we touch per symbol based on the window flag.
  const maxQuarters = WINDOW_TO_QUARTERS[window] ?? WINDOW_TO_QUARTERS["3q"];
  const allowedBySymbol = new Map();
  for (const key of bySymbolQuarter.keys()) {
    const [symbol, quarter] = key.split("|");
    if (symbolFilterSet && !symbolFilterSet.has(symbol.toUpperCase())) {
      continue;
    }
    if (!isQuarterInLookbackWindow(quarter, window)) {
      continue;
    }
    if (!allowedBySymbol.has(symbol)) {
      allowedBySymbol.set(symbol, []);
    }
    allowedBySymbol.get(symbol).push(quarter);
  }
  for (const [symbol, quarters] of allowedBySymbol.entries()) {
    quarters.sort(); // FYxx-Qy sorts lexicographically fine within small ranges
    const keep = new Set(quarters.slice(-maxQuarters));
    allowedBySymbol.set(symbol, keep);
  }

  // Further restrict: only process quarters that already exist from NSE for that symbol,
  // so Node does not create extra historical quarters that Python never had.
  const existingBySymbol = new Map();
  if (fs.existsSync(root)) {
    for (const symbolName of fs.readdirSync(root)) {
      if (symbolFilterSet && !symbolFilterSet.has(symbolName.toUpperCase())) {
        continue;
      }
      const symbolDir = path.join(root, symbolName);
      if (!fs.statSync(symbolDir).isDirectory()) continue;
      const quarters = new Set();
      for (const q of fs.readdirSync(symbolDir)) {
        const qDir = path.join(symbolDir, q);
        if (!fs.statSync(qDir).isDirectory()) continue;
        if (!q.startsWith("FY")) continue;
        quarters.add(q);
      }
      if (quarters.size > 0) {
        existingBySymbol.set(symbolName, quarters);
      }
    }
  }

  console.log("Merge data directory:", root);
  console.log(
    `Merge: ${links.length} Screener links -> ${bySymbolQuarter.size} symbol-quarter groups (max ${maxQuarters} quarter(s) per symbol)`,
  );
  if (bySymbolQuarter.size === 0 && links.length > 0) {
    console.warn(
      "No links had a parseable quarter label (e.g. 'Sep 2025'). Check screener_links_node.json labels.",
    );
  }

  for (const [key, linksForKey] of bySymbolQuarter.entries()) {
    const [symbol, quarter] = key.split("|");
    if (symbolFilterSet && !symbolFilterSet.has(symbol.toUpperCase())) {
      continue;
    }
    const allowedSet = allowedBySymbol.get(symbol);
    if (allowedSet && !allowedSet.has(quarter)) {
      continue;
    }
    // Process quarter if NSE created it or we have Screener links (create folder and backfill earnings/concall/presentation from Screener)
    if (linksForKey.length === 0) continue;
    console.log(`Merging Screener for ${symbol} ${quarter}...`);
    await backfillQuarterForSymbol(symbol, quarter, linksForKey, allowedSet ?? undefined, root);
  }

  console.log("Merge complete (Node).");
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, "/")) {
  runMerge().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

