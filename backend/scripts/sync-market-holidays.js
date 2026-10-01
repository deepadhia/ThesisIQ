/**
 * Production CLI & Cron Runner: Synchronize Dynamic Market Holidays
 * 
 * Mandate:
 * Fetches the official trading holiday calendar dynamically from the National Stock Exchange (NSE).
 * Caches and persists the verified holiday schedule into PostgreSQL (system_settings table)
 * with robust offline fallback to ensure continuous high-availability.
 * 
 * Usage:
 *   node backend/scripts/sync-market-holidays.js
 *   node backend/scripts/sync-market-holidays.js --force
 */

import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { 
  syncDynamicMarketHolidays, 
  getMarketHolidaysMap, 
  getMarketHolidayDetails,
  getIstDateYmd
} from '../services/market-holidays.service.js';

async function main() {
  console.log('========================================================================');
  console.log('📅 DYNAMIC MARKET HOLIDAY SYNCHRONIZATION (NSE / BSE)');
  console.log('========================================================================\n');

  const startTime = Date.now();
  try {
    const syncResult = await syncDynamicMarketHolidays(pool, { forceLive: true });
    
    console.log(`• Status: ${syncResult.success ? '✅ SUCCESS (Live Sync)' : '⚠️ FALLBACK (Cached/Static)'}`);
    console.log(`• Source: ${syncResult.source}`);
    console.log(`• Active Holidays Count: ${syncResult.count}`);
    if (syncResult.liveCount) {
      console.log(`• Live NSE Records Ingested: ${syncResult.liveCount}`);
    }
    if (syncResult.error) {
      console.log(`• Fallback Reason: ${syncResult.error}`);
    }

    const todayDetails = getMarketHolidayDetails(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDetails = getMarketHolidayDetails(tomorrow);

    console.log('\n--- Status Check ---');
    console.log(`• Today (${todayDetails.dateYmd}): ${todayDetails.isHoliday ? `🏖️ HOLIDAY (${todayDetails.holidayName})` : '📈 TRADING DAY (Open)'}`);
    console.log(`• Tomorrow (${tomorrowDetails.dateYmd}): ${tomorrowDetails.isHoliday ? `🏖️ HOLIDAY (${tomorrowDetails.holidayName})` : '📈 TRADING DAY (Open)'}`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n========================================================================`);
    console.log(`🏁 Holiday sync completed in ${elapsed}s.`);
    console.log(`========================================================================\n`);

    return syncResult;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('sync-market-holidays.js')) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal Sync Error:', err);
      process.exit(1);
    });
}
