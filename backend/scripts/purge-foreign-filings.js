/**
 * Sets aside the OTHER companies' filings that the scanner saved under tracked tickers on 2026-11-06 (NSE's NextApi ignored the
 * `symbol` parameter), and removes what they wrote. Idempotent; dry-run by default (AGENTS.md rule 1 exception: committed,
 * dry-run-first, backs up what it changes, `--apply` only when the user asks).
 *
 *   node --env-file=.env.local backend/scripts/purge-foreign-filings.js                 # dry run: prints the plan, writes nothing
 *   node --env-file=.env.local backend/scripts/purge-foreign-filings.js --apply         # writes (after a JSON backup)
 *   ... --since 2026-11-06      only rows created on/after this day (default 2026-11-06)
 *
 * How a row is judged: its NSE document must be in NSE's own per-symbol list of that stock (verified, never guessed). A stock whose
 * list cannot be read is skipped and reported. Rows already alerted stay alerted (nothing can unsend them): they are only flagged.
 *
 * Effect of --apply (one transaction):
 *   * foreign rows: deep_dive_status -> 'not_required', event_analysis.foreign_filing = true (queues cleared); the rows stay, so the
 *     scanner never ingests them again.
 *   * management_commitments / quarterly_snapshots whose text sits inside a foreign row of the SAME stock are deleted. A deleted
 *     snapshot is rebuilt when the stock's real results filing is re-queued (requeue-stuck-filings.js).
 *   * stock_syntheses are only reported (they are rebuilt from the data above at the next filing).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db/pool.js";
import { fetchNseAnnouncements } from "../services/announcement.service.js";
import { planForeignCleanup } from "../services/foreign-cleanup.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : "2026-11-06";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.error("--since needs YYYY-MM-DD"); await pool.end(); process.exit(1); }

  const { rows } = await pool.query(
    `SELECT id, stock_id, ticker, title, attachment_url, deep_dive_status, created_at, event_analysis
     FROM corporate_announcements WHERE created_at >= $1 AND attachment_url IS NOT NULL ORDER BY created_at`, [since]);
  const { rows: stocks } = await pool.query("SELECT id, ticker, COALESCE(nse_symbol, ticker) AS nse_symbol FROM stocks");
  const symbolOf = new Map(stocks.map((s) => [s.ticker, s.nse_symbol]));

  // ownership: what NSE itself lists for each stock (the per-symbol endpoint, window wide enough to cover every row)
  const lookback = Math.ceil((Date.now() - new Date(`${since}T00:00:00Z`).getTime()) / 86400000) + 45;
  const verifiedByTicker = new Map();
  for (const ticker of new Set(rows.map((r) => r.ticker))) {
    const list = await fetchNseAnnouncements(symbolOf.get(ticker) || ticker, lookback);
    verifiedByTicker.set(ticker, new Set(list.map((a) => a.attachment).filter(Boolean)));
  }

  const { rows: commitments } = await pool.query(
    "SELECT id, ticker, stock_id, quarter, statement, evidence_summary, created_at FROM management_commitments");
  const { rows: snapshots } = await pool.query(
    "SELECT id, stock_id, quarter, summary, created_at FROM quarterly_snapshots");
  const plan = planForeignCleanup({ rows, verifiedByTicker, commitments, snapshots });
  const s = plan.summary;

  console.log(`Filings created since ${since}: ${rows.length}`);
  console.log(`Foreign (not in the stock's own NSE list): ${s.foreign} across ${s.tickers.length} tickers (${s.alreadyAlerted} already alerted, ${s.stillQueued} still queued)`);
  console.log(`Unverifiable (NSE list could not be read for the stock): ${s.unverifiable}${plan.unverifiable.length ? ` -> ${[...new Set(plan.unverifiable.map((r) => r.ticker))].join(", ")}` : ""}`);
  console.log(`Commitments traced to foreign filings: ${s.commitments}; quarterly snapshots traced: ${s.snapshots}`);
  for (const sn of plan.snapshots) console.log(`  snapshot ${sn.quarter} of stock ${sn.stock_id}: ${String(sn.summary).slice(0, 90)}`);
  for (const r of plan.foreign.filter((x) => /^pending_/.test(x.deep_dive_status)).slice(0, 5)) console.log(`  still queued: ${r.ticker} | ${r.title} | ${r.attachment_url.split("/").pop().slice(0, 50)}`);

  if (plan.foreign.length === 0 && plan.commitments.length === 0 && plan.snapshots.length === 0) { console.log("Nothing to do."); await pool.end(); return; }
  if (!apply) { console.log("\n(dry run — pass --apply to write)"); await pool.end(); return; }

  const backupDir = path.resolve(here, "../../scratch");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `foreign-filings-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    rows: plan.foreign.map((r) => ({ id: r.id, ticker: r.ticker, title: r.title, deep_dive_status: r.deep_dive_status, event_analysis: r.event_analysis })),
    commitments: plan.commitments,
    snapshots: await (async () => (plan.snapshots.length ? (await pool.query("SELECT * FROM quarterly_snapshots WHERE id = ANY($1)", [plan.snapshots.map((x) => x.id)])).rows : []))()
  }, null, 2));
  console.log(`\nBackup written to ${backupPath}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (plan.foreign.length) {
      await client.query(
        `UPDATE corporate_announcements
         SET deep_dive_status = 'not_required',
             event_analysis = (COALESCE(event_analysis, '{}'::jsonb) - 'alert_pending' - 'digest_pending' - 'synthesis_pending' - 'board_pending')
                              || jsonb_build_object('foreign_filing', true, 'foreign_filing_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
         WHERE id = ANY($1)`, [plan.foreign.map((r) => r.id)]);
    }
    if (plan.commitments.length) await client.query("DELETE FROM management_commitments WHERE id = ANY($1)", [plan.commitments.map((c) => c.id)]);
    if (plan.snapshots.length) await client.query("DELETE FROM quarterly_snapshots WHERE id = ANY($1)", [plan.snapshots.map((x) => x.id)]);
    await client.query("COMMIT");
    console.log(`Done: ${plan.foreign.length} filings set aside, ${plan.commitments.length} commitments and ${plan.snapshots.length} snapshots removed.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Rolled back:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch(async (err) => { console.error(err); await pool.end(); process.exit(1); });
