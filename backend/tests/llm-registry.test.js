import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/env.js', () => ({ NVIDIA_API_KEY: 'n-key', GROQ_API_KEY: 'g-key', GEMINI_API_KEY: 'm-key' }));

import {
  initModelRegistry,
  settleModelRegistry,
  markModelsDirty,
  getModelRegistry,
  resetModelRegistryForTests,
  getConfiguredProviders,
  getGeminiModelNames,
  runLlm
} from '../services/llm.service.js';
import { REGISTRY_KEY, REGISTRY_TTL_MS } from '../services/model-discovery.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const lists = JSON.parse(fs.readFileSync(path.resolve(here, 'fixtures/provider-model-lists.json'), 'utf8'));
const bodies = {
  groq: { data: lists.groq },
  gemini: { data: lists.gemini.map((id) => ({ id })) },
  nim: { data: lists.nim.map((id) => ({ id })) }
};

const ok = (json) => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => json });
const fail = (status) => ({ ok: false, status, statusText: 'err', headers: { get: () => null }, json: async () => ({}) });

/** Network double: /models lists, chat answers, and a set of retired models that answer 404. */
function installFetch({ dead = new Set(), listFails = false } = {}) {
  const log = { list: 0, chat: [] };
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (!init.method || init.method === 'GET') {
      log.list += 1;
      if (listFails) return fail(500);
      return ok(bodies[u.includes('groq') ? 'groq' : u.includes('generativelanguage') ? 'gemini' : 'nim']);
    }
    const body = JSON.parse(init.body);
    log.chat.push(body.model);
    if (dead.has(body.model)) return fail(404);
    return ok({ choices: [{ message: { content: '{"ok":true}' } }] });
  }));
  return { log, dead };
}

const memoryStore = (initial = {}) => {
  const data = { ...initial };
  return { data, get: vi.fn(async (k) => data[k] ?? null), set: vi.fn(async (k, v) => { data[k] = v; }) };
};
const cachedRegistry = (fetchedAt, groqModel = 'cached/groq-model-70b') => ({
  version: 1,
  fetchedAt: fetchedAt.toISOString(),
  providers: { groq: [{ model: groqModel, extra: {} }], gemini: [{ model: 'gemini-3.7-flash', extra: { reasoning_effort: 'low' } }], nim: [{ model: 'openai/gpt-oss-20b', extra: {} }] }
});

describe('model registry in the running process', () => {
  beforeEach(() => resetModelRegistryForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('without a store it never calls a provider for discovery: the seed chain is used (tests, ad-hoc scripts)', async () => {
    const net = installFetch();
    await initModelRegistry({});
    await settleModelRegistry(1000);
    expect(net.log.list).toBe(0);
    expect(getConfiguredProviders().length).toBeGreaterThan(5);
  });

  it('a fresh cached registry is used immediately and nothing is re-probed (the scanner restarts every 5 minutes)', async () => {
    const net = installFetch();
    const store = memoryStore({ [REGISTRY_KEY]: cachedRegistry(new Date()) });
    await initModelRegistry({ store });
    await settleModelRegistry(1000);
    expect(net.log.list).toBe(0);
    expect(net.log.chat).toEqual([]);
    expect(getConfiguredProviders().map((p) => p.model)).toContain('cached/groq-model-70b');
  });

  it('a stale registry is still used right away, while a refresh runs in the background and replaces it', async () => {
    const net = installFetch();
    const store = memoryStore({ [REGISTRY_KEY]: cachedRegistry(new Date(Date.now() - REGISTRY_TTL_MS - 60000)) });
    await initModelRegistry({ store });
    expect(getConfiguredProviders().map((p) => p.model)).toContain('cached/groq-model-70b');   // usable before the refresh finishes
    await settleModelRegistry(20000);
    expect(net.log.list).toBeGreaterThan(0);
    const models = getConfiguredProviders().map((p) => p.model);
    expect(models).toContain('openai/gpt-oss-120b');
    expect(models).not.toContain('cached/groq-model-70b');
    expect(store.set).toHaveBeenCalledWith(REGISTRY_KEY, expect.objectContaining({ providers: expect.any(Object) }));
  });

  it('with no cached registry the seed chain serves calls while discovery runs, then the discovered models take over', async () => {
    installFetch();
    const store = memoryStore();
    await initModelRegistry({ store });
    expect(getModelRegistry()).toBeNull();
    expect(getConfiguredProviders().length).toBeGreaterThan(5);
    await settleModelRegistry(20000);
    expect(getModelRegistry()).not.toBeNull();
    expect(getModelRegistry().providers.groq[0].model).toBe('openai/gpt-oss-120b');
  });

  it('a retired model hit during a real call triggers an immediate re-discovery (no waiting for the 6-hour timer)', async () => {
    const dead = new Set(['cached/groq-model-70b']);
    const net = installFetch({ dead });
    const store = memoryStore({ [REGISTRY_KEY]: cachedRegistry(new Date()) });
    await initModelRegistry({ store });
    await settleModelRegistry(1000);
    expect(net.log.list).toBe(0);

    // First call: the cached Groq model answers 404, the chain fails over to the next provider and the call still succeeds.
    const reply = await runLlm('system', 'user');
    expect(reply).toContain('ok');
    expect(net.log.chat[0]).toBe('cached/groq-model-70b');

    await settleModelRegistry(20000);
    expect(net.log.list).toBeGreaterThan(0);                                   // re-discovery was triggered by the 404
    expect(getConfiguredProviders().map((p) => p.model)).not.toContain('cached/groq-model-70b');
  });

  it('re-discovery is rate-limited: a second dead model right after does not start another round', async () => {
    const net = installFetch({ dead: new Set(['cached/groq-model-70b']) });
    const store = memoryStore({ [REGISTRY_KEY]: cachedRegistry(new Date()) });
    await initModelRegistry({ store });
    markModelsDirty();
    await settleModelRegistry(20000);
    const afterFirst = net.log.list;
    expect(afterFirst).toBeGreaterThan(0);
    markModelsDirty();
    await settleModelRegistry(20000);
    expect(net.log.list).toBe(afterFirst);
  });

  it('the cool-down survives a process restart: a recent attempt recorded in the database prevents another round (the daemon restarts every 5 minutes)', async () => {
    const net = installFetch();
    const store = memoryStore({
      [REGISTRY_KEY]: cachedRegistry(new Date(Date.now() - REGISTRY_TTL_MS - 60000)),   // stale, so a refresh is due...
      llm_model_registry_attempt: Date.now() - 2 * 60000                                   // ...but one started 2 minutes ago and was killed
    });
    await initModelRegistry({ store });
    await settleModelRegistry(5000);
    expect(net.log.list).toBe(0);
  });

  it('records the start of every refresh attempt in the database', async () => {
    installFetch();
    const store = memoryStore();
    await initModelRegistry({ store });
    await settleModelRegistry(20000);
    expect(store.set).toHaveBeenCalledWith('llm_model_registry_attempt', expect.any(Number));
  });

  it('a failing /models endpoint leaves the cached chain untouched and never throws into the pipeline', async () => {
    installFetch({ listFails: true });
    const cached = cachedRegistry(new Date(Date.now() - REGISTRY_TTL_MS - 60000));
    const store = memoryStore({ [REGISTRY_KEY]: cached });
    await initModelRegistry({ store });
    await settleModelRegistry(20000);
    expect(getConfiguredProviders().map((p) => p.model)).toContain('cached/groq-model-70b');
  });

  it('OCR and audio (Gemini native API) use the discovered Gemini models, newest working first, with the seed models only as a tail', async () => {
    installFetch();
    const store = memoryStore({ [REGISTRY_KEY]: cachedRegistry(new Date()) });
    expect(getGeminiModelNames()[0]).toBe('gemini-3.1-flash-lite');   // no registry yet: the seed list leads
    await initModelRegistry({ store });
    const names = getGeminiModelNames();
    expect(names[0]).toBe('gemini-3.7-flash');                          // the discovered model leads
    expect(names).toContain('gemini-3.5-flash-lite');                   // seed models stay as a last-resort tail
    expect(new Set(names).size).toBe(names.length);                     // no duplicates
  });

  it('corrupted cache entries (no model name) never reach the chain', async () => {
    installFetch();
    const damaged = { version: 1, fetchedAt: new Date().toISOString(), providers: { groq: [{ model: '' }, { extra: {} }, null, { model: 'ok/groq-70b', extra: {} }], gemini: [{ model: 42 }], nim: 'not-a-list' } };
    await initModelRegistry({ store: memoryStore({ [REGISTRY_KEY]: damaged }) });
    const models = getConfiguredProviders().map((p) => p.model);
    expect(models).toContain('ok/groq-70b');
    expect(models.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
    // Gemini and NIM had nothing valid, so they fall back to the seed instead of being empty
    expect(getConfiguredProviders().some((p) => p.url.includes('generativelanguage'))).toBe(true);
  });

  it('a broken or unreadable cache is ignored (seed used) instead of crashing', async () => {
    installFetch();
    const store = { get: vi.fn(async () => { throw new Error('db down'); }), set: vi.fn(async () => {}) };
    await initModelRegistry({ store });
    expect(getConfiguredProviders().length).toBeGreaterThan(5);
  });
});
