/**
 * Thesis Prediction Ledger Service (Layer 3)
 * 
 * CORE PRINCIPLE: At decision timestamp T_S, this service formulates and permanently
 * freezes explicit, falsifiable fundamental and valuation predictions BEFORE any forward
 * outcome resolution occurs. Zero retrospective adaptation or hindsight bias.
 */

import fs from 'fs';
import path from 'path';
import { computeCanonicalHash } from '../utils/canonical-json.util.js';

/**
 * Builds and freezes the explicit prediction ledger for all evaluations.
 * 
 * @param {Array} evidenceSnapshots - The 143 Point-in-Time evidence snapshots
 * @param {Array} replayEvaluations - The 143 replay evaluation records
 * @returns {Array} List of frozen prediction ledger entries
 */
export function buildThesisPredictionLedger(evidenceSnapshots, replayEvaluations) {
  console.log("==========================================================================");
  console.log("=== 📜 FREEZING THESIS PREDICTION LEDGER (AT DECISION TIMESTAMP T_S) ===");
  console.log("==========================================================================");

  const predictionLedger = [];

  for (const ev of replayEvaluations) {
    if (ev.evaluation_type === 'UNKNOWN') {
      predictionLedger.push({
        prediction_id: `PRED_${ev.ticker}_${ev.quarter}`,
        ticker: ev.ticker,
        quarter: ev.quarter,
        decision_timestamp: ev.decision_timestamp,
        proposed_action: ev.proposed_action,
        status: 'UNRESOLVABLE',
        unresolvable_reason: 'ZERO_EVIDENCE_IN_DB',
        predictions: [],
        prediction_hash: '0000000000000000000000000000000000000000000000000000000000000000'
      });
      continue;
    }

    const snap = evidenceSnapshots.find(s => s.filing_id === ev.evidence_ids[0]);
    const m = snap?.current_metrics || {};
    const d = snap?.derived_features || {};

    const action = ev.proposed_action;
    const baselineRevGrowth = d.revenue_growth_yoy_pct ?? null;
    const baselineMargin = m.ebitda_margin_pct ?? null;
    const baselinePe = d.trailing_pe ?? null;

    const predictions = [];

    // Prediction 1: Revenue Growth Trajectory
    if (action === 'ADD' || action === 'RE_ACCUMULATE') {
      predictions.push({
        metric: 'revenue_growth_yoy_pct',
        baseline: baselineRevGrowth,
        expected_direction: 'ACCELERATION_OR_STRONG_GROWTH',
        target_operator: '>=',
        target_value: 15.0,
        horizon_reported_quarters: 1,
        measurement_rule: 'quarterly_reported_revenue_growth'
      });
      predictions.push({
        metric: 'revenue_growth_yoy_pct',
        baseline: baselineRevGrowth,
        expected_direction: 'SUSTAINED_GROWTH',
        target_operator: '>=',
        target_value: 12.0,
        horizon_reported_quarters: 2,
        measurement_rule: 'quarterly_reported_revenue_growth'
      });
    } else if (action === 'HOLD') {
      predictions.push({
        metric: 'revenue_growth_yoy_pct',
        baseline: baselineRevGrowth,
        expected_direction: 'STABLE_OR_POSITIVE',
        target_operator: '>=',
        target_value: 0.0,
        horizon_reported_quarters: 1,
        measurement_rule: 'quarterly_reported_revenue_growth'
      });
    } else if (action === 'GATE' || action === 'KILL') {
      predictions.push({
        metric: 'revenue_growth_yoy_pct',
        baseline: baselineRevGrowth,
        expected_direction: 'HEADWIND_OR_DECELERATION',
        target_operator: '<',
        target_value: 10.0,
        horizon_reported_quarters: 1,
        measurement_rule: 'quarterly_reported_revenue_growth'
      });
    }

    // Prediction 2: EBITDA Margin Quality
    if (action === 'ADD' || action === 'RE_ACCUMULATE') {
      predictions.push({
        metric: 'ebitda_margin_pct',
        baseline: baselineMargin,
        expected_direction: 'HEALTHY_MARGIN',
        target_operator: '>=',
        target_value: 12.0,
        horizon_reported_quarters: 1,
        measurement_rule: 'quarterly_reported_ebitda_margin'
      });
    } else if (action === 'GATE' || action === 'KILL') {
      predictions.push({
        metric: 'ebitda_margin_pct',
        baseline: baselineMargin,
        expected_direction: 'MARGIN_COMPRESSION_OR_BELOW_THRESHOLD',
        target_operator: '<',
        target_value: 12.0,
        horizon_reported_quarters: 1,
        measurement_rule: 'quarterly_reported_ebitda_margin'
      });
    }

    // Prediction 3: Valuation Trajectory
    if (action === 'ADD' || action === 'HOLD') {
      predictions.push({
        metric: 'trailing_pe',
        baseline: baselinePe,
        expected_direction: 'RATIONAL_VALUATION',
        target_operator: '<=',
        target_value: 75.0,
        horizon_reported_quarters: 2,
        measurement_rule: 'market_price_to_earnings'
      });
    } else if (action === 'GATE' && baselinePe !== null && baselinePe > 75.0) {
      predictions.push({
        metric: 'trailing_pe',
        baseline: baselinePe,
        expected_direction: 'VALUATION_COMPRESSION',
        target_operator: '<',
        target_value: baselinePe,
        horizon_reported_quarters: 2,
        measurement_rule: 'market_price_to_earnings'
      });
    }

    const predEntry = {
      prediction_id: `PRED_${ev.ticker}_${ev.quarter}`,
      ticker: ev.ticker,
      quarter: ev.quarter,
      decision_timestamp: ev.decision_timestamp,
      evidence_ids: ev.evidence_ids || [],
      previous_state: ev.previous_state,
      proposed_action: ev.proposed_action,
      predictions
    };

    predEntry.prediction_hash = computeCanonicalHash(predEntry);
    predictionLedger.push(predEntry);
  }

  const auditDir = path.resolve(process.cwd(), 'audit');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'THESIS_PREDICTION_LEDGER.json'), JSON.stringify(predictionLedger, null, 2));

  console.log(`✅ Formulated and Frozen ${predictionLedger.length} Explicit Prediction Entries.`);
  console.log(`💾 Saved: audit/THESIS_PREDICTION_LEDGER.json\n`);

  return predictionLedger;
}
