/**
 * Daily Asymmetric Valuation Dislocation Watchdog Runner
 * 
 * Runs daily evaluation across the 18-stock cohort.
 * Alerts on high-conviction dislocations (HBL / Time Techno state) with 7-day de-duplication.
 * 
 * Usage:
 *   node backend/scripts/run-daily-valuation-watchdog.js
 *   node backend/scripts/run-daily-valuation-watchdog.js --dry-run
 *   node backend/scripts/run-daily-valuation-watchdog.js --force
 */

import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { evaluateAndDispatchDislocationAlerts } from '../services/valuation-dislocation-watchdog.service.js';

export async function runDailyValuationWatchdog() {
  const isDryRun = process.argv.includes('--dry-run');
  const forceAlert = process.argv.includes('--force');

  console.log('========================================================================');
  console.log('🎯 RUNNING DAILY ASYMMETRIC VALUATION DISLOCATION WATCHDOG');
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (Simulated)' : 'PRODUCTION LIVE'} | Force: ${forceAlert}`);
  console.log('========================================================================\n');

  try {
    const results = await evaluateAndDispatchDislocationAlerts({
      pool,
      isDryRun,
      forceAlert
    });

    console.log('\n========================================================================');
    console.log('🏁 WATCHDOG RUN COMPLETED:');
    console.log(`• Evaluated: ${results.evaluatedCount} holdings`);
    console.log(`• Qualified Dislocations: ${results.dislocationsFound}`);
    console.log(`• Alerts Dispatched: ${results.alertsDispatched} (${results.dispatchedTickers.join(', ') || 'None'})`);
    console.log(`• Alerts Suppressed (7-day Cooldown): ${results.alertsSuppressed} (${results.suppressedTickers.map(s => s.ticker).join(', ') || 'None'})`);
    console.log('========================================================================\n');

    return results;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('run-daily-valuation-watchdog.js')) {
  runDailyValuationWatchdog()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal Watchdog Runner Error:', err);
      process.exit(1);
    });
}
