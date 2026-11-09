import { loadEarningsReaction, formatReactionContext, indiaDate } from './earnings-reaction.service.js';
import { parseFiscalQuarter } from '../utils/fiscal-quarter.js';

/** Only statement-bearing results anchor the event, never the latest generic board outcome or concall. */
export function selectResultsEvents(rows) {
  const quarterKey = row => {
    const period = parseFiscalQuarter(row.reporting_period);
    if (period.key) return period.key;
    const date = row.vf?.quarterEnded;
    return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? parseFiscalQuarter(new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))).key : 0;
  };
  const selected = new Map();
  for (const row of [...rows].sort((a, b) => new Date(b.filing_date) - new Date(a.filing_date))) {
    const vf = row.vf;
    if (!vf?.isFinancialResult || vf.isVerified === false || vf.verification === 'LLM_LOCATED_TEXT_GROUNDED' || !Number.isFinite(Number(vf.revenue)) || vf.revenue == null || !row.attachment_url || row.foreign_filing === true || /intimation|will be held|scheduled|transcript|presentation|newspaper/i.test(row.title || '')) continue;
    const time = row.filing_date instanceof Date ? row.filing_date : new Date(row.filing_date);
    if (!Number.isFinite(time.getTime())) continue;
    const existing = selected.get(row.ticker);
    // Anchor the quarter's first disclosure, even when a later duplicate crosses midnight.
    // A subsequent correction to an older quarter must not replace the latest reported quarter.
    const key = quarterKey(row), previousKey = existing && quarterKey(existing);
    if (!existing || (key && previousKey && key > previousKey) || (key && key === previousKey) || (!key && !previousKey && indiaDate(new Date(existing.filing_date)) === indiaDate(time))) selected.set(row.ticker, row);
  }
  return [...selected.values()];
}

export async function loadEarningsReactionBoard(pool, { tickers = null, now = new Date(), loadReaction = loadEarningsReaction } = {}) {
  const { rows } = await pool.query(`
    SELECT ca.id, ca.ticker, ca.title, ca.filing_date, ca.attachment_url,
      ca.event_analysis->'institutional_verdict'->'verified_financials' AS vf,
      ca.event_analysis->'institutional_verdict'->>'final_action' AS fundamental_action,
      ca.event_analysis->'institutional_verdict'->>'reporting_period' AS reporting_period
    FROM corporate_announcements ca JOIN stocks s ON s.id = ca.stock_id
    WHERE s.category IN ('Core', 'Watchlist')
      AND ca.filing_date >= $1::timestamptz - INTERVAL '60 days' AND ca.filing_date <= $1::timestamptz
      AND ($2::text[] IS NULL OR ca.ticker = ANY($2::text[]))
      AND COALESCE(ca.event_analysis->>'foreign_filing', 'false') <> 'true'
      AND ca.event_analysis->'institutional_verdict'->'verified_financials' IS NOT NULL
    ORDER BY ca.ticker, ca.filing_date DESC`, [now.toISOString(), tickers]);
  const stocks = [];
  // Sequential stocks, shared/in-flight benchmark and bounded request deadlines: no portfolio-sized burst.
  for (const event of selectResultsEvents(rows)) {
    const reaction = await loadReaction({ ticker: event.ticker, publishedAt: event.filing_date, now });
    stocks.push({ ticker: event.ticker, filingId: event.id, filingDate: event.filing_date, filingUrl: event.attachment_url,
      reportingPeriod: event.reporting_period, fundamentalAction: event.fundamental_action,
      timestampBasis: 'STORED_EXCHANGE_TIMESTAMP_NOT_INDEPENDENTLY_REVERIFIED',
      reaction, context: formatReactionContext(reaction) });
  }
  return { generatedAt: now.toISOString(), benchmark: 'NIFTY_500', status: stocks.some(s => s.reaction.status === 'UNAVAILABLE') ? 'PARTIAL' : 'COMPLETE',
    note: 'Observed moves do not establish causation or a consensus beat. Valuation must be refreshed separately. Missing verified results are excluded.', stocks };
}

export function reactionBoardMarkdown(report) {
  const value = n => Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : 'unavailable';
  const window = (r, n) => r.windows?.[`D${n}`]?.status === 'OBSERVED' ? value(r.windows[`D${n}`].returnPct) : r.status === 'UNAVAILABLE' ? 'unavailable' : 'pending';
  return `# Earnings market reaction\n\nAs of ${report.generatedAt}. ${report.note}\n\nReturns from the last close before release, using provider-adjusted closes. D1/D3/D5 count completed trading sessions.\n\n| Stock | Results filed | D1 | D3 | D5 | Since release | Latest session |\n|---|---|---:|---:|---:|---:|---:|\n${report.stocks.map(s => `| ${s.ticker} | ${new Date(s.filingDate).toISOString()} | ${window(s.reaction, 1)} | ${window(s.reaction, 3)} | ${window(s.reaction, 5)} | ${value(s.reaction.latest?.returnPct)} | ${value(s.reaction.latestSession?.returnPct)} |`).join('\n')}\n\n${report.stocks.map(s => `## ${s.ticker}\n\n[Result filing](${s.filingUrl}); anchor ${s.timestampBasis}.\n\n${s.context}\n\n${s.reaction.flags?.join(', ') || s.reaction.reason || ''}`).join('\n\n')}\n`;
}
