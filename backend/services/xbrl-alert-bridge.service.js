/**
 * XBRL Alert Bridge Service
 *
 * Bridges structured XBRL filings into the alert pipeline only when exact-filing,
 * unit, scope and taxonomy provenance has been retained. Legacy quarterly rows
 * and this module's unvalidated XML parser are comparison data, not alert authority.
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
 * Converts a database row into the worker's financial shape. The legacy mode is for
 * comparison only; callers must require alertEligible before using it in an alert.
 */
export function formatXbrlRowAsFinancials(row, { absoluteInr = false } = {}) {
  if (!row) return null;
  const rawRev = row.revenue_from_ops ?? row.revenue;
  if (rawRev === null || rawRev === undefined) return null;

  const numRev = parseFloat(rawRev);
  if (isNaN(numRev) || numRev <= 0) return null;

  // DB values in xbrl_metrics_quarterly are stored in absolute INR (e.g. 1766622000.00 for ₹176.66 Cr)
  const scale = value => absoluteInr ? round2(Number(value) / 1e7) : (Math.abs(Number(value)) >= 1e6 ? round2(Number(value) / 1e7) : round2(Number(value)));
  const revCr = scale(numRev);
  const rawPat = row.pat;
  const patCr = rawPat !== null && rawPat !== undefined && Number.isFinite(Number(rawPat)) ? scale(rawPat) : null;

  let ebitdaCr = null;
  if (row.ebitda !== null && row.ebitda !== undefined) {
    const rawEb = parseFloat(row.ebitda);
    ebitdaCr = Number.isFinite(rawEb) ? scale(rawEb) : null;
  }

  const ebitdaMarginPct = (revCr > 0 && ebitdaCr !== null) ? round2((ebitdaCr / revCr) * 100) : null;
  const periodEnd = row.period_end_date ? new Date(row.period_end_date).toISOString().slice(0, 10) : null;

  const revGrowth = !absoluteInr && row.revenue_growth_yoy !== null && row.revenue_growth_yoy !== undefined ? parseFloat(row.revenue_growth_yoy) : null;
  const patGrowth = !absoluteInr && row.pat_growth_yoy !== null && row.pat_growth_yoy !== undefined ? parseFloat(row.pat_growth_yoy) : null;

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
    patStandalone: absoluteInr ? null : patCr,
    patConsolidated: patCr,
    patAttributable: absoluteInr ? null : patCr,
    patYoYGrowthPct: patGrowth,
    isYoYDecline: Boolean(patGrowth !== null && patGrowth < 0),
    isMarginErosion: false,
    segmentRedFlags: [],
    source: "XBRL_XML",
    verification: "XBRL_VERIFIED",
    isVerified: true,
    alertEligible: absoluteInr
  };
}

/**
 * Parses raw XBRL XML text into a standardized verified financial object.
 */
export async function parseXbrlXmlToFinancials(xmlContent) {
  if (typeof xmlContent !== "string" || !xmlContent.trim()) return null;

  const parseResult = await parseXbrlFile(xmlContent);
  if (!parseResult.success || !parseResult.data || !parseResult.data.metrics) return null;

  const quarterDates = parseResult.data.quarterDates || {};
  const datedQuarters = Object.keys(parseResult.data.metrics).map(q => {
    const raw = quarterDates[q];
    const end = typeof raw === "string" ? raw : raw?.endDate;
    const timestamp = Date.parse(end || "");
    return { q, end, timestamp };
  }).filter(entry => Number.isFinite(entry.timestamp)).sort((a, b) => b.timestamp - a.timestamp);
  if (!datedQuarters.length) return null;

  const latestQ = datedQuarters[0].q;
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
  const periodEnd = datedQuarters[0].end;

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
    // This legacy parser does not validate taxonomy, unitRef, context dimensions or filing identity.
    // Its figures can be inspected but cannot authorize an alert until those checks exist.
    alertEligible: false,
    rawSegments: parseResult.data.segments || []
  };
}

/**
 * Queries xbrl_metrics_quarterly in Supabase for a matching filing by ticker and periodEndHint.
 */
export async function resolveXbrlFinancialsForFiling(ticker, periodEndHint, pool, { attachmentUrl = null } = {}) {
  if (!ticker || !pool || !/^\d{4}-\d{2}-\d{2}$/.test(String(periodEndHint || "")) || !attachmentUrl) return null;

  try {
    const query = `
      SELECT * FROM xbrl_metrics_quarterly
      WHERE ticker = $1 AND period_end_date = $2::date AND revenue_from_ops IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1
    `;
    const { rows } = await pool.query(query, [ticker, periodEndHint]);
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    const proof = row.metric_metadata?.alert_provenance;
    // The current quarterly table collapses basis/revisions and contains NSE API as well as XML values.
    // Only a future fact-ledger writer that supplies this explicit attestation may feed an alert.
    if (row.source !== "validated_xml" || proof?.taxonomy_validated !== true || proof?.unit !== "INR" ||
        proof?.scope !== "CONSOLIDATED" || proof?.period_end !== periodEndHint ||
        proof?.source_url !== attachmentUrl || proof?.fields?.revenue_from_ops !== "validated" ||
        proof?.fields?.pat !== "validated") return null;
    const fin = formatXbrlRowAsFinancials(row, { absoluteInr: true });
    if (!fin || fin.revenue <= 0 || fin.patConsolidated === null) return null;
    if (proof.fields.ebitda !== "validated") {
      fin.ebitda = null;
      fin.ebitdaMarginPct = null;
    }
    return fin;
  } catch (err) {
    console.warn(`[XBRL BRIDGE] Query failed for ${ticker}:`, err.message);
    return null;
  }
}

/**
 * Reconciles and enriches a PDF-parsed financial object with XBRL data.
 */
export function reconcileOrEnrichFinancials(pdfFin, xbrlFin) {
  if (!pdfFin || !pdfFin.revenue) return xbrlFin?.alertEligible === true ? xbrlFin : pdfFin;
  if (!xbrlFin || !xbrlFin.revenue) return pdfFin;

  const comparable = pdfFin.isVerified === true && xbrlFin.isVerified === true && xbrlFin.alertEligible === true &&
    pdfFin.quarterEnded && pdfFin.quarterEnded === xbrlFin.quarterEnded &&
    pdfFin.statementScope && pdfFin.statementScope === xbrlFin.statementScope &&
    Number.isFinite(Number(pdfFin.patConsolidated)) && Number.isFinite(Number(xbrlFin.patConsolidated));
  const close = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) <= 0.005;
  if (!comparable || !close(pdfFin.revenue, xbrlFin.revenue) ||
      !close(pdfFin.patConsolidated, xbrlFin.patConsolidated)) return pdfFin;
  const enriched = { ...pdfFin, xbrlReconciled: true };
  if (enriched.ebitda == null && Number.isFinite(Number(xbrlFin.ebitda)) && xbrlFin.ebitda != null) {
    enriched.ebitda = xbrlFin.ebitda;
    enriched.ebitdaMarginPct = xbrlFin.ebitdaMarginPct;
  }
  return enriched;
}
