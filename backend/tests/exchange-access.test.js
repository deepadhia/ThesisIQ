/**
 * Exchange access (2026-11-01): from the Oracle server BSE answered HTTP 403 for every stock (a cloud IP is treated as a bot).
 * Two stocks (HSCL, MOREPENLAB) are listed only on BSE, so while BSE is blocked the daemon cannot see their filings at all,
 * and nothing said so. The BSE client now presents a browser session (cookie warm-up), retries a block once with a fresh
 * session, can go through a relay the owner controls, and the scanner tells the owner when BSE-only stocks are blind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/env.js', () => ({ NVIDIA_API_KEY: '', GROQ_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', GEMINI_API_KEY: '', DATABASE_URL: 'postgres://test' }));
vi.mock('../db/pool.js', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../services/telegram.service.js', async () => ({ ...(await vi.importActual('../services/telegram.service.js')), sendTelegramMessage: vi.fn(async () => ({ ok: true })) }));

import { fetchBseAnnouncements, resetBseSession } from '../services/announcement.service.js';
import { evaluateExchangeAccess, alertExchangeAccess, shouldSkipBse } from '../services/exchange-access.service.js';

// Production runs on plain Node (AbortSignal.timeout exists); the jsdom test environment's AbortSignal lacks it.
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms).unref?.();
    return controller.signal;
  };
}

const ROW = { NEWSID: 'abc-1', NEWSSUB: 'Outcome of Board Meeting', DT_TM: '2026-10-31T13:31:00', PDFFLAG: 0, ATTACHMENTNAME: 'x.pdf' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null, getSetCookie: () => [] } });
const page = (rows) => json({ Table: rows, Table1: [{ ROWCNT: rows.length }] });
const home = () => ({ ok: true, status: 200, text: async () => '', headers: { get: () => null, getSetCookie: () => ['ak_bmsc=ABC123; Path=/; Secure', 'bm_sv=XYZ; Path=/'] } });
const blocked = (status = 403, body = '<HTML>Access Denied') => ({ ok: false, status, text: async () => body, json: async () => { throw new Error('not json'); }, headers: { get: () => null, getSetCookie: () => [] } });

let calls;
function stubFetch(handler) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts, calls.length);
  }));
}

beforeEach(() => { resetBseSession(); delete process.env.BSE_PROXY_URL; delete process.env.BSE_PROXY_TOKEN; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.BSE_PROXY_URL; delete process.env.BSE_PROXY_TOKEN; });

describe('BSE client', () => {
  it('opens a browser session first and sends its cookies with the API call', async () => {
    stubFetch((url) => (url.includes('AnnSubCategoryGetData') ? page([ROW]) : home()));
    const rows = await fetchBseAnnouncements('533282', 7, { retryDelayMs: 0 });
    expect(rows).toHaveLength(1);
    const api = calls.find(c => c.url.includes('AnnSubCategoryGetData'));
    expect(api.opts.headers.Cookie).toContain('ak_bmsc=ABC123');
    expect(api.opts.headers.Cookie).toContain('bm_sv=XYZ');
    expect(api.opts.headers['Sec-Fetch-Site']).toBe('same-site');
  });

  it('reuses the session for the next stock instead of opening a new one each time', async () => {
    stubFetch((url) => (url.includes('AnnSubCategoryGetData') ? page([ROW]) : home()));
    await fetchBseAnnouncements('533282', 7, { retryDelayMs: 0 });
    await fetchBseAnnouncements('519600', 7, { retryDelayMs: 0 });
    expect(calls.filter(c => !c.url.includes('AnnSubCategoryGetData'))).toHaveLength(1);
  });

  it('a 403 is retried once with a fresh session and succeeds when the second try is let through', async () => {
    let apiCalls = 0;
    stubFetch((url) => {
      if (!url.includes('AnnSubCategoryGetData')) return home();
      apiCalls += 1;
      return apiCalls === 1 ? blocked(403) : page([ROW]);
    });
    const rows = await fetchBseAnnouncements('533282', 7, { retryDelayMs: 0 });
    expect(rows).toHaveLength(1);
    expect(apiCalls).toBe(2);
    expect(calls.filter(c => !c.url.includes('AnnSubCategoryGetData')).length).toBe(2); // session opened, then refreshed
  });

  it('a block that persists throws an error that says it is a block, with the status and what the exchange answered', async () => {
    stubFetch((url) => (url.includes('AnnSubCategoryGetData') ? blocked(403, '<HTML>Access Denied - reference #18.abc') : home()));
    const err = await fetchBseAnnouncements('533282', 7, { retryDelayMs: 0 }).catch(e => e);
    expect(err.blocked).toBe(true);
    expect(err.status).toBe(403);
    expect(err.message).toContain('BSE announcements HTTP 403 for scrip 533282');
    expect(err.message).toContain('Access Denied');
  });

  it('a server error (not a block) is a plain failure, not a block', async () => {
    stubFetch((url) => (url.includes('AnnSubCategoryGetData') ? blocked(500, 'oops') : home()));
    const err = await fetchBseAnnouncements('533282', 7, { retryDelayMs: 0 }).catch(e => e);
    expect(err.blocked).toBeFalsy();
    expect(err.message).toContain('HTTP 500');
  });

  it('goes through the owner\'s relay when BSE_PROXY_URL is set, never touching the exchange directly', async () => {
    process.env.BSE_PROXY_URL = 'https://relay.example.workers.dev';
    process.env.BSE_PROXY_TOKEN = 'secret-token';
    stubFetch(() => page([ROW]));
    const rows = await fetchBseAnnouncements('533282', 7, { retryDelayMs: 0 });
    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith('https://relay.example.workers.dev/?url=')).toBe(true);
    expect(decodeURIComponent(calls[0].url)).toContain('api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w');
    expect(calls[0].opts.headers['x-proxy-token']).toBe('secret-token');
  });
});

describe('BSE-only stocks going blind', () => {
  const stocks = [
    { ticker: 'CCL', nse_symbol: 'CCL', bse_scrip_code: '519600' },
    { ticker: 'HSCL', nse_symbol: null, bse_scrip_code: '500184' },
    { ticker: 'MOREPENLAB', nse_symbol: null, bse_scrip_code: '500288' }
  ];

  it('is an issue when a stock listed only on BSE could not be fetched', () => {
    const issues = evaluateExchangeAccess({ stocks, bseFailures: new Map([['CCL', 403], ['HSCL', 403], ['MOREPENLAB', 403]]) });
    expect(issues).toHaveLength(1);
    expect(issues[0].tickers).toEqual(['HSCL', 'MOREPENLAB']);
    expect(issues[0].text).toContain('HSCL');
    expect(issues[0].text).toContain('MOREPENLAB');
    expect(issues[0].text).not.toContain('CCL');
  });

  it('is not an issue when only stocks that NSE also covers failed on BSE', () => {
    expect(evaluateExchangeAccess({ stocks, bseFailures: new Map([['CCL', 403]]) })).toEqual([]);
  });

  it('is not an issue when nothing failed', () => {
    expect(evaluateExchangeAccess({ stocks, bseFailures: new Map() })).toEqual([]);
  });

  it('tells the owner once per cooldown, and records the alert only after it was sent', async () => {
    const issues = evaluateExchangeAccess({ stocks, bseFailures: new Map([['HSCL', 403]]) });
    const mem = new Map();
    const store = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); } };
    const send = vi.fn(async () => ({ ok: true }));
    const t0 = new Date('2026-11-01T06:00:00Z');
    expect(await alertExchangeAccess({ issues, store, send, now: t0 })).toHaveLength(1);
    expect(await alertExchangeAccess({ issues, store, send, now: new Date(t0.getTime() + 3600000) })).toHaveLength(0);
    expect(await alertExchangeAccess({ issues, store, send, now: new Date(t0.getTime() + 13 * 3600000) })).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2);

    const failingSend = vi.fn(async () => { throw new Error('telegram down'); });
    const mem2 = new Map();
    const store2 = { get: async (k) => mem2.get(k) ?? null, set: async (k, v) => { mem2.set(k, v); } };
    await expect(alertExchangeAccess({ issues, store: store2, send: failingSend, now: t0 })).rejects.toThrow('telegram down');
    expect(mem2.size).toBe(0);
  });

  it('stops hammering BSE for stocks NSE also covers after repeated blocks, but always tries the BSE-only ones', () => {
    expect(shouldSkipBse({ blockedInRun: 0, hasNse: true })).toBe(false);
    expect(shouldSkipBse({ blockedInRun: 1, hasNse: true })).toBe(false);
    expect(shouldSkipBse({ blockedInRun: 2, hasNse: true })).toBe(true);
    expect(shouldSkipBse({ blockedInRun: 9, hasNse: false })).toBe(false);
  });
});
