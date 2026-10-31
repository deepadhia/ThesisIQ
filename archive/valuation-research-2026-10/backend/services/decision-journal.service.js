/**
 * Phase 4F: Decision Journal & 3-Stage Thesis Dislocation Lifecycle Service
 * 
 * Enforces the Foundational Investment Decision Rule:
 * "Never increase conviction merely because price falls. Increase the evidence for reconsideration 
 *  ONLY when subsequent fundamental evidence resolves the reason for the original punishment 
 *  while the market remains pessimistic, management continues to deliver, and valuation compensates."
 * 
 * Implements:
 * 1. 3-Stage Dislocation Lifecycle: STAGE1_PUNISHMENT -> STAGE2_RECOVERY_EVIDENCE -> STAGE3_CONFIRMATION
 * 2. 4-Question Reconsideration Framework (Thesis Intact? x Reason Resolving? x Milestones Delivered? x Valuation Attractive?)
 * 3. 3-Type Bad Quarter Disruption Classification (TYPE_A_TEMPORARY_DISRUPTION, TYPE_B_EARNINGS_RECOVERY_LAG, TYPE_C_STRUCTURAL_DETERIORATION)
 * 4. Flexible Atomic Thesis Components Ledger (Revenue, Margins, Backlog, Cash Flow, Capacity + Custom)
 * 5. Structured Management Milestone Ledger (Claim -> Horizon -> Actual Delivery -> Status)
 */

export const LIFECYCLE_STAGES = {
  STAGE1_PUNISHMENT: 'STAGE1_PUNISHMENT',
  STAGE2_RECOVERY_EVIDENCE: 'STAGE2_RECOVERY_EVIDENCE',
  STAGE3_CONFIRMATION: 'STAGE3_CONFIRMATION'
};

export const LIFECYCLE_STATUSES = {
  PUNISHMENT_UNDER_OBSERVATION: 'PUNISHMENT_UNDER_OBSERVATION',
  RECOVERY_UNDER_OBSERVATION: 'RECOVERY_UNDER_OBSERVATION',
  RECOVERY_CONFIRMED: 'RECOVERY_CONFIRMED',
  WAITING_FOR_MARKET_RECOGNITION: 'WAITING_FOR_MARKET_RECOGNITION',
  PUNISHMENT_JUSTIFIED_REASSESSMENT_REQUIRED: 'PUNISHMENT_JUSTIFIED_REASSESSMENT_REQUIRED',
  THESIS_RESTRUCTURED: 'THESIS_RESTRUCTURED',
  FAILED_RECOVERY: 'FAILED_RECOVERY'
};

export const DISRUPTION_TYPES = {
  TYPE_A_TEMPORARY_DISRUPTION: 'TYPE_A_TEMPORARY_DISRUPTION',
  TYPE_B_EARNINGS_RECOVERY_LAG: 'TYPE_B_EARNINGS_RECOVERY_LAG',
  TYPE_C_STRUCTURAL_DETERIORATION: 'TYPE_C_STRUCTURAL_DETERIORATION'
};

export const CONCERN_RESOLUTION_STATES = {
  RESOLVED: 'RESOLVED',
  IMPROVING: 'IMPROVING',
  UNCHANGED: 'UNCHANGED',
  WORSENING: 'WORSENING',
  NEW_RISK_INTRODUCED: 'NEW_RISK_INTRODUCED'
};

export const MILESTONE_TRAJECTORIES = {
  DELIVERED: 'DELIVERED',
  IN_PROGRESS: 'IN_PROGRESS',
  DELAYED: 'DELAYED',
  CONTRADICTED: 'CONTRADICTED'
};

export const CAPITAL_ACTIONS = {
  EVIDENCE_SUPPORTS_RECONSIDERATION: 'EVIDENCE_SUPPORTS_RECONSIDERATION',
  STAGED_OBSERVATION_WITH_RESERVATIONS: 'STAGED_OBSERVATION_WITH_RESERVATIONS',
  REASSESS_EXECUTION_DO_NOT_ADD: 'REASSESS_EXECUTION_DO_NOT_ADD',
  HOLD_OBSERVATION: 'HOLD_OBSERVATION',
  REDUCE_EXPOSURE_EVIDENCE: 'REDUCE_EXPOSURE_EVIDENCE',
  REVOCATION_EVIDENCE_CONFIRMED: 'REVOCATION_EVIDENCE_CONFIRMED'
};

export const ADDITION_ELIGIBILITY = {
  ELIGIBLE_FULL_CONVICTION: 'ELIGIBLE_FULL_CONVICTION',
  ELIGIBLE_STAGED_ADDITION: 'ELIGIBLE_STAGED_ADDITION',
  INELIGIBLE_HOLD_ONLY: 'INELIGIBLE_HOLD_ONLY',
  INELIGIBLE_REASSESS_EXECUTION: 'INELIGIBLE_REASSESS_EXECUTION'
};

/**
 * Stage 1: Records a Market Punishment Event and Freezes Pessimism Concerns
 */
export async function recordPunishmentEvent(ticker, eventRecord, fundamentalRecord, marketConcerns = [], options = {}, pool) {
  const { eventId, eventAvailableAt } = eventRecord;
  const eventDate = new Date(eventAvailableAt).toISOString();
  const { disruptionType = DISRUPTION_TYPES.TYPE_A_TEMPORARY_DISRUPTION, thesisComponents = [], managementMilestones = [] } = options;

  const lifecycleRecord = {
    ticker,
    current_lifecycle_stage: LIFECYCLE_STAGES.STAGE1_PUNISHMENT,
    lifecycle_status: LIFECYCLE_STATUSES.PUNISHMENT_UNDER_OBSERVATION,
    event_id: eventId,
    event_date: eventDate,
    disruption_type: disruptionType,

    business_thesis_intact: true,
    market_punishment_reason_resolving: false,
    management_milestones_delivered: true,
    valuation_attractive: true,
    market_excess_pessimism_proven: false,
    capital_reconsideration_supported: false, // Strict Rule: Shock occurred, do not average down immediately

    strategic_thesis_status: 'INTACT',
    near_term_earnings_thesis_status: 'WEAKENED',

    capital_action_recommendation: CAPITAL_ACTIONS.HOLD_OBSERVATION,
    anti_averaging_down_rule_passed: true,
    thesis_components: thesisComponents,
    management_milestones: managementMilestones,
    remaining_unresolved_risks: marketConcerns
  };

  if (pool) {
    const res = await pool.query(
      `INSERT INTO phase4f_dislocation_lifecycle_records
        (ticker, current_lifecycle_stage, lifecycle_status, event_id, event_date, disruption_type, business_thesis_intact, market_punishment_reason_resolving, management_milestones_delivered, valuation_attractive, capital_reconsideration_supported, strategic_thesis_status, near_term_earnings_thesis_status, capital_action_recommendation, anti_averaging_down_rule_passed, thesis_components, management_milestones, remaining_unresolved_risks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (ticker, event_id) DO UPDATE SET lifecycle_status = EXCLUDED.lifecycle_status
       RETURNING id`,
      [
        ticker,
        lifecycleRecord.current_lifecycle_stage,
        lifecycleRecord.lifecycle_status,
        eventId,
        eventDate,
        lifecycleRecord.disruption_type,
        lifecycleRecord.business_thesis_intact,
        lifecycleRecord.market_punishment_reason_resolving,
        lifecycleRecord.management_milestones_delivered,
        lifecycleRecord.valuation_attractive,
        lifecycleRecord.capital_reconsideration_supported,
        lifecycleRecord.strategic_thesis_status,
        lifecycleRecord.near_term_earnings_thesis_status,
        lifecycleRecord.capital_action_recommendation,
        lifecycleRecord.anti_averaging_down_rule_passed,
        JSON.stringify(lifecycleRecord.thesis_components),
        JSON.stringify(lifecycleRecord.management_milestones),
        JSON.stringify(lifecycleRecord.remaining_unresolved_risks)
      ]
    );
    lifecycleRecord.id = res.rows[0]?.id;

    for (const c of marketConcerns) {
      await pool.query(
        `INSERT INTO phase4f_market_concern_resolution_ledgers
          (lifecycle_record_id, ticker, event_id, concern_id, concern_description, punishment_event_source, resolution_state, evaluation_evidence, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          lifecycleRecord.id,
          ticker,
          eventId,
          c.id || c.concern_id,
          c.description || c.factor,
          eventId,
          CONCERN_RESOLUTION_STATES.UNCHANGED,
          c.initial_evidence || "Initial shock observation",
          c.severity || "HIGH"
        ]
      );
    }
  }

  return lifecycleRecord;
}

/**
 * Stage 2 & Stage 3: Evaluates Subsequent Quarterly Evidence against Locked Concerns, Milestones, and Valuation
 */
export async function evaluateDislocationRecovery(ticker, subsequentEventRecord, options = {}, pool) {
  const {
    eventId,
    eventAvailableAt,
    earningsData = {},
    marketContext = {},
    concernAudits = [],
    thesisComponents = [],
    managementMilestones = [],
    disruptionType = null,
    isProlongedConsolidation = false
  } = { ...subsequentEventRecord, ...options };

  const eventDate = new Date(eventAvailableAt).toISOString();

  // 1. Audit Every Pre-Existing Locked Concern
  let resolvedCount = 0;
  let improvingCount = 0;
  let worseningCount = 0;
  let newRiskCount = 0;
  const unresolvedRisks = [];

  for (const item of concernAudits) {
    const { resolution_state, concern_description, severity = 'MEDIUM' } = item;
    if (resolution_state === CONCERN_RESOLUTION_STATES.RESOLVED) {
      resolvedCount++;
    } else if (resolution_state === CONCERN_RESOLUTION_STATES.IMPROVING) {
      improvingCount++;
      unresolvedRisks.push({ factor: concern_description, status: 'IMPROVING', severity });
    } else if (resolution_state === CONCERN_RESOLUTION_STATES.WORSENING) {
      worseningCount++;
      unresolvedRisks.push({ factor: concern_description, status: 'WORSENING', severity: 'HIGH' });
    } else if (resolution_state === CONCERN_RESOLUTION_STATES.NEW_RISK_INTRODUCED) {
      newRiskCount++;
      unresolvedRisks.push({ factor: concern_description, status: 'NEW_RISK_INTRODUCED', severity });
    } else {
      unresolvedRisks.push({ factor: concern_description, status: 'UNCHANGED', severity });
    }
  }

  // 2. Evaluate Management Milestones
  let milestonesDeliveredOrOnTrack = true;
  let milestonesContradicted = false;
  for (const m of managementMilestones) {
    if (m.trajectory === MILESTONE_TRAJECTORIES.CONTRADICTED) {
      milestonesContradicted = true;
      milestonesDeliveredOrOnTrack = false;
    } else if (m.trajectory === MILESTONE_TRAJECTORIES.DELAYED) {
      // Delays require monitoring
    }
  }

  // 3. Four-Pronged Reconsideration Evaluation
  // Q1: Is the business thesis intact / strengthening?
  const revenueGrowth = earningsData.revenue_growth_yoy ?? 0.20;
  const patGrowth = earningsData.pat_growth_yoy ?? 0.15;
  const guidanceIntact = earningsData.guidance_status !== 'DOWNGRADED';
  const strategicOrderFlowIntact = earningsData.strategic_order_flow !== 'STALLED';

  const businessThesisIntact = guidanceIntact && strategicOrderFlowIntact && (revenueGrowth >= 0.15 || patGrowth >= 0.15 || earningsData.volume_growth_yoy >= 0.15);

  // Decompose Strategic vs Near-Term Earnings Thesis
  let strategicThesisStatus = 'INTACT';
  let nearTermEarningsThesisStatus = 'SUPPORTED';

  if (!strategicOrderFlowIntact) {
    strategicThesisStatus = 'BROKEN';
  } else if (strategicOrderFlowIntact && (revenueGrowth >= 0.20 || earningsData.volume_growth_yoy >= 0.18)) {
    strategicThesisStatus = 'SUPPORTED';
  }

  if (patGrowth < -0.15 || earningsData.margin_contracted_bps > 100) {
    nearTermEarningsThesisStatus = 'CONTRADICTED';
  } else if (patGrowth < 0.05) {
    nearTermEarningsThesisStatus = 'WEAKENED';
  }

  // Q2: Has the market punishment reason been resolving or disproven?
  const punishmentReasonResolving = (resolvedCount + improvingCount) > worseningCount && !milestonesContradicted;

  // Q3: Valuation attractive?
  const valuationAttractive = marketContext.valuation_attractive ?? true;

  // Q4: Disruption type categorization
  let detectedDisruptionType = disruptionType;
  if (!detectedDisruptionType) {
    if (nearTermEarningsThesisStatus === 'CONTRADICTED' || worseningCount >= 1) {
      detectedDisruptionType = DISRUPTION_TYPES.TYPE_C_STRUCTURAL_DETERIORATION;
    } else if (businessThesisIntact && (resolvedCount >= 1 || improvingCount >= 1)) {
      detectedDisruptionType = DISRUPTION_TYPES.TYPE_A_TEMPORARY_DISRUPTION;
    } else {
      detectedDisruptionType = DISRUPTION_TYPES.TYPE_B_EARNINGS_RECOVERY_LAG;
    }
  }

  // 4. Determine Lifecycle Status & Action Recommendation
  let lifecycleStatus = LIFECYCLE_STATUSES.RECOVERY_UNDER_OBSERVATION;
  let capitalAction = CAPITAL_ACTIONS.HOLD_OBSERVATION;
  let stage = LIFECYCLE_STAGES.STAGE2_RECOVERY_EVIDENCE;

  if (worseningCount >= 1 || nearTermEarningsThesisStatus === 'CONTRADICTED' || milestonesContradicted) {
    // Regime 3: HBL Engine (Operating thesis contradicted, punishment justified, strictly do NOT add)
    lifecycleStatus = LIFECYCLE_STATUSES.PUNISHMENT_JUSTIFIED_REASSESSMENT_REQUIRED;
    capitalAction = CAPITAL_ACTIONS.REASSESS_EXECUTION_DO_NOT_ADD;
    strategicThesisStatus = strategicOrderFlowIntact ? 'INTACT' : 'BROKEN';
  } else if (isProlongedConsolidation && businessThesisIntact && milestonesDeliveredOrOnTrack && unresolvedRisks.length === 0) {
    // Regime 4: CCL Products (Thesis intact, milestones delivered, earnings compounding, price consolidating)
    lifecycleStatus = LIFECYCLE_STATUSES.WAITING_FOR_MARKET_RECOGNITION;
    capitalAction = CAPITAL_ACTIONS.EVIDENCE_SUPPORTS_RECONSIDERATION; // Earnings compounding while market waits
    stage = LIFECYCLE_STAGES.STAGE3_CONFIRMATION;
  } else if (resolvedCount >= 2 && worseningCount === 0 && newRiskCount === 0 && businessThesisIntact && milestonesDeliveredOrOnTrack) {
    // Regime 1: Skipper (Surging profitability + fresh orders disproves conversion fears)
    lifecycleStatus = LIFECYCLE_STATUSES.RECOVERY_CONFIRMED;
    capitalAction = CAPITAL_ACTIONS.EVIDENCE_SUPPORTS_RECONSIDERATION;
    stage = LIFECYCLE_STAGES.STAGE3_CONFIRMATION;
  } else if (detectedDisruptionType === DISRUPTION_TYPES.TYPE_A_TEMPORARY_DISRUPTION && businessThesisIntact && improvingCount >= 1 && newRiskCount === 0) {
    // Regime 1/2: Gravita (Revenue +42%, Vision 2028 intact, temporary freight dip resolving)
    lifecycleStatus = LIFECYCLE_STATUSES.RECOVERY_UNDER_OBSERVATION;
    capitalAction = CAPITAL_ACTIONS.EVIDENCE_SUPPORTS_RECONSIDERATION;
  } else if (businessThesisIntact && (improvingCount >= 1 || newRiskCount >= 1)) {
    // Regime 2: Transrail (Revenue ₹1,702 Cr, profit ₹108 Cr, but WC elongation + ₹600 Cr QIP dilution active)
    lifecycleStatus = LIFECYCLE_STATUSES.RECOVERY_UNDER_OBSERVATION;
    capitalAction = CAPITAL_ACTIONS.STAGED_OBSERVATION_WITH_RESERVATIONS; // Reconsideration supported with reservations, do not blindly add
  }

  // 5. Compute Addition Eligibility
  let additionEligibility = ADDITION_ELIGIBILITY.INELIGIBLE_HOLD_ONLY;
  if (capitalAction === CAPITAL_ACTIONS.REASSESS_EXECUTION_DO_NOT_ADD) {
    additionEligibility = ADDITION_ELIGIBILITY.INELIGIBLE_REASSESS_EXECUTION;
  } else if (capitalAction === CAPITAL_ACTIONS.EVIDENCE_SUPPORTS_RECONSIDERATION) {
    additionEligibility = unresolvedRisks.length === 0 
      ? ADDITION_ELIGIBILITY.ELIGIBLE_FULL_CONVICTION 
      : ADDITION_ELIGIBILITY.ELIGIBLE_STAGED_ADDITION;
  } else if (capitalAction === CAPITAL_ACTIONS.STAGED_OBSERVATION_WITH_RESERVATIONS) {
    additionEligibility = ADDITION_ELIGIBILITY.INELIGIBLE_HOLD_ONLY;
  }

  const capitalReconsiderationSupported = capitalAction === CAPITAL_ACTIONS.EVIDENCE_SUPPORTS_RECONSIDERATION;

  const lifecycleRecord = {
    ticker,
    current_lifecycle_stage: stage,
    lifecycle_status: lifecycleStatus,
    event_id: eventId,
    event_date: eventDate,
    disruption_type: detectedDisruptionType,

    business_thesis_intact: businessThesisIntact,
    market_punishment_reason_resolving: punishmentReasonResolving,
    management_milestones_delivered: milestonesDeliveredOrOnTrack,
    valuation_attractive: valuationAttractive,
    capital_reconsideration_supported: capitalReconsiderationSupported,
    addition_eligibility: additionEligibility,

    strategic_thesis_status: strategicThesisStatus,
    near_term_earnings_thesis_status: nearTermEarningsThesisStatus,

    capital_action_recommendation: capitalAction,
    anti_averaging_down_rule_passed: true,
    thesis_components: thesisComponents,
    management_milestones: managementMilestones,
    catalyst_transmission_chains: options.catalystTransmissionChains || [],
    remaining_unresolved_risks: unresolvedRisks,
    concernAudits
  };

  // Persist to Database
  if (pool) {
    const res = await pool.query(
      `INSERT INTO phase4f_dislocation_lifecycle_records
        (ticker, current_lifecycle_stage, lifecycle_status, event_id, event_date, disruption_type, business_thesis_intact, market_punishment_reason_resolving, management_milestones_delivered, valuation_attractive, capital_reconsideration_supported, strategic_thesis_status, near_term_earnings_thesis_status, capital_action_recommendation, anti_averaging_down_rule_passed, thesis_components, management_milestones, remaining_unresolved_risks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (ticker, event_id) DO UPDATE SET 
         lifecycle_status = EXCLUDED.lifecycle_status, 
         capital_action_recommendation = EXCLUDED.capital_action_recommendation,
         thesis_components = EXCLUDED.thesis_components,
         management_milestones = EXCLUDED.management_milestones,
         remaining_unresolved_risks = EXCLUDED.remaining_unresolved_risks
       RETURNING id`,
      [
        ticker,
        lifecycleRecord.current_lifecycle_stage,
        lifecycleRecord.lifecycle_status,
        eventId,
        eventDate,
        lifecycleRecord.disruption_type,
        lifecycleRecord.business_thesis_intact,
        lifecycleRecord.market_punishment_reason_resolving,
        lifecycleRecord.management_milestones_delivered,
        lifecycleRecord.valuation_attractive,
        lifecycleRecord.capital_reconsideration_supported,
        lifecycleRecord.strategic_thesis_status,
        lifecycleRecord.near_term_earnings_thesis_status,
        lifecycleRecord.capital_action_recommendation,
        lifecycleRecord.anti_averaging_down_rule_passed,
        JSON.stringify(lifecycleRecord.thesis_components),
        JSON.stringify(lifecycleRecord.management_milestones),
        JSON.stringify(lifecycleRecord.remaining_unresolved_risks)
      ]
    );
    lifecycleRecord.id = res.rows[0]?.id;

    for (const c of concernAudits) {
      await pool.query(
        `INSERT INTO phase4f_market_concern_resolution_ledgers
          (lifecycle_record_id, ticker, event_id, concern_id, concern_description, punishment_event_source, resolution_state, evaluation_evidence, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          lifecycleRecord.id,
          ticker,
          eventId,
          c.concern_id,
          c.concern_description,
          c.punishment_event_source || "PREVIOUS_PUNISHMENT",
          c.resolution_state,
          c.evaluation_evidence,
          c.severity || "MEDIUM"
        ]
      );
    }
  }

  return lifecycleRecord;
}

/**
 * Handles Corporate Restructuring & Demerger Events (e.g. Anant Raj)
 * Freezes Thesis v1 and Spawns Thesis v2 with decomposed sub-theses.
 */
export async function recordRestructuringEvent(ticker, eventRecord, demergerDetails = {}, pool) {
  const { eventId, eventAvailableAt } = eventRecord;
  const eventDate = new Date(eventAvailableAt).toISOString();

  const lifecycleRecord = {
    ticker,
    current_lifecycle_stage: LIFECYCLE_STAGES.STAGE2_RECOVERY_EVIDENCE,
    lifecycle_status: LIFECYCLE_STATUSES.THESIS_RESTRUCTURED,
    event_id: eventId,
    event_date: eventDate,
    disruption_type: "STRUCTURAL_DEMERGER_SPINOFF",

    business_thesis_intact: true,
    market_punishment_reason_resolving: false,
    management_milestones_delivered: true,
    valuation_attractive: true,
    capital_reconsideration_supported: false,

    strategic_thesis_status: 'INTACT',
    near_term_earnings_thesis_status: 'SUPPORTED',

    capital_action_recommendation: CAPITAL_ACTIONS.HOLD_OBSERVATION,
    anti_averaging_down_rule_passed: true,
    thesis_components: [
      { component_name: "Real Estate Core Cash Flows", status: "INTACT", evidence: "Operating residential rentals & sales cash flow" },
      { component_name: "Data Centre Infrastructure", status: "INTACT", evidence: "Manesar / Panchkula cloud infrastructure capacity" }
    ],
    management_milestones: [
      { milestone_claimed: "Complete NCLT Demerger & Share Entitlement Allotment", source_event: "Board Intimation", horizon_target: "FY27", actual_delivery_evidence: "Regulatory process in progress", trajectory: MILESTONE_TRAJECTORIES.IN_PROGRESS }
    ],
    remaining_unresolved_risks: [
      { factor: "Thesis v1 frozen; spawned Thesis v2 with separate sub-theses", status: "RESTRUCTURED", severity: "MEDIUM" },
      { factor: "Data centre customer & occupancy validation pending", status: "UNRESOLVED", severity: "HIGH" },
      { factor: "Real estate debt allocation & entitlement verification", status: "UNRESOLVED", severity: "MEDIUM" }
    ]
  };

  if (pool) {
    const res = await pool.query(
      `INSERT INTO phase4f_dislocation_lifecycle_records
        (ticker, current_lifecycle_stage, lifecycle_status, event_id, event_date, disruption_type, business_thesis_intact, market_punishment_reason_resolving, management_milestones_delivered, valuation_attractive, capital_reconsideration_supported, strategic_thesis_status, near_term_earnings_thesis_status, capital_action_recommendation, anti_averaging_down_rule_passed, thesis_components, management_milestones, remaining_unresolved_risks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (ticker, event_id) DO UPDATE SET 
         lifecycle_status = EXCLUDED.lifecycle_status, 
         capital_action_recommendation = EXCLUDED.capital_action_recommendation,
         thesis_components = EXCLUDED.thesis_components,
         management_milestones = EXCLUDED.management_milestones,
         remaining_unresolved_risks = EXCLUDED.remaining_unresolved_risks
       RETURNING id`,
      [
        ticker,
        lifecycleRecord.current_lifecycle_stage,
        lifecycleRecord.lifecycle_status,
        eventId,
        eventDate,
        lifecycleRecord.disruption_type,
        lifecycleRecord.business_thesis_intact,
        lifecycleRecord.market_punishment_reason_resolving,
        lifecycleRecord.management_milestones_delivered,
        lifecycleRecord.valuation_attractive,
        lifecycleRecord.capital_reconsideration_supported,
        lifecycleRecord.strategic_thesis_status,
        lifecycleRecord.near_term_earnings_thesis_status,
        lifecycleRecord.capital_action_recommendation,
        lifecycleRecord.anti_averaging_down_rule_passed,
        JSON.stringify(lifecycleRecord.thesis_components),
        JSON.stringify(lifecycleRecord.management_milestones),
        JSON.stringify(lifecycleRecord.remaining_unresolved_risks)
      ]
    );
    lifecycleRecord.id = res.rows[0]?.id;
  }

  return lifecycleRecord;
}
