/**
 * The AI health guard: a dead LLM chain used to be silent (every filing "failed", no Telegram message).
 * These tests pin when the user is told, that they are told once per cooldown, and that a failed send is retried.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateLlmHealth, evaluateCanary, runProviderCanary, alertForIssues, reportLlmHealth } from '../services/llm-health.service.js';
import { resetLlmState, runLlmPrompt, buildProviders } from '../services/llm-failover.service.js';

const stats = (over = {}) => ({ calls: 0, succeeded: 0, failedCalls: 0, providers: {}, ...over });
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const T0 = new Date('2026-10-31T06:00:00.000Z'); // 11:30 IST

beforeEach(() => resetLlmState());

describe('evaluateLlmHealth', () => {
  it('is quiet when calls succeed, even if a provider hit a normal rate limit', () => {
    const s = stats({ calls: 5, succeeded: 5, providers: { 'groq-gpt-oss-120b': { ok: 3, fail: 2, permanent: false, lastStatus: 429, lastError: 'groq HTTP 429' } } });
    expect(evaluateLlmHealth(s, 7)).toEqual([]);
  });
  it('is quiet when the pipeline made no LLM calls at all (nothing to analyse)', () => {
    expect(evaluateLlmHealth(stats(), 7)).toEqual([]);
  });
  it('raises a critical issue when every call failed, naming each provider error', () => {
    const s = stats({ calls: 3, succeeded: 0, failedCalls: 3, providers: { a: { ok: 0, fail: 3, permanent: false, lastStatus: 503, lastError: 'a HTTP 503' } } });
    const issues = evaluateLlmHealth(s, 7);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: 'llm:all-failed', severity: 'critical' });
    expect(issues[0].text).toMatch(/a HTTP 503/);
  });
  it('flags a retired model / revoked key even while a fallback is masking it', () => {
    const s = stats({ calls: 4, succeeded: 4, providers: { 'nim-x': { ok: 0, fail: 1, permanent: true, lastStatus: 404, lastError: 'nim-x HTTP 404' } } });
    const issues = evaluateLlmHealth(s, 7);
    expect(issues.map(i => i.id)).toEqual(['llm:dead:nim-x']);
    expect(issues[0].text).toMatch(/404/);
  });
  it('says plainly when no provider is configured', () => {
    expect(evaluateLlmHealth(stats(), 0)[0]).toMatchObject({ id: 'llm:no-provider', severity: 'critical' });
  });
});

describe('canary', () => {
  it('runs each provider on its own and reports the broken ones', async () => {
    const providers = buildProviders({ groqKey: 'g', geminiKey: 'm' });
    const callImpl = vi.fn(async (p) => { if (p.name.startsWith('gemini')) { const e = new Error('gemini HTTP 404'); e.status = 404; throw e; } return 'ok'; });
    const results = await runProviderCanary(providers, { callImpl });
    expect(callImpl).toHaveBeenCalledTimes(providers.length);
    const issues = evaluateCanary(results);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].text).toMatch(/gemini-3\.1-flash-lite: gemini HTTP 404/);
  });
  it('does not accuse a provider of one transient 503: it retries once and reports it healthy', async () => {
    const providers = buildProviders({ groqKey: 'g' }).slice(0, 1);
    let n = 0;
    const callImpl = vi.fn(async () => { n += 1; if (n === 1) { const e = new Error('503'); e.status = 503; throw e; } return 'ok'; });
    const results = await runProviderCanary(providers, { callImpl, sleepImpl: async () => {} });
    expect(callImpl).toHaveBeenCalledTimes(2);
    expect(results[0].ok).toBe(true);
    expect(evaluateCanary(results)).toEqual([]);
  });
  it('reports a provider that fails twice, and does not waste a retry on a retired model (404)', async () => {
    const providers = buildProviders({ groqKey: 'g' }).slice(0, 1);
    const flaky = vi.fn(async () => { const e = new Error('groq HTTP 503'); e.status = 503; throw e; });
    expect((await runProviderCanary(providers, { callImpl: flaky, sleepImpl: async () => {} }))[0].ok).toBe(false);
    expect(flaky).toHaveBeenCalledTimes(2);
    const gone = vi.fn(async () => { const e = new Error('groq HTTP 404'); e.status = 404; throw e; });
    expect((await runProviderCanary(providers, { callImpl: gone, sleepImpl: async () => {} }))[0].ok).toBe(false);
    expect(gone).toHaveBeenCalledTimes(1);
  });
  it('treats a 429 as alive (rate-limited is not down)', async () => {
    const providers = buildProviders({ groqKey: 'g' }).slice(0, 1);
    const callImpl = vi.fn(async () => { const e = new Error('groq HTTP 429'); e.status = 429; throw e; });
    const results = await runProviderCanary(providers, { callImpl, sleepImpl: async () => {} });
    expect(results[0]).toMatchObject({ ok: true, note: 'rate-limited (alive)' });
    expect(callImpl).toHaveBeenCalledTimes(1);
  });
  it('gives reasoning models a probe budget big enough to answer', async () => {
    const providers = buildProviders({ nvidiaKey: 'n' }).slice(0, 1);
    const callImpl = vi.fn(async () => 'ok');
    await runProviderCanary(providers, { callImpl, sleepImpl: async () => {} });
    expect(callImpl.mock.calls[0][0].maxTokens).toBeGreaterThanOrEqual(1000);
  });
  it('is critical when no provider is healthy and silent when all are', () => {
    expect(evaluateCanary([{ name: 'a', ok: false, error: 'x' }])[0].severity).toBe('critical');
    expect(evaluateCanary([{ name: 'a', ok: true, ms: 5 }])).toEqual([]);
  });
});

describe('alertForIssues', () => {
  const issue = { id: 'llm:all-failed', severity: 'critical', cooldownHours: 3, text: 'Every AI call failed' };
  it('sends once, records the cooldown, and stays quiet inside it', async () => {
    const store = memStore(); const send = vi.fn(async () => {});
    expect(await alertForIssues({ issues: [issue], store, send, now: T0 })).toHaveLength(1);
    expect(await alertForIssues({ issues: [issue], store, send, now: new Date(T0.getTime() + 2 * 3600000) })).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatch(/AI PIPELINE DOWN/);
  });
  it('re-alerts after the cooldown if the problem persists', async () => {
    const store = memStore(); const send = vi.fn(async () => {});
    await alertForIssues({ issues: [issue], store, send, now: T0 });
    await alertForIssues({ issues: [issue], store, send, now: new Date(T0.getTime() + 4 * 3600000) });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('does NOT start the cooldown when the Telegram send failed (it is retried next run)', async () => {
    const store = memStore();
    await expect(alertForIssues({ issues: [issue], store, send: async () => { throw new Error('telegram down'); }, now: T0 })).rejects.toThrow();
    const send = vi.fn(async () => {});
    expect(await alertForIssues({ issues: [issue], store, send, now: T0 })).toHaveLength(1);
  });
  it('strips Markdown control characters so provider error text cannot break the Telegram message', async () => {
    const send = vi.fn(async () => {});
    await alertForIssues({ issues: [{ ...issue, text: 'bad_provider *x* `y` [z]' }], store: memStore(), send, now: T0 });
    expect(send.mock.calls[0][0]).toContain('badprovider x y z');
  });
});

describe('reportLlmHealth', () => {
  it('alerts the user when a real run had every provider fail (end to end through the failover layer)', async () => {
    const providers = buildProviders({ groqKey: 'g', geminiKey: 'm' });
    await runLlmPrompt('s', 'u', { providers, fetchImpl: async () => ({ ok: false, status: 503, statusText: 'x', headers: new Headers() }), sleepImpl: async () => {} }).catch(() => {});
    const store = memStore({ llm_canary_date: '2026-10-31' }); const send = vi.fn(async () => {});
    await reportLlmHealth({ store, send, providers, now: T0, canary: vi.fn() });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatch(/Every AI call failed/);
  });
  it('runs the daily canary once per IST day, after 08:00, and alerts only when something is broken', async () => {
    const providers = buildProviders({ groqKey: 'g' });
    const store = memStore(); const send = vi.fn(async () => {});
    const canary = vi.fn(async () => [{ name: 'groq-gpt-oss-120b', ok: false, ms: 1, error: 'groq HTTP 401' }]);
    await reportLlmHealth({ store, send, providers, now: T0, canary });
    await reportLlmHealth({ store, send, providers, now: new Date(T0.getTime() + 300000), canary });
    expect(canary).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatch(/groq HTTP 401/);
  });
  it('a broken model found by the canary triggers a model re-discovery; a healthy canary does not', async () => {
    const providers = buildProviders({ groqKey: 'g' });
    const onBroken = vi.fn();
    await reportLlmHealth({ store: memStore(), send: vi.fn(async () => {}), providers, now: T0, canary: vi.fn(async () => [{ name: 'a', ok: false, ms: 1, error: 'HTTP 404' }]), onBroken });
    expect(onBroken).toHaveBeenCalledTimes(1);
    const onBroken2 = vi.fn();
    await reportLlmHealth({ store: memStore(), send: vi.fn(async () => {}), providers, now: T0, canary: vi.fn(async () => [{ name: 'a', ok: true, ms: 1 }]), onBroken: onBroken2 });
    expect(onBroken2).not.toHaveBeenCalled();
  });
  it('a retired-model alert says the list is re-discovered automatically (it no longer tells the owner to edit code)', () => {
    const issues = evaluateLlmHealth({ calls: 5, succeeded: 5, failedCalls: 0, providers: { 'groq-x': { ok: 0, fail: 2, permanent: true, lastStatus: 404, lastError: 'HTTP 404' } } }, 3);
    expect(issues[0].text).toMatch(/re-?discover/i);
    expect(issues[0].text).not.toMatch(/llm-failover\.service\.js/);
  });
  it('does not probe before 08:00 IST', async () => {
    const canary = vi.fn(async () => []);
    await reportLlmHealth({ store: memStore(), send: vi.fn(), providers: buildProviders({ groqKey: 'g' }), now: new Date('2026-10-31T01:00:00.000Z'), canary }); // 06:30 IST
    expect(canary).not.toHaveBeenCalled();
  });
  it('never throws, even when the store is broken (health reporting must not break the pipeline)', async () => {
    const broken = { get: async () => { throw new Error('db down'); }, set: async () => {} };
    await expect(reportLlmHealth({ store: broken, send: vi.fn(), providers: buildProviders({ groqKey: 'g' }), now: T0, canary: vi.fn() })).resolves.toBeUndefined();
  });
});
