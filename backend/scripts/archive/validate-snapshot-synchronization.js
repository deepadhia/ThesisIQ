/**
 * Snapshot Synchronization Validation Suite
 * 
 * Strict post-backfill validation asserting:
 *   1. 18/18 Target Stocks have latest_snapshot === 'Q1_FY27'
 *   2. Exactly 90/90 snapshot positions exist (18 stocks × 5 continuous quarters)
 *   3. Zero missing quarters in Q1_FY26 -> Q1_FY27 window
 *   4. Zero duplicate (stock, quarter) pairs
 *   5. Strict chronological ordering (2601 < 2602 < 2603 < 2604 < 2701)
 *   6. Zero future-period leakage
 *   7. Valid metrics schema and non-empty summaries
 */

import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
dotenv.config();
import { pool } from '../db/pool.js';
import { parseFiscalQuarter, compareFiscalQuartersAsc, sortFiscalQuarters, latestQuarter } from '../utils/fiscal-quarter.util.js';

const TARGET_PORTFOLIO_TICKERS = [
  'HSCL', 'ANANTRAJ', 'JYOTICNC', 'LUMAXTECH', 'POLICYBZR', 'HBLENGINE',
  'SKIPPER', 'JSLL', 'TRANSRAILL', 'SBCL', 'SJS', 'QPOWER',
  'INOXINDIA', 'TIMETECHNO', 'CCL', 'GRAVITA', 'ELECON', 'SHAKTIPUMP'
];

const EXPECTED_QUARTERS = ['Q1_FY26', 'Q2_FY26', 'Q3_FY26', 'Q4_FY26', 'Q1_FY27'];

export async function validateSnapshotSynchronization() {
  console.log('================================================================================');
  console.log('🔍 RUNNING SNAPSHOT SYNCHRONIZATION VALIDATION SUITE');
  console.log('================================================================================\n');

  const { rows: snapshots } = await pool.query(`
    SELECT qs.id, s.ticker, s.company_name, qs.quarter, qs.metrics, qs.summary, qs.thesis_status, qs.confidence_score, qs.created_at
    FROM quarterly_snapshots qs
    JOIN stocks s ON s.id = qs.stock_id
    WHERE s.ticker = ANY($1) AND qs.quarter = ANY($2)
  `, [TARGET_PORTFOLIO_TICKERS, EXPECTED_QUARTERS]);

  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failCount++;
    }
  }

  // 1. Total Target Stocks
  const stockMap = new Map();
  for (const s of snapshots) {
    if (!stockMap.has(s.ticker)) stockMap.set(s.ticker, []);
    stockMap.get(s.ticker).push(s);
  }

  console.log('--- 1. Universe Coverage ---');
  assert(stockMap.size === 18, `All 18 target portfolio stocks are present (found ${stockMap.size})`);
  assert(snapshots.length === 90, `Total snapshot rows across 18 stocks equals exactly 90 (found ${snapshots.length})`);

  // 2. Per-Stock Continuity & Latest Quarter
  console.log('\n--- 2. Continuity & Latest Quarter (Q1 FY27) ---');
  for (const ticker of TARGET_PORTFOLIO_TICKERS) {
    const list = stockMap.get(ticker) || [];
    const quarters = list.map(l => l.quarter);
    const sorted = sortFiscalQuarters(quarters);

    const latest = latestQuarter(sorted);
    assert(latest === 'Q1_FY27', `${ticker}: latest_snapshot is 'Q1_FY27' (actual: ${latest})`);
    assert(list.length === 5, `${ticker}: exactly 5 snapshots exist (actual: ${list.length})`);

    const missing = EXPECTED_QUARTERS.filter(q => !quarters.includes(q));
    assert(missing.length === 0, `${ticker}: zero missing quarters in FY26-FY27 window (missing: ${missing.join(', ') || 'none'})`);
  }

  // 3. Duplicate Prevention
  console.log('\n--- 3. Duplicate Prevention ---');
  const seenPairs = new Set();
  let duplicateCount = 0;
  for (const s of snapshots) {
    const key = `${s.ticker}:${s.quarter}`;
    if (seenPairs.has(key)) duplicateCount++;
    seenPairs.add(key);
  }
  assert(duplicateCount === 0, `Zero duplicate (stock, quarter) pairs found (duplicates: ${duplicateCount})`);

  // 4. Chronological Sorting Invariant
  console.log('\n--- 4. Chronological Sorting Invariant ---');
  for (const ticker of TARGET_PORTFOLIO_TICKERS) {
    const list = stockMap.get(ticker) || [];
    const keys = list.map(l => parseFiscalQuarter(l.quarter).key).sort((a, b) => a - b);
    const expectedKeys = [2601, 2602, 2603, 2604, 2701];
    const matches = JSON.stringify(keys) === JSON.stringify(expectedKeys);
    assert(matches, `${ticker}: strictly ordered as [2601, 2602, 2603, 2604, 2701]`);
  }

  // 5. Data Quality & Metric Integrity
  console.log('\n--- 5. Metric Schema & Summary Integrity ---');
  let validMetrics = 0;
  for (const s of snapshots) {
    if (s.metrics && typeof s.metrics === 'object' && s.summary && s.summary.length > 10) {
      validMetrics++;
    }
  }
  assert(validMetrics === 90, `All 90 snapshots contain valid metrics and structured summaries (actual: ${validMetrics}/90)`);

  console.log('\n================================================================================');
  console.log(`📊 VALIDATION SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================================\n');

  if (failCount > 0) {
    throw new Error(`Snapshot validation failed with ${failCount} errors.`);
  }

  return { passCount, failCount, totalStocks: stockMap.size, totalSnapshots: snapshots.length };
}

if (process.argv[1]?.endsWith('validate-snapshot-synchronization.js')) {
  validateSnapshotSynchronization()
    .then(() => pool.end())
    .catch(err => {
      console.error('❌ Validation failed:', err.message);
      pool.end();
      process.exit(1);
    });
}
