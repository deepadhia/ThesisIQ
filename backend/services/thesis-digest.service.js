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
    gate: compactGate(verdict.thesis_gate_result),
    summary: failed || LLM_FILLER.test(summaryRaw) ? "" : summaryRaw,
    positives: positives.slice(0, 4),
    concerns: concerns.slice(0, 4),
    guidance: [...asList(ch.quarterly_guidance), ...asList(ch.annual_guidance), ...asList(ch.multi_year_targets)].slice(0, 4),
    growthInitiatives: asList(ch.growth_initiatives).slice(0, 4),
    operations: asList(ch.operational_highlights).slice(0, 4),
    businessExecution: asList(ch.business_performance || ch.segment_highlights).slice(0, 4),
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
  const verified = [fin.revenue, fin.patAttributable, fin.patConsolidated, fin.ebitda].filter((v) => typeof v === "number" && v > 0);
  if (!verified.length) return list;
  const LABEL = /\b(?:revenue|sales|turnover|pat|net\s+profit|profit\s+after\s+tax|attributable\s+profit|ebitda)\b/i;
  const HALF_OR_SEGMENT = /half[-\s]?year|h1|9m|nine\s+months|segment|branch|division|standalone|export|domestic|order|backlog|cash|asset/i;
  return list.filter((t) => {
    const s = String(t || "");
    if (!LABEL.test(s) || HALF_OR_SEGMENT.test(s)) return true;
    const amounts = [...s.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
    return !amounts.some((a) => verified.some((v) => Math.abs(a - v) < 0.006));
  });
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
function verdictReason({ signal, board, gate }) {
  const names = (st) => board.filter((b) => b.status === st).map((b) => plain(b.driver));
  const broken = names("BROKEN");
  const atRisk = names("AT_RISK");
  if (broken.length) return `thesis driver broken: ${broken.join(", ")}.`;
  if (atRisk.length) return `driver at risk: ${atRisk.join(", ")}.`;
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
export function buildSignalRationale({ lead = null, board = [], fin = null, periodLabel = null, concall = null, itemKinds = [] } = {}) {
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

  if (signal) lines.push(`➡️ *Verdict: ${signal}* — ${verdictReason({ signal, board, gate })}`);
  return lines.join("\n");
}

/**
 * One Telegram message for one stock: thesis status first, then what is new.
 * @param {object} p
 * @param {string} p.financialsBlock pre-built "LATEST VERIFIED RESULTS" block (verified numbers only) or ""
 */
export function formatThesisDigestMessage({ ticker, companyName, items = [], board = [], overall, financialsBlock = "", fin, periodLabel = null, concall }) {
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

  let msg = `🏢 ${head}\n🧭 *THESIS STATUS:* ${status.emoji} ${status.label}${tally ? `\n_${tally}_` : ""}`;
  // The signal sits next to the status (with its conviction), so "drivers intact" and "HOLD" are never left to contradict each other unexplained.
  if (wantRationale && lead) {
    const sig = signalLabel(lead.action);
    msg += `\n🎯 *SIGNAL:* ${SIGNAL_EMOJI[sig] || "🟡"} ${sig}${lead.conviction ? ` (conviction ${lead.conviction}/10)` : ""}`;
  }
  msg += "\n──────────────────────────────";
  if (financialsBlock) msg += financialsBlock.replace(/\n$/, "");
  if (wantRationale) {
    msg += `\n\n${buildSignalRationale({ lead, board, fin: fin || null, periodLabel, concall: concall || null, itemKinds: items.map((i) => i.kind) })}`;
  }

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
  const blocks = [];
  const collapsed = [];
  for (const it of ordered) {
    const link = it.url ? `[${plain(it.title) || "Filing"}](${it.url})` : plain(it.title) || "Filing";
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
      lines.push(`  🏭 *Capex & Plant Commissioning:*`);
      lines.push(...ops.map(o => `    ${o}`));
    }
    if (biz.length) {
      lines.push(`  📦 *Divisional & Order Book Execution:*`);
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
