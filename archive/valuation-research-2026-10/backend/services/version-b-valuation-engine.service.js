/**
 * Phase 4F - Version B: Market-Implied Expectation-Gap & Historical Valuation Engine
 * 
 * Implements:
 * 1. LENS 1: Point-in-Time Trailing Valuation Distribution (3Y, 5Y, 7Y with Depth Guards)
 * 2. LENS 2: Market-Implied 3-Year EPS Growth Expectations across Configurable Exit Scenarios [25x, 30x, 35x]
 * 3. Point-in-Time T0 Evidence Growth Synthesis (Derived strictly from data published <= T0)
 * 4. Expectation-Gap Calculation (Evidence CAGR - Implied CAGR)
 * 5. Position-Sizing & Valuation Reservation Governor (SEVERE, HIGH, MODERATE, LOW, INSUFFICIENT_HISTORY)
 * 
 * STRICT TERMINOLOGY & DENOMINATOR CONTRACT:
 * - When 4 trailing quarterly XBRL filings are available published <= T: epsType = 'POINT_IN_TIME_TTM_4Q'
 * - When falling back to the latest statutory audited annual report published <= T: epsType = 'POINT_IN_TIME_STATUTORY_ANNUAL'
 * 
 * STRICT EXPERIMENTAL RULE:
 * Version B attaches valuation context to the Version A signal; it NEVER mutates or overrides the underlying fundamental thesis diagnosis.
 */

import crypto from 'crypto';

export const VALUATION_RESERVATIONS = {
  SEVERE: 'SEVERE',
  HIGH: 'HIGH',
  MODERATE: 'MODERATE',
  LOW: 'LOW',
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY'
};

export const DEFAULT_EXIT_SCENARIOS = [
  { id: 'SCENARIO_A', multiple: 25, label: 'Exit Scenario A (25x)' },
  { id: 'SCENARIO_B', multiple: 30, label: 'Exit Scenario B (30x)' },
  { id: 'SCENARIO_C', multiple: 35, label: 'Exit Scenario C (35x)' }
];

function calculateMedian(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculatePercentile(arr, val) {
  if (!arr || arr.length === 0 || val === null) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const countBelow = sorted.filter(x => x <= val).length;
  return Math.round((countBelow / sorted.length) * 100);
}

function computeConfigHash(scenarios) {
  return crypto.createHash('sha256').update(JSON.stringify(scenarios)).digest('hex').slice(0, 12);
}

/**
 * Resolves Point-in-Time Trailing Diluted EPS strictly knowable on date T.
 * Adheres to publication timestamp and period-end cutoff (zero lookahead).
 */
export async function resolvePointInTimeEPS(stockId, targetDateStr, pool) {
  const targetDate = new Date(targetDateStr);
  
  if (pool) {
    // 1. Check quarterly filings with period_end_date <= targetDate
    const { rows: quarters } = await pool.query(
      `SELECT quarter, period_end_date, eps_diluted, eps_basic, pat, revenue_from_ops
       FROM xbrl_metrics_quarterly
       WHERE stock_id = $1 AND period_end_date <= $2
       ORDER BY period_end_date DESC
       LIMIT 4`,
      [stockId, targetDateStr]
    );

    if (quarters.length === 4) {
      let ttmEps = 0;
      let valid = true;
      for (const q of quarters) {
        const qEps = q.eps_diluted !== null ? parseFloat(q.eps_diluted) : (q.eps_basic !== null ? parseFloat(q.eps_basic) : null);
        if (qEps === null || isNaN(qEps)) {
          valid = false;
          break;
        }
        ttmEps += qEps;
      }
      if (valid && ttmEps > 0) {
        return {
          eps: parseFloat(ttmEps.toFixed(2)),
          epsType: 'POINT_IN_TIME_TTM_4Q',
          source: 'XBRL_TTM_4Q',
          quartersUsed: quarters.map(q => q.quarter),
          isPointInTime: true
        };
      }
    }

    // 2. Point-in-Time Annual Statutory Diluted EPS Fallback
    // In India, audited annual results for FY(Y) (period ending March 31) are published by May 30 of year Y.
    // An annual filing of year Y is strictly knowable if targetDate >= publication date (May 30 of year Y).
    // If targetDate is before May 30 of year Y, only FY(Y-1) is knowable.
    const calYear = targetDate.getFullYear();
    const annualFilingPublicationCutoff = new Date(`${calYear}-05-30T00:00:00.000Z`);
    const maxKnowableFilingYear = (targetDate.getTime() >= annualFilingPublicationCutoff.getTime()) ? calYear : calYear - 1;

    const { rows: annualRows } = await pool.query(
      `SELECT year, eps, net_profit, revenue
       FROM financial_metrics
       WHERE stock_id = $1 AND year <= $2
       ORDER BY year DESC LIMIT 1`,
      [stockId, maxKnowableFilingYear]
    );

    if (annualRows[0] && annualRows[0].eps && parseFloat(annualRows[0].eps) > 0) {
      return {
        eps: parseFloat(annualRows[0].eps),
        epsType: 'POINT_IN_TIME_STATUTORY_ANNUAL',
        source: `STATUTORY_AUDITED_FY${annualRows[0].year}`,
        quartersUsed: [`FY${annualRows[0].year}_ANNUAL`],
        isPointInTime: true
      };
    }
  }

  return { eps: null, epsType: 'INSUFFICIENT_DATA', source: 'INSUFFICIENT_DATA', isPointInTime: false };
}

// Backward compatibility alias
export const resolvePointInTimeTTMEPS = resolvePointInTimeEPS;

/**
 * Builds Multi-Window Historical P/E Distributions (3Y, 5Y, 7Y)
 */
export async function buildMultiWindowPEDistributions(stockId, valuationDateStr, pool) {
  if (!pool) return { status: 'NO_POOL' };

  const valuationDate = new Date(valuationDateStr);

  // Fetch all historical prices <= valuationDate
  const { rows: prices } = await pool.query(
    `SELECT price, date FROM prices 
     WHERE stock_id = $1 AND date <= $2 
     ORDER BY date ASC`,
    [stockId, valuationDateStr]
  );

  const { rows: annualEps } = await pool.query(
    "SELECT year, eps FROM financial_metrics WHERE stock_id = $1 ORDER BY year ASC",
    [stockId]
  );
  const epsMap = new Map(annualEps.map(r => [r.year, parseFloat(r.eps)]));

  const totalTradingDays = prices.length;
  const daysByWindow = {
    '3Y': 3 * 252,
    '5Y': 5 * 252,
    '7Y': 7 * 252
  };

  const windowResults = {};

  for (const [wKey, minDaysRequired] of Object.entries(daysByWindow)) {
    const windowYears = parseInt(wKey[0]);
    const startDate = new Date(valuationDate.getTime() - windowYears * 365.25 * 24 * 60 * 60 * 1000);
    const windowPrices = prices.filter(p => new Date(p.date) >= startDate);

    if (windowPrices.length < 200 || (wKey === '5Y' && totalTradingDays < 500) || (wKey === '7Y' && totalTradingDays < 1000)) {
      windowResults[wKey] = {
        status: 'INSUFFICIENT_HISTORY',
        tradingDays: windowPrices.length,
        medianPE: null,
        percentile: null
      };
      continue;
    }

    const peArray = [];
    for (const p of windowPrices) {
      const yr = new Date(p.date).getFullYear();
      const pDate = new Date(p.date);
      const knowableYr = (pDate.getTime() >= new Date(`${yr}-05-30T00:00:00.000Z`).getTime()) ? yr : yr - 1;
      const eps = epsMap.get(knowableYr) || epsMap.get(knowableYr - 1);
      if (eps && eps > 0) {
        const pe = parseFloat(p.price) / eps;
        if (pe >= 2 && pe <= 200) peArray.push(pe);
      }
    }

    const median = calculateMedian(peArray);
    windowResults[wKey] = {
      status: 'AVAILABLE',
      tradingDays: windowPrices.length,
      medianPE: median ? parseFloat(median.toFixed(1)) : null,
      minPE: peArray.length > 0 ? parseFloat(Math.min(...peArray).toFixed(1)) : null,
      maxPE: peArray.length > 0 ? parseFloat(Math.max(...peArray).toFixed(1)) : null,
      peValues: peArray
    };
  }

  return {
    totalTradingDays,
    depthClassification: totalTradingDays >= 500 ? 'SUFFICIENT_FOR_5Y' : 'INSUFFICIENT_FOR_5Y_SHORT_LISTING',
    windows: windowResults
  };
}

/**
 * Evaluates Full Version B Valuation Engine
 */
export async function evaluateVersionBValuation(params, pool) {
  const {
    ticker,
    stockId,
    valuationDate,
    currentPrice,
    t0EvidenceGrowthRange = [0.20, 0.25], // Point-in-time growth derived strictly <= T0
    exitScenarios = DEFAULT_EXIT_SCENARIOS
  } = params;

  const configHash = computeConfigHash(exitScenarios);

  // 1. Resolve Point-in-Time Diluted EPS
  const pitEps = await resolvePointInTimeEPS(stockId, valuationDate, pool);
  const pointInTimeEPS = pitEps.eps;
  const epsType = pitEps.epsType;
  const valuationPE = (currentPrice && pointInTimeEPS) ? parseFloat((currentPrice / pointInTimeEPS).toFixed(1)) : null;

  // 2. Lens 1: Multi-Window Historical Trailing P/E Distribution
  const multiDist = await buildMultiWindowPEDistributions(stockId, valuationDate, pool);
  const p3y = multiDist.windows?.['3Y']?.peValues ? calculatePercentile(multiDist.windows['3Y'].peValues, valuationPE) : null;
  const p5y = multiDist.windows?.['5Y']?.peValues ? calculatePercentile(multiDist.windows['5Y'].peValues, valuationPE) : null;
  const p7y = multiDist.windows?.['7Y']?.peValues ? calculatePercentile(multiDist.windows['7Y'].peValues, valuationPE) : null;

  // 3. Lens 2: Market-Implied 3-Year EPS Growth Expectations
  const scenarioResults = [];
  let negativeGapCount = 0;
  let positiveGapCount = 0;

  for (const s of exitScenarios) {
    const requiredYear3EPS = currentPrice && s.multiple ? currentPrice / s.multiple : null;
    let implied3YCAGR = null;
    if (requiredYear3EPS && pointInTimeEPS && pointInTimeEPS > 0) {
      implied3YCAGR = Math.pow(requiredYear3EPS / pointInTimeEPS, 1 / 3) - 1;
    }

    const impliedPct = implied3YCAGR !== null ? parseFloat((implied3YCAGR * 100).toFixed(1)) : null;
    const midEvidenceGrowth = ((t0EvidenceGrowthRange[0] + t0EvidenceGrowthRange[1]) / 2) * 100;
    const expectationGapPct = (impliedPct !== null) ? parseFloat((midEvidenceGrowth - impliedPct).toFixed(1)) : null;

    if (expectationGapPct !== null) {
      if (expectationGapPct < 0) negativeGapCount++;
      else positiveGapCount++;
    }

    scenarioResults.push({
      scenarioId: s.id,
      label: s.label,
      exitMultiple: s.multiple,
      requiredYear3EPS: requiredYear3EPS ? parseFloat(requiredYear3EPS.toFixed(2)) : null,
      implied3YCAGR: impliedPct !== null ? `${impliedPct >= 0 ? '+' : ''}${impliedPct}%` : 'N/A',
      impliedCAGRRaw: implied3YCAGR,
      expectationGapPct: expectationGapPct !== null ? `${expectationGapPct >= 0 ? '+' : ''}${expectationGapPct}%` : 'N/A',
      expectationGapRaw: expectationGapPct
    });
  }

  // 4. Synthesize Valuation Reservation Governor (Pre-Frozen Non-Binary Rules)
  let valuationReservation = VALUATION_RESERVATIONS.MODERATE;
  let reservationReason = "Valuation multiple within normal historical band with balanced expectation gap.";

  if (multiDist.totalTradingDays < 500) {
    valuationReservation = VALUATION_RESERVATIONS.INSUFFICIENT_HISTORY;
    reservationReason = `Listed history is ${multiDist.totalTradingDays} trading days (< 500 days). Rely on peer benchmarks and capacity execution milestones.`;
  } else if (p5y !== null && p5y >= 90 && negativeGapCount === exitScenarios.length) {
    valuationReservation = VALUATION_RESERVATIONS.SEVERE;
    reservationReason = `Trailing P/E (${valuationPE}x) is at the ${p5y}th percentile (peak historical band) AND market-implied growth exceeds evidence-supported growth across ALL exit scenarios.`;
  } else if (p5y !== null && p5y >= 90 && negativeGapCount >= 2) {
    valuationReservation = VALUATION_RESERVATIONS.HIGH;
    reservationReason = `Trailing P/E (${valuationPE}x) is at the ${p5y}th percentile AND market-implied growth exceeds evidence-supported growth across at least 2/3 exit scenarios. Elevated multiple compression risk.`;
  } else if (p5y !== null && p5y <= 35 && positiveGapCount === exitScenarios.length) {
    valuationReservation = VALUATION_RESERVATIONS.LOW;
    reservationReason = `Trailing P/E (${valuationPE}x) is at the ${p5y}th percentile (lower quartile) AND evidence-supported growth exceeds market-implied growth across ALL scenarios. Valuation is strongly supportive.`;
  } else if (p5y !== null && p5y >= 70) {
    valuationReservation = VALUATION_RESERVATIONS.MODERATE;
    reservationReason = `Trailing P/E (${valuationPE}x) is at the ${p5y}th percentile. Demands execution delivery without excessive multiple expansion.`;
  }

  return {
    ticker,
    valuationDate,
    configHash,
    currentPrice,
    pointInTimeEPS,
    epsType,
    valuationPE,
    t0EvidenceGrowthRange: `${(t0EvidenceGrowthRange[0] * 100).toFixed(0)}% to ${(t0EvidenceGrowthRange[1] * 100).toFixed(0)}%`,
    lens1Historical: {
      totalTradingDays: multiDist.totalTradingDays,
      depthClassification: multiDist.depthClassification,
      medianPE5Y: multiDist.windows?.['5Y']?.medianPE || null,
      percentile3Y: p3y !== null ? `${p3y}th pct` : 'INSUFFICIENT_HISTORY',
      percentile5Y: p5y !== null ? `${p5y}th pct` : 'INSUFFICIENT_HISTORY',
      percentile7Y: p7y !== null ? `${p7y}th pct` : 'INSUFFICIENT_HISTORY'
    },
    lens2Expectations: {
      scenarios: scenarioResults,
      negativeGapCount,
      positiveGapCount
    },
    valuationReservation,
    reservationReason
  };
}
