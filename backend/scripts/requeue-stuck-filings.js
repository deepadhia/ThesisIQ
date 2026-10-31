/**
 * Re-queues earnings-pipeline filings of the CURRENT reporting quarter that dead-lettered or failed, so the worker
 * processes them again with the fixed code. Idempotent; dry-run by default (AGENTS.md rule 1 exception: committed,
 * dry-run-first, backs up what it changes, `--apply` only when the user asks).
 *
 *   node --env-file=.env.local backend/scripts/requeue-stuck-filings.js                 # dry run
 *   node --env-file=.env.local backend/scripts/requeue-stuck-filings.js --apply         # writes (after a JSON backup)
 *   ... --since 2026-10-01          only filings dated on/after this day (default: day after the latest quarter end)
 *   ... --ids <uuid>,<uuid>         ALSO re-queue these (already 'completed') rows, e.g. alerts that went out with bad
 *                                   content and must be re-sent corrected
 *
 * Selected: deep_dive_status IN ('needs_review','failed') filed on/after --since, plus any --ids.
 * Effect: deep_dive_status -> pending_stage1 / pending_stage2 / pending_audio (by the filing's own title/URL),
 * and the failure bookkeeping (pipeline_error, attempts, parked alert) is cleared so the retry budget starts fresh.
 * Deploy the fixed code BEFORE applying: the next scan cycle picks the rows up with whatever code is running.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db/pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Day after the most recent fiscal-quarter end (Mar 31 / Jun 30 / Sep 30 / Dec 31) on or before `now`. */
export function defaultSinceDate(now = new Date()) {
  const y = now.getUTCFullYear();
  const ends = [[y - 1, 11, 31], [y, 2, 31], [y, 5, 30], [y, 8, 30], [y, 11, 31]]
    .map(([yy, m, d]) => new Date(Date.UTC(yy, m, d)))
    .filter(d => d.getTime() < now.getTime());
  const last = ends[ends.length - 1];
  return new Date(last.getTime() + 86400000).toISOString().slice(0, 10);
}

/** Which queue a filing belongs to, judged only from its own title and file name. */
export function stageForFiling(title = "", attachmentUrl = "", previousError = "") {
  const t = `${title} ${attachmentUrl}`.toLowerCase();
  if (/transcript/.test(t)) return "pending_stage2";
  if (/audio|recording|callrecording/.test(t) || /^audio ingestion/i.test(String(previousError || ""))) return "pending_audio";
  return "pending_stage1";
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const since = argValue(args, "--since") || defaultSinceDate();
  const extraIds = (argValue(args, "--ids") || "").split(",").map(s => s.trim()).filter(Boolean);

  const { rows } = await pool.query(
    `SELECT id, ticker, title, attachment_url, deep_dive_status, status, filing_date, event_analysis
     FROM corporate_announcements
     WHERE (deep_dive_status IN ('needs_review', 'failed') AND filing_date >= $1::date)
        OR id = ANY($2::uuid[])
     ORDER BY ticker, filing_date`,
    [since, extraIds]
  );

  console.log(`Filings to re-queue (since ${since}${extraIds.length ? `, plus ${extraIds.length} explicit id(s)` : ""}): ${rows.length}`);
  const plan = rows.map(r => ({ ...r, newStatus: stageForFiling(r.title, r.attachment_url, r.event_analysis?.pipeline_error) }));
  for (const p of plan) {
    console.log(` - ${p.ticker.padEnd(11)} ${String(p.filing_date).slice(0, 10)}  ${p.deep_dive_status} -> ${p.newStatus}  | ${p.title.slice(0, 60)}${p.event_analysis?.pipeline_error ? `\n     was: ${String(p.event_analysis.pipeline_error).slice(0, 100)}` : ""}`);
  }

  if (plan.length === 0) { console.log("Nothing to do."); await pool.end(); return; }
  if (!apply) { console.log("\n(dry run — pass --apply to write)"); await pool.end(); return; }

  const backupDir = path.resolve(here, "../../scratch");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `requeue-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(plan.map(p => ({ id: p.id, ticker: p.ticker, title: p.title, deep_dive_status: p.deep_dive_status, event_analysis: p.event_analysis })), null, 2));
  console.log(`\nBackup of previous values written to ${backupPath}`);

  for (const p of plan) {
    await pool.query(
      `UPDATE corporate_announcements
       SET deep_dive_status = $1,
           event_analysis = (COALESCE(event_analysis, '{}'::jsonb)
                             - 'pipeline_error' - 'failed_at' - 'deep_dive_attempts' - 'fetch_attempts' - 'notext_attempts' - 'unreadable_attempts' - 'llm_attempts' - 'audio_attempts' - 'alert_pending' - 'pending_alert_text' - 'alert_error' - 'retry_not_before' - 'llm_outage_first_at' - 'llm_outage_retries' - 'scan_failures' - 'scan_first_failed_at' - 'scan_next_retry_at')
                            || jsonb_build_object('requeued_at', NOW(), 'requeued_from', $2::text)
       WHERE id = $3`,
      [p.newStatus, p.deep_dive_status, p.id]
    );
  }
  console.log(`Re-queued ${plan.length} filing(s). They are processed by the next scan cycle (4 per cycle).`);
  await pool.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
