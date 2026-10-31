import { getMarketDataSnapshot } from './market-data-layer.service.js';

/**
 * Phase 4B: Dual Market Expectations & Required Return Engine
 * 
 * Engine A: Investor Required Return Model (REQUIRED_RETURN_GROWTH_MODEL)
 *   Answers: "If I demand investor hurdle rate r (e.g. 20%), what EPS/Revenue growth is required?"
 * 
 * Engine B: True Market-Implied Expectations Model (TRUE_MARKET_IMPLIED_EXPECTATIONS_MODEL)
 *   Answers: "Given today's share price P0, baseline EPS0, cost of capital r_discount, and terminal P/E,
 *            what operational growth g_market is today's stock price ALREADY PRICING IN?"
 */

/**
 * Engine A: Investor Required Return Model
 */
export function calculateInvestorRequiredReturnModel(params) {
  const {
    sharePrice,
    baselineSharesOutstanding,
    baselineEps,
    baselineRevenue,
    baselineNetMarginPct,
    holdingPeriodYears = 5,
    investorRequiredCagrPct = 20.0,
    assumedTerminalPe,
    assumedTerminalNetMarginPct,
    assumedDilutionPct = 0.0
  } = params;

  const P0 = parseFloat(sharePrice);
  const S0 = parseFloat(baselineSharesOutstanding);
  const EPS0 = parseFloat(baselineEps);
  const R0 = parseFloat(baselineRevenue);
  const M0 = parseFloat(baselineNetMarginPct);
  const N = parseInt(holdingPeriodYears, 10);
  const r = parseFloat(investorRequiredCagrPct) / 100.0;
  const PE_term = parseFloat(assumedTerminalPe);
  const M_term = parseFloat(assumedTerminalNetMarginPct) / 100.0;
  const dilution = parseFloat(assumedDilutionPct) / 100.0;

  if (isNaN(P0) || P0 <= 0 || isNaN(S0) || S0 <= 0 || isNaN(EPS0) || EPS0 <= 0 || isNaN(R0) || R0 <= 0 || isNaN(N) || N <= 0 || isNaN(PE_term) || PE_term <= 0 || isNaN(M_term) || M_term <= 0) {
    return { isValid: false, errorCode: "MALFORMED_INPUT", errorMessage: "Invalid inputs for Investor Required Return Model." };
  }

  const currentEquityValue = P0 * S0;
  const requiredTerminalEquityValue = currentEquityValue * Math.pow(1 + r, N);
  const assumedTerminalSharesOutstanding = S0 * (1 + dilution);
  const requiredTerminalPat = requiredTerminalEquityValue / PE_term;
  const requiredTerminalEps = requiredTerminalPat / assumedTerminalSharesOutstanding;
  const requiredEpsCagrPct = (Math.pow(requiredTerminalEps / EPS0, 1.0 / N) - 1) * 100.0;
  const requiredTerminalRevenue = requiredTerminalPat / M_term;
  const requiredRevenueCagrPct = (Math.pow(requiredTerminalRevenue / R0, 1.0 / N) - 1) * 100.0;

  return {
    isValid: true,
    modelType: "REQUIRED_RETURN_GROWTH_MODEL",
    inputs: { sharePrice: P0, baselineSharesOutstanding: S0, baselineEps: EPS0, baselineRevenue: R0, investorRequiredCagrPct: r * 100.0, assumedTerminalPe: PE_term, assumedTerminalNetMarginPct: M_term * 100.0, assumedDilutionPct: dilution * 100.0 },
    intermediateValues: { currentEquityValue: parseFloat(currentEquityValue.toFixed(2)), requiredTerminalEquityValue: parseFloat(requiredTerminalEquityValue.toFixed(2)), assumedTerminalSharesOutstanding: parseFloat(assumedTerminalSharesOutstanding.toFixed(2)), requiredTerminalPat: parseFloat(requiredTerminalPat.toFixed(2)), requiredTerminalEps: parseFloat(requiredTerminalEps.toFixed(2)), requiredTerminalRevenue: parseFloat(requiredTerminalRevenue.toFixed(2)) },
    outputs: { requiredTerminalEps: parseFloat(requiredTerminalEps.toFixed(2)), requiredEpsCagrPct: parseFloat(requiredEpsCagrPct.toFixed(2)), requiredTerminalRevenue: parseFloat(requiredTerminalRevenue.toFixed(2)), requiredRevenueCagrPct: parseFloat(requiredRevenueCagrPct.toFixed(2)) }
  };
}

/**
 * Engine B: True Market-Implied Expectations Model
 * Solves: P0 = (EPS0 * (1 + g_market)^N * PE_term) / (1 + r_discount)^N
 * => g_market = ((P0 * (1 + r_discount)^N) / (EPS0 * PE_term))^(1/N) - 1
 */
export function calculateTrueMarketImpliedExpectationsModel(params) {
  const {
    sharePrice,
    baselineSharesOutstanding,
    baselineEps,
    baselineRevenue,
    baselineNetMarginPct,
    holdingPeriodYears = 5,
    costOfCapitalDiscountRatePct = 10.0, // Discount Rate / Cost of Equity (Default 10%)
    assumedTerminalPe,
    assumedTerminalNetMarginPct,
    assumedDilutionPct = 0.0,
    consensusEpsCagrBefore = null,
    consensusEpsCagrAfter = null
  } = params;

  const P0 = parseFloat(sharePrice);
  const S0 = parseFloat(baselineSharesOutstanding);
  const EPS0 = parseFloat(baselineEps);
  const R0 = parseFloat(baselineRevenue);
  const M0 = parseFloat(baselineNetMarginPct);
  const N = parseInt(holdingPeriodYears, 10);
  const r_disc = parseFloat(costOfCapitalDiscountRatePct) / 100.0;
  const PE_term = parseFloat(assumedTerminalPe);
  const M_term = parseFloat(assumedTerminalNetMarginPct) / 100.0;
  const dilution = parseFloat(assumedDilutionPct) / 100.0;

  if (isNaN(P0) || P0 <= 0 || isNaN(S0) || S0 <= 0 || isNaN(EPS0) || EPS0 <= 0 || isNaN(R0) || R0 <= 0 || isNaN(N) || N <= 0 || isNaN(PE_term) || PE_term <= 0 || isNaN(M_term) || M_term <= 0) {
    return { isValid: false, errorCode: "MALFORMED_INPUT", errorMessage: "Invalid inputs for True Market-Implied Expectations Model." };
  }

  const currentEquityValue = P0 * S0;
  const assumedTerminalSharesOutstanding = S0 * (1 + dilution);

  // Solves exact market-implied growth g_market
  // P0 = (EPS0 * (1 + g)^N * PE_term) / (1 + r_disc)^N
  // => (1 + g)^N = (P0 * (1 + r_disc)^N) / (EPS0 * PE_term)
  const compoundFactor = (P0 * Math.pow(1 + r_disc, N)) / (EPS0 * PE_term);
  const marketImpliedEpsCagrPct = (Math.pow(compoundFactor, 1.0 / N) - 1) * 100.0;

  // Implied Terminal EPS & PAT at implied growth rate
  const marketImpliedTerminalEps = EPS0 * Math.pow(1 + (marketImpliedEpsCagrPct / 100.0), N);
  const marketImpliedTerminalPat = marketImpliedTerminalEps * assumedTerminalSharesOutstanding;
  const marketImpliedTerminalRevenue = marketImpliedTerminalPat / M_term;
  const marketImpliedRevenueCagrPct = (Math.pow(marketImpliedTerminalRevenue / R0, 1.0 / N) - 1) * 100.0;

  return {
    isValid: true,
    modelType: "TRUE_MARKET_IMPLIED_EXPECTATIONS_MODEL",
    inputs: {
      sharePrice: P0,
      baselineSharesOutstanding: S0,
      baselineEps: EPS0,
      baselineRevenue: R0,
      holdingPeriodYears: N,
      costOfCapitalDiscountRatePct: r_disc * 100.0,
      assumedTerminalPe: PE_term,
      assumedTerminalNetMarginPct: M_term * 100.0,
      assumedDilutionPct: dilution * 100.0
    },
    intermediateValues: {
      currentEquityValue: parseFloat(currentEquityValue.toFixed(2)),
      assumedTerminalSharesOutstanding: parseFloat(assumedTerminalSharesOutstanding.toFixed(2)),
      marketImpliedTerminalEps: parseFloat(marketImpliedTerminalEps.toFixed(2)),
      marketImpliedTerminalPat: parseFloat(marketImpliedTerminalPat.toFixed(2)),
      marketImpliedTerminalRevenue: parseFloat(marketImpliedTerminalRevenue.toFixed(2))
    },
    outputs: {
      marketImpliedEpsCagrPct: parseFloat(marketImpliedEpsCagrPct.toFixed(2)),
      marketImpliedRevenueCagrPct: parseFloat(marketImpliedRevenueCagrPct.toFixed(2)),
      consensusEpsCagrBefore: consensusEpsCagrBefore !== null ? parseFloat(consensusEpsCagrBefore) : null,
      consensusEpsCagrAfter: consensusEpsCagrAfter !== null ? parseFloat(consensusEpsCagrAfter) : null
    }
  };
}

/**
 * Generates Expectations Sensitivity Matrix across P/E Multiples & Discount Rates
 */
export function generateExpectationsMatrix(params) {
  const terminalPeOptions = [15, 20, 25, 30, 35];
  const discountRateOptions = [8.0, 10.0, 12.0, 14.0];
  const matrix = [];

  for (const discRate of discountRateOptions) {
    const row = { discountRatePct: discRate, peResults: {} };
    for (const pe of terminalPeOptions) {
      const res = calculateTrueMarketImpliedExpectationsModel({
        ...params,
        costOfCapitalDiscountRatePct: discRate,
        assumedTerminalPe: pe
      });
      row.peResults[`pe_${pe}x`] = res.outputs.marketImpliedEpsCagrPct;
    }
    matrix.push(row);
  }

  return matrix;
}

/**
 * Computes & Persists Both Engines to Database
 */
export async function computeAndPersistMarketExpectations(params, pool) {
  const {
    ticker,
    period,
    informationCutoffAt,
    assumedTerminalPe,
    assumedTerminalNetMarginPct,
    assumedDilutionPct = 0.0,
    holdingPeriodYears = 5,
    requiredCagrPct = 20.0,
    costOfCapitalDiscountRatePct = 10.0
  } = params;

  // 1. Fetch Market Snapshot & Enforce Gate 1 Freshness
  const snapshotRes = await getMarketDataSnapshot(ticker, period, pool, { asOfDate: params.asOfDate });

  if (snapshotRes.status === "VALUATION_BLOCKED") {
    return {
      success: false,
      status: "VALUATION_BLOCKED",
      errorCode: snapshotRes.errorCode,
      errorMessage: snapshotRes.errorMessage
    };
  }

  const snapshot = snapshotRes.snapshot;

  // 2. Enforce Information Cutoff Timestamp
  const cutoffDate = new Date(informationCutoffAt);
  const snapshotDate = new Date(snapshot.market_data_retrieved_at || snapshot.market_data_as_of);

  if (snapshotDate > cutoffDate) {
    return {
      success: false,
      status: "VALUATION_BLOCKED",
      errorCode: "INFORMATION_CUTOFF_VIOLATION",
      errorMessage: `Market snapshot timestamp (${snapshotDate.toISOString()}) is AFTER information_cutoff_at (${cutoffDate.toISOString()}). Hindsight leakage rejected.`
    };
  }

  // 3. Run Engine A (Investor Required Return) & Engine B (True Market Implied)
  const baselineEps = parseFloat(snapshot.ttm_eps);
  const baselineRevenue = parseFloat(snapshot.ttm_revenue);
  const baselinePat = parseFloat(snapshot.ttm_pat);
  const baselineNetMarginPct = (baselinePat / baselineRevenue) * 100.0;

  const engineA = calculateInvestorRequiredReturnModel({
    sharePrice: snapshot.share_price, baselineSharesOutstanding: snapshot.shares_outstanding, baselineEps, baselineRevenue, baselineNetMarginPct, holdingPeriodYears, investorRequiredCagrPct: requiredCagrPct, assumedTerminalPe, assumedTerminalNetMarginPct, assumedDilutionPct
  });

  const engineB = calculateTrueMarketImpliedExpectationsModel({
    sharePrice: snapshot.share_price, baselineSharesOutstanding: snapshot.shares_outstanding, baselineEps, baselineRevenue, baselineNetMarginPct, holdingPeriodYears, costOfCapitalDiscountRatePct, assumedTerminalPe, assumedTerminalNetMarginPct, assumedDilutionPct
  });

  if (!engineA.isValid || !engineB.isValid) {
    return { success: false, status: "VALUATION_BLOCKED", errorCode: engineA.errorCode || engineB.errorCode, errorMessage: engineA.errorMessage || engineB.errorMessage };
  }

  // 4. Persist True Market Implied Record to Database
  const query = `
    INSERT INTO market_implied_expectations (
      ticker, period, information_cutoff_at, share_price, holding_period_years,
      required_cagr_pct, baseline_eps, baseline_revenue, baseline_net_margin_pct,
      baseline_shares_outstanding, assumed_terminal_shares_outstanding, assumed_dilution_pct,
      assumed_terminal_pe, assumed_terminal_net_margin_pct, required_terminal_equity_value,
      required_terminal_eps, required_eps_cagr_pct, required_terminal_revenue, required_revenue_cagr_pct
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
    )
    ON CONFLICT (ticker, period, information_cutoff_at) DO UPDATE SET
      share_price = EXCLUDED.share_price,
      required_terminal_equity_value = EXCLUDED.required_terminal_equity_value,
      required_terminal_eps = EXCLUDED.required_terminal_eps,
      required_eps_cagr_pct = EXCLUDED.required_eps_cagr_pct,
      required_terminal_revenue = EXCLUDED.required_terminal_revenue,
      required_revenue_cagr_pct = EXCLUDED.required_revenue_cagr_pct,
      created_at = NOW()
    RETURNING *;
  `;

  const values = [
    ticker, period, informationCutoffAt, snapshot.share_price, holdingPeriodYears,
    requiredCagrPct, baselineEps, baselineRevenue, baselineNetMarginPct,
    snapshot.shares_outstanding, engineB.intermediateValues.assumedTerminalSharesOutstanding,
    assumedDilutionPct, assumedTerminalPe, assumedTerminalNetMarginPct,
    engineA.intermediateValues.requiredTerminalEquityValue, engineB.intermediateValues.marketImpliedTerminalEps,
    engineB.outputs.marketImpliedEpsCagrPct, engineB.intermediateValues.marketImpliedTerminalRevenue,
    engineB.outputs.marketImpliedRevenueCagrPct
  ];

  const { rows } = await pool.query(query, values);

  return {
    success: true,
    status: "COMPUTED_AND_PERSISTED",
    engineA_InvestorRequired: engineA,
    engineB_TrueMarketImplied: engineB,
    matrix: generateExpectationsMatrix({
      sharePrice: snapshot.share_price, baselineSharesOutstanding: snapshot.shares_outstanding, baselineEps, baselineRevenue, baselineNetMarginPct, holdingPeriodYears, assumedTerminalNetMarginPct, assumedDilutionPct
    }),
    persistedRecord: rows[0]
  };
}
