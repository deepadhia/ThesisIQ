/**
 * Backfills the verified guidance track record (table guidance_outcomes) from the March-quarter results already filed.
 * Dry run by default (prints what it would record); `--apply` writes (idempotent upserts) and needs the migration
 * supabase/migrations/20261107000000_guidance_tracking.sql to have been applied (npm run db:migrate).
 *
 *   node --env-file=.env.local backend/scripts/backfill-guidance-outcomes.js                  # dry run, FY26 (March 2026 quarter)
 *   node --env-file=.env.local backend/scripts/backfill-guidance-outcomes.js --apply
 *   ... --from 2026-04-10 --to 2026-07-05              the filing-date window of the March-quarter results
 *   ... --ticker SJS                                   one stock
 *
 * It judges the ORIGINAL guide of the year (the first statement stored for that year) and the guide in force at year end, against the
 * full-year columns printed in the March-quarter statement. Nothing is judged without a readable statement (never guessed).
 */
import { pool } from "../db/pool.js";
import { extractPdfTextDetailed } from "../services/announcement.service.js";
import { extractDeterministicFinancials, quarterEndBefore } from "../services/financial-validator.service.js";
import { computeGuidancePacing } from "../services/guidance-pacing.service.js";

const args = process.argv.slice(2);
const arg = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const apply = args.includes("--apply");
const from = arg("--from", "2026-04-10");
const to = arg("--to", "2026-07-05");
const only = arg("--ticker");

const { rows } = await pool.query(
  `SELECT DISTINCT ON (ticker) ticker, attachment_url, filing_date
   FROM corporate_announcements
   WHERE filing_date >= $1::date AND filing_date <= $2::date AND attachment_url IS NOT NULL
     AND title ~* '^(outcome of board meeting|board meeting outcome|financial results|results)'
     AND ($3::text IS NULL OR ticker = $3)
   ORDER BY ticker, filing_date DESC`,
  [from, to, only]
);

console.log(`${apply ? "APPLY" : "DRY RUN"}: ${rows.length} March-quarter results filing(s) between ${from} and ${to}\n`);
let judged = 0;
for (const r of rows) {
  let fin = null;
  try {
    const pdf = await extractPdfTextDetailed(r.attachment_url);
    fin = pdf.text ? extractDeterministicFinancials(pdf.text, { periodEndHint: quarterEndBefore(r.filing_date) }) : null;
  } catch (err) { console.log(`${r.ticker.padEnd(11)} could not read the statement (${String(err.message).slice(0, 60)})`); continue; }
  if (!fin) { console.log(`${r.ticker.padEnd(11)} no statement read`); continue; }
  if (!fin.fyEnded) { console.log(`${r.ticker.padEnd(11)} no full-year columns in this layout (q ${fin.quarterEnded})`); continue; }

  const { rows: g } = await pool.query(
    `SELECT id, statement, metric, target_value, timeline, quarter, created_at FROM management_commitments WHERE ticker = $1 ORDER BY created_at DESC LIMIT 400`, [r.ticker]);
  const result = computeGuidancePacing({ commitments: g, fin });
  console.log(`${r.ticker.padEnd(11)} FY ended ${fin.fyEnded}: revenue ${fin.fyRevenue} vs ${fin.fyRevenuePrior} (${fin.fyRevenueYoYGrowthPct}%), EBITDA margin ${fin.fyEbitdaMarginPct}%  [${result.items.length} guide(s) judged]`);
  for (const it of result.items) {
    console.log(`      original: ${(it.initial?.line || "(none)").replace(/\*/g, "")}${it.revised ? `   | in force at year end: ${it.status}` : ""}`);
    console.log(`                <- "${(it.initial?.statement || it.statement).slice(0, 100)}"`);
    judged++;
    if (!apply) continue;
    for (const [initial, j] of [[true, it.initial], [false, { status: it.status, line: it.line, guidedText: it.guidedText, statement: it.statement, commitmentId: it.commitmentId }]]) {
      if (!j) continue;
      await pool.query(
        `INSERT INTO guidance_outcomes (ticker, fiscal_year, kind, initial, status, guided_text, line, statement, commitment_id, judged_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (ticker, fiscal_year, kind, initial) DO UPDATE
           SET status = EXCLUDED.status, guided_text = EXCLUDED.guided_text, line = EXCLUDED.line, statement = EXCLUDED.statement,
               commitment_id = EXCLUDED.commitment_id, judged_at = EXCLUDED.judged_at`,
        [r.ticker, it.fy, it.kind, initial, j.status, j.guidedText || null, String(j.line || "").replace(/\*/g, ""), j.statement || null, j.commitmentId || null, fin.fyEnded]
      );
    }
  }
}
console.log(`\n${judged} guide(s) ${apply ? "recorded" : "would be recorded (dry run: pass --apply after the migration)"}.`);
await pool.end();
process.exit(0);
