import { describe, it, expect, vi, beforeEach } from 'vitest';

const queries = vi.hoisted(() => ({ calls: [], results: [] }));

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(async (sql, params) => {
      queries.calls.push({ sql: String(sql), params });
      return queries.results.length ? queries.results.shift() : { rows: [] };
    })
  }
}));

import {
  BACKOFF_MINUTES,
  OUTAGE_DEGRADE_AFTER_MS,
  OUTAGE_GIVE_UP_AFTER_MS,
  CLASSIFICATION_ALERT_AFTER_FAILURES,
  buildClassificationStuckMessage,
  quotaPauseMs,
  isQuotaPaused,
  batchSizeAfterPause,
  backoffDelayMs,
  decideLlmFailureAction
} from '../services/retry-policy.service.js';
import { isAnnouncementProcessed, recordClassificationFailure } from '../services/announcement.service.js';
import { resetLlmState, runLlmPrompt } from '../services/llm-failover.service.js';

const MIN = 60 * 1000;

describe('backoff schedule', () => {
  it('grows with each failure and then holds at the last step', () => {
    expect(BACKOFF_MINUTES).toEqual([5, 10, 20, 30, 60]);
    expect([1, 2, 3, 4, 5, 6, 12].map(backoffDelayMs)).toEqual([5, 10, 20, 30, 60, 60, 60].map((m) => m * MIN));
  });
  it('treats a missing or invalid failure count as the first failure', () => {
    for (const n of [0, -3, NaN, undefined, null]) expect(backoffDelayMs(n)).toBe(5 * MIN);
  });
});

describe('LLM failure policy: an AI outage is not the filing’s fault', () => {
  const base = { nowMs: 1_000_000_000_000, maxAttempts: 3, hasVerifiedNumbers: true };

  it('during an outage it retries later and does NOT consume an attempt', () => {
    const d = decideLlmFailureAction({ ...base, chainDown: true, outageFirstAtMs: base.nowMs, outageRetries: 1 });
    expect(d).toEqual({ action: 'RETRY', countAttempt: false, delayMs: 5 * MIN });
  });

  it('a long outage never exhausts attempts: 40 consecutive outage retries still do not escalate before the give-up time', () => {
    for (let retries = 1; retries <= 40; retries++) {
      const d = decideLlmFailureAction({ ...base, hasVerifiedNumbers: false, chainDown: true, outageFirstAtMs: base.nowMs - 2 * 60 * MIN, outageRetries: retries });
      expect(d.action).toBe('RETRY');
      expect(d.countAttempt).toBe(false);
    }
  });

  it('backs off during a continuing outage', () => {
    const delays = [1, 2, 3, 4, 5, 6].map((r) => decideLlmFailureAction({ ...base, hasVerifiedNumbers: false, chainDown: true, outageFirstAtMs: base.nowMs, outageRetries: r }).delayMs);
    expect(delays).toEqual([5, 10, 20, 30, 60, 60].map((m) => m * MIN));
  });

  it('after the grace period, verified numbers are delivered without the AI narrative', () => {
    const d = decideLlmFailureAction({ ...base, chainDown: true, outageFirstAtMs: base.nowMs - OUTAGE_DEGRADE_AFTER_MS - 1, outageRetries: 6 });
    expect(d.action).toBe('DEGRADE');
  });

  it('without verified numbers it keeps waiting past the grace period', () => {
    const d = decideLlmFailureAction({ ...base, hasVerifiedNumbers: false, chainDown: true, outageFirstAtMs: base.nowMs - OUTAGE_DEGRADE_AFTER_MS - 1, outageRetries: 6 });
    expect(d.action).toBe('RETRY');
  });

  it('only after the give-up time does a filing with nothing to show escalate to a human', () => {
    const d = decideLlmFailureAction({ ...base, hasVerifiedNumbers: false, chainDown: true, outageFirstAtMs: base.nowMs - OUTAGE_GIVE_UP_AFTER_MS - 1, outageRetries: 30 });
    expect(d.action).toBe('ESCALATE');
  });

  it('when the chain is healthy but this filing keeps failing, attempts count and back off, then degrade or escalate', () => {
    const f = (attempts, hasVerifiedNumbers = true) => decideLlmFailureAction({ ...base, hasVerifiedNumbers, chainDown: false, attempts });
    expect(f(1)).toEqual({ action: 'RETRY', countAttempt: true, delayMs: 5 * MIN });
    expect(f(2)).toEqual({ action: 'RETRY', countAttempt: true, delayMs: 10 * MIN });
    expect(f(3).action).toBe('DEGRADE');
    expect(f(3, false).action).toBe('ESCALATE');
  });
});

describe('quota pauses: when the free tiers are rate-limited, stop hammering and resume one filing at a time', () => {
  it('escalates 10, 30, 60, 120 then 180 minutes and holds', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => quotaPauseMs(n))).toEqual([10, 30, 60, 120, 180, 180, 180].map((m) => m * MIN));
  });
  it('never pauses for less than the provider itself asked for', () => {
    expect(quotaPauseMs(1, 25 * MIN)).toBe(25 * MIN);
    expect(quotaPauseMs(4, 30 * MIN)).toBe(120 * MIN);
    expect(quotaPauseMs(1, NaN)).toBe(10 * MIN);
    expect(quotaPauseMs(0)).toBe(10 * MIN);
  });
  it('a pause that is still running keeps the queue idle; an expired one does not', () => {
    expect(isQuotaPaused({ until: 2000, count: 1 }, 1000)).toBe(true);
    expect(isQuotaPaused({ until: 2000, count: 1 }, 3000)).toBe(false);
    expect(isQuotaPaused(null, 1000)).toBe(false);
  });
  it('after a pause the queue works one filing at a time until a success clears it', () => {
    expect(batchSizeAfterPause({ until: 1, count: 2 }, 4)).toBe(1);
    expect(batchSizeAfterPause({ until: 0, count: 0 }, 4)).toBe(4);
    expect(batchSizeAfterPause(null, 4)).toBe(4);
  });
});

describe('a rate-limited chain is told apart from a broken one, on the error of that call', () => {
  beforeEach(() => resetLlmState());
  const providers = [
    { name: 'a', kind: 'openai', url: 'https://example.invalid/a', key: 'k', model: 'm1', timeoutMs: 1000 },
    { name: 'b', kind: 'openai', url: 'https://example.invalid/b', key: 'k', model: 'm2', timeoutMs: 1000 }
  ];
  const resp = (status, retryAfter) => ({ ok: false, status, statusText: 'err', headers: { get: (h) => (h === 'retry-after' && retryAfter ? String(retryAfter) : null) }, json: async () => ({}) });

  it('every provider answering 429 is rateLimited, with the shortest wait the providers advertised', async () => {
    const f = vi.fn(async (url) => (String(url).endsWith('/a') ? resp(429, 600) : resp(429, 1800)));
    const err = await runLlmPrompt('s', 'u', { providers, fetchImpl: f }).catch((e) => e);
    expect(err.chainExhausted).toBe(true);
    expect(err.rateLimited).toBe(true);
    expect(err.retryAfterMs).toBe(600 * 1000);
  });

  it('a 429 mixed with a timeout is still quota pressure; a retired model or revoked key makes it a different problem', async () => {
    const timeout = vi.fn(async (url, init) => (String(url).endsWith('/a') ? resp(429, 600) : new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))));
    const withTimeout = await runLlmPrompt('s', 'u', { providers: providers.map((p) => ({ ...p, timeoutMs: 20 })), fetchImpl: timeout }).catch((e) => e);
    expect(withTimeout.rateLimited).toBe(true);
    resetLlmState();
    const gone = vi.fn(async (url) => (String(url).endsWith('/a') ? resp(429, 600) : resp(404)));
    expect((await runLlmPrompt('s', 'u', { providers, fetchImpl: gone }).catch((e) => e)).rateLimited).toBe(false);
  });

  it('plain server errors are not quota pressure', async () => {
    const down = vi.fn(async () => resp(503));
    expect((await runLlmPrompt('s', 'u', { providers, fetchImpl: down }).catch((e) => e)).rateLimited).toBe(false);
  });
});

describe('scanner: failed classifications back off instead of retrying every cycle', () => {
  beforeEach(() => { queries.calls = []; queries.results = []; });

  it('skips a failed row while its next retry time is in the future, and retries once it has passed', async () => {
    await isAnnouncementProcessed('ABC', 'src-1', 'hash-1');
    const sql = queries.calls[0].sql;
    expect(sql).toContain("status != 'failed'");
    expect(sql).toContain("scan_next_retry_at");
    expect(sql).toMatch(/status = 'failed'[\s\S]*scan_next_retry_at[\s\S]*> NOW\(\)/);
  });

  it('records each failure, schedules the next retry with growing delay, and reports the count', async () => {
    queries.results = [{ rows: [{ failures: 3 }] }, { rows: [] }];
    const before = Date.now();
    const r = await recordClassificationFailure('ABC', 'src-1', 'hash-1');
    expect(r.failures).toBe(3);
    expect(queries.calls).toHaveLength(2);
    expect(queries.calls[0].sql).toContain('scan_failures');
    expect(queries.calls[1].sql).toContain('scan_next_retry_at');
    const scheduled = new Date(queries.calls[1].params[0]).getTime();
    expect(scheduled - before).toBeGreaterThanOrEqual(20 * MIN - 2000);
    expect(scheduled - before).toBeLessThanOrEqual(20 * MIN + 2000);
    expect(r.nextRetryAt.getTime()).toBe(scheduled);
  });

  it('tells the user once, at a fixed failure count, that a filing cannot be classified', () => {
    expect(CLASSIFICATION_ALERT_AFTER_FAILURES).toBeGreaterThanOrEqual(3);
    expect(CLASSIFICATION_ALERT_AFTER_FAILURES).toBeLessThanOrEqual(10);
    const msg = buildClassificationStuckMessage({ ticker: 'abc', title: 'Outcome of *Board* Meeting [x]', failures: 6, docUrl: 'https://example.com/f.pdf' });
    expect(msg).toContain('ABC');
    expect(msg).toContain('6 attempts');
    expect(msg).toContain('https://example.com/f.pdf');
    expect(msg).not.toMatch(/[*`[\]]/);   // plain text: markdown characters in a title must not break Telegram parsing
  });
});

describe('an exhausted LLM chain is reported on the error of THAT call (not via shared global state)', () => {
  beforeEach(() => resetLlmState());

  const providers = [{ name: 'p1', kind: 'openai', url: 'https://example.invalid/v1/chat/completions', key: 'k', model: 'm', timeoutMs: 1000 }];
  const failing = () => vi.fn(async () => { throw new TypeError('fetch failed'); });
  const ok = () => vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) }));

  it('marks the error when every provider failed, and keeps the original message', async () => {
    const err = await runLlmPrompt('s', 'u', { providers, fetchImpl: failing() }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.chainExhausted).toBe(true);
    expect(err.message).toMatch(/fetch failed/);
  });

  it('a success elsewhere (e.g. a short prompt answered by another provider) cannot hide the failure of a long prompt', async () => {
    const err = await runLlmPrompt('s', 'u', { providers, fetchImpl: failing() }).catch((e) => e);
    await runLlmPrompt('s', 'u', { providers, fetchImpl: ok() });
    expect(err.chainExhausted).toBe(true);
  });

  it('errors that are not exhaustion carry no such mark', () => {
    expect(new SyntaxError('bad json').chainExhausted).toBeUndefined();
  });
});
