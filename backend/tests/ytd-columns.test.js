/**
 * Guidance pacing needs the cumulative columns a Q2 / Q3 statement already prints: the half-year (nine-month) figures, last year's
 * same period, and last year's full year. They were parsed and thrown away. Expected values below are computed by hand from the rows
 * of the real SHAKTIPUMP Q2 FY27 consolidated statement (fixtures/shaktipump-q2fy27-results.txt):
 *   Revenue from operations  746.03  858.67  666.35  1,604.70  1,288.85  2,697.61   (H1 = 746.03 + 858.67)
 *   Profit for the period     38.51   51.59   90.71     90.10    187.54    257.58   (H1 = 38.51 + 51.59)
 *   PBT 120.58 / 251.18 / 359.15, finance cost 33.42 / 23.06 / 59.07, depreciation 15.68 / 12.72 / 28.32, other income 22.79 / 7.44 / 24.84
 *   EBITDA (PBT + finance + depreciation - other income) = 146.89 / 279.52 / 421.70
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { extractDeterministicFinancials } from "../services/financial-validator.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const shakti = fs.readFileSync(path.resolve(here, "fixtures/shaktipump-q2fy27-results.txt"), "utf8");

describe("cumulative columns of a Q2 statement (real SHAKTIPUMP page)", () => {
  const fin = extractDeterministicFinancials(shakti);

  it("reads the half-year and last year's figures, in crores", () => {
    expect(fin.ytdMonths).toBe(6);
    expect(fin.ytdRevenue).toBe(1604.7);
    expect(fin.ytdRevenuePrior).toBe(1288.85);
    expect(fin.fyPriorRevenue).toBe(2697.61);
    expect(fin.ytdRevenueYoYGrowthPct).toBeCloseTo(24.51, 1);   // 1604.70 / 1288.85 - 1
    expect(fin.ytdPat).toBe(90.1);
    expect(fin.ytdPatPrior).toBe(187.54);
    expect(fin.fyPriorPat).toBe(257.58);
    expect(fin.ytdPatYoYGrowthPct).toBeCloseTo(-51.96, 1);       // 90.10 / 187.54 - 1
  });

  it("derives EBITDA and margin for the half-year and for last year with the same definition as the quarter", () => {
    expect(fin.ytdEbitda).toBeCloseTo(146.89, 1);
    expect(fin.ytdEbitdaPrior).toBeCloseTo(279.52, 1);
    expect(fin.fyPriorEbitda).toBeCloseTo(421.7, 1);
    expect(fin.ytdEbitdaMarginPct).toBeCloseTo(9.15, 1);          // 146.89 / 1604.70
    expect(fin.ytdEbitdaMarginPriorPct).toBeCloseTo(21.69, 1);    // 279.52 / 1288.85
  });

  it("the quarterly figures are unchanged", () => {
    expect(fin.revenue).toBe(746.03);
    expect(fin.patYoYGrowthPct).toBeCloseTo(-57.55, 1);
  });
});

describe("cumulative columns are never guessed", () => {
  it("a half-year figure that is not the sum of the two quarters is a mis-read column: nothing is reported", () => {
    const broken = shakti.replace("1,604.70", "999.00");
    const fin = extractDeterministicFinancials(broken);
    expect(fin.revenue).toBe(746.03);
    expect(fin.ytdRevenue ?? null).toBeNull();
    expect(fin.fyPriorRevenue ?? null).toBeNull();
  });

  it("a year-ago full year smaller than the year-ago half is not accepted", () => {
    const broken = shakti.replace("2,697.61", "1,000.00");
    const fin = extractDeterministicFinancials(broken);
    expect(fin.ytdRevenue ?? null).toBeNull();
  });

  it("a statement that is not a Q2 / Q3 layout (a March quarter) reports no cumulative figures", () => {
    const march = shakti.replace(/September 30,\s*2026/g, "March 31, 2027");   // header dates are split across lines in the fixture
    const fin = extractDeterministicFinancials(march);
    expect(fin.quarterEnded).toBe("2027-03-31");
    expect(fin.ytdRevenue ?? null).toBeNull();
  });
});

describe("whatever real statement is read, cumulative figures obey the arithmetic or are absent", () => {
  const dir = path.resolve(here, "fixtures/real-layouts");
  const files = fs.readdirSync(dir).filter((f) => /^[A-Z]+_2026-\d\d-\d\d\.txt$/.test(f));
  it.each(files)("%s", (name) => {
    const fin = extractDeterministicFinancials(fs.readFileSync(path.join(dir, name), "utf8"));
    if (!fin || fin.ytdRevenue === undefined || fin.ytdRevenue === null) return;     // absent is fine
    expect(fin.ytdRevenue).toBeGreaterThan(fin.revenue);
    if (fin.fyPriorRevenue !== undefined && fin.fyPriorRevenue !== null) expect(fin.fyPriorRevenue).toBeGreaterThanOrEqual(fin.ytdRevenuePrior);   // some layouts print no full-year column
    expect([6, 9]).toContain(fin.ytdMonths);
  });
});

describe("other layouts", () => {
  it("a FIVE-column September statement (TRANSRAIL: no last-full-year column) reports the half-year and no full-year base (real page; 2,030.22 + 1,702.45 = 3,732.67)", () => {
    const fin = extractDeterministicFinancials(fs.readFileSync(path.resolve(here, "fixtures/real-layouts/TRANSRAILL_2026-11-03.txt"), "utf8"));
    expect(fin.ytdMonths).toBe(6);
    expect(fin.ytdRevenue).toBe(3732.67);
    expect(fin.ytdRevenuePrior).toBe(3171.31);
    expect(fin.ytdRevenueYoYGrowthPct).toBeCloseTo(17.7, 0);
    expect(fin.fyPriorRevenue ?? null).toBeNull();
  });

  it("a March quarter with five columns reports the FULL YEAR just ended (the outcome a year's guidance is judged on), by hand: 3,100 vs 2,600, PAT 327 vs 247, EBITDA 436 + 70 + 36 - 36 = 506", () => {
    const fin = extractDeterministicFinancials(fs.readFileSync(path.resolve(here, "fixtures/q4-five-column-synthetic.txt"), "utf8"));
    expect(fin.quarterEnded).toBe("2027-03-31");
    expect(fin.fyRevenue).toBe(3100);
    expect(fin.fyRevenuePrior).toBe(2600);
    expect(fin.fyRevenueYoYGrowthPct).toBeCloseTo(19.23, 1);
    expect(fin.fyPat).toBe(327);
    expect(fin.fyPatYoYGrowthPct).toBeCloseTo(32.39, 1);
    expect(fin.fyEbitda).toBeCloseTo(506, 0);
    expect(fin.fyEbitdaMarginPct).toBeCloseTo(16.32, 1);
    expect(fin.fyEnded).toBe("2027-03-31");
    expect(fin.ytdMonths ?? null).toBeNull();
  });

  it("when the header dates are unreadable the filing date decides which quarter it is (SHAKTIPUMP's real PDF printed no readable dates)", async () => {
    const { quarterEndBefore } = await import("../services/financial-validator.service.js");
    expect(quarterEndBefore("2026-10-23T12:55:00Z")).toBe("2026-09-30");
    expect(quarterEndBefore("2026-11-04")).toBe("2026-09-30");
    expect(quarterEndBefore("2027-05-20")).toBe("2027-03-31");
    expect(quarterEndBefore("2026-08-10")).toBe("2026-06-30");
    expect(quarterEndBefore("2027-02-05")).toBe("2026-12-31");
    expect(quarterEndBefore(null)).toBeNull();
    // and the hint is what unlocks the cumulative columns of a statement whose own dates cannot be read
    const noDates = shakti.replace(/(?:March|June|September|December) \d\d,\s*\d{4}/g, "");
    expect(extractDeterministicFinancials(noDates).ytdRevenue ?? null).toBeNull();
    expect(extractDeterministicFinancials(noDates, { periodEndHint: "2026-09-30" }).ytdRevenue).toBe(1604.7);
  });
});
