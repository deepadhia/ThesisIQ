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
export function shouldSendDigest({ queuedAt = [], otherPending = 0, now = Date.now() }) {
  if (otherPending <= 0) return true;
  const times = queuedAt.map((q) => (typeof q === "number" ? q : Date.parse(q))).filter((t) => !Number.isNaN(t));
  if (times.length < queuedAt.length || times.length === 0) return true; // unparseable: treat as due, never hold forever
  return now - Math.min(...times) >= DIGEST_MAX_WAIT_MS;
}

const asList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim().length > 3) : []);

/**
 * Compact, storable record of one processed filing (never includes _raw_text).
 */
export function buildDigestItem({ kind, title, url = null, filedAt, queuedAt = new Date().toISOString(), verdict = {} }) {
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
    summary: failed || LLM_FILLER.test(summaryRaw) ? "" : summaryRaw,
    positives: positives.slice(0, 3),
    concerns: concerns.slice(0, 3),
    guidance: [...asList(ch.quarterly_guidance), ...asList(ch.annual_guidance)].slice(0, 3),
    // Facts the call itself stated (already grounded by sanitizeConcallHighlights); they back up the driver evidence.
    facts: ["financial_performance", "business_performance", "operational_highlights", "growth_initiatives", "multi_year_targets"]
      .flatMap((k) => asList(ch[k]).slice(0, 2))
      .slice(0, 8),
    commitmentFlags: flags.slice(0, 3),
    assessment: Array.isArray(verdict.thesis_driver_assessment) ? verdict.thesis_driver_assessment : [],
    llmFailed: failed
  };
}

/**
 * True when a processed filing has nothing to say: no positives, concerns, guidance, facts, flagged commitments or driver
 * evidence (a call-recording intimation, for instance). Sending it would produce a "No driver evidence yet" message that is
 * pure noise. A filing whose AI analysis failed is never content-free: the user must still hear that it arrived.
 */
export function isContentFreeDigestItem(item = {}) {
  if (item.llmFailed) return false;
  const hasEvidence = Array.isArray(item.assessment) && item.assessment.some((a) => a && !/NO_EVIDENCE/i.test(String(a.status || "")) && String(a.evidence || "").trim());
  return !(item.positives?.length || item.concerns?.length || item.guidance?.length || item.facts?.length || item.commitmentFlags?.length || hasEvidence);
}

function signalLabel(action) {
  const a = String(action || "").toUpperCase();
  if (a.includes("BUY") || a.includes("ADD")) return "BUY / ACCUMULATE";
  if (a.includes("REASSESS") || a.includes("TRIM") || a.includes("EXIT")) return "REASSESS THESIS";
  return "HOLD / MONITOR";
}

/**
 * One Telegram message for one stock: thesis status first, then what is new.
 * @param {object} p
 * @param {string} p.financialsBlock pre-built "LATEST VERIFIED RESULTS" block (verified numbers only) or ""
 */
export function formatThesisDigestMessage({ ticker, companyName, items = [], board = [], overall, financialsBlock = "" }) {
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

  let msg = `🏢 ${head}\n🧭 *THESIS STATUS:* ${status.emoji} ${status.label}${tally ? `\n_${tally}_` : ""}\n──────────────────────────────`;
  if (financialsBlock) msg += financialsBlock.replace(/\n$/, "");

  if (board.length) {
    const rows = [];
    for (const st of ["BROKEN", "AT_RISK", "CONFIRMED", "ON_TRACK"]) {
      for (const b of board.filter((x) => x.status === st)) {
        const when = fmtDate(b.asOf);
        rows.push(`${STATUS_EMOJI[st]} *${plain(b.driver)}* — ${b.evidence}${when ? ` _(${when})_` : ""}`);
        if (st === "BROKEN" && b.falsificationTrigger) rows.push(`   ↳ _Falsification trigger hit:_ ${plain(b.falsificationTrigger)}`);
      }
    }
    const silent = board.filter((x) => x.status === "NO_EVIDENCE").length;
    if (silent) rows.push(`⚪ _${silent} driver(s) with no evidence yet_`);
    msg += `\n\n🎯 *DRIVER BOARD*\n${rows.join("\n")}`;
  }

  // Per-filing detail: bullets already stated by an earlier filing are dropped; filings left with nothing are collapsed.
  const seen = new Set();
  const fresh = (list) => (list || []).filter((t) => { const k = norm(t); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  const ordered = [...items].sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));
  const blocks = [];
  const collapsed = [];
  for (const it of ordered) {
    const link = it.url ? `[${plain(it.title) || "Filing"}](${it.url})` : plain(it.title) || "Filing";
    const summary = it.summary && !seen.has(norm(it.summary)) ? (seen.add(norm(it.summary)), plain(it.summary)) : "";
    const pos = fresh(it.positives).map((t) => `  ✅ ${plain(t)}`);
    const con = fresh(it.concerns).map((t) => `  ⚠️ ${plain(t)}`);
    const gui = fresh(it.guidance).map((t) => `  ⏱️ ${plain(t)}`);
    const fct = fresh(it.facts).map((t) => `  📌 ${plain(t)}`);
    const flg = (it.commitmentFlags || []).map((f) => `  🔴 ${f.status}: ${plain(f.statement)}${f.reason ? ` (${plain(f.reason)})` : ""}`);
    if (!summary && !pos.length && !con.length && !gui.length && !fct.length && !flg.length) {
      collapsed.push(link);
      continue;
    }
    const lines = [`${KIND_LABEL[it.kind] || KIND_LABEL.OTHER} — ${link}`];
    if (summary) lines.push(`  ${summary}`);
    lines.push(...fct, ...pos, ...con, ...gui, ...flg);
    if (it.llmFailed) lines.push("  ⚠️ _AI narrative unavailable for this filing; open it for details._");
    blocks.push(lines.join("\n"));
  }
  if (blocks.length) msg += `\n\n🆕 *NEW SINCE LAST UPDATE*\n${blocks.join("\n\n")}`;
  if (collapsed.length) msg += `\n\n📎 _Also filed:_ ${collapsed.join(" • ")}`;

  const lead = [...items].filter((i) => i.action).sort((x, y) => (Date.parse(y.filedAt) || 0) - (Date.parse(x.filedAt) || 0))[0];
  msg += `\n──────────────────────────────\n_${lead ? `System signal: ${signalLabel(lead.action)}${lead.conviction ? ` (conviction ${lead.conviction}/10)` : ""} • ` : ""}Thesis-tracking data, not investment advice._`;
  return msg;
}
