/**
 * Production Runner: ThesisIQ v3.2 Fundamental Trajectory & Management Evidence Dossier
 * 
 * Generates an institutional-grade Fundamental Trajectory & Action Context Dossier across 19 stocks:
 * - 5-Dimension Fundamental Reality: Credibility -> Guidance -> Growth -> Economic Quality -> Thesis Status
 * - The Three Truths Architecture: Observed Reality -> Forward Scenario -> Evidence-Adjusted Potential -> Underwriting
 * - Auditable Management Promise Ledger: Tracks claims across quarters against actual verified delivery
 * - Structured Position & Capital Directives: Decoupled existingPositionStatus and newCapitalStatus
 * - Stage-by-Stage Bottleneck Diagnostics (✅ / ❓ / ❌)
 * - Trajectory Confidence & Evidence-Backed Revision Signals (Zero scenario-to-action leakage)
 * - Conditional Multi-Underwriting Valuation Hurdle Price Matrix ("What price satisfies valuation hurdle for 22%, 28%, 32%, 35%?")
 * - Deep Dive Sensitivity Matrices: QPower, HBL, Transrail, Anant Raj, SJS, Shakti Pumps
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GROWTH_ENGINE_TYPE,
  THESIS_RISK_ENGINE_TYPE,
  EVIDENCE_STRENGTH_TIER,
  TRAJECTORY_CONFIDENCE,
  THESIS_REVISION_SIGNAL,
  UNDERWRITING_STATUS,
  BOTTLENECK_STATE,
  MANAGEMENT_CREDIBILITY_STATUS,
  GUIDANCE_STATUS,
  GROWTH_METRICS_TRAJECTORY,
  ECONOMIC_QUALITY_STATUS,
  THESIS_OPERATIONAL_STATUS,
  VALUATION_STATUS,
  EXISTING_POSITION_STATUS,
  NEW_CAPITAL_STATUS,
  ACTION_CONTEXT,
  PROMISE_CLAIM_TYPE,
  PROMISE_DELIVERY_STATUS,
  PROMISE_CREDIBILITY_IMPACT,
  MANAGEMENT_PROMISE_LEDGER,
  COHORT_TRAJECTORY_PROFILES,
  synthesizeCohortFundamentalTrajectories,
  evaluateFundamentalTrajectoryVector
} from '../services/fundamental-trajectory-engine.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function formatBottleneckSymbol(state) {
  if (state === BOTTLENECK_STATE.VERIFIED_HEALTHY) return '✅';
  if (state === BOTTLENECK_STATE.UNDER_OBSERVATION) return '❓';
  if (state === BOTTLENECK_STATE.IMPAIRED_BOTTLENECK) return '❌';
  return '—';
}

export function formatDeliveryStatusBadge(status) {
  if (status === PROMISE_DELIVERY_STATUS.DELIVERED_AHEAD || status === PROMISE_DELIVERY_STATUS.DELIVERED_ON_TIME) return `🟢 \`${status}\``;
  if (status === PROMISE_DELIVERY_STATUS.IN_PROGRESS_ON_TRACK) return `🔵 \`${status}\``;
  if (status === PROMISE_DELIVERY_STATUS.PENDING_OPERATIONAL_PROOF) return `🟡 \`${status}\``;
  if (status === PROMISE_DELIVERY_STATUS.DELAYED) return `🟠 \`${status}\``;
  if (status === PROMISE_DELIVERY_STATUS.MISSED || status === PROMISE_DELIVERY_STATUS.BROKEN) return `🔴 \`${status}\``;
  return `⚪ \`${status}\``;
}

export function runFundamentalTrajectoryReport() {
  const cohortVectors = synthesizeCohortFundamentalTrajectories();

  console.log('=============================================================================================================================');
  console.log('🏛️  THESISIQ v3.2: 5-DIMENSION FUNDAMENTAL REALITY & STRUCTURED POSITION DIRECTIVES (19 STOCKS)');
  console.log('=============================================================================================================================\n');

  console.log(
    'Ticker'.padEnd(12) +
    'Credibility'.padEnd(14) +
    'Guidance'.padEnd(14) +
    'Growth'.padEnd(16) +
    'Underwriting'.padEnd(18) +
    'Thesis Status'.padEnd(20) +
    'Existing Pos'.padEnd(24) +
    'New Capital'
  );
  console.log('-'.repeat(160));

  for (const v of cohortVectors) {
    console.log(
      v.ticker.padEnd(12) +
      v.managementCredibility.padEnd(14) +
      v.guidanceStatus.padEnd(14) +
      v.growthMetricsTrajectory.padEnd(16) +
      v.underwriting.underwritingStatus.padEnd(18) +
      v.thesisOperationalStatus.padEnd(20) +
      v.existingPositionStatus.padEnd(24) +
      v.newCapitalStatus
    );
  }

  // Generate Institutional Markdown Dossier
  const reportPath = path.resolve(__dirname, '../../reports/thesis_board/FUNDAMENTAL_TRAJECTORY_DOSSIER_V3_2.md');
  const dir = path.dirname(reportPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let md = `# ThesisIQ v3.2: Fundamental Trajectory & Management Evidence Dossier\n\n`;
  md += `**Execution Date**: September 20, 2026\n`;
  md += `**Cohort**: 19 Active Micro/Small/Mid-Cap Compounders\n`;
  md += `**Methodological Standard**: Three Truths Architecture & Management Promise Ledger with Frozen v3.1.1 Valuation Invariant\n\n`;

  md += `> [!IMPORTANT]\n`;
  md += `> **Architecture & Decision Mandate**:\n`;
  md += `> 1. **The Three Truths Framework**:\n`;
  md += `>    - **Observed Reality**: Audited historical & TTM financial metrics (Cannot change DCF).\n`;
  md += `>    - **Forward Scenario**: Theoretical operational potential across capacity/order engines (Cannot change DCF).\n`;
  md += `>    - **Evidence-Adjusted Potential**: Scenario potential discounted by evidence confidence factor $\\alpha$ (Cannot change DCF).\n`;
  md += `>    - **Underwriting**: Frozen v3.1.1 baseline assumptions (Can ONLY change upon explicit human analyst approval).\n`;
  md += `> 2. **Auditable Management Promise Ledger**: Permanent ledger tracking management claims across quarters against reported delivery, variance, and credibility impact.\n`;
  md += `> 3. **Structured Position & Capital Directives**: Decoupled \`existingPositionStatus\` from \`newCapitalStatus\`; zero prescriptive portfolio weight mandates.\n`;
  md += `> 4. **Non-Contradiction Invariant**: Eliminates false accumulation signals when underwritten rates are under review (e.g. HBL $\\to$ \`REVIEW_UNDERWRITING_BEFORE_ADDING\`).\n`;
  md += `> 5. **No Scenario-to-Action Leakage**: Model scenarios alone do NOT trigger revision signals or capital deployments without observed evidence.\n`;
  md += `> 6. **Independent Valuation Hurdle Price**: Formula $P_{\\text{hurdle}} = FV \\times (1 - \\text{MoS}_{\\text{required}})$; evaluated across evidence scenarios.\n\n`;

  md += `---\n\n`;
  md += `## Section 1: 5-Dimension Fundamental Reality & Structured Directives Board\n\n`;
  md += `| Ticker | Company Name | 1. Management Credibility | 2. Guidance Status | 3. Growth Trajectory | 4. Economic Quality | 5. Thesis Status | Underwriting Status | Existing Position Status | New Capital Status |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :--- |\n`;

  for (const v of cohortVectors) {
    let existingBadge = `\`${v.existingPositionStatus}\``;
    if (v.existingPositionStatus === EXISTING_POSITION_STATUS.HOLD_CORE_AND_MONITOR) existingBadge = `🟡 **\`${v.existingPositionStatus}\`**`;
    else if (v.existingPositionStatus === EXISTING_POSITION_STATUS.HOLD_CORE_COMPOUNDING) existingBadge = `🟢 **\`${v.existingPositionStatus}\`**`;
    else if (v.existingPositionStatus === EXISTING_POSITION_STATUS.HOLD_CORE_AWAITING_CASH_CONVERSION) existingBadge = `🟠 **\`${v.existingPositionStatus}\`**`;
    else if (v.existingPositionStatus === EXISTING_POSITION_STATUS.EXIT_THESIS_BROKEN) existingBadge = `🔴 **\`${v.existingPositionStatus}\`**`;
    else if (v.existingPositionStatus === EXISTING_POSITION_STATUS.TRIM_VALUATION_EXTREME) existingBadge = `🔵 **\`${v.existingPositionStatus}\`**`;

    let newCapBadge = `\`${v.newCapitalStatus}\``;
    if (v.newCapitalStatus === NEW_CAPITAL_STATUS.WAIT_FOR_VALUATION_HURDLE) newCapBadge = `🔵 **\`${v.newCapitalStatus}\`**`;
    else if (v.newCapitalStatus === NEW_CAPITAL_STATUS.REVIEW_UNDERWRITING_BEFORE_ADDING) newCapBadge = `🟣 **\`${v.newCapitalStatus}\`**`;
    else if (v.newCapitalStatus === NEW_CAPITAL_STATUS.DEPLOYMENT_SUPPORTED_BY_VALUATION) newCapBadge = `🟢 **\`${v.newCapitalStatus}\`**`;
    else if (v.newCapitalStatus === NEW_CAPITAL_STATUS.BLOCKED_THESIS_BROKEN || v.newCapitalStatus === NEW_CAPITAL_STATUS.BLOCKED_EXTREME_VALUATION) newCapBadge = `🔴 **\`${v.newCapitalStatus}\`**`;

    md += `| **\`${v.ticker}\`** | ${v.companyName} | \`${v.managementCredibility}\` | \`${v.guidanceStatus}\` | \`${v.growthMetricsTrajectory}\` | \`${v.economicQuality}\` | \`${v.thesisOperationalStatus}\` | \`${v.underwriting.underwritingStatus}\` | ${existingBadge} | ${newCapBadge} |\n`;
  }

  md += `\n---\n\n`;
  md += `## Section 2: The Three Truths Reconciliation Board\n\n`;
  md += `| Ticker | 1. Observed Reality (TTM YoY / Backlog / CFO) | 2. Forward Scenario Range | 3. Evidence Confidence ($\\alpha$) | Evidence-Adjusted Potential CAGR | 4. Current Underwriting | Underwriting Status | Thesis Revision Signal |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`;

  for (const v of cohortVectors) {
    const obsStr = `+${v.observedReality.ttmYoYGrowthPct.toFixed(1)}% YoY | ` + (v.observedReality.orderBookCr > 0 ? `₹${v.observedReality.orderBookCr} Cr Bklog | ` : '') + `CFO/PAT ${v.observedReality.cfoPatRatio.toFixed(2)}x`;
    const rangeStr = `[${v.forwardScenarioTrajectory.modeledNopatCagrRange[0].toFixed(1)}% – ${v.forwardScenarioTrajectory.modeledNopatCagrRange[1].toFixed(1)}%] (Base: ${v.forwardScenarioTrajectory.baseCaseModeledNopatCagr.toFixed(1)}%)`;
    const alphaStr = `$\\alpha = ${v.evidenceAdjustedPotential.evidenceConfidenceFactor.toFixed(2)}$`;
    const adjPotentialStr = `**${v.evidenceAdjustedPotential.evidenceAdjustedPotentialCagr.toFixed(1)}%** [${v.evidenceAdjustedPotential.evidenceAdjustedRange[0].toFixed(1)}%–${v.evidenceAdjustedPotential.evidenceAdjustedRange[1].toFixed(1)}%]`;
    
    let signalBadge = `\`${v.thesisRevisionSignal}\``;
    if (v.thesisRevisionSignal === THESIS_REVISION_SIGNAL.MONITOR_EVIDENCE_RAMP) signalBadge = `🟡 **\`${v.thesisRevisionSignal}\`**`;
    else if (v.thesisRevisionSignal === THESIS_REVISION_SIGNAL.REVISION_SUPPORTED_ACCELERATION) signalBadge = `🟢 **\`${v.thesisRevisionSignal}\`**`;
    else if (v.thesisRevisionSignal === THESIS_REVISION_SIGNAL.EXECUTION_FRICTION_WATCH) signalBadge = `🟠 **\`${v.thesisRevisionSignal}\`**`;
    else if (v.thesisRevisionSignal === THESIS_REVISION_SIGNAL.POTENTIAL_DECELERATION || v.thesisRevisionSignal === THESIS_REVISION_SIGNAL.POTENTIAL_ACCELERATION) signalBadge = `🔵 **\`${v.thesisRevisionSignal}\`**`;
    else if (v.thesisRevisionSignal === THESIS_REVISION_SIGNAL.REVISION_SUPPORTED_DECELERATION) signalBadge = `🔴 **\`${v.thesisRevisionSignal}\`**`;

    md += `| **\`${v.ticker}\`** | ${obsStr} | ${rangeStr} | ${alphaStr} | ${adjPotentialStr} | **${v.underwriting.underwrittenNopatCagrPct.toFixed(1)}%** | \`${v.underwriting.underwritingStatus}\` | ${signalBadge} |\n`;
  }

  md += `\n---\n\n`;
  md += `## Section 3: Stage-by-Stage Bottleneck Diagnostic Board\n\n`;
  md += `| Ticker | 1. Demand Visibility | 2. Capacity Supply | 3. Operational Utilization | 4. Pricing & Margins | 5. Working Capital / Cash | 6. Capital Efficiency (iROIC) | Diagnostic State Summary |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |\n`;

  for (const v of cohortVectors) {
    const b = v.bottleneckDiagnostic.stages;
    let summary = 'Clean execution flow across all stages.';
    if (b.WORKING_CAPITAL_CASH === BOTTLENECK_STATE.IMPAIRED_BOTTLENECK) {
      summary = '⚠️ **Severe Working Capital Drag**: Cash conversion failing to match revenue.';
    } else if (b.OPERATIONAL_UTILIZATION === BOTTLENECK_STATE.UNDER_OBSERVATION) {
      summary = '🔍 **Commissioning / Ramp Watch**: Capacity ready; awaiting utilization proof.';
    }

    md += `| **\`${v.ticker}\`** | ${formatBottleneckSymbol(b.DEMAND_VISIBILITY)} | ${formatBottleneckSymbol(b.CAPACITY_SUPPLY)} | ${formatBottleneckSymbol(b.OPERATIONAL_UTILIZATION)} | ${formatBottleneckSymbol(b.PRICING_MARGINS)} | ${formatBottleneckSymbol(b.WORKING_CAPITAL_CASH)} | ${formatBottleneckSymbol(b.CAPITAL_EFFICIENCY)} | ${summary} |\n`;
  }

  md += `\n---\n\n`;
  md += `## Section 4: Fundamental Catch-Up vs Price Catch-Up Velocity Board\n\n`;
  md += `Evaluates whether price appreciation reflects fundamental earnings compounding or valuation/expectation expansion between baseline and current reality.\n\n`;
  md += `| Ticker | Δ Price (%) | Δ NOPAT (%) | Δ Fair Value (%) | Trajectory Gap (% pts) | Catch-Up Dynamics Regime | Analytical Interpretation |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`;

  for (const v of cohortVectors) {
    const d = v.catchUpDynamics;
    let regimeBadge = `\`${d.catchUpRegime}\``;
    if (d.catchUpRegime === 'PRICE_AHEAD_OF_FUNDAMENTALS') regimeBadge = `🟡 **\`${d.catchUpRegime}\`**`;
    else if (d.catchUpRegime === 'FUNDAMENTALS_AHEAD_OF_PRICE') regimeBadge = `🟢 **\`${d.catchUpRegime}\`**`;
    else if (d.catchUpRegime === 'PRICE_AND_FUNDAMENTALS_ALIGNED') regimeBadge = `🔵 **\`${d.catchUpRegime}\`**`;
    else if (d.catchUpRegime === 'FUNDAMENTALS_DETERIORATING') regimeBadge = `🔴 **\`${d.catchUpRegime}\`**`;

    const priceSign = d.deltaPricePct > 0 ? `+${d.deltaPricePct}%` : `${d.deltaPricePct}%`;
    const nopatSign = d.deltaNopatPct > 0 ? `+${d.deltaNopatPct}%` : `${d.deltaNopatPct}%`;
    const fvSign = d.deltaFairValuePct > 0 ? `+${d.deltaFairValuePct}%` : `${d.deltaFairValuePct}%`;
    const gapSign = d.trajectoryGapPctPts > 0 ? `+${d.trajectoryGapPctPts}% pts` : `${d.trajectoryGapPctPts}% pts`;

    md += `| **\`${v.ticker}\`** | ${priceSign} | ${nopatSign} | ${fvSign} | ${gapSign} | ${regimeBadge} | ${d.interpretation} |\n`;
  }

  md += `\n---\n\n`;
  md += `## Section 5: The Auditable Management Promise Ledger & Track Record\n\n`;
  md += `Tracks historical concall claims, capacity timelines, and margin guidance across quarters to verify whether previous management statements turned into actual financial delivery.\n\n`;
  md += `| Ticker | Quarter | Claim Type | Management Claim | Source & Evidence Tier | Target Deadline | Actual Reported Delivery | Delivery Status | Credibility Impact |\n`;
  md += `| :--- | :---: | :--- | :--- | :--- | :---: | :--- | :---: | :---: |\n`;

  for (const [ticker, entries] of Object.entries(MANAGEMENT_PROMISE_LEDGER)) {
    for (const item of entries) {
      md += `| **\`${ticker}\`** | ${item.quarter} | \`${item.claimType}\` | "${item.managementClaim}" | ${item.source} (\`${item.evidenceTier}\`) | ${item.deadline} | ${item.actualReportedDelivery} | ${formatDeliveryStatusBadge(item.status)} | \`${item.credibilityImpact}\` |\n`;
    }
  }

  // Deep Dive 1: QPower (QPOWER)
  const qpower = cohortVectors.find(v => v.ticker === 'QPOWER');
  if (qpower && qpower.forwardScenarioTrajectory.scenarios) {
    md += `\n---\n\n`;
    md += `## Section 6: Deep-Dive Analysis — QPower (QPOWER)\n\n`;
    md += `### The Core Investment Dilemma\n`;
    md += `> *"I am sitting on a +70% gain in QPower. The current v3.1.1 DCF indicates a model fair value of ₹438 versus CMP ₹1,426 (−32.5% modeled 3Y IRR). Should I execute an automatic stop-loss exit or wait for operational evidence?"*\n\n`;
    
    md += `### The Verdict: \`HOLD_CORE_AND_MONITOR\` | New Capital: \`WAIT_FOR_VALUATION_HURDLE\`\n`;
    md += `**Do NOT execute an automatic stop-loss exit based purely on trailing multiples (82.9× P/E).**\n`;
    md += `The fundamental evidence from Q1 FY27 indicates an accelerating operating engine rather than a broken thesis:\n`;
    md += `1. **Q1 Revenue**: ₹256.4 Cr (+32% YoY growth).\n`;
    md += `2. **Operating Margins**: Adjusted EBITDA of ₹72.5 Cr (28.3% margin) after isolating Turkey hyperinflation adjustments; pricing discipline maintained without sacrificing realization.\n`;
    md += `3. **Order Book**: ₹1,945 Cr (~1.9× FY26 revenue, ~15-month executable visibility).\n`;
    md += `4. **Sangli Expansion**: 8× capacity for key product lines, trial production targeted August 2026. Management explicitly guided a temporary Q3 P&L drag (depreciation, manpower, unabsorbed power) before fixed-cost absorption over the following 15 months.\n\n`;

    md += `### The Three Truths for QPower\n`;
    md += `- **Observed Reality**: Q1 revenue +32% YoY, EBITDA margin 28.3% (adjusted), Order backlog ₹1,945 Cr, CFO/PAT 0.85x, forward iROIC 33.9%.\n`;
    md += `- **Forward Scenario Potential**: 25% util $\\to$ 14.6% CAGR | 50% util $\\to$ 37.6% CAGR | 75% util $\\to$ 55.4% CAGR | 100% util $\\to$ 68.0% CAGR.\n`;
    md += `- **Evidence Confidence Adjustment ($\\alpha = 0.75$)**: $37.6\\% \\times 0.75 = \\mathbf{28.2\\%}$ evidence-adjusted potential CAGR. *Capacity potential $\\neq$ verified cash delivery.* Discount reflects trial run status.\n`;
    md += `- **Underwriting Baseline**: Frozen at **22.0%** (Fair Value ₹438.17). Human analyst approval required before revision to 28%–32%.\n\n`;

    md += `### Sangli Capacity-to-Earnings Sensitivity Matrix\n\n`;
    md += `| Sangli Utilization | Total Revenue (₹ Cr) | Incremental Revenue (₹ Cr) | EBITDA Margin (%) | Total EBITDA (₹ Cr) | Total NOPAT (₹ Cr) | Incremental NOA (₹ Cr) | Incremental ROIC (%) | Implied 3Y NOPAT CAGR | Evidence-Adjusted Potential ($\\alpha=0.75$) | Revision Potential |\n`;
    md += `| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |\n`;

    for (const sc of qpower.forwardScenarioTrajectory.scenarios) {
      const adjCagr = (sc.impliedNopatCagrPct * 0.75).toFixed(1);
      const revPot = sc.impliedNopatCagrPct >= 25.0 ? '🟢 Potential 28%–32% Case' : '⚪ Baseline 22% Case';
      md += `| **${sc.utilizationPct}%** | ₹${sc.totalRevenueCr} | +₹${sc.incrementalRevenueCr} | ${sc.effectiveEbitdaMarginPct.toFixed(1)}% | ₹${sc.totalEbitdaCr} | ₹${sc.totalNopatCr} | ₹${sc.totalIncrementalNoa} | **${sc.incrementalRoicPct.toFixed(1)}%** | **${sc.impliedNopatCagrPct.toFixed(1)}%** | **${adjCagr}%** | ${revPot} |\n`;
    }

    md += `\n### Conditional Multi-Underwriting DCF Valuation Hurdle Matrix\n\n`;
    md += `| Evidence Scenario | Modeled NOPAT CAGR | DCF Fair Value (₹) | Valuation Hurdle Price (₹) [25% MoS] | CMP vs FV Implied 3Y IRR | Valuation Assessment | Capital Action Guidance |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`;

    for (const dcfSc of qpower.conditionalDcfMatrix) {
      md += `| **${dcfSc.label}** | **${dcfSc.nopatCagrPct.toFixed(1)}%** | **₹${dcfSc.fairValuePrice.toFixed(2)}** | **₹${dcfSc.valuationHurdlePrice.toFixed(2)}** | **${dcfSc.implied3YrIrrPct.toFixed(1)}%** | \`${dcfSc.valuationConclusion}\` | Hurdle Entry: **₹${dcfSc.valuationHurdlePrice.toFixed(2)}** |\n`;
    }

    md += `\n### Concrete Thesis Breakers for QPower\n`;
    for (const tb of qpower.thesisBreakers) {
      md += `- ❌ **${tb}**\n`;
    }
  }

  // Deep Dive 2: HBL Power Systems (HBLENGINE)
  const hbl = cohortVectors.find(v => v.ticker === 'HBLENGINE');
  if (hbl) {
    md += `\n---\n\n`;
    md += `## Section 7: Deep-Dive Analysis — HBL Power Systems (HBLENGINE)\n\n`;
    md += `### Resolving the Underwriting vs Action Dilemma\n`;
    md += `- **Observed Reality**: TTM Revenue ₹2,150 Cr (+28% YoY), EBITDA margin 22.0%, Order Backlog ₹2,800 Cr, CFO/PAT 0.82x, Forward iROIC 32.0%.\n`;
    md += `- **Forward Scenario (Pure Backlog Burn)**: Conservative 4.5% | Base Case 12.5% | Accelerated 18.9% (without assuming continuous tender renewals).\n`;
    md += `- **Current Underwriting**: **28.0%** (Fair Value ₹1,042.36 | Valuation Hurdle Price ₹781.77 | CMP ₹722.00).\n`;
    md += `- **Underwriting Status**: \`TOO_AGGRESSIVE\` / \`UNDER_REVIEW\`.\n`;
    md += `- **Structured Directives**:\n`;
    md += `  - **Existing Position**: \`HOLD_CORE_AND_MONITOR\`\n`;
    md += `  - **New Capital**: \`REVIEW_UNDERWRITING_BEFORE_ADDING\`\n`;
    md += `  - **Why?**: The core business is excellent and strengthening (+28% YoY), but the 28% underwritten CAGR assumes flawless tender execution. Re-underwrite baseline before committing fresh capital.\n\n`;

    md += `### Concrete Thesis Breakers for HBL\n`;
    for (const tb of hbl.thesisBreakers) {
      md += `- ❌ **${tb}**\n`;
    }
  }

  // Deep Dive 3: Transrail Lighting (TRANSRAILL)
  const transrail = cohortVectors.find(v => v.ticker === 'TRANSRAILL');
  if (transrail) {
    md += `\n---\n\n`;
    md += `## Section 8: Deep-Dive Analysis — Transrail Lighting (TRANSRAILL)\n\n`;
    md += `### The Working Capital Conversion Paradox\n`;
    md += `- **Demand & Backlog**: Massive ₹10,500 Cr order book (~2.5× revenue) with +22% YoY revenue growth.\n`;
    md += `- **The Fatal Bottleneck**: **115-day receivables drag** ($CFO/PAT = 0.50\\text{x}$), consuming cash and suppressing free cash flow.\n`;
    md += `- **Underwriting Status**: \`UNDER_REVIEW\` | Revision Signal: \`EXECUTION_FRICTION_WATCH\`.\n`;
    md += `- **Structured Directives**:\n`;
    md += `  - **Existing Position**: \`HOLD_CORE_AWAITING_CASH_CONVERSION\`\n`;
    md += `  - **New Capital**: \`WAIT_FOR_CASH_CONVERSION\` (Hurdle: ₹538.11, but blocked until DSO < 90 days and positive CFO).\n\n`;

    md += `### Concrete Thesis Breakers for Transrail\n`;
    for (const tb of transrail.thesisBreakers) {
      md += `- ❌ **${tb}**\n`;
    }
  }

  // Deep Dive 4: Shakti Pumps (SHAKTIPUMP)
  const shakti = cohortVectors.find(v => v.ticker === 'SHAKTIPUMP');
  if (shakti) {
    md += `\n---\n\n`;
    md += `## Section 9: Deep-Dive Analysis — Shakti Pumps (SHAKTIPUMP)\n\n`;
    md += `### The Broken Thesis / Value Trap Case\n`;
    md += `- **Observed Reality**: 140-day receivables blowout, CFO/PAT 0.15x, severe subsidy dependence.\n`;
    md += `- **Underwriting Status**: \`BROKEN\` | Revision Signal: \`REVISION_SUPPORTED_DECELERATION\`.\n`;
    md += `- **Structured Directives**:\n`;
    md += `  - **Existing Position**: \`EXIT_THESIS_BROKEN\`\n`;
    md += `  - **New Capital**: \`BLOCKED_THESIS_BROKEN\`\n`;
    md += `  - **Key Invariant**: Valuation discount cannot rescue broken unit economics or structural subsidy impairment.\n\n`;
  }

  fs.writeFileSync(reportPath, md, 'utf-8');
  console.log(`\n✅ Institutional Fundamental Trajectory Dossier successfully written to: ${reportPath}`);
}

// Execute report if called directly
runFundamentalTrajectoryReport();
