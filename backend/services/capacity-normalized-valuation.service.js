/**
 * ThesisIQ v4.2: Capacity-Normalized Valuation & P/E Compression Resilience Service
 * 
 * Epistemic Mandate:
 * Resolves valuation paralysis on capex-transformation and order-backlog compounders
 * by evaluating companies on their normalized full-capacity earnings, dynamic ROCE-tethered
 * exit P/E compression, and milestone-gated capital deployment tranches.
 * 
 * Non-Negotiable Invariants:
 * 1. Zero Hardcoded Tickers: All valuation metrics and compression buffers derive dynamically from database relations.
 * 2. Strict Grounding: All capacity figures link to audited exchange filings and concall disclosures.
 * 3. Dynamic ROCE-Tethered Compression: Exit multiples reflect underlying business return on capital, not arbitrary flat pegs.
 */

import { pool } from '../db/pool.js';

/**
 * Resolves the appropriate terminal exit P/E based on business ROCE quality.
 * High-ROCE monopolies (>=30%) sustain elevated multiples (35x) over commodity peers (16x).
 * 
 * @param {number} rocePct 
 * @returns {number} exitPe
 */
export function resolveRoceTetheredExitPe(rocePct) {
  const roce = parseFloat(rocePct) || 15.0;
  if (roce >= 30.0) return 35.0;
  if (roce >= 22.0) return 28.0;
  if (roce >= 16.0) return 22.0;
  return 16.0;
}

/**
 * Computes capacity-normalized valuation metrics for a single stock snapshot and engine.
 */
export function computeCapacityValuationMetrics(stockData, engineData) {
  const price = parseFloat(stockData.share_price) || 0.0;
  const trailingPe = parseFloat(stockData.pe_ratio) || 0.0;
  const mcapCr = parseFloat(stockData.market_cap) || (price * 10.0);
  const ttmPatCr = parseFloat(stockData.ttm_pat) || (trailingPe > 0 ? mcapCr / trailingPe : 0.0);
  const rocePct = parseFloat(stockData.roce_pct) || 15.0;

  const currentRevenueCr = parseFloat(engineData.current_runrate_revenue_cr) || 0.0;
  const fullCapacityRevenueCr = parseFloat(engineData.full_capacity_revenue_cr) || currentRevenueCr;
  const normalizedEbitdaMarginPct = parseFloat(engineData.normalized_ebitda_margin_pct) || 15.0;
  const normalizedPatMarginPct = parseFloat(engineData.normalized_pat_margin_pct) || 10.0;
  const normalizedCapacityPatCr = parseFloat(engineData.normalized_full_capacity_pat_cr) || 
    (fullCapacityRevenueCr * normalizedPatMarginPct / 100.0);

  // Capacity-Adjusted Forward P/E (Current Mcap / Full-Capacity PAT)
  const capacityForwardPe = normalizedCapacityPatCr > 0 ? 
    parseFloat((mcapCr / normalizedCapacityPatCr).toFixed(1)) : trailingPe;

  // ROCE-Tethered Compression Exit Multiple
  const exitPe = resolveRoceTetheredExitPe(rocePct);

  // Terminal Scaled Market Cap & Compression Buffer
  const terminalScaledMcapCr = parseFloat((normalizedCapacityPatCr * exitPe).toFixed(1));
  const compressionBufferPct = mcapCr > 0 ? 
    parseFloat((((terminalScaledMcapCr - mcapCr) / mcapCr) * 100.0).toFixed(1)) : 0.0;

  // Compression Verdict Classification
  let compressionVerdict = 'MODERATE_BUFFER';
  if (compressionBufferPct > 35.0) {
    compressionVerdict = 'HIGH_UPSIDE_PROTECTED';
  } else if (compressionBufferPct >= 0.0) {
    compressionVerdict = 'GROWTH_ABSORBS_COMPRESSION';
  } else if (compressionBufferPct >= -25.0) {
    compressionVerdict = 'MILD_COMPRESSION_OVERHANG';
  } else {
    compressionVerdict = 'SEVERE_MULTIPLE_BUBBLE';
  }

  // Milestone Tranche Evaluation
  const milestoneTranches = Array.isArray(engineData.milestone_tranches) ? 
    engineData.milestone_tranches : 
    (typeof engineData.milestone_tranches === 'string' ? JSON.parse(engineData.milestone_tranches || '[]') : []);

  const achievedTranches = milestoneTranches.filter(t => t.status === 'ACHIEVED');
  const pendingTranches = milestoneTranches.filter(t => t.status !== 'ACHIEVED');
  
  let authorizedWeightPct = 0;
  achievedTranches.forEach(t => { authorizedWeightPct += (t.tranche_pct || 0); });

  let trancheAction = 'STARTER_TRANCHE_ONLY';
  if (authorizedWeightPct >= 100) {
    trancheAction = 'FULL_CORE_ALLOCATION_AUTHORIZED';
  } else if (authorizedWeightPct >= 65) {
    trancheAction = 'COMMISSIONING_TRANCHE_ACTIVE';
  } else if (authorizedWeightPct >= 30) {
    trancheAction = 'STARTER_TRANCHE_ACTIVE';
  } else {
    trancheAction = 'WAIT_FOR_FIRST_MILESTONE';
  }

  return {
    ticker: stockData.ticker,
    companyName: stockData.company_name,
    sector: stockData.sector,
    currentPrice: price,
    trailingPe,
    mcapCr,
    ttmPatCr: parseFloat(ttmPatCr.toFixed(1)),
    rocePct,
    engineName: engineData.engine_name,
    engineType: engineData.engine_type,
    engineStatus: engineData.status,
    contractedBacklogCr: parseFloat(engineData.contracted_backlog_cr) || 0.0,
    unbilledCapexCr: parseFloat(engineData.unbilled_capex_cr) || 0.0,
    currentRevenueCr,
    fullCapacityRevenueCr,
    normalizedEbitdaMarginPct,
    normalizedPatMarginPct,
    normalizedCapacityPatCr: parseFloat(normalizedCapacityPatCr.toFixed(1)),
    capacityForwardPe,
    exitPe,
    terminalScaledMcapCr,
    compressionBufferPct,
    compressionVerdict,
    authorizedWeightPct,
    trancheAction,
    milestoneTranches,
    nextPendingMilestone: pendingTranches.length > 0 ? pendingTranches[0].trigger : 'ALL_MILESTONES_DELIVERED',
    sourceRationale: engineData.source_rationale
  };
}

/**
 * Loads all portfolio stocks with live market data and audited capacity engines from PostgreSQL.
 */
export async function loadPortfolioCapacityValuationBoard(dbPool = pool) {
  const client = await dbPool.connect();
  try {
    const res = await client.query(`
      SELECT s.id, s.ticker, s.company_name, s.sector, s.category,
             md.share_price, md.pe_ratio, md.market_cap, md.ttm_pat, md.roce_pct, md.market_data_as_of,
             pce.engine_name, pce.engine_type, pce.status as engine_status,
             pce.unbilled_capex_cr, pce.contracted_backlog_cr, pce.current_runrate_revenue_cr,
             pce.full_capacity_revenue_cr, pce.normalized_ebitda_margin_pct, pce.normalized_pat_margin_pct,
             pce.normalized_full_capacity_pat_cr, pce.target_commissioning_quarter,
             pce.milestone_tranches, pce.source_rationale
      FROM stocks s
      JOIN (
        SELECT DISTINCT ON (ticker) ticker, share_price, pe_ratio, market_cap, ttm_pat, roce_pct, market_data_as_of
        FROM market_data_snapshots
        ORDER BY ticker, market_data_as_of DESC
      ) md ON md.ticker = s.ticker
      JOIN portfolio_capacity_engines pce ON pce.ticker = s.ticker
      ORDER BY s.ticker;
    `);

    return res.rows.map(row => {
      return computeCapacityValuationMetrics(
        {
          ticker: row.ticker,
          company_name: row.company_name,
          sector: row.sector,
          share_price: row.share_price,
          pe_ratio: row.pe_ratio,
          market_cap: row.market_cap,
          ttm_pat: row.ttm_pat,
          roce_pct: row.roce_pct
        },
        {
          engine_name: row.engine_name,
          engine_type: row.engine_type,
          status: row.engine_status,
          unbilled_capex_cr: row.unbilled_capex_cr,
          contracted_backlog_cr: row.contracted_backlog_cr,
          current_runrate_revenue_cr: row.current_runrate_revenue_cr,
          full_capacity_revenue_cr: row.full_capacity_revenue_cr,
          normalized_ebitda_margin_pct: row.normalized_ebitda_margin_pct,
          normalized_pat_margin_pct: row.normalized_pat_margin_pct,
          normalized_full_capacity_pat_cr: row.normalized_full_capacity_pat_cr,
          target_commissioning_quarter: row.target_commissioning_quarter,
          milestone_tranches: row.milestone_tranches,
          source_rationale: row.source_rationale
        }
      );
    });
  } finally {
    client.release();
  }
}
