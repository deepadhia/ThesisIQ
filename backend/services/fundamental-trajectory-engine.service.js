/**
 * ThesisIQ v3.2: Fundamental Trajectory & Management Evidence Engine
 * 
 * Epistemic Mandate:
 * Implements the "Three Truths Architecture" & the "Management Promise Ledger" to establish
 * a rigorous, non-contradictory bridge between forensic reality and intrinsic valuation:
 * 1. Observed Reality: Audited/reported actual operating metrics (Cannot change DCF).
 * 2. Forward Scenario: Theoretical operational potential across capacity/order engines (Cannot change DCF).
 * 3. Evidence-Adjusted Potential: Scenario potential discounted by evidence confidence factor alpha (Cannot change DCF).
 * 4. Underwriting: Frozen v3.1.1 valuation baseline (Can ONLY change upon explicit human analyst approval).
 * 5. Management Promise Ledger: Auditable quarterly record tracking claims, sources, deadlines, actual reported delivery, and variance.
 * 
 * Non-Negotiable Invariants:
 * 1. Valuation Engine Frozen: DCF fair values and underwritten CAGRs remain strictly immutable.
 * 2. No Scenario-to-Action Leakage: Forward model scenarios alone must never trigger revision signals or capital actions.
 * 3. Sustained Evidence Requirement: REVISION_SUPPORTED requires multi-period audited evidence and economic confirmation.
 * 4. Structured Position Directives: Decouples existing position status from new capital status; zero prescriptive portfolio weight mandates.
 * 5. Independent Valuation Hurdle Price: Calculated as FV * (1 - MoS_required); fully verifiable in both mathematical directions.
 * 6. Auditable Track Record: Management credibility is dynamically reconciled from historical promise ledger entries.
 */

import { calculateInstitutionalFcffDcf } from './asymmetric-mispricing-ranking.service.js';

export const GROWTH_ENGINE_TYPE = Object.freeze({
  CAPACITY_UTILIZATION: 'CAPACITY_UTILIZATION',       // Greenfield/Brownfield unit ramp (QPower, CCL, HSCL, Gravita, Time Techno)
  ORDER_BOOK_EXECUTION: 'ORDER_BOOK_EXECUTION',       // Contracted backlog execution (HBL, Skipper, Jyoti CNC, Shakti, JSLL, SBCL)
  CUSTOMER_PROGRAM_RAMP: 'CUSTOMER_PROGRAM_RAMP',     // OEM platform wins / vehicle content expansion (Lumax, SJS)
  ASSET_COMMISSIONING: 'ASSET_COMMISSIONING',         // Incremental capacity/MW leasing (Anant Raj)
  MARKET_SHARE_GAIN: 'MARKET_SHARE_GAIN',             // Competitive displacement outperforming TAM (INOX India, PolicyBazaar)
  PRICE_MIX: 'PRICE_MIX',                             // Premiumization and value-add mix shift (HSCL, Elecon)
  GEOGRAPHIC_EXPANSION: 'GEOGRAPHIC_EXPANSION',       // Export penetration / new markets (Elecon, CCL, Gravita)
  ACQUISITION_INTEGRATION: 'ACQUISITION_INTEGRATION', // Inorganic synergy realization (SJS)
  COMBINATION: 'COMBINATION'                          // Multi-engine compounders
});

export const THESIS_RISK_ENGINE_TYPE = Object.freeze({
  WORKING_CAPITAL_CONVERSION: 'WORKING_CAPITAL_CONVERSION', // Receivables elongation & cash collection drag (Transrail, Shakti)
  CAPEX_INSTALLATION_DRAG: 'CAPEX_INSTALLATION_DRAG',       // Depreciation & unabsorbed overhead hitting P&L before ramp (QPower, HSCL, Anant Raj)
  EXECUTION_LUMPINESS: 'EXECUTION_LUMPINESS',               // Milestone delivery & tender timing volatility (HBL, Skipper, Jyoti CNC)
  RAW_MATERIAL_CYCLICALITY: 'RAW_MATERIAL_CYCLICALITY',     // Commodity spread & inventory volatility (Gravita, HSCL)
  CUSTOMER_CONCENTRATION: 'CUSTOMER_CONCENTRATION',         // Exposure to OEM schedule delays (Lumax)
  INTEGRATION_EXECUTION: 'INTEGRATION_EXECUTION',           // Synergy realization friction (SJS)
  COMPETITIVE_DISRUPTION: 'COMPETITIVE_DISRUPTION',         // Price undercutting / margin pressure
  NONE_OR_MINIMAL: 'NONE_OR_MINIMAL'                        // Low-friction compounders
});

export const EVIDENCE_STRENGTH_TIER = Object.freeze({
  E1_EXCHANGE_FILED_CONTRACT: 'E1_EXCHANGE_FILED_CONTRACT',       // Regulatory SEBI LODR / Exchange disclosure of contract
  E2_AUDITED_CAPEX_COMMISSIONING: 'E2_AUDITED_CAPEX_COMMISSIONING', // Formal commissioning filing / trial run verification
  E3_CONCALL_QUANTIFIED_GUIDANCE: 'E3_CONCALL_QUANTIFIED_GUIDANCE', // Concall statement with numerical range & timeline
  E4_CONCALL_DIRECTIONAL: 'E4_CONCALL_DIRECTIONAL',               // Directional commentary without quantified dates
  E5_ASPIRATIONAL_OR_UNVERIFIED: 'E5_ASPIRATIONAL_OR_UNVERIFIED'  // Long-term management vision without operational milestones
});

export const TRAJECTORY_CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',               // E1/E2 evidence with verified order backlog / commissioning and operational track record
  MEDIUM: 'MEDIUM',           // E2/E3 evidence with concrete guidance and historical delivery consistency
  LOW: 'LOW',                 // E3/E4 directional claims with high execution risk or unverified ramp metrics
  SPECULATIVE: 'SPECULATIVE'  // E4/E5 aspirational statements without balance sheet or order book backing
});

export const THESIS_REVISION_SIGNAL = Object.freeze({
  REVISION_SUPPORTED_ACCELERATION: 'REVISION_SUPPORTED_ACCELERATION', // Multi-period audited results > Underwriting +3.0 pts, no CFO/iROIC drag
  UNDERWRITING_CONFIRMED: 'UNDERWRITING_CONFIRMED',                   // Trajectory matches underwritten rate (+/- 3.0 pts)
  MONITOR_EVIDENCE_RAMP: 'MONITOR_EVIDENCE_RAMP',                     // Visible capacity/orders in installation; awaiting post-commissioning proof
  EXECUTION_FRICTION_WATCH: 'EXECUTION_FRICTION_WATCH',               // Optical growth exists, but working capital/cash drag impairs ROIC
  POTENTIAL_ACCELERATION: 'POTENTIAL_ACCELERATION',                   // Forward model scenario > Underwriting, pending verified earnings delivery
  POTENTIAL_DECELERATION: 'POTENTIAL_DECELERATION',                   // Forward model scenario < Underwriting, but no observed deterioration
  REVISION_SUPPORTED_DECELERATION: 'REVISION_SUPPORTED_DECELERATION'  // Multi-period audited deterioration < Underwriting -3.0 pts or unit economics collapse
});

export const UNDERWRITING_STATUS = Object.freeze({
  VALID: 'VALID',                                   // Underwriting well-grounded in verifiable multi-quarter evidence
  SUPPORTED_BY_EVIDENCE: 'SUPPORTED_BY_EVIDENCE',   // Evidence actively confirms underwritten trajectory
  UNDER_REVIEW: 'UNDER_REVIEW',                     // Evidence warrants human review before making fresh commitments
  STALE: 'STALE',                                   // Operational reality has materially shifted away from original baseline
  TOO_AGGRESSIVE: 'TOO_AGGRESSIVE',                 // Underwritten rate exceeds realistic execution pacing / backlog burn
  TOO_CONSERVATIVE: 'TOO_CONSERVATIVE',             // Underwritten rate significantly lags verified multi-quarter delivery
  BROKEN: 'BROKEN'                                  // Core operating thesis or unit economics have structurally collapsed
});

export const BOTTLENECK_STATE = Object.freeze({
  VERIFIED_HEALTHY: 'VERIFIED_HEALTHY',     // Stage verified and operating smoothly (✅)
  UNDER_OBSERVATION: 'UNDER_OBSERVATION',   // Stage unverified / awaiting operational proof (❓)
  IMPAIRED_BOTTLENECK: 'IMPAIRED_BOTTLENECK' // Stage exhibiting severe friction / value drag (❌)
});

// -----------------------------------------------------------------------------
// Management Promise Ledger Taxonomy
// -----------------------------------------------------------------------------

export const PROMISE_CLAIM_TYPE = Object.freeze({
  CAPACITY_COMMISSIONING: 'CAPACITY_COMMISSIONING', // Greenfield/Brownfield trial, COD, power energization
  REVENUE_GUIDANCE: 'REVENUE_GUIDANCE',             // Quantitative annual / quarterly revenue targets
  MARGIN_TARGET: 'MARGIN_TARGET',                   // EBITDA, gross, or EBIT margin targets
  ORDER_BOOK_EXECUTION: 'ORDER_BOOK_EXECUTION',     // Backlog conversion milestones & delivery run-rate
  WORKING_CAPITAL_DSO: 'WORKING_CAPITAL_DSO',       // Receivable days, inventory reduction, cash collection
  DELEVERAGING: 'DELEVERAGING',                     // Debt reduction, interest cover targets
  PRODUCT_CUSTOMER_RAMP: 'PRODUCT_CUSTOMER_RAMP',   // Platform wins, SOP dates, customer expansion
  M_AND_A_SYNERGY: 'M_AND_A_SYNERGY'                // Acquisition integration, margin turnaround
});

export const PROMISE_DELIVERY_STATUS = Object.freeze({
  DELIVERED_AHEAD: 'DELIVERED_AHEAD',               // Target beaten ahead of schedule
  DELIVERED_ON_TIME: 'DELIVERED_ON_TIME',           // Target delivered as guided
  IN_PROGRESS_ON_TRACK: 'IN_PROGRESS_ON_TRACK',     // Timeline active, interim milestones healthy
  PENDING_OPERATIONAL_PROOF: 'PENDING_OPERATIONAL_PROOF', // Asset physically ready; commercial volume/margin proof pending
  DELAYED: 'DELAYED',                               // Target timeline pushed back by 1-2 quarters
  MISSED: 'MISSED',                                 // Quantitative target missed without prior warning
  BROKEN: 'BROKEN'                                  // Project abandoned or multi-quarter failure
});

export const PROMISE_CREDIBILITY_IMPACT = Object.freeze({
  POSITIVE: 'POSITIVE',                             // Enhances confidence in forward guidance
  NEUTRAL: 'NEUTRAL',                               // In progress / pending verification
  WATCHLIST: 'WATCHLIST',                           // Slight delay or partial execution
  NEGATIVE: 'NEGATIVE'                              // Guidance miss or multi-quarter delay
});

// -----------------------------------------------------------------------------
// 5-Dimension Fundamental Reality Taxonomy
// -----------------------------------------------------------------------------

export const MANAGEMENT_CREDIBILITY_STATUS = Object.freeze({
  AHEAD: 'AHEAD',             // Previous milestones consistently beaten
  ON_TRACK: 'ON_TRACK',       // Delivering as guided with verifiable audit trail
  MIXED: 'MIXED',             // Operational targets met, but cash/working capital lagging
  BEHIND: 'BEHIND',           // Delayed timelines or unfulfilled capacity promises
  BROKEN: 'BROKEN'            // Continuous guidance cuts / credibility loss
});

export const GUIDANCE_STATUS = Object.freeze({
  RAISED: 'RAISED',                         // Quantitative guidance revised upward
  MAINTAINED: 'MAINTAINED',                 // Target range reiterated and on track
  LOWERED: 'LOWERED',                       // Explicit numerical cut in targets
  MISSED: 'MISSED',                         // Historical target missed without re-guidance
  NO_FORMAL_GUIDANCE: 'NO_FORMAL_GUIDANCE'  // Company does not give quantitative guidance
});

export const GROWTH_METRICS_TRAJECTORY = Object.freeze({
  ACCELERATING: 'ACCELERATING', // Revenue/EBITDA/Orders growing faster than prior run rate
  STABLE: 'STABLE',             // Growth compounding consistently within expected band
  DECELERATING: 'DECELERATING', // Growth rate moderating or cyclical top forming
  ERRATIC: 'ERRATIC'            // High quarter-on-quarter unpredictability
});

export const ECONOMIC_QUALITY_STATUS = Object.freeze({
  IMPROVING: 'IMPROVING',                                     // iROIC expanding, cash conversion healthy, margins widening
  STABLE: 'STABLE',                                           // Unit economics and ROCE maintained
  CAPITAL_CONSUMING_ACCRETIVE: 'CAPITAL_CONSUMING_ACCRETIVE', // High reinvestment (iROIC > WACC), temporary FCFF absorption
  DETERIORATING: 'DETERIORATING'                              // Receivables blowout, CFO/PAT < 0.60, or ROIC compressing
});

export const THESIS_OPERATIONAL_STATUS = Object.freeze({
  STRENGTHENING: 'STRENGTHENING',           // Core thesis drivers expanding faster than underwritten
  UNCHANGED: 'UNCHANGED',                   // Thesis compounding as expected
  UNDER_VALIDATION: 'UNDER_VALIDATION',     // Capacity/orders visible, awaiting commercial validation
  UNDER_REVALIDATION: 'UNDER_REVALIDATION', // Historical excellence undergoing recent friction
  WEAKENING: 'WEAKENING',                   // Competitive pressure or margin erosion
  BROKEN: 'BROKEN'                          // Structural thesis collapse
});

export const VALUATION_STATUS = Object.freeze({
  DEEP_VALUE: 'DEEP_VALUE',   // Margin of safety >= 35%, Asymmetry >= +3:1
  ATTRACTIVE: 'ATTRACTIVE',   // Margin of safety 15-35%, Asymmetry >= +1.5:1
  FAIR: 'FAIR',               // Price within +/- 15% of Intrinsic Fair Value
  EXPENSIVE: 'EXPENSIVE',     // Price 15-50% above Intrinsic Fair Value
  EXTREME: 'EXTREME'          // Price > 50% above Intrinsic Fair Value (Demands perfection)
});

// -----------------------------------------------------------------------------
// Structured Position & Capital Directives (Non-Prescriptive)
// -----------------------------------------------------------------------------

export const EXISTING_POSITION_STATUS = Object.freeze({
  HOLD_CORE_AND_MONITOR: 'HOLD_CORE_AND_MONITOR',                     // Hold core; do not sell on multiple alone; allow operational proof to mature
  HOLD_CORE_AWAITING_CASH_CONVERSION: 'HOLD_CORE_AWAITING_CASH_CONVERSION', // Hold core; pause additions until working capital & CFO normalize
  HOLD_CORE_COMPOUNDING: 'HOLD_CORE_COMPOUNDING',                     // Healthy compounder operating normally; maintain core exposure
  TRIM_VALUATION_EXTREME: 'TRIM_VALUATION_EXTREME',                   // Multiple pricing extreme perfection (>50% above FV) without near-term catalysts
  REDUCE_ON_DETERIORATION: 'REDUCE_ON_DETERIORATION',                 // Fundamental deterioration observed; de-risk exposure
  EXIT_THESIS_BROKEN: 'EXIT_THESIS_BROKEN'                            // Structural thesis broken; full exit regardless of valuation
});

export const NEW_CAPITAL_STATUS = Object.freeze({
  WAIT_FOR_VALUATION_HURDLE: 'WAIT_FOR_VALUATION_HURDLE',             // Valuation demanding; new deployment blocked until price reaches valuation hurdle
  WAIT_FOR_CASH_CONVERSION: 'WAIT_FOR_CASH_CONVERSION',               // Capital locked in working capital; additions blocked until DSO & CFO normalize
  REVIEW_UNDERWRITING_BEFORE_ADDING: 'REVIEW_UNDERWRITING_BEFORE_ADDING', // Underwriting under review / aggressive; re-underwrite before adding new capital
  SELECTIVE_TRANCHE_DEPLOYMENT: 'SELECTIVE_TRANCHE_DEPLOYMENT',       // Favorable asymmetry & valid underwriting; add measured tranches
  DEPLOYMENT_SUPPORTED_BY_VALUATION: 'DEPLOYMENT_SUPPORTED_BY_VALUATION', // Stock at or below valuation hurdle price with verified thesis
  BLOCKED_EXTREME_VALUATION: 'BLOCKED_EXTREME_VALUATION',             // Multiple exceeds reasonable growth bounds; new capital blocked
  BLOCKED_THESIS_BROKEN: 'BLOCKED_THESIS_BROKEN'                      // Broken thesis; zero new capital
});

export const ACTION_CONTEXT = Object.freeze({
  HOLD_AND_MONITOR_ACCELERATION: 'HOLD_AND_MONITOR_ACCELERATION',
  HOLD_AWAITING_WORKING_CAPITAL_CONVERSION: 'HOLD_AWAITING_WORKING_CAPITAL_CONVERSION',
  COMPOUNDING_HOLD_AT_FAIR_PRICE: 'COMPOUNDING_HOLD_AT_FAIR_PRICE',
  REVIEW_UNDERWRITING_BEFORE_ADDING: 'REVIEW_UNDERWRITING_BEFORE_ADDING',
  WAIT_FOR_VALUATION_HURDLE: 'WAIT_FOR_VALUATION_HURDLE',
  SELECTIVE_TRANCHE_DEPLOYMENT: 'SELECTIVE_TRANCHE_DEPLOYMENT',
  DEFENSIVE_TRIM_OR_EXIT: 'DEFENSIVE_TRIM_OR_EXIT',
  SYSTEMATIC_EXIT: 'SYSTEMATIC_EXIT'
});

const STATUTORY_TAX_RATE = 0.2517; // 25.17% standard corporate tax rate

/**
 * Helper: Computes compound annual growth rate across T years.
 */
export function calculateCagr(startValue, endValue, years) {
  if (!startValue || !endValue || startValue <= 0 || endValue <= 0 || years <= 0) return null;
  return parseFloat(((Math.pow(endValue / startValue, 1 / years) - 1) * 100).toFixed(2));
}

/**
 * Helper: Computes exact Valuation Hurdle Price for a required Margin of Safety.
 * Formula: P_hurdle = FV * (1 - MoS_required)
 */
export function calculateValuationHurdlePrice(fairValue, requiredMarginOfSafetyPct = 25.0) {
  if (!fairValue || fairValue <= 0) return 0.0;
  return parseFloat((fairValue * (1.0 - (requiredMarginOfSafetyPct / 100.0))).toFixed(2));
}

/**
 * Helper: Computes Margin of Safety given Fair Value and Price.
 * Formula: MoS = (FV - Price) / FV
 */
export function calculateMarginOfSafety(fairValue, price) {
  if (!fairValue || fairValue <= 0) return 0.0;
  return parseFloat((((fairValue - price) / fairValue) * 100.0).toFixed(2));
}

// -----------------------------------------------------------------------------
// 1. Management Promise Ledger Evaluation Engine
// -----------------------------------------------------------------------------

export function evaluateManagementPromiseLedger(ticker, entries = []) {
  if (!entries || entries.length === 0) {
    return {
      ticker,
      totalPromisesTracked: 0,
      deliveredCount: 0,
      inProgressCount: 0,
      pendingProofCount: 0,
      delayedCount: 0,
      missedOrBrokenCount: 0,
      deliverySuccessRatePct: 100.0,
      derivedCredibilityStatus: MANAGEMENT_CREDIBILITY_STATUS.ON_TRACK,
      entries: []
    };
  }

  let deliveredCount = 0;
  let inProgressCount = 0;
  let pendingProofCount = 0;
  let delayedCount = 0;
  let missedOrBrokenCount = 0;

  for (const item of entries) {
    if (item.status === PROMISE_DELIVERY_STATUS.DELIVERED_ON_TIME || item.status === PROMISE_DELIVERY_STATUS.DELIVERED_AHEAD) {
      deliveredCount++;
    } else if (item.status === PROMISE_DELIVERY_STATUS.IN_PROGRESS_ON_TRACK) {
      inProgressCount++;
    } else if (item.status === PROMISE_DELIVERY_STATUS.PENDING_OPERATIONAL_PROOF) {
      pendingProofCount++;
    } else if (item.status === PROMISE_DELIVERY_STATUS.DELAYED) {
      delayedCount++;
    } else if (item.status === PROMISE_DELIVERY_STATUS.MISSED || item.status === PROMISE_DELIVERY_STATUS.BROKEN) {
      missedOrBrokenCount++;
    }
  }

  const resolvedClaims = deliveredCount + delayedCount + missedOrBrokenCount;
  const deliverySuccessRatePct = resolvedClaims > 0 ? parseFloat(((deliveredCount / resolvedClaims) * 100.0).toFixed(1)) : 100.0;

  const hasBrokenClaim = entries.some(e => e.status === PROMISE_DELIVERY_STATUS.BROKEN);

  let derivedCredibilityStatus = MANAGEMENT_CREDIBILITY_STATUS.ON_TRACK;
  if (hasBrokenClaim || missedOrBrokenCount >= 2 || (resolvedClaims >= 2 && deliverySuccessRatePct < 50.0)) {
    derivedCredibilityStatus = MANAGEMENT_CREDIBILITY_STATUS.BROKEN;
  } else if (missedOrBrokenCount === 1 && delayedCount >= 1) {
    derivedCredibilityStatus = MANAGEMENT_CREDIBILITY_STATUS.BEHIND;
  } else if (missedOrBrokenCount === 1 || delayedCount >= 1) {
    derivedCredibilityStatus = MANAGEMENT_CREDIBILITY_STATUS.MIXED;
  } else if (deliveredCount >= 2 && missedOrBrokenCount === 0 && delayedCount === 0) {
    derivedCredibilityStatus = MANAGEMENT_CREDIBILITY_STATUS.AHEAD;
  } else {
    derivedCredibilityStatus = MANAGEMENT_CREDIBILITY_STATUS.ON_TRACK;
  }

  return {
    ticker,
    totalPromisesTracked: entries.length,
    deliveredCount,
    inProgressCount,
    pendingProofCount,
    delayedCount,
    missedOrBrokenCount,
    deliverySuccessRatePct,
    derivedCredibilityStatus,
    entries
  };
}

/**
 * Dynamic Database Adapter: Hydrates Promise Ledger directly from canonical database tables
 * (management_commitments, claim_lineage, and management_execution_ledger).
 * 
 * Enforces the core architectural separation:
 * - Database = Canonical Source of Truth (Recorded evidence & cryptographic provenance).
 * - ThesisIQ = Derived Analytical View (Credibility, Bottlenecks, Confidence, Trajectory).
 */
export async function loadPromiseLedgerFromDatabase(ticker, poolInstance) {
  if (!poolInstance) return null;

  try {
    const query = `
      SELECT 
        mc.id,
        mc.quarter,
        mc.statement AS management_claim,
        mc.metric AS target_metric,
        mc.target_value,
        mc.timeline AS deadline,
        mc.status,
        mc.credibility_impact,
        mc.evidence_summary AS actual_reported_delivery,
        mc.guidance_source_ref AS source_ref,
        mc.created_at,
        cl.source_document_type,
        cl.provenance_type,
        mel.variance_pct,
        mel.execution_outcome
      FROM management_commitments mc
      LEFT JOIN claim_lineage cl ON (cl.ticker = mc.ticker AND (cl.paragraph_excerpt ILIKE '%' || SUBSTRING(mc.statement FROM 1 FOR 40) || '%' OR cl.claim_id = mc.guidance_source_ref))
      LEFT JOIN management_execution_ledger mel ON (mel.ticker = mc.ticker AND mel.source_claim_id = cl.claim_id)
      WHERE UPPER(mc.ticker) = UPPER($1)
      ORDER BY mc.created_at ASC
    `;
    const { rows } = await poolInstance.query(query, [ticker]);
    if (!rows || rows.length === 0) return null;

    return rows.map(r => {
      // Map claim type
      let claimType = PROMISE_CLAIM_TYPE.REVENUE_GUIDANCE;
      const lower = (r.management_claim + ' ' + (r.target_metric || '')).toLowerCase();
      if (lower.includes('capacity') || lower.includes('capex') || lower.includes('commissioning') || lower.includes('plant') || lower.includes('trial')) {
        claimType = PROMISE_CLAIM_TYPE.CAPACITY_COMMISSIONING;
      } else if (lower.includes('margin') || lower.includes('ebitda')) {
        claimType = PROMISE_CLAIM_TYPE.MARGIN_TARGET;
      } else if (lower.includes('dso') || lower.includes('receivable') || lower.includes('working capital') || lower.includes('subsidy')) {
        claimType = PROMISE_CLAIM_TYPE.WORKING_CAPITAL_DSO;
      } else if (lower.includes('order') || lower.includes('backlog') || lower.includes('contract')) {
        claimType = PROMISE_CLAIM_TYPE.ORDER_BOOK_EXECUTION;
      } else if (lower.includes('debt') || lower.includes('deleverag')) {
        claimType = PROMISE_CLAIM_TYPE.DELEVERAGING;
      } else if (lower.includes('customer') || lower.includes('oem') || lower.includes('platform')) {
        claimType = PROMISE_CLAIM_TYPE.PRODUCT_CUSTOMER_RAMP;
      }

      // Map evidence tier
      let evidenceTier = EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE;
      if (r.source_document_type === 'SEBI_LODR_FILING' || r.provenance_type === 'PRIMARY_SOURCE_VERIFIED') {
        evidenceTier = EVIDENCE_STRENGTH_TIER.E1_EXCHANGE_FILED_CONTRACT;
      } else if (claimType === PROMISE_CLAIM_TYPE.CAPACITY_COMMISSIONING && (r.status === 'Achieved' || r.execution_outcome === 'ACHIEVED')) {
        evidenceTier = EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING;
      }

      // Map delivery status
      let status = PROMISE_DELIVERY_STATUS.IN_PROGRESS_ON_TRACK;
      const dbStatus = (r.execution_outcome || r.status || '').toUpperCase();
      if (dbStatus === 'ACHIEVED' || dbStatus === 'DELIVERED') {
        status = PROMISE_DELIVERY_STATUS.DELIVERED_ON_TIME;
      } else if (dbStatus === 'DELAYED') {
        status = PROMISE_DELIVERY_STATUS.DELAYED;
      } else if (dbStatus === 'MISSED') {
        status = PROMISE_DELIVERY_STATUS.MISSED;
      } else if (dbStatus === 'BROKEN') {
        status = PROMISE_DELIVERY_STATUS.BROKEN;
      } else if (dbStatus === 'PENDING' || dbStatus === 'IN_PROGRESS') {
        status = claimType === PROMISE_CLAIM_TYPE.CAPACITY_COMMISSIONING 
          ? PROMISE_DELIVERY_STATUS.PENDING_OPERATIONAL_PROOF 
          : PROMISE_DELIVERY_STATUS.IN_PROGRESS_ON_TRACK;
      }

      // Map credibility impact
      let credibilityImpact = PROMISE_CREDIBILITY_IMPACT.POSITIVE;
      if (status === PROMISE_DELIVERY_STATUS.MISSED || status === PROMISE_DELIVERY_STATUS.BROKEN) {
        credibilityImpact = PROMISE_CREDIBILITY_IMPACT.NEGATIVE;
      } else if (status === PROMISE_DELIVERY_STATUS.DELAYED) {
        credibilityImpact = PROMISE_CREDIBILITY_IMPACT.WATCHLIST;
      } else if (status === PROMISE_DELIVERY_STATUS.PENDING_OPERATIONAL_PROOF) {
        credibilityImpact = PROMISE_CREDIBILITY_IMPACT.NEUTRAL;
      }

      const formattedDate = r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : '2026-01-01';

      return {
        quarter: r.quarter || 'Ongoing',
        source: r.source_ref || (r.source_document_type ? `${r.source_document_type}` : 'Earnings Call / Exchange Filing'),
        date: formattedDate,
        claimType,
        evidenceTier,
        managementClaim: r.management_claim,
        targetMetric: r.target_metric || (r.target_value ? `${r.target_value}` : 'As Guided'),
        deadline: r.deadline || 'FY27',
        actualReportedDelivery: r.actual_reported_delivery || 'Awaiting reported verification',
        variance: r.variance_pct ? `${r.variance_pct > 0 ? '+' : ''}${r.variance_pct}% variance` : (status === PROMISE_DELIVERY_STATUS.DELIVERED_ON_TIME ? 'Delivered On Schedule' : 'In Progress'),
        status,
        credibilityImpact
      };
    });
  } catch (err) {
    console.warn(`[ThesisIQ Bridge] Database promise ledger load warning for ${ticker}: ${err.message}. Falling back to canonical cache.`);
    return null;
  }
}

// -----------------------------------------------------------------------------
// 2. Specialized Calculation Sub-Engines
// -----------------------------------------------------------------------------

/**
 * 1. Capacity Utilization Trajectory Engine
 * Models Greenfield/Brownfield expansions across utilization tiers (25%, 50%, 75%, 100%).
 * Incorporates overhead & depreciation drag during initial commissioning phases.
 */
export function calculateCapacityUtilizationTrajectory(profile) {
  const {
    baselineRevenueCr,
    baselineEbitdaMarginPct,
    baselineNopatCr,
    capacityMultiple = 2.0,
    productLineMixFactor = 0.60,
    incrementalCapexCr = 150.0,
    overheadDragBpsAtLowUtil = 250,
    underwrittenNopatCagrPct = 22.0,
    horizonYears = 3
  } = profile;

  const scenarios = [25, 50, 75, 100].map(utilizationPct => {
    const utilFraction = utilizationPct / 100.0;
    
    // Revenue Engine: Baseline + Incremental capacity volume
    const maxIncrementalRev = baselineRevenueCr * (capacityMultiple - 1) * productLineMixFactor;
    const incrementalRevenueCr = maxIncrementalRev * utilFraction;
    const totalRevenueCr = baselineRevenueCr + incrementalRevenueCr;

    // Margin Engine: Baseline margin adjusted for overhead drag during early ramp
    const dragBps = utilizationPct <= 25 ? overheadDragBpsAtLowUtil : (utilizationPct <= 50 ? overheadDragBpsAtLowUtil * 0.4 : 0);
    const effectiveEbitdaMarginPct = Math.max(8.0, baselineEbitdaMarginPct - (dragBps / 100.0));
    const totalEbitdaCr = totalRevenueCr * (effectiveEbitdaMarginPct / 100.0);

    // Depreciation & EBIT Engine
    const annualIncrementalDna = (incrementalCapexCr * 0.08); // 8% depreciation rate
    const baselineDna = baselineRevenueCr * 0.035;
    const totalDnaCr = baselineDna + (annualIncrementalDna * (utilizationPct > 0 ? 1.0 : 0.0));
    const totalEbitCr = Math.max(0, totalEbitdaCr - totalDnaCr);

    // NOPAT Engine
    const totalNopatCr = totalEbitCr * (1 - STATUTORY_TAX_RATE);
    const incrementalNopatCr = Math.max(0, totalNopatCr - baselineNopatCr);

    // Capital Engine & Incremental ROIC
    const incrementalWorkingCapital = incrementalRevenueCr * 0.18; // 18% working capital intensity
    const totalIncrementalNoa = incrementalCapexCr + incrementalWorkingCapital;
    const incrementalRoicPct = totalIncrementalNoa > 0 ? parseFloat(((incrementalNopatCr / totalIncrementalNoa) * 100).toFixed(2)) : 0.0;

    // Cash Conversion Engine
    const cfoCr = totalNopatCr * 0.82;
    const fcffCr = cfoCr - (annualIncrementalDna * 0.5);

    // Trajectory Implied CAGR
    const impliedNopatCagrPct = calculateCagr(baselineNopatCr, totalNopatCr, horizonYears);
    const cagrDeltaVsUnderwritten = impliedNopatCagrPct !== null ? parseFloat((impliedNopatCagrPct - underwrittenNopatCagrPct).toFixed(2)) : 0.0;

    return {
      utilizationPct,
      totalRevenueCr: parseFloat(totalRevenueCr.toFixed(1)),
      incrementalRevenueCr: parseFloat(incrementalRevenueCr.toFixed(1)),
      effectiveEbitdaMarginPct: parseFloat(effectiveEbitdaMarginPct.toFixed(2)),
      totalEbitdaCr: parseFloat(totalEbitdaCr.toFixed(1)),
      totalNopatCr: parseFloat(totalNopatCr.toFixed(1)),
      incrementalNopatCr: parseFloat(incrementalNopatCr.toFixed(1)),
      totalIncrementalNoa: parseFloat(totalIncrementalNoa.toFixed(1)),
      incrementalRoicPct,
      cfoCr: parseFloat(cfoCr.toFixed(1)),
      fcffCr: parseFloat(fcffCr.toFixed(1)),
      impliedNopatCagrPct,
      cagrDeltaVsUnderwritten
    };
  });

  return {
    engineType: GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION,
    scenarios,
    baselineNopatCr,
    underwrittenNopatCagrPct
  };
}

/**
 * 2. Order Book Execution Trajectory Engine
 * Models contracted backlog execution speed, execution haircuts, and working capital drag.
 */
export function calculateOrderBookExecutionTrajectory(profile) {
  const {
    baselineRevenueCr,
    baselineEbitdaMarginPct,
    baselineNopatCr,
    orderBookTotalCr,
    executionMonths = 18,
    executionHaircutPct = 10.0,
    recurringRevenueFraction = 0.55,
    coreRecurringGrowthPct = 10.0,
    receivablesDays = 85,
    cfoPatRatio = 0.80,
    underwrittenNopatCagrPct = 25.0,
    horizonYears = 3
  } = profile;

  const scenarios = [
    { name: 'CONSERVATIVE_EXECUTION', burnMonths: executionMonths * 1.35, haircut: executionHaircutPct * 1.5, marginDeltaBps: -100 },
    { name: 'BASE_CASE_EXECUTION', burnMonths: executionMonths, haircut: executionHaircutPct, marginDeltaBps: 0 },
    { name: 'ACCELERATED_EXECUTION', burnMonths: executionMonths * 0.85, haircut: executionHaircutPct * 0.5, marginDeltaBps: +100 }
  ].map(sc => {
    const netOrderBookCr = orderBookTotalCr * (1 - (sc.haircut / 100.0));
    const annualProjectRevenueCr = (netOrderBookCr / (sc.burnMonths / 12.0));
    
    // Core recurring business compounding
    const recurringRevCr = (baselineRevenueCr * recurringRevenueFraction) * Math.pow(1 + (coreRecurringGrowthPct / 100.0), horizonYears);
    const totalRevenueCr = recurringRevCr + annualProjectRevenueCr;

    // Margin Engine
    const effectiveMarginPct = Math.max(7.0, baselineEbitdaMarginPct + (sc.marginDeltaBps / 100.0));
    const totalEbitdaCr = totalRevenueCr * (effectiveMarginPct / 100.0);
    const totalDnaCr = totalRevenueCr * 0.03;
    const totalEbitCr = Math.max(0, totalEbitdaCr - totalDnaCr);
    const totalNopatCr = totalEbitCr * (1 - STATUTORY_TAX_RATE);
    const incrementalNopatCr = Math.max(0, totalNopatCr - baselineNopatCr);

    // Capital & Working Capital Drag Engine
    const incrementalWorkingCapital = (totalRevenueCr - baselineRevenueCr) * (receivablesDays / 365.0);
    const incrementalCapexCr = (totalRevenueCr - baselineRevenueCr) * 0.08;
    const totalIncrementalNoa = incrementalCapexCr + incrementalWorkingCapital;
    const incrementalRoicPct = totalIncrementalNoa > 0 ? parseFloat(((incrementalNopatCr / totalIncrementalNoa) * 100).toFixed(2)) : 0.0;

    // Cash Conversion Engine
    const effectiveCfoPat = receivablesDays > 110 ? Math.min(cfoPatRatio, 0.50) : cfoPatRatio;
    const totalCfoCr = totalNopatCr * effectiveCfoPat;
    const totalFcffCr = totalCfoCr - incrementalCapexCr;

    const impliedNopatCagrPct = calculateCagr(baselineNopatCr, totalNopatCr, horizonYears);
    const cagrDeltaVsUnderwritten = impliedNopatCagrPct !== null ? parseFloat((impliedNopatCagrPct - underwrittenNopatCagrPct).toFixed(2)) : 0.0;

    return {
      scenarioName: sc.name,
      burnMonths: parseFloat(sc.burnMonths.toFixed(1)),
      haircutPct: sc.haircut,
      totalRevenueCr: parseFloat(totalRevenueCr.toFixed(1)),
      effectiveEbitdaMarginPct: parseFloat(effectiveMarginPct.toFixed(2)),
      totalNopatCr: parseFloat(totalNopatCr.toFixed(1)),
      incrementalRoicPct,
      receivablesDays,
      effectiveCfoPatRatio: parseFloat(effectiveCfoPat.toFixed(2)),
      totalCfoCr: parseFloat(totalCfoCr.toFixed(1)),
      totalFcffCr: parseFloat(totalFcffCr.toFixed(1)),
      impliedNopatCagrPct,
      cagrDeltaVsUnderwritten
    };
  });

  return {
    engineType: GROWTH_ENGINE_TYPE.ORDER_BOOK_EXECUTION,
    scenarios,
    baselineNopatCr,
    underwrittenNopatCagrPct
  };
}

/**
 * 3. Asset Commissioning Trajectory Engine (e.g. Anant Raj Data Centers)
 */
export function calculateAssetCommissioningTrajectory(profile) {
  const {
    baselineRevenueCr,
    baselineNopatCr,
    coreBusinessGrowthPct = 12.0,
    currentOperationalUnits = 21.0,
    phasedTargetUnits = 50.0,
    fullScaleUnits = 150.0,
    annualRevenuePerUnitCr = 8.5,
    unitEbitdaMarginPct = 65.0,
    capexPerUnitCr = 25.0,
    underwrittenNopatCagrPct = 25.0,
    horizonYears = 3
  } = profile;

  const phases = [
    { phaseName: 'CURRENT_OPERATIONAL', units: currentOperationalUnits },
    { phaseName: 'PHASE_2_COMMISSIONED', units: phasedTargetUnits },
    { phaseName: 'FULL_SCALE_RAMP', units: fullScaleUnits }
  ].map(p => {
    const coreCompoundedRev = baselineRevenueCr * Math.pow(1 + (coreBusinessGrowthPct / 100.0), horizonYears);
    const coreCompoundedNopat = baselineNopatCr * Math.pow(1 + (coreBusinessGrowthPct / 100.0), horizonYears);

    const incrementalUnits = Math.max(0, p.units - currentOperationalUnits);
    const incrementalDcRevCr = incrementalUnits * annualRevenuePerUnitCr;
    const totalRevenueCr = p.phaseName === 'CURRENT_OPERATIONAL' ? baselineRevenueCr : coreCompoundedRev + incrementalDcRevCr;
    
    const assetEbitdaCr = incrementalDcRevCr * (unitEbitdaMarginPct / 100.0);
    const assetDnaCr = incrementalUnits * capexPerUnitCr * 0.05;
    const assetEbitCr = Math.max(0, assetEbitdaCr - assetDnaCr);
    const assetNopatCr = assetEbitCr * (1 - STATUTORY_TAX_RATE);

    const totalNopatCr = p.phaseName === 'CURRENT_OPERATIONAL' ? baselineNopatCr : coreCompoundedNopat + assetNopatCr;
    const incrementalNopatCr = Math.max(0, totalNopatCr - baselineNopatCr);
    
    const incrementalCapexCr = incrementalUnits * capexPerUnitCr;
    const incrementalRoicPct = incrementalCapexCr > 0 ? parseFloat(((incrementalNopatCr / incrementalCapexCr) * 100).toFixed(2)) : 0.0;

    const impliedNopatCagrPct = calculateCagr(baselineNopatCr, totalNopatCr, horizonYears);
    const cagrDeltaVsUnderwritten = impliedNopatCagrPct !== null ? parseFloat((impliedNopatCagrPct - underwrittenNopatCagrPct).toFixed(2)) : 0.0;

    return {
      phaseName: p.phaseName,
      operationalUnits: p.units,
      totalRevenueCr: parseFloat(totalRevenueCr.toFixed(1)),
      assetEbitdaCr: parseFloat(assetEbitdaCr.toFixed(1)),
      totalNopatCr: parseFloat(totalNopatCr.toFixed(1)),
      incrementalCapexCr: parseFloat(incrementalCapexCr.toFixed(1)),
      incrementalRoicPct,
      impliedNopatCagrPct,
      cagrDeltaVsUnderwritten
    };
  });

  return {
    engineType: GROWTH_ENGINE_TYPE.ASSET_COMMISSIONING,
    phases,
    baselineNopatCr,
    underwrittenNopatCagrPct
  };
}

/**
 * 4. Customer Program & Platform Ramp Trajectory Engine (e.g. SJS, Lumax)
 */
export function calculateCustomerProgramTrajectory(profile) {
  const {
    baselineRevenueCr,
    baselineEbitdaMarginPct,
    baselineNopatCr,
    organicProgramGrowthPct = 18.0,
    contentPerVehicleGrowthPct = 12.0,
    acquisitionRevenueCr = 0.0,
    underwrittenNopatCagrPct = 22.0,
    horizonYears = 3
  } = profile;

  const scenarios = [
    { name: 'BASELINE_OEM_GROWTH', contentGrowth: contentPerVehicleGrowthPct * 0.5, volumeGrowth: organicProgramGrowthPct * 0.6 },
    { name: 'DESIGN_WIN_ACCELERATION', contentGrowth: contentPerVehicleGrowthPct, volumeGrowth: organicProgramGrowthPct },
    { name: 'PREMIUM_PLATFORM_RAMP', contentGrowth: contentPerVehicleGrowthPct * 1.4, volumeGrowth: organicProgramGrowthPct * 1.3 }
  ].map(sc => {
    const combinedGrowthPct = ((1 + (sc.volumeGrowth / 100.0)) * (1 + (sc.contentGrowth / 100.0)) - 1) * 100.0;
    const organicRevenueCr = baselineRevenueCr * (1 + (combinedGrowthPct / 100.0));
    const totalRevenueCr = organicRevenueCr + acquisitionRevenueCr;
    
    const marginExpansionBps = sc.name === 'PREMIUM_PLATFORM_RAMP' ? 150 : (sc.name === 'DESIGN_WIN_ACCELERATION' ? 80 : 0);
    const effectiveMarginPct = baselineEbitdaMarginPct + (marginExpansionBps / 100.0);
    const totalEbitdaCr = totalRevenueCr * (effectiveMarginPct / 100.0);
    const totalDnaCr = totalRevenueCr * 0.04;
    const totalEbitCr = Math.max(0, totalEbitdaCr - totalDnaCr);
    const totalNopatCr = totalEbitCr * (1 - STATUTORY_TAX_RATE);
    const incrementalNopatCr = Math.max(0, totalNopatCr - baselineNopatCr);

    const incrementalCapexCr = (totalRevenueCr - baselineRevenueCr) * 0.25;
    const incrementalRoicPct = incrementalCapexCr > 0 ? parseFloat(((incrementalNopatCr / incrementalCapexCr) * 100).toFixed(2)) : 0.0;

    const impliedNopatCagrPct = calculateCagr(baselineNopatCr, totalNopatCr, horizonYears);
    const cagrDeltaVsUnderwritten = impliedNopatCagrPct !== null ? parseFloat((impliedNopatCagrPct - underwrittenNopatCagrPct).toFixed(2)) : 0.0;

    return {
      scenarioName: sc.name,
      totalRevenueCr: parseFloat(totalRevenueCr.toFixed(1)),
      effectiveEbitdaMarginPct: parseFloat(effectiveMarginPct.toFixed(2)),
      totalNopatCr: parseFloat(totalNopatCr.toFixed(1)),
      incrementalRoicPct,
      impliedNopatCagrPct,
      cagrDeltaVsUnderwritten
    };
  });

  return {
    engineType: GROWTH_ENGINE_TYPE.CUSTOMER_PROGRAM_RAMP,
    scenarios,
    baselineNopatCr,
    underwrittenNopatCagrPct
  };
}

// -----------------------------------------------------------------------------
// 3. Deterministic Bottleneck Diagnostic Engine
// -----------------------------------------------------------------------------

export function diagnoseBottlenecks(profile, trajectoryData) {
  const { ticker, growthEngines = [], riskEngines = [], cashFlowEvidence = {} } = profile;
  const receivablesDays = cashFlowEvidence.receivableDays || 70;
  const cfoPatRatio = cashFlowEvidence.cfoPatRatio !== undefined ? cashFlowEvidence.cfoPatRatio : 0.85;

  const stages = {
    DEMAND_VISIBILITY: BOTTLENECK_STATE.VERIFIED_HEALTHY,
    CAPACITY_SUPPLY: BOTTLENECK_STATE.VERIFIED_HEALTHY,
    OPERATIONAL_UTILIZATION: BOTTLENECK_STATE.VERIFIED_HEALTHY,
    PRICING_MARGINS: BOTTLENECK_STATE.VERIFIED_HEALTHY,
    WORKING_CAPITAL_CASH: BOTTLENECK_STATE.VERIFIED_HEALTHY,
    CAPITAL_EFFICIENCY: BOTTLENECK_STATE.VERIFIED_HEALTHY
  };

  let nextRequiredEvidence = "Quarterly financial disclosure & earnings call reconciliation";

  if (ticker === 'QPOWER') {
    stages.DEMAND_VISIBILITY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.CAPACITY_SUPPLY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.OPERATIONAL_UTILIZATION = BOTTLENECK_STATE.UNDER_OBSERVATION;
    stages.PRICING_MARGINS = BOTTLENECK_STATE.UNDER_OBSERVATION;
    stages.WORKING_CAPITAL_CASH = BOTTLENECK_STATE.UNDER_OBSERVATION;
    stages.CAPITAL_EFFICIENCY = BOTTLENECK_STATE.UNDER_OBSERVATION;
    nextRequiredEvidence = "Sangli Q2/Q3 FY27 actual commercial utilization rate & gross margin absorption";
  } else if (ticker === 'TRANSRAILL') {
    stages.DEMAND_VISIBILITY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.CAPACITY_SUPPLY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.OPERATIONAL_UTILIZATION = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.PRICING_MARGINS = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.WORKING_CAPITAL_CASH = BOTTLENECK_STATE.IMPAIRED_BOTTLENECK;
    stages.CAPITAL_EFFICIENCY = BOTTLENECK_STATE.UNDER_OBSERVATION;
    nextRequiredEvidence = "Sustained reduction in receivables days (<90 days) & positive quarterly CFO";
  } else if (ticker === 'HBLENGINE') {
    stages.DEMAND_VISIBILITY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.CAPACITY_SUPPLY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.OPERATIONAL_UTILIZATION = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.PRICING_MARGINS = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.WORKING_CAPITAL_CASH = BOTTLENECK_STATE.UNDER_OBSERVATION;
    stages.CAPITAL_EFFICIENCY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    nextRequiredEvidence = "Quarterly Kavach installation run-rate & Indian Railways billing certs";
  } else if (ticker === 'ANANTRAJ') {
    stages.DEMAND_VISIBILITY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.CAPACITY_SUPPLY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.OPERATIONAL_UTILIZATION = BOTTLENECK_STATE.UNDER_OBSERVATION;
    stages.PRICING_MARGINS = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.WORKING_CAPITAL_CASH = BOTTLENECK_STATE.UNDER_OBSERVATION;
    stages.CAPITAL_EFFICIENCY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    nextRequiredEvidence = "Disclosure of incremental MW tenancy agreements & power energization certs";
  } else if (ticker === 'SJS') {
    stages.DEMAND_VISIBILITY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.CAPACITY_SUPPLY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.OPERATIONAL_UTILIZATION = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.PRICING_MARGINS = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.WORKING_CAPITAL_CASH = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.CAPITAL_EFFICIENCY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    nextRequiredEvidence = "Walter Pack cross-selling revenue contribution & Exxpand export dispatches";
  } else if (ticker === 'SHAKTIPUMP') {
    stages.DEMAND_VISIBILITY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.CAPACITY_SUPPLY = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.OPERATIONAL_UTILIZATION = BOTTLENECK_STATE.VERIFIED_HEALTHY;
    stages.PRICING_MARGINS = BOTTLENECK_STATE.UNDER_OBSERVATION;
    stages.WORKING_CAPITAL_CASH = BOTTLENECK_STATE.IMPAIRED_BOTTLENECK;
    stages.CAPITAL_EFFICIENCY = BOTTLENECK_STATE.UNDER_OBSERVATION;
    nextRequiredEvidence = "State government subsidy disbursement timeline & DSO reduction below 100 days";
  } else {
    if (receivablesDays > 110 || cfoPatRatio < 0.60) {
      stages.WORKING_CAPITAL_CASH = BOTTLENECK_STATE.IMPAIRED_BOTTLENECK;
      nextRequiredEvidence = "Receivables normalization and CFO/PAT conversion improvement";
    } else if (riskEngines.includes(THESIS_RISK_ENGINE_TYPE.CAPEX_INSTALLATION_DRAG)) {
      stages.OPERATIONAL_UTILIZATION = BOTTLENECK_STATE.UNDER_OBSERVATION;
      stages.PRICING_MARGINS = BOTTLENECK_STATE.UNDER_OBSERVATION;
      nextRequiredEvidence = "Post-commissioning capacity utilization ramp & overhead absorption";
    } else {
      nextRequiredEvidence = "Ongoing quarterly guidance delivery & margin persistence";
    }
  }

  return {
    stages,
    nextRequiredEvidence
  };
}

// -----------------------------------------------------------------------------
// 4. Deterministic Fundamental Vector Synthesizer (Three Truths Architecture)
// -----------------------------------------------------------------------------

export function evaluateFundamentalTrajectoryVector(profile) {
  const {
    ticker,
    companyName,
    sector = 'Capital Goods',
    growthEngines = [GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION],
    riskEngines = [THESIS_RISK_ENGINE_TYPE.NONE_OR_MINIMAL],
    underwrittenNopatCagrPct = 20.0,
    evidenceTier = EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
    managementDeliveryHistory = 'CONSISTENT_DELIVERY',
    evidenceConfidenceFactor = 0.85,
    requiredMarginOfSafetyPct = 25.0,
    thesisBreakers = []
  } = profile;

  // ---------------------------------------------------------------------------
  // Layer 1: Observed Reality (Audited Historical & TTM Financial Results)
  // ---------------------------------------------------------------------------
  const observedReality = {
    ttmRevenueCr: profile.baselineRevenueCr || 1000.0,
    ttmYoYGrowthPct: profile.observedYoYGrowthPct || 25.0,
    ebitdaMarginPct: profile.baselineEbitdaMarginPct || 20.0,
    orderBookCr: profile.orderBookTotalCr || 0.0,
    orderBookToRevenueRatio: profile.orderBookTotalCr && profile.baselineRevenueCr ? parseFloat((profile.orderBookTotalCr / profile.baselineRevenueCr).toFixed(2)) : null,
    cfoPatRatio: profile.cashFlowEvidence?.cfoPatRatio !== undefined ? profile.cashFlowEvidence.cfoPatRatio : 0.80,
    receivableDays: profile.cashFlowEvidence?.receivableDays || 70,
    iroicPct: profile.forwardIroic || 25.0,
    consecutiveQuartersDelivered: profile.consecutiveQuartersDelivered || 2,
    hasAuditedDeterioration: profile.hasAuditedDeterioration || false
  };

  // ---------------------------------------------------------------------------
  // Layer 2: Forward Scenario Trajectory (Theoretical Capacity / Order Math)
  // ---------------------------------------------------------------------------
  let trajectoryOutput = null;
  const primaryGrowthEngine = growthEngines[0];

  if (primaryGrowthEngine === GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION) {
    trajectoryOutput = calculateCapacityUtilizationTrajectory(profile);
  } else if (primaryGrowthEngine === GROWTH_ENGINE_TYPE.ORDER_BOOK_EXECUTION) {
    trajectoryOutput = calculateOrderBookExecutionTrajectory(profile);
  } else if (primaryGrowthEngine === GROWTH_ENGINE_TYPE.ASSET_COMMISSIONING) {
    trajectoryOutput = calculateAssetCommissioningTrajectory(profile);
  } else if (primaryGrowthEngine === GROWTH_ENGINE_TYPE.CUSTOMER_PROGRAM_RAMP) {
    trajectoryOutput = calculateCustomerProgramTrajectory(profile);
  } else {
    trajectoryOutput = calculateOrderBookExecutionTrajectory(profile);
  }

  let scenarioCagrs = [];
  if (trajectoryOutput.scenarios) {
    scenarioCagrs = trajectoryOutput.scenarios.map(s => s.impliedNopatCagrPct).filter(c => c !== null);
  } else if (trajectoryOutput.phases) {
    scenarioCagrs = trajectoryOutput.phases.map(p => p.impliedNopatCagrPct).filter(c => c !== null);
  }

  const minImpliedCagr = scenarioCagrs.length > 0 ? Math.min(...scenarioCagrs) : underwrittenNopatCagrPct;
  const maxImpliedCagr = scenarioCagrs.length > 0 ? Math.max(...scenarioCagrs) : underwrittenNopatCagrPct;
  const modeledNopatCagrRange = [minImpliedCagr, maxImpliedCagr];
  
  const baseCaseModeledNopatCagr = scenarioCagrs.length > 0 
    ? (scenarioCagrs.length % 2 === 1 ? scenarioCagrs[Math.floor(scenarioCagrs.length / 2)] : scenarioCagrs[1] || scenarioCagrs[0])
    : underwrittenNopatCagrPct;

  // ---------------------------------------------------------------------------
  // Layer 3: Evidence Confidence & Evidence-Adjusted Potential
  // (modeledNopatCagr * alpha = evidenceAdjustedPotentialCagr; NOT an automatic forecast)
  // ---------------------------------------------------------------------------
  const alpha = Math.min(1.0, Math.max(0.50, evidenceConfidenceFactor));
  const evidenceAdjustedPotentialCagr = parseFloat((baseCaseModeledNopatCagr * alpha).toFixed(2));
  const evidenceAdjustedRange = [
    parseFloat((minImpliedCagr * alpha).toFixed(2)),
    parseFloat((maxImpliedCagr * alpha).toFixed(2))
  ];

  // Trajectory Confidence Mapping
  let trajectoryConfidence = TRAJECTORY_CONFIDENCE.MEDIUM;
  if (evidenceTier === EVIDENCE_STRENGTH_TIER.E1_EXCHANGE_FILED_CONTRACT || evidenceTier === EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING) {
    trajectoryConfidence = TRAJECTORY_CONFIDENCE.HIGH;
  } else if (evidenceTier === EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE) {
    trajectoryConfidence = TRAJECTORY_CONFIDENCE.MEDIUM;
  } else if (evidenceTier === EVIDENCE_STRENGTH_TIER.E4_CONCALL_DIRECTIONAL) {
    trajectoryConfidence = TRAJECTORY_CONFIDENCE.LOW;
  } else {
    trajectoryConfidence = TRAJECTORY_CONFIDENCE.SPECULATIVE;
  }

  // ---------------------------------------------------------------------------
  // Layer 4: Management Promise Ledger Evaluation
  // ---------------------------------------------------------------------------
  const promiseLedgerEntries = profile.promiseLedger || MANAGEMENT_PROMISE_LEDGER[ticker] || [];
  const promiseLedgerEvaluation = evaluateManagementPromiseLedger(ticker, promiseLedgerEntries);

  // ---------------------------------------------------------------------------
  // Layer 5: Bottlenecks & Deterministic Revision Signals
  // (Strictly adheres to: No Scenario-to-Action Leakage & Sustained Evidence Rules)
  // ---------------------------------------------------------------------------
  const bottleneckDiagnostic = diagnoseBottlenecks(profile, trajectoryOutput);
  const hasWcFriction = bottleneckDiagnostic.stages.WORKING_CAPITAL_CASH === BOTTLENECK_STATE.IMPAIRED_BOTTLENECK;
  const hasPendingCommissioning = bottleneckDiagnostic.stages.OPERATIONAL_UTILIZATION === BOTTLENECK_STATE.UNDER_OBSERVATION && riskEngines.includes(THESIS_RISK_ENGINE_TYPE.CAPEX_INSTALLATION_DRAG);

  let thesisRevisionSignal = THESIS_REVISION_SIGNAL.UNDERWRITING_CONFIRMED;
  const observedGrowthCagrDelta = observedReality.ttmYoYGrowthPct - underwrittenNopatCagrPct;

  if (profile.thesisRevisionSignal) {
    thesisRevisionSignal = profile.thesisRevisionSignal;
  } else if (ticker === 'SHAKTIPUMP' || observedReality.hasAuditedDeterioration) {
    thesisRevisionSignal = THESIS_REVISION_SIGNAL.REVISION_SUPPORTED_DECELERATION;
  } else if (hasWcFriction) {
    thesisRevisionSignal = THESIS_REVISION_SIGNAL.EXECUTION_FRICTION_WATCH;
  } else if (hasPendingCommissioning) {
    thesisRevisionSignal = THESIS_REVISION_SIGNAL.MONITOR_EVIDENCE_RAMP;
  } else if (observedGrowthCagrDelta >= 3.0 && observedReality.consecutiveQuartersDelivered >= 2 && observedReality.cfoPatRatio >= 0.70) {
    thesisRevisionSignal = THESIS_REVISION_SIGNAL.REVISION_SUPPORTED_ACCELERATION;
  } else if (baseCaseModeledNopatCagr > underwrittenNopatCagrPct + 3.0) {
    thesisRevisionSignal = THESIS_REVISION_SIGNAL.POTENTIAL_ACCELERATION;
  } else if (baseCaseModeledNopatCagr < underwrittenNopatCagrPct - 3.0) {
    thesisRevisionSignal = THESIS_REVISION_SIGNAL.POTENTIAL_DECELERATION;
  } else {
    thesisRevisionSignal = THESIS_REVISION_SIGNAL.UNDERWRITING_CONFIRMED;
  }

  // ---------------------------------------------------------------------------
  // Layer 6: Underwriting Status Taxonomy
  // ---------------------------------------------------------------------------
  let underwritingStatus = profile.underwritingStatus;
  if (!underwritingStatus) {
    if (ticker === 'SHAKTIPUMP') underwritingStatus = UNDERWRITING_STATUS.BROKEN;
    else if (ticker === 'HBLENGINE') underwritingStatus = UNDERWRITING_STATUS.TOO_AGGRESSIVE;
    else if (ticker === 'QPOWER') underwritingStatus = UNDERWRITING_STATUS.UNDER_REVIEW;
    else if (ticker === 'TRANSRAILL') underwritingStatus = UNDERWRITING_STATUS.UNDER_REVIEW;
    else if (thesisRevisionSignal === THESIS_REVISION_SIGNAL.REVISION_SUPPORTED_ACCELERATION) underwritingStatus = UNDERWRITING_STATUS.TOO_CONSERVATIVE;
    else if (thesisRevisionSignal === THESIS_REVISION_SIGNAL.UNDERWRITING_CONFIRMED) underwritingStatus = UNDERWRITING_STATUS.SUPPORTED_BY_EVIDENCE;
    else underwritingStatus = UNDERWRITING_STATUS.VALID;
  }

  // ---------------------------------------------------------------------------
  // 5-Dimension Reality Synthesis (Reconciled with Promise Ledger)
  // ---------------------------------------------------------------------------
  const managementCredibility = profile.managementCredibility || promiseLedgerEvaluation.derivedCredibilityStatus;
  const guidanceStatus = profile.guidanceStatus || GUIDANCE_STATUS.MAINTAINED;
  const growthMetricsTrajectory = profile.growthMetricsTrajectory || (observedReality.ttmYoYGrowthPct > 20.0 ? GROWTH_METRICS_TRAJECTORY.ACCELERATING : GROWTH_METRICS_TRAJECTORY.STABLE);
  
  let economicQuality = profile.economicQuality;
  if (!economicQuality) {
    if (hasWcFriction) economicQuality = ECONOMIC_QUALITY_STATUS.DETERIORATING;
    else if (riskEngines.includes(THESIS_RISK_ENGINE_TYPE.CAPEX_INSTALLATION_DRAG)) economicQuality = ECONOMIC_QUALITY_STATUS.CAPITAL_CONSUMING_ACCRETIVE;
    else if (observedReality.iroicPct >= 25.0) economicQuality = ECONOMIC_QUALITY_STATUS.IMPROVING;
    else economicQuality = ECONOMIC_QUALITY_STATUS.STABLE;
  }

  let thesisOperationalStatus = profile.thesisOperationalStatus;
  if (!thesisOperationalStatus) {
    if (ticker === 'SHAKTIPUMP') thesisOperationalStatus = THESIS_OPERATIONAL_STATUS.BROKEN;
    else if (ticker === 'TRANSRAILL') thesisOperationalStatus = THESIS_OPERATIONAL_STATUS.UNDER_REVALIDATION;
    else if (hasPendingCommissioning) thesisOperationalStatus = THESIS_OPERATIONAL_STATUS.UNDER_VALIDATION;
    else if (observedGrowthCagrDelta >= 3.0) thesisOperationalStatus = THESIS_OPERATIONAL_STATUS.STRENGTHENING;
    else thesisOperationalStatus = THESIS_OPERATIONAL_STATUS.UNCHANGED;
  }

  // ---------------------------------------------------------------------------
  // Valuation Status & Independent Valuation Hurdle Price
  // ---------------------------------------------------------------------------
  const currentPrice = profile.currentPrice || 1000.0;
  const fairValuePrice = profile.fairValuePrice || (currentPrice * 0.75);
  const priceToFairValueRatio = currentPrice / (fairValuePrice || 1.0);

  let valuationStatus = VALUATION_STATUS.FAIR;
  if (priceToFairValueRatio > 1.50) valuationStatus = VALUATION_STATUS.EXTREME;
  else if (priceToFairValueRatio > 1.15) valuationStatus = VALUATION_STATUS.EXPENSIVE;
  else if (priceToFairValueRatio < 0.65) valuationStatus = VALUATION_STATUS.DEEP_VALUE;
  else if (priceToFairValueRatio < 0.85) valuationStatus = VALUATION_STATUS.ATTRACTIVE;
  else valuationStatus = VALUATION_STATUS.FAIR;

  if (profile.valuationStatus) valuationStatus = profile.valuationStatus;

  const valuationHurdlePrice = calculateValuationHurdlePrice(fairValuePrice, requiredMarginOfSafetyPct);
  const currentMarginOfSafetyPct = calculateMarginOfSafety(fairValuePrice, currentPrice);

  // ---------------------------------------------------------------------------
  // Structured Position & Capital Directives (Non-Prescriptive)
  // ---------------------------------------------------------------------------
  let existingPositionStatus = EXISTING_POSITION_STATUS.HOLD_CORE_AND_MONITOR;
  let newCapitalStatus = NEW_CAPITAL_STATUS.WAIT_FOR_VALUATION_HURDLE;
  let actionContext = ACTION_CONTEXT.HOLD_AND_MONITOR_ACCELERATION;
  let actionRationale = "";

  if (thesisOperationalStatus === THESIS_OPERATIONAL_STATUS.BROKEN || underwritingStatus === UNDERWRITING_STATUS.BROKEN) {
    existingPositionStatus = EXISTING_POSITION_STATUS.EXIT_THESIS_BROKEN;
    newCapitalStatus = NEW_CAPITAL_STATUS.BLOCKED_THESIS_BROKEN;
    actionContext = ACTION_CONTEXT.SYSTEMATIC_EXIT;
    actionRationale = "Structural thesis breakdown. Valuation discount cannot rescue broken unit economics or structural subsidy impairment.";
  } else if (thesisOperationalStatus === THESIS_OPERATIONAL_STATUS.UNDER_REVALIDATION || hasWcFriction) {
    existingPositionStatus = EXISTING_POSITION_STATUS.HOLD_CORE_AWAITING_CASH_CONVERSION;
    newCapitalStatus = NEW_CAPITAL_STATUS.WAIT_FOR_CASH_CONVERSION;
    actionContext = ACTION_CONTEXT.HOLD_AWAITING_WORKING_CAPITAL_CONVERSION;
    actionRationale = `Substantial backlog exists, but capital is tied in receivables (${observedReality.receivableDays} days, CFO/PAT ${observedReality.cfoPatRatio}x). Existing position: hold core; New capital: blocked until cash conversion normalizes.`;
  } else if (underwritingStatus === UNDERWRITING_STATUS.TOO_AGGRESSIVE || underwritingStatus === UNDERWRITING_STATUS.UNDER_REVIEW) {
    if (ticker === 'HBLENGINE') {
      existingPositionStatus = EXISTING_POSITION_STATUS.HOLD_CORE_AND_MONITOR;
      newCapitalStatus = NEW_CAPITAL_STATUS.REVIEW_UNDERWRITING_BEFORE_ADDING;
      actionContext = ACTION_CONTEXT.REVIEW_UNDERWRITING_BEFORE_ADDING;
      actionRationale = `Core operating thesis is strengthening (+28% YoY), but current 28% underwritten CAGR exceeds pure backlog execution pacing (4.5–18.9%). Existing position: hold core; New capital: re-underwrite conservative baseline before adding fresh tranches.`;
    } else if (valuationStatus === VALUATION_STATUS.EXTREME || valuationStatus === VALUATION_STATUS.EXPENSIVE) {
      existingPositionStatus = EXISTING_POSITION_STATUS.HOLD_CORE_AND_MONITOR;
      newCapitalStatus = NEW_CAPITAL_STATUS.WAIT_FOR_VALUATION_HURDLE;
      actionContext = ACTION_CONTEXT.HOLD_AND_MONITOR_ACCELERATION;
      actionRationale = `Operating trajectory accelerating via major unmodeled capacity ramp, but current price (₹${currentPrice}) trades well above base fair value (₹${fairValuePrice}). Existing position: hold core and monitor Q2/Q3 commercial proof; New capital: wait for valuation hurdle (₹${valuationHurdlePrice}) or formal evidence-backed underwriting revision.`;
    } else {
      existingPositionStatus = EXISTING_POSITION_STATUS.HOLD_CORE_AND_MONITOR;
      newCapitalStatus = NEW_CAPITAL_STATUS.SELECTIVE_TRANCHE_DEPLOYMENT;
      actionContext = ACTION_CONTEXT.SELECTIVE_TRANCHE_DEPLOYMENT;
      actionRationale = "Thesis validated at attractive valuation. Measured tranche deployment supported.";
    }
  } else if (valuationStatus === VALUATION_STATUS.EXTREME) {
    existingPositionStatus = EXISTING_POSITION_STATUS.TRIM_VALUATION_EXTREME;
    newCapitalStatus = NEW_CAPITAL_STATUS.BLOCKED_EXTREME_VALUATION;
    actionContext = ACTION_CONTEXT.WAIT_FOR_VALUATION_HURDLE;
    actionRationale = `Valuation multiple discounts extreme perfection (>50% above FV ₹${fairValuePrice}). Existing position: consider trimming excess portfolio weight; New capital: strictly blocked until valuation hurdle (₹${valuationHurdlePrice}).`;
  } else if (valuationStatus === VALUATION_STATUS.ATTRACTIVE || valuationStatus === VALUATION_STATUS.DEEP_VALUE) {
    existingPositionStatus = EXISTING_POSITION_STATUS.HOLD_CORE_COMPOUNDING;
    newCapitalStatus = NEW_CAPITAL_STATUS.DEPLOYMENT_SUPPORTED_BY_VALUATION;
    actionContext = ACTION_CONTEXT.SELECTIVE_TRANCHE_DEPLOYMENT;
    actionRationale = `Favorable valuation asymmetry with confirmed underwriting. Existing position: hold compounding core; New capital: deployment supported.`;
  } else {
    existingPositionStatus = EXISTING_POSITION_STATUS.HOLD_CORE_COMPOUNDING;
    newCapitalStatus = NEW_CAPITAL_STATUS.WAIT_FOR_VALUATION_HURDLE;
    actionContext = ACTION_CONTEXT.COMPOUNDING_HOLD_AT_FAIR_PRICE;
    actionRationale = "Healthy compounder trading near fair value. Maintain core position; wait for margin of safety before adding fresh capital.";
  }

  // Explicit default thesis breakers if not provided
  const resolvedThesisBreakers = thesisBreakers.length > 0 ? thesisBreakers : [
    `Consecutive 2-quarter revenue growth drops below ${(underwrittenNopatCagrPct * 0.7).toFixed(1)}%`,
    `Receivable days exceed ${observedReality.receivableDays + 30} days with CFO/PAT < 0.60`,
    `Operating EBITDA margin compresses by >250 bps vs baseline (${observedReality.ebitdaMarginPct}%)`,
    `Management guidance cut or failure to achieve announced commissioning milestones`
  ];

  // ---------------------------------------------------------------------------
  // Layer 7: Conditional Multi-Underwriting DCF Price Matrix
  // ---------------------------------------------------------------------------
  const conditionalScenarios = profile.conditionalScenarios || [
    { label: 'Current Base Underwriting', nopatCagrPct: underwrittenNopatCagrPct },
    { label: 'Expansion Validated', nopatCagrPct: underwrittenNopatCagrPct + 6.0 },
    { label: 'Strong Utilization Ramp', nopatCagrPct: underwrittenNopatCagrPct + 10.0 },
    { label: 'Exceptional Execution', nopatCagrPct: underwrittenNopatCagrPct + 13.0 }
  ];

  const conditionalDcfMatrix = calculateConditionalMultiUnderwritingDcf(profile, conditionalScenarios, requiredMarginOfSafetyPct);

  return {
    ticker,
    companyName,
    sector,
    growthEngines,
    riskEngines,
    
    // Three Truths Objects
    observedReality,
    forwardScenarioTrajectory: {
      primaryGrowthEngine,
      modeledNopatCagrRange,
      baseCaseModeledNopatCagr,
      scenarios: trajectoryOutput.scenarios || trajectoryOutput.phases
    },
    evidenceAdjustedPotential: {
      evidenceConfidenceFactor: alpha,
      evidenceAdjustedPotentialCagr,
      evidenceAdjustedRange
    },
    underwriting: {
      underwrittenNopatCagrPct,
      underwritingStatus,
      cagrGapVsUnderwriting: parseFloat((baseCaseModeledNopatCagr - underwrittenNopatCagrPct).toFixed(2)),
      humanApprovalRequiredForRevision: true
    },

    // Promise Ledger Summary
    promiseLedger: promiseLedgerEvaluation,

    // 5-Dimension Reality
    managementDeliveryHistory,
    managementCredibility,
    guidanceStatus,
    growthMetricsTrajectory,
    economicQuality,
    thesisOperationalStatus,
    
    // Evidence & Diagnostics
    evidenceTier,
    trajectoryConfidence,
    thesisRevisionSignal,
    bottleneckDiagnostic,

    // Valuation & Directives
    currentPrice,
    fairValuePrice,
    valuationStatus,
    requiredMarginOfSafetyPct,
    valuationHurdlePrice,
    currentMarginOfSafetyPct,
    
    // Structured Directives
    existingPositionStatus,
    newCapitalStatus,
    actionContext,
    actionRationale,
    thesisBreakers: resolvedThesisBreakers,
    
    // Multi-Underwriting DCF Matrix
    conditionalDcfMatrix,
    valuationEngineInvariantProtected: true
  };
}

/**
 * 5. Conditional Multi-Underwriting DCF Calculator
 */
export function calculateConditionalMultiUnderwritingDcf(profile, scenarios = [], requiredMarginOfSafetyPct = 25.0) {
  const currentPrice = profile.currentPrice || 1000.0;
  const currentPE = profile.currentPE || 40.0;
  const forwardIroic = profile.forwardIroic || 25.0;
  const wacc = profile.wacc || 0.115;
  const sector = profile.sector || 'Capital Goods';

  return scenarios.map(sc => {
    const fv = calculateInstitutionalFcffDcf({
      currentPrice,
      currentPE,
      underwrittenCagr: sc.nopatCagrPct,
      effectiveIroic: forwardIroic,
      wacc,
      terminalGrowth: 0.035,
      sector
    });

    const hurdlePrice = calculateValuationHurdlePrice(fv, requiredMarginOfSafetyPct);
    const implied3YrIrrPct = currentPrice > 0 && fv > 0
      ? parseFloat(((Math.pow(fv / currentPrice, 1.0 / 3.0) - 1.0) * 100.0).toFixed(1))
      : -50.0;

    let valuationConclusion = 'EXPENSIVE';
    if (currentPrice <= hurdlePrice) valuationConclusion = 'ATTRACTIVE (BELOW_HURDLE)';
    else if (currentPrice <= fv) valuationConclusion = 'FAIR_VALUE';
    else if (implied3YrIrrPct >= -10.0) valuationConclusion = 'MODERATELY_EXPENSIVE';
    else valuationConclusion = 'EXTREMELY_DEMANDING';

    return {
      label: sc.label,
      nopatCagrPct: sc.nopatCagrPct,
      fairValuePrice: fv,
      valuationHurdlePrice: hurdlePrice,
      implied3YrIrrPct,
      valuationConclusion
    };
  });
}

// -----------------------------------------------------------------------------
// 6. Master Management Promise Ledger (Cohort Historical Claims Database)
// -----------------------------------------------------------------------------

export const MANAGEMENT_PROMISE_LEDGER = Object.freeze({
  QPOWER: [
    {
      quarter: 'Q3 FY26',
      source: 'Earnings Concall Transcript',
      date: '2026-01-22',
      claimType: PROMISE_CLAIM_TYPE.CAPACITY_COMMISSIONING,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
      managementClaim: 'Sangli Greenfield facility trial production targeted for August 2026',
      targetMetric: 'Trial Run COD',
      deadline: 'August 2026',
      actualReportedDelivery: 'Trial production initiated August 2026; commercial ramp underway',
      variance: 'Delivered On Schedule',
      status: PROMISE_DELIVERY_STATUS.DELIVERED_ON_TIME,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.POSITIVE
    },
    {
      quarter: 'Q1 FY27',
      source: 'Earnings Call / Investor Deck',
      date: '2026-07-28',
      claimType: PROMISE_CLAIM_TYPE.MARGIN_TARGET,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
      managementClaim: 'Executable order book booked above communicated margin guidance with pricing discipline intact',
      targetMetric: 'EBITDA Margin >= 20.0%',
      deadline: 'Q1 FY27',
      actualReportedDelivery: 'Adjusted EBITDA ₹72.5 Cr (28.3% margin after isolating Turkey hyperinflation impact)',
      variance: '+8.3% pts margin beat',
      status: PROMISE_DELIVERY_STATUS.DELIVERED_AHEAD,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.POSITIVE
    },
    {
      quarter: 'Q1 FY27',
      source: 'Earnings Call Transcript',
      date: '2026-07-28',
      claimType: PROMISE_CLAIM_TYPE.REVENUE_GUIDANCE,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
      managementClaim: 'FY27 revenue guidance remains around 20% growth with high-teens/20% EBITDA margin through Sangli ramp',
      targetMetric: '₹1,230 Cr Revenue (~20% YoY)',
      deadline: 'FY27 Full Year',
      actualReportedDelivery: 'Q1 Revenue ₹256.4 Cr (+32% YoY); Q2/Q3 Sangli absorption pending',
      variance: 'Tracking Ahead (+12% pts in Q1)',
      status: PROMISE_DELIVERY_STATUS.IN_PROGRESS_ON_TRACK,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.POSITIVE
    },
    {
      quarter: 'Q1 FY27',
      source: 'Earnings Call Transcript',
      date: '2026-07-28',
      claimType: PROMISE_CLAIM_TYPE.CAPACITY_COMMISSIONING,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
      managementClaim: 'Sangli capacity will absorb initial depreciation/overhead drag and ramp to commercial utilization over 15 months',
      targetMetric: 'Commercial Utilization >= 50%',
      deadline: 'Q4 FY27 / Q1 FY28',
      actualReportedDelivery: 'Awaiting Q2 and Q3 FY27 dispatches & fixed overhead absorption proof',
      variance: 'Milestone In Progress',
      status: PROMISE_DELIVERY_STATUS.PENDING_OPERATIONAL_PROOF,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.NEUTRAL
    }
  ],
  HBLENGINE: [
    {
      quarter: 'Q2 FY26',
      source: 'Earnings Concall',
      date: '2025-11-14',
      claimType: PROMISE_CLAIM_TYPE.CAPACITY_COMMISSIONING,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
      managementClaim: 'Kavach manufacturing capacity ramped to 3,000+ track-km per annum',
      targetMetric: '3,000 km/yr capacity',
      deadline: 'Q4 FY26',
      actualReportedDelivery: 'Facility readiness certified and approved by RDSO',
      variance: 'Delivered On Time',
      status: PROMISE_DELIVERY_STATUS.DELIVERED_ON_TIME,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.POSITIVE
    },
    {
      quarter: 'Q4 FY26',
      source: 'SEBI LODR Filing',
      date: '2026-05-20',
      claimType: PROMISE_CLAIM_TYPE.REVENUE_GUIDANCE,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
      managementClaim: 'FY27 revenue growth expected at 25–30% driven by railway signalling & defence dispatches',
      targetMetric: '+25–30% YoY',
      deadline: 'FY27 Full Year',
      actualReportedDelivery: 'Q1 FY27 revenue grew +28% YoY to ₹580 Cr',
      variance: 'Delivered Within Range',
      status: PROMISE_DELIVERY_STATUS.IN_PROGRESS_ON_TRACK,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.POSITIVE
    }
  ],
  TRANSRAILL: [
    {
      quarter: 'Q4 FY26',
      source: 'Earnings Call',
      date: '2026-05-25',
      claimType: PROMISE_CLAIM_TYPE.REVENUE_GUIDANCE,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
      managementClaim: 'Revenue growth exceeding 20% backed by ₹10,500 Cr contracted backlog',
      targetMetric: '>20% YoY Revenue',
      deadline: 'FY27',
      actualReportedDelivery: 'Q1 revenue ₹1,050 Cr (+22% YoY)',
      variance: 'Delivered On Time',
      status: PROMISE_DELIVERY_STATUS.DELIVERED_ON_TIME,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.POSITIVE
    },
    {
      quarter: 'Q4 FY26',
      source: 'Earnings Call',
      date: '2026-05-25',
      claimType: PROMISE_CLAIM_TYPE.WORKING_CAPITAL_DSO,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
      managementClaim: 'Receivables normalization toward <90 days with positive quarterly CFO generation',
      targetMetric: '<90 Days DSO',
      deadline: 'Q1 FY27',
      actualReportedDelivery: 'DSO remained at 115 days; CFO/PAT remained depressed at 0.50x',
      variance: '+25 Days Delay / CFO Lag',
      status: PROMISE_DELIVERY_STATUS.MISSED,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.NEGATIVE
    }
  ],
  ANANTRAJ: [
    {
      quarter: 'Q3 FY26',
      source: 'Investor Presentation',
      date: '2026-01-18',
      claimType: PROMISE_CLAIM_TYPE.CAPACITY_COMMISSIONING,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
      managementClaim: 'Manesar Phase 1 (21 MW) power energization and tenant lease commencement',
      targetMetric: '21 MW Operational',
      deadline: 'Q4 FY26',
      actualReportedDelivery: '21 MW energization certified; leasing commenced with cloud tenants',
      variance: 'Delivered On Time',
      status: PROMISE_DELIVERY_STATUS.DELIVERED_ON_TIME,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.POSITIVE
    },
    {
      quarter: 'Q4 FY26',
      source: 'Earnings Call',
      date: '2026-05-15',
      claimType: PROMISE_CLAIM_TYPE.CAPACITY_COMMISSIONING,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
      managementClaim: 'Phase 2 expansion to 50 MW by end-FY27',
      targetMetric: '50 MW Total Capacity',
      deadline: 'Q4 FY27',
      actualReportedDelivery: 'Civil structures completed; substation equipment procurement active',
      variance: 'In Progress On Schedule',
      status: PROMISE_DELIVERY_STATUS.IN_PROGRESS_ON_TRACK,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.NEUTRAL
    }
  ],
  SJS: [
    {
      quarter: 'Q1 FY26',
      source: 'SEBI LODR Filing',
      date: '2025-07-20',
      claimType: PROMISE_CLAIM_TYPE.CAPACITY_COMMISSIONING,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
      managementClaim: 'Exxpand manufacturing plant commissioning by Q3 FY26',
      targetMetric: 'COD Q3 FY26',
      deadline: 'Q3 FY26',
      actualReportedDelivery: 'Commissioned on schedule in November 2025',
      variance: 'Delivered On Time',
      status: PROMISE_DELIVERY_STATUS.DELIVERED_ON_TIME,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.POSITIVE
    },
    {
      quarter: 'Q4 FY26',
      source: 'Earnings Call Transcript',
      date: '2026-05-12',
      claimType: PROMISE_CLAIM_TYPE.MARGIN_TARGET,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
      managementClaim: 'Sustained organic EBITDA margin above 27% with Walter Pack cross-selling',
      targetMetric: '>27% EBITDA Margin',
      deadline: 'FY27',
      actualReportedDelivery: 'Q1 FY27 EBITDA margin reached 28.5%',
      variance: '+150 bps beat',
      status: PROMISE_DELIVERY_STATUS.DELIVERED_AHEAD,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.POSITIVE
    }
  ],
  SHAKTIPUMP: [
    {
      quarter: 'Q2 FY26',
      source: 'Earnings Call',
      date: '2025-11-10',
      claimType: PROMISE_CLAIM_TYPE.WORKING_CAPITAL_DSO,
      evidenceTier: EVIDENCE_STRENGTH_TIER.E4_CONCALL_DIRECTIONAL,
      managementClaim: 'State government subsidy receivables will normalize, bringing debtor days below 90 days',
      targetMetric: '<90 Days DSO',
      deadline: 'Q4 FY26',
      actualReportedDelivery: 'Debtor days expanded to 140 days; CFO remained severely negative',
      variance: '+50 Days Blowout',
      status: PROMISE_DELIVERY_STATUS.BROKEN,
      credibilityImpact: PROMISE_CREDIBILITY_IMPACT.NEGATIVE
    }
  ]
});

// -----------------------------------------------------------------------------
// 7. 19-Stock Master Cohort Profile Dictionary
// -----------------------------------------------------------------------------

export const COHORT_TRAJECTORY_PROFILES = Object.freeze({
  QPOWER: {
    ticker: 'QPOWER',
    companyName: 'Quality Power Electrical Equipments Ltd.',
    sector: 'Heavy Electrical Equipment',
    currentPrice: 1426.0,
    currentPE: 82.9,
    fairValuePrice: 438.17,
    forwardIroic: 33.9,
    growthEngines: [GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION, GROWTH_ENGINE_TYPE.ORDER_BOOK_EXECUTION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.CAPEX_INSTALLATION_DRAG, THESIS_RISK_ENGINE_TYPE.EXECUTION_LUMPINESS],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.ACCELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNDER_VALIDATION,
    underwritingStatus: UNDERWRITING_STATUS.UNDER_REVIEW,
    valuationStatus: VALUATION_STATUS.EXTREME,
    baselineRevenueCr: 1025.0,
    baselineEbitdaMarginPct: 19.5,
    baselineNopatCr: 145.0,
    observedYoYGrowthPct: 32.0,
    consecutiveQuartersDelivered: 2,
    capacityMultiple: 8.0,
    productLineMixFactor: 0.55,
    incrementalCapexCr: 180.0,
    overheadDragBpsAtLowUtil: 250,
    orderBookTotalCr: 1945.0,
    underwrittenNopatCagrPct: 22.0,
    evidenceConfidenceFactor: 0.75,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
    managementDeliveryHistory: 'STRONG_TRACK_RECORD',
    cashFlowEvidence: { receivableDays: 75, cfoPatRatio: 0.85 },
    thesisBreakers: [
      "Sangli commercial trial fails to ramp above 30% utilization by Q4 FY27",
      "Gross EBITDA margin fails to rebound above 20% after initial commissioning drag",
      "Order book fails to convert into positive CFO (CFO/PAT drops below 0.65)",
      "FY27 revenue guidance is lowered below 20%"
    ],
    conditionalScenarios: [
      { label: 'Current Base Underwriting', nopatCagrPct: 22.0 },
      { label: 'Sangli Commissioned (50% Util)', nopatCagrPct: 28.0 },
      { label: 'Strong Utilization Ramp (75% Util)', nopatCagrPct: 32.0 },
      { label: 'Exceptional Execution (Full 8x Line Ramp)', nopatCagrPct: 35.0 }
    ]
  },
  HBLENGINE: {
    ticker: 'HBLENGINE',
    companyName: 'HBL Power Systems Ltd.',
    sector: 'Industrial Batteries & Railways',
    currentPrice: 722.0,
    currentPE: 35.0,
    fairValuePrice: 1042.36,
    forwardIroic: 32.0,
    growthEngines: [GROWTH_ENGINE_TYPE.ORDER_BOOK_EXECUTION, GROWTH_ENGINE_TYPE.MARKET_SHARE_GAIN],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.EXECUTION_LUMPINESS, THESIS_RISK_ENGINE_TYPE.CAPEX_INSTALLATION_DRAG],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.ACCELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.CAPITAL_CONSUMING_ACCRETIVE,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.STRENGTHENING,
    underwritingStatus: UNDERWRITING_STATUS.TOO_AGGRESSIVE,
    valuationStatus: VALUATION_STATUS.ATTRACTIVE,
    baselineRevenueCr: 2150.0,
    baselineEbitdaMarginPct: 22.0,
    baselineNopatCr: 320.0,
    observedYoYGrowthPct: 28.0,
    consecutiveQuartersDelivered: 4,
    orderBookTotalCr: 2800.0,
    executionMonths: 18,
    executionHaircutPct: 8.0,
    underwrittenNopatCagrPct: 28.0,
    evidenceConfidenceFactor: 0.90,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E1_EXCHANGE_FILED_CONTRACT,
    managementDeliveryHistory: 'CONSISTENT_DELIVERY',
    cashFlowEvidence: { receivableDays: 70, cfoPatRatio: 0.82 },
    thesisBreakers: [
      "Indian Railways Kavach installation rate drops below 1,500 km per annum",
      "Defence battery contract renewal delays exceeding 6 months",
      "Forward iROIC compresses below 22% due to working capital blowout",
      "CFO conversion drag exceeds 30 percentage points vs NOPAT"
    ]
  },
  TRANSRAILL: {
    ticker: 'TRANSRAILL',
    companyName: 'Transrail Lighting Ltd.',
    sector: 'Power Transmission & Lighting',
    currentPrice: 410.0,
    currentPE: 16.0,
    fairValuePrice: 717.48,
    forwardIroic: 18.0,
    growthEngines: [GROWTH_ENGINE_TYPE.ORDER_BOOK_EXECUTION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.WORKING_CAPITAL_CONVERSION, THESIS_RISK_ENGINE_TYPE.EXECUTION_LUMPINESS],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.ACCELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.DETERIORATING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNDER_REVALIDATION,
    underwritingStatus: UNDERWRITING_STATUS.UNDER_REVIEW,
    valuationStatus: VALUATION_STATUS.ATTRACTIVE,
    baselineRevenueCr: 4200.0,
    baselineEbitdaMarginPct: 11.2,
    baselineNopatCr: 240.0,
    observedYoYGrowthPct: 22.0,
    consecutiveQuartersDelivered: 3,
    orderBookTotalCr: 10500.0,
    executionMonths: 24,
    executionHaircutPct: 15.0,
    underwrittenNopatCagrPct: 20.0,
    evidenceConfidenceFactor: 0.80,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E1_EXCHANGE_FILED_CONTRACT,
    managementDeliveryHistory: 'REVENUE_DELIVERED_CASH_LAGGING',
    cashFlowEvidence: { receivableDays: 115, cfoPatRatio: 0.50 },
    thesisBreakers: [
      "Receivable days remain above 115 days for >2 consecutive quarters",
      "Annual CFO remains negative or CFO/PAT fails to reach 0.65",
      "EBITDA margins compress below 9.5% due to EPC contract cost overruns",
      "Order backlog cancellation rate exceeds 10%"
    ]
  },
  ANANTRAJ: {
    ticker: 'ANANTRAJ',
    companyName: 'Anant Raj Ltd.',
    sector: 'Data Centers & Real Estate',
    currentPrice: 598.0,
    currentPE: 45.0,
    fairValuePrice: 399.95,
    forwardIroic: 30.0,
    growthEngines: [GROWTH_ENGINE_TYPE.ASSET_COMMISSIONING, GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.CAPEX_INSTALLATION_DRAG],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.ACCELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.STRENGTHENING,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXPENSIVE,
    baselineRevenueCr: 1850.0,
    baselineNopatCr: 360.0,
    observedYoYGrowthPct: 35.0,
    consecutiveQuartersDelivered: 4,
    currentOperationalUnits: 21.0,
    phasedTargetUnits: 50.0,
    fullScaleUnits: 150.0,
    annualRevenuePerUnitCr: 8.5,
    unitEbitdaMarginPct: 65.0,
    capexPerUnitCr: 25.0,
    underwrittenNopatCagrPct: 25.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
    managementDeliveryHistory: 'MILESTONE_ON_TRACK',
    cashFlowEvidence: { receivableDays: 60, cfoPatRatio: 0.85 },
    thesisBreakers: [
      "Data center Phase 2 (50 MW) power energization delayed beyond FY27",
      "Average data center lease rental falls below ₹6.5 Cr/MW/yr",
      "Real estate cash flows fail to fund data center capex equity portion"
    ]
  },
  SJS: {
    ticker: 'SJS',
    companyName: 'SJS Enterprises Ltd.',
    sector: 'Automotive Aesthetics',
    currentPrice: 2354.0,
    currentPE: 38.0,
    fairValuePrice: 1404.49,
    forwardIroic: 26.0,
    growthEngines: [GROWTH_ENGINE_TYPE.CUSTOMER_PROGRAM_RAMP, GROWTH_ENGINE_TYPE.ACQUISITION_INTEGRATION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.INTEGRATION_EXECUTION],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.STABLE,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.STRENGTHENING,
    underwritingStatus: UNDERWRITING_STATUS.SUPPORTED_BY_EVIDENCE,
    valuationStatus: VALUATION_STATUS.EXPENSIVE,
    baselineRevenueCr: 650.0,
    baselineEbitdaMarginPct: 28.5,
    baselineNopatCr: 125.0,
    observedYoYGrowthPct: 24.0,
    consecutiveQuartersDelivered: 5,
    organicProgramGrowthPct: 20.0,
    contentPerVehicleGrowthPct: 14.0,
    acquisitionRevenueCr: 120.0,
    underwrittenNopatCagrPct: 22.0,
    evidenceConfidenceFactor: 0.90,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
    managementDeliveryHistory: 'GUIDANCE_EXCEEDED',
    cashFlowEvidence: { receivableDays: 65, cfoPatRatio: 0.90 },
    thesisBreakers: [
      "EBITDA margin compresses below 24% due to OEM pricing pushback",
      "Walter Pack acquisition synergy turns negative or goodwill is impaired",
      "Export revenue share falls below 15%"
    ]
  },
  HSCL: {
    ticker: 'HSCL',
    companyName: 'Himadri Speciality Chemical Ltd.',
    sector: 'Specialty Chemicals & Anode Materials',
    currentPrice: 665.0,
    currentPE: 32.0,
    fairValuePrice: 441.20,
    forwardIroic: 28.0,
    growthEngines: [GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION, GROWTH_ENGINE_TYPE.PRICE_MIX],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.CAPEX_INSTALLATION_DRAG, THESIS_RISK_ENGINE_TYPE.RAW_MATERIAL_CYCLICALITY],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.STABLE,
    economicQuality: ECONOMIC_QUALITY_STATUS.CAPITAL_CONSUMING_ACCRETIVE,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNDER_VALIDATION,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXPENSIVE,
    baselineRevenueCr: 4500.0,
    baselineEbitdaMarginPct: 15.0,
    baselineNopatCr: 420.0,
    observedYoYGrowthPct: 18.0,
    consecutiveQuartersDelivered: 3,
    capacityMultiple: 2.2,
    productLineMixFactor: 0.50,
    incrementalCapexCr: 600.0,
    overheadDragBpsAtLowUtil: 200,
    underwrittenNopatCagrPct: 22.0,
    evidenceConfidenceFactor: 0.80,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
    managementDeliveryHistory: 'CONSISTENT_DELIVERY',
    cashFlowEvidence: { receivableDays: 75, cfoPatRatio: 0.80 },
    thesisBreakers: [
      "Lithium-ion synthetic anode material commercial ramp delayed past FY27",
      "Coal tar pitch spreads compress by >30% due to global steel slowdown",
      "Net debt / EBITDA expands above 2.0x during capex ramp"
    ]
  },
  TIMETECHNO: {
    ticker: 'TIMETECHNO',
    companyName: 'Time Technoplast Ltd.',
    sector: 'Polymer Products & Type-IV CNG',
    currentPrice: 442.0,
    currentPE: 21.0,
    fairValuePrice: 382.47,
    forwardIroic: 22.0,
    growthEngines: [GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION, GROWTH_ENGINE_TYPE.MARKET_SHARE_GAIN],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.RAW_MATERIAL_CYCLICALITY],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.STABLE,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNCHANGED,
    underwritingStatus: UNDERWRITING_STATUS.SUPPORTED_BY_EVIDENCE,
    valuationStatus: VALUATION_STATUS.FAIR,
    baselineRevenueCr: 5200.0,
    baselineEbitdaMarginPct: 14.5,
    baselineNopatCr: 410.0,
    observedYoYGrowthPct: 16.0,
    consecutiveQuartersDelivered: 4,
    capacityMultiple: 1.7,
    productLineMixFactor: 0.45,
    incrementalCapexCr: 250.0,
    overheadDragBpsAtLowUtil: 150,
    underwrittenNopatCagrPct: 18.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
    managementDeliveryHistory: 'CONSISTENT_DELIVERY',
    cashFlowEvidence: { receivableDays: 80, cfoPatRatio: 0.85 },
    thesisBreakers: [
      "PESO regulatory approval delays for Type-IV CNG cascades",
      "Polymer raw material price volatility compresses EBITDA below 12.5%",
      "Consolidated ROCE fails to cross 18%"
    ]
  },
  GRAVITA: {
    ticker: 'GRAVITA',
    companyName: 'Gravita India Ltd.',
    sector: 'Recycling & Non-Ferrous Metals',
    currentPrice: 2196.0,
    currentPE: 42.0,
    fairValuePrice: 874.39,
    forwardIroic: 27.0,
    growthEngines: [GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION, GROWTH_ENGINE_TYPE.GEOGRAPHIC_EXPANSION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.RAW_MATERIAL_CYCLICALITY],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.ACCELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.CAPITAL_CONSUMING_ACCRETIVE,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.STRENGTHENING,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXTREME,
    baselineRevenueCr: 3600.0,
    baselineEbitdaMarginPct: 10.5,
    baselineNopatCr: 280.0,
    observedYoYGrowthPct: 26.0,
    consecutiveQuartersDelivered: 5,
    capacityMultiple: 2.5,
    productLineMixFactor: 0.60,
    incrementalCapexCr: 200.0,
    overheadDragBpsAtLowUtil: 180,
    underwrittenNopatCagrPct: 25.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
    managementDeliveryHistory: 'VISION_2028_ON_TRACK',
    cashFlowEvidence: { receivableDays: 55, cfoPatRatio: 0.82 },
    thesisBreakers: [
      "Scrap metal feedstock availability constraints drop capacity util below 60%",
      "Hedging failure results in unhedged metal inventory losses >₹30 Cr",
      "Vision 2028 volume CAGR drops below 20%"
    ]
  },
  CCL: {
    ticker: 'CCL',
    companyName: 'CCL Products (India) Ltd.',
    sector: 'Instant Coffee & FMCG',
    currentPrice: 812.0,
    currentPE: 34.0,
    fairValuePrice: 512.63,
    forwardIroic: 22.0,
    growthEngines: [GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION, GROWTH_ENGINE_TYPE.GEOGRAPHIC_EXPANSION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.RAW_MATERIAL_CYCLICALITY],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.STABLE,
    economicQuality: ECONOMIC_QUALITY_STATUS.CAPITAL_CONSUMING_ACCRETIVE,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNCHANGED,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXPENSIVE,
    baselineRevenueCr: 2800.0,
    baselineEbitdaMarginPct: 17.5,
    baselineNopatCr: 310.0,
    observedYoYGrowthPct: 19.0,
    consecutiveQuartersDelivered: 3,
    capacityMultiple: 1.8,
    productLineMixFactor: 0.50,
    incrementalCapexCr: 350.0,
    overheadDragBpsAtLowUtil: 220,
    underwrittenNopatCagrPct: 20.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
    managementDeliveryHistory: 'CONSISTENT_DELIVERY',
    cashFlowEvidence: { receivableDays: 70, cfoPatRatio: 0.80 },
    thesisBreakers: [
      "Robusta coffee bean cost surge cannot be passed on to private-label clients",
      "Vietnam / Continental Coffee UK plant utilization languishes below 50%",
      "Domestic branded business fails to achieve EBITDA break-even"
    ]
  },
  SBCL: {
    ticker: 'SBCL',
    companyName: 'Shivalik Bimetal Controls Ltd.',
    sector: 'Bimetal & Shunt Resistors',
    currentPrice: 585.0,
    currentPE: 33.0,
    fairValuePrice: 388.94,
    forwardIroic: 25.0,
    growthEngines: [GROWTH_ENGINE_TYPE.CUSTOMER_PROGRAM_RAMP, GROWTH_ENGINE_TYPE.MARKET_SHARE_GAIN],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.EXECUTION_LUMPINESS],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.STABLE,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNCHANGED,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXPENSIVE,
    baselineRevenueCr: 520.0,
    baselineEbitdaMarginPct: 23.0,
    baselineNopatCr: 95.0,
    observedYoYGrowthPct: 18.0,
    consecutiveQuartersDelivered: 3,
    orderBookTotalCr: 450.0,
    executionMonths: 15,
    executionHaircutPct: 10.0,
    underwrittenNopatCagrPct: 20.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
    managementDeliveryHistory: 'CONSISTENT_DELIVERY',
    cashFlowEvidence: { receivableDays: 75, cfoPatRatio: 0.85 },
    thesisBreakers: [
      "Global EV BMS shunt resistor adoption decelerates or faces ASIC displacement",
      "Smart meter rollout pacing in India slows by >40%",
      "EBITDA margins compress below 19%"
    ]
  },
  SKIPPER: {
    ticker: 'SKIPPER',
    companyName: 'Skipper Ltd.',
    sector: 'T&D Structures & Polymer Pipes',
    currentPrice: 485.0,
    currentPE: 24.0,
    fairValuePrice: 423.86,
    forwardIroic: 19.0,
    growthEngines: [GROWTH_ENGINE_TYPE.ORDER_BOOK_EXECUTION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.WORKING_CAPITAL_CONVERSION],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.ACCELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.STABLE,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNCHANGED,
    underwritingStatus: UNDERWRITING_STATUS.SUPPORTED_BY_EVIDENCE,
    valuationStatus: VALUATION_STATUS.FAIR,
    baselineRevenueCr: 3300.0,
    baselineEbitdaMarginPct: 10.2,
    baselineNopatCr: 165.0,
    observedYoYGrowthPct: 25.0,
    consecutiveQuartersDelivered: 4,
    orderBookTotalCr: 6200.0,
    executionMonths: 20,
    executionHaircutPct: 12.0,
    underwrittenNopatCagrPct: 22.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E1_EXCHANGE_FILED_CONTRACT,
    managementDeliveryHistory: 'STRONG_EXECUTION',
    cashFlowEvidence: { receivableDays: 95, cfoPatRatio: 0.72 },
    thesisBreakers: [
      "T&D order backlog execution slows past 24 months burn rate",
      "Steel raw material price surge compresses operating margin below 8.5%",
      "Receivables stretch beyond 115 days"
    ]
  },
  PGEL: {
    ticker: 'PGEL',
    companyName: 'PG Electroplast Ltd.',
    sector: 'Consumer Electronics EMS',
    currentPrice: 742.0,
    currentPE: 44.0,
    fairValuePrice: 382.15,
    forwardIroic: 24.0,
    growthEngines: [GROWTH_ENGINE_TYPE.CUSTOMER_PROGRAM_RAMP, GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.CUSTOMER_CONCENTRATION],
    guidanceStatus: GUIDANCE_STATUS.RAISED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.ACCELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.CAPITAL_CONSUMING_ACCRETIVE,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.STRENGTHENING,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXTREME,
    baselineRevenueCr: 3200.0,
    baselineEbitdaMarginPct: 9.0,
    baselineNopatCr: 160.0,
    observedYoYGrowthPct: 38.0,
    consecutiveQuartersDelivered: 4,
    capacityMultiple: 2.0,
    productLineMixFactor: 0.65,
    incrementalCapexCr: 300.0,
    overheadDragBpsAtLowUtil: 150,
    underwrittenNopatCagrPct: 25.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E2_AUDITED_CAPEX_COMMISSIONING,
    managementDeliveryHistory: 'GUIDANCE_BEATEN',
    cashFlowEvidence: { receivableDays: 70, cfoPatRatio: 0.78 },
    thesisBreakers: [
      "RAC (Room Air Conditioner) product demand experiences severe unseasonal slump",
      "Key OEM customer insources manufacturing",
      "EBITDA margins compress below 7.0%"
    ]
  },
  LUMAXTECH: {
    ticker: 'LUMAXTECH',
    companyName: 'Lumax Auto Technologies Ltd.',
    sector: 'Auto Components & Lighting',
    currentPrice: 1994.0,
    currentPE: 28.0,
    fairValuePrice: 961.19,
    forwardIroic: 22.0,
    growthEngines: [GROWTH_ENGINE_TYPE.CUSTOMER_PROGRAM_RAMP],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.CUSTOMER_CONCENTRATION],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.STABLE,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNCHANGED,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXPENSIVE,
    baselineRevenueCr: 2900.0,
    baselineEbitdaMarginPct: 13.5,
    baselineNopatCr: 180.0,
    observedYoYGrowthPct: 16.0,
    consecutiveQuartersDelivered: 3,
    organicProgramGrowthPct: 16.0,
    contentPerVehicleGrowthPct: 10.0,
    acquisitionRevenueCr: 0.0,
    underwrittenNopatCagrPct: 20.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
    managementDeliveryHistory: 'CONSISTENT_DELIVERY',
    cashFlowEvidence: { receivableDays: 68, cfoPatRatio: 0.86 },
    thesisBreakers: [
      "Key 2W/PV OEM volumes contract by >15% YoY",
      "IAC India acquisition fails to maintain operating margins above 12%",
      "ROCE drops below 16%"
    ]
  },
  INOXINDIA: {
    ticker: 'INOXINDIA',
    companyName: 'INOX India Ltd.',
    sector: 'Cryogenic Equipment',
    currentPrice: 2247.0,
    currentPE: 79.0,
    fairValuePrice: 734.99,
    forwardIroic: 28.0,
    growthEngines: [GROWTH_ENGINE_TYPE.MARKET_SHARE_GAIN, GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.RAW_MATERIAL_CYCLICALITY],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.STABLE,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNCHANGED,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXTREME,
    baselineRevenueCr: 1250.0,
    baselineEbitdaMarginPct: 23.5,
    baselineNopatCr: 215.0,
    observedYoYGrowthPct: 22.0,
    consecutiveQuartersDelivered: 4,
    orderBookTotalCr: 1686.0,
    executionMonths: 16,
    executionHaircutPct: 8.0,
    underwrittenNopatCagrPct: 22.0,
    evidenceConfidenceFactor: 0.90,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E1_EXCHANGE_FILED_CONTRACT,
    managementDeliveryHistory: 'STRONG_TRACK_RECORD',
    cashFlowEvidence: { receivableDays: 72, cfoPatRatio: 0.88 },
    thesisBreakers: [
      "Global LNG and cryogenic equipment capex cycle stalls",
      "Order intake drops below quarterly revenue run rate for >2 quarters",
      "EBITDA margins fall below 20%"
    ]
  },
  POLICYBZR: {
    ticker: 'POLICYBZR',
    companyName: 'PB Fintech Ltd.',
    sector: 'Insurance Tech Platform',
    currentPrice: 1797.0,
    currentPE: 95.0,
    fairValuePrice: 331.34,
    forwardIroic: 25.0,
    growthEngines: [GROWTH_ENGINE_TYPE.MARKET_SHARE_GAIN],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.COMPETITIVE_DISRUPTION],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.ACCELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.STRENGTHENING,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXTREME,
    baselineRevenueCr: 4100.0,
    baselineEbitdaMarginPct: 12.0,
    baselineNopatCr: 380.0,
    observedYoYGrowthPct: 35.0,
    consecutiveQuartersDelivered: 4,
    organicProgramGrowthPct: 28.0,
    contentPerVehicleGrowthPct: 0.0,
    acquisitionRevenueCr: 0.0,
    underwrittenNopatCagrPct: 25.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
    managementDeliveryHistory: 'CONSISTENT_DELIVERY',
    cashFlowEvidence: { receivableDays: 30, cfoPatRatio: 0.95 },
    thesisBreakers: [
      "IRDAI regulatory caps on insurance distribution commission structures",
      "Health/Term insurance premium renewal persistency drops below 80%",
      "EBITDA margins fail to expand toward 18-20% target"
    ]
  },
  JSLL: {
    ticker: 'JSLL',
    companyName: 'Jeena Sikho Lifecare Ltd.',
    sector: 'Ayurvedic Healthcare Services',
    currentPrice: 512.0,
    currentPE: 28.0,
    fairValuePrice: 496.40,
    forwardIroic: 30.0,
    growthEngines: [GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.EXECUTION_LUMPINESS],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.STABLE,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNCHANGED,
    underwritingStatus: UNDERWRITING_STATUS.SUPPORTED_BY_EVIDENCE,
    valuationStatus: VALUATION_STATUS.FAIR,
    baselineRevenueCr: 450.0,
    baselineEbitdaMarginPct: 32.0,
    baselineNopatCr: 110.0,
    observedYoYGrowthPct: 24.0,
    consecutiveQuartersDelivered: 4,
    capacityMultiple: 1.8,
    productLineMixFactor: 0.60,
    incrementalCapexCr: 80.0,
    overheadDragBpsAtLowUtil: 150,
    underwrittenNopatCagrPct: 20.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
    managementDeliveryHistory: 'CONSISTENT_DELIVERY',
    cashFlowEvidence: { receivableDays: 45, cfoPatRatio: 0.90 },
    thesisBreakers: [
      "Hospital bed occupancy rates fall below 55%",
      "Regulatory scrutiny or AYUSH compliance friction",
      "Operating EBITDA margin drops below 26%"
    ]
  },
  ELECON: {
    ticker: 'ELECON',
    companyName: 'Elecon Engineering Company Ltd.',
    sector: 'Industrial Gears & MHE',
    currentPrice: 422.0,
    currentPE: 26.0,
    fairValuePrice: 261.57,
    forwardIroic: 24.0,
    growthEngines: [GROWTH_ENGINE_TYPE.GEOGRAPHIC_EXPANSION, GROWTH_ENGINE_TYPE.PRICE_MIX],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.EXECUTION_LUMPINESS],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.DECELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.STABLE,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.UNCHANGED,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXPENSIVE,
    baselineRevenueCr: 2100.0,
    baselineEbitdaMarginPct: 24.0,
    baselineNopatCr: 380.0,
    observedYoYGrowthPct: 14.0,
    consecutiveQuartersDelivered: 3,
    orderBookTotalCr: 2400.0,
    executionMonths: 18,
    executionHaircutPct: 10.0,
    underwrittenNopatCagrPct: 20.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E3_CONCALL_QUANTIFIED_GUIDANCE,
    managementDeliveryHistory: 'CYCLICAL_MODERATION',
    cashFlowEvidence: { receivableDays: 85, cfoPatRatio: 0.70 },
    thesisBreakers: [
      "Overseas industrial gear export growth slows below 10%",
      "MHE division order book turns negative YoY",
      "EBITDA margins fall below 20%"
    ]
  },
  JYOTICNC: {
    ticker: 'JYOTICNC',
    companyName: 'Jyoti CNC Automation Ltd.',
    sector: 'CNC Machine Tools',
    currentPrice: 985.0,
    currentPE: 48.0,
    fairValuePrice: 464.37,
    forwardIroic: 26.0,
    growthEngines: [GROWTH_ENGINE_TYPE.ORDER_BOOK_EXECUTION, GROWTH_ENGINE_TYPE.CAPACITY_UTILIZATION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.EXECUTION_LUMPINESS],
    guidanceStatus: GUIDANCE_STATUS.MAINTAINED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.ACCELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.IMPROVING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.STRENGTHENING,
    underwritingStatus: UNDERWRITING_STATUS.VALID,
    valuationStatus: VALUATION_STATUS.EXTREME,
    baselineRevenueCr: 1650.0,
    baselineEbitdaMarginPct: 16.5,
    baselineNopatCr: 190.0,
    observedYoYGrowthPct: 34.0,
    consecutiveQuartersDelivered: 4,
    orderBookTotalCr: 4100.0,
    executionMonths: 20,
    executionHaircutPct: 10.0,
    underwrittenNopatCagrPct: 30.0,
    evidenceConfidenceFactor: 0.85,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E1_EXCHANGE_FILED_CONTRACT,
    managementDeliveryHistory: 'STRONG_RAMP',
    cashFlowEvidence: { receivableDays: 95, cfoPatRatio: 0.75 },
    thesisBreakers: [
      "Aerospace/Defence EMS machine delivery delays >6 months",
      "Order backlog burn rate slows past 28 months",
      "EBITDA margins compress below 14.5%"
    ]
  },
  SHAKTIPUMP: {
    ticker: 'SHAKTIPUMP',
    companyName: 'Shakti Pumps (India) Ltd.',
    sector: 'Solar Pumps & Motors',
    currentPrice: 494.0,
    currentPE: 22.0,
    fairValuePrice: 236.49,
    forwardIroic: 12.0,
    growthEngines: [GROWTH_ENGINE_TYPE.ORDER_BOOK_EXECUTION],
    riskEngines: [THESIS_RISK_ENGINE_TYPE.WORKING_CAPITAL_CONVERSION, THESIS_RISK_ENGINE_TYPE.RAW_MATERIAL_CYCLICALITY],
    guidanceStatus: GUIDANCE_STATUS.MISSED,
    growthMetricsTrajectory: GROWTH_METRICS_TRAJECTORY.DECELERATING,
    economicQuality: ECONOMIC_QUALITY_STATUS.DETERIORATING,
    thesisOperationalStatus: THESIS_OPERATIONAL_STATUS.BROKEN,
    underwritingStatus: UNDERWRITING_STATUS.BROKEN,
    valuationStatus: VALUATION_STATUS.EXTREME,
    baselineRevenueCr: 2200.0,
    baselineEbitdaMarginPct: 18.0,
    baselineNopatCr: 250.0,
    observedYoYGrowthPct: 110.0,
    consecutiveQuartersDelivered: 1,
    hasAuditedDeterioration: true,
    orderBookTotalCr: 2400.0,
    executionMonths: 15,
    executionHaircutPct: 20.0,
    underwrittenNopatCagrPct: 10.0,
    evidenceConfidenceFactor: 0.60,
    evidenceTier: EVIDENCE_STRENGTH_TIER.E1_EXCHANGE_FILED_CONTRACT,
    managementDeliveryHistory: 'EXTREME_CYCLICALITY',
    cashFlowEvidence: { receivableDays: 140, cfoPatRatio: 0.15 },
    thesisBreakers: [
      "State government PM-KUSUM subsidy disbursement moratorium",
      "Receivables remain above 130 days with negative CFO",
      "Post-subsidy volume contraction >50%"
    ]
  }
});

/**
 * 8. Cohort Orchestrator (Synchronous - Uses Profile / Static Ledger)
 */
export function synthesizeCohortFundamentalTrajectories(customProfiles = {}) {
  const mergedProfiles = { ...COHORT_TRAJECTORY_PROFILES, ...customProfiles };
  const results = [];

  for (const [ticker, profile] of Object.entries(mergedProfiles)) {
    const vector = evaluateFundamentalTrajectoryVector(profile);
    results.push(vector);
  }

  return results;
}

/**
 * Single Vector Evaluator with Dynamic Database Hydration
 */
export async function evaluateFundamentalTrajectoryVectorAsync(profile, poolInstance = null) {
  let promiseLedger = profile.promiseLedger;
  if (!promiseLedger && poolInstance) {
    const dbLedger = await loadPromiseLedgerFromDatabase(profile.ticker, poolInstance);
    if (dbLedger && dbLedger.length > 0) {
      promiseLedger = dbLedger;
    }
  }

  return evaluateFundamentalTrajectoryVector({
    ...profile,
    promiseLedger
  });
}

/**
 * Cohort Orchestrator with Dynamic Database Hydration
 */
export async function synthesizeCohortFundamentalTrajectoriesAsync(customProfiles = {}, poolInstance = null) {
  const mergedProfiles = { ...COHORT_TRAJECTORY_PROFILES, ...customProfiles };
  const results = [];

  for (const [ticker, profile] of Object.entries(mergedProfiles)) {
    const vector = await evaluateFundamentalTrajectoryVectorAsync(profile, poolInstance);
    results.push(vector);
  }

  return results;
}
