import crypto from "crypto";
import { pool } from "../db/pool.js";
import { quotaPauseMs } from "./retry-policy.service.js";

export const OCR_QUOTA_KEY = "gemini_ocr_quota";
const PACE_MS = 15000;
const ESCALATION_WINDOW_MS = 6 * 60 * 60 * 1000;

export function ocrDeferred(code, retryAfterMs, message) {
  return Object.assign(new Error(message), { code, retryAfterMs: Math.max(1000, retryAfterMs), ocrDeferred: true });
}

/** Gemini supplies Retry-After and/or google.rpc.RetryInfo. Honour the longest valid hint. */
export function ocrRetryAfterMs(headers, body, now = Date.now()) {
  const hints = [];
  const header = headers?.get?.("retry-after");
  if (header != null && String(header).trim()) {
    const numeric = Number(header);
    hints.push(Number.isFinite(numeric) ? numeric * 1000 : Date.parse(header) - now);
  }
  try {
    const error = JSON.parse(body)?.error;
    for (const d of error?.details || []) {
      if (String(d["@type"] || "").endsWith("google.rpc.RetryInfo")) {
        const delay = /^(\d+(?:\.\d+)?)s$/.exec(String(d.retryDelay || ""));
        if (delay) hints.push(Number(delay[1]) * 1000);
      }
    }
    const messageDelay = /retry in\s+(\d+(?:\.\d+)?)s/i.exec(error?.message || "");
    if (messageDelay) hints.push(Number(messageDelay[1]) * 1000);
  } catch { /* Not every HTTP error body is JSON. */ }
  return Math.max(0, ...hints.filter((v) => Number.isFinite(v) && v >= 0));
}

/** Atomic row leases work with Supabase transaction pooling; a killed process's lease expires. */
export function postgresOcrStore(db) {
  return {
    async acquire(owner, busyUntil, now) {
      const { rows } = await db.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = system_settings.value || jsonb_build_object('owner', $3::text, 'busyUntil', $4::bigint), updated_at = NOW()
         WHERE COALESCE((system_settings.value->>'until')::bigint, 0) <= $5::bigint
           AND COALESCE((system_settings.value->>'busyUntil')::bigint, 0) <= $5::bigint
         RETURNING value`,
        [OCR_QUOTA_KEY, JSON.stringify({ owner, busyUntil, until: 0, count: 0 }), owner, busyUntil, now]);
      return rows[0]?.value || null;
    },
    async get() {
      const { rows } = await db.query("SELECT value FROM system_settings WHERE key = $1", [OCR_QUOTA_KEY]);
      return rows[0]?.value || {};
    },
    async finish(owner, state) {
      await db.query(
        `UPDATE system_settings SET value = $2::jsonb, updated_at = NOW()
         WHERE key = $1 AND value->>'owner' = $3`,
        [OCR_QUOTA_KEY, JSON.stringify(state), owner]);
    }
  };
}

/** One OCR at a time across scanner, repair scripts and failover, followed by pacing; no sleeping worker slots. */
export function createOcrQuotaGate({ store, now = Date.now }) {
  return {
    async run(totalMs, work) {
      const owner = crypto.randomUUID();
      let lease;
      try {
        lease = await store.acquire(owner, now() + totalMs + 30000, now());
        if (!lease) {
          const state = await store.get();
          const rateLimited = state.until > now();
          throw ocrDeferred(rateLimited ? "OCR_RATE_LIMITED" : "OCR_BUSY",
            Math.max(state.until || 0, state.busyUntil || 0) - now(),
            rateLimited ? "Gemini OCR quota is cooling down" : "Another OCR request is running or being paced");
        }
      } catch (err) {
        if (err.ocrDeferred) throw err;
        console.warn(`[OCR QUOTA] Could not acquire shared OCR lease: ${err.message}`);
        throw ocrDeferred("OCR_UNAVAILABLE", 60000, "OCR quota store unavailable; retry later");
      }
      let state = { until: lease.until || 0, count: lease.count || 0 };
      try {
        const result = await work();
        if (result) state = { until: 0, count: 0 };
        return result;
      } catch (err) {
        if (err.code === "OCR_RATE_LIMITED") {
          const count = now() - (lease.until || 0) < ESCALATION_WINDOW_MS ? (lease.count || 0) + 1 : 1;
          const delay = quotaPauseMs(count, err.retryAfterMs);
          state = { until: now() + delay, count };
          err.retryAfterMs = delay;
        }
        throw err;
      } finally {
        try { await store.finish(owner, { ...state, busyUntil: now() + PACE_MS }); }
        catch (err) { console.warn(`[OCR QUOTA] Could not save OCR cooldown: ${err.message}`); }
      }
    }
  };
}

export const geminiOcrQuotaGate = createOcrQuotaGate({ store: postgresOcrStore(pool) });
