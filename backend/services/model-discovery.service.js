/**
 * Dynamic model discovery for the LLM failover chain.
 *
 * Why: model names hard-coded in the chain are what silently killed the pipeline on 2026-10-31 (NVIDIA retired the
 * llama-3.2 models the scanner depended on; Gemini 2.5 was retired too) while newer, better models appeared. This module
 * asks each provider what it offers right now, and never trusts the list alone: the /models endpoints are noisy
 * (embeddings, speech, image, safety, vision) and still list retired models (NIM lists llama-3.2 although it answers 404).
 *
 *   list -> keep text-chat candidates -> rank (fast, current first) -> probe each with a real call -> keep what answers
 *
 * The result (the "registry") is cached in system_settings, because the scanner process restarts every 5 minutes and
 * must not re-probe on every start. It is refreshed every 6 hours, and immediately when a model dies at runtime.
 * A failed refresh never wipes a working list, and llm-failover.service.js falls back to its measured SEED list only if
 * no discovered list exists at all.
 *
 * Pure decisions + injected I/O (fetch, store, clock) so it is unit-tested without a network. Keys only travel in the
 * Authorization header and never appear in logs or error text.
 */
import { callProvider, makeProvider, providerListUrl, defaultExtra, PROVIDER_KINDS } from "./llm-failover.service.js";

export const REGISTRY_KEY = "llm_model_registry";
export const REGISTRY_TTL_MS = 6 * 60 * 60 * 1000;
/** After an attempt (even a failed one) wait this long before trying again: a dead /models endpoint is not hammered. */
export const ATTEMPT_COOLDOWN_MS = 15 * 60 * 1000;

const PROBE_PROMPT = 'Reply with exactly this JSON and nothing else: {"ok":true}';
const PERMANENT_STATUSES = new Set([401, 403, 404, 410]);
const LIST_TIMEOUT_MS = 15000;
/** A trivial probe that needs longer than this is unusable for a pipeline whose alerts are time-sensitive. */
const PROBE_TIMEOUT_MS = 15000;
/** A model that answers, but slower than this, is dropped: it would hold up every call for its whole timeout. */
const SLOW_PROBE_MS = 10000;
const PROBE_CONCURRENCY = 4;
const KEEP = { groq: 3, gemini: 4, nim: 3 };
const MIN_PARAMS_B = 15;

/** Names that are never text-chat models for this pipeline (speech, image, embedding, safety, vision, code, multimodal). */
const NOISE = /embed|whisper|tts|speech|audio|transcribe|orpheus|lyria|imagen|image|vision|vlm|vila|neva|kosmos|fuyu|deplot|clip|guard|safeguard|safety|reward|retriev|rerank|parse|translate|live|realtime|robotics|computer-use|antigravity|deep-research|aqa|omni|banana|code|coder|calibration|detector|cosmos|topic-control|diffusion|-vl-|ocr/i;
const GEMINI_FLASH = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(-preview)?$/i;
const GEMINI_ALIAS = /^gemini-flash(-lite)?-latest$/i;

/**
 * Largest "NNb" parameter count in a model id ("120b", "27b", and "e4b" = 4B effective); "a3b" (active params of a
 * mixture-of-experts) and "86m" are ignored.
 */
function paramsB(id) {
  const sizes = [...String(id).matchAll(/(?<![a-df-z0-9.])(\d+(?:\.\d+)?)b(?![a-z])/gi)].map((m) => parseFloat(m[1]));
  return sizes.length ? Math.max(...sizes) : null;
}

/**
 * Pulls `{id, ...}` entries out of a /models body. Gemini prefixes ids with "models/", which is stripped; Groq marks
 * retired models `active: false`, which are dropped. Malformed bodies yield [].
 */
export function parseModelList(kind, body) {
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return list
    .map((m) => (typeof m === "string" ? { id: m } : m))
    .filter((m) => m && typeof (m.id || m.name) === "string")
    .map((m) => ({ ...m, id: String(m.id || m.name).replace(/^models\//, "") }))
    .filter((m) => m.active !== false);
}

export function isChatCandidate(kind, id) {
  const name = String(id);
  if (NOISE.test(name)) return false;
  if (kind === "gemini") return GEMINI_FLASH.test(name) || GEMINI_ALIAS.test(name);
  const size = paramsB(name);
  if (size !== null && size < MIN_PARAMS_B) return false;
  return true;
}

function geminiRankKey(id) {
  const alias = GEMINI_ALIAS.exec(id);
  if (alias) return [alias[1] ? 2 : 3, 0, 0];                       // aliases last: their target drifts
  const m = GEMINI_FLASH.exec(id);
  const lite = Boolean(m[2]);
  return [lite ? 0 : 1, -parseFloat(m[1]), m[3] ? 1 : 0];           // lite first, newest first, GA before preview
}

function nimRankKey(id) {
  const fast = /lightning|flash|nano|bolt|mini|small|20b/i.test(id);
  return [fast ? 0 : 1, paramsB(id) ?? 25];                          // fast families first, smaller (faster) first
}

function compareKeys(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

/** Orders candidate ids best-first for the provider kind (fast, capable, current). Stable for equal scores. */
export function rankCandidates(kind, ids) {
  const key = kind === "gemini" ? geminiRankKey : kind === "nim" ? nimRankKey : (id) => [-(paramsB(id) ?? 0)];
  return ids.map((id, i) => ({ id, i, k: key(id) })).sort((a, b) => compareKeys(a.k, b.k) || a.i - b.i).map((x) => x.id);
}

export function selectCandidates(kind, body, { limit = 8 } = {}) {
  const ids = [...new Set(parseModelList(kind, body).map((m) => m.id))].filter((id) => isChatCandidate(kind, id));
  return rankCandidates(kind, ids).slice(0, limit);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls the model once for real. The list is not proof (retired models are still listed), so this is the test that counts.
 * A 400 with the reasoning parameter is retried once without it (the model may not support it) and that shape is kept.
 * 404/410/401/403 = gone, never retried; 429 = alive but limited; a 5xx or network error gets one retry; a hang is NOT
 * retried (it already cost the whole timeout, and a model that hangs on a trivial prompt is not usable anyway).
 */
export async function probeModel({ kind, key, model, fetchImpl = globalThis.fetch, callImpl = callProvider, timeoutMs = PROBE_TIMEOUT_MS, sleepImpl = defaultSleep }) {
  const shapes = [defaultExtra(kind, model)];
  if (Object.keys(shapes[0]).length > 0) shapes.push({});
  const started = Date.now();
  let last = null;
  for (let s = 0; s < shapes.length; s++) {
    const provider = { ...makeProvider(kind, key, { model, extra: shapes[s], timeoutMs }), maxTokens: 1500 };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const reply = await callImpl(provider, "You are a health probe.", PROBE_PROMPT, 0, fetchImpl);
        // The pipeline parses JSON replies: a model that answers in prose to a JSON-only instruction is not usable.
        if (!/"ok"\s*:\s*true/i.test(String(reply))) return { ok: false, error: "reply did not follow the JSON-only instruction", status: null };
        return { ok: true, ms: Date.now() - started, extra: shapes[s] };
      } catch (err) {
        last = err;
        if (err.status === 429) return { ok: true, ms: Date.now() - started, extra: shapes[s], note: "rate-limited (alive)" };
        if (PERMANENT_STATUSES.has(err.status)) return { ok: false, permanent: true, status: err.status, error: String(err.message).slice(0, 160) };
        if (err.name === "AbortError") return { ok: false, error: "no reply within the timeout", status: null };
        if (err.status === 400 && s < shapes.length - 1) break;   // try the next request shape
        if (attempt === 1) await sleepImpl(800);
      }
    }
  }
  const why = last?.name === "AbortError" ? "no reply within the timeout" : String(last?.message || "failed").slice(0, 160);
  return { ok: false, error: why, status: last?.status ?? null };
}

async function fetchModelList(kind, key, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(providerListUrl(kind), { method: "GET", headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discovers the usable models of one provider: list, filter, rank, probe the top candidates, keep those that answer
 * (fast ones first, slow ones after). Never throws: a failed listing is reported in `error`.
 * @returns {Promise<{kind: string, models: {model: string, extra: object, ms: number}[], listed: number, probed: number, error?: string}>}
 */
export async function discoverProvider({ kind, key, fetchImpl = globalThis.fetch, callImpl = callProvider, maxCandidates = 8, maxKeep = KEEP[kind] ?? 3, timeoutMs, sleepImpl, slowMs = SLOW_PROBE_MS }) {
  let body;
  try {
    body = await fetchModelList(kind, key, fetchImpl);
  } catch (err) {
    return { kind, models: [], listed: 0, probed: 0, error: `model list unavailable: ${err.name === "AbortError" ? "timeout" : err.message}` };
  }
  const listed = parseModelList(kind, body).length;
  const candidates = selectCandidates(kind, body, { limit: maxCandidates });
  const results = new Array(candidates.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(PROBE_CONCURRENCY, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const idx = cursor++;
      results[idx] = await probeModel({ kind, key, model: candidates[idx], fetchImpl, callImpl, timeoutMs, sleepImpl });
    }
  });
  await Promise.all(lanes);
  const working = candidates
    .map((model, i) => ({ model, extra: results[i].extra, ms: results[i].ms, ok: results[i].ok }))
    .filter((r) => r.ok && r.ms <= slowMs)
    .map(({ model, extra, ms }) => ({ model, extra, ms }));
  // Models that failed their probe only with a server-side error (5xx): not proven dead, so a refresh may carry them over.
  const transient = candidates.filter((_, i) => !results[i].ok && !results[i].permanent && Number(results[i].status) >= 500);
  const listedIds = parseModelList(kind, body).map((m) => m.id);
  const rank = Object.fromEntries(candidates.map((m, i) => [m, i]));
  return { kind, models: working.slice(0, maxKeep), listed, probed: candidates.length, transient, listedIds, rank };
}

/** Whether the registry must be refreshed now (missing, stale, flagged dirty by a runtime failure), respecting the cool-down. */
export function needsRefresh(registry, { now = new Date(), dirty = false, lastAttemptAt = 0 } = {}) {
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  if (lastAttemptAt && nowMs - lastAttemptAt < ATTEMPT_COOLDOWN_MS) return false;
  if (!registry || !registry.providers) return true;
  if (dirty) return true;
  const age = nowMs - Date.parse(registry.fetchedAt);
  return !(age < REGISTRY_TTL_MS);
}

/**
 * Reads the cached registry. Anything malformed counts as "none", and individual entries without a usable model name are
 * dropped (a provider left with no valid entry falls back to the seed list when the chain is built).
 */
export async function loadRegistry(store) {
  try {
    const v = await store.get(REGISTRY_KEY);
    if (!v || typeof v !== "object" || !v.providers || typeof v.providers !== "object") return null;
    const providers = {};
    for (const kind of PROVIDER_KINDS) {
      const list = Array.isArray(v.providers[kind]) ? v.providers[kind].filter((m) => m && typeof m.model === "string" && m.model.trim()) : [];
      if (list.length > 0) providers[kind] = list;
    }
    return Object.keys(providers).length > 0 ? { ...v, providers } : null;
  } catch {
    return null;
  }
}

/**
 * Re-discovers every provider that has a key and stores the result. A provider whose listing failed, or whose candidates
 * all failed their probe, keeps its previous list: a flaky /models call or a short outage must never wipe the chain.
 * @param {{keys: {groqKey?: string, geminiKey?: string, nvidiaKey?: string}, fetchImpl?: Function, callImpl?: Function, store?: object, previous?: object|null, now?: Date, sleepImpl?: Function}} deps
 */
export async function refreshModelRegistry({ keys, fetchImpl = globalThis.fetch, callImpl = callProvider, store, previous = null, now = new Date(), sleepImpl, probeTimeoutMs } = {}) {
  const keyFor = { groq: keys?.groqKey, gemini: keys?.geminiKey, nim: keys?.nvidiaKey };
  const providers = {};
  const report = {};
  const snapshot = () => ({ version: 1, fetchedAt: now.toISOString(), providers: { ...providers }, report: { ...report } });
  // Saves are serialised and each carries the state at the moment its provider finished, so a slow earlier write can never
  // land after (and overwrite) a fuller later one.
  let saveChain = Promise.resolve();
  const save = () => {
    if (!store || Object.keys(providers).length === 0) return saveChain;
    const snap = snapshot();
    saveChain = saveChain.then(() => store.set(REGISTRY_KEY, snap)).catch((err) => console.warn(`[MODELS] Could not cache the model registry: ${err.message}`));
    return saveChain;
  };
  // Providers run in parallel (sequential discovery took 165 s live, longer than a scan run) and each one is saved the
  // moment it finishes: the daemon restarts every 5 minutes, and a refresh killed half-way must keep what it learned.
  await Promise.all(PROVIDER_KINDS.filter((kind) => keyFor[kind]).map(async (kind) => {
    const found = await discoverProvider({ kind, key: keyFor[kind], fetchImpl, callImpl, sleepImpl, timeoutMs: probeTimeoutMs });
    const prev = previous?.providers?.[kind];
    if (found.models.length > 0) {
      // A model that worked before and only hit a server error this time keeps a place at the tail: one 503 during a
      // probe must not shrink the chain. Dead (404), hanging, slow or no-longer-listed models are not carried over.
      const carried = (Array.isArray(prev) ? prev : []).filter((m) => found.transient.includes(m.model) && !found.models.some((f) => f.model === m.model));
      const byRank = (a, b) => (found.rank[a.model] ?? Infinity) - (found.rank[b.model] ?? Infinity);
      providers[kind] = [...found.models, ...carried].sort(byRank).slice(0, KEEP[kind] ?? 3);   // a flaky top model keeps its rank
    } else if (Array.isArray(prev) && prev.length > 0) providers[kind] = prev;
    report[kind] = { listed: found.listed, probed: found.probed, kept: found.models.length, ...(found.error ? { error: found.error } : {}) };
    await save();
  }));
  await save();
  return snapshot();
}
