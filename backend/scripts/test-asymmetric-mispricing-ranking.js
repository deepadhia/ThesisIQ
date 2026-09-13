/**
 * Test Suite: Asymmetric Mispricing Ranking Service & Dual-Lens Framework
 * 
 * Verifies:
 * 1. Non-binary expectation gap screening.
 * 2. Reverse-DCF sensitivity analysis & 20% growth haircut stress-testing.
 * 3. Thesis robustness classification (HIGHLY_RESILIENT, RESILIENT, SENSITIVE, VULNERABLE).
 * 4. Three-pillar ROCE regime classification (CONFIRMED_STRUCTURAL, STABLE_EXPANDING, CYCLICAL_CAPITAL_INTENSIVE).
 * 5. Structural governance gates:
 *    - WEAKENING / BROKEN / SYSTEMATIC_EXIT strictly zero score & STRUCTURAL_VALUE_TRAP.
 *    - EXTREME valuation capped at 50 & OVERVALUED_COMPOUNDER.
 *    - FULL valuation capped at 75 & COMPOUNDING_AT_FAIR_PRICE.
 *    - WATCHLIST_FRICTION pause gating on UNDER_PRESSURE.
 * 6. Deterministic ordering: Tier priority followed by Mispricing score.
 */

import { evaluateEquityMispricing, rankUniverseByMispricing, MISPRICING_OPPORTUNITY_TIER } from '../services/asymmetric-mispricing-ranking.service.js';

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

console.log('========================================================================');
console.log('🧪 RUNNING TEST SUITE: ASYMMETRIC MISPRICING RANKING SERVICE (DUAL-LENS)');
console.log('========================================================================\n');

// -------------------------------------------------------------------------
// Test 1: Reverse-DCF Sensitivity & Thesis Robustness
// -------------------------------------------------------------------------
console.log('--- 1. Testing Reverse-DCF Sensitivity & Robustness Classification ---');
const resilientStock = evaluateEquityMispricing({
  ticker: 'HBLENGINE',
  companyName: 'HBL Power Systems',
  thesisHealth: 'STRENGTHENING',
  currentConviction: 9.6,
  evidenceSufficiency: 'SUFFICIENT',
  valuationState: 'ATTRACTIVE',
  capitalAction: 'ACCUMULATE_CONVICTION',
  currentPrice: 702.55,
  currentPE: 16.1,
  expectationGap: 22.6,
  expectedGrowthTrajectory: '28% CAGR',
  impliedGrowthRate: '5.4%',
  financialEvidence: { revenueGrowthYoY: 30.5, roce: 24.5 },
  cashFlowEvidence: { cfoPatRatio: 0.90, receivableDays: 70, debtToEquity: 0.00 }
});

assert(resilientStock.metrics.stressTestedEvidenceGrowth === 22.4, 'Stress-tested growth is 28 * 0.8 = 22.4%');
assert(resilientStock.metrics.stressTestedExpectationGap === 17.0, 'Stress-tested expectation gap is 22.4 - 5.4 = 17.0%');
assert(resilientStock.metrics.thesisRobustness === 'HIGHLY_RESILIENT', 'Gap >= 10.0 after 20% haircut is HIGHLY_RESILIENT');
assert(resilientStock.metrics.roceRegimeClassification === 'CONFIRMED_STRUCTURAL', 'ROCE >= 22%, RevGrowth >= 20%, D/E <= 0.20 is CONFIRMED_STRUCTURAL');
assert(resilientStock.opportunityTier === MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION, 'Qualifies as TOP_CONVICTION_DISLOCATION');
assert(resilientStock.mispricingScore === 100.0, 'Composite score is 100.0');

// -------------------------------------------------------------------------
// Test 2: High Multiple Sensitive Compounder
// -------------------------------------------------------------------------
console.log('\n--- 2. Testing High Multiple Sensitive Compounder ---');
const highMultipleStock = evaluateEquityMispricing({
  ticker: 'LUMAXTECH',
  companyName: 'Lumax Auto Technologies',
  thesisHealth: 'STRENGTHENING',
  currentConviction: 9.7,
  evidenceSufficiency: 'SUFFICIENT',
  valuationState: 'FULL',
  capitalAction: 'CORE_HOLD',
  currentPrice: 1988.80,
  currentPE: 48.8,
  expectationGap: 3.7,
  expectedGrowthTrajectory: '20% CAGR',
  impliedGrowthRate: '16.3%',
  financialEvidence: { revenueGrowthYoY: 28.0, roce: 22.5 },
  cashFlowEvidence: { cfoPatRatio: 0.84, receivableDays: 70, debtToEquity: 0.20 }
});

assert(highMultipleStock.metrics.stressTestedEvidenceGrowth === 16.0, 'Stress-tested growth is 20 * 0.8 = 16.0%');
assert(highMultipleStock.metrics.stressTestedExpectationGap === -0.3, 'Stress-tested expectation gap is 16.0 - 16.3 = -0.3%');
assert(highMultipleStock.metrics.thesisRobustness === 'VULNERABLE', 'Stress gap < 0 is VULNERABLE under growth haircut');
assert(highMultipleStock.mispricingScore <= 75.0, 'Score capped at 75.0 due to FULL valuation state');
assert(highMultipleStock.opportunityTier === MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE, 'Classified as COMPOUNDING_AT_FAIR_PRICE');

// -------------------------------------------------------------------------
// Test 3: Structural Value Trap & Weakening Thesis Gate
// -------------------------------------------------------------------------
console.log('\n--- 3. Testing Structural Value Trap & Weakening Hard Gate ---');
const weakeningStock = evaluateEquityMispricing({
  ticker: 'SHAKTIPUMP',
  companyName: 'Shakti Pumps',
  thesisHealth: 'WEAKENING',
  currentConviction: 2.0,
  evidenceSufficiency: 'SUFFICIENT',
  valuationState: 'REASONABLE',
  capitalAction: 'SYSTEMATIC_EXIT',
  currentPrice: 503.55,
  currentPE: 55.9,
  expectationGap: -20.0,
  expectedGrowthTrajectory: '10% CAGR',
  impliedGrowthRate: '30.0%',
  financialEvidence: { revenueGrowthYoY: 12.4, roce: 20.0 },
  cashFlowEvidence: { cfoPatRatio: 0.15, receivableDays: 140, debtToEquity: 0.45 }
});

assert(weakeningStock.mispricingScore === 0.0, 'WEAKENING / SYSTEMATIC_EXIT thesis score is strictly 0.0');
assert(weakeningStock.opportunityTier === MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP, 'Classified as STRUCTURAL_VALUE_TRAP');

// -------------------------------------------------------------------------
// Test 4: Extreme Valuation Trim Candidate
// -------------------------------------------------------------------------
console.log('\n--- 4. Testing Extreme Valuation Overvalued Compounder ---');
const extremeStock = evaluateEquityMispricing({
  ticker: 'JYOTICNC',
  companyName: 'Jyoti CNC Automation',
  thesisHealth: 'STRENGTHENING',
  currentConviction: 9.5,
  evidenceSufficiency: 'SUFFICIENT',
  valuationState: 'EXTREME',
  capitalAction: 'CORE_HOLD',
  currentPrice: 988.80,
  currentPE: 65.0,
  expectationGap: 3.5,
  expectedGrowthTrajectory: '30% CAGR',
  impliedGrowthRate: '26.5%',
  financialEvidence: { revenueGrowthYoY: 24.1, roce: 22.5 },
  cashFlowEvidence: { cfoPatRatio: 0.88, receivableDays: 85, debtToEquity: 0.25 }
});

assert(extremeStock.mispricingScore <= 50.0, 'EXTREME valuation state capped at 50.0');
assert(extremeStock.opportunityTier === MISPRICING_OPPORTUNITY_TIER.OVERVALUED_COMPOUNDER, 'Classified as OVERVALUED_COMPOUNDER');

// -------------------------------------------------------------------------
// Test 5: Watchlist Friction on UNDER_PRESSURE
// -------------------------------------------------------------------------
console.log('\n--- 5. Testing Watchlist Friction on UNDER_PRESSURE ---');
const frictionStock = evaluateEquityMispricing({
  ticker: 'ELECON',
  companyName: 'Elecon Engineering',
  thesisHealth: 'UNDER_PRESSURE',
  currentConviction: 4.0,
  evidenceSufficiency: 'SUFFICIENT',
  valuationState: 'REASONABLE',
  capitalAction: 'PAUSE_ADDITIONS',
  currentPrice: 451.55,
  currentPE: 30.2,
  expectationGap: 6.0,
  expectedGrowthTrajectory: '20% CAGR',
  impliedGrowthRate: '14.0%',
  financialEvidence: { revenueGrowthYoY: 6.1, roce: 22.0 },
  cashFlowEvidence: { cfoPatRatio: 0.70, receivableDays: 85, debtToEquity: 0.00 }
});

assert(frictionStock.mispricingScore <= 35.0, 'UNDER_PRESSURE score capped at 35.0');
assert(frictionStock.opportunityTier === MISPRICING_OPPORTUNITY_TIER.WATCHLIST_FRICTION, 'Classified as WATCHLIST_FRICTION');

// -------------------------------------------------------------------------
// Test 6: Deterministic Universe Ranking & Tier Partitioning
// -------------------------------------------------------------------------
console.log('\n--- 6. Testing Deterministic Universe Ranking ---');
const ranked = rankUniverseByMispricing([weakeningStock, extremeStock, resilientStock, frictionStock, highMultipleStock]);

assert(ranked[0].ticker === 'HBLENGINE', 'Rank #1 is TOP_CONVICTION_DISLOCATION (HBLENGINE)');
assert(ranked[1].ticker === 'LUMAXTECH', 'Rank #2 is COMPOUNDING_AT_FAIR_PRICE (LUMAXTECH)');
assert(ranked[2].ticker === 'ELECON', 'Rank #3 is WATCHLIST_FRICTION (ELECON)');
assert(ranked[3].ticker === 'JYOTICNC', 'Rank #4 is OVERVALUED_COMPOUNDER (JYOTICNC)');
assert(ranked[4].ticker === 'SHAKTIPUMP', 'Rank #5 is STRUCTURAL_VALUE_TRAP (SHAKTIPUMP)');

console.log('\n========================================================================');
console.log(`🎉 ALL ${passedTests}/${totalTests} ASYMMETRIC MISPRICING INVARIANT TESTS PASSED!`);
console.log('========================================================================');
