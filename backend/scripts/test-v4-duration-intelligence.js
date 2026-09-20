/**
 * ThesisIQ v4.0: Duration Intelligence & Adversarial Anti-Bubble Test Suite
 * 
 * Strict Invariant Tests:
 * 1. Layer 3 Deterministic v4 Classification Tests (Situations A, B, C, D)
 * 2. Duration Quality Economic Invariants (D1 to D5 strictly economic, independent of stock price)
 * 3. Execution Eligibility Decoupling (Research classification != portfolio weight)
 * 4. Adversarial Anti-Bubble Tests:
 *    - Bubble Test: Extreme story + weak evidence ceiling => Strictly Situation D (Expectation Risk)
 *    - Optionality Test: Future opportunity with zero commercial proof => Strictly Situation C at most (Never B)
 *    - Capacity Illusion Test: High physical capacity + low demand => D3/D4 (Never D2)
 *    - True Compounder Test: Expensive 5Y DCF + D1 + high iROIC + cash conversion => Situation B (Titan/Dixon phase)
 * 5. Zero Hardcoded Ticker Invariant: Pure generic mathematical and rule evaluation.
 */

import assert from 'assert';
import {
  DURATION_QUALITY,
  DURATION_PHASE,
  MANAGEMENT_EXECUTION_CREDIBILITY,
  NEXT_ENGINE_EVIDENCE_TIER,
  INVESTMENT_OPPORTUNITY_SITUATION,
  EXECUTION_ELIGIBILITY,
  CAPITAL_ABSORPTION_QUALITY,
  UNDERWRITING_SUPPORT_STATUS,
  CAPITAL_DEPLOYMENT_STATE,
  buildDurationVector,
  evaluateDurationQuality,
  evaluateCapitalAbsorptionQuality,
  classifyInvestmentOpportunitySituation,
  evaluateExecutionEligibility,
  generateCausalDurationDossier,
  evaluateEconomicHealth,
  calculateCorrectionTriggers,
  evaluatePriceCorrectionScenario,
  reconcileMarketVsThesis
} from '../services/market-thesis-reconciliation.service.js';

import {
  COHORT_TRAJECTORY_PROFILES,
  evaluateFundamentalTrajectoryVector
} from '../services/fundamental-trajectory-engine.service.js';

function logPass(testNum, msg) {
  console.log(`  ✓ [PASS] Test ${testNum}: ${msg}`);
}

console.log('================================================================================================');
console.log('🧪 RUNNING INVARIANT TEST SUITE: THESISIQ v4.0 DURATION & OPPORTUNITY INTELLIGENCE');
console.log('================================================================================================\n');

// -----------------------------------------------------------------------------
// Suite 1: Generic Profiles & Deterministic Classification
// -----------------------------------------------------------------------------
console.log('--- Suite 1: Generic Economic Profiles & Deterministic Classification ---');

// Profile A: Discounted DCF + D1/D2 Duration + Supported Underwriting => Situation A
const profileA = {
  ticker: 'GENERIC_VALUE_DISLOCATION',
  companyName: 'Generic Value Co',
  sector: 'Capital Goods',
  currentPrice: 400.0,
  currentPE: 15.0,
  fairValuePrice: 650.0,
  underwrittenNopatCagrPct: 20.0,
  forwardIroic: 25.0,
  capacityMultiple: 2.0,
  orderBookTotalCr: 3000.0,
  baselineRevenueCr: 1500.0,
  consecutiveQuartersDelivered: 4,
  managementDeliveryHistory: 'STRONG_TRACK_RECORD',
  evidenceTier: 'E1_EXCHANGE_FILED_CONTRACT',
  cashFlowEvidence: { receivableDays: 110, cfoPatRatio: 0.55 },
  forwardScenarioTrajectory: { modeledNopatCagrRange: [12.0, 32.0] }
};

const v4A = reconcileMarketVsThesis(profileA);
assert.strictEqual(v4A.durationQuality, DURATION_QUALITY.D2_EVIDENCE_SUPPORTED, 'Profile A with temporary WC friction should be D2');
assert.strictEqual(v4A.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_A_VALUE_OPPORTUNITY, 'Profile A must be Situation A (Value Opportunity)');
assert.strictEqual(v4A.executionEligibility, EXECUTION_ELIGIBILITY.IMMEDIATE_ALLOCATION, 'Profile A must have IMMEDIATE_ALLOCATION eligibility');
logPass(1, 'Profile A (Discounted DCF + D2) correctly classified as Situation A (VALUE_OPPORTUNITY)');

// Profile B: Expensive 5Y DCF + D1 Proven + Plausible Long Runway => Situation B (Titan/Dixon)
const profileB = {
  ticker: 'GENERIC_TITAN_COMPOUNDER',
  companyName: 'Generic Titan Co',
  sector: 'Power Equipment',
  currentPrice: 1500.0,
  currentPE: 45.0,
  fairValuePrice: 850.0,
  underwrittenNopatCagrPct: 25.0,
  forwardIroic: 32.0,
  capacityMultiple: 3.5,
  orderBookTotalCr: 5000.0,
  baselineRevenueCr: 2000.0,
  consecutiveQuartersDelivered: 5,
  managementDeliveryHistory: 'STRONG_TRACK_RECORD',
  evidenceTier: 'E1_EXCHANGE_FILED_CONTRACT',
  cashFlowEvidence: { receivableDays: 65, cfoPatRatio: 0.90 },
  forwardScenarioTrajectory: { modeledNopatCagrRange: [20.0, 48.0] }
};

const v4B = reconcileMarketVsThesis(profileB);
assert.strictEqual(v4B.durationQuality, DURATION_QUALITY.D1_PROVEN, 'Profile B with strong multi-year audited delivery must be D1_PROVEN');
assert.strictEqual(v4B.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY, 'Profile B must be Situation B (Compounder Opportunity)');
assert.strictEqual(v4B.executionEligibility, EXECUTION_ELIGIBILITY.CORE_COMPOUNDER_ALLOCATION, 'Profile B must have CORE_COMPOUNDER_ALLOCATION eligibility');
logPass(2, 'Profile B (Expensive 5Y DCF + D1 + Cash Intact) correctly classified as Situation B (COMPOUNDER_OPPORTUNITY)');

// Profile C: Expensive 5Y DCF + D2 Duration + Commercial Proof Pending => Situation C (QPower prototype)
const profileC = {
  ticker: 'GENERIC_MILESTONE_VALIDATION',
  companyName: 'Generic Greenfield Co',
  sector: 'Power & Grid Equipment',
  currentPrice: 1400.0,
  currentPE: 50.0,
  fairValuePrice: 450.0,
  underwrittenNopatCagrPct: 22.0,
  forwardIroic: 34.0,
  capacityMultiple: 8.0,
  orderBookTotalCr: 2000.0,
  baselineRevenueCr: 800.0,
  consecutiveQuartersDelivered: 2,
  managementDeliveryHistory: 'STRONG_TRACK_RECORD',
  evidenceTier: 'E2_AUDITED_CAPEX_COMMISSIONING',
  cashFlowEvidence: { receivableDays: 75, cfoPatRatio: 0.85 },
  forwardScenarioTrajectory: { modeledNopatCagrRange: [14.0, 68.0] }
};

const v4C = reconcileMarketVsThesis(profileC);
assert.strictEqual(v4C.durationQuality, DURATION_QUALITY.D2_EVIDENCE_SUPPORTED, 'Profile C with 8x plant in commissioning must be D2_EVIDENCE_SUPPORTED');
assert.strictEqual(v4C.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY, 'Profile C must be Situation C (Milestone Opportunity)');
assert.strictEqual(v4C.executionEligibility, EXECUTION_ELIGIBILITY.MILESTONE_DEPENDENT, 'Profile C must be MILESTONE_DEPENDENT');
logPass(3, 'Profile C (Expensive DCF + 8x capacity + Pending Proof) correctly classified as Situation C (MILESTONE_OPPORTUNITY)');

// Profile D: Expensive 5Y DCF + Requirement Exceeds Evidence Ceiling => Situation D (Expectation Risk)
const profileD = {
  ticker: 'GENERIC_EXPECTATION_RISK',
  companyName: 'Generic Hype Co',
  sector: 'Auto Ancillary',
  currentPrice: 2400.0,
  currentPE: 40.0,
  fairValuePrice: 1400.0,
  underwrittenNopatCagrPct: 20.0,
  forwardIroic: 22.0,
  capacityMultiple: 1.5,
  orderBookTotalCr: 600.0,
  baselineRevenueCr: 600.0,
  consecutiveQuartersDelivered: 2,
  evidenceTier: 'E3_CONCALL_QUANTIFIED_GUIDANCE',
  cashFlowEvidence: { receivableDays: 70, cfoPatRatio: 0.85 },
  forwardScenarioTrajectory: { modeledNopatCagrRange: [9.6, 19.6] }
};

const v4D = reconcileMarketVsThesis(profileD);
assert.strictEqual(v4D.durationQuality, DURATION_QUALITY.D4_SPECULATIVE, 'Profile D with limited capacity & mature TAM must be D4_SPECULATIVE');
assert.strictEqual(v4D.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK, 'Profile D must be Situation D (Expectation Risk)');
assert.strictEqual(v4D.executionEligibility, EXECUTION_ELIGIBILITY.WAIT_REVALIDATE, 'Profile D must be WAIT_REVALIDATE');
logPass(4, 'Profile D (Market requirement exceeds evidence ceiling) correctly classified as Situation D (EXPECTATION_RISK)');

// Profile E: Structural Cash Bleed & Broken Thesis => Situation D (Broken)
const profileE = {
  ticker: 'GENERIC_BROKEN_VALUE_TRAP',
  companyName: 'Generic Broken Co',
  sector: 'Pumps & Motors',
  currentPrice: 500.0,
  currentPE: 25.0,
  fairValuePrice: 240.0,
  underwrittenNopatCagrPct: 10.0,
  forwardIroic: 10.0,
  capacityMultiple: 1.2,
  thesisOperationalStatus: 'BROKEN',
  hasAuditedDeterioration: true,
  cashFlowEvidence: { receivableDays: 145, cfoPatRatio: 0.15 },
  forwardScenarioTrajectory: { modeledNopatCagrRange: [-10.0, 15.0] }
};

const v4E = reconcileMarketVsThesis(profileE);
assert.strictEqual(v4E.durationQuality, DURATION_QUALITY.D5_BROKEN, 'Profile E with broken thesis & cash bleed must be D5_BROKEN');
assert.strictEqual(v4E.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK, 'Profile E must be Situation D (Expectation Risk)');
assert.strictEqual(v4E.executionEligibility, EXECUTION_ELIGIBILITY.AVOID_TRIM, 'Profile E must be AVOID_TRIM');
logPass(5, 'Profile E (Broken Thesis + Cash Bleed) correctly classified as D5_BROKEN and AVOID_TRIM');

// -----------------------------------------------------------------------------
// Suite 2: Adversarial Anti-Bubble Tests
// -----------------------------------------------------------------------------
console.log('\n--- Suite 2: Adversarial Anti-Bubble Invariants ---');

// Adversarial Test 1: The Bubble Story Trap
// Enormous management TAM story, extreme stock price, but forward evidence ceiling is low (15%) vs market required 38%
const bubbleTrapProfile = {
  ticker: 'ADVERSARIAL_BUBBLE_STORY',
  companyName: 'Bubble Story Co',
  sector: 'Green Hydrogen Hype',
  currentPrice: 3500.0,
  currentPE: 95.0,
  fairValuePrice: 600.0,
  underwrittenNopatCagrPct: 15.0,
  forwardIroic: 18.0,
  capacityMultiple: 1.5,
  orderBookTotalCr: 200.0,
  baselineRevenueCr: 500.0,
  evidenceTier: 'E4_CONCALL_DIRECTIONAL',
  consecutiveQuartersDelivered: 0,
  cashFlowEvidence: { receivableDays: 85, cfoPatRatio: 0.70 },
  forwardScenarioTrajectory: { modeledNopatCagrRange: [5.0, 15.0] }
};

const bubbleRes = reconcileMarketVsThesis(bubbleTrapProfile);
assert.strictEqual(bubbleRes.durationQuality, DURATION_QUALITY.D4_SPECULATIVE, 'Bubble story with no capacity backing must be D4');
assert.strictEqual(bubbleRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK, 'Bubble story MUST be Situation D (Expectation Risk)');
assert.notStrictEqual(bubbleRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY, 'Bubble story must NEVER be Situation B');
assert.notStrictEqual(bubbleRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY, 'Bubble story must NEVER be Situation C');
logPass(6, '[ANTI_BUBBLE] Enormous narrative story with low evidence ceiling strictly prevented from B/C classification');

// Adversarial Test 2: The Unaudited Optionality Trap
// Huge future optionality announced, but zero commercial proof delivered yet
const optionalityTrapProfile = {
  ticker: 'ADVERSARIAL_OPTIONALITY_TRAP',
  companyName: 'Future Optionality Co',
  sector: 'Battery Chemicals',
  currentPrice: 1200.0,
  currentPE: 40.0,
  fairValuePrice: 600.0,
  underwrittenNopatCagrPct: 18.0,
  forwardIroic: 24.0,
  capacityMultiple: 4.0,
  orderBookTotalCr: 300.0,
  baselineRevenueCr: 400.0,
  evidenceTier: 'E3_CONCALL_QUANTIFIED_GUIDANCE', // Concall only, no formal trial filing
  consecutiveQuartersDelivered: 0,
  growthEngines: ['CAPACITY_UTILIZATION'],
  cashFlowEvidence: { receivableDays: 75, cfoPatRatio: 0.80 },
  forwardScenarioTrajectory: { modeledNopatCagrRange: [12.0, 35.0] }
};

const optionalityRes = reconcileMarketVsThesis(optionalityTrapProfile);
assert.strictEqual(optionalityRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY, 'Unaudited optionality with pending proof is Situation C at most');
assert.notStrictEqual(optionalityRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY, 'Unaudited optionality must NEVER reach Situation B without commercial proof');
logPass(7, '[ANTI_OPTIONALITY_LEAKAGE] Unaudited optionality strictly gated to Situation C at most (Never B)');

// Adversarial Test 3: The Capacity Illusion Trap
// Company claims 10x capacity expansion, but has weak demand (book to bill 0.2x) and low utilization
const capacityIllusionProfile = {
  ticker: 'ADVERSARIAL_CAPACITY_ILLUSION',
  companyName: 'Ghost Factory Co',
  sector: 'Textiles & Commodity',
  currentPrice: 800.0,
  currentPE: 30.0,
  fairValuePrice: 350.0,
  underwrittenNopatCagrPct: 12.0,
  forwardIroic: 14.0, // Low iROIC despite big capex
  capacityMultiple: 10.0,
  orderBookTotalCr: 50.0,
  baselineRevenueCr: 500.0,
  evidenceTier: 'E4_CONCALL_DIRECTIONAL',
  consecutiveQuartersDelivered: 0,
  cashFlowEvidence: { receivableDays: 80, cfoPatRatio: 0.75 },
  forwardScenarioTrajectory: { modeledNopatCagrRange: [-5.0, 14.0] }
};

const capacityIllusionRes = reconcileMarketVsThesis(capacityIllusionProfile);
assert(
  capacityIllusionRes.durationQuality === DURATION_QUALITY.D3_IDENTIFIED || capacityIllusionRes.durationQuality === DURATION_QUALITY.D4_SPECULATIVE,
  'Capacity expansion with low iROIC (<20%) and weak demand must NOT reach D2'
);
assert.strictEqual(capacityIllusionRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK, 'Capacity illusion with low evidence ceiling must be Situation D');
logPass(8, '[ANTI_CAPACITY_ILLUSION] 10x capacity expansion with low iROIC strictly rejected from D2 and Situation B/C');

// Adversarial Test 4: Hype Story with Unproven Management & Speculative Next Engine
// Stock is expensive (35% required growth vs 15% core ceiling). Claims "next-leg transition" but has 0 delivered promises and unproven credibility.
const hypeUnprovenNextLegProfile = {
  ticker: 'ADVERSARIAL_HYPE_UNPROVEN_NEXT_LEG',
  companyName: 'Hype Unproven Next Leg Co',
  sector: 'Auto Ancillary',
  currentPrice: 2500.0,
  currentPE: 45.0,
  fairValuePrice: 1200.0,
  underwrittenNopatCagrPct: 15.0,
  forwardIroic: 16.0,
  capacityMultiple: 1.5,
  orderBookTotalCr: 400.0,
  baselineRevenueCr: 600.0,
  consecutiveQuartersDelivered: 0,
  managementDeliveryHistory: 'UNPROVEN',
  evidenceTier: 'E4_CONCALL_DIRECTIONAL',
  cashFlowEvidence: { receivableDays: 85, cfoPatRatio: 0.65 },
  forwardScenarioTrajectory: { modeledNopatCagrRange: [8.0, 16.0] },
  growthEngines: ['ACQUISITION_INTEGRATION'] // Claims M&A, but unproven track record & low iROIC
};

const hypeNextLegRes = reconcileMarketVsThesis(hypeUnprovenNextLegProfile);
assert.strictEqual(hypeNextLegRes.durationQuality, DURATION_QUALITY.D4_SPECULATIVE, 'Unproven next engine with weak track record must be D4_SPECULATIVE');
assert.strictEqual(hypeNextLegRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK, 'Unproven next engine MUST be Situation D');
assert.notStrictEqual(hypeNextLegRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY, 'Unproven next engine must NEVER reach Situation B');
logPass(9, '[ANTI_HYPE_NEXT_LEG] Claimed next-leg transition with unproven management strictly rejected from Situation B');

// -----------------------------------------------------------------------------
// Suite 3: Actual Universe Cohort Verification
// -----------------------------------------------------------------------------
console.log('\n--- Suite 3: Actual Universe Cohort & Valuation Context Verification ---');

// HBL Engine: Discounted Price + D1 Proven + Under-supported Underwriting => Situation A (WAIT_REVALIDATE)
const hblVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.HBLENGINE);
const hblRes = reconcileMarketVsThesis(COHORT_TRAJECTORY_PROFILES.HBLENGINE, hblVector);
assert.strictEqual(hblRes.durationQuality, DURATION_QUALITY.D1_PROVEN, 'HBLENGINE must be D1_PROVEN');
assert.strictEqual(hblRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_A_VALUE_OPPORTUNITY, 'HBLENGINE must be Situation A (Value Opportunity)');
assert.strictEqual(hblRes.executionEligibility, EXECUTION_ELIGIBILITY.WAIT_REVALIDATE, 'HBLENGINE with under-supported underwriting must be WAIT_REVALIDATE');
logPass(10, 'HBLENGINE correctly identified as Situation A (VALUE_OPPORTUNITY, D1, WAIT_REVALIDATE)');

// Anant Raj: Expensive 5Y DCF + D1/D2 + Within Evidence Ceiling => Situation B (Titan/Dixon Compounder)
const anantVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.ANANTRAJ);
const anantRes = reconcileMarketVsThesis(COHORT_TRAJECTORY_PROFILES.ANANTRAJ, anantVector);
assert(anantRes.durationQuality === DURATION_QUALITY.D1_PROVEN || anantRes.durationQuality === DURATION_QUALITY.D2_EVIDENCE_SUPPORTED, 'ANANTRAJ must be D1 or D2');
assert.strictEqual(anantRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY, 'ANANTRAJ must be Situation B (Compounder Opportunity)');
assert.strictEqual(anantRes.executionEligibility, EXECUTION_ELIGIBILITY.CORE_COMPOUNDER_ALLOCATION, 'ANANTRAJ must be CORE_COMPOUNDER_ALLOCATION');
logPass(11, 'ANANTRAJ correctly identified as Situation B (COMPOUNDER_OPPORTUNITY, D2, CORE_COMPOUNDER_ALLOCATION)');

// QPower: Expensive DCF + 8x Sangli Capacity => Situation C (Milestone Opportunity)
const qpowerVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.QPOWER);
const qpowerRes = reconcileMarketVsThesis(COHORT_TRAJECTORY_PROFILES.QPOWER, qpowerVector);
assert.strictEqual(qpowerRes.durationQuality, DURATION_QUALITY.D2_EVIDENCE_SUPPORTED, 'QPOWER must be D2_EVIDENCE_SUPPORTED');
assert.strictEqual(qpowerRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY, 'QPOWER must be Situation C (Milestone Opportunity)');
assert.strictEqual(qpowerRes.executionEligibility, EXECUTION_ELIGIBILITY.MILESTONE_DEPENDENT, 'QPOWER must be MILESTONE_DEPENDENT');
logPass(12, 'QPOWER correctly identified as Situation C (MILESTONE_OPPORTUNITY, D2, MILESTONE_DEPENDENT)');

// Transrail: Discounted DCF + Backlog execution => Situation A (Immediate Allocation)
const transrailVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.TRANSRAILL);
const transrailRes = reconcileMarketVsThesis(COHORT_TRAJECTORY_PROFILES.TRANSRAILL, transrailVector);
assert(transrailRes.durationQuality === DURATION_QUALITY.D2_EVIDENCE_SUPPORTED || transrailRes.durationQuality === DURATION_QUALITY.D3_IDENTIFIED, 'TRANSRAILL duration must be D2 or D3');
assert.strictEqual(transrailRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_A_VALUE_OPPORTUNITY, 'TRANSRAILL must be Situation A (Value Opportunity)');
assert.strictEqual(transrailRes.executionEligibility, EXECUTION_ELIGIBILITY.IMMEDIATE_ALLOCATION, 'TRANSRAILL must be IMMEDIATE_ALLOCATION');
logPass(13, 'TRANSRAILL correctly identified as Situation A (VALUE_OPPORTUNITY, D3, IMMEDIATE_ALLOCATION)');

// SJS: Expensive DCF + Proven Promise Delivery + Active Next Engine (Walter Pack / IMD) => Situation B (VALIDATE_NEXT_LEG)
const sjsVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.SJS);
const sjsRes = reconcileMarketVsThesis(COHORT_TRAJECTORY_PROFILES.SJS, sjsVector);
assert.strictEqual(sjsRes.durationQuality, DURATION_QUALITY.D2_EVIDENCE_SUPPORTED, 'SJS must be D2_EVIDENCE_SUPPORTED (Transitioning Compounder)');
assert.strictEqual(sjsRes.durationPhase, DURATION_PHASE.TRANSITIONING_TO_NEXT_LEG, 'SJS must be in phase TRANSITIONING_TO_NEXT_LEG');
assert.strictEqual(sjsRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY, 'SJS must be Situation B (Compounder Opportunity - Next Leg Transition)');
assert.strictEqual(sjsRes.executionEligibility, EXECUTION_ELIGIBILITY.VALIDATE_NEXT_LEG, 'SJS must have VALIDATE_NEXT_LEG eligibility');
assert.strictEqual(sjsRes.transitionCompounderChecklist.overallConclusion, 'TRANSITIONING_TO_NEXT_LEG_SUPPORTED', 'SJS 5-point checklist must confirm supported transition compounder status');
logPass(14, 'SJS correctly identified as Situation B (COMPOUNDER_OPPORTUNITY, D2, TRANSITIONING_TO_NEXT_LEG, VALIDATE_NEXT_LEG)');

// Shakti Pump: Broken Thesis + Cash Bleed => Situation D (Broken)
const shaktiVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.SHAKTIPUMP);
const shaktiRes = reconcileMarketVsThesis(COHORT_TRAJECTORY_PROFILES.SHAKTIPUMP, shaktiVector);
assert.strictEqual(shaktiRes.durationQuality, DURATION_QUALITY.D5_BROKEN, 'SHAKTIPUMP must be D5_BROKEN');
assert.strictEqual(shaktiRes.durationPhase, DURATION_PHASE.BROKEN, 'SHAKTIPUMP must be in phase BROKEN');
assert.strictEqual(shaktiRes.investmentOpportunitySituation, INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK, 'SHAKTIPUMP must be Situation D (Expectation Risk)');
assert.strictEqual(shaktiRes.executionEligibility, EXECUTION_ELIGIBILITY.AVOID_TRIM, 'SHAKTIPUMP must be AVOID_TRIM');
logPass(15, 'SHAKTIPUMP correctly identified as Situation D (EXPECTATION_RISK, D5_BROKEN, AVOID_TRIM)');

// =============================================================================
// Suite 4: Capital Deployment Action Layer & Matrix Invariants
// =============================================================================
console.log('\n--- Suite 4: Capital Deployment Action Layer & Matrix Invariants ---');

// 1. Check all 7 Capital Deployment Action States on Universe Equities
assert.strictEqual(transrailRes.capitalDeploymentState, CAPITAL_DEPLOYMENT_STATE.ADD_ACCUMULATE_REVIEW, 'TRANSRAILL must be ADD_ACCUMULATE_REVIEW');
assert.strictEqual(anantRes.capitalDeploymentState, CAPITAL_DEPLOYMENT_STATE.ADD_ON_CORRECTION, 'ANANTRAJ must be ADD_ON_CORRECTION');
assert.strictEqual(qpowerRes.capitalDeploymentState, CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_MILESTONE, 'QPOWER must be WAIT_FOR_MILESTONE');
assert.strictEqual(sjsRes.capitalDeploymentState, CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_NEXT_LEG_EVIDENCE, 'SJS must be WAIT_FOR_NEXT_LEG_EVIDENCE');
assert.strictEqual(hblRes.capitalDeploymentState, CAPITAL_DEPLOYMENT_STATE.REVALIDATE, 'HBLENGINE must be REVALIDATE');
assert.strictEqual(shaktiRes.capitalDeploymentState, CAPITAL_DEPLOYMENT_STATE.THESIS_BREAKER, 'SHAKTIPUMP must be THESIS_BREAKER');

const inoxVector = evaluateFundamentalTrajectoryVector(COHORT_TRAJECTORY_PROFILES.INOXINDIA);
const inoxRes = reconcileMarketVsThesis(COHORT_TRAJECTORY_PROFILES.INOXINDIA, inoxVector);
assert.strictEqual(inoxRes.capitalDeploymentState, CAPITAL_DEPLOYMENT_STATE.HOLD, 'INOXINDIA must be HOLD');
logPass(16, 'All 7 Capital Deployment Action States derived deterministically across core archetypes');

// 2. Dual Correction Triggers Verification
const anantTriggers = anantRes.correctionTriggers;
assert(anantTriggers.priceAtEvidenceCeiling > 0, 'Anant Raj priceAtEvidenceCeiling must be finite positive');
assert(anantTriggers.priceAt25PctMoS > 0, 'Anant Raj priceAt25PctMoS must be finite positive');
assert.strictEqual(anantTriggers.priceAt25PctMoS, parseFloat((anantRes.fairValuePrice * 0.75).toFixed(2)), '25% MoS price must strictly equal 0.75 * Base Fair Value');
assert(anantTriggers.correctionRequiredTo25PctMoSPct > 0, 'Anant Raj at premium must require positive correction to 25% MoS');
logPass(17, 'Dual Correction Triggers (priceAtEvidenceCeiling & priceAt25PctMoS) derived mathematically without hardcoded constants');

// 3. Invariant: Price Drop with Intact Economics Unlocks ADD_ACCUMULATE_REVIEW (HBL ₹722 -> ₹550 Intact)
const hblScenarioIntact = evaluatePriceCorrectionScenario(COHORT_TRAJECTORY_PROFILES.HBLENGINE, hblRes, 550.0, null);
assert.strictEqual(hblScenarioIntact.hasDeterioration, false, 'HBL scenario intact has no deterioration');
assert(hblScenarioIntact.scenarioMarketRequiredGrowth < hblScenarioIntact.baselineMarketRequiredGrowth, 'Price drop must reduce market-required growth');
assert(hblScenarioIntact.isWithinEvidenceCeilingNow === true, 'HBL at ₹550 must be within 19.86% evidence ceiling');
assert.strictEqual(hblScenarioIntact.scenarioState, CAPITAL_DEPLOYMENT_STATE.ADD_ACCUMULATE_REVIEW, 'HBL at ₹550 with intact economics must unlock ADD_ACCUMULATE_REVIEW');
logPass(18, '[MATRIX_QUADRANT_1] Price Drop + Intact Fundamentals compresses g_market into evidence ceiling and unlocks ADD_ACCUMULATE_REVIEW');

// 4. Invariant: Price Drop WITH Fundamental Deterioration STRICTLY Rejected from Accumulation (HBL ₹722 -> ₹550 Deteriorated)
const hblScenarioDeteriorated = evaluatePriceCorrectionScenario(COHORT_TRAJECTORY_PROFILES.HBLENGINE, hblRes, 550.0, {
  cashFlowEvidence: { receivableDays: 140, cfoPatRatio: 0.20 },
  hasAuditedDeterioration: true,
  thesisOperationalStatus: 'BROKEN'
});
assert.strictEqual(hblScenarioDeteriorated.hasDeterioration, true, 'HBL scenario deteriorated flags deterioration');
assert(hblScenarioDeteriorated.scenarioState === CAPITAL_DEPLOYMENT_STATE.REVALIDATE || hblScenarioDeteriorated.scenarioState === CAPITAL_DEPLOYMENT_STATE.THESIS_BREAKER, 'Deteriorated stock must never become ADD_ACCUMULATE_REVIEW');
assert.notStrictEqual(hblScenarioDeteriorated.scenarioState, CAPITAL_DEPLOYMENT_STATE.ADD_ACCUMULATE_REVIEW, 'Price drop with deterioration strictly prevented from accumulation');
logPass(19, '[MATRIX_QUADRANT_2] Price Drop + Deteriorated Fundamentals strictly triggers REVALIDATE / THESIS_BREAKER (Anti-Averaging-Down)');

// 5. Invariant: Milestone Gate CANNOT Be Bypassed by Price Alone (QPower at 50% discount)
const qpowerDiscountScenario = evaluatePriceCorrectionScenario(COHORT_TRAJECTORY_PROFILES.QPOWER, qpowerRes, 713.0, null);
assert.strictEqual(qpowerDiscountScenario.scenarioState, CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_MILESTONE, 'QPower at 50% price discount must remain WAIT_FOR_MILESTONE');
logPass(20, '[MILESTONE_GATE_INVARIANT] Price drop alone cannot bypass WAIT_FOR_MILESTONE prior to commercial verification');

// 6. Invariant: Next-Leg Gate CANNOT Be Bypassed by Price Alone (SJS at 25% discount)
const sjsDiscountScenario = evaluatePriceCorrectionScenario(COHORT_TRAJECTORY_PROFILES.SJS, sjsRes, 1765.0, null);
assert.strictEqual(sjsDiscountScenario.scenarioState, CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_NEXT_LEG_EVIDENCE, 'SJS at 25% discount without next-leg proof must remain WAIT_FOR_NEXT_LEG_EVIDENCE');
logPass(21, '[NEXT_LEG_GATE_INVARIANT] Price drop alone cannot bypass WAIT_FOR_NEXT_LEG_EVIDENCE prior to next-engine billing');

// 7. Invariant: Thesis Breaker Strictly Overrides Valuation (Shakti Pumps at 80% discount)
const shaktiDeepDiscount = evaluatePriceCorrectionScenario(COHORT_TRAJECTORY_PROFILES.SHAKTIPUMP, shaktiRes, 100.0, null);
assert.strictEqual(shaktiDeepDiscount.scenarioState, CAPITAL_DEPLOYMENT_STATE.THESIS_BREAKER, 'Shakti Pumps at deep discount must strictly remain THESIS_BREAKER');
logPass(22, '[THESIS_BREAKER_OVERRIDE] Deep valuation discount cannot override structural THESIS_BREAKER');

console.log('\n================================================================================================');
console.log('🎉 ALL 22/22 THESISIQ v4.1 DURATION, CAPITAL DEPLOYMENT & MATRIX INVARIANT TESTS PASSED CLEANLY!');
console.log('================================================================================================');
