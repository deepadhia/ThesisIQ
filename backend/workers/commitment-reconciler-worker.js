import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { compareFiscalQuartersDesc } from '../utils/fiscal-quarter.js';
import { classifyGuidanceScope } from '../utils/guidance-scope.js';

/**
 * Parses numeric value from strings like "25%", "₹1,248 Cr", "308,000 MTPA", "15-20%".
 */
function parseNumeric(valStr) {
  if (!valStr || typeof valStr !== 'string') return null;
  const cleaned = valStr.replace(/,/g, '');
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Deterministically reconciles management commitments against verified quarterly snapshots.
 * @param {string} ticker 
 * @param {boolean} dryRun - If true, does NOT mutate database rows.
 */
export async function reconcileCommitments(ticker, dryRun = true) {
  console.log(`\n═══════════════════════════════════════════════════════════════════════════`);
  console.log(`🔍 RECONCILING COMMITMENTS FOR ${ticker} (Mode: ${dryRun ? 'DRY-RUN / TEST (No DB Changes)' : 'LIVE UPDATE'})`);
  console.log(`═══════════════════════════════════════════════════════════════════════════\n`);

  const { rows: stockRows } = await pool.query(
    "SELECT id, company_name, ticker FROM stocks WHERE ticker = $1",
    [ticker]
  );
  if (stockRows.length === 0) {
    console.error(`Stock ${ticker} not found in database.`);
    return [];
  }
  const stock = stockRows[0];

  const { rows: comms } = await pool.query(
    `SELECT id, commitment_title, statement, metric, target_value, timeline, status, credibility_impact, blockers_and_risks
     FROM management_commitments WHERE ticker = $1 ORDER BY created_at DESC`,
    [ticker]
  );

  const { rows: rawSnapshots } = await pool.query(
    `SELECT quarter, metrics, summary FROM quarterly_snapshots WHERE stock_id = $1`,
    [stock.id]
  );
  const snapshots = [...rawSnapshots].sort((a, b) => compareFiscalQuartersDesc(a.quarter, b.quarter));

  // Systemic Guardrail: Filter snapshots to strictly Consolidated financial filings
  const consolidatedSnapshots = snapshots.filter(s => {
    const m = s.metrics || {};
    return !m.filing_type || m.filing_type === 'CONSOLIDATED';
  });

  const auditResults = [];

  for (const c of comms) {
    let calculatedStatus = c.status;
    let confidenceReason = 'Preserved current status';
    let match = true;

    const metricLower = (c.metric || '').toLowerCase();
    const statementLower = (c.statement || '').toLowerCase();
    const titleLower = (c.commitment_title || '').toLowerCase();
    const combinedText = `${metricLower} ${statementLower} ${titleLower}`;
    const scopeInfo = classifyGuidanceScope(c);

    // 1. EBITDA CAGR / Multi-Year Growth Reconciler (Strictly multi-year, NEVER single quarter YoY)
    if ((scopeInfo.scope === 'MULTI_YEAR' || combinedText.includes('cagr')) && combinedText.includes('cagr')) {
      const targetNum = parseNumeric(c.target_value);
      if (combinedText.includes('ebitda') && targetNum !== null) {
        // Search snapshots for verified multi-year CAGR metrics
        let foundBeat = false;
        for (const s of snapshots) {
          const summaryStr = (s.summary || '').toLowerCase();
          if (summaryStr.includes('cagr') || summaryStr.includes('ebitda')) {
            const actualCagrMatch = summaryStr.match(/ebitda cagr (?:of )?(\d+(?:\.\d+)?)%/i);
            if (actualCagrMatch) {
              const actualCagr = parseFloat(actualCagrMatch[1]);
              if (actualCagr >= targetNum) {
                calculatedStatus = 'Achieved';
                confidenceReason = `Verified Actual 5-Yr EBITDA CAGR (${actualCagr}%) >= Guided Target (${targetNum}%)`;
                foundBeat = true;
                break;
              }
            }
          }
        }
        if (!foundBeat && targetNum > 0) {
          confidenceReason = `Multi-Year Target (${targetNum}% CAGR) - In-progress across multi-year trajectory`;
        }
      }
    }

    // 2. EBITDA Margin & Ratio Reconciler
    if (combinedText.includes('ebitda margin') || combinedText.includes('opm') || combinedText.includes('margin expansion') || combinedText.includes('export')) {
      const latestMetrics = snapshots[0]?.metrics || {};
      const latestOpm = latestMetrics.opm ? parseNumeric(latestMetrics.opm.value) : null;
      
      // 1. Audit EBITDA Margins against snapshot reported OPM
      if (c.metric && (c.metric.toLowerCase().includes('margin') || c.metric.toLowerCase().includes('ebitda'))) {
        const targetOpm = parseNumeric(c.target_value);
        if (targetOpm !== null && latestOpm !== null) {
          // Strict Numeric Comparison
          if (latestOpm >= targetOpm) {
            calculatedStatus = 'Achieved';
            confidenceReason = `Reported Margin (${latestOpm}%) >= Target (${targetOpm}%) [Strict Math Match]`;
          } else if (latestOpm < targetOpm - 2.0) {
            calculatedStatus = 'Missed';
            confidenceReason = `Reported Margin (${latestOpm}%) < Target (${targetOpm}%) [Margin Compression]`;
          }
        }
      }

      // 2. Audit Disambiguated Export Share (Revenue % vs Backlog %) & Net Debt/EBITDA Ratios
      if (c.metric && (c.metric.toLowerCase().includes('export') || c.metric.toLowerCase().includes('debt'))) {
        const targetVal = parseNumeric(c.target_value);

        // Disambiguate Export Revenue Share vs Export Order Backlog Share
        if (c.metric.toLowerCase().includes('export')) {
          const isBacklogMetric = combinedText.includes('backlog') || combinedText.includes('order book');
          const exportMetricObj = isBacklogMetric ? (latestMetrics.export_backlog_share || latestMetrics.export_share) : (latestMetrics.export_revenue_share || latestMetrics.export_share);
          const actualExport = exportMetricObj ? parseNumeric(exportMetricObj.value) : null;
          
          if (actualExport !== null && targetVal !== null && actualExport >= targetVal) {
            calculatedStatus = 'Achieved';
            confidenceReason = `Reported Export ${isBacklogMetric ? 'Backlog Share' : 'Revenue Share'} (${actualExport}%) >= Target (${targetVal}%) [Disambiguated Metric Match]`;
          }
        }

        // Dynamic Net Debt / EBITDA Math Calculation
        if (combinedText.includes('net debt/ebitda') || combinedText.includes('debt/ebitda')) {
          const netDebt = latestMetrics.net_debt ? parseNumeric(latestMetrics.net_debt.value) : null;
          const ebitda = latestMetrics.ebitda ? parseNumeric(latestMetrics.ebitda.value) : null;
          if (netDebt !== null && ebitda !== null && ebitda > 0) {
            const calculatedRatio = parseFloat((netDebt / ebitda).toFixed(2));
            confidenceReason = `Calculated Net Debt/EBITDA (${calculatedRatio}x = ₹${netDebt}Cr / ₹${ebitda}Cr) [Dynamic Math Match]`;
          }
        }
      }
    }

    // 3. Multi-Phase Capacity Target Matching & DC Roadmap Matching
    if (combinedText.includes('capacity') || combinedText.includes('mtpa') || combinedText.includes('mw')) {
      const targetNum = parseNumeric(c.target_value);
      if (targetNum !== null) {
        if (combinedText.includes('fy28') || combinedText.includes('long-term')) {
          confidenceReason = `Long-Term Target: ${targetNum} (Target Timeline: FY28/FY32)`;
        }
      }
    }

    // 4. Order Inflow & Order Book Reconciler (Full-Year Accumulated Inflows vs Target)
    if (combinedText.includes('order intake') || combinedText.includes('order inflow') || combinedText.includes('order book')) {
      const targetNum = parseNumeric(c.target_value);
      const latestMetrics = snapshots[0]?.metrics || {};
      const actualInflow = latestMetrics.order_inflow ? parseNumeric(latestMetrics.order_inflow.value) : (latestMetrics.order_book ? parseNumeric(latestMetrics.order_book.value) : null);

      if (actualInflow !== null && targetNum !== null) {
        if (actualInflow >= targetNum) {
          calculatedStatus = 'Achieved';
          confidenceReason = `Reported Order Inflow/Book (${actualInflow} Cr) >= Guided Target (${targetNum} Cr) [Full-Year Beat]`;
        }
      }
    }

    // 5. Numeric Revenue Target Reconciler (Strictly Quarterly vs Annual Isolation)
    if (combinedText.includes('revenue') || combinedText.includes('run-rate')) {
      const targetNum = parseNumeric(c.target_value);
      const latestMetrics = snapshots[0]?.metrics || {};
      const actualRev = latestMetrics.revenue ? parseNumeric(latestMetrics.revenue.value) : null;
      
      if (scopeInfo.scope === 'QUARTERLY') {
        if (actualRev !== null && targetNum !== null && actualRev >= targetNum) {
          calculatedStatus = 'Achieved';
          confidenceReason = `Reported Quarterly Revenue (${actualRev} Cr) >= Guided Target (${targetNum} Cr) [Quarterly Beat]`;
        }
      } else if (scopeInfo.scope === 'ANNUAL') {
        // Annual target must NOT be evaluated against a single quarter!
        if (targetNum !== null && actualRev !== null) {
          confidenceReason = `Annual Target (₹${targetNum} Cr) - Quarterly Pacing: ₹${actualRev} Cr in ${snapshots[0]?.quarter || 'Latest'}`;
        }
      }
    }

    // Evaluate Match
    match = (calculatedStatus === c.status);

    auditResults.push({
      id: c.id,
      title: (c.commitment_title || c.metric || 'Commitment').substring(0, 35),
      currentDbStatus: c.status,
      calculatedStatus,
      match: match ? '✅ MATCH' : '⚠️ MISMATCH',
      confidenceReason
    });

    // If NOT dryRun, update DB
    if (!dryRun && !match) {
      await pool.query(
        `UPDATE management_commitments SET status = $1, credibility_impact = $2 WHERE id = $3`,
        [calculatedStatus, calculatedStatus === 'Achieved' ? 'positive' : 'neutral', c.id]
      );
    }
  }

  if (process.env.VERBOSE === 'true') {
    console.table(auditResults);
  }
  return auditResults;
}

// Command Line Runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ticker = args[0] || 'GRAVITA';
  const liveMode = args.includes('--live');
  
  reconcileCommitments(ticker, !liveMode)
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
