/**
 * The deploy smoke check: one command on the server that says in seconds whether the environment can actually run the pipeline,
 * instead of finding out from a missed alert (no Gemini key -> scanned results unreadable; no ffmpeg -> recordings never
 * transcribed; no canvas binary -> page-level OCR silently falls back; gate left off -> every alert pushed).
 */
import { describe, it, expect } from "vitest";
import { evaluateSmoke } from "../services/smoke-check.service.js";

const good = () => ({
  node: "v22.1.0", env: { DATABASE_URL: "postgres://x", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1", GROQ_API_KEY: "gsk_abc", GEMINI_API_KEY: "g", ALLOCATION_GATE: undefined },
  ffmpeg: true, canvas: true, db: { ok: true, tables: ["corporate_announcements", "system_settings", "market_data_snapshots"] },
  modelRegistryAgeHours: 3, sourceProblems: []
});

describe("evaluateSmoke", () => {
  it("a good environment passes every check", () => {
    const r = evaluateSmoke(good());
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("each missing prerequisite fails with the consequence named, and the run is not ok", () => {
    const cases = [
      [{ env: { ...good().env, DATABASE_URL: "" } }, /database/i],
      [{ env: { ...good().env, TELEGRAM_BOT_TOKEN: "" } }, /telegram/i],
      [{ env: { ...good().env, GEMINI_API_KEY: "" } }, /scanned|OCR/i],
      [{ env: { ...good().env, GROQ_API_KEY: "", GROK_API_KEY: "" } }, /recording|whisper|groq/i],
      [{ ffmpeg: false }, /ffmpeg/i],
      [{ canvas: false }, /canvas/i],
      [{ db: { ok: false, error: "refused", tables: [] } }, /database/i],
      [{ sourceProblems: ["backend/x.js:3"] }, /control character/i],
    ];
    for (const [patch, text] of cases) {
      const r = evaluateSmoke({ ...good(), ...patch });
      const failed = r.checks.filter((c) => !c.ok);
      expect(failed.length, JSON.stringify(patch)).toBeGreaterThan(0);
      expect(failed.map((c) => c.consequence + c.name).join(" "), JSON.stringify(patch)).toMatch(text);
      expect(r.ok, JSON.stringify(patch)).toBe(false);
    }
  });

  it("a Groq key stored under the GROK_API_KEY alias counts only if it starts with gsk_", () => {
    expect(evaluateSmoke({ ...good(), env: { ...good().env, GROQ_API_KEY: "", GROK_API_KEY: "gsk_abc" } }).ok).toBe(true);
    expect(evaluateSmoke({ ...good(), env: { ...good().env, GROQ_API_KEY: "", GROK_API_KEY: "nvapi-123" } }).ok).toBe(false);
  });

  it("warnings (gate off, stale model registry) do not fail the run but are shown", () => {
    const r = evaluateSmoke({ ...good(), env: { ...good().env, ALLOCATION_GATE: "off" }, modelRegistryAgeHours: 80 });
    expect(r.ok).toBe(true);
    const warned = r.checks.filter((c) => !c.ok && c.severity === "warn");
    expect(warned.map((c) => c.name).join(" ")).toMatch(/gate/i);
    expect(warned.map((c) => c.name).join(" ")).toMatch(/registry/i);
  });

  it("a Node version below 20 fails", () => {
    expect(evaluateSmoke({ ...good(), node: "v18.19.0" }).ok).toBe(false);
  });
});
