import { replayClaimLineage } from './claim-lineage.service.js';

/**
 * Thesis Contract Validation Engine
 * Enforces mandatory contract provenance (rationale_claim_id NOT NULL)
 * and verifies replayability, entity isolation, and period alignment.
 */
export async function validateThesisContract(contractObj, pool, options = {}) {
  const {
    thesisId,
    ticker,
    companyName,
    contractVersion = 1,
    thesisStatement,
    assumptions = []
  } = contractObj;

  if (!thesisId || !ticker || !thesisStatement) {
    return {
      isValid: false,
      errorCode: "CONTRACT_VALIDATION_FAILURE",
      errorMessage: "Thesis Contract missing required identity fields (thesisId, ticker, thesisStatement)."
    };
  }

  if (!assumptions || assumptions.length === 0) {
    return {
      isValid: false,
      errorCode: "CONTRACT_VALIDATION_FAILURE",
      errorMessage: "Thesis Contract must contain at least one typed assumption."
    };
  }

  // Validate each assumption for strict rationale & provenance rules
  for (const asm of assumptions) {
    // 1. Mandatory source_rationale check
    if (!asm.sourceRationale || asm.sourceRationale.trim().length === 0) {
      return {
        isValid: false,
        errorCode: "CONTRACT_VALIDATION_FAILURE",
        errorMessage: `Assumption '${asm.code || 'UNKNOWN'}' is missing mandatory written investment source_rationale.`
      };
    }

    // 2. Mandatory rationale_claim_id NOT NULL check
    if (!asm.rationaleClaimId || asm.rationaleClaimId.trim().length === 0) {
      return {
        isValid: false,
        errorCode: "CONTRACT_VALIDATION_FAILURE",
        errorMessage: `Assumption '${asm.code}' is missing mandatory Lineage Citation rationale_claim_id!`
      };
    }

    // 3. Replay rationale claim against Phase 2 Lineage Engine
    const replay = await replayClaimLineage(asm.rationaleClaimId, pool, options);

    if (replay.replayStatus === "BLOCKED") {
      const errCode = replay.errorCode === "PERIOD_MISMATCH" ? "RATIONALE_CLAIM_PERIOD_MISMATCH" :
                      replay.errorCode === "ENTITY_MISMATCH" ? "RATIONALE_CLAIM_ENTITY_MISMATCH" :
                      "CONTRACT_VALIDATION_FAILURE";
      return {
        isValid: false,
        errorCode: errCode,
        errorMessage: `Assumption '${asm.code}' rationale_claim_id '${asm.rationaleClaimId}' failed Phase 2 lineage replay: ${replay.errorCode} - ${replay.errorMessage}`
      };
    }

    // 4. Test Rationale Claim Entity Contamination (TEST 16A)
    if (replay.ticker !== ticker) {
      return {
        isValid: false,
        errorCode: "RATIONALE_CLAIM_ENTITY_MISMATCH",
        errorMessage: `Assumption '${asm.code}' rationale_claim_id '${asm.rationaleClaimId}' belongs to ticker '${replay.ticker}', but contract ticker is '${ticker}'!`
      };
    }

    // 5. Test Rationale Claim Period Contamination (TEST 16B)
    if (options.expectedPeriod && replay.period !== options.expectedPeriod) {
      return {
        isValid: false,
        errorCode: "RATIONALE_CLAIM_PERIOD_MISMATCH",
        errorMessage: `Assumption '${asm.code}' rationale_claim_id '${asm.rationaleClaimId}' period is '${replay.period}', but expected '${options.expectedPeriod}'!`
      };
    }
  }

  return {
    isValid: true,
    thesisId,
    ticker,
    contractVersion,
    validatedAssumptionsCount: assumptions.length,
    status: "VALIDATED"
  };
}

/**
 * Persists a Validated Thesis Contract to Supabase DB (Refuses to save if validation fails)
 */
export async function saveThesisContract(contractObj, pool, options = {}) {
  const validation = await validateThesisContract(contractObj, pool, options);
  if (!validation.isValid) {
    throw new Error(`[CONTRACT_VALIDATION_FAILURE] ${validation.errorCode}: ${validation.errorMessage}`);
  }

  const {
    thesisId,
    ticker,
    companyName,
    contractVersion = 1,
    thesisStatement,
    assumptions = []
  } = contractObj;

  // Insert contract header
  const contractQuery = `
    INSERT INTO thesis_contracts (thesis_id, ticker, company_name, contract_version, status, thesis_statement)
    VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
    ON CONFLICT (thesis_id, contract_version) DO UPDATE SET
      thesis_statement = EXCLUDED.thesis_statement,
      updated_at = NOW()
    RETURNING *;
  `;

  const contractRes = await pool.query(contractQuery, [thesisId, ticker, companyName, contractVersion, thesisStatement]);
  const savedContract = contractRes.rows[0];

  // Insert contract assumptions
  const asmRows = [];
  for (const asm of assumptions) {
    const asmQuery = `
      INSERT INTO thesis_assumptions (
        thesis_contract_id, assumption_code, assumption_text, indicator_type,
        associated_metric, baseline_value, warning_threshold_expression,
        break_threshold_expression, source_rationale, rationale_claim_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (thesis_contract_id, assumption_code) DO UPDATE SET
        assumption_text = EXCLUDED.assumption_text,
        baseline_value = EXCLUDED.baseline_value,
        warning_threshold_expression = EXCLUDED.warning_threshold_expression,
        break_threshold_expression = EXCLUDED.break_threshold_expression,
        source_rationale = EXCLUDED.source_rationale,
        rationale_claim_id = EXCLUDED.rationale_claim_id
      RETURNING *;
    `;

    const asmRes = await pool.query(asmQuery, [
      savedContract.id,
      asm.code,
      asm.text,
      asm.indicatorType,
      asm.associatedMetric || null,
      asm.baselineValue,
      asm.warningThresholdExpression || null,
      asm.breakThresholdExpression || null,
      asm.sourceRationale,
      asm.rationaleClaimId
    ]);

    asmRows.push(asmRes.rows[0]);
  }

  return {
    contract: savedContract,
    assumptions: asmRows,
    validationStatus: "VALIDATED_AND_PERSISTED"
  };
}
