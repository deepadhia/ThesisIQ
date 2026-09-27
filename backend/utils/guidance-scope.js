/**
 * Guidance Scope & Disambiguation Engine
 * 
 * Enforces strict boundaries between:
 * 1. QUARTERLY: Single upcoming quarter guidance (e.g. Q2 FY27 revenue ₹650 Cr, next quarter margin 18%)
 * 2. ANNUAL: Full fiscal year guidance (e.g. FY27 revenue ₹2,800 Cr, FY27 topline growth 25-30%)
 * 3. MULTI_YEAR: 3-5 year aspirational roadmap (e.g. Vision 2030 ₹10,000 Cr, 5-yr EBITDA CAGR 25%)
 * 4. CAPEX_MILESTONE: Physical plant commissioning, capacity addition, demerger, NCLT approval
 * 5. OPERATIONAL: Working capital days, debt reduction, order intake run-rate
 * 
 * Invariants:
 * - NEVER evaluate an Annual FY target against a single quarter's revenue (avoids false 70-80% misses).
 * - NEVER evaluate a Multi-year CAGR target against a single quarter's YoY growth.
 * - Relative expressions like "next quarter" in a Q4 FY26 filing resolve to target quarter "Q1 FY27".
 */

import { parseFiscalQuarter, getQuarterOffset, getQuarterDistance } from './fiscal-quarter.js';

/**
 * Deterministically classifies a commitment or guidance statement into its exact scope.
 * 
 * @param {Object} item
 * @param {string} item.statement
 * @param {string} [item.metric]
 * @param {string} [item.target_value]
 * @param {string} [item.timeline]
 * @param {string} [item.quarter] - Quarter of origin (e.g. "Q4 FY26")
 * @param {number} [item.baselineQuarterlyRevenue] - Baseline quarterly revenue in ₹ Cr (for magnitude check)
 * @returns {Object} Classified guidance metadata
 */
export function classifyGuidanceScope(item = {}) {
  const statement = item.statement || "";
  const metric = item.metric || "";
  const targetValue = item.target_value || "";
  const timeline = item.timeline || "";
  const originQuarter = item.quarter || "";
  const baselineRev = item.baselineQuarterlyRevenue ? parseFloat(String(item.baselineQuarterlyRevenue).replace(/,/g, '')) : null;

  const combined = `${metric} ${statement} ${targetValue} ${timeline}`.toLowerCase();
  const timelineLower = timeline.toLowerCase().trim();
  const metricLower = metric.toLowerCase().trim();
  const stmtLower = statement.toLowerCase().trim();

  // 1. Noise / Non-Guidance Ratios Filter
  if (
    combined.includes('utilization') || 
    combined.includes('concentration') ||
    combined.includes('promoter holding') ||
    combined.includes('dividend payout') ||
    combined.includes('trading window') ||
    combined.includes('upsi') ||
    combined.includes('investor presentation')
  ) {
    return {
      scope: 'OPERATIONAL',
      targetQuarter: null,
      targetFY: null,
      targetNumericValue: null,
      targetUnit: 'OTHER',
      confidenceReason: 'Non-guidance operational ratio or compliance notice'
    };
  }

  // Extract Numeric Target (₹ Cr or %)
  let targetNumericValue = null;
  let targetUnit = 'OTHER';
  let isRange = false;
  let rangeMin = null;
  let rangeMax = null;

  const crMatch = targetValue.match(/(?:₹|inr\s*|rs\.?\s*)?(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:cr|crore|crores)/i) ||
                  statement.match(/(?:₹|inr\s*|rs\.?\s*)(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:cr|crore|crores)/i) ||
                  statement.match(/(?:guidance|target|revenue of|topline of|sales to reach)\s*(?:of\s*)?(?:₹|inr\s*|rs\.?\s*)?(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:cr|crore|crores)/i);

  const rangeCrMatch = targetValue.match(/(?:₹|inr\s*|rs\.?\s*)?(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:cr|crore|crores)/i) ||
                       statement.match(/(?:₹|inr\s*|rs\.?\s*)?(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:cr|crore|crores)/i);

  const pctMatch = targetValue.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?\s*%/i) ||
                   statement.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?\s*%\s*(?:yoy|growth|margin)/i);

  if (rangeCrMatch) {
    rangeMin = parseFloat(rangeCrMatch[1].replace(/,/g, ''));
    rangeMax = parseFloat(rangeCrMatch[2].replace(/,/g, ''));
    targetNumericValue = rangeMax;
    targetUnit = 'CR';
    isRange = true;
  } else if (crMatch) {
    targetNumericValue = parseFloat(crMatch[1].replace(/,/g, ''));
    targetUnit = 'CR';
  } else if (pctMatch) {
    rangeMin = parseFloat(pctMatch[1]);
    rangeMax = pctMatch[2] ? parseFloat(pctMatch[2]) : rangeMin;
    targetNumericValue = rangeMax;
    targetUnit = 'PCT';
    isRange = Boolean(pctMatch[2]);
  }

  // 2. Multi-Year Roadmap Detection (3-5 years, Vision 2030, CAGR)
  const isMultiYear = 
    combined.includes('cagr') ||
    combined.includes('vision 20') ||
    combined.includes('3-5 year') ||
    combined.includes('3 to 5 year') ||
    combined.includes('5-year') ||
    combined.includes('5 year') ||
    combined.includes('by 2028') ||
    combined.includes('by 2029') ||
    combined.includes('by 2030') ||
    combined.includes('by 2032') ||
    combined.includes('by fy29') ||
    combined.includes('by fy30') ||
    combined.includes('by fy31') ||
    combined.includes('by fy32') ||
    combined.includes('medium term') ||
    combined.includes('long term') ||
    combined.includes('over 3 to 4 years') ||
    combined.includes('3-year roadmap');

  if (isMultiYear) {
    return {
      scope: 'MULTI_YEAR',
      targetQuarter: null,
      targetFY: extractFiscalYear(combined),
      targetNumericValue,
      targetUnit,
      isRange,
      rangeMin,
      rangeMax,
      confidenceReason: 'Matches multi-year strategic vision / CAGR horizon'
    };
  }

  // 3. Capex & Operational Milestone Detection (Plant Commissioning, Demerger, Approvals)
  const isCapexMilestone = 
    combined.includes('commissioning') ||
    combined.includes('commissioned') ||
    combined.includes('commercial production') ||
    combined.includes('plant expansion') ||
    combined.includes('capacity addition') ||
    combined.includes('mtpa') ||
    combined.includes('mw') ||
    combined.includes('scheme of arrangement') ||
    combined.includes('nclt') ||
    combined.includes('sebi approval') ||
    combined.includes('demerger') ||
    combined.includes('qip allotment') ||
    metricLower.includes('regulatory') ||
    metricLower.includes('capacity');

  if (isCapexMilestone && !metricLower.includes('revenue') && !metricLower.includes('margin') && !combined.includes('revenue guidance')) {
    return {
      scope: 'CAPEX_MILESTONE',
      targetQuarter: extractQuarter(combined, originQuarter),
      targetFY: extractFiscalYear(combined),
      targetNumericValue,
      targetUnit,
      isRange,
      rangeMin,
      rangeMax,
      confidenceReason: 'Matches physical capex milestone, regulatory clearance, or capacity addition'
    };
  }

  // 4. Strict Quarterly vs Annual Disambiguation
  const hasExplicitQuarterWord = 
    /\b(?:q[1-4]|quarter\s*[1-4]|first\s*quarter|second\s*quarter|third\s*quarter|fourth\s*quarter|next\s*quarter|current\s*quarter|qoq|1q|2q|3q|4q)\b/i.test(combined);

  const hasExplicitAnnualWord = 
    /\b(?:full\s*year|annual|annually|for\s*the\s*year|fiscal\s*year|throughout\s*the\s*year|h1\s*\+\s*h2|by\s*fy|for\s*fy)\b/i.test(combined) ||
    /^(?:fy|h[12]fy)\s*\d{2,4}$/i.test(timelineLower) ||
    /^fy\d{2}$/i.test(timelineLower);

  // Magnitude Guard: If target revenue is > 2.2x baseline quarterly revenue, it CANNOT be quarterly revenue
  const isAnnualByMagnitude = (targetUnit === 'CR' && baselineRev && targetNumericValue && targetNumericValue > baselineRev * 2.2);

  // Evaluate Scope
  if (hasExplicitAnnualWord || isAnnualByMagnitude) {
    const targetFY = extractFiscalYear(combined) || extractFiscalYear(originQuarter);
    return {
      scope: 'ANNUAL',
      targetQuarter: null,
      targetFY,
      targetNumericValue,
      targetUnit,
      isRange,
      rangeMin,
      rangeMax,
      confidenceReason: isAnnualByMagnitude 
        ? `Magnitude guard: Target (₹${targetNumericValue} Cr) > 2.2x quarterly baseline (₹${baselineRev} Cr) -> Classified as ANNUAL`
        : `Matches explicit full-year / annual fiscal year keyword`
    };
  }

  if (hasExplicitQuarterWord) {
    const targetQuarter = extractQuarter(combined, originQuarter);
    return {
      scope: 'QUARTERLY',
      targetQuarter,
      targetFY: extractFiscalYear(combined),
      targetNumericValue,
      targetUnit,
      isRange,
      rangeMin,
      rangeMax,
      confidenceReason: `Matches explicit quarter keyword (${targetQuarter || 'Upcoming Quarter'})`
    };
  }

  // Default Fallback: If timeline is FYxx -> Annual, if timeline is Qx -> Quarterly
  if (timelineLower.startsWith('q')) {
    return {
      scope: 'QUARTERLY',
      targetQuarter: extractQuarter(combined, originQuarter),
      targetFY: extractFiscalYear(combined),
      targetNumericValue,
      targetUnit,
      isRange,
      rangeMin,
      rangeMax,
      confidenceReason: 'Timeline begins with Q -> Classified as QUARTERLY'
    };
  }

  // Default to Annual for full-year metrics
  return {
    scope: 'ANNUAL',
    targetQuarter: null,
    targetFY: extractFiscalYear(combined),
    targetNumericValue,
    targetUnit,
    isRange,
    rangeMin,
    rangeMax,
    confidenceReason: 'Defaulted to ANNUAL (No single quarter marker identified)'
  };
}

/**
 * Extracts normalized fiscal year string (e.g. "FY26", "FY27") from text.
 */
export function extractFiscalYear(text = "") {
  if (!text) return null;
  const match = text.match(/\bFY\s*(\d{2,4})\b/i) || text.match(/\b20(\d{2})\b/);
  if (!match) return null;
  const num = match[1];
  if (num.length === 4) return `FY${num.slice(2)}`;
  return `FY${num}`;
}

/**
 * Extracts normalized fiscal quarter string (e.g. "Q1 FY27", "Q2 FY27") from text.
 * Resolves relative "next quarter" expressions using originQuarter.
 */
export function extractQuarter(text = "", originQuarter = "") {
  if (!text) return null;

  // 1. Check for explicit quarter with FY (e.g. "Q1 FY27", "Q2_FY26", "FY27-Q1", "FY27 Q1")
  const explicitMatch = text.match(/\b(Q[1-4])[\s_/-]*(FY\s*\d{2,4})\b/i) ||
                        text.match(/\b(FY\s*\d{2,4})[\s_/-]*(Q[1-4])\b/i);
  if (explicitMatch) {
    if (/^Q/i.test(explicitMatch[1])) {
      const qPart = explicitMatch[1].toUpperCase();
      const fyPart = extractFiscalYear(explicitMatch[2]);
      return fyPart ? `${qPart} ${fyPart}` : qPart;
    } else {
      const qPart = explicitMatch[2].toUpperCase();
      const fyPart = extractFiscalYear(explicitMatch[1]);
      return fyPart ? `${qPart} ${fyPart}` : qPart;
    }
  }

  // 2. Check for "next quarter"
  if (/next\s*quarter/i.test(text) && originQuarter) {
    try {
      const parsed = parseFiscalQuarter(originQuarter);
      if (parsed && parsed.label) {
        return getQuarterOffset(parsed.label, 1).replace('_', ' ');
      }
    } catch {
      // Fallback
    }
  }

  // 3. Fallback: single quarter without explicit FY in the match (e.g. "Q1", "Q2")
  const singleQMatch = text.match(/\b(Q[1-4])\b/i);
  if (singleQMatch) {
    const qPart = singleQMatch[1].toUpperCase();
    const qNum = parseInt(qPart.slice(1), 10);
    if (originQuarter) {
      const parsed = parseFiscalQuarter(originQuarter);
      if (parsed.fiscalYear > 0) {
        // If target quarter <= origin quarter (e.g. origin Q4, target Q1), it rolls into next FY
        let targetFy = parsed.fiscalYear;
        if (parsed.quarter > 0 && qNum <= parsed.quarter) {
          targetFy = parsed.fiscalYear + 1;
        }
        return `${qPart} FY${targetFy.toString().padStart(2, '0')}`;
      }
    }
    return qPart;
  }

  return null;
}

/**
 * Reconciles prior guidance against currently reported quarterly financial delivery.
 * 
 * Guarantees:
 * 1. QUARTERLY guidance is compared strictly against the quarterly delivered figures (Beat / Miss / In-line).
 * 2. ANNUAL guidance is reported strictly as run-rate pacing (Progress % of annual target delivered), NEVER a quarterly miss.
 * 3. Returns both sections if both exist, eliminating ambiguity.
 */
export function reconcileGuidanceVsActual({
  commitments = [],
  currentQuarter = "",
  currentFinancials = {}
} = {}) {
  if (!commitments || commitments.length === 0) return null;
  const fin = currentFinancials || {};
  const actualRev = fin.revenue ? parseFloat(String(fin.revenue).replace(/,/g, '')) : null;
  const actualRevGrowth = fin.revenueYoYGrowthPct !== undefined && fin.revenueYoYGrowthPct !== null 
    ? parseFloat(fin.revenueYoYGrowthPct) 
    : null;

  let bestQuarterlyMatch = null;
  let bestAnnualMatch = null;

  const currentQNormalized = currentQuarter ? currentQuarter.replace(/_/g, ' ').toUpperCase() : "";
  const currentQParsed = parseFiscalQuarter(currentQuarter);

  for (const c of commitments) {
    const classification = classifyGuidanceScope({
      statement: c.statement,
      metric: c.metric,
      target_value: c.target_value,
      timeline: c.timeline,
      quarter: c.quarter,
      baselineQuarterlyRevenue: actualRev
    });

    const stmt = c.statement || "";
    const shortStmt = stmt.length > 80 ? stmt.substring(0, 80) + '...' : stmt;
    const originQ = c.quarter || "Prior Concall";

    // 1. Process QUARTERLY Scope
    if (classification.scope === 'QUARTERLY') {
      if (bestQuarterlyMatch) continue; // Keep highest-priority match

      // If targetQuarter is specified, check if it matches currentQuarter
      if (classification.targetQuarter && currentQuarter) {
        const tqParsed = parseFiscalQuarter(classification.targetQuarter);
        if (tqParsed.fiscalYear > 0 && currentQParsed.fiscalYear > 0) {
          // If both have FY, require exact key match (prevents Q1 FY26 matching Q1 FY27)
          if (tqParsed.key !== currentQParsed.key) {
            continue;
          }
        } else if (tqParsed.quarter > 0 && currentQParsed.quarter > 0) {
          // If FY not present on target, at least require matching quarter number
          if (tqParsed.quarter !== currentQParsed.quarter) {
            continue;
          }
        }
      }

      // If targetQuarter is NOT specified, check distance from origin quarter
      if (!classification.targetQuarter && c.quarter && currentQuarter) {
        const dist = getQuarterDistance(currentQuarter, c.quarter);
        // Quarterly guidance must be from an immediate prior quarter (e.g. 1 or 2 quarters ago)
        if (dist !== null && (dist <= 0 || dist > 2)) {
          continue; // Guidance is outdated or from the future
        }
      }

      // Math Comparison: Revenue (₹ Cr)
      if (classification.targetUnit === 'CR' && actualRev && classification.targetNumericValue) {
        const guidedRev = classification.targetNumericValue;
        const diff = actualRev - guidedRev;
        const diffPct = ((diff / guidedRev) * 100).toFixed(1);

        let verdictBadge = "🟡 *QUARTERLY IN-LINE* (Met guidance within ~1%)";
        if (diff > 5) {
          verdictBadge = `🟢 *QUARTERLY BEAT* (+₹${diff.toFixed(1)} Cr / +${diffPct}% above guidance)`;
        } else if (diff < -5) {
          verdictBadge = `🔴 *QUARTERLY MISSED* (-₹${Math.abs(diff).toFixed(1)} Cr / ${diffPct}% below guidance)`;
        }

        bestQuarterlyMatch = {
          scope: 'QUARTERLY',
          metricType: 'REVENUE',
          priorQuarter: originQ,
          targetQuarter: classification.targetQuarter || currentQuarter,
          guidedStatement: shortStmt,
          guidedValue: `₹${guidedRev} Cr (Quarterly Guidance)`,
          actualValue: `₹${actualRev} Cr (${currentQuarter})`,
          verdictBadge,
          diffCr: diff,
          diffPct: parseFloat(diffPct)
        };
      }

      // Math Comparison: Growth (% YoY)
      else if (classification.targetUnit === 'PCT' && actualRevGrowth !== null && !isNaN(actualRevGrowth) && classification.targetNumericValue) {
        const minPct = classification.rangeMin !== null ? classification.rangeMin : classification.targetNumericValue;
        const maxPct = classification.rangeMax !== null ? classification.rangeMax : classification.targetNumericValue;

        let verdictBadge = "🟡 *QUARTERLY IN-LINE* (Delivered within guided range)";
        if (actualRevGrowth > maxPct + 1.0) {
          verdictBadge = `🟢 *QUARTERLY BEAT* (+${(actualRevGrowth - maxPct).toFixed(1)}% above guided upper band)`;
        } else if (actualRevGrowth < minPct - 1.0) {
          verdictBadge = `🔴 *QUARTERLY MISSED* (${(actualRevGrowth - minPct).toFixed(1)}% below guided lower band)`;
        }

        bestQuarterlyMatch = {
          scope: 'QUARTERLY',
          metricType: 'GROWTH',
          priorQuarter: originQ,
          targetQuarter: classification.targetQuarter || currentQuarter,
          guidedStatement: shortStmt,
          guidedValue: classification.isRange ? `${minPct}%–${maxPct}% YoY (Quarterly Guidance)` : `${minPct}% YoY (Quarterly Guidance)`,
          actualValue: `${actualRevGrowth >= 0 ? '+' : ''}${actualRevGrowth}% YoY`,
          verdictBadge,
          diffPct: actualRevGrowth - maxPct
        };
      }
    }

    // 2. Process ANNUAL Scope (Strictly Pacing, NEVER Quarterly Miss)
    if (classification.scope === 'ANNUAL') {
      if (bestAnnualMatch) continue;

      // Filter out stale annual targets from completed prior fiscal years
      // e.g. An FY26 target should not be matched as pacing for a Q1 FY27 filing
      if (classification.targetFY && currentQParsed.fiscalYear > 0) {
        const targetFyParsed = parseFiscalQuarter(classification.targetFY);
        if (targetFyParsed.fiscalYear > 0 && targetFyParsed.fiscalYear < currentQParsed.fiscalYear) {
          continue; // Target is for an earlier completed fiscal year
        }
      }

      // If targetFY is not explicit, verify origin quarter was not in an earlier fiscal year
      if (!classification.targetFY && c.quarter && currentQParsed.fiscalYear > 0) {
        const originQParsed = parseFiscalQuarter(c.quarter);
        if (originQParsed.fiscalYear > 0 && originQParsed.fiscalYear < currentQParsed.fiscalYear) {
          continue; // Commitment made in an earlier fiscal year without a forward FY target
        }
      }

      // Revenue Pacing (₹ Cr)
      if (classification.targetUnit === 'CR' && actualRev && classification.targetNumericValue) {
        const guidedAnnualRev = classification.targetNumericValue;
        const runRateProgress = ((actualRev / guidedAnnualRev) * 100).toFixed(1);
        const targetFY = classification.targetFY || "Target Year";

        bestAnnualMatch = {
          scope: 'ANNUAL',
          metricType: 'REVENUE',
          priorQuarter: originQ,
          targetFY,
          guidedStatement: shortStmt,
          guidedValue: `₹${guidedAnnualRev} Cr (${targetFY} Full-Year Target)`,
          actualValue: `₹${actualRev} Cr (${currentQuarter})`,
          runRateProgressPct: parseFloat(runRateProgress),
          verdictBadge: `⏳ *ANNUAL FY GUIDANCE PACING:* Quarterly run-rate delivered ${runRateProgress}% of ${targetFY} target`
        };
      }

      // Growth Pacing (% YoY)
      else if (classification.targetUnit === 'PCT' && actualRevGrowth !== null && !isNaN(actualRevGrowth) && classification.targetNumericValue) {
        const minPct = classification.rangeMin !== null ? classification.rangeMin : classification.targetNumericValue;
        const maxPct = classification.rangeMax !== null ? classification.rangeMax : classification.targetNumericValue;
        const isAhead = actualRevGrowth >= maxPct;
        const targetFY = classification.targetFY || "Full-Year";

        bestAnnualMatch = {
          scope: 'ANNUAL',
          metricType: 'GROWTH',
          priorQuarter: originQ,
          targetFY,
          guidedStatement: shortStmt,
          guidedValue: classification.isRange ? `${minPct}%–${maxPct}% YoY (${targetFY} Target)` : `${minPct}% YoY (${targetFY} Target)`,
          actualValue: `${actualRevGrowth >= 0 ? '+' : ''}${actualRevGrowth}% YoY (${currentQuarter})`,
          verdictBadge: isAhead
            ? `🟢 *ANNUAL PACING AHEAD:* Running at ${actualRevGrowth}% YoY vs ${minPct}–${maxPct}% full-year target`
            : `⏳ *ANNUAL PACING ACTIVE:* Running at ${actualRevGrowth}% YoY vs ${minPct}–${maxPct}% full-year target`
        };
      }
    }
  }

  if (!bestQuarterlyMatch && !bestAnnualMatch) return null;

  // Build clean, disambiguated markdown presentation
  let formattedSection = "";

  if (bestQuarterlyMatch && bestAnnualMatch) {
    formattedSection = `\n🎯 *PREVIOUS GUIDANCE VS. ACTUAL DELIVERY:*
• *Quarterly Target:* ${bestQuarterlyMatch.guidedValue} _(from ${bestQuarterlyMatch.priorQuarter})_
• *Actual Delivered:* ${bestQuarterlyMatch.actualValue}
• *Quarterly Verdict:* ${bestQuarterlyMatch.verdictBadge}

⏳ *${bestAnnualMatch.targetFY || 'ANNUAL'} GUIDANCE PACING:*
• *Full-Year Target:* ${bestAnnualMatch.guidedValue} _(from ${bestAnnualMatch.priorQuarter})_
• *Delivery Pacing:* ${bestAnnualMatch.actualValue}
• *Pacing Verdict:* ${bestAnnualMatch.verdictBadge}\n`;
  } else if (bestQuarterlyMatch) {
    formattedSection = `\n🎯 *PREVIOUS QUARTERLY GUIDANCE VS. ACTUAL DELIVERY:*
• *Guided Target:* ${bestQuarterlyMatch.guidedValue} _(from ${bestQuarterlyMatch.priorQuarter})_
• *Actual Delivered:* ${bestQuarterlyMatch.actualValue}
• *Delivery Verdict:* ${bestQuarterlyMatch.verdictBadge}\n`;
  } else if (bestAnnualMatch) {
    formattedSection = `\n⏳ *${bestAnnualMatch.targetFY || 'ANNUAL'} GUIDANCE PACING:*
• *Full-Year Target:* ${bestAnnualMatch.guidedValue} _(from ${bestAnnualMatch.priorQuarter})_
• *Quarterly Actual:* ${bestAnnualMatch.actualValue}
• *Pacing Verdict:* ${bestAnnualMatch.verdictBadge}\n`;
  }

  return {
    quarterly: bestQuarterlyMatch,
    annual: bestAnnualMatch,
    formattedSection,
    // Backward compatibility fields
    guidedValue: bestQuarterlyMatch ? bestQuarterlyMatch.guidedValue : bestAnnualMatch.guidedValue,
    actualValue: bestQuarterlyMatch ? bestQuarterlyMatch.actualValue : bestAnnualMatch.actualValue,
    priorQuarter: bestQuarterlyMatch ? bestQuarterlyMatch.priorQuarter : bestAnnualMatch.priorQuarter,
    verdictBadge: bestQuarterlyMatch ? bestQuarterlyMatch.verdictBadge : bestAnnualMatch.verdictBadge
  };
}
