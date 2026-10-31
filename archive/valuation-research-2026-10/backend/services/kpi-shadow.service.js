/**
 * Thesis KPI Shadow Service v1.0
 * Domain analytics, period math, driver evolution state machine, economic relevance,
 * look-ahead protection, and lead-lag confusion matrix.
 * 
 * STRICT ARCHITECTURAL INVARIANT:
 * Zero write path to ranking tables or quarterly snapshots.
 */

/**
 * Parses period strings like 'FY22', 'FY26', 'Q1_FY26', 'Q1 FY27', 'FY26-Q1'.
 * Returns structured period metadata.
 */
export function parsePeriod(periodStr) {
  if (!periodStr || typeof periodStr !== 'string') {
    return { type: 'UNKNOWN', fy: 0, q: 0, raw: String(periodStr || '') };
  }
  const s = periodStr.trim();

  // Annual patterns: 'FY22', 'FY2022', '2022'
  const mAnn = s.match(/^FY\s*(\d{2}|\d{4})$/i);
  if (mAnn) {
    let fy = parseInt(mAnn[1], 10);
    if (mAnn[1].length === 4) fy = fy % 100;
    return { type: 'ANNUAL', fy, q: 0, raw: `FY${fy.toString().padStart(2, '0')}` };
  }

  // Quarterly patterns: 'Q1_FY26', 'Q1 FY26', 'Q1-FY26', 'Q1FY26'
  const mQ1 = s.match(/^Q(\d)[\s_-]*FY\s*(\d{2}|\d{4})$/i);
  if (mQ1) {
    let fy = parseInt(mQ1[2], 10);
    if (mQ1[2].length === 4) fy = fy % 100;
    const q = parseInt(mQ1[1], 10);
    return { type: 'QUARTERLY', fy, q, raw: `Q${q}_FY${fy.toString().padStart(2, '0')}` };
  }

  // Quarterly reverse patterns: 'FY26-Q1', 'FY26_Q1', 'FY26Q1'
  const mQ2 = s.match(/^FY\s*(\d{2}|\d{4})[\s_-]*Q(\d)$/i);
  if (mQ2) {
    let fy = parseInt(mQ2[1], 10);
    if (mQ2[1].length === 4) fy = fy % 100;
    const q = parseInt(mQ2[2], 10);
    return { type: 'QUARTERLY', fy, q, raw: `Q${q}_FY${fy.toString().padStart(2, '0')}` };
  }

  return { type: 'UNKNOWN', fy: 0, q: 0, raw: s };
}

/**
 * Compare two periods chronologically ascending (oldest to newest).
 */
export function comparePeriodsAsc(a, b) {
  const pa = parsePeriod(typeof a === 'string' ? a : a?.period || a?.reporting_period);
  const pb = parsePeriod(typeof b === 'string' ? b : b?.period || b?.reporting_period);

  if (pa.fy !== pb.fy) return pa.fy - pb.fy;
  if (pa.q !== pb.q) return pa.q - pb.q;
  if (pa.type !== pb.type) return pa.type === 'ANNUAL' ? -1 : 1;
  if (pa.fy > 0 && pa.fy === pb.fy && pa.q === pb.q && pa.type === pb.type) return 0;
  return pa.raw.localeCompare(pb.raw);
}

/**
 * Compare two periods chronologically descending (newest to oldest).
 */
export function comparePeriodsDesc(a, b) {
  return comparePeriodsAsc(b, a);
}

/**
 * Checks if two periods are like-for-like (both ANNUAL or both QUARTERLY).
 */
export function isLikeForLikePeriod(p1, p2) {
  const parsed1 = parsePeriod(p1);
  const parsed2 = parsePeriod(p2);
  return parsed1.type !== 'UNKNOWN' && parsed1.type === parsed2.type;
}

/**
 * Filters a list of observations so that only observations with period <= targetPeriod are retained.
 * Guarantees zero look-ahead bias in historical analysis.
 */
export function filterObservationsUpToPeriod(observations, targetPeriod) {
  if (!Array.isArray(observations)) return [];
  return observations.filter(obs => {
    const p = obs.period || obs.reporting_period;
    return comparePeriodsAsc(p, targetPeriod) <= 0;
  });
}

/**
 * Computes like-for-like YoY, QoQ, growth rate, growth acceleration, and directional classifications.
 * Tolerance determines when a change is classified as FLAT vs UP/DOWN.
 */
export function computeObservationDeltas(observations, tolerance = 0.01) {
  if (!Array.isArray(observations) || observations.length === 0) return [];

  // Group by metric_id and period_type
  const grouped = new Map();
  for (const obs of observations) {
    const key = `${obs.company || obs.ticker || 'DEFAULT'}\t${obs.metric_id || obs.metricId}\t${obs.period_type || 'QUARTERLY'}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(obs);
  }

  const enriched = [];

  for (const [key, list] of grouped) {
    // Sort chronologically ascending
    const sorted = [...list].sort(comparePeriodsAsc);

    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const curVal = cur.reported_value != null ? Number(cur.reported_value) : null;
      const curPeriod = parsePeriod(cur.period || cur.reporting_period);

      let qoq_delta = null;
      let yoy_delta = null;
      let growth_rate = null;
      let growth_acceleration = null;
      let growth_direction = 'UNKNOWN';

      if (curVal !== null && !isNaN(curVal) && cur.availability_status !== 'UNAVAILABLE' && cur.availability_status !== 'NOT_APPLICABLE') {
        if (curPeriod.type === 'QUARTERLY') {
          // 1. QoQ: compare with immediate previous quarter (same FY previous Q, or previous FY Q4)
          const prevQ = sorted.slice(0, i).reverse().find(prev => {
            const pp = parsePeriod(prev.period || prev.reporting_period);
            return pp.type === 'QUARTERLY' && ((pp.fy === curPeriod.fy && pp.q === curPeriod.q - 1) || (pp.fy === curPeriod.fy - 1 && curPeriod.q === 1 && pp.q === 4));
          });

          if (prevQ && prevQ.reported_value != null && Number(prevQ.reported_value) > 0) {
            qoq_delta = Number(((curVal - Number(prevQ.reported_value)) / Number(prevQ.reported_value)).toFixed(4));
          }

          // 2. YoY: compare with same quarter in previous fiscal year
          const prevYearQ = sorted.slice(0, i).reverse().find(prev => {
            const pp = parsePeriod(prev.period || prev.reporting_period);
            return pp.type === 'QUARTERLY' && pp.fy === curPeriod.fy - 1 && pp.q === curPeriod.q;
          });

          if (prevYearQ && prevYearQ.reported_value != null && Number(prevYearQ.reported_value) > 0) {
            yoy_delta = Number(((curVal - Number(prevYearQ.reported_value)) / Number(prevYearQ.reported_value)).toFixed(4));
          }

          growth_rate = yoy_delta !== null ? yoy_delta : qoq_delta;

          // 3. Growth Acceleration: compare current growth_rate with previous period's growth_rate
          if (i > 0) {
            const prevObs = sorted[i - 1];
            if (prevObs.growth_rate != null && growth_rate !== null) {
              growth_acceleration = Number((growth_rate - prevObs.growth_rate).toFixed(4));
            }
          }
        } else if (curPeriod.type === 'ANNUAL') {
          // Annual YoY: compare with previous fiscal year
          const prevAnn = sorted.slice(0, i).reverse().find(prev => {
            const pp = parsePeriod(prev.period || prev.reporting_period);
            return pp.type === 'ANNUAL' && pp.fy === curPeriod.fy - 1;
          });

          if (prevAnn && prevAnn.reported_value != null && Number(prevAnn.reported_value) > 0) {
            yoy_delta = Number(((curVal - Number(prevAnn.reported_value)) / Number(prevAnn.reported_value)).toFixed(4));
            growth_rate = yoy_delta;
          }

          if (i > 0 && sorted[i - 1].growth_rate != null && growth_rate !== null) {
            growth_acceleration = Number((growth_rate - sorted[i - 1].growth_rate).toFixed(4));
          }
        }

        // Direction classification with tolerance
        if (growth_rate !== null) {
          if (growth_rate > tolerance) growth_direction = 'UP';
          else if (growth_rate < -tolerance) growth_direction = 'DOWN';
          else growth_direction = 'FLAT';
        }
      }

      // Compute economic relevance and driver state up to this period (Zero look-ahead)
      const historyUpToNow = sorted.slice(0, i + 1);
      const economic_relevance = classifyEconomicRelevance(cur);
      const driver_state = classifyDriverState(historyUpToNow, economic_relevance);

      const computed = {
        ...cur,
        qoq_delta,
        yoy_delta,
        growth_rate,
        growth_acceleration,
        growth_direction,
        economic_relevance,
        driver_state
      };

      sorted[i] = computed;
      enriched.push(computed);
    }
  }

  return enriched;
}

/**
 * Classifies the economic relevance of a KPI observation:
 * LOW (<10% mix), RISING (10-20% mix), MATERIAL (20-50% mix), DOMINANT (>50% mix).
 */
export function classifyEconomicRelevance(observation) {
  if (!observation) return 'LOW';
  if (observation.availability_status === 'UNAVAILABLE' || observation.availability_status === 'NOT_APPLICABLE') {
    return 'LOW';
  }

  const revMix = observation.revenue_contribution_pct != null ? Number(observation.revenue_contribution_pct) : null;
  const ebitdaMix = observation.ebitda_contribution_pct != null ? Number(observation.ebitda_contribution_pct) : null;
  const val = observation.reported_value != null ? Number(observation.reported_value) : null;
  const unit = (observation.unit || '').toUpperCase();

  const primaryPct = revMix !== null ? revMix : (ebitdaMix !== null ? ebitdaMix : (unit === 'PERCENT' ? val : null));

  if (primaryPct !== null) {
    if (primaryPct >= 50.0) return 'DOMINANT';
    if (primaryPct >= 20.0) return 'MATERIAL';
    if (primaryPct >= 10.0) return 'RISING';
    return 'LOW';
  }

  return 'LOW';
}

/**
 * Deterministic Driver State Machine:
 * - WATCH: < 2 valid directional observations
 * - EMERGING: 2+ consecutive positive observations
 * - SCALING: positive growth + expanding operational indicators
 * - THESIS_RELEVANT: 3+ positive periods + economic relevance (RISING/MATERIAL/DOMINANT) + supporting indicators
 */
export function classifyDriverState(historyUpToCurrentPeriod, currentEconomicRelevance = 'LOW') {
  if (!Array.isArray(historyUpToCurrentPeriod) || historyUpToCurrentPeriod.length === 0) {
    return 'WATCH';
  }

  const validObs = historyUpToCurrentPeriod.filter(o => 
    o.reported_value != null && 
    o.availability_status !== 'UNAVAILABLE' && 
    o.availability_status !== 'NOT_APPLICABLE'
  );

  if (validObs.length < 2) {
    return 'WATCH';
  }

  // Check last N directional movements
  const recent = validObs.slice(-4);
  const consecutiveUpCount = [...recent].reverse().findIndex(o => o.growth_direction !== 'UP');
  const positiveRun = consecutiveUpCount === -1 ? recent.length : consecutiveUpCount;

  const isEconomicallyMaterial = currentEconomicRelevance === 'MATERIAL' || currentEconomicRelevance === 'DOMINANT' || currentEconomicRelevance === 'RISING';

  if (positiveRun >= 3 && isEconomicallyMaterial) {
    return 'THESIS_RELEVANT';
  }

  if (positiveRun >= 2) {
    return isEconomicallyMaterial ? 'SCALING' : 'EMERGING';
  }

  if (positiveRun >= 1 && (validObs[validObs.length - 1].growth_direction === 'UP' || validObs[validObs.length - 1].growth_direction === 'FLAT')) {
    return 'EMERGING';
  }

  return 'WATCH';
}

/**
 * 2x2 Confusion Matrix & Lead-Lag Analysis Engine
 * Compares KPI signals at period T against financial outcomes at period T + lagQuarters.
 */
export function computeLeadLagConfusionMatrix(kpiObservations, financialSnapshots, lagQuarters = 1) {
  let tp = 0; // KPI Warning = Yes, Financial Deterioration = Yes
  let fp = 0; // KPI Warning = Yes, Financial Deterioration = No
  let fn = 0; // KPI Warning = No,  Financial Deterioration = Yes
  let tn = 0; // KPI Warning = No,  Financial Deterioration = No

  const pairs = [];

  // Group by period
  const finMap = new Map();
  for (const f of financialSnapshots || []) {
    const p = f.quarter || f.period;
    finMap.set(p, f);
  }

  for (const kpi of kpiObservations || []) {
    const kpiPeriod = parsePeriod(kpi.period || kpi.reporting_period);
    if (kpiPeriod.type !== 'QUARTERLY') continue;

    // Calculate target future quarter T + lagQuarters
    let targetFy = kpiPeriod.fy;
    let targetQ = kpiPeriod.q + lagQuarters;
    while (targetQ > 4) {
      targetQ -= 4;
      targetFy += 1;
    }
    const targetPeriodKey = `Q${targetQ}_FY${targetFy.toString().padStart(2, '0')}`;

    const futureFin = finMap.get(targetPeriodKey);
    if (!futureFin) continue;

    // KPI Warning: Growth direction is DOWN or significant deceleration
    const kpiWarning = kpi.growth_direction === 'DOWN' || (kpi.growth_acceleration !== null && kpi.growth_acceleration < -0.15);

    // Financial Deterioration: Revenue YoY < 0 OR PAT YoY < 0 OR thesis_status in ('weakening', 'broken')
    const revVal = futureFin.metrics?.revenue_growth?.value != null ? parseFloat(String(futureFin.metrics.revenue_growth.value).replace(/%/g, '')) : null;
    const patVal = futureFin.metrics?.pat_growth?.value != null ? parseFloat(String(futureFin.metrics.pat_growth.value).replace(/%/g, '')) : null;
    const finDeterioration = (revVal !== null && revVal < 0) || (patVal !== null && patVal < 0) || futureFin.thesis_status === 'weakening' || futureFin.thesis_status === 'broken';

    if (kpiWarning && finDeterioration) tp++;
    else if (kpiWarning && !finDeterioration) fp++;
    else if (!kpiWarning && finDeterioration) fn++;
    else if (!kpiWarning && !finDeterioration) tn++;

    pairs.push({
      kpiPeriod: kpiPeriod.raw,
      targetPeriod: targetPeriodKey,
      kpiWarning,
      finDeterioration
    });
  }

  const total = tp + fp + fn + tn;
  const isSampleSufficient = total >= 10;
  const hasSignalVariation = (tp + fp) > 0 && (tp + fn) > 0;

  let status = 'INSUFFICIENT_SAMPLE';
  if (!isSampleSufficient) {
    status = 'INSUFFICIENT_SAMPLE';
  } else if (!hasSignalVariation) {
    status = 'INSUFFICIENT_SIGNAL_VARIATION';
  } else {
    status = 'VALIDATED';
  }

  const precision = (tp + fp) > 0 ? Number((tp / (tp + fp)).toFixed(4)) : null;
  const recall = (tp + fn) > 0 ? Number((tp / (tp + fn)).toFixed(4)) : null;
  const falsePositiveRate = (fp + tn) > 0 ? Number((fp / (fp + tn)).toFixed(4)) : null;
  const directionalAccuracy = total > 0 ? Number(((tp + tn) / total).toFixed(4)) : null;

  return {
    lagQuarters,
    sampleSize: total,
    isSampleSufficient,
    hasSignalVariation,
    status,
    confusionMatrix: { tp, fp, fn, tn },
    metrics: {
      precision,
      recall,
      falsePositiveRate,
      directionalAccuracy
    },
    pairs
  };
}
