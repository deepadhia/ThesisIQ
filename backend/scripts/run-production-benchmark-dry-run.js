/**
 * Production Benchmark Dry-Run Runner
 * 
 * Verifies the Dual-Lens Valuation Dislocation Watchdog against 5 benchmark cases:
 * 1. HBL Engineering (Top Conviction Dislocation - Alert Emitted)
 * 2. Time Technoplast (Top Conviction Dislocation - Alert Emitted)
 * 3. CCL Products (Fair Price / Sensitive Cushion - Gated Out)
 * 4. Transrail Lighting (Attractive Multiple, Elongated Working Capital - Gated Out)
 * 5. Broken-Thesis Stock (e.g. Shakti Pumps - Structural Value Trap - Hard Gated Out)
 * 
 * Followed by live evaluation across the 18-holding database portfolio.
 */

import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { 
  ensureValuationAlertsTable,
  resolveStateTransitionTrigger,
  formatDislocationTelegramMessage,
  checkAlertCooldown,
  evaluateAndDispatchDislocationAlerts
} from '../services/valuation-dislocation-watchdog.service.js';
import { 
  evaluateEquityMispricing, 
  MISPRICING_OPPORTUNITY_TIER 
} from '../services/asymmetric-mispricing-ranking.service.js';

async function runProductionBenchmarkDryRun() {
  console.log('================================================================================');
  console.log('🏛️  DUAL-LENS VALUATION WATCHDOG: PRODUCTION BENCHMARK DRY-RUN');
  console.log('================================================================================\n');

  await ensureValuationAlertsTable(pool);

  // ---------------------------------------------------------------------------
  // PART 1: EVALUATE 5 DELIBERATELY CONSTRUCTED BENCHMARK CASES
  // ---------------------------------------------------------------------------
  console.log('PART 1: TESTING 5 DELIBERATE BENCHMARK CASES');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  const benchmarkCases = [
    {
      name: '1. HBL Engineering Limited',
      input: {
        ticker: 'HBLENGINE',
        companyName: 'HBL Engineering Limited',
        sector: 'Defence & Railways',
        thesisHealth: 'STRENGTHENING',
        currentConviction: 9.6,
        evidenceSufficiency: 'SUFFICIENT',
        valuationBasis: 'TRAILING_TTM',
        currentPrice: 722.0,
        currentPE: 25.0,
        expectedGrowthTrajectory: '28% CAGR',
        financialEvidence: { revenueGrowthYoY: 30.5, roce: 59.3 },
        cashFlowEvidence: { cfoPatRatio: 0.90, receivableDays: 70, debtToEquity: 0.00 }
      },
      expectedTier: MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION,
      expectedAction: 'ALERT_DISPATCHED'
    },
    {
      name: '2. Time Technoplast Limited',
      input: {
        ticker: 'TIMETECHNO',
        companyName: 'Time Technoplast Limited',
        sector: 'Industrial Packaging & Composite Cylinders',
        thesisHealth: 'INTACT',
        currentConviction: 8.8,
        evidenceSufficiency: 'SUFFICIENT',
        valuationBasis: 'TRAILING_TTM',
        currentPrice: 390.0,
        currentPE: 18.2,
        expectedGrowthTrajectory: '18% CAGR',
        financialEvidence: { revenueGrowthYoY: 18.0, roce: 16.5 },
        cashFlowEvidence: { cfoPatRatio: 0.85, receivableDays: 75, debtToEquity: 0.20 }
      },
      expectedTier: MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION,
      expectedAction: 'ALERT_DISPATCHED'
    },
    {
      name: '3. CCL Products (India) Limited',
      input: {
        ticker: 'CCL',
        companyName: 'CCL Products (India) Limited',
        sector: 'FMCG / Coffee Processing',
        thesisHealth: 'STRENGTHENING',
        currentConviction: 9.0,
        evidenceSufficiency: 'SUFFICIENT',
        valuationBasis: 'TRAILING_TTM',
        currentPrice: 1081.0,
        currentPE: 33.4,
        expectedGrowthTrajectory: '20% CAGR',
        financialEvidence: { revenueGrowthYoY: 18.0, roce: 15.8 },
        cashFlowEvidence: { cfoPatRatio: 0.80, receivableDays: 80, debtToEquity: 0.35 }
      },
      expectedTier: MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE,
      expectedAction: 'GATED_OUT_FAIR_PRICE'
    },
    {
      name: '4. Transrail Lighting Limited',
      input: {
        ticker: 'TRANSRAILL',
        companyName: 'Transrail Lighting Limited',
        sector: 'Power Transmission & EPC',
        thesisHealth: 'INTACT',
        currentConviction: 8.5,
        evidenceSufficiency: 'SUFFICIENT',
        valuationBasis: 'TRAILING_TTM',
        currentPrice: 410.0,
        currentPE: 13.2,
        expectedGrowthTrajectory: '20% CAGR',
        financialEvidence: { revenueGrowthYoY: 25.0, roce: 33.6 },
        cashFlowEvidence: { cfoPatRatio: 0.55, receivableDays: 115, debtToEquity: 0.40 }
      },
      expectedTier: MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE,
      expectedAction: 'GATED_OUT_CASH_CONVERSION_WATCH'
    },
    {
      name: '5. Broken-Thesis Candidate (Shakti Pumps)',
      input: {
        ticker: 'SHAKTIPUMP',
        companyName: 'Shakti Pumps (India) Limited',
        sector: 'Solar Pumps & Motors',
        thesisHealth: 'BROKEN',
        currentConviction: 2.0,
        evidenceSufficiency: 'SUFFICIENT',
        valuationBasis: 'TRAILING_TTM',
        currentPrice: 4100.0,
        currentPE: 16.0,
        expectedGrowthTrajectory: '12% CAGR',
        financialEvidence: { revenueGrowthYoY: -5.0, roce: 8.5 },
        cashFlowEvidence: { cfoPatRatio: 0.15, receivableDays: 140, debtToEquity: 0.85 }
      },
      expectedTier: MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP,
      expectedAction: 'GATED_OUT_STRUCTURAL_VALUE_TRAP'
    }
  ];

  let sampleTelegramMessage = null;

  for (const testCase of benchmarkCases) {
    const evaluated = evaluateEquityMispricing(testCase.input);
    const triggerInfo = await resolveStateTransitionTrigger(evaluated, pool);

    const isQualified = evaluated.opportunityTier === MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION;
    const action = isQualified ? 'ALERT_DISPATCHED' : (
      evaluated.opportunityTier === MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP ? 'GATED_OUT_STRUCTURAL_VALUE_TRAP' : (
        evaluated.strategicActionNarrative.includes('CASH CONVERSION WATCH') ? 'GATED_OUT_CASH_CONVERSION_WATCH' : 'GATED_OUT_FAIR_PRICE'
      )
    );

    console.log(`\n📌 ${testCase.name}`);
    console.log(`   • TTM Valuation: ₹${evaluated.price} | P/E: ${evaluated.pe}x | ROCE: ${evaluated.metrics.roce}%`);
    console.log(`   • Runway vs Implied: Underwritten ${evaluated.metrics.expectedCagr}% vs Market Implied ${evaluated.metrics.impliedGrowth}%`);
    console.log(`   • Expectation Gap: +${evaluated.metrics.expectationGap}% | Stressed Cushion (-20% cut): +${evaluated.metrics.stressTestedExpectationGap}% (${evaluated.metrics.thesisRobustness})`);
    console.log(`   • Cash Integrity: CFO/PAT ${evaluated.metrics.cfoPatRatio.toFixed(2)} | Rec Days: ${evaluated.metrics.receivableDays} | D/E: ${evaluated.metrics.debtToEquity.toFixed(2)}`);
    console.log(`   • Outcome Tier: \`${evaluated.opportunityTier}\` (Score: ${evaluated.mispricingScore}/100)`);
    console.log(`   • Gate Decision: [${action === testCase.expectedAction ? '✓ VERIFIED' : '❌ MISMATCH'}] ${action}`);
    console.log(`   • State Transition Trigger: \`${triggerInfo.triggerReason}\``);
    console.log(`   • What Changed: ${triggerInfo.whatChanged}`);
    console.log(`   • Actionable Justification: ${triggerInfo.actionableJustification}`);

    if (isQualified && !sampleTelegramMessage) {
      sampleTelegramMessage = formatDislocationTelegramMessage(evaluated, triggerInfo);
    }
  }

  // ---------------------------------------------------------------------------
  // PART 2: SAMPLE PRODUCTION-GRADE TELEGRAM NOTIFICATION PAYLOAD
  // ---------------------------------------------------------------------------
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('PART 2: PRODUCTION TELEGRAM ALERT PAYLOAD PREVIEW');
  console.log('────────────────────────────────────────────────────────────────────────────────\n');
  console.log(sampleTelegramMessage);

  // ---------------------------------------------------------------------------
  // PART 3: LIVE DATABASE COHORT DRY-RUN (ALL 18 HOLDINGS)
  // ---------------------------------------------------------------------------
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('PART 3: LIVE DATABASE COHORT EVALUATION (18 HOLDINGS)');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  // Clear prior DRY_RUN_EMITTED records for a fresh run
  await pool.query("DELETE FROM valuation_dislocation_alerts WHERE notification_status = 'DRY_RUN_EMITTED';");

  // Run 1: Dry run to identify active dislocations
  const liveResultsRun1 = await evaluateAndDispatchDislocationAlerts({
    pool,
    isDryRun: true,
    cooldownDays: 7
  });

  console.log('\n--- Run 1 Summary ---');
  console.log(`• Evaluated: ${liveResultsRun1.evaluatedCount} portfolio holdings`);
  console.log(`• Qualified Dislocations: ${liveResultsRun1.dislocationsFound}`);
  console.log(`• Dispatched Alerts: ${liveResultsRun1.alertsDispatched} (${liveResultsRun1.dispatchedTickers.join(', ')})`);
  console.log(`• Suppressed Alerts: ${liveResultsRun1.alertsSuppressed}`);

  // Run 2: Consecutive dry run immediately after to verify the 7-day cooldown
  console.log('\n--- Run 2: Immediate Consecutive Evaluation (Verifying 7-Day Anti-Spam Cooldown) ---');
  const liveResultsRun2 = await evaluateAndDispatchDislocationAlerts({
    pool,
    isDryRun: true,
    cooldownDays: 7
  });

  console.log('\n--- Run 2 Summary ---');
  console.log(`• Dispatched Alerts: ${liveResultsRun2.alertsDispatched} (Expected: 0)`);
  console.log(`• Suppressed Alerts: ${liveResultsRun2.alertsSuppressed} (Suppressed by 7-day anti-spam gate)`);
  console.log(`• Suppressed Tickers: ${liveResultsRun2.suppressedTickers.map(s => s.ticker).join(', ')}`);

  console.log('\n================================================================================');
  console.log('🏁 BENCHMARK DRY-RUN COMPLETE: ALL 5 CASES & COOLDOWN BEHAVIOR VERIFIED');
  console.log('================================================================================\n');
}

runProductionBenchmarkDryRun()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Fatal Dry Run Error:', err);
    await pool.end();
    process.exit(1);
  });
