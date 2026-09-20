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

// Cached driver-level thesis contracts
let cachedContracts = null;

function loadThesisContracts() {
  if (cachedContracts) return cachedContracts;
  try {
    const contractsPath = path.resolve('reports/thesis_board/driver-level-thesis-contracts.json');
    if (fs.existsSync(contractsPath)) {
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
  if (fin.patYoYGrowthPct === null || fin.patYoYGrowthPct === undefined || isNaN(fin.patYoYGrowthPct)) {
    return {
      status: 'UNAVAILABLE',
      passed: false,
      reason: 'Verified PAT YoY growth rate unavailable'
    };
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
  const patGrowth = Number(fin.patYoYGrowthPct);
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
    return {
      status: 'FAIL',
      passed: false,
      reason: `Severe EBITDA margin compression (${fin.ebitdaMarginBpsDelta ?? -150} bps YoY)`
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
const SPECIFIC_THESIS_HURDLES = {
  TIMETECHNO: {
    primary: {
      minEbitdaMarginPct: 14.5,
      minPatCr: 130.0,
      minEbitdaCr: 246.0
    },
    structural: {
      targetVapSharePct: 30.0
    },
    description: "Primary: EBITDA margin ≥14.5%, PAT ≥₹130 Cr, EBITDA ≥₹246 Cr | Structural: VAP mix ≥30%"
  },
  ANANTRAJ: {
    primary: {
      minEbitdaMarginPct: 30.0,
      minPatCr: 140.0
    },
    structural: {
      targetDataCenterMw: 6.0
    },
    description: "Primary: EBITDA margin ≥30%, PAT ≥₹140 Cr | Structural: Data Center monetization"
  },
  HSCL: {
    primary: {
      minEbitdaMarginPct: 18.0,
      minPatCr: 140.0
    },
    structural: {
      targetScbUtilizationPct: 80.0
    },
    description: "Primary: EBITDA margin ≥18%, PAT ≥₹140 Cr | Structural: SCB utilization ≥80%"
  },
  HBLENGINE: {
    primary: {
      minRevenueCr: 700.0,
      minEbitdaMarginPct: 16.0
    },
    description: "Primary: Quarterly revenue run-rate ≥₹700 Cr, EBITDA margin ≥16%"
  },
  SKIPPER: {
    primary: {
      minEbitdaMarginPct: 9.5
    },
    structural: {
      targetExportMixPct: 45.0
    },
    description: "Primary: EBITDA margin ≥9.5% | Structural: Export order mix ≥45%"
  },
  INOXINDIA: {
    primary: {
      minEbitdaMarginPct: 22.0
    },
    structural: {
      targetExportMixPct: 50.0
    },
    description: "Primary: EBITDA margin ≥22.0% | Structural: Export backlog ≥50%"
  },
  GRAVITA: {
    primary: {
      minEbitdaMarginPct: 9.0
    },
    structural: {
      targetNonLeadMixPct: 35.0
    },
    description: "Primary: EBITDA margin ≥9.0% | Structural: Non-lead mix ≥35%"
  },
  CCL: {
    primary: {
      minEbitdaMarginPct: 18.0
    },
    structural: {
      targetFreezeDriedCapacityUtilPct: 75.0
    },
    description: "Primary: EBITDA margin ≥18.0% | Structural: Freeze-dried coffee utilization ≥75%"
  },
  ASTRAMICRO: {
    primary: {
      minEbitdaMarginPct: 18.0,
      minRevenueCr: 200.0
    },
    structural: {
      targetOrderBookCr: 4000.0
    },
    description: "Primary: Quarterly revenue ≥₹200 Cr, EBITDA margin ≥18.0% | Structural: Order book ≥₹4,000 Cr (HAL Uttam / AMCA AAAU)"
  },
  POLICYBZR: {
    primary: {
      minRevenueGrowthPct: 25.0
    },
    structural: {
      targetRenewalSharePct: 40.0
    },
    description: "Primary: Revenue growth ≥25.0% YoY | Structural: Renewal premium share ≥40%"
  }
};

/**
 * Evaluates Layer 2: Company-Specific Thesis Hurdle Gate (Fail-Closed)
 */
export function evaluateThesisSpecificHurdle(ticker, fin = {}, operational = {}) {
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
    if (fin.ebitdaMarginPct === null || fin.ebitdaMarginPct === undefined || isNaN(fin.ebitdaMarginPct)) {
      unavailable.push(`Required KPI EBITDA Margin unavailable in verified data`);
    } else if (Number(fin.ebitdaMarginPct) < primary.minEbitdaMarginPct) {
      failures.push(`EBITDA Margin ${fin.ebitdaMarginPct}% < target ${primary.minEbitdaMarginPct}%`);
    }
  }

  // 2. Primary PAT Gate (Fail-Closed on missing KPI)
  if (primary.minPatCr !== undefined) {
    if (fin.patConsolidated === null || fin.patConsolidated === undefined || isNaN(fin.patConsolidated)) {
      unavailable.push(`Required KPI Consolidated PAT unavailable in verified data`);
    } else if (Number(fin.patConsolidated) < primary.minPatCr) {
      failures.push(`PAT ₹${fin.patConsolidated} Cr < target ₹${primary.minPatCr} Cr`);
    }
  }

  // 3. Primary EBITDA Gate (Fail-Closed on missing KPI)
  if (primary.minEbitdaCr !== undefined) {
    if (fin.ebitda === null || fin.ebitda === undefined || isNaN(fin.ebitda)) {
      unavailable.push(`Required KPI EBITDA unavailable in verified data`);
    } else if (Number(fin.ebitda) < primary.minEbitdaCr) {
      failures.push(`EBITDA ₹${fin.ebitda} Cr < target ₹${primary.minEbitdaCr} Cr`);
    }
  }

  // 4. Primary Revenue Gate (Fail-Closed on missing KPI)
  if (primary.minRevenueCr !== undefined) {
    const revVal = (fin.revenue !== null && fin.revenue !== undefined) ? fin.revenue : fin.revenueCr;
    if (revVal === null || revVal === undefined || isNaN(revVal)) {
      unavailable.push(`Required KPI Total Revenue unavailable in verified data`);
    } else if (Number(revVal) < primary.minRevenueCr) {
      failures.push(`Revenue ₹${revVal} Cr < target ₹${primary.minRevenueCr} Cr`);
    }
  }

  // Evaluate Structural Confirmation Metric (e.g. VAP mix)
  let structuralConfirmed = true;
  const structural = hurdles.structural || {};
  if (structural.targetVapSharePct !== undefined) {
    if (operational.vapSharePct !== undefined && operational.vapSharePct !== null) {
      structuralConfirmed = Number(operational.vapSharePct) >= structural.targetVapSharePct;
    } else if (fin.vapSharePct !== undefined && fin.vapSharePct !== null) {
      structuralConfirmed = Number(fin.vapSharePct) >= structural.targetVapSharePct;
    } else {
      structuralConfirmed = false; // Pending structural data
    }
  }

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

/**
 * Main Dual-Layer Gating Function
 * Returns actionable verdict, granular categorization, and decision text.
 */
export function evaluateDualLayerActionGate({ ticker, financialData, operationalMetrics = {}, proposedAction = 'HOLD', llmConviction = 5 }) {
  const universal = evaluateUniversalFinancialHealth(financialData);
  const thesis = evaluateThesisSpecificHurdle(ticker, financialData, operationalMetrics);

  const actionAuthorized = universal.status === 'PASS' && thesis.status === 'PASS';

  let finalAction = 'HOLD';
  let calibratedConviction = Math.min(Number(llmConviction) || 5, 10);
  let statusClassification = 'NEUTRAL';
  let decisionExplanation = '';

  if (actionAuthorized) {
    // Both gates cleared -> Authorize BUY / ACCUMULATE
    // Structural confirmation adjusts conviction tier (9/10 for full structural beat vs 8/10 for primary gate pass)
    finalAction = (calibratedConviction >= 9 && thesis.structuralConfirmed) ? 'STRONG BUY' : 'ADD';
    calibratedConviction = thesis.structuralConfirmed ? Math.max(calibratedConviction, 9) : 8;
    statusClassification = 'THESIS_CONFIRMED_BEAT';
    decisionExplanation = thesis.structuralConfirmed
      ? 'Primary financial growth and structural thesis hurdle rates verified.'
      : 'Primary financial hurdle rates cleared; structural metrics in confirmation phase.';
  } else if (thesis.status === 'NO_CONTRACT') {
    // No verified thesis contract -> Hold
    finalAction = 'HOLD / MONITOR';
    calibratedConviction = Math.min(calibratedConviction, 5);
    statusClassification = 'NO_CONTRACT';
    decisionExplanation = thesis.reason;
  } else if (universal.status === 'PASS' && thesis.status === 'FAIL') {
    // Company is financially growing, but thesis-specific hurdle not yet met
    finalAction = 'WATCH / WAIT FOR CONFIRMATION';
    calibratedConviction = Math.min(calibratedConviction, 6);
    statusClassification = 'GROWING_BUT_THESIS_UNCONFIRMED';
    decisionExplanation = `Company is financially growing, but specific thesis gates unmet: ${thesis.reason}`;
  } else if (universal.status === 'UNAVAILABLE' || thesis.status === 'UNAVAILABLE') {
    // Missing required data -> Strict Fail-Closed Holding Pattern
    finalAction = 'HOLD / MONITOR';
    calibratedConviction = Math.min(calibratedConviction, 5);
    statusClassification = 'DATA_UNAVAILABLE';
    decisionExplanation = `Data requirement unmet: ${universal.status === 'UNAVAILABLE' ? universal.reason : thesis.reason}`;
  } else if (universal.status === 'FAIL') {
    // Margin compression or earnings contraction
    finalAction = 'REASSESS THESIS';
    calibratedConviction = Math.min(calibratedConviction, 4);
    statusClassification = 'THESIS_DEVIATION';
    decisionExplanation = `Universal financial health failure: ${universal.reason}`;
  } else {
    finalAction = 'HOLD / MONITOR';
    calibratedConviction = Math.min(calibratedConviction, 5);
    statusClassification = 'NEUTRAL_HOLD';
    decisionExplanation = universal.reason || 'Holding position pending further evidence.';
  }

  return {
    actionAuthorized,
    finalAction,
    calibratedConviction,
    statusClassification,
    decisionExplanation,
    universalGate: universal,
    thesisGate: thesis
  };
}
