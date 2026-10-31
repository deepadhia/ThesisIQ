/**
 * Valuation inputs: turns database rows + the analyst underwriting file into the equity objects the valuation
 * engine evaluates. Nothing here is keyed on a ticker and nothing is invented:
 *  - market facts (price, P/E, ROCE, market cap, TTM figures) come ONLY from market_data_snapshots;
 *  - analyst assumptions (underwritten growth, forward iROIC, cash conversion, ...) come ONLY from
 *    backend/config/underwriting-assumptions.json;
 *  - anything missing or stale is listed in `inputGaps` and the engine refuses to issue a verdict
 *    (INSUFFICIENT_DATA) rather than substituting a stand-in number.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Kept in backend/config (tracked by git): reports/ is git-ignored, so a file there would never reach the server.
export const UNDERWRITING_ASSUMPTIONS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../config/underwriting-assumptions.json'
);

export const DEFAULT_MAX_SNAPSHOT_AGE_DAYS = 4; // covers a weekend plus one missed sync

let assumptionsCache = null;

export function loadUnderwritingAssumptions() {
  if (!assumptionsCache) {
    const parsed = JSON.parse(fs.readFileSync(UNDERWRITING_ASSUMPTIONS_PATH, 'utf8'));
    assumptionsCache = { note: parsed.note || '', assumptions: parsed.assumptions || {} };
  }
  return assumptionsCache;
}

const positive = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const finite = (v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Age is computed from the snapshot date itself; the stored freshness_status label is not trusted. */
export function assessSnapshotFreshness(asOf, { now = new Date(), maxAgeDays = DEFAULT_MAX_SNAPSHOT_AGE_DAYS } = {}) {
  if (!asOf) return { fresh: false, ageDays: null };
  const d = asOf instanceof Date ? asOf : new Date(`${String(asOf).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { fresh: false, ageDays: null };
  const ageDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  return { fresh: ageDays <= maxAgeDays, ageDays };
}

/** Stored statuses that mean "no assessment was possible" (not a verdict). Lower-case, matched exactly. */
export const UNUSABLE_THESIS_STATUSES = ['data_unavailable', 'no_contract'];

/**
 * Maps a stored thesis_status to the engine's health vocabulary. Returns null for anything unrecognised: an unknown
 * status must never be read as "healthy" (it used to default to INTACT, so DATA_UNAVAILABLE and THESIS_DEVIATION
 * looked fine to the buy gate).
 */
export function mapThesisHealth(rawStatus) {
  const s = String(rawStatus || '').trim().toLowerCase();
  if (!s || UNUSABLE_THESIS_STATUSES.includes(s)) return null;
  if (s.includes('weaken') || s.includes('broken') || s.includes('deteriorat')) return 'WEAKENING';
  if (s.includes('pressure') || s.includes('review') || s.includes('watch') || s.includes('deviation')) return 'UNDER_PRESSURE';
  if (s.includes('strengthen') || s.includes('accelerat') || s.includes('confirmed_beat')) return 'STRENGTHENING';
  if (s.includes('intact') || s.includes('stable')) return 'INTACT';
  return null;
}

const OPTIONAL_CASH_FIELDS = ['cfoPatRatio', 'receivableDays', 'debtToEquity', 'netDebtCr'];

export function buildAuditedEquity(row, assumption = null, { now = new Date(), maxAgeDays = DEFAULT_MAX_SNAPSHOT_AGE_DAYS } = {}) {
  const inputGaps = [];
  const inputNotes = [];

  const price = positive(row.share_price);
  const pe = positive(row.pe_ratio);
  const roce = positive(row.roce_pct);
  if (price === null) inputGaps.push('MISSING_PRICE');
  if (pe === null) inputGaps.push('MISSING_PE');
  if (roce === null) inputGaps.push('MISSING_ROCE');

  const freshness = assessSnapshotFreshness(row.market_data_as_of, { now, maxAgeDays });
  if (!freshness.fresh) inputGaps.push('STALE_MARKET_DATA');

  const growth = positive(assumption?.underwrittenCagrPct);
  if (growth === null) inputGaps.push('NO_UNDERWRITTEN_GROWTH');

  let thesisHealth = mapThesisHealth(row.thesis_status);
  if (thesisHealth === null) inputGaps.push(row.thesis_status ? 'UNKNOWN_THESIS_STATUS' : 'NO_THESIS_STATUS');
  const override = assumption?.thesisHealthOverride;
  if (override?.value) {
    thesisHealth = override.value;
    inputNotes.push(`Thesis health overridden to ${override.value} by the underwriting file (${override.reason || 'no reason given'}).`);
    for (const gap of ['NO_THESIS_STATUS', 'UNKNOWN_THESIS_STATUS']) {
      const idx = inputGaps.indexOf(gap);
      if (idx >= 0) inputGaps.splice(idx, 1);
    }
  }
  if (row.thesis_quarter) inputNotes.push(`Thesis status is from ${row.thesis_quarter}.`);

  const cashFlowEvidence = {};
  for (const key of OPTIONAL_CASH_FIELDS) {
    const v = finite(assumption?.[key]);
    if (v !== undefined) cashFlowEvidence[key] = v;
  }

  const economicEvidence = {};
  const fwd = positive(assumption?.forwardIroicPct);
  if (fwd !== null) economicEvidence.forwardIroic = fwd;
  if (assumption?.forwardIroicConfidence) economicEvidence.forwardIroicConfidence = assumption.forwardIroicConfidence;
  if (assumption?.evidenceRecency) economicEvidence.evidenceRecency = assumption.evidenceRecency;
  if (assumption?.hasTransformationCapex) economicEvidence.hasTransformationCapex = true;
  const tam = positive(assumption?.addressableTamCr);
  if (tam !== null) economicEvidence.addressableTamCr = tam;

  return {
    ticker: row.ticker,
    companyName: row.company_name,
    sector: row.sector,
    thesisHealth,
    currentConviction: finite(row.conviction_score) ?? null,
    evidenceSufficiency: 'SUFFICIENT',
    valuationBasis: 'TRAILING_TTM',
    capitalAction: row.final_action || null,
    currentPrice: price,
    currentPE: pe,
    marketCap: positive(row.market_cap),
    expectedGrowthTrajectory: growth === null ? null : `${growth}% CAGR`,
    financialEvidence: {
      roce,
      ttmPat: positive(row.ttm_pat),
      currentRevenue: positive(row.ttm_revenue)
    },
    cashFlowEvidence,
    economicEvidence,
    inputGaps,
    inputNotes,
    marketDataAsOf: row.market_data_as_of ?? null,
    marketDataAgeDays: freshness.ageDays,
    assumptionSource: assumption?.source ?? null
  };
}

const COHORT_SQL = `
  SELECT s.ticker, s.company_name, s.sector,
         qs.thesis_status, qs.quarter AS thesis_quarter, qs.conviction_score, qs.final_action,
         md.share_price, md.pe_ratio, md.market_cap, md.ttm_pat, md.ttm_revenue, md.roce_pct, md.market_data_as_of
  FROM stocks s
  LEFT JOIN (
    -- Latest snapshot that carries a usable status: a newer "DATA_UNAVAILABLE" does not hide an older real verdict.
    SELECT DISTINCT ON (stock_id) stock_id, quarter, thesis_status, conviction_score, final_action
    FROM quarterly_snapshots
    ORDER BY stock_id,
             (CASE WHEN thesis_status IS NULL OR LOWER(thesis_status) = ANY($1::text[]) THEN 1 ELSE 0 END),
             COALESCE((substring(quarter from 'FY([0-9]{2})')::integer * 100 + substring(quarter from 'Q([1-4])')::integer), 0) DESC,
             created_at DESC
  ) qs ON qs.stock_id = s.id
  LEFT JOIN (
    SELECT DISTINCT ON (ticker) ticker, share_price, pe_ratio, market_cap, ttm_pat, ttm_revenue, roce_pct, market_data_as_of
    FROM market_data_snapshots
    ORDER BY ticker, market_data_as_of DESC, market_data_retrieved_at DESC
  ) md ON md.ticker = s.ticker
  WHERE s.category IN ('Core', 'Watchlist')
  ORDER BY s.ticker`;

/** The tracked cohort (Core + Watchlist stocks) with real market data; every stock is returned, complete or not. */
export async function loadAuditedPortfolioFromDatabase(dbPool, { now = new Date(), maxAgeDays } = {}) {
  const { rows } = await dbPool.query(COHORT_SQL, [UNUSABLE_THESIS_STATUSES]);
  const { assumptions } = loadUnderwritingAssumptions();
  return rows.map((row) => buildAuditedEquity(row, assumptions[row.ticker] || null, { now, maxAgeDays }));
}
