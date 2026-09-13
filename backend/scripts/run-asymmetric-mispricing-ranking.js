/**
 * Production Runner: Asymmetric Mispricing Ranking Report (Dual-Lens Valuation Architecture)
 * 
 * Generates an institutional-grade mispricing and expectation gap report across the audited 18-stock cohort.
 * Incorporates:
 * - Reverse-DCF implied growth extraction
 * - Expectation gap analysis
 * - 20% growth haircut sensitivity stress-testing
 * - Three-pillar ROCE regime validation
 * - Dynamic opportunity tier classification
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rankUniverseByMispricing } from '../services/asymmetric-mispricing-ranking.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Verified 18-Stock Institutional Coverage Universe
const AUDITED_PORTFOLIO_COHORT = [
  {
    ticker: "HBLENGINE",
    companyName: "HBL Power Systems",
    sector: "Defence & Railways",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.6,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "ATTRACTIVE",
    capitalAction: "ACCUMULATE_CONVICTION",
    currentPrice: 702.55,
    currentPE: 16.1,
    expectationGap: 22.6,
    expectedGrowthTrajectory: "28% CAGR",
    impliedGrowthRate: "5.4%",
    financialEvidence: { revenueGrowthYoY: 30.5, roce: 24.5 },
    cashFlowEvidence: { cfoPatRatio: 0.90, receivableDays: 70, debtToEquity: 0.00 }
  },
  {
    ticker: "SKIPPER",
    companyName: "Skipper Limited",
    sector: "Power T&D Infrastructure",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.6,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "ATTRACTIVE",
    capitalAction: "ACCUMULATE_CONVICTION",
    currentPrice: 554.00,
    currentPE: 18.3,
    expectationGap: 15.9,
    expectedGrowthTrajectory: "22% CAGR",
    impliedGrowthRate: "6.1%",
    financialEvidence: { revenueGrowthYoY: 28.0, roce: 18.5 },
    cashFlowEvidence: { cfoPatRatio: 0.85, receivableDays: 70, debtToEquity: 0.02 }
  },
  {
    ticker: "TIMETECHNO",
    companyName: "Time Technoplast",
    sector: "Industrial Packaging & Composite Cylinders",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.6,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "ATTRACTIVE",
    capitalAction: "ACCUMULATE_CONVICTION",
    currentPrice: 187.48,
    currentPE: 10.2,
    expectationGap: 14.6,
    expectedGrowthTrajectory: "18% CAGR",
    impliedGrowthRate: "3.4%",
    financialEvidence: { revenueGrowthYoY: 17.5, roce: 17.0 },
    cashFlowEvidence: { cfoPatRatio: 0.75, receivableDays: 75, debtToEquity: 0.08 }
  },
  {
    ticker: "ANANTRAJ",
    companyName: "Anant Raj Limited",
    sector: "Data Centers & Real Estate",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.6,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "ATTRACTIVE",
    capitalAction: "ACCUMULATE_CONVICTION",
    currentPrice: 625.00,
    currentPE: 23.7,
    expectationGap: 14.1,
    expectedGrowthTrajectory: "25% CAGR",
    impliedGrowthRate: "7.9%",
    financialEvidence: { revenueGrowthYoY: 79.2, roce: 18.5 },
    cashFlowEvidence: { cfoPatRatio: 0.82, receivableDays: 60, debtToEquity: 0.00 }
  },
  {
    ticker: "HSCL",
    companyName: "Himadri Speciality Chemical",
    sector: "Specialty Chemicals & Battery Anode",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.5,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "ATTRACTIVE",
    capitalAction: "ACCUMULATE_CONVICTION",
    currentPrice: 654.40,
    currentPE: 21.5,
    expectationGap: 13.8,
    expectedGrowthTrajectory: "25% CAGR",
    impliedGrowthRate: "11.2%",
    financialEvidence: { revenueGrowthYoY: 28.0, roce: 22.0 },
    cashFlowEvidence: { cfoPatRatio: 0.88, receivableDays: 65, debtToEquity: 0.12 }
  },
  {
    ticker: "GRAVITA",
    companyName: "Gravita India",
    sector: "Circular Recycling",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.6,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "ATTRACTIVE",
    capitalAction: "ACCUMULATE_CONVICTION",
    currentPrice: 1821.70,
    currentPE: 28.5,
    expectationGap: 12.5,
    expectedGrowthTrajectory: "22% CAGR",
    impliedGrowthRate: "9.5%",
    financialEvidence: { revenueGrowthYoY: 42.0, roce: 27.5 },
    cashFlowEvidence: { cfoPatRatio: 0.85, receivableDays: 55, debtToEquity: 0.18 }
  },
  {
    ticker: "CCL",
    companyName: "CCL Products",
    sector: "Instant Coffee & B2C Brand",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.6,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "ATTRACTIVE",
    capitalAction: "ACCUMULATE_CONVICTION",
    currentPrice: 1082.30,
    currentPE: 26.3,
    expectationGap: 11.2,
    expectedGrowthTrajectory: "20% CAGR",
    impliedGrowthRate: "8.8%",
    financialEvidence: { revenueGrowthYoY: 31.2, roce: 18.0 },
    cashFlowEvidence: { cfoPatRatio: 0.80, receivableDays: 80, debtToEquity: 0.35 }
  },
  {
    ticker: "SBCL",
    companyName: "Shivalik Bimetal Controls",
    sector: "Bimetal & EV Shunt Resistors",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.5,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "ATTRACTIVE",
    capitalAction: "ACCUMULATE_CONVICTION",
    currentPrice: 993.25,
    currentPE: 24.5,
    expectationGap: 10.5,
    expectedGrowthTrajectory: "22% CAGR",
    impliedGrowthRate: "11.5%",
    financialEvidence: { revenueGrowthYoY: 33.4, roce: 26.0 },
    cashFlowEvidence: { cfoPatRatio: 0.90, receivableDays: 60, debtToEquity: 0.00 }
  },
  {
    ticker: "TRANSRAILL",
    companyName: "Transrail Lighting",
    sector: "Grid EPC & Substations",
    thesisHealth: "INTACT",
    currentConviction: 8.5,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "ATTRACTIVE",
    capitalAction: "HOLD",
    currentPrice: 460.00,
    currentPE: 18.5,
    expectationGap: 13.8,
    expectedGrowthTrajectory: "20% CAGR",
    impliedGrowthRate: "6.2%",
    financialEvidence: { revenueGrowthYoY: 22.0, roce: 16.5 },
    cashFlowEvidence: { cfoPatRatio: 0.55, receivableDays: 115, debtToEquity: 0.40 }
  },
  {
    ticker: "LUMAXTECH",
    companyName: "Lumax Auto Technologies",
    sector: "Mechatronics & EV Components",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.7,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "FULL",
    capitalAction: "CORE_HOLD",
    currentPrice: 1988.80,
    currentPE: 48.8,
    expectationGap: 3.7,
    expectedGrowthTrajectory: "20% CAGR",
    impliedGrowthRate: "16.3%",
    financialEvidence: { revenueGrowthYoY: 28.0, roce: 22.5 },
    cashFlowEvidence: { cfoPatRatio: 0.84, receivableDays: 70, debtToEquity: 0.20 }
  },
  {
    ticker: "SJS",
    companyName: "SJS Enterprises",
    sector: "Aesthetic Cockpit Overlays",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.7,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "FULL",
    capitalAction: "CORE_HOLD",
    currentPrice: 2497.40,
    currentPE: 52.8,
    expectationGap: 4.4,
    expectedGrowthTrajectory: "22% CAGR",
    impliedGrowthRate: "17.6%",
    financialEvidence: { revenueGrowthYoY: 24.5, roce: 24.5 },
    cashFlowEvidence: { cfoPatRatio: 0.92, receivableDays: 60, debtToEquity: 0.00 }
  },
  {
    ticker: "INOXINDIA",
    companyName: "INOX India",
    sector: "Cryogenic Engineering",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.6,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "FULL",
    capitalAction: "CORE_HOLD",
    currentPrice: 1930.20,
    currentPE: 48.8,
    expectationGap: 5.7,
    expectedGrowthTrajectory: "22% CAGR",
    impliedGrowthRate: "16.3%",
    financialEvidence: { revenueGrowthYoY: 19.8, roce: 28.0 },
    cashFlowEvidence: { cfoPatRatio: 0.82, receivableDays: 75, debtToEquity: 0.00 }
  },
  {
    ticker: "POLICYBZR",
    companyName: "PB Fintech",
    sector: "Online Insurance Platform",
    thesisHealth: "STRENGTHENING",
    currentConviction: 8.8,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "FULL",
    capitalAction: "CORE_HOLD",
    currentPrice: 1795.20,
    currentPE: 65.0,
    expectationGap: 5.0,
    expectedGrowthTrajectory: "25% CAGR",
    impliedGrowthRate: "20.0%",
    financialEvidence: { revenueGrowthYoY: 40.1, roce: 18.0 },
    cashFlowEvidence: { cfoPatRatio: 0.95, receivableDays: 30, debtToEquity: 0.00 }
  },
  {
    ticker: "JSLL",
    companyName: "Jeena Sikho Lifecare",
    sector: "Ayurvedic Healthcare Clinics",
    thesisHealth: "INTACT",
    currentConviction: 8.5,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "REASONABLE",
    capitalAction: "HOLD",
    currentPrice: 505.35,
    currentPE: 28.0,
    expectationGap: 5.0,
    expectedGrowthTrajectory: "20% CAGR",
    impliedGrowthRate: "15.0%",
    financialEvidence: { revenueGrowthYoY: 20.0, roce: 18.0 },
    cashFlowEvidence: { cfoPatRatio: 0.60, receivableDays: 95, debtToEquity: 0.10 }
  },
  {
    ticker: "QPOWER",
    companyName: "Quality Power Electrical",
    sector: "High-Voltage Grid Components",
    thesisHealth: "INTACT",
    currentConviction: 8.5,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "FULL",
    capitalAction: "CORE_HOLD",
    currentPrice: 1305.60,
    currentPE: 58.0,
    expectationGap: 4.0,
    expectedGrowthTrajectory: "22% CAGR",
    impliedGrowthRate: "18.0%",
    financialEvidence: { revenueGrowthYoY: 18.0, roce: 20.0 },
    cashFlowEvidence: { cfoPatRatio: 0.80, receivableDays: 85, debtToEquity: 0.05 }
  },
  {
    ticker: "ELECON",
    companyName: "Elecon Engineering",
    sector: "Industrial Gears",
    thesisHealth: "UNDER_PRESSURE",
    currentConviction: 4.0,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "REASONABLE",
    capitalAction: "PAUSE_ADDITIONS",
    currentPrice: 451.55,
    currentPE: 30.2,
    expectationGap: 6.0,
    expectedGrowthTrajectory: "20% CAGR",
    impliedGrowthRate: "14.0%",
    financialEvidence: { revenueGrowthYoY: 6.1, roce: 22.0 },
    cashFlowEvidence: { cfoPatRatio: 0.70, receivableDays: 85, debtToEquity: 0.00 }
  },
  {
    ticker: "JYOTICNC",
    companyName: "Jyoti CNC Automation",
    sector: "CNC Tooling & Aerospace",
    thesisHealth: "STRENGTHENING",
    currentConviction: 9.5,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "EXTREME",
    capitalAction: "CORE_HOLD",
    currentPrice: 988.80,
    currentPE: 65.0,
    expectationGap: 3.5,
    expectedGrowthTrajectory: "30% CAGR",
    impliedGrowthRate: "26.5%",
    financialEvidence: { revenueGrowthYoY: 24.1, roce: 22.5 },
    cashFlowEvidence: { cfoPatRatio: 0.88, receivableDays: 85, debtToEquity: 0.25 }
  },
  {
    ticker: "SHAKTIPUMP",
    companyName: "Shakti Pumps",
    sector: "Solar Ag Pumps",
    thesisHealth: "BROKEN",
    currentConviction: 0.0,
    evidenceSufficiency: "SUFFICIENT",
    valuationState: "FULL",
    capitalAction: "SYSTEMATIC_EXIT",
    currentPrice: 503.55,
    currentPE: 55.9,
    expectationGap: -20.0,
    expectedGrowthTrajectory: "10% CAGR",
    impliedGrowthRate: "30.0%",
    financialEvidence: { revenueGrowthYoY: 12.4, roce: 20.0 },
    cashFlowEvidence: { cfoPatRatio: 0.15, receivableDays: 140, debtToEquity: 0.45 }
  }
];

export function runAsymmetricRankingReport() {
  const ranked = rankUniverseByMispricing(AUDITED_PORTFOLIO_COHORT);

  console.log('========================================================================================');
  console.log('🏛️  INSTITUTIONAL ASYMMETRIC MISPRICING & REVERSE-DCF RANKING BOARD (18 STOCKS)');
  console.log('========================================================================================\n');

  console.log(
    'Rank'.padEnd(5) +
    'Ticker'.padEnd(12) +
    'P/E'.padEnd(7) +
    'Score'.padEnd(7) +
    'ExpGap'.padEnd(8) +
    'StressGap'.padEnd(11) +
    'Robustness'.padEnd(17) +
    'Tier'.padEnd(28) +
    'Strategic Action'
  );
  console.log('-'.repeat(120));

  for (const r of ranked) {
    const pStr = `${r.pe}x`.padEnd(7);
    const scoreStr = `${r.mispricingScore}`.padEnd(7);
    const gapStr = `${r.metrics.expectationGap > 0 ? '+' : ''}${r.metrics.expectationGap}%`.padEnd(8);
    const stressStr = `${r.metrics.stressTestedExpectationGap > 0 ? '+' : ''}${r.metrics.stressTestedExpectationGap}%`.padEnd(11);
    const robStr = r.metrics.thesisRobustness.padEnd(17);
    const tierStr = r.opportunityTier.padEnd(28);

    console.log(
      `#${r.universeRank}`.padEnd(5) +
      r.ticker.padEnd(12) +
      pStr +
      scoreStr +
      gapStr +
      stressStr +
      robStr +
      tierStr +
      r.strategicActionNarrative
    );
  }

  // Save detailed Markdown dossier into reports/thesis_board/
  const reportDir = path.join(__dirname, '..', '..', 'reports', 'thesis_board');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = path.join(reportDir, 'ASYMMETRIC_MISPRICING_RANKING_18_STOCKS.md');

  let md = `# Institutional Asymmetric Mispricing & Dual-Lens Ranking Dossier

Generated: ${new Date().toISOString()}  
Coverage Universe: 18 Portfolio Holdings

---

## Executive Summary: Dual-Lens Valuation Architecture

This institutional ranking engine operationalizes the dual-lens framework:
1. **Regime Shift Validation**: Does the company possess structural economic moat and balance sheet strength to justify a permanent valuation re-rating?
2. **Reverse-DCF Expectation Gap**: How much growth is embedded in today's price, and does underwritten evidence exceed it?
3. **Sensitivity Stress-Testing**: What happens to the expectation gap under a severe **20% growth haircut**?

---

## Portfolio Ranking & Opportunity Tiers

| Rank | Ticker | Company | P/E | Underwritten CAGR | Implied Growth | Expectation Gap | Stress Gap (-20%) | Thesis Robustness | ROCE Regime | Opportunity Tier | Mispricing Score | Strategic Recommendation |
|:---:|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---|:---:|:---|
`;

  for (const r of ranked) {
    const gapSign = r.metrics.expectationGap > 0 ? '+' : '';
    const stressSign = r.metrics.stressTestedExpectationGap > 0 ? '+' : '';
    md += `| #${r.universeRank} | **${r.ticker}** | ${r.companyName} | ${r.pe}x | ${r.metrics.expectedCagr}% | ${r.metrics.impliedGrowth}% | **${gapSign}${r.metrics.expectationGap}%** | **${stressSign}${r.metrics.stressTestedExpectationGap}%** | \`${r.metrics.thesisRobustness}\` | \`${r.metrics.roceRegimeClassification}\` | \`${r.opportunityTier}\` | **${r.mispricingScore}** | ${r.strategicActionNarrative} |\n`;
  }

  md += `
---

## Key Capital Allocation Decisions & Guardrails

### 1. The Asymmetric Accumulation Cohort (Ranks 1 to 8)
- **Top 8 Conviction Dislocations**: HBL Power (#1), Skipper (#2), Himadri Chemical (#3), Gravita (#4), Shivalik Bimetal (#5), Anant Raj (#6), CCL Products (#7), and Time Technoplast (#8).
- **Stress-Test Resilience**: All 8 names maintain positive expectation gaps (+6.1% to +17.0%) even after an aggressive 20% growth cut.
- **CCL Products Core Position**: CCL boasts an Expectation Gap of **+11.2%** (implied growth 8.8% vs. 20% underwritten CAGR) and a Stress Gap of **+7.2%**. Backed by Vietnam capacity doubling and premium freeze-dried coffee mix shift, CCL remains firmly anchored in the core accumulation tier.

### 2. Fully-Priced High-Quality Compounders (Ranks 9 to 15)
- **Lumax Auto, SJS Enterprises, INOX India, PB Fintech, Quality Power**: Outstanding business models, high ROCE (20% to 28%), but trading at elevated multiples (48x to 65x P/E).
- **Expectation Gaps Compressed**: Gaps are narrow (+3.7% to +5.7%) and under a 20% growth haircut, stress gaps compress to near-zero (-0.3% to +1.3%).
- **Policy**: Maintain core holding weight to capture underlying earnings compounding, but **do not chase with fresh aggressive capital deployment**.

### 3. Monitoring Cash Conversion (Transrail Lighting - Rank 13)
- **Transrail Lighting**: P/E of 18.5x gives an attractive initial expectation gap (+13.8%), but working capital intensity (115 receivable days, CFO/PAT of 0.55) caps its score and tier at \`COMPOUNDING_AT_FAIR_PRICE\`.
- **Policy**: Hold position; wait for audited cash conversion and quarterly operating momentum to verify before expanding allocation.

### 4. Capital Protection (Trims & Systematic Exits)
- **Jyoti CNC Automation (#17)**: 65x P/E with 26.5% implied growth. While execution is strong, valuation is extreme. Trim into strength.
- **Elecon Engineering (#16)**: Growth decelerated to 6.1% YoY, placing thesis under pressure. Gated into \`WATCHLIST_FRICTION\` (score 35).
- **Shakti Pumps (#18)**: Broken thesis, extreme working capital stress (140 receivable days, CFO/PAT 0.15). Strictly gated into \`STRUCTURAL_VALUE_TRAP\` with a score of 0.0.
`;

  fs.writeFileSync(reportPath, md, 'utf-8');
  console.log(`\n✅ Institutional Ranking Dossier generated at: ${reportPath}\n`);
  return ranked;
}

// Auto-execute when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAsymmetricRankingReport();
}
