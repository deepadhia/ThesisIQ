/**
 * Asymmetric Mispricing Ranking Layer
 * 
 * Epistemic Mandate:
 * Answers: "Among companies whose thesis is genuinely strong, which one is the market mispricing
 * the most — based on business trajectory + management credibility + earnings + cash + current price + implied expectations?"
 * 
 * Core Architectural Invariants:
 * 1. Zero Modification of Thesis Health: Consumes the frozen high-conviction thesis tracker output as an immutable upstream contract.
 * 2. Multi-Factor Asymmetry Synthesis: Combines Expectation Gap, Earnings Trajectory, Cash Quality, and Current Multiples into an Institutional Opportunity Score (0 - 100).
 * 3. Tiered Priority Sorting: Prioritizes Capital Deployment Dislocation opportunities (#1 Buy) while distinctly partitioning Trim and Exit candidates.
 */

export const MISPRICING_OPPORTUNITY_TIER = {
  TOP_CONVICTION_DISLOCATION: 'TOP_CONVICTION_DISLOCATION', // Highest risk-adjusted upside (#1, #2 Buy)
  COMPOUNDING_AT_FAIR_PRICE: 'COMPOUNDING_AT_FAIR_PRICE',   // Excellent business at fair valuation (Hold/Core)
  WATCHLIST_FRICTION: 'WATCHLIST_FRICTION',                 // Operational/cyclical friction under observation (Pause)
  OVERVALUED_COMPOUNDER: 'OVERVALUED_COMPOUNDER',           // Outstanding business but multiple bubble (Trim)
  STRUCTURAL_VALUE_TRAP: 'STRUCTURAL_VALUE_TRAP'            // Cheap on headline multiple but broken thesis (Exit/Avoid)
};

const TIER_PRIORITY = {
  [MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION]: 1,
  [MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE]: 2,
  [MISPRICING_OPPORTUNITY_TIER.WATCHLIST_FRICTION]: 3,
  [MISPRICING_OPPORTUNITY_TIER.OVERVALUED_COMPOUNDER]: 4,
  [MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP]: 5
};

/**
 * Computes Asymmetric Mispricing Score and Opportunity Tier for a single equity dossier.
 */
export function evaluateEquityMispricing(auditedEquity) {
  const {
    ticker,
    companyName,
    sector = 'Diversified',
    thesisHealth,
    currentConviction,
    evidenceSufficiency,
    valuationState,
    capitalAction,
    financialEvidence = {},
    cashFlowEvidence = {},
    currentPrice,
    currentPE,
    expectationGap = 0,
    expectedGrowthTrajectory = '20% CAGR',
    impliedGrowthRate = '15%'
  } = auditedEquity;

  // -------------------------------------------------------------------------
  // 1. Parse Underwritten vs Implied Growth Rates
  // -------------------------------------------------------------------------
  const expectedCagr = parseFloat(String(expectedGrowthTrajectory).replace(/[^0-9.]/g, '')) || 20.0;
  const impliedGrowth = parseFloat(String(impliedGrowthRate).replace(/[^0-9.]/g, '')) || 15.0;
  const growthAsymmetryDelta = parseFloat((expectedCagr - impliedGrowth).toFixed(1));

  // -------------------------------------------------------------------------
  // 2. Factor 1: Expectation Asymmetry & Margin of Safety (35% Weight)
  // -------------------------------------------------------------------------
  let asymmetryScore = 50.0;
  if (expectationGap !== undefined && expectationGap !== null) {
    if (expectationGap >= 20.0) asymmetryScore = 100.0;
    else if (expectationGap >= 15.0) asymmetryScore = 90.0;
    else if (expectationGap >= 10.0) asymmetryScore = 80.0;
    else if (expectationGap >= 5.0) asymmetryScore = 65.0;
    else if (expectationGap >= 0.0) asymmetryScore = 50.0;
    else if (expectationGap >= -15.0) asymmetryScore = 30.0;
    else if (expectationGap >= -30.0) asymmetryScore = 15.0;
    else asymmetryScore = 5.0;
  }

  // -------------------------------------------------------------------------
  // 3. Factor 2: Business Conviction & Thesis Quality (25% Weight)
  // -------------------------------------------------------------------------
  let convictionFactor = ((currentConviction || 5.0) / 10.0) * 100.0;
  if (thesisHealth === 'STRENGTHENING') convictionFactor = Math.min(100.0, convictionFactor + 10.0);
  else if (thesisHealth === 'BROKEN') convictionFactor = 0.0;
  else if (thesisHealth === 'UNDER_PRESSURE') convictionFactor = Math.min(40.0, convictionFactor * 0.5);

  // -------------------------------------------------------------------------
  // 4. Factor 3: Earnings Acceleration & ROIC / ROCE (20% Weight)
  // -------------------------------------------------------------------------
  const revGrowth = financialEvidence.revenueGrowthYoY || 0;
  const roce = financialEvidence.roce || 15.0;
  let earningsQualityScore = 50.0;
  if (revGrowth >= 25.0 && roce >= 22.0) earningsQualityScore = 100.0;
  else if (revGrowth >= 20.0 && roce >= 18.0) earningsQualityScore = 85.0;
  else if (revGrowth >= 15.0 && roce >= 15.0) earningsQualityScore = 70.0;
  else if (revGrowth < 0.0 || roce < 10.0) earningsQualityScore = 15.0;

  // -------------------------------------------------------------------------
  // 5. Factor 4: Statutory Cash Flow & Balance Sheet Pristineness (20% Weight)
  // -------------------------------------------------------------------------
  const cfoPat = cashFlowEvidence.cfoPatRatio !== undefined ? cashFlowEvidence.cfoPatRatio : 0.8;
  const recDays = cashFlowEvidence.receivableDays || 75;
  const debtEquity = cashFlowEvidence.debtToEquity || 0.0;
  let cashQualityScore = 50.0;

  if (cfoPat >= 0.80 && recDays <= 75 && debtEquity <= 0.20) cashQualityScore = 100.0;
  else if (cfoPat >= 0.70 && recDays <= 90 && debtEquity <= 0.40) cashQualityScore = 80.0;
  else if (cfoPat >= 0.50 && recDays <= 110) cashQualityScore = 55.0;
  else if (cfoPat < 0.25 || recDays > 150 || debtEquity > 0.80) cashQualityScore = 10.0;

  // -------------------------------------------------------------------------
  // 6. Synthesize Composite Mispricing Opportunity Score (0 - 100)
  // -------------------------------------------------------------------------
  let compositeScore = (
    (asymmetryScore * 0.35) +
    (convictionFactor * 0.25) +
    (earningsQualityScore * 0.20) +
    (cashQualityScore * 0.20)
  );

  // Hard Structural Gates:
  if (thesisHealth === 'BROKEN') {
    compositeScore = 0.0;
  } else if (thesisHealth === 'UNDER_PRESSURE' || evidenceSufficiency === 'INSUFFICIENT') {
    compositeScore = Math.min(35.0, compositeScore);
  } else if (valuationState === 'EXTREME') {
    compositeScore = Math.min(50.0, compositeScore);
  } else if (valuationState === 'FULL') {
    compositeScore = Math.min(75.0, compositeScore);
  }

  const finalScore = parseFloat(compositeScore.toFixed(1));

  // -------------------------------------------------------------------------
  // 7. Determine Mispricing Opportunity Tier
  // -------------------------------------------------------------------------
  let opportunityTier = MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE;
  let strategicActionNarrative = "";

  if (thesisHealth === 'BROKEN') {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP;
    strategicActionNarrative = "STRUCTURAL VALUE TRAP: Headline multiple may appear cheap, but business model or cash conversion is broken. Zero allocation.";
  } else if (valuationState === 'EXTREME' && (thesisHealth === 'STRENGTHENING' || thesisHealth === 'INTACT')) {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.OVERVALUED_COMPOUNDER;
    strategicActionNarrative = "OVERVALUED COMPOUNDER: Superb business execution, but market multiple has priced in multi-year perfection. Capital protection trim recommended.";
  } else if (
    thesisHealth === 'UNDER_PRESSURE' || 
    evidenceSufficiency === 'INSUFFICIENT' ||
    capitalAction === 'PAUSE_ADDITIONS' ||
    capitalAction === 'HOLD_ACTIVE_WATCH'
  ) {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.WATCHLIST_FRICTION;
    strategicActionNarrative = "WATCHLIST FRICTION: Operational or reporting friction under observation. Pause incremental capital until resolution.";
  } else if (finalScore >= 80.0 && (valuationState === 'ATTRACTIVE' || valuationState === 'REASONABLE') && (thesisHealth === 'STRENGTHENING' || thesisHealth === 'INTACT')) {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION;
    strategicActionNarrative = "TOP CONVICTION DISLOCATION: Exceptional business compounding at a significant discount to intrinsic growth runway. Prime capital deployment opportunity.";
  } else {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE;
    strategicActionNarrative = "COMPOUNDING AT FAIR PRICE: Healthy business compounding steadily with balanced risk-reward. Core holding.";
  }

  return {
    ticker,
    companyName,
    sector,
    price: currentPrice,
    pe: currentPE,
    thesisHealth,
    currentConviction,
    evidenceSufficiency,
    valuationState,
    capitalAction,
    opportunityTier,
    mispricingScore: finalScore,
    metrics: {
      expectationGap,
      expectedCagr,
      impliedGrowth,
      growthAsymmetryDelta,
      revenueGrowthYoY: revGrowth,
      roce,
      cfoPatRatio: cfoPat,
      receivableDays: recDays,
      debtToEquity: debtEquity
    },
    subScores: {
      asymmetryScore,
      convictionFactor: parseFloat(convictionFactor.toFixed(1)),
      earningsQualityScore,
      cashQualityScore
    },
    strategicActionNarrative
  };
}

/**
 * Ranks an entire coverage universe of audited equities by asymmetric mispricing opportunity.
 */
export function rankUniverseByMispricing(auditedUniverse = []) {
  const evaluated = auditedUniverse.map(eq => evaluateEquityMispricing(eq));

  // Sort primarily by Tier Priority (Top Dislocation Buys first), secondarily by Mispricing Score descending
  evaluated.sort((a, b) => {
    const pA = TIER_PRIORITY[a.opportunityTier] || 99;
    const pB = TIER_PRIORITY[b.opportunityTier] || 99;
    if (pA !== pB) return pA - pB;
    return b.mispricingScore - a.mispricingScore;
  });

  // Assign Universe Rank (#1, #2, #3...)
  return evaluated.map((item, idx) => ({
    universeRank: idx + 1,
    ...item
  }));
}
