/**
 * HBLENGINE Q2 FY27 results (filed 2026-11-07, the first real test of the fixed pipeline). Every headline number of the alert was
 * right when read against the filing by hand; the segment red flags were not:
 *   - they came from the STANDALONE segment table (the first one in the filing) while the alert said CONSOLIDATED;
 *   - the segment RESULT (profit) row was printed as if it were revenue, under a second name: the filing's own text says
 *     "Etectronics" in that row, so the alert listed "ELECTRONICS" and "ETECTRONICS" as two segments.
 * Hand-computed from the printed rows (consolidated table): Electronics revenue 363.23 vs 793.59 = -54.2%; Electronics segment result
 * 145.67 vs 461.49 = -68.4%.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { extractDeterministicFinancials, extractSegmentRedFlags } from "../services/financial-validator.service.js";
import { buildVerifiedFinancialsBlock } from "../workers/quarterly-deepdive-worker.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const hbl = fs.readFileSync(path.resolve(here, "fixtures/real-layouts/HBLENGINE_q2fy27-results_2026-11-07.txt"), "utf8");

describe("HBLENGINE Q2 FY27 (real filing): the headline numbers, each computed by hand from the consolidated statement", () => {
  const fin = extractDeterministicFinancials(hbl);
  it("revenue, EBITDA (excluding other income and the associate), margin, PAT of the owners", () => {
    expect(fin.statementScope).toBe("CONSOLIDATED");
    expect(fin.revenue).toBe(871.56);
    expect(fin.revenueYoYGrowthPct).toBeCloseTo(-28.73, 2);            // (871.56 - 1222.90) / 1222.90
    expect(fin.ebitda).toBeCloseTo(229.85, 2);                          // 232.40 + 6.31 + 13.25 - 22.11
    expect(fin.ebitdaMarginPct).toBeCloseTo(26.37, 2);
    expect(fin.ebitdaMarginBpsDelta).toBe(-1812);                       // 26.37% vs 544.05 / 1222.90 = 44.49%
    expect(fin.patAttributable).toBe(192.51);                           // shareholders of the company
    expect(fin.patYoYGrowthPct).toBeCloseTo(-50.29, 2);                 // (192.51 - 387.26) / 387.26
  });
});

describe("segment red flags come from the table of the statement's own scope, revenue and result told apart", () => {
  const fin = extractDeterministicFinancials(hbl);
  it("consolidated scope: Electronics revenue -54.2% (793.59 -> 363.23) and Electronics RESULT -68.4% (461.49 -> 145.67), under one name", () => {
    const flags = fin.segmentRedFlags;
    expect(flags).toContainEqual({ segment: "ELECTRONICS", metric: "revenue", currentValue: 363.23, prevValue: 793.59, yoyDeclinePct: -54.2 });
    expect(flags).toContainEqual({ segment: "ELECTRONICS", metric: "result", currentValue: 145.67, prevValue: 461.49, yoyDeclinePct: -68.4 });
    expect(flags.map((f) => f.segment)).not.toContain("ETECTRONICS");
    expect(flags).toHaveLength(2);
  });

  const table = (title, elecPrev) => [
    `Unaudited ${title} Segment-wise Revenue, Results and Capital Employed`,
    "Particulars 30-Sep-26 | 30-Jun-26 | 30-Sep-25 | 30-Sep-26 | 30-Sep-25 | 31-Mar-26",
    "Segment Revenue",
    "Industrial Batteries 400.00 350.00 380.00 750.00 720.00 1,400.00",
    `Electronics 363.23 227.31 ${elecPrev} 590.54 973.98 1,626.25`,
    "Total 763.23 577.31 1,173.00 1,340.54 1,693.98 3,026.25",
    "Segment Results",
    "Industrial Batteries 88.00 80.00 100.00 168.00 190.00 340.00",
    `Etectronics 145.67 70.73 461.49 216.40 550.63 818.49`,
    "Total 233.67 150.73 561.49 384.40 740.63 1,158.49",
    "Segment Assets"
  ];
  it("with a standalone table first and a consolidated one after it, the flags follow the statement scope; unknown scope takes the first table", () => {
    const lines = [...table("Standalone", "793.58"), ...table("Consolidated", "793.59")];
    const rev = (flags) => flags.find((f) => f.metric === "revenue" && f.segment === "ELECTRONICS");
    expect(rev(extractSegmentRedFlags(lines, 1173, "CONSOLIDATED")).prevValue).toBe(793.59);
    expect(rev(extractSegmentRedFlags(lines, 1173, "STANDALONE")).prevValue).toBe(793.58);
    expect(rev(extractSegmentRedFlags(lines, 1173, null)).prevValue).toBe(793.58);
    expect(rev(extractSegmentRedFlags(lines, 1173, "CONSOLIDATED"))).toBeTruthy();
  });
  it("a typo'd result label (edit distance 1-2 from a revenue label of the same table) is read as that segment, never as a second one", () => {
    const flags = extractSegmentRedFlags(table("Consolidated", "793.59"), 1173, "CONSOLIDATED");
    expect(flags.filter((f) => f.metric === "result").map((f) => f.segment)).toEqual(["ELECTRONICS"]);
  });
  it("a table without a 'Segment Revenue' / 'Segment Results' split still works as before (every row counts as revenue)", () => {
    const old = ["Segment Information", "Alpha 100 110 300 210 600 1200", "Beta 90 80 85 170 160 330"];
    expect(extractSegmentRedFlags(old, 600, null)).toEqual([{ segment: "ALPHA", metric: "revenue", currentValue: 100, prevValue: 300, yoyDeclinePct: -66.7 }]);
  });
});

describe("the verified-financials block says what each segment flag measures", () => {
  it("prints revenue and result flags as two plainly different lines", () => {
    const fin = extractDeterministicFinancials(hbl);
    const block = buildVerifiedFinancialsBlock(fin);
    expect(block).toMatch(/Segment red flag:\* Electronics revenue down 54\.2% YoY \(₹363\.23 Cr vs ₹793\.59 Cr\)/);
    expect(block).toMatch(/Segment red flag:\* Electronics profit \(segment result\) down 68\.4% YoY \(₹145\.67 Cr vs ₹461\.49 Cr\)/);
    expect(block).not.toMatch(/ETECTRONICS/i);
  });
});
