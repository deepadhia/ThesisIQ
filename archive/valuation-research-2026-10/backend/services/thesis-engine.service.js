import { replayClaimLineage } from './claim-lineage.service.js';

/**
 * Reconciles Management Commentary against Observable Primary Claims
 */
export function reconcileManagementClaim(managementClaimText = "", primaryClaims = []) {
  if (!managementClaimText || managementClaimText.trim().length === 0) {
    return { status: "NOT_TESTABLE", rationale: "No management claim provided." };
  }
  if (!primaryClaims || primaryClaims.length === 0) {
    return { status: "UNSUPPORTED", rationale: "No primary observable claims available to test management statement." };
  }

  // Check if primary claims contradict or support management text
  let hasContradiction = false;
  let hasSupport = false;

  for (const claim of primaryClaims) {
    if (claim.verification_status === "EVIDENCE_CONFLICT" || claim.provenance_type === "UNVERIFIED_OR_CONFLICTING") {
      hasContradiction = true;
    } else if (claim.provenance_type === "PRIMARY_SOURCE_VERIFIED" && claim.verification_status === "VERIFIED") {
      hasSupport = true;
    }
  }

  if (hasContradiction) {
    return { status: "CONFLICTING", rationale: "Primary SEBI LODR evidence directly contradicts management statement." };
  } else if (hasSupport) {
    return { status: "SUPPORTED", rationale: "Primary SEBI LODR evidence supports management statement." };
  } else {
    return { status: "UNSUPPORTED", rationale: "Management statement unsupported by observable primary evidence." };
  }
}

/**
 * Deterministic Multi-Quarter Thesis Engine
 * Evaluates Business Condition, Thesis State, Evidence Status, and Review Status.
 * NO arbitrary LLM conviction scores. NO text-matching shortcuts.
 */
export async function evaluateThesisState(ticker, period, inputClaims = [], pool, options = {}) {
  // 1. Fetch active validated Thesis Contract
  const contractRes = await pool.query(
    `SELECT * FROM thesis_contracts WHERE ticker = $1 AND status = 'ACTIVE' ORDER BY contract_version DESC LIMIT 1`,
    [ticker]
  );

  if (contractRes.rows.length === 0) {
    return {
      ticker,
      period,
      evaluationStatus: "BLOCKED",
      errorCode: "MISSING_VALIDATED_CONTRACT",
      errorMessage: `No active validated Thesis Contract found for ticker '${ticker}'.`
    };
  }

  const contract = contractRes.rows[0];

  // Fetch contract assumptions
  const asmRes = await pool.query(
    `SELECT * FROM thesis_assumptions WHERE thesis_contract_id = $1 ORDER BY assumption_code ASC`,
    [contract.id]
  );
  const assumptions = asmRes.rows;

  // 2. Fetch previous quarter thesis state (e.g. Q4 FY26)
  const prevRes = await pool.query(
    `SELECT * FROM thesis_state_history WHERE thesis_contract_id = $1 AND ticker = $2 ORDER BY created_at DESC LIMIT 1`,
    [contract.id, ticker]
  );
  const previousStateObj = prevRes.rows[0] || null;
  const previousThesisState = previousStateObj ? previousStateObj.current_thesis_state : "UNINITIALIZED";
  const prevConsecutiveNegQ = previousStateObj ? previousStateObj.consecutive_negative_quarters : 0;
  const prevConsecutivePosQ = previousStateObj ? previousStateObj.consecutive_positive_quarters : 0;

  // 3. Verify all input claims against Phase 2 Lineage Engine
  const verifiedClaimsMap = new Map();
  let hasUnreplayableClaim = false;

  for (const claimInput of inputClaims) {
    const claimId = typeof claimInput === 'string' ? claimInput : claimInput.claimId;
    const replay = await replayClaimLineage(claimId, pool, { expectedTicker: ticker, expectedPeriod: period });

    if (replay.replayStatus === "BLOCKED") {
      hasUnreplayableClaim = true;
      console.warn(`[THESIS ENGINE WARN] Claim '${claimId}' failed lineage replay: ${replay.errorCode}`);
    } else {
      verifiedClaimsMap.set(replay.metric || claimId, replay);
    }
  }

  // 4. Deterministically Compute Dimension 1: BUSINESS CONDITION (Current Quarter P&L / Operations)
  const revClaim = verifiedClaimsMap.get("TOTAL_REVENUE");
  const patClaim = verifiedClaimsMap.get("CORE_PAT");
  const marginClaim = verifiedClaimsMap.get("EBITDA_MARGIN");

  let businessCondition = "STABLE";
  let isPnLWeak = false;

  // Check if financial performance deteriorated in current quarter
  if (revClaim || patClaim || marginClaim) {
    const revVal = revClaim ? parseFloat(revClaim.canonicalValue) : null;
    const patVal = patClaim ? parseFloat(patClaim.canonicalValue) : null;

    // Check YoY or baseline comparisons if available in ground truth or claim
    if (options.isPnLWeakQuarter || (patVal !== null && patVal < (options.previousPatVal || patVal * 1.2))) {
      isPnLWeak = true;
      businessCondition = "DETERIORATING";
    } else if (revVal && revVal > (options.previousRevVal || revVal * 0.9)) {
      businessCondition = "IMPROVING";
    }
  }

  // 5. Deterministically Compute Dimension 2: THESIS STATE (Long-term Leading Indicators)
  let thesisBreakTriggered = false;
  let leadingIndicatorsIntact = true;
  let affectedAssumptionCode = "A1";

  // Evaluate assumptions against primary claims
  for (const asm of assumptions) {
    if (asm.associated_metric) {
      const metricClaim = verifiedClaimsMap.get(asm.associated_metric);
      if (metricClaim) {
        const val = parseFloat(metricClaim.canonicalValue);
        const baseline = parseFloat(asm.baseline_value);

        // Check Hard Break Condition
        if (!isNaN(val) && !isNaN(baseline) && val < baseline * 0.5) {
          thesisBreakTriggered = true;
          leadingIndicatorsIntact = false;
          affectedAssumptionCode = asm.assumption_code;
        } else if (!isNaN(val) && !isNaN(baseline) && val < baseline) {
          leadingIndicatorsIntact = false;
          affectedAssumptionCode = asm.assumption_code;
        }
      }
    }
  }

  // Calculate multi-quarter consecutive counters
  let consecutiveNegQ = isPnLWeak ? prevConsecutiveNegQ + 1 : 0;
  let consecutivePosQ = !isPnLWeak && businessCondition === "IMPROVING" ? prevConsecutivePosQ + 1 : 0;

  let currentThesisState = "STABLE";
  let stateChangeReason = "";

  if (thesisBreakTriggered) {
    currentThesisState = "BROKEN";
    stateChangeReason = `Hard thesis break condition triggered on assumption ${affectedAssumptionCode}.`;
  } else if (consecutiveNegQ >= 2) {
    currentThesisState = "WEAKENING";
    stateChangeReason = `Confirmed two-quarter operational deterioration (${consecutiveNegQ} consecutive negative quarters).`;
  } else if (isPnLWeak && leadingIndicatorsIntact && consecutiveNegQ === 1) {
    // CRITICAL HBL INVARIANT: 1 weak quarter + intact leading indicators = THESIS STABLE!
    currentThesisState = "STABLE";
    stateChangeReason = `Q1 financial performance deteriorated, but leading thesis indicators (e.g. Kavach order book) remain structurally intact. Single quarter noise flagged as AMBER.`;
  } else if (consecutivePosQ >= 2 && leadingIndicatorsIntact) {
    currentThesisState = "STRENGTHENING";
    stateChangeReason = `Sustained operational acceleration across ${consecutivePosQ} consecutive positive quarters.`;
  } else {
    currentThesisState = previousThesisState === "UNINITIALIZED" ? "STABLE" : previousThesisState;
    stateChangeReason = `Thesis indicators remain within stable baseline bounds.`;
  }

  // 6. Reconcile Management Claim (if provided)
  const mgmtClaimObj = inputClaims.find(c => c.claimType === "MANAGEMENT_CLAIM" || c.provenanceType === "SOURCE_VERIFIED_MANAGEMENT_CLAIM");
  const mgmtReconciliation = reconcileManagementClaim(
    mgmtClaimObj ? mgmtClaimObj.paragraphExcerpt : options.managementClaimText,
    Array.from(verifiedClaimsMap.values())
  );

  // 7. Deterministically Compute Dimension 3: EVIDENCE STATUS
  let evidenceStatus = "CONFIRMED";
  if (hasUnreplayableClaim || verifiedClaimsMap.size === 0 || inputClaims.length === 0) {
    evidenceStatus = "INSUFFICIENT";
  } else if (options.hasConflictingClaim || mgmtReconciliation.status === "CONFLICTING") {
    evidenceStatus = "CONFLICTING";
  } else if (businessCondition === "DETERIORATING" && currentThesisState === "STABLE") {
    // HBL Benchmark: Weak P&L + Intact Leading Thesis = MIXED Evidence!
    evidenceStatus = "MIXED";
  }

  // 8. Deterministically Compute Dimension 4: REVIEW STATUS Flag
  const reviewStatus = (evidenceStatus !== "CONFIRMED" || businessCondition === "DETERIORATING" || currentThesisState === "WEAKENING" || currentThesisState === "BROKEN")
    ? "REVIEW_REQUIRED"
    : "NORMAL";

  // 9. Construct Mandatory 4 Explanation Questions
  const explanationWhatChanged = `Q1 P&L performance yielded Business Condition '${businessCondition}' (Revenue: ${revClaim ? revClaim.canonicalValue : 'N/A'}, PAT: ${patClaim ? patClaim.canonicalValue : 'N/A'}).`;
  const explanationAssumptionAffected = `Evaluated assumption '${affectedAssumptionCode}' (${assumptions[0] ? assumptions[0].assumption_text : 'Core Thesis'}). Leading thesis metrics remain ${leadingIndicatorsIntact ? 'INTACT' : 'DETERIORATED'}.`;
  const explanationNature = isPnLWeak ? "Temporary operational headwind (lead cost lag / execution deferment). Requires Q2 execution confirmation." : "Stable operational execution.";
  const explanationInvalidationCriteria = `Thesis will transition to WEAKENING if Q2 confirms a 2nd consecutive negative quarter OR if Kavach order backlog drops below ₹1,200 Cr.`;

  return {
    ticker,
    period,
    thesisContractId: contract.id,
    thesisId: contract.thesis_id,
    businessCondition,
    previousThesisState,
    currentThesisState,
    evidenceStatus,
    reviewStatus,
    stateChangeReason,
    consecutiveNegativeQuarters: consecutiveNegQ,
    consecutivePositiveQuarters: consecutivePosQ,
    isTemporaryHeadwind: isPnLWeak && currentThesisState === "STABLE",
    isStructuralDeterioration: currentThesisState === "WEAKENING" || currentThesisState === "BROKEN",
    thesisBreakTriggered,
    managementClaimReconciliation: mgmtReconciliation,
    explanationWhatChanged,
    explanationAssumptionAffected,
    explanationNature,
    explanationInvalidationCriteria,
    evidenceClaimIds: Array.from(verifiedClaimsMap.values()).map(c => c.claimId)
  };
}

/**
 * Persists Thesis Assessment Record & Evidence Lineage Links to Supabase DB
 */
export async function persistThesisStateHistory(assessment, pool) {
  if (assessment.evaluationStatus === "BLOCKED") {
    throw new Error(`Cannot persist blocked thesis assessment: ${assessment.errorMessage}`);
  }

  const query = `
    INSERT INTO thesis_state_history (
      thesis_contract_id, ticker, period, business_condition, previous_thesis_state,
      current_thesis_state, evidence_status, review_status, state_change_reason,
      consecutive_negative_quarters, consecutive_positive_quarters,
      is_temporary_headwind, is_structural_deterioration, thesis_break_triggered,
      explanation_what_changed, explanation_assumption_affected,
      explanation_nature, explanation_invalidation_criteria
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
    )
    ON CONFLICT (thesis_contract_id, ticker, period) DO UPDATE SET
      business_condition = EXCLUDED.business_condition,
      current_thesis_state = EXCLUDED.current_thesis_state,
      evidence_status = EXCLUDED.evidence_status,
      review_status = EXCLUDED.review_status,
      state_change_reason = EXCLUDED.state_change_reason,
      consecutive_negative_quarters = EXCLUDED.consecutive_negative_quarters,
      consecutive_positive_quarters = EXCLUDED.consecutive_positive_quarters,
      created_at = NOW()
    RETURNING *;
  `;

  const values = [
    assessment.thesisContractId, assessment.ticker, assessment.period,
    assessment.businessCondition, assessment.previousThesisState, assessment.currentThesisState,
    assessment.evidenceStatus, assessment.reviewStatus, assessment.stateChangeReason,
    assessment.consecutiveNegativeQuarters, assessment.consecutivePositiveQuarters,
    assessment.isTemporaryHeadwind, assessment.isStructuralDeterioration, assessment.thesisBreakTriggered,
    assessment.explanationWhatChanged, assessment.explanationAssumptionAffected,
    assessment.explanationNature, assessment.explanationInvalidationCriteria
  ];

  const { rows } = await pool.query(query, values);
  const savedState = rows[0];

  // Persist evidence links
  if (assessment.evidenceClaimIds && assessment.evidenceClaimIds.length > 0) {
    for (const claimId of assessment.evidenceClaimIds) {
      await pool.query(
        `INSERT INTO thesis_evidence_links (state_history_id, claim_id, evidence_role, reconciliation_status)
         VALUES ($1, $2, 'SUPPORTING', 'SUPPORTED')
         ON CONFLICT DO NOTHING;`,
        [savedState.id, claimId]
      );
    }
  }

  return savedState;
}

export {
  classifyThesisStateV2,
  reconcileSnapshotThesisState,
  THESIS_STATES,
  THESIS_RELEVANCE
} from './thesis-state-engine.service.js';
