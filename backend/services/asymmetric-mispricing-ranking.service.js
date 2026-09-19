/**
 * ThesisIQ v3.1: Institutional Asymmetric Compounding Engine (v3.1.1 Audit Patch)
 * 
 * Epistemic Mandate:
 * Evaluates whether a company possesses a genuine multibagger economic compounding engine,
 * whether its 5x pathway is physically and market-feasible over a standard 7-year horizon,
 * and whether current market price offers strict asymmetric upside (>3:1 risk-reward)
 * under conservative FCFF/WACC enterprise discounting.
 * 
 * 7-Layer Architecture:
 * - Layer 1: Forensic Truth & Cash Conversion Diagnostics (NOPAT, D&A, Capex, dNWC, Debt, Cash)
 * - Layer 2: Multibagger Economic Engine (Forward iROIC, Runway, Capture, Recency Priority)
 * - Layer 3: 5x Economic Pathway Feasibility (7-Year Horizon @ 25.85% CAGR, NOA, TAM Burden, Market Share Delta, Pathway Status)
 * - Layer 4: Institutional DCF (Formal FCFF_t = NOPAT_t - dNOA_t where dNOA_t = Capex_t - D&A_t + dNWC_t)
 * - Layer 5: Asymmetry & Downside Modeling (Dual Bear Floor: min(DCF Bear, Multiple Stress), Signed Asymmetry, Buy Below, Trim Above)
 * - Layer 6: Deterministic Decision State Machine (Zero Contradictions: Strict Rule Enforcement & 3-Way Conviction Separation)
 * - Layer 7: Thesis Evolution & Continuous Monitoring (Evidence Diff, Recency Audit, Dynamic State Transition)
 */

export const ECONOMIC_ENGINE_STATE = {
  PROVEN: 'PROVEN',                         // Moat proven, high ROCE, pristine cash conversion
  EMERGING: 'EMERGING',                     // Accelerating runway, high iROIC on new capex
  UNDER_CONSTRUCTION: 'UNDER_CONSTRUCTION', // Capex in installation; temporary cash absorption
  UNDER_REVALIDATION: 'UNDER_REVALIDATION', // Historical excellence undergoing recent friction
  UNPROVEN: 'UNPROVEN',                     // Story/guidance without verified unit economics
  BROKEN: 'BROKEN'                          // Structural deterioration or value destruction
};

export const EVIDENCE_RECENCY = {
  CURRENT_QUARTER: 'CURRENT_QUARTER',   // Weight: 1.0 (Latest quarterly audit - highest priority)
  PREVIOUS_QUARTER: 'PREVIOUS_QUARTER', // Weight: 0.8
  FY_LATEST: 'FY_LATEST',               // Weight: 0.6
  HISTORICAL_2YR: 'HISTORICAL_2YR',     // Weight: 0.3
  STALE: 'STALE'                        // Weight: 0.1
};

export const FORWARD_IROIC_CONFIDENCE = {
  HIGH: 'HIGH',               // Historical + Contracted Unit Economics (w_fwd = 0.80)
  MEDIUM: 'MEDIUM',           // Historical + Verified Capacity Addition (w_fwd = 0.50)
  LOW: 'LOW',                 // Management Guidance Only (w_fwd = 0.20)
  SPECULATIVE: 'SPECULATIVE'  // Unverified Story / Optionality (w_fwd = 0.00)
};

export const TAM_BURDEN_TIER = {
  SUBSTANTIAL_RUNWAY: 'SUBSTANTIAL_RUNWAY', // <10% Required Rev / TAM
  FEASIBLE: 'FEASIBLE',                     // 10-20%
  DEMANDING: 'DEMANDING',                   // 20-30%
  HIGHLY_DEMANDING: 'HIGHLY_DEMANDING',     // 30-50%
  UNFEASIBLE: 'UNFEASIBLE'                  // >50%
};

export const PATHWAY_5X_STATUS = {
  PASS: 'PASS',                                 // TAM Burden <= 20%, iROIC >= 20%, Target Margin >= 8% (Substantial Runway)
  CONDITIONAL: 'CONDITIONAL',                   // Feasible but demanding TAM burden (20-50%)
  TAM_CONSTRAINED: 'TAM_CONSTRAINED',           // TAM Burden > 50% (Demands massive market share capture)
  CAPITAL_HEAVY: 'CAPITAL_HEAVY',               // Requires massive incremental capital relative to NOA
  ECONOMICALLY_UNPROVEN: 'ECONOMICALLY_UNPROVEN', // Engine is UNPROVEN or UNDER_CONSTRUCTION
  FAILED: 'FAILED'                              // Business model / engine is BROKEN
};

export const EXPECTATIONS_REGIME = {
  MARKET_EXPECTATIONS_ABOVE_THESIS: 'MARKET_EXPECTATIONS_ABOVE_THESIS', // Market implied > Underwritten: high hurdle / priced for perfection
  EXPECTATIONS_ALIGNED: 'EXPECTATIONS_ALIGNED',                         // |Gap| < 2.0% pts: fairly priced expectations
  POTENTIAL_UNDEREXPECTATION: 'POTENTIAL_UNDEREXPECTATION',             // Gap >= +2.0% pts, Forward iROIC > WACC, verified evidence
  LARGE_UNDEREXPECTATION_REQUIRES_VALIDATION: 'LARGE_UNDEREXPECTATION_REQUIRES_VALIDATION' // Positive gap exists, but under observation / working capital friction / low confidence
};

export const FCFF_CONVERSION_STATUS = {
  POSITIVE_CASH_COMPOUNDER: 'POSITIVE_CASH_COMPOUNDER',       // Strong cash generation alongside growth (RR <= 65%, Conversion >= 35%)
  CAPITAL_INTENSIVE: 'CAPITAL_INTENSIVE',                       // Accretive growth absorbs heavy capital (e.g. HBL: RR 74.7%, Conversion 25.3%)
  FCFF_NEGATIVE_DURING_GROWTH: 'FCFF_NEGATIVE_DURING_GROWTH',   // Growth consumes more capital than NOPAT generates (RR > 85% or FCFF_5 <= 0)
  FCFF_RECOVERY_REQUIRED: 'FCFF_RECOVERY_REQUIRED'             // Working capital stress or baseline FCFF <= 0 requiring cash turnaround (e.g. Transrail)
};

export const FCFF_CONVERSION_THRESHOLDS = {
  POSITIVE_COMPOUNDER_MAX_RR: 0.65,
  POSITIVE_COMPOUNDER_MIN_CONVERSION: 35.0,
  CAPITAL_INTENSIVE_MAX_RR: 0.85,
  CAPITAL_INTENSIVE_MIN_CONVERSION: 15.0
};

export const MISPRICING_OPPORTUNITY_TIER = {
  TOP_CONVICTION_DISLOCATION: 'TOP_CONVICTION_DISLOCATION', // Strictly >= 3:1 Asymmetry, >= 25% MoS, >= 20% 3Y IRR (ACCUMULATE)
  COMPOUNDING_AT_FAIR_PRICE: 'COMPOUNDING_AT_FAIR_PRICE',   // Healthy compounder at fair price (Hold / Core)
  WATCHLIST_DISLOCATION_WATCH: 'WATCHLIST_DISLOCATION_WATCH', // Dislocation runway, waiting for Buy Below trigger
  WATCHLIST_FRICTION: 'WATCHLIST_FRICTION',                 // Operational/cyclical friction under observation (Pause)
  OVERVALUED_COMPOUNDER: 'OVERVALUED_COMPOUNDER',           // Outstanding business but multiple bubble (Trim)
  STRUCTURAL_VALUE_TRAP: 'STRUCTURAL_VALUE_TRAP'            // Broken thesis, solvency failure, or value destruction (Exit)
};

const TIER_PRIORITY = {
  [MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION]: 1,
  [MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE]: 2,
  [MISPRICING_OPPORTUNITY_TIER.WATCHLIST_DISLOCATION_WATCH]: 3,
  [MISPRICING_OPPORTUNITY_TIER.WATCHLIST_FRICTION]: 4,
  [MISPRICING_OPPORTUNITY_TIER.OVERVALUED_COMPOUNDER]: 5,
  [MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP]: 6
};

// -----------------------------------------------------------------------------
// Layer 1: Forensic Truth & Cash Conversion Diagnostics
// -----------------------------------------------------------------------------

/**
 * Calculates statutory baseline Free Cash Flow to Firm (FCFF).
 * Formula: FCFF = NOPAT + D&A - Capex - dNWC = NOPAT - dNOA
 * where dNOA = Capex - D&A + dNWC
 */
export function calculateBaselineFcff(params = {}) {
  const nopat = parseFloat(params.nopat) || (parseFloat(params.ttmPat) || 100.0);
  const dna = parseFloat(params.dna) || (nopat * 0.18);
  const capex = parseFloat(params.capex) || (nopat * 0.35);
  const dNwc = parseFloat(params.dNwc) || (nopat * 0.15);
  const cfoPat = parseFloat(params.cfoPatRatio !== undefined ? params.cfoPatRatio : 0.85);

  // Statutory Reconciled Identity: FCFF = NOPAT + D&A - Capex - dNWC = NOPAT - dNOA
  const dNoa = capex - dna + dNwc;
  const explicitFcff = nopat - dNoa;
  const cfoProxyFcff = (nopat * cfoPat) - (capex * 0.40);

  const baselineFcff = (params.dna !== undefined && params.capex !== undefined)
    ? explicitFcff
    : cfoProxyFcff;

  return {
    nopat: parseFloat(nopat.toFixed(2)),
    dna: parseFloat(dna.toFixed(2)),
    capex: parseFloat(capex.toFixed(2)),
    dNwc: parseFloat(dNwc.toFixed(2)),
    dNoa: parseFloat(dNoa.toFixed(2)),
    baselineFcff: parseFloat(baselineFcff.toFixed(2))
  };
}

/**
 * Computes forensic cash conversion diagnostics.
 * NOTE: CFO/PAT and related metrics serve as forensic diagnostics and risk inputs,
 * NEVER multiplying the FCFF equation directly.
 */
export function evaluateCashConversionDiagnostics(params = {}) {
  const nopat = parseFloat(params.nopat) || (parseFloat(params.ttmPat) || 100.0);
  const cfo = parseFloat(params.cfo) || (nopat * (params.cfoPatRatio !== undefined ? params.cfoPatRatio : 0.85));
  const dna = parseFloat(params.dna) || (nopat * 0.18);
  const capex = parseFloat(params.capex) || (nopat * 0.35);
  const dNwc = parseFloat(params.dNwc) || (nopat * 0.15);
  const revenue = parseFloat(params.revenue) || (nopat * 10.0);
  const recDays = parseFloat(params.receivableDays) || 75;
  const invDays = parseFloat(params.inventoryDays) || 60;

  const cfoToNopat = nopat > 0 ? parseFloat((cfo / nopat).toFixed(2)) : 0.0;
  const cfoToPat = parseFloat((params.cfoPatRatio !== undefined ? params.cfoPatRatio : (nopat > 0 ? cfo / nopat : 0.85)).toFixed(2));
  const fcff = nopat + dna - capex - dNwc;
  const fcffToNopat = nopat > 0 ? parseFloat((fcff / nopat).toFixed(2)) : 0.0;
  const dNwcToRevenue = revenue > 0 ? parseFloat(((dNwc / revenue) * 100).toFixed(1)) : 0.0;

  let diagnosticState = 'HEALTHY_CONVERSION';
  let diagnosticFrictionScore = 0; // 0 = pristine, 100 = severe drag
  const issues = [];

  if (cfoToPat < 0.65) {
    issues.push(`Low CFO/PAT (${(cfoToPat * 100).toFixed(0)}% < 65%) indicates earnings quality friction`);
    diagnosticFrictionScore += 35;
  }
  if (recDays > 100) {
    issues.push(`Elevated receivable days (${recDays} > 100 days) dragging working capital`);
    diagnosticFrictionScore += 25;
  }
  if (invDays > 120) {
    issues.push(`Elevated inventory days (${invDays} > 120 days) tying up cash`);
    diagnosticFrictionScore += 15;
  }
  if (dNwcToRevenue > 15.0) {
    issues.push(`High working capital intensity (${dNwcToRevenue}% of revenue)`);
    diagnosticFrictionScore += 25;
  }

  if (diagnosticFrictionScore >= 50) {
    diagnosticState = 'SEVERE_WORKING_CAPITAL_FRICTION';
  } else if (diagnosticFrictionScore >= 25) {
    diagnosticState = 'MODERATE_FRICTION';
  }

  return {
    cfoToNopat,
    cfoToPat,
    fcffToNopat,
    dNwcToRevenue,
    receivableDays: recDays,
    inventoryDays: invDays,
    diagnosticState,
    diagnosticFrictionScore,
    issues
  };
}

// -----------------------------------------------------------------------------
// Layer 2: Multibagger Economic Engine & Forward iROIC
// -----------------------------------------------------------------------------

/**
 * Calculates evidence-weighted Effective Forward iROIC across confidence and recency tiers.
 * Incorporates non-linear override: Recent contradictory negative evidence takes priority over stale positive evidence.
 */
export function calculateEffectiveForwardIroic(historicalRoce = 20.0, forwardIroic = 25.0, confidence = 'MEDIUM', recency = 'CURRENT_QUARTER', cashFlowEvidence = {}) {
  const cfoPat = cashFlowEvidence.cfoPatRatio !== undefined ? cashFlowEvidence.cfoPatRatio : 0.85;
  const recDays = cashFlowEvidence.receivableDays || 75;

  // Non-linear override: If latest quarter shows severe working capital deterioration,
  // do not allow stale optimism to blend in; clamp forward expectations to historical base
  const hasRecentContradiction = (recency === EVIDENCE_RECENCY.CURRENT_QUARTER && (cfoPat < 0.65 || recDays > 100));
  if (hasRecentContradiction) {
    return parseFloat(Math.min(historicalRoce, forwardIroic * 0.85).toFixed(1));
  }

  const confWeights = {
    [FORWARD_IROIC_CONFIDENCE.HIGH]: 0.80,
    [FORWARD_IROIC_CONFIDENCE.MEDIUM]: 0.50,
    [FORWARD_IROIC_CONFIDENCE.LOW]: 0.20,
    [FORWARD_IROIC_CONFIDENCE.SPECULATIVE]: 0.00
  };

  const recWeights = {
    [EVIDENCE_RECENCY.CURRENT_QUARTER]: 1.0,
    [EVIDENCE_RECENCY.PREVIOUS_QUARTER]: 0.8,
    [EVIDENCE_RECENCY.FY_LATEST]: 0.6,
    [EVIDENCE_RECENCY.HISTORICAL_2YR]: 0.3,
    [EVIDENCE_RECENCY.STALE]: 0.1
  };

  const wConf = confWeights[confidence] !== undefined ? confWeights[confidence] : 0.50;
  const wRec = recWeights[recency] !== undefined ? recWeights[recency] : 1.0;
  const effectiveFwdWeight = wConf * wRec;

  const effectiveIroic = (effectiveFwdWeight * forwardIroic) + ((1.0 - effectiveFwdWeight) * historicalRoce);
  return parseFloat(effectiveIroic.toFixed(1));
}

/**
 * Classifies the operational economic engine state.
 */
export function classifyEconomicEngineState(equity = {}) {
  const {
    thesisHealth = 'INTACT',
    financialEvidence = {},
    cashFlowEvidence = {},
    economicEvidence = {}
  } = equity;

  const roce = parseFloat(financialEvidence.roce) || 20.0;
  const cfoPat = cashFlowEvidence.cfoPatRatio !== undefined ? cashFlowEvidence.cfoPatRatio : 0.85;
  const recDays = cashFlowEvidence.receivableDays || 75;
  const debtEquity = cashFlowEvidence.debtToEquity || 0.0;
  const hasTransformationCapex = economicEvidence.hasTransformationCapex || false;

  if (thesisHealth === 'BROKEN' || thesisHealth === 'WEAKENING') {
    return ECONOMIC_ENGINE_STATE.BROKEN;
  }

  if (cfoPat < 0.65 && recDays > 100 && !hasTransformationCapex) {
    return ECONOMIC_ENGINE_STATE.UNDER_REVALIDATION;
  }

  if (hasTransformationCapex && cfoPat < 0.70) {
    return ECONOMIC_ENGINE_STATE.UNDER_CONSTRUCTION;
  }

  if (roce >= 22.0 && cfoPat >= 0.75 && debtEquity <= 0.30) {
    return ECONOMIC_ENGINE_STATE.PROVEN;
  }

  if (roce >= 16.0 && debtEquity <= 0.50) {
    return ECONOMIC_ENGINE_STATE.EMERGING;
  }

  return ECONOMIC_ENGINE_STATE.UNPROVEN;
}

// -----------------------------------------------------------------------------
// Layer 3: 5x Economic Pathway Feasibility Model (Standard 7-Year Horizon)
// -----------------------------------------------------------------------------

/**
 * Reverse-engineers what is required for a company to 5x its NOPAT over a standard 7-year horizon.
 * Standard institutional baseline: 5x in 7 years requires ~25.85% NOPAT CAGR.
 * Provides Current vs. Required Market Share expansion delta and Pathway Status classification.
 */
export function calculate5xEconomicPathway(equity = {}) {
  const {
    ticker = '',
    thesisHealth = 'INTACT',
    economicEngineState = 'PROVEN',
    financialEvidence = {},
    cashFlowEvidence = {},
    economicEvidence = {}
  } = equity;

  const currentRevenue = parseFloat(financialEvidence.currentRevenue) || 1000.0; // Cr
  const currentPat = parseFloat(financialEvidence.ttmPat) || (currentRevenue * 0.10);
  const currentNopat = parseFloat(financialEvidence.nopat) || currentPat;
  const targetNetMarginPct = parseFloat(economicEvidence.targetNetMarginPct) || Math.max(8.0, (currentNopat / currentRevenue) * 100.0);
  const effectiveIroicPct = parseFloat(economicEvidence.effectiveForwardIroic) || parseFloat(financialEvidence.roce) || 20.0;
  const addressableTamCr = parseFloat(economicEvidence.addressableTamCr) || (currentRevenue * 15.0); // Default 15x TAM
  const currentNoaCr = parseFloat(economicEvidence.currentNoaCr) || (currentNopat / (effectiveIroicPct / 100.0));

  // 1. Target 5x NOPAT
  const target5xNopat = currentNopat * 5.0;

  // 2. Standard 7-Year Horizon CAGR: (5^(1/7) - 1) ~ 25.85%
  const standardHorizonYears = 7;
  const required7YrCagrPct = parseFloat(((Math.pow(5.0, 1.0 / 7.0) - 1.0) * 100.0).toFixed(2)); // 25.85%

  const horizonSensitivity = {
    cagr5YrPct: parseFloat(((Math.pow(5.0, 1.0 / 5.0) - 1.0) * 100.0).toFixed(1)),   // 38.0%
    cagr7YrPct: required7YrCagrPct,                                                   // 25.85%
    cagr10YrPct: parseFloat(((Math.pow(5.0, 1.0 / 10.0) - 1.0) * 100.0).toFixed(1)), // 17.5%
    cagr12YrPct: parseFloat(((Math.pow(5.0, 1.0 / 12.0) - 1.0) * 100.0).toFixed(1))  // 14.4%
  };

  // 3. Required Revenue for 5x NOPAT
  const required5xRevenue = target5xNopat / (targetNetMarginPct / 100.0);

  // 4. Required Net Operating Assets (NOA)
  const required5xNoa = target5xNopat / (effectiveIroicPct / 100.0);

  // 5. Incremental Capital Required (Delta NOA)
  const incrementalCapitalRequired = Math.max(0.0, required5xNoa - currentNoaCr);

  // 6. Current vs Required 5x Market Share & Expansion Delta
  const currentEstimatedMarketSharePct = addressableTamCr > 0 ? parseFloat(((currentRevenue / addressableTamCr) * 100.0).toFixed(1)) : 0.0;
  const required5xMarketSharePct = addressableTamCr > 0 ? parseFloat(((required5xRevenue / addressableTamCr) * 100.0).toFixed(1)) : 0.0;
  const marketShareExpansionDeltaPct = parseFloat((required5xMarketSharePct - currentEstimatedMarketSharePct).toFixed(1));

  // 7. TAM Burden (% of addressable market required for 5x revenue)
  const tamBurdenPct = required5xMarketSharePct;

  // 8. TAM Burden Feasibility Tier
  let tamBurdenTier = TAM_BURDEN_TIER.FEASIBLE;
  if (tamBurdenPct < 10.0) tamBurdenTier = TAM_BURDEN_TIER.SUBSTANTIAL_RUNWAY;
  else if (tamBurdenPct <= 20.0) tamBurdenTier = TAM_BURDEN_TIER.FEASIBLE;
  else if (tamBurdenPct <= 30.0) tamBurdenTier = TAM_BURDEN_TIER.DEMANDING;
  else if (tamBurdenPct <= 50.0) tamBurdenTier = TAM_BURDEN_TIER.HIGHLY_DEMANDING;
  else tamBurdenTier = TAM_BURDEN_TIER.UNFEASIBLE;

  // 9. Pathway Verdict Status
  let pathwayStatus = PATHWAY_5X_STATUS.PASS;
  if (thesisHealth === 'BROKEN' || thesisHealth === 'WEAKENING' || economicEngineState === 'BROKEN') {
    pathwayStatus = PATHWAY_5X_STATUS.FAILED;
  } else if (economicEngineState === 'UNPROVEN' || economicEngineState === 'UNDER_CONSTRUCTION') {
    pathwayStatus = PATHWAY_5X_STATUS.ECONOMICALLY_UNPROVEN;
  } else if (tamBurdenPct > 50.0) {
    pathwayStatus = PATHWAY_5X_STATUS.TAM_CONSTRAINED;
  } else if (incrementalCapitalRequired > (currentNoaCr * 3.0) && effectiveIroicPct < 15.0) {
    pathwayStatus = PATHWAY_5X_STATUS.CAPITAL_HEAVY;
  } else if (tamBurdenPct > 20.0) {
    pathwayStatus = PATHWAY_5X_STATUS.CONDITIONAL;
  } else {
    pathwayStatus = PATHWAY_5X_STATUS.PASS;
  }

  return {
    currentNopat: parseFloat(currentNopat.toFixed(1)),
    target5xNopat: parseFloat(target5xNopat.toFixed(1)),
    standardHorizonYears,
    required7YrCagrPct,
    horizonSensitivity,
    required5xRevenue: parseFloat(required5xRevenue.toFixed(1)),
    required5xNoa: parseFloat(required5xNoa.toFixed(1)),
    incrementalCapitalRequired: parseFloat(incrementalCapitalRequired.toFixed(1)),
    addressableTamCr: parseFloat(addressableTamCr.toFixed(1)),
    currentEstimatedMarketSharePct,
    required5xMarketSharePct,
    marketShareExpansionDeltaPct,
    tamBurdenPct: parseFloat(tamBurdenPct.toFixed(1)),
    tamBurdenTier,
    pathwayStatus
  };
}

// -----------------------------------------------------------------------------
// Layer 4: Market Expectations Gap & Deterministic Regimes
// -----------------------------------------------------------------------------

/**
 * Classifies Market Expectations Gap and deterministic Regime.
 * Formulas:
 * - EXPECTATIONS_GAP (% pts) = Underwritten NOPAT CAGR - Market-Implied FCFF CAGR.
 * - FCFF_CONVERSION_GAP (% pts) = Underwritten NOPAT CAGR - Underwritten FCFF CAGR.
 * 7-Year 5x Required CAGR (25.85%) is retained strictly as an external reference benchmark, not an input to the gap.
 * Hard gates prevent false-positive POTENTIAL_UNDEREXPECTATION when engine is broken, evidence is stale/low-confidence, or iROIC <= WACC.
 */
export function classifyMarketExpectationsRegime(options = {}) {
  const {
    underwrittenNopatCagr = 20.0,
    underwrittenFcffCagr = null,
    fcffConversionDragPct = null,
    fcffConversionGapPct = null, // Backward compatibility alias
    reinvestmentRatePct = 50.0,
    modeledFcffConversionPct = 50.0,
    fcffConversionStatus = FCFF_CONVERSION_STATUS.POSITIVE_CASH_COMPOUNDER,
    marketImpliedFcffCagr = 15.0,
    marketImpliedCagr, // Backward compatibility alias
    effectiveIroic = 20.0,
    waccPct = 11.5,
    economicEngineState = 'PROVEN',
    evidenceRecency = 'CURRENT_QUARTER',
    forwardIroicConfidence = 'HIGH',
    thesisHealth = 'INTACT'
  } = options;

  const impliedFcff = marketImpliedFcffCagr !== undefined ? marketImpliedFcffCagr : (marketImpliedCagr || 15.0);
  const expectationGapPct = parseFloat((underwrittenNopatCagr - impliedFcff).toFixed(1));
  
  // FCFF conversion drag is mathematically defined only when FCFF CAGR is valid
  const resolvedFcffDragPct = (underwrittenFcffCagr !== null && fcffConversionDragPct !== null)
    ? fcffConversionDragPct
    : (underwrittenFcffCagr !== null ? parseFloat((underwrittenNopatCagr - underwrittenFcffCagr).toFixed(1)) : null);

  const isValueAccretive = effectiveIroic > waccPct;
  const benchmark7Yr5xCagrPct = 25.85;

  const isBroken = (thesisHealth === 'BROKEN' || thesisHealth === 'WEAKENING' || economicEngineState === ECONOMIC_ENGINE_STATE.BROKEN);
  
  const hasFrictionOrUnvalidated = (
    economicEngineState === ECONOMIC_ENGINE_STATE.UNDER_REVALIDATION ||
    economicEngineState === ECONOMIC_ENGINE_STATE.UNPROVEN ||
    economicEngineState === ECONOMIC_ENGINE_STATE.UNDER_CONSTRUCTION ||
    forwardIroicConfidence === FORWARD_IROIC_CONFIDENCE.LOW ||
    forwardIroicConfidence === FORWARD_IROIC_CONFIDENCE.SPECULATIVE ||
    evidenceRecency === EVIDENCE_RECENCY.STALE ||
    evidenceRecency === EVIDENCE_RECENCY.HISTORICAL_2YR ||
    thesisHealth === 'UNDER_PRESSURE'
  );

  const baseDetails = {
    expectationGapPct,
    fcffConversionDragPct: resolvedFcffDragPct,
    fcffConversionGapPct: resolvedFcffDragPct, // alias
    marketImpliedFcffCagr: impliedFcff,
    marketImpliedCagr: impliedFcff,
    underwrittenNopatCagr,
    underwrittenFcffCagr,
    reinvestmentRatePct,
    modeledFcffConversionPct,
    forwardFcffToNopatRatioPct: modeledFcffConversionPct,
    fcffConversionStatus,
    benchmark7Yr5xCagrPct,
    isValueAccretive
  };

  // Gate 1: Broken Thesis or Destroying Capital
  if (isBroken) {
    return {
      ...baseDetails,
      regime: EXPECTATIONS_REGIME.MARKET_EXPECTATIONS_ABOVE_THESIS,
      isValueAccretive: false,
      narrative: `Structural problem: Thesis broken or cash generation impaired. Implied market growth (${impliedFcff}%) exceeds true economic capacity.`
    };
  }

  // Gate 2: Market Implied exceeds Underwritten NOPAT CAGR (Priced for perfection / high hurdle)
  if (expectationGapPct <= -2.0) {
    return {
      ...baseDetails,
      regime: EXPECTATIONS_REGIME.MARKET_EXPECTATIONS_ABOVE_THESIS,
      narrative: `Market implied FCFF growth (${impliedFcff}%) discounts more aggressive expansion than underwritten NOPAT thesis (${underwrittenNopatCagr}%). High hurdle / priced for perfection.`
    };
  }

  // Gate 3: Expectations broadly aligned within +/- 2.0% pts
  if (expectationGapPct < 2.0 && expectationGapPct > -2.0) {
    return {
      ...baseDetails,
      regime: EXPECTATIONS_REGIME.EXPECTATIONS_ALIGNED,
      narrative: `Market expectations (${impliedFcff}%) are closely aligned with underwritten operating trajectory (${underwrittenNopatCagr}%). Fairly priced expectations.`
    };
  }

  // Gate 4: Positive Expectation Gap (gap >= +2.0% pts)
  // Hard Gates: If operational friction, low confidence, or stale evidence -> LARGE_UNDEREXPECTATION_REQUIRES_VALIDATION
  if (hasFrictionOrUnvalidated) {
    return {
      ...baseDetails,
      regime: EXPECTATIONS_REGIME.LARGE_UNDEREXPECTATION_REQUIRES_VALIDATION,
      narrative: `Large expectation gap (+${expectationGapPct}% pts: NOPAT ${underwrittenNopatCagr}% vs Implied ${impliedFcff}%), but economic friction / low confidence requires operational validation before accumulating.`
    };
  }

  // Hard Gates: Forward iROIC must strictly exceed WACC to qualify as genuine value-accretive POTENTIAL_UNDEREXPECTATION
  if (isValueAccretive) {
    let conversionNuance = '';
    if (fcffConversionStatus === FCFF_CONVERSION_STATUS.CAPITAL_INTENSIVE) {
      conversionNuance = `growth is real but capital-intensive (FCFF CAGR ${underwrittenFcffCagr}%, modeled conversion ${modeledFcffConversionPct}%, drag +${resolvedFcffDragPct}% pts)`;
    } else if (fcffConversionStatus === FCFF_CONVERSION_STATUS.FCFF_NEGATIVE_DURING_GROWTH) {
      conversionNuance = `growth consumes cash (modeled conversion ${modeledFcffConversionPct}%, RR ${reinvestmentRatePct}%, FCFF negative during growth)`;
    } else if (fcffConversionStatus === FCFF_CONVERSION_STATUS.FCFF_RECOVERY_REQUIRED) {
      conversionNuance = `requires working-capital/FCFF turnaround before expansion`;
    } else {
      conversionNuance = `clean cash conversion (FCFF CAGR ${underwrittenFcffCagr}%, modeled conversion ${modeledFcffConversionPct}%)`;
    }

    return {
      ...baseDetails,
      regime: EXPECTATIONS_REGIME.POTENTIAL_UNDEREXPECTATION,
      isValueAccretive: true,
      narrative: `Substantial expectation gap (+${expectationGapPct}% pts: NOPAT ${underwrittenNopatCagr}% vs Implied ${impliedFcff}%) supported by value-accretive Forward iROIC (${effectiveIroic}% > ${waccPct}% WACC); ${conversionNuance}.`
    };
  }

  // If iROIC <= WACC, growth destroys value even if gap is positive
  return {
    ...baseDetails,
    regime: EXPECTATIONS_REGIME.EXPECTATIONS_ALIGNED,
    isValueAccretive: false,
    narrative: `Growth gap exists but iROIC (${effectiveIroic}%) does not exceed WACC (${waccPct}%) to create accretive value.`
  };
}

// -----------------------------------------------------------------------------
// Layer 6: Institutional DCF (EV -> FCFF -> WACC -> Net Debt Bridge)
// -----------------------------------------------------------------------------

/**
 * Dynamically resolves terminal growth rate gt based on sector and business quality.
 */
export function resolveTerminalGrowthRate(sector = '', businessQuality = 'QUALITY_COMPOUNDER') {
  const sec = (sector || '').toLowerCase();
  if (sec.includes('defence') || sec.includes('rail') || sec.includes('tech') || sec.includes('specialty')) {
    return 0.040; // 4.0%
  } else if (sec.includes('auto') || sec.includes('packaging') || sec.includes('engineering')) {
    return 0.035; // 3.5%
  } else if (sec.includes('commodity') || sec.includes('sugar') || sec.includes('textile')) {
    return 0.025; // 2.5%
  }
  return 0.035; // 3.5% Default
}

/**
 * Calculates Institutional DCF Enterprise Value and Intrinsic Fair Value per share.
 * In every forecast year: FCFF_t = NOPAT_t - dNOA_t = NOPAT_t * (1 - ReinvestmentRate_t)
 * where ReinvestmentRate_t = g_t / EffectiveForwardiROIC and dNOA_t = Capex_t - D&A_t + dNWC_t.
 */
export function calculateInstitutionalFcffDcf(options = {}) {
  const currentPrice = options.currentPrice || 100.0;
  const pe = options.currentPE || 20.0;
  const underwrittenCagr = (options.underwrittenCagr || 20.0) / 100.0;
  const effectiveIroic = Math.max(0.12, (options.effectiveIroic || options.roce || 20.0) / 100.0);
  const wacc = options.wacc || 0.115; // 11.5% default WACC
  const gt = options.terminalGrowth || 0.035; // 3.5% default terminal growth
  const multipleDeratePct = options.multipleDeratePct || 0.0;
  const netDebtCr = options.netDebtCr || 0.0; // Positive = Net Debt, Negative = Net Cash
  const marketCapCr = options.marketCapCr || (currentPrice * 10.0);

  const baselineEps = pe > 0 ? (currentPrice / pe) : 1.0;
  let pv = 0;
  let eps = baselineEps;

  // Stage 1: Years 1-5 (Explicit Underwritten Growth)
  const rr1 = Math.min(0.85, Math.max(0.10, underwrittenCagr / effectiveIroic));
  for (let t = 1; t <= 5; t++) {
    eps *= (1 + underwrittenCagr);
    const fcff = eps * (1 - rr1);
    pv += fcff / Math.pow(1 + wacc, t);
  }

  // Stage 2: Years 6-10 (Linear Competitive Fade to gt)
  for (let t = 6; t <= 10; t++) {
    const fadeG = underwrittenCagr - ((t - 5) / 5.0) * (underwrittenCagr - gt);
    const rr_t = Math.min(0.85, Math.max(0.10, fadeG / effectiveIroic));
    eps *= (1 + fadeG);
    const fcff = eps * (1 - rr_t);
    pv += fcff / Math.pow(1 + wacc, t);
  }

  // Stage 3: Terminal Value at Year 10
  const terminalRr = Math.min(0.85, Math.max(0.10, gt / effectiveIroic));
  const terminalFcff = eps * (1 + gt) * (1 - terminalRr);
  let terminalValue = terminalFcff / Math.max(0.02, (wacc - gt));
  if (multipleDeratePct > 0) {
    terminalValue *= (1.0 - multipleDeratePct);
  }
  pv += terminalValue / Math.pow(1 + wacc, 10);

  // Net Debt / Cash Bridge Adjustment
  let perShareAdjustment = 0;
  if (marketCapCr > 0 && currentPrice > 0) {
    const sharesCr = marketCapCr / currentPrice;
    if (sharesCr > 0) {
      perShareAdjustment = - (netDebtCr / sharesCr); // If net cash (negative netDebt), adds to value
    }
  }

  const intrinsicFairValuePerShare = Math.max(1.0, pv + perShareAdjustment);
  return parseFloat(intrinsicFairValuePerShare.toFixed(2));
}

// -----------------------------------------------------------------------------
// Layer 5: Asymmetry & Downside Risk Modeling
// -----------------------------------------------------------------------------

/**
 * Solves market-implied growth rate using the 2-Stage FCFF / WACC model.
 */
export function solveTwoStageFcfImpliedGrowth(pe, options = {}) {
  const wacc = options.wacc || options.discountRate || 0.115;
  const gt = options.terminalGrowth || 0.035;
  const effectiveIroic = Math.max(0.12, (options.effectiveIroic || options.roce || 20.0) / 100.0);
  const isForward = options.isForwardEstimate || false;
  const forwardYears = options.forwardHorizonYears || 2;

  if (!pe || pe <= 0 || isNaN(pe)) return 15.0;

  let low = -0.20;
  let high = 0.80;
  let bestG = 0.10;

  for (let iter = 0; iter < 45; iter++) {
    const g1 = (low + high) / 2;
    let pv = 0;
    let eps = 1.0;

    // Stage 1: Years 1-5 (Explicit Growth g1)
    const rr1 = Math.min(0.85, Math.max(0.10, g1 / effectiveIroic));
    for (let t = 1; t <= 5; t++) {
      eps *= (1 + g1);
      const fcff = eps * (1 - rr1);
      pv += fcff / Math.pow(1 + wacc, t);
    }

    // Stage 2: Years 6-10 (Linear Competitive Fade to gt)
    for (let t = 6; t <= 10; t++) {
      const fadeG = g1 - ((t - 5) / 5.0) * (g1 - gt);
      const rr_t = Math.min(0.85, Math.max(0.10, fadeG / effectiveIroic));
      eps *= (1 + fadeG);
      const fcff = eps * (1 - rr_t);
      pv += fcff / Math.pow(1 + wacc, t);
    }

    // Stage 3: Terminal Value at Year 10
    const terminalRr = Math.min(0.85, Math.max(0.10, gt / effectiveIroic));
    const terminalFcff = eps * (1 + gt) * (1 - terminalRr);
    const terminalValue = terminalFcff / Math.max(0.02, (wacc - gt));
    pv += terminalValue / Math.pow(1 + wacc, 10);

    if (isForward) {
      pv = pv / Math.pow(1 + g1, forwardYears);
    }

    if (pv >= pe) {
      bestG = g1;
      high = g1;
    } else {
      low = g1;
    }
  }

  return parseFloat((bestG * 100).toFixed(1));
}

/**
 * Calculates dual-methodology Bear Floor anchor: min(DCF Bear Floor, Multiple Stress Floor).
 */
export function calculateDualBearFloor(options = {}) {
  const currentPrice = options.currentPrice || 100.0;
  const currentPE = options.currentPE || 20.0;
  const expectedCagr = options.underwrittenCagr || 20.0;
  const effectiveIroic = options.effectiveIroic || 20.0;
  const gt = options.terminalGrowth || 0.035;
  const netDebtCr = options.netDebtCr || 0.0;
  const marketCapCr = options.marketCapCr || (currentPrice * 10.0);

  // 1. DCF Bear Floor: Formal DCF with -30% growth cut, stressed iROIC, +150 bps WACC (13.0%), 2.0% terminal growth
  const dcfBearFloor = calculateInstitutionalFcffDcf({
    currentPrice,
    currentPE,
    underwrittenCagr: expectedCagr * 0.70,
    effectiveIroic: Math.max(10.0, effectiveIroic * 0.75),
    wacc: 0.130, // 13.0% stressed WACC
    terminalGrowth: Math.max(0.02, gt - 0.015),
    multipleDeratePct: 0.20,
    netDebtCr,
    marketCapCr
  });

  // 2. Multiple Stress Floor: Cyclical trough multiple (40% multiple compression, min 12x P/E)
  const baselineEps = currentPE > 0 ? (currentPrice / currentPE) : 1.0;
  const troughPE = Math.max(12.0, currentPE * 0.60);
  let perShareAdjustment = 0;
  if (marketCapCr > 0 && currentPrice > 0) {
    const sharesCr = marketCapCr / currentPrice;
    if (sharesCr > 0) {
      perShareAdjustment = - (netDebtCr / sharesCr);
    }
  }
  const multipleStressFloor = parseFloat(Math.max(1.0, (baselineEps * troughPE) + perShareAdjustment).toFixed(2));

  // Anchor is the conservative minimum of both formal methodologies
  const bearFloorPrice = parseFloat(Math.min(dcfBearFloor, multipleStressFloor).toFixed(2));

  return {
    bearFloorPrice,
    dcfBearFloor,
    multipleStressFloor
  };
}

/**
 * Evaluates balance sheet debt health dynamically across coverage, leverage, and reinvestment returns.
 */
export function evaluateDebtHealth(equity = {}) {
  const { cashFlowEvidence = {}, financialEvidence = {} } = equity;
  const debtEquity = parseFloat(cashFlowEvidence.debtToEquity) || 0.0;
  const interestCoverage = parseFloat(financialEvidence.interestCoverage !== undefined ? financialEvidence.interestCoverage : 15.0);
  const netDebtCr = parseFloat(cashFlowEvidence.netDebtCr) || 0.0;
  const roce = parseFloat(financialEvidence.roce) || 20.0;

  if (netDebtCr < 0 || debtEquity <= 0.05) {
    return { status: 'FORTRESS_CASH', score: 100, isFailure: false, narrative: 'Net cash balance sheet provides downside fortress resilience.' };
  }

  if (debtEquity > 0.60 && interestCoverage < 3.5) {
    return { status: 'SOLVENCY_FAILURE', score: 0, isFailure: true, narrative: 'High leverage (D/E > 0.60x) coupled with thin interest coverage (< 3.5x). Solvency hard stop.' };
  }

  if (debtEquity > 0.60 && interestCoverage >= 8.0 && roce >= 22.0) {
    return { status: 'EXPANSION_LEVERAGE', score: 70, isFailure: false, narrative: 'Elevated debt actively funding high-return capacity additions (ROCE >= 22%). Monitored.' };
  }

  if (debtEquity > 0.40) {
    return { status: 'LEVERAGE_WARNING', score: 60, isFailure: false, narrative: 'Moderate leverage under observation.' };
  }

  return { status: 'PRISTINE', score: 90, isFailure: false, narrative: 'Conservative balance sheet with strong solvency coverage.' };
}

/**
 * Deterministically generates a concrete, falsifiable Thesis-Breaker Metric for any equity.
 */
export function generateThesisBreakerMetric(equity = {}) {
  const sec = (equity.sector || '').toLowerCase();
  const tick = (equity.ticker || '').toUpperCase();

  if (tick === 'HBLENGINE') {
    return 'KAVACH order inflow drops < ₹300 Cr/yr OR Train Collision Avoidance contract execution stalls > 2 quarters';
  } else if (tick === 'TIMETECHNO') {
    return 'Type-IV Composite Cylinder margin contribution drops < 18% OR Debt/Equity exceeds 0.35x';
  } else if (tick === 'SKIPPER') {
    return 'T&D EPC execution order book falls below 2.0x trailing revenue OR CFO/PAT drops below 0.50';
  } else if (tick === 'ANANTRAJ') {
    return 'Data Center leasing ARR drops < ₹150 Cr/MW OR residential collection rate falls below 80%';
  } else if (tick === 'HSCL') {
    return 'Synthetic Anode plant commissioning delayed beyond Q4 FY27 OR Gross Spread contracts > 350 bps';
  } else if (tick === 'GRAVITA') {
    return 'Lead/Aluminium scrap volume growth drops < 15% YoY OR Battery Waste Management compliance stalls';
  } else if (tick === 'SJS') {
    return 'Automotive aesthetic value-added content per vehicle drops OR EBITDA margin falls below 22%';
  } else if (tick === 'SHAKTIPUMP') {
    return 'PM-KUSUM subsidy receivables exceed 150 days OR Net Profit margin falls below 8%';
  } else if (tick === 'ELECON') {
    return 'Industrial Gear order book intake declines > 15% YoY OR MHI overseas revenue growth stalls';
  } else if (tick === 'TRANSRAILL') {
    return 'Receivable days remain above 115 days for 2 consecutive quarters OR EBITDA margin drops below 11%';
  }

  if (sec.includes('auto') || sec.includes('industrial')) {
    return 'EBITDA margin contracts < 14.0% OR CFO/PAT falls below 0.60 for 2 consecutive quarters';
  } else if (sec.includes('defence') || sec.includes('rail') || sec.includes('infra') || sec.includes('capital goods')) {
    return 'Order backlog book-to-bill drops below 1.2x trailing revenue OR working capital days exceed 125 days';
  } else if (sec.includes('chemical') || sec.includes('material')) {
    return 'Gross margin spreads compress > 300 bps YoY OR CapEx project commissioning slips > 2 quarters';
  } else if (sec.includes('tech') || sec.includes('fintech') || sec.includes('financial')) {
    return 'Take-rate contracts > 50 bps YoY OR customer renewal/retention drops below 85%';
  }

  return 'CFO/PAT drops below 0.50 for 2 consecutive quarters OR Revenue YoY growth decelerates below 10%';
}

/**
 * Calculates unified ThesisIQ v3.1 Institutional Compounding Scorecard with 3-Way Conviction Separation.
 * Accurately calculates signed asymmetry ratio (preserving negative ratios when CMP > Fair Value).
 */
export function calculateThesisIqScorecard(equity = {}) {
  const currentPrice = parseFloat(equity.currentPrice) || 100.0;
  const currentPE = parseFloat(equity.currentPE) || 20.0;
  const expectedCagr = parseFloat(String(equity.expectedGrowthTrajectory || '20').replace(/[^0-9.]/g, '')) || 20.0;
  const roce = parseFloat(equity.financialEvidence?.roce) || 20.0;
  const cfoPat = equity.cashFlowEvidence?.cfoPatRatio !== undefined ? equity.cashFlowEvidence.cfoPatRatio : 0.85;
  const debtEquity = equity.cashFlowEvidence?.debtToEquity || 0.0;
  const sector = equity.sector || '';

  // 1. Cash Conversion Diagnostics (Layer 1)
  const cashDiagnostics = evaluateCashConversionDiagnostics({
    ttmPat: equity.financialEvidence?.ttmPat || (currentPrice * 5.0),
    cfoPatRatio: cfoPat,
    receivableDays: equity.cashFlowEvidence?.receivableDays || 75,
    inventoryDays: equity.cashFlowEvidence?.inventoryDays || 60,
    revenue: equity.financialEvidence?.currentRevenue || (currentPrice * 50.0)
  });

  // 2. Evidence Freshness & Effective Forward iROIC (Layer 2)
  const forwardIroic = parseFloat(equity.economicEvidence?.forwardIroic) || (roce * 1.15);
  const confidence = equity.economicEvidence?.forwardIroicConfidence || 'MEDIUM';
  const recency = equity.economicEvidence?.evidenceRecency || 'CURRENT_QUARTER';
  const effectiveIroic = calculateEffectiveForwardIroic(roce, forwardIroic, confidence, recency, equity.cashFlowEvidence);

  // 3. Economic Engine State
  const economicEngineState = classifyEconomicEngineState({
    ...equity,
    financialEvidence: { ...equity.financialEvidence, roce },
    cashFlowEvidence: { ...equity.cashFlowEvidence, cfoPatRatio: cfoPat, debtToEquity: debtEquity }
  });

  // 4. 5x Economic Pathway Feasibility (Layer 3 - Standard 7-Year Horizon)
  const pathway5x = calculate5xEconomicPathway({
    ...equity,
    thesisHealth: equity.thesisHealth,
    economicEngineState,
    economicEvidence: { ...equity.economicEvidence, effectiveForwardIroic: effectiveIroic }
  });

  // 5. Dynamic Terminal Growth Rate & WACC (Layer 6)
  const gt = resolveTerminalGrowthRate(sector);
  const wacc = 0.115; // 11.5% institutional WACC

  // 6. Layer 3 & Layer 4: Underwritten NOPAT CAGR vs Underwritten FCFF CAGR vs Market-Implied FCFF CAGR
  const underwrittenNopatCagr = expectedCagr;
  const g = underwrittenNopatCagr / 100.0;
  const iroic = effectiveIroic / 100.0;
  
  // Unconstrained Reinvestment Rate: RR = g / iROIC
  const rawReinvestmentRate = iroic > 0 ? (g / iroic) : 1.0;
  const reinvestmentRatePct = parseFloat((rawReinvestmentRate * 100.0).toFixed(1));
  
  // Modeled Forward FCFF Conversion Ratio: 1 - RR = 1 - g/iROIC
  const modeledFcffConversionRatio = 1.0 - rawReinvestmentRate;
  const modeledFcffConversionPct = parseFloat((modeledFcffConversionRatio * 100.0).toFixed(1));
  const forwardFcffToNopatRatioPct = modeledFcffConversionPct; // Alias for reporting
  
  // Statutory Baseline FCFF / NOPAT Conversion
  const baselineFcffConversion = cashDiagnostics.fcffToNopat;
  
  // Terminal and Baseline FCFF Endpoint Check (Year 0 vs Year 5)
  const hasPositiveBaselineFcff = baselineFcffConversion > 0;
  const hasPositiveForecastFcff = modeledFcffConversionRatio > 0;
  
  // Underwritten FCFF CAGR & FCFF Conversion Drag
  let underwrittenFcffCagr = null;
  let fcffConversionDragPct = null;
  
  if (hasPositiveBaselineFcff && hasPositiveForecastFcff) {
    const fcffExpansionRatio = Math.pow(modeledFcffConversionRatio / baselineFcffConversion, 0.20);
    const computedCagr = ((1.0 + g) * fcffExpansionRatio - 1.0) * 100.0;
    if (Number.isFinite(computedCagr)) {
      underwrittenFcffCagr = parseFloat(computedCagr.toFixed(1));
      fcffConversionDragPct = parseFloat((underwrittenNopatCagr - underwrittenFcffCagr).toFixed(1));
    }
  }
  
  // Deterministic Status Classification Hierarchy:
  // A. FCFF recovery first: Working-capital stress or negative baseline FCFF
  // B. Negative FCFF during growth: Terminal FCFF_5 <= 0 or modeled conversion <= 0
  // C. Positive but capital-intensive: FCFF_5 > 0 but RR > 0.65 or conversion < 35%
  // D. Positive cash compounder: Strong conversion (RR <= 0.65 and conversion >= 35%)
  let fcffConversionStatus = FCFF_CONVERSION_STATUS.POSITIVE_CASH_COMPOUNDER;
  
  const hasWorkingCapitalStress = (
    cashDiagnostics.diagnosticState === 'SEVERE_WORKING_CAPITAL_FRICTION' ||
    cashDiagnostics.diagnosticFrictionScore >= 50 ||
    cfoPat < 0.65 ||
    !hasPositiveBaselineFcff
  );
  
  if (hasWorkingCapitalStress) {
    fcffConversionStatus = FCFF_CONVERSION_STATUS.FCFF_RECOVERY_REQUIRED;
  } else if (!hasPositiveForecastFcff || rawReinvestmentRate > 1.0 || modeledFcffConversionPct <= 0.0) {
    fcffConversionStatus = FCFF_CONVERSION_STATUS.FCFF_NEGATIVE_DURING_GROWTH;
  } else if (
    rawReinvestmentRate > FCFF_CONVERSION_THRESHOLDS.POSITIVE_COMPOUNDER_MAX_RR ||
    modeledFcffConversionPct < FCFF_CONVERSION_THRESHOLDS.POSITIVE_COMPOUNDER_MIN_CONVERSION
  ) {
    fcffConversionStatus = FCFF_CONVERSION_STATUS.CAPITAL_INTENSIVE;
  } else {
    fcffConversionStatus = FCFF_CONVERSION_STATUS.POSITIVE_CASH_COMPOUNDER;
  }
  
  const marketImpliedFcffCagr = solveTwoStageFcfImpliedGrowth(currentPE, { wacc, gt, effectiveIroic });
  const marketImpliedCagr = marketImpliedFcffCagr; // alias

  const expectationsLayer = classifyMarketExpectationsRegime({
    underwrittenNopatCagr,
    underwrittenFcffCagr,
    fcffConversionDragPct,
    fcffConversionGapPct: fcffConversionDragPct,
    reinvestmentRatePct,
    modeledFcffConversionPct,
    fcffConversionStatus,
    marketImpliedFcffCagr,
    effectiveIroic,
    waccPct: parseFloat((wacc * 100).toFixed(1)),
    economicEngineState,
    evidenceRecency: recency,
    forwardIroicConfidence: confidence,
    thesisHealth: equity.thesisHealth
  });

  // 7. Intrinsic Fair Value (Layer 6 DCF)
  const fairValuePrice = calculateInstitutionalFcffDcf({
    currentPrice,
    currentPE,
    underwrittenCagr: underwrittenNopatCagr,
    effectiveIroic,
    wacc,
    terminalGrowth: gt,
    multipleDeratePct: 0.0,
    netDebtCr: equity.cashFlowEvidence?.netDebtCr || 0.0,
    marketCapCr: equity.marketCap || (currentPrice * 10.0)
  });

  // 8. Dual-Methodology Bear Floor (Layer 7: min(DCF Bear, Multiple Stress))
  const dualBear = calculateDualBearFloor({
    currentPrice,
    currentPE,
    underwrittenCagr: underwrittenNopatCagr,
    effectiveIroic,
    terminalGrowth: gt,
    netDebtCr: equity.cashFlowEvidence?.netDebtCr || 0.0,
    marketCapCr: equity.marketCap || (currentPrice * 10.0)
  });
  const bearFloorPrice = dualBear.bearFloorPrice;

  // 9. Model-Derived Buy Below Price: Entry ceiling where BOTH >= 25% MoS AND >= 3.0:1 Asymmetry are met
  const buyBelowPrice = parseFloat(Math.min(
    fairValuePrice * 0.75,
    (fairValuePrice + 3.0 * bearFloorPrice) / 4.0
  ).toFixed(2));

  // 10. Model-Derived Trim Above Price
  const trimAbovePrice = parseFloat(Math.max(
    fairValuePrice * 1.15,
    currentPrice * Math.sqrt(Math.max(1.0, fairValuePrice / currentPrice))
  ).toFixed(2));

  // 11. Signed Asymmetry Ratio at Current Price: (Fair Value - CMP) / (CMP - Bear Floor)
  const netUpsideRupees = fairValuePrice - currentPrice;
  const downsideRupees = Math.max(1.0, currentPrice - bearFloorPrice);
  const asymmetryRatio = parseFloat((netUpsideRupees / downsideRupees).toFixed(2));

  // 12. Projected 3-Year Base Case IRR (% p.a. to Fair Value over 36 months)
  let projected3YrIrr = 0.0;
  if (currentPrice > 0 && fairValuePrice > 0) {
    projected3YrIrr = parseFloat(((Math.pow(fairValuePrice / currentPrice, 1.0 / 3.0) - 1.0) * 100.0).toFixed(1));
  }

  // 13. Margin of Safety at Current Price
  const marginOfSafetyPct = parseFloat((((fairValuePrice - currentPrice) / fairValuePrice) * 100.0).toFixed(1));

  // 14. Debt Health Status
  const debtHealth = evaluateDebtHealth(equity);

  // 15. Thesis-Breaker Metric
  const thesisBreakerMetric = generateThesisBreakerMetric(equity);

  // 16. Three-Way Conviction Separation
  let economicConviction = 'MEDIUM';
  if (economicEngineState === ECONOMIC_ENGINE_STATE.PROVEN) economicConviction = 'HIGH';
  else if (economicEngineState === ECONOMIC_ENGINE_STATE.EMERGING) economicConviction = 'MEDIUM';
  else if (economicEngineState === ECONOMIC_ENGINE_STATE.BROKEN) economicConviction = 'BROKEN';
  else economicConviction = 'LOW';

  let valuationConviction = 'FAIR_VALUE';
  if (asymmetryRatio >= 3.0 && marginOfSafetyPct >= 25.0 && projected3YrIrr >= 20.0) valuationConviction = 'DEEP_DISLOCATION';
  else if (asymmetryRatio >= 1.5 && marginOfSafetyPct >= 15.0) valuationConviction = 'ATTRACTIVE';
  else if (currentPE > 60.0 || marginOfSafetyPct < -40.0) valuationConviction = 'EXTREME';
  else if (currentPrice > fairValuePrice * 1.15) valuationConviction = 'OVERVALUED';
  else valuationConviction = 'FAIR_VALUE';

  let thesisConfidence = 'MEDIUM';
  if (confidence === 'HIGH' && recency === EVIDENCE_RECENCY.CURRENT_QUARTER) thesisConfidence = 'HIGH';
  else if ((confidence === 'HIGH' || confidence === 'MEDIUM') && (recency === EVIDENCE_RECENCY.CURRENT_QUARTER || recency === EVIDENCE_RECENCY.PREVIOUS_QUARTER || recency === EVIDENCE_RECENCY.FY_LATEST)) thesisConfidence = 'MEDIUM';
  else if (confidence === 'LOW' || recency === EVIDENCE_RECENCY.HISTORICAL_2YR) thesisConfidence = 'LOW';
  else thesisConfidence = 'SPECULATIVE';

  return {
    fairValuePrice,
    bearFloorPrice,
    dcfBearFloor: dualBear.dcfBearFloor,
    multipleStressFloor: dualBear.multipleStressFloor,
    buyBelowPrice,
    trimAbovePrice,
    asymmetryRatio,
    projected3YrIrr,
    marginOfSafetyPct,
    effectiveIroic,
    forwardIroicConfidence: confidence,
    evidenceRecency: recency,
    economicEngineState,
    terminalGrowthRate: parseFloat((gt * 100).toFixed(1)),
    waccPct: parseFloat((wacc * 100).toFixed(1)),
    underwrittenNopatCagr,
    underwrittenFcffCagr,
    reinvestmentRatePct,
    modeledFcffConversionPct,
    forwardFcffToNopatRatioPct: modeledFcffConversionPct,
    fcffConversionStatus,
    marketImpliedFcffCagr,
    marketImpliedCagr,
    expectationGapPct: expectationsLayer.expectationGapPct,
    fcffConversionDragPct: expectationsLayer.fcffConversionDragPct,
    fcffConversionGapPct: expectationsLayer.fcffConversionGapPct,
    expectationsRegime: expectationsLayer.regime,
    expectationsLayer,
    debtHealth,
    cashDiagnostics,
    pathway5x,
    convictions: {
      economicConviction,
      valuationConviction,
      thesisConfidence
    },
    thesisBreakerMetric
  };
}

// -----------------------------------------------------------------------------
// Layer 8: Deterministic Decision Engine & Universe Evaluation
// -----------------------------------------------------------------------------

/**
 * Solves for market-implied growth rate using a standard 10-year Reverse-DCF model.
 */
export function solveImpliedGrowthFromPE(pe, options = {}) {
  const r = options.discountRate || 0.12;      // 12% Cost of Capital
  const gt = options.terminalGrowth || 0.05;   // 5% Terminal Growth
  const years = options.holdingYears || 10;
  const isForward = options.isForwardEstimate || false;
  const forwardYears = options.forwardHorizonYears || 2;

  if (!pe || pe <= 0 || isNaN(pe)) return 15.0;

  let low = -0.20;
  let high = 0.80;
  let bestG = 0.10;

  for (let iter = 0; iter < 40; iter++) {
    const mid = (low + high) / 2;
    let pv = 0;
    let eps_t = 1;
    for (let t = 1; t <= years; t++) {
      eps_t *= (1 + mid);
      pv += eps_t / Math.pow(1 + r, t);
    }
    const terminalValue = (eps_t * (1 + gt)) / (r - gt);
    pv += terminalValue / Math.pow(1 + r, years);

    if (isForward) {
      pv = pv / Math.pow(1 + mid, forwardYears);
    }

    if (pv >= pe) {
      bestG = mid;
      high = mid;
    } else {
      low = mid;
    }
  }

  return parseFloat((bestG * 100).toFixed(1));
}

export function calculateTwoStageFcfIntrinsicValue(options = {}) {
  return calculateInstitutionalFcffDcf(options);
}

export function calculateHedgeFundScorecard(equity = {}) {
  const scorecard = calculateThesisIqScorecard(equity);
  return {
    ...scorecard,
    solvencyGatePassed: !scorecard.debtHealth.isFailure,
    upsideToFairValuePct: parseFloat((((scorecard.fairValuePrice - (equity.currentPrice || 100)) / (equity.currentPrice || 100)) * 100).toFixed(1)),
    downsideRiskPct: parseFloat(((((equity.currentPrice || 100) - scorecard.bearFloorPrice) / (equity.currentPrice || 100)) * 100).toFixed(1))
  };
}

/**
 * Computes ThesisIQ v3.1 Institutional Asymmetric Compounding Score and Opportunity Tier.
 */
export function evaluateEquityMispricing(auditedEquity) {
  const {
    ticker,
    companyName,
    sector = 'Diversified',
    thesisHealth,
    currentConviction,
    evidenceSufficiency,
    valuationState: inputValuationState,
    capitalAction,
    financialEvidence = {},
    cashFlowEvidence = {},
    currentPrice = 100.0,
    currentPE = 20.0,
    expectedGrowthTrajectory = '20% CAGR',
    impliedGrowthRate: inputImpliedGrowthRate,
    expectationGap: inputExpectationGap
  } = auditedEquity;

  const expectedCagr = parseFloat(String(expectedGrowthTrajectory).replace(/[^0-9.]/g, '')) || 20.0;
  
  // 1. Synthesize 8-Layer Scorecard
  const scorecard = calculateThesisIqScorecard(auditedEquity);

  // 2. Implied Growth and Expectations Gap from 2-Stage FCFF Reverse DCF
  const impliedGrowth = (inputImpliedGrowthRate !== undefined && inputImpliedGrowthRate !== null)
    ? parseFloat(String(inputImpliedGrowthRate).replace(/[^0-9.]/g, ''))
    : scorecard.expectationsLayer.marketImpliedCagr;

  const expectationGap = (inputExpectationGap !== undefined && inputExpectationGap !== null)
    ? inputExpectationGap
    : parseFloat((expectedCagr - impliedGrowth).toFixed(1));

  const stressTestedEvidenceGrowth = parseFloat((expectedCagr * 0.80).toFixed(1));
  const stressTestedExpectationGap = parseFloat((stressTestedEvidenceGrowth - impliedGrowth).toFixed(1));

  let thesisRobustness = 'MODERATE';
  if (stressTestedExpectationGap >= 10.0) thesisRobustness = 'HIGHLY_RESILIENT';
  else if (stressTestedExpectationGap >= 5.0) thesisRobustness = 'RESILIENT';
  else if (stressTestedExpectationGap >= 0.0) thesisRobustness = 'SENSITIVE';
  else thesisRobustness = 'VULNERABLE';

  // Three-pillar ROCE regime classification for backward compatibility
  const revGrowth = financialEvidence.revenueGrowthYoY || 0;
  const roce = parseFloat(financialEvidence.roce) || 15.0;
  const debtEquity = cashFlowEvidence.debtToEquity || 0.0;
  let roceRegimeClassification = 'CYCLICAL_UNPROVEN';
  if (roce >= 22.0 && revGrowth >= 20.0 && debtEquity <= 0.20) {
    roceRegimeClassification = 'CONFIRMED_STRUCTURAL';
  } else if (roce >= 16.0 && debtEquity <= 0.40) {
    roceRegimeClassification = 'STABLE_EXPANDING';
  } else {
    roceRegimeClassification = 'CYCLICAL_CAPITAL_INTENSIVE';
  }

  // Dynamic Valuation State
  let valuationState = inputValuationState;
  if (!valuationState && currentPE) {
    if (currentPE < 20.0) valuationState = 'ATTRACTIVE';
    else if (currentPE <= 35.0) valuationState = 'REASONABLE';
    else if (currentPE <= 60.0) valuationState = 'FULL';
    else valuationState = 'EXTREME';
  } else if (!valuationState) {
    valuationState = 'REASONABLE';
  }

  // -------------------------------------------------------------------------
  // 3. Layer 6: STRICT DETERMINISTIC DECISION STATE MACHINE (Zero Contradictions)
  // -------------------------------------------------------------------------
  let opportunityTier = MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE;
  let strategicActionNarrative = "";
  let finalScore = 50.0;

  const isSolvencyFailure = scorecard.debtHealth.isFailure;
  const isThesisBroken = (thesisHealth === 'BROKEN' || thesisHealth === 'WEAKENING' || capitalAction === 'SYSTEMATIC_EXIT');
  const isExtremeValuation = (valuationState === 'EXTREME' || (currentPE > 60.0 && expectationGap < 0));

  // Gate 1: Solvency Failure or Value Destruction
  if (isSolvencyFailure) {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP;
    finalScore = 0.0;
    strategicActionNarrative = `STRUCTURAL VALUE TRAP: ${scorecard.debtHealth.narrative} Zero capital allocation.`;
  }
  // Gate 2: Broken Thesis
  else if (isThesisBroken) {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP;
    finalScore = 0.0;
    strategicActionNarrative = "STRUCTURAL VALUE TRAP: Business model, margin structure, or cash conversion is broken/weakening. Systematic exit.";
  }
  // Gate 3: Extreme Valuation / Bubble Multiples
  else if (isExtremeValuation && (thesisHealth === 'STRENGTHENING' || thesisHealth === 'INTACT')) {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.OVERVALUED_COMPOUNDER;
    finalScore = 45.0;
    strategicActionNarrative = `OVERVALUED COMPOUNDER: Superb business execution, but market multiple (${currentPE}x) has priced in multi-year perfection. Capital protection trim recommended (Trim above ₹${scorecard.trimAbovePrice}).`;
  }
  // Gate 4: Operational Observation / Watchlist Friction
  else if (
    thesisHealth === 'UNDER_PRESSURE' ||
    evidenceSufficiency === 'INSUFFICIENT' ||
    capitalAction === 'PAUSE_ADDITIONS' ||
    capitalAction === 'HOLD_ACTIVE_WATCH'
  ) {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.WATCHLIST_FRICTION;
    finalScore = 35.0;
    strategicActionNarrative = "WATCHLIST FRICTION: Operational or reporting friction under observation. Pause incremental capital until resolution.";
  }
  // Gate 5: Under Revalidation (Transrail case: separates Valuation Conviction from Investability)
  else if (scorecard.economicEngineState === ECONOMIC_ENGINE_STATE.UNDER_REVALIDATION) {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE;
    finalScore = 65.0;
    strategicActionNarrative = `COMPOUNDING AT FAIR PRICE (UNDER REVALIDATION): Valuation Conviction is DEEP_DISLOCATION (${scorecard.asymmetryRatio}:1, MoS ${scorecard.marginOfSafetyPct}%), but Economic Conviction is LOW due to recent working capital/cash friction. Action: MONITOR (Do not accumulate until WC normalizes).`;
  }
  // Gate 6: Top Conviction Dislocation (ACCUMULATE)
  // Triggered when Price is in Buy Below zone OR strict mathematical hurdles (>= 3:1 Asym, >= 25% MoS, >= 20% 3Y IRR) are satisfied
  else if (
    (currentPrice <= scorecard.buyBelowPrice || (scorecard.asymmetryRatio >= 3.0 && scorecard.marginOfSafetyPct >= 25.0 && scorecard.projected3YrIrr >= 20.0)) &&
    (scorecard.economicEngineState === ECONOMIC_ENGINE_STATE.PROVEN || scorecard.economicEngineState === ECONOMIC_ENGINE_STATE.EMERGING) &&
    (thesisHealth === 'STRENGTHENING' || thesisHealth === 'INTACT') &&
    scorecard.evidenceRecency !== EVIDENCE_RECENCY.STALE
  ) {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION;
    finalScore = 95.0;
    strategicActionNarrative = `TOP CONVICTION DISLOCATION (ACCUMULATE): Multi-layer dislocation verified. Price (₹${currentPrice}) is in Buy Below zone (<= ₹${scorecard.buyBelowPrice}) with ${scorecard.asymmetryRatio}:1 Asymmetry, ${scorecard.marginOfSafetyPct}% MoS, and +${scorecard.projected3YrIrr}% 3Y IRR. Prime capital deployment.`;
  }
  // Gate 7: Compounding at Fair Price (Core Hold)
  else {
    opportunityTier = MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE;
    finalScore = 75.0;
    strategicActionNarrative = `COMPOUNDING AT FAIR PRICE: Healthy business compounding steadily with balanced risk-reward (Fair Value ₹${scorecard.fairValuePrice}, Bear Floor ₹${scorecard.bearFloorPrice}). Core holding.`;
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
      fcffConversionGap: scorecard.fcffConversionGapPct,
      fcffConversionDrag: scorecard.fcffConversionDragPct,
      underwrittenNopatCagr: scorecard.underwrittenNopatCagr,
      underwrittenFcffCagr: scorecard.underwrittenFcffCagr,
      reinvestmentRatePct: scorecard.reinvestmentRatePct,
      modeledFcffConversionPct: scorecard.modeledFcffConversionPct,
      fcffConversionStatus: scorecard.fcffConversionStatus,
      marketImpliedFcffCagr: scorecard.marketImpliedFcffCagr,
      expectedCagr,
      impliedGrowth,
      expectationsRegime: scorecard.expectationsRegime,
      benchmark7Yr5xCagrPct: 25.85,
      stressTestedEvidenceGrowth,
      stressTestedExpectationGap,
      thesisRobustness,
      roceRegimeClassification,
      roce: parseFloat(financialEvidence.roce) || 20.0,
      cfoPatRatio: cashFlowEvidence.cfoPatRatio !== undefined ? cashFlowEvidence.cfoPatRatio : 0.85,
      receivableDays: cashFlowEvidence.receivableDays || 75,
      debtToEquity: cashFlowEvidence.debtToEquity || 0.0
    },
    thesisIqScorecard: scorecard,
    hedgeFundScorecard: calculateHedgeFundScorecard(auditedEquity),
    strategicActionNarrative
  };
}

/**
 * Ranks an entire coverage universe by ThesisIQ v3.1 opportunity tier and mispricing score.
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

  return evaluated.map((item, idx) => ({
    universeRank: idx + 1,
    ...item
  }));
}
