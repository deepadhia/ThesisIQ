import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/pool.js', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../services/telegram.service.js', () => ({ sendTelegramMessage: vi.fn(async () => ({ ok: true })) }));

const { sendTelegramMessage } = await import('../services/telegram.service.js');
const { evaluateAndDispatchDislocationAlerts } = await import('../services/valuation-dislocation-watchdog.service.js');
const { loadUnderwritingAssumptions } = await import('../services/valuation-inputs.service.js');

const today = () => new Date().toISOString().slice(0, 10);
const longAgo = '2020-01-01';

const row = (ticker, over = {}) => ({
  ticker,
  company_name: `${ticker} Ltd`,
  sector: 'Industrial',
  thesis_status: 'Strengthening',
  conviction_score: 9,
  final_action: 'ACCUMULATE_CONVICTION',
  share_price: 450,
  pe_ratio: 10.3,
  market_cap: 4500,
  ttm_pat: 437,
  ttm_revenue: 4000,
  roce_pct: 24.5,
  market_data_as_of: today(),
  ...over
});

/** Fake pool: serves the cohort query, records writes, returns nothing for every other read. */
function fakePool(cohortRows, { failInsert = false } = {}) {
  const writes = [];
  const queries = [];
  return {
    writes,
    queries,
    query: async (sql, params) => {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (/FROM stocks s/.test(text)) return { rows: cohortRows };
      if (/^\s*INSERT INTO valuation_dislocation_alerts/i.test(text) && failInsert) throw new Error('numeric field overflow');
      if (/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER)/i.test(text)) writes.push({ sql: text.replace(/\s+/g, ' ').slice(0, 60), params });
      return { rows: [] };
    }
  };
}

// A ticker from the real underwriting file that has a verified net-cash balance sheet and an underwritten growth figure.
const netCashTicker = Object.entries(loadUnderwritingAssumptions().assumptions)
  .find(([, a]) => a.underwrittenCagrPct > 0 && Number.isFinite(a.netDebtCr) && a.netDebtCr <= 0)?.[0];

describe('valuation watchdog', () => {
  beforeEach(() => sendTelegramMessage.mockClear());

  it('has a verified-cash ticker in the underwriting file to test with', () => {
    expect(netCashTicker).toBeTruthy();
  });

  it('alerts on a cheap stock with verified cash and complete, fresh data', async () => {
    const pool = fakePool([row(netCashTicker)]);
    const res = await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false, forceAlert: true });
    expect(res.evaluatedCount).toBe(1);
    expect(res.dislocationsFound).toBe(1);
    expect(res.dispatchedTickers).toEqual([netCashTicker]);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage.mock.calls[0][0]).toContain('qualified on a verified net-cash balance sheet');
  });

  it('never alerts on a stock with no underwritten growth, however cheap it looks', async () => {
    const pool = fakePool([row('ASTRAMICRO')]);
    const res = await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false, forceAlert: true });
    expect(res.evaluatedCount).toBe(0);
    expect(res.notEvaluatedTickers[0].missing).toContain('NO_UNDERWRITTEN_GROWTH');
    expect(res.alertsDispatched).toBe(0);
  });

  it('never alerts on stale prices', async () => {
    const pool = fakePool([row(netCashTicker, { market_data_as_of: longAgo })]);
    const res = await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false, forceAlert: true });
    expect(res.alertsDispatched).toBe(0);
    expect(res.notEvaluatedTickers[0].missing).toContain('STALE_MARKET_DATA');
  });

  it('says so on Telegram when it could not evaluate a single stock (no silent failure)', async () => {
    const pool = fakePool([row(netCashTicker, { market_data_as_of: longAgo }), row('ASTRAMICRO')]);
    await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false, forceAlert: true });
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    const text = sendTelegramMessage.mock.calls[0][0];
    expect(text).toMatch(/could not evaluate any of 2 stocks/);
    expect(text).toContain('STALE_MARKET_DATA');
  });

  it('does not send the health warning on a dry run', async () => {
    const pool = fakePool([row(netCashTicker, { market_data_as_of: longAgo })]);
    await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: true, forceAlert: true });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('the alert only states what the code actually checked: no EMA or "pristine cash" claims it never computed', async () => {
    const pool = fakePool([row(netCashTicker)]);
    await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false, forceAlert: true });
    const text = sendTelegramMessage.mock.calls[0][0];
    expect(text).not.toMatch(/EMA/);
    expect(text).not.toMatch(/institutional support/i);
    expect(text).not.toMatch(/pristine cash/i);
    expect(text).toMatch(/discount to (model )?fair value/i);
  });

  it('"what changed since the last alert" only considers alerts that were actually delivered', async () => {
    const pool = fakePool([row(netCashTicker)]);
    await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false, forceAlert: true });
    const prior = pool.queries.find(q => /FROM valuation_dislocation_alerts/.test(q.sql) && /ORDER BY sent_at DESC/.test(q.sql) && /trigger_reason/.test(q.sql));
    expect(prior).toBeTruthy();
    expect(prior.sql).toContain("notification_status = 'SENT'");
  });

  it('a failed Telegram send is not counted as dispatched and is reported, so the day is not marked done', async () => {
    sendTelegramMessage.mockRejectedValueOnce(new Error('telegram down'));
    const pool = fakePool([row(netCashTicker)]);
    const res = await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false, forceAlert: true });
    expect(res.alertsDispatched).toBe(0);
    expect(res.alertsFailed).toBe(1);
    expect(res.failedTickers).toEqual([netCashTicker]);
    expect(pool.writes.some(w => /INSERT INTO valuation_dislocation_alerts/.test(w.sql) && w.params.includes('FAILED'))).toBe(true);
  });

  it('if recording the alert fails after it was sent, the run still completes (no crash that would resend every cycle)', async () => {
    const pool = fakePool([row(netCashTicker)], { failInsert: true });
    const res = await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false, forceAlert: true });
    expect(res.alertsDispatched).toBe(1);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it('does not alert on an unverified-cash stock even with cheap, fresh data', async () => {
    // HBLENGINE has growth and forward iROIC on file but no verified CFO/PAT or net cash.
    const pool = fakePool([row('HBLENGINE')]);
    const res = await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: false, forceAlert: true });
    expect(res.evaluatedCount).toBe(1);
    expect(res.alertsDispatched).toBe(0);
  });
});
