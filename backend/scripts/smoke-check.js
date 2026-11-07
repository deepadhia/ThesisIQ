/**
 * Deploy smoke check. Read-only: it reads nothing but environment variables, the PATH, the database catalogue and source files.
 *
 *   node --env-file=.env.local backend/scripts/smoke-check.js
 *
 * Run it on the server after every deploy (and after changing keys). Exit code 1 when a prerequisite is missing.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateSmoke, formatSmokeReport } from "../services/smoke-check.service.js";
import { findControlCharSources } from "../services/pipeline-health.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The same resolver the audio pipeline uses (FFMPEG_PATH, a known local install, then PATH).
const ffmpegBinary = await import("../services/audio-transcript-analyzer.service.js").then((m) => m.getFfmpegPath()).catch(() => "ffmpeg");
const ffmpeg = (() => { try { return spawnSync(ffmpegBinary, ["-version"], { stdio: "ignore" }).status === 0; } catch { return false; } })();
const ytDlp = await import("../services/audio-transcript-analyzer.service.js").then((m) => m.isYtDlpAvailable()).catch(() => false);
const canvas = await import("@napi-rs/canvas").then(() => true).catch(() => false);

let db = { ok: false, tables: [], error: "DATABASE_URL not set" };
let modelRegistryAgeHours = null;
if (process.env.DATABASE_URL) {
  try {
    const { pool } = await import("../db/pool.js");
    const t = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    db = { ok: true, tables: t.rows.map((r) => r.table_name) };
    const reg = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600 AS age FROM system_settings WHERE key = 'llm_model_registry'").catch(() => ({ rows: [] }));
    modelRegistryAgeHours = reg.rows[0] ? Number(reg.rows[0].age) : null;
    await pool.end();
  } catch (err) {
    db = { ok: false, tables: [], error: String(err.message).slice(0, 120) };
  }
}

const result = evaluateSmoke({
  node: process.version, env: process.env, ffmpeg, ytDlp, canvas, db, modelRegistryAgeHours, sourceProblems: findControlCharSources(root)
});
console.log(formatSmokeReport(result));
process.exit(result.ok ? 0 : 1);
