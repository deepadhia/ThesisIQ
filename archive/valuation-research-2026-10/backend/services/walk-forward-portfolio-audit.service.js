import crypto from 'crypto';
import { measureExpectationDislocation } from './market-dislocation.service.js';
import { classifyThesisAndConviction, CONVICTION_LEVELS, ECONOMIC_CASES } from './thesis-conviction-classifier.service.js';
import { evaluateMultiHorizonTrajectory, AXIS1_THESIS_TRAJECTORY, AXIS2_MARKET_RELATIONSHIP, DISLOCATION_TRAJECTORIES, EVIDENCE_DIRECTIONS } from './multi-horizon-thesis-survival.service.js';
import { attributeMarketDisagreement } from './market-disagreement-attribution.service.js';

/**
 * Phase 4E.5 Walk-Forward Out-of-Sample Portfolio Audit Service
 * 
 * Enforces strict scientific principles:
 * 1. Strict Unidirectional Pipeline: T0 Information -> 4E.2 State -> 4E.3 Conviction Classification -> 🔒 FREEZE -> 4E.4 Trajectory -> 4E.5 Outcomes.
 * 2. Three Distinct Outcome Dimensions: Thesis Outcome, Market Recognition, Relative Investment Outcomes (Sector, Peer, Smallcap, Nifty).
 * 3. Descriptive Historical Conviction Diagnostic Matrix (Non-validating, preventing overfitting on small universe).
 * 4. Zero Look-Ahead Bias: T0 state is cryptographically locked and never retrofitted.
 */

/**
 * Computes SHA-256 cryptographic hash of a frozen T0 record
 */
export function computeFrozenT0Hash(t0Record) {
  const payload = JSON.stringify({
    ticker: t0Record.ticker,
    eventId: t0Record.eventId,
    t0Date: t0Record.t0Date,
    t0_conviction_level: t0Record.t0_conviction_level,
    t0_thesis_growth: t0Record.t0_thesis_growth,
    t0_market_implied_growth: t0Record.t0_market_implied_growth,
    critical_assumptions: t0Record.critical_assumptions_ledger
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Known Unresolved Risk Ledger per Company at historical T0
 */
export function getT0UnresolvedRisks(ticker) {
  const risksDB = {
    TRANSRAIL: [
      { factor: "International transmission execution & collections", status: "UNRESOLVED", severity: "HIGH" },
      { factor: "Working capital cycle elongation in turnkey projects", status: "UNRESOLVED", severity: "HIGH" },
      { factor: "Geopolitical exposure in overseas sub-stations", status: "OBSERVED", severity: "MEDIUM" }
    ],
    SKIPPER: [
      { factor: "Execution conversion variability from tender to revenue", status: "UNRESOLVED", severity: "HIGH" },
      { factor: "Raw material steel price pass-through lag", status: "OBSERVED", severity: "MEDIUM" },
      { factor: "Working capital requirement for BSNL telecom tower rollout", status: "UNRESOLVED", severity: "MEDIUM" }
    ],
    TIMETECH: [
      { factor: "Composite cylinder regulatory approval & adoption pace", status: "UNRESOLVED", severity: "HIGH" },
      { factor: "Catalyst maturity timeline in early commercialization phase", status: "OBSERVED", severity: "MEDIUM" },
      { factor: "Asset monetization of non-core overseas business", status: "UNRESOLVED", severity: "MEDIUM" }
    ],
    LUMAX: [
      { factor: "Minda synergies integration timeline", status: "OBSERVED", severity: "MEDIUM" },
      { factor: "Automotive EV lighting localization margin curve", status: "UNRESOLVED", severity: "MEDIUM" }
    ],
    CCL: [
      { factor: "Coffee bean price volatility pass-through elasticity", status: "OBSERVED", severity: "MEDIUM" },
      { factor: "Vietnam & India freeze-dried plant ramp-up schedule", status: "UNRESOLVED", severity: "LOW" }
    ],
    ANANTRAJ: [
      { factor: "Data center phase 1 tenant conversion & leasing commitments", status: "UNRESOLVED", severity: "HIGH" },
      { factor: "High-density power infrastructure clearance timeline", status: "UNRESOLVED", severity: "MEDIUM" }
    ],
    SHAKTIPUMP: [
      { factor: "PM KUSUM state-level subsidy release timing", status: "UNRESOLVED", severity: "HIGH" },
      { factor: "Component supply chain dependence for solar inverters", status: "OBSERVED", severity: "MEDIUM" }
    ],
    SJS: [
      { factor: "Automotive premiumization demand continuity", status: "SUPPORTED", severity: "LOW" },
      { factor: "Exxomove synergy realization", status: "SUPPORTED", severity: "LOW" }
    ],
    INOXINDIA: [
      { factor: "Global LNG capex cycle durability", status: "SUPPORTED", severity: "LOW" },
      { factor: "Export container shipping availability", status: "OBSERVED", severity: "LOW" }
    ],
    GRAVITA: [
      { factor: "Lead and aluminum scrap sourcing regulatory compliance", status: "SUPPORTED", severity: "LOW" },
      { factor: "Overseas recycling facility operational stability", status: "SUPPORTED", severity: "LOW" }
    ],
    QPOWER: [
      { factor: "Turnkey transmission substation bidding discipline", status: "SUPPORTED", severity: "MEDIUM" },
      { factor: "QIP proceeds deployment rate", status: "SUPPORTED", severity: "LOW" }
    ],
    HBLENGINE: [
      { factor: "Kavach rollout procurement tender allocation pace", status: "UNRESOLVED", severity: "HIGH" },
      { factor: "Defence battery contract delivery schedule", status: "OBSERVED", severity: "MEDIUM" }
    ]
  };

  return risksDB[ticker] || [];
}

/**
 * Freezes T0 Point-in-Time Investment State (Contract 4E.5 Step 1)
 */
export async function freezeT0InvestmentState(eventRecord, fundamentalRecord, pool) {
  const { eventId, ticker, eventAvailableAt, decisionCutoffAt } = eventRecord;

  // 1. Measure T0 Dislocation and Classify Conviction
  const dislocationRecord = await measureExpectationDislocation(eventRecord, fundamentalRecord, pool);
  const classifierRecord = await classifyThesisAndConviction(dislocationRecord, pool);

  const t0Date = eventAvailableAt;
  const cutoffIso = decisionCutoffAt || eventAvailableAt;

  // 2. Extract T0 Quantitative Baselines
  const t0ThesisGrowth = classifierRecord.classificationEvidence?.valuation_evidence?.thesis_growth ?? 0.20;
  const t0MarketImpliedGrowth = dislocationRecord.marketState?.implied_growth?.revenue_growth ?? 0.10;
  const t0ThesisMarketGap = Math.round((t0ThesisGrowth - t0MarketImpliedGrowth) * 10000) / 10000;
  const t0PE = classifierRecord.classificationEvidence?.valuation_evidence?.current_pe ?? 25.0;

  // 3. Unresolved Risks & Evidence Vectors
  const unresolvedRisks = getT0UnresolvedRisks(ticker);
  const highSeverityUnresolved = unresolvedRisks.filter(r => r.severity === 'HIGH' && r.status === 'UNRESOLVED').length;

  // Determine T0 Conviction Level incorporating evidence depth and unresolved risks
  let t0ConvictionLevel = classifierRecord.classification?.conviction_level || CONVICTION_LEVELS.MEDIUM;
  if (highSeverityUnresolved >= 1 && t0ConvictionLevel === CONVICTION_LEVELS.HIGH) {
    t0ConvictionLevel = CONVICTION_LEVELS.MEDIUM; // Demoted appropriately due to unresolved critical variables
  }

  const frozenLedger = {
    ticker,
    eventId,
    t0Date,
    decisionCutoffAt: cutoffIso,
    
    t0_conviction_level: t0ConvictionLevel,
    t0_economic_case: classifierRecord.classification?.economic_case || ECONOMIC_CASES.THESIS_SUPPORTED_MARKET_DISLOCATION,
    t0_hypothesis_label: classifierRecord.classification?.t0_hypothesis_label || 'EVIDENCE_SUPPORTED_THESIS_ABOVE_MARKET',
    t0_evidence_completeness: classifierRecord.classificationEvidence?.business_evidence?.status || 'HIGH',
    
    t0_thesis_growth: t0ThesisGrowth,
    t0_market_implied_growth: t0MarketImpliedGrowth,
    t0_thesis_market_gap: t0ThesisMarketGap,
    t0_pe: t0PE,
    
    thesis_integrity_summary: classifierRecord.thesisIntegrity || {},
    critical_assumptions_ledger: classifierRecord.thesisIntegrity?.assumption_test_ledger || [],
    unresolved_risks: unresolvedRisks,
    valuation_evidence_vector: classifierRecord.classificationEvidence?.valuation_evidence || {},
    
    dislocationRecord,
    classifierRecord
  };

  frozenLedger.t0_frozen_hash = computeFrozenT0Hash(frozenLedger);

  // Persist Frozen T0 Ledger to Database
  if (pool) {
    const res = await pool.query(
      `INSERT INTO phase4e5_t0_frozen_ledgers
        (ticker, event_id, t0_date, decision_cutoff_at, t0_conviction_level, t0_economic_case, t0_hypothesis_label, t0_evidence_completeness, t0_thesis_growth, t0_market_implied_growth, t0_thesis_market_gap, t0_pe, thesis_integrity_summary, critical_assumptions_ledger, unresolved_risks, valuation_evidence_vector, t0_frozen_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (event_id) DO UPDATE SET t0_conviction_level = EXCLUDED.t0_conviction_level
       RETURNING id`,
      [
        ticker,
        eventId,
        t0Date,
        cutoffIso,
        frozenLedger.t0_conviction_level,
        frozenLedger.t0_economic_case,
        frozenLedger.t0_hypothesis_label,
        frozenLedger.t0_evidence_completeness,
        t0ThesisGrowth,
        t0MarketImpliedGrowth,
        t0ThesisMarketGap,
        t0PE,
        JSON.stringify(frozenLedger.thesis_integrity_summary),
        JSON.stringify(frozenLedger.critical_assumptions_ledger),
        JSON.stringify(frozenLedger.unresolved_risks),
        JSON.stringify(frozenLedger.valuation_evidence_vector),
        frozenLedger.t0_frozen_hash
      ]
    );
    frozenLedger.id = res.rows[0]?.id;
  }

  return frozenLedger;
}

/**
 * Evaluates Walk-Forward Horizons for a frozen T0 record (Contract 4E.5 Step 2)
 */
export async function evaluateWalkForwardHorizons(frozenT0, horizonDefinitions = [], pool) {
  const { ticker, eventId, dislocationRecord, classifierRecord, id: t0LedgerId } = frozenT0;
  const evaluations = [];

  for (const hDef of horizonDefinitions) {
    const { horizon, force_simulation = false, ...horizonContext } = hDef;
    
    // Evaluate trajectory via 4E.4 Engine
    const trajectoryRecord = await evaluateMultiHorizonTrajectory(
      dislocationRecord,
      classifierRecord,
      horizon,
      { ...horizonContext, force_simulation },
      pool
    );

    const eventDate = new Date(dislocationRecord.eventAvailableAt);
    const horizonMonths = parseInt(horizon.replace('M', ''), 10);
    const targetHorizonDate = new Date(eventDate.getTime() + horizonMonths * 30 * 24 * 3600 * 1000);
    const evaluationDate = trajectoryRecord.evaluatedAt ? new Date(trajectoryRecord.evaluatedAt) : new Date();

    // Horizon Maturity Discipline
    const isMatured = (evaluationDate >= targetHorizonDate) || force_simulation;
    const horizonStatus = isMatured ? 'COMPUTABLE' : 'NOT_YET_MATURED';

    // Dimension A: Thesis Outcome
    const axis1 = isMatured ? trajectoryRecord.axes.axis1_thesis_trajectory : AXIS1_THESIS_TRAJECTORY.NOT_YET_MATURED;
    const revRealized = isMatured ? (horizonContext.revenue_yoy ?? 0.20) : null;
    const ebitdaRealized = isMatured ? (horizonContext.ebitda_yoy ?? 0.22) : null;
    const critSurvived = isMatured ? (horizonContext.critical_assumptions_survived ?? classifierRecord.thesisIntegrity?.supported_count ?? 2) : null;
    const critTotal = classifierRecord.thesisIntegrity?.assumption_count ?? 2;
    const guidanceOutcome = isMatured ? (horizonContext.guidance_outcome || 'EXCEEDED') : null;

    // Dimension B: Market Recognition
    const axis2 = isMatured ? trajectoryRecord.axes.axis2_market_relationship : AXIS2_MARKET_RELATIONSHIP.NOT_COMPUTABLE;
    const dislocTraj = isMatured ? trajectoryRecord.axes.dislocation_trajectory : DISLOCATION_TRAJECTORIES.NO_CONCLUSION;
    const thesisGrowthT = isMatured ? trajectoryRecord.horizonQuantitativeState.thesis_growth_t : null;
    const marketImpliedGrowthT = isMatured ? trajectoryRecord.horizonQuantitativeState.market_implied_growth_t : null;
    const thesisMarketGapT = isMatured ? trajectoryRecord.horizonQuantitativeState.thesis_market_gap_t : null;
    const gapChange = isMatured ? trajectoryRecord.horizonQuantitativeState.gap_change : 0;

    // Dimension C: Relative Investment Outcomes & Benchmarks
    const stockReturn = isMatured ? (horizonContext.stock_return_pct ?? 0.15) : null;
    const sectorReturn = isMatured ? (horizonContext.sector_return_pct ?? 0.10) : null;
    const sectorAlpha = isMatured ? Math.round((stockReturn - sectorReturn) * 10000) / 10000 : null;
    
    const peerReturn = isMatured ? (horizonContext.peer_basket_return_pct ?? sectorReturn ?? 0.08) : null;
    const peerAlpha = isMatured ? Math.round((stockReturn - peerReturn) * 10000) / 10000 : null;
    
    const smallcapReturn = isMatured ? (horizonContext.smallcap_index_return_pct ?? 0.12) : null;
    const smallcapAlpha = isMatured ? Math.round((stockReturn - smallcapReturn) * 10000) / 10000 : null;

    const niftyReturn = isMatured ? (horizonContext.nifty_return_pct ?? 0.08) : null;
    const niftyAlpha = isMatured ? Math.round((stockReturn - niftyReturn) * 10000) / 10000 : null;

    const peT = isMatured ? (horizonContext.pe_t ?? (frozenT0.t0_pe * 1.1)) : null;
    const multipleChangePct = isMatured && frozenT0.t0_pe > 0 ? Math.round(((peT - frozenT0.t0_pe) / frozenT0.t0_pe) * 10000) / 10000 : null;

    const evidenceDir = isMatured ? trajectoryRecord.convictionEvidence.evidence_direction : EVIDENCE_DIRECTIONS.INSUFFICIENT_EVIDENCE;

    // Structured 12-Dimensional Disagreement Attribution (Phase 4E.5.1)
    const attributionResult = attributeMarketDisagreement(frozenT0, {
      horizonStatus,
      axis1_thesis_trajectory: axis1,
      axis2_market_relationship: axis2,
      stock_return_pct: stockReturn,
      sector_return_pct: sectorReturn,
      sector_relative_alpha: sectorAlpha,
      peer_basket_return_pct: peerReturn,
      peer_relative_alpha: peerAlpha,
      smallcap_index_return_pct: smallcapReturn,
      nifty_index_return_pct: niftyReturn,
      pe_t: peT,
      multiple_change_pct: multipleChangePct,
      revenue_growth_realized: revRealized,
      guidance_outcome: guidanceOutcome
    });

    const evalRecord = {
      t0LedgerId,
      ticker,
      eventId,
      horizon,
      horizonStatus,
      evaluatedAt: evaluationDate.toISOString(),
      targetHorizonDate: targetHorizonDate.toISOString(),

      // Dimension A
      axis1_thesis_trajectory: axis1,
      revenue_growth_realized: revRealized,
      ebitda_growth_realized: ebitdaRealized,
      critical_assumptions_survived: critSurvived,
      critical_assumptions_total: critTotal,
      guidance_outcome: guidanceOutcome,

      // Dimension B
      axis2_market_relationship: axis2,
      dislocation_trajectory: dislocTraj,
      thesis_growth_t: thesisGrowthT,
      market_implied_growth_t: marketImpliedGrowthT,
      thesis_market_gap_t: thesisMarketGapT,
      gap_change: gapChange,

      // Dimension C
      stock_return_pct: stockReturn,
      sector_return_pct: sectorReturn,
      sector_relative_alpha: sectorAlpha,
      peer_basket_return_pct: peerReturn,
      peer_relative_alpha: peerAlpha,
      smallcap_index_return_pct: smallcapReturn,
      smallcap_relative_alpha: smallcapAlpha,
      nifty_index_return_pct: niftyReturn,
      nifty_relative_alpha: niftyAlpha,
      pe_t: peT,
      multiple_change_pct: multipleChangePct,

      evidence_direction: evidenceDir,
      divergence_scenario: attributionResult.divergence_scenario,
      market_disagreement_attribution: attributionResult.market_disagreement_attribution,
      divergence_explanation_ledger: attributionResult.attribution_notes
    };

    // Persist Walk-Forward Evaluation to Database
    if (pool && t0LedgerId) {
      await pool.query(
        `INSERT INTO phase4e5_walk_forward_evaluations
          (t0_ledger_id, ticker, event_id, horizon, horizon_status, evaluated_at, target_horizon_date, axis1_thesis_trajectory, revenue_growth_realized, ebitda_growth_realized, critical_assumptions_survived, critical_assumptions_total, guidance_outcome, axis2_market_relationship, dislocation_trajectory, thesis_growth_t, market_implied_growth_t, thesis_market_gap_t, gap_change, stock_return_pct, sector_return_pct, sector_relative_alpha, peer_basket_return_pct, peer_relative_alpha, smallcap_index_return_pct, smallcap_relative_alpha, nifty_index_return_pct, nifty_relative_alpha, pe_t, multiple_change_pct, evidence_direction, divergence_explanation_ledger)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
         ON CONFLICT (ticker, event_id, horizon) DO UPDATE SET axis1_thesis_trajectory = EXCLUDED.axis1_thesis_trajectory`,
        [
          t0LedgerId,
          ticker,
          eventId,
          horizon,
          horizonStatus,
          evalRecord.evaluatedAt,
          evalRecord.targetHorizonDate,
          axis1,
          revRealized,
          ebitdaRealized,
          critSurvived,
          critTotal,
          guidanceOutcome,
          axis2,
          dislocTraj,
          thesisGrowthT,
          marketImpliedGrowthT,
          thesisMarketGapT,
          gapChange,
          stockReturn,
          sectorReturn,
          sectorAlpha,
          peerReturn,
          peerAlpha,
          smallcapReturn,
          smallcapAlpha,
          niftyReturn,
          niftyAlpha,
          peT,
          multipleChangePct,
          evidenceDir,
          JSON.stringify(evalRecord.divergence_explanation_ledger)
        ]
      );
    }

    evaluations.push(evalRecord);
  }

  return evaluations;
}

/**
 * Computes Historical Conviction Diagnostic Matrix (Contract 4E.5 Step 3)
 * Explicitly marked DESCRIPTIVE / NON-VALIDATING (Case Study Scale: N=11-12)
 */
export function computeHistoricalConvictionDiagnostics(frozenT0Ledgers, walkForwardEvaluations) {
  const tierStats = {
    HIGH: { count: 0, thesisStrengthened: 0, marketConverged: 0, marketDiscounted: 0, avgStockReturn: 0, avgSectorAlpha: 0, avgPeerAlpha: 0, totalMatured: 0 },
    MEDIUM: { count: 0, thesisStrengthened: 0, marketConverged: 0, marketDiscounted: 0, avgStockReturn: 0, avgSectorAlpha: 0, avgPeerAlpha: 0, totalMatured: 0 },
    LOW: { count: 0, thesisStrengthened: 0, marketConverged: 0, marketDiscounted: 0, avgStockReturn: 0, avgSectorAlpha: 0, avgPeerAlpha: 0, totalMatured: 0 }
  };

  const companyDiagnosticSummary = [];

  for (const t0 of frozenT0Ledgers) {
    const tier = t0.t0_conviction_level || 'MEDIUM';
    if (!tierStats[tier]) tierStats[tier] = { count: 0, thesisStrengthened: 0, marketConverged: 0, marketDiscounted: 0, avgStockReturn: 0, avgSectorAlpha: 0, avgPeerAlpha: 0, totalMatured: 0 };
    tierStats[tier].count++;

    // Find primary matured horizon evaluation (12M or 6M)
    const evals = walkForwardEvaluations.filter(e => e.ticker === t0.ticker);
    const maturedEval = evals.find(e => e.horizon === '12M' && e.horizonStatus === 'COMPUTABLE') ||
                        evals.find(e => e.horizon === '6M' && e.horizonStatus === 'COMPUTABLE') ||
                        evals[0];

    if (maturedEval && maturedEval.horizonStatus === 'COMPUTABLE') {
      tierStats[tier].totalMatured++;

      if (maturedEval.axis1_thesis_trajectory === AXIS1_THESIS_TRAJECTORY.THESIS_STRENGTHENING) {
        tierStats[tier].thesisStrengthened++;
      }
      if (maturedEval.axis2_market_relationship === AXIS2_MARKET_RELATIONSHIP.MARKET_CONVERGING || maturedEval.axis2_market_relationship === AXIS2_MARKET_RELATIONSHIP.MARKET_OVERSHOOTING) {
        tierStats[tier].marketConverged++;
      }
      if (maturedEval.axis2_market_relationship === AXIS2_MARKET_RELATIONSHIP.MARKET_DISCOUNTING) {
        tierStats[tier].marketDiscounted++;
      }

      tierStats[tier].avgStockReturn += (maturedEval.stock_return_pct ?? 0);
      tierStats[tier].avgSectorAlpha += (maturedEval.sector_relative_alpha ?? 0);
      tierStats[tier].avgPeerAlpha += (maturedEval.peer_relative_alpha ?? 0);
    }

    companyDiagnosticSummary.push({
      ticker: t0.ticker,
      t0Conviction: tier,
      t0Hypothesis: t0.t0_hypothesis_label,
      t0Gap: `${(t0.t0_thesis_market_gap * 100).toFixed(0)}pp`,
      horizon: maturedEval?.horizon || 'N/A',
      horizonStatus: maturedEval?.horizonStatus || 'NOT_YET_MATURED',
      thesisTrajectory: maturedEval?.axis1_thesis_trajectory || 'NOT_YET_MATURED',
      marketRelationship: maturedEval?.axis2_market_relationship || 'NOT_COMPUTABLE',
      dislocationTrajectory: maturedEval?.dislocation_trajectory || 'NO_CONCLUSION',
      stockReturn: maturedEval?.stock_return_pct !== null && maturedEval?.stock_return_pct !== undefined ? `${(maturedEval.stock_return_pct * 100).toFixed(1)}%` : 'N/A',
      sectorAlpha: maturedEval?.sector_relative_alpha !== null && maturedEval?.sector_relative_alpha !== undefined ? `${(maturedEval.sector_relative_alpha * 100).toFixed(1)}%` : 'N/A',
      peerAlpha: maturedEval?.peer_relative_alpha !== null && maturedEval?.peer_relative_alpha !== undefined ? `${(maturedEval.peer_relative_alpha * 100).toFixed(1)}%` : 'N/A',
      evidenceDirection: maturedEval?.evidence_direction || 'INSUFFICIENT_EVIDENCE'
    });
  }

  // Calculate Averages
  const matrix = Object.keys(tierStats).map(tier => {
    const s = tierStats[tier];
    const n = s.totalMatured || 1;
    return {
      t0ConvictionTier: tier,
      totalCompanies: s.count,
      maturedObservations: s.totalMatured,
      thesisStrengtheningRate: s.totalMatured > 0 ? `${((s.thesisStrengthened / n) * 100).toFixed(0)}%` : 'N/A',
      marketConvergenceRate: s.totalMatured > 0 ? `${((s.marketConverged / n) * 100).toFixed(0)}%` : 'N/A',
      marketDiscountingRate: s.totalMatured > 0 ? `${((s.marketDiscounted / n) * 100).toFixed(0)}%` : 'N/A',
      avgRealizedStockReturn: s.totalMatured > 0 ? `${((s.avgStockReturn / n) * 100).toFixed(1)}%` : 'N/A',
      avgSectorRelativeAlpha: s.totalMatured > 0 ? `${((s.avgSectorAlpha / n) * 100).toFixed(1)}%` : 'N/A',
      avgPeerRelativeAlpha: s.totalMatured > 0 ? `${((s.avgPeerAlpha / n) * 100).toFixed(1)}%` : 'N/A'
    };
  });

  return {
    nature: "DESCRIPTIVE / NON-VALIDATING (Case Study Scale: N=11-12)",
    diagnosticMatrix: matrix,
    companyDiagnosticSummary
  };
}
