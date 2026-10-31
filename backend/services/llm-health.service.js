/**
 * LLM health reporting.
 *
 * A dead LLM chain used to be invisible: the scanner kept "succeeding", every new filing was saved as `failed`
 * ("AI classification failed") and no alert ever arrived. Two cheap guards turn that into a Telegram message:
 *
 *  1. Run outcome  — after each scan, if every LLM call failed, or a provider answered 404/410/401/403 (retired model,
 *                    revoked key), tell the user once (cooldown in system_settings, so a long outage cannot spam).
 *  2. Daily canary — once a day (after 08:00 IST) every configured provider is probed individually with a tiny prompt;
 *                    broken ones are reported. This finds a silently retired model BEFORE the chain needs it.
 *
 * The decision logic is pure (evaluateLlmHealth / evaluateCanary) and the I/O is injected, so it is unit-tested.
 * Keys are never logged or sent: only provider names, HTTP statuses and error text produced by llm-failover.service.js.
 */
import { callProvider, getLlmStats } from "./llm-failover.service.js";

const PERMANENT_STATUSES = new Set([401, 403, 404, 410]);
const DOWN_COOLDOWN_HOURS = 3;
const DEAD_COOLDOWN_HOURS = 24;
const CANARY_HOUR_IST = 8;
const CANARY_PROMPT = 'Reply with exactly this JSON and nothing else: {"ok":true}';

/**
 * @param {ReturnType<typeof getLlmStats>} stats snapshot from the failover layer for this run
 * @param {number} configuredCount number of providers in the chain
 * @returns {{id: string, severity: "critical"|"warning", cooldownHours: number, text: string}[]}
 */
export function evaluateLlmHealth(stats, configuredCount) {
  const issues = [];
  if (configuredCount === 0) {
    issues.push({
      id: "llm:no-provider", severity: "critical", cooldownHours: DOWN_COOLDOWN_HOURS,
      text: "No LLM provider is configured (GROQ_API_KEY / GEMINI_API_KEY / NVIDIA_API_KEY missing). New filings cannot be analysed."
    });
    return issues;
  }
  if (stats.calls > 0 && stats.succeeded === 0) {
    const reasons = Object.entries(stats.providers)
      .filter(([, p]) => p.fail > 0)
      .map(([name, p]) => `${name}: ${p.lastError || "failed"}`)
      .slice(0, 5);
    issues.push({
      id: "llm:all-failed", severity: "critical", cooldownHours: DOWN_COOLDOWN_HOURS,
      text: `Every AI call failed this run (${stats.failedCalls} of ${stats.calls}). New filings are being saved as failed and retried, but no analysis is produced until a provider recovers.\n${reasons.map((r) => `• ${r}`).join("\n")}`
    });
  }
  for (const [name, p] of Object.entries(stats.providers)) {
    if (p.permanent) {
      issues.push({
        id: `llm:dead:${name}`, severity: "warning", cooldownHours: DEAD_COOLDOWN_HOURS,
        text: `Provider ${name} is permanently failing (HTTP ${p.lastStatus}): the model was retired or the key is invalid. The chain is skipping it and the model list is re-discovered automatically; if this repeats, check that provider's API key.`
      });
    }
  }
  return issues;
}

/** @param {{name: string, ok: boolean, ms: number, error?: string}[]} results */
export function evaluateCanary(results) {
  const broken = results.filter((r) => !r.ok);
  if (broken.length === 0) return [];
  const healthy = results.length - broken.length;
  return [{
    id: "llm:canary", severity: healthy === 0 ? "critical" : "warning", cooldownHours: 20,
    text: `Daily provider check: ${healthy} of ${results.length} AI providers healthy.\n${broken.map((r) => `• ${r.name}: ${r.error}`).join("\n")}`
  }];
}

/**
 * Probes each provider on its own (no failover) with a tiny prompt. A provider is only reported broken after it failed
 * twice (one transient 503 is normal on free tiers), and a 429 counts as alive: rate-limited is not down. The token budget
 * is generous because reasoning models spend it on thinking before they answer (a 200-token probe read as "empty reply").
 */
export async function runProviderCanary(providers, { fetchImpl = globalThis.fetch, callImpl = callProvider, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const results = [];
  for (const p of providers) {
    const t = Date.now();
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await callImpl({ ...p, timeoutMs: Math.min(p.timeoutMs, 30000), maxTokens: 1500 }, "You are a health probe.", CANARY_PROMPT, 0, fetchImpl);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (err.status === 429 || PERMANENT_STATUSES.has(err.status)) break; // alive-but-limited, or definitively gone: no point retrying
        if (attempt === 1) await sleepImpl(3000);
      }
    }
    if (!lastErr) results.push({ name: p.name, ok: true, ms: Date.now() - t });
    else if (lastErr.status === 429) results.push({ name: p.name, ok: true, ms: Date.now() - t, note: "rate-limited (alive)" });
    else {
      const why = lastErr.name === "AbortError" ? "no reply within the timeout" : String(lastErr.message || lastErr).slice(0, 160);
      results.push({ name: p.name, ok: false, ms: Date.now() - t, error: why });
    }
  }
  return results;
}

function formatMessage(issues, now) {
  const time = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
  const critical = issues.some((i) => i.severity === "critical");
  const body = issues.map((i) => i.text.replace(/[*_`[\]]/g, "")).join("\n\n");
  return `${critical ? "🚨" : "⚠️"} ${critical ? "AI PIPELINE DOWN" : "AI PIPELINE DEGRADED"}\n──────────────────────────────\n${body}\n──────────────────────────────\n🕐 ${time} IST · ThesisIQ health guard`;
}

/**
 * Sends one Telegram message for the issues whose cooldown has expired and records the cooldown only after the send
 * succeeded (a failed send is retried on the next run). Returns the issues that were sent.
 * @param {{issues: object[], store: {get(k: string): Promise<string|null>, set(k: string, v: string): Promise<void>}, send: (t: string) => Promise<unknown>, now?: Date}} deps
 */
export async function alertForIssues({ issues, store, send, now = new Date() }) {
  const due = [];
  for (const issue of issues) {
    const last = await store.get(`llm_alert_${issue.id}`);
    const hoursSince = last ? (now.getTime() - new Date(last).getTime()) / 3600000 : Infinity;
    if (!(hoursSince < issue.cooldownHours)) due.push(issue);
  }
  if (due.length === 0) return [];
  await send(formatMessage(due, now));
  for (const issue of due) await store.set(`llm_alert_${issue.id}`, now.toISOString());
  return due;
}

/** system_settings-backed store (same table the scanner health guard already uses). */
export function dbStore(pool) {
  return {
    async get(key) {
      const res = await pool.query("SELECT value FROM system_settings WHERE key = $1", [key]);
      const v = res.rows[0]?.value;
      return typeof v === "string" ? v.replace(/"/g, "") : v ?? null;
    },
    async set(key, value) {
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    }
  };
}

export function istDateAndHour(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now));
  return { date, hour };
}

/**
 * Called once at the end of each live scan. Never throws: health reporting must not break the alert pipeline.
 * @param {{store: object, send: Function, providers: object[], now?: Date, canary?: Function, onBroken?: Function}} deps
 */
export async function reportLlmHealth({ store, send, providers, now = new Date(), canary = runProviderCanary, onBroken = null }) {
  try {
    const issues = evaluateLlmHealth(getLlmStats(), providers.length);

    const { date, hour } = istDateAndHour(now);
    if (providers.length > 0 && hour >= CANARY_HOUR_IST && (await store.get("llm_canary_date")) !== date) {
      // Mark first: the probe costs a handful of free-tier calls and must not repeat every 5 minutes if it is slow.
      await store.set("llm_canary_date", date);
      const results = await canary(providers);
      console.log(`[LLM HEALTH] Daily canary: ${results.map((r) => `${r.name}=${r.ok ? `ok ${r.ms}ms` : "FAIL"}`).join(", ")}`);
      issues.push(...evaluateCanary(results));
      // A broken model means the discovered list is out of date: re-discover now instead of waiting for the timer
      if (onBroken && results.some((r) => !r.ok)) onBroken();
    }

    if (issues.length > 0) await alertForIssues({ issues, store, send, now });
  } catch (err) {
    console.warn(`[LLM HEALTH WARN] Could not complete health report: ${err.message}`);
  }
}
