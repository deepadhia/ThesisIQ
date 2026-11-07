/**
 * A single quarter's profit cannot exceed the whole trailing year's profit. Measured on the 16 real verified results of the tracked
 * stocks (quarterly PAT / (market cap / P/E)): all between 0.24 and 0.47. SJS 2026-11-04, read at the wrong unit (₹580.3 million as
 * ₹580.3 crore): 2.82. The ceiling is 1.0, with room on both sides. Unknown inputs are trusted: nothing is withheld on a guess.
 */
import { describe, it, expect } from "vitest";
import { scaleSanity, MAX_QUARTER_TO_TRAILING_PROFIT } from "../services/scale-sanity.service.js";

describe("scaleSanity", () => {
  it("the real SJS misread is caught: 580.3 'Cr' against a trailing profit of 6,596 / 32.1 = 205 Cr", () => {
    const r = scaleSanity({ patCr: 580.3, marketCapCr: 6596, pe: 32.1 });
    expect(r.suspect).toBe(true);
    expect(r.ratio).toBeCloseTo(2.82, 1);
    expect(r.reason).toMatch(/unit/i);
  });
  it("the same quarter at the right unit (58.03 Cr) is fine", () => {
    const r = scaleSanity({ patCr: 58.03, marketCapCr: 6596, pe: 32.1 });
    expect(r.suspect).toBe(false);
    expect(r.ratio).toBeCloseTo(0.28, 1);
  });
  it("every real verified result of the tracked stocks passes (ratios 0.24 to 0.47)", () => {
    for (const [pat, mcap, pe] of [[88.89, 5041, 26.8], [96.35, 9498, 30.5], [34.75, 5715, 49.0], [105.51, 15704, 42.4], [148.31, 8787, 16.8], [130.09, 12688, 27.5], [42.44, 10573, 69.8], [156.88, 15961, 26.7], [102.01, 11036, 27.7], [66.56, 17029, 64.4], [103.94, 5789, 13.5], [38.51, 4265, 26.7], [192.51, 23286, 29.1], [192.45, 44607, 55.4], [58.04, 6279, 25.6], [72.58, 22914, 74.2]]) {
      expect(scaleSanity({ patCr: pat, marketCapCr: mcap, pe }).suspect, `${pat}/${mcap}/${pe}`).toBe(false);
    }
    expect(MAX_QUARTER_TO_TRAILING_PROFIT).toBe(1);
  });
  it("unknown, missing or non-positive inputs are trusted (a loss, no snapshot, a negative P/E)", () => {
    for (const x of [{}, { patCr: 100 }, { patCr: -5, marketCapCr: 1000, pe: 20 }, { patCr: 100, marketCapCr: 1000, pe: -3 }, { patCr: 100, marketCapCr: null, pe: 20 }, { patCr: "x", marketCapCr: 1000, pe: 20 }]) {
      expect(scaleSanity(x).suspect, JSON.stringify(x)).toBe(false);
    }
  });
});
