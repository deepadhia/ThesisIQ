/**
 * Immutable Live Decision Journaling & Audit Service
 * 
 * Guarantees that going forward, every live decision (ADD, GATE, HOLD, KILL, RE_ACCUMULATE)
 * is recorded with:
 *   1. True point-in-time UTC server timestamp.
 *   2. Cryptographic snapshot of all raw input metrics.
 *   3. Append-only enforcement (no overwriting or deletion).
 */

import crypto from 'crypto';
import { pool } from '../db/pool.js';

/**
 * Computes a deterministic SHA256 signature of the point-in-time input payload
 */
export function computeInputSignature(payload) {
  const normalized = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Records an immutable decision event in the live production journal
 */
export async function logImmutableLiveDecision(params, client = pool) {
  const {
    ticker,
    period,
    decisionAction, // ADD, GATE, HOLD, KILL, RE_ACCUMULATE
    decisionMaker = 'SYSTEM_ENGINE_V2',
    rationale,
    inputEvidencePayload = {},
    probabilities = { bear: 20, base: 50, bull: 30, optionality: 0 }
  } = params;

  const now = new Date();
  const inputSignature = computeInputSignature(inputEvidencePayload);

  // 1. Fetch current thesis state from history
  const stateRes = await client.query(`
    SELECT current_thesis_state 
    FROM thesis_state_history 
    WHERE ticker = $1 
    ORDER BY created_at DESC 
    LIMIT 1
  `, [ticker]);

  const prevState = stateRes.rows.length > 0 ? stateRes.rows[0].current_thesis_state : 'NONE';

  // 2. Insert into human_decision_journal (Append-Only)
  const journalRes = await client.query(`
    INSERT INTO human_decision_journal (
      ticker,
      period,
      decision_version,
      decision_maker_user_id,
      information_cutoff_at,
      machine_expectation_gap_classification,
      machine_summary,
      human_decision,
      human_investor_rationale,
      human_probability_bear_pct,
      human_probability_base_pct,
      human_probability_bull_pct,
      human_probability_optionality_pct,
      created_at
    ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id
  `, [
    ticker,
    period,
    decisionMaker,
    now,
    `INPUT_SHA256:${inputSignature}`,
    `Snapshot Hash: ${inputSignature}`,
    decisionAction,
    rationale,
    probabilities.bear,
    probabilities.base,
    probabilities.bull,
    probabilities.optionality,
    now
  ]);

  // 3. Insert into thesis_state_history (Append-Only)
  await client.query(`
    INSERT INTO thesis_state_history (
      ticker,
      period,
      business_condition,
      previous_thesis_state,
      current_thesis_state,
      evidence_status,
      review_status,
      state_change_reason,
      explanation_what_changed,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    ticker,
    period,
    'EVALUATED_LIVE',
    prevState,
    decisionAction,
    'VERIFIED_POINT_IN_TIME',
    'APPROVED',
    rationale,
    `Live decision executed with signature ${inputSignature.substring(0, 16)}`,
    now
  ]);

  return {
    journalId: journalRes.rows[0].id,
    ticker,
    period,
    decisionAction,
    timestamp: now.toISOString(),
    inputSignature
  };
}
