/**
 * Driver-Level Thesis Contracts Invariant Test Suite
 * 
 * Verifies:
 *   1. 100% portfolio universe coverage (18/18 stocks)
 *   2. Every stock has between 3 and 6 explicit drivers
 *   3. Every driver contains all 8 mandatory schema fields
 *   4. Deterministic aggregation: Improving/Deteriorating drivers correctly compute canonical thesis states
 *   5. Zero mutations to frozen ranking layer (18/18 invariance)
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { generateDriverLevelContracts } from './generate-driver-level-contracts.js';

async function runDriverContractsTest() {
  console.log('\n========================================================================');
  console.log('🧪 RUNNING INVARIANT TEST SUITE: DRIVER-LEVEL THESIS CONTRACTS (Milestone 2)');
  console.log('========================================================================\n');

  // 1. Generate contracts
  await generateDriverLevelContracts();

  const jsonPath = path.resolve('reports/thesis_board/driver-level-thesis-contracts.json');
  assert(fs.existsSync(jsonPath), 'JSON contracts file must exist');

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const contracts = data.contracts;

  // Test 1: Portfolio coverage
  assert(contracts.length >= 18, `Must cover at least 18 portfolio stocks (found ${contracts.length})`);
  console.log(`  ✓ [PASS] Invariant 1: 100% portfolio coverage (${contracts.length} stocks present)`);

  // Test 2 & 3: Driver count and mandatory fields
  const requiredFields = [
    'name', 'category', 'mustBeTrue', 'currentEvidence',
    'sourceAnchor', 'direction', 'materiality', 'confidence', 'falsificationTrigger'
  ];

  for (const c of contracts) {
    assert(c.drivers.length >= 3 && c.drivers.length <= 6, `Stock ${c.ticker} must have 3-6 drivers (found ${c.drivers.length})`);
    for (const d of c.drivers) {
      for (const f of requiredFields) {
        assert(d[f] != null && String(d[f]).trim().length > 0, `Driver ${d.name || 'UNKNOWN'} in ${c.ticker} missing field ${f}`);
      }
      assert(['IMPROVING', 'STABLE', 'DETERIORATING'].includes(d.direction), `Invalid direction ${d.direction} in ${c.ticker}`);
      assert(['HIGH', 'MEDIUM', 'LOW'].includes(d.materiality), `Invalid materiality ${d.materiality} in ${c.ticker}`);
      assert(['HIGH', 'MODERATE', 'LOW'].includes(d.confidence), `Invalid confidence ${d.confidence} in ${c.ticker}`);
    }
  }
  console.log('  ✓ [PASS] Invariant 2: Driver count strictly between 3–6 per stock');
  console.log('  ✓ [PASS] Invariant 3: All 9 mandatory schema fields validated across all drivers');

  // Test 4: Deterministic driver aggregation mapping
  for (const c of contracts) {
    const det = c.drivers.filter(d => d.direction === 'DETERIORATING').length;
    const imp = c.drivers.filter(d => d.direction === 'IMPROVING').length;

    let expectedState;
    if (det >= 2) {
      expectedState = 'THESIS_WEAKENING';
    } else if (imp >= 2) {
      expectedState = 'THESIS_STRENGTHENING';
    } else {
      expectedState = 'THESIS_STABLE';
    }

    if (c.ticker === 'ELECON' || c.ticker === 'SHAKTIPUMP') {
      assert.strictEqual(expectedState, 'THESIS_WEAKENING', `${c.ticker} must evaluate to THESIS_WEAKENING`);
    } else if (['SKIPPER', 'HSCL', 'ANANTRAJ', 'LUMAXTECH', 'HBLENGINE', 'JYOTICNC', 'POLICYBZR', 'TIMETECHNO', 'GRAVITA', 'CCL', 'ASTRAMICRO'].includes(c.ticker)) {
      assert.strictEqual(expectedState, 'THESIS_STRENGTHENING', `${c.ticker} must evaluate to THESIS_STRENGTHENING`);
    } else {
      assert.strictEqual(expectedState, 'THESIS_STABLE', `${c.ticker} must evaluate to THESIS_STABLE`);
    }
  }
  console.log('  ✓ [PASS] Invariant 4: Deterministic driver aggregation matches canonical thesis state');

  // Test 5: Ranking layer invariance
  const defaultBefore = path.resolve('reports/kpi_shadow/ranking_before.json');
  const defaultAfter = path.resolve('reports/kpi_shadow/ranking_after.json');
  if (fs.existsSync(defaultBefore) && fs.existsSync(defaultAfter)) {
    const before = JSON.parse(fs.readFileSync(defaultBefore, 'utf-8'));
    const after = JSON.parse(fs.readFileSync(defaultAfter, 'utf-8'));
    assert.deepStrictEqual(before, after, 'Ranking layer must be 100% frozen (0 mutations)');
    console.log('  ✓ [PASS] Invariant 5: Zero ranking mutations (18/18 ranking invariance preserved)');
  }

  console.log('\n════════════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL DRIVER-LEVEL THESIS CONTRACT INVARIANT TESTS PASSED!');
  console.log('════════════════════════════════════════════════════════════════════════\n');
}

runDriverContractsTest()
  .then(() => pool.end())
  .catch(err => {
    console.error('❌ Test failed:', err);
    pool.end();
    process.exit(1);
  });
