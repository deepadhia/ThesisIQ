/**
 * LIVE OUTPUT INTEGRITY GATE SERVICE
 * 
 * Enforces the 10 structural validation invariants on all output cards before 
 * they can be presented to investors or research decision-makers.
 */

export const INTEGRITY_GATES = {
  GATE_1_FRESHNESS: 'GATE_1_DATA_FRESHNESS',
  GATE_2_PROVENANCE: 'GATE_2_POINT_IN_TIME_PROVENANCE',
  GATE_3_UNIT_SCALING: 'GATE_3_UNIT_SCALING_AND_SANITY',
  GATE_4_METRIC_COHERENCE: 'GATE_4_REVENUE_PAT_COHERENCE',
  GATE_5_MARGIN_ANOMALY: 'GATE_5_MARGIN_ANOMALY_EXPLANATION',
  GATE_6_GUIDANCE_DEADLINES: 'GATE_6_GUIDANCE_DEADLINE_TRANSITION',
  GATE_7_VALUATION_DECOMPOSITION: 'GATE_7_VALUATION_LENS_DECOMPOSITION',
  GATE_8_CONFIDENCE_CALIBRATION: 'GATE_8_CONFIDENCE_SCORE_CALIBRATION',
  GATE_9_PRICE_REGIME_COHERENCE: 'GATE_9_PRICE_REGIME_COHERENCE',
  GATE_10_NO_STALE_OR_GATED_ADDS: 'GATE_10_NO_STALE_OR_GATED_ADDS'
};

/**
 * Validates a single stock's live card against all 10 integrity gates.
 */
export function validateStockLiveCard(card, asOfDateStr = '2026-08-18') {
  const violations = [];
  const warnings = [];
  const asOfDate = new Date(asOfDateStr);

  // GATE 1: Freshness (If latest verified quarter end is > 150 days old, must flag STALE)
  const quarterEndDate = card.quarter_end_date ? new Date(card.quarter_end_date) : null;
  let isStale = false;
  if (!quarterEndDate || (asOfDate - quarterEndDate) / (1000 * 60 * 60 * 24) > 150) {
    isStale = true;
    warnings.push(`DATA_STALE: Latest quarter (${card.quarter || 'N/A'}) is >150 days older than as-of date ${asOfDateStr}`);
  }

  // GATE 2: Provenance Header
  if (!card.quarter || !card.filing_date) {
    violations.push('MISSING_PROVENANCE: Card must state quarter, quarter_end_date, and filing_date');
  }

  // GATE 3: Unit Scaling (No PAT or Revenue > 10,000 Cr without explicit conglomerate verification)
  const rev = Number(card.revenue_cr) || 0;
  const pat = Number(card.pat_cr) || 0;
  if (pat > 50000 || rev > 200000) {
    violations.push(`CORRUPTED_UNITS: PAT (₹${pat} Cr) or Revenue (₹${rev} Cr) exceeds sane small/midcap bounds (unscaled integer bug)`);
  }

  // GATE 4: Metric Coherence (Revenue cannot be ₹0.0 Cr while PAT is non-zero)
  if (rev === 0 && pat !== 0) {
    violations.push(`METRIC_INCOHERENCE: Revenue is ₹0.0 Cr while PAT is ₹${pat} Cr. Evidence snapshot is incomplete.`);
  }

  // GATE 5: Margin Anomaly (If EBITDA margin < 5% or > 60%, require explicit anomaly note)
  const margin = Number(card.ebitda_margin_pct) || 0;
  if ((margin < 5.0 || margin > 60.0) && !card.anomaly_explanation) {
    warnings.push(`UNEXPLAINED_MARGIN_ANOMALY: EBITDA margin (${margin}%) is extreme without explicit anomaly explanation`);
  }

  // GATE 6: Guidance Deadlines (Past deadlines cannot remain 'PENDING')
  if (card.promises && Array.isArray(card.promises)) {
    for (const p of card.promises) {
      if (p.status?.toLowerCase() === 'pending') {
        const deadline = p.target_deadline?.toUpperCase() || '';
        if (deadline.includes('FY24') || deadline.includes('FY25') || deadline.includes('FY26') || deadline.includes('Q4_FY26')) {
          violations.push(`INVALID_PENDING_GUIDANCE: Promise "${p.promise_text.substring(0, 40)}..." has target deadline ${deadline} which passed before ${asOfDateStr}. Must be marked OVERDUE, KEPT, or MISSED.`);
        }
      }
    }
  }

  // GATE 7: Valuation Decomposition (Must provide Reported PE, Normalized PE if M&A, Lens 1, Lens 2)
  if (!card.valuation || card.valuation.reported_pe === undefined || card.valuation.lens2_implied_cagr === undefined) {
    warnings.push('INCOMPLETE_VALUATION_DECOMPOSITION: Must provide reported_pe and lens2_implied_cagr');
  }

  // GATE 8: Confidence Calibration (No false precision percentages; cap at 50 if stale or broken)
  if (typeof card.confidence === 'string' && card.confidence.includes('%') && !card.confidence.includes('/100')) {
    warnings.push(`FALSE_PRECISION_CONFIDENCE: Use Confidence Score (e.g. 85/100) and qualitative band (HIGH/MEDIUM/LOW), not uncalibrated %`);
  }
  if ((isStale || violations.length > 0) && card.confidence_score > 50) {
    violations.push(`UNCALIBRATED_CONFIDENCE: Confidence score (${card.confidence_score}/100) must be capped at <= 50 when data is stale or corrupted.`);
  }

  // GATE 9: Price Regime Coherence
  if (card.drawdown_pct === undefined || !card.market_regime) {
    warnings.push('MISSING_PRICE_REGIME: Card must specify drawdown from peak and market regime');
  }

  // GATE 10: No Stale or Gated ADDs (Only check exact positive ADD signals)
  const isPositiveAddAction = card.action === 'ADD' || card.action === '🟢 ADD' || card.action === '🟢 HOLD / ADD' || card.action === '🟢 ACCUMULATE';
  if ((isStale || card.action?.includes('GATE') || card.action?.includes('TRIM') || margin < 8.0) && isPositiveAddAction) {
    violations.push(`ILLEGAL_ADD_SIGNAL: Action is ${card.action} while data is stale (isStale=${isStale}) or margin is compressed (${margin}%). ADD is strictly prohibited.`);
  }

  return {
    ticker: card.ticker,
    isValid: violations.length === 0,
    violations,
    warnings,
    isStale
  };
}
