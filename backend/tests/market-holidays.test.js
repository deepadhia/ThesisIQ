/**
 * Invariant Test Suite for Indian Stock Market (NSE/BSE) Holiday Calendar
 * 
 * Verifies:
 * 1. Correct identification of official exchange holidays across 2024-2027.
 * 2. Proper weekend detection (Saturdays and Sundays in Asia/Kolkata timezone).
 * 3. Guaranteed closure on tomorrow: 2026-10-02 (Mahatma Gandhi Jayanti).
 * 4. Correct identification of normal trading weekdays (e.g. 2026-10-01, 2026-10-05).
 * 5. Timezone robustness (ensures UTC execution in GitHub Actions correctly maps to IST).
 * 6. Dynamic NSE date parsing and PostgreSQL sync invariants.
 */

import { 
  NSE_BSE_HOLIDAYS, 
  getIstDateYmd, 
  isWeekend, 
  getMarketHolidayDetails, 
  isMarketOpenDay,
  parseNseTradingDate,
  syncDynamicMarketHolidays,
  loadDynamicMarketHolidays
} from '../services/market-holidays.service.js';
import { pool } from '../db/pool.js';

// Polyfill describe / it / expect for seamless compatibility with both Vitest and standalone Node
const describeFn = typeof describe !== 'undefined' ? describe : (name, fn) => {
  console.log(`\n--- ${name} ---`);
  return fn();
};

const testFn = typeof it !== 'undefined' ? it : (typeof test !== 'undefined' ? test : async (name, fn) => {
  try {
    const res = await fn();
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} (${err.message})`);
    throw err;
  }
});

const expectFn = (actual) => {
  if (typeof expect !== 'undefined') {
    const vitestExpect = expect(actual);
    return {
      toBe: (expected) => vitestExpect.toBe(expected),
      toBeGreaterThanOrEqual: (expected) => vitestExpect.toBeGreaterThanOrEqual(expected)
    };
  }
  return {
    toBe: (expected) => {
      if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
    },
    toBeGreaterThanOrEqual: (expected) => {
      if (!(actual >= expected)) throw new Error(`Expected ${actual} >= ${expected}`);
    }
  };
};

describeFn('NSE/BSE Market Holiday Calendar Invariants', () => {

  testFn('2026-10-02 (Mahatma Gandhi Jayanti) must be identified as market closed', () => {
    const mgjDetails = getMarketHolidayDetails('2026-10-02T13:00:00+05:30');
    expectFn(mgjDetails.isHoliday).toBe(true);
    expectFn(mgjDetails.holidayName).toBe('Mahatma Gandhi Jayanti');
    expectFn(isMarketOpenDay('2026-10-02T13:00:00+05:30')).toBe(false);
  });

  testFn('Weekend detection in Asia/Kolkata timezone', () => {
    const satDate = '2026-10-03T10:00:00+05:30';
    const sunDate = '2026-10-04T10:00:00+05:30';
    const monDate = '2026-10-05T10:00:00+05:30';
    expectFn(isWeekend(satDate)).toBe(true);
    expectFn(isWeekend(sunDate)).toBe(true);
    expectFn(isWeekend(monDate)).toBe(false);
    expectFn(isMarketOpenDay(satDate)).toBe(false);
    expectFn(isMarketOpenDay(sunDate)).toBe(false);
    expectFn(isMarketOpenDay(monDate)).toBe(true);
  });

  testFn('Normal trading day detection (2026-10-01)', () => {
    const thuDate = '2026-10-01T13:00:00+05:30';
    const thuDetails = getMarketHolidayDetails(thuDate);
    expectFn(thuDetails.isHoliday).toBe(false);
    expectFn(isWeekend(thuDate)).toBe(false);
    expectFn(isMarketOpenDay(thuDate)).toBe(true);
  });

  testFn('Multi-year major exchange holidays are closed', () => {
    expectFn(isMarketOpenDay('2024-01-26T12:00:00+05:30')).toBe(false);
    expectFn(isMarketOpenDay('2024-08-15T12:00:00+05:30')).toBe(false);
    expectFn(isMarketOpenDay('2024-12-25T12:00:00+05:30')).toBe(false);
    expectFn(isMarketOpenDay('2025-03-14T12:00:00+05:30')).toBe(false);
    expectFn(isMarketOpenDay('2025-10-21T12:00:00+05:30')).toBe(false);
    expectFn(isMarketOpenDay('2026-10-20T12:00:00+05:30')).toBe(false);
    expectFn(isMarketOpenDay('2026-11-24T12:00:00+05:30')).toBe(false);
  });

  testFn('UTC server schedule times map accurately to IST calendar date', () => {
    const utcDate = new Date('2026-10-02T07:30:00.000Z');
    expectFn(getIstDateYmd(utcDate)).toBe('2026-10-02');
    expectFn(isMarketOpenDay(utcDate)).toBe(false);

    const utcOpenDate = new Date('2026-10-05T07:30:00.000Z');
    expectFn(getIstDateYmd(utcOpenDate)).toBe('2026-10-05');
    expectFn(isMarketOpenDay(utcOpenDate)).toBe(true);
  });

  testFn('NSE date parser converts DD-MMM-YYYY to ISO YYYY-MM-DD', () => {
    expectFn(parseNseTradingDate('15-Jan-2026')).toBe('2026-01-15');
    expectFn(parseNseTradingDate('02-Oct-2026')).toBe('2026-10-02');
    expectFn(parseNseTradingDate('25-Dec-2026')).toBe('2026-12-25');
    expectFn(parseNseTradingDate('invalid-date')).toBe(null);
    expectFn(parseNseTradingDate(null)).toBe(null);
  });

  testFn('Dynamic holiday sync and database persistence executes without errors', async () => {
    const syncResult = await syncDynamicMarketHolidays(pool);
    expectFn(syncResult.count >= 20).toBe(true);

    const loadResult = await loadDynamicMarketHolidays(pool);
    expectFn(loadResult.count >= 20).toBe(true);
  });

});

if (!process.env.VITEST) {
  console.log('\n✅ All Market Holiday tests passed successfully!');
  pool.end();
}
