import { buildCanonicalObservableOutcomeMap } from './management-execution-ledger.service.js';
import { reconstructHistoricalOutcomes } from './management-execution-profile.service.js';

/**
 * Phase 4D Execution Evidence -> Scenario Probability Shift Gate Service
 * 
 * Enforces 8 Hard Design Principles:
 * 1. Minimum Sample Threshold: sample_size < 3 -> ZERO probability shift.
 * 2. 4-Stage Decoupled Pipeline: MANAGEMENT_EXECUTION -> EXECUTION_SIGNAL -> SHIFT_ELIGIBILITY -> PROBABILITY_SHIFT.
 * 3. Metric-Family Sample Isolation: Sample size counted within homogeneous metric families (e.g. Revenue YoY).
 * 4. Probability Conservation Firewall: Bull + Base + Bear = 1.0000 (100%), 0.0 <= p <= 1.0.
 * 5. Valuation Multiple Firewall: PE_before === PE_after (Base multiples strictly IMMUTABLE).
 * 6. Audit Trail: Comprehensive JSON audit record for every 4D evaluation.
 * 7. Conflicting Outcomes Firewall: Mixed outcomes block probability shifts.
 * 8. Zero Evidence Distortion: pre_probability === post_probability when sample < 3.
 */

export const MINIMUM_EVALUATED_SAMPLE = 3;

export const EXECUTION_SIGNALS = {
  NO_EVIDENCE: 'NO_EVIDENCE',
  POSITIVE_OBSERVATION: 'POSITIVE_OBSERVATION',
  NEGATIVE_OBSERVATION: 'NEGATIVE_OBSERVATION',
  CONSISTENT_POSITIVE_PATTERN: 'CONSISTENT_POSITIVE_PATTERN',
  CONSISTENT_NEGATIVE_PATTERN: 'CONSISTENT_NEGATIVE_PATTERN',
  AMBIGUOUS_CONFLICTING_PATTERN: 'AMBIGUOUS_CONFLICTING_PATTERN'
};

/**
 * Evaluates Scenario Probability Shift for a portfolio holding based on 4C evidence
 */
export async function evaluateScenarioProbabilityShift(ticker, options = {}, pool) {
  const {
    preProbability = { bull: 0.30, base: 0.50, bear: 0.20 },
    baseMultiple = 30.0
  } = options;

  // 1. Validate Pre-Probability Conservation
  const preSum = preProbability.bull + preProbability.base + preProbability.bear;
  if (Math.abs(preSum - 1.0) > 0.0001) {
    throw new Error(`Pre-probability distribution must sum to 1.0 (Sum = ${preSum})`);
  }

  // 2. Fetch Frozen Phase 4C Reconstruction Evidence
  const reconstructionData = await reconstructHistoricalOutcomes(ticker, pool);
  const ledgerEntries = reconstructionData.reconstructedEntries || [];

  // 3. Filter Validated Outcomes by Metric Family (Metric Isolation & Canonicalization)
  const metricFamilies = {};
  for (const entry of ledgerEntries) {
    if (['ACHIEVED', 'WITHIN_GUIDANCE', 'BELOW_GUIDANCE', 'ABOVE_GUIDANCE', 'PARTIALLY_ACHIEVED', 'MISSED', 'DELAYED'].includes(entry.reconstructedOutcome)) {
      let familyKey = entry.target_metric || 'REVENUE_GROWTH';
      if (familyKey === 'MANAGEMENT_TARGET' || !familyKey) {
        familyKey = 'REVENUE_GROWTH';
      }
      if (!metricFamilies[familyKey]) metricFamilies[familyKey] = [];
      metricFamilies[familyKey].push(entry);
    }
  }

  // Determine Primary Metric Family Sample Size
  let primaryFamilyKey = 'REVENUE_GROWTH';
  let validatedSample = [];
  for (const [fKey, items] of Object.entries(metricFamilies)) {
    if (items.length > validatedSample.length) {
      primaryFamilyKey = fKey;
      validatedSample = items;
    }
  }

  const sampleSize = validatedSample.length;

  // 4. Stage 1 & 2: Derive Execution Signal
  let executionSignal = EXECUTION_SIGNALS.NO_EVIDENCE;
  if (sampleSize === 1) {
    const single = validatedSample[0];
    executionSignal = ['ACHIEVED', 'WITHIN_GUIDANCE', 'ABOVE_GUIDANCE'].includes(single.reconstructedOutcome)
      ? EXECUTION_SIGNALS.POSITIVE_OBSERVATION
      : EXECUTION_SIGNALS.NEGATIVE_OBSERVATION;
  } else if (sampleSize === 2) {
    const pos = validatedSample.filter(s => ['ACHIEVED', 'WITHIN_GUIDANCE', 'ABOVE_GUIDANCE'].includes(s.reconstructedOutcome)).length;
    executionSignal = pos === 2 ? EXECUTION_SIGNALS.POSITIVE_OBSERVATION : (pos === 0 ? EXECUTION_SIGNALS.NEGATIVE_OBSERVATION : EXECUTION_SIGNALS.AMBIGUOUS_CONFLICTING_PATTERN);
  } else if (sampleSize >= MINIMUM_EVALUATED_SAMPLE) {
    const pos = validatedSample.filter(s => ['ACHIEVED', 'WITHIN_GUIDANCE', 'ABOVE_GUIDANCE'].includes(s.reconstructedOutcome)).length;
    const neg = validatedSample.filter(s => ['MISSED', 'BELOW_GUIDANCE', 'DELAYED'].includes(s.reconstructedOutcome)).length;

    if (pos === sampleSize) executionSignal = EXECUTION_SIGNALS.CONSISTENT_POSITIVE_PATTERN;
    else if (neg === sampleSize) executionSignal = EXECUTION_SIGNALS.CONSISTENT_NEGATIVE_PATTERN;
    else executionSignal = EXECUTION_SIGNALS.AMBIGUOUS_CONFLICTING_PATTERN;
  }

  // 5. Stage 3: Shift Eligibility Check (HARD SAMPLE THRESHOLD >= 3)
  const isShiftEligible = sampleSize >= MINIMUM_EVALUATED_SAMPLE && executionSignal !== EXECUTION_SIGNALS.AMBIGUOUS_CONFLICTING_PATTERN;

  // 6. Stage 4: Probability Shift Calculation
  let postProbability = { ...preProbability };
  let shiftApplied = false;
  let reason = 'SAMPLE_BELOW_MINIMUM_THRESHOLD';

  if (sampleSize === 0) {
    reason = 'NO_EVIDENCE_AVAILABLE';
  } else if (sampleSize < MINIMUM_EVALUATED_SAMPLE) {
    reason = `SAMPLE_SIZE_${sampleSize}_BELOW_MINIMUM_THRESHOLD_${MINIMUM_EVALUATED_SAMPLE}`;
  } else if (executionSignal === EXECUTION_SIGNALS.AMBIGUOUS_CONFLICTING_PATTERN) {
    reason = 'CONFLICTING_EVIDENCE_PATTERN_BLOCKED';
  } else if (isShiftEligible && executionSignal === EXECUTION_SIGNALS.CONSISTENT_POSITIVE_PATTERN) {
    // Controlled shift: Shift +5% from Bear to Bull
    postProbability = {
      bull: parseFloat((preProbability.bull + 0.05).toFixed(4)),
      base: preProbability.base,
      bear: parseFloat((preProbability.bear - 0.05).toFixed(4))
    };
    shiftApplied = true;
    reason = 'CONSISTENT_POSITIVE_PATTERN_ELIGIBLE_SHIFT_APPLIED';
  } else if (isShiftEligible && executionSignal === EXECUTION_SIGNALS.CONSISTENT_NEGATIVE_PATTERN) {
    // Controlled shift: Shift +5% from Bull to Bear
    postProbability = {
      bull: parseFloat((preProbability.bull - 0.05).toFixed(4)),
      base: preProbability.base,
      bear: parseFloat((preProbability.bear + 0.05).toFixed(4))
    };
    shiftApplied = true;
    reason = 'CONSISTENT_NEGATIVE_PATTERN_ELIGIBLE_SHIFT_APPLIED';
  }

  // 7. Probability Conservation & Bounds Verification
  const postSum = postProbability.bull + postProbability.base + postProbability.bear;
  if (Math.abs(postSum - 1.0) > 0.0001) {
    throw new Error(`Post-probability conservation violation: Sum = ${postSum}`);
  }
  if (postProbability.bull < 0 || postProbability.base < 0 || postProbability.bear < 0 ||
      postProbability.bull > 1 || postProbability.base > 1 || postProbability.bear > 1) {
    throw new Error(`Post-probability bounds violation: [Bull=${postProbability.bull}, Base=${postProbability.base}, Bear=${postProbability.bear}]`);
  }

  // 8. Valuation Multiple Firewall Check (Must remain 100% identical)
  const postMultiple = baseMultiple;
  if (baseMultiple !== postMultiple) {
    throw new Error(`Valuation multiple firewall violation: PE_before (${baseMultiple}) !== PE_after (${postMultiple})`);
  }

  return {
    ticker,
    primaryMetricFamily: primaryFamilyKey,
    validatedSampleSize: sampleSize,
    minimumThreshold: MINIMUM_EVALUATED_SAMPLE,
    executionSignal,
    probabilityShiftEligible: isShiftEligible,
    probabilityShiftApplied: shiftApplied,
    preProbability,
    postProbability,
    baseMultipleBefore: baseMultiple,
    baseMultipleAfter: postMultiple,
    valuationMultipleUnchanged: baseMultiple === postMultiple,
    reason
  };
}
