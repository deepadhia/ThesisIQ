import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool.js';
import { getIndianFiscalQuarter, reconcilePriorGuidanceVsActual } from '../workers/quarterly-deepdive-worker.js';
import { extractTextFromPdfUrl } from '../services/announcement.service.js';
import { extractDeterministicFinancials } from '../services/financial-validator.service.js';
import { evaluateDualLayerActionGate } from '../services/thesis-gate-evaluator.service.js';
import { getVerifiedGroundTruth } from '../services/verified-data-layer.service.js';

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('🧪 RUNNING COMPREHENSIVE Q1 PORTFOLIO STRESS TEST & COMMITMENT MATCH AUDIT');
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  const { rows: stocks } = await pool.query(`
    SELECT id, ticker, company_name, category 
    FROM stocks 
    WHERE (category IN ('Core', 'Watchlist') OR category IS NULL)
    ORDER BY ticker ASC;
  `);

  console.log(`Auditing ${stocks.length} portfolio stocks for Q1 FY27 earnings & commitments matching...\n`);

  const reportPath = path.resolve('reports/q1_stress_test_commitments_audit.md');
  let md = `# Q1 FY27 Comprehensive Portfolio Stress Test & Guidance Match Audit\n\n`;
  md += `**Execution Time**: ${new Date().toISOString()}  \n`;
  md += `**Scope**: All ${stocks.length} portfolio equities  \n`;
  md += `**Mode**: Offline dry-run (Zero Telegram alerts dispatched)  \n\n`;
  md += `| Ticker | Company Name | Category | Q1 Rev (Cr) | YoY Rev % | EBITDA (Cr) | OPM % | PAT (Cr) | Gate Action | Guidance Matched | Pending Comms | Anomalies |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :---: | :--- |\n`;

  const results = [];

  for (const stock of stocks) {
    const t = stock.ticker;
    console.log(`▶ Auditing [${t}] - ${stock.company_name}...`);

    // 1. Fetch latest Q1 earnings announcement
    const { rows: annRows } = await pool.query(`
      SELECT id, title, raw_text, filing_date, attachment_url, is_earnings_release, event_analysis
      FROM corporate_announcements
      WHERE ticker = $1 
        AND filing_date >= '2026-06-01'
        AND (
          is_earnings_release = true 
          OR title ILIKE '%Financial Result%' 
          OR title ILIKE '%un-audited%' 
          OR title ILIKE '%unaudited%'
          OR title ILIKE '%statement of financial%'
        )
      ORDER BY filing_date DESC LIMIT 1;
    `, [t]);

    let docText = '';
    let filingTitle = 'N/A';
    let filingDate = 'N/A';
    let attachmentUrl = '';

    if (annRows.length > 0) {
      const ann = annRows[0];
      filingTitle = ann.title;
      filingDate = ann.filing_date ? new Date(ann.filing_date).toISOString().slice(0, 10) : 'N/A';
      attachmentUrl = ann.attachment_url || '';
      docText = ann.raw_text || '';

      if ((!docText || docText.length < 100) && attachmentUrl) {
        try {
          process.stdout.write(`  [${t}] Downloading PDF... `);
          const parsed = await extractTextFromPdfUrl(attachmentUrl);
          if (parsed && parsed.length > 50) {
            docText = parsed;
            console.log(`OK (${docText.length} chars)`);
          } else {
            console.log(`Minimal text (${docText.length} chars)`);
          }
        } catch (err) {
          console.log(`Failed (${err.message})`);
        }
      }
    }

    // 2. Extract deterministic financials
    const extractedFin = extractDeterministicFinancials(docText, filingTitle);
    const groundTruth = getVerifiedGroundTruth(t);

    const deterministicFin = (extractedFin && extractedFin.revenue)
      ? extractedFin
      : (groundTruth && groundTruth.revenue ? {
          isFinancialResult: true,
          revenue: groundTruth.revenue,
          revenueYoYGrowthPct: groundTruth.revenueYoYGrowthPct,
          ebitda: groundTruth.ebitda,
          ebitdaMarginPct: groundTruth.ebitdaMarginPct,
          ebitdaMarginBpsDelta: groundTruth.ebitdaMarginBpsDelta,
          patConsolidated: groundTruth.patConsolidated,
          patAttributable: groundTruth.patConsolidated,
          patYoYGrowthPct: groundTruth.patYoYGrowthPct,
          isYoYDecline: groundTruth.patYoYGrowthPct !== null && groundTruth.patYoYGrowthPct < 0,
          isMarginErosion: Boolean(groundTruth.isMarginErosion) || (groundTruth.ebitdaMarginBpsDelta !== null && groundTruth.ebitdaMarginBpsDelta < -100),
          exceptionalGain: groundTruth.EXCEPTIONAL_ITEM || null,
          normalisedPat: groundTruth.CORE_PAT || null
        } : extractedFin || {});

    // 3. Evaluate Dual-Layer Action Gate
    let gateResult = null;
    if (deterministicFin && deterministicFin.revenue) {
      gateResult = evaluateDualLayerActionGate({
        ticker: t,
        financialData: deterministicFin,
        proposedAction: 'HOLD',
        llmConviction: 7
      });
    }

    // 4. Reconcile previous quarter guidance vs actual delivered
    const priorGuidanceComp = await reconcilePriorGuidanceVsActual(t, 'Q1_FY27', deterministicFin);

    // 5. Query active commitments from management_commitments table
    const { rows: commRows } = await pool.query(`
      SELECT statement, metric, target_value, timeline, status 
      FROM management_commitments 
      WHERE ticker = $1 
      ORDER BY created_at DESC LIMIT 5;
    `, [t]);

    const pendingCount = commRows.filter(c => c.status === 'Pending').length;
    const achievedCount = commRows.filter(c => c.status === 'Achieved').length;

    let guidanceMatchedStr = 'No Prior Q Guidance';
    if (priorGuidanceComp && priorGuidanceComp.guidedValue) {
      guidanceMatchedStr = `Guided: ${priorGuidanceComp.guidedValue} -> Delivered: ${priorGuidanceComp.actualValue} (${priorGuidanceComp.verdictBadge})`;
    }

    const anomalies = [];
    if (!deterministicFin.revenue) anomalies.push('Financials unavailable');
    if (priorGuidanceComp && priorGuidanceComp.annual && priorGuidanceComp.annual.verdictBadge.includes('MISSED')) {
      anomalies.push('Annual guidance false miss flag');
    }

    const resObj = {
      ticker: t,
      company: stock.company_name,
      category: stock.category,
      revenue: deterministicFin.revenue ? `₹${deterministicFin.revenue}` : 'N/A',
      revGrowth: deterministicFin.revenueYoYGrowthPct != null ? `${deterministicFin.revenueYoYGrowthPct}%` : 'N/A',
      ebitda: deterministicFin.ebitda ? `₹${deterministicFin.ebitda}` : 'N/A',
      opm: deterministicFin.ebitdaMarginPct != null ? `${deterministicFin.ebitdaMarginPct}%` : 'N/A',
      pat: deterministicFin.patConsolidated ? `₹${deterministicFin.patConsolidated}` : 'N/A',
      gateAction: gateResult ? gateResult.finalAction : 'PENDING_DATA',
      gateStatus: gateResult ? gateResult.statusClassification : 'N/A',
      guidanceMatched: guidanceMatchedStr,
      pendingComms: pendingCount,
      achievedComms: achievedCount,
      anomalies: anomalies.length > 0 ? anomalies.join('; ') : 'None'
    };

    results.push(resObj);

    md += `| **\`${t}\`** | ${stock.company_name} | ${stock.category} | ${resObj.revenue} | ${resObj.revGrowth} | ${resObj.ebitda} | ${resObj.opm} | ${resObj.pat} | \`${resObj.gateAction}\` | ${guidanceMatchedStr} | ${pendingCount} | ${resObj.anomalies === 'None' ? '✅ Clean' : '⚠️ ' + resObj.anomalies} |\n`;
  }

  // Write detailed stock-by-stock section to markdown
  md += `\n\n## 📋 Detailed Stock-by-Stock Guidance & Commitment Breakdown\n\n`;
  for (const r of results) {
    const { rows: stockComms } = await pool.query(`
      SELECT statement, metric, target_value, timeline, status, evidence_summary
      FROM management_commitments 
      WHERE ticker = $1 
      ORDER BY created_at DESC LIMIT 6;
    `, [r.ticker]);

    md += `### ${r.ticker} — ${r.company} (${r.category})\n`;
    md += `- **Reported Financials**: Revenue: ${r.revenue} (${r.revGrowth} YoY) | EBITDA: ${r.ebitda} (Margin: ${r.opm}) | PAT: ${r.pat}\n`;
    md += `- **Gate Verdict**: \`${r.gateAction}\` (${r.gateStatus})\n`;
    md += `- **Guidance Delivery**: ${r.guidanceMatched}\n`;
    md += `- **Active Tracked Commitments (${stockComms.length} shown)**:\n`;
    if (stockComms.length === 0) {
      md += `  * *No commitments tracked yet in database.*\n`;
    } else {
      for (const c of stockComms) {
        const badge = c.status === 'Achieved' ? '🟢 [ACHIEVED]' : (c.status === 'Missed' ? '🔴 [MISSED]' : '⏳ [PENDING]');
        md += `  * ${badge} **${c.statement}** (Metric: \`${c.metric || 'General'}\` | Target: \`${c.target_value || 'N/A'}\` | Timeline: \`${c.timeline || 'Ongoing'}\`)\n`;
      }
    }
    md += `\n`;
  }

  fs.writeFileSync(reportPath, md, 'utf-8');

  console.log('\n════════════════════════════════════════════════════════════════════════════');
  console.log('📊 Q1 STRESS TEST RESULTS SUMMARY ACROSS ALL 20 STOCKS');
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  console.table(results.map(r => ({
    Ticker: r.ticker,
    'Rev (Cr)': r.revenue,
    'YoY %': r.revGrowth,
    'OPM %': r.opm,
    PAT: r.pat,
    'Gate Action': r.gateAction,
    'Guidance Matched': r.guidanceMatched.length > 35 ? r.guidanceMatched.slice(0, 32) + '...' : r.guidanceMatched,
    'Pending Comms': r.pendingComms,
    Anomalies: r.anomalies
  })));

  console.log(`\n📄 Saved complete report with detailed commitments to: ${reportPath}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error during stress test:', err);
  process.exit(1);
});
