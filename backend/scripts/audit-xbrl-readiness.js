/** Read-only audit of structured financial coverage before changing the alert parser. */
import {pool} from '../db/pool.js';
try {
  const {rows}=await pool.query(`SELECT DISTINCT ON (ticker) ticker,quarter,period_end_date,source_preferred,revenue_from_ops,pat,ebitda,metric_sources,reliability_score,updated_at
    FROM xbrl_metrics_quarterly ORDER BY ticker,period_end_date DESC NULLS LAST,updated_at DESC`);
  const {rows:coverage}=await pool.query(`SELECT quarter,count(*)::int AS rows,count(*) FILTER (WHERE source_preferred='xml')::int AS xml_preferred,
    count(*) FILTER (WHERE revenue_from_ops IS NOT NULL AND pat IS NOT NULL)::int AS revenue_pat,
    max(updated_at) AS latest_updated FROM xbrl_metrics_quarterly GROUP BY quarter ORDER BY quarter DESC LIMIT 8`);
  const {rows:filings}=await pool.query(`SELECT id,ticker,title,filing_date,attachment_url FROM corporate_announcements
    WHERE filing_date>=NOW()-INTERVAL '45 days' AND (title ~* '(integrated filing|xbrl)' OR attachment_url ~* '(ixbrl|xbrl)')
    ORDER BY filing_date DESC LIMIT 40`);
  console.log(JSON.stringify({auditedAt:new Date().toISOString(),latestByTicker:rows,quarterCoverage:coverage,recentStructuredFilings:filings},null,2));
} finally {await pool.end();}
