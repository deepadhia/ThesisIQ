/**
 * XBRL Alert Bridge Service
 *
 * Bridges official NSE/BSE structured XBRL filings into the real-time alert pipeline.
 * Authorizes 100% verified machine-readable financial metrics (revenue, EBITDA, PAT)
 * to preempt or augment PDF OCR parsing.
 */

import { parseXbrlFile } from "./xbrl/index.js";

const round2 = (n) => (n === null || n === undefined || isNaN(n)) ? null : Math.round(n * 100) / 100;

/**
 * Normalizes raw numeric values (which may be in absolute INR, lakhs, or crores) into Crores.
 */
function normalizeToCrores(val) {
  if (val === null || val === undefined || isNaN(val)) return null;
  const num = parseFloat(val);
  if (isNaN(num)) return null;

  // If > 10,000,000 (1 Cr absolute INR), convert from absolute INR to Crores
  if (Math.abs(num) >= 1e7) {
    return round2(num / 1e7);
  }
  // If > 1,000,000 but < 10,000,000, it's likely absolute INR (< 1 Cr) or lakhs
  if (Math.abs(num) >= 1e6) {
    return round2(num / 1e7);
  }
  // If between 1000 and 1,000,000, check if already in Crores or Lakhs
  // In typical Indian quarterly filings: revenue is either in Lakhs (1,000 - 500,000) or Crores (10 - 5,000)
  // But XBRL XML metrics parsed via metricMapper are either absolute INR (scaled) or raw from tag.
  return round2(num);
}

/**
 * Converts a database row from xbrl_metrics_quarterly into a standardized verified financial object.
 */
export function formatXbrlRowAsFinancials(row) {
  if (!row) return null;
  const rawRev = row.revenue_from_ops ?? row.revenue;
  if (rawRev === null || rawRev === undefined) return null;

  const numRev = parseFloat(rawRev);
  if (isNaN(numRev) || numRev <= 0) return null;

  // DB values in xbrl_metrics_quarterly are stored in absolute INR (e.g. 1766622000.00 for ₹176.66 Cr)
  const revCr = numRev >= 1e6 ? round2(numRev / 1e7) : round2(numRev);
  const rawPat = row.pat;
  const patCr = rawPat !== null && rawPat !== undefined ? (parseFloat(rawPat) >= 1e6 ? round2(parseFloat(rawPat) / 1e7) : round2(parseFloat(rawPat))) : null;

  let ebitdaCr = null;
  if (row.ebitda !== null && row.ebitda !== undefined) {
    const rawEb = parseFloat(row.ebitda);
    ebitdaCr = rawEb >= 1e6 ? round2(rawEb / 1e7) : round2(rawEb);
  }

  const ebitdaMarginPct = (revCr > 0 && ebitdaCr !== null) ? round2((ebitdaCr / revCr) * 100) : null;
  const periodEnd = row.period_end_date ? new Date(row.period_end_date).toISOString().slice(0, 10) : null;

  const revGrowth = row.revenue_growth_yoy !== null && row.revenue_growth_yoy !== undefined ? parseFloat(row.revenue_growth_yoy) : null;
  const patGrowth = row.pat_growth_yoy !== null && row.pat_growth_yoy !== undefined ? parseFloat(row.pat_growth_yoy) : null;

  return {
    isFinancialResult: true,
    statementScope: "CONSOLIDATED",
    unit: "Crores",
    quarterEnded: periodEnd,
    revenue: revCr,
    revenueYoYGrowthPct: revGrowth,
    revenueQoQGrowthPct: null,
    ebitda: ebitdaCr,
    ebitdaMarginPct: ebitdaMarginPct,
    ebitdaYoYGrowthPct: null,
    ebitdaMarginBpsDelta: null,
    patStandalone: patCr,
    patConsolidated: patCr,
    patAttributable: patCr,
    patYoYGrowthPct: patGrowth,
    isYoYDecline: Boolean(patGrowth !== null && patGrowth < 0),
    isMarginErosion: false,
    segmentRedFlags: [],
    source: "XBRL_XML",
    verification: "XBRL_VERIFIED",
    isVerified: true
  };
}

/**
 * Parses raw XBRL XML text into a standardized verified financial object.
 */
export async function parseXbrlXmlToFinancials(xmlContent) {
  if (typeof xmlContent !== "string" || !xmlContent.trim()) return null;

  const parseResult = await parseXbrlFile(xmlContent);
  if (!parseResult.success || !parseResult.data || !parseResult.data.metrics) return null;

  const quarters = Object.keys(parseResult.data.metrics);
  if (quarters.length === 0) return null;

  // Pick the latest quarter
  const latestQ = quarters[0];
  const m = parseResult.data.metrics[latestQ];
  if (!m || (m.revenue === undefined && m.pbt === undefined && m.pat === undefined)) return null;

  const revCr = normalizeToCrores(m.revenue);
  const patCr = normalizeToCrores(m.pat);
  let ebitdaCr = normalizeToCrores(m.ebitda);

  // If EBITDA is not explicitly tagged, compute EBITDA = PBT + Finance Costs + Depreciation
  if (ebitdaCr === null && m.pbt !== undefined) {
    const pbt = normalizeToCrores(m.pbt) || 0;
    const finCost = normalizeToCrores(m.finance_cost) || 0;
    const dep = normalizeToCrores(m.depreciation) || 0;
    if (pbt !== 0 || finCost !== 0 || dep !== 0) {
      ebitdaCr = round2(pbt + finCost + dep);
    }
  }

  const margin = (revCr && revCr > 0 && ebitdaCr !== null) ? round2((ebitdaCr / revCr) * 100) : null;
  const qDates = parseResult.data.quarterDates?.[latestQ];
  const periodEnd = qDates?.endDate || null;

  return {
    isFinancialResult: true,
    statementScope: "CONSOLIDATED",
    unit: "Crores",
    quarterEnded: periodEnd,
    revenue: revCr,
    revenueYoYGrowthPct: null,
    revenueQoQGrowthPct: null,
    ebitda: ebitdaCr,
    ebitdaMarginPct: margin,
    ebitdaYoYGrowthPct: null,
    ebitdaMarginBpsDelta: null,
    patStandalone: patCr,
    patConsolidated: patCr,
    patAttributable: patCr,
    patYoYGrowthPct: null,
    isYoYDecline: false,
    isMarginErosion: false,
    segmentRedFlags: [],
    source: "XBRL_XML",
    verification: "XBRL_VERIFIED",
    isVerified: true,
    rawSegments: parseResult.data.segments || []
  };
}

/**
 * Queries xbrl_metrics_quarterly in Supabase for a matching filing by ticker and periodEndHint.
 */
export async function resolveXbrlFinancialsForFiling(ticker, periodEndHint, pool) {
  if (!ticker || !pool) return null;

  try {
    let query = `
      SELECT * FROM xbrl_metrics_quarterly
      WHERE ticker = $1 AND revenue_from_ops IS NOT NULL
    `;
    const params = [ticker];

    if (periodEndHint) {
      // Check for period end within ±15 days to handle UTC vs IST month-end dates (e.g. 2026-06-29 vs 2026-06-30)
      query += ` AND period_end_date >= ($2::date - INTERVAL '15 days') AND period_end_date <= ($2::date + INTERVAL '15 days')`;
      params.push(periodEndHint);
    }

    query += ` ORDER BY period_end_date DESC LIMIT 1`;

    const { rows } = await pool.query(query, params);
    if (!rows || rows.length === 0) return null;

    return formatXbrlRowAsFinancials(rows[0]);
  } catch (err) {
    console.warn(`[XBRL BRIDGE] Query failed for ${ticker}:`, err.message);
    return null;
  }
}

/**
 * Reconciles and enriches a PDF-parsed financial object with XBRL data.
 */
export function reconcileOrEnrichFinancials(pdfFin, xbrlFin) {
  if (!pdfFin || !pdfFin.revenue) return xbrlFin;
  if (!xbrlFin || !xbrlFin.revenue) return pdfFin;

  // Enrich missing EBITDA or segments if PDF missed them
  const enriched = { ...pdfFin };
  if ((enriched.ebitda === null || enriched.ebitda === undefined) && xbrlFin.ebitda !== null) {
    enriched.ebitda = xbrlFin.ebitda;
    enriched.ebitdaMarginPct = xbrlFin.ebitdaMarginPct;
  }

  // Cross-check revenue
  const diffPct = Math.abs(enriched.revenue - xbrlFin.revenue) / Math.max(enriched.revenue, xbrlFin.revenue) * 100;
  if (diffPct <= 2.0) {
    // Highly reconciled!
    enriched.xbrlReconciled = true;
  }

  return enriched;
}
