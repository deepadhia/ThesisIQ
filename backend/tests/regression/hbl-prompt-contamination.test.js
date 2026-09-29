import { getVerifiedGroundTruth, validateNarrativeAgainstArithmetic } from '../../services/verified-data-layer.service.js';

// Polyfill describe / test / expect for standalone node execution
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
  toBeUndefined: () => {
    if (actual !== undefined) throw new Error(`Expected undefined, got ${actual}`);
  },
  not: {
    toContain: (expected) => {
      if (actual && actual.includes(expected)) throw new Error(`Expected not to contain "${expected}"`);
    },
    toMatch: (expected) => {
      if (expected.test(actual)) throw new Error(`Expected not to match regex ${expected}`);
    }
  },
  toContain: (expected) => {
    if (!actual || !actual.includes(expected)) throw new Error(`Expected to contain "${expected}"`);
  },
  toMatch: (expected) => {
    if (!expected.test(actual)) throw new Error(`Expected to match regex ${expected}`);
  }
});

describeFn('Regression Test: Prompt Contamination & Unverified Segment Suppression', () => {

  // ✅ TEST 1: Unverified Prompt-Leaked Numbers Must Be Hard-Blocked
  testFn('HBLENGINE Q1 FY27 output must NOT contain hallucinated Defence EBIT -72.4%', () => {
    const truth = getVerifiedGroundTruth('HBLENGINE');
    expectFn(truth.segmentRedFlags).toBeUndefined();

    const leakedNarrative = "Q1 FY27 results show 🟡 SEGMENT RED FLAG: Defence & Aviation EBIT collapsed -72.4% YoY (₹9.10 Cr vs ₹32.94 Cr). Net profit reached ₹109.14 Cr.";
    const cleaned = validateNarrativeAgainstArithmetic('HBLENGINE', leakedNarrative);

    expectFn(cleaned).not.toContain('9.10');
    expectFn(cleaned).not.toContain('32.94');
    expectFn(cleaned).toContain('109.14'); // Grounded number preserved
  });

  // ✅ TEST 2: Verified Numbers MUST Pass Through Intact (Positive Assertion)
  testFn('HBLENGINE Q1 FY27 verified figures must be present in output', () => {
    const truth = getVerifiedGroundTruth('HBLENGINE');
    expectFn(truth.revenue).toBe(658.59);
    expectFn(truth.patConsolidated).toBe(109.14);
    expectFn(truth.ebitdaMarginPct).toBe(25.40);
  });

  // ✅ TEST 3: Cross-Ticker Contamination Test (SKIPPER vs HBL Compound Pattern)
  testFn('SKIPPER output must NOT contain HBLENGINE figures or Defence segment text', () => {
    const skipperTruth = getVerifiedGroundTruth('SKIPPER');
    expectFn(skipperTruth.revenue).toBe(1309.83);
    expectFn(skipperTruth.patConsolidated).toBe(56.47);

    const skipperNarrative = "Skipper declared Q1 results with PAT ₹56.47 Cr.";
    const cleaned = validateNarrativeAgainstArithmetic('SKIPPER', skipperNarrative, 'Q1 FY27');

    expectFn(cleaned).not.toMatch(/Defence\s*&\s*Aviation.*9\.10/i);
    expectFn(cleaned).not.toMatch(/32\.94.*EBIT/i);
    expectFn(cleaned).not.toContain('Defence & Aviation');
  });

  // ✅ TEST 4: Ticker Universe Isolation Guard
  testFn('SKIPPER output narrative must contain zero references to other portfolio stock tickers', () => {
    const portfolioTickers = ['HBLENGINE', 'INOXINDIA', 'ANANTRAJ', 'SJS', 'LUMAXTECH'];
    const skipperNarrative = "Skipper declared Q1 results with PAT ₹56.47 Cr.";
    const cleaned = validateNarrativeAgainstArithmetic('SKIPPER', skipperNarrative, 'Q1 FY27');

    portfolioTickers.forEach(otherTicker => {
      expectFn(cleaned).not.toMatch(new RegExp(`\\b${otherTicker}\\b`, 'i'));
    });
  });

});
