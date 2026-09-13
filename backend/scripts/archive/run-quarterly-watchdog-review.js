/**
 * Quarterly Thesis Watchdog Review Orchestrator
 * 
 * Production Workflow:
 * 1. Refresh closing price series and compute rolling 365-day 52-Week Highs/Lows.
 * 2. Ingest latest quarterly filing evidence & evaluate driver-level contracts.
 * 3. Synthesize Layer 4 Capital Allocation Matrix (Strong Add, Dips, Hold, Watch).
 * 4. Regenerate Markdown and JSON reports in `reports/thesis_board/`.
 * 5. Run the 4-layer regression test suite to ensure 100% invariant compliance.
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });

import { generateCapitalAllocationFramework } from './generate-capital-allocation-framework.js';
import { generateDriverLevelContracts } from './generate-driver-level-contracts.js';
import { generateFalsifiableTrackingFramework } from './generate-falsifiable-thesis-framework.js';
import { pool } from '../db/pool.js';

async function runQuarterlyWatchdogReview() {
  console.log('\n========================================================================');
  console.log('🏛️ RUNNING AUTOMATED QUARTERLY THESIS WATCHDOG REVIEW');
  console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
  console.log('========================================================================\n');

  try {
    // Step 1: Regenerate Driver-Level Contracts with verified thresholds
    console.log('--- 📋 Step 1: Evaluating Driver-Level Contracts & Triggers ---');
    await generateDriverLevelContracts();

    // Step 2: Generate Master Falsifiable Tracking Framework
    console.log('\n--- 🛡️ Step 2: Generating Falsifiable Thesis Tracking Framework ---');
    generateFalsifiableTrackingFramework();

    // Step 3: Compute Rolling 52W Highs & Generate Layer 4 Actionability Matrix
    console.log('\n--- 📊 Step 3: Synthesizing Capital Allocation Matrix (Rolling 52W Highs) ---');
    await generateCapitalAllocationFramework();

    // Step 4: Run Invariant Regression Test Suites
    console.log('\n--- 🧪 Step 4: Running Invariant Regression Verification ---');
    const tests = [
      'backend/scripts/test-thesis-state-engine.js',
      'backend/scripts/test-driver-contracts.js',
      'backend/scripts/test-walk-forward-replay.js',
      'backend/scripts/test-price-drawdown-validation.js'
    ];

    for (const t of tests) {
      console.log(`  Executing test suite: ${t}...`);
      execSync(`node --env-file=.env.local ${t}`, { stdio: 'inherit' });
    }

    console.log('\n========================================================================');
    console.log('🎉 QUARTERLY THESIS WATCHDOG REVIEW COMPLETED SUCCESSFULLY!');
    console.log('Reports updated in: reports/thesis_board/');
    console.log('========================================================================\n');
  } catch (err) {
    console.error('❌ Error executing quarterly watchdog review:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('run-quarterly-watchdog-review.js')) {
  runQuarterlyWatchdogReview();
}
