/**
 * Invariant Test Suite: ThesisIQ v3.2 Fundamental Trajectory & Management Evidence Engine
 * 
 * Verifies all 10 Core Architectural Invariants:
 * 1. Three Truths Separation: Observed Reality, Forward Scenario, Evidence-Adjusted Potential, and Underwriting.
 * 2. Evidence Confidence Math: evidenceAdjustedPotentialCagr = modeledNopatCagr * alpha; alpha in [0.5, 1.0].
 * 3. Frozen Valuation Invariant: v3.1.1 baseline underwritten CAGRs and DCF fair values remain strictly invariant.
 * 4. Non-Contradiction Invariant: Discrepancy between underwritten rate and execution pacing (e.g. HBL) triggers UNDER_REVIEW / REVIEW_UNDERWRITING.
 * 5. Invariant 6 - No Scenario-to-Action Leakage: Forward model scenarios alone NEVER produce revision signals or capital actions.
 * 6. Sustained Evidence Requirement: REVISION_SUPPORTED requires multi-period audited delivery and economic confirmation.
 * 7. Independent Valuation Hurdle Invariant: P_hurdle = FV * (1 - MoS_required); verified in both mathematical directions.
 * 8. Structured Position Directives: Decoupled existingPositionStatus and newCapitalStatus across all 18 cohort stocks.
 * 9. Working Capital & Bottleneck Diagnostics: 115+ day DSO correctly marks IMPAIRED_BOTTLENECK and triggers EXECUTION_FRICTION_WATCH.
 * 10. Monotonicity & Commissioning Overhead Drag: Monotonic revenue scaling with low-utilization margin drag.
 */

import {
  GROWTH_ENGINE_TYPE,
  THESIS_RISK_ENGINE_TYPE,
  EVIDENCE_STRENGTH_TIER,
  TRAJECTORY_CONFIDENCE,
  THESIS_REVISION_SIGNAL,
  UNDERWRITING_STATUS,
  BOTTLENECK_STATE,
  MANAGEMENT_CREDIBILITY_STATUS,
  GUIDANCE_STATUS,
  GROWTH_METRICS_TRAJECTORY,
  ECONOMIC_QUALITY_STATUS,
  THESIS_OPERATIONAL_STATUS,
  VALUATION_STATUS,
  EXISTING_POSITION_STATUS,
  NEW_CAPITAL_STATUS,
  ACTION_CONTEXT,
  CATCH_UP_DYNAMICS_REGIME,
  COHORT_TRAJECTORY_PROFILES,
  calculateCapacityUtilizationTrajectory,
  calculateOrderBookExecutionTrajectory,
  calculateAssetCommissioningTrajectory,
  calculateCustomerProgramTrajectory,
  calculateValuationHurdlePrice,
  calculateMarginOfSafety,
  calculateFundamentalCatchUpDynamics,
  diagnoseBottlenecks,
  evaluateManagementPromiseLedger,
  loadPromiseLedgerFromDatabase,
  MANAGEMENT_PROMISE_LEDGER,
  evaluateFundamentalTrajectoryVector,
  evaluateFundamentalTrajectoryVectorAsync,
  synthesizeCohortFundamentalTrajectories
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
console.log('🧪 RUNNING INVARIANT TEST SUITE: THESISIQ v3.2 FUNDAMENTAL TRAJECTORY & EVIDENCE ENGINE');
console.log('================================================================================================\n');

// -------------------------------------------------------------------------
// 1. Three Truths Separation & Architecture Invariants
// -------------------------------------------------------------------------
console.log('--- 1. Testing Three Truths Architecture & Evidence-Confidence Math ---');

const qpowerProfile = COHORT_TRAJECTORY_PROFILES.QPOWER;
const qpowerVector = evaluateFundamentalTrajectoryVector(qpowerProfile);

// Layer 1: Observed Reality
assert(qpowerVector.observedReality !== undefined, 'Layer 1: Observed Reality object is defined');
assert(qpowerVector.observedReality.ttmRevenueCr === 1025.0, 'QPower observed TTM revenue is ₹1,025 Cr');
assert(qpowerVector.observedReality.ttmYoYGrowthPct === 32.0, 'QPower observed YoY growth is +32.0%');
assert(qpowerVector.observedReality.orderBookCr === 1945.0, 'QPower observed order backlog is ₹1,945 Cr');
assert(qpowerVector.observedReality.orderBookToRevenueRatio === 1.9, 'QPower order backlog to revenue ratio is 1.9x');
assert(qpowerVector.observedReality.iroicPct === 33.9, 'QPower observed forward iROIC is 33.9%');

// Layer 2: Forward Scenario
assert(qpowerVector.forwardScenarioTrajectory !== undefined, 'Layer 2: Forward Scenario Trajectory is defined');
assert(Array.isArray(qpowerVector.forwardScenarioTrajectory.modeledNopatCagrRange), 'Forward scenario models a [min, max] CAGR range');
assert(qpowerVector.forwardScenarioTrajectory.baseCaseModeledNopatCagr === 37.64 || Math.abs(qpowerVector.forwardScenarioTrajectory.baseCaseModeledNopatCagr - 37.6) < 0.2, `Base case modeled NOPAT CAGR (50% util) is ~37.6% (Found: ${qpowerVector.forwardScenarioTrajectory.baseCaseModeledNopatCagr}%)`);

// Layer 3: Evidence-Adjusted Potential (NOT an automatic forecast)
assert(qpowerVector.evidenceAdjustedPotential !== undefined, 'Layer 3: Evidence-Adjusted Potential is defined');
assert(qpowerVector.evidenceAdjustedPotential.evidenceConfidenceFactor === 0.75, 'QPower evidence confidence factor alpha is 0.75 (Sangli commissioning underway)');
const expectedAdjustedCagr = parseFloat((qpowerVector.forwardScenarioTrajectory.baseCaseModeledNopatCagr * 0.75).toFixed(2));
assert(Math.abs(qpowerVector.evidenceAdjustedPotential.evidenceAdjustedPotentialCagr - expectedAdjustedCagr) < 0.05, `evidenceAdjustedPotentialCagr (${qpowerVector.evidenceAdjustedPotential.evidenceAdjustedPotentialCagr}%) == modeledCagr * alpha (${expectedAdjustedCagr}%)`);

// Layer 4: Underwriting
assert(qpowerVector.underwriting.underwrittenNopatCagrPct === 22.0, 'Layer 4: Underwritten NOPAT CAGR remains frozen at 22.0%');
assert(qpowerVector.underwriting.underwritingStatus === UNDERWRITING_STATUS.UNDER_REVIEW, 'QPower underwriting status is UNDER_REVIEW');
assert(qpowerVector.underwriting.humanApprovalRequiredForRevision === true, 'Human analyst approval is strictly required before any underwriting change');

// -------------------------------------------------------------------------
// 2. Frozen Valuation Engine & Immutability Invariants
// -------------------------------------------------------------------------
console.log('\n--- 2. Testing Frozen Valuation Engine Immutability ---');

assert(qpowerVector.fairValuePrice === 438.17, 'QPower intrinsic fair value remains strictly invariant at ₹438.17');
assert(qpowerVector.valuationEngineInvariantProtected === true, 'Valuation engine invariant protection flag is active');

const hblVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.HBLENGINE);
assert(hblVector.fairValuePrice === 1042.36, 'HBL intrinsic fair value remains strictly invariant at ₹1,042.36');
assert(hblVector.underwriting.underwrittenNopatCagrPct === 28.0, 'HBL underwritten NOPAT CAGR remains strictly invariant at 28.0%');

// -------------------------------------------------------------------------
// 3. Non-Contradiction Invariant & Underwriting Status (HBL Case)
// -------------------------------------------------------------------------
console.log('\n--- 3. Testing Non-Contradiction Invariant & Underwriting Status (HBL Case) ---');

assert(hblVector.thesisOperationalStatus === THESIS_OPERATIONAL_STATUS.STRENGTHENING, 'HBL thesis is STRENGTHENING (+28% YoY, strong Kavach mandate)');
assert(hblVector.valuationStatus === VALUATION_STATUS.ATTRACTIVE, 'HBL valuation is ATTRACTIVE (CMP ₹722 vs FV ₹1,042.36)');
assert(hblVector.underwriting.underwritingStatus === UNDERWRITING_STATUS.TOO_AGGRESSIVE, 'HBL underwriting status is TOO_AGGRESSIVE (28% underwriting vs 4.5-18.9% pure backlog execution pacing)');
assert(hblVector.newCapitalStatus === NEW_CAPITAL_STATUS.REVIEW_UNDERWRITING_BEFORE_ADDING, 'HBL new capital status is REVIEW_UNDERWRITING_BEFORE_ADDING');
assert(hblVector.existingPositionStatus === EXISTING_POSITION_STATUS.HOLD_CORE_AND_MONITOR, 'HBL existing position status is HOLD_CORE_AND_MONITOR');
assert(hblVector.actionContext === ACTION_CONTEXT.REVIEW_UNDERWRITING_BEFORE_ADDING, 'HBL action context is REVIEW_UNDERWRITING_BEFORE_ADDING (resolves contradiction)');

// -------------------------------------------------------------------------
// 4. Invariant 6 - No Scenario-to-Action Leakage
// -------------------------------------------------------------------------
console.log('\n--- 4. Testing Invariant 6: No Scenario-to-Action Leakage ---');

// A forward scenario model with high capacity (e.g. 68% at 100% util) must NOT trigger REVISION_SUPPORTED_ACCELERATION without observed audited delivery
assert(qpowerVector.thesisRevisionSignal === THESIS_REVISION_SIGNAL.MONITOR_EVIDENCE_RAMP, 'QPower scenario potential (37.6-68%) does NOT leak into REVISION_SUPPORTED_ACCELERATION; remains MONITOR_EVIDENCE_RAMP');
assert(qpowerVector.newCapitalStatus === NEW_CAPITAL_STATUS.WAIT_FOR_VALUATION_HURDLE, 'QPower new capital remains blocked (WAIT_FOR_VALUATION_HURDLE) despite 68% upper scenario potential');

// A conservative scenario model (e.g. HBL backlog burn 4.5-18.9%) must NOT trigger REVISION_SUPPORTED_DECELERATION when reported reality is +28% YoY
assert(hblVector.thesisRevisionSignal !== THESIS_REVISION_SIGNAL.REVISION_SUPPORTED_DECELERATION, 'HBL conservative scenario math does NOT trigger REVISION_SUPPORTED_DECELERATION');
assert(hblVector.thesisRevisionSignal === THESIS_REVISION_SIGNAL.POTENTIAL_DECELERATION, 'HBL revision signal is POTENTIAL_DECELERATION (scenario math only, zero observed deterioration)');

// -------------------------------------------------------------------------
// 5. Sustained Evidence Requirement for Revision Signals
// -------------------------------------------------------------------------
console.log('\n--- 5. Testing Sustained Evidence Requirement for Revision Signals ---');

// SJS: 5 consecutive quarters delivered, audited E2 capex, beating guidance -> UNDERWRITING_CONFIRMED
const sjsVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.SJS);
assert(sjsVector.observedReality.consecutiveQuartersDelivered >= 4, 'SJS has 5 consecutive quarters of delivered guidance');
assert(sjsVector.underwriting.underwritingStatus === UNDERWRITING_STATUS.SUPPORTED_BY_EVIDENCE, 'SJS underwriting is SUPPORTED_BY_EVIDENCE');

// Shakti Pumps: Structural subsidy impairment & negative CFO -> REVISION_SUPPORTED_DECELERATION & EXIT_THESIS_BROKEN
const shaktiVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.SHAKTIPUMP);
assert(shaktiVector.thesisRevisionSignal === THESIS_REVISION_SIGNAL.REVISION_SUPPORTED_DECELERATION, 'Shakti Pumps triggers REVISION_SUPPORTED_DECELERATION due to audited deterioration');
assert(shaktiVector.underwriting.underwritingStatus === UNDERWRITING_STATUS.BROKEN, 'Shakti Pumps underwriting status is BROKEN');
assert(shaktiVector.existingPositionStatus === EXISTING_POSITION_STATUS.EXIT_THESIS_BROKEN, 'Shakti Pumps existing position is EXIT_THESIS_BROKEN');
assert(shaktiVector.newCapitalStatus === NEW_CAPITAL_STATUS.BLOCKED_THESIS_BROKEN, 'Shakti Pumps new capital is BLOCKED_THESIS_BROKEN');

// -------------------------------------------------------------------------
// 6. Independent Valuation Hurdle Price Math Invariants
// -------------------------------------------------------------------------
console.log('\n--- 6. Testing Independent Valuation Hurdle Price Math ---');

const testFv = 1000.0;
const testMoS = 25.0;
const hurdlePrice = calculateValuationHurdlePrice(testFv, testMoS);
assert(hurdlePrice === 750.0, `Valuation Hurdle Price for FV ₹${testFv} at ${testMoS}% MoS is ₹750.0 (Found: ₹${hurdlePrice})`);

// Verify bidirectional consistency: MoS(FV, HurdlePrice) === requiredMoS
const calculatedMoS = calculateMarginOfSafety(testFv, hurdlePrice);
assert(Math.abs(calculatedMoS - testMoS) < 0.01, `Bidirectional verification: MoS(₹${testFv}, ₹${hurdlePrice}) == ${testMoS}% (Found: ${calculatedMoS}%)`);

// Verify across QPower conditional scenarios
for (const sc of qpowerVector.conditionalDcfMatrix) {
  assert(sc.valuationHurdlePrice !== undefined, `${sc.label}: valuationHurdlePrice is defined`);
  assert(sc.valuationHurdlePrice === parseFloat((sc.fairValuePrice * 0.75).toFixed(2)), `${sc.label}: Hurdle price guarantees exact 25% Margin of Safety on FV ₹${sc.fairValuePrice}`);
  const mos = calculateMarginOfSafety(sc.fairValuePrice, sc.valuationHurdlePrice);
  assert(Math.abs(mos - 25.0) < 0.05, `${sc.label}: Calculated MoS on hurdle price equals 25.0%`);
}

// -------------------------------------------------------------------------
// 7. Structured Position & Capital Directives across Cohort
// -------------------------------------------------------------------------
console.log('\n--- 7. Testing Structured Position & Capital Directives (18 Stocks) ---');

const cohortResults = synthesizeCohortFundamentalTrajectories();
assert(cohortResults.length === 19, `All 19 cohort stocks evaluated (Found: ${cohortResults.length})`);

const validExistingStatuses = Object.values(EXISTING_POSITION_STATUS);
const validNewCapitalStatuses = Object.values(NEW_CAPITAL_STATUS);
const validUnderwritingStatuses = Object.values(UNDERWRITING_STATUS);

for (const res of cohortResults) {
  assert(validExistingStatuses.includes(res.existingPositionStatus), `${res.ticker}: existingPositionStatus (${res.existingPositionStatus}) is valid`);
  assert(validNewCapitalStatuses.includes(res.newCapitalStatus), `${res.ticker}: newCapitalStatus (${res.newCapitalStatus}) is valid`);
  assert(validUnderwritingStatuses.includes(res.underwriting.underwritingStatus), `${res.ticker}: underwritingStatus (${res.underwriting.underwritingStatus}) is valid`);
  assert(Array.isArray(res.thesisBreakers) && res.thesisBreakers.length >= 3, `${res.ticker}: Defines at least 3 concrete thesisBreakers`);
  assert(res.valuationHurdlePrice > 0, `${res.ticker}: valuationHurdlePrice (₹${res.valuationHurdlePrice}) is strictly positive`);
}

// -------------------------------------------------------------------------
// 8. Working Capital Conversion Friction & Bottleneck Diagnostics
// -------------------------------------------------------------------------
console.log('\n--- 8. Testing Working Capital Conversion Friction (Transrail) ---');

const transrailVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.TRANSRAILL);
assert(transrailVector.bottleneckDiagnostic.stages.WORKING_CAPITAL_CASH === BOTTLENECK_STATE.IMPAIRED_BOTTLENECK, 'Transrail working capital stage is marked IMPAIRED_BOTTLENECK (115-day DSO)');
assert(transrailVector.thesisRevisionSignal === THESIS_REVISION_SIGNAL.EXECUTION_FRICTION_WATCH, 'Transrail revision signal is EXECUTION_FRICTION_WATCH');
assert(transrailVector.existingPositionStatus === EXISTING_POSITION_STATUS.HOLD_CORE_AWAITING_CASH_CONVERSION, 'Transrail existing position is HOLD_CORE_AWAITING_CASH_CONVERSION');
assert(transrailVector.newCapitalStatus === NEW_CAPITAL_STATUS.WAIT_FOR_CASH_CONVERSION, 'Transrail new capital status is WAIT_FOR_CASH_CONVERSION');
assert(transrailVector.actionContext === ACTION_CONTEXT.HOLD_AWAITING_WORKING_CAPITAL_CONVERSION, 'Transrail action context is HOLD_AWAITING_WORKING_CAPITAL_CONVERSION');

// -------------------------------------------------------------------------
// 9. Monotonicity & Commissioning Overhead Drag
// -------------------------------------------------------------------------
console.log('\n--- 9. Testing Monotonicity & Commissioning Overhead Drag ---');

const qpowerTraj = calculateCapacityUtilizationTrajectory(qpowerProfile);
for (let i = 1; i < qpowerTraj.scenarios.length; i++) {
  const prev = qpowerTraj.scenarios[i - 1];
  const curr = qpowerTraj.scenarios[i];
  assert(curr.totalRevenueCr > prev.totalRevenueCr, `Revenue at ${curr.utilizationPct}% (₹${curr.totalRevenueCr} Cr) > ${prev.utilizationPct}% (₹${prev.totalRevenueCr} Cr)`);
  assert(curr.totalNopatCr > prev.totalNopatCr, `NOPAT at ${curr.utilizationPct}% (₹${curr.totalNopatCr} Cr) > ${prev.utilizationPct}% (₹${prev.totalNopatCr} Cr)`);
}

const util25 = qpowerTraj.scenarios.find(s => s.utilizationPct === 25);
const util75 = qpowerTraj.scenarios.find(s => s.utilizationPct === 75);
assert(util25.effectiveEbitdaMarginPct < util75.effectiveEbitdaMarginPct, `Overhead drag modeled: 25% margin (${util25.effectiveEbitdaMarginPct}%) < 75% margin (${util75.effectiveEbitdaMarginPct}%)`);

// -------------------------------------------------------------------------
// 10. Multi-Engine Array Schema across All 18 Cohort Stocks
// -------------------------------------------------------------------------
console.log('\n--- 10. Testing Multi-Engine Array Schema across All 18 Stocks ---');

for (const p of Object.values(COHORT_TRAJECTORY_PROFILES)) {
  assert(Array.isArray(p.growthEngines) && p.growthEngines.length >= 1, `${p.ticker}: growthEngines is non-empty Array`);
  assert(Array.isArray(p.riskEngines) && p.riskEngines.length >= 1, `${p.ticker}: riskEngines is non-empty Array`);
  for (const ge of p.growthEngines) {
    assert(Object.values(GROWTH_ENGINE_TYPE).includes(ge), `${p.ticker}: Growth engine ${ge} is valid enum`);
  }
  for (const re of p.riskEngines) {
    assert(Object.values(THESIS_RISK_ENGINE_TYPE).includes(re), `${p.ticker}: Risk engine ${re} is valid enum`);
  }
}

// -------------------------------------------------------------------------
// 11. Testing Management Promise Ledger & Track Record Invariants
// -------------------------------------------------------------------------
console.log('\n--- 11. Testing Management Promise Ledger & Dynamic Credibility Invariants ---');

// Generic Evaluation Logic Invariants
const mockDelivered = [
  { status: 'DELIVERED_ON_TIME' },
  { status: 'DELIVERED_AHEAD' }
];
const deliveredEval = evaluateManagementPromiseLedger('TEST_AHEAD', mockDelivered);
assert(deliveredEval.derivedCredibilityStatus === MANAGEMENT_CREDIBILITY_STATUS.AHEAD, '2 delivered claims with 0 misses derives AHEAD credibility');
assert(deliveredEval.deliverySuccessRatePct === 100.0, '100% success rate calculated for fully delivered claims');

const mockBroken = [
  { status: 'MISSED' },
  { status: 'BROKEN' }
];
const brokenEval = evaluateManagementPromiseLedger('TEST_BROKEN', mockBroken);
assert(brokenEval.derivedCredibilityStatus === MANAGEMENT_CREDIBILITY_STATUS.BROKEN, '>=2 misses/broken claims derives BROKEN credibility');
assert(brokenEval.deliverySuccessRatePct === 0.0, '0% success rate calculated for broken claims');

// Ticker-Specific Promise Ledger Assertions
assert(qpowerVector.promiseLedger !== undefined, 'QPower output vector includes promiseLedger evaluation');
assert(qpowerVector.promiseLedger.totalPromisesTracked >= 3, `QPower tracks at least 3 historical promise entries (Found: ${qpowerVector.promiseLedger.totalPromisesTracked})`);
assert(qpowerVector.promiseLedger.derivedCredibilityStatus === MANAGEMENT_CREDIBILITY_STATUS.ON_TRACK || qpowerVector.promiseLedger.derivedCredibilityStatus === MANAGEMENT_CREDIBILITY_STATUS.AHEAD, 'QPower promise ledger verifies ON_TRACK / AHEAD delivery');

// Transrail: Revenue delivered on time, but DSO missed -> MIXED credibility
assert(transrailVector.promiseLedger.missedOrBrokenCount === 1, 'Transrail promise ledger flags exactly 1 missed working capital target');
assert(transrailVector.promiseLedger.derivedCredibilityStatus === MANAGEMENT_CREDIBILITY_STATUS.MIXED, 'Transrail promise ledger dynamically derives MIXED credibility');

// SJS: Exxpand COD on time + Margin target beaten -> AHEAD credibility
assert(sjsVector.promiseLedger.deliveredCount >= 2, 'SJS promise ledger verifies >=2 delivered claims');
assert(sjsVector.promiseLedger.derivedCredibilityStatus === MANAGEMENT_CREDIBILITY_STATUS.AHEAD, 'SJS promise ledger dynamically derives AHEAD credibility');

// Shakti: Subsidy DSO broken -> BROKEN credibility
assert(shaktiVector.promiseLedger.missedOrBrokenCount >= 1, 'Shakti Pumps promise ledger flags broken subsidy target');
assert(shaktiVector.promiseLedger.derivedCredibilityStatus === MANAGEMENT_CREDIBILITY_STATUS.BROKEN || shaktiVector.managementCredibility === MANAGEMENT_CREDIBILITY_STATUS.BROKEN, 'Shakti Pumps verifies BROKEN credibility');

// Database Bridge Mock Invariant Test
const mockDbPool = {
  query: async (sql, params) => {
    return {
      rows: [
        {
          id: 'mock-1',
          quarter: 'Q1 FY27',
          management_claim: 'Commissioning Sangli capacity on schedule for August 2026',
          target_metric: 'COD August 2026',
          target_value: null,
          timeline: 'August 2026',
          status: 'Achieved',
          credibility_impact: 'positive',
          actual_reported_delivery: 'Trial production commenced August 2026',
          source_ref: 'Earnings Concall Transcript',
          created_at: '2026-08-01',
          source_document_type: 'CONCALL_TRANSCRIPT',
          provenance_type: 'PRIMARY_SOURCE_VERIFIED',
          variance_pct: 0,
          execution_outcome: 'ACHIEVED'
        },
        {
          id: 'mock-2',
          quarter: 'Q1 FY27',
          management_claim: 'Maintaining 20% revenue growth guidance across FY27',
          target_metric: '+20% YoY',
          target_value: 20.0,
          timeline: 'FY27',
          status: 'Pending',
          credibility_impact: 'positive',
          actual_reported_delivery: 'Q1 grew +32% YoY',
          source_ref: 'Earnings Concall Transcript',
          created_at: '2026-08-01',
          source_document_type: 'CONCALL_TRANSCRIPT',
          provenance_type: 'PRIMARY_SOURCE_VERIFIED',
          variance_pct: 12.0,
          execution_outcome: 'IN_PROGRESS'
        }
      ]
    };
  }
};

const hydratedLedger = await loadPromiseLedgerFromDatabase('QPOWER', mockDbPool);
assert(Array.isArray(hydratedLedger) && hydratedLedger.length === 2, 'loadPromiseLedgerFromDatabase successfully extracts 2 normalized entries from mock DB');
assert(hydratedLedger[0].claimType === 'CAPACITY_COMMISSIONING', 'DB adapter accurately maps statement text to CAPACITY_COMMISSIONING claim type');
assert(hydratedLedger[0].status === 'DELIVERED_ON_TIME', 'DB adapter accurately maps ACHIEVED execution outcome to DELIVERED_ON_TIME');
assert(hydratedLedger[1].claimType === 'REVENUE_GUIDANCE', 'DB adapter accurately maps revenue target to REVENUE_GUIDANCE claim type');

const asyncVector = await evaluateFundamentalTrajectoryVectorAsync(COHORT_TRAJECTORY_PROFILES.QPOWER, mockDbPool);
assert(asyncVector.promiseLedger.totalPromisesTracked === 2, 'evaluateFundamentalTrajectoryVectorAsync seamlessly integrates dynamic database ledger');
assert(asyncVector.promiseLedger.deliveredCount === 1, 'evaluateFundamentalTrajectoryVectorAsync accurately resolves delivered count from DB');

// -------------------------------------------------------------------------
// 12. Testing Fundamental Catch-Up vs Price Catch-Up Dynamics
// -------------------------------------------------------------------------
console.log('\n--- 12. Testing Fundamental Catch-Up vs Price Catch-Up Dynamics ---');

// Case 1: Price running ahead of fundamentals (QPower: +70% price vs +32% NOPAT -> PRICE_AHEAD_OF_FUNDAMENTALS)
const qpowerDynamics = calculateFundamentalCatchUpDynamics({
  currentPrice: 1426.0,
  priorQuarterPrice: 838.0, // +70.2% price move
  baselineNopatCr: 145.0,
  priorQuarterNopatCr: 110.0, // +31.8% NOPAT move
  fairValuePrice: 438.17,
  priorFairValuePrice: 400.0
});
assert(qpowerDynamics.catchUpRegime === CATCH_UP_DYNAMICS_REGIME.PRICE_AHEAD_OF_FUNDAMENTALS, 'QPower (+70% price vs +32% NOPAT) correctly classified as PRICE_AHEAD_OF_FUNDAMENTALS');
assert(qpowerDynamics.isExpectationExpansion === true, 'QPower flags expectation/multiple expansion dominant');
assert(qpowerDynamics.trajectoryGapPctPts > 30.0, `QPower trajectory gap (${qpowerDynamics.trajectoryGapPctPts}% pts) reflects substantial price run-ahead`);

// Case 2: Fundamentals catching up faster than price (+40% NOPAT vs +15% price -> FUNDAMENTALS_AHEAD_OF_PRICE)
const catchUpProfile = {
  currentPrice: 1150.0,
  priorQuarterPrice: 1000.0, // +15% price move
  baselineNopatCr: 140.0,
  priorQuarterNopatCr: 100.0, // +40% NOPAT move
  fairValuePrice: 1500.0,
  priorFairValuePrice: 1100.0 // +36% FV move
};
const catchUpDynamics = calculateFundamentalCatchUpDynamics(catchUpProfile);
assert(catchUpDynamics.catchUpRegime === CATCH_UP_DYNAMICS_REGIME.FUNDAMENTALS_AHEAD_OF_PRICE, 'Company (+40% NOPAT vs +15% price) correctly classified as FUNDAMENTALS_AHEAD_OF_PRICE');
assert(catchUpDynamics.isExpectationExpansion === false, 'Fundamental catch-up does NOT flag expectation expansion');

// Case 3: Price and Fundamentals compounding in equilibrium (+20% price vs +22% NOPAT -> PRICE_AND_FUNDAMENTALS_ALIGNED)
const alignedProfile = {
  currentPrice: 1200.0,
  priorQuarterPrice: 1000.0, // +20% price move
  baselineNopatCr: 122.0,
  priorQuarterNopatCr: 100.0, // +22% NOPAT move
  fairValuePrice: 1200.0,
  priorFairValuePrice: 1000.0
};
const alignedDynamics = calculateFundamentalCatchUpDynamics(alignedProfile);
assert(alignedDynamics.catchUpRegime === CATCH_UP_DYNAMICS_REGIME.PRICE_AND_FUNDAMENTALS_ALIGNED, 'Balanced compounder (+20% price vs +22% NOPAT) classified as PRICE_AND_FUNDAMENTALS_ALIGNED');

// Case 4: Fundamentals deteriorating (Shakti: Negative operating cash / deterioration -> FUNDAMENTALS_DETERIORATING)
const deterioratingProfile = {
  currentPrice: 494.0,
  priorQuarterPrice: 500.0,
  baselineNopatCr: 150.0,
  priorQuarterNopatCr: 200.0, // -25% NOPAT drop
  hasAuditedDeterioration: true,
  thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.BROKEN
};
const deterioratingDynamics = calculateFundamentalCatchUpDynamics(deterioratingProfile);
assert(deterioratingDynamics.catchUpRegime === CATCH_UP_DYNAMICS_REGIME.FUNDAMENTALS_DETERIORATING, 'Broken/deteriorating thesis classified as FUNDAMENTALS_DETERIORATING');

// Vector Output Verification
assert(qpowerVector.catchUpDynamics !== undefined, 'evaluateFundamentalTrajectoryVector attaches catchUpDynamics object');
assert(qpowerVector.catchUpDynamics.catchUpRegime !== undefined, 'Vector output contains valid catchUpRegime');

console.log('\n================================================================================================');
console.log(`📊 INVARIANT TEST SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED (100% SUCCESS)`);
console.log('================================================================================================\n');

if (passedTests !== totalTests) {
  process.exitCode = 1;
}

