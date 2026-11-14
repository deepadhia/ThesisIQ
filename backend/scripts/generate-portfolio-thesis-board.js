/**
 * 18-Stock Portfolio Thesis State Board Generator
 * 
 * Synthesizes:
 * 1. Financial Thesis Trajectory (Revenue, PAT, Margin Discipline)
 * 2. Operational Thesis & Business Drivers (VAP, Backlog, Capacity, Unit Economics)
 * 3. Economic Relevance Transitions (LOW -> RISING -> MATERIAL -> DOMINANT)
 * 4. Actionable Investor Decision Buckets (Strengthening, Intact/Transitioning, Weakening, Broken)
 * 
 * Outputs:
 *   - reports/thesis_board/PORTFOLIO_THESIS_STATE_BOARD.md
 *   - reports/thesis_board/portfolio-thesis-board.json
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { classifyThesisStateV2, reconcileSnapshotThesisState, THESIS_STATES } from '../services/thesis-state-engine.service.js';
import { getThesisContract } from '../services/thesis-driver-context.service.js';
import { compareFiscalQuarters } from '../utils/fiscal-quarter.js';
import { loadEarningsReactionBoard, reactionBoardMarkdown } from '../services/earnings-reaction-board.service.js';
import { loadThesisHealthInputs, buildThesisHealthReport, thesisHealthMarkdown } from '../services/thesis-health-tracker.service.js';

const OUTPUT_DIR = path.resolve('reports/thesis_board');

/**
 * Dynamically resolves operational driver metadata for any portfolio stock
 * from its thesis contract (driver-level-thesis-contracts.json / supplementary-thesis-contracts.json).
 * Adheres strictly to AGENTS.md Rule 3 (no static hardcoded ticker tables in backend code).
 */
function getOperationalMetadataForTicker(ticker) {
  const contract = getThesisContract(ticker);
  if (!contract || !contract.drivers || contract.drivers.length === 0) {
    return {
      coreDriver: contract?.thesisTitle || null,
      category: 'General',
      relevance: 'Core',
      direction: 'FLAT',
      kpiEvidence: 'Quarterly financial compounding and operating margins tracked in snapshots.',
      decisionQuestion: 'Is quarterly performance maintaining thesis trajectory?',
      bucket: '⚪ Unassessed (No Contract)'
    };
  }

  // Find primary driver (HIGH materiality or first driver)
  const primaryDriver = contract.drivers.find(d => d.materiality === 'HIGH') || contract.drivers[0];
  
  let direction = 'FLAT';
  const dirUpper = String(primaryDriver.direction || '').toUpperCase();
  if (dirUpper.includes('IMPROVING') || dirUpper.includes('UP')) direction = 'UP';
  else if (dirUpper.includes('DETERIORATING') || dirUpper.includes('DOWN')) direction = 'DOWN';

  let bucket = '🟡 Intact (Monitoring)';
  if (direction === 'UP') bucket = '🟢 Strengthening';
  else if (direction === 'DOWN') bucket = '🔴 Weakening';

  return {
    coreDriver: primaryDriver.name || contract.thesisTitle || 'Core Business Operations',
    category: primaryDriver.category || 'Operational Focus',
    relevance: primaryDriver.materiality ? `${primaryDriver.materiality} Materiality` : 'Core',
    direction,
    kpiEvidence: primaryDriver.currentEvidence || primaryDriver.mustBeTrue || 'Performance tracked against thesis drivers.',
    decisionQuestion: primaryDriver.falsificationTrigger ? `Does execution avoid falsification: "${primaryDriver.falsificationTrigger}"?` : 'Is quarterly performance maintaining thesis trajectory?',
    bucket
  };
}

export function buildPortfolioBoardRows({
  rankings = [],
  healthReport = null,
  snapshotMap = new Map(),
  reactionMap = new Map(),
  trackedStocks = []
} = {}) {
  const rankingList = Array.isArray(rankings) ? rankings : [];
  const rankingMap = new Map(rankingList.map(r => [r.ticker, r]));

  const candidates = [];
  const seenTickers = new Set();

  for (const r of rankingList) {
    if (r.ticker && !seenTickers.has(r.ticker)) {
      seenTickers.add(r.ticker);
      candidates.push({
        ticker: r.ticker,
        rank: r.rank ?? null,
        latestQuarter: r.latest_quarter ?? null,
        consolidatedScore: r.consolidated_score ?? null,
        trajectoryBonus: r.trajectory_bonus ?? null,
        thesisStatus: r.thesis_status ?? null
      });
    }
  }

  const healthStocks = Array.isArray(healthReport?.stocks) ? healthReport.stocks : [];
  for (const h of healthStocks) {
    if (h.ticker && !seenTickers.has(h.ticker)) {
      seenTickers.add(h.ticker);
      candidates.push({
        ticker: h.ticker,
        rank: null,
        latestQuarter: null,
        consolidatedScore: null,
        trajectoryBonus: null,
        thesisStatus: null
      });
    }
  }

  const stockList = Array.isArray(trackedStocks) ? trackedStocks : [];
  for (const s of stockList) {
    if (s.ticker && !seenTickers.has(s.ticker)) {
      seenTickers.add(s.ticker);
      candidates.push({
        ticker: s.ticker,
        rank: null,
        latestQuarter: null,
        consolidatedScore: null,
        trajectoryBonus: null,
        thesisStatus: null
      });
    }
  }

  const healthMap = new Map(healthStocks.map(s => [s.ticker, s]));

  return candidates.map(r => {
    const snap = snapshotMap.get(r.ticker) || {};
    const meta = getOperationalMetadataForTicker(r.ticker);
    const health = healthMap.get(r.ticker) || null;

    let bucket = meta.bucket;
    if (!meta.coreDriver || health?.fundamental?.status === 'INSUFFICIENT_EVIDENCE' || meta.bucket.includes('Unassessed')) {
      bucket = '⚪ Unassessed';
    }

    return {
      rank: r.rank,
      ticker: r.ticker,
      companyName: snap.company_name || r.ticker,
      latestQuarter: r.latestQuarter || snap.quarter || null,
      consolidatedScore: r.consolidatedScore,
      trajectoryBonus: r.trajectoryBonus,
      thesisStatus: r.thesisStatus || snap.thesis_status || null,
      marketReaction: reactionMap.get(r.ticker) || null,
      thesisHealth: health,
      coreDriver: meta.coreDriver || 'Core Business Operations',
      category: meta.category,
      economicRelevance: meta.relevance,
      operationalDirection: meta.direction,
      kpiEvidence: meta.kpiEvidence,
      decisionQuestion: meta.decisionQuestion,
      thesisBucket: bucket
    };
  });
}

export async function generatePortfolioThesisBoard() {
  console.log('--- 🏛️ Generating 18-Stock Portfolio Thesis State Board ---');
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 1. Fetch baseline ranking data
  const rankingPath = path.resolve('reports/kpi_shadow/ranking_before.json');
  let rankings = [];
  if (fs.existsSync(rankingPath)) {
    try {
      rankings = JSON.parse(fs.readFileSync(rankingPath, 'utf-8'));
    } catch {
      rankings = [];
    }
  }
  const rankingMap = new Map((rankings || []).map(r => [r.ticker, r]));

  // Query all tracked stocks so the board renders all active companies even when frozen ranking file is absent locally
  const { rows: trackedStocks } = await pool.query(`
    SELECT s.id, s.ticker, s.company_name
    FROM stocks s
    WHERE s.category IN ('Core', 'Watchlist') OR s.category IS NULL
    ORDER BY s.ticker ASC
  `);

  // 2. Fetch latest snapshot evidence chronologically (eliminates ASCII max(quarter) corruption)
  const { rows: snapshots } = await pool.query(`
    SELECT qs.*, s.ticker, s.company_name
    FROM quarterly_snapshots qs
    JOIN stocks s ON s.id = qs.stock_id
    ORDER BY s.ticker ASC
  `);

  const snapshotMap = new Map();
  for (const s of snapshots) {
    const existing = snapshotMap.get(s.ticker);
    if (!existing) {
      snapshotMap.set(s.ticker, s);
    } else {
      const cmp = compareFiscalQuarters(s.quarter, existing.quarter);
      if (cmp > 0 || (cmp === 0 && new Date(s.created_at || 0) > new Date(existing.created_at || 0))) {
        snapshotMap.set(s.ticker, s);
      }
    }
  }

  // Refreshed on every nightly board so D3/D5 mature without replaying a filing or resending its alert.
  let reactionReport = null;
  try {
    reactionReport = await loadEarningsReactionBoard(pool);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'earnings-reaction.json'), JSON.stringify(reactionReport, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'earnings-reaction.md'), reactionBoardMarkdown(reactionReport));
  } catch (err) {
    console.warn(`[THESIS BOARD] Market reaction unavailable: ${err.message}`);
  }
  const reactionMap = new Map((reactionReport?.stocks || []).map(s => [s.ticker, s]));

  // The frozen ranking may omit newly added stocks; health covers all tracked stocks.
  let healthReport = null;
  try {
    const inputs = await loadThesisHealthInputs(pool);
    healthReport = buildThesisHealthReport({ ...inputs, reactions: reactionReport?.stocks || [] });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'thesis-health.json'), JSON.stringify(healthReport, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'thesis-health.md'), thesisHealthMarkdown(healthReport));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'thesis-health-status.json'),
      JSON.stringify({ generatedAt: healthReport.generatedAt, status: 'COMPLETE', stocks: healthReport.stocks.length }, null, 2));
  } catch (err) {
    console.error('[THESIS BOARD] Thesis health refresh failed:', err);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'thesis-health-status.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), status: 'FAILED', reason: err.message }, null, 2));
  }
  const healthMap = new Map((healthReport?.stocks || []).map(s => [s.ticker, s]));

  // 3. Build unified portfolio board rows
  const boardRows = buildPortfolioBoardRows({
    rankings,
    healthReport,
    snapshotMap,
    reactionMap,
    trackedStocks
  });

  // 4. Save JSON Artifact
  const jsonReport = {
    timestamp: new Date().toISOString(),
    totalPortfolioStocks: boardRows.length,
    thesisBucketsSummary: {
      strengthening: boardRows.filter(b => b.thesisBucket.includes('Strengthening')).length,
      intactOrTransitioning: boardRows.filter(b => b.thesisBucket.includes('Transitioning') || b.thesisBucket.includes('Intact') || b.thesisBucket.includes('Stable')).length,
      weakeningOrInvestigating: boardRows.filter(b => b.thesisBucket.includes('Weakening')).length
    },
    stocks: boardRows
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'portfolio-thesis-board.json'), JSON.stringify(jsonReport, null, 2));

  // 5. Generate Markdown Board
  const strengtheningStocks = boardRows.filter(b => b.thesisBucket.includes('Strengthening')).map(b => `\`${b.ticker}\``).join(', ');
  const intactStocks = boardRows.filter(b => b.thesisBucket.includes('Transitioning') || b.thesisBucket.includes('Intact') || b.thesisBucket.includes('Stable')).map(b => `\`${b.ticker}\``).join(', ');
  const weakeningStocks = boardRows.filter(b => b.thesisBucket.includes('Weakening')).map(b => `\`${b.ticker}\``).join(', ');

  let md = `# 🏛️ 18-Stock Portfolio Thesis State Board
**Portfolio Status:** Active Multibagger Tracking Universe  
**Generated At:** ${new Date().toUTCString()}  
**System Invariant:** Synthesizes Frozen Financial Rankings with Grounded Operational KPI Evidence.

---

## 📊 Summary: Portfolio Thesis Allocation by Bucket

| Thesis Classification Bucket | Stock Count | Stocks in Cohort | Actionable Strategy |
| :--- | :---: | :--- | :--- |
| 🟢 **Thesis Strengthening** | **${boardRows.filter(b => b.thesisBucket.includes('Strengthening')).length}** | ${strengtheningStocks} | Compounding on track; Hold / Add on valuation dips. |
| 🟡 **Thesis Intact / Transitioning / Monitoring** | **${boardRows.filter(b => b.thesisBucket.includes('Transitioning') || b.thesisBucket.includes('Intact') || b.thesisBucket.includes('Stable')).length}** | ${intactStocks} | Operational drivers sound; Monitor quarterly confirmation. |
| 🔴 **Thesis Weakening / High Base Risk** | **${boardRows.filter(b => b.thesisBucket.includes('Weakening')).length}** | ${weakeningStocks} | Operational/cyclical slowdown; Active investigation required. |

---

## 📋 Comprehensive 18-Stock Thesis State Master Matrix

| Rank | Stock | Financial Score | Operational Business Driver | Economic Relevance | Operational Direction | Thesis State Bucket |
| :---: | :--- | :---: | :--- | :--- | :---: | :--- |
${boardRows.map(b => {
  const rankStr = b.rank !== 'N/A' && b.rank !== null && b.rank !== undefined ? `**#${b.rank}**` : `**-**`;
  const scoreStr = b.consolidatedScore !== null && b.consolidatedScore !== undefined
    ? `**${b.consolidatedScore.toLocaleString()}** (${b.trajectoryBonus >= 0 ? '+' + b.trajectoryBonus : b.trajectoryBonus} bonus)`
    : `*Unavailable*`;
  return `| ${rankStr} | **\`${b.ticker}\`** | ${scoreStr} | ${b.coreDriver} | \`${b.economicRelevance}\` | ${b.operationalDirection.includes('UP') ? '🟢 **' + b.operationalDirection + '**' : b.operationalDirection.includes('DOWN') ? '🔴 **' + b.operationalDirection + '**' : '🟡 **' + b.operationalDirection + '**'} | ${b.thesisBucket} |`;
}).join('\n')}

---

---

## 🔍 Detailed Stock-by-Stock Deep Dive

`;

  for (const b of boardRows) {
    const healthSummary = b.thesisHealth
      ? [b.thesisHealth.fundamental.status,
        b.thesisHealth.fundamental.currentness,
        `recorded conviction ${b.thesisHealth.fundamental.recordedSnapshotConviction ?? 'unavailable'}/10`,
        b.thesisHealth.fundamental.evidenceSignal,
        `price attribution ${b.thesisHealth.attribution}`].join(' | ')
      : 'Unavailable; see thesis-health-status.json';
    const rankHeader = b.rank !== 'N/A' && b.rank !== null && b.rank !== undefined ? `${b.rank}. ${b.ticker}` : b.ticker;
    const scoreLine = b.consolidatedScore !== null && b.consolidatedScore !== undefined
      ? `\`${b.consolidatedScore}\` (Base: \`${b.consolidatedScore - b.trajectoryBonus}\`, Trajectory Bonus: \`${b.trajectoryBonus >= 0 ? '+' + b.trajectoryBonus : b.trajectoryBonus}\`)`
      : '`Unavailable` (baseline ranking absent; scores not invented)';
    md += `### ${rankHeader} (${b.companyName})
* **Financial Thesis Score:** ${scoreLine}
* **Thesis State Bucket:** **${b.thesisBucket}**
* **Market reaction:** ${b.marketReaction?.context || 'Unavailable: no current verified results reaction.'}
* **Thesis health:** ${healthSummary} ([all tracked stocks](thesis-health.md))
* **Core Operational Driver:** **${b.coreDriver}** (${b.category})
* **Economic Relevance:** \`${b.economicRelevance}\` | **Operational Direction:** \`${b.operationalDirection}\`
* **Underlying Operational Evidence:**  
  ${b.kpiEvidence}
* **Critical Investor Monitoring Question:**  
  > *"${b.decisionQuestion}"*

---
`;
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'PORTFOLIO_THESIS_STATE_BOARD.md'), md);
  console.log(`✅ Portfolio Thesis State Board generated successfully in ${OUTPUT_DIR}\n`);
  return jsonReport;
}

if (process.argv[1]?.endsWith('generate-portfolio-thesis-board.js')) {
  generatePortfolioThesisBoard()
    .then(() => pool.end())
    .catch(err => {
      console.error('❌ Board generation failed:', err);
      pool.end();
      process.exit(1);
    });
}
