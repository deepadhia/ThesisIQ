import { compareFiscalQuarters, parseFiscalQuarter } from '../utils/fiscal-quarter.js';
import { THESIS_STATES } from './thesis-state-engine.service.js';

const DRIVER_STATES = new Set(['CONFIRMED', 'ON_TRACK', 'AT_RISK', 'BROKEN']);
const VALID_THESIS_STATES = new Set(Object.values(THESIS_STATES));
const finiteScore = value => {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
};
const validDate = value => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};
const round2 = value => Math.round(value * 100) / 100;

/**
 * A descriptive health view over saved evidence. Price cannot change a
 * fundamental status or conviction, and unexplained moves are not called speculation.
 */
export function assessThesisHealth({ stock, snapshots = [], filings = [], reaction = null } = {}) {
  const ticker = String(stock?.ticker || '').toUpperCase();
  const orderedSnapshots = [...snapshots].sort((a, b) =>
    compareFiscalQuarters(b.quarter, a.quarter) || validDate(b.created_at) - validDate(a.created_at));
  const latestSnapshot = orderedSnapshots[0];
  const sourceRows = [...filings].filter(row =>
    row.deep_dive_status === 'completed' && row.attachment_url &&
    row.event_analysis?.institutional_verdict &&
    row.event_analysis.institutional_verdict.highlight_extraction?.status !== 'INCOMPLETE'
  ).sort((a, b) => validDate(b.filing_date) - validDate(a.filing_date));

  const verifiedResult = sourceRows.find(row => {
    const vf = row.event_analysis.institutional_verdict.verified_financials;
    return vf?.isFinancialResult === true && vf?.isVerified === true &&
      finiteScore(row.event_analysis.institutional_verdict.conviction_score) !== null;
  });
  const drivers = new Map();
  for (const row of sourceRows) {
    const assessments = row.event_analysis.institutional_verdict.thesis_driver_assessment;
    for (const item of Array.isArray(assessments) ? assessments : []) {
      const name = String(item?.driver || '').trim();
      const status = String(item?.status || '').toUpperCase();
      if (!name || !DRIVER_STATES.has(status) || drivers.has(name.toLowerCase()) ||
          !String(item.evidence || '').trim()) continue;
      drivers.set(name.toLowerCase(), {
        driver: name, status, evidence: String(item.evidence).slice(0, 400),
        filingId: row.id, sourceUrl: row.attachment_url, filingDate: row.filing_date,
        verification: 'RECORDED_ASSESSMENT_REQUIRES_SOURCE_REPLAY'
      });
    }
  }
  const observations = [...drivers.values()];
  const adverse = observations.some(d => d.status === 'BROKEN' || d.status === 'AT_RISK');
  const positive = observations.some(d => d.status === 'CONFIRMED' || d.status === 'ON_TRACK');
  const evidenceSignal = adverse && positive ? 'MIXED_RECORDED' :
    adverse ? 'ADVERSE_RECORDED' : positive ? 'POSITIVE_RECORDED' : 'INSUFFICIENT_EVIDENCE';
  const recordedSnapshotStatus = latestSnapshot?.thesis_status || null;
  const snapshotState = recordedSnapshotStatus || THESIS_STATES.INSUFFICIENT_EVIDENCE;
  const snapshotQuarterKey = parseFiscalQuarter(latestSnapshot?.quarter).key;
  const resultQuarter = row => {
    const vf = row.event_analysis?.institutional_verdict?.verified_financials;
    if (vf?.isFinancialResult !== true) return 0;
    const date = vf.quarterEnded;
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const label = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${date}T00:00:00Z`));
      return parseFiscalQuarter(label).key;
    }
    return parseFiscalQuarter(row.event_analysis.institutional_verdict.reporting_period).key;
  };
  const newerResult = sourceRows.find(row => resultQuarter(row) > snapshotQuarterKey);
  const currentness = newerResult ? 'NEWER_RESULT_UNASSESSED' :
    latestSnapshot ? 'SNAPSHOT_CURRENT_FOR_KNOWN_RESULTS' : 'NO_SNAPSHOT';

  const measured = reaction?.reaction?.status === 'OBSERVED' ? reaction.reaction : null;
  const observedReturns = measured ? [
    ...Object.values(measured.windows || {}).filter(w => w?.status === 'OBSERVED').map(w => w.returnPct),
    measured.latest?.returnPct
  ].filter(Number.isFinite) : [];
  const latestReturn = measured?.latest?.returnPct;
  const observedWindowMaxToLatestPp = Number.isFinite(latestReturn) && observedReturns.length
    ? round2(Math.max(...observedReturns) - latestReturn) : null;
  const reviewReasons = [];
  if (recordedSnapshotStatus && !VALID_THESIS_STATES.has(recordedSnapshotStatus)) reviewReasons.push('LEGACY_STATUS_VOCABULARY');
  if (!verifiedResult) reviewReasons.push('NO_STRICTLY_VERIFIED_RESULT_CONVICTION');
  if (newerResult) reviewReasons.push('NEWER_RESULT_THAN_SNAPSHOT');
  if (sourceRows.length < filings.length) reviewReasons.push('INCOMPLETE_OR_UNLINKED_FILING');
  if (adverse && /STRENGTHEN|CONFIRMED|BEAT/i.test(snapshotState)) reviewReasons.push('ADVERSE_DRIVER_VS_POSITIVE_SNAPSHOT');

  return {
    ticker, companyName: stock?.company_name || ticker,
    fundamental: {
      status: snapshotState, recordedSnapshotStatus, statusQuarter: latestSnapshot?.quarter || null,
      currentness, newerResultFilingId: newerResult?.id || null,
      newerResultSourceUrl: newerResult?.attachment_url || null,
      quarterlyHistory: orderedSnapshots.slice(0, 4).map(s => ({
        quarter: s.quarter, recordedStatus: s.thesis_status || null,
        recordedConviction: finiteScore(s.conviction_score)
      })),
      statusBasis: !latestSnapshot ? 'NO_QUARTERLY_SNAPSHOT' :
        VALID_THESIS_STATES.has(recordedSnapshotStatus) ? 'SAVED_CANONICAL_SNAPSHOT' : 'SAVED_LEGACY_SNAPSHOT',
      conviction: verifiedResult ? finiteScore(verifiedResult.event_analysis.institutional_verdict.conviction_score) : null,
      recordedSnapshotConviction: finiteScore(latestSnapshot?.conviction_score),
      convictionFilingId: verifiedResult?.id || null,
      convictionSourceUrl: verifiedResult?.attachment_url || null,
      evidenceSignal, drivers: observations,
      reviewRequired: reviewReasons.length > 0, reviewReasons
    },
    market: {
      reactionStatus: measured ? 'OBSERVED' : reaction?.reaction?.status || 'UNAVAILABLE',
      resultFilingId: reaction?.filingId || null,
      windows: measured?.windows || null,
      latestObservationDate: measured?.latest?.date || null,
      observedWindowMaxToLatestPp,
      latestReturnPct: Number.isFinite(latestReturn) ? latestReturn : null,
      note: 'Observed reaction is separate from business evidence; causation is not established.'
    },
    attribution: 'UNDETERMINED'
  };
}

export function buildThesisHealthReport({ stocks = [], snapshots = [], filings = [], reactions = [], now = new Date() } = {}) {
  const byTicker = (rows, key = 'ticker') => {
    const map = new Map();
    for (const row of rows) {
      const ticker = String(row?.[key] || '').toUpperCase();
      if (!map.has(ticker)) map.set(ticker, []);
      map.get(ticker).push(row);
    }
    return map;
  };
  const snapMap = byTicker(snapshots);
  const filingMap = byTicker(filings);
  const reactionMap = new Map(reactions.map(row => [String(row.ticker || '').toUpperCase(), row]));
  return {
    generatedAt: now.toISOString(), version: 1,
    note: 'Saved thesis assessments need source replay. Market reaction does not determine fundamental conviction or prove causation.',
    stocks: stocks.map(stock => assessThesisHealth({
      stock, snapshots: snapMap.get(String(stock.ticker).toUpperCase()) || [],
      filings: filingMap.get(String(stock.ticker).toUpperCase()) || [],
      reaction: reactionMap.get(String(stock.ticker).toUpperCase()) || null
    }))
  };
}

export async function loadThesisHealthInputs(pool) {
  const { rows: stocks } = await pool.query(
    `SELECT id, ticker, company_name, investment_thesis FROM stocks WHERE category IN ('Core', 'Watchlist') ORDER BY ticker`);
  if (!stocks.length) return { stocks, snapshots: [], filings: [] };
  const tickers = stocks.map(s => s.ticker);
  const [{ rows: snapshots }, { rows: filings }] = await Promise.all([
    pool.query(`SELECT qs.*, s.ticker FROM quarterly_snapshots qs JOIN stocks s ON s.id = qs.stock_id
      WHERE s.ticker = ANY($1::text[])`, [tickers]),
    pool.query(`SELECT * FROM (
      SELECT ca.id, ca.ticker, ca.filing_date, ca.attachment_url, ca.deep_dive_status, ca.event_analysis,
        ROW_NUMBER() OVER (PARTITION BY ca.ticker ORDER BY ca.filing_date DESC) AS rn
      FROM corporate_announcements ca WHERE ca.ticker = ANY($1::text[])
        AND ca.filing_date >= NOW() - INTERVAL '370 days'
        AND ca.event_analysis->'institutional_verdict' IS NOT NULL
    ) recent WHERE rn <= 24`, [tickers])
  ]);
  return { stocks, snapshots, filings };
}

export function thesisHealthMarkdown(report) {
  const lines = [
    '# Portfolio thesis health',
    '',
    `Generated: ${report.generatedAt}. ${report.note}`,
    '',
    '| Stock | Saved thesis state | Recorded / strictly verified conviction | Driver evidence | Price reaction | Attribution |',
    '|---|---|---:|---|---|---|'
  ];
  for (const row of report.stocks) {
    lines.push(`| ${row.ticker} | ${row.fundamental.status} (${row.fundamental.statusQuarter || 'no quarter'}; ${row.fundamental.currentness}) | ${row.fundamental.recordedSnapshotConviction ?? 'unavailable'} / ${row.fundamental.conviction ?? 'unavailable'} | ${row.fundamental.evidenceSignal}${row.fundamental.reviewRequired ? '; REVIEW' : ''} | ${row.market.reactionStatus}${row.market.observedWindowMaxToLatestPp === null ? '' : `; observed window maximum to latest ${row.market.observedWindowMaxToLatestPp} pp`} | ${row.attribution} |`);
  }
  for (const row of report.stocks) {
    lines.push('', `## ${row.ticker}`, '', `Fundamental status source: ${row.fundamental.statusBasis}. Strictly verified conviction: ${row.fundamental.conviction ?? 'unavailable'}; recorded snapshot conviction: ${row.fundamental.recordedSnapshotConviction ?? 'unavailable'}. Conviction source: ${row.fundamental.convictionSourceUrl || 'unavailable'}. Review reasons: ${row.fundamental.reviewReasons.join(', ') || 'none'}.`);
    lines.push(`- Last four quarters: ${row.fundamental.quarterlyHistory.map(q => `${q.quarter}: ${q.recordedStatus || 'unknown'} (${q.recordedConviction ?? 'no score'}/10)`).join('; ') || 'unavailable'}.`);
    for (const driver of row.fundamental.drivers) {
      lines.push(`- ${driver.driver}: ${driver.status} — ${driver.evidence} ([filing](${driver.sourceUrl})); ${driver.verification}.`);
    }
    lines.push(`- Market: ${row.market.note} Attribution: ${row.attribution}.`);
  }
  return lines.join('\n') + '\n';
}
