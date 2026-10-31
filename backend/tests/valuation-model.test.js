import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  solveImpliedGrowth,
  solveTwoStageFcfImpliedGrowth,
  fcffValuePerEps,
  calculateInstitutionalFcffDcf,
  evaluateEquityMispricing,
  rankUniverseByMispricing,
  generateThesisBreakerMetric,
  IMPLIED_GROWTH_STATUS,
  MISPRICING_OPPORTUNITY_TIER
} from '../services/asymmetric-mispricing-ranking.service.js';
import {
  buildAuditedEquity,
  assessSnapshotFreshness,
  loadAuditedPortfolioFromDatabase,
  loadUnderwritingAssumptions,
  UNDERWRITING_ASSUMPTIONS_PATH
} from '../services/valuation-inputs.service.js';

const NOW = new Date('2026-10-31T10:00:00Z');
const src = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const marketRow = (over = {}) => ({
  ticker: 'AAA',
  company_name: 'Alpha Co',
  sector: 'Industrial',
  thesis_status: 'Intact',
  conviction_score: 8,
  final_action: 'HOLD',
  share_price: 100,
  pe_ratio: 20,
  market_cap: 5000,
  ttm_pat: 250,
  ttm_revenue: 2500,
  roce_pct: 25,
  market_data_as_of: '2026-10-30',
  freshness_status: 'FRESH',
  ...over
});
const assumption = (over = {}) => ({
  underwrittenCagrPct: 22,
  cfoPatRatio: 0.9,
  debtToEquity: 0.1,
  netDebtCr: -50,
  forwardIroicPct: 28,
  forwardIroicConfidence: 'HIGH',
  ...over
});

describe('reverse-DCF solver never invents a number', () => {
  it('reports INVALID_PE (not a made-up 15%) for zero, negative or non-numeric P/E', () => {
    for (const pe of [0, -5, NaN, undefined, null, '']) {
      const r = solveImpliedGrowth(pe, { effectiveIroic: 25 });
      expect(r.status).toBe(IMPLIED_GROWTH_STATUS.INVALID_PE);
      expect(r.growthPct).toBeNull();
      expect(solveTwoStageFcfImpliedGrowth(pe, { effectiveIroic: 25 })).toBeNull();
    }
  });

  it('reports UNREACHABLE for an absurd P/E instead of silently returning 10%', () => {
    const r = solveImpliedGrowth(5000, { effectiveIroic: 25 });
    expect(r.status).toBe(IMPLIED_GROWTH_STATUS.UNREACHABLE);
    expect(r.growthPct).toBeNull();
  });

  it('says a ~12% ROIC business at 27x P/E cannot be explained by growth (no 30% artifact)', () => {
    const r = solveImpliedGrowth(27.2, { effectiveIroic: 12.1 });
    expect(r.status).toBe(IMPLIED_GROWTH_STATUS.UNREACHABLE);
    expect(r.growthPct).toBeNull();
  });

  it('solves a normal case and round-trips: value at the implied growth equals the P/E', () => {
    const r = solveImpliedGrowth(26.7, { effectiveIroic: 24 });
    expect(r.status).toBe(IMPLIED_GROWTH_STATUS.SOLVED);
    expect(r.growthPct).toBeGreaterThan(5);
    expect(r.growthPct).toBeLessThan(40);
    const pv = fcffValuePerEps(r.growthPct / 100, { effectiveIroic: 24 });
    expect(Math.abs(pv - 26.7)).toBeLessThan(0.1);
  });

  it('implied growth rises with P/E at fixed ROIC', () => {
    const lo = solveImpliedGrowth(20, { effectiveIroic: 30 }).growthPct;
    const hi = solveImpliedGrowth(40, { effectiveIroic: 30 }).growthPct;
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('solver and DCF are one model', () => {
  it('fair value at the market-implied growth equals the market price (net debt zero)', () => {
    const r = solveImpliedGrowth(30, { effectiveIroic: 26 });
    expect(r.status).toBe(IMPLIED_GROWTH_STATUS.SOLVED);
    const fv = calculateInstitutionalFcffDcf({
      currentPrice: 300,
      currentPE: 30,
      underwrittenCagr: r.growthPct,
      effectiveIroic: 26,
      netDebtCr: 0,
      marketCapCr: 3000
    });
    expect(Math.abs(fv - 300) / 300).toBeLessThan(0.01);
  });
});

describe('snapshot freshness is computed from the date, not the stored label', () => {
  it('flags a 48-day-old snapshot even though the label says FRESH', () => {
    const f = assessSnapshotFreshness('2026-09-13', { now: NOW, maxAgeDays: 4 });
    expect(f.fresh).toBe(false);
    expect(f.ageDays).toBeGreaterThan(40);
  });
  it('accepts yesterday’s snapshot', () => {
    expect(assessSnapshotFreshness('2026-10-30', { now: NOW, maxAgeDays: 4 }).fresh).toBe(true);
  });
  it('treats a missing date as stale', () => {
    expect(assessSnapshotFreshness(null, { now: NOW }).fresh).toBe(false);
  });
});

describe('buildAuditedEquity: no ticker-specific behaviour, no silent defaults', () => {
  it('gives identical numbers for identical inputs regardless of ticker', () => {
    const a = buildAuditedEquity(marketRow({ ticker: 'AAA' }), assumption(), { now: NOW });
    const b = buildAuditedEquity(marketRow({ ticker: 'BBB' }), assumption(), { now: NOW });
    const strip = ({ ticker, companyName, ...rest }) => rest;
    expect(strip(a)).toEqual(strip(b));
  });

  it('is complete when market data is fresh and an underwritten growth exists', () => {
    const e = buildAuditedEquity(marketRow(), assumption(), { now: NOW });
    expect(e.inputGaps).toEqual([]);
    expect(e.expectedGrowthTrajectory).toBe('22% CAGR');
    expect(e.currentPE).toBe(20);
  });

  it('flags NO_UNDERWRITTEN_GROWTH instead of defaulting to 20%', () => {
    const e = buildAuditedEquity(marketRow(), null, { now: NOW });
    expect(e.inputGaps).toContain('NO_UNDERWRITTEN_GROWTH');
    expect(e.expectedGrowthTrajectory).toBeNull();
    const e2 = buildAuditedEquity(marketRow(), assumption({ underwrittenCagrPct: null }), { now: NOW });
    expect(e2.inputGaps).toContain('NO_UNDERWRITTEN_GROWTH');
  });

  it('flags a missing/invalid P/E instead of defaulting to 25x', () => {
    const e = buildAuditedEquity(marketRow({ pe_ratio: null }), assumption(), { now: NOW });
    expect(e.inputGaps).toContain('MISSING_PE');
    expect(e.currentPE).toBeNull();
    const neg = buildAuditedEquity(marketRow({ pe_ratio: -12 }), assumption(), { now: NOW });
    expect(neg.inputGaps).toContain('MISSING_PE');
  });

  it('flags missing ROCE instead of defaulting to 20%', () => {
    const e = buildAuditedEquity(marketRow({ roce_pct: null }), assumption(), { now: NOW });
    expect(e.inputGaps).toContain('MISSING_ROCE');
  });

  it('flags STALE_MARKET_DATA from the date even when the label says FRESH', () => {
    const e = buildAuditedEquity(marketRow({ market_data_as_of: '2026-09-13' }), assumption(), { now: NOW });
    expect(e.inputGaps).toContain('STALE_MARKET_DATA');
  });

  it('does not fabricate a thesis status or conviction', () => {
    const e = buildAuditedEquity(marketRow({ thesis_status: null, conviction_score: null, final_action: null }), assumption(), { now: NOW });
    expect(e.inputGaps).toContain('NO_THESIS_STATUS');
    expect(e.currentConviction).toBeNull();
    expect(e.capitalAction).toBeNull();
  });

  it('leaves unknown cash-conversion fields undefined rather than inventing 0.85 / 70 days / 0.05 D/E', () => {
    const e = buildAuditedEquity(marketRow(), assumption({ cfoPatRatio: undefined, debtToEquity: undefined, netDebtCr: undefined }), { now: NOW });
    expect(e.cashFlowEvidence.cfoPatRatio).toBeUndefined();
    expect(e.cashFlowEvidence.debtToEquity).toBeUndefined();
    expect(e.cashFlowEvidence.netDebtCr).toBeUndefined();
    expect(e.cashFlowEvidence.receivableDays).toBeUndefined();
  });

  it('applies an explicit, visible thesis-health override from the data file', () => {
    const e = buildAuditedEquity(
      marketRow({ thesis_status: 'Intact' }),
      assumption({ thesisHealthOverride: { value: 'BROKEN', reason: 'analyst', asOf: '2026-10-01' } }),
      { now: NOW }
    );
    expect(e.thesisHealth).toBe('BROKEN');
    expect(e.inputNotes.join(' ')).toMatch(/overrid/i);
  });
});

describe('thesis status mapping never turns "unknown" into "healthy"', () => {
  const healthOf = (status) => buildAuditedEquity(marketRow({ thesis_status: status }), assumption(), { now: NOW });

  it.each([
    ['strengthening', 'STRENGTHENING'],
    ['STRENGTHENING', 'STRENGTHENING'],
    ['ACCELERATING', 'STRENGTHENING'],
    ['THESIS_CONFIRMED_BEAT', 'STRENGTHENING'],
    ['Intact', 'INTACT'],
    ['stable', 'INTACT'],
    ['weakening', 'WEAKENING'],
    ['Under_Review', 'UNDER_PRESSURE'],
    ['THESIS_DEVIATION', 'UNDER_PRESSURE']
  ])('maps the real status %s to %s', (status, expected) => {
    const e = healthOf(status);
    expect(e.thesisHealth).toBe(expected);
    expect(e.inputGaps).not.toContain('UNKNOWN_THESIS_STATUS');
  });

  it.each(['DATA_UNAVAILABLE', 'NO_CONTRACT', 'something_new'])('treats %s as unknown (no verdict), not as INTACT', (status) => {
    const e = healthOf(status);
    expect(e.thesisHealth).toBeNull();
    expect(e.inputGaps).toContain('UNKNOWN_THESIS_STATUS');
    expect(evaluateEquityMispricing(e).opportunityTier).toBe(MISPRICING_OPPORTUNITY_TIER.INSUFFICIENT_DATA);
  });

  it('a visible override in the underwriting file still applies when the stored status is unknown', () => {
    const e = buildAuditedEquity(
      marketRow({ thesis_status: 'DATA_UNAVAILABLE' }),
      assumption({ thesisHealthOverride: { value: 'UNDER_PRESSURE', reason: 'analyst', asOf: '2026-10-01' } }),
      { now: NOW }
    );
    expect(e.thesisHealth).toBe('UNDER_PRESSURE');
    expect(e.inputGaps).not.toContain('UNKNOWN_THESIS_STATUS');
  });

  it('the cohort query prefers the latest snapshot that has a usable status over a newer unusable one', async () => {
    const captured = [];
    const fakePool = { query: async (sql, params) => { captured.push({ sql: String(sql), params }); return { rows: [] }; } };
    await loadAuditedPortfolioFromDatabase(fakePool, { now: NOW });
    expect(captured[0].params[0]).toEqual(expect.arrayContaining(['data_unavailable', 'no_contract']));
    expect(captured[0].sql).toMatch(/ANY\(\$1/);
  });
});

describe('scorecard internal consistency', () => {
  const equity = (over = {}) => ({
    ticker: 'X',
    companyName: 'X Ltd',
    sector: 'Defence & Railways',          // terminal growth 4.0% (not the 3.5% default)
    thesisHealth: 'STRENGTHENING',
    currentConviction: 9,
    evidenceSufficiency: 'SUFFICIENT',
    capitalAction: 'ACCUMULATE_CONVICTION',
    currentPrice: 450,
    currentPE: 15.6,
    marketCap: 4500,
    expectedGrowthTrajectory: '28% CAGR',
    financialEvidence: { roce: 24.5, ttmPat: 288, currentRevenue: 2000 },
    cashFlowEvidence: { cfoPatRatio: 0.9, debtToEquity: 0.0, netDebtCr: -100 },
    economicEvidence: { forwardIroic: 32, forwardIroicConfidence: 'HIGH', evidenceRecency: 'CURRENT_QUARTER' },
    ...over
  });

  it('the reverse DCF uses the same terminal growth as the fair-value DCF (sector-specific, not always 3.5%)', () => {
    const e = equity();
    const r = evaluateEquityMispricing(e);
    const sc = r.thesisIqScorecard;
    expect(sc.terminalGrowthRate).toBe(4.0);
    // Value the stock at exactly the implied growth with the SAME terminal growth: it must equal the price.
    const fvAtImplied = calculateInstitutionalFcffDcf({
      currentPrice: e.currentPrice,
      currentPE: e.currentPE,
      underwrittenCagr: sc.marketImpliedFcffCagr,
      effectiveIroic: sc.effectiveIroic,
      wacc: 0.115,
      terminalGrowth: sc.terminalGrowthRate / 100,
      netDebtCr: 0,
      marketCapCr: e.currentPrice * 10
    });
    expect(Math.abs(fvAtImplied - e.currentPrice) / e.currentPrice).toBeLessThan(0.02);
  });

  it('the solver accepts the terminal growth under either name (terminalGrowth or gt)', () => {
    const a = solveImpliedGrowth(25, { effectiveIroic: 25, terminalGrowth: 0.04 }).growthPct;
    const b = solveImpliedGrowth(25, { effectiveIroic: 25, gt: 0.04 }).growthPct;
    const dflt = solveImpliedGrowth(25, { effectiveIroic: 25 }).growthPct;
    expect(a).toBe(b);
    expect(a).not.toBe(dflt);
  });

  it('a bear case never sits above the price, so downside is never clamped to ₹1 and asymmetry stays sane', () => {
    const cheap = evaluateEquityMispricing(equity({ currentPrice: 160, currentPE: 8, marketCap: 1600, sector: 'Industrial' }));
    const sc = cheap.thesisIqScorecard;
    expect(sc.bearFloorPrice).toBeLessThanOrEqual(160 * 0.9 + 0.01);
    const maxAsymmetry = (sc.fairValuePrice - 160) / (160 * 0.10);
    expect(Number.isFinite(sc.asymmetryRatio)).toBe(true);
    expect(sc.asymmetryRatio).toBeLessThanOrEqual(maxAsymmetry + 0.01);
  });

  it('unverified cash conversion and leverage can never earn the PROVEN economic engine state', () => {
    const unverified = evaluateEquityMispricing(equity({ financialEvidence: { roce: 30, ttmPat: 288, currentRevenue: 2000 }, cashFlowEvidence: {} }));
    expect(unverified.thesisIqScorecard.economicEngineState).not.toBe('PROVEN');
    const verified = evaluateEquityMispricing(equity({ financialEvidence: { roce: 30, ttmPat: 288, currentRevenue: 2000 }, cashFlowEvidence: { cfoPatRatio: 0.9, debtToEquity: 0.1, netDebtCr: -50 } }));
    expect(verified.thesisIqScorecard.economicEngineState).toBe('PROVEN');
  });
});

describe('evaluateEquityMispricing refuses to judge on incomplete data', () => {
  it('returns INSUFFICIENT_DATA with the reasons, never an invented tier', () => {
    const e = buildAuditedEquity(marketRow(), null, { now: NOW });
    const r = evaluateEquityMispricing(e);
    expect(r.opportunityTier).toBe(MISPRICING_OPPORTUNITY_TIER.INSUFFICIENT_DATA);
    expect(r.mispricingScore).toBe(0);
    expect(r.missingInputs).toContain('NO_UNDERWRITTEN_GROWTH');
    expect(r.dataComplete).toBe(false);
  });

  it('rejects raw equities with no price / P/E / growth even without inputGaps', () => {
    expect(evaluateEquityMispricing({ ticker: 'X', currentPrice: 100, currentPE: 0, expectedGrowthTrajectory: '20% CAGR' }).opportunityTier)
      .toBe(MISPRICING_OPPORTUNITY_TIER.INSUFFICIENT_DATA);
    expect(evaluateEquityMispricing({ ticker: 'X', currentPrice: 100, currentPE: 20 }).opportunityTier)
      .toBe(MISPRICING_OPPORTUNITY_TIER.INSUFFICIENT_DATA);
    expect(evaluateEquityMispricing({ ticker: 'X', currentPE: 20, expectedGrowthTrajectory: '20% CAGR' }).opportunityTier)
      .toBe(MISPRICING_OPPORTUNITY_TIER.INSUFFICIENT_DATA);
  });

  it('ranks incomplete equities last', () => {
    const good = buildAuditedEquity(marketRow({ ticker: 'GOOD' }), assumption(), { now: NOW });
    const bad = buildAuditedEquity(marketRow({ ticker: 'BAD' }), null, { now: NOW });
    const ranked = rankUniverseByMispricing([bad, good]);
    expect(ranked[ranked.length - 1].ticker).toBe('BAD');
  });

  it('unverified cash conversion can never reach TOP_CONVICTION_DISLOCATION', () => {
    const base = {
      ticker: 'CHEAP',
      companyName: 'Cheap Co',
      sector: 'Industrial',
      thesisHealth: 'STRENGTHENING',
      currentConviction: 9,
      evidenceSufficiency: 'SUFFICIENT',
      capitalAction: 'ACCUMULATE_CONVICTION',
      currentPrice: 450,
      currentPE: 10.3,
      marketCap: 4500,
      expectedGrowthTrajectory: '28% CAGR',
      financialEvidence: { roce: 24.5, ttmPat: 437, currentRevenue: 4000 },
      economicEvidence: { forwardIroic: 30, forwardIroicConfidence: 'HIGH', evidenceRecency: 'CURRENT_QUARTER' }
    };
    const verified = evaluateEquityMispricing({
      ...base,
      cashFlowEvidence: { cfoPatRatio: 0.9, debtToEquity: 0.0, netDebtCr: -100 }
    });
    expect(verified.opportunityTier).toBe(MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION);

    const unverified = evaluateEquityMispricing({ ...base, cashFlowEvidence: {} });
    expect(unverified.opportunityTier).not.toBe(MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION);
  });
});

describe('loader reads the database and the data file, not the code', () => {
  it('queries without hard-coded tickers and flags stocks with no assumption entry', async () => {
    const assumptions = loadUnderwritingAssumptions();
    const known = Object.keys(assumptions.assumptions);
    expect(known.length).toBeGreaterThan(5);

    const captured = [];
    const fakePool = {
      query: async (sql, params) => {
        captured.push({ sql: String(sql), params });
        return {
          rows: [
            marketRow({ ticker: known[0] }),
            marketRow({ ticker: 'ZZZNEW' })
          ]
        };
      }
    };
    const out = await loadAuditedPortfolioFromDatabase(fakePool, { now: NOW });
    expect(captured.length).toBeGreaterThan(0);
    for (const c of captured) {
      expect(c.sql).not.toMatch(/'HBLENGINE'|'CCL'|'SHAKTIPUMP'/);
    }
    const zzz = out.find((e) => e.ticker === 'ZZZNEW');
    expect(zzz.inputGaps).toContain('NO_UNDERWRITTEN_GROWTH');
  });
});

describe('underwriting-assumptions data file', () => {
  const file = loadUnderwritingAssumptions();
  it('lives in a tracked location: reports/ is git-ignored, so a file there would never reach the server and the valuation watchdog would crash on load', () => {
    expect(UNDERWRITING_ASSUMPTIONS_PATH).not.toMatch(/[\\/]reports[\\/]/);
    expect(fs.existsSync(UNDERWRITING_ASSUMPTIONS_PATH)).toBe(true);
    const ignored = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const rel = path.relative(process.cwd(), UNDERWRITING_ASSUMPTIONS_PATH).replace(/\\/g, '/');
    for (const rule of ignored) {
      if (rule.endsWith('/')) expect(rel.startsWith(rule), `ignored by ${rule}`).toBe(false);
      else if (!rule.includes('*')) expect(rel, `ignored by ${rule}`).not.toBe(rule);
    }
  });
  it('has provenance and sane values', () => {
    expect(typeof file.note).toBe('string');
    for (const [ticker, a] of Object.entries(file.assumptions)) {
      expect(ticker).toMatch(/^[A-Z0-9&-]+$/);
      expect(a.source, `${ticker} needs a source`).toBeTruthy();
      if (a.underwrittenCagrPct !== null && a.underwrittenCagrPct !== undefined) {
        expect(a.underwrittenCagrPct).toBeGreaterThan(0);
        expect(a.underwrittenCagrPct).toBeLessThanOrEqual(60);
      }
    }
  });
  it('does not invent growth for names that were never underwritten', () => {
    expect(file.assumptions.ASTRAMICRO?.underwrittenCagrPct ?? null).toBeNull();
    expect(file.assumptions.MOREPENLAB?.underwrittenCagrPct ?? null).toBeNull();
  });
});

describe('no per-ticker logic in valuation code', () => {
  const files = [
    'backend/services/asymmetric-mispricing-ranking.service.js',
    'backend/services/valuation-inputs.service.js',
    'backend/scripts/run-asymmetric-mispricing-ranking.js',
    'backend/services/valuation-dislocation-watchdog.service.js'
  ];
  for (const f of files) {
    it(`${f} has no ticker comparisons or ticker maps`, () => {
      const text = src(f);
      expect(text).not.toMatch(/\b(?:ticker|tick|symbol)\s*===?\s*['"][A-Z]{3,}/);
      expect(text).not.toMatch(/UNDERWRITTEN_CAGR_MAP/);
    });
  }
  it('thesis-breaker text is generic', () => {
    const a = generateThesisBreakerMetric({ ticker: 'HBLENGINE', sector: 'Industrial' });
    const b = generateThesisBreakerMetric({ ticker: 'OTHER', sector: 'Industrial' });
    expect(a).toBe(b);
  });
});
