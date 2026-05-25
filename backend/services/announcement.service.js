import crypto from "crypto";
import { pool } from "../db/pool.js";
import { PDFParse } from "pdf-parse";

const HIGH_KEYWORDS = [
  "order", "contract", "work order", "order win", "loa", "letter of award",
  "tender", "project", "agreement", "strategic",
  "acquisition", "merger", "demerger",
  "expansion", "capacity expansion", "capex", "investment",
  "fund raising", "qip",
  "results", "financial results", "earnings", "guidance", "outlook",
  "margin", "ebitda", "profit warning",
  "delay", "default", "downgrade",
  "resignation", "auditor resignation",
  "fraud", "investigation", "raid", "search", "seizure", "income tax", "it department", "enforcement directorate",
  "news verification", "clarification regarding news", "response to news",
  "insolvency", "nclt",
  "approval", "permission", "peso", "cylinder", "hydrogen", "allotment", "award", "license", "regulatory", "mou", "partnership", "jv", "joint venture", "secures", "secured", "received", "receipt", "patent", "commercial production", "commissioning", "environmental clearance", "ec"
];

const LOW_KEYWORDS = [
  "loss of share certificate", "duplicate certificate",
  "closure of trading window",
  "compliance certificate",
  "regulation 30", "regulation 39",
  "voting results", "scrutinizer report",
  "agm notice", "postal ballot",
  "newspaper publication", "newspaper advertisement", "intimation of closure", "extracts of", "statement of deviation"
];

const MEDIUM_KEYWORDS = [
  "dividend", "interim dividend", "final dividend",
  "board meeting", "committee meeting",
  "credit rating", "reaffirmation",
  "investor meeting", "analyst call", "presentation",
  "allotment of shares", "esop",
  "update", "general update", "intimation"
];

/**
 * Normalizes an announcement title by removing routine prefixes and extra whitespace.
 * Helps in deduplicating news that is slightly differently worded on NSE vs BSE.
 */
export function normalizeTitle(title) {
  if (!title) return "";
  let t = title.toLowerCase();
  
  // Remove common noisy phrases and prefixes
  const noise = [
    "intimation of ", "updates on ", "copy of ", "general updates - ", 
    "outcome of ", "disclosure under ", "corporate announcement - ",
    "regulation 30 - ", "press release - ", "announcement regarding ",
    "intimation under regulation 30", "outcome of board meeting",
    "submission of ", "regarding ", "intimation for ", "information regarding "
  ];
  
  for (const n of noise) {
    if (t.includes(n)) t = t.replace(n, "");
  }

  // Remove common exchange suffixes
  t = t.replace(/ - (nse|bse)$/, "");
  t = t.replace(/\((nse|bse)\)$/, "");

  // Remove excessive whitespace
  t = t.replace(/\s+/g, " ").trim();
  
  return t;
}

/**
 * First-pass keyword filter to ignore routine filings.
 */
export function shouldProcessAnnouncement(title) {
  const t = String(title || "").toLowerCase();

  // We process everything for the live feed, but we can use keywords to set defaults
  return true; 
}

/**
 * Classifies an announcement title and optional raw text into concall categories: "transcript", "audio", "scheduled", or "done".
 * Returns null if the announcement is not a genuine public earnings concall.
 */
export function getConcallType(title, rawText = "") {
  const t = String(title || "").toLowerCase();
  const body = String(rawText || "").toLowerCase();
  const combined = `${t} ${body}`;

  // 1. Check for Transcript (most specific)
  if (t.includes("transcript") || body.includes("transcript")) {
    const isGenericMeet =
      combined.includes("investor meet") ||
      combined.includes("analyst meet") ||
      combined.includes("investor meeting") ||
      combined.includes("analyst meeting") ||
      combined.includes("investor/analyst meet") ||
      combined.includes("analyst / institutional investor meeting") ||
      combined.includes("meeting with") ||
      combined.includes("interaction with") ||
      combined.includes("one on one") ||
      combined.includes("one-on-one") ||
      combined.includes("group meeting") ||
      combined.includes("group meet") ||
      combined.includes("fund meeting") ||
      combined.includes("roadshow");

    const hasEarningsKeywords =
      combined.includes("earnings") ||
      combined.includes("results") ||
      combined.includes("financial results") ||
      /q[1-4]/.test(combined) ||
      /fy\d{2}/.test(combined);

    if (isGenericMeet && !hasEarningsKeywords) {
      return null; // Ignore transcripts of private / generic investor meets
    }
    return "transcript";
  }

  // 2. Check for Audio Recording / Audio Link (indicates concall is completed)
  if (
    combined.includes("audio recording") ||
    combined.includes("audio link") ||
    combined.includes("link of audio") ||
    combined.includes("recording of")
  ) {
    const isGenericMeet =
      combined.includes("investor meet") ||
      combined.includes("analyst meet") ||
      combined.includes("investor meeting") ||
      combined.includes("analyst meeting") ||
      combined.includes("investor/analyst meet") ||
      combined.includes("analyst / institutional investor meeting") ||
      combined.includes("meeting with") ||
      combined.includes("interaction with") ||
      combined.includes("one on one") ||
      combined.includes("one-on-one") ||
      combined.includes("group meeting") ||
      combined.includes("group meet") ||
      combined.includes("fund meeting") ||
      combined.includes("roadshow");

    const hasEarningsKeywords =
      combined.includes("earnings") ||
      combined.includes("results") ||
      combined.includes("financial results") ||
      /q[1-4]/.test(combined) ||
      /fy\d{2}/.test(combined);

    if (isGenericMeet && !hasEarningsKeywords) {
      return null; // Ignore audio of private / generic investor meets
    }
    return "audio";
  }

  // 3. General concall / conference call check
  const hasConcallKeywords =
    combined.includes("concall") ||
    combined.includes("con call") ||
    combined.includes("con. call") ||
    combined.includes("con-call") ||
    combined.includes("conference call") ||
    combined.includes("earnings call");

  if (!hasConcallKeywords) {
    return null; // Not concall related at all
  }

  // 4. Exclude private fund meets, roadshows, or generic broker-led investor conferences
  const isGenericMeet =
    combined.includes("investor meet") ||
    combined.includes("analyst meet") ||
    combined.includes("investor meeting") ||
    combined.includes("analyst meeting") ||
    combined.includes("investor/analyst meet") ||
    combined.includes("analyst / institutional investor meeting") ||
    combined.includes("meeting with") ||
    combined.includes("interaction with") ||
    combined.includes("one on one") ||
    combined.includes("one-on-one") ||
    combined.includes("group meeting") ||
    combined.includes("group meet") ||
    combined.includes("fund meeting") ||
    combined.includes("roadshow") ||
    combined.includes("participating in") ||
    combined.includes("organized by");

  const hasEarningsKeywords =
    combined.includes("earnings") ||
    combined.includes("results") ||
    combined.includes("financial results") ||
    /q[1-4]/.test(combined) ||
    /fy\d{2}/.test(combined);

  if (isGenericMeet && !hasEarningsKeywords) {
    return null; // Ignore broker/private group meets
  }

  // 5. Determine scheduled vs completed
  const isCompleted =
    t.includes("outcome") || 
    t.includes("completed") || 
    t.includes("concluded") ||
    body.includes("outcome") ||
    body.includes("completed") ||
    body.includes("concluded");

  if (isCompleted) {
    return "done";
  }

  // Otherwise, default to scheduled (since simple "Earnings Call" is upcoming, not completed)
  return "scheduled";
}

/**
 * Detects if an announcement title and text is related to a concall, transcript, or audio recording.
 */
export function isConcallOrTranscript(title, rawText = "") {
  return !!getConcallType(title, rawText);
}


/**
 * Resets announcements stuck in 'pending' for too long.
 */
export async function resetStuckPending(timeoutMs = 15 * 60 * 1000) {
  const timeoutSec = Math.floor(timeoutMs / 1000);
  await pool.query(
    `UPDATE corporate_announcements 
     SET status = 'failed' 
     WHERE status = 'pending' 
     AND processed_at < NOW() - interval '${timeoutSec} seconds'`
  );
}

/**
 * Fetches recent announcements from BSE API for a specific scrip code.
 * @param {string} scripCode 
 */
export async function fetchBseAnnouncements(scripCode) {
  if (!scripCode) return [];

  const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w`;
  const params = new URLSearchParams({
    strCat: "Company Update",
    strScrip: scripCode
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://www.bseindia.com",
      "Referer": "https://www.bseindia.com/",
      "Connection": "keep-alive"
    },
  });

  if (!response.ok) {
    console.error(`BSE API failed for ${scripCode}:`, response.status);
    return [];
  }

  const data = await response.json();
  // BSE API usually returns { Table: [...] }
  return data.Table || [];
}

/**
 * Fetches NSE session cookies (best-effort — cloud IPs may get 403 on homepage).
 * Returns empty string on failure so the API call is still attempted without cookies.
 */
let nseCookies = "";
async function getNseCookies() {
  if (nseCookies) return nseCookies;
  try {
    const res = await fetch("https://www.nseindia.com/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (res.ok || res.status === 200) {
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        nseCookies = setCookie.split(";")[0];
      }
    } else {
      console.warn(`[NSE] Homepage returned ${res.status} — proceeding without cookies (cloud IP likely).`);
    }
  } catch (err) {
    console.warn(`[NSE] Cookie fetch failed: ${err.message} — proceeding without cookies.`);
  }
  return nseCookies;
}

/**
 * Fetches recent announcements from NSE API for a specific symbol.
 * @param {string} symbol 
 * @param {number} lookbackDaysNum Number of days to look back (default 30)
 */
export async function fetchNseAnnouncements(symbol, lookbackDaysNum = 30) {
  if (!symbol) return [];
  const cookies = await getNseCookies();
  
  const url = `https://www.nseindia.com/api/corporate-announcements`;
  const params = new URLSearchParams({
    index: "equities",
    symbol: symbol
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Referer": `https://www.nseindia.com/get-quotes/equity?symbol=${symbol}`,
      "Cookie": cookies
    },
  });

  if (!response.ok) {
    console.error(`NSE API failed for ${symbol}:`, response.status);
    return [];
  }

  const data = await response.json();
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDaysNum);

  // NSE returns an array directly. Filter for last 30 days to avoid history bloat.
  return (data || [])
    .filter(ann => {
      const annDate = new Date(ann.sort_date || ann.an_dt || ann.dt);
      return annDate >= lookbackDate;
    })
    .map(ann => ({
      NEWS_ID: ann.seq_id || ann.desc, 
      NEWSSUB: ann.desc,
      DT_TM: ann.sort_date || ann.an_dt,
      SOURCE: "NSE",
      attachment: ann.attchmntFile 
        ? (ann.attchmntFile.startsWith("http") ? ann.attchmntFile : `https://nsearchives.nseindia.com/corporate/${ann.attchmntFile}`)
        : null,
      attachment_text: ann.attchmntText
    }));
}

/**
 * Generates a unique hash for an announcement to prevent duplicates 
 * when source_id (NEWS_ID) is missing or unreliable.
 */
export function generateAnnouncementHash(ticker, title, timestamp) {
  // Use normalized title and DATE ONLY for the hash to handle small time drifts between exchanges
  const norm = normalizeTitle(title);
  const date = timestamp ? new Date(timestamp).toISOString().split('T')[0] : 'nodate';
  const data = `${ticker}:${norm}:${date}`;
  return crypto.createHash("md5").update(data).digest("hex");
}

/**
 * Checks if an announcement has already been processed in the DB.
 */
export async function isAnnouncementProcessed(ticker, sourceId, titleHash) {
  const result = await pool.query(
    `SELECT id FROM corporate_announcements 
     WHERE ticker = $1 
     AND (source_id = $2 OR title_hash = $3)`,
    [ticker, sourceId, titleHash]
  );
  return result.rows.length > 0;
}

/**
 * Saves a processed announcement to the database.
 */
export async function saveAnnouncement({
  stock_id, ticker, source_id, title_hash, title, raw_text, priority, impact, confidence, summary, status, sent_to_telegram, is_earnings_release, attachment_url, filing_date
}) {
  await pool.query(
    `INSERT INTO corporate_announcements 
      (stock_id, ticker, source_id, title_hash, title, raw_text, priority, impact, confidence, summary, status, sent_to_telegram, is_earnings_release, processed_at, attachment_url, filing_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14, $15)
     ON CONFLICT (ticker, source_id) DO NOTHING`,
    [stock_id, ticker, source_id, title_hash, title, raw_text, priority, impact, confidence, summary, status, sent_to_telegram, is_earnings_release, attachment_url, filing_date]
  );
}

/**
 * Validates date format YYYY-MM-DD.
 */
export function isValidDate(dateStr) {
  if (!dateStr) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

/**
 * Updates the result date for a specific stock with validation guards.
 */
export async function updateStockResultDate(stockId, resultDate, confidence) {
  if (!isValidDate(resultDate) || confidence !== "HIGH") {
    console.warn(`[DATE] Skipped update for stock ${stockId}: Invalid date or low confidence.`);
    return;
  }

  const existingRes = await pool.query(
    "SELECT next_results_date FROM stocks WHERE id = $1",
    [stockId]
  );
  const existing = existingRes.rows[0]?.next_results_date;
  
  // Format existing date to YYYY-MM-DD for comparison if it's a Date object
  const existingStr = existing ? new Date(existing).toISOString().split('T')[0] : null;

  if (resultDate !== existingStr) {
    await pool.query(
      "UPDATE stocks SET next_results_date = $1 WHERE id = $2",
      [resultDate, stockId]
    );
    console.log(`[DATE] Updated result date for ${stockId}: ${existingStr || 'none'} -> ${resultDate}`);
  }
}

/**
 * Checks if a heartbeat is needed for today.
 */
export async function isHeartbeatNeeded() {
  const res = await pool.query("SELECT value FROM system_settings WHERE key = 'last_heartbeat_at'");
  const lastHeartbeat = res.rows[0]?.value;
  const today = new Date().toISOString().split('T')[0];
  return lastHeartbeat !== today;
}

/**
 * Marks today's heartbeat as sent.
 */
export async function markHeartbeatSent() {
  const today = new Date().toISOString().split('T')[0];
  await pool.query(
    "UPDATE system_settings SET value = $1, updated_at = NOW() WHERE key = 'last_heartbeat_at'",
    [JSON.stringify(today)]
  );
}


/**
 * Downloads a PDF from a URL and extracts its text content.
 * Limited to first ~10,000 characters to prevent AI context overflow.
 * 
 * @param {string} url 
 * @returns {Promise<string>}
 */
export async function extractTextFromPdfUrl(url) {
  if (!url) return "";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for PDF download

  try {
    console.log(`[PDF] Downloading... ${url}`);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status}`);
    }

    console.log(`[PDF] Parsing...`);
    const arrayBuffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const parser = new PDFParse(uint8);
    const data = await parser.getText();
    
    // Clean up text: remove extra whitespace and truncate
    const cleanText = data.text
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 60000);

    console.log(`[PDF] Extracted ${cleanText.length} characters.`);
    return cleanText;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.warn(`[PDF TIMEOUT] Failed to download PDF within 30s: ${url}`);
    } else {
      console.error(`[PDF ERROR] Failed to extract text from ${url}:`, err.message);
    }
    return "";
  }
}

/**
 * High-level orchestration to sync announcements for a ticker from both NSE and BSE.
 */
export async function syncAnnouncementsForTicker(stockId, ticker, lookbackDays = 30) {
  console.log(`[SYNC] Fetching announcements for ${ticker} (lookback: ${lookbackDays} days)...`);
  
  const results = { nse: 0, bse: 0, saved: 0, skipped: 0 };

  // 1. Fetch NSE
  try {
    const nseAnnouncements = await fetchNseAnnouncements(ticker, lookbackDays);
    results.nse = nseAnnouncements.length;
    for (const ann of nseAnnouncements) {
      const title = ann.NEWSSUB || "";
      const sourceId = String(ann.NEWS_ID || "");
      const timestamp = ann.DT_TM;
      const titleHash = generateAnnouncementHash(ticker, title, timestamp);

      if (await isAnnouncementProcessed(ticker, sourceId, titleHash)) {
        results.skipped++;
        continue;
      }

      if (!shouldProcessAnnouncement(title)) {
        results.skipped++;
        continue;
      }

      // Basic saving logic
      await saveAnnouncement({
        stock_id: stockId,
        ticker: ticker,
        source_id: sourceId,
        title_hash: titleHash,
        title: title,
        raw_text: ann.attachment_text || "",
        priority: "MEDIUM",
        impact: "NEUTRAL",
        confidence: "LOW",
        summary: "NSE Filing",
        status: "processed",
        sent_to_telegram: true,
        is_earnings_release: title.toLowerCase().includes("results"),
        attachment_url: ann.attachment,
        filing_date: timestamp
      });
      results.saved++;
    }
  } catch (err) {
    console.error(`[NSE SYNC ERROR] ${ticker}:`, err.message);
  }

  // 2. Fetch BSE (BSE API doesn't support lookback easily, we just process what it gives)
  // But we skip if ticker doesn't have a scrip code
  const stockRes = await pool.query("SELECT bse_scrip_code FROM stocks WHERE id = $1", [stockId]);
  const scripCode = stockRes.rows[0]?.bse_scrip_code;
  
  if (scripCode) {
    try {
      const bseAnnouncements = await fetchBseAnnouncements(scripCode);
      results.bse = bseAnnouncements.length;
      for (const ann of bseAnnouncements) {
        const title = ann.NEWSSUB || "";
        const sourceId = String(ann.NEWS_ID || "");
        const timestamp = ann.DT_TM;
        const titleHash = generateAnnouncementHash(ticker, title, timestamp);

        if (await isAnnouncementProcessed(ticker, sourceId, titleHash)) {
          results.skipped++;
          continue;
        }

        if (!shouldProcessAnnouncement(title)) {
          results.skipped++;
          continue;
        }

        await saveAnnouncement({
          stock_id: stockId,
          ticker: ticker,
          source_id: sourceId,
          title_hash: titleHash,
          title: title,
          raw_text: "", // BSE doesn't give text easily
          priority: "MEDIUM",
          impact: "NEUTRAL",
          confidence: "LOW",
          summary: "BSE Filing",
          status: "processed",
          sent_to_telegram: true,
          is_earnings_release: title.toLowerCase().includes("results"),
          attachment_url: ann.ATTACHMENTNAME 
            ? (ann.ATTACHMENTNAME.startsWith("http") ? ann.ATTACHMENTNAME : `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${ann.ATTACHMENTNAME}`)
            : null,
          filing_date: timestamp
        });
        results.saved++;
      }
    } catch (err) {
      console.error(`[BSE SYNC ERROR] ${ticker}:`, err.message);
    }
  }

  return results;
}
