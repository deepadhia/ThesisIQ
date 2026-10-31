import { replayClaimLineage } from './claim-lineage.service.js';
import { getMarketDataSnapshot } from './market-data-layer.service.js';

/**
 * Phase 4C: Evidence-Supported Scenario & Provenance Engine (V2 - Enforces Economic Semantics)
 * Enforces strict assumption taxonomy, Phase 2 lineage replay, Backlog != Revenue rules,
 * Growth Origin Disclosures, and Complete Backward Reconstruction.
 */

export async function validateScenarioAssumption(assumption, options = {}, pool) {
  if (!assumption || typeof assumption !== 'object') {
    return { isValid: false, errorCode: "MALFORMED_ASSUMPTION", errorMessage: "Assumption object is null or invalid." };
  }

  const {
    assumptionKey,
    assumptionValue,
    provenanceCategory,
    claimId = null,
    rationaleText = "",
    claimedOriginCategory = null,
    isBacklogConversion = false,
    backlogExecutionPeriodYears = null,
    backlogConversionMarginPct = null
  } = assumption;

  // 1. Mandatory Provenance Category Check
  const validCategories = ['VERIFIED_FACT', 'DERIVED_FACT', 'MANAGEMENT_CLAIM', 'ANALYST_ASSUMPTION'];
  if (!provenanceCategory || !validCategories.includes(provenanceCategory)) {
    return {
      isValid: false,
      errorCode: "INVALID_PROVENANCE_CATEGORY",
      errorMessage: `provenanceCategory '${provenanceCategory}' must be one of: ${validCategories.join(', ')}.`
    };
  }

  // 2. Mandatory claim_id Rule for non-analyst assumptions
  if (['VERIFIED_FACT', 'DERIVED_FACT', 'MANAGEMENT_CLAIM'].includes(provenanceCategory) && (!claimId || claimId.trim() === '')) {
    return {
      isValid: false,
      errorCode: "MISSING_CLAIM_ID",
      errorMessage: `Assumption category '${provenanceCategory}' requires a non-null replayable claim_id.`
    };
  }

  // 3. Provenance Misrepresentation Check (Management claim presenting as verified fact)
  if (provenanceCategory === 'VERIFIED_FACT' && claimedOriginCategory === 'MANAGEMENT_CLAIM') {
    return {
      isValid: false,
      errorCode: "PROVENANCE_MISREPRESENTATION",
      errorMessage: "A management claim must NEVER be silently promoted to a VERIFIED_FACT."
    };
  }

  // 4. Backlog != Revenue Enforcement Rule (TEST 14)
  if (assumptionKey.includes("ORDER_BOOK") || assumptionKey.includes("BACKLOG")) {
    if (!isBacklogConversion || !backlogExecutionPeriodYears || !backlogConversionMarginPct) {
      return {
        isValid: false,
        errorCode: "INVALID_BACKLOG_CONVERSION",
        errorMessage: `Backlog/Order-book claim '${assumptionKey}' cannot be directly treated as revenue/PAT/EPS without explicit backlogExecutionPeriodYears and backlogConversionMarginPct parameters.`
      };
    }
  }

  // 5. Lineage Replay Verification & Information Cutoff Check
  let replayRes = null;
  if (claimId) {
    replayRes = await replayClaimLineage(claimId, pool, {
      expectedTicker: options.ticker,
      expectedPeriod: options.period
    });

    if (replayRes.replayStatus === "BLOCKED") {
      return {
        isValid: false,
        errorCode: replayRes.errorCode || "CLAIM_LINEAGE_UNREPLAYABLE",
        errorMessage: `Lineage replay failed for claim_id '${claimId}': ${replayRes.errorMessage}`
      };
    }

    // Check DERIVED_FACT dependency completeness (TEST 13)
    if (provenanceCategory === 'DERIVED_FACT' && (!replayRes.dependencies || replayRes.dependencies.length === 0)) {
      return {
        isValid: false,
        errorCode: "MISSING_DEPENDENCY_LINK",
        errorMessage: `DERIVED_FACT claim '${claimId}' must expose its complete deterministic child claim dependencies in claim_dependencies edge table.`
      };
    }

    // Replay check for Management Claim misrepresentation against DB record
    if (provenanceCategory === 'VERIFIED_FACT' && (replayRes.claimType === 'MANAGEMENT_CLAIM' || replayRes.provenanceType === 'SOURCE_VERIFIED_MANAGEMENT_CLAIM' || replayRes.sourceDocumentType === 'CONCALL_TRANSCRIPT')) {
      return {
        isValid: false,
        errorCode: "PROVENANCE_MISREPRESENTATION",
        errorMessage: `Claim ID '${claimId}' originates from management claim/concall and cannot be marked as VERIFIED_FACT.`
      };
    }

    // Information Cutoff Timestamp Verification
    const claimTimestamp = replayRes.retrievedAt;
    if (options.informationCutoffAt && claimTimestamp) {
      const cutoffDate = new Date(options.informationCutoffAt);
      const claimDate = new Date(claimTimestamp);
      if (claimDate > cutoffDate) {
        return {
          isValid: false,
          errorCode: "INFORMATION_CUTOFF_VIOLATION",
          errorMessage: `Claim ID '${claimId}' timestamp (${claimDate.toISOString()}) is AFTER information_cutoff_at (${cutoffDate.toISOString()}). Hindsight leakage rejected.`
        };
      }
    }
  }

  return {
    isValid: true,
    assumptionKey,
    assumptionValue,
    provenanceCategory,
    claimId,
    rationaleText,
    replayRes
  };
}

/**
 * Computes a Deterministic Valuation Scenario with Growth Origin Disclosure & Backward Reconstruction
 */
export async function computeValuationScenario(scenarioInput, pool) {
  const {
    ticker,
    period,
    scenarioName,
    informationCutoffAt,
    expectedEpsCagrPct,
    expectedEpsCagrOriginCategory, // Must be DERIVED_FACT, ANALYST_ASSUMPTION, or MANAGEMENT_CLAIM (TEST 15)
    expectedTerminalPe,
    assumedNetMarginPct = 40.0,
    assumedDilutionPct = 0.0,
    dividendYieldReturnPct = 0.0,
    valueTrapCategory = "NOT_VALUE_TRAP",
    valueTrapRationale = null,
    assumptions = [],
    llmValuationText = null
  } = scenarioInput;

  // 1. Validate Scenario Name
  const validScenarios = ['BEAR', 'BASE', 'BULL', 'OPTIONALITY'];
  if (!validScenarios.includes(scenarioName)) {
    return { success: false, errorCode: "INVALID_SCENARIO_NAME", errorMessage: `Scenario name '${scenarioName}' must be one of: ${validScenarios.join(', ')}.` };
  }

  // 2. Growth Origin Disclosure Check (TEST 15)
  const validOrigins = ['DERIVED_FACT', 'MANAGEMENT_CLAIM', 'ANALYST_ASSUMPTION'];
  if (!expectedEpsCagrOriginCategory || !validOrigins.includes(expectedEpsCagrOriginCategory)) {
    return {
      success: false,
      errorCode: "UNEXPLAINED_GROWTH_ORIGIN",
      errorMessage: `Operational growth rate (${expectedEpsCagrPct}%) must explicitly declare its provenance origin (DERIVED_FACT, MANAGEMENT_CLAIM, or ANALYST_ASSUMPTION).`
    };
  }

  // 3. Fetch Market Data Snapshot & Enforce Gate 1 Freshness
  const snapshotRes = await getMarketDataSnapshot(ticker, period, pool, { asOfDate: scenarioInput.asOfDate });
  if (snapshotRes.status === "VALUATION_BLOCKED") {
    return { success: false, errorCode: snapshotRes.errorCode, errorMessage: snapshotRes.errorMessage };
  }

  const snapshot = snapshotRes.snapshot;

  // 4. Validate Every Material Assumption & Lineage Provenance
  const validatedAssumptions = [];
  let containsFact = false;
  let containsAnalystGrowth = (expectedEpsCagrOriginCategory === 'ANALYST_ASSUMPTION');

  for (const assumption of assumptions) {
    const valRes = await validateScenarioAssumption(assumption, { ticker, period, informationCutoffAt }, pool);
    if (!valRes.isValid) {
      return {
        success: false,
        errorCode: valRes.errorCode,
        errorMessage: valRes.errorMessage,
        failedAssumptionKey: assumption.assumptionKey
      };
    }
    if (valRes.provenanceCategory === 'VERIFIED_FACT') containsFact = true;
    validatedAssumptions.push(valRes);
  }

  // 5. Assumption Leakage Test Rule (TEST 12)
  // If baseline revenue is VERIFIED_FACT but growth rate is ANALYST_ASSUMPTION, evidence-supported growth is NOT_ESTABLISHED_BY_FACT_ALONE
  const evidenceSupportedGrowthStatus = containsFact && containsAnalystGrowth
    ? "NOT_ESTABLISHED_BY_FACT_ALONE"
    : (containsFact ? "EVIDENCE_SUPPORTED" : "ANALYST_MODELLED");

  // 6. Deterministic Scenario Math
  const P0 = parseFloat(snapshot.share_price);
  const EPS0 = parseFloat(snapshot.ttm_eps);
  const PE0 = parseFloat(snapshot.pe_ratio);
  const N = 5;

  const g = parseFloat(expectedEpsCagrPct) / 100.0;
  const PE_term = parseFloat(expectedTerminalPe);

  const terminalEps = EPS0 * Math.pow(1 + g, N);
  const projectedTargetPriceMid = terminalEps * PE_term;
  const projectedTargetPriceMin = parseFloat((projectedTargetPriceMid * 0.95).toFixed(2));
  const projectedTargetPriceMax = parseFloat((projectedTargetPriceMid * 1.05).toFixed(2));

  const operationalGrowthReturnPct = parseFloat((g * 100.0).toFixed(2));
  const multipleExpansionReturnPct = parseFloat(((Math.pow(PE_term / PE0, 1.0 / N) - 1) * 100.0).toFixed(2));

  // 7. Backward Scenario Reconstruction Traceability Chain (TEST 16)
  const backwardTraceabilityChain = {
    targetPriceRange: `₹${projectedTargetPriceMin} - ₹${projectedTargetPriceMax}`,
    terminalEps: `₹${terminalEps.toFixed(2)} = EPS0 (₹${EPS0}) * (1 + ${expectedEpsCagrPct}% cover 5Y)`,
    growthRateOrigin: `${expectedEpsCagrOriginCategory} (${expectedEpsCagrPct}%)`,
    evidenceSupportedGrowthStatus,
    terminalPeMultiple: `${PE_term}x`,
    baselinePrice: `₹${P0}`,
    baselineEps: `₹${EPS0}`,
    underlyingAssumptionsTrace: validatedAssumptions.map(a => ({
      key: a.assumptionKey,
      value: a.assumptionValue,
      provenanceCategory: a.provenanceCategory,
      claimId: a.claimId || "NONE",
      lineageChain: a.replayRes ? a.replayRes.lineageChain : "ANALYST_ASSUMPTION"
    }))
  };

  return {
    success: true,
    scenarioName,
    ticker,
    period,
    informationCutoffAt,
    baselineSharePrice: P0,
    baselineEps: EPS0,
    baselinePe: PE0,
    evidenceSupportedGrowthStatus,
    growthRateOriginCategory: expectedEpsCagrOriginCategory,
    outputs: {
      expectedEpsCagrPct: g * 100.0,
      expectedTerminalPe: PE_term,
      terminalEps: parseFloat(terminalEps.toFixed(2)),
      projectedTargetPriceMin,
      projectedTargetPriceMax,
      operationalGrowthReturnPct,
      multipleExpansionReturnPct,
      dividendYieldReturnPct: parseFloat(dividendYieldReturnPct),
      valueTrapCategory,
      valueTrapRationale
    },
    backwardTraceabilityChain,
    validatedAssumptions
  };
}

/**
 * Computes & Persists All 4 Valuation Scenarios to DB
 */
export async function computeAndPersistValuationScenarios(params, pool) {
  const { ticker, period, informationCutoffAt, scenarioConfigs = [] } = params;
  const persistedScenarios = [];

  for (const config of scenarioConfigs) {
    const computed = await computeValuationScenario({
      ticker, period, informationCutoffAt, ...config
    }, pool);

    if (!computed.success) {
      return {
        success: false,
        errorCode: computed.errorCode,
        errorMessage: computed.errorMessage,
        failedScenarioName: config.scenarioName,
        failedAssumptionKey: computed.failedAssumptionKey
      };
    }

    const scenQuery = `
      INSERT INTO valuation_scenarios (
        ticker, period, information_cutoff_at, scenario_name, expected_eps_cagr_pct,
        expected_terminal_pe, projected_target_price_min, projected_target_price_max,
        operational_growth_return_pct, multiple_expansion_return_pct, dividend_yield_return_pct,
        value_trap_category, value_trap_rationale
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
      ON CONFLICT (ticker, period, scenario_name, information_cutoff_at) DO UPDATE SET
        expected_eps_cagr_pct = EXCLUDED.expected_eps_cagr_pct,
        expected_terminal_pe = EXCLUDED.expected_terminal_pe,
        projected_target_price_min = EXCLUDED.projected_target_price_min,
        projected_target_price_max = EXCLUDED.projected_target_price_max,
        created_at = NOW()
      RETURNING *;
    `;

    const scenValues = [
      ticker, period, informationCutoffAt, computed.scenarioName,
      computed.outputs.expectedEpsCagrPct, computed.outputs.expectedTerminalPe,
      computed.outputs.projectedTargetPriceMin, computed.outputs.projectedTargetPriceMax,
      computed.outputs.operationalGrowthReturnPct, computed.outputs.multipleExpansionReturnPct,
      computed.outputs.dividendYieldReturnPct, computed.outputs.valueTrapCategory,
      computed.outputs.valueTrapRationale
    ];

    const { rows: scenRows } = await pool.query(scenQuery, scenValues);
    const scenarioRecord = scenRows[0];

    for (const asm of config.assumptions || []) {
      const asmQuery = `
        INSERT INTO valuation_scenario_assumptions (
          scenario_id, assumption_key, assumption_value, provenance_category, claim_id, rationale_text
        ) VALUES ($1, $2, $3, $4, $5, $6);
      `;
      await pool.query(asmQuery, [
        scenarioRecord.id, asm.assumptionKey, asm.assumptionValue, asm.provenanceCategory, asm.claimId || null, asm.rationaleText || ""
      ]);
    }

    persistedScenarios.push({
      scenarioName: computed.scenarioName,
      scenarioRecord,
      outputs: computed.outputs,
      backwardTraceabilityChain: computed.backwardTraceabilityChain
    });
  }

  return {
    success: true,
    status: "SCENARIOS_COMPUTED_AND_PERSISTED",
    persistedScenarios
  };
}
