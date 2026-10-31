/**
 * Env-bound entry point to the LLM failover chain. Every pipeline stage (scanner classification, corporate-action
 * extraction, deep-dive verdicts, highlights, syntheses) calls runLlm so they all share one provider chain, one
 * circuit breaker and one concurrency cap — instead of each stage hard-coding its own model list.
 *
 * The models in the chain are DISCOVERED, not hard-coded (see model-discovery.service.js): the cached registry is loaded
 * at scan start (initModelRegistry), refreshed in the background when it is older than 6 hours, and refreshed at once
 * when a model answers 404/410/401/403 during a real call. The measured seed list in llm-failover.service.js is only the
 * fallback while no discovered list exists. Without a store (unit tests, ad-hoc scripts) nothing is discovered at all.
 */
import { NVIDIA_API_KEY, GROQ_API_KEY, GEMINI_API_KEY } from "../config/env.js";
import { runLlmPrompt, buildProviders, SEED_MODELS } from "./llm-failover.service.js";
import { loadRegistry, refreshModelRegistry, needsRefresh } from "./model-discovery.service.js";

const keys = { nvidiaKey: NVIDIA_API_KEY, groqKey: GROQ_API_KEY, geminiKey: GEMINI_API_KEY };

const registryState = { registry: null, store: null, dirty: false, lastAttemptAt: 0, inFlight: null };

export function getModelRegistry() {
  return registryState.registry;
}

/** Test helper: forget the cached registry and any in-flight refresh. */
export function resetModelRegistryForTests() {
  Object.assign(registryState, { registry: null, store: null, dirty: false, lastAttemptAt: 0, inFlight: null });
}

function summarise(registry) {
  return Object.entries(registry.providers).map(([kind, list]) => `${kind}=[${list.map((m) => m.model).join(", ")}]`).join(" ");
}

const ATTEMPT_KEY = "llm_model_registry_attempt";

/**
 * Starts a background refresh when one is due (missing, stale, or flagged dirty) and none is running. Never throws.
 * The time of the last attempt is also kept in the database: the daemon restarts every 5 minutes, so an in-memory
 * cool-down alone would restart a refresh that was killed half-way on every single run.
 */
function maybeRefresh(now = new Date()) {
  const { store } = registryState;
  if (!store || registryState.inFlight) return;
  if (!needsRefresh(registryState.registry, { now, dirty: registryState.dirty, lastAttemptAt: registryState.lastAttemptAt })) return;
  registryState.lastAttemptAt = now.getTime();
  const wasDirty = registryState.dirty;
  registryState.dirty = false;
  registryState.inFlight = (async () => {
    let persistedAttempt = 0;
    try { persistedAttempt = Number(await store.get(ATTEMPT_KEY)) || 0; } catch { /* unreadable: treat as "never attempted" */ }
    if (!needsRefresh(registryState.registry, { now, dirty: wasDirty, lastAttemptAt: persistedAttempt })) return;
    try { await store.set(ATTEMPT_KEY, now.getTime()); } catch { /* best effort */ }
    const registry = await refreshModelRegistry({ keys, store, previous: registryState.registry, now });
    if (Object.keys(registry.providers).length > 0) {
      registryState.registry = registry;
      console.log(`[MODELS] Registry refreshed: ${summarise(registry)}`);
    } else {
      console.warn("[MODELS] Discovery found no usable model; keeping the current chain.");
    }
  })()
    .catch((err) => console.warn(`[MODELS] Discovery failed (${err.message}); keeping the current chain.`))
    .finally(() => { registryState.inFlight = null; });
}

/**
 * Loads the cached registry (fast) and starts a background refresh if it is due. The pipeline never waits for discovery:
 * calls use the cached list, or the seed list when there is none yet.
 * @param {{store?: {get(k: string): Promise<unknown>, set(k: string, v: unknown): Promise<void>}}} [deps]
 */
export async function initModelRegistry({ store } = {}) {
  registryState.store = store || null;
  if (!registryState.store) return null;
  if (!registryState.registry) registryState.registry = await loadRegistry(registryState.store);
  maybeRefresh();
  return registryState.registry;
}

/** A model died at runtime (retired, key revoked): re-discover now instead of waiting for the timer (rate-limited). */
export function markModelsDirty() {
  registryState.dirty = true;
  maybeRefresh();
}

/** Lets a running refresh finish before the process exits (the daemon restarts every 5 minutes). */
export async function settleModelRegistry(maxMs = 60000) {
  const pending = registryState.inFlight;
  if (!pending) return;
  let timer;
  await Promise.race([pending, new Promise((resolve) => { timer = setTimeout(resolve, maxMs); })]);
  clearTimeout(timer);
}

/**
 * Gemini model ids for the NATIVE multimodal API (scanned-PDF OCR, concall audio), best first: the discovered models lead and
 * the measured seed models follow as a last-resort tail. Same source as the chat chain, so a retired or newer model never
 * needs a code change here either.
 */
export function getGeminiModelNames() {
  const discovered = (registryState.registry?.providers?.gemini ?? []).map((m) => m.model);
  const seed = SEED_MODELS.gemini.map((m) => m.model);
  return [...new Set([...discovered, ...seed])];
}

export function getConfiguredProviders() {
  return buildProviders({ ...keys, registry: registryState.registry });
}

export function hasLlmProvider() {
  return getConfiguredProviders().length > 0;
}

/** @param {{temperature?: number, maxTotalMs?: number}} [opts] maxTotalMs bounds this logical call across all providers */
export function runLlm(systemPrompt, userPrompt, { temperature = 0.05, maxTotalMs } = {}) {
  return runLlmPrompt(systemPrompt, userPrompt, {
    temperature,
    providers: getConfiguredProviders(),
    onPermanentFailure: () => markModelsDirty(),
    ...(maxTotalMs ? { maxTotalMs } : {})
  });
}
