/**
 * Winner Protection Engine (WINNER_PROTECTION_ENGINE_V2)
 * 
 * Objective:
 * Capture upside asymmetry in multi-bagger winners while systematically protecting capital
 * against expectation divergence, multiple compression, and thesis deterioration WITHOUT
 * prematurely cutting genuine compounders.
 * 
 * 3-Axis Quantitative Evaluation Framework:
 * 1. Business Quality Axis (ROCE, Net Margin, FCF conversion, Debt solvency)
 * 2. Expectation Risk Axis (Trailing P/E, Market-Implied EPS CAGR vs. Actual Delivery)
 * 3. Thesis Integrity Axis (Operating Cash Flow, Receivables Days, Regulatory compliance)
 * 
 * 9-State Winner Lifecycle Taxonomy:
 * - W1_EMERGING: Thesis Emerging (Starter Tranche 1.0%)
 * - W2_CONFIRMED: Thesis Confirmed (Add Tranche 2.0%-2.5%)
 * - W3_EXECUTION: Strong Execution (Core Position 3.5%-4.0%)
 * - W4_COMPOUNDER: Composite Quality Compounder (Hold full core at high ROCE & clean FCF)
 * - W5_PRICE_AHEAD: Price Running Ahead of Fundamentals (Governor Activated; Additions Blocked)
 * - W6_EARNINGS_CATCHUP: Earnings Catching Up (Hold Core; multiple normalized by EPS delivery)
 * - W9_EARLY_DIVERGENCE: Watch State / Noise Filter (Hold 4.0% with Governor Lock; Require confirmation before selling)
 * - W7_DIVERGENCE: Confirmed Expectation Divergence (Systematic Trim from 4.0% to 2.5%)
 * - W8_BROKEN: Structural Thesis Breakdown (Immediate Kill-Switch Exit to 0.0%)
 */

import { calculateTrueMarketImpliedExpectationsModel } from './market-expectations.service.js';

export const WINNER_STATE = Object.freeze({
  W0_PRE_CONTRACT: 'W0_PRE_CONTRACT',
  W1_EMERGING: 'W1_EMERGING',
  W2_CONFIRMED: 'W2_CONFIRMED',
  W3_EXECUTION: 'W3_EXECUTION',
  W4_COMPOUNDER: 'W4_COMPOUNDER',
  W5_PRICE_AHEAD: 'W5_PRICE_AHEAD',
  W6_EARNINGS_CATCHUP: 'W6_EARNINGS_CATCHUP',
  W9_EARLY_DIVERGENCE: 'W9_EARLY_DIVERGENCE',
  W7_DIVERGENCE: 'W7_DIVERGENCE',
  W8_BROKEN: 'W8_BROKEN'
});

export const WINNER_ACTION = Object.freeze({
  WAIT: 'WAIT (0.0% Allocation)',
  STARTER: 'STARTER (1.0%)',
  ADD: 'ADD (2.0% - 2.5%)',
  CORE: 'CORE (3.5% - 4.0%)',
  HOLD: 'HOLD (4.0%)',
  HOLD_TRIMMED: 'HOLD (2.5% Trimmed Weight)',
  WATCH_AND_HOLD: 'WATCH_AND_HOLD (4.0% with Governor Lock)',
  GOVERNOR_BLOCK: 'GOVERNOR_BLOCK (Additions Blocked)',
  TRIM: 'TRIM / RISK_MANAGEMENT (Reduce to 2.0% - 2.5%)',
  KILL_SWITCH: 'KILL_SWITCH (Immediate Exit to 0.0%)',
  AVOID: 'AVOID (0.0% Allocation)'
});

// -----------------------------------------------------------------------------
// 1. AXIS 1: BUSINESS QUALITY SCORE (0.0 to 10.0)
// -----------------------------------------------------------------------------
export function calculateBusinessQualityScore(params) {
  const { trailingRocePct, netMarginPct, operatingCashFlowCr, receivableDays } = params;
  let score = 0.0;

  // ROCE Component (Max 4.0 pts)
  if (trailingRocePct >= 25.0) score += 4.0;
  else if (trailingRocePct >= 18.0) score += 3.0;
  else if (trailingRocePct >= 12.0) score += 1.5;
  else score += 0.5;

  // Net Margin Component (Max 3.0 pts)
  if (netMarginPct >= 18.0) score += 3.0;
  else if (netMarginPct >= 10.0) score += 2.0;
  else if (netMarginPct >= 5.0) score += 1.0;
  else score += 0.2;

  // Cash Flow Conversion / Efficiency Component (Max 3.0 pts)
  if (operatingCashFlowCr > 100.0 && receivableDays <= 75) score += 3.0;
  else if (operatingCashFlowCr > 0.0 && receivableDays <= 110) score += 2.0;
  else if (operatingCashFlowCr > 0.0) score += 1.0;
  else score += 0.0;

  let classification = 'MODERATE_QUALITY';
  if (score >= 8.0) classification = 'ELITE_QUALITY';
  else if (score >= 6.0) classification = 'GOOD_QUALITY';
  else if (score < 4.0) classification = 'WEAK_QUALITY';

  return { score: parseFloat(score.toFixed(1)), classification };
}

// -----------------------------------------------------------------------------
// 2. AXIS 2: EXPECTATION RISK SCORE (0.0 to 10.0)
// -----------------------------------------------------------------------------
export function calculateExpectationRiskScore(params) {
  const { trailingPE, ttmEarningsGrowthPct, impliedEpsCagrPct } = params;
  let score = 0.0;

  // P/E Multiple Risk Component (Max 6.0 pts)
  if (trailingPE >= 60.0) score += 6.0;
  else if (trailingPE >= 45.0) score += 4.5;
  else if (trailingPE >= 35.0) score += 2.5;
  else if (trailingPE >= 25.0) score += 1.5;
  else score += 0.5;

  // Growth Delivery vs. Implied Expectations Component (Max 4.0 pts)
  const growthDeficit = (impliedEpsCagrPct || 20.0) - ttmEarningsGrowthPct;
  if (growthDeficit > 12.0 && ttmEarningsGrowthPct < 20.0) score += 4.0;
  else if (growthDeficit > 5.0) score += 2.5;
  else if (growthDeficit <= 0.0) score -= 1.0; // Surplus delivery reduces risk

  score = Math.max(0.0, Math.min(10.0, score));

  let classification = 'MODERATE_EXPECTATION_RISK';
  if (score >= 7.5) classification = 'EXTREME_EXPECTATION_RISK';
  else if (score >= 5.5) classification = 'HIGH_EXPECTATION_RISK';
  else if (score <= 3.0) classification = 'LOW_EXPECTATION_RISK';

  return { score: parseFloat(score.toFixed(1)), classification };
}

// -----------------------------------------------------------------------------
// 3. AXIS 3: THESIS INTEGRITY SCORE (0.0 to 10.0)
// -----------------------------------------------------------------------------
export function calculateThesisIntegrityScore(params) {
  const { operatingCashFlowCr, receivableDays, thesisState } = params;
  let score = 0.0;

  // Cash Flow Solvency (Max 4.0 pts)
  if (operatingCashFlowCr > 100.0) score += 4.0;
  else if (operatingCashFlowCr > 0.0) score += 2.5;
  else if (operatingCashFlowCr >= -20.0) score += 1.0;
  else score += 0.0; // Critical cash burn

  // Working Capital Integrity (Max 3.0 pts)
  if (receivableDays <= 75) score += 3.0;
  else if (receivableDays <= 110) score += 2.0;
  else if (receivableDays <= 140) score += 1.0;
  else score += 0.0; // Severe receivables lockup

  // Evidence Verification State (Max 3.0 pts)
  if (thesisState === 5) score += 3.0;
  else if (thesisState >= 3) score += 2.0;
  else score += 1.0;

  let classification = 'INTACT';
  if (score < 4.0 || operatingCashFlowCr < -50.0 || receivableDays > 160) {
    classification = 'BROKEN';
  } else if (score < 7.0) {
    classification = 'MONITORED';
  }

  return { score: parseFloat(score.toFixed(1)), classification };
}

// -----------------------------------------------------------------------------
// 4. MASTER WINNER PROTECTION STATE EVALUATOR
// -----------------------------------------------------------------------------
/**
 * Evaluates the Winner Protection State for a holding across all 3 independent risk axes.
 * 
 * @param {Object} params
 * @param {string} params.ticker - Stock symbol
 * @param {number} params.sharePrice - Current stock price
 * @param {number} params.basePrice - Reference entry price
 * @param {number} params.trailingPE - Current trailing P/E multiple
 * @param {number} params.thesisState - Current evidence state (1 to 5)
 * @param {number} params.trailingEps - Trailing 12M EPS
 * @param {number} params.trailingRevenue - Trailing 12M Revenue (Cr)
 * @param {number} params.netMarginPct - Trailing Net Profit Margin %
 * @param {number} params.trailingRocePct - Trailing Return on Capital Employed %
 * @param {number} params.operatingCashFlowCr - Trailing Operating Cash Flow (Cr)
 * @param {number} params.receivableDays - Trade receivable days
 * @param {number} params.ttmEarningsGrowthPct - TTM YoY EPS growth %
 * @param {number} params.priorWeightPct - Portfolio allocation prior to this quarter
 * @param {number} [params.divergenceConsecutiveQuarters=1] - Consecutive quarters of growth divergence
 * @returns {Object} Winner Protection Decision
 */
export function evaluateWinnerProtectionState(params) {
  const {
    ticker,
    sharePrice,
    basePrice,
    trailingPE,
    thesisState,
    trailingEps,
    trailingRevenue,
    netMarginPct,
    trailingRocePct,
    operatingCashFlowCr,
    receivableDays,
    ttmEarningsGrowthPct,
    priorWeightPct = 0.0,
    divergenceConsecutiveQuarters = 0 // Default to 0 (unconfirmed) to prevent assuming divergence without explicit history
  } = params;

  const priceGainMultiplier = basePrice > 0 ? (sharePrice / basePrice) : 1.0;
  const isMultiBagger = priceGainMultiplier >= 2.0;

  // Compute 3 Independent Risk Axes
  const quality = calculateBusinessQualityScore({ trailingRocePct, netMarginPct, operatingCashFlowCr, receivableDays });
  const thesis = calculateThesisIntegrityScore({ operatingCashFlowCr, receivableDays, thesisState });

  // Calculate Market-Implied Expectations
  const impliedExpectations = calculateTrueMarketImpliedExpectationsModel({
    sharePrice,
    baselineSharesOutstanding: 10.0,
    baselineEps: trailingEps > 0 ? trailingEps : 10.0,
    baselineRevenue: trailingRevenue > 0 ? trailingRevenue : 100.0,
    baselineNetMarginPct: netMarginPct > 0 ? netMarginPct : 15.0,
    holdingPeriodYears: 5,
    costOfCapitalDiscountRatePct: 10.0,
    assumedTerminalPe: 25.0,
    assumedTerminalNetMarginPct: netMarginPct > 0 ? netMarginPct : 15.0
  });

  const impliedEpsCagrPct = (impliedExpectations && impliedExpectations.isValid && impliedExpectations.outputs && impliedExpectations.outputs.marketImpliedEpsCagrPct != null)
    ? impliedExpectations.outputs.marketImpliedEpsCagrPct
    : 20.0;

  const expectations = calculateExpectationRiskScore({ trailingPE, ttmEarningsGrowthPct, impliedEpsCagrPct });

  // =========================================================================
  // 1. CRITICAL THESIS BREAKAGE CHECK (W8)
  // =========================================================================
  if (thesis.classification === 'BROKEN') {
    return {
      ticker,
      winnerState: WINNER_STATE.W8_BROKEN,
      action: WINNER_ACTION.KILL_SWITCH,
      recommendedWeightPct: 0.0,
      qualityScore: quality.score,
      expectationRiskScore: expectations.score,
      thesisIntegrityScore: thesis.score,
      rationale: `Structural thesis breakage (Thesis Integrity: ${thesis.score}/10 [BROKEN]): Operating Cash Flow negative (₹${operatingCashFlowCr} Cr) or receivables severely bloated (${receivableDays} days) despite reported accounting PAT. Immediate full exit to protect capital.`,
      scenarioType: 'SCENARIO_C_STRUCTURAL_BREAKAGE'
    };
  }

  // =========================================================================
  // 2. EARLY LIFECYCLE STATES (W0, W1, W2)
  // =========================================================================
  if (thesisState < 3) {
    return {
      ticker,
      winnerState: WINNER_STATE.W0_PRE_CONTRACT,
      action: WINNER_ACTION.WAIT,
      recommendedWeightPct: 0.0,
      qualityScore: quality.score,
      expectationRiskScore: expectations.score,
      thesisIntegrityScore: thesis.score,
      rationale: `Early thesis development (State ${thesisState}); unproven capex or pre-commercial discussions. Zero capital deployed until binding contract/approval is signed.`,
      scenarioType: 'WAIT_FOR_CONTRACT'
    };
  }

  if (thesisState === 3) {
    // Quality & Integrity Governor: State 3 is necessary, NOT sufficient for capital deployment!
    if (quality.classification === 'WEAK_QUALITY' || quality.score < 4.0 || thesis.score < 5.0) {
      return {
        ticker,
        winnerState: WINNER_STATE.W0_PRE_CONTRACT,
        action: WINNER_ACTION.AVOID,
        recommendedWeightPct: 0.0,
        qualityScore: quality.score,
        expectationRiskScore: expectations.score,
        thesisIntegrityScore: thesis.score,
        rationale: `Narrative / Quality Trap Avoided: Event/filing claimed (State 3), but Business Quality is weak (${quality.score}/10 [${quality.classification}]) or Thesis Integrity is fragile (${thesis.score}/10). Zero capital deployed.`,
        scenarioType: 'QUALITY_GOVERNOR_AVOID'
      };
    }

    if (trailingPE >= 50.0 || expectations.score >= 7.0) {
      return {
        ticker,
        winnerState: WINNER_STATE.W5_PRICE_AHEAD,
        action: WINNER_ACTION.GOVERNOR_BLOCK,
        recommendedWeightPct: 1.0,
        qualityScore: quality.score,
        expectationRiskScore: expectations.score,
        thesisIntegrityScore: thesis.score,
        rationale: `Binding contract signed (State 3), but trailing multiple (${trailingPE.toFixed(1)}x) or expectation risk (${expectations.score}/10) is elevated. Starter tranche capped at 1.0%.`,
        scenarioType: 'VALUATION_RESTRICTED'
      };
    }

    return {
      ticker,
      winnerState: WINNER_STATE.W1_EMERGING,
      action: WINNER_ACTION.STARTER,
      recommendedWeightPct: 1.0,
      qualityScore: quality.score,
      expectationRiskScore: expectations.score,
      thesisIntegrityScore: thesis.score,
      rationale: `Binding commercial contract/statutory clearance confirmed (State 3) with sound fundamentals (Quality: ${quality.score}/10); initial 1.0% starter tranche deployed.`,
      scenarioType: 'STARTER_ENTRY'
    };
  }

  if (thesisState === 4) {
    if (quality.classification === 'WEAK_QUALITY' || quality.score < 4.0 || thesis.score < 5.0) {
      return {
        ticker,
        winnerState: WINNER_STATE.W0_PRE_CONTRACT,
        action: WINNER_ACTION.AVOID,
        recommendedWeightPct: 0.0,
        qualityScore: quality.score,
        expectationRiskScore: expectations.score,
        thesisIntegrityScore: thesis.score,
        rationale: `Validation stage (State 4), but underlying Quality (${quality.score}/10) or Cash Flow Integrity (${thesis.score}/10) is impaired. Capital deployment blocked.`,
        scenarioType: 'QUALITY_GOVERNOR_AVOID'
      };
    }

    if (trailingPE >= 50.0 || expectations.score >= 7.0) {
      return {
        ticker,
        winnerState: WINNER_STATE.W5_PRICE_AHEAD,
        action: WINNER_ACTION.GOVERNOR_BLOCK,
        recommendedWeightPct: Math.min(priorWeightPct > 0 ? priorWeightPct : 1.0, 2.0),
        qualityScore: quality.score,
        expectationRiskScore: expectations.score,
        thesisIntegrityScore: thesis.score,
        rationale: `Validation in progress (State 4), but trailing multiple (${trailingPE.toFixed(1)}x) exceeds governor ceiling. Additions blocked.`,
        scenarioType: 'VALUATION_RESTRICTED'
      };
    }

    return {
      ticker,
      winnerState: WINNER_STATE.W2_CONFIRMED,
      action: WINNER_ACTION.ADD,
      recommendedWeightPct: Math.min(priorWeightPct + 1.0, 2.5),
      qualityScore: quality.score,
      expectationRiskScore: expectations.score,
      thesisIntegrityScore: thesis.score,
      rationale: `Physical validation batches/deliveries confirmed (State 4); scaling allocation to 2.0%-2.5% at reasonable multiple (${trailingPE.toFixed(1)}x).`,
      scenarioType: 'SCALING_CONFIRMATION'
    };
  }

  // =========================================================================
  // 3. MULTI-BAGGER MATURE & COMPOUNDING STATES (State 5)
  // =========================================================================
  if (isMultiBagger) {
    // Check if position was previously trimmed and growth has NOT recovered to >=20%
    if (priorWeightPct === 2.5 && ttmEarningsGrowthPct < 20.0) {
      return {
        ticker,
        winnerState: WINNER_STATE.W7_DIVERGENCE,
        action: WINNER_ACTION.HOLD_TRIMMED,
        recommendedWeightPct: 2.5,
        qualityScore: quality.score,
        expectationRiskScore: expectations.score,
        thesisIntegrityScore: thesis.score,
        priceGainMultiplier: parseFloat(priceGainMultiplier.toFixed(2)),
        impliedEpsCagrPct: parseFloat(impliedEpsCagrPct.toFixed(1)),
        actualGrowthPct: parseFloat(ttmEarningsGrowthPct.toFixed(1)),
        trailingPE: parseFloat(trailingPE.toFixed(1)),
        trailingRocePct: parseFloat(trailingRocePct.toFixed(1)),
        rationale: `Trimmed Position Held: Stock is consolidating around ₹${sharePrice.toFixed(2)} (${trailingPE.toFixed(1)}x P/E) with moderate growth (${ttmEarningsGrowthPct.toFixed(1)}%). Position maintained at trimmed 2.5% weight until re-acceleration occurs.`,
        scenarioType: 'HOLD_TRIMMED_WEIGHT'
      };
    }

    // Condition A: Confirmed Expectation Divergence (W7)
    // High multiple (>42x) AND actual growth is lagging expectations (<20% EPS growth and < implied CAGR)
    // AND confirmed across >= 2 quarters
    const isValuationStretched = trailingPE >= 42.0;
    const isGrowthLaggingExpectations = ttmEarningsGrowthPct < impliedEpsCagrPct && ttmEarningsGrowthPct < 20.0;
    
    // Note: If EPS growth is strong (>=25%), temporary ROCE dip does NOT trigger a trim!
    const isConfirmedDivergence = isValuationStretched && isGrowthLaggingExpectations;

    if (isConfirmedDivergence) {
      if (divergenceConsecutiveQuarters < 1) {
        // W9: Single-Quarter Noise Filter / Watch State (Do NOT sell on single quarter noise!)
        return {
          ticker,
          winnerState: WINNER_STATE.W9_EARLY_DIVERGENCE,
          action: WINNER_ACTION.WATCH_AND_HOLD,
          recommendedWeightPct: priorWeightPct > 0 ? priorWeightPct : 4.0,
          qualityScore: quality.score,
          expectationRiskScore: expectations.score,
          thesisIntegrityScore: thesis.score,
          priceGainMultiplier: parseFloat(priceGainMultiplier.toFixed(2)),
          impliedEpsCagrPct: parseFloat(impliedEpsCagrPct.toFixed(1)),
          actualGrowthPct: parseFloat(ttmEarningsGrowthPct.toFixed(1)),
          trailingPE: parseFloat(trailingPE.toFixed(1)),
          trailingRocePct: parseFloat(trailingRocePct.toFixed(1)),
          rationale: `W9 Early Divergence Watch: Multiple is elevated (${trailingPE.toFixed(1)}x) and single-quarter growth slowed to ${ttmEarningsGrowthPct.toFixed(1)}%, but Thesis Integrity is clean (${thesis.score}/10). Holding full position with Governor Lock; requiring 2-quarter confirmation before trimming.`,
          scenarioType: 'W9_EARLY_DIVERGENCE_WATCH'
        };
      }

      // W7: Confirmed 2-Quarter Divergence Trim
      return {
        ticker,
        winnerState: WINNER_STATE.W7_DIVERGENCE,
        action: WINNER_ACTION.TRIM,
        recommendedWeightPct: 2.5, // Systematically trim from 4.0% to 2.5%
        qualityScore: quality.score,
        expectationRiskScore: expectations.score,
        thesisIntegrityScore: thesis.score,
        priceGainMultiplier: parseFloat(priceGainMultiplier.toFixed(2)),
        impliedEpsCagrPct: parseFloat(impliedEpsCagrPct.toFixed(1)),
        actualGrowthPct: parseFloat(ttmEarningsGrowthPct.toFixed(1)),
        trailingPE: parseFloat(trailingPE.toFixed(1)),
        trailingRocePct: parseFloat(trailingRocePct.toFixed(1)),
        rationale: `Scenario B (Dangerous Winner / Confirmed Divergence): Stock has gained ${priceGainMultiplier.toFixed(1)}x to ₹${sharePrice.toFixed(2)} at ${trailingPE.toFixed(1)}x P/E, pricing in ${impliedEpsCagrPct.toFixed(1)}% EPS CAGR. Actual delivery (${ttmEarningsGrowthPct.toFixed(1)}%) has confirmed a 2-quarter slowdown. Systematically trimmed from 4.0% to 2.5% to protect multi-bagger gains without complete exit.`,
        scenarioType: 'SCENARIO_B_DANGEROUS_WINNER_TRIM'
      };
    }

    // Condition B: Composite Quality Compounder (W4 / W6)
    // High Quality (score >= 6.0) and strong earnings growth (>=20%) or elite ROCE (>=22%)
    const isQualityCompounder = quality.score >= 6.0 && (ttmEarningsGrowthPct >= 20.0 || trailingRocePct >= 22.0);

    if (isQualityCompounder) {
      const winnerState = trailingPE > 45.0 ? WINNER_STATE.W6_EARNINGS_CATCHUP : WINNER_STATE.W4_COMPOUNDER;
      return {
        ticker,
        winnerState,
        action: WINNER_ACTION.HOLD,
        recommendedWeightPct: 4.0, // Hold full Core
        qualityScore: quality.score,
        expectationRiskScore: expectations.score,
        thesisIntegrityScore: thesis.score,
        priceGainMultiplier: parseFloat(priceGainMultiplier.toFixed(2)),
        impliedEpsCagrPct: parseFloat(impliedEpsCagrPct.toFixed(1)),
        actualGrowthPct: parseFloat(ttmEarningsGrowthPct.toFixed(1)),
        trailingPE: parseFloat(trailingPE.toFixed(1)),
        trailingRocePct: parseFloat(trailingRocePct.toFixed(1)),
        rationale: `Scenario A (Composite Quality Compounder): Stock has gained ${priceGainMultiplier.toFixed(1)}x to ₹${sharePrice.toFixed(2)}, backed by Quality Score of ${quality.score}/10 (${quality.classification}) and ${ttmEarningsGrowthPct.toFixed(1)}% earnings growth. Continue holding full 4.0% Core position; avoid premature selling.`,
        scenarioType: 'SCENARIO_A_GOOD_WINNER_HOLD'
      };
    }
  }

  // Standard State 5 Core Positioning (For <2x gain holdings or initial State 5 entrants)
  return {
    ticker,
    winnerState: WINNER_STATE.W3_EXECUTION,
    action: WINNER_ACTION.CORE,
    recommendedWeightPct: 4.0,
    qualityScore: quality.score,
    expectationRiskScore: expectations.score,
    thesisIntegrityScore: thesis.score,
    rationale: `State 5 commercial delivery confirmed with healthy valuation (${trailingPE.toFixed(1)}x); core allocation maintained.`,
    scenarioType: 'CORE_EXECUTION'
  };
}
