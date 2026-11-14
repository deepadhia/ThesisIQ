/** Read-only, bounded report of recent filing processing and alert delivery. */
import { pool } from '../db/pool.js';
import { gatherHealthSnapshot, evaluatePipelineHealth } from '../services/pipeline-health.service.js';

const daysArg = Number(process.argv[process.argv.indexOf('--days') + 1]);
const days = Number.isInteger(daysArg) && daysArg >= 1 && daysArg <= 30 ? daysArg : 7;

try {
  const [recent, health, commitments, daily, scanner] = await Promise.all([
    pool.query(`SELECT id,ticker,title,summary,filing_date,status,deep_dive_status,filing_category,sent_to_telegram,
      event_analysis->>'alert_sent_at' AS alert_sent_at,
      event_analysis->>'alert_pending' AS alert_pending,
      event_analysis->>'pipeline_error' AS pipeline_error,
      event_analysis->'institutional_verdict'->>'final_action' AS action,
      event_analysis->'institutional_verdict'->'source_document'->>'announcement_id' AS verdict_source_id,
      event_analysis->'institutional_verdict'->'highlight_extraction' AS highlight_extraction,
      event_analysis->'institutional_verdict'->'verified_financials' AS verified_financials,
      event_analysis->>'repair_followups_pending' AS repair_followups_pending
      FROM corporate_announcements WHERE filing_date>=NOW()-($1::int * INTERVAL '1 day')
      ORDER BY filing_date DESC`, [days]),
    gatherHealthSnapshot(pool, { lookbackDays: days }),
    pool.query(`SELECT id,ticker,status,statement,target_value,evidence_summary FROM management_commitments
      WHERE status LIKE 'Achieved%' AND statement ~* '(board approv|propos)' AND statement ~* '(acqui|stake|equity|merger|investment)' ORDER BY created_at DESC LIMIT 30`),
    pool.query(`SELECT filing_date::date AS day,count(*)::int AS rows,count(*) FILTER (WHERE deep_dive_status='completed')::int AS completed,
      count(*) FILTER (WHERE deep_dive_status='not_required')::int AS not_required,
      count(*) FILTER (WHERE event_analysis->>'foreign_filing'='true')::int AS foreign_flagged,
      max(created_at) AS newest_created_at
      FROM corporate_announcements WHERE filing_date>=NOW()-($1::int * INTERVAL '1 day') GROUP BY 1 ORDER BY 1 DESC`, [days]),
    pool.query(`SELECT key,updated_at,value FROM system_settings WHERE key IN ('last_bse_time','last_nse_time','scan_lease','ocr_provider_cooldown')`)
  ]);
  const rows = recent.rows;
  const counts = {};
  for (const r of rows) counts[r.deep_dive_status || 'null'] = (counts[r.deep_dive_status || 'null'] || 0) + 1;
  const suspicious = rows.filter(r =>
    ['needs_review', 'pending_stage1', 'pending_stage2', 'pending_audio', 'failed'].includes(r.deep_dive_status) ||
    r.alert_pending === 'true' ||
    (r.deep_dive_status === 'completed' && r.verdict_source_id && r.verdict_source_id !== r.id) ||
    r.highlight_extraction?.status === 'INCOMPLETE' ||
    r.repair_followups_pending === 'true');
  const compact = r => ({ id:r.id,ticker:r.ticker,date:r.filing_date,title:r.title,summary:r.summary,status:r.status,deepDive:r.deep_dive_status,category:r.filing_category,sent:r.sent_to_telegram,alertSentAt:r.alert_sent_at,alertPending:r.alert_pending,error:r.pipeline_error,action:r.action,verdictSourceId:r.verdict_source_id,highlights:r.highlight_extraction,financials:r.verified_financials,repairFollowupsPending:r.repair_followups_pending });
  console.log(JSON.stringify({ auditedAt:new Date().toISOString(),days,recentRows:rows.length,latestFiling:rows[0] ? compact(rows[0]) : null,daily:daily.rows,scanner:scanner.rows,statusCounts:counts,findings:evaluatePipelineHealth(health),healthQueryErrors:health.queryErrors,suspicious:suspicious.map(compact),...(process.argv.includes('--all') ? { filings:rows.map(compact) } : {}),prematureCommitments:commitments.rows },null,2));
} finally {
  await pool.end();
}
