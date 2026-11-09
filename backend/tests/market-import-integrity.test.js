import { describe, it, expect, vi } from 'vitest';
import { parseScreenerValuationData, syncAllPortfolioValuations, syncStockMarketValuation } from '../services/portfolio-market-valuation.service.js';
import { ingestMarketDataSnapshot, validateMarketDataSnapshot, getMarketDataSnapshot } from '../services/market-data-layer.service.js';
import { assessSnapshotFreshness } from '../services/valuation-inputs.service.js';
const html = `<ul id="top-ratios"><li><span class="name">Current Price</span><span class="number">100</span></li><li><span class="name">Market Cap</span><span class="number">1000</span></li></ul>`;
describe('market facts are never estimated from assumed margins or default P/E', () => {
  it('leaves missing financials, debt and EV unknown', () => {
    const r = parseScreenerValuationData(html, 'AAA');
    for (const field of ['ttmRevenue', 'ttmEbitda', 'ttmEbit', 'ttmPat', 'ttmEps', 'peRatio', 'netDebt', 'enterpriseValue', 'evEbitdaRatio']) expect(r[field], field).toBeNull();
  });
  it('does not describe P/E-derived EPS and PAT as independently verified statements', () => {
    const r = parseScreenerValuationData(html.replace('</ul>', '<li><span class="name">Stock P/E</span><span class="number">20</span></li></ul>'), 'AAA');
    expect(r.peRatio).toBe(20);
    expect(r.ttmPat).toBeNull();
    expect(r.ttmEps).toBeNull();
  });
  it('rejects future-dated snapshots', () => {
    expect(assessSnapshotFreshness('2026-11-09', { now: new Date('2026-11-08T12:00:00Z') }).fresh).toBe(false);
  });
  it('uses the source closing-price date, never retrieval date, and leaves unknown dates missing', () => {
    expect(parseScreenerValuationData(html, 'AAA').quoteAsOfDate).toBeNull();
    const dated = parseScreenerValuationData(`${html}<div>06 Nov - close price</div>`, 'AAA', { now: new Date('2026-11-08T12:00:00Z') });
    expect(dated.quoteAsOfDate).toBe('2026-11-06');
  });
  it('reads the source-dated intraday quote in Screener’s current page header', () => {
    const page = `Morepen Laboratories Ltd ₹ 99.0 4.98% 09 Nov 2:23 p.m. Export to Excel ${html}`;
    expect(parseScreenerValuationData(page, 'AAA', { now: new Date('2026-11-09T09:00:00Z') }).quoteAsOfDate).toBe('2026-11-09');
    expect(parseScreenerValuationData(`Morepen Laboratories Ltd ₹ 99.0 4.98% ${html}`, 'AAA', { now: new Date('2026-11-09T09:00:00Z') }).quoteAsOfDate).toBeNull();
  });
  it('does not trust a FRESH label on expired data at ingestion or retrieval', async () => {
    const old = { ticker: 'AAA', period: 'TTM', asOfDate: '2020-01-01', retrievedAt: new Date(), marketDataSource: 'TEST', sourceDocumentId: 'doc', sourceHash: 'hash', freshnessStatus: 'FRESH', sharePrice: 100, sharesOutstanding: 10, marketCap: 1000 };
    expect(validateMarketDataSnapshot(old).isValid).toBe(false);
    const result = await getMarketDataSnapshot('AAA', 'TTM', { query: async () => ({ rows: [{ freshness_status: 'FRESH', market_data_as_of: old.asOfDate }] }) });
    expect(result.status).toBe('VALUATION_BLOCKED');
  });
  it('preflights the live schema and refuses to insert made-up required facts', async () => {
    const queries = [];
    const result = await syncAllPortfolioValuations({ query: async sql => { queries.push(sql); return { rows: [{ column_name: 'enterprise_value' }] }; } });
    expect(result).toMatchObject([{ success: false, status: 'SCHEMA_MIGRATION_REQUIRED' }]);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('information_schema.columns');
  });
  it('does not retry alternate pages or other stocks after a Screener 429', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 429, headers: { get: () => '120' } }));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('AbortSignal', { timeout: () => new AbortController().signal });
    const pool = { query: vi.fn() };
    try {
      await expect(syncStockMarketValuation({ ticker: 'AAA' }, pool)).rejects.toThrow(/429/);
      await expect(syncStockMarketValuation({ ticker: 'BBB' }, pool)).rejects.toThrow(/cooldown/i);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(pool.query).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('persists unknown debt/EV as null and refreshes provenance and all financial fields on conflict', async () => {
    let sql, values;
    await ingestMarketDataSnapshot({ ticker: 'AAA', period: 'TTM', asOfDate: new Date(), retrievedAt: new Date(), marketDataSource: 'TEST', sourceDocumentId: 'doc', sourceHash: 'hash', freshnessStatus: 'FRESH', sharePrice: 100, sharesOutstanding: 10, marketCap: 1000 }, { query: async (q, v) => { sql = q; values = v; return { rows: [{}] }; } });
    expect(values[12]).toBeNull(); expect(values[13]).toBeNull();
    const conflict = sql.split('DO UPDATE SET')[1];
    for (const column of ['source_hash', 'source_document_id', 'ttm_revenue', 'ttm_ebitda', 'net_debt', 'roce_pct']) expect(conflict).toContain(`${column} = EXCLUDED.${column}`);
  });
});
