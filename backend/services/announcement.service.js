import crypto from "crypto";
import https from "https";
import { pool } from "../db/pool.js";
import { PDFParse } from "pdf-parse";
import { sendTelegramMessage } from "./telegram.service.js";
import { GEMINI_API_KEY } from "../config/env.js";

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
export function getConcallType(title, rawText = "", attachmentUrl = "") {
  const t = String(title || "").toLowerCase();
  const body = String(rawText || "").toLowerCase();
  const attach = String(attachmentUrl || "").toLowerCase();
  const combined = `${t} ${body} ${attach}`;

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

  // A call invitation routinely says "the audio recording and transcript will be available on our website".
  // That is NOT a transcript. Body-only detection requires a full-length document that reads like a call.
  const bodyLooksLikeTranscript = (() => {
    if (!body.includes("transcript")) return false;
    // (a) a full-length document that reads like a call
    if (body.length >= 3500 && /moderator|question[\s-]+and[\s-]+answer|q\s*&\s*a session|management\s*:|operator\s*:/.test(body.slice(0, 20000))) {
      return true;
    }
    // (b) an explicit "Transcript of the <earnings/conference call>" statement that is not future-tense boilerplate
    const m = body.match(/transcript\s+(?:of|for)\s+(?:the\s+)?(?:earnings|conference|con\.?\s?call|concall|q[1-4]|investor|analyst)/);
    if (!m) return false;
    const ctx = body.slice(Math.max(0, m.index - 140), m.index + m[0].length + 140);
    const futureTense = /(?:will|shall|would|to)\s+be\s+(?:made\s+)?(?:available|uploaded|hosted|published|posted|shared)|available\s+on\s+(?:the\s+)?(?:company|our|website)|in\s+due\s+course|within\s+\d+\s+(?:working\s+)?days/.test(ctx);
    return !futureTense;
  })();

  // 1. Check for Transcript (most specific)
  if (t.includes("transcript") || bodyLooksLikeTranscript || attach.includes("transcript")) {
    const isConcallFiling = t.includes("con. call") || t.includes("conference call") || t.includes("earnings call") || attach.includes("transcript");
    const isGenericMeet = !isConcallFiling && (
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
      combined.includes("roadshow")
    );

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
  // The exchanges' STANDARD subject lines for ANY analyst/earnings call filing contain the words "investor meet"
  // ("Analysts/Institutional Investor Meet/Con. Call Updates", "Analyst / Investor Meet - Intimation").
  // Those words must not, by themselves, mark an earnings-call invitation as a private fund meet.
  const combinedForPrivateCheck = combined
    .replace(/analysts?\s*\/\s*institutional\s+investors?\s+meet(?:\s*\/\s*con\.?\s*call\s+updates)?/g, " con. call updates ")
    .replace(/analysts?\s*\/\s*investors?\s+meet(?:\s*-\s*intimation)?/g, " analyst call intimation ");
  const isPrivateMeet =
    combinedForPrivateCheck.includes("investor meet") ||
    combinedForPrivateCheck.includes("analyst meet") ||
    combinedForPrivateCheck.includes("investor meeting") ||
    combinedForPrivateCheck.includes("analyst meeting") ||
    combinedForPrivateCheck.includes("investor/analyst meet") ||
    combinedForPrivateCheck.includes("analyst / institutional investor meeting") ||
    combinedForPrivateCheck.includes("meeting with") ||
    combinedForPrivateCheck.includes("interaction with") ||
    combinedForPrivateCheck.includes("one on one") ||
    combinedForPrivateCheck.includes("one-on-one") ||
    combinedForPrivateCheck.includes("group meeting") ||
    combinedForPrivateCheck.includes("group meet") ||
    combinedForPrivateCheck.includes("fund meeting") ||
    combinedForPrivateCheck.includes("roadshow") ||
    combinedForPrivateCheck.includes("participating in") ||
    combinedForPrivateCheck.includes("organized by");

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
 * True when a filing is the invitation / intimation for an EARNINGS call (not a private fund meet or a roadshow).
 */
export function isEarningsConcallInvite(title = "", text = "") {
  if (getConcallType(title, text) !== "scheduled") return false;
  const combined = `${title} ${text}`.toLowerCase();
  return /earnings|results|quarter|q[1-4]\b|fy\s?\d{2}|half[\s-]year/.test(combined);
}

/**
 * Pulls the call date / time / joining link out of an intimation. Dates already in the past are ignored.
 * Returns { date: 'YYYY-MM-DD'|null, time: 'HH:MM'|null, link: string|null } (all IST wall-clock).
 */
export function extractConcallSchedule(text = "", hint = {}, now = new Date()) {
  const src = String(text || "");
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const todayIst = new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

  const candidates = [];
  if (hint.date && /^\d{4}-\d{2}-\d{2}$/.test(hint.date)) candidates.push({ iso: hint.date, idx: -1 });
  const push = (y, m, d, idx) => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2024 && y <= 2035)) return;
    candidates.push({ iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, idx });
  };
  for (const m of src.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s,-]+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi)) push(+m[3], months[m[2].toLowerCase().slice(0, 4) === "sept" ? "sept" : m[2].toLowerCase().slice(0, 3)], +m[1], m.index);
  for (const m of src.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi)) push(+m[3], months[m[1].toLowerCase().slice(0, 4) === "sept" ? "sept" : m[1].toLowerCase().slice(0, 3)], +m[2], m.index);
  for (const m of src.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/g)) push(+m[3], +m[2], +m[1], m.index);

  // Prefer a date mentioned close to the word "call" / "conference" and not in the past
  const callIdx = [...src.matchAll(/\b(?:call|conference|concall|con\.\s?call)\b/gi)].map(m => m.index);
  const future = candidates.filter(c => c.iso >= todayIst);
  future.sort((a, b) => {
    const da = callIdx.length ? Math.min(...callIdx.map(i => Math.abs(i - a.idx))) : 0;
    const db = callIdx.length ? Math.min(...callIdx.map(i => Math.abs(i - b.idx))) : 0;
    return da - db;
  });
  const date = future.length ? future[0].iso : null;

  let time = null;
  if (hint.time && /^\d{1,2}:\d{2}$/.test(hint.time)) time = hint.time.padStart(5, "0");
  if (!time) {
    const m12 = src.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*(?:\(?IST\)?)?/i);
    const m24 = src.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:hrs|hours|IST)\b/i);
    if (m12) {
      let h = +m12[1] % 12;
      if (/p/i.test(m12[3])) h += 12;
      time = `${String(h).padStart(2, "0")}:${m12[2] || "00"}`;
    } else if (m24) {
      time = `${m24[1].padStart(2, "0")}:${m24[2]}`;
    }
  }

  const links = [...src.matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)].map(m => m[0].replace(/[.,;]+$/, ""))
    .filter(u => !/nseindia|bseindia|sebi\.gov/i.test(u));
  const link = links.find(u => /diamondpass|choruscall|zoom|webex|teams|meet\.|webcast|researchbytes|orientcapital|bit\.ly|tinyurl|link/i.test(u)) || links[0] || null;

  return { date, time, link };
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
  // Auto-archive ancient un-executed deep-dive tasks older than 60 days so they don't block fresh queues
  await pool.query(
    `UPDATE corporate_announcements 
     SET deep_dive_status = 'archived'
     WHERE deep_dive_status IN ('pending_stage1', 'pending_stage2', 'pending_audio')
     AND created_at < NOW() - interval '60 days'`
  ).catch(err => console.warn('[RESET] Ancient deep dive archive error:', err.message));
}

/**
 * Exchange timestamps (NSE "12102026142235" / "12-Oct-2026 14:22:35", BSE "2026-10-23T16:58:29.837")
 * are all IST wall-clock times WITHOUT a zone. Parsing them with `new Date(...)` on a UTC server shifts
 * every filing by 5.5 hours. This pins them to +05:30 and returns an ISO string (or null).
 */
export function parseExchangeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();

  // Already zoned (Z or +hh:mm)
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) && /\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  let m = raw.match(/^(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})$/); // ddmmyyyyHHMMSS
  if (m) return toIstIso(m[3], m[2], m[1], m[4], m[5], m[6]);

  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (m) return toIstIso(m[1], m[2], m[3], m[4], m[5], m[6]);

  m = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const mm = months[m[2].toLowerCase()];
    if (mm) return toIstIso(m[3], mm, m[1], m[4], m[5], m[6]);
  }

  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return toIstIso(m[1], m[2], m[3], "00", "00", "00");

  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function toIstIso(y, mo, d, h, mi, sec) {
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}+05:30`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * Age of a filing in hours (never negative). Unknown timestamps count as fresh (age 0).
 */
export function getFilingAgeHours(timestamp, now = Date.now()) {
  const iso = parseExchangeTimestamp(timestamp);
  if (!iso) return 0;
  return Math.max(0, (now - new Date(iso).getTime()) / 3600000);
}

/**
 * Formats a Date as BSE's YYYYMMDD query-string date.
 */
function toBseDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

const BSE_PAGE_LIMIT = 4;

/**
 * Fetches recent announcements from the BSE API for a specific scrip code.
 *
 * The BSE endpoint now REJECTS requests without an explicit date window
 * ("Both From Date and To Date must be provided.") and the old per-category
 * calls silently produced zero rows. A single all-category (strCat=-1) call over
 * a date window returns every category (Result, Board Meeting, Company Update,
 * Analyst/Investor Meet, AGM/EGM, ...) and is paginated.
 *
 * Rows are normalised to the shape the scanner expects (NEWS_ID, NEWSSUB, DT_TM,
 * PDFFLAG) and enriched with ATTACHMENTNAME (the real PDF file name — NEWSID is
 * NOT the document name), the exchange's own descriptive text, and any
 * concall audio link.
 *
 * @param {string} scripCode
 * @param {number} lookbackDays
 */
export async function fetchBseAnnouncements(scripCode, lookbackDays = 7) {
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

  const today = new Date();
  const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const seen = new Set();
  const merged = [];

  for (let page = 1; page <= BSE_PAGE_LIMIT; page++) {
    const params = new URLSearchParams({
      pageno: String(page),
      strCat: "-1",
      strPrevDate: toBseDate(from),
      strScrip: String(scripCode),
      strSearch: "P",
      strToDate: toBseDate(today),
      strType: "C",
      subcategory: "-1"
    });

    const res = await fetch(`${baseUrl}?${params.toString()}`, { headers });
    if (!res.ok) {
      throw new Error(`BSE announcements HTTP ${res.status} for scrip ${scripCode}`);
    }
    const data = await res.json();

    // Surface API-level rejections instead of silently reporting "0 announcements".
    if (data && data.Status === false && data.Message) {
      throw new Error(`BSE announcements rejected for scrip ${scripCode}: ${data.Message}`);
    }

    const rows = Array.isArray(data?.Table) ? data.Table : [];
    for (const raw of rows) {
      const id = String(raw.NEWSID || raw.NEWS_ID || raw.XML_NAME || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const description = String(raw.MORE || raw.HEADLINE || "").trim();
      const audioLink = raw.AUDIO_VIDEO_FILE ? String(raw.AUDIO_VIDEO_FILE).trim() : "";
      const extraText = [description, audioLink ? `Audio/Video link: ${audioLink}` : ""].filter(Boolean).join("\n");

      merged.push({
        ...raw,
        NEWS_ID: id,
        NEWSSUB: raw.NEWSSUB,
        DT_TM: parseExchangeTimestamp(raw.DT_TM || raw.NEWS_DT) || raw.DT_TM || raw.NEWS_DT,
        PDFFLAG: raw.PDFFLAG ?? 0,
        ATTACHMENTNAME: raw.ATTACHMENTNAME || null,
        CATEGORYNAME: raw.CATEGORYNAME || null,
        attachment_text: extraText || undefined
      });
    }

    const totalRows = Number(data?.Table1?.[0]?.ROWCNT ?? rows.length);
    if (rows.length === 0 || merged.length >= totalRows) break;
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

    const annIso = (ann) => parseExchangeTimestamp(ann.dt) || parseExchangeTimestamp(ann.an_dt) || parseExchangeTimestamp(ann.sort_date);

    return (Array.isArray(data) ? data : [])
      .filter(ann => {
        const iso = annIso(ann);
        const annDate = iso ? new Date(iso) : new Date(ann.sort_date || ann.an_dt || ann.dt);
        return annDate >= lookbackDate;
      })
      .map(ann => {
        const attachFilename = ann.attchmntFile ? ann.attchmntFile.split('/').pop()?.split('?')[0] : null;
        const uniqueNewsId = ann.seq_id || attachFilename || `${ann.desc}_${ann.sort_date || ann.an_dt || ann.dt}`;
        return {
          NEWS_ID: uniqueNewsId,
          NEWSSUB: ann.desc,
          DT_TM: annIso(ann) || ann.sort_date || ann.an_dt || ann.dt,
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
export function generateAnnouncementHash(ticker, title, timestamp, discriminator = null) {
  // Use normalized title and DATE ONLY for the hash to handle small time drifts between exchanges
  const norm = normalizeTitle(title);
  const iso = parseExchangeTimestamp(timestamp);
  const date = iso ? iso.split('T')[0] : 'nodate';
  // NSE files many different documents under the same short generic subject ("Updates", "Press Release",
  // "Financial Results", ...). Without a discriminator the 2nd..nth such filing of the day is silently
  // dropped as a duplicate of the first. Long descriptive titles keep the cross-exchange dedup behaviour.
  const isGenericShort = norm.split(/\s+/).filter(Boolean).length <= 5;
  const disc = isGenericShort && discriminator ? `:${discriminator}` : '';
  const data = `${ticker}:${norm}:${date}${disc}`;
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
 * Extracts rupee amounts (normalised to a plain number string) from free text, e.g. "₹420 Cr", "Rs. 1,250.5 crore".
 */
function extractAmounts(text) {
  const out = new Set();
  const src = String(text || "");
  for (const m of src.matchAll(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/gi)) out.add(String(parseFloat(m[1].replace(/,/g, ""))));
  for (const m of src.matchAll(/([\d,]+(?:\.\d+)?)\s*(?:cr\b|crores?\b|lakhs?\b|mn\b|million\b)/gi)) out.add(String(parseFloat(m[1].replace(/,/g, ""))));
  return out;
}

/**
 * True when BOTH texts quote rupee amounts and they share none — i.e. two different deals/orders.
 */
function amountsDiffer(a, b) {
  const A = extractAmounts(a);
  const B = extractAmounts(b);
  if (A.size === 0 || B.size === 0) return false;
  for (const v of A) if (B.has(v)) return false;
  return true;
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
    const typeKeyword = concall_type;
    // Only look at the filing's own title/summary (raw_text matches words like "audio" or "scheduled" almost anywhere)
    // and, for scheduled/done calls, require an actual call-style title.
    const keywordPattern = (typeKeyword === 'audio' || typeKeyword === 'transcript')
      ? `%${typeKeyword}%`
      : `%call%`;
    const res = await pool.query(
      `SELECT id FROM corporate_announcements 
       WHERE ticker = $1 
         AND sent_to_telegram = true 
         AND (
           title ILIKE $2 
           OR summary ILIKE $2
         ) 
         AND processed_at > NOW() - interval '24 hours'`,
      [ticker, keywordPattern]
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
        // Compare only against the earlier alert's own title + summary (its 4,000-char raw_text matches generic words everywhere)
        const prevText = `${prev.title || ""} ${prev.summary || ""}`.toLowerCase();
        if (amountsDiffer(summary, prev.summary)) continue; // different ₹ amounts => different order / deal / investment
        const matchingTokens = tokens.filter(t => prevText.includes(t));
        // Distinct events from the same company routinely share 1-2 generic words ("order", "subsidiary").
        // Require strong overlap before suppressing an alert.
        if (matchingTokens.length >= 3 || (tokens.length === 2 && matchingTokens.length === 2)) {
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

    const tickerWord = String(ticker || "").toLowerCase();
    const sumWords = summary.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !SUMMARY_STOP_WORDS.has(w) && !(tickerWord && (w === tickerWord || tickerWord.startsWith(w))));

    const GENERIC_WRAPPER_REGEX = /\b(press release|media release|general update|general updates|corporate announcement|company update|business update|disclosure under regulation 30|intimation under regulation 30|outcome of board meeting|investor update)\b/i;
    const isCurrentWrapper = GENERIC_WRAPPER_REGEX.test(title || "") || filing_category === "GENERAL" || !filing_category;

    for (const prev of sumRows) {
      if (!prev.summary) continue;

      const prevTitle = prev.title || "";
      const prevSumLower = prev.summary.toLowerCase();
      const prevCombined = `${prevTitle.toLowerCase()} ${prevSumLower}`;
      if (amountsDiffer(summary, prev.summary)) continue; // different ₹ amounts => a different event

      const commonWords = sumWords.filter(w => prevCombined.includes(w));
      const isPrevWrapper = GENERIC_WRAPPER_REGEX.test(prevTitle) || prev.filing_category === "GENERAL";
      const isSameCategory = prev.filing_category === filing_category;

      // 6a. If either filing is a generic wrapper (Press Release / Media Release / GENERAL):
      // 2 or more substantive entity tokens indicate it is marketing/PR duplication of the same event
      if ((isCurrentWrapper || isPrevWrapper) && commonWords.length >= 3) {
        return true;
      }

      // 6b. Same-category filings: 4 or more substantive content words match across summaries
      if (isSameCategory && commonWords.length >= 4) {
        return true;
      }

      // 6c. Cross-category match: 6 or more substantive entity tokens match across summaries
      if (commonWords.length >= 6) {
        return true;
      }
    }
  }

  return false;
}


/**
 * True when the SAME filing was already alerted in the last 24h under a slightly different exchange title.
 * Compares full normalised titles (equality / containment) — NOT a 3-word prefix, which used to swallow
 * distinct filings such as "Award of Order ..." for two different customers.
 */
export async function isFuzzyDuplicateTitle(ticker, title) {
  const norm = normalizeTitle(title);
  if (!ticker || !norm || norm.length < 20) return false;
  const { rows } = await pool.query(
    `SELECT title FROM corporate_announcements
     WHERE ticker = $1
       AND status = 'sent'
       AND processed_at > NOW() - interval '24 hours'`,
    [ticker]
  );
  return rows.some(r => {
    const prev = normalizeTitle(r.title);
    return prev.length >= 20 && (prev === norm || (norm.length >= 30 && (prev.includes(norm) || norm.includes(prev))));
  });
}

/**
 * Cross-exchange document de-duplication: NSE and BSE publish the same PDF under different ids/titles.
 * Matches on the first ~1,000 characters of extracted text already stored for this ticker.
 */
export async function findContentDuplicate(ticker, extractedText, withinDays = 10) {
  const text = String(extractedText || "");
  if (!ticker || text.length < 1200) return null;
  const probe = text.slice(0, 1000);
  const { rows } = await pool.query(
    `SELECT id, status, deep_dive_status, sent_to_telegram, title
     FROM corporate_announcements
     WHERE ticker = $1
       AND created_at > NOW() - ($3 || ' days')::interval
       AND status != 'failed'
       AND POSITION($2 IN raw_text) > 0
     LIMIT 1`,
    [ticker, probe, String(withinDays)]
  );
  return rows[0] || null;
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
 * Returns the current hour in Asia/Kolkata timezone (0 to 23).
 * Uses hourCycle: 'h23' to ensure midnight (00:00) is strictly 0 and never 24.
 */
export function getIstHour(date = new Date()) {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hourCycle: "h23"
  }).format(date);
  return parseInt(hourStr, 10);
}

/**
 * Checks if the end-of-day quiet day summary is needed.
 * Triggered ONLY:
/**
 * Checks if the end-of-day quiet day summary is needed.
 * Permanently disabled per user mandate: only weekly heartbeat is dispatched if 0 alerts fired in week.
 */
export async function isNightlyQuietSummaryNeeded() {
  return false;
}

/**
 * Sends the single nightly quiet day summary to Telegram and marks it as sent.
 */
export async function sendNightlyQuietSummary(stocksCount) {
  return;
}

/**
 * Checks if the weekly heartbeat notification is needed.
 * Triggered ONLY:
 * 1. Once per week on Sunday between 10:00 and 12:00 IST (or after >= 7 days)
 * 2. If ZERO alerts were sent to Telegram in the entire past 7 days
 * 3. Has NOT already been sent this calendar week
 */
export async function isWeeklyHeartbeatNeeded() {
  const now = new Date();
  const istHour = getIstHour(now);
  if (istHour < 10 || istHour > 12) return false;

  const dayStr = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(now);
  if (dayStr !== "Sun") return false;

  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const res = await pool.query("SELECT value FROM system_settings WHERE key = 'last_weekly_heartbeat_at'");
  const lastSent = res.rows[0]?.value ? (typeof res.rows[0].value === 'string' ? res.rows[0].value.replace(/"/g, '') : res.rows[0].value) : null;
  if (lastSent === todayIst) return false;

  // Check if ANY alert was sent to Telegram across all stocks in the rolling 7-day period
  const alertRes = await pool.query(
    `SELECT COUNT(*) FROM corporate_announcements 
     WHERE sent_to_telegram = true 
       AND processed_at >= NOW() - INTERVAL '7 days'`
  );
  const count = parseInt(alertRes.rows[0]?.count || 0, 10);
  return count === 0;
}

/**
 * Sends the weekly heartbeat summary to Telegram and marks it as sent.
 */
export async function sendWeeklyHeartbeat(stocksCount = 20) {
  const now = new Date();
  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const dateFormatted = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const timestamp = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: '2-digit', minute: '2-digit', hour12: true });

  let message = `🟢 *SYSTEM HEARTBEAT: 24/7 SCANNER ACTIVE*\n`;
  message    += `──────────────────────────────\n`;
  message    += `📡 *Status:* Weekly Silent Check-in\n`;
  message    += `📅 *Period:* Past 7 Days (Clean Run)\n`;
  message    += `🏢 *Coverage:* ${stocksCount} stocks monitored (BSE & NSE)\n`;
  message    += `🎯 *Summary:* 0 material / price-sensitive events triggered this week\n`;
  message    += `🛡️ *System Health:* Active 24/7 daemon operating normally\n`;
  message    += `──────────────────────────────\n`;
  message    += `🕐 ${timestamp} IST (${dateFormatted})`;

  await sendTelegramMessage(message);

  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) 
     VALUES ('last_weekly_heartbeat_at', $1, NOW()) 
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(todayIst)]
  );
  console.log("[HEARTBEAT] Sent weekly silent check-in heartbeat to Telegram.");
}

/**
 * Backward-compatible alias: delegates to isWeeklyHeartbeatNeeded.
 */
export async function isHeartbeatNeeded() {
  return isWeeklyHeartbeatNeeded();
}

/**
 * Marks daily/weekly heartbeat as sent in system_settings.
 */
export async function markHeartbeatSent() {
  const now = new Date();
  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) 
     VALUES ('last_weekly_heartbeat_at', $1, NOW()) 
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(todayIst)]
  );
}

const SCAN_LEASE_KEY = "scan_lease";
const SCAN_LEASE_TTL_SEC = 120;
const SCAN_LEASE_RENEW_MS = 30000;

/**
 * Cross-process scan lease. Oracle PM2 (every 5 min) and the GitHub Actions failover (every 30 min) share one
 * database; without a lease both can analyse and alert the same filing. The lease is renewed by a heartbeat and
 * expires on its own if the process is killed (PM2 cron restart, runner timeout). Fails OPEN on any error so a
 * lease problem can never stop alerts.
 * @returns {Promise<object|null>} lease handle, or null when another scan currently holds it
 */
export async function acquireScanLease() {
  const holder = `${process.env.GITHUB_ACTIONS === "true" ? "gha" : "daemon"}-${process.pid}-${Date.now()}`;
  try {
    const res = await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
       WHERE system_settings.updated_at < NOW() - make_interval(secs => $3)
       RETURNING key`,
      [SCAN_LEASE_KEY, JSON.stringify({ holder }), SCAN_LEASE_TTL_SEC]
    );
    if (res.rows.length === 0) return null;

    const timer = setInterval(() => {
      pool.query(
        `UPDATE system_settings SET updated_at = NOW() WHERE key = $1 AND value::text LIKE $2`,
        [SCAN_LEASE_KEY, `%${holder}%`]
      ).catch(() => {});
    }, SCAN_LEASE_RENEW_MS);
    if (typeof timer.unref === "function") timer.unref();
    return { holder, timer };
  } catch (err) {
    console.warn(`[LEASE] Could not evaluate scan lease (${err.message}). Proceeding without it.`);
    return { holder, timer: null, failOpen: true };
  }
}

export async function releaseScanLease(lease) {
  if (!lease) return;
  if (lease.timer) clearInterval(lease.timer);
  if (lease.failOpen) return;
  try {
    await pool.query(
      `UPDATE system_settings SET updated_at = NOW() - interval '1 hour' WHERE key = $1 AND value::text LIKE $2`,
      [SCAN_LEASE_KEY, `%${lease.holder}%`]
    );
  } catch (err) {
    console.warn(`[LEASE] Could not release scan lease: ${err.message}`);
  }
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
 * Multimodal Gemini Vision OCR fallback for scanned zero-text PDFs.
 */
async function ocrPdfWithGemini(uint8Buffer, apiKey) {
  if (!apiKey || !uint8Buffer || uint8Buffer.length === 0) return null;
  // Guard: max 20MB inline base64
  if (uint8Buffer.length > 20 * 1024 * 1024) {
    console.warn("[PDF OCR WARN] PDF exceeds 20MB inline limit for Gemini OCR.");
    return null;
  }

  const base64Data = Buffer.from(uint8Buffer).toString("base64");
  const models = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-latest"];

  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: base64Data
                }
              },
              {
                text: "Extract and transcribe all text from this corporate filing document verbatim. Pay particular attention to all financial results tables, row labels (Revenue from operations, Total Income, PBT, Profit for the Period / PAT), and column figures (Quarter Ended, Half Year Ended, Year Ended). Preserve exact numbers."
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[GEMINI OCR] Model ${model} returned ${res.status}: ${errText.substring(0, 100)}`);
        continue;
      }

      const data = await res.json();
      const extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (extractedText && extractedText.length > 50) {
        return extractedText
          .replace(/[^\S\r\n]+/g, ' ')
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .substring(0, 60000);
      }
    } catch (err) {
      console.warn(`[GEMINI OCR] Attempt with ${model} failed: ${err.message}`);
    }
  }
  return null;
}

const DOWNLOAD_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Downloads a binary document. BSE's file server emits headers that undici (Node's fetch) rejects as malformed
 * ("Unexpected whitespace after header value"), which silently turned every BSE PDF into "no text". On such a
 * parser failure we retry through node:https with the lenient HTTP parser.
 */
async function downloadBinary(url, signal) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": DOWNLOAD_UA }, signal });
    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    const parserError = /HPE_|HTTPParserError|does not match the HTTP|Unexpected whitespace|fetch failed/i.test(`${err?.message} ${err?.cause?.message || ""} ${err?.cause?.code || ""}`);
    if (!parserError || err?.name === "AbortError") throw err;
    console.warn(`[PDF] fetch() rejected the response (${err.cause?.message || err.message}). Retrying via lenient HTTPS parser...`);
    return httpsDownload(url, signal);
  }
}

function httpsDownload(url, signal, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": DOWNLOAD_UA }, insecureHTTPParser: true }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        resolve(httpsDownload(new URL(res.headers.location, url).href, signal, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Failed to download PDF: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (signal) {
      if (signal.aborted) { req.destroy(new Error("aborted")); }
      signal.addEventListener("abort", () => req.destroy(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }
  });
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
      
      const bytes = await downloadBinary(downloadUrl, controller.signal);
      clearTimeout(timeoutId);

      console.log(`[PDF] Parsing...`);
      const uint8 = new Uint8Array(bytes);

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

      let cleanText = "";
      try {
        const parser = new PDFParse(uint8);
        const data = await parser.getText();
        if (data && data.text) {
          cleanText = data.text
            .replace(/[^\S\r\n]+/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .substring(0, 60000);
        }
      } catch (parseErr) {
        console.warn(`[PDF PARSE WARN] Native pdf-parse failed (${parseErr.message}). Falling back to Vision OCR.`);
      } finally {
        console.warn = origWarn;
      }

      // OCR Fallback: If native parse threw or extracted < 100 characters (scanned image or compressed xref), fallback to Gemini Vision
      const activeGeminiKey = GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (cleanText.length < 100 && activeGeminiKey) {
        try {
          console.log(`[PDF OCR] Native parse yielded ${cleanText.length} chars. Invoking Gemini Multimodal Document OCR...`);
          const ocrText = await ocrPdfWithGemini(uint8, activeGeminiKey);
          if (ocrText && ocrText.length > 50) {
            cleanText = ocrText
              .replace(/[^\S\r\n]+/g, ' ')
              .replace(/\r\n/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .trim()
              .substring(0, 60000);
            console.log(`[PDF OCR SUCCESS] Extracted ${cleanText.length} characters via Gemini Vision OCR.`);
          }
        } catch (ocrErr) {
          console.warn(`[PDF OCR WARN] Gemini vision fallback encountered an issue: ${ocrErr.message}`);
        }
      }

      if (cleanText.length > 0) {
        console.log(`[PDF] Extracted ${cleanText.length} characters.`);
        return cleanText;
      }
      throw new Error("Unable to extract readable text from PDF via native parser or OCR");
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
