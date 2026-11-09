import { describe, it, expect, vi } from 'vitest';
import { analyseEarningsReaction, createReactionHistoryClient, parseReactionChart, formatReactionContext, loadEarningsReaction } from '../services/earnings-reaction.service.js';
import { selectResultsEvents } from '../services/earnings-reaction-board.service.js';

const bar = (date, close, extra = {}) => ({ date, open: close, close, adjustedClose: close, volume: 100, ...extra });
const bars = [bar('2026-11-05', 100), bar('2026-11-06', 98), bar('2026-11-08', 104)];
const input = (extra = {}) => ({ publishedAt: '2026-11-05T15:00:00Z', bars, benchmarkBars: bars.map(b => ({ ...b, close: 100, adjustedClose: 100 })), now: new Date('2026-11-08T13:00:00Z'), ...extra });

describe('event-relative market reaction, independent of company', () => {
  it('separates the first response, latest session and cumulative response; immature windows stay pending', () => {
    const r = analyseEarningsReaction(input());
    expect(r.windows.D1.returnPct).toBeCloseTo(-2);
    expect(r.latest.returnPct).toBeCloseTo(4);
    expect(r.latestSession.returnPct).toBeCloseTo(100 * (104 / 98 - 1));
    expect(r.windows.D3).toEqual({ status: 'PENDING', sessionsRequired: 3 });
    expect(r.consensus).toBe('UNKNOWN');
  });
  it('counts an actual Sunday special session after Saturday results', () => {
    const r = analyseEarningsReaction(input({ publishedAt: '2026-11-07T08:15:31Z' }));
    expect(r.baseline.date).toBe('2026-11-06');
    expect(r.windows.D1.date).toBe('2026-11-08');
    expect(r.flags).toContain('SHORT_SESSION_VOLUME_NOT_COMPARABLE');
  });
  it('does not use a still-open session or future bars', () => {
    const r = analyseEarningsReaction(input({ now: new Date('2026-11-08T09:30:00Z'), publishedAt: '2026-11-07T08:15:31Z' }));
    expect(r.status).toBe('PENDING');
    expect(r.windows.D1.status).toBe('PENDING');
  });
  it('flags an intraday daily bar as mixing pre and post release prices', () => {
    const r = analyseEarningsReaction(input({ publishedAt: '2026-11-06T08:30:00Z' }));
    expect(r.flags).toContain('INTRADAY_RELEASE_MIXED_DAILY_BAR');
    expect(r.windows.D1.returnPct).toBeCloseTo(-2);
  });
  it('uses adjusted closes through a split, and refuses missing adjustments', () => {
    const splitBars = [bar('2026-11-05', 100, { adjustedClose: 50 }), bar('2026-11-06', 51), bar('2026-11-08', 52)];
    expect(analyseEarningsReaction(input({ bars: splitBars })).windows.D1.returnPct).toBeCloseTo(2);
    expect(analyseEarningsReaction(input({ bars: [bars[0], { ...bars[1], adjustedClose: null }] })).status).toBe('UNAVAILABLE');
  });
  it('requires the actual benchmark baseline date, never substitutes a nearby close', () => {
    const r = analyseEarningsReaction(input({ benchmarkBars: [bar('2026-11-04', 99), bar('2026-11-06', 100)] }));
    expect(r.windows.D1.benchmarkReturnPct).toBeNull();
    expect(r.windows.D1.excessReturnPp).toBeNull();
  });
  it('fails closed on duplicate dates, invalid timestamps and insufficient baseline history', () => {
    expect(analyseEarningsReaction(input({ bars: [...bars, bars[1]] })).status).toBe('UNAVAILABLE');
    expect(analyseEarningsReaction(input({ publishedAt: '2026-11-05 15:00:00' })).status).toBe('UNAVAILABLE');
    expect(analyseEarningsReaction(input({ publishedAt: '2026-10-01T00:00:00Z' })).status).toBe('UNAVAILABLE');
  });
  it('does not turn a price move into a buy/sell or expectations beat', () => {
    const text = formatReactionContext(analyseEarningsReaction(input()));
    expect(text).toContain('expectations unknown');
    expect(text).toContain('D3 pending');
    expect(text).not.toMatch(/\b(BUY|SELL|ADD|beat expectations)\b/);
  });
  it('anchors on the earliest verified result that day, excluding later unrelated board meetings and decks', () => {
    const event = { ticker: 'AAA', title: 'Financial results', filing_date: '2026-11-05T15:00:00Z', attachment_url: 'https://exchange.test/results.pdf', vf: { isFinancialResult: true, revenue: 100 } };
    const rows = [{ ...event, filing_date: '2026-11-07T12:00:00Z', vf: null }, { ...event, filing_date: '2026-11-06T12:00:00Z', title: 'Investor presentation' }, { ...event, filing_date: '2026-11-05T16:00:00Z' }, event];
    expect(selectResultsEvents(rows)).toEqual([event]);
  });
  it('recognises verified statements under generic exchange titles', () => {
    const event = { ticker: 'AAA', title: 'General Updates', filing_date: '2026-11-05T15:00:00Z', attachment_url: 'https://exchange.test/results.pdf', vf: { isFinancialResult: true, revenue: 100 } };
    expect(selectResultsEvents([event])).toEqual([event]);
  });
  it('keeps the first disclosure of the same reporting quarter across midnight and later duplicates', () => {
    const event = { ticker: 'AAA', title: 'General Updates', filing_date: '2026-11-05T18:00:00Z', reporting_period: 'Q2 FY27', attachment_url: 'https://exchange.test/results.pdf', vf: { isFinancialResult: true, revenue: 100 } };
    expect(selectResultsEvents([event, { ...event, filing_date: '2026-11-06T08:00:00Z' }])).toEqual([event]);
  });
  it('does not label stale history as the latest response when a benchmark session is missing', () => {
    expect(analyseEarningsReaction(input({ bars: bars.slice(0, 2) })).status).toBe('UNAVAILABLE');
  });
  it('has a whole-request deadline including a stalled response body', async () => {
    const client = createReactionHistoryClient({ timeoutMs: 10, fetcher: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
    await expect(client.get('AAA.NS')).rejects.toThrow(/deadline/);
  });
});

const chart = (symbol = 'AAA.NS') => ({ chart: { result: [{ meta: { symbol, exchangeTimezoneName: 'Asia/Kolkata' }, timestamp: [1793936700], indicators: { quote: [{ open: [100], close: [101], volume: [10] }], adjclose: [{ adjclose: [101] }] } }] } });
describe('bounded and shared market history provider', () => {
  it('prefers the current ticker over an exchange identifier retained for legacy filings', async () => {
    const client = { get: vi.fn(async symbol => {
      if (symbol === 'OLD.NS') throw new Error('Market history HTTP 404');
      return { bars, source: 'TEST' };
    }) };
    const r = await loadEarningsReaction({ ticker: 'AAA', nseSymbol: 'OLD', publishedAt: input().publishedAt, now: input().now, client });
    expect(r.status).toBe('OBSERVED');
    expect(client.get).not.toHaveBeenCalledWith('OLD.NS');
  });
  it('validates identity and rejects missing adjusted prices instead of falling back to raw', () => {
    expect(() => parseReactionChart(chart('BBB.NS'), 'AAA.NS')).toThrow(/identity/i);
    const c = chart(); c.chart.result[0].indicators.adjclose = [];
    expect(() => parseReactionChart(c, 'AAA.NS')).toThrow(/adjust/i);
  });
  it('coalesces identical requests and caches them across filings', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => chart() }));
    const client = createReactionHistoryClient({ fetcher });
    await Promise.all([client.get('AAA.NS'), client.get('AAA.NS')]);
    await client.get('AAA.NS');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].signal).toBeDefined();
  });
  it('respects a provider-wide 429 cooldown, without retry storms on other symbols', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 429, headers: { get: () => '120' } }));
    const client = createReactionHistoryClient({ fetcher });
    await expect(client.get('AAA.NS')).rejects.toThrow(/429/);
    await expect(client.get('BBB.NS')).rejects.toThrow(/cooldown/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
