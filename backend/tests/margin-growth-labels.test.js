/**
 * A percentage the model attaches to the WRONG measure (handoff 11-06 fix #1). The grounding guard only checks that a number
 * appears somewhere in the document; it did not check what the sentence says the number IS:
 *   TIMETECHNO flash: "YoY growth of 13.19% in EBITDA"      -> 13.19% is the margin; EBITDA growth is +18.12%
 *   SKIPPER board:    "10.5% EBITDA margin expansion"       -> 10.58% is the margin level; the margin moved -10 bps
 *   SBCL recording:   "48% EBITDA margin"                   -> 48% was a growth figure; the margin is ~25%
 */
import { describe, it, expect } from "vitest";
import { applyInstitutionalGuard, mislabelsMarginOrGrowth } from "../services/institutional-guard.service.js";

const fin = {
  isFinancialResult: true,
  statementScope: "CONSOLIDATED",
  unit: "CRORES",
  revenue: 500,
  ebitda: 65.95,
  ebitdaMarginPct: 13.19,
  ebitdaYoYGrowthPct: 18.12,
  revenueYoYGrowthPct: 9.4,
  patConsolidated: 30,
  patAttributable: 30,
  patYoYGrowthPct: 12.0,
};
const raw = "EBITDA margin 13.19% EBITDA growth 18.12% revenue 500 10.58% 48% margin";

describe("mislabelsMarginOrGrowth", () => {
  it("flags a margin LEVEL described as growth", () => {
    expect(mislabelsMarginOrGrowth("YoY growth of 13.19% in EBITDA.", fin)).toBe(true);
    expect(mislabelsMarginOrGrowth("EBITDA grew 13.19% year on year.", fin)).toBe(true);
  });
  it("flags a margin level described as expansion (also when written slightly rounded)", () => {
    expect(mislabelsMarginOrGrowth("10.5% EBITDA margin expansion.", { ...fin, ebitdaMarginPct: 10.58 })).toBe(true);
    expect(mislabelsMarginOrGrowth("EBITDA margin expansion of 13.19%.", fin)).toBe(true);
  });
  it("flags a growth figure presented as the EBITDA margin", () => {
    expect(mislabelsMarginOrGrowth("EBITDA margin of 18.12% in the quarter.", fin)).toBe(true);
  });
  it("flags a bare 'N% EBITDA margin' far from the verified margin when nothing qualifies it", () => {
    expect(mislabelsMarginOrGrowth("The company delivered a 48% EBITDA margin.", fin)).toBe(true);
  });

  it("does NOT flag the correct statements", () => {
    expect(mislabelsMarginOrGrowth("EBITDA grew 18.12% YoY with a margin of 13.19%.", fin)).toBe(false);
    expect(mislabelsMarginOrGrowth("EBITDA margin was 13.19% in the quarter.", fin)).toBe(false);
    expect(mislabelsMarginOrGrowth("EBITDA margin improved to 13.19%.", fin)).toBe(false);
    expect(mislabelsMarginOrGrowth("Revenue growth of 9.4% YoY.", fin)).toBe(false);
    expect(mislabelsMarginOrGrowth("EBITDA margin expansion of 150 bps.", fin)).toBe(false);
  });
  it("does NOT flag segment, half-year or target statements about a different margin", () => {
    expect(mislabelsMarginOrGrowth("Export segment EBITDA margin of 48%.", fin)).toBe(false);
    expect(mislabelsMarginOrGrowth("Management targets a 48% EBITDA margin in the new plant.", fin)).toBe(false);
    expect(mislabelsMarginOrGrowth("EBITDA margin rose from 40% to 48% in H1.", fin)).toBe(false);
  });
  it("is silent without verified figures", () => {
    expect(mislabelsMarginOrGrowth("YoY growth of 13.19% in EBITDA.", null)).toBe(false);
    expect(mislabelsMarginOrGrowth("YoY growth of 13.19% in EBITDA.", { ...fin, ebitdaMarginPct: null })).toBe(false);
  });
});

describe("deck highlights are checked against the verified results too (SJS deck alert mixed 35.83% and 31.0% margins)", () => {
  it("sanitizeConcallHighlights drops a mislabelled bullet when verified financials are supplied, and is unchanged without them", async () => {
    const { sanitizeConcallHighlights } = await import("../services/institutional-guard.service.js");
    const h = { financial_performance: ["YoY growth of 13.19% in EBITDA.", "EBITDA grew 18.12% year on year."], key_positives: [] };
    const doc = "EBITDA growth of 13.19% was reported; EBITDA grew 18.12% year on year.";
    expect(sanitizeConcallHighlights(h, doc, fin).financial_performance).toEqual(["EBITDA grew 18.12% year on year."]);
    expect(sanitizeConcallHighlights(h, doc).financial_performance).toHaveLength(2);
  });
});

describe("the guard removes the mislabelled sentences before anything is sent", () => {
  it("drops the TIMETECHNO summary sentence and keeps the correct one", () => {
    const verdict = {
      summary: "Revenue grew steadily. YoY growth of 13.19% in EBITDA. EBITDA grew 18.12% YoY.",
      verdict_summary: "Revenue grew steadily. YoY growth of 13.19% in EBITDA. EBITDA grew 18.12% YoY.",
      _raw_text: raw,
    };
    const out = applyInstitutionalGuard(verdict, fin, "Financial results", "TIMETECHNO");
    expect(out.summary).not.toContain("13.19% in EBITDA");
    expect(out.summary).toContain("EBITDA grew 18.12% YoY");
  });

  it("drops a mislabelled bullet, and a thesis driver resting only on such a sentence falls back to NO_EVIDENCE", () => {
    const verdict = {
      summary: "Results in line.",
      key_positives: ["EBITDA margin of 18.12% in the quarter.", "Revenue growth of 9.4% YoY."],
      thesis_driver_assessment: [
        { driver: "Margin expansion", status: "ON_TRACK", evidence: "10.58% EBITDA margin expansion YoY.", materiality: "HIGH" },
        { driver: "Volume growth", status: "ON_TRACK", evidence: "Revenue growth of 9.4% YoY.", materiality: "HIGH" },
      ],
      _raw_text: raw,
    };
    const out = applyInstitutionalGuard(verdict, { ...fin, ebitdaMarginPct: 10.58 }, "Financial results", "SKIPPER");
    expect(out.key_positives).toEqual(["Revenue growth of 9.4% YoY."]);
    const byName = Object.fromEntries(out.thesis_driver_assessment.map((a) => [a.driver, a]));
    expect(byName["Margin expansion"].status).toBe("NO_EVIDENCE");
    expect(byName["Volume growth"].status).toBe("ON_TRACK");
  });
});
