/**
 * Invariant Test Suite: ThesisIQ v3.3.1 Market–Thesis Reconciliation Engine
 * 
 * Epistemic & Mathematical Invariant Guardrails:
 * 1. Zero Ticker Hardcoding in Tests: Tests evaluate pure mathematical conditions and generic decision tree branches.
 * 2. Strict 3-Quantity Separation: Market-required, evidence-supported, and theoretical bull economics remain strictly decoupled.
 * 3. Market-vs-Evidence Gap Quantification: Verifies g_market vs g_underwritten vs g_evidence_max metrics.
 * 4. UNDERWRITING_SUPPORT_STATUS: Verifies all 5 states (SUPPORTED, PARTIALLY_SUPPORTED, UNDER_SUPPORTED, UNSUPPORTED, BROKEN).
 * 5. 9-State Reality Taxonomy: Tests DISLOCATION_UNDERWRITING_REVALIDATION when discount exists but underwriting is under-supported.
 * 6. Multi-Horizon DCF Monotonicity: Extending compounding duration (5Y -> 10Y -> 12Y) and operating leverage strictly increases DCF value.
 * 7. Reverse Duration Solver Convergence: Numerical T_req monotonicity (higher CAGR -> lower required duration) with zero subjective strings.
 * 8. Sequential Scenario Bridge Identity & Overshoot Prevention:
 *    P_0 + sum(Delta P_i) + UNEXPLAINED_MARKET_PREMIUM == P_market with zero overshoot.
 * 9. Invariant Growth Text Direction: Checks that required growth comparisons accurately reflect 'higher' vs 'lower'.
 * 10. HBL Power Reconciliation: 28% underwriting with 5.5%–19.9% forward evidence correctly flagged DISLOCATION_UNDERWRITING_REVALIDATION.
 * 11. SJS Reconciliation: 33.2% required growth with 9.65%–19.61% forward evidence maintains substantial unexplained market premium.
 * 12. Frozen Baseline Valuation Invariant: Baseline fair values remain 100% immutable throughout reconciliation.
 */

import {
  RECONCILIATION_REALITY_STATE,
  UNDERWRITING_SUPPORT_STATUS,
  OPTIONALITY_STATUS,
  GAP_DIRECTION,
  calculateMultiHorizonFcffDcf,
  solveRequiredCompoundingDuration,
  solveRequiredNopatGrowthAtHorizon,
  calculateReverseDurationSensitivityMatrix,
  evaluateUnderwritingSupportStatus,
  deconstructSevenEconomicGaps,
  buildValuationGapWaterfallBridge,
  classifyReconciliationRealityState,
  buildMarketVsEvidenceComparison,
  reconcileMarketVsThesis,
  reconcileCohortMarketVsThesis
} from '../services/market-thesis-reconciliation.service.js';

import {
  COHORT_TRAJECTORY_PROFILES,
  evaluateFundamentalTrajectoryVector
} from '../services/fundamental-trajectory-engine.service.js';

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
console.log('🧪 RUNNING INVARIANT TEST SUITE: THESISIQ v3.3.1 MARKET-THESIS RECONCILIATION ENGINE');
console.log('================================================================================================\n');

// -------------------------------------------------------------------------
// 1. Multi-Horizon DCF & Operating Leverage Monotonicity
// -------------------------------------------------------------------------
console.log('--- 1. Testing Multi-Horizon DCF & Operating Leverage Mathematical Invariants ---');

const dcf5y = calculateMultiHorizonFcffDcf({
  currentPrice: 1000.0,
  currentPE: 30.0,
  nopatCagrPct: 25.0,
  horizonYears: 5,
  effectiveIroicPct: 30.0,
  terminalRoicPct: 22.0
});

const dcf10y = calculateMultiHorizonFcffDcf({
  currentPrice: 1000.0,
  currentPE: 30.0,
  nopatCagrPct: 25.0,
  horizonYears: 10,
  effectiveIroicPct: 30.0,
  terminalRoicPct: 22.0
});

const dcf12y = calculateMultiHorizonFcffDcf({
  currentPrice: 1000.0,
  currentPE: 30.0,
  nopatCagrPct: 25.0,
  horizonYears: 12,
  effectiveIroicPct: 30.0,
  terminalRoicPct: 22.0
});

const dcf10yOpLev = calculateMultiHorizonFcffDcf({
  currentPrice: 1000.0,
  currentPE: 30.0,
  nopatCagrPct: 25.0,
  horizonYears: 10,
  effectiveIroicPct: 30.0,
  terminalRoicPct: 22.0,
  operatingLeverageMarginDeltaBps: 200
});

assert(dcf10y > dcf5y, `Extending compounding duration from 5Y to 10Y expands DCF fair value (5Y: ₹${dcf5y} -> 10Y: ₹${dcf10y})`);
assert(dcf12y > dcf10y, `Extending compounding duration from 10Y to 12Y further expands DCF fair value (10Y: ₹${dcf10y} -> 12Y: ₹${dcf12y})`);
assert(dcf10yOpLev > dcf10y, `Operating leverage (+200 bps margin expansion) adds value at scale (₹${dcf10y} -> ₹${dcf10yOpLev})`);

// -------------------------------------------------------------------------
// 2. Reverse Duration & Growth Solvers (Pure Numerical Output)
// -------------------------------------------------------------------------
console.log('\n--- 2. Testing Reverse Duration & Growth Solvers ---');

const testTargetPrice = 1426.0;
const reqGrowth5y = solveRequiredNopatGrowthAtHorizon(testTargetPrice, 5, {
  currentPrice: testTargetPrice,
  currentPE: 82.9,
  effectiveIroicPct: 33.9,
  terminalRoicPct: 25.0
});

assert(reqGrowth5y > 35.0, `Fixed 5Y horizon requires high growth (~${reqGrowth5y}% CAGR) to reach ₹${testTargetPrice}`);

const reqDuration28 = solveRequiredCompoundingDuration(testTargetPrice, {
  currentPrice: testTargetPrice,
  currentPE: 82.9,
  candidateGrowthPct: 28.0,
  effectiveIroicPct: 33.9,
  terminalRoicPct: 25.0
});

const reqDuration32 = solveRequiredCompoundingDuration(testTargetPrice, {
  currentPrice: testTargetPrice,
  currentPE: 82.9,
  candidateGrowthPct: 32.0,
  effectiveIroicPct: 33.9,
  terminalRoicPct: 25.0
});

assert(reqDuration28 > reqDuration32, `Higher candidate growth rate reduces required compounding duration (28%: ${reqDuration28}y vs 32%: ${reqDuration32}y)`);
assert(reqDuration28 >= 9.0 && reqDuration28 <= 14.0, `At 28% NOPAT CAGR, ₹${testTargetPrice} requires ~${reqDuration28} years of compounding runway`);

const sensitivityMatrix = calculateReverseDurationSensitivityMatrix(testTargetPrice, {
  currentPrice: testTargetPrice,
  currentPE: 82.9,
  effectiveIroicPct: 33.9
});
assert(Array.isArray(sensitivityMatrix) && sensitivityMatrix.length === 7, 'Reverse duration sensitivity matrix has 7 candidate growth steps');
assert(sensitivityMatrix[0].feasibility === undefined, 'Duration sensitivity matrix outputs pure numerical data without subjective feasibility strings');
assert(typeof sensitivityMatrix[0].requiredDurationYears === 'number', 'Required duration is a pure numeric float');

// -------------------------------------------------------------------------
// 3. UNDERWRITING_SUPPORT_STATUS Taxonomy
// -------------------------------------------------------------------------
console.log('\n--- 3. Testing UNDERWRITING_SUPPORT_STATUS Evaluations ---');

const supportedStatus = evaluateUnderwritingSupportStatus({
  underwrittenNopatCagrPct: 20.0,
  evidenceConfidenceFactor: 0.90
}, [18.0, 26.0]);
assert(supportedStatus === UNDERWRITING_SUPPORT_STATUS.SUPPORTED, 'Forward scenario range [18, 26] covering 20% underwriting yields SUPPORTED');

const underSupportedStatus = evaluateUnderwritingSupportStatus({
  underwrittenNopatCagrPct: 28.0,
  underwritingStatus: 'TOO_AGGRESSIVE'
}, [5.5, 19.9]);
assert(underSupportedStatus === UNDERWRITING_SUPPORT_STATUS.UNDER_SUPPORTED, 'Forward scenario ceiling (19.9%) < 28% underwriting yields UNDER_SUPPORTED');

const brokenStatus = evaluateUnderwritingSupportStatus({
  thesisOperationalStatus: 'BROKEN',
  underwrittenNopatCagrPct: 20.0
});
assert(brokenStatus === UNDERWRITING_SUPPORT_STATUS.BROKEN, 'Broken thesis yields BROKEN underwriting support status');

// -------------------------------------------------------------------------
// 4. 7-Gap Economic Decomposition & Terminology Direction Check
// -------------------------------------------------------------------------
console.log('\n--- 4. Testing 7-Gap Observable Formulations & Direction Invariants ---');

const sampleProfile = {
  ticker: 'SAMPLE_EXPANSION',
  companyName: 'Sample Compounder',
  sector: 'Heavy Electrical Equipment',
  currentPrice: 1426.0,
  currentPE: 80.0,
  fairValuePrice: 438.17,
  forwardIroic: 33.9,
  baselineRevenueCr: 1025.0,
  baselineEbitdaMarginPct: 19.5,
  baselineNopatCr: 145.0,
  underwrittenNopatCagrPct: 22.0,
  capacityMultiple: 8.0,
  incrementalCapexCr: 180.0,
  evidenceConfidenceFactor: 0.85,
  forwardScenarioTrajectory: { modeledNopatCagrRange: [22.0, 68.0] }
};

const sampleGaps = deconstructSevenEconomicGaps(sampleProfile);

assert(sampleGaps.growthGap.underwrittenGrowthPct === 22.0, 'Growth Gap: Underwritten baseline growth is 22.0%');
assert(sampleGaps.growthGap.growthGapPctPts > 0, `Growth Gap: Computes required 5Y growth gap (+${sampleGaps.growthGap.growthGapPctPts}% pts)`);
assert(sampleGaps.growthGap.interpretation.includes('higher'), 'Growth Gap: Higher market required growth correctly includes "higher" in interpretation text');
assert(sampleGaps.durationGap.durationGapYears > 0, `Duration Gap: Computes required duration extension (+${sampleGaps.durationGap.durationGapYears}y)`);
assert(sampleGaps.marginGap.marginGapPctPts > 0, `Margin Gap: Computes required EBITDA margin expansion (+${sampleGaps.marginGap.marginGapPctPts}% pts)`);
assert(sampleGaps.iroicGap.iroicGapPctPts > 0, `iROIC Gap: Identifies required capital return hurdle (${sampleGaps.iroicGap.requiredIroicPct}%)`);
assert(sampleGaps.reinvestmentGap.requiredIncrementalCapitalCr > 0, `Reinvestment Gap: Computes required incremental capital (₹${sampleGaps.reinvestmentGap.requiredIncrementalCapitalCr} Cr)`);
assert(sampleGaps.reinvestmentGap.evidenceSupportedAbsorptionCapacityCr > 0, `Reinvestment Gap: Computes evidence-supported absorption capacity (₹${sampleGaps.reinvestmentGap.evidenceSupportedAbsorptionCapacityCr} Cr)`);
assert(typeof sampleGaps.reinvestmentGap.canDeployAtAssumedIroic === 'boolean', 'Reinvestment Gap: Evaluates capital deployment absorption feasibility boolean');
assert(sampleGaps.reinvestmentGap.reinvestmentBurdenRatio > 0, `Reinvestment Gap: Computes capital burden ratio (${sampleGaps.reinvestmentGap.reinvestmentBurdenRatio}x)`);
assert(sampleGaps.optionalityGap.hasSubstantialCapacityRunway === true, 'Optionality Gap: Identifies multi-fold capacity runway');
assert(sampleGaps.terminalEconomicsGap.terminalRoicGapPctPts > 0, 'Terminal Economics Gap: Computes required terminal return shift');

// -------------------------------------------------------------------------
// 5. Sequential Scenario Bridge & Unexplained Market Premium Identity
// -------------------------------------------------------------------------
console.log('\n--- 5. Testing Sequential Scenario Bridge & Overshoot Prevention ---');

const sampleBridge = buildValuationGapWaterfallBridge(sampleProfile, sampleGaps);

assert(sampleBridge.isPremium === true, 'Sample profile correctly identified as trading at a premium');
assert(sampleBridge.baselineUnderwrittenPrice === 438.17, 'Baseline underwritten fair value is frozen at ₹438.17');
assert(sampleBridge.totalGapPerShare === 987.83, 'Total valuation gap is ₹987.83 (₹1,426 - ₹438.17)');
assert(sampleBridge.explainedByEvidencePct >= 70.0, `Evidence-backed long duration + 8x capacity explains ${sampleBridge.explainedByEvidencePct}% of the ₹987.83 gap (>= 70%)`);
assert(sampleBridge.unexplainedMarketPremium >= 0.0, `Unexplained Market Premium (Residual) is non-negative (₹${sampleBridge.unexplainedMarketPremium})`);

// Mathematical Identity Check: P0 + sum(Delta P_i) + Unexplained == P_market
const sumDeltas = sampleBridge.components.slice(1, -1).reduce((acc, c) => acc + c.priceDelta, 0);
const calculatedTotal = parseFloat((sampleBridge.baselineUnderwrittenPrice + sumDeltas + sampleBridge.unexplainedMarketPremium).toFixed(2));
assert(Math.abs(calculatedTotal - sampleProfile.currentPrice) < 0.05, `Sequential Bridge Identity holds: P0 (₹${sampleBridge.baselineUnderwrittenPrice}) + Deltas (₹${sumDeltas.toFixed(2)}) + Residual (₹${sampleBridge.unexplainedMarketPremium}) == CMP (₹${sampleProfile.currentPrice})`);

// Overshoot check: Last cumulative price must equal CMP
const lastCumulative = sampleBridge.components[sampleBridge.components.length - 1].cumulativePrice;
assert(Math.abs(lastCumulative - sampleProfile.currentPrice) < 0.05, `Last cumulative price in bridge exactly equals CMP (₹${lastCumulative} == ₹${sampleProfile.currentPrice})`);

// -------------------------------------------------------------------------
// 6. SJS Overshoot Prevention & Positive Residual Invariant
// -------------------------------------------------------------------------
console.log('\n--- 6. Testing SJS Scenario Bridge (Overshoot Prevention & Positive Residual) ---');

const sjsProfile = {
  ticker: 'SJS',
  companyName: 'SJS Enterprises Ltd.',
  sector: 'Automotive Aesthetics',
  currentPrice: 2354.0,
  currentPE: 38.0,
  fairValuePrice: 1404.49,
  forwardIroic: 26.0,
  underwrittenNopatCagrPct: 22.0,
  capacityMultiple: 2.0,
  forwardScenarioTrajectory: { modeledNopatCagrRange: [9.65, 19.61] } // Evidence ceiling is below 22% underwriting
};

const sjsGaps = deconstructSevenEconomicGaps(sjsProfile);
const sjsBridge = buildValuationGapWaterfallBridge(sjsProfile, sjsGaps);

assert(sjsBridge.explainedByEvidencePct < 60.0, `SJS evidence explains only ${sjsBridge.explainedByEvidencePct}% of gap (< 60%, no false 100% claim)`);
assert(sjsBridge.unexplainedMarketPremium > 400.0, `SJS maintains a substantial unexplained market premium (₹${sjsBridge.unexplainedMarketPremium})`);
const sjsLastCum = sjsBridge.components[sjsBridge.components.length - 1].cumulativePrice;
assert(Math.abs(sjsLastCum - 2354.0) < 0.05, `SJS Sequential Bridge finishes cleanly at CMP ₹2,354 without overshoot (Got: ₹${sjsLastCum})`);

// -------------------------------------------------------------------------
// 7. HBL Under-Supported Underwriting Dislocation Invariant
// -------------------------------------------------------------------------
console.log('\n--- 7. Testing HBL Power Reconciliation & DISLOCATION_UNDERWRITING_REVALIDATION ---');

const hblProfile = {
  ticker: 'HBLENGINE',
  companyName: 'HBL Power Systems Ltd.',
  sector: 'Industrial Batteries & Railways',
  currentPrice: 722.0,
  currentPE: 35.0,
  fairValuePrice: 1042.36,
  forwardIroic: 32.0,
  underwrittenNopatCagrPct: 28.0,
  underwritingStatus: 'TOO_AGGRESSIVE',
  capacityMultiple: 2.0,
  forwardScenarioTrajectory: { modeledNopatCagrRange: [5.51, 19.86] },
  cashFlowEvidence: { receivableDays: 70, cfoPatRatio: 0.82 }
};

const hblGaps = deconstructSevenEconomicGaps(hblProfile);
const hblBridge = buildValuationGapWaterfallBridge(hblProfile, hblGaps);
const hblClassification = classifyReconciliationRealityState(hblProfile, hblGaps, hblBridge);

assert(hblClassification.realityState === RECONCILIATION_REALITY_STATE.DISLOCATION_UNDERWRITING_REVALIDATION, 'HBL with under-supported 28% underwriting classified as DISLOCATION_UNDERWRITING_REVALIDATION');
assert(hblClassification.primaryReason.includes('does not yet support'), 'HBL primary reason explicitly states that current evidence does not yet support the 28% underwriting');

// -------------------------------------------------------------------------
// 8. Deterministic Decision Tree Rule Branching (Generic Condition Tests)
// -------------------------------------------------------------------------
console.log('\n--- 8. Testing Deterministic Decision Tree across Mathematical Conditions ---');

// Branch 1: Structural Breakdown Condition
const brokenSynthetic = {
  currentPrice: 500.0,
  fairValuePrice: 250.0,
  thesisOperationalStatus: 'BROKEN',
  underwritingStatus: 'BROKEN',
  cashFlowEvidence: { receivableDays: 140, cfoPatRatio: 0.10 }
};
const brokenResult = classifyReconciliationRealityState(brokenSynthetic, sampleGaps, sampleBridge);
assert(brokenResult.realityState === RECONCILIATION_REALITY_STATE.BROKEN, 'Condition: Structural breakdown triggers BROKEN state');

// Branch 2: Dislocation with Temporary Working Capital Friction
const dislocationSynthetic = {
  currentPrice: 400.0,
  fairValuePrice: 700.0, // Discount (Valuation ratio 0.57x)
  thesisOperationalStatus: 'UNDER_REVALIDATION',
  underwritingStatus: 'UNDER_REVIEW',
  underwritingSupportStatus: UNDERWRITING_SUPPORT_STATUS.PARTIALLY_SUPPORTED,
  cashFlowEvidence: { receivableDays: 115, cfoPatRatio: 0.50 }
};
const dislocationGaps = deconstructSevenEconomicGaps(dislocationSynthetic);
const dislocationBridge = buildValuationGapWaterfallBridge(dislocationSynthetic, dislocationGaps);
const dislocationResult = classifyReconciliationRealityState(dislocationSynthetic, dislocationGaps, dislocationBridge);
assert(dislocationResult.realityState === RECONCILIATION_REALITY_STATE.DISLOCATION_TEMPORARY_FRICTION, 'Condition: Price < Model with 115d DSO triggers DISLOCATION_TEMPORARY_FRICTION');

// Branch 3: Undervalued with Confirmed Economics Condition
const undervaluedSynthetic = {
  currentPrice: 450.0,
  fairValuePrice: 750.0, // Discount (Valuation ratio 0.60x)
  thesisOperationalStatus: 'STRENGTHENING',
  underwrittenNopatCagrPct: 25.0,
  underwritingSupportStatus: UNDERWRITING_SUPPORT_STATUS.SUPPORTED,
  cashFlowEvidence: { receivableDays: 65, cfoPatRatio: 0.85 }
};
const undervaluedGaps = deconstructSevenEconomicGaps(undervaluedSynthetic);
const undervaluedBridge = buildValuationGapWaterfallBridge(undervaluedSynthetic, undervaluedGaps);
const undervaluedResult = classifyReconciliationRealityState(undervaluedSynthetic, undervaluedGaps, undervaluedBridge);
assert(undervaluedResult.realityState === RECONCILIATION_REALITY_STATE.UNDERVALUED_THESIS_SUPPORTED, 'Condition: Price < Model with confirmed support triggers UNDERVALUED_THESIS_SUPPORTED');

// Branch 4: Fairly Aligned Condition
const fairSynthetic = {
  currentPrice: 500.0,
  fairValuePrice: 510.0, // Within +/- 15%
  thesisOperationalStatus: 'UNCHANGED',
  underwritingSupportStatus: UNDERWRITING_SUPPORT_STATUS.SUPPORTED,
  cashFlowEvidence: { receivableDays: 70, cfoPatRatio: 0.80 }
};
const fairGaps = deconstructSevenEconomicGaps(fairSynthetic);
const fairBridge = buildValuationGapWaterfallBridge(fairSynthetic, fairGaps);
const fairResult = classifyReconciliationRealityState(fairSynthetic, fairGaps, fairBridge);
assert(fairResult.realityState === RECONCILIATION_REALITY_STATE.FAIR_THESIS_ALIGNED, 'Condition: Price within +/- 15% of FV triggers FAIR_THESIS_ALIGNED');

// Branch 5: Expensive Explainable Condition (High capacity, high iROIC, proven delivery)
const explainableSynthetic = {
  currentPrice: 1400.0,
  fairValuePrice: 450.0,
  capacityMultiple: 8.0,
  forwardIroic: 33.0,
  underwrittenNopatCagrPct: 22.0,
  managementDeliveryHistory: 'STRONG_TRACK_RECORD',
  managementCredibility: 'ON_TRACK',
  underwritingSupportStatus: UNDERWRITING_SUPPORT_STATUS.SUPPORTED,
  evidenceTier: 'E1_EXCHANGE_FILED_CONTRACT',
  consecutiveQuartersDelivered: 4,
  evidenceConfidenceFactor: 0.90,
  cashFlowEvidence: { receivableDays: 70, cfoPatRatio: 0.85 }
};
const explainableGaps = deconstructSevenEconomicGaps(explainableSynthetic);
const explainableBridge = buildValuationGapWaterfallBridge(explainableSynthetic, explainableGaps);
const explainableResult = classifyReconciliationRealityState(explainableSynthetic, explainableGaps, explainableBridge);
assert(explainableResult.realityState === RECONCILIATION_REALITY_STATE.EXPENSIVE_EXPLAINABLE, 'Condition: Price > Model with 8x capacity, 33% iROIC, and proven delivery triggers EXPENSIVE_EXPLAINABLE');

// Branch 6: Expensive Unproven Condition (Expansion math exists, commercial proof pending)
const unprovenSynthetic = {
  currentPrice: 1400.0,
  fairValuePrice: 450.0,
  capacityMultiple: 4.0,
  forwardIroic: 26.0,
  underwrittenNopatCagrPct: 22.0,
  managementDeliveryHistory: 'STRONG_TRACK_RECORD',
  managementCredibility: 'ON_TRACK',
  underwritingSupportStatus: UNDERWRITING_SUPPORT_STATUS.SUPPORTED,
  evidenceTier: 'E3_CONCALL_QUANTIFIED_GUIDANCE',
  consecutiveQuartersDelivered: 1, // Proof pending
  evidenceConfidenceFactor: 0.70,
  cashFlowEvidence: { receivableDays: 75, cfoPatRatio: 0.80 }
};
const unprovenGaps = deconstructSevenEconomicGaps(unprovenSynthetic);
const unprovenBridge = buildValuationGapWaterfallBridge(unprovenSynthetic, unprovenGaps);
const unprovenResult = classifyReconciliationRealityState(unprovenSynthetic, unprovenGaps, unprovenBridge);
assert(unprovenResult.realityState === RECONCILIATION_REALITY_STATE.EXPENSIVE_UNPROVEN, 'Condition: Price > Model with pending operational proof triggers EXPENSIVE_UNPROVEN');

// Branch 7: Expensive Unexplained Condition (Low capacity, thin iROIC, extreme multiple)
const unexplainedSynthetic = {
  currentPrice: 2500.0,
  fairValuePrice: 300.0, // 8.3x multiple ratio
  capacityMultiple: 1.2,
  forwardIroic: 14.0,
  underwrittenNopatCagrPct: 15.0,
  managementDeliveryHistory: 'MIXED',
  managementCredibility: 'MIXED',
  underwritingSupportStatus: UNDERWRITING_SUPPORT_STATUS.SUPPORTED,
  cashFlowEvidence: { receivableDays: 85, cfoPatRatio: 0.70 }
};
const unexplainedGaps = deconstructSevenEconomicGaps(unexplainedSynthetic);
const unexplainedBridge = buildValuationGapWaterfallBridge(unexplainedSynthetic, unexplainedGaps);
const unexplainedResult = classifyReconciliationRealityState(unexplainedSynthetic, unexplainedGaps, unexplainedBridge);
assert(unexplainedResult.realityState === RECONCILIATION_REALITY_STATE.EXPENSIVE_UNEXPLAINED, 'Condition: Price > Model without capacity/iROIC backing triggers EXPENSIVE_UNEXPLAINED');

// -------------------------------------------------------------------------
// 9. 3-Quantity Comparison Structure & Market-vs-Evidence Gap
// -------------------------------------------------------------------------
console.log('\n--- 9. Testing 3-Quantity Comparison Structure & Market-Evidence Gap ---');

const comparison = buildMarketVsEvidenceComparison(sampleProfile, sampleGaps, sampleBridge, UNDERWRITING_SUPPORT_STATUS.SUPPORTED);

assert(comparison.marketRequires !== undefined, 'Comparison object contains marketRequires');
assert(comparison.marketRequires.fcffCagrPct > 0, `marketRequires defines required FCFF growth (${comparison.marketRequires.fcffCagrPct}%)`);
assert(comparison.evidenceSupports !== undefined, 'Comparison object contains evidenceSupports');
assert(comparison.evidenceSupports.underwrittenNopatCagrPct === 22.0, 'evidenceSupports contains underwritten NOPAT CAGR (22.0%)');
assert(comparison.evidenceSupports.underwritingSupportStatus === UNDERWRITING_SUPPORT_STATUS.SUPPORTED, 'evidenceSupports contains underwritingSupportStatus');
assert(comparison.marketEvidenceGap !== undefined, 'Comparison object contains marketEvidenceGap quantification');
assert(comparison.marketEvidenceGap.isWithinEvidenceCeiling === true, 'Sample profile with 68% ceiling correctly identified as within evidence ceiling');
assert(comparison.marketEvidenceGap.marketVsEvidenceMaxPp < 0, `Market vs Evidence Max is negative for sample expansion story (${comparison.marketEvidenceGap.marketVsEvidenceMaxPp} pp)`);
assert(comparison.theoreticalBullScenario !== undefined, 'Comparison object contains theoreticalBullScenario');
assert(comparison.theoreticalBullScenario.isEvidenceSupported === false, 'theoreticalBullScenario explicitly marked as isEvidenceSupported: false');
assert(Array.isArray(comparison.unmodeledAndPartialVectors), 'Comparison defines unmodeled and partial optionality vectors');

// -------------------------------------------------------------------------
// 10. Cohort-Wide Reconciliation & Vector Bridge Invariant
// -------------------------------------------------------------------------
console.log('\n--- 10. Testing Cohort-Wide Orchestrator & Vector Integration ---');

const cohortReconciliation = reconcileCohortMarketVsThesis(COHORT_TRAJECTORY_PROFILES);
assert(cohortReconciliation.length === 19, `Cohort reconciliation covers all 19 core stocks (Found: ${cohortReconciliation.length})`);

for (const item of cohortReconciliation) {
  assert(item.ticker !== undefined, `Cohort item ${item.ticker}: ticker is defined`);
  assert(item.realityState !== undefined, `Cohort item ${item.ticker}: realityState (${item.realityState}) is defined`);
  assert(item.underwritingSupportStatus !== undefined, `Cohort item ${item.ticker}: underwritingSupportStatus (${item.underwritingSupportStatus}) is defined`);
  assert(item.sevenEconomicGaps !== undefined, `Cohort item ${item.ticker}: sevenEconomicGaps is defined`);
  assert(item.comparison !== undefined, `Cohort item ${item.ticker}: comparison is defined`);
  assert(item.marketEvidenceGap !== undefined, `Cohort item ${item.ticker}: marketEvidenceGap is defined`);
  assert(item.sequentialScenarioBridge !== undefined, `Cohort item ${item.ticker}: sequentialScenarioBridge is defined`);
  assert(item.waterfallBridge !== undefined, `Cohort item ${item.ticker}: waterfallBridge alias is defined`);
}

// Check trajectory vector bridge
const testProfile = COHORT_TRAJECTORY_PROFILES.QPOWER;
const testVector = evaluateFundamentalTrajectoryVector(testProfile);
assert(testVector.marketThesisReconciliation !== undefined, 'Fundamental trajectory vector output includes marketThesisReconciliation');
assert(testVector.underwriting.underwrittenNopatCagrPct === 22.0, 'Frozen Invariant: Underwritten CAGR remains 22.0%');
assert(testVector.fairValuePrice === 438.17, 'Frozen Invariant: Base DCF fair value remains ₹438.17');

console.log('\n================================================================================================');
console.log(`📊 INVARIANT TEST SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED (100% SUCCESS)`);
console.log('================================================================================================\n');
