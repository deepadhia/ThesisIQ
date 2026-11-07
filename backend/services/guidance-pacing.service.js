/**
 * Guidance pacing: the year to date against what management guided for the FULL year, and what the rest of the year must deliver.
 *
 * Stock prices move on guidance and on whether it is being fulfilled. A quarter's growth says little about a full-year guide;
 * what matters is the half-year (nine-month) position and the growth the remaining months must produce. Example: a full-year
 * growth guide of 13-14% with half-year growth of +7% needs about +18-20% in the second half: that is "BEHIND", and the number
 * is the message. All figures come from the parser-verified statement (financial-validator: cumulative columns) and from the
 * management commitments already stored; nothing is estimated except where a line says "about".
 *
 * Pure. Statuses: AHEAD < ON_TRACK < STRETCH < BEHIND.
 */

import { classifyGuidanceScope } from "../utils/guidance-scope.js";

/** Pacing thresholds in percentage points of required-vs-delivered growth (defaults, tunable). */
export const PACING = { aheadPts: -5, onTrackPts: 3, stretchPts: 10, marginStretchPts: 1, runRateOnTrackPts: -2, runRateStretchPts: -6, partialGrowthPts: 1.5, partialRupeePct: 97, partialMarginPts: 0.5 };

const SEVERITY = { MET: 0, AHEAD: 0, ON_TRACK: 1, PARTIAL: 2, STRETCH: 2, BEHIND: 3, MISSED: 3 };
export const pacingSeverity = (status) => SEVERITY[status] ?? 1;

const EMOJI = { AHEAD: "🟢", ON_TRACK: "✅", STRETCH: "🟡", BEHIND: "🟠", MET: "✅", PARTIAL: "🟡", MISSED: "🔴" };
const n1 = (v) => (Math.round(v * 10) / 10);
const sgn = (v) => `${v >= 0 ? "+" : ""}${n1(v).toFixed(1)}%`;
const inr = (v) => Math.round(v).toLocaleString("en-IN");
const band = (lo, hi, suffix = "%") => (hi !== null && hi !== undefined && hi !== lo ? `${lo}–${hi}${suffix}` : `${lo}${suffix}`);

const statusFromGap = (gapPts) => (gapPts <= PACING.aheadPts ? "AHEAD" : gapPts <= PACING.onTrackPts ? "ON_TRACK" : gapPts <= PACING.stretchPts ? "STRETCH" : "BEHIND");

const fiscalYearLabel = (quarterEnded) => {
  const d = new Date(`${String(quarterEnded).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const fy = d.getUTCMonth() + 1 >= 4 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  return `FY${String(fy).slice(2)}`;
};

/** What a guidance statement is about, from its own words; null when it is not something this module can pace. */
// Statements that are not a full-year guide for the whole company, found by running this on the real database:
const MULTI_YEAR = /\bnext\s+(?:two|three|four|five|\d+)\s+years?\b|\bover\s+the\s+next\b|\bfor\s+the\s+next\b|\bcagr\b|\bmulti[- ]?year\b|\bmedium[- ]term\b|\blong[- ]term\b/;
const PARTIAL_PERIOD = /\b(?:first|second)\s+half\b|\bh[12]\b|\bq[1-4]\b|\bnine[- ]months?\b|\b9m\b|\bnext\s+quarter\b/;
const FULL_YEAR_WORDS = /\bfy\s?\d{2}e?\b|full[- ]year|\bannual/;
const SEGMENT_WORDS = /\b(?:segment|brand|division|vertical|domestic|export|international|category|region|subsidiary|standalone|retail|b2b|b2c)\b/;
const COMPANY_WORDS = /\b(?:consolidated|overall|total|company|topline|group)\b/;

function metricKind(c, cls) {
  const t = `${c.metric || ""} ${c.statement || ""}`.toLowerCase();
  const said = String(c.statement || "").toLowerCase();
  if (MULTI_YEAR.test(said)) return null;
  if (PARTIAL_PERIOD.test(said) && !FULL_YEAR_WORDS.test(said)) return null;
  const growthWord = /growth|\bgrow|yoy|increase/.test(t);
  // the STATEMENT must itself speak of a margin: the AI extraction sometimes files an EBITDA-growth sentence, or an unrelated one, under a margin metric
  if (cls.targetUnit === "PCT" && /(?:ebitda|operating)\s*margin|\bopm\b/.test(t) && /margin|\bopm\b/.test(said)) return "EBITDA_MARGIN";
  if (cls.targetUnit === "PCT" && /\b(?:pat|profit after tax|net profit)\b/.test(t) && growthWord && !/margin/.test(t)) return "PAT_GROWTH";
  if (/revenue|\bsales\b|topline|turnover/.test(t) && !/margin|ebitda|profit|\bpat\b/.test(t.replace(/revenue growth|sales growth/g, ""))) {
    // a segment's or a brand's growth is not the company's revenue (CCL: "...Continental coffee brand scaling at >30% YoY")
    if (SEGMENT_WORDS.test(said) && !COMPANY_WORDS.test(said)) return null;
    if (cls.targetUnit === "PCT" && growthWord) return "REVENUE_GROWTH";
    if (cls.targetUnit === "CR") return "REVENUE_ABS";
  }
  return null;
}

/**
 * @param {{commitments: Array<{statement,metric,target_value,timeline,quarter,created_at}>, fin: object|null}} p
 * @returns {{items: Array, fiscalYear: string|null}}
 */
export function computeGuidancePacing({ commitments = [], fin = null } = {}) {
  const empty = { items: [], fiscalYear: null };
  // A March-quarter statement carries the full year just ended: guidance is then JUDGED (met / partial / missed), not paced.
  const finalMode = Boolean(fin && fin.fyEnded && fin.fyRevenue > 0);
  if (!fin || !fin.quarterEnded) return empty;
  if (!finalMode && (![6, 9].includes(fin.ytdMonths) || !(fin.ytdRevenue > 0))) return empty;
  const fy = fiscalYearLabel(finalMode ? fin.fyEnded : fin.quarterEnded);
  if (!fy) return empty;
  const ytdLabel = fin.ytdMonths === 6 ? "H1" : "9M";
  const restLabel = fin.ytdMonths === 6 ? "H2" : "Q4";

  // newest statement first; the newest of each kind is the guide in force (a revision replaces the earlier one). For the year-end
  // judgement the FIRST statement of the year is judged too: that is the guide management gave at the start, and the credibility test.
  const ordered = [...commitments].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  const byKind = new Map();
  const items = [];

  for (const c of ordered) {
    let cls;
    try { cls = classifyGuidanceScope(c); } catch { continue; }
    if (cls.scope !== "ANNUAL" || cls.targetFY !== fy) continue;
    const kind = metricKind(c, cls);
    if (!kind) continue;
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push({ c, cls });
  }

  const build = (kind, { c, cls }) => {
    const lo = cls.rangeMin ?? cls.targetNumericValue;
    const hi = cls.rangeMax ?? cls.targetNumericValue;
    if (!(lo > 0)) return null;
    const args = { kind, lo, hi, isRange: Boolean(cls.isRange), fin, fy, statement: c.statement };
    const it = finalMode ? buildFinalItem(args) : buildItem({ ...args, ytdLabel, restLabel });
    return it ? { ...it, commitmentId: c.id ?? null } : null;
  };

  for (const [kind, list] of byKind) {
    // only the newest statement is the guide in force: if it is implausible the kind is skipped, never replaced by a stale older one
    const item = build(kind, list[0]);
    if (!item) continue;
    if (finalMode) {
      const first = list[list.length - 1];
      const initial = first === list[0] ? item : build(kind, first);
      item.initial = initial ? { status: initial.status, line: initial.line, guidedText: initial.guidedText, statement: initial.statement, commitmentId: initial.commitmentId } : null;
      item.revised = list.length > 1 && first !== list[0] && Boolean(initial) && initial.guidedText !== item.guidedText;
    }
    items.push(item);
  }
  items.sort((a, b) => pacingSeverity(b.status) - pacingSeverity(a.status));
  return { items, fiscalYear: fy, mode: finalMode ? "FINAL" : "PACING" };
}

function buildItem({ kind, lo, hi, isRange, fin, fy, ytdLabel, restLabel, statement }) {
  const base = { kind, fy, ytdLabel, restLabel, statement: String(statement || "").slice(0, 200), key: `${kind}|${fy}` };

  if (kind === "REVENUE_GROWTH" || kind === "REVENUE_ABS") {
    const { ytdRevenue: ytd, ytdRevenuePrior: ytdPy, fyPriorRevenue: fyPy } = fin;
    if (!(ytdPy > 0)) return null;
    const haveBase = Number.isFinite(fyPy) && fyPy > ytdPy;
    const restPrior = haveBase ? fyPy - ytdPy : null;
    const ytdGrowth = fin.ytdRevenueYoYGrowthPct ?? ((ytd / ytdPy) - 1) * 100;
    // A full-year revenue target can be neither below what the year to date already reported nor far outside last year's revenue:
    // such a figure is a segment, a quarter or a mis-extraction (real: CCL "Rs 550 Cr" against H1 revenue of 2,411 Cr).
    if (kind === "REVENUE_ABS") {
      if (hi < ytd) return null;
      if (haveBase && (hi < 0.9 * fyPy || lo > 3 * fyPy)) return null;
      if (!haveBase) return null;   // what the rest of the year must deliver cannot be said without last year's full year
    }
    if (kind === "REVENUE_GROWTH" && !haveBase) return runRateItem({ base, label: "Revenue growth", lo, hi, isRange, ytdGrowth, ytdLabel, fy });
    const targetLo = kind === "REVENUE_GROWTH" ? fyPy * (1 + lo / 100) : lo;
    const targetHi = kind === "REVENUE_GROWTH" ? fyPy * (1 + hi / 100) : hi;
    const needLo = targetLo - ytd, needHi = targetHi - ytd;
    const guidedText = kind === "REVENUE_GROWTH" ? `${band(lo, isRange ? hi : null)} growth` : `₹${inr(lo)}${isRange && hi !== lo ? `–${inr(hi)}` : ""} Cr`;
    const label = kind === "REVENUE_GROWTH" ? "Revenue growth" : "Revenue";
    if (needLo <= 0) {
      return { ...base, guidedText, status: "AHEAD", ytdGrowthPct: ytdGrowth, requiredLowPct: null, requiredHighPct: null, gapPts: null,
        line: `${EMOJI.AHEAD} *AHEAD* — ${label} ${fy} guide ${guidedText}: target already exceeded by ${ytdLabel} (₹${inr(ytd)} Cr)` };
    }
    const reqLo = (needLo / restPrior - 1) * 100;
    const reqHi = needHi > 0 ? (needHi / restPrior - 1) * 100 : reqLo;
    const gap = reqLo - ytdGrowth;
    let status = statusFromGap(gap);
    if (kind === "REVENUE_GROWTH" && ytdGrowth >= hi) status = "AHEAD";
    const need = kind === "REVENUE_GROWTH"
      ? `${restLabel} needs ${sgn(reqLo)}${isRange && reqHi - reqLo > 0.05 ? ` to ${sgn(reqHi)}` : ""} YoY`
      : `${restLabel} needs ₹${inr(needLo)} Cr (${sgn(reqLo)} YoY)`;
    const faster = gap > 0 ? ` (about +${n1(gap).toFixed(1)} pts faster than ${ytdLabel})` : "";
    return { ...base, guidedText, status, ytdGrowthPct: ytdGrowth, requiredLowPct: reqLo, requiredHighPct: reqHi, gapPts: gap,
      line: `${EMOJI[status]} *${status.replace("_", " ")}* — ${label} ${fy} guide ${guidedText}: ${ytdLabel} ${sgn(ytdGrowth)}; ${need}${faster}` };
  }

  if (kind === "PAT_GROWTH") {
    const { ytdPat: ytd, ytdPatPrior: ytdPy, fyPriorPat: fyPy } = fin;
    if (![ytd, ytdPy].every((v) => typeof v === "number") || !(ytdPy > 0)) return null;
    const ytdGrowth = fin.ytdPatYoYGrowthPct ?? ((ytd / ytdPy) - 1) * 100;
    if (typeof fyPy !== "number" || !(fyPy > ytdPy)) return runRateItem({ base, label: "Profit growth", lo, hi, isRange, ytdGrowth, ytdLabel, fy });
    const restPrior = fyPy - ytdPy;
    const needLo = fyPy * (1 + lo / 100) - ytd;
    const guidedText = `${band(lo, isRange ? hi : null)} growth`;
    if (needLo <= 0) {
      return { ...base, guidedText, status: "AHEAD", ytdGrowthPct: ytdGrowth, requiredLowPct: null, requiredHighPct: null, gapPts: null,
        line: `${EMOJI.AHEAD} *AHEAD* — Profit growth ${fy} guide ${guidedText}: target already exceeded by ${ytdLabel}` };
    }
    const reqLo = (needLo / restPrior - 1) * 100;
    const gap = reqLo - ytdGrowth;
    const status = ytdGrowth >= hi ? "AHEAD" : statusFromGap(gap);
    return { ...base, guidedText, status, ytdGrowthPct: ytdGrowth, requiredLowPct: reqLo, requiredHighPct: reqLo, gapPts: gap,
      line: `${EMOJI[status]} *${status.replace("_", " ")}* — Profit growth ${fy} guide ${guidedText}: ${ytdLabel} ${sgn(ytdGrowth)}; ${restLabel} needs ${sgn(reqLo)} YoY` };
  }

  if (kind === "EBITDA_MARGIN") {
    const m = fin.ytdEbitdaMarginPct;
    if (typeof m !== "number") return null;
    // A guided margin several times above or below the company's own EBITDA margin is a different measure (a net or segment margin).
    if (m > 3 * hi || m < lo / 3) return null;
    const top = isRange && hi > lo ? hi : lo;
    let status;
    if (isRange && hi > lo) status = m >= hi ? "AHEAD" : m >= lo ? "ON_TRACK" : m >= lo - PACING.marginStretchPts ? "STRETCH" : "BEHIND";
    else status = m >= lo + 1 ? "AHEAD" : m >= lo ? "ON_TRACK" : m >= lo - PACING.marginStretchPts ? "STRETCH" : "BEHIND";
    // the margin the remaining months would need to reach the bottom of the band, at the year-to-date growth rate (an estimate)
    let impliedText = "";
    const restPrior = fin.fyPriorRevenue - fin.ytdRevenuePrior;
    if (restPrior > 0 && typeof fin.ytdEbitda === "number" && status !== "AHEAD" && status !== "ON_TRACK") {
      const restRev = restPrior * (1 + (fin.ytdRevenueYoYGrowthPct ?? 0) / 100);
      const implied = ((lo / 100) * (fin.ytdRevenue + restRev) - fin.ytdEbitda) / restRev * 100;
      if (implied > 0 && implied < 60) impliedText = `; ${restLabel} margin would need about ${n1(implied).toFixed(1)}% at the ${ytdLabel} growth rate`;
    }
    const latest = typeof fin.ebitdaMarginPct === "number" ? ` (latest quarter ${n1(fin.ebitdaMarginPct).toFixed(1)}%; EBITDA excl. other income)` : " (EBITDA excl. other income)";
    const guidedText = band(lo, isRange && hi > lo ? top : null);
    return { ...base, guidedText, status, ytdGrowthPct: null, requiredLowPct: null, requiredHighPct: null, gapPts: n1(lo - m),
      line: `${EMOJI[status]} *${status.replace("_", " ")}* — EBITDA margin ${fy} guide ${guidedText}: ${ytdLabel} ${n1(m).toFixed(1)}%${latest}${impliedText}` };
  }
  return null;
}

/** The pacing block of an alert: worst first, at most four lines. */
export function formatPacingSection(items = []) {
  if (!items.length) return "";
  const shown = [...items].sort((a, b) => pacingSeverity(b.status) - pacingSeverity(a.status)).slice(0, 4);
  const first = shown[0];
  if (first.final) return `\n📒 *GUIDANCE OUTCOME (${first.fy} full year):*\n${shown.map((i) => `• ${i.line}`).join("\n")}\n`;
  return `\n⏱️ *GUIDANCE PACING (${first.fy}, ${first.ytdLabel} done):*\n${shown.map((i) => `• ${i.line}`).join("\n")}\n`;
}

/** The compact form stored on a verdict / digest item (what the next filing is compared with). */
export function compactPacing(items = []) {
  return items.map((i) => ({
    key: i.key, kind: i.kind, label: KIND_LABEL[i.kind] || "Guidance", fy: i.fy, ytdLabel: i.ytdLabel, restLabel: i.restLabel,
    guidedText: i.guidedText, status: i.status, line: i.line, gapPts: i.gapPts ?? null, final: Boolean(i.final), basis: i.basis || null, initial: i.initial || null, revised: Boolean(i.revised)
  }));
}

const KIND_LABEL = { REVENUE_GROWTH: "Revenue growth", REVENUE_ABS: "Revenue", PAT_GROWTH: "Profit growth", EBITDA_MARGIN: "EBITDA margin" };


/** Growth guide when the filing does not print last year's full year: the year-to-date growth against the band (no claim about what the rest must deliver). */
function runRateItem({ base, label, lo, hi, isRange, ytdGrowth, ytdLabel, fy }) {
  const guidedText = `${band(lo, isRange ? hi : null)} growth`;
  const status = ytdGrowth >= hi ? "AHEAD" : ytdGrowth >= lo + PACING.runRateOnTrackPts ? "ON_TRACK" : ytdGrowth >= lo + PACING.runRateStretchPts ? "STRETCH" : "BEHIND";
  return { ...base, guidedText, status, basis: "RUN_RATE", ytdGrowthPct: ytdGrowth, requiredLowPct: null, requiredHighPct: null, gapPts: n1(lo - ytdGrowth),
    line: `${EMOJI[status]} *${status.replace("_", " ")}* — ${label} ${fy} guide ${guidedText}: ${ytdLabel} ${sgn(ytdGrowth)} (run-rate; this filing does not print last year's full year)` };
}

/** The full-year outcome of a guide, from the March-quarter statement: met, partial (just short) or missed. This is the fulfilment record. */
function buildFinalItem({ kind, lo, hi, isRange, fin, fy, statement }) {
  const base = { kind, fy, final: true, ytdLabel: "FY", restLabel: "", statement: String(statement || "").slice(0, 200), key: `${kind}|${fy}` };
  const done = (status, label, guidedText, delivered, extra = {}) => ({ ...base, guidedText, status, gapPts: extra.gapPts ?? null, ytdGrowthPct: null, requiredLowPct: null, requiredHighPct: null,
    line: `${EMOJI[status]} *${status}* — ${label} ${fy} guide ${guidedText}: delivered ${delivered}` });

  if (kind === "REVENUE_GROWTH") {
    const a = fin.fyRevenueYoYGrowthPct;
    if (typeof a !== "number") return null;
    const status = a >= lo ? "MET" : a >= lo - PACING.partialGrowthPts ? "PARTIAL" : "MISSED";
    return done(status, "Revenue growth", `${band(lo, isRange ? hi : null)} growth`, `${sgn(a)} (₹${inr(fin.fyRevenue)} Cr vs ₹${inr(fin.fyRevenuePrior)} Cr)`, { gapPts: n1(lo - a) });
  }
  if (kind === "REVENUE_ABS") {
    const a = fin.fyRevenue;
    if (!(a > 0) || !(fin.fyRevenuePrior > 0) || lo < 0.5 * fin.fyRevenuePrior || lo > 3 * fin.fyRevenuePrior) return null;
    const status = a >= lo ? "MET" : (a / lo) * 100 >= PACING.partialRupeePct ? "PARTIAL" : "MISSED";
    return done(status, "Revenue", `₹${inr(lo)}${isRange && hi !== lo ? `–${inr(hi)}` : ""} Cr`, `₹${inr(a)} Cr (${n1((a / lo) * 100)}% of the target)`, { gapPts: n1(((lo - a) / lo) * 100) });
  }
  if (kind === "PAT_GROWTH") {
    const a = fin.fyPatYoYGrowthPct;
    if (typeof a !== "number") return null;
    const status = a >= lo ? "MET" : a >= lo - PACING.partialGrowthPts ? "PARTIAL" : "MISSED";
    return done(status, "Profit growth", `${band(lo, isRange ? hi : null)} growth`, `${sgn(a)}`, { gapPts: n1(lo - a) });
  }
  if (kind === "EBITDA_MARGIN") {
    const a = fin.fyEbitdaMarginPct;
    if (typeof a !== "number") return null;
    if (a > 3 * hi || a < lo / 3) return null;   // a different measure (see the pacing guard)
    const status = a >= lo ? "MET" : a >= lo - PACING.partialMarginPts ? "PARTIAL" : "MISSED";
    // our EBITDA excludes other income; a company may define its margin differently, so the verdict says which definition it used
    return done(status, "EBITDA margin", band(lo, isRange && hi > lo ? hi : null), `${n1(a).toFixed(1)}% (EBITDA excl. other income)`, { gapPts: n1(lo - a) });
  }
  return null;
}

const KIND_NAME = { REVENUE_GROWTH: "Revenue growth", REVENUE_ABS: "Revenue", PAT_GROWTH: "Profit growth", EBITDA_MARGIN: "EBITDA margin" };

/**
 * The verified track record of a stock's ORIGINAL full-year guides (rows of guidance_outcomes, initial = true), most recent first.
 * "" when nothing has been judged yet: a record is never invented (the old management_commitments ledger is not used for this:
 * hundreds of repeated extractions and loose labels made it 96% "achieved").
 */
export function formatTrackRecord(rows = []) {
  const list = (rows || []).filter((r) => r && ["MET", "PARTIAL", "MISSED"].includes(r.status));
  if (!list.length) return "";
  const met = list.filter((r) => r.status === "MET").length;
  const partial = list.filter((r) => r.status === "PARTIAL").length;
  const missed = list.filter((r) => r.status === "MISSED").length;
  const order = { MISSED: 0, PARTIAL: 1, MET: 2 };
  const shown = [...list].sort((a, b) => order[a.status] - order[b.status] || String(b.fiscal_year).localeCompare(String(a.fiscal_year))).slice(0, 4);
  const lines = shown.map((r) => `• ${EMOJI[r.status]} ${r.fiscal_year} ${KIND_NAME[r.kind] || "Guide"} (${r.guided_text || "guide"}): ${r.status}`);
  return `\n🧾 *GUIDANCE TRACK RECORD (verified, original full-year guides):* ${met} of ${list.length} met${partial ? `, ${partial} partial` : ""}${missed ? `, ${missed} missed` : ""}\n${lines.join("\n")}\n`;
}
