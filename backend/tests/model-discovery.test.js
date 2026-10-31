import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import {
  parseModelList,
  isChatCandidate,
  rankCandidates,
  selectCandidates,
  probeModel,
  discoverProvider,
  refreshModelRegistry,
  needsRefresh,
  REGISTRY_TTL_MS,
  REGISTRY_KEY
} from '../services/model-discovery.service.js';
import { buildProviders } from '../services/llm-failover.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const lists = JSON.parse(fs.readFileSync(path.resolve(here, 'fixtures/provider-model-lists.json'), 'utf8'));
const groqBody = { data: lists.groq };
const geminiBody = { data: lists.gemini.map((id) => ({ id })) };
const nimBody = { data: lists.nim.map((id) => ({ id })) };

const ok = (json) => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => json });
const fail = (status) => ({ ok: false, status, statusText: 'err', headers: { get: () => null }, json: async () => ({}) });
const chatOk = () => ok({ choices: [{ message: { content: '{"ok":true}' } }] });

/** Fake provider network: serves the /models lists and answers chat calls; `dead` models answer 404 like retired ones do. */
function makeFetch({ dead = [], listFails = [], rejectExtra = [] } = {}) {
  const calls = { list: [], chat: [] };
  const impl = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (!init.method || init.method === 'GET') {
      calls.list.push(u);
      const kind = u.includes('groq') ? 'groq' : u.includes('generativelanguage') ? 'gemini' : 'nim';
      if (listFails.includes(kind)) return fail(500);
      return ok(kind === 'groq' ? groqBody : kind === 'gemini' ? geminiBody : nimBody);
    }
    const body = JSON.parse(init.body);
    calls.chat.push(body);
    if (dead.includes(body.model)) return fail(404);
    if (rejectExtra.includes(body.model) && body.reasoning_effort) return fail(400);
    return chatOk();
  });
  impl.calls = calls;
  return impl;
}

const memoryStore = (initial = {}) => {
  const data = { ...initial };
  const setCalls = [];
  return { data, setCalls, get: async (k) => data[k] ?? null, set: async (k, v) => { setCalls.push(JSON.parse(JSON.stringify(v))); data[k] = v; } };
};

describe('parsing the real, noisy /models responses', () => {
  it('Gemini: strips the "models/" prefix the endpoint adds', () => {
    const ids = parseModelList('gemini', geminiBody).map((m) => m.id);
    expect(ids).toContain('gemini-3.1-flash-lite');
    expect(ids.every((id) => !id.startsWith('models/'))).toBe(true);
  });

  it('Groq: drops models the provider marks inactive', () => {
    const ids = parseModelList('groq', groqBody).map((m) => m.id);
    expect(ids).not.toContain('some/retired-chat-70b');
    expect(ids).toContain('openai/gpt-oss-120b');
  });

  it('survives a malformed or empty body', () => {
    expect(parseModelList('groq', null)).toEqual([]);
    expect(parseModelList('nim', {})).toEqual([]);
    expect(parseModelList('gemini', { data: 'nope' })).toEqual([]);
  });
});

describe('only text-chat models are candidates', () => {
  it.each([
    ['groq', 'whisper-large-v3'], ['groq', 'canopylabs/orpheus-v1-english'], ['groq', 'meta-llama/llama-prompt-guard-2-86m'],
    ['groq', 'openai/gpt-oss-safeguard-20b'],
    ['gemini', 'gemini-2.5-flash-preview-tts'], ['gemini', 'gemini-3.1-flash-image'], ['gemini', 'gemini-embedding-001'],
    ['gemini', 'gemini-3.8-live'], ['gemini', 'gemini-3.5-transcribe'], ['gemini', 'gemini-3.1-pro-preview'], ['gemini', 'gemma-4-31b-it'],
    ['gemini', 'gemini-4-argon'], ['gemini', 'lyria-3.5'], ['gemini', 'aqa'],
    ['nim', 'nvidia/embed-qa-4'], ['nim', 'nvidia/llama-3.1-nemoguard-8b-content-safety'], ['nim', 'meta/llama-3.2-11b-vision-instruct'],
    ['nim', 'google/deplot'], ['nim', 'bigcode/starcoder2-15b'], ['nim', 'nvidia/nemotron-4-340b-reward'], ['nim', 'nvidia/riva-translate-4b-instruct'],
    ['nim', 'nvidia/nemotron-parse'], ['nim', 'nvidia/nemotron-3.5-super-vl-120b-a12b'],
    ['nim', 'nvidia/nemotron-3.5-bolt-e4b'],      // 4B "effective" parameters: too small for financial JSON (live run ranked it first)
    ['nim', 'google/gemma-3-4b-it']
  ])('%s: %s is not a candidate', (kind, id) => {
    expect(isChatCandidate(kind, id)).toBe(false);
  });

  it.each([
    ['groq', 'openai/gpt-oss-120b'], ['groq', 'qwen/qwen3.8-27b'], ['groq', 'openai/gpt-oss-20b'],
    ['gemini', 'gemini-3.1-flash-lite'], ['gemini', 'gemini-3.8-flash'], ['gemini', 'gemini-flash-lite-latest'], ['gemini', 'gemini-3-flash-preview'],
    ['nim', 'openai/gpt-oss-20b'], ['nim', 'nvidia/nemotron-3.5-lightning-30b-a3b'], ['nim', 'z-ai/glm-5.3-flash']
  ])('%s: %s is a candidate', (kind, id) => {
    expect(isChatCandidate(kind, id)).toBe(true);
  });
});

describe('ranking prefers fast, current models and picks up newer ones without a code change', () => {
  it('Groq: largest capable model first, tiny models never', () => {
    const order = selectCandidates('groq', groqBody, { limit: 10 });
    expect(order).toEqual(['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']);
  });

  it('Gemini: lite models first, newest version first, and models released after this code was written rank by version', () => {
    const order = selectCandidates('gemini', geminiBody, { limit: 20 });
    const lites = order.filter((id) => /lite/.test(id) && !/latest/.test(id));
    expect(order.slice(0, lites.length)).toEqual(lites);                       // all lite models come before any non-lite
    expect(order.indexOf('gemini-3.5-flash-lite')).toBeLessThan(order.indexOf('gemini-3.1-flash-lite'));
    expect(order.indexOf('gemini-3.8-flash')).toBeLessThan(order.indexOf('gemini-3.7-flash'));
    expect(order.indexOf('gemini-3.7-flash')).toBeLessThan(order.indexOf('gemini-3.6-flash'));
    expect(order.indexOf('gemini-3.6-flash')).toBeLessThan(order.indexOf('gemini-3.5-flash'));
    expect(order.indexOf('gemini-3.1-flash-lite')).toBeLessThan(order.indexOf('gemini-3.1-flash-lite-preview'));  // GA before preview
  });

  it('a model the code has never heard of is still found and ranked by its version', () => {
    const body = { data: [{ id: 'models/gemini-9.9-flash-lite' }, { id: 'models/gemini-3.1-flash-lite' }] };
    expect(selectCandidates('gemini', body, { limit: 5 })[0]).toBe('gemini-9.9-flash-lite');
  });

  it('NIM: noise removed, fast families before large ones', () => {
    const order = selectCandidates('nim', nimBody, { limit: 40 });
    expect(order).toContain('openai/gpt-oss-20b');
    expect(order).toContain('nvidia/nemotron-3.5-lightning-30b-a3b');
    expect(order.some((id) => /embed|guard|safety|vision|vl-|reward|parse|translate|code/.test(id))).toBe(false);
    expect(order.indexOf('nvidia/nemotron-3.5-lightning-30b-a3b')).toBeLessThan(order.indexOf('mistralai/mistral-large-4-1t-a52b'));
  });

  it('rankCandidates is stable for equal scores', () => {
    expect(rankCandidates('groq', ['openai/gpt-oss-20b', 'openai/gpt-oss-20b'])).toHaveLength(2);
  });
});

describe('probing a model with a real call (the list alone is not proof: it still lists retired models)', () => {
  const entry = { kind: 'gemini', key: 'k', model: 'gemini-3.1-flash-lite' };

  it('reports a working model with its latency and the request shape that worked', async () => {
    const r = await probeModel({ ...entry, fetchImpl: makeFetch() });
    expect(r.ok).toBe(true);
    expect(r.extra).toEqual({ reasoning_effort: 'low' });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('a retired model (404/410) is reported dead and never retried', async () => {
    const f = makeFetch({ dead: ['gemini-3.1-flash-lite'] });
    const r = await probeModel({ ...entry, fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(true);
    expect(f.calls.chat).toHaveLength(1);
  });

  it('if the model rejects the reasoning parameter (400), it is retried once without it and that shape is kept', async () => {
    const f = makeFetch({ rejectExtra: ['gemini-3.1-flash-lite'] });
    const r = await probeModel({ ...entry, fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.extra).toEqual({});
    expect(f.calls.chat).toHaveLength(2);
  });

  it('a model that answers but ignores the JSON-only instruction is not accepted (the pipeline parses JSON replies)', async () => {
    const chatty = vi.fn(async () => ok({ choices: [{ message: { content: 'Sure! Here is my answer: everything is fine.' } }] }));
    const r = await probeModel({ ...entry, fetchImpl: chatty, sleepImpl: async () => {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON/i);
  });

  it('a JSON reply wrapped in a code fence still counts (models often fence JSON)', async () => {
    const fenced = vi.fn(async () => ok({ choices: [{ message: { content: '```json\n{"ok": true}\n```' } }] }));
    expect((await probeModel({ ...entry, fetchImpl: fenced })).ok).toBe(true);
  });

  it('a hang is not retried (a retry doubled the probe time; live run: 54 s for one model)', async () => {
    const hang = vi.fn(async (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const r = await probeModel({ ...entry, fetchImpl: hang, timeoutMs: 20, sleepImpl: async () => {} });
    expect(r.ok).toBe(false);
    // one call per request shape (with and without the reasoning parameter is only tried after a 400), never a repeat
    expect(hang.mock.calls.length).toBe(1);
  });

  it('a transient server error (5xx) is retried once', async () => {
    let n = 0;
    const flaky = vi.fn(async () => (++n === 1 ? fail(503) : chatOk()));
    const r = await probeModel({ ...entry, fetchImpl: flaky, sleepImpl: async () => {} });
    expect(r.ok).toBe(true);
    expect(flaky.mock.calls.length).toBe(2);
  });

  it('a rate limit (429) counts as alive; a hang counts as not usable', async () => {
    const limited = vi.fn(async () => fail(429));
    expect((await probeModel({ ...entry, fetchImpl: limited })).ok).toBe(true);
    const hang = vi.fn(async (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const r = await probeModel({ ...entry, fetchImpl: hang, timeoutMs: 20 });
    expect(r.ok).toBe(false);
  });
});

describe('discovering a provider end to end', () => {
  it('keeps only candidates that actually answer, in ranked order', async () => {
    const f = makeFetch({ dead: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'] });
    const r = await discoverProvider({ kind: 'gemini', key: 'k', fetchImpl: f, maxCandidates: 6, maxKeep: 3 });
    const models = r.models.map((m) => m.model);
    expect(models).toHaveLength(3);
    expect(models).not.toContain('gemini-3.8-flash');
    expect(models).not.toContain('gemini-3.5-flash-lite');
    expect(r.listed).toBeGreaterThan(0);
  });

  it('drops a model that is too slow to be useful (it would hold up every call for its whole timeout)', async () => {
    const slowFetch = vi.fn(async (url, init = {}) => {
      if (!init.method || init.method === 'GET') return ok(geminiBody);
      const body = JSON.parse(init.body);
      if (body.model === 'gemini-3.5-flash-lite') await new Promise((r) => setTimeout(r, 80));
      return chatOk();
    });
    const r = await discoverProvider({ kind: 'gemini', key: 'k', fetchImpl: slowFetch, maxCandidates: 4, maxKeep: 4, slowMs: 40 });
    expect(r.models.map((m) => m.model)).not.toContain('gemini-3.5-flash-lite');
    expect(r.models.length).toBeGreaterThan(0);
  });

  it('reports a failed listing instead of throwing', async () => {
    const r = await discoverProvider({ kind: 'groq', key: 'k', fetchImpl: makeFetch({ listFails: ['groq'] }) });
    expect(r.models).toEqual([]);
    expect(r.error).toBeTruthy();
  });

  it('never sends the key anywhere except the Authorization header', async () => {
    const f = makeFetch();
    await discoverProvider({ kind: 'groq', key: 'SECRET-KEY-123', fetchImpl: f });
    for (const call of f.mock.calls) {
      expect(String(call[0])).not.toContain('SECRET-KEY-123');
      expect(String(call[1]?.body || '')).not.toContain('SECRET-KEY-123');
    }
  });
});

describe('the registry: cached in the database, refreshed when stale, never wiped by a bad refresh', () => {
  const keys = { groqKey: 'g', geminiKey: 'm', nvidiaKey: 'n' };
  const NOW = new Date('2026-10-31T10:00:00Z');

  it('stores discovered models per provider and stamps the time', async () => {
    const store = memoryStore();
    const reg = await refreshModelRegistry({ keys, fetchImpl: makeFetch(), store, now: NOW });
    expect(Object.keys(reg.providers).sort()).toEqual(['gemini', 'groq', 'nim']);
    expect(reg.fetchedAt).toBe(NOW.toISOString());
    expect(store.data[REGISTRY_KEY]).toBeTruthy();
    expect(reg.providers.groq[0].model).toBe('openai/gpt-oss-120b');
  });

  it('probes the providers in parallel (sequential discovery took 165 s live, longer than a scan run)', async () => {
    // Groq's list is held back until a Gemini probe has happened: a sequential implementation would wait forever.
    let release;
    const gate = new Promise((r) => { release = r; });
    const base = makeFetch();
    const f = vi.fn(async (url, init = {}) => {
      const isList = !init.method || init.method === 'GET';
      if (isList && String(url).includes('groq')) await gate;
      if (!isList && JSON.parse(init.body).model.startsWith('gemini')) release();
      return base(url, init);
    });
    const reg = await refreshModelRegistry({ keys, fetchImpl: f, store: memoryStore(), now: NOW });
    expect(Object.keys(reg.providers).sort()).toEqual(['gemini', 'groq', 'nim']);
  }, 5000);

  it('saves each provider as soon as it is finished, so a process killed mid-refresh keeps the progress', async () => {
    const store = memoryStore();
    await refreshModelRegistry({ keys, fetchImpl: makeFetch(), store, now: NOW });
    expect(store.setCalls.length).toBeGreaterThanOrEqual(3);
    const sizes = store.setCalls.map((c) => Object.keys(c.providers).length);
    expect(sizes[0]).toBeLessThan(3);                 // the first save already happened with only part of the work done
    expect(sizes[sizes.length - 1]).toBe(3);
  });

  it('only probes providers that have a key', async () => {
    const f = makeFetch();
    const reg = await refreshModelRegistry({ keys: { groqKey: 'g' }, fetchImpl: f, store: memoryStore(), now: NOW });
    expect(Object.keys(reg.providers)).toEqual(['groq']);
    expect(f.calls.list.every((u) => u.includes('groq'))).toBe(true);
  });

  it('a failed listing keeps the previous working list for that provider (a flaky /models call must not wipe the chain)', async () => {
    const store = memoryStore();
    const first = await refreshModelRegistry({ keys, fetchImpl: makeFetch(), store, now: NOW });
    const second = await refreshModelRegistry({ keys, fetchImpl: makeFetch({ listFails: ['gemini'] }), store, previous: first, now: new Date(NOW.getTime() + 7 * 3600e3) });
    expect(second.providers.gemini).toEqual(first.providers.gemini);
    expect(second.providers.groq.length).toBeGreaterThan(0);
  });

  it('if every probe of a provider fails, the previous list is kept rather than replaced by nothing', async () => {
    const store = memoryStore();
    const first = await refreshModelRegistry({ keys, fetchImpl: makeFetch(), store, now: NOW });
    const allGroqDead = first.providers.groq.map((m) => m.model).concat(['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b']);
    const second = await refreshModelRegistry({ keys, fetchImpl: makeFetch({ dead: allGroqDead }), store, previous: first, now: new Date(NOW.getTime() + 7 * 3600e3) });
    expect(second.providers.groq).toEqual(first.providers.groq);
  });

  it('a model that failed its probe with a transient server error keeps its place (a 503 must not shrink the chain), but a hang or a 404 does not', async () => {
    const store = memoryStore();
    const first = await refreshModelRegistry({ keys, fetchImpl: makeFetch(), store, now: NOW });
    const target = first.providers.gemini[0].model;
    const base = makeFetch();
    const flaky = (mode) => vi.fn(async (url, init = {}) => {
      if (init.method === 'POST' && JSON.parse(init.body).model === target) {
        if (mode === '503') return fail(503);
        if (mode === '404') return fail(404);
        if (mode === 'hang') return new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      }
      return base(url, init);
    });
    const later = new Date(NOW.getTime() + 7 * 3600e3);
    const run = (mode) => refreshModelRegistry({ keys, fetchImpl: flaky(mode), store: memoryStore(), previous: first, now: later, sleepImpl: async () => {}, probeTimeoutMs: 30 });

    expect((await run('503')).providers.gemini.map((m) => m.model)).toContain(target);
    expect((await run('404')).providers.gemini.map((m) => m.model)).not.toContain(target);
    expect((await run('hang')).providers.gemini.map((m) => m.model)).not.toContain(target);
  });

  it('a previously working model that is no longer listed at all is dropped', async () => {
    const first = { version: 1, fetchedAt: NOW.toISOString(), providers: { groq: [{ model: 'gone/model-70b', extra: {} }, { model: 'openai/gpt-oss-120b', extra: {} }] } };
    const reg = await refreshModelRegistry({ keys: { groqKey: 'g' }, fetchImpl: makeFetch({ dead: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'] }), store: memoryStore(), previous: first, now: NOW, sleepImpl: async () => {} });
    expect(reg.providers.groq.map((m) => m.model)).not.toContain('gone/model-70b');
  });

  it('a model that was listed and working before but is now dead drops out, replaced by what still works', async () => {
    const store = memoryStore();
    const first = await refreshModelRegistry({ keys, fetchImpl: makeFetch(), store, now: NOW });
    const second = await refreshModelRegistry({ keys, fetchImpl: makeFetch({ dead: ['openai/gpt-oss-120b'] }), store, previous: first, now: new Date(NOW.getTime() + 7 * 3600e3) });
    expect(second.providers.groq.map((m) => m.model)).not.toContain('openai/gpt-oss-120b');
    expect(second.providers.groq.length).toBeGreaterThan(0);
  });

  describe('when a refresh is due', () => {
    const reg = { fetchedAt: NOW.toISOString(), providers: { groq: [{ model: 'x' }] } };
    it('not while the cache is fresh', () => {
      expect(needsRefresh(reg, { now: new Date(NOW.getTime() + REGISTRY_TTL_MS - 1000) })).toBe(false);
    });
    it('when it is older than the TTL', () => {
      expect(needsRefresh(reg, { now: new Date(NOW.getTime() + REGISTRY_TTL_MS + 1000) })).toBe(true);
    });
    it('immediately when a model has died, even if the cache is fresh', () => {
      expect(needsRefresh(reg, { now: NOW, dirty: true })).toBe(true);
    });
    it('when there is no registry at all', () => {
      expect(needsRefresh(null, { now: NOW })).toBe(true);
    });
    it('but not again right after a failed attempt (cool-down), so a dead /models endpoint is not hammered every call', () => {
      expect(needsRefresh(null, { now: NOW, lastAttemptAt: NOW.getTime() - 60000 })).toBe(false);
      expect(needsRefresh(null, { now: NOW, lastAttemptAt: NOW.getTime() - 20 * 60000 })).toBe(true);
    });
  });
});

describe('no call site hard-codes a model name', () => {
  const callSites = [
    'backend/services/announcement.service.js',
    'backend/services/audio-transcript-analyzer.service.js',
    'backend/services/nim.service.js',
    'backend/services/filing-classifier.service.js',
    'backend/workers/quarterly-deepdive-worker.js',
    'backend/scripts/scan-announcements.js'
  ];
  for (const rel of callSites) {
    it(`${rel} contains no literal model id (only llm-failover.service.js holds the fallback seed list)`, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      expect(src).not.toMatch(/["'`](?:gemini-[\w.-]+|openai\/gpt-oss[\w.-]*|qwen\/[\w.-]+|meta\/llama[\w.-]*|nvidia\/nemotron[\w.-]*)["'`]/);
    });
  }
});

describe('the chain is built from the registry, with the measured seed list only as the fallback', () => {
  const keys = { nvidiaKey: 'n', groqKey: 'g', geminiKey: 'm' };
  const registry = {
    providers: {
      groq: [{ model: 'openai/gpt-oss-120b', extra: { reasoning_effort: 'low' } }, { model: 'brand-new/groq-model-70b', extra: {} }],
      gemini: [{ model: 'gemini-3.8-flash-lite', extra: { reasoning_effort: 'low' } }, { model: 'gemini-3.8-flash', extra: { reasoning_effort: 'low' } }, { model: 'gemini-3.7-flash', extra: { reasoning_effort: 'low' } }],
      nim: [{ model: 'z-ai/glm-5.3-flash', extra: {} }, { model: 'openai/gpt-oss-20b', extra: { reasoning_effort: 'low' } }]
    }
  };

  it('uses the discovered models, alternating Groq and Gemini, with NIM strictly last', () => {
    const chain = buildProviders({ ...keys, registry });
    expect(chain.map((p) => p.model)).toEqual([
      'openai/gpt-oss-120b', 'gemini-3.8-flash-lite', 'brand-new/groq-model-70b', 'gemini-3.8-flash', 'gemini-3.7-flash', 'z-ai/glm-5.3-flash', 'openai/gpt-oss-20b'
    ]);
    const firstNim = chain.findIndex((p) => p.url.includes('nvidia'));
    expect(chain.slice(firstNim).every((p) => p.url.includes('nvidia'))).toBe(true);
  });

  it('a model name that exists nowhere in the code still makes it into the chain', () => {
    expect(buildProviders({ ...keys, registry }).some((p) => p.model === 'brand-new/groq-model-70b')).toBe(true);
  });

  it('falls back to the seed chain when there is no registry or it has nothing for a provider', () => {
    const seedChain = buildProviders(keys);
    expect(seedChain.length).toBeGreaterThan(5);
    const partial = buildProviders({ ...keys, registry: { providers: { groq: registry.providers.groq } } });
    expect(partial.some((p) => p.url.includes('generativelanguage'))).toBe(true);   // Gemini fell back to the seed
    expect(partial.some((p) => p.model === 'brand-new/groq-model-70b')).toBe(true);
  });

  it('only providers with a key are in the chain', () => {
    const chain = buildProviders({ groqKey: 'g', registry });
    expect(chain.every((p) => p.url.includes('groq'))).toBe(true);
  });

  it('Groq entries keep the per-minute token guard so an oversized prompt skips Groq instead of being refused', () => {
    const groqEntries = buildProviders({ ...keys, registry }).filter((p) => p.url.includes('groq'));
    expect(groqEntries.every((p) => p.maxInputTokens > 0)).toBe(true);
  });
});
