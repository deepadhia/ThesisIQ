/**
 * Thesis Digest Service
 *
 * The product question is "where does each of my stocks' thesis stand?", not "what did this one PDF say?".
 * Verified quarterly RESULTS are still alerted immediately (numbers + gate + driver check). Everything else the worker
 * produces (concall transcripts, investor decks, press releases, audio) is queued on its filing row and sent as ONE
 * message per stock that leads with a THESIS STATUS board: the newest evidence per thesis driver across recent filings.
 *
 * Pure functions only (no DB / Telegram) so every rule is unit-tested; the worker owns persistence and delivery.
 */

import { summarizeDriverAssessment } from "./thesis-driver-context.service.js";
import { formatPacingSection } from "./guidance-pacing.service.js";

/** A queued item is never held longer than this, even if a sibling filing of the same stock is stuck. */
export const DIGEST_MAX_WAIT_MS = 30 * 60 * 1000;

const LLM_FILLER = /ai synthesis unavailable|deep-dive completed; maintaining/i;
const STATUS_EMOJI = { CONFIRMED: "✅", ON_TRACK: "🟢", AT_RISK: "🟠", BROKEN: "🔴", NO_EVIDENCE: "⚪" };
const KIND_LABEL = {
  CONCALL: "🎙️ Concall transcript",
  DECK: "📑 Investor presentation",
  PRESS: "📰 Press release",
  AUDIO: "🎧 Concall audio",
  OTHER: "📄 Filing"
};
const KIND_ORDER = ["CONCALL", "DECK", "PRESS", "OTHER", "AUDIO"];

/** Telegram legacy Markdown breaks on stray * _ ` [ in model text; strip them from dynamic strings. */
const plain = (s) => String(s ?? "").replace(/[*_`\[\]]/g, "").replace(/\s+/g, " ").trim();

const GENERIC_SUBJECT = /^(?:general\s+updates?|updates?|corporate\s+announcements?|announcements?|analysts?\s*\/\s*institutional\s+investor\s+meet\s*\/\s*con\.?\s*call\s+updates?|announcement\s+under\s+regulation\s+30.*)$/i;
const KIND_LINK_NAME = { CONCALL: "Call transcript", AUDIO: "Call recording", DECK: "Investor presentation", PRESS: "Press release", OTHER: "Exchange filing" };

/**
 * The text of a filing's link. The exchange files most things under generic subjects ("General Updates", "Updates", the Con. Call
 * Updates subject), which tells the reader nothing; those become what the filing IS plus its date ("Call recording, 5 Nov").
 * A title that already says something is kept.
 */
export function filingLinkText(item = {}) {
  const title = plain(item.title);
  if (title && !GENERIC_SUBJECT.test(title)) return title;
  const name = item.source === "audio" ? KIND_LINK_NAME.AUDIO : (KIND_LINK_NAME[item.kind] || KIND_LINK_NAME.OTHER);
  const t = Date.parse(item.filedAt);
  const day = Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  return day ? `${name}, ${day}` : name;
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function fmtDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

/**
 * Verified statement filings are the one alert that must never wait; everything else is digested.
 * @returns {"immediate"|"digest"}
 */
export function routeAlert({ isStatementFiling, isTranscript, isAudio }) {
  if (isTranscript || isAudio) return "digest";
  return isStatementFiling ? "immediate" : "digest";
}

/**
 * Per driver: the newest assessment that actually has evidence (NO_EVIDENCE never overwrites older evidence).
 * @param {Array<{filedAt:string, source?:string, assessment:Array}>} entries any order
 * @param {Array<{name:string, materiality?:string}>} drivers the stock's thesis contract drivers
 */
export function buildThesisStatusBoard(entries = [], drivers = []) {
  if (!drivers.length) return [];
  const sorted = [...entries].sort((x, y) => (Date.parse(y.filedAt) || 0) - (Date.parse(x.filedAt) || 0));
  return drivers.map((d) => {
    const key = norm(d.name);
    for (const e of sorted) {
      // Only evidence the guard verified against a filing (`grounded: true`) may appear on the board.
      const hit = (e.assessment || []).find((a) => norm(a.driver) === key && a.grounded === true && a.status && a.status !== "NO_EVIDENCE");
      if (hit) {
        return {
          driver: d.name,
          status: hit.status,
          evidence: plain(hit.evidence),
          materiality: d.materiality || hit.materiality || "MEDIUM",
          falsificationTrigger: hit.falsificationTrigger || null,
          asOf: e.filedAt,
          source: e.source || null
        };
      }
    }
    return { driver: d.name, status: "NO_EVIDENCE", evidence: "", materiality: d.materiality || "MEDIUM", falsificationTrigger: null, asOf: null, source: null };
  });
}

export function overallThesisStatus(board = []) {
  const s = summarizeDriverAssessment(board);
  const counts = { broken: s.broken.length, atRisk: s.atRisk.length, confirmed: s.confirmed.length, onTrack: s.onTrack.length, noEvidence: s.noEvidence.length };
  if (counts.broken > 0) return { emoji: "🔴", label: `Thesis under threat — ${counts.broken} driver(s) broken`, counts };
  if (counts.atRisk > 0) return { emoji: "🟠", label: `At risk — ${counts.atRisk} driver(s) slipping`, counts };
  if (counts.confirmed + counts.onTrack > 0) return { emoji: "🟢", label: "Intact — evidence supports the drivers", counts };
  return { emoji: "⚪", label: "No driver evidence yet", counts };
}

/**
 * Send as soon as the stock has no other filing still waiting for the worker (so a deck + transcript that land together
 * go out together), but never hold anything longer than DIGEST_MAX_WAIT_MS.
 */
export function shouldSendDigest({ queuedAt = [], otherPending = 0, now = Date.now(), kinds = [], resultsAlerted = false, urgent = false }) {
  const times = queuedAt.map((q) => (typeof q === "number" ? q : Date.parse(q))).filter((t) => !Number.isNaN(t));
  const parseable = times.length === queuedAt.length && times.length > 0;
  // One message per stock per earnings cycle: a deck / press release filed after an alerted results statement waits (up to 24 h)
  // for the call, so deck + press release + call go out as ONE write-up instead of three. The call (a transcript or an analysed
  // recording) ends the hold at once, and urgent news (a guidance cut, a driver at risk or broken, a delayed or missed commitment,
  // a failed AI read) is never held.
  if (!urgent && parseable && resultsAlerted && kinds.length > 0 && kinds.every((k) => SETTLING_KINDS.has(k))) {
    if (now - Math.min(...times) < EARNINGS_HOLD_MS) return false;
  }
  if (otherPending <= 0) return true;
  if (!parseable) return true; // unparseable: treat as due, never hold forever
  return now - Math.min(...times) >= DIGEST_MAX_WAIT_MS;
}

/** How long deck / press-release items wait for the call before going out on their own (only after an alerted results statement). */
export const EARNINGS_HOLD_MS = 24 * 60 * 60 * 1000;
const SETTLING_KINDS = new Set(["DECK", "PRESS", "OTHER"]);

/** True when any item of a batch is news that must not wait for the call (see shouldSendDigest). */
export function hasUrgentDigestItem(items = []) {
  return items.some((i) => i && (
    i.llmFailed ||
    i.guidanceCuts?.length ||
    i.commitmentFlags?.length ||
    (i.assessment || []).some((a) => a && /AT_RISK|BROKEN/i.test(String(a.status || ""))) ||
    (i.kind === "DECK" && Boolean(i.guidance?.length || i.growthInitiatives?.length || i.operations?.length))
  ));
}

/**
 * Why a queued batch is NOT worth a message of its own, or null when it must be sent. Only a batch made purely of press
 * releases, filed after the results were alerted, with nothing beyond what the results said (no guidance, flagged commitment,
 * new initiative / capacity / business item, driver at risk or broken, and a successful AI read) is folded. A deck, a call, a
 * failed read or anything with possible news is always sent: a silent miss is worse than one more message.
 */
export function quietBatchReason({ items = [], resultsAlerted = false } = {}) {
  if (!resultsAlerted || !items.length) return null;
  if (!items.every((i) => i && i.kind === "PRESS")) return null;
  for (const i of items) {
    if (i.llmFailed) return null;
    if (i.guidance?.length || i.guidanceCuts?.length || i.commitmentFlags?.length || i.growthInitiatives?.length || i.operations?.length || i.businessExecution?.length || i.highlights) return null;
    if ((i.assessment || []).some((a) => a && /AT_RISK|BROKEN/i.test(String(a.status || "")))) return null;
  }
  return "press release only restates the results already alerted; nothing new to report";
}

const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g;
const numbersOf = (text) => new Set([...String(text || "").matchAll(NUMBER_TOKEN)].map((m) => m[0].replace(/,/g, "")).filter((n) => n.length >= 2 || n.includes(".")));
const CALL_LISTS = ["guidance_changes", "annual_guidance", "quarterly_guidance", "multi_year_targets", "financial_performance", "operational_highlights"];

/**
 * True when a call's WRITTEN transcript adds nothing the recording write-up (sent earlier for the same call) did not already
 * say: every figure in its guidance / numbers / capacity bullets already appears in that write-up. The transcript is then
 * folded instead of sent as a second message about the same call. Any new figure, or a missing write-up, means "send".
 */
export function repeatsEarlierCallWriteup({ items = [], earlierItems = [] } = {}) {
  if (!items.length || !earlierItems.length) return false;
  if (!items.every((i) => i && i.kind === "CONCALL" && i.source !== "audio" && i.highlights)) return false;
  const earlier = earlierItems.filter((e) => e && e.highlights);
  if (!earlier.length) return false;
  const known = numbersOf(earlier.flatMap((e) => CALL_LISTS.flatMap((k) => asList(e.highlights[k]))).join(" "));
  if (known.size === 0) return false;
  let sawFigure = false;
  for (const i of items) {
    for (const k of CALL_LISTS) {
      for (const bullet of asList(i.highlights[k])) {
        for (const n of numbersOf(bullet)) {
          sawFigure = true;
          if (!known.has(n)) return false;
        }
      }
    }
  }
  return sawFigure;
}

/** "💹 CMP ₹2,222 · P/E 37.5 · Mcap ₹7,164 Cr (as of 04 Nov)" from the latest market-data snapshot; "" when there is none. A snapshot older than 3 days says so. */
export function buildPriceContextLine(md, now = Date.now()) {
  if (!md || typeof md !== "object") return "";
  const n = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const price = n(md.share_price);
  const pe = n(md.pe_ratio);
  const mcap = n(md.market_cap);
  if (price === null && pe === null && mcap === null) return "";
  const fmt = (v) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const parts = [price !== null ? `CMP ₹${fmt(price)}` : null, pe !== null ? `P/E ${fmt(pe)}` : null, mcap !== null ? `Mcap ₹${fmt(mcap)} Cr` : null].filter(Boolean);
  const asOf = Date.parse(md.market_data_as_of);
  const when = Number.isNaN(asOf) ? "" : fmtDate(md.market_data_as_of);
  const stale = !Number.isNaN(asOf) && now - asOf > 3 * 86400000;
  return `💹 ${parts.join(" · ")}${when ? ` (as of ${when}${stale ? ", stale" : ""})` : ""}`;
}

const asList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim().length > 3) : []);

/** The gate outcome in the small form stored on a digest item (so the digest can explain the signal without re-deriving it). */
function compactGate(g) {
  if (!g || typeof g !== "object") return null;
  const hurdle = g.thesisGate || {};
  return {
    classification: g.statusClassification || null,
    explanation: String(g.decisionExplanation || "").slice(0, 240),
    hurdleStatus: hurdle.status || null,
    hurdleReason: String(hurdle.reason || "").slice(0, 200),
    hurdles: String(hurdle.hurdlesEvaluated || "").slice(0, 200)
  };
}

/**
 * Compact, storable record of one processed filing (never includes _raw_text).
 */
export function buildDigestItem({ kind, title, url = null, filedAt, queuedAt = new Date().toISOString(), verdict = {}, source = null, analysed = false }) {
  const ch = verdict.concall_highlights || {};
  const failed = Boolean(verdict._llm_failed);
  const summaryRaw = String(verdict.verdict_summary || verdict.summary || "");
  const positives = asList(ch.key_positives).length ? asList(ch.key_positives) : asList(verdict.key_positives);
  const concerns = asList(ch.key_challenges || ch.key_risks).length ? asList(ch.key_challenges || ch.key_risks) : asList(verdict.key_concerns_and_drags);
  const flags = (Array.isArray(verdict.commitments) ? verdict.commitments : [])
    .filter((c) => /delayed|missed/i.test(String(c?.status || "")) && c.statement)
    .map((c) => ({ statement: String(c.statement), status: /missed/i.test(c.status) ? "Missed" : "Delayed", reason: String(c.blockers_and_risks || "") }));
  return {
    kind,
    title: String(title || ""),
    url,
    filedAt,
    queuedAt,
    action: failed ? null : (verdict.final_action || verdict.action_signal || null),
    conviction: failed ? null : (verdict.conviction_score ?? null),
    gate: compactGate(verdict.thesis_gate_result),
    summary: failed || LLM_FILLER.test(summaryRaw) ? "" : summaryRaw,
    positives: positives.slice(0, 4),
    concerns: concerns.slice(0, 4),
    guidance: ([...asList(ch.quarterly_guidance), ...asList(ch.annual_guidance), ...asList(ch.multi_year_targets)].length
      ? [...asList(ch.quarterly_guidance), ...asList(ch.annual_guidance), ...asList(ch.multi_year_targets)]
      : (Array.isArray(verdict.commitments) ? verdict.commitments : [])
          .filter((c) => c && c.statement && !/delayed|missed/i.test(String(c.status || "")))
          .map((c) => c.target_value ? `${c.metric || 'Target'}: ${c.target_value}${c.timeline ? ` by ${c.timeline}` : ''} (${c.statement})` : c.statement)
    ).slice(0, 4),
    growthInitiatives: (asList(ch.growth_initiatives).length ? asList(ch.growth_initiatives) : asList(verdict.key_positives)).slice(0, 4),
    operations: (asList(ch.operational_highlights).length ? asList(ch.operational_highlights) : asList(verdict.thesis_operational_kpis)).slice(0, 4),
    businessExecution: asList(ch.business_performance || ch.segment_highlights).slice(0, 4),
    // Facts the call itself stated (already grounded by sanitizeConcallHighlights); they back up the driver evidence.
    facts: ["financial_performance", "business_performance", "operational_highlights", "growth_initiatives", "multi_year_targets"]
      .flatMap((k) => asList(ch[k]).slice(0, 2))
      .slice(0, 8),
    commitmentFlags: flags.slice(0, 3),
    assessment: Array.isArray(verdict.thesis_driver_assessment) ? verdict.thesis_driver_assessment : [],
    // The call's own highlights (guidance changes, numbers, segments, capex, initiatives, risks, what to monitor), capped for storage.
    highlights: compactHighlights(ch),
    // A guidance CUT is a thesis-relevant fact in itself: it is carried so the signal and its reason can say so.
    guidanceCuts: guidanceCutsOf(ch),
    // Where the year to date stands against the full-year guide (guidance-pacing.service.js), compact, so the next filing can say if it changed.
    pacing: Array.isArray(verdict.guidance_pacing) ? verdict.guidance_pacing.slice(0, 4) : [],
    trackRecord: typeof verdict.guidance_track_record === "string" ? verdict.guidance_track_record : "",
    // "audio": the call was heard (transcribed from the company's recording), not read from a filed transcript.
    source,
    // True when the item holds real analysis of a call: only then does the digest report the concall as analysed.
    analysed: Boolean(analysed),
    llmFailed: failed
  };
}

/** True when any item of the digest is an analysed concall (a filed transcript, or a transcribed / analysed recording). */
export function hasAnalysedConcallItem(items = []) {
  return items.some((i) => i && (i.kind === "CONCALL" || (i.kind === "AUDIO" && i.analysed === true)));
}

const HIGHLIGHT_KEYS = ["guidance_changes", "quarterly_guidance", "annual_guidance", "multi_year_targets", "financial_performance", "business_performance", "operational_highlights", "growth_initiatives", "key_positives", "key_challenges", "key_monitorables"];

/** The highlight lists worth storing: near-duplicates merged, each list capped. Null when the filing has no call highlights. */
export function compactHighlights(ch = {}) {
  if (!ch || typeof ch !== "object") return null;
  const out = {};
  let any = false;
  for (const k of HIGHLIGHT_KEYS) {
    const list = dedupeNearDuplicates(asList(ch[k])).slice(0, 8);
    out[k] = list;
    if (list.length) any = true;
  }
  out.management_tone = typeof ch.management_tone === "string" ? ch.management_tone : null;
  out.key_takeaway = typeof ch.key_takeaway === "string" ? ch.key_takeaway : null;
  return any ? out : null;
}

const GUIDANCE_CUT = /\b(?:cut|reduc\w*|lower\w*|trim\w*|downgrad\w*|scal\w* back|pared)\b/i;

const GUIDANCE_RAISE_MARK = /\((?:raised|increas\w*|upgrad\w*)[^)]*\)/i;

/**
 * A guidance CUT stated in the recent past (a call, a recording or a deck of the same stock; `changes` newest first) vetoes a buy on
 * whatever is judged next: SJS cut its revenue growth guide on the 2026-11-05 call and the results alert for the same quarter still
 * said STRONG BUY 9/10. A NEWER raise cancels an older cut. Only ever downgrades a buy (AGENTS.md I7: numbers authorise, vetoes win).
 * @returns {{vetoed: false} | {vetoed: true, action: string, conviction: number, cut: string}}
 */
export function recentGuidanceVeto({ action, conviction, changes } = {}) {
  const list = Array.isArray(changes) ? changes.filter((t) => typeof t === "string") : [];
  if (!list.length || !/\b(?:BUY|ADD|ACCUMULATE)\b/i.test(String(action || ""))) return { vetoed: false };
  const firstCut = list.findIndex((t) => guidanceCutsOf({ guidance_changes: [t] }).length > 0);
  if (firstCut === -1) return { vetoed: false };
  const firstRaise = list.findIndex((t) => GUIDANCE_RAISE_MARK.test(t));
  if (firstRaise !== -1 && firstRaise < firstCut) return { vetoed: false };
  const c = Number(conviction);
  return { vetoed: true, action: "HOLD / MONITOR", conviction: Number.isFinite(c) ? Math.min(c, 5) : 5, cut: list[firstCut] };
}

/** Guidance changes that are reductions (a "-> ... (cut)" revision), as they were stated. */
export function guidanceCutsOf(ch = {}) {
  // The model marks each change "(raised)", "(cut)" or "(reaffirmed)": that marker decides; wording elsewhere in the bullet
  // ("due to increased costs") must not turn a cut into a raise.
  const marked = (t) => (t.match(/\((?:raised|increas\w*|upgrad\w*|reaffirm\w*|cut|reduc\w*|lower\w*|trimm\w*|downgrad\w*)[^)]*\)/i) || [])[0] || "";
  return dedupeNearDuplicates(asList(ch?.guidance_changes))
    .filter((t) => (marked(t) ? GUIDANCE_CUT.test(marked(t)) : GUIDANCE_CUT.test(t) && !/\b(?:raised|upgraded|reaffirm\w*)\b/i.test(t)))
    .slice(0, 3);
}

/**
 * True when a processed filing has nothing to say: no positives, concerns, guidance, facts, flagged commitments or driver
 * evidence (a call-recording intimation, for instance). Sending it would produce a "No driver evidence yet" message that is
 * pure noise. A filing whose AI analysis failed is never content-free: the user must still hear that it arrived.
 */
export function isContentFreeDigestItem(item = {}) {
  if (item.llmFailed) return false;
  const hasEvidence = Array.isArray(item.assessment) && item.assessment.some((a) => a && !/NO_EVIDENCE/i.test(String(a.status || "")) && String(a.evidence || "").trim());
  return !(item.positives?.length || item.concerns?.length || item.guidance?.length || item.facts?.length || item.commitmentFlags?.length || item.highlights || hasEvidence);
}

function signalLabel(action) {
  const a = String(action || "").toUpperCase();
  if (a.includes("BUY") || a.includes("ADD")) return "BUY / ACCUMULATE";
  if (a.includes("REASSESS") || a.includes("TRIM") || a.includes("EXIT")) return "REASSESS THESIS";
  return "HOLD / MONITOR";
}

const SIGNAL_EMOJI = { "BUY / ACCUMULATE": "🟢", "REASSESS THESIS": "🔴", "HOLD / MONITOR": "🟡" };
const pctText = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`);

// Words that carry no meaning when deciding whether two bullets say the same thing ("Rs. 73 Cr" / "₹73 Cr").
const STOP_WORDS = new Set(["the", "a", "an", "of", "to", "in", "for", "and", "by", "at", "on", "rs", "inr", "cr", "crore", "crores", "was", "were", "is", "are", "its", "from", "with"]);
const tokenSet = (s) => new Set(norm(s).split(" ").filter((t) => t && !STOP_WORDS.has(t)));
/** Two bullets are the same statement when one's meaningful words are (almost) all in the other. Short bullets are never merged. */
function nearDuplicate(a, b) {
  const small = a.size <= b.size ? a : b;
  const large = small === a ? b : a;
  if (small.size < 4) return false;
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  return shared / small.size >= 0.8;
}

/**
 * Drops bullets that only restate a verified headline figure (revenue / PAT / EBITDA) the alert already prints in its VERIFIED
 * FINANCIALS block. The same number three times in one message makes the message long and hides the new information.
 * A bullet is dropped only when it carries a revenue / profit / EBITDA label AND one of those verified amounts.
 */
export function dropRestatedFigures(list = [], fin = null) {
  if (!fin) return list;
  const verified = [fin.revenue, fin.patAttributable, fin.patConsolidated, fin.ebitda, fin.ebitdaMarginPct].filter((v) => typeof v === "number" && v > 0);
  if (!verified.length) return list;
  const LABEL = /\b(?:revenue|sales|turnover|pat|net\s+profit|profit\s+after\s+tax|attributable\s+profit|ebitda(?:\s+margin)?)\b/i;
  const HALF_OR_SEGMENT = /half[-\s]?year|h1|9m|nine\s+months|segment|branch|division|standalone|export|domestic|order|backlog|cash|asset/i;
  return list.filter((t) => {
    const s = String(t || "");
    if (!LABEL.test(s) || HALF_OR_SEGMENT.test(s)) return true;
    const amounts = [...s.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
    return !amounts.some((a) => verified.some((v) => Math.abs(a - v) < 0.006));
  });
}

/**
 * A "Label: value" bullet whose label already appeared keeps only its first value ("Inventory: ₹1,245.90 Cr" then
 * "Inventory: ₹1,440.52 Cr" under one heading is two sources disagreeing, and the reader cannot tell which is right).
 * Bullets without a short label before a colon are left alone.
 */
export function dedupeByLabel(list = []) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (typeof t !== "string") continue;
    const m = t.match(/^\s*•?\s*([^:]{2,40}):\s*\S/);
    const key = m ? norm(m[1]) : null;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(t);
  }
  return out;
}

/** Keeps the first of any group of near-identical bullets (a model that is called per document chunk repeats the same fact). */
export function dedupeNearDuplicates(list = []) {
  const kept = [];
  const sets = [];
  for (const t of list) {
    if (typeof t !== "string" || !t.trim()) continue;
    const ts = tokenSet(t);
    if (sets.some((s) => nearDuplicate(ts, s))) continue;
    kept.push(t);
    sets.push(ts);
  }
  return kept;
}

/**
 * The single reason the signal is what it is, in priority order: a broken driver, an at-risk driver, a missed thesis hurdle,
 * missing verified numbers; only then the "all clear" explanations. Pure and deterministic: nothing here is model text.
 */
function verdictReason({ signal, board, gate, cuts = [] }) {
  const names = (st) => board.filter((b) => b.status === st).map((b) => plain(b.driver));
  const broken = names("BROKEN");
  const atRisk = names("AT_RISK");
  if (broken.length) return `thesis driver broken: ${broken.join(", ")}.`;
  if (atRisk.length) return `driver at risk: ${atRisk.join(", ")}.`;
  if (cuts.length) return `management cut guidance on the call: ${plain(cuts[0]).slice(0, 160)}.`;
  if (gate?.hurdleStatus === "FAIL") {
    return `the drivers are supported but the thesis hurdle was missed (${plain(gate.hurdleReason) || "see results"}), so there is no case to add until it recovers or is explained.`;
  }
  if (gate?.classification === "DATA_UNAVAILABLE" || gate?.classification === "UNVERIFIED_FIGURES") return "verified numbers are incomplete, so no buy is authorised.";
  if (signal === "BUY / ACCUMULATE") return "the numbers pass the thesis hurdles and the drivers are supported by evidence.";
  if (signal === "REASSESS THESIS") return "the evidence is mixed enough to re-check the thesis.";
  return "the evidence supports the drivers but not strongly enough to add.";
}

/**
 * "HOW THIS SIGNAL WAS REACHED": results -> thesis drivers -> this filing -> concall -> verdict, so the reader can see which
 * input produced the signal instead of a bare "HOLD (6/10)".
 */
export function buildSignalRationale({ lead = null, board = [], fin = null, periodLabel = null, concall = null, itemKinds = [], cuts = [] } = {}) {
  const lines = ["🧮 *HOW THIS SIGNAL WAS REACHED*"];
  const gate = lead?.gate || null;
  const signal = lead?.action ? signalLabel(lead.action) : null;

  if (fin && fin.revenue !== null && fin.revenue !== undefined) {
    const scope = fin.statementScope && fin.statementScope !== "UNKNOWN" ? fin.statementScope.toLowerCase() : "reported";
    const parts = [];
    if (pctText(fin.revenueYoYGrowthPct)) parts.push(`Revenue ${pctText(fin.revenueYoYGrowthPct)} YoY`);
    if (fin.ebitdaMarginPct !== null && fin.ebitdaMarginPct !== undefined) {
      const bps = Number.isFinite(fin.ebitdaMarginBpsDelta) ? ` (${fin.ebitdaMarginBpsDelta >= 0 ? "+" : ""}${fin.ebitdaMarginBpsDelta} bps YoY)` : "";
      parts.push(`EBITDA margin ${fin.ebitdaMarginPct}%${bps}`);
    }
    const pat = fin.patAttributable ?? fin.patConsolidated;
    if (pat !== null && pat !== undefined && pctText(fin.patYoYGrowthPct)) parts.push(`PAT ${pctText(fin.patYoYGrowthPct)} YoY`);
    lines.push(`1️⃣ *Results (${periodLabel ? `${periodLabel}, ` : ""}${scope}):* ${parts.join(" · ") || `Revenue ₹${fin.revenue} Cr`}`);
    if (gate?.hurdleStatus === "FAIL") lines.push(`   ❌ Thesis hurdle missed: ${plain(gate.hurdleReason)}`);
    else if (gate?.hurdleStatus === "PASS") lines.push("   ✅ Thesis hurdles met");
    else if (gate?.classification === "DATA_UNAVAILABLE" && gate.explanation) lines.push(`   ⚪ ${plain(gate.explanation)}`);
  } else {
    lines.push("1️⃣ *Results:* no verified results for this quarter yet, so no numbers check was applied.");
  }

  const s = summarizeDriverAssessment(board);
  const tally = [
    s.confirmed.length ? `${s.confirmed.length} confirmed` : null,
    s.onTrack.length ? `${s.onTrack.length} on track` : null,
    s.atRisk.length ? `${s.atRisk.length} at risk` : null,
    s.broken.length ? `${s.broken.length} broken` : null,
    s.noEvidence.length ? `${s.noEvidence.length} no evidence yet` : null
  ].filter(Boolean).join(" · ");
  if (board.length) {
    const verdictWord = s.broken.length ? "🔴 thesis under threat" : s.atRisk.length ? "🟠 at risk" : (s.confirmed.length + s.onTrack.length) ? "🟢 drivers intact" : "⚪ no evidence yet";
    lines.push(`2️⃣ *Thesis drivers:* ${tally} — ${verdictWord}`);
  } else {
    lines.push("2️⃣ *Thesis drivers:* no driver contract on file for this stock.");
  }

  if (lead) {
    const kind = (KIND_LABEL[lead.kind] || KIND_LABEL.OTHER).replace(/^\S+\s/, "");
    const first = asList(lead.concerns)[0];
    lines.push(`3️⃣ *This filing (${kind}):* read as ${signal || "no signal"}${lead.conviction ? ` (${lead.conviction}/10)` : ""}${first ? `; main concern: ${plain(first).slice(0, 140)}` : ""}`);
  }

  if (concall) {
    lines.push(concall.status === "ANALYSED"
      ? `4️⃣ *Concall:* ✅ analysed${itemKinds.includes("CONCALL") ? " in this update" : ""}`
      : "4️⃣ *Concall:* ⏳ not analysed yet — the signal is provisional until the transcript is filed");
  }

  if (signal) lines.push(`➡️ *Verdict: ${signal}* — ${verdictReason({ signal, board, gate, cuts })}`);
  return lines.join("\n");
}

/** Cuts a bullet at a word boundary so no bullet runs on; "…" marks the cut. */
function clip(text, max = 150) {
  const t = plain(text);
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, "").replace(/[,;:\s-]+$/, "")}…`;
}

/** 🔻 cut / 🔺 raised / ➖ reaffirmed for a "metric: earlier -> now (cut|raised|reaffirmed)" guidance change. */
function changeMarker(t) {
  const m = (String(t).match(/\((?:raised|increas\w*|upgrad\w*|reaffirm\w*|cut|reduc\w*|lower\w*|trimm\w*|downgrad\w*)[^)]*\)/i) || [""])[0];
  if (/cut|reduc|lower|trimm|downgrad/i.test(m)) return "🔻";
  if (/raised|increas|upgrad/i.test(m)) return "🔺";
  if (/reaffirm/i.test(m)) return "➖";
  return "•";
}

/**
 * A concall rendered the way an analyst writes it up: guidance & outlook (what CHANGED first), quarterly numbers, business &
 * segments, capacity & capex, new initiatives, risks & concerns, analyst take (positives, what to monitor, bottom line).
 * `fresh` filters bullets already printed elsewhere in the message. Pure; every bullet comes from grounded call text.
 */
export function formatConcallHighlightsBlock(item = {}, link = "", fresh = (l) => l, fin = null) {
  const h = item.highlights;
  if (!h) return "";
  // A deck or press release restates the quarter's results: when the parser has verified numbers they are printed once (in the
  // verified block), so this document's own copy of them is not shown (the source of "three different revenues" in one quarter).
  const hideOwnNumbers = Boolean(fin) && item.kind !== "CONCALL" && item.source !== "audio";
  const take = (list, n) => fresh(dedupeNearDuplicates(list || [])).slice(0, n);
  const sections = [];
  const add = (title, lines) => { if (lines.length) sections.push(`${title}\n${lines.join("\n")}`); };

  const changes = take(h.guidance_changes, 4).map((t) => `${changeMarker(t)} ${clip(t)}`);
  const rest = take([...(h.annual_guidance || []), ...(h.quarterly_guidance || []), ...(h.multi_year_targets || [])], 5 - Math.min(changes.length, 2)).map((t) => `• ${clip(t)}`);
  add("1️⃣ *GUIDANCE & OUTLOOK*", [...changes, ...rest]);
  if (!hideOwnNumbers) add("2️⃣ *QUARTERLY NUMBERS*", take(h.financial_performance, 6).map((t) => `• ${clip(t)}`));
  add("3️⃣ *BUSINESS & SEGMENTS*", take(h.business_performance, 5).map((t) => `• ${clip(t)}`));
  add("4️⃣ *CAPACITY & CAPEX*", take(h.operational_highlights, 5).map((t) => `• ${clip(t)}`));
  add("5️⃣ *NEW INITIATIVES*", take(h.growth_initiatives, 4).map((t) => `• ${clip(t)}`));
  add("6️⃣ *RISKS & CONCERNS*", take(h.key_challenges, 5).map((t) => `• ${clip(t)}`));
  const takeLines = [
    ...take(h.key_positives, 3).map((t) => `✅ ${clip(t)}`),
    ...take(h.key_monitorables, 3).map((t) => `👀 Monitor: ${clip(t)}`)
  ];
  if (h.key_takeaway) takeLines.push(`🔑 ${clip(h.key_takeaway, 220)}`);
  if (h.management_tone) takeLines.push(`🗣️ Tone: ${clip(h.management_tone, 40)}`);
  add("7️⃣ *ANALYST TAKE*", takeLines);
  if (!sections.length) return "";
  const label = item.source === "audio" ? "🎧 Concall (heard from the company's recording)" : (KIND_LABEL[item.kind] || KIND_LABEL.CONCALL);
  return `${label} — ${link || plain(item.title) || "Concall"}\n\n${sections.join("\n\n")}`;
}

/**
 * One Telegram message for one stock: thesis status first, then what is new.
 * @param {object} p
 * @param {string} p.financialsBlock pre-built "LATEST VERIFIED RESULTS" block (verified numbers only) or ""
 */
export function formatThesisDigestMessage({ ticker, companyName, items = [], board = [], overall, financialsBlock = "", fin, periodLabel = null, concall, priceLine = "", allocationLine = "" }) {
  // The rationale is shown when the caller supplies the evidence it is built from (`fin`, even null, and/or `concall`).
  const wantRationale = fin !== undefined || concall !== undefined;
  const lead = [...items].filter((i) => i.action).sort((x, y) => (Date.parse(y.filedAt) || 0) - (Date.parse(x.filedAt) || 0))[0];
  // Stored company names often carry the screener's "share price" suffix ("Skipper Ltd share price")
  const cleanName = companyName ? plain(companyName).replace(/\s+share\s+price\s*$/i, "").trim() : "";
  const head = cleanName ? `*${String(ticker).toUpperCase()}* | ${cleanName}` : `*${String(ticker).toUpperCase()}*`;
  const status = overall || overallThesisStatus(board);
  const c = status.counts || {};
  const tally = [
    c.confirmed ? `${c.confirmed} confirmed` : null,
    c.onTrack ? `${c.onTrack} on track` : null,
    c.atRisk ? `${c.atRisk} at risk` : null,
    c.broken ? `${c.broken} broken` : null
  ].filter(Boolean).join(" · ");

  // Bullets already stated by an earlier filing are dropped (shared by the call write-up and the per-filing detail below).
  const seen = new Set();
  const seenSets = [];
  const fresh = (list) => (list || []).filter((t) => {
    const k = norm(t);
    if (!k || seen.has(k)) return false;
    const ts = tokenSet(t);
    if (seenSets.some((s) => nearDuplicate(ts, s))) return false;
    seen.add(k);
    seenSets.push(ts);
    return true;
  });
  const ordered = [...items].sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));
  // A call with highlights is rendered as the analyst write-up (it replaces the generic per-filing bullets) and leads the message.
  const callBlocks = new Map();
  for (const it of ordered) {
    const link = it.url ? `[${filingLinkText(it)}](${it.url})` : filingLinkText(it);
    const cb = formatConcallHighlightsBlock(it, link, fresh, fin || null);
    if (cb) callBlocks.set(it, cb);
  }

  let msg = `🏢 ${head}${priceLine ? `\n${priceLine}` : ""}${allocationLine ? `\n${allocationLine}` : ""}\n🧭 *THESIS STATUS:* ${status.emoji} ${status.label}${tally ? `\n_${tally}_` : ""}`;
  // The signal sits next to the status (with its conviction), so "drivers intact" and "HOLD" are never left to contradict each other unexplained.
  if (wantRationale && lead) {
    const sig = signalLabel(lead.action);
    msg += `\n🎯 *SIGNAL:* ${SIGNAL_EMOJI[sig] || "🟡"} ${sig}${lead.conviction ? ` (conviction ${lead.conviction}/10)` : ""}`;
  }
  msg += "\n──────────────────────────────";
  if (financialsBlock) msg += financialsBlock.replace(/\n$/, "");
  // Guidance pacing from the newest item that carries it: the year to date against the full-year guide, and what the rest must deliver.
  const pacingItems = [...items].sort((x, y) => (Date.parse(y.filedAt) || 0) - (Date.parse(x.filedAt) || 0)).map((i) => i.pacing).find((p) => Array.isArray(p) && p.length) || [];
  if (pacingItems.length) msg += `\n${formatPacingSection(pacingItems).trim()}`;
  const trackRecord = [...items].sort((x, y) => (Date.parse(y.filedAt) || 0) - (Date.parse(x.filedAt) || 0)).map((i) => i.trackRecord).find((t) => typeof t === "string" && t.trim());
  if (trackRecord) msg += `\n${trackRecord.trim()}`;
  if (callBlocks.size) msg += `\n\n${[...callBlocks.values()].join("\n\n")}`;
  if (wantRationale) {
    msg += `\n\n${buildSignalRationale({ lead, board, fin: fin || null, periodLabel, concall: concall || null, itemKinds: items.map((i) => i.kind), cuts: items.flatMap((i) => i.guidanceCuts || []) })}`;
  }

  if (board.length) {
    const rows = [];
    for (const st of ["BROKEN", "AT_RISK", "CONFIRMED", "ON_TRACK"]) {
      for (const b of board.filter((x) => x.status === st)) {
        const when = fmtDate(b.asOf);
        rows.push(`${STATUS_EMOJI[st]} *${plain(b.driver)}*${when ? ` _(${when})_` : ""}\n   • ${b.evidence}`);
        if (st === "BROKEN" && b.falsificationTrigger) rows.push(`   ↳ _Falsification trigger hit:_ ${plain(b.falsificationTrigger)}`);
      }
    }
    const silent = board.filter((x) => x.status === "NO_EVIDENCE").length;
    if (silent) rows.push(`⚪ _${silent} driver(s) with no evidence yet_`);
    msg += `\n\n🎯 *DRIVER BOARD*\n${rows.join("\n")}`;
  }

  // Per-filing detail: bullets already stated by an earlier filing are dropped; filings left with nothing are collapsed.
  const blocks = [];
  const collapsed = [];
  for (const it of ordered) {
    const link = it.url ? `[${filingLinkText(it)}](${it.url})` : filingLinkText(it);
    if (callBlocks.has(it)) continue; // already printed above as the call write-up
    const summary = it.summary && !seen.has(norm(it.summary)) ? (seen.add(norm(it.summary)), plain(it.summary)) : "";
    const pos = fresh(it.positives).map((t) => `  ✅ ${plain(t)}`);
    const con = fresh(it.concerns).map((t) => `  ⚠️ ${plain(t)}`);
    const gui = fresh(it.guidance).map((t) => `  ⏱️ ${plain(t)}`);
    const growth = fresh(it.growthInitiatives || []).map((t) => `• ${plain(t)}`);
    const ops = fresh(it.operations || []).map((t) => `• ${plain(t)}`);
    const biz = fresh(it.businessExecution || []).map((t) => `• ${plain(t)}`);
    // Filter facts so they never duplicate bullets already listed in other sections
    const fct = fresh(it.facts)
      .filter((t) => {
        const normT = norm(t);
        const inOther = [...(it.positives || []), ...(it.concerns || []), ...(it.growthInitiatives || []), ...(it.operations || []), ...(it.businessExecution || [])]
          .some((p) => { const nP = norm(p); return nP.includes(normT) || normT.includes(nP); });
        return !inOther;
      })
      .slice(0, 4)
      .map((t) => `  📌 ${plain(t)}`);
    const flg = (it.commitmentFlags || []).map((f) => `  🔴 ${f.status}: ${plain(f.statement)}${f.reason ? ` (${plain(f.reason)})` : ""}`);
    if (!summary && !pos.length && !con.length && !gui.length && !growth.length && !ops.length && !biz.length && !fct.length && !flg.length) {
      collapsed.push(link);
      continue;
    }
    const lines = [`${KIND_LABEL[it.kind] || KIND_LABEL.OTHER} — ${link}`];
    if (summary) lines.push(`  ${summary}`);
    if (gui.length) {
      lines.push(`  ⏱️ *Forward Guidance & Pacing:*`);
      lines.push(...gui.map(g => `    • ${g.replace(/^  ⏱️\s*/, "")}`));
    }
    if (growth.length) {
      lines.push(`  🚀 *New Growth Initiatives & Pilots:*`);
      lines.push(...growth.map(g => `    ${g}`));
    }
    if (ops.length) {
      // Neutral headings: the model's operations / business fields hold claims, volumes or premiums for a financial-services
      // stock just as often as plant news for an industrial one, so a heading that names capex or an order book mislabels them.
      lines.push(`  🏭 *Operations & Capacity:*`);
      lines.push(...ops.map(o => `    ${o}`));
    }
    if (biz.length) {
      lines.push(`  📦 *Business & Segment Execution:*`);
      lines.push(...biz.map(b => `    ${b}`));
    }
    if (con.length) {
      lines.push(`  ⚠️ *Headwinds & Friction Points:*`);
      lines.push(...con.map(c => `    • ${c.replace(/^  ⚠️\s*/, "")}`));
    }
    if (pos.length) {
      lines.push(`  ✅ *Positive Highlights:*`);
      lines.push(...pos.map(p => `    • ${p.replace(/^  ✅\s*/, "")}`));
    }
    if (fct.length) {
      lines.push(`  📌 *Key Operational Facts:*`);
      lines.push(...fct.map(f => `    • ${f.replace(/^  📌\s*/, "")}`));
    }
    if (flg.length) {
      lines.push(`  🔴 *Flagged Commitments:*`);
      lines.push(...flg.map(fl => `    • ${fl.replace(/^  🔴\s*/, "")}`));
    }
    if (it.llmFailed) lines.push("  ⚠️ _AI narrative unavailable for this filing; open it for details._");
    blocks.push(lines.join("\n"));
  }
  if (blocks.length) msg += `\n\n🆕 *NEW SINCE LAST UPDATE*\n${blocks.join("\n\n")}`;
  if (collapsed.length) msg += `\n\n📎 _Also filed:_ ${collapsed.join(" • ")}`;

  msg += `\n──────────────────────────────\n_${lead ? `System signal: ${signalLabel(lead.action)}${lead.conviction ? ` (conviction ${lead.conviction}/10)` : ""} • ` : ""}Thesis-tracking data, not investment advice._`;
  return msg;
}
