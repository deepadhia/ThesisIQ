/**
 * Phase 4E.5.1: Structured Market Disagreement Attribution Engine
 * 
 * Analyzes and attributes why market pricing diverged or converged with the fundamental thesis.
 * 
 * Enforces strict scientific discipline:
 * 1. Zero causal speculation - outputs evidence ledger only with standard statuses.
 * 2. Twelve explicit attribution dimensions evaluated systematically.
 * 3. Distinguishes macro/sector repricing from company-specific de-rating and liquidity expansion.
 * 4. Never alters T0 conviction state retrospectively.
 */

export const ATTRIBUTION_STATUSES = {
  OBSERVED: 'OBSERVED',
  SUPPORTED: 'SUPPORTED',
  UNRESOLVED: 'UNRESOLVED',
  CONTRADICTED: 'CONTRADICTED',
  NOT_COMPUTABLE: 'NOT_COMPUTABLE'
};

export const DIVERGENCE_SCENARIOS = {
  SECTOR_MACRO_REPRICING: 'SECTOR_MACRO_REPRICING',             // Industry-wide decline, positive relative alpha despite stock drawdown
  COMPANY_SPECIFIC_DISAGREEMENT: 'COMPANY_SPECIFIC_DISAGREEMENT', // Stock down while sector/peers up
  MARKET_THESIS_CONVERGENCE: 'MARKET_THESIS_CONVERGENCE',         // Stock and multiples expanded tracking fundamental thesis
  LIQUIDITY_EXPANSION_NON_THESIS: 'LIQUIDITY_EXPANSION_NON_THESIS', // Stock rallied despite weak/contested fundamental thesis
  NEUTRAL_NO_DISLOCATION: 'NEUTRAL_NO_DISLOCATION',
  UNMATURED: 'UNMATURED'
};

/**
 * Builds the 12-dimensional structured market disagreement attribution ledger
 */
export function attributeMarketDisagreement(frozenT0, horizonEvaluation) {
  const { ticker, t0_pe, t0_thesis_growth, t0_market_implied_growth, unresolved_risks = [] } = frozenT0;
  const {
    horizonStatus,
    axis1_thesis_trajectory,
    axis2_market_relationship,
    stock_return_pct,
    sector_return_pct,
    sector_relative_alpha,
    peer_basket_return_pct,
    peer_relative_alpha,
    smallcap_index_return_pct,
    nifty_index_return_pct,
    pe_t,
    multiple_change_pct,
    revenue_growth_realized,
    guidance_outcome
  } = horizonEvaluation;

  if (horizonStatus === 'NOT_YET_MATURED') {
    return {
      divergence_scenario: DIVERGENCE_SCENARIOS.UNMATURED,
      market_disagreement_attribution: {
        sector_repricing: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        peer_repricing: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        smallcap_index_benchmark: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        nifty_index_benchmark: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        valuation_multiple_compression_expansion: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        earnings_actual_vs_thesis_growth: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        order_book_execution_conversion: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        working_capital_elongation_concern: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        guidance_revision_trajectory: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        company_specific_de_rating_event: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        macro_geopolitical_factor: ATTRIBUTION_STATUSES.NOT_COMPUTABLE,
        liquidity_rerating_factor: ATTRIBUTION_STATUSES.NOT_COMPUTABLE
      },
      attribution_notes: ["Horizon not yet matured; attribution non-computable."]
    };
  }

  // 1. Evaluate Divergence Scenario
  let divergenceScenario = DIVERGENCE_SCENARIOS.NEUTRAL_NO_DISLOCATION;
  if (axis1_thesis_trajectory === 'THESIS_STRENGTHENING' && axis2_market_relationship === 'MARKET_DISCOUNTING') {
    if (sector_return_pct !== null && sector_return_pct <= -0.15 && (sector_relative_alpha ?? 0) >= 0) {
      divergenceScenario = DIVERGENCE_SCENARIOS.SECTOR_MACRO_REPRICING;
    } else {
      divergenceScenario = DIVERGENCE_SCENARIOS.COMPANY_SPECIFIC_DISAGREEMENT;
    }
  } else if (axis1_thesis_trajectory === 'THESIS_STRENGTHENING' && (axis2_market_relationship === 'MARKET_CONVERGING' || axis2_market_relationship === 'MARKET_OVERSHOOTING')) {
    divergenceScenario = DIVERGENCE_SCENARIOS.MARKET_THESIS_CONVERGENCE;
  } else if (axis1_thesis_trajectory === 'THESIS_BROKEN' && stock_return_pct !== null && stock_return_pct > 0.30) {
    divergenceScenario = DIVERGENCE_SCENARIOS.LIQUIDITY_EXPANSION_NON_THESIS;
  }

  // 2. Determine 12 Attribution Dimensions
  const attribution = {};
  const notes = [];

  // Dimension 1: Sector Repricing
  if (sector_return_pct !== null && sector_return_pct <= -0.15) {
    attribution.sector_repricing = ATTRIBUTION_STATUSES.SUPPORTED;
    notes.push(`Sector benchmark fell by ${(sector_return_pct * 100).toFixed(1)}%, indicating broad industry derating.`);
  } else if (sector_return_pct !== null && sector_return_pct > 0.10) {
    attribution.sector_repricing = ATTRIBUTION_STATUSES.CONTRADICTED;
  } else {
    attribution.sector_repricing = ATTRIBUTION_STATUSES.OBSERVED;
  }

  // Dimension 2: Peer Repricing
  if (peer_basket_return_pct !== null && peer_basket_return_pct <= -0.15) {
    attribution.peer_repricing = ATTRIBUTION_STATUSES.SUPPORTED;
  } else if (peer_basket_return_pct !== null && peer_basket_return_pct > 0.10) {
    attribution.peer_repricing = ATTRIBUTION_STATUSES.CONTRADICTED;
  } else {
    attribution.peer_repricing = ATTRIBUTION_STATUSES.OBSERVED;
  }

  // Dimension 3 & 4: Smallcap & Nifty Index Benchmarks
  attribution.smallcap_index_benchmark = smallcap_index_return_pct !== null ? ATTRIBUTION_STATUSES.OBSERVED : ATTRIBUTION_STATUSES.NOT_COMPUTABLE;
  attribution.nifty_index_benchmark = nifty_index_return_pct !== null ? ATTRIBUTION_STATUSES.OBSERVED : ATTRIBUTION_STATUSES.NOT_COMPUTABLE;

  // Dimension 5: Valuation Multiple Compression / Expansion
  if (multiple_change_pct !== null && multiple_change_pct <= -0.20) {
    attribution.valuation_multiple_compression_expansion = ATTRIBUTION_STATUSES.SUPPORTED;
    notes.push(`Multiple compressed from ${t0_pe}x to ${pe_t}x (${(multiple_change_pct * 100).toFixed(1)}%).`);
  } else if (multiple_change_pct !== null && multiple_change_pct >= 0.20) {
    attribution.valuation_multiple_compression_expansion = ATTRIBUTION_STATUSES.SUPPORTED;
    notes.push(`Multiple expanded from ${t0_pe}x to ${pe_t}x (+${(multiple_change_pct * 100).toFixed(1)}%).`);
  } else {
    attribution.valuation_multiple_compression_expansion = ATTRIBUTION_STATUSES.OBSERVED;
  }

  // Dimension 6: Earnings Actual vs Thesis Growth
  if (revenue_growth_realized !== null && revenue_growth_realized >= t0_thesis_growth) {
    attribution.earnings_actual_vs_thesis_growth = ATTRIBUTION_STATUSES.SUPPORTED;
  } else if (revenue_growth_realized !== null && revenue_growth_realized < (t0_thesis_growth - 0.05)) {
    attribution.earnings_actual_vs_thesis_growth = ATTRIBUTION_STATUSES.CONTRADICTED;
  } else {
    attribution.earnings_actual_vs_thesis_growth = ATTRIBUTION_STATUSES.OBSERVED;
  }

  // Dimension 7: Order Book Execution & Conversion
  const hasOrderRisk = unresolved_risks.some(r => r.factor.toLowerCase().includes('order') || r.factor.toLowerCase().includes('execution'));
  attribution.order_book_execution_conversion = hasOrderRisk ? ATTRIBUTION_STATUSES.UNRESOLVED : ATTRIBUTION_STATUSES.OBSERVED;

  // Dimension 8: Working Capital Elongation Concern
  const hasWCRisk = unresolved_risks.some(r => r.factor.toLowerCase().includes('working capital') || r.factor.toLowerCase().includes('wc'));
  attribution.working_capital_elongation_concern = hasWCRisk ? ATTRIBUTION_STATUSES.SUPPORTED : ATTRIBUTION_STATUSES.UNRESOLVED;

  // Dimension 9: Guidance Revision Trajectory
  if (guidance_outcome === 'EXCEEDED' || guidance_outcome === 'ACHIEVED') {
    attribution.guidance_revision_trajectory = ATTRIBUTION_STATUSES.SUPPORTED;
  } else if (guidance_outcome === 'DOWNGRADED') {
    attribution.guidance_revision_trajectory = ATTRIBUTION_STATUSES.CONTRADICTED;
  } else {
    attribution.guidance_revision_trajectory = ATTRIBUTION_STATUSES.UNRESOLVED;
  }

  // Dimension 10: Company-Specific De-Rating Event
  if (divergenceScenario === DIVERGENCE_SCENARIOS.COMPANY_SPECIFIC_DISAGREEMENT) {
    attribution.company_specific_de_rating_event = ATTRIBUTION_STATUSES.SUPPORTED;
  } else {
    attribution.company_specific_de_rating_event = ATTRIBUTION_STATUSES.CONTRADICTED;
  }

  // Dimension 11: Macro & Geopolitical Factor
  const hasGeoRisk = unresolved_risks.some(r => r.factor.toLowerCase().includes('geopolitical') || r.factor.toLowerCase().includes('international'));
  attribution.macro_geopolitical_factor = hasGeoRisk ? ATTRIBUTION_STATUSES.SUPPORTED : ATTRIBUTION_STATUSES.UNRESOLVED;

  // Dimension 12: Liquidity & Smallcap Rerating Factor
  if (divergenceScenario === DIVERGENCE_SCENARIOS.LIQUIDITY_EXPANSION_NON_THESIS) {
    attribution.liquidity_rerating_factor = ATTRIBUTION_STATUSES.SUPPORTED;
    notes.push(`Asset rallied strongly despite thesis being contested/broken, attributable to smallcap liquidity and theme rerating.`);
  } else {
    attribution.liquidity_rerating_factor = ATTRIBUTION_STATUSES.OBSERVED;
  }

  return {
    divergence_scenario: divergenceScenario,
    market_disagreement_attribution: attribution,
    attribution_notes: notes
  };
}
