/**
 * Deploy smoke check (pure part): turns the facts the script collected into a pass / fail list with the consequence of each
 * failure named, so "why did no alert come" is answered at deploy time instead of at 9 am on results day.
 * Severity "fail" makes the run not ok; "warn" is shown but does not fail it.
 */

export function evaluateSmoke(f = {}) {
  const env = f.env || {};
  const checks = [];
  const add = (name, ok, consequence, severity = "fail", detail = "") => checks.push({ name, ok: Boolean(ok), consequence, severity, detail });

  const major = Number(String(f.node || "").replace(/^v/, "").split(".")[0]);
  add("Node 20 or newer", major >= 20, "the pipeline uses APIs that need Node 20+", "fail", f.node);
  add("DATABASE_URL set and the database reachable", Boolean(env.DATABASE_URL) && f.db?.ok === true, "no database: nothing can be read, judged or recorded", "fail", f.db?.error || "");
  const need = ["corporate_announcements", "system_settings", "market_data_snapshots"];
  if (f.db?.ok) add("Required tables exist", need.every((t) => (f.db.tables || []).includes(t)), `missing table(s): ${need.filter((t) => !(f.db.tables || []).includes(t)).join(", ")}`, "fail");
  add("Telegram bot token and chat id set", Boolean(env.TELEGRAM_BOT_TOKEN) && Boolean(env.TELEGRAM_CHAT_ID), "Telegram not configured: every alert throws and is parked", "fail");

  const groqKey = env.GROQ_API_KEY || (String(env.GROK_API_KEY || "").startsWith("gsk_") ? env.GROK_API_KEY : "");
  add("Groq key set (GROQ_API_KEY, or a gsk_ key in GROK_API_KEY)", Boolean(groqKey), "no Groq key: recordings are never transcribed (Whisper) and the fastest AI route is gone", "fail");
  add("Gemini key set (GEMINI_API_KEY)", Boolean(env.GEMINI_API_KEY), "no Gemini key: scanned results PDFs cannot be read by OCR, so those stocks get no verified numbers", "fail");
  add("ffmpeg on PATH", f.ffmpeg === true, "ffmpeg missing: concall recordings cannot be encoded and are never transcribed", "fail");
  add("@napi-rs/canvas loads (page-level OCR)", f.canvas === true, "canvas missing: scanned statement pages inside long filings (POLICYBZR) fall back to the old whole-file OCR and are usually missed", "fail");
  add("No source file has a control character", !(f.sourceProblems || []).length, `a regex escape was corrupted by an editing accident: ${(f.sourceProblems || []).slice(0, 3).join(", ")} (control character)`, "fail");

  add("Allocation gate is ON", String(env.ALLOCATION_GATE || "on").toLowerCase() !== "off", "gate off: every alert is pushed (no board)", "warn");
  const age = f.modelRegistryAgeHours;
  add("AI model registry is fresh (under 48 h)", age === null || age === undefined ? true : age < 48, `model registry is ${Math.round(age)} h old: model discovery may not be refreshing (registry)`, "warn");

  return { ok: checks.every((c) => c.ok || c.severity === "warn"), checks };
}

/** Plain-text report: one line per check. */
export function formatSmokeReport(result) {
  const lines = result.checks.map((c) => `${c.ok ? "  ok  " : c.severity === "warn" ? " WARN " : " FAIL "} ${c.name}${c.ok ? "" : `\n         -> ${c.consequence}${c.detail ? ` (${c.detail})` : ""}`}`);
  return `${lines.join("\n")}\n\n${result.ok ? "SMOKE CHECK PASSED" : "SMOKE CHECK FAILED: fix the FAIL lines before relying on alerts"}`;
}
