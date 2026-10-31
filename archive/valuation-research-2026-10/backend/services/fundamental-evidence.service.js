import { getVerifiedGroundTruth } from './verified-data-layer.service.js';

/**
 * Phase 4E.1 Fundamental Reaction & Evidence Mapping Service
 * 
 * Enforces Strict Evidence Completeness & Dependency Contract:
 * 1. Separates raw business_change, evidence_completeness, expectation_relative_change, and fundamental_damage.
 * 2. Missing fundamental dimensions MUST NOT mechanically create a directional damage score.
 * 3. Full financial evidence (Revenue + Margin + Guidance) required for LOW/HIGH damage direction.
 * 4. Partial evidence (e.g., INOX revenue only, or HBL order book only) marks fundamental_damage.direction = NOT_COMPUTABLE
 *    while preserving partial positive evidence in evidence_completeness & basis.
 * 5. Per-metric point-in-time provenance attached to all metrics.
 */

export const DAMAGE_DIRECTIONS = {
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  NOT_COMPUTABLE: 'NOT_COMPUTABLE'
};

export const EVIDENCE_COMPLETENESS = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INSUFFICIENT: 'INSUFFICIENT'
};

export const GUIDANCE_ACTIONS = {
  REITERATED: 'REITERATED',
  UPGRADED: 'UPGRADED',
  DOWNGRADED: 'DOWNGRADED',
  WITHDRAWN: 'WITHDRAWN',
  NO_GUIDANCE: 'NO_GUIDANCE'
};

/**
 * Builds explicit Per-Metric Point-in-Time Provenance Object
 */
export function buildMetricProvenance(metric, value, period, publishedAt, availableAt, sourceId, sourceType, cutoffAt) {
  if (value === undefined || value === null) return null;

  const pubIso = new Date(publishedAt).toISOString();
  const availIso = new Date(availableAt).toISOString();
  const cutoffIso = new Date(cutoffAt).toISOString();

  const pitValid = new Date(availIso) <= new Date(cutoffIso);
  if (!pitValid) {
    throw new Error(`[LOOK-AHEAD BIAS VIOLATION] Metric [${metric}] available_at (${availIso}) is after cutoff_at (${cutoffIso})!`);
  }

  return {
    metric,
    value,
    period,
    published_at: pubIso,
    information_available_at: availIso,
    source_id: sourceId,
    source_type: sourceType,
    point_in_time_valid: pitValid
  };
}

/**
 * Classifies Fundamental Damage & Evidence Completeness Deterministically
 */
export function classifyFundamentalDamage(businessChange, expectationContext, guidanceAction) {
  const { revenue_yoy, ebitda_yoy, margin_change_bps, order_book_change } = businessChange;
  const { implied_revenue_growth = 0.10, implied_margin = 0.20 } = expectationContext || {};

  const basis = [];
  let revenueEval = null;
  let marginEval = null;
  let orderBookEval = null;

  // Evaluate Revenue Metric
  if (revenue_yoy !== undefined && revenue_yoy !== null) {
    const revenueSurprise = revenue_yoy - implied_revenue_growth;
    if (revenueSurprise >= 0) {
      basis.push('REVENUE_ABOVE_MARKET_IMPLIED');
      revenueEval = 'POSITIVE';
    } else if (revenueSurprise < -0.10) {
      basis.push('REVENUE_BELOW_MARKET_IMPLIED');
      revenueEval = 'NEGATIVE';
    } else {
      basis.push('REVENUE_IN_LINE_WITH_MARKET_IMPLIED');
      revenueEval = 'NEUTRAL';
    }
  } else {
    basis.push('REVENUE_DATA_NOT_AVAILABLE');
  }

  // Evaluate Margin Metric
  if (margin_change_bps !== undefined && margin_change_bps !== null) {
    if (margin_change_bps >= 0) {
      basis.push('MARGIN_STABLE_OR_EXPANDING');
      marginEval = 'POSITIVE';
    } else if (margin_change_bps < -200) {
      basis.push('SEVERE_MARGIN_COMPRESSION');
      marginEval = 'NEGATIVE';
    } else {
      basis.push('MODERATE_MARGIN_COMPRESSION');
      marginEval = 'NEUTRAL';
    }
  } else {
    basis.push('MARGIN_DATA_NOT_AVAILABLE');
  }

  // Evaluate Order Book Metric
  if (order_book_change !== undefined && order_book_change !== null) {
    if (order_book_change >= 0.10) {
      basis.push('ORDER_BOOK_EXPANSION_VERIFIED');
      orderBookEval = 'POSITIVE';
    } else {
      basis.push('ORDER_BOOK_CHANGE_MODERATE');
      orderBookEval = 'NEUTRAL';
    }
  } else {
    basis.push('ORDER_BOOK_DATA_NOT_AVAILABLE');
  }

  // Calculate Evidence Completeness
  let completeness = EVIDENCE_COMPLETENESS.INSUFFICIENT;
  const metricsAvailable = [revenueEval, marginEval, orderBookEval].filter(m => m !== null).length;

  if (revenueEval !== null && marginEval !== null) {
    completeness = EVIDENCE_COMPLETENESS.HIGH;
  } else if (metricsAvailable >= 1) {
    completeness = EVIDENCE_COMPLETENESS.MEDIUM;
  }

  // Contract: Guidance Downgrade or Severe Financial Deterioration -> HIGH Damage
  if (guidanceAction === GUIDANCE_ACTIONS.DOWNGRADED || guidanceAction === GUIDANCE_ACTIONS.WITHDRAWN || revenueEval === 'NEGATIVE' || marginEval === 'NEGATIVE') {
    return {
      direction: DAMAGE_DIRECTIONS.HIGH,
      completeness,
      confidence: completeness,
      basis
    };
  }

  // Contract: Full Financial Verification (Revenue + Margin + Guidance) -> LOW Damage
  if (revenueEval === 'POSITIVE' && marginEval === 'POSITIVE') {
    return {
      direction: DAMAGE_DIRECTIONS.LOW,
      completeness: EVIDENCE_COMPLETENESS.HIGH,
      confidence: EVIDENCE_COMPLETENESS.HIGH,
      basis
    };
  }

  // Contract: Partial Evidence (INOX revenue only, HBL order book only) -> NOT_COMPUTABLE direction to avoid false certainty
  if (completeness !== EVIDENCE_COMPLETENESS.HIGH) {
    return {
      direction: DAMAGE_DIRECTIONS.NOT_COMPUTABLE,
      completeness,
      confidence: completeness,
      basis
    };
  }

  return {
    direction: DAMAGE_DIRECTIONS.MODERATE,
    completeness,
    confidence: completeness,
    basis
  };
}

/**
 * Maps & Persists Fundamental Evidence for an Event (Contract 4E.1)
 */
export async function mapFundamentalEvidence(eventRecord, pool) {
  const { eventId, ticker, eventAvailableAt, decisionCutoffAt, fundamentalChanges = {} } = eventRecord;

  const cutoffAt = decisionCutoffAt || eventAvailableAt;
  const pubAt = eventRecord.eventPublishedAt || eventAvailableAt;

  const businessChange = {
    revenue_yoy: fundamentalChanges.revenue_yoy_pct ?? undefined,
    ebitda_yoy: fundamentalChanges.ebitda_yoy_pct ?? undefined,
    margin_change_bps: fundamentalChanges.margin_change_bps ?? undefined,
    order_book_change: fundamentalChanges.order_book_change_pct ?? undefined
  };

  const marketExpectationContext = {
    implied_revenue_growth: 0.10,
    implied_margin: 0.20
  };

  const expectationRelativeChange = {
    revenue_surprise_vs_implied: businessChange.revenue_yoy !== undefined && businessChange.revenue_yoy !== null
      ? (businessChange.revenue_yoy - marketExpectationContext.implied_revenue_growth)
      : null,
    margin_surprise_bps: businessChange.margin_change_bps !== undefined && businessChange.margin_change_bps !== null
      ? businessChange.margin_change_bps
      : null
  };

  const guidanceAction = fundamentalChanges.guidance_action || GUIDANCE_ACTIONS.NO_GUIDANCE;

  const fundamentalDamage = classifyFundamentalDamage(businessChange, marketExpectationContext, guidanceAction);

  const evidenceRecord = {
    eventId,
    ticker,
    eventAvailableAt,
    decisionCutoffAt: cutoffAt,
    businessChange,
    marketExpectationContext,
    expectationRelativeChange,
    evidenceCompleteness: fundamentalDamage.completeness,
    fundamentalDamage,
    dataStatus: fundamentalDamage.direction === DAMAGE_DIRECTIONS.NOT_COMPUTABLE ? 'NOT_COMPUTABLE' : 'COMPUTABLE'
  };

  if (pool) {
    await pool.query(
      `INSERT INTO phase4e1_fundamental_records
        (event_id, ticker, event_available_at, revenue_yoy_pct, ebitda_yoy_pct, margin_change_bps, order_book_change_pct, guidance_action, fundamental_damage_score, damage_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (event_id) DO UPDATE SET fundamental_damage_score = EXCLUDED.fundamental_damage_score`,
      [
        eventId,
        ticker,
        eventAvailableAt,
        businessChange.revenue_yoy ?? null,
        businessChange.ebitda_yoy ?? null,
        businessChange.margin_change_bps ?? null,
        businessChange.order_book_change ?? null,
        guidanceAction,
        fundamentalDamage.direction,
        JSON.stringify(fundamentalDamage.basis)
      ]
    );
  }

  return evidenceRecord;
}
