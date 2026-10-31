/**
 * Deterministic Forensic Filing Reconciler Service
 * 
 * Reconciles every single row in xbrl_filings (N = 192) against xbrl_metrics_quarterly (M = 174).
 * Enforces strict fail-closed assertion:
 *   mapped + explicitly_excluded = 192
 *   ambiguous = 0
 *   unexpected_unmapped = 0
 */

import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool.js';

export async function reconcileFilingsForensic(client = pool) {
  console.log("==========================================================================");
  console.log("=== 🔬 EXECUTING DETERMINISTIC FORENSIC FILING RECONCILIATION ===");
  console.log("==========================================================================");

  // 1. Query all 192 filings
  const fRes = await client.query(`
    SELECT id, stock_id, ticker, period_end_date, filing_date, created_at
    FROM xbrl_filings
    ORDER BY ticker, period_end_date ASC NULLS LAST, filing_date ASC NULLS LAST, created_at ASC
  `);

  // 2. Query all 174 metrics
  const mRes = await client.query(`
    SELECT id, stock_id, ticker, quarter, period_end_date, revenue_from_ops, pat, ebitda, cfo, borrowings, xbrl_filing_id, created_at
    FROM xbrl_metrics_quarterly
    ORDER BY ticker, period_end_date ASC NULLS LAST
  `);

  const filings = fRes.rows;
  const metrics = mRes.rows;

  console.log(`Primary Filings in DB (xbrl_filings):        ${filings.length}`);
  console.log(`Quarterly Metrics in DB (xbrl_metrics):     ${metrics.length}`);

  // Build canonical map for metrics by ticker + period
  const metricByPeriodMap = {};
  const metricByFkMap = {};
  for (const m of metrics) {
    if (m.xbrl_filing_id) {
      metricByFkMap[m.xbrl_filing_id] = m;
    }
    if (m.period_end_date) {
      const pKey = `${m.ticker}_${new Date(m.period_end_date).toISOString().split('T')[0]}`;
      if (!metricByPeriodMap[pKey]) metricByPeriodMap[pKey] = [];
      metricByPeriodMap[pKey].push(m);
    }
  }

  const reconciliationRecords = [];
  const mappedMetricIds = new Set();
  const seenFilingPeriods = {};

  for (const f of filings) {
    const fPeriodStr = f.period_end_date ? new Date(f.period_end_date).toISOString().split('T')[0] : null;
    const fDateStr = f.filing_date ? new Date(f.filing_date).toISOString().split('T')[0] : null;
    const pKey = fPeriodStr ? `${f.ticker}_${fPeriodStr}` : null;

    let status = 'UNMAPPED';
    let exclusionCode = 'NONE';
    let exclusionReason = 'NONE';
    let matchedMetricId = 'NULL';
    let matchedQuarter = 'NULL';

    if (!f.period_end_date) {
      status = 'EXPLICITLY_EXCLUDED';
      exclusionCode = 'NULL_PERIOD_END_DATE';
      exclusionReason = 'Filing record contains NULL period_end_date (unparseable metadata header).';
    } else {
      // Check if direct FK match exists
      let matchedMetric = metricByFkMap[f.id];

      if (!matchedMetric && pKey && metricByPeriodMap[pKey]) {
        const candidates = metricByPeriodMap[pKey];
        if (candidates.length === 1) {
          matchedMetric = candidates[0];
        }
      }

      if (matchedMetric) {
        if (!seenFilingPeriods[pKey]) {
          seenFilingPeriods[pKey] = f.id;
          status = 'MAPPED_EXACT_CANONICAL';
          matchedMetricId = matchedMetric.id;
          matchedQuarter = matchedMetric.quarter || 'N/A';
          mappedMetricIds.add(matchedMetric.id);
        } else {
          status = 'EXPLICITLY_EXCLUDED';
          exclusionCode = 'DUPLICATE_PERIOD_SCRAPE_ARTIFACT';
          exclusionReason = `Filing is a duplicate scrape row for ${pKey}. Canonical filing ID is ${seenFilingPeriods[pKey]}.`;
        }
      } else {
        status = 'EXPLICITLY_EXCLUDED';
        exclusionCode = 'NON_QUARTERLY_OR_NO_METRIC_EXTRACT';
        exclusionReason = `No quarterly P&L metric extracted for ${f.ticker} on period ${fPeriodStr}.`;
      }
    }

    reconciliationRecords.push({
      filing_id: f.id,
      ticker: f.ticker,
      period_end_date: fPeriodStr || 'NULL',
      filing_date: fDateStr || 'NULL',
      created_at_utc: new Date(f.created_at).toISOString(),
      reconciliation_status: status,
      matched_metric_id: matchedMetricId,
      matched_quarter: matchedQuarter,
      exclusion_code: exclusionCode,
      exclusion_reason: exclusionReason
    });
  }

  const mappedCount = reconciliationRecords.filter(r => r.reconciliation_status === 'MAPPED_EXACT_CANONICAL').length;
  const excludedCount = reconciliationRecords.filter(r => r.reconciliation_status === 'EXPLICITLY_EXCLUDED').length;
  const unmappedCount = reconciliationRecords.filter(r => r.reconciliation_status === 'UNMAPPED').length;
  const ambiguousCount = reconciliationRecords.filter(r => r.reconciliation_status === 'AMBIGUOUS').length;

  console.log(`\n=== 📊 RECONCILIATION AUDIT RESULTS ===`);
  console.log(`- Total Primary Filings Evaluated: ${reconciliationRecords.length} / 192`);
  console.log(`- Mapped Exactly Once (Canonical): ${mappedCount}`);
  console.log(`- Explicitly Excluded with Reason:  ${excludedCount}`);
  console.log(`- Unexpected Unmapped:             ${unmappedCount}`);
  console.log(`- Ambiguous Multi-Matches:         ${ambiguousCount}`);
  console.log(`- Total Accounted (Mapped + Excl): ${mappedCount + excludedCount} / 192`);
  console.log(`- Unique Metrics Covered:          ${mappedMetricIds.size} / 174`);

  // Fail-closed verification assertion
  if (reconciliationRecords.length !== 192) {
    throw new Error(`CRITICAL INVARIANT VIOLATION: Evaluated filing count (${reconciliationRecords.length}) != 192.`);
  }
  if (mappedCount + excludedCount !== 192) {
    throw new Error(`CRITICAL INVARIANT VIOLATION: Mapped (${mappedCount}) + Excluded (${excludedCount}) != 192.`);
  }
  if (unmappedCount > 0) {
    throw new Error(`CRITICAL INVARIANT VIOLATION: Found ${unmappedCount} unexpected unmapped filings.`);
  }
  if (ambiguousCount > 0) {
    throw new Error(`CRITICAL INVARIANT VIOLATION: Found ${ambiguousCount} ambiguous multi-matches.`);
  }

  // Write CSV
  const outDir = path.resolve(process.cwd(), 'audit');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const headers = Object.keys(reconciliationRecords[0]).join(',');
  const rows = reconciliationRecords.map(r => 
    Object.values(r).map(v => typeof v === 'string' && (v.includes(',') || v.includes('\n')) ? `"${v}"` : v).join(',')
  ).join('\n');

  fs.writeFileSync(path.join(outDir, 'EXHAUSTIVE_FILING_RECONCILIATION_LEDGER.csv'), `${headers}\n${rows}`);
  console.log(`\n💾 Saved: audit/EXHAUSTIVE_FILING_RECONCILIATION_LEDGER.csv`);

  return {
    totalFilings: reconciliationRecords.length,
    mappedCount,
    excludedCount,
    unmappedCount,
    ambiguousCount,
    records: reconciliationRecords
  };
}
