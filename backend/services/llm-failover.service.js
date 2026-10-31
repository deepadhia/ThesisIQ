/**
 * LLM provider failover for the alert pipeline.
 *
 * Why it exists: a filing whose every LLM call fails dead-letters with no alert, and free tiers fail in different ways
 * (NVIDIA NIM retired its llama-3.2 models — they answer 404 / hang; Groq caps tokens per minute per model; Gemini
 * returns 503 under load). This module walks an ordered chain of independent free providers, keeps each call inside a
 * hard time budget (the daemon restarts every 5 minutes), honours Retry-After, caps concurrent calls process-wide so
 * parallel filings do not trip burst limits, and runs a small circuit breaker so a provider that is retired, out of
 * quota or timing out is skipped instead of costing every filing its timeout again.
 *
 * It also records per-provider outcomes (getLlmStats) so llm-health.service.js can tell the user when a provider is
 * dead or the whole chain is failing — a silent LLM outage is exactly how alerts used to get lost.
 *
 * No config / DB imports on purpose: keys are passed in (see buildProviders) so this stays unit-testable.
 * Keys only ever travel in the Authorization header and are never written to logs or error messages.
 */

const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export const MAX_CONCURRENT_LLM_CALLS = 3;
/** One logical LLM call (all providers and retries together) never runs longer than this. */
export const CALL_BUDGET_MS = 100000;
const MIN_ATTEMPT_MS = 5000;
const MAX_RETRY_AFTER_MS = 15000;
const DEFAULT_RETRY_AFTER_MS = 5000;

/** HTTP statuses that mean "this model/key is gone", not "try again": retired model (404/410), bad or revoked key (401/403). */
const PERMANENT_STATUSES = new Set([401, 403, 404, 410]);
const PERMANENT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const TRANSIENT_COOLDOWN_MS = 90 * 1000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 120 * 1000;
const TRANSIENT_FAILURES_BEFORE_COOLDOWN = 2;

const KIND_CONFIG = {
  groq: { chatUrl: GROQ_URL, listUrl: "https://api.groq.com/openai/v1/models", timeoutMs: 30000, maxTokens: 3000 },
  gemini: { chatUrl: GEMINI_URL, listUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models", timeoutMs: 40000, maxTokens: 4096 },
  nim: { chatUrl: NIM_URL, listUrl: "https://integrate.api.nvidia.com/v1/models", timeoutMs: 25000, maxTokens: 3000 }
};
export const PROVIDER_KINDS = Object.keys(KIND_CONFIG);
export const providerListUrl = (kind) => KIND_CONFIG[kind].listUrl;

// Groq's free tier rejects (413) any request whose prompt + max_tokens exceeds its 8,000 tokens/min limit, so a prompt
// above maxInputTokens is skipped for Groq up front instead of being sent and refused.
const GROQ_TPM = 8000;

/**
 * Request parameters that suit a model family. gpt-oss and Gemini 3 are reasoning models: low effort keeps the JSON answer
 * inside the token budget and fast (Gemini 3 "thinks" by default, which dominates latency on long transcripts).
 */
export function defaultExtra(kind, model) {
  const m = String(model).toLowerCase();
  if (kind === "gemini") return { reasoning_effort: "low" };
  if (m.includes("gpt-oss")) return { reasoning_effort: "low" };
  if (kind === "groq" && m.includes("qwen")) return { reasoning_effort: "none" };
  return {};
}

const shortModelName = (model) => String(model).split("/").pop();

/** One chain entry for a model of a provider kind. Names are derived from the model id unless a seed gives one. */
export function makeProvider(kind, key, { model, extra, timeoutMs, name } = {}) {
  const c = KIND_CONFIG[kind];
  const short = shortModelName(model);
  return {
    name: name || (short.startsWith(kind) ? short : `${kind}-${short}`),
    url: c.chatUrl,
    key,
    model,
    timeoutMs: timeoutMs || c.timeoutMs,
    maxTokens: c.maxTokens,
    ...(kind === "groq" ? { maxInputTokens: GROQ_TPM - 3000 - 300 } : {}),
    extra: extra ?? defaultExtra(kind, model)
  };
}

/**
 * SEED models: the last-resort fallback used ONLY when no discovered list exists (first run before discovery has finished,
 * or every discovery attempt failed). The live chain comes from model-discovery.service.js, which lists each provider's
 * models, filters to text-chat models, ranks them and probes each with a real call, so a retired model (or a newer
 * better one) never needs a code change. These were measured on 2026-10-31 on a realistic 15 KB filing prompt: Groq
 * 0.3-0.7 s, Gemini 3.1 flash-lite 1.3 s, NIM gpt-oss-20b 2.4 s with reasoning_effort=low. No `response_format` JSON
 * mode anywhere: measured 3.5x slower on NIM with identical output.
 */
export const SEED_MODELS = {
  groq: [
    { model: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" } },
    { model: "qwen/qwen3.8-27b", extra: { reasoning_effort: "none" } },
    { model: "openai/gpt-oss-20b", extra: { reasoning_effort: "low" } }
  ],
  gemini: [
    { model: "gemini-3.1-flash-lite", timeoutMs: 40000 },
    { model: "gemini-3-flash-preview", timeoutMs: 45000 },
    // Every Gemini model has its own free-tier quota bucket, so extra models are extra capacity for long (transcript-sized)
    // prompts that Groq cannot take.
    { model: "gemini-3.5-flash-lite", timeoutMs: 40000 },
    { model: "gemini-flash-lite-latest", timeoutMs: 40000 }
  ],
  // NIM's free tier is the least reliable (it hung for 45 s twice in the 2026-10-31 live runs): last resort, short timeouts.
  nim: [
    { model: "openai/gpt-oss-20b", timeoutMs: 25000, extra: { reasoning_effort: "low" } },
    { model: "nvidia/nemotron-3.5-lightning-30b-a3b", name: "nim-nemotron-3.5-lightning", timeoutMs: 30000, extra: {} }
  ]
};

/**
 * The ordered chain. Models come from `registry` (discovered and probed) and fall back to SEED_MODELS per provider.
 * Groq and Gemini alternate so one provider's outage never removes two adjacent attempts; NIM is strictly last.
 */
export function buildProviders({ nvidiaKey, groqKey, geminiKey, registry } = {}) {
  const entriesFor = (kind, key) => {
    if (!key) return [];
    const discovered = registry?.providers?.[kind];
    const list = Array.isArray(discovered) && discovered.length > 0 ? discovered : SEED_MODELS[kind];
    return list.map((e) => makeProvider(kind, key, e));
  };
  const groq = entriesFor("groq", groqKey);
  const gemini = entriesFor("gemini", geminiKey);
  const nim = entriesFor("nim", nvidiaKey);
  const chain = [];
  let gi = 0;
  let mi = 0;
  while (gi < groq.length && mi < gemini.length) chain.push(groq[gi++], gemini[mi++]);
  chain.push(...gemini.slice(mi), ...groq.slice(gi), ...nim);
  return chain;
}

/** Deliberately pessimistic (3.2 chars/token): numeric Indian filings tokenise far denser than English prose (~6 chars/token). */
const estimateTokens = (...texts) => Math.ceil(texts.reduce((n, t) => n + String(t || "").length, 0) / 3.2);

// ── per-provider health (circuit breaker + stats for the health alert) ──
const health = new Map();
const stats = { calls: 0, succeeded: 0, failedCalls: 0, startedAt: Date.now() };

function healthOf(name) {
  if (!health.has(name)) health.set(name, { ok: 0, fail: 0, consecutive: 0, cooldownUntil: 0, lastError: null, lastStatus: null, permanent: false });
  return health.get(name);
}

function recordSuccess(name) {
  const h = healthOf(name);
  h.ok += 1;
  h.consecutive = 0;
  h.cooldownUntil = 0;
  h.permanent = false;
}

function recordFailure(name, err, nowMs) {
  const h = healthOf(name);
  h.fail += 1;
  // 413 means THIS request was too big for the provider's limit, not that the provider is unhealthy: never trip the breaker.
  if (err.status === 413) { h.lastError = String(err.message).slice(0, 200); h.lastStatus = 413; return; }
  h.consecutive += 1;
  h.lastError = String(err.message || err).slice(0, 200);
  h.lastStatus = err.status ?? null;
  if (PERMANENT_STATUSES.has(err.status)) {
    h.permanent = true;
    h.cooldownUntil = nowMs + PERMANENT_COOLDOWN_MS;
  } else if (err.status === 429) {
    h.cooldownUntil = nowMs + Math.min(err.retryAfterMs ?? 30000, MAX_RATE_LIMIT_COOLDOWN_MS);
  } else if (err.name === "AbortError" || h.consecutive >= TRANSIENT_FAILURES_BEFORE_COOLDOWN) {
    // A hang costs the full timeout on every call (seen: Gemini lite "no reply within 40s" on parallel chunk calls), far
    // more than an error that comes back fast, so one timeout is enough to start skipping the provider.
    h.cooldownUntil = nowMs + TRANSIENT_COOLDOWN_MS;
  }
}

/** Snapshot for llm-health.service.js (plain data, safe to log: error text never contains a key). */
export function getLlmStats() {
  const providers = {};
  for (const [name, h] of health) {
    providers[name] = { ok: h.ok, fail: h.fail, permanent: h.permanent, lastError: h.lastError, lastStatus: h.lastStatus };
  }
  return { ...stats, providers };
}

/** Clears the breaker and the stats (tests, and the start of a health canary). */
export function resetLlmState() {
  health.clear();
  stats.calls = 0;
  stats.succeeded = 0;
  stats.failedCalls = 0;
  stats.startedAt = Date.now();
}

// ── process-wide concurrency cap ──
let active = 0;
const waiters = [];
function acquire() {
  if (active < MAX_CONCURRENT_LLM_CALLS) { active += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(resolve));
}
function release() {
  const next = waiters.shift();
  if (next) next(); // hand the slot straight to the next waiter
  else active -= 1;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseRetryAfter(value) {
  if (value === null || value === undefined || value === "") return null;
  const secs = Number(value);
  if (!Number.isNaN(secs) && secs >= 0) return Math.round(secs * 1000);
  const when = Date.parse(value);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

export async function callProvider(p, systemPrompt, userPrompt, temperature, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), p.timeoutMs);
  try {
    const res = await fetchImpl(p.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: p.model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        temperature,
        max_tokens: p.maxTokens,
        ...p.extra
      })
    });
    if (!res.ok) {
      const err = new Error(`${p.name} HTTP ${res.status}: ${res.statusText || "error"}`);
      err.status = res.status;
      const retryAfter = parseRetryAfter(res.headers?.get?.("retry-after"));
      if (retryAfter !== null) err.retryAfterMs = retryAfter;
      else if (res.status === 429 && typeof res.json === "function") {
        // Google states the wait in the error body ("retryDelay": "23s") instead of a Retry-After header.
        try {
          const m = JSON.stringify(await res.json()).match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
          if (m) err.retryAfterMs = Math.round(parseFloat(m[1]) * 1000);
        } catch { /* body is optional: fall back to the default wait */ }
      }
      throw err;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error(`${p.name} returned an empty reply`);
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one prompt, failing over between providers. Resolves with the reply text; rejects with the last error
 * (message never contains a key) when every attempt failed or the time budget ran out.
 */
export async function runLlmPrompt(systemPrompt, userPrompt, {
  temperature = 0.05,
  providers,
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
  now = Date.now,
  maxTotalMs = CALL_BUDGET_MS,
  onPermanentFailure = null
} = {}) {
  if (!providers || providers.length === 0) {
    throw new Error("No LLM provider configured (set GROQ_API_KEY, GEMINI_API_KEY and/or NVIDIA_API_KEY).");
  }
  await acquire();
  stats.calls += 1;
  try {
    const start = now();
    const timeLeft = () => maxTotalMs - (now() - start);
    let lastErr = null;
    const attemptErrors = [];

    // Skip providers that are known-dead or cooling down; if that leaves nothing, try everything once anyway.
    const nowMs = Date.now();
    const promptTokens = estimateTokens(systemPrompt, userPrompt);
    const fits = providers.filter((p) => !p.maxInputTokens || promptTokens <= p.maxInputTokens);
    const candidates = fits.length > 0 ? fits : providers; // if nothing "fits", still try everything rather than give up
    const usable = candidates.filter((p) => healthOf(p.name).cooldownUntil <= nowMs);
    const chain = usable.length > 0 ? usable : candidates;

    for (const p of chain) {
      if (timeLeft() < MIN_ATTEMPT_MS) break;
      let waitedOnce = false;
      for (;;) {
        try {
          const attemptStart = Date.now();
          const reply = await callProvider(p, systemPrompt, userPrompt, temperature, fetchImpl);
          recordSuccess(p.name);
          stats.succeeded += 1;
          const secs = ((Date.now() - attemptStart) / 1000).toFixed(1);
          if (lastErr) console.log(`[LLM] Served by ${p.name} in ${secs}s after an earlier provider failed (prompt ~${promptTokens} tokens).`);
          else if (Date.now() - attemptStart > 15000) console.log(`[LLM] Slow reply from ${p.name}: ${secs}s (prompt ~${promptTokens} tokens).`);
          return reply;
        } catch (err) {
          lastErr = err;
          attemptErrors.push(err);
          recordFailure(p.name, err, Date.now());
          // A retired model or revoked key: tell the owner so the model list can be re-discovered right away
          if (PERMANENT_STATUSES.has(err.status) && onPermanentFailure) {
            try { onPermanentFailure(p, err); } catch { /* a hook must never break a call */ }
          }
          console.warn(`[LLM] ${p.name} failed: ${err.name === "AbortError" ? `no reply within ${p.timeoutMs / 1000}s` : err.message}`);
          if (err.status === 429 && !waitedOnce) {
            const wait = err.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
            if (wait <= MAX_RETRY_AFTER_MS && timeLeft() - wait >= MIN_ATTEMPT_MS) {
              waitedOnce = true;
              await sleepImpl(wait);
              healthOf(p.name).cooldownUntil = 0; // we waited the advertised time; this provider is usable again
              continue; // same provider once more after the advertised wait
            }
          }
          break; // next provider
        }
      }
    }
    stats.failedCalls += 1;
    // Every provider that could take this prompt failed (or the time budget ran out): an outage of the chain, as opposed
    // to an unusable reply. The mark travels on THIS call's error, so a success elsewhere cannot hide it.
    const exhausted = new Error(lastErr ? lastErr.message : "LLM call produced no reply within its time budget.");
    if (lastErr) {
      exhausted.name = lastErr.name;
      exhausted.status = lastErr.status;
      exhausted.retryAfterMs = lastErr.retryAfterMs;
    }
    exhausted.chainExhausted = true;
    // Quota pressure (some provider answered 429 and none is gone for good) versus a broken chain: the owner waits out the
    // first and pauses the whole queue for it; the shortest wait any provider advertised is the earliest sensible retry.
    const rateLimitedErrors = attemptErrors.filter((e) => e.status === 429);
    exhausted.rateLimited = rateLimitedErrors.length > 0 && !attemptErrors.some((e) => PERMANENT_STATUSES.has(e.status));
    if (exhausted.rateLimited) {
      const waits = rateLimitedErrors.map((e) => e.retryAfterMs).filter(Number.isFinite);
      exhausted.retryAfterMs = waits.length ? Math.min(...waits) : undefined;
    }
    throw exhausted;
  } finally {
    release();
  }
}
