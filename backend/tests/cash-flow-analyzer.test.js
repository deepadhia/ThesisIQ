import { describe, it, expect } from "vitest";
import {
  extractDeterministicCashFlow,
  extractEarningsQualityMetrics,
  formatCashFlowAndQualitySection
} from "../services/cash-flow-analyzer.service.js";

const QPOWER_CF_SAMPLE = `
STATEMENT OF CONSOLIDATED CASH FLOWS FOR THE HALF YEAR ENDED 30TH SEPTEMBER 2026
(Rs. in Millions)

CASH FLOW FROM OPERATING ACTIVITIES:
Net Profit before tax as per Statement of Profit & Loss 1,366.16 886.17 2,164.33
Adjustment for : - -
Depreciation and amortization Expenses 78.02 56.67 130.01
Finance Cost 43.17 34.28 68.05
Notional Gain on Listed Equity Shares 0.04 - 3.42
Interest on Fixed Deposit (131.48) (149.64) (307.54)
Gross up effect of Hyper Inflation of Step Down Subsidiary (220.07) (109.35) (189.80)
Operating profit before working capital changes 1,186.46 757.91 2,028.27
Working Capital Changes
(Increase)/Decrease in Trade Receivables 106.99 (707.72) (1,057.13)
(Increase)/Decrease in Inventory (1,031.96) (163.58) (143.67)
(Increase)/Decrease in Other Current & Non Current Assets (507.19) (510.35) (593.83)
Increase/(Decrease) in Trade Payables 290.70 422.51 727.92
Increase/(Decrease) in Other Current Liabilities & Provision 229.09 162.10 171.83
Cash generated from operations 274.09 (39.13) 1,133.38
Less:- Income Taxes paid 203.30 80.51 330.54
Net cash flow from operating activities A 70.79 (119.64) 802.84
B) CASH FLOW FROM INVESTING ACTIVITIES:
Purchase of PPE including of CWIP (512.69) (211.26) (1,291.43)
Sale of PPE 27.03 3.13 32.74
`;

const CRORES_CF_SAMPLE = `
CONSOLIDATED STATEMENT OF CASH FLOWS FOR THE HALF YEAR ENDED SEPTEMBER 30, 2026
(Rs. in Crores)

CASH FLOWS FROM OPERATING ACTIVITIES:
Profit Before Tax 450.50 320.10
Operating Profit before working capital changes 485.20 340.00
(Increase) / decrease in trade receivables (45.00) (80.00)
(Increase) / decrease in inventories (25.50) (15.00)
Increase / (decrease) in trade payables 30.20 22.00
Cash generated from operations 444.90 267.00
Direct taxes paid (net of refunds) (95.00) (65.00)
Net cash from operating activities 349.90 202.00
CASH FLOWS FROM INVESTING ACTIVITIES:
Purchase of property, plant and equipment (120.00) (85.00)
`;

describe("cash-flow-analyzer", () => {
  it("extracts deterministic cash flow metrics from Millions-based statements (QPOWER Case Study)", () => {
    const cf = extractDeterministicCashFlow(QPOWER_CF_SAMPLE);
    expect(cf).not.toBeNull();
    expect(cf.unit).toBe("MILLIONS");
    expect(cf.statementScope).toBe("CONSOLIDATED");
    // 70.79 Millions * 0.1 = 7.08 Cr
    expect(cf.operatingCashFlowCr).toBe(7.08);
    // (119.64) Millions * 0.1 = -11.96 Cr
    expect(cf.operatingCashFlowPriorCr).toBe(-11.96);
    // Operating profit before WC: 1,186.46 * 0.1 = 118.65 Cr
    expect(cf.operatingProfitBeforeWcCr).toBe(118.65);
    // Inventory drain: (1,031.96) * 0.1 = -103.2 Cr
    expect(cf.inventoryChangeCr).toBe(-103.2);
    // Receivables: 106.99 * 0.1 = 10.7 Cr
    expect(cf.receivablesChangeCr).toBe(10.7);
    // Capex: 512.69 * 0.1 = 51.27 Cr
    expect(cf.capexCr).toBe(51.27);
    // Free Cash Flow: 7.08 - 51.27 = -44.19 Cr
    expect(cf.freeCashFlowCr).toBe(-44.19);
    // Flagged as working capital drain because inventory increase absorbed > 50% of operating profit
    expect(cf.isWorkingCapitalDrain).toBe(true);
  });

  it("extracts deterministic cash flow metrics from Crores-based statements", () => {
    const cf = extractDeterministicCashFlow(CRORES_CF_SAMPLE);
    expect(cf).not.toBeNull();
    expect(cf.unit).toBe("CRORES");
    expect(cf.operatingCashFlowCr).toBe(349.9);
    expect(cf.operatingCashFlowPriorCr).toBe(202.0);
    expect(cf.capexCr).toBe(120.0);
    expect(cf.freeCashFlowCr).toBe(229.9);
    expect(cf.isWorkingCapitalDrain).toBe(false);
  });

  it("returns null gracefully when no cash flow statement is present in the text", () => {
    const text = "Company announces board meeting on November 10, 2026 to consider unaudited results.";
    expect(extractDeterministicCashFlow(text)).toBeNull();
  });

  it("extracts hyperinflation monetary adjustment and other income from filing text", () => {
    const pnlText = `
STATEMENT OF UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR Q2 FY27
(Rs. in Millions)
II. Other Income 210.75 237.14 131.19
Note: Gross up effect of Hyper Inflation of Step Down Subsidiary 220.07 Millions
    `;
    const eq = extractEarningsQualityMetrics(pnlText, {
      revenue: 272.53,
      ebitda: 63.0,
      ebitdaMarginPct: 23.1,
      pbt: 77.23,
      patConsolidated: 63.33,
      patAttributable: 42.4
    });
    expect(eq).not.toBeNull();
    // 210.75 * 0.1 = 21.08 Cr
    expect(eq.otherIncomeCr).toBe(21.08);
    // 21.08 / 77.23 = 27.29%
    expect(eq.otherIncomePctOfPbt).toBeCloseTo(27.3, 1);
    // Hyperinflation gain
    expect(eq.hyperinflationGainCr).toBe(22.01);
    // Minority interest: 63.33 - 42.4 = 20.93 Cr
    expect(eq.minorityInterestCr).toBe(20.93);
  });

  it("formats a high-impact alert section with cash conversion % and working capital warnings", () => {
    const cf = {
      periodMonths: 6,
      pbtPeriodCr: 110.0,
      operatingCashFlowCr: 7.08,
      operatingCashFlowPriorCr: -11.96,
      inventoryChangeCr: -103.2,
      capexCr: 51.27,
      freeCashFlowCr: -44.19
    };
    const eq = {
      otherIncomeCr: 21.08,
      otherIncomePctOfPbt: 27.3,
      hyperinflationGainCr: 3.83,
      patAttributableCr: 42.4,
      minorityInterestCr: 20.93,
      marginFlatteryBps: 140
    };
    const formatted = formatCashFlowAndQualitySection(cf, eq, 110.0);
    expect(formatted).toContain("Net Operating Cash Flow (H1):* ₹7.08 Cr");
    expect(formatted).toContain("Cash Conversion:* ⚠️ 6.44% of Profit");
    expect(formatted).toContain("Working Capital Absorption:* ₹103.2 Cr absorbed by inventory buildup");
    expect(formatted).toContain("Free Cash Flow:* 🔴 ₹-44.19 Cr");
    expect(formatted).toContain("Other Income:* ₹21.08 Cr (27.3% of PBT)");
  });

  it("grounding guard rejects unscaled Million numbers falsely labeled as Crores", async () => {
    const { applyInstitutionalGuard } = await import("../services/institutional-guard.service.js");
    const rawDocText = "Outcome of Board Meeting. Revenue from operations was 2725.28 and total income was 2936.00 in Millions.";
    const fin = {
      isFinancialResult: true,
      statementScope: "CONSOLIDATED",
      unit: "MILLIONS",
      revenue: 293.6,
      patConsolidated: 42.44,
      patAttributable: 42.44
    };
    const badVerdict = {
      summary: "Revenue surged to ₹2,725.28 Cr this quarter.",
      verdict_summary: "Revenue reached ₹2,725.28 Cr driven by strong order execution.",
      _raw_text: rawDocText
    };
    const guarded = applyInstitutionalGuard(badVerdict, fin, "Outcome of Board Meeting", "QPOWER");
    expect(guarded.summary).not.toContain("₹2,725.28 Cr");
    expect(guarded.verdict_summary).not.toContain("₹2,725.28 Cr");

    const goodVerdict = {
      summary: "Revenue reached ₹293.6 Cr this quarter.",
      verdict_summary: "Revenue reached ₹293.6 Cr driven by strong order execution.",
      _raw_text: rawDocText
    };
    const guardedGood = applyInstitutionalGuard(goodVerdict, fin, "Outcome of Board Meeting", "QPOWER");
    expect(guardedGood.summary).toContain("₹293.6 Cr");
    expect(guardedGood.verdict_summary).toContain("₹293.6 Cr");
  });
});

describe("an operating cash flow that cannot be right is not shown (SJS 2026-11-04: ₹10,728.1 Cr OCF against ₹58 Cr profit = '18487% cash conversion', 'FCF ₹10,679 Cr')", () => {
  const cf = { operatingCashFlowCr: 10728.1, operatingCashFlowPriorCr: 107.65, capexCr: 48.86, freeCashFlowCr: 10679.24, inventoryChangeCr: null };
  it("withholds the OCF, the conversion and the free cash flow, and says why", () => {
    const out = formatCashFlowAndQualitySection(cf, null, 58.03);
    expect(out).not.toContain("10728.1");
    expect(out).not.toContain("18487");
    expect(out).not.toContain("10679");
    expect(out).toMatch(/cash flow.*could not be verified|looks mis-read/i);
  });
  it("a conversion above 100% that is still plausible (a strong working-capital release) is shown", () => {
    const out = formatCashFlowAndQualitySection({ periodMonths: 6, pbtPeriodCr: 100, operatingCashFlowCr: 150, operatingCashFlowPriorCr: 90, capexCr: 40, freeCashFlowCr: 110, inventoryChangeCr: null }, null, 100);
    expect(out).toContain("150% of Profit");
    expect(out).toContain("Free Cash Flow");
  });
  it("a plausible OCF is untouched", () => {
    const out = formatCashFlowAndQualitySection({ periodMonths: 6, pbtPeriodCr: 58, operatingCashFlowCr: 40, operatingCashFlowPriorCr: 30, capexCr: 10, freeCashFlowCr: 30, inventoryChangeCr: null }, null, 58);
    expect(out).toContain("68.97% of Profit");
  });
});

describe("cash conversion compares a cash flow with the profit of the SAME period (handoff 11-06 item 5: H1 operating cash flow was divided by ONE quarter's PAT)", () => {
  it("reads the period and the statement's own pre-tax profit from the cash flow statement", () => {
    const cf = extractDeterministicCashFlow(QPOWER_CF_SAMPLE);
    expect(cf.periodMonths).toBe(6);
    // 1,366.16 Millions = 136.62 Cr, the first row of the printed statement (half-year profit before tax)
    expect(cf.pbtPeriodCr).toBe(136.62);
    expect(extractDeterministicCashFlow(CRORES_CF_SAMPLE).pbtPeriodCr).toBe(450.5);
  });
  it("a full-year statement is labelled FY, not H1", () => {
    const text = QPOWER_CF_SAMPLE.replace("FOR THE HALF YEAR ENDED 30TH SEPTEMBER 2026", "FOR THE YEAR ENDED 31ST MARCH 2027");
    expect(extractDeterministicCashFlow(text).periodMonths).toBe(12);
  });
  it("sets a half-year cash flow against the half-year profit, and names that base in the line", () => {
    const cf = extractDeterministicCashFlow(CRORES_CF_SAMPLE);
    // a quarter's PAT (here 60 Cr) would give 583%: it must not be used
    const out = formatCashFlowAndQualitySection(cf, null, 60);
    expect(out).toContain("Net Operating Cash Flow (H1)");
    expect(out).toContain("77.67% of Profit"); // 349.9 / 450.5
    expect(out).toContain("H1 pre-tax profit");
    expect(out).not.toContain("583");
  });
  it("with no same-period profit it shows NO ratio rather than a mismatched one, and does not withhold a plausible OCF", () => {
    const out = formatCashFlowAndQualitySection({ periodMonths: 6, pbtPeriodCr: null, operatingCashFlowCr: 150, operatingCashFlowPriorCr: 90, capexCr: 40, freeCashFlowCr: 110, inventoryChangeCr: null }, null, 40);
    expect(out).toContain("₹150 Cr");
    expect(out).not.toContain("Cash Conversion");
  });
});
