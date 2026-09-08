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
    "analysts/institutional investor meet/con. call updates",
    "analysts/institutional investor meet",
    "intimation of schedule of analyst / institutional investor meeting",
    "intimation of schedule of analyst / investor meeting",
    "intimation of audio recording", "submission of audio recording",
    "intimation of transcript", "submission of transcript",
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
  
  return t || title.toLowerCase().trim();
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

  // 0. AGM / EGM / Postal Ballot guard — must come first.
  // These filings are NEVER earnings concalls. If the title/text contains AGM
  // keywords without an explicit concall keyword, return null immediately.
  const AGM_PATTERNS = [
    "agm", "egm", "annual general meeting", "extraordinary general meeting",
    "shareholders meeting", "general meeting", "postal ballot",
    "board meeting notice"
  ];
  const hasExplicitConcall =
    combined.includes("concall") ||
    combined.includes("transcript") ||
    combined.includes("conference call") ||
    combined.includes("earnings call");
  const isAgmOrPostalBallot = AGM_PATTERNS.some(k => combined.includes(k));
  if (isAgmOrPostalBallot && !hasExplicitConcall) {
    return null;
  }

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

  // 3b. Also catch "investor/analyst call on <date>" style intimations.
  // BSE often files these as "Intimation of Investor/Analyst Call on 29th May"
  // which has no "concall" keyword but is clearly a scheduled earnings call.
  const hasDateSignal =
    /\d+(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(combined) ||
    /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(combined) ||
    combined.includes("scheduled on") ||
    combined.includes("to be held");

  const hasEarningsSignal =
    combined.includes("earnings") ||
    combined.includes("results") ||
    combined.includes("financial results") ||
    /q[1-4]/.test(combined) ||
    /fy\d{2}/.test(combined);

  const hasCallOnDate =
    // Use word-boundary regex to avoid matching "called", "recall", "locally" etc.
    /\bcall\b/i.test(combined) &&
    (
      // Path A: investor/analyst call + specific date + earnings context
      // Requires BOTH a date AND an earnings signal to avoid triggering on private fund meets.
      // e.g. "Investor/Analyst Call on 29th May for Q4 FY25 Results" → YES
      // e.g. "Investor/Analyst Call on 29th May" (no results mention) → NO
      ((combined.includes("investor") || combined.includes("analyst")) &&
       hasDateSignal && hasEarningsSignal) ||
      // Path B: bare "intimation of call" with an earnings keyword
      // e.g. "Intimation of call for Q4 FY25" → YES
      (/\bintimation of call\b/i.test(combined) && hasEarningsSignal)
    );

  if (!hasConcallKeywords && !hasCallOnDate) {
    return null; // Not concall related at all
  }

  // 4. Exclude private fund meets, roadshows, and one-on-one meetings.
  // Applied to BOTH paths — an earnings concall will never have these meeting phrases.
  const isPrivateMeet =
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

  // Private meet without earnings context → always skip.
  // Private meet WITH earnings context (e.g. earnings roadshow Q4) → borderline, still skip
  // because the actual concall will be filed separately.
  if (isPrivateMeet) {
    return null;
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
/**
 * BSE categories that carry high-impact filings.
 * Fetched in parallel so we never miss an award, MOU, acquisition, result,
 * or concall just because it was filed under a different category.
 */
const BSE_CATEGORIES = [
  "Company Update",          // General announcements, orders, MOUs, awards
  "Result",                  // Financial results
  "AGM/EGM",                // Board meetings, AGMs
  "Corp. Action",            // Dividends, splits, buybacks
  "Insider Trading / SAST",   // Bulk deals, promoter activity
  "Analyst / Investor Meet", // Concall intimations, investor meets, presentations, transcripts
  "Board Meeting",           // Board meeting notices & outcomes
];

export async function fetchBseAnnouncements(scripCode) {
  if (!scripCode) return [];

  const baseUrl = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.bseindia.com",
    "Referer": "https://www.bseindia.com/",
    "Connection": "keep-alive"
  };

  // Fetch all relevant BSE categories in parallel and merge results.
  // Deduplicate by NEWS_ID so the same filing appearing in multiple categories isn't doubled.
  const results = await Promise.allSettled(
    BSE_CATEGORIES.map(async (cat) => {
      const params = new URLSearchParams({ strCat: cat, strScrip: scripCode });
      const res = await fetch(`${baseUrl}?${params.toString()}`, { headers });
      if (!res.ok) {
        console.warn(`[BSE] Category '${cat}' fetch failed for ${scripCode}: ${res.status}`);
        return [];
      }
      const data = await res.json();
      return data.Table || [];
    })
  );

  const seen = new Set();
  const merged = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const ann of result.value) {
        const key = String(ann.NEWS_ID || ann.NEWSSUB || "");
        if (key && !seen.has(key)) {
          seen.add(key);
          merged.push(ann);
        }
      }
    }
  }

  return merged;
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

  const toDateObj = new Date();
  const fromDateObj = new Date();
  fromDateObj.setDate(fromDateObj.getDate() - lookbackDaysNum);

  const formatDate = (d) => {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const fromDateStr = formatDate(fromDateObj);
  const toDateStr = formatDate(toDateObj);
  
  // New NSE NextApi endpoint
  const url = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getCorporateAnnouncement&symbol=${symbol}&marketApiType=equities&subject=&fromDate=${fromDateStr}&toDate=${toDateStr}`;

  try {
    let response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": `https://www.nseindia.com/get-quotes/equity?symbol=${symbol}`,
        "Cookie": cookies
      },
    });

    let data = [];
    if (response.ok) {
      data = await response.json();
    }

    // Symbol alias check (e.g. HBLPOWER -> HBLENGINE)
    if ((!Array.isArray(data) || data.length === 0) && symbol === "HBLPOWER") {
      const aliasUrl = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getCorporateAnnouncement&symbol=HBLENGINE&marketApiType=equities&subject=&fromDate=${fromDateStr}&toDate=${toDateStr}`;
      const aliasRes = await fetch(aliasUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*",
          "Referer": `https://www.nseindia.com/get-quotes/equity?symbol=HBLENGINE`,
          "Cookie": cookies
        },
      });
      if (aliasRes.ok) {
        data = await aliasRes.json();
      }
    }

    // Fallback to legacy endpoint if NextApi returned 0 results
    if (!Array.isArray(data) || data.length === 0) {
      const legacyUrl = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${symbol}`;
      const legacyRes = await fetch(legacyUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*",
          "Referer": `https://www.nseindia.com/get-quotes/equity?symbol=${symbol}`,
          "Cookie": cookies
        },
      });
      if (legacyRes.ok) {
        data = await legacyRes.json();
      }
    }

    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - lookbackDaysNum);

    return (Array.isArray(data) ? data : [])
      .filter(ann => {
        const annDate = new Date(ann.sort_date || ann.an_dt || ann.dt);
        return annDate >= lookbackDate;
      })
      .map(ann => {
        const attachFilename = ann.attchmntFile ? ann.attchmntFile.split('/').pop()?.split('?')[0] : null;
        const uniqueNewsId = ann.seq_id || attachFilename || `${ann.desc}_${ann.sort_date || ann.an_dt || ann.dt}`;
        return {
          NEWS_ID: uniqueNewsId,
          NEWSSUB: ann.desc,
          DT_TM: ann.sort_date || ann.an_dt || ann.dt,
          SOURCE: "NSE",
          attachment: ann.attchmntFile 
            ? (ann.attchmntFile.startsWith("http") ? ann.attchmntFile : `https://nsearchives.nseindia.com/corporate/${ann.attchmntFile}`)
            : null,
          attachment_text: ann.attchmntText
        };
      });
  } catch (err) {
    console.error(`[NSE API ERROR] Failed for ${symbol}:`, err.message);
    return [];
  }
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
 * Checks if an announcement has already been processed or ingested in the DB.
 */
export async function isAnnouncementProcessed(ticker, sourceId, titleHash) {
  const result = await pool.query(
    `SELECT id FROM corporate_announcements 
     WHERE ticker = $1 
     AND (source_id = $2 OR title_hash = $3)
     AND status != 'failed'`,
    [ticker, sourceId, titleHash]
  );
  return result.rows.length > 0;
}

/**
 * Checks if a Telegram alert for a specific event identity has ALREADY been sent
 * for this ticker within the last 6 to 24 hours.
 * Prevents duplicate alerts when NSE and BSE publish slightly different titles or multiple
 * circulars for the exact same underlying event, while allowing distinct events to pass.
 */
export async function isEventAlertRecentlySent({ ticker, title, concall_type, is_earnings_release, attachment_url, filing_category }) {
  if (!ticker) return false;

  // 1. Check attachment URL / filename matching first if present (Exact document deduplication)
  if (attachment_url) {
    const filename = attachment_url.split('/').pop()?.split('?')[0];
    if (filename && filename.length > 8) {
      const res = await pool.query(
        `SELECT id FROM corporate_announcements 
         WHERE ticker = $1 
           AND sent_to_telegram = true 
           AND attachment_url ILIKE $2 
           AND processed_at > NOW() - interval '24 hours'`,
        [ticker, `%${filename}%`]
      );
      if (res.rows.length > 0) return true;
    }
  }

  // 2. Earnings Release deduplication check (1 release alert per ticker per 24 hours)
  if (is_earnings_release) {
    const res = await pool.query(
      `SELECT id FROM corporate_announcements 
       WHERE ticker = $1 
         AND sent_to_telegram = true 
         AND is_earnings_release = true 
         AND processed_at > NOW() - interval '24 hours'`,
      [ticker]
    );
    if (res.rows.length > 0) return true;
  }

  // 3. Concall Stage deduplication check (1 alert per concall_type stage per ticker per 24 hours)
  if (concall_type) {
    let typeKeyword = concall_type;
    if (concall_type === 'audio') typeKeyword = 'audio';
    else if (concall_type === 'transcript') typeKeyword = 'transcript';

    const res = await pool.query(
      `SELECT id FROM corporate_announcements 
       WHERE ticker = $1 
         AND sent_to_telegram = true 
         AND (
           title ILIKE $2 
           OR summary ILIKE $2 
           OR raw_text ILIKE $2
         ) 
         AND processed_at > NOW() - interval '24 hours'`,
      [ticker, `%${typeKeyword}%`]
    );
    if (res.rows.length > 0) return true;
  }

  // 4. Same-Day Event Identity Deduplication (Same ticker + same category + matching subject tokens within 6 hours)
  if (filing_category && filing_category !== "GENERAL" && title) {
    // Extract key identifying words (ignore generic stock/corporate stop words)
    const stopWords = new Set(["outcome", "board", "meeting", "intimation", "disclosure", "update", "updates", "general", "under", "regulation", "sebi", "lodr", "ltd", "limited", "the", "and", "for", "with"]);
    const tokens = title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
    
    if (tokens.length > 0) {
      const { rows } = await pool.query(
        `SELECT id, title, raw_text FROM corporate_announcements 
         WHERE ticker = $1 
           AND sent_to_telegram = true 
           AND filing_category = $2 
           AND processed_at > NOW() - interval '6 hours'`,
        [ticker, filing_category]
      );
      
      for (const prev of rows) {
        const prevText = `${prev.title || ""} ${prev.raw_text || ""}`.toLowerCase();
        // If at least one specific identifying token (e.g. target company name, "merger", "resignation") matches
        const hasTokenOverlap = tokens.some(t => prevText.includes(t));
        if (hasTokenOverlap) return true;
      }
    }
  }

  return false;
}


/**
 * Saves a processed announcement to the database.
 * If the row already exists as 'pending' (capped from a previous run),
 * it is promoted to 'sent' or 'ignored' so it isn't evaluated again.
 */
export async function saveAnnouncement({
  stock_id, ticker, source_id, title_hash, title, raw_text, priority, impact, confidence, summary, status, sent_to_telegram, is_earnings_release, attachment_url, filing_date,
  filing_category = "GENERAL", event_analysis = null, deep_dive_status = "not_required", key_data = null, deep_dive_indicator = null
}) {
  await pool.query(
    `INSERT INTO corporate_announcements 
      (stock_id, ticker, source_id, title_hash, title, raw_text, priority, impact, confidence, summary, status, sent_to_telegram, is_earnings_release, processed_at, attachment_url, filing_date, filing_category, event_analysis, deep_dive_status, key_data, deep_dive_indicator)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14, $15, $16, $17, $18, $19, $20)
     ON CONFLICT (ticker, source_id) DO UPDATE
       SET status = CASE
             -- Promote if currently pending (capped mid-run) OR failed (NIM outage, now recovered)
             WHEN corporate_announcements.status IN ('pending', 'failed') THEN EXCLUDED.status
             ELSE corporate_announcements.status
           END,
           sent_to_telegram = CASE
             WHEN corporate_announcements.status IN ('pending', 'failed') THEN EXCLUDED.sent_to_telegram
             ELSE corporate_announcements.sent_to_telegram
           END,
           summary = CASE
             WHEN corporate_announcements.status IN ('pending', 'failed') OR corporate_announcements.summary LIKE 'AI classification failed%' THEN EXCLUDED.summary
             ELSE corporate_announcements.summary
           END,
           priority = CASE
             WHEN corporate_announcements.status IN ('pending', 'failed') OR corporate_announcements.summary LIKE 'AI classification failed%' THEN EXCLUDED.priority
             ELSE corporate_announcements.priority
           END,
           impact = CASE
             WHEN corporate_announcements.status IN ('pending', 'failed') OR corporate_announcements.summary LIKE 'AI classification failed%' THEN EXCLUDED.impact
             ELSE corporate_announcements.impact
           END,
           confidence = CASE
             WHEN corporate_announcements.status IN ('pending', 'failed') OR corporate_announcements.summary LIKE 'AI classification failed%' THEN EXCLUDED.confidence
             ELSE corporate_announcements.confidence
           END,
           key_data = CASE
             WHEN corporate_announcements.status IN ('pending', 'failed') OR corporate_announcements.summary LIKE 'AI classification failed%' THEN EXCLUDED.key_data
             ELSE corporate_announcements.key_data
           END,
           deep_dive_indicator = CASE
             WHEN corporate_announcements.status IN ('pending', 'failed') OR corporate_announcements.summary LIKE 'AI classification failed%' THEN EXCLUDED.deep_dive_indicator
             ELSE corporate_announcements.deep_dive_indicator
           END,
           raw_text = CASE
             WHEN corporate_announcements.status IN ('pending', 'failed') OR LENGTH(COALESCE(corporate_announcements.raw_text, '')) <= LENGTH(COALESCE(corporate_announcements.title, '')) THEN EXCLUDED.raw_text
             ELSE corporate_announcements.raw_text
           END,
           filing_category = EXCLUDED.filing_category,
           event_analysis = COALESCE(EXCLUDED.event_analysis, corporate_announcements.event_analysis),
           deep_dive_status = CASE
             WHEN corporate_announcements.deep_dive_status = 'completed' AND EXCLUDED.deep_dive_status IN ('pending_stage2', 'pending_audio') THEN EXCLUDED.deep_dive_status
             WHEN corporate_announcements.deep_dive_status IN ('not_required', 'failed') THEN EXCLUDED.deep_dive_status
             ELSE corporate_announcements.deep_dive_status
           END,
           processed_at = CASE
             WHEN corporate_announcements.status IN ('pending', 'failed') THEN NOW()
             ELSE corporate_announcements.processed_at
           END
    `,
    [stock_id, ticker, source_id, title_hash, title, raw_text, priority, impact, confidence, summary, status, sent_to_telegram, is_earnings_release, attachment_url, filing_date, filing_category, event_analysis ? JSON.stringify(event_analysis) : null, deep_dive_status, key_data, deep_dive_indicator]
  ).catch(err => {
    // Silently handle title_hash unique constraint violations (cross-exchange dedup race).
    // These are not real errors — the announcement was already processed from the other exchange.
    if (err.code === '23505') {
      console.log(`[DB] Duplicate title_hash skipped for ${ticker}: ${title.substring(0, 60)}`);
      return;
    }
    throw err;
  });
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
  let downloadUrl = url;
  if (downloadUrl.includes("drive.google.com/file/d/")) {
    const match = downloadUrl.match(/\/file\/d\/([^\/]+)/);
    if (match && match[1]) {
      downloadUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for PDF download

  try {
    console.log(`[PDF] Downloading... ${downloadUrl}`);
    const response = await fetch(downloadUrl, {
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

    // Suppress noisy pdf.js standardFontDataUrl / TT bytecode / getHexString warnings from stdout
    const origWarn = console.warn;
    console.warn = (...args) => {
      const msg = args.join(" ");
      if (
        msg.includes("standardFontDataUrl") ||
        msg.includes("TT: undefined function") ||
        msg.includes("getHexString") ||
        msg.includes("Indexing all PDF objects")
      ) return;
      origWarn(...args);
    };

    let data;
    try {
      const parser = new PDFParse(uint8);
      data = await parser.getText();
    } finally {
      console.warn = origWarn;
    }
    
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
