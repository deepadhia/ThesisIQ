/**
 * Production CLI & Cron Runner: Synchronize Portfolio Market Data
 * 
 * Mandate:
 * Automatically synchronizes live trailing market metrics across all portfolio stocks in Supabase.
 * Enforces programmatic mathematical verification and eliminates manual valuation inputs.
 * 
 * Usage:
 * node backend/scripts/sync-portfolio-market-data.js
 */

import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { syncAllPortfolioValuations } from '../services/portfolio-market-valuation.service.js';

async function main() {
  console.log('========================================================================================');
  console.log('🛡️  PORTFOLIO LIVE MARKET DATA SYNCHRONIZATION & MATHEMATICAL AUDIT');
  console.log('========================================================================================\n');

  const startTime = Date.now();
  try {
    const results = await syncAllPortfolioValuations(pool, { period: 'Q1_FY27' });

    console.log(
      'Ticker'.padEnd(14) +
      'Status'.padEnd(20) +
      'Price'.padEnd(10) +
      'Trailing P/E'.padEnd(16) +
      'Market Cap (Cr)'.padEnd(18) +
      'TTM EPS'.padEnd(12) +
      'ROCE'
    );
    console.log('-'.repeat(96));

    let passedCount = 0;
    let failedCount = 0;

    for (const r of results) {
      if (r.success) {
        passedCount++;
        const pStr = `₹${r.sharePrice}`.padEnd(10);
        const peStr = `${r.peRatio}x`.padEnd(16);
        const mcapStr = `₹${r.marketCap}`.padEnd(18);
        const epsStr = `₹${r.ttmEps}`.padEnd(12);
        const roceStr = `${r.rocePct || 'N/A'}%`;
        console.log(
          r.ticker.padEnd(14) +
          `✅ ${r.status}`.padEnd(20) +
          pStr +
          peStr +
          mcapStr +
          epsStr +
          roceStr
        );
      } else {
        failedCount++;
        console.log(
          r.ticker.padEnd(14) +
          `❌ ${r.status}`.padEnd(20) +
          '-'.padEnd(10) +
          '-'.padEnd(16) +
          '-'.padEnd(18) +
          '-'.padEnd(12) +
          `Error: ${r.error}`
        );
      }
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n----------------------------------------------------------------------------------------');
    console.log(`Sync completed in ${elapsedSec}s: ${passedCount} Validated, ${failedCount} Blocked/Failed.`);
    console.log('----------------------------------------------------------------------------------------\n');

    if (failedCount > 0) {
      process.exitCode = 1;
    }

  } catch (err) {
    console.error('Fatal sync error:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
