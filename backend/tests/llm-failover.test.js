/**
 * LLM provider failover: Groq / Gemini / NVIDIA NIM chain (alternating, so one outage never removes two adjacent
 * attempts), Retry-After honoured, a circuit breaker for retired/overloaded providers, a hard per-call time budget,
 * and a process-wide cap on concurrent calls (free tiers throttle bursts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLlmPrompt, buildProviders, getLlmStats, resetLlmState } from '../services/llm-failover.service.js';

const ok = (content) => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers(), json: async () => ({ choices: [{ message: { content } }] }) });
const http = (status, headers = {}) => ({ ok: false, status, statusText: 'err', headers: new Headers(headers), json: async () => ({}) });
const isNim = (url) => String(url).includes('integrate.api.nvidia.com');
const isGroq = (url) => String(url).includes('api.groq.com');
const isGemini = (url) => String(url).includes('generativelanguage.googleapis.com');
const bodyOf = (init) => JSON.parse(init.body);
const ALL_KEYS = { nvidiaKey: 'nv-key', groqKey: 'gq-key', geminiKey: 'gm-key' };
const run = (fetchImpl, extra = {}, keys = ALL_KEYS) => runLlmPrompt('sys', 'user', {
  providers: buildProviders(keys),
  fetchImpl, sleepImpl: async () => {}, ...extra
});

beforeEach(() => resetLlmState());

describe('buildProviders', () => {
  it('starts with the fast Groq model, then Gemini, alternating providers', () => {
    const names = buildProviders(ALL_KEYS).map(p => p.name);
    expect(names.slice(0, 4)).toEqual(['groq-gpt-oss-120b', 'gemini-3.1-flash-lite', 'groq-qwen3.8-27b', 'gemini-3-flash-preview']);
  });
  it('keeps NVIDIA NIM (the least reliable free tier) as the last resort, with short timeouts', () => {
    const plan = buildProviders(ALL_KEYS);
    const nimIdx = plan.map((p, i) => (isNim(p.url) ? i : -1)).filter(i => i >= 0);
    expect(nimIdx).toEqual([plan.length - 2, plan.length - 1]);
    expect(plan.filter(p => isNim(p.url)).every(p => p.timeoutMs <= 30000)).toBe(true);
  });
  it('never contains a model NVIDIA retired (llama-3.2 answers 404 / hangs, llama-3.3 answers 410)', () => {
    const models = buildProviders(ALL_KEYS).map(p => p.model).join(' ');
    expect(models).not.toMatch(/llama-3\.[123]/);
  });
  it('gives every attempt a unique name (the circuit breaker is keyed by it)', () => {
    const names = buildProviders(ALL_KEYS).map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it('works with a single provider key', () => {
    expect(buildProviders({ groqKey: 'b' }).every(p => isGroq(p.url))).toBe(true);
    expect(buildProviders({ geminiKey: 'g' }).every(p => isGemini(p.url))).toBe(true);
    expect(buildProviders({ nvidiaKey: 'a' }).every(p => isNim(p.url))).toBe(true);
    expect(buildProviders({ nvidiaKey: 'a' }).length).toBeGreaterThanOrEqual(2);
  });
  it('is empty when no provider is configured', () => {
    expect(buildProviders({ nvidiaKey: '', groqKey: '', geminiKey: '' })).toEqual([]);
    expect(buildProviders()).toEqual([]);
  });
});

describe('runLlmPrompt', () => {
  it('uses only the first provider when it answers', async () => {
    const f = vi.fn(async () => ok('{"a":1}'));
    expect(await run(f)).toBe('{"a":1}');
    expect(f).toHaveBeenCalledTimes(1);
    expect(isGroq(f.mock.calls[0][0])).toBe(true);
    expect(bodyOf(f.mock.calls[0][1]).model).toBe('openai/gpt-oss-120b');
    expect(bodyOf(f.mock.calls[0][1]).reasoning_effort).toBe('low');
  });

  it('never requests response_format JSON mode (it made NIM 3.5x slower)', async () => {
    const f = vi.fn(async () => ok('x'));
    await run(f);
    expect(bodyOf(f.mock.calls[0][1]).response_format).toBeUndefined();
  });

  it('falls over Groq -> Gemini with the right model and key, and never mixes keys', async () => {
    const f = vi.fn(async (url) => { if (isGroq(url)) throw new TypeError('fetch failed'); return ok('from gemini'); });
    expect(await run(f)).toBe('from gemini');
    const gemCall = f.mock.calls.find(c => isGemini(c[0]));
    expect(bodyOf(gemCall[1]).model).toBe('gemini-3.1-flash-lite');
    expect(gemCall[1].headers.Authorization).toBe('Bearer gm-key');
    const groqCall = f.mock.calls.find(c => isGroq(c[0]));
    expect(groqCall[1].headers.Authorization).toBe('Bearer gq-key');
  });

  it('reaches NVIDIA NIM when Groq and Gemini are both down', async () => {
    const f = vi.fn(async (url) => { if (isNim(url)) return ok('from nim'); throw new TypeError('fetch failed'); });
    expect(await run(f)).toBe('from nim');
    const nimCall = f.mock.calls.find(c => isNim(c[0]));
    expect(bodyOf(nimCall[1]).model).toBe('openai/gpt-oss-20b');
    expect(nimCall[1].headers.Authorization).toBe('Bearer nv-key');
  });

  it('does not send an oversized prompt to Groq (its free tier answers 413 above 8,000 tokens/min): Gemini gets it directly', async () => {
    const f = vi.fn(async (url) => (isGroq(url) ? http(413) : ok('gemini handled the big one')));
    const big = 'x'.repeat(40000); // ~12.5k tokens at the pessimistic estimate
    const out = await runLlmPrompt('sys', big, { providers: buildProviders(ALL_KEYS), fetchImpl: f, sleepImpl: async () => {} });
    expect(out).toBe('gemini handled the big one');
    expect(f.mock.calls.some(c => isGroq(c[0]))).toBe(false);
  });

  it('a 413 never trips the breaker: the next, smaller prompt still goes to Groq', async () => {
    let refuse = true;
    const f = vi.fn(async (url) => (isGroq(url) && refuse ? http(413) : ok('fine')));
    await run(f); await run(f); await run(f);   // three refusals in a row
    refuse = false;
    f.mockClear();
    await run(f);
    expect(isGroq(f.mock.calls[0][0])).toBe(true);
    expect(getLlmStats().providers['groq-gpt-oss-120b'].permanent).toBe(false);
  });

  it('honours a short Retry-After, then retries the same provider and succeeds', async () => {
    const sleep = vi.fn(async () => {});
    let groqCalls = 0;
    const f = vi.fn(async (url) => {
      if (!isGroq(url)) throw new TypeError('fetch failed');
      groqCalls += 1;
      return groqCalls === 1 ? http(429, { 'retry-after': '2' }) : ok('after wait');
    });
    expect(await run(f, { sleepImpl: sleep })).toBe('after wait');
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(groqCalls).toBe(2);
  });

  it('reads Google\'s retryDelay from a 429 body (no Retry-After header) and waits that long once', async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const f = vi.fn(async (url) => {
      if (!isGemini(url)) throw new TypeError('fetch failed');
      n += 1;
      if (n === 1) return { ok: false, status: 429, statusText: 'x', headers: new Headers(), json: async () => ({ error: { details: [{ retryDelay: '7s' }] } }) };
      return ok('after google wait');
    });
    expect(await run(f, { sleepImpl: sleep })).toBe('after google wait');
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('has several Gemini models: each has its own free-tier quota bucket', () => {
    expect(buildProviders(ALL_KEYS).filter(p => isGemini(p.url)).length).toBeGreaterThanOrEqual(3);
  });

  it('does not wait out a long Retry-After; it moves on to the next provider instead', async () => {
    const sleep = vi.fn(async () => {});
    const f = vi.fn(async (url) => (isGroq(url) ? http(429, { 'retry-after': '60' }) : ok('gemini took over')));
    expect(await run(f, { sleepImpl: sleep })).toBe('gemini took over');
    expect(sleep).not.toHaveBeenCalledWith(60000);
  });

  it('treats an empty reply as a failure and tries the next provider', async () => {
    const f = vi.fn(async (url) => (isGroq(url) ? ok('   ') : ok('real answer')));
    expect(await run(f)).toBe('real answer');
  });

  it('throws when every attempt fails, without leaking any key in the message', async () => {
    const f = vi.fn(async () => http(500));
    const err = await run(f).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/500/);
    expect(err.message).not.toMatch(/nv-key|gq-key|gm-key/);
  });

  it('throws a clear error when no provider is configured', async () => {
    await expect(runLlmPrompt('s', 'u', { providers: [], fetchImpl: vi.fn() })).rejects.toThrow(/No LLM provider configured/);
  });

  it('stops attempting once the per-call time budget is spent', async () => {
    let clock = 0;
    const f = vi.fn(async () => { clock += 60000; throw new TypeError('fetch failed'); });
    await run(f, { now: () => clock, maxTotalMs: 100000 }).catch(() => {});
    expect(f.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('caps concurrent calls process-wide (free tiers throttle bursts)', async () => {
    let inFlight = 0;
    let peak = 0;
    const f = vi.fn(async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 15));
      inFlight -= 1;
      return ok('x');
    });
    await Promise.all(Array.from({ length: 9 }, () => run(f)));
    expect(f).toHaveBeenCalledTimes(9);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('circuit breaker', () => {
  it('stops calling a retired model (404/410) or revoked key (401) on later calls, and flags it permanent', async () => {
    const f = vi.fn(async (url) => (isGroq(url) ? http(404) : ok('gemini')));
    await run(f);
    expect(f.mock.calls.filter(c => isGroq(c[0])).length).toBeGreaterThan(0);
    const groqCallsAfterFirst = f.mock.calls.filter(c => isGroq(c[0])).length;
    await run(f);
    await run(f);
    // Groq models that answered 404 are skipped from now on (only a model that had not been tried yet may be tried once).
    expect(f.mock.calls.filter(c => isGroq(c[0])).length).toBe(groqCallsAfterFirst);
    expect(getLlmStats().providers['groq-gpt-oss-120b']).toMatchObject({ permanent: true, lastStatus: 404 });
  });

  it('skips a provider that keeps timing out for a while instead of paying its timeout on every filing', async () => {
    let groqCalls = 0;
    const f = vi.fn(async (url) => { if (isGroq(url)) { groqCalls += 1; throw new TypeError('fetch failed'); } return ok('gemini'); });
    await run(f); await run(f); // two consecutive failures open the breaker for the first Groq model
    const before = groqCalls;
    expect(before).toBe(2);
    await run(f);
    expect(groqCalls).toBe(before); // breaker open: Groq is not touched, Gemini (next in the chain) answers straight away
  });

  it('one hang (timeout) is enough to start skipping that provider: a hang costs the full timeout on every call', async () => {
    let groqCalls = 0;
    const abort = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };
    const f = vi.fn(async (url) => { if (isGroq(url)) { groqCalls += 1; throw abort(); } return ok('gemini'); });
    await run(f);
    const after1 = groqCalls;
    await run(f);
    expect(groqCalls).toBe(after1);
  });

  it('still tries every provider once when all of them are cooling down (never gives up without trying)', async () => {
    const f = vi.fn(async () => http(404));
    await run(f).catch(() => {});
    const n = f.mock.calls.length;
    await run(f).catch(() => {});
    expect(f.mock.calls.length).toBe(n * 2);
  });

  it('forgets the breaker once the provider answers again', async () => {
    let groqUp = false;
    const f = vi.fn(async (url) => { if (isGroq(url) && !groqUp) throw new TypeError('x'); return ok('ok'); });
    await run(f);
    groqUp = true;
    resetLlmState();
    await run(f);
    expect(getLlmStats().providers['groq-gpt-oss-120b']).toMatchObject({ ok: 1, permanent: false });
  });
});

describe('stats (feed the health alert)', () => {
  it('counts calls, successes and fully failed calls', async () => {
    await run(vi.fn(async () => ok('x')));
    await run(vi.fn(async () => http(500))).catch(() => {});
    expect(getLlmStats()).toMatchObject({ calls: 2, succeeded: 1, failedCalls: 1 });
  });
  it('never puts a key into the stats', async () => {
    await run(vi.fn(async () => http(401))).catch(() => {});
    expect(JSON.stringify(getLlmStats())).not.toMatch(/nv-key|gq-key|gm-key/);
  });
});
