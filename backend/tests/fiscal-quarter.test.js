/**
 * Permanent Regression Test Suite for Canonical Fiscal Quarter Utility
 * 
 * Verifies:
 *   1. Quarter ordering: Q1_FY26 < Q2_FY26 < Q3_FY26 < Q4_FY26 < Q1_FY27
 *   2. Strict recency: Q1_FY27 > Q4_FY26
 *   3. Latest quarter detection from arbitrary unsorted lists
 *   4. Mathematical offsets (YoY -4, QoQ -1, Forward +1)
 *   5. Multi-format parsing normalization (Q1_FY27, FY27-Q1, Q1 FY27, Jun 2026, FY2027-Q1)
 */

import {
  parseFiscalQuarter,
  compareFiscalQuarters,
  compareFiscalQuartersDesc,
  sortFiscalQuarters,
  latestQuarter,
  getQuarterOffset,
  getQuarterDistance,
  isBefore,
  isAfter,
  isEqual
} from '../utils/fiscal-quarter.js';

// Polyfill describe / test for standalone node execution
const testFn = typeof test !== 'undefined' ? test : (name, fn) => {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} (${err.message})`);
    throw err;
  }
};

const describeFn = typeof describe !== 'undefined' ? describe : (name, fn) => {
  console.log(`\n--- ${name} ---`);
  fn();
};

const expectFn = typeof expect !== 'undefined' ? expect : (actual) => ({
  toBe: (expected) => {
    if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
  },
  toEqual: (expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  toBeGreaterThan: (expected) => {
    if (!(actual > expected)) throw new Error(`Expected ${actual} > ${expected}`);
  },
  toBeLessThan: (expected) => {
    if (!(actual < expected)) throw new Error(`Expected ${actual} < ${expected}`);
  }
});

describeFn('Fiscal Quarter Chronological Sequence & Transitivity', () => {

  testFn('Q1_FY26 < Q2_FY26 < Q3_FY26 < Q4_FY26 < Q1_FY27', () => {
    expectFn(compareFiscalQuarters('Q1_FY26', 'Q2_FY26')).toBeLessThan(0);
    expectFn(compareFiscalQuarters('Q2_FY26', 'Q3_FY26')).toBeLessThan(0);
    expectFn(compareFiscalQuarters('Q3_FY26', 'Q4_FY26')).toBeLessThan(0);
    expectFn(compareFiscalQuarters('Q4_FY26', 'Q1_FY27')).toBeLessThan(0);
    expectFn(compareFiscalQuarters('Q3_FY26', 'Q1_FY27')).toBeLessThan(0);
    expectFn(compareFiscalQuarters('Q1_FY27', 'Q4_FY26')).toBeGreaterThan(0);
  });

  testFn('Helper Predicates (isBefore, isAfter, isEqual)', () => {
    expectFn(isBefore('Q4_FY26', 'Q1_FY27')).toBe(true);
    expectFn(isAfter('Q1_FY27', 'Q4_FY26')).toBe(true);
    expectFn(isEqual('Q1_FY27', 'FY27-Q1')).toBe(true);
    expectFn(isBefore('Q1_FY27', 'Q4_FY26')).toBe(false);
  });

  testFn('Latest Quarter Selection & Strict Sorting', () => {
    const unsorted1 = ['Q3_FY26', 'Q1_FY27', 'Q4_FY26', 'Q1_FY26', 'Q2_FY26'];
    expectFn(latestQuarter(unsorted1)).toBe('Q1_FY27');
    const sortedAsc = sortFiscalQuarters(unsorted1, false);
    expectFn(sortedAsc).toEqual(['Q1_FY26', 'Q2_FY26', 'Q3_FY26', 'Q4_FY26', 'Q1_FY27']);
  });

  testFn('Quarter Offsets (QoQ / YoY)', () => {
    expectFn(getQuarterOffset('Q1_FY27', -1)).toBe('Q4_FY26');
    expectFn(getQuarterOffset('Q1_FY27', -4)).toBe('Q1_FY26');
    expectFn(getQuarterOffset('Q4_FY26', +1)).toBe('Q1_FY27');
    expectFn(getQuarterOffset('Q2_FY26', -1)).toBe('Q1_FY26');
  });

  testFn('Quarter Distance Calculation', () => {
    expectFn(getQuarterDistance('Q1_FY27', 'Q4_FY26')).toBe(1);
    expectFn(getQuarterDistance('Q1_FY27', 'Q1_FY26')).toBe(4);
    expectFn(getQuarterDistance('Q4_FY26', 'Q1_FY27')).toBe(-1);
    expectFn(getQuarterDistance('Q1_FY27', 'Q1_FY27')).toBe(0);
  });

  testFn('Multi-Format Normalization', () => {
    const formatsQ1FY27 = ['Q1_FY27', 'FY27-Q1', 'Q1 FY27', 'Jun 2026', 'FY2027-Q1', 'Q1-FY27'];
    for (const f of formatsQ1FY27) {
      const p = parseFiscalQuarter(f);
      expectFn(p.key).toBe(2701);
      expectFn(p.label).toBe('Q1_FY27');
    }

    const formatsQ4FY26 = ['Q4_FY26', 'FY26-Q4', 'Q4 FY26', 'Mar 2026', 'FY2026-Q4', 'Q4-FY26'];
    for (const f of formatsQ4FY26) {
      const p = parseFiscalQuarter(f);
      expectFn(p.key).toBe(2604);
      expectFn(p.label).toBe('Q4_FY26');
    }
  });

});
