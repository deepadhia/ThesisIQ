/**
 * "I need only important info which is useful for the share allocation" (user, 2026-11-06).
 * A filing is pushed to Telegram only when it could change how much of the stock is held: the stance (buy / hold / reassess)
 * moved, conviction moved by 2+, the thesis hurdle flipped, a driver got worse, management changed guidance, or the quarter
 * surprised. Everything else goes to ONE end-of-day allocation board, so nothing is silently missed.
 */
import { describe, it, expect } from "vitest";
import {
  classifyAllocationRelevance, buildAllocationLine, buildAllocationBoardMessage, shouldSendAllocationBoard, boardEntryFrom
} from "../services/allocation-relevance.service.js";

const prev = { action: "HOLD / MONITOR", conviction: 6, hurdleStatus: "PASS", assessment: [], guidanceChanges: [] };
const cur = (o = {}) => ({ action: "HOLD / MONITOR", conviction: 6, hurdleStatus: "PASS", assessment: [], guidanceChanges: [], llmFailed: false, ...o });

describe("classifyAllocationRelevance: what is worth a message", () => {
  it("an unchanged view is NOT pushed (HOLD 6/10 -> HOLD 6/10, nothing new)", () => {
    const r = classifyAllocationRelevance({ current: cur(), previous: prev, fin: { patYoYGrowthPct: 12, revenueYoYGrowthPct: 9, ebitdaMarginBpsDelta: 20 } });
    expect(r.push).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it("a stance change is pushed, with the change stated", () => {
    const r = classifyAllocationRelevance({ current: cur({ action: "REASSESS THESIS" }), previous: prev });
    expect(r.push).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/HOLD.*REASSESS/);
    expect(classifyAllocationRelevance({ current: cur({ action: "BUY / ACCUMULATE" }), previous: prev }).push).toBe(true);
  });

  it("different wording of the same stance is not a change (ADD and BUY / ACCUMULATE; WATCH and HOLD)", () => {
    const p = { ...prev, action: "BUY / ACCUMULATE" };
    expect(classifyAllocationRelevance({ current: cur({ action: "ADD" }), previous: p }).push).toBe(false);
    expect(classifyAllocationRelevance({ current: cur({ action: "WATCH / WAIT FOR CONFIRMATION" }), previous: prev }).push).toBe(false);
  });

  it("older stored wording is understood: BUILD POSITION is a buy, WAIT AND WATCH a hold, and a conviction out of 100 is read out of 10", () => {
    const old = { action: "BUILD POSITION", conviction: 85, hurdleStatus: null, assessment: [], guidanceChanges: [] };
    expect(classifyAllocationRelevance({ current: cur({ action: "ADD", conviction: 8 }), previous: old }).push).toBe(false);   // BUY 8.5 -> BUY 8: same view
    expect(classifyAllocationRelevance({ current: cur({ action: "HOLD / MONITOR", conviction: 5 }), previous: { ...old, action: "WAIT AND WATCH", conviction: null } }).push).toBe(false);
    expect(classifyAllocationRelevance({ current: cur({ action: "REASSESS THESIS", conviction: 4 }), previous: old }).reasons.join(" ")).toMatch(/BUY.*REASSESS/);
  });

  it("conviction moving by 2 or more is pushed; by 1 is not", () => {
    expect(classifyAllocationRelevance({ current: cur({ conviction: 4 }), previous: prev }).push).toBe(true);
    expect(classifyAllocationRelevance({ current: cur({ conviction: 8 }), previous: prev }).push).toBe(true);
    expect(classifyAllocationRelevance({ current: cur({ conviction: 5 }), previous: prev }).push).toBe(false);
  });

  it("the thesis hurdle flipping is pushed in either direction", () => {
    expect(classifyAllocationRelevance({ current: cur({ hurdleStatus: "FAIL" }), previous: prev }).reasons.join(" ")).toMatch(/hurdle/i);
    expect(classifyAllocationRelevance({ current: cur({ hurdleStatus: "PASS" }), previous: { ...prev, hurdleStatus: "FAIL" } }).push).toBe(true);
  });

  it("a driver that got WORSE is pushed; the same at-risk driver reported again is not", () => {
    const worse = cur({ assessment: [{ driver: "Order book", status: "AT_RISK", grounded: true, evidence: "orders fell" }] });
    expect(classifyAllocationRelevance({ current: worse, previous: prev }).reasons.join(" ")).toMatch(/Order book/);
    const prevAtRisk = { ...prev, assessment: [{ driver: "Order book", status: "AT_RISK" }] };
    expect(classifyAllocationRelevance({ current: worse, previous: prevAtRisk }).push).toBe(false);
    const broken = cur({ assessment: [{ driver: "Order book", status: "BROKEN", grounded: true, evidence: "x" }] });
    expect(classifyAllocationRelevance({ current: broken, previous: prevAtRisk }).push).toBe(true);
    // an ungrounded status is not evidence
    expect(classifyAllocationRelevance({ current: cur({ assessment: [{ driver: "D", status: "BROKEN", grounded: false }] }), previous: prev }).push).toBe(false);
  });

  it("a guidance change (cut OR raise) is pushed once; the same change repeated by a later filing is not", () => {
    const g = ["Revenue growth outlook: 1.5-2x -> 1.2-1.5x (cut)"];
    const r = classifyAllocationRelevance({ current: cur({ guidanceChanges: g }), previous: prev });
    expect(r.push).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/guidance/i);
    expect(classifyAllocationRelevance({ current: cur({ guidanceChanges: ["EBITDA margin guide raised to 29-30% (raised)"] }), previous: prev }).push).toBe(true);
    const again = classifyAllocationRelevance({ current: cur({ guidanceChanges: ["Growth guidance lowered to 1.2-1.5x from 1.5-2x (cut)"] }), previous: { ...prev, guidanceChanges: g } });
    expect(again.push).toBe(false);
    // "reaffirmed" is not a change
    expect(classifyAllocationRelevance({ current: cur({ guidanceChanges: ["Margin guide: 27-28% (reaffirmed)"] }), previous: prev }).push).toBe(false);
  });

  it("a DOWNSIDE results surprise is pushed even when the stance holds: profit down 15%+, revenue down 5%+, margin down 300+ bps", () => {
    const fin = (o) => ({ patYoYGrowthPct: 10, revenueYoYGrowthPct: 8, ebitdaMarginBpsDelta: 0, ...o });
    expect(classifyAllocationRelevance({ current: cur(), previous: prev, fin: fin({ patYoYGrowthPct: -22 }) }).push).toBe(true);
    expect(classifyAllocationRelevance({ current: cur(), previous: prev, fin: fin({ revenueYoYGrowthPct: -6 }) }).push).toBe(true);
    expect(classifyAllocationRelevance({ current: cur(), previous: prev, fin: fin({ ebitdaMarginBpsDelta: -400 }) }).push).toBe(true);
    expect(classifyAllocationRelevance({ current: cur(), previous: prev, fin: fin({ patYoYGrowthPct: -8, ebitdaMarginBpsDelta: -180 }) }).push).toBe(false);
  });

  it("a strong quarter is NOT a message by itself (backtest 2026-11-06: profit +29% / +35% / +74% were followed by -8.8% / -5.7% / flat; the stance carries a real upgrade)", () => {
    const fin = (o) => ({ patYoYGrowthPct: 10, revenueYoYGrowthPct: 8, ebitdaMarginBpsDelta: 0, ...o });
    expect(classifyAllocationRelevance({ current: cur(), previous: prev, fin: fin({ patYoYGrowthPct: 34.8 }) }).push).toBe(false);
    expect(classifyAllocationRelevance({ current: cur(), previous: prev, fin: fin({ patYoYGrowthPct: 74, revenueYoYGrowthPct: 34, ebitdaMarginBpsDelta: 600 }) }).push).toBe(false);
  });

  it("when relevance cannot be judged the filing is pushed, never hidden: no previous stance on a non-HOLD view, or an AI read that failed", () => {
    expect(classifyAllocationRelevance({ current: cur({ action: "BUY / ACCUMULATE" }), previous: null }).push).toBe(true);
    expect(classifyAllocationRelevance({ current: cur(), previous: null }).push).toBe(false);          // a first HOLD is routine
    expect(classifyAllocationRelevance({ current: cur({ llmFailed: true }), previous: prev }).push).toBe(true);
  });
});

describe("only verified results may move the stance on their own (damper for same-day flip-flops: HSCL REASSESS then HOLD, SHAKTIPUMP REASSESS / HOLD / REASSESS)", () => {
  it("a deck or call (stanceAuthoritative: false) does not push on a stance or conviction change alone", () => {
    const r = classifyAllocationRelevance({ current: cur({ action: "REASSESS THESIS", conviction: 3, stanceAuthoritative: false }), previous: prev });
    expect(r.push).toBe(false);
  });
  it("but it still pushes on what it actually says: guidance, a worse driver, a flipped hurdle", () => {
    expect(classifyAllocationRelevance({ current: cur({ stanceAuthoritative: false, guidanceChanges: ["Revenue outlook 1.5-2x -> 1.2-1.5x (cut)"] }), previous: prev }).push).toBe(true);
    expect(classifyAllocationRelevance({ current: cur({ stanceAuthoritative: false, assessment: [{ driver: "D", status: "BROKEN", grounded: true }] }), previous: prev }).push).toBe(true);
    expect(classifyAllocationRelevance({ current: cur({ stanceAuthoritative: false, hurdleStatus: "FAIL" }), previous: prev }).push).toBe(true);
  });
  it("results whose numbers could not be verified are always pushed (relevance cannot be judged)", () => {
    const r = classifyAllocationRelevance({ current: cur({ unverifiedResults: true }), previous: prev });
    expect(r.push).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/could not be verified/i);
  });
});

describe("flash-to-flash flip-flops (HSCL 10-16 REASSESS 4/10 then 10-17 HOLD 5/10 from a partial parse; SHAKTIPUMP 10-23 REASSESS, 10-25 HOLD, 10-26 REASSESS)", () => {
  const justNow = { ...prev, action: "REASSESS THESIS", conviction: 4, ageHours: 20, stanceBefore: "BUY / ACCUMULATE" };

  it("within 72 h of the last judgement, results with INCOMPLETE numbers cannot overturn the stance or conviction", () => {
    const r = classifyAllocationRelevance({ current: cur({ action: "HOLD / MONITOR", conviction: 5, numbersComplete: false }), previous: justNow });
    expect(r.push).toBe(false);
    // the same filing with complete numbers is a real re-judgement and is pushed
    expect(classifyAllocationRelevance({ current: cur({ action: "HOLD / MONITOR", conviction: 5, numbersComplete: true }), previous: justNow }).push).toBe(true);
    // after 72 h the damper no longer applies
    expect(classifyAllocationRelevance({ current: cur({ action: "HOLD / MONITOR", conviction: 5, numbersComplete: false }), previous: { ...justNow, ageHours: 100 } }).push).toBe(true);
  });

  it("a move straight back to the stance the stock had before the last change, within 72 h, is not pushed (it is the same event judged twice)", () => {
    const heldBetween = { ...prev, action: "HOLD / MONITOR", conviction: 5, ageHours: 30, stanceBefore: "REASSESS THESIS" };
    const r = classifyAllocationRelevance({ current: cur({ action: "REASSESS THESIS", conviction: 4, numbersComplete: true }), previous: heldBetween });
    expect(r.push).toBe(false);
    // not a reversal: a move to a third stance is still pushed
    expect(classifyAllocationRelevance({ current: cur({ action: "BUY / ACCUMULATE", conviction: 8 }), previous: heldBetween }).push).toBe(true);
  });

  it("a damped flip never hides real news: a driver, hurdle or guidance change still pushes", () => {
    const heldBetween = { ...prev, action: "HOLD / MONITOR", ageHours: 30, stanceBefore: "REASSESS THESIS" };
    const r = classifyAllocationRelevance({ current: cur({ action: "REASSESS THESIS", numbersComplete: false, hurdleStatus: "FAIL" }), previous: heldBetween });
    expect(r.push).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/hurdle/i);
    expect(r.reasons.join(" ")).not.toMatch(/stance/i);
  });
});

describe("the allocation line that leads a pushed message", () => {
  it("names the stance move and the reasons in one line", () => {
    const r = classifyAllocationRelevance({ current: cur({ action: "REASSESS THESIS", conviction: 4 }), previous: prev });
    const line = buildAllocationLine({ ticker: "SJS", ...r, current: cur({ action: "REASSESS THESIS", conviction: 4 }), previous: prev });
    expect(line).toMatch(/ALLOCATION/);
    expect(line).toMatch(/HOLD.*REASSESS THESIS/);
    expect(line).toMatch(/6.*4/);
    expect(line.split("\n").length).toBe(1);
  });
});

describe("the end-of-day allocation board", () => {
  const e = (o) => boardEntryFrom({ ticker: "SJS", kinds: ["PRESS", "DECK"], action: "HOLD / MONITOR", conviction: 6, gist: "Nothing changes the view.", ...o });

  it("lists each stock once with its stance, what was filed and a one-line gist", () => {
    const msg = buildAllocationBoardMessage([e({}), e({ ticker: "TIMETECHNO", kinds: ["CONCALL"], gist: "Call confirms margin guide." }), e({ ticker: "SJS", kinds: ["AUDIO"] })], { todayYmd: "2026-11-06" });
    expect(msg).toMatch(/ALLOCATION BOARD/);
    expect(msg).toContain("06 Nov");
    expect(msg.match(/SJS/g).length).toBe(1);
    expect(msg).toContain("TIMETECHNO");
    expect(msg).toMatch(/HOLD/);
    expect(msg).toMatch(/press release/i);
    expect(msg).toContain("Call confirms margin guide.");
  });
  it("is null when nothing was filed", () => {
    expect(buildAllocationBoardMessage([], { todayYmd: "2026-11-06" })).toBeNull();
  });
  it("keeps every line short", () => {
    const long = "word ".repeat(80);
    const msg = buildAllocationBoardMessage([e({ gist: long })], { todayYmd: "2026-11-06" });
    expect(Math.max(...msg.split("\n").map((l) => l.length))).toBeLessThan(260);
  });
  it("is sent once a day, after 18:00 IST, only when something is waiting", () => {
    const at = (h, m = 0) => Date.parse(`2026-11-06T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
    expect(shouldSendAllocationBoard({ now: at(17, 59), lastSentYmd: "2026-11-05", pending: 3 })).toBe(false);
    expect(shouldSendAllocationBoard({ now: at(18, 0), lastSentYmd: "2026-11-05", pending: 3 })).toBe(true);
    expect(shouldSendAllocationBoard({ now: at(19, 0), lastSentYmd: "2026-11-06", pending: 3 })).toBe(false);
    expect(shouldSendAllocationBoard({ now: at(19, 0), lastSentYmd: "2026-11-05", pending: 0 })).toBe(false);
  });
});

import { classifyDirectEvent, MATERIAL_PCT_OF_MCAP } from "../services/allocation-relevance.service.js";

describe("direct scanner alerts (orders, capex, credit, routine filings): only what matters for allocation is pushed", () => {
  const ev = (o) => ({ category: "GENERAL", priority: "MEDIUM", impact: "POSITIVE", amountCr: null, marketCapCr: null, ...o });

  it("structural and risk events always push: credit event, governance, regulatory action, capital raise, restructuring", () => {
    for (const category of ["CREDIT_EVENT", "GOVERNANCE_RISK", "REGULATORY_ACTION", "CAPITAL_RAISE", "RESTRUCTURING"]) {
      expect(classifyDirectEvent(ev({ category, priority: "MEDIUM" })).push, category).toBe(true);
    }
  });

  it("an order / capex / acquisition is pushed only when it is material to the company (>= 3% of market cap)", () => {
    expect(MATERIAL_PCT_OF_MCAP).toBe(3);
    const big = classifyDirectEvent(ev({ category: "ORDER_WIN", amountCr: 300, marketCapCr: 7000 }));   // 4.3%
    expect(big.push).toBe(true);
    expect(big.reason).toMatch(/4\.3% of market cap/);
    const small = classifyDirectEvent(ev({ category: "ORDER_WIN", amountCr: 60, marketCapCr: 7000 })); // 0.9%
    expect(small.push).toBe(false);
    expect(small.reason).toMatch(/0\.9% of market cap/);
    expect(classifyDirectEvent(ev({ category: "CAPEX_COMMISSIONING", amountCr: 500, marketCapCr: 7000 })).push).toBe(true);
    expect(classifyDirectEvent(ev({ category: "ACQUISITION", amountCr: 40, marketCapCr: 7000 })).push).toBe(false);
  });

  it("an unknown size is not guessed: pushed only if the AI rated it HIGH; an acquisition of unknown size is pushed", () => {
    expect(classifyDirectEvent(ev({ category: "ORDER_WIN", priority: "MEDIUM" })).push).toBe(false);
    expect(classifyDirectEvent(ev({ category: "ORDER_WIN", priority: "HIGH" })).push).toBe(true);
    expect(classifyDirectEvent(ev({ category: "ACQUISITION", priority: "MEDIUM" })).push).toBe(true);
    expect(classifyDirectEvent(ev({ category: "ORDER_WIN", amountCr: 300, marketCapCr: null, priority: "MEDIUM" })).push).toBe(false);
  });

  it("bad news is never held back: a NEGATIVE order / capex event pushes whatever its size", () => {
    expect(classifyDirectEvent(ev({ category: "ORDER_WIN", impact: "NEGATIVE", amountCr: 10, marketCapCr: 7000 })).push).toBe(true);
    expect(classifyDirectEvent(ev({ category: "GENERAL", impact: "NEGATIVE", priority: "MEDIUM" })).push).toBe(true);
  });

  it("routine compliance, general filings and dividends wait on the board unless the AI rated them HIGH and non-neutral", () => {
    for (const category of ["ROUTINE_COMPLIANCE", "GENERAL", "AGM_DISCLOSURE", "CAPITAL_RETURN"]) {
      expect(classifyDirectEvent(ev({ category, priority: "MEDIUM" })).push, category).toBe(false);
      expect(classifyDirectEvent(ev({ category, priority: "HIGH", impact: "POSITIVE" })).push, category + " HIGH").toBe(true);
      expect(classifyDirectEvent(ev({ category, priority: "HIGH", impact: "NEUTRAL" })).push, category + " HIGH neutral").toBe(false);
    }
  });

  it("an unknown category is treated like a general filing", () => {
    expect(classifyDirectEvent(ev({ category: "SOMETHING_NEW", priority: "MEDIUM" })).push).toBe(false);
  });
});

describe("board entries for filings that have no stance (direct events)", () => {
  it("the stance is omitted, not invented, and the category reads as a plain word", () => {
    const e = boardEntryFrom({ ticker: "sjs", kinds: ["ORDER_WIN"], gist: "Order worth Rs 60 Cr, 0.9% of market cap." });
    expect(e.stance).toBeNull();
    const msg = buildAllocationBoardMessage([e], { todayYmd: "2026-11-06" });
    expect(msg).toContain("SJS");
    expect(msg).toMatch(/order win/i);
    expect(msg).not.toMatch(/HOLD|BUY|REASSESS/);
  });
  it("a stance-less entry does not erase the stance of a stock that has one", () => {
    const msg = buildAllocationBoardMessage([
      boardEntryFrom({ ticker: "SJS", kinds: ["DECK"], action: "HOLD / MONITOR", conviction: 6, gist: "x" }),
      boardEntryFrom({ ticker: "SJS", kinds: ["ORDER_WIN"], gist: "Order." })
    ], { todayYmd: "2026-11-06" });
    expect(msg.match(/SJS/g).length).toBe(1);
    expect(msg).toMatch(/HOLD \/ MONITOR \(6\/10\)/);
    expect(msg).toMatch(/investor deck, order win/);
  });
});

describe("guidance pacing is a first-class reason (stock prices move on guidance AND on whether it is being fulfilled)", () => {
  const cur2 = (o = {}) => ({ action: "HOLD / MONITOR", conviction: 6, hurdleStatus: "PASS", assessment: [], guidanceChanges: [], llmFailed: false, pacing: [], ...o });
  const prev2 = (pacing) => ({ action: "HOLD / MONITOR", conviction: 6, hurdleStatus: "PASS", assessment: [], guidanceChanges: [], pacing });
  const p = (status, o = {}) => ({ key: "REVENUE_GROWTH|FY27", label: "Revenue growth", fy: "FY27", guidedText: "13–14% growth", status, ...o });

  it("pacing that WORSENS to stretch / behind is pushed, naming the guide and both statuses", () => {
    const r = classifyAllocationRelevance({ current: cur2({ pacing: [p("BEHIND")] }), previous: prev2([p("ON_TRACK")]) });
    expect(r.push).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/guidance pacing.*Revenue growth FY27.*BEHIND.*was ON TRACK/);
    expect(classifyAllocationRelevance({ current: cur2({ pacing: [p("STRETCH")] }), previous: prev2([p("AHEAD")]) }).push).toBe(true);
  });

  it("pacing that RECOVERS from behind to on track / ahead is pushed", () => {
    const r = classifyAllocationRelevance({ current: cur2({ pacing: [p("ON_TRACK")] }), previous: prev2([p("BEHIND")]) });
    expect(r.push).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/pacing recovered/i);
  });

  it("the same status again, or a small move that stays on track, is not pushed", () => {
    expect(classifyAllocationRelevance({ current: cur2({ pacing: [p("BEHIND")] }), previous: prev2([p("BEHIND")]) }).push).toBe(false);
    expect(classifyAllocationRelevance({ current: cur2({ pacing: [p("ON_TRACK")] }), previous: prev2([p("AHEAD")]) }).push).toBe(false);
    expect(classifyAllocationRelevance({ current: cur2({ pacing: [p("STRETCH")] }), previous: prev2([p("STRETCH")]) }).push).toBe(false);
  });

  it("a first reading is pushed only when it is BEHIND (stretch / on track on first sight is routine)", () => {
    expect(classifyAllocationRelevance({ current: cur2({ pacing: [p("BEHIND")] }), previous: prev2([]) }).push).toBe(true);
    expect(classifyAllocationRelevance({ current: cur2({ pacing: [p("STRETCH")] }), previous: prev2([]) }).push).toBe(false);
    expect(classifyAllocationRelevance({ current: cur2({ pacing: [p("BEHIND")] }), previous: null }).push).toBe(true);
  });

  it("works for a deck / call too (pacing is not a stance, so it is not damped)", () => {
    const r = classifyAllocationRelevance({ current: cur2({ stanceAuthoritative: false, pacing: [p("BEHIND")] }), previous: prev2([p("ON_TRACK")]) });
    expect(r.push).toBe(true);
  });
});
