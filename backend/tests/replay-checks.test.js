/**
 * The pre-deploy replay: every recent results statement of the tracked stocks is parsed again with the code about to be deployed and
 * checked for the failure classes that have actually gone live (a unit read at the wrong scale, an unparseable statement, one
 * segment under two names). Each check below is a real incident of 2026-11-06/07.
 */
import { describe, it, expect } from "vitest";
import { checkParsedResult } from "../services/replay-checks.service.js";

const good = { revenue: 871.56, unit: "CRORES", ebitdaMarginPct: 26.37, patAttributable: 192.51, revenueYoYGrowthPct: -28.73, segmentRedFlags: [] };
const snap = { market_cap: 23286, pe_ratio: 29.1 };
const codes = (r) => r.issues.map((i) => i.code);

describe("checkParsedResult", () => {
  it("a sound result (HBLENGINE Q2 FY27 as verified by hand) has no issues", () => {
    const r = checkParsedResult({ fin: good, declaredUnit: "crore", snapshot: snap });
    expect(r.issues).toEqual([]);
    expect(r.level).toBe("PASS");
  });
  it("SJS: profit read at the wrong unit is a FAIL (quarter 580.3 vs a trailing year of 205 Cr)", () => {
    const r = checkParsedResult({ fin: { ...good, revenue: 2827.28, patAttributable: 580.3, unit: "CRORES" }, declaredUnit: "million", snapshot: { market_cap: 6596, pe_ratio: 32.1 } });
    expect(codes(r)).toContain("SCALE_IMPLAUSIBLE");
    expect(r.level).toBe("FAIL");
  });
  it("SJS: a statement parsed in crores while the filing declares millions is flagged even with no market data", () => {
    const r = checkParsedResult({ fin: { ...good, unit: "CRORES" }, declaredUnit: "million", snapshot: null });
    expect(codes(r)).toContain("UNIT_DISAGREES_WITH_FILING");
    expect(r.level).toBe("WARN");
  });
  it("an unparseable statement is a WARN (it needs OCR), not a pass", () => {
    expect(checkParsedResult({ fin: null, declaredUnit: null, snapshot: snap }).level).toBe("WARN");
    expect(codes(checkParsedResult({ fin: { revenue: null }, declaredUnit: null, snapshot: snap }))).toContain("NOT_PARSED");
  });
  it("HBLENGINE: one segment listed under two names (Etectronics) is a FAIL", () => {
    const flags = [{ segment: "ELECTRONICS", metric: "result", currentValue: 1, prevValue: 9, yoyDeclinePct: -88 }, { segment: "ETECTRONICS", metric: "result", currentValue: 2, prevValue: 9, yoyDeclinePct: -77 }];
    expect(codes(checkParsedResult({ fin: { ...good, segmentRedFlags: flags }, declaredUnit: "crore", snapshot: snap }))).toContain("SEGMENT_NAME_DUPLICATE");
  });
  it("the same segment as a revenue flag and a result flag is NOT a duplicate", () => {
    const flags = [{ segment: "ELECTRONICS", metric: "revenue", currentValue: 1, prevValue: 9, yoyDeclinePct: -88 }, { segment: "ELECTRONICS", metric: "result", currentValue: 2, prevValue: 9, yoyDeclinePct: -77 }];
    expect(checkParsedResult({ fin: { ...good, segmentRedFlags: flags }, declaredUnit: "crore", snapshot: snap }).issues).toEqual([]);
  });
  it("an impossible margin is a FAIL; an extreme growth rate a WARN", () => {
    expect(codes(checkParsedResult({ fin: { ...good, ebitdaMarginPct: 240 }, declaredUnit: "crore", snapshot: snap }))).toContain("MARGIN_IMPOSSIBLE");
    const r = checkParsedResult({ fin: { ...good, revenueYoYGrowthPct: 950 }, declaredUnit: "crore", snapshot: snap });
    expect(codes(r)).toContain("GROWTH_EXTREME");
    expect(r.level).toBe("WARN");
  });
  it("the worst issue sets the level", () => {
    const r = checkParsedResult({ fin: { ...good, ebitdaMarginPct: 240, revenueYoYGrowthPct: 950 }, declaredUnit: "crore", snapshot: snap });
    expect(r.level).toBe("FAIL");
  });
});
