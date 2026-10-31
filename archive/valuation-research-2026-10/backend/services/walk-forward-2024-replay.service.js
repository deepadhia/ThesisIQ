/**
 * Walk-Forward 2024+ Replay Engine Service
 * 
 * Executes the frozen ruleset (FROZEN_V1) strictly point-in-time across all 20 universe stocks
 * for 2024-01-01 to Present.
 * 
 * Strict Architectural Guarantees:
 * 1. Zero Opportunistic DB Queries: Consumes ONLY immutable evidence snapshots from Step 3.
 * 2. Zero Hardcoded Ticker Branches: All logic is 100% generic quantitative rule evaluation.
 * 3. Every single quarterly evaluation is recorded (NO_CHANGE, STATE_TRANSITION, UNKNOWN).
 * 4. Deterministic SHA256 input and output hashing with transient stripping.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { computeCanonicalHash } from '../utils/canonical-json.util.js';
import { buildPointInTimeEvidenceSnapshots } from './pit-evidence-builder.service.js';

const UNIVERSE = [
  'HBLENGINE', 'GRAVITA', 'ASTRAMICRO', 'MOREPENLAB', 'INOXINDIA',
  'CCL', 'GULPOLY', 'TIMETECHNO', 'SKIPPER', 'QPOWER',
  'LUMAXTECH', 'JSLL', 'JYOTICNC', 'SJS', 'TRANSRAILL',
  'SHAKTIPUMP', 'ANANTRAJ', 'POLICYBZR', 'SBCL', 'ELECON'
];

/**
 * Ensures the replay_evaluations table exists in PostgreSQL.
 */
export async function ensureReplayEvaluationsTable(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS replay_evaluations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL,
      ticker VARCHAR(50) NOT NULL,
      quarter VARCHAR(50) NOT NULL,
      evaluation_type VARCHAR(50) NOT NULL,
      is_initial_t0 BOOLEAN NOT NULL DEFAULT FALSE,
      previous_state VARCHAR(50) NOT NULL,
      current_state VARCHAR(50) NOT NULL,
      proposed_action VARCHAR(50) NOT NULL,
      decision_timestamp DATE NOT NULL,
      evidence_timestamp DATE NOT NULL,
      evidence_timestamp_provenance VARCHAR(100) NOT NULL,
      evidence_ids JSONB NOT NULL,
      price_at_ts NUMERIC,
      decision_reason TEXT NOT NULL,
      rule_version VARCHAR(50) NOT NULL,
      input_hash VARCHAR(64) NOT NULL,
      output_hash VARCHAR(64) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_replay_evals_run_ticker ON replay_evaluations(run_id, ticker);
    CREATE INDEX IF NOT EXISTS idx_replay_evals_decision_date ON replay_evaluations(decision_timestamp);
  `);
}

/**
 * Evaluates the FROZEN_V1 ruleset for a single evidence snapshot.
 */
export function evaluateFrozenV1Rules(snapshot, prevState, isInitialT0) {
  const m = snapshot.current_metrics || {};
  const d = snapshot.derived_features || {};

  const revGrowth = d.revenue_growth_yoy_pct;
  const ebitdaMargin = m.ebitda_margin_pct;
  const marginDeltaBps = d.ebitda_margin_delta_yoy_bps;
  const trailingPe = d.trailing_pe;

  // Case 0: Missing or unparseable metrics
  if (m.revenue_from_ops === undefined || m.revenue_from_ops === null || m.revenue_from_ops === 0) {
    return {
      evaluation_type: 'UNKNOWN',
      previous_state: prevState,
      current_state: prevState === 'NONE' ? 'NONE' : prevState,
      proposed_action: prevState === 'NONE' ? 'NONE' : prevState,
      decision_reason: 'Incomplete or unparseable fundamental metrics in evidence snapshot'
    };
  }

  // Case 1: Initial Underwriting (T0 or from NONE)
  if (isInitialT0 || prevState === 'NONE') {
    if (ebitdaMargin < 8.0 || (revGrowth !== null && revGrowth < -10.0)) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'NONE',
        current_state: 'GATE',
        proposed_action: 'GATE',
        decision_reason: `Initial Underwriting Gated: EBITDA margin (${ebitdaMargin}%) < 8.0% minimum threshold or revenue compressed (${revGrowth || 0}%)`
      };
    }
    return {
      evaluation_type: 'STATE_TRANSITION',
      previous_state: 'NONE',
      current_state: 'ADD',
      proposed_action: 'ADD',
      decision_reason: `Initial Underwriting Pass: Revenue growth (${revGrowth !== null ? revGrowth + '%' : 'N/A'}) and EBITDA margin (${ebitdaMargin}%) satisfy criteria`
    };
  }

  // Case 2: From ADD
  if (prevState === 'ADD') {
    // Structural Collapse / Kill
    if ((marginDeltaBps !== null && marginDeltaBps <= -600) || ebitdaMargin < 4.0) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'ADD',
        current_state: 'KILL',
        proposed_action: 'KILL',
        decision_reason: `Severe Margin Collapse: EBITDA margin compressed by ${marginDeltaBps} bps to ${ebitdaMargin}%`
      };
    }
    // Margin Compression / Slowdown -> GATE
    if ((marginDeltaBps !== null && marginDeltaBps <= -300) || (revGrowth !== null && revGrowth < 0) || ebitdaMargin < 8.0) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'ADD',
        current_state: 'GATE',
        proposed_action: 'GATE',
        decision_reason: `Margin Compression / Headwind: Margin delta ${marginDeltaBps || 'N/A'} bps, EBITDA margin ${ebitdaMargin}%, Rev Growth ${revGrowth || 'N/A'}%`
      };
    }
    // Valuation Overextension
    if (trailingPe !== null && trailingPe > 75.0) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'ADD',
        current_state: 'GATE',
        proposed_action: 'GATE',
        decision_reason: `Extreme Valuation Overextension: Trailing P/E (${trailingPe}x) exceeded Gate ceiling (75.0x)`
      };
    }
    if (trailingPe !== null && trailingPe > 55.0) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'ADD',
        current_state: 'HOLD',
        proposed_action: 'HOLD',
        decision_reason: `Valuation Ceiling Reached: Trailing P/E (${trailingPe}x) exceeded Hold ceiling (55.0x)`
      };
    }
    // Intact
    return {
      evaluation_type: 'NO_CHANGE',
      previous_state: 'ADD',
      current_state: 'ADD',
      proposed_action: 'ADD',
      decision_reason: `Thesis Trajectory Intact: Rev Growth ${revGrowth !== null ? revGrowth + '%' : 'N/A'}, EBITDA Margin ${ebitdaMargin}%`
    };
  }

  // Case 3: From HOLD
  if (prevState === 'HOLD') {
    if ((marginDeltaBps !== null && marginDeltaBps <= -600) || ebitdaMargin < 4.0) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'HOLD',
        current_state: 'KILL',
        proposed_action: 'KILL',
        decision_reason: `Structural Guidance Collapse during Hold: EBITDA margin compressed ${marginDeltaBps} bps to ${ebitdaMargin}%`
      };
    }
    if ((marginDeltaBps !== null && marginDeltaBps <= -300) || (revGrowth !== null && revGrowth < 0) || (trailingPe !== null && trailingPe > 75.0)) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'HOLD',
        current_state: 'GATE',
        proposed_action: 'GATE',
        decision_reason: `Slowdown or Valuation Gate in Hold: P/E ${trailingPe || 'N/A'}x, margin delta ${marginDeltaBps || 'N/A'} bps`
      };
    }
    if (trailingPe !== null && trailingPe <= 45.0 && revGrowth !== null && revGrowth >= 20.0 && ebitdaMargin >= 12.0) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'HOLD',
        current_state: 'ADD',
        proposed_action: 'ADD',
        decision_reason: `Valuation Normalized & Growth Re-accelerated: P/E ${trailingPe}x, Rev Growth ${revGrowth}%`
      };
    }
    return {
      evaluation_type: 'NO_CHANGE',
      previous_state: 'HOLD',
      current_state: 'HOLD',
      proposed_action: 'HOLD',
      decision_reason: `Hold Maintained: Multiple (${trailingPe || 'N/A'}x) remains elevated while fundamental growth continues`
    };
  }

  // Case 4: From GATE
  if (prevState === 'GATE') {
    if (ebitdaMargin < 0 || (marginDeltaBps !== null && marginDeltaBps <= -800)) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'GATE',
        current_state: 'KILL',
        proposed_action: 'KILL',
        decision_reason: `Irreversible Structural Deterioration: Operating loss or EBITDA margin collapse (${ebitdaMargin}%)`
      };
    }
    if (revGrowth !== null && revGrowth >= 15.0 && ebitdaMargin >= 10.0 && marginDeltaBps !== null && marginDeltaBps >= 100) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'GATE',
        current_state: 'RE_ACCUMULATE',
        proposed_action: 'RE_ACCUMULATE',
        decision_reason: `Audited Turnaround Confirmation: Rev Growth ${revGrowth}% and margin expansion +${marginDeltaBps} bps`
      };
    }
    return {
      evaluation_type: 'NO_CHANGE',
      previous_state: 'GATE',
      current_state: 'GATE',
      proposed_action: 'GATE',
      decision_reason: `Gating Condition Continues: EBITDA margin (${ebitdaMargin}%) or growth (${revGrowth || 'N/A'}%) remains constrained`
    };
  }

  // Case 5: From RE_ACCUMULATE
  if (prevState === 'RE_ACCUMULATE') {
    if (revGrowth !== null && revGrowth >= 15.0 && ebitdaMargin >= 12.0) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'RE_ACCUMULATE',
        current_state: 'ADD',
        proposed_action: 'ADD',
        decision_reason: `Sustained Growth Confirmed post-turnaround`
      };
    }
    if ((marginDeltaBps !== null && marginDeltaBps <= -300) || ebitdaMargin < 8.0) {
      return {
        evaluation_type: 'STATE_TRANSITION',
        previous_state: 'RE_ACCUMULATE',
        current_state: 'GATE',
        proposed_action: 'GATE',
        decision_reason: `Relapse after turnaround attempt: Margin delta ${marginDeltaBps} bps`
      };
    }
    return {
      evaluation_type: 'NO_CHANGE',
      previous_state: 'RE_ACCUMULATE',
      current_state: 'RE_ACCUMULATE',
      proposed_action: 'RE_ACCUMULATE',
      decision_reason: `Re-accumulation thesis monitored`
    };
  }

  // Case 6: From KILL
  if (prevState === 'KILL') {
    return {
      evaluation_type: 'NO_CHANGE',
      previous_state: 'KILL',
      current_state: 'KILL',
      proposed_action: 'KILL',
      decision_reason: `Position Terminated: Kill condition executed permanently`
    };
  }

  return {
    evaluation_type: 'UNKNOWN',
    previous_state: prevState,
    current_state: prevState,
    proposed_action: 'NONE',
    decision_reason: `Unhandled state transition from ${prevState}`
  };
}

/**
 * Runs the full 2024+ Walk-Forward Replay across all 20 stocks.
 */
export async function runWalkForward2024Replay(options = {}) {
  const {
    saveToDb = true,
    runId = crypto.randomUUID(),
    client = pool
  } = options;

  console.log("==========================================================================");
  console.log(`=== 🚀 RUNNING 2024+ WALK-FORWARD REPLAY ENGINE (Run ID: ${runId}) ===`);
  console.log("==========================================================================");

  if (saveToDb) {
    await ensureReplayEvaluationsTable(client);
  }

  // 1. Obtain Point-in-Time Evidence Snapshots
  const snapshots = await buildPointInTimeEvidenceSnapshots(client);

  // Group snapshots by ticker and sort chronologically by decision_session_date
  const snapshotsByTicker = {};
  for (const s of snapshots) {
    if (!snapshotsByTicker[s.ticker]) snapshotsByTicker[s.ticker] = [];
    snapshotsByTicker[s.ticker].push(s);
  }

  const allEvaluations = [];
  const stateByTicker = {};

  // Initialize all tickers
  for (const ticker of UNIVERSE) {
    stateByTicker[ticker] = 'NONE';
    const tickerSnapshots = snapshotsByTicker[ticker] || [];

    // Sort chronologically by period_end_date and evidence_timestamp
    tickerSnapshots.sort((a, b) => (a.period_end_date > b.period_end_date ? 1 : -1));

    if (tickerSnapshots.length === 0) {
      // Stock with missing fundamental evidence (e.g. JSLL)
      const unknownEval = {
        run_id: runId,
        ticker,
        quarter: '2024-T0',
        evaluation_type: 'UNKNOWN',
        is_initial_t0: true,
        previous_state: 'NONE',
        current_state: 'NONE',
        proposed_action: 'NONE',
        decision_timestamp: '2024-01-01',
        evidence_timestamp: '2024-01-01',
        evidence_timestamp_provenance: 'ZERO_EVIDENCE_IN_DB',
        evidence_ids: [],
        price_at_ts: null,
        decision_reason: 'Zero XBRL quarterly metrics available in database for point-in-time evaluation',
        rule_version: 'FROZEN_V1',
        input_hash: '0000000000000000000000000000000000000000000000000000000000000000'
      };

      const evalForHash = { ...unknownEval };
      delete evalForHash.run_id;
      unknownEval.output_hash = computeCanonicalHash(evalForHash);
      allEvaluations.push(unknownEval);
      continue;
    }

    // Evaluate snapshots chronologically
    let hasRecorded2024T0 = false;

    for (const snapshot of tickerSnapshots) {
      const prevState = stateByTicker[ticker];
      const isPre2024 = snapshot.decision_session_date < '2024-01-01';
      const isInitial = !hasRecorded2024T0;

      const evalResult = evaluateFrozenV1Rules(snapshot, prevState, isInitial);
      stateByTicker[ticker] = evalResult.current_state;

      // Only record evaluations that occur in the 2024+ backtest window
      if (!isPre2024) {
        const evalRecord = {
          run_id: runId,
          ticker: snapshot.ticker,
          quarter: snapshot.quarter,
          evaluation_type: evalResult.evaluation_type,
          is_initial_t0: isInitial,
          previous_state: evalResult.previous_state,
          current_state: evalResult.current_state,
          proposed_action: evalResult.proposed_action,
          decision_timestamp: snapshot.decision_session_date,
          evidence_timestamp: snapshot.evidence_timestamp,
          evidence_timestamp_provenance: snapshot.evidence_provenance,
          evidence_ids: [snapshot.filing_id, snapshot.metric_id],
          price_at_ts: snapshot.decision_execution_price,
          decision_reason: evalResult.decision_reason,
          rule_version: 'FROZEN_V1',
          input_hash: snapshot.snapshot_hash
        };

        // Compute deterministic output hash (excluding transient run_id)
        const evalForHash = { ...evalRecord };
        delete evalForHash.run_id;
        evalRecord.output_hash = computeCanonicalHash(evalForHash);

        allEvaluations.push(evalRecord);
        hasRecorded2024T0 = true;
      }
    }
  }

  // 2. Persist to DB if requested
  if (saveToDb) {
    console.log(`\n💾 Persisting ${allEvaluations.length} evaluation records to database...`);
    for (const ev of allEvaluations) {
      await client.query(`
        INSERT INTO replay_evaluations (
          run_id, ticker, quarter, evaluation_type, is_initial_t0,
          previous_state, current_state, proposed_action,
          decision_timestamp, evidence_timestamp, evidence_timestamp_provenance,
          evidence_ids, price_at_ts, decision_reason, rule_version,
          input_hash, output_hash
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17
        )
      `, [
        ev.run_id, ev.ticker, ev.quarter, ev.evaluation_type, ev.is_initial_t0,
        ev.previous_state, ev.current_state, ev.proposed_action,
        ev.decision_timestamp, ev.evidence_timestamp, ev.evidence_timestamp_provenance,
        JSON.stringify(ev.evidence_ids), ev.price_at_ts, ev.decision_reason, ev.rule_version,
        ev.input_hash, ev.output_hash
      ]);
    }
  }

  // 3. Derive actionable decisions subset (Initial T0 OR State Transition)
  const actionableDecisions = allEvaluations.filter(e => e.is_initial_t0 || e.evaluation_type === 'STATE_TRANSITION');

  console.log(`\n==========================================================================`);
  console.log(`=== 📊 WALK-FORWARD REPLAY EXECUTION SUMMARY ===`);
  console.log(`==========================================================================`);
  console.log(`Total Universe Stocks Evaluated:      ${UNIVERSE.length}`);
  console.log(`Total Quarterly Evaluations Recorded: ${allEvaluations.length}`);
  console.log(`  - No Change Evaluations (HOLD/ADD): ${allEvaluations.filter(e => e.evaluation_type === 'NO_CHANGE').length}`);
  console.log(`  - State Transitions (Actionable):   ${allEvaluations.filter(e => e.evaluation_type === 'STATE_TRANSITION').length}`);
  console.log(`  - Unknown / Missing Evidence:       ${allEvaluations.filter(e => e.evaluation_type === 'UNKNOWN').length}`);
  console.log(`Total Actionable Decision Points:     ${actionableDecisions.length}`);

  // 4. Save artifacts to audit/
  const outDir = path.resolve(process.cwd(), 'audit');
  fs.writeFileSync(path.join(outDir, 'REPLAY_EVALUATIONS_LEDGER.json'), JSON.stringify(allEvaluations, null, 2));
  fs.writeFileSync(path.join(outDir, 'REPLAY_DECISIONS_ACTIONABLE.json'), JSON.stringify(actionableDecisions, null, 2));

  // Also write CSV for comprehensive spreadsheet audit
  const csvHeaders = [
    'run_id', 'ticker', 'quarter', 'evaluation_type', 'is_initial_t0',
    'previous_state', 'current_state', 'proposed_action',
    'decision_timestamp', 'evidence_timestamp', 'evidence_timestamp_provenance',
    'price_at_ts', 'decision_reason', 'rule_version', 'input_hash', 'output_hash'
  ];
  const csvRows = [csvHeaders.join(',')];
  for (const ev of allEvaluations) {
    const vals = [
      ev.run_id, ev.ticker, ev.quarter, ev.evaluation_type, ev.is_initial_t0,
      ev.previous_state, ev.current_state, ev.proposed_action,
      ev.decision_timestamp, ev.evidence_timestamp, `"${ev.evidence_timestamp_provenance}"`,
      ev.price_at_ts, `"${ev.decision_reason.replace(/"/g, '""')}"`, ev.rule_version,
      ev.input_hash, ev.output_hash
    ];
    csvRows.push(vals.join(','));
  }
  fs.writeFileSync(path.join(outDir, 'REPLAY_EVALUATIONS_LEDGER.csv'), csvRows.join('\n'));

  console.log(`💾 Saved: audit/REPLAY_EVALUATIONS_LEDGER.json`);
  console.log(`💾 Saved: audit/REPLAY_DECISIONS_ACTIONABLE.json`);
  console.log(`💾 Saved: audit/REPLAY_EVALUATIONS_LEDGER.csv`);

  return {
    runId,
    evaluations: allEvaluations,
    actionableDecisions
  };
}
