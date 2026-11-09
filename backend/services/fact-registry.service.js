/** Only persisted statement provenance can supply current synthesis truth. */
export function currentSynthesisTruth(snapshot) {
  const output = snapshot?.raw_ai_output;
  const fin = output?.verified_financials;
  if (!snapshot?.quarter || !output?.source_filing?.announcement_id || !output.source_filing.attachment_url || !fin?.isFinancialResult || fin.isVerified === false || fin.verification === 'LLM_LOCATED_TEXT_GROUNDED' || !Number.isFinite(fin.revenue)) return null;
  return { ...fin, period: snapshot.quarter };
}

/**
 * Multi-Layer Typed Knowledge Graph Fact Registry & Immutable Claim Validation Service
 * 
 * Enforces 7-Layer Categorization per Share:
 * 1. CORE_FINANCIALS (Revenue, Core PAT, EBITDA Margin, FCF)
 * 2. PRIMARY_THESIS_METRICS (Stock-specific machine-verifiable drivers with mandatory schema)
 * 3. DERIVED_METRICS (Growth rates, Backlog/Revenue ratios, bps deltas)
 * 4. STRATEGIC_INITIATIVES (Multi-phase themes: SAVLI_CRYO, ASHOK_CLOUD, KAVACH_RAIL, etc.)
 * 5. MANAGEMENT_COMMITMENTS (Filtered short-term due scorecards vs long-term aspirational >2030)
 * 6. ACCOUNTING_ADJUSTMENTS (Normalization items: e.g. SJS ₹24.17 Cr JV buyout exceptional gain)
 * 7. RISK_ALERTS (Derived warning flags: e.g. HBL -810 bps margin erosion alert, Shakti receivable days)
 */

export function buildFactRegistry(ticker, truth = null) {
  if (!truth?.period) return null;

  const periodTag = truth.period.replace(/\s+/g, '');
  const prefix = `${ticker}_${periodTag}`;

  const registry = {
    ticker,
    companyName: truth.companyName || ticker,
    period: truth.period,
    coreFinancials: new Map(),
    primaryThesisMetrics: new Map(),
    derivedMetrics: new Map(),
    strategicInitiatives: new Map(),
    accountingAdjustments: new Map(),
    riskAlerts: new Map()
  };
  if (Number.isFinite(truth.capacityUtilizationPct)) registry.primaryThesisMetrics.set(`${prefix}_CAPACITY_UTILIZATION`, { value: truth.capacityUtilizationPct });

  // 1. CORE FINANCIALS
  if (Number.isFinite(truth.revenue)) {
    registry.coreFinancials.set(`${prefix}_TOTAL_REVENUE`, {
      metric_id: `${prefix}_TOTAL_REVENUE`,
      ticker,
      metric_name: 'TOTAL_REVENUE',
      value: truth.revenue,
      yoy_growth_pct: truth.revenueYoYGrowthPct,
      qoq_growth_pct: truth.revenueQoQGrowthPct,
      unit: 'INR_CR',
      period: truth.period,
      fact_status: 'VERIFIED',
      importance: 'CORE'
    });
  }

  if (Number.isFinite(truth.patConsolidated)) {
    registry.coreFinancials.set(`${prefix}_CORE_PAT`, {
      metric_id: `${prefix}_CORE_PAT`,
      ticker,
      metric_name: 'REPORTED_PAT',
      value: truth.patConsolidated,
      yoy_growth_pct: truth.patYoYGrowthPct,
      unit: 'INR_CR',
      period: truth.period,
      fact_status: 'VERIFIED',
      importance: 'CORE'
    });
  }

  if (Number.isFinite(truth.ebitdaMarginPct)) {
    registry.coreFinancials.set(`${prefix}_EBITDA_MARGIN`, {
      metric_id: `${prefix}_EBITDA_MARGIN`,
      ticker,
      metric_name: 'EBITDA_MARGIN_PCT',
      value: truth.ebitdaMarginPct,
      bps_delta: truth.ebitdaMarginBpsDelta,
      unit: 'PERCENT',
      period: truth.period,
      fact_status: 'VERIFIED',
      importance: 'CORE'
    });
  }

  // 2. PRIMARY THESIS METRICS (Stock-Specific Typed Schema)
  if (truth.orderBookTotal !== undefined) {
    registry.primaryThesisMetrics.set(`${prefix}_TOTAL_ORDER_BACKLOG`, {
      metric_id: `${prefix}_TOTAL_ORDER_BACKLOG`,
      ticker,
      metric_name: 'TOTAL_ORDER_BACKLOG',
      value: truth.orderBookTotal,
      unit: 'INR_CR',
      period: truth.period,
      fact_status: 'VERIFIED',
      direction: 'POSITIVE',
      thesis_effect: 'POSITIVE',
      importance: 'PRIMARY'
    });
  }

  if (truth.quarterlyOrderInflow !== undefined) {
    registry.primaryThesisMetrics.set(`${prefix}_QUARTERLY_ORDER_INFLOW`, {
      metric_id: `${prefix}_QUARTERLY_ORDER_INFLOW`,
      ticker,
      metric_name: 'QUARTERLY_ORDER_INFLOW',
      value: truth.quarterlyOrderInflow,
      unit: 'INR_CR',
      period: truth.period,
      fact_status: 'VERIFIED',
      direction: 'POSITIVE',
      thesis_effect: 'POSITIVE',
      importance: 'PRIMARY'
    });
  }

  if (truth.exportOrderBook !== undefined) {
    registry.primaryThesisMetrics.set(`${prefix}_EXPORT_BACKLOG`, {
      metric_id: `${prefix}_EXPORT_BACKLOG`,
      ticker,
      metric_name: 'EXPORT_BACKLOG',
      value: truth.exportOrderBook,
      unit: 'INR_CR',
      period: truth.period,
      fact_status: 'VERIFIED',
      direction: 'POSITIVE',
      thesis_effect: 'POSITIVE',
      importance: 'PRIMARY'
    });
  }

  // 3. ACCOUNTING ADJUSTMENTS (Normalization Isolation)
  if (truth.exceptionalGain !== undefined) {
    registry.accountingAdjustments.set(`${prefix}_EXCEPTIONAL_ITEM`, {
      metric_id: `${prefix}_EXCEPTIONAL_ITEM`,
      ticker,
      metric_name: 'EXCEPTIONAL_ITEM_ISOLATION',
      value: truth.exceptionalGain,
      unit: 'INR_CR',
      description: truth.exceptionalDescription || 'Reported exceptional item; classification requires filing evidence',
      fact_status: 'VERIFIED',
      isNormalized: true
    });
  }

  // 4. RISK ALERTS (Derived Margin Contraction / Red Flags)
  if (truth.isMarginErosion || (truth.ebitdaMarginBpsDelta && truth.ebitdaMarginBpsDelta < -200)) {
    registry.riskAlerts.set(`${prefix}_MARGIN_EROSION_ALERT`, {
      alert_id: `${prefix}_MARGIN_EROSION_ALERT`,
      ticker,
      alert_type: 'MARGIN_CONTRACTION',
      bps_delta: Number.isFinite(truth.ebitdaMarginBpsDelta) ? truth.ebitdaMarginBpsDelta : null,
      severity: 'HIGH',
      description: Number.isFinite(truth.ebitdaMarginBpsDelta) ? `EBITDA Margin contracted by ${Math.abs(truth.ebitdaMarginBpsDelta)} bps YoY.` : 'Margin erosion flagged; magnitude unavailable.'
    });
  }

  return registry;
}

/**
 * Validates generated synthesis report text against multi-layer Fact Registry.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateSynthesisClaims(reportText = "", factRegistry) {
  const errors = [];
  if (!reportText || !factRegistry) return { valid: true, errors: [] };

  const textLower = reportText.toLowerCase();

  // TEST 1: Check for contradictory Revenue Growth % vs Ground Truth (Strict Entity-Period-Metric Fact Lock)
  const revFact = factRegistry.coreFinancials.get(`${factRegistry.ticker}_${factRegistry.period.replace(/\s+/g, '')}_TOTAL_REVENUE`);
  if (revFact && Number.isFinite(revFact.yoy_growth_pct)) {
    const matches = [
      ...reportText.matchAll(/([+-]?\d+(\.\d+)?)\%\s*(YoY|year-over-year)?\s*(revenue\s+growth|revenue)/gi),
      ...reportText.matchAll(/\brevenue\s+(?:growth(?:\s+of)?|grew(?:\s+by)?|increased(?:\s+by)?|declined(?:\s+by)?|fell(?:\s+by)?)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)\s*%/gi)
    ];
    for (const m of matches) {
      const citedPct = /\b(?:declined|fell)\b/i.test(m[0]) ? -Math.abs(parseFloat(m[1])) : parseFloat(m[1]);
      const trailing = reportText.slice(m.index + m[0].length, m.index + m[0].length + 16);
      const preceding = reportText.slice(Math.max(0,m.index - 12), m.index);
      const qoq = /\bqoq\b|quarter[- ]on[- ]quarter/i.test(`${preceding} ${trailing}`);
      const expectedPct = qoq ? revFact.qoq_growth_pct : revFact.yoy_growth_pct;
      if (!Number.isFinite(expectedPct) || Math.abs(citedPct - expectedPct) > 0.5) {
        const reason = `Contradictory Revenue Growth cited (${citedPct}%) vs current statement (${Number.isFinite(expectedPct) ? expectedPct : 'unverified'}% ${qoq ? 'QoQ' : 'YoY'})`;
        errors.push(`[TEST 1 FAIL] ${reason}`);
      }
    }
  }

  // TEST 2: Check for EXPORT_BACKLOG mislabeling (e.g. "Export Revenue = ₹1,140 Cr" or "LNG Business = ₹1,140 Cr")
  const exportFact = factRegistry.primaryThesisMetrics.get(`${factRegistry.ticker}_${factRegistry.period.replace(/\s+/g, '')}_EXPORT_BACKLOG`);
  if (exportFact && exportFact.value) {
    const exportValStr = exportFact.value.toString();
    if (textLower.includes(`export revenue: ₹${exportValStr}`) || textLower.includes(`export revenue of ₹${exportValStr}`) || textLower.includes(`lng business: ₹${exportValStr}`)) {
      errors.push(`[TEST 2 FAIL] Export Backlog (₹${exportValStr} Cr) mislabeled as Export Revenue or LNG Business`);
    }
  }

  // TEST 3: Check for TOTAL_REVENUE mislabeling (e.g. "Export Revenue: ₹382 Cr")
  if (revFact && revFact.value) {
    const revValStr = Math.round(revFact.value).toString();
    if (textLower.includes(`export revenue: ₹${revValStr}`) || textLower.includes(`export revenue of ₹${revValStr}`)) {
      errors.push(`[TEST 3 FAIL] Total Revenue (₹${revValStr} Cr) mislabeled as Export Revenue`);
    }
  }

  // TEST 4: Fake Precision Conviction Score Enforcement (e.g. "Conviction Score: 92/100" or "92%")
  if (reportText.match(/conviction\s+score[:\s]+\d{2}\/100/i) || reportText.match(/conviction\s+score[:\s]+\d{2}\%/i)) {
    errors.push(`[TEST 4 FAIL] Unanchored numeric conviction score (e.g. 92/100) cited. Use qualitative Conviction (High/Medium/Low) ONLY.`);
  }

  // Capacity claims must match disclosed capacity, rather than a list of historically troublesome percentages.
  const capacity = factRegistry.primaryThesisMetrics.get(`${factRegistry.ticker}_${factRegistry.period.replace(/\s+/g, '')}_CAPACITY_UTILIZATION`);
  for (const claim of reportText.matchAll(/capacity\s+utili[sz]ation\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/gi)) {
    if (!capacity || Math.abs(Number(claim[1]) - capacity.value) > 0.05) errors.push('Capacity utilization is missing or differs from the current disclosed metric.');
  }

  // 5. Check for Premature Guidance Achievement in Q1
  if (factRegistry.period.includes('Q1') && textLower.includes('achieved revenue growth of 18% to 20% for fy')) {
    errors.push(`Annual FY target marked 'Achieved' during Q1. Must be ON_TRACK or AT_RISK for active mid-year target.`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Programmatic Commitment State Machine (8 Approved States)
 */
export function calculateProgrammaticCommitmentStatus(commitment, currentPeriod = 'Q1 FY27', actualPerformance = {}) {
  const statement = (commitment.statement || '').toLowerCase();
  const timeline = (commitment.timeline || '').toLowerCase();

  // 1. Long-term Aspirational Target (> 5 years)
  if (timeline.includes('2035') || timeline.includes('2040') || timeline.includes('2050')) {
    return 'ASPIRATIONAL_LONG_TERM';
  }

  // 2. Explicitly dropped guidance
  if (commitment.status === 'Dropped' || statement.includes('withdrawn') || statement.includes('dropped')) {
    return 'DROPPED';
  }

  // 3. Explicitly delayed
  if (commitment.status === 'Delayed' || statement.includes('postponed') || statement.includes('delayed')) {
    return 'DELAYED';
  }

  // 4. Mid-year Annual Guidance (Q1/Q2/Q3)
  if (currentPeriod.includes('Q1') || currentPeriod.includes('Q2') || currentPeriod.includes('Q3')) {
    if (actualPerformance.isFallingBehind) {
      return 'AT_RISK';
    }
    return 'ON_TRACK';
  }

  // 5. End of Full Year Period Evaluation
  if (commitment.status === 'Achieved') return 'ACHIEVED';
  if (commitment.status === 'Missed') return 'MISSED';

  return 'ON_TRACK';
}
