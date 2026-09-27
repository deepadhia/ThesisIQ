/**
 * Unit & Invariant Test Suite for Guidance Scope & Disambiguation Engine
 * 
 * Verifies that:
 * 1. Quarterly guidance is NEVER confused with Annual guidance.
 * 2. Magnitude guard forces high-value targets to ANNUAL even if quarter text appears.
 * 3. Multi-year CAGR & Capex milestones are cleanly segregated.
 * 4. Annual guidance never triggers a false quarterly miss.
 * 5. Relative "next quarter" expressions resolve correctly.
 */

import { classifyGuidanceScope, reconcileGuidanceVsActual } from '../utils/guidance-scope.js';

// Polyfill describe / test for standalone node execution if running outside vitest
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
  toBeNull: () => {
    if (actual !== null) throw new Error(`Expected null, got ${actual}`);
  },
  toContain: (substr) => {
    if (!actual || !actual.includes(substr)) throw new Error(`Expected string to contain "${substr}", got "${actual}"`);
  },
  not: {
    toContain: (substr) => {
      if (actual && actual.includes(substr)) throw new Error(`Expected string NOT to contain "${substr}", got "${actual}"`);
    }
  }
});

describeFn('Guidance Scope Classification & Horizon Detection', () => {

  testFn('Q2 FY27 revenue is classified as QUARTERLY', () => {
    const c1 = classifyGuidanceScope({
      statement: "Management guided Q2 revenue of Rs 650 Cr with strong order book execution.",
      metric: "Revenue",
      target_value: "₹650 Cr",
      timeline: "Q2 FY27",
      quarter: "Q1 FY27"
    });
    expectFn(c1.scope).toBe('QUARTERLY');
    expectFn(c1.targetQuarter).toBe('Q2 FY27');
    expectFn(c1.targetNumericValue).toBe(650);
  });

  testFn('FY26 revenue target is classified as ANNUAL', () => {
    const c2 = classifyGuidanceScope({
      statement: "We are guiding for revenue of Rs 3,800-4,000 crores for FY26.",
      metric: "Revenue Guidance FY26",
      target_value: "3800-4000 Cr",
      timeline: "FY26",
      quarter: "Q3 FY26"
    });
    expectFn(c2.scope).toBe('ANNUAL');
    expectFn(c2.targetFY).toBe('FY26');
    expectFn(c2.targetNumericValue).toBe(4000);
  });

  testFn('Magnitude guard overrides to ANNUAL when target > 2.2x quarterly baseline', () => {
    const c3 = classifyGuidanceScope({
      statement: "We expect to cross ₹2,800 Cr topline as dispatches ramp up by Q4.",
      metric: "Topline Target",
      target_value: "₹2800 Cr",
      timeline: "By Q4",
      quarter: "Q1 FY27",
      baselineQuarterlyRevenue: 600
    });
    expectFn(c3.scope).toBe('ANNUAL');
  });

  testFn('"Next quarter" relative to Q4 FY26 resolves to Q1 FY27', () => {
    const c4 = classifyGuidanceScope({
      statement: "For the next quarter, we expect EBITDA margins to improve to 18-20%.",
      metric: "EBITDA Margin",
      target_value: "18-20%",
      timeline: "Next Quarter",
      quarter: "Q4 FY26"
    });
    expectFn(c4.scope).toBe('QUARTERLY');
    expectFn(c4.targetQuarter).toBe('Q1 FY27');
  });

  testFn('Vision 2030 / 5-yr CAGR is classified as MULTI_YEAR', () => {
    const c5 = classifyGuidanceScope({
      statement: "Aiming for 5-year EBITDA CAGR of 25% under Vision 2030.",
      metric: "5-Yr CAGR",
      target_value: "25%",
      timeline: "FY30",
      quarter: "Q1 FY26"
    });
    expectFn(c5.scope).toBe('MULTI_YEAR');
  });

  testFn('Capex plant commissioning is classified as CAPEX_MILESTONE', () => {
    const c6 = classifyGuidanceScope({
      statement: "Commercial production and plant commissioning of Sangli 8x capacity facility.",
      metric: "Plant Commissioning",
      target_value: "350 MW",
      timeline: "Q3 FY26",
      quarter: "Q1 FY26"
    });
    expectFn(c6.scope).toBe('CAPEX_MILESTONE');
  });

});

describeFn('Guidance vs Actual Delivery Invariants', () => {

  testFn('Annual guidance NEVER triggers a quarterly miss', () => {
    const annualOnlyCommitments = [
      {
        statement: "We guide for full-year FY27 revenue of Rs 4,000 crores.",
        metric: "Revenue FY27",
        target_value: "₹4,000 Cr",
        timeline: "FY27",
        quarter: "Q4 FY26"
      }
    ];
    const rec1 = reconcileGuidanceVsActual({
      commitments: annualOnlyCommitments,
      currentQuarter: "Q1 FY27",
      currentFinancials: { revenue: 950, revenueYoYGrowthPct: 22 }
    });
    expectFn(rec1.quarterly).toBeNull();
    expectFn(rec1.annual.runRateProgressPct).toBe(23.8);
    expectFn(rec1.formattedSection).toContain('PACING');
    expectFn(rec1.formattedSection).not.toContain('MISSED');
  });

  testFn('Quarterly guidance evaluates Beat / Miss accurately', () => {
    const quarterlyCommitments = [
      {
        statement: "Management guided Q1 FY27 revenue of Rs 650 Cr.",
        metric: "Revenue Q1",
        target_value: "₹650 Cr",
        timeline: "Q1 FY27",
        quarter: "Q4 FY26"
      }
    ];
    const rec2 = reconcileGuidanceVsActual({
      commitments: quarterlyCommitments,
      currentQuarter: "Q1 FY27",
      currentFinancials: { revenue: 685, revenueYoYGrowthPct: 25 }
    });
    expectFn(rec2.quarterly.diffCr).toBe(35);
    expectFn(rec2.quarterly.verdictBadge).toContain('QUARTERLY BEAT');
  });

  testFn('Dual commitments (both quarterly and annual) are cleanly segregated into distinct sections', () => {
    const dualCommitments = [
      {
        statement: "Management guided Q1 FY27 revenue of Rs 650 Cr.",
        metric: "Revenue Q1",
        target_value: "₹650 Cr",
        timeline: "Q1 FY27",
        quarter: "Q4 FY26"
      },
      {
        statement: "Full year FY27 guidance stands at Rs 2,800 Cr with 20% EBITDA margin.",
        metric: "Revenue Guidance FY27",
        target_value: "₹2,800 Cr",
        timeline: "FY27",
        quarter: "Q4 FY26"
      }
    ];
    const rec3 = reconcileGuidanceVsActual({
      commitments: dualCommitments,
      currentQuarter: "Q1 FY27",
      currentFinancials: { revenue: 685, revenueYoYGrowthPct: 28 }
    });
    expectFn(rec3.formattedSection).toContain('QUARTERLY BEAT');
    expectFn(rec3.formattedSection).toContain('ANNUAL');
    expectFn(rec3.formattedSection).toContain('PACING');
    expectFn(rec3.formattedSection).not.toContain('QUARTERLY MISSED');
  });

  testFn('Future quarter guidance is NOT evaluated prematurely against current results', () => {
    const futureCommitment = [
      {
        statement: "We guide Q3 FY27 revenue of Rs 800 Cr.",
        metric: "Revenue",
        target_value: "₹800 Cr",
        timeline: "Q3 FY27",
        quarter: "Q1 FY27"
      }
    ];
    const rec4 = reconcileGuidanceVsActual({
      commitments: futureCommitment,
      currentQuarter: "Q1 FY27",
      currentFinancials: { revenue: 650 }
    });
    expectFn(rec4).toBeNull();
  });

  testFn('Stale annual guidance from a prior fiscal year (FY26) is ignored in FY27', () => {
    const staleCommitment = [
      {
        statement: "Management guided FY26 revenue of Rs 28 Cr.",
        metric: "Revenue FY26",
        target_value: "₹28 Cr",
        timeline: "FY26",
        quarter: "Q3 FY26"
      }
    ];
    const rec5 = reconcileGuidanceVsActual({
      commitments: staleCommitment,
      currentQuarter: "Q1 FY27",
      currentFinancials: { revenue: 256 }
    });
    expectFn(rec5).toBeNull();
  });

  testFn('Active annual guidance for the current fiscal year (FY27) given in Q4 FY26 matches and calculates pacing', () => {
    const activeCommitment = [
      {
        statement: "We are guiding for full year FY27 revenue of Rs 1,000 Cr.",
        metric: "Revenue FY27",
        target_value: "₹1,000 Cr",
        timeline: "FY27",
        quarter: "Q4 FY26"
      }
    ];
    const rec6 = reconcileGuidanceVsActual({
      commitments: activeCommitment,
      currentQuarter: "Q1 FY27",
      currentFinancials: { revenue: 256 }
    });
    expectFn(rec6.annual.runRateProgressPct).toBe(25.6);
    expectFn(rec6.annual.targetFY).toBe('FY27');
    expectFn(rec6.formattedSection).toContain('ANNUAL FY GUIDANCE PACING');
  });

  testFn('Outdated quarterly guidance from 4 quarters ago (Q1 FY26) is NOT matched to Q1 FY27', () => {
    const outdatedQuarterly = [
      {
        statement: "Management expects Q1 FY26 revenue of Rs 200 Cr.",
        metric: "Revenue Q1",
        target_value: "₹200 Cr",
        timeline: "Q1 FY26",
        quarter: "Q4 FY25"
      }
    ];
    const rec7 = reconcileGuidanceVsActual({
      commitments: outdatedQuarterly,
      currentQuarter: "Q1 FY27",
      currentFinancials: { revenue: 300 }
    });
    expectFn(rec7).toBeNull();
  });

});

