/**
 * Allocation relevance: what is worth a Telegram message.
 *
 * The product question is "should I hold more, the same or less of this stock?". A filing is pushed immediately only when it could
 * change that answer: the stance moved, conviction moved by 2+, the thesis hurdle flipped, a driver got worse, management changed
 * guidance (up or down, once), or the quarter surprised. Everything else is recorded and listed once, in an end-of-day allocation
 * board, so nothing is silently missed (AGENTS.md section 10: a silent miss is the worst bug) and nothing is a notification.
 * When relevance cannot be judged (no previous stance on a non-HOLD view, a failed AI read) the filing is pushed.
 *
 * Pure functions only; the worker owns the queries, the storage and the send. Thresholds below are defaults the user can tune.
 */

/** Kill switch: ALLOCATION_GATE=off restores "every alert is pushed" (set it in the server environment, no deploy needed). */
export const allocationGateEnabled = () => String(process.env.ALLOCATION_GATE || "on").toLowerCase() !== "off";

/**
 * Downside-surprise thresholds for a results statement (verified numbers only). There is deliberately NO upside trigger: in the
 * 2026-11-06 backtest of 26 results events, a strong profit print (+29%, +35%, +74%) was not followed by a gain, and +25% is
 * ordinary for this portfolio, so "profit up" would push most results. A real upgrade arrives as a stance / driver / guidance change.
 */
export const SURPRISE = { patDownPct: -15, revenueDownPct: -5, marginDownBps: -300 };
/** Conviction must move this many points (of 10) to count as a change of view. */
export const CONVICTION_MOVE = 2;
/** The flip-flop damper applies to a stock judged within this many hours before. */
export const FLIP_WINDOW_HOURS = 72;

const plain = (s) => String(s ?? "").replace(/[*_`\[\]]/g, "").replace(/\s+/g, " ").trim();
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clip = (s, n) => { const t = plain(s); return t.length <= n ? t : `${t.slice(0, n).replace(/\s+\S*$/, "")}…`; };

/** BUY / ACCUMULATE | HOLD / MONITOR | REASSESS THESIS, whatever the wording the model or gate used. */
export function stanceOf(action) {
  const a = String(action || "").toUpperCase();
  if (/BUY|ADD|ACCUMULATE|BUILD/.test(a)) return "BUY / ACCUMULATE";
  if (/REASSESS|TRIM|SELL|EXIT|REDUCE/.test(a)) return "REASSESS THESIS";
  return "HOLD / MONITOR";
}

/** Stored convictions come on two scales (older rows out of 100); null when there is none. */
const outOfTen = (v) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  return n > 10 ? Math.min(10, Math.round(n / 10)) : n;
};

const SEVERITY = { BROKEN: 4, AT_RISK: 3, CONFIRMED: 2, ON_TRACK: 1, NO_EVIDENCE: 0 };
const numbersOf = (t) => new Set([...String(t || "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "")).filter((n) => n.length >= 2 || n.includes(".")));
const isReaffirm = (t) => /\(\s*reaffirm\w*/i.test(t) || (/\breaffirm\w*\b/i.test(t) && !/\((?:raised|cut|increas|reduc|lower)/i.test(t));

/** True when a guidance-change bullet says something the earlier bullets did not (every figure already stated before = a repeat). */
function isNewGuidanceChange(bullet, earlier = []) {
  const nums = numbersOf(bullet);
  const known = numbersOf(earlier.join(" "));
  if (nums.size > 0) return ![...nums].every((n) => known.has(n));
  const a = new Set(norm(bullet).split(" ").filter((w) => w.length > 2));
  return !earlier.some((e) => {
    const b = new Set(norm(e).split(" ").filter((w) => w.length > 2));
    let shared = 0; for (const w of a) if (b.has(w)) shared++;
    return a.size >= 4 && shared / a.size >= 0.8;
  });
}

/**
 * @param {object} p
 * @param {{action,conviction,hurdleStatus,assessment,guidanceChanges,llmFailed}} p.current this filing (or batch) as judged
 * @param {{action,conviction,hurdleStatus,assessment,guidanceChanges}|null} p.previous the last view of the stock before it
 * @param {{patYoYGrowthPct,revenueYoYGrowthPct,ebitdaMarginBpsDelta}|null} [p.fin] verified results of a results statement
 * @returns {{push:boolean, reasons:string[], stanceNow:string, stancePrev:string|null}}
 */
export function classifyAllocationRelevance({ current = {}, previous = null, fin = null } = {}) {
  const reasons = [];
  const stanceNow = stanceOf(current.action);
  const stancePrev = previous ? stanceOf(previous.action) : null;

  if (current.llmFailed) reasons.push("the AI read of this filing failed, so relevance could not be judged; open the filing");
  if (current.unverifiedResults) reasons.push("the results numbers could not be verified, so relevance could not be judged; open the filing");

  // Only a results statement with verified numbers may move the stance by itself. A deck or call inherits the carried-forward
  // numbers, and letting it re-grade the stock produced same-day flip-flops (REASSESS, then HOLD, then REASSESS).
  let stanceAuthoritative = current.stanceAuthoritative !== false;
  if (previous && Number.isFinite(Number(previous.ageHours)) && Number(previous.ageHours) <= FLIP_WINDOW_HOURS) {
    // Within 72 h of the last judgement the same event is often judged again from another copy or a partial parse: incomplete
    // numbers cannot overturn it, and a move straight back to the stance it had before that judgement is the same event twice.
    if (current.numbersComplete === false) stanceAuthoritative = false;
    if (previous.stanceBefore && stanceNow === stanceOf(previous.stanceBefore) && stanceNow !== stancePrev) stanceAuthoritative = false;
  }

  if (previous) {
    if (stanceAuthoritative && stanceNow !== stancePrev) reasons.push(`stance ${stancePrev} → ${stanceNow}`);
    const c0 = outOfTen(previous.conviction), c1 = outOfTen(current.conviction);
    if (stanceAuthoritative && c0 !== null && c1 !== null && Math.abs(c1 - c0) >= CONVICTION_MOVE) reasons.push(`conviction ${c0} → ${c1}`);
    if (previous.hurdleStatus && current.hurdleStatus && previous.hurdleStatus !== current.hurdleStatus &&
        ["PASS", "FAIL"].includes(previous.hurdleStatus) && ["PASS", "FAIL"].includes(current.hurdleStatus)) {
      reasons.push(current.hurdleStatus === "FAIL" ? "thesis hurdle now missed" : "thesis hurdle now met");
    }
  } else if (stanceAuthoritative && stanceNow !== "HOLD / MONITOR") {
    reasons.push(`first view of this stock is ${stanceNow}`);
  }

  // A driver that got worse than the last view of it (an at-risk driver reported again is not news).
  const before = new Map((previous?.assessment || []).map((a) => [norm(a.driver), SEVERITY[a.status] ?? 0]));
  for (const a of current.assessment || []) {
    if (!a || a.grounded === false || !["AT_RISK", "BROKEN"].includes(a.status)) continue;
    const was = before.get(norm(a.driver)) ?? 0;
    if ((SEVERITY[a.status] ?? 0) > was) reasons.push(`driver ${a.status === "BROKEN" ? "broken" : "at risk"}: ${clip(a.driver, 60)}`);
  }

  // Guidance changed (raised or cut) and the earlier filings had not said it.
  const earlierGuidance = previous?.guidanceChanges || [];
  const newChanges = (current.guidanceChanges || []).filter((t) => typeof t === "string" && t.trim() && !isReaffirm(t) && isNewGuidanceChange(t, earlierGuidance));
  if (newChanges.length) reasons.push(`guidance ${/\(\s*(?:cut|reduc|lower|trimm|downgrad)/i.test(newChanges[0]) ? "cut" : /\(\s*(?:raised|increas|upgrad)/i.test(newChanges[0]) ? "raised" : "changed"}: ${clip(newChanges[0], 110)}`);

  // Guidance PACING: whether the year to date is on course for the full-year guide is what a guide is judged on. A worse status
  // (to stretch / behind), a recovery from behind, or a first reading that is already behind is a reason; the same status again is not.
  const PACE = { AHEAD: 0, ON_TRACK: 1, STRETCH: 2, BEHIND: 3 };
  const paceName = (s) => String(s || "").replace("_", " ");
  for (const c of current.pacing || []) {
    if (!c || PACE[c.status] === undefined) continue;
    const was = (previous?.pacing || []).find((x) => x && x.key === c.key);
    const tag = `${c.label || "Guidance"} ${c.fy || ""} guide ${c.guidedText || ""}`.replace(/\s+/g, " ").trim();
    if (was && PACE[was.status] !== undefined) {
      if (PACE[c.status] >= 2 && PACE[c.status] > PACE[was.status]) reasons.push(`guidance pacing: ${tag} now ${paceName(c.status)} (was ${paceName(was.status)})`);
      else if (PACE[was.status] === 3 && PACE[c.status] <= 1) reasons.push(`guidance pacing recovered: ${tag} now ${paceName(c.status)}`);
    } else if (c.status === "BEHIND") {
      reasons.push(`guidance pacing: ${tag} is BEHIND`);
    }
  }

  // Presentation / concall disclosures: forward guidance, expansion milestones, or delayed commitments
  const flags = (current.commitmentFlags || []).filter((f) => f && f.statement && /delayed|missed/i.test(String(f.status || "")));
  for (const f of flags) {
    reasons.push(`commitment ${f.status || "delayed"}: ${clip(f.statement, 60)}`);
  }

  const hasGuidance = (current.guidance || []).some((g) => typeof g === "string" && g.trim());
  if (hasGuidance && !reasons.some((r) => r.startsWith("guidance"))) {
    reasons.push(`forward guidance: ${clip(current.guidance[0], 80)}`);
  }

  const hasGrowth = (current.growthInitiatives || []).some((g) => typeof g === "string" && g.trim());
  if (hasGrowth && !reasons.some((r) => r.includes("growth") || r.includes("expansion"))) {
    reasons.push(`growth initiative: ${clip(current.growthInitiatives[0], 80)}`);
  }

  const hasOps = (current.operations || []).some((o) => typeof o === "string" && o.trim());
  if (hasOps && !reasons.some((r) => r.includes("capacity") || r.includes("operational"))) {
    reasons.push(`capacity/operational milestone: ${clip(current.operations[0], 80)}`);
  }

  if (fin) {
    const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
    const pat = num(fin.patYoYGrowthPct), rev = num(fin.revenueYoYGrowthPct), bps = num(fin.ebitdaMarginBpsDelta);
    if (pat !== null && pat <= SURPRISE.patDownPct) reasons.push(`profit ${pat}% YoY`);
    if (rev !== null && rev <= SURPRISE.revenueDownPct) reasons.push(`revenue ${rev}% YoY`);
    if (bps !== null && bps <= SURPRISE.marginDownBps) reasons.push(`EBITDA margin ${bps} bps YoY`);
  }

  return { push: reasons.length > 0, reasons, stanceNow, stancePrev };
}

/** One line that leads a pushed message: where the stance is now, where it was, and why this is worth reading. */
export function buildAllocationLine({ reasons = [], current = {}, previous = null } = {}) {
  const now = stanceOf(current.action);
  const nowC = Number.isFinite(Number(current.conviction)) ? ` (${current.conviction}/10)` : "";
  const was = previous ? stanceOf(previous.action) : null;
  const wasC = previous && Number.isFinite(Number(previous.conviction)) ? ` (${previous.conviction}/10)` : "";
  const move = previous
    ? (was !== now || wasC !== nowC ? `${was}${wasC} → ${now}${nowC}` : `${now}${nowC}, stance unchanged`)
    : `${now}${nowC}`;
  const meaningfulReasons = reasons.filter((r) => !/^first view/i.test(r) && !/^stance\b/i.test(r));
  const pickedReasons = (meaningfulReasons.length ? meaningfulReasons : reasons).slice(0, 2);
  return `⚖️ *ALLOCATION:* ${move}${pickedReasons.length ? ` — ${pickedReasons.map((r) => plain(r)).join("; ")}` : ""}`.replace(/\n/g, " ");
}

/** An order / capex / acquisition at or above this share of market cap (percent) is material to the stock. */
export const MATERIAL_PCT_OF_MCAP = 3;

const ALWAYS_PUSH = new Set(["CREDIT_EVENT", "GOVERNANCE_RISK", "REGULATORY_ACTION", "CAPITAL_RAISE", "RESTRUCTURING"]);
const SIZE_GATED = new Set(["ORDER_WIN", "CAPEX_COMMISSIONING", "ACQUISITION"]);
const CATEGORY_LABEL = {
  CREDIT_EVENT: "credit event", GOVERNANCE_RISK: "governance event", REGULATORY_ACTION: "regulatory action", CAPITAL_RAISE: "capital raise",
  RESTRUCTURING: "restructuring", ORDER_WIN: "order win", CAPEX_COMMISSIONING: "capex", ACQUISITION: "acquisition",
  CAPITAL_RETURN: "dividend / buyback", ROUTINE_COMPLIANCE: "compliance filing", GENERAL: "general filing", AGM_DISCLOSURE: "AGM disclosure"
};

/**
 * Direct scanner alerts (a filing alerted on its own, not via the results / deck / call worker): push only what could change how
 * much of the stock is held. Structural and risk events always push; an order, capex or acquisition pushes when it is material to
 * the company (>= 3% of market cap) or negative; everything else (routine compliance, general filings, dividends, an unknown
 * category) goes to the board unless the AI rated it HIGH and not neutral. An unknown size is never guessed: it pushes only when
 * the AI rated it HIGH (an acquisition of unknown size always pushes).
 * @returns {{push:boolean, reason:string}}
 */
export function classifyDirectEvent({ category = "GENERAL", priority = "MEDIUM", impact = "", amountCr = null, marketCapCr = null } = {}) {
  const cat = String(category || "GENERAL").toUpperCase();
  const label = CATEGORY_LABEL[cat] || "filing";
  const negative = /NEGATIVE/i.test(String(impact || ""));
  const neutral = /NEUTRAL/i.test(String(impact || ""));
  const high = String(priority || "").toUpperCase() === "HIGH";

  if (ALWAYS_PUSH.has(cat)) return { push: true, reason: `${label}: a structural or risk event` };
  if (negative) return { push: true, reason: `${label} with a negative impact` };

  if (SIZE_GATED.has(cat)) {
    const amt = Number(amountCr), mcap = Number(marketCapCr);
    if (Number.isFinite(amt) && amt > 0 && Number.isFinite(mcap) && mcap > 0) {
      const pct = (amt / mcap) * 100;
      const shown = `${pct.toFixed(1)}% of market cap`;
      return pct >= MATERIAL_PCT_OF_MCAP
        ? { push: true, reason: `${label} of about ₹${Math.round(amt)} Cr, ${shown}` }
        : { push: false, reason: `${label} of about ₹${Math.round(amt)} Cr, only ${shown}` };
    }
    if (cat === "ACQUISITION") return { push: true, reason: "acquisition of unknown size" };
    return high ? { push: true, reason: `${label} rated high priority (size unknown)` } : { push: false, reason: `${label}, size unknown` };
  }

  if (high && !neutral) return { push: true, reason: `${label} rated high priority` };
  return { push: false, reason: label };
}

const KIND_NAME = {
  RESULTS: "results", PRESS: "press release", DECK: "investor deck", CONCALL: "concall", AUDIO: "recording", OTHER: "filing", CONCALL_SCHEDULE: "call scheduled",
  ...CATEGORY_LABEL
};

/** Compact record of a filing that was NOT pushed, kept on its row until the end-of-day board lists it. A filing with no stance (a direct event) carries none. */
export function boardEntryFrom({ ticker, kinds = [], action = null, conviction = null, gist = "" } = {}) {
  const hasStance = action !== null && action !== undefined && String(action).trim() !== "";
  return {
    ticker: String(ticker || "").toUpperCase(), kinds: [...new Set(kinds)], stance: hasStance ? stanceOf(action) : null,
    conviction: Number.isFinite(Number(conviction)) && conviction !== null ? Number(conviction) : null, gist: clip(gist, 140)
  };
}

/**
 * The end-of-day allocation board: every stock that filed something that did NOT change the view, once, with its stance.
 * Anything that did change the view was already sent when it happened. Null when nothing is waiting.
 */
export function buildAllocationBoardMessage(entries = [], { todayYmd = "" } = {}) {
  const byTicker = new Map();
  for (const e of entries) {
    if (!e || !e.ticker) continue;
    const cur = byTicker.get(e.ticker) || { ticker: e.ticker, kinds: [], stance: e.stance, conviction: e.conviction, gist: "" };
    cur.kinds = [...new Set([...cur.kinds, ...(e.kinds || [])])];
    cur.stance = e.stance || cur.stance;          // a stance-less entry (a direct event) never erases the stance of a stock that has one
    if (e.conviction !== null && e.conviction !== undefined) cur.conviction = e.conviction;
    if (!cur.gist && e.gist) cur.gist = e.gist;
    byTicker.set(e.ticker, cur);
  }
  if (!byTicker.size) return null;
  const t = Date.parse(`${todayYmd}T00:00:00Z`);
  const day = Number.isNaN(t) ? "" : ` — ${new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })}`;
  const lines = [`📋 *ALLOCATION BOARD*${day}`, "_Filed since the last board, nothing that changes the view (anything that did was sent when it happened):_"];
  for (const e of [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    const what = e.kinds.map((k) => KIND_NAME[k] || "filing").join(", ");
    const stanceText = e.stance ? `${e.stance}${e.conviction !== null ? ` (${e.conviction}/10)` : ""}: ` : "";
    lines.push(`• *${e.ticker}* — ${stanceText}${what}.${e.gist ? ` ${e.gist}` : ""}`);
  }
  return lines.join("\n");
}

/** Once a day, from 18:00 IST, only when something is waiting. */
export function shouldSendAllocationBoard({ now = Date.now(), lastSentYmd = null, pending = 0 } = {}) {
  if (pending <= 0) return false;
  const ist = new Date(now + 5.5 * 3600e3);
  const ymd = ist.toISOString().slice(0, 10);
  return ist.getUTCHours() >= 18 && lastSentYmd !== ymd;
}
