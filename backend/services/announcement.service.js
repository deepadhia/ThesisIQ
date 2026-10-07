import crypto from "crypto";
import { pool } from "../db/pool.js";
import { PDFParse } from "pdf-parse";
import { sendTelegramMessage } from "./telegram.service.js";

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
  // Procedural notices/ballots are not concalls, BUT AGM audio recordings,
  // webcasts, and transcripts MUST be captured for the deep-dive audio/transcript engine.
  const AGM_PATTERNS = [
    "agm", "egm", "annual general meeting", "extraordinary general meeting",
    "shareholders meeting", "general meeting", "postal ballot",
    "board meeting notice"
  ];
  const hasAudioOrTranscript =
    combined.includes("concall") ||
    combined.includes("transcript") ||
    combined.includes("conference call") ||
    combined.includes("earnings call") ||
    combined.includes("audio recording") ||
    combined.includes("audio link") ||
    combined.includes("link of audio") ||
    combined.includes("recording of") ||
    combined.includes("webcast");

  const isAgmOrPostalBallot = AGM_PATTERNS.some(k => combined.includes(k));
  if (isAgmOrPostalBallot && !hasAudioOrTranscript) {
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

    const hasEarningsOrAgmKeywords =
      combined.includes("earnings") ||
      combined.includes("results") ||
      combined.includes("financial results") ||
      combined.includes("agm") ||
      combined.includes("annual general meeting") ||
      /q[1-4]/.test(combined) ||
      /fy\d{2}/.test(combined);

    if (isGenericMeet && !hasEarningsOrAgmKeywords) {
      return null; // Ignore transcripts of private / generic investor meets without earnings/AGM context
    }
    return "transcript";
  }

  // 2. Check for Audio Recording / Audio Link (indicates concall or AGM is completed)
  if (
    combined.includes("audio recording") ||
    combined.includes("audio link") ||
    combined.includes("link of audio") ||
    combined.includes("recording of") ||
    combined.includes("webcast")
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

    const hasEarningsOrAgmKeywords =
      combined.includes("earnings") ||
      combined.includes("results") ||
      combined.includes("financial results") ||
      combined.includes("agm") ||
      combined.includes("annual general meeting") ||
      /q[1-4]/.test(combined) ||
      /fy\d{2}/.test(combined);

    if (isGenericMeet && !hasEarningsOrAgmKeywords) {
      return null; // Ignore audio of private / generic investor meets without earnings/AGM context
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
  const cleanSourceId = sourceId && String(sourceId).trim().length > 0 ? String(sourceId).trim() : null;
  const result = await pool.query(
    `SELECT id FROM corporate_announcements 
     WHERE ticker = $1 
     AND (($2::text IS NOT NULL AND source_id = $2) OR title_hash = $3)
     AND status != 'failed'`,
    [ticker, cleanSourceId, titleHash]
  );
  return result.rows.length > 0;
}

/**
 * Checks if a Telegram alert for a specific event identity has ALREADY been sent
 * for this ticker within the last 6 to 24 hours.
 * Prevents duplicate alerts when NSE and BSE publish slightly different titles or multiple
 * circulars for the exact same underlying event, while allowing distinct events to pass.
 */
export async function isEventAlertRecentlySent({ ticker, title, summary, concall_type, is_earnings_release, attachment_url, filing_category }) {
  if (!ticker) return false;

  // 1. Check attachment URL / filename matching first if present (Exact & Base Document Deduplication)
  if (attachment_url) {
    const rawFilename = attachment_url.split('/').pop()?.split('?')[0];
    if (rawFilename && rawFilename.length > 8) {
      // 1a. Exact filename match
      const res = await pool.query(
        `SELECT id FROM corporate_announcements 
         WHERE ticker = $1 
           AND sent_to_telegram = true 
           AND attachment_url ILIKE $2 
           AND processed_at > NOW() - interval '24 hours'`,
        [ticker, `%${rawFilename}%`]
      );
      if (res.rows.length > 0) return true;

      // 1b. Base document match (stripping NSE timestamp prefix e.g. TIMETECHNO_29092026204150_Outcome29092026_signed.pdf -> Outcome29092026_signed.pdf)
      const baseFilename = rawFilename.replace(/^[A-Z0-9]+_\d{14}_/i, "").replace(/^\d{14}_/, "");
      if (baseFilename && baseFilename.length >= 10 && baseFilename !== rawFilename) {
        const baseRes = await pool.query(
          `SELECT id FROM corporate_announcements 
           WHERE ticker = $1 
             AND sent_to_telegram = true 
             AND attachment_url ILIKE $2 
             AND processed_at > NOW() - interval '24 hours'`,
          [ticker, `%${baseFilename}%`]
        );
        if (baseRes.rows.length > 0) return true;
      }
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

  // 4. Major Board Action / Restructuring Same-Day Event Deduplication (Rolling 3-hour window)
  // Prevents duplicate alerts when a board meeting outcome is filed, followed by an annexure/scheme filing minutes later.
  const SINGULAR_CATEGORIES = new Set([
    "RESTRUCTURING",
    "CAPITAL_RAISE",
    "CAPITAL_RETURN",
    "ACQUISITION",
    "CREDIT_EVENT"
  ]);

  if (filing_category && SINGULAR_CATEGORIES.has(filing_category)) {
    const { rows: recentCatRows } = await pool.query(
      `SELECT id, title, summary, raw_text, filing_category FROM corporate_announcements 
       WHERE ticker = $1 
         AND sent_to_telegram = true 
         AND filing_category = $2
         AND processed_at > NOW() - interval '3 hours'`,
      [ticker, filing_category]
    );

    if (recentCatRows.length > 0) {
      for (const prev of recentCatRows) {
        // If either title is generic corporate outcome/announcement wording
        const genericTitles = new Set(["outcome", "board", "meeting", "scheme", "arrangement", "disclosure", "regulation", "general", "update", "updates", "intimation"]);
        const titleWords = (title || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);
        const prevTitleWords = (prev.title || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);
        const isCurrentGeneric = titleWords.length === 0 || titleWords.every(w => genericTitles.has(w));
        const isPrevGeneric = prevTitleWords.length === 0 || prevTitleWords.every(w => genericTitles.has(w));

        if (isCurrentGeneric || isPrevGeneric) {
          return true;
        }

        // Check summary keyword/entity overlap (e.g., subsidiary or transaction name)
        if (summary && prev.summary) {
          const currentSumTokens = summary.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 4);
          const prevSumLower = prev.summary.toLowerCase();
          const overlap = currentSumTokens.filter(t => prevSumLower.includes(t));
          if (overlap.length >= 2) {
            return true;
          }
        }
      }
    }
  }

  // 5. Same-Day Event Identity Deduplication (Same ticker + matching subject tokens within 12 hours)
  if (title) {
    // Extract key identifying words (ignore generic stock/corporate stop words & press wrappers)
    const stopWords = new Set([
      "outcome", "board", "meeting", "intimation", "disclosure", "update", "updates", 
      "general", "under", "regulation", "sebi", "lodr", "ltd", "limited", "the", "and", 
      "for", "with", "share", "shares", "company", "announcement", "press", "release", 
      "media", "news", "dated", "regarding", "about", "copy", "submission", "schedule",
      "notice", "circular", "investor", "investors"
    ]);
    const tokens = title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
    
    if (tokens.length > 0) {
      const { rows } = await pool.query(
        `SELECT id, title, summary, raw_text, filing_category FROM corporate_announcements 
         WHERE ticker = $1 
           AND sent_to_telegram = true 
           AND processed_at > NOW() - interval '12 hours'`,
        [ticker]
      );
      
      for (const prev of rows) {
        const prevText = `${prev.title || ""} ${prev.summary || ""} ${prev.raw_text || ""}`.toLowerCase();
        // If at least 2 distinct tokens match, or 1 token matches when only 1 specific token exists,
        // or at least 1 token matches AND the filing category matches (e.g. "scheme" + RESTRUCTURING)
        const matchingTokens = tokens.filter(t => prevText.includes(t));
        if (
          matchingTokens.length >= 2 ||
          (matchingTokens.length === 1 && tokens.length === 1) ||
          (matchingTokens.length >= 1 && prev.filing_category === filing_category)
        ) {
          return true;
        }
      }
    }
  }

  // 6. Cross-Category Summary Entity & Generic Wrapper Overlap (Rolling 12-hour window)
  // Catches duplicate marketing disclosures (e.g. "Press Release" or "General Updates")
  // that accompany or follow statutory disclosures (e.g. strategic partnership, subsidiary incorporation, order win)
  if (summary) {
    const { rows: sumRows } = await pool.query(
      `SELECT id, title, summary, raw_text, filing_category FROM corporate_announcements 
       WHERE ticker = $1 
         AND sent_to_telegram = true 
         AND processed_at > NOW() - interval '12 hours'`,
      [ticker]
    );

    const SUMMARY_STOP_WORDS = new Set([
      "company", "companies", "limited", "board", "directors", "director", "meeting", 
      "intimation", "disclosure", "disclosures", "regulation", "regulations", "sebi", 
      "lodr", "approved", "approval", "approvals", "dated", "hereby", "informs", 
      "held", "disclosed", "pursuant", "regarding", "information", "exchange", 
      "exchanges", "stock", "announcement", "announcements", "outcome", "business", 
      "financial", "financials", "quarter", "quarterly", "ended", "ending", "statement", 
      "statements", "details", "under", "general", "press", "release", "media", 
      "update", "updates", "report", "reports", "submission", "letter", "signed", 
      "enclosed", "herewith", "scheduled", "consider", "committee", "further", "shall", 
      "their", "about", "which", "would", "there", "these", "other", "after", "first", 
      "second", "third", "fourth", "annual", "month", "months", "years", "today", 
      "yesterday", "million", "billion", "crores", "crore", "lakhs", "rupees", 
      "indian", "india", "private", "public", "proceedings", "transacted", "matters",
      "noted", "taken", "record", "office", "registered", "place", "copy"
    ]);

    const sumWords = summary.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !SUMMARY_STOP_WORDS.has(w));

    const GENERIC_WRAPPER_REGEX = /\b(press release|media release|general update|general updates|corporate announcement|company update|business update|disclosure under regulation 30|intimation under regulation 30|outcome of board meeting|investor update)\b/i;
    const isCurrentWrapper = GENERIC_WRAPPER_REGEX.test(title || "") || filing_category === "GENERAL" || !filing_category;

    for (const prev of sumRows) {
      if (!prev.summary) continue;

      const prevTitle = prev.title || "";
      const prevSumLower = prev.summary.toLowerCase();
      const prevCombined = `${prevTitle.toLowerCase()} ${prevSumLower} ${(prev.raw_text || "").toLowerCase().slice(0, 3000)}`;

      const commonWords = sumWords.filter(w => prevCombined.includes(w));
      const isPrevWrapper = GENERIC_WRAPPER_REGEX.test(prevTitle) || prev.filing_category === "GENERAL";
      const isSameCategory = prev.filing_category === filing_category;

      // 6a. If either filing is a generic wrapper (Press Release / Media Release / GENERAL):
      // 2 or more substantive entity tokens indicate it is marketing/PR duplication of the same event
      if ((isCurrentWrapper || isPrevWrapper) && commonWords.length >= 2) {
        return true;
      }

      // 6b. Same-category filings: 3 or more substantive content words match across summaries
      if (isSameCategory && commonWords.length >= 3) {
        return true;
      }

      // 6c. Cross-category match: 4 or more substantive entity tokens match across summaries
      if (commonWords.length >= 4) {
        return true;
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
 * Deterministically extracts upcoming financial results board meeting dates from filing text.
 * Covers standard Indian exchange phrasing (e.g. "scheduled to be held on Wednesday, October 28, 2026 ... to consider ... Financial Results")
 * 
 * @param {string} text 
 * @returns {string|null} YYYY-MM-DD or null
 */
export function extractResultDateFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  // Must be about financial results & board meeting
  const hasResults = lower.includes("financial results") || lower.includes("financial statement") || lower.includes("quarterly results") || lower.includes("unaudited financial") || lower.includes("audited financial");
  const hasBoardMeet = lower.includes("board of directors") || lower.includes("board meeting") || lower.includes("meeting of the board") || lower.includes("inter-alia, to consider") || lower.includes("inter alia to consider");
  
  if (!hasResults || !hasBoardMeet) return null;

  const months = {
    jan: "01", january: "01",
    feb: "02", february: "02",
    mar: "03", march: "03",
    apr: "04", april: "04",
    may: "05",
    jun: "06", june: "06",
    jul: "07", july: "07",
    aug: "08", august: "08",
    sep: "09", sept: "09", september: "09",
    oct: "10", october: "10",
    nov: "11", november: "11",
    dec: "12", december: "12"
  };

  // Pattern 1: "held on [Day,] October 28, 2026" or "scheduled on October 28, 2026"
  const m1 = text.match(/(?:held\s+on|scheduled\s+(?:to\s+be\s+held\s+)?on|meeting\s+on)\s+(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+)?([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})/i);
  if (m1) {
    const month = months[m1[1].toLowerCase()];
    const day = m1[2].padStart(2, "0");
    const year = m1[3];
    if (month && year >= "2024" && year <= "2035") {
      return `${year}-${month}-${day}`;
    }
  }

  // Pattern 2: "held on [Day,] 28th October, 2026" or "28 October 2026"
  const m2 = text.match(/(?:held\s+on|scheduled\s+(?:to\s+be\s+held\s+)?on|meeting\s+on)\s+(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)[,\s]+(\d{4})/i);
  if (m2) {
    const day = m2[1].padStart(2, "0");
    const month = months[m2[2].toLowerCase()];
    const year = m2[3];
    if (month && year >= "2024" && year <= "2035") {
      return `${year}-${month}-${day}`;
    }
  }

  // Pattern 3: "held on 28/10/2026" or "28-10-2026"
  const m3 = text.match(/(?:held\s+on|scheduled\s+(?:to\s+be\s+held\s+)?on|meeting\s+on)\s+(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+)?(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i);
  if (m3) {
    const day = m3[1].padStart(2, "0");
    const month = m3[2].padStart(2, "0");
    const year = m3[3];
    if (year >= "2024" && year <= "2035" && parseInt(month) >= 1 && parseInt(month) <= 12) {
      return `${year}-${month}-${day}`;
    }
  }

  return null;
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
 * Checks if the end-of-day quiet day summary is needed.
 * Triggered ONLY:
 * 1. At night (>= 21:00 / 9:00 PM IST)
 * 2. If ZERO alerts were sent to Telegram the entire day
 * 3. Has NOT already been sent today
 */
export async function isNightlyQuietSummaryNeeded() {
  const now = new Date();
  const istHour = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: 'numeric', hour12: false }), 10);
  if (istHour < 21) return false;

  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  
  // Check if already sent today
  const res = await pool.query("SELECT value FROM system_settings WHERE key = 'last_nightly_summary_at'");
  const lastSent = res.rows[0]?.value ? (typeof res.rows[0].value === 'string' ? res.rows[0].value.replace(/"/g, '') : res.rows[0].value) : null;
  if (lastSent === todayIst) return false;

  // Check if any alerts were sent to Telegram today
  const alertRes = await pool.query(
    `SELECT COUNT(*) FROM corporate_announcements 
     WHERE sent_to_telegram = true 
       AND (processed_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`,
    [todayIst]
  );
  const count = parseInt(alertRes.rows[0]?.count || 0, 10);
  return count === 0;
}

/**
 * Sends the single nightly quiet day summary to Telegram and marks it as sent.
 */
export async function sendNightlyQuietSummary(stocksCount) {
  const now = new Date();
  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const dateFormatted = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const timestamp = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: '2-digit', minute: '2-digit', hour12: true });

  let message = `🌙 *DAILY ANNOUNCEMENT SCANNER STATUS*\n`;
  message    += `──────────────────────────────\n`;
  message    += `• *Monitored Coverage:* ${stocksCount} stocks (BSE & NSE)\n`;
  message    += `• *Today's Alerts:* 0 material / price-sensitive events\n`;
  message    += `• *Status:* Clean run — all routine filings processed & archived\n`;
  message    += `• *System Health:* Active 24/7 daemon operating normally\n`;
  message    += `──────────────────────────────\n`;
  message    += `🕐 ${timestamp} IST (${dateFormatted})`;

  await sendTelegramMessage(message);

  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) 
     VALUES ('last_nightly_summary_at', $1, NOW()) 
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(todayIst)]
  );
  console.log("[SUMMARY] Sent nightly quiet day summary to Telegram.");
}

/**
 * Checks if the daily morning heartbeat notification is needed.
 * Dispatched once per day at >= 09:00 IST.
 */
export async function isHeartbeatNeeded() {
  const now = new Date();
  const istHour = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: 'numeric', hour12: false }), 10);
  if (istHour < 9) return false;

  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const res = await pool.query("SELECT value FROM system_settings WHERE key = 'last_heartbeat_at'");
  const lastSent = res.rows[0]?.value ? (typeof res.rows[0].value === 'string' ? res.rows[0].value.replace(/"/g, '') : res.rows[0].value) : null;
  return lastSent !== todayIst;
}

/**
 * Marks daily heartbeat as sent in system_settings.
 */
export async function markHeartbeatSent() {
  const now = new Date();
  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) 
     VALUES ('last_heartbeat_at', $1, NOW()) 
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(todayIst)]
  );
}

const FAILURE_THRESHOLD = 3;
const COOLDOWN_HOURS = 6;

/**
 * Records a successful scan execution in system_settings.
 * Resets consecutive failure counter and sends a one-time recovery note if an alert was active.
 */
export async function recordScannerSuccess() {
  try {
    const now = new Date();
    const res = await pool.query(
      "SELECT key, value FROM system_settings WHERE key IN ('scanner_consecutive_failures', 'scanner_failure_alert_active')"
    );
    const settings = {};
    for (const r of res.rows) {
      settings[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    }

    const previousFailures = parseInt(settings.scanner_consecutive_failures || 0, 10);
    const alertWasActive = Boolean(settings.scanner_failure_alert_active);

    // If an alert was active and system recovered, send exactly one recovery notification
    if (alertWasActive && previousFailures >= FAILURE_THRESHOLD) {
      const timeIst = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: '2-digit', minute: '2-digit', hour12: true });
      const recoveryMsg = `🟢 *SCANNER RECOVERED*\n` +
        `──────────────────────────────\n` +
        `✅ Corporate filing scanner resumed normal operation.\n` +
        `🕐 *Time:* ${timeIst} IST\n` +
        `📡 All feeds operating cleanly.\n` +
        `──────────────────────────────`;
      await sendTelegramMessage(recoveryMsg);
      console.log("[HEALTH] Sent recovery notification to Telegram.");
    }

    // Reset failure counter and update last_successful_scan_at
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) 
       VALUES 
         ('last_successful_scan_at', $1, NOW()),
         ('scanner_consecutive_failures', '0', NOW()),
         ('scanner_failure_alert_active', 'false', NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(now.toISOString())]
    );
  } catch (err) {
    console.warn("[HEALTH WARN] Failed to record scanner success:", err.message);
  }
}

/**
 * Records a scanner run failure in system_settings.
 * Dispatches a Telegram alert ONCE when consecutive failures >= FAILURE_THRESHOLD,
 * muted for COOLDOWN_HOURS to prevent spam.
 */
export async function recordScannerFailure(error, options = {}) {
  try {
    const now = new Date();
    const envLabel = options.environment || (process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions Runner' : 'Server PM2 Daemon');

    const res = await pool.query(
      "SELECT key, value FROM system_settings WHERE key IN ('scanner_consecutive_failures', 'last_scanner_failure_alert_at')"
    );
    const settings = {};
    for (const r of res.rows) {
      settings[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    }

    const currentFailures = (parseInt(settings.scanner_consecutive_failures || 0, 10)) + 1;
    const lastAlertAt = settings.last_scanner_failure_alert_at ? new Date(settings.last_scanner_failure_alert_at) : null;
    
    const hoursSinceLastAlert = lastAlertAt ? (now.getTime() - lastAlertAt.getTime()) / (1000 * 60 * 60) : 999;
    const canAlert = hoursSinceLastAlert >= COOLDOWN_HOURS;

    // Persist failure count
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) 
       VALUES ('scanner_consecutive_failures', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(currentFailures)]
    );

    console.warn(`[HEALTH] Scanner failure recorded. Consecutive failure count: ${currentFailures}`);

    // If threshold met and outside cooldown, dispatch single Telegram alert
    if (currentFailures >= FAILURE_THRESHOLD && canAlert) {
      const timeIst = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: '2-digit', minute: '2-digit', hour12: true });
      const errMsg = (error?.message || String(error)).substring(0, 300);
      
      const alertMsg = `🚨 *SCANNER ALERT: REPEATED FAILURES*\n` +
        `──────────────────────────────\n` +
        `⚠️ *Consecutive Failures:* ${currentFailures}\n` +
        `📡 *Environment:* ${envLabel}\n` +
        `🕐 *Time:* ${timeIst} IST\n` +
        `❌ *Error:* \`${errMsg}\`\n` +
        `──────────────────────────────\n` +
        `🔒 *Anti-Spam:* Alert muted for the next ${COOLDOWN_HOURS} hours unless resolved.\n` +
        `_ThesisIQ Diagnostics Guard_`;

      await sendTelegramMessage(alertMsg);
      console.log("[HEALTH] Dispatched single circuit-breaker failure alert to Telegram.");

      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at) 
         VALUES 
           ('last_scanner_failure_alert_at', $1, NOW()),
           ('scanner_failure_alert_active', 'true', NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(now.toISOString())]
      );
    }
  } catch (err) {
    console.error("[HEALTH ERROR] Failed to record scanner failure:", err.message);
  }
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

  const MAX_ATTEMPTS = 2;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for PDF download

    try {
      if (attempt > 1) {
        console.log(`[PDF RETRY] Retrying download (attempt ${attempt}/${MAX_ATTEMPTS}): ${downloadUrl}`);
      } else {
        console.log(`[PDF] Downloading... ${downloadUrl}`);
      }
      
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
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[PDF RETRY] Download/parse failed (${err.message}). Waiting 2s before retry...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  if (lastErr?.name === "AbortError") {
    console.warn(`[PDF TIMEOUT] Failed to download PDF within 30s: ${url}`);
  } else {
    console.error(`[PDF ERROR] Failed to extract text from ${url}:`, lastErr?.message || "Unknown error");
  }
  return "";
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
