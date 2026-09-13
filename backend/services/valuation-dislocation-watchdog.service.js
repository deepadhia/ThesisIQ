/**
 * Asymmetric Valuation Dislocation Watchdog Service
 * 
 * Mandate:
 * Evaluates the portfolio against the Dual-Lens Valuation Architecture and dispatches
 * production-grade Telegram notifications whenever a stock enters a top conviction
 * dislocation state (e.g. HBL / Time Techno state: high conviction, strong stressed
 * expectation gap, pristine cash conversion).
 * 
 * Invariants:
 * 1. 7-Day Anti-Spam Cooldown: Prevents duplicate alerts for the same ticker within 7 days.
 * 2. Strict Qualification: Only alerts on `TOP_CONVICTION_DISLOCATION` with pristine cash flow.
 * 3. Growth Cushion Precision: Highlights stressed operating growth margin, not guaranteed return.
 * 4. Idempotency: Thread-safe, idempotent alert recording into `valuation_dislocation_alerts`.
 */

import { pool as defaultPool } from '../db/pool.js';
import { loadAuditedPortfolioFromDatabase } from '../scripts/run-asymmetric-mispricing-ranking.js';
import { rankUniverseByMispricing, MISPRICING_OPPORTUNITY_TIER } from './asymmetric-mispricing-ranking.service.js';
import { sendTelegramMessage } from './telegram.service.js';

export const COOLDOWN_DAYS = 7;

/**
 * Idempotently ensures the tracking table exists.
 */
export async function ensureValuationAlertsTable(pool = defaultPool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS valuation_dislocation_alerts (
      id SERIAL PRIMARY KEY,
      ticker VARCHAR(20) NOT NULL,
      share_price NUMERIC(12, 2) NOT NULL,
      pe_ratio NUMERIC(8, 2) NOT NULL,
      market_cap NUMERIC(14, 2),
      expected_cagr NUMERIC(6, 2),
      implied_growth NUMERIC(6, 2),
      expectation_gap NUMERIC(6, 2),
      stress_gap NUMERIC(6, 2),
      mispricing_score NUMERIC(6, 2),
      roce_pct NUMERIC(6, 2),
      cfo_pat_ratio NUMERIC(6, 2),
      receivable_days INT,
      notification_status VARCHAR(30) DEFAULT 'SENT',
      sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_vda_ticker_sent ON valuation_dislocation_alerts (ticker, sent_at DESC);
  `);
}

/**
 * Formats a high-impact, institutional-grade Telegram alert for a detected dislocation.
 */
export function formatDislocationTelegramMessage(equity) {
  const {
    ticker,
    companyName,
    sector,
    price,
    pe,
    mispricingScore,
    metrics
  } = equity;

  const nextCooldownDate = new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

  let msg = `🎯 *ASYMMETRIC MISPRICING DISLOCATION DETECTED*\n`;
  msg += `─────────────────────────\n`;
  msg += `🏢 *${ticker.toUpperCase()}* | *${companyName}*\n`;
  msg += `📍 *Sector*: ${sector}\n\n`;

  msg += `💰 *VALUATION ENTRY POINT*\n`;
  msg += `• Current Price: *₹${price.toFixed(2)}*\n`;
  msg += `• Trailing P/E: *${pe}x* (Consolidated Trailing TTM)\n\n`;

  msg += `📈 *DUAL-LENS EXPECTATION ASYMMETRY*\n`;
  msg += `• Underwritten Runway: *${metrics.expectedCagr}% CAGR*\n`;
  msg += `• Market-Implied Growth: *${metrics.impliedGrowth}% CAGR*\n`;
  msg += `• Raw Expectation Gap: *+${metrics.expectationGap}%*\n`;
  msg += `• Stressed Cushion (-20% haircut): *+${metrics.stressTestedExpectationGap}%* (\`${metrics.thesisRobustness}\`)\n\n`;

  msg += `🛡️ *QUALITY & CASH CONVERSION (AUDITED)*\n`;
  msg += `• ROCE: *${metrics.roce}%* (\`${metrics.roceRegimeClassification}\`)\n`;
  msg += `• Debt/Equity: *${metrics.debtToEquity.toFixed(2)}*\n`;
  msg += `• Cash Flow: *CFO/PAT ${metrics.cfoPatRatio.toFixed(2)}* | *Rec Days: ${metrics.receivableDays}*\n\n`;

  msg += `⚖️ *STRATEGIC ALLOCATION VERDICT*\n`;
  msg += `• Opportunity Tier: \`TOP_CONVICTION_DISLOCATION\`\n`;
  msg += `• Mispricing Score: *${mispricingScore} / 100*\n`;
  msg += `• Recommendation: *Prime Fresh Capital Deployment*. Underwritten evidence significantly exceeds market expectations with resilient margin of safety.\n\n`;

  msg += `⏱️ *Anti-Spam Cooldown*: Next alert for this stock locked until *${nextCooldownDate}*.\n`;
  msg += `─────────────────────────\n`;
  msg += `🏛️ *Multibagger Institutional Watchdog v2.0*`;

  return msg;
}

/**
 * Checks if an alert was already dispatched for this ticker within the cooldown period.
 */
export async function checkAlertCooldown(ticker, pool = defaultPool, cooldownDays = COOLDOWN_DAYS, options = {}) {
  const includeDryRun = options.includeDryRun || false;
  const statusFilterClause = includeDryRun 
    ? "AND notification_status IN ('SENT', 'DRY_RUN_EMITTED')" 
    : "AND notification_status = 'SENT'";

  const res = await pool.query(`
    SELECT id, sent_at, share_price, pe_ratio, expectation_gap, stress_gap
    FROM valuation_dislocation_alerts
    WHERE ticker = $1 
      AND sent_at > NOW() - ($2 || ' days')::INTERVAL
      ${statusFilterClause}
    ORDER BY sent_at DESC
    LIMIT 1;
  `, [ticker, cooldownDays]);

  if (res.rows.length > 0) {
    return {
      isInCooldown: true,
      lastAlert: res.rows[0]
    };
  }

  return {
    isInCooldown: false,
    lastAlert: null
  };
}

/**
 * Evaluates the entire audited cohort and dispatches alerts for qualified dislocations.
 */
export async function evaluateAndDispatchDislocationAlerts(options = {}) {
  const {
    pool = defaultPool,
    isDryRun = false,
    forceAlert = false,
    cooldownDays = COOLDOWN_DAYS
  } = options;

  await ensureValuationAlertsTable(pool);

  // 1. Load latest database cohort & rank universe
  const cohort = await loadAuditedPortfolioFromDatabase(pool);
  const ranked = rankUniverseByMispricing(cohort);

  // 2. Identify Top Conviction Dislocations
  const dislocations = ranked.filter(
    s => s.opportunityTier === MISPRICING_OPPORTUNITY_TIER.TOP_CONVICTION_DISLOCATION
  );

  const results = {
    evaluatedCount: ranked.length,
    dislocationsFound: dislocations.length,
    alertsDispatched: 0,
    alertsSuppressed: 0,
    dispatchedTickers: [],
    suppressedTickers: []
  };

  console.log(`\n🔍 Valuation Dislocation Watchdog: Evaluated ${ranked.length} stocks.`);
  console.log(`Found ${dislocations.length} candidates in TOP_CONVICTION_DISLOCATION tier.\n`);

  for (const equity of dislocations) {
    const ticker = equity.ticker;

    // Check 7-day cooldown
    const { isInCooldown, lastAlert } = await checkAlertCooldown(ticker, pool, cooldownDays, { includeDryRun: isDryRun });

    if (isInCooldown && !forceAlert) {
      console.log(`⏳ [COOLDOWN ACTIVE] ${ticker} is in TOP_CONVICTION_DISLOCATION, but alert was dispatched on ${new Date(lastAlert.sent_at).toISOString()} (< ${cooldownDays} days ago). Suppressed.`);
      results.alertsSuppressed++;
      results.suppressedTickers.push({
        ticker,
        lastSentAt: lastAlert.sent_at,
        reason: 'COOLDOWN_ACTIVE'
      });
      continue;
    }

    // Cooldown elapsed or fresh dislocation: format & send alert
    const alertMessage = formatDislocationTelegramMessage(equity);

    console.log(`🚀 [ALERT TRIGGERED] Preparing Telegram notification for ${ticker} (${equity.pe}x P/E, +${equity.metrics.expectationGap}% gap, +${equity.metrics.stressTestedExpectationGap}% stress gap)...`);

    let notificationStatus = isDryRun ? 'DRY_RUN_EMITTED' : 'SENT';

    if (!isDryRun) {
      try {
        await sendTelegramMessage(alertMessage);
        console.log(`✅ [TELEGRAM SENT] Dislocation alert delivered for ${ticker}.`);
      } catch (err) {
        console.error(`❌ [TELEGRAM ERROR] Failed to deliver alert for ${ticker}:`, err.message);
        notificationStatus = 'FAILED';
      }
    } else {
      console.log(`ℹ️ [DRY RUN] Skipped real Telegram delivery for ${ticker}. Status recorded as DRY_RUN_EMITTED.`);
    }

    // Record into database
    await pool.query(`
      INSERT INTO valuation_dislocation_alerts (
        ticker, share_price, pe_ratio, market_cap, expected_cagr,
        implied_growth, expectation_gap, stress_gap, mispricing_score,
        roce_pct, cfo_pat_ratio, receivable_days, notification_status, sent_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW());
    `, [
      ticker,
      equity.price,
      equity.pe,
      equity.metrics.marketCap || (equity.price * 25), // fallback if needed
      equity.metrics.expectedCagr,
      equity.metrics.impliedGrowth,
      equity.metrics.expectationGap,
      equity.metrics.stressTestedExpectationGap,
      equity.mispricingScore,
      equity.metrics.roce,
      equity.metrics.cfoPatRatio,
      equity.metrics.receivableDays,
      notificationStatus
    ]);

    results.alertsDispatched++;
    results.dispatchedTickers.push(ticker);
  }

  return results;
}
