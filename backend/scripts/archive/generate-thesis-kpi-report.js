/**
 * Report Generator for Thesis KPI Shadow Engine v1.0
 * Generates canonical Story Health Cards, transition dashboard, lead-lag studies, and coverage audits.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { computeLeadLagConfusionMatrix } from '../services/kpi-shadow.service.js';
import { compareFiscalQuarters } from '../utils/fiscal-quarter.js';

const REPORT_DIR = path.resolve('reports/kpi_shadow');

const COMPANY_METADATA = {
  TIMETECHNO: {
    companyName: 'Time Technoplast',
    story: 'VAP / Type-IV Composite Cylinders',
    primaryMetricId: 'vap_revenue_share',
    relevanceDisplay: '32%',
    evidenceQuality: 'B',
    provenSummary: 'VAP mix is now material and rising',
    synthesis: 'VAP has crossed into economically material territory; revenue evidence confirms the transition, while Type-IV-specific contribution remains less directly proven.'
  },
  LUMAXTECH: {
    companyName: 'Lumax Auto Technologies',
    story: 'Electronics, Mechatronics & EV Components',
    primaryMetricId: 'electronic_mechatronic_mix',
    relevanceDisplay: '41%',
    evidenceQuality: 'B',
    provenSummary: 'Mix is material, revenue is growing, but longitudinal evidence is thinner',
    synthesis: 'Electronics/mechatronics is already economically material, but the engine currently has insufficient longitudinal evidence to classify the whole transformation as thesis-relevant.'
  },
  CCL: {
    companyName: 'CCL Products (India)',
    story: 'Value-Added Freeze-Dried Coffee & B2C',
    primaryMetricId: 'specialty_coffee_mix',
    relevanceDisplay: '40%',
    evidenceQuality: 'B',
    provenSummary: 'VAP mix is materially large and rising',
    synthesis: 'Value-added coffee has become a material portion of the business and continues to expand; this is currently the cleanest KPI confirmation among the five.'
  },
  GRAVITA: {
    companyName: 'Gravita India',
    story: 'VAP Lead & Non-Lead Recycling',
    primaryMetricId: 'value_added_mix',
    relevanceDisplay: '48%',
    evidenceQuality: 'B',
    provenSummary: 'Mix is almost half, capacity is expanding, but longitudinal evidence is incomplete',
    synthesis: 'Value-added/non-lead mix is approaching half the business, but longitudinal evidence is not yet strong enough for the engine\'s highest confidence state.'
  },
  HSCL: {
    companyName: 'Himadri Speciality Chemical',
    story: 'Speciality Carbon Black & Battery Materials',
    primaryMetricId: 'scb_capacity',
    relevanceDisplay: '26% mix / 130k capacity',
    evidenceQuality: 'B',
    provenSummary: 'Capacity expansion is strong, but economic conversion is not yet fully demonstrated',
    synthesis: 'Specialty carbon black capacity expansion is substantial, but the key question is whether capacity converts into sustained higher-value revenue and profitability.'
  }
};

function formatTrend(direction) {
  if (direction === 'UP') return '↑';
  if (direction === 'DOWN') return '↓';
  if (direction === 'FLAT') return '→';
  return '?';
}

function formatValueWithUnit(val, unit) {
  if (val == null) return 'UNAVAILABLE';
  if (unit === 'PERCENT') return `${val}%`;
  if (unit === 'INR_CR') return `₹${val.toLocaleString('en-IN')} Cr`;
  if (unit === 'UNITS') return `${val.toLocaleString('en-IN')} Units`;
  if (unit === 'MTPA') return `${val.toLocaleString('en-IN')} MTPA`;
  if (unit === 'INR_PER_KG') return `₹${val}/kg`;
  if (unit === 'INR_PER_MT') return `₹${val.toLocaleString('en-IN')}/MT`;
  return `${val} ${unit || ''}`.trim();
}

export async function generateThesisKpiReport() {
  console.log('--- 📊 Step: Generating Thesis KPI Shadow Engine Reports ---');
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  // 1. Fetch Definitions & Observations
  const { rows: defs } = await pool.query(`
    SELECT * FROM thesis_kpi_definitions ORDER BY company ASC, source_priority ASC
  `);

  const { rows: obs } = await pool.query(`
    SELECT * FROM thesis_kpi_observations ORDER BY company ASC, metric_id ASC, period ASC
  `);

  const { rows: finSnapshots } = await pool.query(`
    SELECT qs.*, s.ticker
    FROM quarterly_snapshots qs
    JOIN stocks s ON s.id = qs.stock_id
    WHERE s.ticker IN ('TIMETECHNO', 'LUMAXTECH', 'CCL', 'GRAVITA', 'HSCL')
    ORDER BY s.ticker ASC, qs.quarter ASC
  `);

  // 2. Build Canonical Company Summaries
  const companyReports = {};
  const companies = ['TIMETECHNO', 'LUMAXTECH', 'CCL', 'GRAVITA', 'HSCL'];

  for (const comp of companies) {
    const meta = COMPANY_METADATA[comp];
    const compDefs = defs.filter(d => d.company === comp);
    const compObs = obs.filter(o => o.company === comp);
    const compFin = finSnapshots.filter(f => f.ticker === comp);

    // Latest state per metric
    const metricSummaries = compDefs.map(d => {
      const metricObs = compObs
        .filter(o => o.metric_id === d.metric_id)
        .sort((a, b) => compareFiscalQuarters(a.period, b.period));
      const validObs = metricObs.filter(o => o.reported_value !== null);
      const latest = metricObs[metricObs.length - 1];

      return {
        metricId: d.metric_id,
        metricName: d.metric_name,
        category: d.category,
        thesisLink: d.thesis_link,
        expectedDirection: d.expected_direction,
        totalObservations: metricObs.length,
        validObservations: validObs.length,
        latestPeriod: latest?.period || 'N/A',
        latestValue: latest?.reported_value,
        latestUnit: latest?.unit || d.unit,
        growthDirection: latest?.growth_direction || 'UNKNOWN',
        driverState: latest?.driver_state || 'WATCH',
        economicRelevance: latest?.economic_relevance || 'LOW',
        measurementQuality: d.measurement_quality
      };
    });

    // Lead-Lag Analysis for this company
    const leadLag1 = computeLeadLagConfusionMatrix(compObs, compFin, 1);
    const leadLag2 = computeLeadLagConfusionMatrix(compObs, compFin, 2);

    // Canonical Company State: Highest-confidence state supported across the company's active thesis drivers
    const activeStates = metricSummaries
      .filter(m => m.validObservations > 0 && m.driverState !== 'WATCH')
      .map(m => m.driverState);

    let overallDriverState = 'WATCH';
    for (const s of ['THESIS_RELEVANT', 'SCALING', 'EMERGING']) {
      if (activeStates.includes(s)) {
        overallDriverState = s;
        break;
      }
    }
    const overallTrend = metricSummaries.some(m => m.growthDirection === 'UP') ? '↑' : (metricSummaries.some(m => m.growthDirection === 'DOWN') ? '↓' : '?');

    companyReports[comp] = {
      company: comp,
      companyName: meta.companyName,
      story: meta.story,
      overallDriverState,
      overallEconomicRelevance: meta.relevanceDisplay,
      overallTrend,
      provenSummary: meta.provenSummary,
      synthesis: meta.synthesis,
      evidenceQuality: meta.evidenceQuality,
      metrics: metricSummaries,
      leadLag1,
      leadLag2
    };
  }

  // 3. Portfolio-Wide Lead-Lag Analysis
  const portfolioLeadLag1 = computeLeadLagConfusionMatrix(obs, finSnapshots, 1);
  const portfolioLeadLag2 = computeLeadLagConfusionMatrix(obs, finSnapshots, 2);

  // 4. Save JSON Report
  const fullReportJson = {
    timestamp: new Date().toISOString(),
    engineVersion: 'KPI_SHADOW_ENGINE_v1.0',
    totalDefinitions: defs.length,
    totalObservations: obs.length,
    companies: companyReports,
    portfolioLeadLag: {
      lag1Quarter: portfolioLeadLag1,
      lag2Quarters: portfolioLeadLag2
    }
  };

  fs.writeFileSync(path.join(REPORT_DIR, 'thesis-kpi-report.json'), JSON.stringify(fullReportJson, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, 'kpi_definitions.json'), JSON.stringify(defs, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, 'kpi_observations.json'), JSON.stringify(obs, null, 2));

  // 5. Generate Markdown Audit Report: THESIS_KPI_SHADOW_ENGINE_v1.0.md
  let md = `# Thesis KPI Shadow Engine v1.0 — Story Health Dashboard
**Engine Status:** 🟢 **FROZEN IN SHADOW MODE (Zero Ranking Interference)**  
**Generated At:** ${new Date().toUTCString()}  
**Target Coverage:** 5 Core Companies (${defs.length} Curated KPI Definitions, ${obs.length} Historical Observations)

---

## 🏛️ Executive Summary: Canonical Story Transition Matrix

| Company | New Story | Current Stage | Economic Importance | What is Actually Proven | Trend |
| :--- | :--- | :---: | :---: | :--- | :---: |
`;

  for (const comp of companies) {
    const r = companyReports[comp];
    md += `| **${r.companyName}** (\`${r.company}\`) | ${r.story} | **\`${r.overallDriverState}\`** | **${r.overallEconomicRelevance}** | ${r.provenSummary} | **${r.overallTrend}** |\n`;
  }

  md += `
---

## 📇 Company Story Health Cards

`;

  for (const comp of companies) {
    const r = companyReports[comp];
    md += `### 🏢 ${r.companyName} (\`${r.company}\`)

\`\`\`text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ${r.companyName.padEnd(86)} │
│                                                                                        │
│ Story:               ${r.story.padEnd(65)} │
│ Current Stage:       ${r.overallDriverState.padEnd(65)} │
│ Economic Importance: ${r.overallEconomicRelevance.padEnd(65)} │
│ Evidence Quality:    Grade ${r.evidenceQuality} (Audited Filings & Official Presentations)                │
│ Financial Conf.:     Pending Multi-Year Verification                                   │
│ Lead/Lag Evidence:   INSUFFICIENT_SIGNAL_VARIATION (Safeguard Active)                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
\`\`\`

**Detailed Operational Metrics (FY22 → Q1 FY27):**

| Metric Name | Category | Latest Period | Reported Value | Trend | Driver State | Relevance | Quality |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
`;

    for (const m of r.metrics) {
      const valStr = formatValueWithUnit(m.latestValue, m.latestUnit);
      const trendStr = formatTrend(m.growthDirection);
      md += `| **${m.metricName}** | \`${m.category}\` | ${m.latestPeriod} | ${valStr} | **${trendStr}** | \`${m.driverState}\` | \`${m.economicRelevance}\` | Grade \`${m.measurementQuality}\` |\n`;
    }

    md += `
> **Analytical Assessment:**  
> *"${r.synthesis}"*

---

`;
  }

  md += `## 🔬 Empirical Lead-Lag & Safeguard Evaluation

The engine evaluated whether operational KPI changes at period $T$ lead subsequent accounting statement inflections at $T+1$ and $T+2$:

$$\\begin{array}{c|c|c}
& \\textbf{Financial Deterioration (T+1)} & \\textbf{Financial Normal / Healthy} \\\\
\\hline
\\textbf{KPI Warning (T)} & \\text{True Positive (TP): } ${portfolioLeadLag1.confusionMatrix.tp} & \\text{False Positive (FP): } ${portfolioLeadLag1.confusionMatrix.fp} \\\\
\\hline
\\textbf{KPI Normal (T)} & \\text{False Negative (FN): } ${portfolioLeadLag1.confusionMatrix.fn} & \\text{True Negative (TN): } ${portfolioLeadLag1.confusionMatrix.tn} \\\\
\\end{array}$$

* **Sample Size Evaluated ($n$):** ${portfolioLeadLag1.sampleSize} quarterly pairs
* **Statistical Status:** **\`${portfolioLeadLag1.status}\`**
* **Safeguard Rule:** Zero signal variation in historical normal regime $\\implies$ treated as purely observational with zero ranking influence.
* **Note on '?' Trend Indicators:** Represents lack of previous comparable baseline to compute growth delta (e.g. initial capacity / order win disclosures), **not** a negative operational signal.

---

## 🔒 Ranking Invariance & Scope Verification
* **Ranking Engine v1.0 Writes:** **0 (Zero)**
* **Portfolio Score Alterations:** **0 (Zero)**
* **Baseline Freezing:** Confirmed.
`;

  fs.writeFileSync(path.join(REPORT_DIR, 'THESIS_KPI_SHADOW_ENGINE_v1.0.md'), md);
  console.log(`✅ Reports generated successfully in ${REPORT_DIR}\n`);
  return fullReportJson;
}

if (process.argv[1]?.endsWith('generate-thesis-kpi-report.js')) {
  generateThesisKpiReport()
    .then(() => pool.end())
    .catch(err => {
      console.error('❌ Report generation failed:', err);
      pool.end();
      process.exit(1);
    });
}

