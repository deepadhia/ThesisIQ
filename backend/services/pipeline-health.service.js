/**
 * Pipeline self-audit: the system reports its own silent failures so the user does not discover them from a bad alert.
 *
 * Every check is a failure that really happened (see tests): results never queued (MOREPENLAB / LUMAXTECH / QPOWER), results filed
 * without verified numbers (POLICYBZR), filings stuck, alerts parked, the end-of-day board not going out, conflicting stances, the
 * allocation gate left off, a source file corrupted by an editing accident. `evaluatePipelineHealth` is pure; `gatherHealthSnapshot`
 * reads the database through an injected pool (a failing query becomes a finding, never a silent skip).
 * The report is sent at most once a day, after 19:00 IST, and only when something is wrong.
 */

import fs from "fs";
import path from "path";
import { isResultsOutcomeFiling } from "./filing-classifier.service.js";

const HOURS = 3600e3;
const stance = (a) => (/BUY|ADD|ACCUMULATE|BUILD/i.test(a || "") ? "BUY" : /REASSESS|TRIM|SELL|EXIT|REDUCE/i.test(a || "") ? "REASSESS" : "HOLD");
const uniq = (xs) => [...new Set(xs)];
const names = (rows, key = "ticker", max = 6) => {
  const u = uniq(rows.map((r) => r[key]).filter(Boolean));
  return u.slice(0, max).join(", ") + (u.length > max ? ` +${u.length - max} more` : "");
};

/** @returns {Array<{level:"critical"|"warn", code:string, text:string}>} critical first */
export function evaluatePipelineHealth(s = {}) {
  const out = [];
  const add = (level, code, text) => out.push({ level, code, text });

  if (s.queryErrors?.length) add("warn", "HEALTH_CHECK_FAILED", `the self-audit could not run ${s.queryErrors.length} check(s) (${uniq(s.queryErrors).slice(0, 2).join("; ").slice(0, 120)}); treat the rest of this report as incomplete`);
  if (s.foreignFilings?.length) add("critical", "FOREIGN_FILINGS", `${s.foreignFilings.length} filing(s) of OTHER companies are saved under tracked stocks (e.g. ${names(s.foreignFilings.flatMap((f) => f.tickers.map((ticker) => ({ ticker }))), "ticker", 4)}): the exchange feed answered for the wrong company; their alerts and numbers are not that stock's`);
  if (s.misroutedResults?.length) add("critical", "RESULTS_NOT_QUEUED", `results filed but never read (classified as something else and skipped): ${names(s.misroutedResults)}`);
  if (s.resultsWithoutNumbers?.length) add("critical", "RESULTS_WITHOUT_NUMBERS", `results filed ${Math.round(Math.min(...s.resultsWithoutNumbers.map((r) => r.filedHoursAgo)))}+ h ago but no verified numbers were produced: ${names(s.resultsWithoutNumbers)}`);
  if (s.prematureCommitments?.length) add('critical', 'PREMATURE_COMMITMENT', `${s.prematureCommitments.length} board-approved or proposed ownership action(s) were marked achieved before final completion (${names(s.prematureCommitments)}); review the source and repair the ledger`);
  if (s.unreadableSources?.length) add("critical", "SOURCE_CORRUPTED", `source file(s) contain control characters (a damaged regex): ${s.unreadableSources.slice(0, 3).join(", ")}`);
  if (s.stuck?.length) add("warn", "FILINGS_STUCK", `${s.stuck.length} filing(s) waiting more than 6 h, oldest ${Math.round(Math.max(...s.stuck.map((r) => r.ageHours)))} h (${names(s.stuck)})`);
  if (s.ocrDeferred?.length) add("warn", "OCR_QUOTA_BACKLOG", `${s.ocrDeferred.length} filing(s) waiting for OCR quota or its shared lease (${names(s.ocrDeferred)}); retries are deferred without consuming filing attempts`);
  if (s.expiredExecutions?.length) add("warn", "EXECUTION_RECOVERY_STALLED", `${s.expiredExecutions.length} eligible filing(s) still waiting more than 30 min after an execution lease expired (${names(s.expiredExecutions)}); automatic recovery is stalled`);
  if (s.parkedAlerts?.length) add("warn", "ALERTS_PARKED", `${s.parkedAlerts.length} alert(s) could not be delivered and are waiting to retry (${names(s.parkedAlerts)})`);
  if (s.boardBacklog?.length) add("warn", "BOARD_BACKLOG", `${s.boardBacklog.length} filing(s) have waited over 30 h for the allocation board, oldest ${Math.round(Math.max(...s.boardBacklog.map((r) => r.ageHours)))} h`);
  if (s.conflicts?.length) add("warn", "CONFLICTING_STANCES", `the same stock was graded two different ways within 48 h on verified numbers: ${names(s.conflicts)}`);
  if (s.guidanceTablesMissing) add("warn", "GUIDANCE_TABLES_MISSING", "the guidance tracking tables do not exist: run \"npm run db:migrate\" (pacing history and year-end outcomes cannot be stored, so no track record builds)");
  if (s.guidanceCoverageGaps?.length) add("warn", "GUIDANCE_COVERAGE_GAP", `${s.guidanceCoverageGaps.length} completed call(s) contain forward commitments but have no structured guidance; review and reprocess their source filings (${names(s.guidanceCoverageGaps)})`);
  if (s.incompleteHighlights?.length) add("warn", "HIGHLIGHTS_INCOMPLETE", `${s.incompleteHighlights.length} completed call or presentation read(s) missed one or more highlight parts; review and reprocess their source filings (${names(s.incompleteHighlights)})`);
  if (s.unresolvedDeadLetters?.length) add("warn", "DEAD_LETTER_REVIEW", `${s.unresolvedDeadLetters.length} material filing(s) remain in needs_review after extraction failed (${names(s.unresolvedDeadLetters)}); open the source and repair or retry them`);
  if (s.gateEnabled === false) add("warn", "GATE_OFF", "the allocation gate is switched OFF: every alert is being pushed (ALLOCATION_GATE=off)");

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
}

/** One short message (at most 8 finding lines), or null when everything is fine. */
export function buildHealthMessage(findings = []) {
  if (!findings.length) return null;
  const shown = findings.slice(0, 8);
  const lines = shown.map((f) => `${f.level === "critical" ? "🔴" : "🟠"} ${f.text}`);
  const more = findings.length > shown.length ? `\n_+${findings.length - shown.length} more_` : "";
  return `🩺 *SYSTEM CHECK* — ${findings.length} thing${findings.length === 1 ? "" : "s"} need attention\n${lines.join("\n")}${more}`;
}

/** Once a day, from 19:00 IST, only with findings, and not the same findings twice on one day. */
export function shouldSendHealthReport({ now = Date.now(), findings = [], last = null } = {}) {
  if (!findings.length) return false;
  const ist = new Date(now + 5.5 * HOURS);
  if (ist.getUTCHours() < 19) return false;
  const ymd = ist.toISOString().slice(0, 10);
  const fingerprint = healthFingerprint(findings);
  if (!last) return true;
  return last.ymd !== ymd || last.fingerprint !== fingerprint;
}

export const healthFingerprint = (findings) => findings.map((f) => f.code).sort().join(",");

/** Files under the given folders that contain a stray control character (the editing accident that silently disables a regex). */
export function findControlCharSources(root, dirs = ["backend", "scripts"]) {
  const bad = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "fixtures") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(?:js|mjs)$/.test(e.name)) {
        const t = fs.readFileSync(p, "utf8");
        const m = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.exec(t);
        if (m) bad.push(`${path.relative(root, p).replace(/\\/g, "/")}:${t.slice(0, m.index).split("\n").length}`);
      }
    }
  };
  for (const d of dirs) walk(path.join(root, d));
  return bad;
}

/**
 * Reads the pipeline's state. Each query is isolated: a failure is recorded in `queryErrors` (and reported), never swallowed.
 * @param {{query: Function}} pool
 */
export async function gatherHealthSnapshot(pool, { now = Date.now(), gateEnabled = true, sourceRoot = null, lookbackDays = 10 } = {}) {
  const days = Math.max(1, Math.min(60, Math.floor(Number(lookbackDays) || 10)));
  const snap = { stuck: [], parkedAlerts: [], boardBacklog: [], misroutedResults: [], resultsWithoutNumbers: [], conflicts: [], foreignFilings: [], guidanceCoverageGaps: [], incompleteHighlights: [], unresolvedDeadLetters: [], prematureCommitments: [], gateEnabled, unreadableSources: [], queryErrors: [], guidanceTablesMissing: false };
  const run = async (label, sql, params = []) => {
    try { return (await pool.query(sql, params)).rows || []; } catch (err) { snap.queryErrors.push(`${label}: ${err.message}`); return []; }
  };
  snap.ocrDeferred = await run("OCR quota backlog",
    `SELECT ticker, event_analysis->>'pipeline_error' AS reason, event_analysis->>'retry_not_before' AS retry_at
     FROM corporate_announcements
     WHERE deep_dive_status IN ('pending_stage1','pending_stage2','pending_audio')
       AND event_analysis->>'pipeline_error' ~ '^OCR_(RATE_LIMITED|BUSY|UNAVAILABLE|PARTIAL):'
       AND COALESCE(event_analysis->>'foreign_filing', 'false') <> 'true'
     ORDER BY filing_date LIMIT 30`);
  snap.prematureCommitments = await run('premature commitments',
    `SELECT ticker, id, 'premature_commitment' AS tag FROM management_commitments
     WHERE status LIKE 'Achieved%'
       AND statement ~* '(board[[:space:]]+approv|proposed)'
       AND (statement || ' ' || COALESCE(metric, '')) ~* '(acquisit|stake|invest|merger|demerg|scheme)'
       AND created_at > NOW() - INTERVAL '60 days'
     ORDER BY created_at DESC LIMIT 30`);
  snap.guidanceCoverageGaps = await run("guidance coverage gap",
    `SELECT DISTINCT c.ticker, 'guidance_coverage_gap' AS tag
     FROM corporate_announcements c
     WHERE c.deep_dive_status = 'completed'
       AND (c.title ~* 'transcript' OR c.event_analysis->>'processed_stage' = 'audio')
       AND c.created_at BETWEEN NOW() - INTERVAL '${days} days' AND NOW() - INTERVAL '2 hours'
       AND COALESCE(c.event_analysis->>'foreign_filing', 'false') <> 'true'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(c.event_analysis->'institutional_verdict'->'commitments') = 'array'
             THEN c.event_analysis->'institutional_verdict'->'commitments' ELSE '[]'::jsonb END
         ) AS commitment
         WHERE commitment->>'guidance_scope' IN ('QUARTERLY', 'ANNUAL', 'MULTI_YEAR')
       )
       AND COALESCE(c.event_analysis->'institutional_verdict'->'concall_highlights'->'guidance_changes', '[]'::jsonb) = '[]'::jsonb
       AND COALESCE(c.event_analysis->'institutional_verdict'->'concall_highlights'->'quarterly_guidance', '[]'::jsonb) = '[]'::jsonb
       AND COALESCE(c.event_analysis->'institutional_verdict'->'concall_highlights'->'annual_guidance', '[]'::jsonb) = '[]'::jsonb
       AND COALESCE(c.event_analysis->'institutional_verdict'->'concall_highlights'->'multi_year_targets', '[]'::jsonb) = '[]'::jsonb
     LIMIT 30`);
  snap.incompleteHighlights = await run("incomplete highlights",
    `SELECT ticker FROM corporate_announcements
     WHERE deep_dive_status = 'completed'
       AND event_analysis->'institutional_verdict'->'highlight_extraction'->>'status' = 'INCOMPLETE'
       AND created_at BETWEEN NOW() - INTERVAL '${days} days' AND NOW() - INTERVAL '2 hours'
       AND COALESCE(event_analysis->>'foreign_filing', 'false') <> 'true'
     ORDER BY created_at DESC LIMIT 30`);
  snap.unresolvedDeadLetters = await run("material dead letters",
    `SELECT ticker, title, 'material_dead_letter' AS tag FROM corporate_announcements
     WHERE deep_dive_status = 'needs_review'
       AND title ~* '(presentation|press release|financial results|outcome of board meeting|transcript)'
       AND created_at > NOW() - INTERVAL '${days} days'
       AND COALESCE(event_analysis->>'foreign_filing', 'false') <> 'true'
     ORDER BY created_at DESC LIMIT 30`);
  snap.expiredExecutions = await run("expired execution recovery",
    `SELECT ticker FROM corporate_announcements
     WHERE deep_dive_status IN ('pending_stage1','pending_stage2','pending_audio')
       AND event_analysis->'execution_lease'->>'until' IS NOT NULL
       AND (event_analysis->'execution_lease'->>'until')::bigint < floor(EXTRACT(EPOCH FROM NOW() - INTERVAL '30 minutes') * 1000)::bigint
       AND (event_analysis->>'retry_not_before' IS NULL OR (event_analysis->>'retry_not_before')::timestamptz <= NOW())
       AND COALESCE(event_analysis->>'foreign_filing', 'false') <> 'true' LIMIT 30`);
  const VERIFIED_ELSEWHERE = `NOT EXISTS (SELECT 1 FROM corporate_announcements v WHERE v.ticker = c.ticker AND v.created_at > NOW() - INTERVAL '${days} days'
        AND v.event_analysis->'institutional_verdict'->'verified_financials' IS NOT NULL)`;

  snap.stuck = (await run("stuck",
    `SELECT ticker, deep_dive_status AS status, EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours
     FROM corporate_announcements WHERE deep_dive_status IN ('pending_stage1','pending_stage2','pending_audio')
       AND ((deep_dive_status <> 'pending_audio' AND created_at < NOW() - INTERVAL '6 hours')
         OR (deep_dive_status = 'pending_audio' AND created_at < NOW() - INTERVAL '36 hours'))
       AND created_at > NOW() - INTERVAL '10 days' ORDER BY age_hours DESC LIMIT 30`))
    .map((r) => ({ ticker: r.ticker, status: r.status, ageHours: Number(r.age_hours) }));

  snap.parkedAlerts = (await run("parked alerts",
    `SELECT ticker, EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours FROM corporate_announcements
     WHERE event_analysis->>'alert_pending' = 'true' AND created_at < NOW() - INTERVAL '1 hour' AND created_at > NOW() - INTERVAL '10 days' LIMIT 30`))
    .map((r) => ({ ticker: r.ticker, ageHours: Number(r.age_hours) }));

  snap.boardBacklog = (await run("board backlog",
    `SELECT ticker, EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours FROM corporate_announcements
     WHERE (event_analysis ->> 'board_pending') = 'true' AND created_at < NOW() - INTERVAL '30 hours' AND created_at > NOW() - INTERVAL '10 days' LIMIT 30`))
    .map((r) => ({ ticker: r.ticker, ageHours: Number(r.age_hours) }));

  // One exchange document belongs to ONE company: the same file stored under three or more tracked tickers means the feed answered
  // for the wrong company (NSE NextApi ignored the symbol, 2026-11-06). Rows already set aside by the clean-up script are not counted.
  snap.foreignFilings = (await run("foreign filings",
    `SELECT source_id, array_agg(DISTINCT ticker) AS tickers FROM corporate_announcements
     WHERE source_id ~* '\\.(pdf|xml|mp3|mp4|m4a)$' AND created_at > NOW() - INTERVAL '${days} days'
       AND COALESCE(event_analysis->>'foreign_filing', '') <> 'true'
     GROUP BY source_id HAVING count(DISTINCT ticker) >= 3 ORDER BY min(created_at) DESC LIMIT 30`))
    .map((r) => ({ sourceId: r.source_id, tickers: r.tickers || [] }));

  // A results outcome that was marked `not_required` and no sibling copy of the same stock produced verified numbers.
  const candidates = await run("misrouted results",
    `SELECT c.ticker, c.title, c.filing_category AS category, c.raw_text FROM corporate_announcements c
     WHERE c.deep_dive_status = 'not_required' AND c.created_at > NOW() - INTERVAL '${days} days'
       AND c.title ~* '(outcome|result)' AND ${VERIFIED_ELSEWHERE} LIMIT 60`);
  snap.misroutedResults = uniqByTicker(candidates.filter((r) => isResultsOutcomeFiling({ title: r.title, text: r.raw_text })))
    .map((r) => ({ ticker: r.ticker, title: r.title, category: r.category }));

  // Results statements that WERE processed but produced no verified numbers for the stock.
  const noNumbers = await run("results without numbers",
    `SELECT c.ticker, EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600 AS hours FROM corporate_announcements c
     WHERE c.filing_category = 'QUARTERLY_EARNINGS' AND c.deep_dive_status IN ('completed','needs_review')
       AND c.title ~* '^(outcome of board meeting|board meeting outcome|financial results|results)'
       AND c.created_at > NOW() - INTERVAL '${days} days' AND c.created_at < NOW() - INTERVAL '6 hours' AND ${VERIFIED_ELSEWHERE} LIMIT 30`);
  const already = new Set(snap.misroutedResults.map((r) => r.ticker));
  snap.resultsWithoutNumbers = uniqByTicker(noNumbers.filter((r) => !already.has(r.ticker))).map((r) => ({ ticker: r.ticker, filedHoursAgo: Number(r.hours) }));

  const judged = await run("conflicting stances",
    `SELECT ticker, COALESCE(filing_date, created_at) AS ts, event_analysis->'institutional_verdict'->>'final_action' AS action
     FROM corporate_announcements WHERE event_analysis->'institutional_verdict'->'verified_financials' IS NOT NULL
       AND event_analysis->'institutional_verdict'->>'final_action' IS NOT NULL AND COALESCE(filing_date, created_at) > NOW() - INTERVAL '5 days'
     ORDER BY ticker, COALESCE(filing_date, created_at)`);
  for (let i = 1; i < judged.length; i++) {
    const a = judged[i - 1], b = judged[i];
    if (a.ticker === b.ticker && stance(a.action) !== stance(b.action) && new Date(b.ts) - new Date(a.ts) < 48 * HOURS) snap.conflicts.push({ ticker: b.ticker });
  }

  const tables = await run("guidance tables", "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('guidance_pacing_history', 'guidance_outcomes')");
  snap.guidanceTablesMissing = snap.queryErrors.every((e) => !e.startsWith("guidance tables")) && tables.length < 2;

  if (sourceRoot) {
    try { snap.unreadableSources = findControlCharSources(sourceRoot); } catch (err) { snap.queryErrors.push(`source scan: ${err.message}`); }
  }
  return snap;
}

function uniqByTicker(rows) {
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.ticker) ? false : (seen.add(r.ticker), true)));
}
