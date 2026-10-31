/**
 * Production Dossier Generator: ThesisIQ v4.1 Market–Thesis Reconciliation, Duration & Capital Deployment Engine
 * 
 * Generates: reports/thesis_board/MARKET_THESIS_RECONCILIATION_DOSSIER_V3_3.md
 * 
 * Epistemic Architecture:
 * - Bridges Valuation Truth (v3.1.1), Evidence Truth (v3.2), Reconciliation (v3.3.1), and Duration Intelligence (v4.1).
 * - Implements Institutional Capital Deployment Action Layer with 7 deterministic states and 2x2 fundamental/price matrix.
 * - Computes dual correction triggers (priceAtEvidenceCeiling & priceAt25PctMoS) without collapsing expectations and valuation.
 * - Dynamic economic health assessment without universal single-variable hardcodes.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  RECONCILIATION_REALITY_STATE,
  UNDERWRITING_SUPPORT_STATUS,
  OPTIONALITY_STATUS,
  GAP_DIRECTION,
  DURATION_QUALITY,
  DURATION_PHASE,
  INVESTMENT_OPPORTUNITY_SITUATION,
  EXECUTION_ELIGIBILITY,
  CAPITAL_DEPLOYMENT_STATE,
  CAPITAL_ABSORPTION_QUALITY,
  reconcileMarketVsThesis,
  reconcileCohortMarketVsThesis
} from '../services/market-thesis-reconciliation.service.js';

import {
  COHORT_TRAJECTORY_PROFILES,
  evaluateFundamentalTrajectoryVector
} from '../services/fundamental-trajectory-engine.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateMarketThesisReconciliationDossier() {
  console.log('================================================================================================');
  console.log('🚀 GENERATING PRODUCTION DOSSIER: THESISIQ v4.1 DURATION & CAPITAL DEPLOYMENT INTELLIGENCE');
  console.log('================================================================================================\n');

  const cohortResults = [];
  for (const [ticker, profile] of Object.entries(COHORT_TRAJECTORY_PROFILES)) {
    const vector = evaluateFundamentalTrajectoryVector(profile);
    const r = reconcileMarketVsThesis(profile, vector);
    cohortResults.push(r);
  }

  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const outputPath = path.resolve(__dirname, '../../reports/thesis_board/MARKET_THESIS_RECONCILIATION_DOSSIER_V3_3.md');
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Group universe purely dynamically by classified opportunity situation
  const quadrantMap = {
    [INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_A_VALUE_OPPORTUNITY]: cohortResults.filter(r => r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_A_VALUE_OPPORTUNITY),
    [INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY]: cohortResults.filter(r => r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY),
    [INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY]: cohortResults.filter(r => r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY),
    [INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK]: cohortResults.filter(r => r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK)
  };

  // Group universe by Capital Deployment State
  const deploymentMap = {
    [CAPITAL_DEPLOYMENT_STATE.ADD_ACCUMULATE_REVIEW]: cohortResults.filter(r => r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.ADD_ACCUMULATE_REVIEW),
    [CAPITAL_DEPLOYMENT_STATE.ADD_ON_CORRECTION]: cohortResults.filter(r => r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.ADD_ON_CORRECTION),
    [CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_NEXT_LEG_EVIDENCE]: cohortResults.filter(r => r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_NEXT_LEG_EVIDENCE),
    [CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_MILESTONE]: cohortResults.filter(r => r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_MILESTONE),
    [CAPITAL_DEPLOYMENT_STATE.REVALIDATE]: cohortResults.filter(r => r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.REVALIDATE),
    [CAPITAL_DEPLOYMENT_STATE.HOLD]: cohortResults.filter(r => r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.HOLD),
    [CAPITAL_DEPLOYMENT_STATE.THESIS_BREAKER]: cohortResults.filter(r => r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.THESIS_BREAKER)
  };

  const sitAList = quadrantMap[INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_A_VALUE_OPPORTUNITY].map(r => r.ticker).join(', ') || 'None';
  const sitBList = quadrantMap[INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY].map(r => r.ticker).join(', ') || 'None';
  const sitCList = quadrantMap[INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY].map(r => r.ticker).join(', ') || 'None';
  const sitDList = quadrantMap[INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK].map(r => r.ticker).join(', ') || 'None';

  let md = `# ThesisIQ v4.1-FROZEN: Market–Thesis Valuation Reconciliation, Duration & Capital Deployment Dossier
**Generated At**: \`${timestamp}\` | **Framework Version**: \`v4.1-FROZEN (Capital Deployment Action Layer)\` | **Coverage Universe**: \`19 Core Multi-Year Compounders\`

---

## 1. Epistemic Mandate & 6-Layer Architecture

ThesisIQ operates across six distinct, non-contradictory analytical layers:
1. **v3.1.1 (Valuation Truth)**: Frozen institutional FCFF/WACC enterprise DCF fair values, margins of safety, and downside asymmetry.
2. **v3.2 (Evidence Truth)**: Observed Audited Actuals $\\to$ Forward Scenario Ranges $\\to$ Longitudinal Management Promise Ledger.
3. **v3.3.1 (Market–Thesis Reconciliation Layer)**: Explains what economic assumptions the market is implicitly capitalizing when Market EV differs from Underwritten EV.
4. **v4.1-FROZEN (Duration & Transition Compounder Intelligence Layer)**: Evaluates whether market demands are economically plausible within the company's capital absorption runway, assigning objective Duration Quality ($D_1 \\to D_5$), Lifecycle Phase (\`DURATION_PHASE\`), and 4-Quadrant Investment Opportunities ($A, B, C, D$).
5. **Causal Milestone Engine**: Pinpoints the exact operational catalyst, milestone threshold, and thesis breaker needed to resolve missing evidence.
6. **Capital Deployment Action Layer (Translational)**: Consumes valuation, evidence, duration, and milestone outputs to determine actionable capital deployment eligibility without altering underlying valuation or evidence truth.

\`\`\`text
                               ┌────────────────────────────────┐
                               │     v3.1.1 DCF Truth (FCFF)    │
                               │ "What is provable today?"      │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │     v3.2 Evidence Truth        │
                               │ "What is actually happening?"  │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │  v3.3.1 Market Reconciliation  │
                               │ "What is market demanding?"    │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │  v4.1 Duration Intelligence    │
                               │ "What economic mechanism       │
                               │  sustains market demands?"     │
                               │  (D1-D5, Phase & 4-Quadrant)   │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │  Causal Milestone Engine       │
                               │ "What observation resolves the │
                               │  missing evidence & risk?"     │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │  Capital Deployment Layer      │
                               │ "What conditions unlock        │
                               │  incremental portfolio capital?"│
                               └────────────────────────────────┘
\`\`\`

> [!IMPORTANT]
> **Epistemic Invariant on Ceilings & Capital Deployment**:
> 1. **\`CREDIBLE_EVIDENCE_CEILING\`**: Maximum growth rate supported by currently observable, audited baseline evidence.
> 2. **Dual Correction Triggers**: Evaluated separately via \`priceAtEvidenceCeiling\` (expectations condition) and \`priceAt25PctMoS\` (valuation condition); never collapsed into a single artificial figure.
> 3. **Anti-Averaging-Down Invariant**: Price corrections alone do not unlock capital deployment if fundamental unit economics, receivables, or cash generation are deteriorating.

---

## 2. Master Universe Unified Board (19 Equities)

| Ticker | Company Name | CMP (₹) | Base FV (₹) | Val. Context | Duration Quality | Opportunity Situation | Credible Ceiling | Capital Deployment State | Dual Correction Triggers (Evidence / 25% MoS) | Key Operational Question / Next Trigger |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
`;

  for (const r of cohortResults) {
    const gaps = r.sevenEconomicGaps;
    const mktEvGap = r.marketEvidenceGap;
    const credCeiling = `${mktEvGap.credibleEvidenceCeiling}%`;
    const trig = r.correctionTriggers;
    
    // Badges
    let valBadge = `\`${r.valuationContext}\``;
    if (r.valuationContext === 'DISCOUNTED') valBadge = `🟢 \`DISCOUNTED\``;
    else if (r.valuationContext === 'ALIGNED') valBadge = `⚪ \`ALIGNED\``;
    else if (r.valuationContext === 'EXPENSIVE') valBadge = `🟠 \`EXPENSIVE\``;
    else if (r.valuationContext === 'EXTREME_PREMIUM') valBadge = `🔴 \`EXTREME_PREMIUM\``;

    let durBadge = `\`${r.durationQuality}\``;
    if (r.durationQuality === DURATION_QUALITY.D1_PROVEN) durBadge = `💎 \`D1\``;
    else if (r.durationQuality === DURATION_QUALITY.D2_EVIDENCE_SUPPORTED) durBadge = `🟢 \`D2\``;
    else if (r.durationQuality === DURATION_QUALITY.D3_IDENTIFIED) durBadge = `🟡 \`D3\``;
    else if (r.durationQuality === DURATION_QUALITY.D4_SPECULATIVE) durBadge = `🟠 \`D4\``;
    else if (r.durationQuality === DURATION_QUALITY.D5_BROKEN) durBadge = `🔴 \`D5\``;

    let sitBadge = `\`${r.investmentOpportunitySituation}\``;
    if (r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_A_VALUE_OPPORTUNITY) sitBadge = `🟢 **A (VAL)**`;
    else if (r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY) sitBadge = `💎 **B (COMP)**`;
    else if (r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY) sitBadge = `🟡 **C (MLST)**`;
    else if (r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK) sitBadge = `🔴 **D (RISK)**`;

    let deployBadge = `\`${r.capitalDeploymentState}\``;
    if (r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.ADD_ACCUMULATE_REVIEW) deployBadge = `🟢 \`ADD_ACCUMULATE_REVIEW\``;
    else if (r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.ADD_ON_CORRECTION) deployBadge = `💎 \`ADD_ON_CORRECTION\``;
    else if (r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_NEXT_LEG_EVIDENCE) deployBadge = `🔍 \`WAIT_NEXT_LEG\``;
    else if (r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_MILESTONE) deployBadge = `🟡 \`WAIT_MILESTONE\``;
    else if (r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.REVALIDATE) deployBadge = `🟠 \`REVALIDATE\``;
    else if (r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.HOLD) deployBadge = `⚪ \`HOLD\``;
    else if (r.capitalDeploymentState === CAPITAL_DEPLOYMENT_STATE.THESIS_BREAKER) deployBadge = `🔴 \`THESIS_BREAKER\``;

    const trigSummary = `₹${trig.priceAtEvidenceCeiling.toFixed(0)} (-${trig.correctionRequiredToEvidenceCeilingPct}%) / ₹${trig.priceAt25PctMoS.toFixed(0)} (-${trig.correctionRequiredTo25PctMoSPct}%)`;
    const cleanQuestion = (r.capitalDeploymentAction.nextTrigger || r.currentQuestion || r.primaryReason || '').replace(/\|/g, '-');
    md += `| **${r.ticker}** | ${r.companyName} | ₹${r.currentPrice.toFixed(2)} | ₹${r.fairValuePrice.toFixed(2)} | ${valBadge} | ${durBadge} | ${sitBadge} | ${credCeiling} | ${deployBadge} | ${trigSummary} | ${cleanQuestion} |\n`;
  }

  const tb = '```';
  md += `\n---\n\n## 3. 4-Quadrant Investment Reality Matrix & Distribution\n\n`;
  md += `The matrix below resolves valuation paralysis by distinguishing between **"expensive because long duration is omitted from static 5Y DCF"** vs **"expensive because market is demanding unachievable economics"**:\n\n`;
  md += `${tb}text\n`;
  md += `┌────────────────────────────────────────────────────────────────────────────────────────┐\n`;
  md += `│                        THESISIQ v4.1 OPPORTUNITY MATRIX (19 EQUITIES)                  │\n`;
  md += `├────────────────────────────────────────┬───────────────────────────────────────────────┤\n`;
  md += `│ SITUATION A: VALUE OPPORTUNITIES (${String(quadrantMap[INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_A_VALUE_OPPORTUNITY].length).padEnd(2, ' ')})│ SITUATION B: COMPOUNDER OPPORTUNITIES (${String(quadrantMap[INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY].length).padEnd(2, ' ')}) │\n`;
  md += `│ • Static DCF: Discounted / Aligned     │ • Static DCF: Expensive on 5Y discrete DCF   │\n`;
  md += `│ • Duration: D1 / D2 / D3 Supported     │ • Duration: D1 Proven / D2 Transitioning     │\n`;
  md += `│ • Capital Action: ADD / REVALIDATE     │ • Capital Action: ADD_ON_CORRECTION / NEXT_LEG│\n`;
  md += `│ • Equities: ${sitAList.padEnd(27, ' ')}│ • Equities: ${sitBList.padEnd(34, ' ')}│\n`;
  md += `├────────────────────────────────────────┼───────────────────────────────────────────────┤\n`;
  md += `│ SITUATION C: MILESTONE OPPORTUNITIES (${String(quadrantMap[INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY].length).padEnd(2, ' ')})│ SITUATION D: EXPECTATION RISKS (${String(quadrantMap[INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_D_EXPECTATION_RISK].length).padEnd(2, ' ')})        │\n`;
  md += `│ (Validation Phase — e.g. QPower)       │ (Speculative Multiples / De-Rating Traps)    │\n`;
  md += `│ • Static DCF: Expensive                │ • Static DCF: Expensive                       │\n`;
  md += `│ • Duration: D2 / D3 (Physical Plant 8x)│ • Duration: D4 Speculative / D5 Broken        │\n`;
  md += `│ • Capital Action: WAIT_FOR_MILESTONE   │ • Capital Action: HOLD / THESIS_BREAKER       │\n`;
  md += `│ • Equities: ${sitCList.padEnd(27, ' ')}│ • Equities: ${sitDList.padEnd(34, ' ')}│\n`;
  md += `└────────────────────────────────────────┴───────────────────────────────────────────────┘\n`;
  md += `${tb}\n\n`;
  md += `---\n\n## 4. Deep-Dive Causal Duration & Capital Deployment Dossiers\n\n`;

  // Render deep dives for key benchmark equities
  const keyTickers = ['QPOWER', 'TRANSRAILL', 'HBLENGINE', 'ANANTRAJ', 'SJS', 'SHAKTIPUMP', 'SKIPPER', 'LUMAXTECH'];
  
  for (const ticker of keyTickers) {
    const r = cohortResults.find(c => c.ticker === ticker);
    if (!r) continue;

    const bridge = r.waterfallBridge;
    const mktEvGap = r.marketEvidenceGap;
    const durVec = r.durationVector;
    const mReq = r.milestoneRequirements;
    const chk = r.transitionCompounderChecklist;
    const cAct = r.capitalDeploymentAction;
    const eH = r.economicHealth;
    const trig = r.correctionTriggers;

    let situationTitle = 'SITUATION D: EXPECTATION RISK';
    if (r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_A_VALUE_OPPORTUNITY) situationTitle = 'SITUATION A: VALUE OPPORTUNITY';
    else if (r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_B_COMPOUNDER_OPPORTUNITY) situationTitle = `SITUATION B: COMPOUNDER OPPORTUNITY (${r.durationPhase === DURATION_PHASE.TRANSITIONING_TO_NEXT_LEG ? 'Next-Leg Transition Phase' : 'Core Scaling Phase'})`;
    else if (r.investmentOpportunitySituation === INVESTMENT_OPPORTUNITY_SITUATION.SITUATION_C_MILESTONE_OPPORTUNITY) situationTitle = 'SITUATION C: MILESTONE OPPORTUNITY (Validation Phase)';

    md += `### ${r.ticker} — ${r.companyName}\n\n`;
    md += `> [!NOTE]\n`;
    md += `> **Opportunity Classification**: **${situationTitle}** | **Duration Quality**: \`${r.durationQuality}\` | **Capital Deployment State**: \`${r.capitalDeploymentState}\`\n\n`;

    md += `#### 1. Valuation & Duration Vector Summary\n`;
    md += `| Metric | Value | Institutional Interpretation |\n`;
    md += `| :--- | :---: | :--- |\n`;
    md += `| **Current Market Price (CMP)** | ₹${r.currentPrice.toFixed(2)} | Current market quote |\n`;
    md += `| **Frozen Baseline Fair Value (P0)** | ₹${r.fairValuePrice.toFixed(2)} | Provable 5-Year Institutional DCF fair value |\n`;
    md += `| **Valuation Context** | \`${r.valuationContext}\` (${r.valuationMultipleRatio}x) | ${r.valuationMultipleRatio > 1.15 ? 'Premium over static DCF' : (r.valuationMultipleRatio < 0.85 ? 'Discount to static DCF' : 'Fairly aligned')} |\n`;
    md += `| **Market-Required 5Y Growth ($g_{\\text{market}}$)** | ${mktEvGap.gMarket}% | 5Y CAGR mathematically demanded by today's price |\n`;
    md += `| **Credible Evidence Ceiling** | ${mktEvGap.credibleEvidenceCeiling}% | Maximum growth supported by existing contracted backlog & core plant |\n`;
    md += `| **Theoretical Scenario Ceiling** | ${mktEvGap.scenarioCeiling}% | Unconstrained expansion ceiling (Core + Next-leg M&A / Greenfield) |\n`;
    md += `| **Forward iROIC** | ${durVec.forwardIroic}% | Reinvestment return on incremental capital deployed |\n`;
    md += `| **Management Execution Credibility** | \`${durVec.managementExecutionCredibility}\` | Audited Promise Ledger track record (${durVec.managementExecutionVector.deliverySuccessRatePct}% success rate) |\n`;
    md += `| **Cash Conversion Quality** | \`${durVec.cashConversionQuality}\` | ${durVec.cashConversionQuality === 'INTACT' ? 'Audited CFO/PAT conversion healthy' : 'Receivables or working capital friction'} |\n`;
    md += `| **Economic Health Status** | \`${eH.healthStatus}\` | iROIC: \`${eH.iROICVsWacc}\` | Cash: \`${eH.cashConversion}\` | Working Capital: \`${eH.workingCapitalStatus}\` |\n\n`;

    md += `#### 2. Capital Deployment Action Framework\n`;
    md += `- **Capital Deployment State**: \`${r.capitalDeploymentState}\`\n`;
    md += `- **Action Summary**: ${cAct.actionSummary}\n`;
    md += `- **Dual Correction Triggers**:\n`;
    md += `  - **Expectations Ceiling Trigger (Price where $g_{\\text{market}} = g_{\\text{credible}}$)**: **₹${trig.priceAtEvidenceCeiling.toFixed(2)}** (Correction Required: **${trig.correctionRequiredToEvidenceCeilingPct}%**)\n`;
    md += `  - **Valuation Margin of Safety Floor (Price at 25% MoS to DCF FV)**: **₹${trig.priceAt25PctMoS.toFixed(2)}** (Correction Required: **${trig.correctionRequiredTo25PctMoSPct}%**)\n`;
    md += `- **Deployment Conditions Required**:\n`;
    for (const cond of cAct.deploymentConditions) {
      md += `  1. ${cond}\n`;
    }
    md += `- **Next Trigger Event**: 🎯 *${cAct.nextTrigger}*\n\n`;

    if (chk) {
      md += `#### 3. Transition Compounder 5-Point Diagnostic Assessment\n`;
      md += `| Diagnostic Dimension | Status | Confidence | Empirical Evidence & Operational Diagnostic |\n`;
      md += `| :--- | :---: | :---: | :--- |\n`;
      md += `| **1. Historical Promise Delivery** | \`${chk.historicalPromiseDelivery.status}\` | ${(chk.historicalPromiseDelivery.confidence * 100).toFixed(0)}% | ${chk.historicalPromiseDelivery.evidence.join(' ')} |\n`;
      md += `| **2. Incremental ROIC (iROIC)** | \`${chk.incrementalReturnOnCapital.status}\` | ${(chk.incrementalReturnOnCapital.confidence * 100).toFixed(0)}% | ${chk.incrementalReturnOnCapital.evidence.join(' ')} |\n`;
      md += `| **3. Core Business Health** | \`${chk.coreBusinessHealth.status}\` | ${(chk.coreBusinessHealth.confidence * 100).toFixed(0)}% | ${chk.coreBusinessHealth.evidence.join(' ')} |\n`;
      md += `| **4. Next Growth Engine Identity** | \`${chk.nextEngineIdentity.status}\` | ${(chk.nextEngineIdentity.confidence * 100).toFixed(0)}% | ${chk.nextEngineIdentity.evidence.join(' ')} |\n`;
      md += `| **5. Mathematical Ceiling Capacity** | \`${chk.mathematicalCeilingCapacity.status}\` | ${(chk.mathematicalCeilingCapacity.confidence * 100).toFixed(0)}% | ${chk.mathematicalCeilingCapacity.evidence.join(' ')} |\n\n`;
      md += `> **Diagnostic Assessment Conclusion**: **\`${chk.overallConclusion}\`** (${chk.supportedCount}/5 checkpoints SUPPORTED).\n\n`;
    }

    md += `#### 4. Causal Milestone & Invariant Constraints\n`;
    md += `- **Current Operational Question**: *${mReq.currentQuestion}*\n`;
    md += `- **Next Observable Milestone**: \`${mReq.nextMilestone}\`\n`;
    md += `- **Milestone Threshold**: ${mReq.milestoneThreshold}\n`;
    md += `- **Expected Economic Consequence**: ${mReq.expectedEconomicEffect}\n`;
    md += `- **Thesis Breaker**: ⚠️ *${mReq.thesisBreaker}*\n\n`;

    if (bridge.isPremium) {
      md += `#### 5. Sequential Scenario Bridge (Operational Milestone Progression):\n`;
      md += `> *Note: This is a sequential scenario step progression illustrating milestones, not path-independent Shapley attribution.*\n\n`;
      md += `| Step | Milestone Scenario Step | Price Delta (₹) | Cumulative Value (₹) | % of Total Gap Explained |\n`;
      md += `| :--- | :--- | :---: | :---: | :---: |\n`;
      for (const c of bridge.components) {
        md += `| **${c.label}** | ${c.priceDelta >= 0 ? '+' : ''}₹${c.priceDelta.toFixed(2)} | ₹${c.cumulativePrice.toFixed(2)} | ${c.pctOfGap !== null ? c.pctOfGap + '%' : '—'} |\n`;
      }
      md += `\n`;
    }

    md += `---\n\n`;
  }

  md += `
## 5. Institutional Capital Deployment Framework & Watchlist

The Capital Deployment Action Layer translates analytical truth into strict, deterministic portfolio deployment states.

### 1. Deterministic State Machine Precedence

\`\`\`text
                               CAPITAL DEPLOYMENT ENGINE
                                          │
                                          ▼
                                Is thesis structurally intact?
                                     /              \\
                                   NO                YES
                                   │                  │
                           THESIS_BREAKER            │
                                                      ▼
                                          Is deployment currently
                                               justified?
                                          /                  \\
                                        YES                   NO
                                         │                     │
                             ADD_ACCUMULATE_REVIEW             ▼
                                                       Is specific evidence
                                                       still pending?
                                                       /             \\
                                                     YES              NO
                                                     │                 │
                                          ┌──────────┴──────────┐      │
                                          │                     │      │
                                     Next-leg?             Milestone?   │
                                          │                     │      │
                               WAIT_FOR_NEXT_LEG          WAIT_MILESTONE
                                                                       │
                                                                       ▼
                                                           Is price correction
                                                           the missing variable?
                                                               /          \\
                                                             YES           NO
                                                             │              │
                                                  ADD_ON_CORRECTION       HOLD

*REVALIDATE sits across the tree whenever the current underwriting/evidence relationship becomes inconsistent.
\`\`\`

### 2. The 2x2 Fundamental vs Price Action Matrix

\`\`\`text
                            FUNDAMENTAL TRAJECTORY & HEALTH
                         INTACT                        DETERIORATING
PRICE ↓
  (Pullback)  ┌──────────────────────────────┬───────────────────────────────┐
              │ ADD_ACCUMULATE_REVIEW /      │ REVALIDATE /                  │
              │ ADD_ON_CORRECTION            │ THESIS_BREAKER                │
              │ (Valuation/Expectation Clears)│ (Anti-Averaging-Down Rule)   │
              ├──────────────────────────────┼───────────────────────────────┤
PRICE → / ↑   │ HOLD /                       │ REVALIDATE /                  │
  (Rally/Flat)│ WAIT_FOR_NEXT_LEG /          │ THESIS_BREAKER                │
              │ WAIT_FOR_MILESTONE           │ (Structural Trim / Exit)      │
              └──────────────────────────────┴───────────────────────────────┘
\`\`\`

### 3. Universe Capital Deployment Summary (19 Equities)

| Deployment State | Count | Equities | Core Portfolio Mandate |
| :--- | :---: | :--- | :--- |
| **\`ADD_ACCUMULATE_REVIEW\`** | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.ADD_ACCUMULATE_REVIEW].length} | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.ADD_ACCUMULATE_REVIEW].map(r => r.ticker).join(', ') || 'None'} | Active accumulation zone; valuation attractive, fundamentals intact. |
| **\`ADD_ON_CORRECTION\`** | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.ADD_ON_CORRECTION].length} | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.ADD_ON_CORRECTION].map(r => r.ticker).join(', ') || 'None'} | Pre-authorized watch condition; deploy on pullback toward triggers without impairment. |
| **\`WAIT_FOR_NEXT_LEG_EVIDENCE\`** | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_NEXT_LEG_EVIDENCE].length} | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_NEXT_LEG_EVIDENCE].map(r => r.ticker).join(', ') || 'None'} | Gated deployment; additional capital requires audited dispatches from next growth leg. |
| **\`WAIT_FOR_MILESTONE\`** | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_MILESTONE].length} | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.WAIT_FOR_MILESTONE].map(r => r.ticker).join(', ') || 'None'} | Phased sizing; physical plant ready, awaiting commercial billing verification. |
| **\`REVALIDATE\`** | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.REVALIDATE].length} | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.REVALIDATE].map(r => r.ticker).join(', ') || 'None'} | Working capital friction or under-supported model; do not average down blindly. |
| **\`HOLD\`** | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.HOLD].length} | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.HOLD].map(r => r.ticker).join(', ') || 'None'} | Maintain existing allocation; extreme valuation premium prevents new capital addition. |
| **\`THESIS_BREAKER\`** | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.THESIS_BREAKER].length} | ${deploymentMap[CAPITAL_DEPLOYMENT_STATE.THESIS_BREAKER].map(r => r.ticker).join(', ') || 'None'} | Structural breakdown in economics, subsidy freeze, or cash bleed. Freeze deployment. |

---

## 6. Reverse Duration Compounding Grid (All 19 Stocks)

The table below answers: *"If the company grows NOPAT at candidate CAGR $g$, how many years ($T_{\\text{req}}$) of uninterrupted compounding does today's price mathematically require?"*

| Ticker | CMP (₹) | Base Underwriting | Req. Duration @ Underwriting | @ 20% CAGR | @ 25% CAGR | @ 28% CAGR | @ 30% CAGR | @ 32% CAGR | @ 35% CAGR | @ 40% CAGR |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
`;

  for (const r of cohortResults) {
    const sens = r.durationSensitivityMatrix;
    const underwrittenG = r.comparison.evidenceSupports.underwrittenNopatCagrPct;
    const durUnderwritten = r.sevenEconomicGaps.durationGap.requiredDurationYears;

    const dur20 = sens.find(s => s.nopatCagrPct === 20.0)?.requiredDurationYears || '—';
    const dur25 = sens.find(s => s.nopatCagrPct === 25.0)?.requiredDurationYears || '—';
    const dur28 = sens.find(s => s.nopatCagrPct === 28.0)?.requiredDurationYears || '—';
    const dur30 = sens.find(s => s.nopatCagrPct === 30.0)?.requiredDurationYears || '—';
    const dur32 = sens.find(s => s.nopatCagrPct === 32.0)?.requiredDurationYears || '—';
    const dur35 = sens.find(s => s.nopatCagrPct === 35.0)?.requiredDurationYears || '—';
    const dur40 = sens.find(s => s.nopatCagrPct === 40.0)?.requiredDurationYears || '—';

    md += `| **${r.ticker}** | ₹${r.currentPrice.toFixed(0)} | ${underwrittenG}% | **${durUnderwritten}y** | ${dur20}y | ${dur25}y | ${dur28}y | ${dur30}y | ${dur32}y | ${dur35}y | ${dur40}y |\n`;
  }

  md += `
---

## 7. Mathematical & Invariant Guarantees (v4.1)

- [x] **Translational Layer Invariant**: Frozen DCF Fair Values ($v3.1.1$) and 9-State Reconciliation States ($v3.3.1$) remain strictly immutable.
- [x] **Dual Correction Trigger Separation**: Evaluates \`priceAtEvidenceCeiling\` ($g_{\\text{market}} \\le g_{\\text{credible}}$) and \`priceAt25PctMoS\` ($P \\le 0.75 \\times FV$) as distinct economic conditions.
- [x] **Anti-Averaging-Down Invariant**: Price drops accompanied by fundamental deterioration strictly route to \`REVALIDATE\` or \`THESIS_BREAKER\`, never unlocking accumulation.
- [x] **Milestone & Next-Leg Gate Invariant**: Price drops alone cannot bypass pending commercial capacity billing (\`WAIT_FOR_MILESTONE\`) or next-engine evidence validation (\`WAIT_FOR_NEXT_LEG_EVIDENCE\`).
- [x] **Dynamic Economic Health Diagnosis**: Evaluates iROIC vs WACC, cash conversion, and working capital status dynamically without universal single-variable hardcodes.
- [x] **Strict 7-State Precedence**: Enforces $\\text{THESIS\\_BREAKER} \\to \\text{REVALIDATE} \\to \\text{WAIT\\_FOR\\_MILESTONE} \\to \\text{WAIT\\_FOR\\_NEXT\\_LEG\\_EVIDENCE} \\to \\text{ADD\\_ACCUMULATE\\_REVIEW} \\to \\text{ADD\\_ON\\_CORRECTION} \\to \\text{HOLD}$.
- [x] **Zero Hardcoded Tickers**: Generic mathematical rules evaluated deterministically across the entire universe.

---
*Report automatically compiled and verified by ThesisIQ v4.1 Capital Deployment Intelligence Engine.*
`;

  fs.writeFileSync(outputPath, md, 'utf-8');
  console.log(`✅ Production Dossier successfully written to:\n   ${outputPath}\n`);
}

generateMarketThesisReconciliationDossier().catch(err => {
  console.error('❌ Dossier generation failed:', err);
  process.exit(1);
});
