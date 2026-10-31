/**
 * RESEARCH ENGINE INTEGRITY AUDIT SERVICE (HARDENED & CANONICAL)
 * 
 * Strictly derives all governance rules from the canonical specification:
 * backend/config/frozen_governance_ruleset_v1.json
 */

import fs from 'fs';
import path from 'path';

// Load Canonical Frozen Governance Specification
const configPath = path.resolve(process.cwd(), 'backend', 'config', 'frozen_governance_ruleset_v1.json');
export const FROZEN_GOVERNANCE_SPEC = JSON.parse(fs.readFileSync(configPath, 'utf8'));

export const INTEGRITY_CATEGORIES = {
  DATA_INTEGRITY: 'DATA_INTEGRITY',
  THESIS_INTEGRITY: 'THESIS_INTEGRITY',
  VALUATION_INTEGRITY: 'VALUATION_INTEGRITY',
  DECISION_READINESS: 'DECISION_READINESS'
};

/**
 * Normalizes and sanitizes financial units across Crores and raw Rupees.
 * Strictly detects and rejects mismatched unit corruption.
 */
export function normalizeAndSanitizeFinancialUnits({ revenue, pat, ebitda }) {
  const sanity = FROZEN_GOVERNANCE_SPEC.financial_sanity_rules;
  let rev = Number(revenue) || 0;
  let p = Number(pat) || 0;
  let eb = Number(ebitda) || 0;

  const rawScale = sanity.raw_rupees_scale_divisor; // 10,000,000
  const maxCrores = sanity.max_normal_crores_threshold; // 50,000

  // Case 1: Both in raw Rupees (>10,000,000) -> Normalize both to Crores
  if (rev > rawScale && p > rawScale) {
    rev /= rawScale;
    p /= rawScale;
    if (eb > rawScale) eb /= rawScale;
    return { isValid: true, revenueCr: rev, patCr: p, ebitdaCr: eb, normalized: true };
  }

  // Case 2: Both in normal Crores (<50,000)
  if (rev < maxCrores && p < maxCrores && eb < maxCrores) {
    // Check if PAT > Revenue (Impossible without exceptional items)
    if (rev > 0 && p > rev) {
      return { isValid: false, reason: 'CORRUPTED_METRIC_PAT_EXCEEDS_REVENUE', revenueCr: rev, patCr: p };
    }
    return { isValid: true, revenueCr: rev, patCr: p, ebitdaCr: eb, normalized: false };
  }

  // Case 3: Mismatched Unit Corruption (e.g. Revenue = 1967 Cr, PAT = 2206100000 Rupees labeled as Cr)
  if (rev < maxCrores && p > rawScale) {
    return {
      isValid: false,
      reason: 'MISMATCHED_UNIT_CORRUPTION_PAT_RAW_RUPEES_VS_REV_CRORES',
      revenueCr: rev,
      patCr: p
    };
  }

  if (rev > rawScale && p < maxCrores) {
    return {
      isValid: false,
      reason: 'MISMATCHED_UNIT_CORRUPTION_REV_RAW_RUPEES_VS_PAT_CRORES',
      revenueCr: rev,
      patCr: p
    };
  }

  return { isValid: false, reason: 'UNRECOGNIZED_UNIT_SCALE', revenueCr: rev, patCr: p };
}

/**
 * Formally asserts point-in-time availability against decision timestamp.
 */
export function verifyPointInTimeAvailability({ quarterEndDate, filingDate, decisionTimestamp }) {
  if (!filingDate) {
    return {
      isAvailable: false,
      reason: 'LOOK_AHEAD_VIOLATION_MISSING_FILING_DATE',
      filingDate: null,
      quarterEndDate,
      decisionTimestamp
    };
  }

  const qEnd = new Date(quarterEndDate);
  const filed = new Date(filingDate);
  const decision = new Date(decisionTimestamp);

  // 1. Filing date cannot precede quarter end date
  if (filed < qEnd) {
    return {
      isAvailable: false,
      reason: 'LOOK_AHEAD_VIOLATION_FILING_PRECEDES_QUARTER_END',
      filingDate,
      quarterEndDate,
      decisionTimestamp
    };
  }

  // 2. Data is only available IF filing date <= decision timestamp
  if (filed > decision) {
    return {
      isAvailable: false,
      reason: 'LOOK_AHEAD_VIOLATION_FILING_AFTER_DECISION_TIMESTAMP',
      filingDate,
      quarterEndDate,
      decisionTimestamp
    };
  }

  return {
    isAvailable: true,
    filingDate,
    quarterEndDate,
    decisionTimestamp
  };
}

/**
 * Calculates mathematically calibrated guidance credibility with asymmetric penalty for quantified misses.
 */
export function calculateCalibratedGuidanceScore(promises = []) {
  const rules = FROZEN_GOVERNANCE_SPEC.guidance_scoring_rules;
  if (!promises || promises.length === 0) {
    return {
      score: rules.default_untracked_score,
      status: 'NO_TRACKED_GUIDANCE',
      completedCount: 0,
      keptCount: 0,
      missedCount: 0,
      overdueCount: 0
    };
  }

  let totalWeight = 0;
  let earnedScore = 0;
  let completedCount = 0;
  let keptCount = 0;
  let missedCount = 0;
  let overdueCount = 0;

  for (const p of promises) {
    const text = (p.promise_text || '').toLowerCase();
    const isQuantified = /\d+%|\d+\s*cr|\d+\s*klpd|\d+\s*units/i.test(text);
    const baseWeight = isQuantified ? rules.quantified_target_base_weight : rules.general_aspiration_base_weight; // 3.0 vs 1.0

    const st = (p.status || '').toUpperCase();
    if (st.includes('KEPT') || st.includes('ACHIEVED')) {
      earnedScore += baseWeight * rules.kept_achievement_multiplier;
      totalWeight += baseWeight;
      completedCount++;
      keptCount++;
    } else if (st.includes('PARTIAL')) {
      earnedScore += baseWeight * rules.partial_achievement_multiplier;
      totalWeight += baseWeight;
      completedCount++;
    } else if (st.includes('MISSED') || st.includes('BROKEN')) {
      earnedScore += 0;
      totalWeight += baseWeight * rules.missed_penalty_multiplier; // 2.0x asymmetric penalty
      completedCount++;
      missedCount++;
    } else if (st.includes('OVERDUE')) {
      earnedScore += 0;
      totalWeight += baseWeight * rules.overdue_penalty_multiplier; // 1.5x penalty
      completedCount++;
      overdueCount++;
    }
  }

  const finalScore = completedCount > 0 && totalWeight > 0
    ? Math.min(100, Math.max(0, Math.round((earnedScore / totalWeight) * 100)))
    : rules.default_untracked_score;

  return {
    score: finalScore,
    status: finalScore >= 80 ? 'HIGH_CREDIBILITY' : finalScore >= 60 ? 'MODERATE_CREDIBILITY' : 'LOW_CREDIBILITY',
    completedCount,
    keptCount,
    missedCount,
    overdueCount
  };
}

/**
 * Executes the full 14-point Research Engine Integrity Audit on a stock evidence card.
 */
export function auditStockResearchIntegrity(card, asOfDateStr = '2026-08-18') {
  const asOfDate = new Date(asOfDateStr);
  const blockingReasons = [];
  const warnings = [];
  let passedDataChecks = 0;
  let totalDataChecks = 6;
  let passedThesisChecks = 0;
  let totalThesisChecks = 4;
  let passedValuationChecks = 0;
  let totalValuationChecks = 4;

  const pitRules = FROZEN_GOVERNANCE_SPEC.point_in_time_rules;
  const sanity = FROZEN_GOVERNANCE_SPEC.financial_sanity_rules;
  const regimes = FROZEN_GOVERNANCE_SPEC.market_regime_thresholds;

  // 1. Price Freshness
  const priceDate = card.price_date ? new Date(card.price_date) : null;
  const priceAgeDays = priceDate ? (asOfDate - priceDate) / (1000 * 60 * 60 * 24) : 999;
  if (!priceDate || priceAgeDays > pitRules.max_price_age_days) {
    blockingReasons.push('PRICE_STALE_OR_MISSING');
  } else {
    passedDataChecks++;
  }

  // 2. Financial Period Freshness
  const qEndDate = card.quarter_end_date ? new Date(card.quarter_end_date) : null;
  const qAgeDays = qEndDate ? (asOfDate - qEndDate) / (1000 * 60 * 60 * 24) : 999;
  let isStale = false;
  if (!qEndDate || qAgeDays > pitRules.max_stale_quarter_days) {
    isStale = true;
    warnings.push(`FINANCIAL_PERIOD_STALE (>${pitRules.max_stale_quarter_days} Days Old)`);
  } else {
    passedDataChecks++;
  }

  // 3. Publication-Date Correctness (No Look-Ahead Bias)
  const pit = verifyPointInTimeAvailability({
    quarterEndDate: card.quarter_end_date,
    filingDate: card.filing_date,
    decisionTimestamp: asOfDateStr
  });
  if (!pit.isAvailable) {
    blockingReasons.push(pit.reason);
  } else {
    passedDataChecks++;
  }

  // 4. Financial-Unit Sanity & Normalization
  const unitNorm = normalizeAndSanitizeFinancialUnits({
    revenue: card.revenue_cr,
    pat: card.pat_cr,
    ebitda: card.ebitda_cr
  });
  if (!unitNorm.isValid) {
    blockingReasons.push(unitNorm.reason);
  } else {
    passedDataChecks++;
  }

  // 5. Revenue / PAT Coherence
  const rev = unitNorm.revenueCr || Number(card.revenue_cr) || 0;
  const pat = unitNorm.patCr || Number(card.pat_cr) || 0;
  if (rev === 0 && pat !== 0) {
    blockingReasons.push('METRIC_INCOHERENCE_REV_ZERO_PAT_NONZERO');
  } else if (rev > 0 && pat > rev) {
    blockingReasons.push('METRIC_INCOHERENCE_PAT_EXCEEDS_REV');
  } else {
    passedDataChecks++;
  }

  // 6. Debt Sanity
  const debt = Number(card.debt_cr) || 0;
  if (debt < 0) {
    blockingReasons.push('NEGATIVE_DEBT_INVALID');
  } else {
    passedDataChecks++;
  }

  // 7. Margin Sanity
  const margin = Number(card.ebitda_margin_pct) || 0;
  if (margin < sanity.min_ebitda_margin_pct || margin > sanity.max_ebitda_margin_pct) {
    blockingReasons.push(`EBITDA_MARGIN_OUT_OF_BOUNDS (${margin}%)`);
  } else if (margin < regimes.margin_collapse_gate_threshold_pct && !card.anomaly_explanation) {
    warnings.push(`EXTREME_MARGIN_COMPRESSION (${margin}%) REQUIRES ANOMALY EXPLANATION`);
    passedThesisChecks++;
  } else {
    passedThesisChecks++;
  }

  // 8. ROCE Sanity
  const roce = Number(card.roce_pct) || 20;
  if (roce < sanity.min_roce_pct || roce > sanity.max_roce_pct) {
    warnings.push(`ROCE_OUT_OF_BOUNDS (${roce}%)`);
  } else {
    passedThesisChecks++;
  }

  // 9. Narrative Inflation Guard (No 'Monopoly' without quantified share)
  const desc = JSON.stringify(card);
  const monopolyRegex = new RegExp(FROZEN_GOVERNANCE_SPEC.narrative_inflation_rules.required_quantified_market_share_regex, 'i');
  if (/monopoly/i.test(desc) && !monopolyRegex.test(desc)) {
    blockingReasons.push('UNSUBSTANTIATED_MONOPOLY_NARRATIVE_INFLATION');
  } else {
    passedThesisChecks++;
  }

  // 10. Guidance Credibility
  const guidanceAudit = calculateCalibratedGuidanceScore(card.promises);
  if (guidanceAudit.score < 50) {
    warnings.push('LOW_MANAGEMENT_GUIDANCE_CREDIBILITY');
  } else {
    passedThesisChecks++;
  }

  // 11. Valuation Decomposition
  if (!card.valuation || card.valuation.reported_pe === undefined || card.valuation.lens2_implied_cagr === undefined) {
    warnings.push('INCOMPLETE_VALUATION_DECOMPOSITION');
  } else {
    passedValuationChecks++;
  }

  // 12. Point-in-Time Availability Provenance
  if (!card.available_to_engine_date) {
    warnings.push('MISSING_AVAILABLE_TO_ENGINE_TIMESTAMP');
  } else {
    passedValuationChecks++;
  }

  // 13. Source Traceability
  if (!card.source_filing) {
    warnings.push('MISSING_SOURCE_FILING_PROVENANCE');
  } else {
    passedValuationChecks++;
  }

  // 14. Action-Rule Traceability & No-Add Governance Guard
  const isAdd = card.action?.includes('ADD') || card.action?.includes('ACCUMULATE');
  const drawdown = Number(card.drawdown_pct) || 0;
  let addAllowed = true;
  let proposedAction = card.action || 'HOLD';

  if (isStale || blockingReasons.length > 0 || margin < regimes.margin_collapse_gate_threshold_pct || drawdown <= regimes.severe_drawdown_pct) {
    addAllowed = false;
    if (isAdd) {
      blockingReasons.push(`ILLEGAL_ADD_SIGNAL_BLOCKED: ADD forbidden under staleness (${isStale}), critical failures (${blockingReasons.length}), margin compression (${margin}%), or drawdown (${drawdown}%)`);
      proposedAction = isStale ? '⚪ UNKNOWN / STALE_DATA_HOLD' : '🟡 TRIM / REVIEW (GATE ACTIVATED)';
    }
  } else {
    passedValuationChecks++;
  }

  return {
    ticker: card.ticker,
    asOfDate: asOfDateStr,
    decisionAllowed: blockingReasons.length === 0,
    addAllowed,
    proposedAction,
    status: FROZEN_GOVERNANCE_SPEC.operational_identity.status,
    blockingReasons,
    warnings,
    checkCoverage: {
      dataChecks: `${passedDataChecks}/${totalDataChecks} PASSED`,
      thesisChecks: `${passedThesisChecks}/${totalThesisChecks} PASSED`,
      valuationChecks: `${passedValuationChecks}/${totalValuationChecks} PASSED`,
      overallStatus: blockingReasons.length === 0 ? 'GOVERNANCE_PASSED' : 'GOVERNANCE_BLOCKED'
    },
    guidanceScore: guidanceAudit.score,
    guidanceStatus: guidanceAudit.status
  };
}
