/**
 * Thesis Gate Evaluator Service
 * 
 * Implements the Dual-Layer Gate Architecture with Strict Fail-Closed Invariants:
 * Layer 1: Universal Financial Health Gate (Revenue growth, PAT growth, margin insulation)
 * Layer 2: Company-Specific Thesis Hurdle Gate (Predefined primary operational & financial targets)
 * 
 * Strict Fail-Closed Invariants:
 * 1. Missing financial data → FAIL/UNAVAILABLE, never PASS.
 * 2. Missing required thesis KPI → FAIL/UNAVAILABLE, never skip.
 * 3. Missing thesis contract → NO_CONTRACT (no BUY authorization).
 * 4. BUY / ACCUMULATE requires: universal.status === 'PASS' && thesis.status === 'PASS'.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { summarizeDriverAssessment } from './thesis-driver-context.service.js';
import { findThesisContractFile } from '../utils/thesis-contract-files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cached driver-level thesis contracts
let cachedContracts = null;

function loadThesisContracts() {
  if (cachedContracts) return cachedContracts;
  try {
    const contractsPath = findThesisContractFile('driver-level-thesis-contracts.json');
    if (contractsPath) {
      const raw = fs.readFileSync(contractsPath, 'utf8');
      const parsed = JSON.parse(raw);
      const map = new Map();
      const list = parsed.contracts || parsed || [];
      for (const c of list) {
        if (c.ticker) map.set(c.ticker.toUpperCase(), c);
      }
      cachedContracts = map;
      return cachedContracts;
    }
  } catch (err) {
    console.warn('[THESIS GATE] Could not load driver contracts JSON:', err.message);
  }
  return new Map();
}

/**
 * Evaluates Layer 1: Universal Financial Health Gate (Fail-Closed)
 */
export function evaluateUniversalFinancialHealth(fin = {}) {
  if (!fin || typeof fin !== 'object') {
    return {
      status: 'UNAVAILABLE',
      passed: false,
      reason: 'Verified financial dataset unavailable'
    };
  }

  // 1. Mandatory Data Presence Checks (Fail-Closed: Missing data is NEVER positive evidence)
  const patYoYMissing = fin.patYoYGrowthPct === null || fin.patYoYGrowthPct === undefined || isNaN(fin.patYoYGrowthPct);
  let patGrowth;
  if (patYoYMissing) {
    // A mathematically undefined growth rate (prior-year loss) is still verifiable from the sign change.
    if (fin.patTurnaround === 'LOSS_TO_PROFIT') {
      patGrowth = Number.POSITIVE_INFINITY;
    } else if (fin.patTurnaround === 'PROFIT_TO_LOSS' || fin.patTurnaround === 'LOSS_WIDENED') {
      return {
        status: 'FAIL',
        passed: false,
        reason: fin.patTurnaround === 'PROFIT_TO_LOSS' ? 'Swung from profit to loss YoY' : 'Net loss widened YoY'
      };
    } else {
      return {
        status: 'UNAVAILABLE',
        passed: false,
        reason: 'Verified PAT YoY growth rate unavailable'
      };
    }
  } else {
    patGrowth = Number(fin.patYoYGrowthPct);
  }

  if (fin.revenueYoYGrowthPct === null || fin.revenueYoYGrowthPct === undefined || isNaN(fin.revenueYoYGrowthPct)) {
    return {
      status: 'UNAVAILABLE',
      passed: false,
      reason: 'Verified Revenue YoY growth rate unavailable'
    };
  }

  if (fin.ebitdaMarginPct === null || fin.ebitdaMarginPct === undefined || isNaN(fin.ebitdaMarginPct)) {
    return {
      status: 'UNAVAILABLE',
      passed: false,
      reason: 'Verified EBITDA margin percentage unavailable'
    };
  }

  // 2. Deterministic Financial Health Checks
  const revGrowth = Number(fin.revenueYoYGrowthPct);
  const isMarginEroded = Boolean(fin.isMarginErosion) || (fin.ebitdaMarginBpsDelta !== null && fin.ebitdaMarginBpsDelta !== undefined && Number(fin.ebitdaMarginBpsDelta) < -150);

  if (patGrowth < 0) {
    return {
      status: 'FAIL',
      passed: false,
      reason: `PAT contraction (${patGrowth}% YoY)`
    };
  }

  if (revGrowth < 0) {
    return {
      status: 'FAIL',
      passed: false,
      reason: `Revenue contraction (${revGrowth}% YoY)`
    };
  }

  if (isMarginEroded) {
    const bps = (fin.ebitdaMarginBpsDelta !== null && fin.ebitdaMarginBpsDelta !== undefined) ? Number(fin.ebitdaMarginBpsDelta) : null;
    // When revenue growth is strong (>= 15%) and PAT is positive, moderate margin compression (-100 to -300 bps)
    // represents operating / raw-material friction during scaling, NOT structural thesis breakdown.
    const isModerateFriction = revGrowth >= 15 && patGrowth >= 0 && (bps === null || bps >= -300);
    if (isModerateFriction) {
      return {
        status: 'TEMPORARY_FRICTION',
        passed: false,
        reason: `Top-line (+${revGrowth}% YoY) and profit (+${patGrowth}% YoY) expanding, but EBITDA margin compressed ${bps ?? -150} bps YoY (operating/input cost friction during expansion)`
      };
    }

    return {
      status: 'FAIL',
      passed: false,
      reason: `Severe EBITDA margin compression (${bps ?? -150} bps YoY)`
    };
  }

  return {
    status: 'PASS',
    passed: true,
    reason: 'Positive revenue & PAT growth with intact operating margins'
  };
}

/**
 * Specific Hurdle Thresholds per Ticker Contract (Calibrated to Falsifiable Framework)
 * Primary Gates: Mandatory financial conditions for BUY authorization.
 * Structural Confirmation: Modifies conviction (8/10 vs 9/10), but does not block BUY if primary gates clear.
 */
const SPECIFIC_THESIS_HURDLES = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/thesis-hurdles.json'), 'utf8'));

/**
 * Human-readable hurdle definition for a ticker (e.g. "Primary: EBITDA margin ≥15.0% | Structural: ..."), or null.
 */
export function getThesisHurdleDescription(ticker) {
  const h = SPECIFIC_THESIS_HURDLES[String(ticker || '').toUpperCase().trim()];
  return h ? h.description : null;
}

/**
 * Evaluates Layer 2: Company-Specific Thesis Hurdle Gate (Fail-Closed)
 */
export function evaluateThesisSpecificHurdle(ticker, fin = {}, operational = {}) {
  const safeFin = fin || {};
  const safeOperational = operational || {};
  const symbol = (ticker || '').toUpperCase().trim();
  const hurdles = SPECIFIC_THESIS_HURDLES[symbol];

  // If ticker has no explicit contract in SPECIFIC_THESIS_HURDLES, check driver contracts JSON
  if (!hurdles) {
    const contracts = loadThesisContracts();
    const contract = contracts.get(symbol);
    
    // Fail-Closed: If no verified thesis contract exists, DO NOT allow BUY authorization
    if (!contract || !contract.drivers || contract.drivers.length === 0) {
      return {
        status: 'NO_CONTRACT',
        passed: false,
        structuralConfirmed: false,
        reason: `No verified thesis contract found for ${symbol} (capital deployment restricted)`,
        hurdlesEvaluated: 'None'
      };
    }

    const hasDeteriorating = contract.drivers.some(d => d.direction === 'DETERIORATING');
    if (hasDeteriorating) {
      return {
        status: 'FAIL',
        passed: false,
        structuralConfirmed: false,
        reason: 'One or more core thesis drivers deteriorating in driver contract',
        hurdlesEvaluated: 'Driver-Level Contract Check'
      };
    }

    return {
      status: 'PASS',
      passed: true,
      structuralConfirmed: true,
      reason: 'Driver-level thesis contract intact with stable/improving drivers',
      hurdlesEvaluated: 'Driver Contract Verification'
    };
  }

  const primary = hurdles.primary || {};
  const failures = [];
  const unavailable = [];

  // 1. Primary EBITDA Margin Gate (Fail-Closed on missing KPI)
  if (primary.minEbitdaMarginPct !== undefined) {
    if (safeFin.ebitdaMarginPct === null || safeFin.ebitdaMarginPct === undefined || isNaN(safeFin.ebitdaMarginPct)) {
      unavailable.push(`Required KPI EBITDA Margin unavailable in verified data`);
    } else if (Number(safeFin.ebitdaMarginPct) < primary.minEbitdaMarginPct) {
      failures.push(`EBITDA Margin ${safeFin.ebitdaMarginPct}% < target ${primary.minEbitdaMarginPct}%`);
    }
  }

  // 2. Primary PAT Gate (Fail-Closed on missing KPI)
  if (primary.minPatCr !== undefined) {
    if (safeFin.patConsolidated === null || safeFin.patConsolidated === undefined || isNaN(safeFin.patConsolidated)) {
      unavailable.push(`Required KPI Consolidated PAT unavailable in verified data`);
    } else if (Number(safeFin.patConsolidated) < primary.minPatCr) {
      failures.push(`PAT ₹${safeFin.patConsolidated} Cr < target ₹${primary.minPatCr} Cr`);
    }
  }

  // 3. Primary EBITDA Gate (Fail-Closed on missing KPI)
  if (primary.minEbitdaCr !== undefined) {
    if (safeFin.ebitda === null || safeFin.ebitda === undefined || isNaN(safeFin.ebitda)) {
      unavailable.push(`Required KPI EBITDA unavailable in verified data`);
    } else if (Number(safeFin.ebitda) < primary.minEbitdaCr) {
      failures.push(`EBITDA ₹${safeFin.ebitda} Cr < target ₹${primary.minEbitdaCr} Cr`);
    }
  }

  // 4. Primary Revenue Gate (Fail-Closed on missing KPI)
  if (primary.minRevenueCr !== undefined) {
    const revVal = (safeFin.revenue !== null && safeFin.revenue !== undefined) ? safeFin.revenue : safeFin.revenueCr;
    if (revVal === null || revVal === undefined || isNaN(revVal)) {
      unavailable.push(`Required KPI Total Revenue unavailable in verified data`);
    } else if (Number(revVal) < primary.minRevenueCr) {
      failures.push(`Revenue ₹${revVal} Cr < target ₹${primary.minRevenueCr} Cr`);
    }
  }

  if (primary.minRevenueGrowthPct !== undefined) {
    if (!Number.isFinite(safeFin.revenueYoYGrowthPct)) unavailable.push('Required KPI revenue growth unavailable in verified data');
    else if (safeFin.revenueYoYGrowthPct < primary.minRevenueGrowthPct) failures.push(`Revenue growth ${safeFin.revenueYoYGrowthPct}% < target ${primary.minRevenueGrowthPct}%`);
  }

  // Every configured target uses the same evidence rule; absent structural data cannot confirm it.
  const structural = hurdles.structural || {};
  const structuralConfirmed = Object.entries(structural).every(([key, target]) => {
    if (!/^target[A-Z]/.test(key) || !Number.isFinite(target)) return false;
    const metric = key.replace(/^target([A-Z])/, (_, initial) => initial.toLowerCase());
    const value = safeOperational[metric] ?? safeFin[metric];
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= target;
  });

  if (unavailable.length > 0) {
    return {
      status: 'UNAVAILABLE',
      passed: false,
      structuralConfirmed,
      reason: unavailable.join('; '),
      hurdlesEvaluated: hurdles.description
    };
  }

  if (failures.length > 0) {
    return {
      status: 'FAIL',
      passed: false,
      structuralConfirmed,
      reason: failures.join('; '),
      hurdlesEvaluated: hurdles.description
    };
  }

  return {
    status: 'PASS',
    passed: true,
    structuralConfirmed,
    reason: `All primary thesis hurdle rates satisfied (${hurdles.description})`,
    hurdlesEvaluated: hurdles.description
  };
}

const BEARISH_ACTION = /\b(TRIM|SELL|REDUCE|EXIT)\b/i;

/**
 * Main Dual-Layer Gating Function
 * Returns actionable verdict, granular categorization, and decision text.
 *
 * Gate order: quantitative gates authorise a buy; the analysis' own bearish call and any broken
 * thesis driver can only VETO that buy, never be overridden by it.
 *
 * @param {object} params
 * @param {boolean} [params.financialsRequired=true] false for filings that never contain statements (concall transcripts, decks)
 * @param {Array}  [params.driverAssessment] normalised thesis-driver assessment for this filing
 * @param {string} [params.financialsSource] e.g. 'THIS_FILING' | 'CARRIED_FORWARD'
 * @param {boolean} [params.financialsVerified=true] false when the figures were only AI-located (never authorises a buy)
 */
export function evaluateDualLayerActionGate({
  ticker,
  financialData = {},
  operationalMetrics = {},
  proposedAction = 'HOLD',
  llmConviction = 5,
  driverAssessment = [],
  financialsRequired = true,
  financialsSource = 'THIS_FILING',
  financialsVerified = true,
  carriedAction = null,
  carriedConviction = null
}) {
  const hasFinancials = Boolean(financialData) && typeof financialData === 'object' && Object.keys(financialData).length > 0;
  const safeFin = financialData || {};
  const safeOperational = operationalMetrics || {};
  const drivers = summarizeDriverAssessment(driverAssessment || []);
  const bearishAnalysis = BEARISH_ACTION.test(String(proposedAction || ''));
  const baseConviction = Math.max(1, Math.min(Number(llmConviction) || 5, 10));

  const driverNote = (() => {
    const parts = [];
    if (drivers.broken.length) parts.push(`Thesis driver(s) BROKEN: ${drivers.broken.map(d => d.driver).join(', ')}`);
    if (drivers.atRisk.length) parts.push(`At risk: ${drivers.atRisk.map(d => d.driver).join(', ')}`);
    return parts.join(' | ');
  })();
  const withDriverNote = (text) => (driverNote ? `${text} ${driverNote}.` : text);
  const sourceNote = financialsSource === 'CARRIED_FORWARD' ? ' (financials carried forward from the latest verified results)' : '';

  const universal = (!hasFinancials && !financialsRequired)
    ? { status: 'NOT_APPLICABLE', passed: false, reason: 'No financial statements in this filing' }
    : evaluateUniversalFinancialHealth(safeFin);
  const thesis = (!hasFinancials && !financialsRequired)
    ? { status: 'NOT_APPLICABLE', passed: false, structuralConfirmed: false, reason: 'No financial statements in this filing', hurdlesEvaluated: 'n/a' }
    : evaluateThesisSpecificHurdle(ticker, safeFin, safeOperational);

  const actionAuthorized = universal.status === 'PASS' && thesis.status === 'PASS';

  let finalAction = 'HOLD / MONITOR';
  let calibratedConviction = baseConviction;
  let statusClassification = 'NEUTRAL';
  let decisionExplanation = '';
  let authorized = actionAuthorized;

  if (universal.status === 'NOT_APPLICABLE') {
    // Concall / presentation / transcript: judged on thesis drivers + the analysis, never on missing statements.
    if (drivers.highBroken.length > 0) {
      finalAction = 'REASSESS THESIS';
      calibratedConviction = Math.min(baseConviction, 4);
      statusClassification = 'THESIS_DRIVER_BROKEN';
      decisionExplanation = withDriverNote('A high-materiality thesis driver is falsified by this filing.');
    } else if (bearishAnalysis) {
      finalAction = 'WATCH / WAIT FOR CONFIRMATION';
      calibratedConviction = Math.min(baseConviction, 5);
      statusClassification = 'NO_FINANCIALS_BEARISH_READ';
      decisionExplanation = withDriverNote('Analysis of this filing is cautious; no new financial statements to confirm or refute it.');
    } else if (carriedAction) {
      finalAction = carriedAction;
      calibratedConviction = carriedConviction ? Number(carriedConviction) : baseConviction;
      statusClassification = 'CARRIED_QUARTERLY_ACTION';
      decisionExplanation = withDriverNote(`Action signal carried forward from quarterly results (${carriedAction}). No new financial statements in this filing.`);
    } else {
      finalAction = 'HOLD / MONITOR';
      calibratedConviction = Math.min(baseConviction, drivers.highAtRisk.length > 0 ? 5 : 6);
      statusClassification = 'NO_FINANCIALS_IN_FILING';
      decisionExplanation = withDriverNote('No financial statements in this filing; action authority stays with the latest results gate.');
    }
    authorized = false;
  } else if (actionAuthorized) {
    if (drivers.highBroken.length > 0) {
      finalAction = 'REASSESS THESIS';
      calibratedConviction = Math.min(baseConviction, 4);
      statusClassification = 'THESIS_DRIVER_BROKEN';
      decisionExplanation = withDriverNote('Financial gates cleared, but a core thesis driver is falsified.');
      authorized = false;
    } else if (!financialsVerified) {
      finalAction = 'WATCH / WAIT FOR CONFIRMATION';
      calibratedConviction = Math.min(baseConviction, 5);
      statusClassification = 'UNVERIFIED_FIGURES';
      decisionExplanation = withDriverNote('Gates pass on AI-located figures, but a buy is only authorised on machine-verified statements — check the filing.');
      authorized = false;
    } else if (bearishAnalysis) {
      finalAction = 'WATCH / WAIT FOR CONFIRMATION';
      calibratedConviction = Math.min(baseConviction, 5);
      statusClassification = 'GATES_PASS_ANALYSIS_BEARISH';
      decisionExplanation = withDriverNote('Financial gates cleared, but the filing analysis raised a bearish flag (governance, guidance or segment risk).');
      authorized = false;
    } else {
      // Both gates cleared and nothing vetoes -> authorise a buy.
      const structural = thesis.structuralConfirmed;
      calibratedConviction = structural ? Math.max(baseConviction, 8) : Math.min(Math.max(baseConviction, 7), 8);
      if (drivers.highAtRisk.length > 0) calibratedConviction = Math.min(calibratedConviction, 7);
      finalAction = (calibratedConviction >= 9 && structural) ? 'STRONG BUY' : 'ADD';
      statusClassification = 'THESIS_CONFIRMED_BEAT';
      decisionExplanation = withDriverNote((structural
        ? 'Primary financial growth and structural thesis hurdle rates verified.'
        : 'Primary financial hurdle rates cleared; structural metrics in confirmation phase.') + sourceNote);
    }
  } else if (thesis.status === 'NO_CONTRACT') {
    finalAction = 'HOLD / MONITOR';
    calibratedConviction = Math.min(baseConviction, 5);
    statusClassification = 'NO_CONTRACT';
    decisionExplanation = thesis.reason;
  } else if (universal.status === 'PASS' && thesis.status === 'FAIL') {
    finalAction = drivers.highBroken.length > 0 ? 'REASSESS THESIS' : 'WATCH / WAIT FOR CONFIRMATION';
    calibratedConviction = Math.min(baseConviction, drivers.highBroken.length > 0 ? 4 : 6);
    statusClassification = 'GROWING_BUT_THESIS_UNCONFIRMED';
    decisionExplanation = withDriverNote(`Company is financially growing, but specific thesis gates unmet: ${thesis.reason}.`);
  } else if (universal.status === 'UNAVAILABLE' || thesis.status === 'UNAVAILABLE') {
    finalAction = 'HOLD / MONITOR';
    calibratedConviction = Math.min(baseConviction, 5);
    statusClassification = 'DATA_UNAVAILABLE';
    decisionExplanation = withDriverNote(`Data requirement unmet: ${universal.status === 'UNAVAILABLE' ? universal.reason : thesis.reason}.`);
  } else if (universal.status === 'TEMPORARY_FRICTION') {
    finalAction = (drivers.highBroken.length > 0) ? 'REASSESS THESIS' : 'HOLD / MONITOR';
    calibratedConviction = Math.min(baseConviction, drivers.highBroken.length > 0 ? 4 : 6);
    statusClassification = drivers.highBroken.length > 0 ? 'THESIS_DRIVER_BROKEN' : 'TEMPORARY_FRICTION';
    decisionExplanation = withDriverNote(`Temporary operating friction: ${universal.reason}.`);
  } else if (universal.status === 'FAIL') {
    finalAction = 'REASSESS THESIS';
    calibratedConviction = Math.min(baseConviction, 4);
    statusClassification = 'THESIS_DEVIATION';
    decisionExplanation = withDriverNote(`Universal financial health failure: ${universal.reason}.`);
  } else {
    finalAction = 'HOLD / MONITOR';
    calibratedConviction = Math.min(baseConviction, 5);
    statusClassification = 'NEUTRAL_HOLD';
    decisionExplanation = universal.reason || 'Holding position pending further evidence.';
  }

  return {
    actionAuthorized: authorized,
    finalAction,
    calibratedConviction,
    statusClassification,
    decisionExplanation,
    universalGate: universal,
    thesisGate: thesis,
    driverSummary: {
      broken: drivers.broken.map(d => d.driver),
      atRisk: drivers.atRisk.map(d => d.driver),
      confirmed: drivers.confirmed.map(d => d.driver)
    }
  };
}
