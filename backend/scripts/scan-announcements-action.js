/**
 * GitHub Actions Entry-Point for Corporate Announcement Scanner
 *
 * This wrapper is called by the workflow YAML instead of scan-announcements.js directly.
 * It handles:
 *   - Secret validation (fail fast with a clear message, not an obscure crash)
 *   - Optional start notification (when workflow_dispatch has notify_start=true)
 *   - Dry-run mode (scan without sending Telegram alerts)
 *   - Passes GitHub Actions run URL for clickable log links in summaries
 *   - Always exits with a clean code (0 = success, 1 = fatal)
 *
 * Called by: .github/workflows/scan-announcements.yml
 * NOT for local use — use scan-announcements.js directly for local runs.
 */

import { scan } from "./scan-announcements.js";
import { sendTelegramMessage } from "../services/telegram.service.js";

// ─── Read Action Inputs ───────────────────────────────────────────────────────
const isDryRun      = process.env.DRY_RUN === "true";
const notifyStart   = process.env.NOTIFY_START === "true";
const runUrl        = process.env.WORKFLOW_RUN_URL || null;

// ─── Validate Required Secrets ────────────────────────────────────────────────
// Fail fast with actionable error messages rather than deep stack traces.
const missing = [];
if (!process.env.DATABASE_URL)       missing.push("DATABASE_URL");
if (!process.env.NVIDIA_API_KEY)     missing.push("NVIDIA_API_KEY");
if (!process.env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
if (!process.env.TELEGRAM_CHAT_ID)   missing.push("TELEGRAM_CHAT_ID");

if (missing.length > 0) {
  console.error(`\n❌ Missing required GitHub Secrets:\n  ${missing.join("\n  ")}`);
  console.error("\nGo to: Settings → Secrets and variables → Actions → New repository secret");
  process.exit(1);
}

// ─── Start Notification (optional) ───────────────────────────────────────────
if (notifyStart) {
  const istTime = new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).toUpperCase();

  try {
    let startMsg = `🚀 *SCANNER TRIGGERED* ${isDryRun ? "_(DRY RUN)_" : ""}\n`;
    startMsg += `──────────────────────────────\n`;
    startMsg += `🕐 *Trigger Time:* ${istTime} IST\n`;
    startMsg += `📡 *Environment:* GitHub Actions Runner\n`;
    if (runUrl) {
      startMsg += `📄 [View Workflow Run →](${runUrl})\n`;
    }
    startMsg += `──────────────────────────────\n`;
    startMsg += `_ThesisIQ Automated Filing Scanner_`;
    await sendTelegramMessage(startMsg);
  } catch (err) {
    // Non-fatal — don't let a start notification failure abort the scan
    console.warn("[WARN] Could not send start notification:", err.message);
  }
}

// ─── Run Scanner ──────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`📢 Corporate Announcement Scanner — GitHub Actions`);
console.log(`   Mode    : ${isDryRun ? "DRY RUN (no Telegram alerts)" : "LIVE"}`);
console.log(`   Run URL : ${runUrl || "N/A (local run)"}`);
console.log(`${"─".repeat(60)}\n`);

try {
  const result = await scan({ isDryRun, runUrl });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`✅ Scan completed successfully`);
  console.log(`   Stocks scanned    : ${result.stocksScanned}`);
  console.log(`   New announcements : ${result.newAnnouncements}`);
  console.log(`   Alerts sent       : ${result.alertsSent}`);
  console.log(`   BSE fetch errors  : ${result.bseErrors}`);
  console.log(`   NSE fetch errors  : ${result.nseErrors}`);
  console.log(`   Duration          : ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`${"─".repeat(60)}\n`);

  process.exit(0);
} catch (err) {
  console.error("\n❌ FATAL: Scanner crashed with an unhandled error:");
  console.error(err);
  // The workflow YAML has a separate step that sends a failure Telegram message
  // via curl when this process exits with code 1.
  process.exit(1);
}
