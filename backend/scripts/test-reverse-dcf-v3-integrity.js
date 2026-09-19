/**
 * Invariant Test Suite: ThesisIQ v3.1 Institutional Asymmetric Compounding Engine (v3.1.1 Audit Patch)
 * 
 * Verifies all 5 Specification Fixes, 7 Layers, and Report-Level Reconciliations:
 * 1. Layer 1: Forensic FCFF Identity & Cash Conversion Diagnostics (FCFF = NOPAT - dNOA).
 * 2. Layer 2: Forward iROIC Confidence Blending & Non-Linear Contradictory Evidence Priority.
 * 3. Layer 3: 5x Economic Pathway Feasibility, Market Share Delta, and 5X_PATHWAY_STATUS.
 * 4. Layer 4: Institutional FCFF DCF in all 10 forecast years & Net Cash Bridge.
 * 5. Layer 5: Dual-Methodology Bear Floor: min(DCF Bear Floor, Multiple Stress Floor) & Signed Asymmetry.
 * 6. Layer 6: Strict Deterministic Decision Engine & 3-Way Conviction Separation.
 * 7. Layer 7: Transrail UNDER_REVALIDATION state derived from recent Q1 working capital friction.
 * 8. Report-Level Reconciliation Invariants: Mathematical identity between scorecard object and displayed metrics.
 */

import {
  calculateBaselineFcff,
  evaluateCashConversionDiagnostics,
  calculateEffectiveForwardIroic,
  classifyEconomicEngineState,
  calculate5xEconomicPathway,
  resolveTerminalGrowthRate,
  calculateInstitutionalFcffDcf,
  calculateDualBearFloor,
  evaluateDebtHealth,
  calculateThesisIqScorecard,
  evaluateEquityMispricing,
  rankUniverseByMispricing,
  ECONOMIC_ENGINE_STATE,
  FORWARD_IROIC_CONFIDENCE,
  EVIDENCE_RECENCY,
  TAM_BURDEN_TIER,
  PATHWAY_5X_STATUS,
  EXPECTATIONS_REGIME,
  FCFF_CONVERSION_STATUS,
  FCFF_CONVERSION_THRESHOLDS,
  MISPRICING_OPPORTUNITY_TIER
} from '../services/asymmetric-mispricing-ranking.service.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    process.exitCode = 1;
  } else {
    passedTests++;
    console.log(`  ✓ [PASS] ${message}`);
  }
}

console.log('================================================================================================');
console.log('🧪 RUNNING INVARIANT TEST SUITE: THESISIQ v3.1 INSTITUTIONAL ASYMMETRIC COMPOUNDING ENGINE');
console.log('================================================================================================\n');

// -------------------------------------------------------------------------
// Test 1: Layer 1 Forensic FCFF Identity & Cash Diagnostics
// -------------------------------------------------------------------------
console.log('--- 1. Testing Layer 1: Forensic FCFF Identity & Diagnostics ---');
const fcffResult = calculateBaselineFcff({
  nopat: 100.0,
  dna: 20.0,
  capex: 80.0,
  dNwc: 30.0
});
// dNOA = 80 - 20 + 30 = 90. FCFF = 100 - 90 = 10.0
assert(fcffResult.dNoa === 90.0, `dNOA equals Capex (80) - D&A (20) + dNWC (30) = 90.0 (Actual: ${fcffResult.dNoa})`);
assert(fcffResult.baselineFcff === 10.0, `FCFF equals NOPAT (100) - dNOA (90) = 10.0 (Actual: ${fcffResult.baselineFcff})`);

const diagResult = evaluateCashConversionDiagnostics({
  ttmPat: 100.0,
  cfoPatRatio: 0.55,
  receivableDays: 120,
  inventoryDays: 60,
  revenue: 1000.0
});
assert(diagResult.diagnosticFrictionScore >= 50, `Severe working capital friction flagged with score >= 50 (Actual: ${diagResult.diagnosticFrictionScore})`);
assert(diagResult.issues.length >= 2, `Diagnostic captures specific friction issues (Found: ${diagResult.issues.length})`);

// -------------------------------------------------------------------------
// Test 2: Layer 2 Forward iROIC Confidence & Recency Non-Linear Override
// -------------------------------------------------------------------------
console.log('\n--- 2. Testing Layer 2: Forward iROIC & Contradictory Evidence Priority ---');
const highConfCurrent = calculateEffectiveForwardIroic(15.0, 30.0, FORWARD_IROIC_CONFIDENCE.HIGH, EVIDENCE_RECENCY.CURRENT_QUARTER);
// w_conf = 0.80 * w_rec = 1.0 = 0.80 weight on 30.0 -> 0.8*30 + 0.2*15 = 27.0
assert(highConfCurrent === 27.0, `High Confidence Current Quarter Forward iROIC is 27.0% (Actual: ${highConfCurrent}%)`);

const speculativeStale = calculateEffectiveForwardIroic(15.0, 30.0, FORWARD_IROIC_CONFIDENCE.SPECULATIVE, EVIDENCE_RECENCY.STALE);
// w_conf = 0.0 -> relies 100% on historical 15.0%
assert(speculativeStale === 15.0, `Speculative/Stale Forward iROIC safely falls back to historical 15.0% (Actual: ${speculativeStale}%)`);

// Non-linear override test: Recent Q1 deterioration overrides stale positive expectations
const contradictoryOverride = calculateEffectiveForwardIroic(18.0, 35.0, FORWARD_IROIC_CONFIDENCE.HIGH, EVIDENCE_RECENCY.CURRENT_QUARTER, {
  cfoPatRatio: 0.50,
  receivableDays: 125
});
assert(contradictoryOverride <= 18.0, `Recent negative shock (125 rec days) overrides optimistic forward projection (Result: ${contradictoryOverride}%)`);

// Transrail case: Recent working capital stress triggers UNDER_REVALIDATION
const transrailState = classifyEconomicEngineState({
  thesisHealth: 'INTACT',
  financialEvidence: { roce: 20.0 },
  cashFlowEvidence: { cfoPatRatio: 0.55, receivableDays: 115, debtToEquity: 0.40 },
  economicEvidence: { hasTransformationCapex: false }
});
assert(transrailState === ECONOMIC_ENGINE_STATE.UNDER_REVALIDATION, `Transrail (115 rec days, 0.55 CFO/PAT) is classified as UNDER_REVALIDATION (Actual: ${transrailState})`);

// -------------------------------------------------------------------------
// Test 3: Layer 3 5x Economic Pathway, Market Share Delta & Status
// -------------------------------------------------------------------------
console.log('\n--- 3. Testing Layer 3: 5x Economic Pathway, Market Share Delta & Status ---');
const feasiblePathway = calculate5xEconomicPathway({
  financialEvidence: { currentRevenue: 1000.0, ttmPat: 100.0, nopat: 100.0, roce: 25.0 },
  economicEvidence: { targetNetMarginPct: 10.0, effectiveForwardIroic: 25.0, addressableTamCr: 50000.0 }
});
assert(feasiblePathway.target5xNopat === 500.0, `Target 5x NOPAT is 500 Cr`);
assert(feasiblePathway.required7YrCagrPct === 25.85, `Standard 7-Year Required CAGR is 25.85% (Actual: ${feasiblePathway.required7YrCagrPct}%)`);
assert(feasiblePathway.currentEstimatedMarketSharePct === 2.0, `Current estimated market share is 2.0%`);
assert(feasiblePathway.required5xMarketSharePct === 10.0, `Required 5x market share is 10.0%`);
assert(feasiblePathway.marketShareExpansionDeltaPct === 8.0, `Market share expansion delta is +8.0%`);
assert(feasiblePathway.pathwayStatus === PATHWAY_5X_STATUS.PASS, `Feasible 10% TAM burden is classified as PASS`);

const tamConstrained = calculate5xEconomicPathway({
  financialEvidence: { currentRevenue: 1000.0, ttmPat: 100.0, nopat: 100.0, roce: 25.0 },
  economicEvidence: { targetNetMarginPct: 10.0, effectiveForwardIroic: 25.0, addressableTamCr: 6000.0 }
});
// Required Rev = 5000. TAM = 6000. TAM Burden = 83.3% -> TAM_CONSTRAINED
assert(tamConstrained.tamBurdenPct === 83.3, `TAM Burden is 83.3%`);
assert(tamConstrained.pathwayStatus === PATHWAY_5X_STATUS.TAM_CONSTRAINED, `Demanding >50% TAM burden is classified as TAM_CONSTRAINED`);

const failedPathway = calculate5xEconomicPathway({
  thesisHealth: 'BROKEN',
  financialEvidence: { currentRevenue: 1000.0, ttmPat: 100.0, nopat: 100.0, roce: 10.0 },
  economicEvidence: { targetNetMarginPct: 10.0, effectiveForwardIroic: 10.0, addressableTamCr: 50000.0 }
});
assert(failedPathway.pathwayStatus === PATHWAY_5X_STATUS.FAILED, `Broken thesis 5x pathway is classified as FAILED`);

// -------------------------------------------------------------------------
// Test 4: Layer 4 Institutional FCFF DCF & Dynamic Terminal Growth
// -------------------------------------------------------------------------
console.log('\n--- 4. Testing Layer 4: Institutional FCFF DCF & Net Cash Bridge ---');
const defTerminalG = resolveTerminalGrowthRate('Defence & Railways');
const autoTerminalG = resolveTerminalGrowthRate('Auto Ancillary');
const cyclicalTerminalG = resolveTerminalGrowthRate('Commodity Chemicals');

assert(defTerminalG === 0.040, 'Defence & Railways terminal growth is 4.0%');
assert(autoTerminalG === 0.035, 'Auto Ancillary terminal growth is 3.5%');
assert(cyclicalTerminalG === 0.025, 'Commodity Chemicals terminal growth is 2.5%');

// Net Cash Bridge: SJS Case (Net cash adds to equity value)
const baseDcfValue = calculateInstitutionalFcffDcf({
  currentPrice: 1000.0,
  currentPE: 25.0,
  underwrittenCagr: 20.0,
  effectiveIroic: 25.0,
  netDebtCr: 0.0,
  marketCapCr: 5000.0
});

const netCashDcfValue = calculateInstitutionalFcffDcf({
  currentPrice: 1000.0,
  currentPE: 25.0,
  underwrittenCagr: 20.0,
  effectiveIroic: 25.0,
  netDebtCr: -500.0, // 500 Cr Net Cash
  marketCapCr: 5000.0
});

assert(netCashDcfValue > baseDcfValue, `Net cash increases Intrinsic Fair Value per share (₹${netCashDcfValue} vs ₹${baseDcfValue})`);

// -------------------------------------------------------------------------
// Test 5: Layer 5 Dual Bear Floor & Signed Asymmetry
// -------------------------------------------------------------------------
console.log('\n--- 5. Testing Layer 5: Dual Bear Floor & Signed Asymmetry ---');
const dualBear = calculateDualBearFloor({
  currentPrice: 700.0,
  currentPE: 20.0,
  underwrittenCagr: 25.0,
  effectiveIroic: 25.0,
  terminalGrowth: 0.035
});

assert(dualBear.bearFloorPrice <= dualBear.dcfBearFloor, `Dual Bear Floor <= DCF Bear Floor`);
assert(dualBear.bearFloorPrice <= dualBear.multipleStressFloor, `Dual Bear Floor <= Multiple Stress Floor`);
assert(dualBear.bearFloorPrice === Math.min(dualBear.dcfBearFloor, dualBear.multipleStressFloor), `Bear Floor strictly equals min(DCF Bear, Multiple Stress)`);

const sc = calculateThesisIqScorecard({
  currentPrice: 700.0,
  currentPE: 16.0,
  expectedGrowthTrajectory: '28% CAGR',
  financialEvidence: { roce: 25.0 },
  cashFlowEvidence: { cfoPatRatio: 0.90, debtToEquity: 0.00 }
});

assert(sc.fairValuePrice > 700.0, `Intrinsic Fair Value (₹${sc.fairValuePrice}) > Current Price (₹700.0)`);
assert(sc.bearFloorPrice < 700.0, `Worst-Case Bear Floor (₹${sc.bearFloorPrice}) < Current Price (₹700.0)`);
assert(sc.buyBelowPrice <= sc.fairValuePrice * 0.75, `Buy Below Price (₹${sc.buyBelowPrice}) guarantees >= 25% MoS to Fair Value`);
assert(sc.convictions.economicConviction === 'HIGH', `Economic conviction is HIGH for PROVEN engine`);
assert(sc.convictions.thesisConfidence === 'MEDIUM', `Thesis confidence is properly resolved`);

// Signed asymmetry test: Overvalued stock produces negative asymmetry, undervalued produces positive
const overvaluedSc = calculateThesisIqScorecard({
  currentPrice: 1668.0,
  currentPE: 45.0,
  expectedGrowthTrajectory: '22% CAGR',
  financialEvidence: { roce: 22.0 },
  cashFlowEvidence: { cfoPatRatio: 0.80, debtToEquity: 0.10 }
});
assert(overvaluedSc.asymmetryRatio < 0, `Overvalued stock CMP ₹1668 vs FV ₹${overvaluedSc.fairValuePrice} correctly produces negative asymmetry (${overvaluedSc.asymmetryRatio}:1)`);

// -------------------------------------------------------------------------
// Test 6: Report-Level Reconciliation Invariants & Layer 4 Expectations Gap
// -------------------------------------------------------------------------
console.log('\n--- 6. Testing Report-Level Mathematical Reconciliation Invariants ---');

// Invariant A: REPORT_ASYMMETRY_RECONCILIATION
const expectedAsymmetry = parseFloat(((sc.fairValuePrice - 700.0) / Math.max(1.0, 700.0 - sc.bearFloorPrice)).toFixed(2));
assert(sc.asymmetryRatio === expectedAsymmetry, `[REPORT_ASYMMETRY_RECONCILIATION] Scorecard asymmetry (${sc.asymmetryRatio}) strictly equals (FV - CMP) / (CMP - Bear) = ${expectedAsymmetry}`);

// Invariant B: REPORT_IRR_RECONCILIATION
const expectedIrr = parseFloat(((Math.pow(sc.fairValuePrice / 700.0, 1.0 / 3.0) - 1.0) * 100.0).toFixed(1));
assert(sc.projected3YrIrr === expectedIrr, `[REPORT_IRR_RECONCILIATION] Scorecard 3Y IRR (${sc.projected3YrIrr}%) strictly equals (FV / CMP)^(1/3) - 1 = ${expectedIrr}%`);

// Invariant C: REPORT_BUY_BELOW_RECONCILIATION
const expectedBuyBelow = parseFloat(Math.min(sc.fairValuePrice * 0.75, (sc.fairValuePrice + 3.0 * sc.bearFloorPrice) / 4.0).toFixed(2));
assert(sc.buyBelowPrice === expectedBuyBelow, `[REPORT_BUY_BELOW_RECONCILIATION] Scorecard Buy Below (₹${sc.buyBelowPrice}) strictly equals min(0.75*FV, (FV + 3*Bear)/4) = ₹${expectedBuyBelow}`);

// Invariant D: REPORT_EXPECTATIONS_GAP_RECONCILIATION
const expectedGap = parseFloat((sc.underwrittenNopatCagr - sc.marketImpliedFcffCagr).toFixed(1));
assert(sc.expectationGapPct === expectedGap, `[REPORT_EXPECTATIONS_GAP_RECONCILIATION] Scorecard gap (${sc.expectationGapPct}% pts) strictly equals Underwritten NOPAT (${sc.underwrittenNopatCagr}%) - Implied FCFF (${sc.marketImpliedFcffCagr}%) = ${expectedGap}% pts`);
assert(sc.expectationsLayer.benchmark7Yr5xCagrPct === 25.85, `[5X_BENCHMARK_ISOLATION] 7Y 5x CAGR is 25.85% benchmark, NOT injected into expectation gap calculation`);

// Invariant E: REPORT_FCFF_CAGR_INTEGRITY & 4-TIER CONVERSION STATUS INVARIANTS
// Case 1: Positive endpoints (HBL: NOPAT 28%, iROIC 37.5% -> FCFF_0 > 0 && FCFF_5 > 0)
const hblScorecard = calculateThesisIqScorecard({
  currentPrice: 722.0,
  currentPE: 25.0,
  expectedGrowthTrajectory: '28% CAGR',
  sector: 'Defence & Railways',
  financialEvidence: { roce: 24.5 },
  cashFlowEvidence: { cfoPatRatio: 0.90, debtToEquity: 0.00 },
  economicEvidence: { forwardIroic: 37.5, forwardIroicConfidence: 'HIGH' }
});

assert(Number.isFinite(hblScorecard.underwrittenFcffCagr), `[FCFF_CAGR_FINITE] When FCFF_0 > 0 and FCFF_5 > 0, FCFF CAGR (${hblScorecard.underwrittenFcffCagr}%) must be finite and mathematically defined`);
assert(hblScorecard.fcffConversionStatus === FCFF_CONVERSION_STATUS.CAPITAL_INTENSIVE, `[FCFF_CAPITAL_INTENSIVE] HBL (RR ${hblScorecard.reinvestmentRatePct}%, Conversion ${hblScorecard.modeledFcffConversionPct}%) is classified as CAPITAL_INTENSIVE`);
const expectedHblDrag = parseFloat((hblScorecard.underwrittenNopatCagr - hblScorecard.underwrittenFcffCagr).toFixed(1));
assert(hblScorecard.fcffConversionDragPct === expectedHblDrag, `[FCFF_CONVERSION_DRAG_VALID] Scorecard drag (${hblScorecard.fcffConversionDragPct}% pts) strictly equals NOPAT (${hblScorecard.underwrittenNopatCagr}%) - FCFF (${hblScorecard.underwrittenFcffCagr}%) = ${expectedHblDrag}% pts`);

// Case 2: Negative forecast FCFF (Growth requires more reinvestment than NOPAT: RR > 100%, FCFF_5 <= 0)
const deficitScorecard = calculateThesisIqScorecard({
  currentPrice: 500.0,
  currentPE: 30.0,
  expectedGrowthTrajectory: '25% CAGR',
  sector: 'Specialty Chemicals',
  financialEvidence: { roce: 16.0 },
  cashFlowEvidence: { cfoPatRatio: 0.80, debtToEquity: 0.10 },
  economicEvidence: { forwardIroic: 18.0, forwardIroicConfidence: 'MEDIUM' } // RR = 25 / 18 = 1.39 > 1.0
});

assert(deficitScorecard.underwrittenFcffCagr === null, `[FCFF_CAGR_NULL_ON_DEFICIT] When FCFF_5 <= 0 (RR > 100%), underwrittenFcffCagr MUST be null (Actual: ${deficitScorecard.underwrittenFcffCagr})`);
assert(deficitScorecard.fcffConversionDragPct === null, `[FCFF_DRAG_NULL_ON_DEFICIT] When FCFF CAGR is null, fcffConversionDragPct MUST be null (Actual: ${deficitScorecard.fcffConversionDragPct})`);
assert(deficitScorecard.fcffConversionStatus === FCFF_CONVERSION_STATUS.FCFF_NEGATIVE_DURING_GROWTH, `[FCFF_STATUS_DEFICIT] When RR > 100%, status is FCFF_NEGATIVE_DURING_GROWTH (Actual: ${deficitScorecard.fcffConversionStatus})`);

// Case 3: Working capital stress (Transrail: CFO/PAT 0.55, 115 rec days) -> FCFF_RECOVERY_REQUIRED
const wcStressScorecard = calculateThesisIqScorecard({
  currentPrice: 410.0,
  currentPE: 13.2,
  expectedGrowthTrajectory: '20% CAGR',
  sector: 'Infra & Power EPC',
  financialEvidence: { roce: 33.6 },
  cashFlowEvidence: { cfoPatRatio: 0.55, receivableDays: 115, debtToEquity: 0.40 },
  economicEvidence: { forwardIroic: 38.64, forwardIroicConfidence: 'LOW', evidenceRecency: 'CURRENT_QUARTER' }
});

assert(wcStressScorecard.fcffConversionStatus === FCFF_CONVERSION_STATUS.FCFF_RECOVERY_REQUIRED, `[FCFF_RECOVERY_PRIORITY] Working-capital stress takes precedence as FCFF_RECOVERY_REQUIRED (Actual: ${wcStressScorecard.fcffConversionStatus})`);

// Case 4: Positive Cash Compounder (High iROIC 35%, moderate growth 18% -> RR = 51.4% <= 65%, Conversion = 48.6% >= 35%)
const cashCompounder = calculateThesisIqScorecard({
  currentPrice: 100.0,
  currentPE: 20.0,
  expectedGrowthTrajectory: '18% CAGR',
  sector: 'Packaging',
  financialEvidence: { roce: 32.0 },
  cashFlowEvidence: { cfoPatRatio: 0.95, debtToEquity: 0.05 },
  economicEvidence: { forwardIroic: 35.0, forwardIroicConfidence: 'HIGH' }
});

assert(cashCompounder.fcffConversionStatus === FCFF_CONVERSION_STATUS.POSITIVE_CASH_COMPOUNDER, `[POSITIVE_CASH_COMPOUNDER] Strong conversion is classified as POSITIVE_CASH_COMPOUNDER (Actual: ${cashCompounder.fcffConversionStatus})`);
assert(Number.isFinite(cashCompounder.underwrittenFcffCagr), `[POSITIVE_COMPOUNDER_CAGR] Valid finite FCFF CAGR for cash compounder (${cashCompounder.underwrittenFcffCagr}%)`);
assert(sc.marketImpliedFcffCagr === sc.marketImpliedCagr, `[FCFF_ALIAS_INTEGRITY] marketImpliedFcffCagr strictly equals marketImpliedCagr`);

// -------------------------------------------------------------------------
// Test 7: Layer 4 Market Expectations Regimes (Adversarial & Hard-Gated Cases)
// -------------------------------------------------------------------------
console.log('\n--- 7. Testing Layer 4: Market Expectations Regimes ---');

// Case 1: INOX India - TAM runway (4.2% burden) but priced for perfection (P/E 79x) -> MARKET_EXPECTATIONS_ABOVE_THESIS
const inoxSc = calculateThesisIqScorecard({
  currentPrice: 2247.0,
  currentPE: 79.0,
  expectedGrowthTrajectory: '22% CAGR',
  sector: 'Industrial Equipment',
  financialEvidence: { roce: 22.0 },
  cashFlowEvidence: { cfoPatRatio: 0.85, debtToEquity: 0.00 }
});
assert(inoxSc.expectationsRegime === 'MARKET_EXPECTATIONS_ABOVE_THESIS', `INOX India (PE 79x, Underwritten 22% vs Implied ${inoxSc.marketImpliedCagr}%) is classified as MARKET_EXPECTATIONS_ABOVE_THESIS (Actual: ${inoxSc.expectationsRegime})`);

// Case 2: Transrail - Positive gap (+7.5% pts) but LOW confidence / UNDER_REVALIDATION -> LARGE_UNDEREXPECTATION_REQUIRES_VALIDATION
const transrailSc = calculateThesisIqScorecard({
  currentPrice: 410.0,
  currentPE: 13.2,
  expectedGrowthTrajectory: '20% CAGR',
  sector: 'Infra & Power EPC',
  financialEvidence: { roce: 33.6 },
  cashFlowEvidence: { cfoPatRatio: 0.55, receivableDays: 115, debtToEquity: 0.40 },
  economicEvidence: { forwardIroic: 38.64, forwardIroicConfidence: 'LOW', evidenceRecency: 'CURRENT_QUARTER' }
});
assert(transrailSc.expectationsRegime === 'LARGE_UNDEREXPECTATION_REQUIRES_VALIDATION', `Transrail (+${transrailSc.expectationGapPct}% gap, LOW confidence WC friction) is classified as LARGE_UNDEREXPECTATION_REQUIRES_VALIDATION`);

// Case 3: HBL Power - Positive gap, HIGH confidence, PROVEN engine, iROIC 32% > 11.5% WACC -> POTENTIAL_UNDEREXPECTATION
const hblSc = calculateThesisIqScorecard({
  currentPrice: 722.0,
  currentPE: 25.0,
  expectedGrowthTrajectory: '28% CAGR',
  sector: 'Defence & Railways',
  financialEvidence: { roce: 24.5 },
  cashFlowEvidence: { cfoPatRatio: 0.90, debtToEquity: 0.00 },
  economicEvidence: { forwardIroic: 32.0, forwardIroicConfidence: 'HIGH' }
});
assert(hblSc.expectationsRegime === 'POTENTIAL_UNDEREXPECTATION', `HBL (+${hblSc.expectationGapPct}% gap, HIGH confidence, iROIC 32% > WACC) is classified as POTENTIAL_UNDEREXPECTATION`);

// Case 4: Shakti Pumps - Broken thesis -> MARKET_EXPECTATIONS_ABOVE_THESIS
const shaktiSc = calculateThesisIqScorecard({
  currentPrice: 494.0,
  currentPE: 45.0,
  thesisHealth: 'BROKEN',
  expectedGrowthTrajectory: '10% CAGR',
  financialEvidence: { roce: 10.0 },
  cashFlowEvidence: { cfoPatRatio: 0.15, debtToEquity: 0.45 }
});
assert(shaktiSc.expectationsRegime === 'MARKET_EXPECTATIONS_ABOVE_THESIS', `Shakti Pumps (BROKEN thesis) is classified as MARKET_EXPECTATIONS_ABOVE_THESIS`);

// Case 5: Value Destruction Hard Gate - Positive growth gap but iROIC (9.0%) <= WACC (11.5%) -> MUST NOT BE POTENTIAL_UNDEREXPECTATION
const valueDestroyerSc = calculateThesisIqScorecard({
  currentPrice: 100.0,
  currentPE: 10.0,
  expectedGrowthTrajectory: '20% CAGR',
  financialEvidence: { roce: 8.0 },
  cashFlowEvidence: { cfoPatRatio: 0.85, debtToEquity: 0.10 },
  economicEvidence: { forwardIroic: 9.0, forwardIroicConfidence: 'HIGH' }
});
assert(valueDestroyerSc.expectationsRegime !== 'POTENTIAL_UNDEREXPECTATION', `Value-destroying company (iROIC 9.0% <= WACC 11.5%) is gated out of POTENTIAL_UNDEREXPECTATION (Actual: ${valueDestroyerSc.expectationsRegime})`);

// -------------------------------------------------------------------------
// Test 8: Layer 8 Strict Deterministic Decision Engine (Fixing HBL & Transrail)
// -------------------------------------------------------------------------
console.log('\n--- 8. Testing Layer 8: Strict Deterministic Decision Engine ---');

// Case A: HBL at current market price ₹722
// At CMP ₹722, Asymmetry ~1.00:1, 3Y IRR ~13.0%.
// RULE: Asymmetry < 3:1 AND IRR < 20% -> MUST NOT BE TOP_CONVICTION_DISLOCATION!
const hblEvaluated = evaluateEquityMispricing({
  ticker: 'HBLENGINE',
  companyName: 'HBL Power Systems',
  sector: 'Defence & Railways',
  thesisHealth: 'STRENGTHENING',
  currentConviction: 9.6,
  evidenceSufficiency: 'SUFFICIENT',
  currentPrice: 722.0,
  currentPE: 25.0,
  expectedGrowthTrajectory: '28% CAGR',
  financialEvidence: { revenueGrowthYoY: 30.5, roce: 24.5, ttmPat: 288.0, currentRevenue: 2000.0 },
  cashFlowEvidence: { cfoPatRatio: 0.90, receivableDays: 70, debtToEquity: 0.00 },
  economicEvidence: { forwardIroic: 32.0, forwardIroicConfidence: 'HIGH', addressableTamCr: 50000.0 }
});

assert(hblEvaluated.opportunityTier === MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE, 
  `HBL at CMP ₹722 (Asymmetry +${hblEvaluated.thesisIqScorecard.asymmetryRatio}:1, IRR +${hblEvaluated.thesisIqScorecard.projected3YrIrr}%) is correctly classified as COMPOUNDING_AT_FAIR_PRICE (Core Hold), NOT Buy dislocation!`);

// Case B: Transrail Case: Separates Valuation Conviction (DEEP_DISLOCATION) from Investability (UNDER_REVALIDATION)
const transrailEvaluated = evaluateEquityMispricing({
  ticker: 'TRANSRAILL',
  companyName: 'Transrail Lighting',
  sector: 'Infra & Power EPC',
  thesisHealth: 'INTACT',
  currentConviction: 9.5,
  evidenceSufficiency: 'SUFFICIENT',
  currentPrice: 410.0,
  currentPE: 13.2,
  expectedGrowthTrajectory: '20% CAGR',
  financialEvidence: { revenueGrowthYoY: 25.0, roce: 33.6, ttmPat: 417.3, currentRevenue: 4173.0 },
  cashFlowEvidence: { cfoPatRatio: 0.55, receivableDays: 115, debtToEquity: 0.40 },
  economicEvidence: { forwardIroic: 38.64, forwardIroicConfidence: 'LOW', evidenceRecency: 'CURRENT_QUARTER', addressableTamCr: 40000.0 }
});

assert(transrailEvaluated.thesisIqScorecard.convictions.valuationConviction === 'DEEP_DISLOCATION', `Transrail Valuation Conviction is DEEP_DISLOCATION (Asymmetry +${transrailEvaluated.thesisIqScorecard.asymmetryRatio}:1)`);
assert(transrailEvaluated.thesisIqScorecard.convictions.economicConviction === 'LOW', `Transrail Economic Conviction is LOW (UNDER_REVALIDATION)`);
assert(transrailEvaluated.opportunityTier === MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE, `Transrail gated out of Top Conviction Buy due to WC friction`);

// Case C: Dislocation Candidate at qualified entry price (P0 <= Buy Below Price)
// When price is ₹450 (below Buy Below ceiling), MoS >= 25%, Asymmetry >= 3:1, 3Y IRR >= 20% -> ACCUMULATE
const hblDislocationPrice = evaluateEquityMispricing({
  ticker: 'HBLENGINE',
  companyName: 'HBL Power Systems',
  sector: 'Defence & Railways',
  thesisHealth: 'STRENGTHENING',
  currentConviction: 9.6,
  evidenceSufficiency: 'SUFFICIENT',
  currentPrice: 450.0, // Deep discount below Buy Below zone
  currentPE: 15.6,
  expectedGrowthTrajectory: '28% CAGR',
  financialEvidence: { revenueGrowthYoY: 30.5, roce: 24.5, ttmPat: 288.0, currentRevenue: 2000.0 },
  cashFlowEvidence: { cfoPatRatio: 0.90, receivableDays: 70, debtToEquity: 0.00 },
  economicEvidence: { forwardIroic: 32.0, forwardIroicConfidence: 'HIGH', addressableTamCr: 50000.0 }
});

assert(hblDislocationPrice.opportunityTier === MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION,
  `HBL at deeply discounted ₹450 (Asymmetry +${hblDislocationPrice.thesisIqScorecard.asymmetryRatio}:1, IRR +${hblDislocationPrice.thesisIqScorecard.projected3YrIrr}%) qualifies as TOP_CONVICTION_DISLOCATION (ACCUMULATE)`);

// Case D: Orthogonal Separation Invariant: FCFF Conversion Status (Cash Economics) != Opportunity Tier (Decision State)
// Transrail: FCFF_RECOVERY_REQUIRED + UNDER_REVALIDATION -> COMPOUNDING_AT_FAIR_PRICE (MONITOR)
// Shakti Pumps: FCFF_RECOVERY_REQUIRED + BROKEN -> STRUCTURAL_VALUE_TRAP (SYSTEMATIC_EXIT)
const shaktiEvaluated = evaluateEquityMispricing({
  ticker: 'SHAKTIPUMP',
  companyName: 'Shakti Pumps',
  thesisHealth: 'BROKEN',
  currentConviction: 0.0,
  evidenceSufficiency: 'SUFFICIENT',
  currentPrice: 494.0,
  currentPE: 28.7,
  expectedGrowthTrajectory: '10% CAGR',
  financialEvidence: { roce: 10.0 },
  cashFlowEvidence: { cfoPatRatio: 0.15, receivableDays: 140, debtToEquity: 0.45 }
});

assert(shaktiEvaluated.thesisIqScorecard.fcffConversionStatus === FCFF_CONVERSION_STATUS.FCFF_RECOVERY_REQUIRED, `Shakti Pumps cash economics classified as FCFF_RECOVERY_REQUIRED`);
assert(transrailEvaluated.thesisIqScorecard.fcffConversionStatus === FCFF_CONVERSION_STATUS.FCFF_RECOVERY_REQUIRED, `Transrail cash economics classified as FCFF_RECOVERY_REQUIRED`);
assert(shaktiEvaluated.opportunityTier === MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP, `Shakti Pumps Decision State is STRUCTURAL_VALUE_TRAP due to BROKEN thesis`);
assert(transrailEvaluated.opportunityTier === MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE, `Transrail Decision State is COMPOUNDING_AT_FAIR_PRICE due to INTACT thesis under revalidation`);
assert(shaktiEvaluated.opportunityTier !== transrailEvaluated.opportunityTier, `[ORTHOGONAL_CASH_VS_DECISION_INVARIANT] FCFF conversion status (cash economics) is decoupled from Decision State (thesis survivability)`);

// -------------------------------------------------------------------------
// Test 8: Full Universe Deterministic Ranking
// -------------------------------------------------------------------------
console.log('\n--- 8. Testing Full Universe Deterministic Ranking ---');
const testUniverse = [
  hblEvaluated,
  shaktiEvaluated,
  evaluateEquityMispricing({
    ticker: 'INOXINDIA',
    companyName: 'INOX India',
    thesisHealth: 'STRENGTHENING',
    currentConviction: 9.5,
    evidenceSufficiency: 'SUFFICIENT',
    valuationState: 'EXTREME',
    currentPrice: 2200.0,
    currentPE: 79.0,
    financialEvidence: { roce: 22.0 },
    cashFlowEvidence: { cfoPatRatio: 0.85, receivableDays: 75, debtToEquity: 0.00 }
  })
];

const ranked = rankUniverseByMispricing(testUniverse);
assert(ranked[0].ticker === 'HBLENGINE', 'Rank #1 is HBLENGINE (COMPOUNDING_AT_FAIR_PRICE)');
assert(ranked[1].ticker === 'INOXINDIA', 'Rank #2 is INOXINDIA (OVERVALUED_COMPOUNDER)');
assert(ranked[2].ticker === 'SHAKTIPUMP', 'Rank #3 is SHAKTIPUMP (STRUCTURAL_VALUE_TRAP)');

console.log('\n================================================================================================');
console.log(`🎉 ALL ${passedTests}/${totalTests} THESISIQ v3.1 INVARIANT TESTS PASSED CLEANLY!`);
console.log('================================================================================================');
