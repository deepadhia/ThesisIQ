/**
 * Test Suite: Asymmetric Valuation Dislocation Watchdog & 7-Day Anti-Spam Cooldown
 * 
 * Verifies:
 * 1. Qualification Invariant: Only genuine dislocations (HBL, Time Techno state) trigger alerts.
 * 2. Gating Invariant: High-multiple (HSCL), fair-price (CCL), and cash-flow constrained (Transrail) are gated out.
 * 3. 7-Day Anti-Spam Invariant: Consecutive runs within 7 days strictly suppress duplicate alerts.
 * 4. Message Integrity: Verifies formatting, growth cushion precision, and anti-spam unlock date.
 */

import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { 
  ensureValuationAlertsTable, 
  formatDislocationTelegramMessage, 
  checkAlertCooldown,
  evaluateAndDispatchDislocationAlerts 
} from '../services/valuation-dislocation-watchdog.service.js';
import { evaluateEquityMispricing, MISPRICING_OPPORTUNITY_TIER } from '../services/asymmetric-mispricing-ranking.service.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    process.exitCode = 1;
  } else {
    passedTests++;
    console.log(`  ✓ [PASS] ${message}`);
  }
}

async function runWatchdogTestSuite() {
  console.log('========================================================================');
  console.log('🧪 RUNNING TEST SUITE: VALUATION DISLOCATION WATCHDOG & ANTI-SPAM ENGINE');
  console.log('========================================================================\n');

  await ensureValuationAlertsTable(pool);

  // Clean up any test records for test tickers
  await pool.query(`DELETE FROM valuation_dislocation_alerts WHERE ticker LIKE 'TEST_%';`);

  // -------------------------------------------------------------------------
  // Test 1: Message Formatting & Growth Cushion Precision
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing Message Formatting & Language Precision ---');
  const mockHbl = evaluateEquityMispricing({
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
  });

  const formattedMsg = formatDislocationTelegramMessage(mockHbl);
  assert(formattedMsg.includes('STATE TRANSITION & ALERT JUSTIFICATION'), 'Message contains state transition & alert justification header');
  assert(formattedMsg.includes('What Changed:'), 'Message contains explicit What Changed section');
  assert(formattedMsg.includes('Actionable Justification:'), 'Message contains Actionable Justification');
  assert(formattedMsg.includes('RISK CONTROLS & CASH CONVERSION (PASSED)'), 'Message frames checks as risk controls');
  assert(formattedMsg.includes('HBLENGINE'), 'Message contains ticker');
  assert(formattedMsg.includes('25x'), 'Message contains verified trailing P/E 25x');
  assert(formattedMsg.includes('+16%'), 'Message contains raw expectation gap +16%');
  assert(formattedMsg.includes('+10.4%'), 'Message contains stressed cushion +10.4%');
  assert(formattedMsg.includes('HIGHLY_RESILIENT'), 'Message contains HIGHLY_RESILIENT tag');
  assert(formattedMsg.includes('ROCE: *59.3%*'), 'Message contains verified ROCE');
  assert(formattedMsg.includes('Anti-Spam Cooldown'), 'Message specifies anti-spam cooldown');
  assert(!formattedMsg.includes('guaranteed annual return'), 'No misleading guaranteed return claims');

  // -------------------------------------------------------------------------
  // Test 2: Qualification & Gating Invariant
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing Qualification & Gating Invariant ---');
  assert(mockHbl.opportunityTier === MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION, 'HBL qualifies as TOP_CONVICTION_DISLOCATION');

  // HSCL: Trailing P/E 42x -> Gated into COMPOUNDING_AT_FAIR_PRICE
  const mockHscl = evaluateEquityMispricing({
    ticker: 'HSCL',
    companyName: 'Himadri Speciality Chemical',
    thesisHealth: 'STRENGTHENING',
    currentConviction: 9.5,
    evidenceSufficiency: 'SUFFICIENT',
    valuationBasis: 'TRAILING_TTM',
    currentPrice: 665.0,
    currentPE: 42.0,
    expectedGrowthTrajectory: '25% CAGR',
    financialEvidence: { revenueGrowthYoY: 28.0, roce: 22.1 },
    cashFlowEvidence: { cfoPatRatio: 0.88, receivableDays: 65, debtToEquity: 0.12 }
  });
  assert(mockHscl.opportunityTier === MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE, 'HSCL is gated into COMPOUNDING_AT_FAIR_PRICE (not dislocation)');

  // CCL: Trailing P/E 33.4x -> Gated into COMPOUNDING_AT_FAIR_PRICE
  const mockCcl = evaluateEquityMispricing({
    ticker: 'CCL',
    companyName: 'CCL Products',
    thesisHealth: 'STRENGTHENING',
    currentConviction: 9.0,
    evidenceSufficiency: 'SUFFICIENT',
    valuationBasis: 'TRAILING_TTM',
    currentPrice: 1081.0,
    currentPE: 33.4,
    expectedGrowthTrajectory: '20% CAGR',
    financialEvidence: { revenueGrowthYoY: 18.0, roce: 15.8 },
    cashFlowEvidence: { cfoPatRatio: 0.80, receivableDays: 80, debtToEquity: 0.35 }
  });
  assert(mockCcl.opportunityTier === MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE, 'CCL is gated into COMPOUNDING_AT_FAIR_PRICE (not dislocation)');

  // Transrail: 13.2x P/E but elongated working capital -> Gated into CASH CONVERSION WATCH
  const mockTransrail = evaluateEquityMispricing({
    ticker: 'TRANSRAILL',
    companyName: 'Transrail Lighting',
    thesisHealth: 'INTACT',
    currentConviction: 8.5,
    evidenceSufficiency: 'SUFFICIENT',
    valuationBasis: 'TRAILING_TTM',
    currentPrice: 410.0,
    currentPE: 13.2,
    expectedGrowthTrajectory: '20% CAGR',
    financialEvidence: { revenueGrowthYoY: 25.0, roce: 33.6 },
    cashFlowEvidence: { cfoPatRatio: 0.55, receivableDays: 115, debtToEquity: 0.40 }
  });
  assert(mockTransrail.opportunityTier === MISPRICING_OPPORTUNITY_TIER.COMPOUNDING_AT_FAIR_PRICE, 'Transrail is gated out of TOP_CONVICTION_DISLOCATION due to cash conversion');
  assert(mockTransrail.strategicActionNarrative.includes('CASH CONVERSION WATCH'), 'Transrail narrative explicitly indicates Cash Conversion Watch');

  // Shakti Pumps: 16.0x P/E, broken thesis -> Gated into STRUCTURAL_VALUE_TRAP
  const mockShakti = evaluateEquityMispricing({
    ticker: 'SHAKTIPUMP',
    companyName: 'Shakti Pumps (India)',
    thesisHealth: 'BROKEN',
    currentConviction: 2.0,
    evidenceSufficiency: 'SUFFICIENT',
    valuationBasis: 'TRAILING_TTM',
    currentPrice: 4100.0,
    currentPE: 16.0,
    expectedGrowthTrajectory: '12% CAGR',
    financialEvidence: { revenueGrowthYoY: -5.0, roce: 8.5 },
    cashFlowEvidence: { cfoPatRatio: 0.15, receivableDays: 140, debtToEquity: 0.85 }
  });
  assert(mockShakti.opportunityTier === MISPRICING_OPPORTUNITY_TIER.STRUCTURAL_VALUE_TRAP, 'Shakti Pumps is gated into STRUCTURAL_VALUE_TRAP due to broken thesis');
  assert(mockShakti.mispricingScore === 0.0, 'Shakti Pumps mispricing score is strictly clamped to 0.0');

  // -------------------------------------------------------------------------
  // Test 3: 7-Day Anti-Spam Cooldown Invariant
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing 7-Day Anti-Spam Cooldown Invariant ---');
  const testTicker = 'TEST_DISLOCATION';

  // Initially: Not in cooldown
  const initialCooldown = await checkAlertCooldown(testTicker, pool, 7);
  assert(initialCooldown.isInCooldown === false, 'Fresh ticker is NOT in cooldown');

  // Simulate an alert dispatched 2 days ago
  await pool.query(`
    INSERT INTO valuation_dislocation_alerts (
      ticker, share_price, pe_ratio, market_cap, expected_cagr,
      implied_growth, expectation_gap, stress_gap, mispricing_score,
      roce_pct, cfo_pat_ratio, receivable_days, notification_status, sent_at
    ) VALUES ($1, 700, 20, 10000, 25, 10, 15, 10, 95, 30, 0.9, 60, 'SENT', NOW() - INTERVAL '2 days');
  `, [testTicker]);

  // Now: Must be in cooldown!
  const activeCooldown = await checkAlertCooldown(testTicker, pool, 7);
  assert(activeCooldown.isInCooldown === true, 'Ticker with alert 2 days ago IS in 7-day cooldown');
  assert(activeCooldown.lastAlert !== null, 'Cooldown check retrieves last alert record');

  // Simulate an alert dispatched 8 days ago (cooldown expired)
  const expiredTicker = 'TEST_EXPIRED';
  await pool.query(`
    INSERT INTO valuation_dislocation_alerts (
      ticker, share_price, pe_ratio, market_cap, expected_cagr,
      implied_growth, expectation_gap, stress_gap, mispricing_score,
      roce_pct, cfo_pat_ratio, receivable_days, notification_status, sent_at
    ) VALUES ($1, 700, 20, 10000, 25, 10, 15, 10, 95, 30, 0.9, 60, 'SENT', NOW() - INTERVAL '8 days');
  `, [expiredTicker]);

  const expiredCooldown = await checkAlertCooldown(expiredTicker, pool, 7);
  assert(expiredCooldown.isInCooldown === false, 'Ticker with alert 8 days ago is NOT in cooldown (cooldown expired)');

  // -------------------------------------------------------------------------
  // Test 4: End-to-End Evaluation & De-duplication in Real Database
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing End-to-End Watchdog Run & Suppression ---');
  // Clear any existing dry run emitted records to test clean first run
  await pool.query("DELETE FROM valuation_dislocation_alerts WHERE notification_status = 'DRY_RUN_EMITTED';");

  // First Run (Dry-run): Dispatches alerts for qualified holdings (HBL, Time Techno)
  const run1 = await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: true });
  assert(run1.evaluatedCount === 18, 'Evaluated all 18 holdings');
  assert(run1.dislocationsFound >= 1, `Found ${run1.dislocationsFound} dislocation candidates`);
  assert(run1.alertsDispatched >= 1, `Dispatched ${run1.alertsDispatched} alerts on initial run`);

  // Second Consecutive Run: MUST be suppressed by the 7-day cooldown!
  const run2 = await evaluateAndDispatchDislocationAlerts({ pool, isDryRun: true });
  assert(run2.alertsDispatched === 0, 'Zero alerts dispatched on consecutive run (all in 7-day cooldown)');
  assert(run2.alertsSuppressed === run1.dislocationsFound, `All ${run1.dislocationsFound} dislocations were suppressed by 7-day anti-spam cooldown`);
  assert(run2.suppressedTickers.length > 0, 'Suppressed tickers logged with COOLDOWN_ACTIVE');

  // Clean up test records
  await pool.query(`DELETE FROM valuation_dislocation_alerts WHERE ticker LIKE 'TEST_%';`);

  console.log('\n========================================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('========================================================================\n');

  if (passedTests !== totalTests) {
    process.exitCode = 1;
  }
}

runWatchdogTestSuite()
  .then(async () => {
    await pool.end();
    process.exit(process.exitCode || 0);
  })
  .catch(async (err) => {
    console.error('Fatal Test Error:', err);
    await pool.end();
    process.exit(1);
  });
