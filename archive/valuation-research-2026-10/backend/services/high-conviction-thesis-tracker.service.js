/**
 * Institutional High-Conviction Investment Underwriting & Longitudinal Thesis Tracking Engine
 * 
 * Core Architectural Hierarchy:
 * 1. Pre-Market Research & Underwriting (T0):
 *    - "Why We Own This" Master Dossier.
 *    - Strict Separation: Business Thesis Assumptions (A1...An) vs Valuation Assumptions (V1...Vm).
 *    - Initial Conviction Score (0 - 10) permanently preserved.
 *    - Explicit Thesis Falsification Criteria (Add / Pause / Trim / Exit).
 * 
 * 2. Triangulated Quarterly Evidence Audit across 5 Orthogonal Causal Buckets:
 *    - BUCKET 1: DEMAND (Orders, backlog, client contracts)
 *    - BUCKET 2: EXECUTION (Capacity commissioning, volume, product mix conversion)
 *    - BUCKET 3: ECONOMICS (EBITDA margins, operating leverage, ROCE)
 *    - BUCKET 4: CASH (CFO/PAT conversion, receivable days, debt)
 *    - BUCKET 5: MANAGEMENT (Milestone delivery, guidance reliability vs divergence)
 * 
 * 3. Two-Dimensional Decoupled Decision State:
 *    - Thesis Health (STRENGTHENING / INTACT / UNDER_PRESSURE / BROKEN) -> Driven ONLY by Business Assumptions + Triangulation
 *    - Valuation State (ATTRACTIVE / REASONABLE / FULL / EXTREME) -> Driven ONLY by Valuation Assumptions + Market Asymmetry
 *    - Evidence Sufficiency (SUFFICIENT / PARTIAL / INSUFFICIENT) -> Guards against UNKNOWN data silently becoming INTACT.
 * 
 * 4. Itemized Evidence-Weighted Conviction Evolution:
 *    - Pure Blind Inference: Zero pre-classified status strings or conclusion booleans (isDelivered, isDelayed, isDivergent).
 *    - Factual Management Triangulation: Evaluates promised deadlines vs actual delivery dates & metric values.
 *    - Mandatory requiredEvidence & Observability on BOTH Business and Valuation Assumptions.
 *    - Constrained Temporary Setback Eligibility (DEMAND and ECONOMICS only).
 *    - Single Canonical Source of Truth for Valuation Thresholds.
 */

export const THESIS_HEALTH = {
  STRENGTHENING: 'STRENGTHENING',
  INTACT: 'INTACT',
  UNDER_PRESSURE: 'UNDER_PRESSURE',
  BROKEN: 'BROKEN'
};

export const VALUATION_STATE = {
  ATTRACTIVE: 'ATTRACTIVE',     // Significant Expectation Asymmetry (E_gap >= +10%)
  REASONABLE: 'REASONABLE',     // Fairly priced (0% <= E_gap < +10%)
  FULL: 'FULL',                 // Modest multiple stretch (-30% <= E_gap < 0%)
  EXTREME: 'EXTREME'            // Severe multiple bubble (P/E > 80x or E_gap < -30%)
};

export const EVIDENCE_SUFFICIENCY = {
  SUFFICIENT: 'SUFFICIENT',     // All critical evidence observable
  PARTIAL: 'PARTIAL',           // Some evidence observable
  INSUFFICIENT: 'INSUFFICIENT'  // Missing critical data; prevents false INTACT states
};

export const CAPITAL_ACTION = {
  ACCUMULATE_CONVICTION: 'ACCUMULATE_CONVICTION', // Thesis Strengthening + Valuation Attractive/Reasonable + Evidence Sufficient
  CORE_HOLD: 'CORE_HOLD',                         // Thesis Intact + Valuation Attractive/Reasonable/Full + Evidence Sufficient
  PAUSE_ADDITIONS: 'PAUSE_ADDITIONS',             // Thesis Under Pressure OR Evidence Insufficient
  PRUDENT_TRIM: 'PRUDENT_TRIM',                   // Thesis Intact/Strengthening BUT Valuation Extreme (Valuation Bubble)
  SYSTEMATIC_EXIT: 'SYSTEMATIC_EXIT'              // Thesis Broken or Structural Falsification Criteria Met
};

export const CAUSAL_BUCKETS = {
  DEMAND: 'DEMAND',
  EXECUTION: 'EXECUTION',
  ECONOMICS: 'ECONOMICS',
  CASH: 'CASH',
  MANAGEMENT: 'MANAGEMENT'
};

export const VALUATION_THRESHOLDS = {
  EXTREME_PE_HARD_CEILING: 80.0,        // Absolute bubble ceiling (P/E > 80x -> EXTREME)
  EXTREME_EGAP_THRESHOLD: -30.0,       // Severe negative expectation gap (E_gap < -30% -> EXTREME)
  FULL_EGAP_MIN: -30.0,                // Full valuation range (-30% <= E_gap < 0%)
  FULL_EGAP_MAX: 0.0,
  REASONABLE_EGAP_MIN: 0.0,            // Reasonable valuation range (0% <= E_gap < +10%)
  REASONABLE_EGAP_MAX: 10.0,
  ATTRACTIVE_EGAP_THRESHOLD: 10.0,     // Attractive valuation range (E_gap >= +10%)
  PE_STRETCH_MULTIPLIER: 1.20          // Multiple exceeding peCeiling by >20% -> STRAINING
};

/**
 * Evidence Impact Weights — v2.2 (Institutional Governance Calibrated)
 * Strictly enforces 1 contribution per orthogonal causal bucket. Zero milestone double-counting.
 */
export const EVIDENCE_IMPACT_WEIGHTS_V1 = {
  CONFIRMED_CAUSAL_BUCKET: 0.05,        // Reward per unique orthogonal causal bucket confirmed (Max 5 buckets = +0.25)
  STRAINING_CAUSAL_BUCKET: -0.25,       // Penalty per unique orthogonal causal bucket straining
  BROKEN_CAUSAL_BUCKET: -0.90,          // Penalty per unique orthogonal causal bucket broken
  STRUCTURAL_FALSIFICATION: -1.00       // Confirmation of structural de-growth or severe cash conversion collapse
};

/**
 * Parses quarter string or date string to comparable numeric chronological key.
 * E.g., "2024-08-14" -> 2024.62, "Q1_FY25" / "Q1_2025" -> 2024.25
 */
export function normalizeDateKey(dateStr) {
  if (!dateStr) return 0;
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) || 1;
    const day = parseInt(parts[2], 10) || 1;
    return year + (month - 1) / 12 + day / 365;
  }
  const qMatch = dateStr.match(/Q([1-4])_FY?(\d{2,4})/i);
  if (qMatch) {
    const q = parseInt(qMatch[1], 10);
    let yr = parseInt(qMatch[2], 10);
    if (yr < 100) yr += 2000;
    // Indian FY: Q1 FY25 = Apr-Jun 2024 -> 2024.25
    return (yr - 1) + (q - 1) * 0.25;
  }
  if (dateStr.includes('FY') || dateStr.includes('ANNUAL')) {
    const yrMatch = dateStr.match(/(\d{4})/);
    if (yrMatch) return parseInt(yrMatch[1], 10);
  }
  return 0;
}

/**
 * Automated Rule-Based Evidence to Assumption Inference Engine.
 * 
 * Strict Invariants:
 * 1. ZERO Pre-Classified Status or Booleans: Evaluates strictly from raw metrics.
 * 2. Mandatory requiredEvidence: If requiredEvidence is absent or empty, returns status: 'UNKNOWN'.
 * 3. Safe Epistemic Fallback: Missing evidence NEVER defaults to CONFIRMED.
 * 4. Banned Arbitrary Code: Only declarative metric contracts evaluated.
 */
export function inferAssumptionStatus(assumption, context) {
  const { financials = {}, cashFlow = {}, management = [], valuation = {} } = context;

  // 1. Mandatory Evidence Observability Contract Check
  const requiredEvidence = assumption.requiredEvidence || [];
  if (requiredEvidence.length === 0) {
    return {
      id: assumption.id,
      text: assumption.text,
      bucket: assumption.bucket || CAUSAL_BUCKETS.EXECUTION,
      requiredEvidence: [],
      observedEvidence: [],
      coverage: 0.0,
      status: 'UNKNOWN',
      empiricalEvidence: 'Assumption failed observability contract: No requiredEvidence declared.'
    };
  }

  const observedEvidence = [];
  for (const reqKey of requiredEvidence) {
    if (financials[reqKey] !== undefined && financials[reqKey] !== null) {
      observedEvidence.push({ key: reqKey, value: financials[reqKey], source: 'financials' });
    } else if (cashFlow[reqKey] !== undefined && cashFlow[reqKey] !== null) {
      observedEvidence.push({ key: reqKey, value: cashFlow[reqKey], source: 'cashFlow' });
    } else if (valuation[reqKey] !== undefined && valuation[reqKey] !== null) {
      observedEvidence.push({ key: reqKey, value: valuation[reqKey], source: 'valuation' });
    } else if (reqKey === 'managementCommitments' && management.length > 0) {
      observedEvidence.push({ key: reqKey, count: management.length, source: 'management' });
    }
  }

  const coverage = observedEvidence.length / requiredEvidence.length;

  if (coverage < 1.0) {
    return {
      id: assumption.id,
      text: assumption.text,
      bucket: assumption.bucket || CAUSAL_BUCKETS.EXECUTION,
      requiredEvidence,
      observedEvidence: observedEvidence.map(o => o.key),
      coverage,
      status: 'UNKNOWN',
      empiricalEvidence: `Incomplete evidence coverage (${observedEvidence.length}/${requiredEvidence.length} metrics observed: missing ${requiredEvidence.filter(k => !observedEvidence.some(o => o.key === k)).join(', ')}).`
    };
  }

  // 2. Assumption-Specific Metric Target (Declarative binding)
  if (assumption.metricKey) {
    const rawVal = financials[assumption.metricKey] ?? cashFlow[assumption.metricKey] ?? valuation[assumption.metricKey];
    if (rawVal !== undefined && rawVal !== null) {
      if (assumption.minThreshold !== undefined) {
        if (rawVal < (assumption.breakThreshold ?? (assumption.minThreshold < 0 ? assumption.minThreshold * 1.5 : assumption.minThreshold * 0.5))) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: [assumption.metricKey], coverage: 1.0, status: 'BROKEN', empiricalEvidence: `${assumption.metricKey} (${rawVal}) severely breached break threshold (${assumption.breakThreshold ?? (assumption.minThreshold < 0 ? assumption.minThreshold * 1.5 : assumption.minThreshold * 0.5)}).` };
        }
        if (rawVal < assumption.minThreshold) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: [assumption.metricKey], coverage: 1.0, status: 'STRAINING', empiricalEvidence: `${assumption.metricKey} (${rawVal}) below target (${assumption.minThreshold}).` };
        }
        return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: [assumption.metricKey], coverage: 1.0, status: 'CONFIRMED', empiricalEvidence: `${assumption.metricKey} (${rawVal}) met target (>= ${assumption.minThreshold}).` };
      }
      if (assumption.maxThreshold !== undefined) {
        if (rawVal > (assumption.breakThreshold ?? assumption.maxThreshold * 1.5)) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: [assumption.metricKey], coverage: 1.0, status: 'BROKEN', empiricalEvidence: `${assumption.metricKey} (${rawVal}) severely breached ceiling (${assumption.breakThreshold ?? assumption.maxThreshold * 1.5}).` };
        }
        if (rawVal > assumption.maxThreshold) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: [assumption.metricKey], coverage: 1.0, status: 'STRAINING', empiricalEvidence: `${assumption.metricKey} (${rawVal}) above target ceiling (${assumption.maxThreshold}).` };
        }
        return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: [assumption.metricKey], coverage: 1.0, status: 'CONFIRMED', empiricalEvidence: `${assumption.metricKey} (${rawVal}) contained within target (<= ${assumption.maxThreshold}).` };
      }
    }
  }

  // 3. Declarative Causal Bucket Rules
  switch (assumption.bucket) {
    case CAUSAL_BUCKETS.CASH:
      if (cashFlow.cfoPatRatio !== undefined && cashFlow.cfoPatRatio !== null) {
        if (cashFlow.cfoPatRatio < 0.20 && (cashFlow.receivableDays > 150 || (cashFlow.debtToEquity || 0) > 0.7)) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['cfoPatRatio', 'receivableDays'], coverage: 1.0, status: 'BROKEN', empiricalEvidence: `CFO/PAT collapsed to ${cashFlow.cfoPatRatio} with receivables ${cashFlow.receivableDays}d.` };
        }
        if (cashFlow.cfoPatRatio < 0.50 || (cashFlow.receivableDays > 100)) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['cfoPatRatio', 'receivableDays'], coverage: 1.0, status: 'STRAINING', empiricalEvidence: `Working capital friction: CFO/PAT ${cashFlow.cfoPatRatio}, receivables ${cashFlow.receivableDays}d.` };
        }
        return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['cfoPatRatio', 'receivableDays'], coverage: 1.0, status: 'CONFIRMED', empiricalEvidence: `Cash flow healthy: CFO/PAT ${cashFlow.cfoPatRatio}, receivables ${cashFlow.receivableDays}d.` };
      }
      break;

    case CAUSAL_BUCKETS.ECONOMICS:
      if (financials.ebitdaMarginDeltaBps !== undefined && financials.ebitdaMarginDeltaBps !== null) {
        if (financials.ebitdaMarginDeltaBps < -300 || (financials.roce && financials.roce < 10.0)) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['ebitdaMarginDeltaBps', 'roce'], coverage: 1.0, status: 'BROKEN', empiricalEvidence: `Severe margin collapse: EBITDA delta ${financials.ebitdaMarginDeltaBps} bps, ROCE ${financials.roce}%.` };
        }
        if (financials.ebitdaMarginDeltaBps < -50) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['ebitdaMarginDeltaBps', 'roce'], coverage: 1.0, status: 'STRAINING', empiricalEvidence: `Margin contraction of ${financials.ebitdaMarginDeltaBps} bps.` };
        }
        return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['ebitdaMarginDeltaBps', 'roce'], coverage: 1.0, status: 'CONFIRMED', empiricalEvidence: `Operating economics strong: EBITDA delta ${financials.ebitdaMarginDeltaBps >= 0 ? '+' : ''}${financials.ebitdaMarginDeltaBps} bps, ROCE ${financials.roce}%.` };
      }
      break;

    case CAUSAL_BUCKETS.DEMAND:
      if (financials.revenueGrowthYoY !== undefined && financials.revenueGrowthYoY !== null) {
        if (financials.revenueGrowthYoY < -15.0) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['revenueGrowthYoY'], coverage: 1.0, status: 'BROKEN', empiricalEvidence: `Structural revenue de-growth: ${financials.revenueGrowthYoY}% YoY.` };
        }
        if (financials.revenueGrowthYoY < 8.0) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['revenueGrowthYoY'], coverage: 1.0, status: 'STRAINING', empiricalEvidence: `Revenue growth decelerated to ${financials.revenueGrowthYoY}% YoY.` };
        }
        return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['revenueGrowthYoY'], coverage: 1.0, status: 'CONFIRMED', empiricalEvidence: `Revenue demand robust: +${financials.revenueGrowthYoY}% YoY.` };
      }
      break;

    case CAUSAL_BUCKETS.MANAGEMENT:
      // Evaluated via pure blind management triangulation
      break;

    default:
      if (financials.patGrowthYoY !== undefined && financials.patGrowthYoY !== null) {
        if (financials.patGrowthYoY < -20.0) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['patGrowthYoY'], coverage: 1.0, status: 'BROKEN', empiricalEvidence: `Severe PAT de-growth: ${financials.patGrowthYoY}% YoY.` };
        }
        if (financials.patGrowthYoY < 5.0) {
          return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['patGrowthYoY'], coverage: 1.0, status: 'STRAINING', empiricalEvidence: `PAT growth subdued at ${financials.patGrowthYoY}% YoY.` };
        }
        return { id: assumption.id, text: assumption.text, bucket: assumption.bucket, requiredEvidence, observedEvidence: ['patGrowthYoY'], coverage: 1.0, status: 'CONFIRMED', empiricalEvidence: `Execution delivering +${financials.patGrowthYoY}% YoY PAT growth.` };
      }
      break;
  }

  // 4. Safe Epistemic Fallback: Missing evidence is UNKNOWN
  return {
    id: assumption.id,
    text: assumption.text,
    bucket: assumption.bucket || CAUSAL_BUCKETS.EXECUTION,
    requiredEvidence,
    observedEvidence: [],
    coverage: 0.0,
    status: 'UNKNOWN',
    empiricalEvidence: 'No observable metric data available for assumption evaluation.'
  };
}

/**
 * Pure Blind Inference for Management Commitments.
 * 
 * Invariants:
 * - ZERO trust in boolean flags (isDelivered, isDelayed, isDivergent, deliveredFlag, delayedFlag, divergenceFlag).
 * - Derives DELIVERED, ON_TRACK, DELAYED, DIVERGENT exclusively from:
 *   1. Statutory / Accounting Contradiction (promised positive cash flow while reported CFO/PAT is negative)
 *   2. Guidance Retraction or severe division de-growth (< -15%)
 *   3. Deadline vs Delivery Date & Actual Metric vs Promised Value.
 */
export function inferManagementCommitmentStatus(commitment, context) {
  const { financials = {}, cashFlow = {}, currentCheckpointDate = '' } = context;

  // 1. Statutory Contradiction Detection (Rhetoric vs Reported Cash Flow / Debt Reality)
  if (commitment.promisedMetric === 'cfoPositive' && (cashFlow.cfoPatRatio !== undefined && cashFlow.cfoPatRatio < 0)) {
    return {
      status: 'DIVERGENT',
      details: `Promised positive cash flow, but reported statutory CFO/PAT was ${cashFlow.cfoPatRatio}.`
    };
  }
  if (commitment.contradictionEvidence) {
    return {
      status: 'DIVERGENT',
      details: commitment.contradictionEvidence
    };
  }

  // 2. Guidance Retraction or Severe Division De-growth (< -15%)
  if (commitment.guidanceRetracted || (commitment.promisedMetric && financials[commitment.promisedMetric] !== undefined && financials[commitment.promisedMetric] < -15.0)) {
    return {
      status: 'DIVERGENT',
      details: commitment.actualDelivery || `Guidance retracted; promised division de-grew ${financials[commitment.promisedMetric]}%.`
    };
  }

  // 3. Factual Delivery & Milestone Completion
  const promisedValue = commitment.promisedValue;
  const actualValue = commitment.actualValue;
  const promisedDeadline = commitment.targetDate || commitment.promisedDeadline;
  const actualDeliveryDate = commitment.actualDeliveryDate || commitment.observedDate;

  const currentKey = normalizeDateKey(currentCheckpointDate);
  const deadlineKey = normalizeDateKey(promisedDeadline);
  const deliveryKey = normalizeDateKey(actualDeliveryDate);

  // If actual metric value is reported and meets/exceeds promised value
  if (promisedValue !== undefined && actualValue !== undefined) {
    if (typeof actualValue === 'number' && typeof promisedValue === 'number') {
      if (actualValue >= promisedValue) {
        if (deliveryKey && deadlineKey && deliveryKey > deadlineKey) {
          return { status: 'DELAYED', details: `Met value target (${actualValue} >= ${promisedValue}) but completed after deadline (${actualDeliveryDate} > ${promisedDeadline}).` };
        }
        return { status: 'DELIVERED', details: `Value target delivered on schedule (${actualValue} >= ${promisedValue}).` };
      } else {
        if (deadlineKey && currentKey && currentKey >= deadlineKey) {
          return { status: 'DELAYED', details: `Target missed at deadline (${actualValue} < ${promisedValue} at ${promisedDeadline}).` };
        }
        return { status: 'ON_TRACK', details: `Progressing toward target (${actualValue} / ${promisedValue}).` };
      }
    }
  }

  // If actual delivery event is documented with delivery date
  if (actualDeliveryDate) {
    if (deadlineKey && deliveryKey && deliveryKey > deadlineKey) {
      return { status: 'DELAYED', details: commitment.actualDelivery || `Completed late: delivered ${actualDeliveryDate} vs target ${promisedDeadline}.` };
    }
    return { status: 'DELIVERED', details: commitment.actualDelivery || `Delivered on schedule on ${actualDeliveryDate}.` };
  }

  // If deadline has passed as of current checkpoint date without completed delivery
  if (deadlineKey && currentKey && currentKey >= deadlineKey) {
    return { status: 'DELAYED', details: commitment.actualDelivery || `Milestone incomplete at deadline ${promisedDeadline} (Current checkpoint: ${currentCheckpointDate}).` };
  }

  // Default: Future milestone progressing on track
  return {
    status: 'ON_TRACK',
    details: commitment.actualDelivery || `Milestone on track toward target date ${promisedDeadline || 'declared schedule'}.`
  };
}

/**
 * Evaluates Valuation Assumptions independently with mandatory Evidence Observability.
 * 
 * Strict Invariants:
 * - Missing required valuation evidence strictly returns UNKNOWN (never defaulting to CONFIRMED).
 * - Canonical threshold bounds enforced.
 */
export function inferValuationStatus(valuationAssumption, valuationContext) {
  const { currentPE, expectationGap, peCeiling = 50.0 } = valuationContext;

  // 1. Valuation Observability Contract Check
  const requiredEvidence = valuationAssumption.requiredEvidence || [];
  const observedEvidence = [];

  if (requiredEvidence.includes('currentPE') && currentPE !== undefined && currentPE !== null) {
    observedEvidence.push('currentPE');
  }
  if (requiredEvidence.includes('expectationGap') && expectationGap !== undefined && expectationGap !== null) {
    observedEvidence.push('expectationGap');
  }

  const coverage = requiredEvidence.length > 0 ? (observedEvidence.length / requiredEvidence.length) : (currentPE !== undefined || expectationGap !== undefined ? 1.0 : 0.0);

  if (coverage < 1.0) {
    return {
      id: valuationAssumption.id,
      text: valuationAssumption.text,
      requiredEvidence,
      observedEvidence,
      coverage,
      status: 'UNKNOWN',
      empiricalEvidence: `Incomplete valuation evidence (${observedEvidence.length}/${requiredEvidence.length || 1} metrics observed: missing ${requiredEvidence.filter(k => !observedEvidence.includes(k)).join(', ') || 'PE / ExpectationGap'}).`
    };
  }

  // 2. Bubble & Extreme Multiple Breach
  if ((currentPE && currentPE > VALUATION_THRESHOLDS.EXTREME_PE_HARD_CEILING) || (expectationGap !== undefined && expectationGap !== null && expectationGap < VALUATION_THRESHOLDS.EXTREME_EGAP_THRESHOLD)) {
    return {
      id: valuationAssumption.id,
      text: valuationAssumption.text,
      requiredEvidence,
      observedEvidence,
      coverage: 1.0,
      status: 'BROKEN',
      empiricalEvidence: `Valuation multiple reached bubble level (P/E ${currentPE || 'N/A'}x vs ceiling ${VALUATION_THRESHOLDS.EXTREME_PE_HARD_CEILING}x, E_gap ${expectationGap || 0}% vs limit ${VALUATION_THRESHOLDS.EXTREME_EGAP_THRESHOLD}%).`
    };
  }

  // 3. Stretched Multiple Breach
  if (currentPE && currentPE > peCeiling * VALUATION_THRESHOLDS.PE_STRETCH_MULTIPLIER) {
    return {
      id: valuationAssumption.id,
      text: valuationAssumption.text,
      requiredEvidence,
      observedEvidence,
      coverage: 1.0,
      status: 'STRAINING',
      empiricalEvidence: `Valuation multiple stretched (P/E ${currentPE}x exceeding targeted ceiling ${peCeiling}x by >20%).`
    };
  }

  return {
    id: valuationAssumption.id,
    text: valuationAssumption.text,
    requiredEvidence,
    observedEvidence,
    coverage: 1.0,
    status: 'CONFIRMED',
    empiricalEvidence: `Valuation within acceptable tolerance (P/E ${currentPE || 'N/A'}x, E_gap ${expectationGap || 0}%).`
  };
}

/**
 * Underwrites an Institutional High-Conviction Investment Dossier at T0.
 */
export function underwriteInstitutionalThesis(params) {
  const {
    ticker,
    companyName,
    sector,
    businessMoat,
    secularRunway,
    managementPillar,
    marketExpectation,
    impliedGrowthRate,
    expectedGrowthTrajectory,
    roce,
    cfoPatTarget = 0.8,
    receivableDaysTarget = 75,
    businessAssumptions = [],     // Strictly business & operational hypotheses (A1 - An)
    valuationAssumptions = [],    // Strictly valuation & market expectations hypotheses (V1 - Vm)
    whatMakesUsAdd = "All core operating assumptions confirmed for 2+ consecutive quarters with valuation attractive.",
    whatMakesUsPause = "One major business assumption straining or working capital cycle elongating beyond target.",
    whatMakesUsTrim = "Business thesis intact/strengthening but stock multiple becomes detached from realistic medium-term growth (P/E > 80x).",
    thesisFalsificationCriteria = "Two or more critical business assumptions broken, structural CFO collapse, or overseas subsidiary de-growth confirmed."
  } = params;

  // Pillar 1: Business Quality & Moat (0-10)
  let moatScore = 7.5;
  if (roce && roce >= 22.0) moatScore += 1.5;
  else if (roce && roce >= 15.0) moatScore += 0.5;
  if (businessMoat?.toLowerCase().includes('monopoly') || businessMoat?.toLowerCase().includes('market leader') || businessMoat?.toLowerCase().includes('exclusive')) {
    moatScore += 1.0;
  }
  moatScore = Math.min(10.0, parseFloat(moatScore.toFixed(1)));

  // Pillar 2: Secular Runway & Industry Theme (0-10)
  let runwayScore = 8.5;
  if (secularRunway?.toLowerCase().includes('infrastructure') || secularRunway?.toLowerCase().includes('data center') || secularRunway?.toLowerCase().includes('defense') || secularRunway?.toLowerCase().includes('cryogenic') || secularRunway?.toLowerCase().includes('cdmo')) {
    runwayScore = 9.5;
  }

  // Pillar 3: Earnings Trajectory & Operating Leverage (0-10)
  let trajectoryScore = 8.0;
  if (expectedGrowthTrajectory?.toLowerCase().includes('25%') || expectedGrowthTrajectory?.toLowerCase().includes('30%')) {
    trajectoryScore = 9.5;
  }

  // Pillar 4: Management Execution & Capital Allocation (0-10)
  let mgmtScore = managementPillar?.credibilityScore || 8.5;

  // Pillar 5: Expectation Asymmetry (0-10)
  let asymmetryScore = 8.0;
  const expGap = params.expectationGap;
  if (expGap !== null && expGap !== undefined) {
    if (expGap >= VALUATION_THRESHOLDS.ATTRACTIVE_EGAP_THRESHOLD) asymmetryScore = 9.5;
    else if (expGap >= VALUATION_THRESHOLDS.REASONABLE_EGAP_MIN) asymmetryScore = 7.5;
    else if (expGap >= VALUATION_THRESHOLDS.FULL_EGAP_MIN) asymmetryScore = 6.0;
    else asymmetryScore = 4.0;
  }

  const initialConviction = parseFloat((
    (moatScore * 0.25) +
    (runwayScore * 0.20) +
    (trajectoryScore * 0.20) +
    (mgmtScore * 0.20) +
    (asymmetryScore * 0.15)
  ).toFixed(1));

  return {
    ticker,
    companyName,
    sector,
    initialConviction,
    currentConviction: initialConviction,
    convictionHistory: [{ date: params.underwritingDate || 'T0', score: initialConviction, reason: 'Initial Fundamental Underwriting' }],
    pillars: {
      businessMoat: moatScore,
      secularRunway: runwayScore,
      earningsTrajectory: trajectoryScore,
      managementExecution: mgmtScore,
      expectationAsymmetry: asymmetryScore
    },
    thesisCore: {
      businessMoat,
      secularRunway,
      expectedGrowthTrajectory,
      marketExpectation,
      impliedGrowthRate
    },
    targets: {
      roceTarget: roce,
      cfoPatTarget,
      receivableDaysTarget
    },
    businessAssumptions,
    valuationAssumptions,
    governanceRules: {
      whatMakesUsAdd,
      whatMakesUsPause,
      whatMakesUsTrim,
      thesisFalsificationCriteria
    }
  };
}

/**
 * Conducts a Comprehensive Triangulated Quarterly Thesis Audit.
 * Updates longitudinal conviction state continuously using itemized evidence weights across 5 orthogonal causal buckets.
 */
export function auditQuarterlyThesis(params) {
  const {
    underwriting,
    quarter,
    checkpointDate,
    currentPrice,
    expectationGap,
    currentPE,
    peCeiling = 50.0,
    whatChangedSummary = [],
    financialEvidence = {},
    cashFlowEvidence = {},
    managementCommitments = []
  } = params;

  const previousConviction = underwriting.currentConviction !== undefined ? underwriting.currentConviction : underwriting.initialConviction;

  // -------------------------------------------------------------------------
  // 1. Management Triangulation (Pure Blind Factual Inference)
  // -------------------------------------------------------------------------
  let deliveredMgmtCount = 0;
  let onTrackMgmtCount = 0;
  let delayedMgmtCount = 0;
  let divergentMgmtCount = 0;

  const mgmtContext = { financials: financialEvidence, cashFlow: cashFlowEvidence, currentCheckpointDate: checkpointDate };
  const mgmtResults = managementCommitments.map(m => {
    const inferred = inferManagementCommitmentStatus(m, mgmtContext);
    if (inferred.status === 'DELIVERED') deliveredMgmtCount++;
    else if (inferred.status === 'ON_TRACK') onTrackMgmtCount++;
    else if (inferred.status === 'DELAYED') delayedMgmtCount++;
    else if (inferred.status === 'DIVERGENT') divergentMgmtCount++;
    return {
      commitment: m.commitmentText,
      status: inferred.status,
      details: inferred.details
    };
  });

  // -------------------------------------------------------------------------
  // 2. Business Assumption Health (Pure Blind Automated Inference)
  // -------------------------------------------------------------------------
  const context = {
    financials: financialEvidence,
    cashFlow: cashFlowEvidence,
    management: mgmtResults,
    valuation: { currentPE, expectationGap, peCeiling }
  };

  const businessAssumptionResults = underwriting.businessAssumptions.map(a => {
    return inferAssumptionStatus(a, context);
  });

  // Aggregate by Unique Causal Bucket (Orthogonality Enforcement)
  const confirmedBuckets = new Set();
  const strainingBuckets = new Set();
  const brokenBuckets = new Set();
  let unknownAssumptionsCount = 0;
  let strainingAssumptionsCount = 0;

  for (const a of businessAssumptionResults) {
    if (a.status === 'BROKEN') brokenBuckets.add(a.bucket);
    else if (a.status === 'STRAINING') {
      strainingBuckets.add(a.bucket);
      strainingAssumptionsCount++;
    } else if (a.status === 'CONFIRMED') confirmedBuckets.add(a.bucket);
    else if (a.status === 'UNKNOWN') unknownAssumptionsCount++;
  }

  // Reflect factual management triangulation in MANAGEMENT bucket
  if (divergentMgmtCount > 0) brokenBuckets.add(CAUSAL_BUCKETS.MANAGEMENT);
  else if (delayedMgmtCount > 0) strainingBuckets.add(CAUSAL_BUCKETS.MANAGEMENT);
  else if (deliveredMgmtCount > 0) confirmedBuckets.add(CAUSAL_BUCKETS.MANAGEMENT);

  // Remove bucket overlap: highest severity takes precedence
  for (const b of brokenBuckets) {
    confirmedBuckets.delete(b);
    strainingBuckets.delete(b);
  }
  for (const b of strainingBuckets) {
    confirmedBuckets.delete(b);
  }

  // -------------------------------------------------------------------------
  // 3. Evidence Sufficiency Guardrail (Business + Valuation)
  // -------------------------------------------------------------------------
  const totalAssumptions = underwriting.businessAssumptions.length;
  let evidenceSufficiency = EVIDENCE_SUFFICIENCY.SUFFICIENT;
  const isCriticalDataMissing = Object.keys(financialEvidence).length === 0 || Object.keys(cashFlowEvidence).length === 0;

  if (isCriticalDataMissing || (totalAssumptions > 0 && (unknownAssumptionsCount / totalAssumptions) > 0.5)) {
    evidenceSufficiency = EVIDENCE_SUFFICIENCY.INSUFFICIENT;
  } else if (unknownAssumptionsCount > 0) {
    evidenceSufficiency = EVIDENCE_SUFFICIENCY.PARTIAL;
  }

  // -------------------------------------------------------------------------
  // 4. Valuation Assumption Health (Pure Blind Inference with Observability)
  // -------------------------------------------------------------------------
  let brokenValuationCount = 0;
  let strainingValuationCount = 0;
  let unknownValuationCount = 0;

  const valuationAssumptionResults = underwriting.valuationAssumptions.map(v => {
    const vRes = inferValuationStatus(v, context.valuation);
    if (vRes.status === 'BROKEN') brokenValuationCount++;
    else if (vRes.status === 'STRAINING') strainingValuationCount++;
    else if (vRes.status === 'UNKNOWN') unknownValuationCount++;
    return vRes;
  });

  if (unknownValuationCount > 0 && currentPE === undefined && expectationGap === undefined) {
    evidenceSufficiency = EVIDENCE_SUFFICIENCY.INSUFFICIENT;
  }

  // -------------------------------------------------------------------------
  // 5. Temporary vs Structural Deterioration Constrained Decision Tree
  // -------------------------------------------------------------------------
  const isPristineCashAndBalanceSheet = (cashFlowEvidence.cfoPatRatio >= 0.8 && cashFlowEvidence.receivableDays <= 80 && (cashFlowEvidence.debtToEquity || 0) <= 0.20);
  const isManagementDelivering = (deliveredMgmtCount > 0 && divergentMgmtCount === 0);
  
  // Constrained rule: Setback is temporary ONLY IF there is exactly 1 isolated straining bucket (DEMAND or ECONOMICS),
  // with < 3 straining assumptions, ZERO broken buckets, pristine cash, and management delivering milestones.
  const temporaryEligibleBuckets = new Set([CAUSAL_BUCKETS.DEMAND, CAUSAL_BUCKETS.ECONOMICS]);
  const isIsolatedFriction = (strainingBuckets.size === 1 && brokenBuckets.size === 0 && strainingAssumptionsCount < 3);
  const isTemporaryCyclicalSetback = isIsolatedFriction && Array.from(strainingBuckets).every(b => temporaryEligibleBuckets.has(b)) && isPristineCashAndBalanceSheet && isManagementDelivering;

  // -------------------------------------------------------------------------
  // 6. Dimension 1: THESIS HEALTH (Purely Fundamental, Zero Valuation Bias)
  // -------------------------------------------------------------------------
  let thesisHealth = THESIS_HEALTH.INTACT;
  let thesisVerdict = "";

  const isSevereCashCollapse = (cashFlowEvidence.cfoPatRatio !== null && cashFlowEvidence.cfoPatRatio !== undefined && cashFlowEvidence.cfoPatRatio < 0.2 && cashFlowEvidence.receivableDays > 150);
  const isSevereDemandMarginCollapse = ((financialEvidence.revenueGrowthYoY || 0) < -20.0 && (financialEvidence.ebitdaMarginDeltaBps || 0) < -300);

  if (brokenBuckets.size >= 2 || isSevereCashCollapse || isSevereDemandMarginCollapse || (divergentMgmtCount >= 1 && brokenBuckets.size >= 1)) {
    thesisHealth = THESIS_HEALTH.BROKEN;
    thesisVerdict = "THESIS FALSIFIED: Critical business assumptions broken or severe working capital / subsidiary deterioration confirmed. Compounding thesis invalidated.";
  } else if (evidenceSufficiency === EVIDENCE_SUFFICIENCY.INSUFFICIENT) {
    thesisHealth = THESIS_HEALTH.UNDER_PRESSURE;
    thesisVerdict = "THESIS UNVERIFIED (INSUFFICIENT EVIDENCE): Critical statutory or operating data unobserved. No new capital authorized.";
  } else if (isTemporaryCyclicalSetback) {
    thesisHealth = THESIS_HEALTH.INTACT;
    thesisVerdict = "THESIS INTACT (TEMPORARY CYCLICAL SETBACK): Isolated operational margin/revenue friction during cyclical destocking, but balance sheet, cash conversion (CFO/PAT > 0.8), and management delivery remain pristine.";
  } else if (brokenBuckets.size === 1 || strainingBuckets.size >= 2 || strainingAssumptionsCount >= 3 || (strainingBuckets.size >= 1 && (delayedMgmtCount >= 1 || cashFlowEvidence.receivableDays > 130)) || divergentMgmtCount >= 1 || delayedMgmtCount >= 2) {
    thesisHealth = THESIS_HEALTH.UNDER_PRESSURE;
    thesisVerdict = "THESIS UNDER PRESSURE: Causal buckets straining or milestone delays / cash flow friction detected. Monitor next quarter closely.";
  } else if (confirmedBuckets.size >= 3 && strainingBuckets.size === 0 && ((financialEvidence.revenueGrowthYoY || 0) >= 20.0 || (financialEvidence.ebitdaMarginDeltaBps || 0) > 50)) {
    thesisHealth = THESIS_HEALTH.STRENGTHENING;
    thesisVerdict = "THESIS STRENGTHENING: Fundamental operational execution, operating leverage, and milestone delivery exceeding initial underwriting trajectory across multiple orthogonal buckets.";
  } else {
    thesisHealth = THESIS_HEALTH.INTACT;
    thesisVerdict = "THESIS INTACT: Business compounding steadily in line with multi-year underwriting milestones.";
  }

  // -------------------------------------------------------------------------
  // 7. Dimension 2: VALUATION STATE (Canonical Threshold Enforcement)
  // -------------------------------------------------------------------------
  let valuationState = VALUATION_STATE.REASONABLE;
  if (brokenValuationCount > 0 || (currentPE && currentPE > VALUATION_THRESHOLDS.EXTREME_PE_HARD_CEILING) || (expectationGap !== null && expectationGap !== undefined && expectationGap <= VALUATION_THRESHOLDS.EXTREME_EGAP_THRESHOLD)) {
    valuationState = VALUATION_STATE.EXTREME;
  } else if (strainingValuationCount > 0 || (expectationGap !== null && expectationGap !== undefined && expectationGap < VALUATION_THRESHOLDS.FULL_EGAP_MAX)) {
    valuationState = VALUATION_STATE.FULL;
  } else if (expectationGap !== null && expectationGap !== undefined && expectationGap >= VALUATION_THRESHOLDS.ATTRACTIVE_EGAP_THRESHOLD) {
    valuationState = VALUATION_STATE.ATTRACTIVE;
  }

  // -------------------------------------------------------------------------
  // 8. Synthesize Capital Action (Derived from Thesis Health + Valuation + Evidence)
  // -------------------------------------------------------------------------
  let capitalAction = CAPITAL_ACTION.CORE_HOLD;
  let capitalDecisionNarrative = "";

  if (thesisHealth === THESIS_HEALTH.BROKEN) {
    capitalAction = CAPITAL_ACTION.SYSTEMATIC_EXIT;
    capitalDecisionNarrative = "SYSTEMATIC EXIT: Capital protection executed due to confirmed thesis falsification.";
  } else if (evidenceSufficiency === EVIDENCE_SUFFICIENCY.INSUFFICIENT) {
    capitalAction = CAPITAL_ACTION.PAUSE_ADDITIONS;
    capitalDecisionNarrative = "PAUSE ADDITIONS: Critical financial/cash data unobserved. Retain existing core position but pause all additions until statutory filings are verified.";
  } else if (valuationState === VALUATION_STATE.EXTREME && (thesisHealth === THESIS_HEALTH.INTACT || thesisHealth === THESIS_HEALTH.STRENGTHENING)) {
    capitalAction = CAPITAL_ACTION.PRUDENT_TRIM;
    capitalDecisionNarrative = "PRUDENT TRIM: The business thesis is outstanding and execution is strong, but the market multiple is detached from realistic medium-term CAGR. Lock in multibagger gains to protect capital.";
  } else if (thesisHealth === THESIS_HEALTH.UNDER_PRESSURE) {
    capitalAction = CAPITAL_ACTION.PAUSE_ADDITIONS;
    capitalDecisionNarrative = "PAUSE ADDITIONS: Maintain core position but pause incremental capital until straining business assumption or execution delay is resolved.";
  } else if (thesisHealth === THESIS_HEALTH.STRENGTHENING && (valuationState === VALUATION_STATE.ATTRACTIVE || valuationState === VALUATION_STATE.REASONABLE)) {
    capitalAction = CAPITAL_ACTION.ACCUMULATE_CONVICTION;
    capitalDecisionNarrative = "ACCUMULATE CONVICTION: Operating leverage and execution expanding while valuation offers strong margin of safety.";
  } else {
    capitalAction = CAPITAL_ACTION.CORE_HOLD;
    capitalDecisionNarrative = "CORE HOLD: Steady multi-year compounding on track; maintain position.";
  }

  // -------------------------------------------------------------------------
  // 9. Itemized Evidence-Weighted Conviction Accounting with Bucket Orthogonality
  // -------------------------------------------------------------------------
  let rawDelta = 0;
  const deltaBreakdown = [];

  // Positive drivers: 1 reward per unique orthogonal confirmed bucket (No milestone double-counting)
  if (confirmedBuckets.size >= 2) {
    const boost = parseFloat((confirmedBuckets.size * EVIDENCE_IMPACT_WEIGHTS_V1.CONFIRMED_CAUSAL_BUCKET).toFixed(2));
    rawDelta += boost;
    deltaBreakdown.push(`+${boost.toFixed(2)}: ${confirmedBuckets.size} unique orthogonal causal buckets confirmed (${Array.from(confirmedBuckets).join(', ')})`);
  }

  // Negative drivers: 1 penalty per unique orthogonal straining / broken bucket
  if (strainingBuckets.size > 0 && !isTemporaryCyclicalSetback) {
    const penalty = parseFloat((strainingBuckets.size * Math.abs(EVIDENCE_IMPACT_WEIGHTS_V1.STRAINING_CAUSAL_BUCKET)).toFixed(2));
    rawDelta -= penalty;
    deltaBreakdown.push(`-${penalty.toFixed(2)}: ${strainingBuckets.size} causal bucket(s) straining (${Array.from(strainingBuckets).join(', ')})`);
  }

  if (brokenBuckets.size > 0) {
    const penalty = parseFloat((brokenBuckets.size * Math.abs(EVIDENCE_IMPACT_WEIGHTS_V1.BROKEN_CAUSAL_BUCKET)).toFixed(2));
    rawDelta -= penalty;
    deltaBreakdown.push(`-${penalty.toFixed(2)}: ${brokenBuckets.size} critical causal bucket(s) broken (${Array.from(brokenBuckets).join(', ')})`);
  }

  if (thesisHealth === THESIS_HEALTH.BROKEN) {
    rawDelta += EVIDENCE_IMPACT_WEIGHTS_V1.STRUCTURAL_FALSIFICATION;
    deltaBreakdown.push(`${EVIDENCE_IMPACT_WEIGHTS_V1.STRUCTURAL_FALSIFICATION.toFixed(2)}: Structural thesis falsification confirmed`);
  }

  // Asymptotic Compression above 9.0 to prevent casual 10/10 saturation
  let effectiveDelta = rawDelta;
  if (rawDelta > 0 && previousConviction >= 9.0) {
    const headroom = 10.0 - previousConviction;
    effectiveDelta = parseFloat((rawDelta * (headroom / 2.0)).toFixed(2));
  }

  const currentConviction = Math.max(1.0, Math.min(10.0, parseFloat((previousConviction + effectiveDelta).toFixed(1))));
  const totalChangeFromT0 = parseFloat((currentConviction - underwriting.initialConviction).toFixed(1));

  // Update underwriting object's longitudinal state
  underwriting.currentConviction = currentConviction;
  underwriting.convictionHistory.push({
    quarter,
    date: checkpointDate,
    previousScore: previousConviction,
    newScore: currentConviction,
    effectiveDelta,
    deltaBreakdown
  });

  return {
    ticker: underwriting.ticker,
    companyName: underwriting.companyName,
    quarter,
    checkpointDate,
    price: currentPrice,
    initialConviction: underwriting.initialConviction,
    previousConviction,
    currentConviction,
    convictionDelta: parseFloat(effectiveDelta.toFixed(2)),
    totalChangeFromT0,
    deltaBreakdown,
    thesisHealth,
    evidenceSufficiency,
    valuationState,
    capitalAction,
    capitalDecisionNarrative,
    thesisVerdict,
    whatChanged: whatChangedSummary,
    triangulation: {
      financialsStatus: (financialEvidence.revenueGrowthYoY || 0) >= 18 ? '🟢 STRONG' : ((financialEvidence.revenueGrowthYoY || 0) >= 10 ? '🟡 MODERATE' : '🔴 WEAK'),
      cashFlowStatus: ((cashFlowEvidence.cfoPatRatio || 0) >= 0.7 && (cashFlowEvidence.receivableDays || 0) <= 85) ? '🟢 CLEAN' : '🔴 DIVERGENT',
      managementStatus: divergentMgmtCount === 0 ? (delayedMgmtCount === 0 ? '🟢 DELIVERING' : '🟡 DELAYED_MILESTONES') : '🔴 DIVERGENT_CLAIMS'
    },
    evidenceLedger: {
      causalBucketsConfirmed: Array.from(confirmedBuckets),
      causalBucketsStraining: Array.from(strainingBuckets),
      causalBucketsBroken: Array.from(brokenBuckets),
      unknownAssumptionsCount,
      unknownValuationCount
    },
    businessAssumptionAudit: businessAssumptionResults,
    valuationAssumptionAudit: valuationAssumptionResults,
    managementAudit: mgmtResults
  };
}
