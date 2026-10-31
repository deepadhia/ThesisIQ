/**
 * Decision Outcome Resolver Service (Layer 3)
 * 
 * Resolves frozen predictions against subsequent quarterly XBRL filings and market price horizons.
 * 
 * Enforces:
 * - Maturity States: MATURED, PENDING, UNRESOLVABLE (Never treat PENDING as failure)
 * - Calendar Horizons: Reported Quarters (+1Q, +2Q, +4Q) for fundamentals; Trading Sessions (+63, +126, +252) for prices.
 * - 3-Way Decoupling: Thesis Accuracy, Decision Correctness, Investment Outcome.
 */

import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool.js';

export async function resolveDecisionOutcomes(predictionLedger, evidenceSnapshots, client = pool) {
  console.log("==========================================================================");
  console.log("=== 🔬 RESOLVING MATURED DECISION OUTCOMES (FORWARD FUNDAMENTALS & PRICES) ===");
  console.log("==========================================================================");

  // 1. Fetch daily price map for forward market returns
  const pricesRes = await client.query(`
    SELECT s.ticker, TO_CHAR(p.date, 'YYYY-MM-DD') as date_str, p.price
    FROM prices p
    JOIN stocks s ON p.stock_id = s.id
    ORDER BY s.ticker, p.date ASC
  `);

  const pricesByTicker = {};
  for (const row of pricesRes.rows) {
    if (!pricesByTicker[row.ticker]) pricesByTicker[row.ticker] = [];
    pricesByTicker[row.ticker].push({ date: row.date_str, close: Number(row.price) });
  }

  // 2. Group snapshots chronologically per ticker
  const snapshotsByTicker = {};
  for (const s of evidenceSnapshots) {
    if (!snapshotsByTicker[s.ticker]) snapshotsByTicker[s.ticker] = [];
    snapshotsByTicker[s.ticker].push(s);
  }
  for (const t of Object.keys(snapshotsByTicker)) {
    snapshotsByTicker[t].sort((a, b) => (a.period_end_date > b.period_end_date ? 1 : -1));
  }

  const resolvedOutcomes = [];

  let totalPredictionsCount = 0;
  let maturedPredictionsCount = 0;
  let pendingPredictionsCount = 0;
  let correctPredictionsCount = 0;

  for (const entry of predictionLedger) {
    if (entry.status === 'UNRESOLVABLE') {
      resolvedOutcomes.push({
        ...entry,
        maturity_status: 'UNRESOLVABLE',
        thesis_accuracy: 'UNRESOLVABLE',
        decision_correctness: 'UNRESOLVABLE',
        investment_outcome: 'UNRESOLVABLE'
      });
      continue;
    }

    const tSnaps = snapshotsByTicker[entry.ticker] || [];
    const currentSnapIdx = tSnaps.findIndex(s => s.filing_id === entry.evidence_ids[0]);

    const resolvedPredictions = [];
    let entryMaturedCount = 0;
    let entryCorrectCount = 0;

    for (const pred of entry.predictions) {
      totalPredictionsCount++;
      const targetSnapIdx = currentSnapIdx + pred.horizon_reported_quarters;

      if (currentSnapIdx === -1 || targetSnapIdx >= tSnaps.length) {
        // Horizon extends beyond available database timeline -> PENDING
        pendingPredictionsCount++;
        resolvedPredictions.push({
          ...pred,
          status: 'PENDING',
          actual_value: null,
          prediction_met: null,
          resolution_note: `Subsequent +${pred.horizon_reported_quarters}Q reporting filing not yet arrived in DB`
        });
        continue;
      }

      // Matured fundamental observation
      maturedPredictionsCount++;
      entryMaturedCount++;
      const futureSnap = tSnaps[targetSnapIdx];
      let actualValue = null;

      if (pred.metric === 'revenue_growth_yoy_pct') {
        actualValue = futureSnap.derived_features?.revenue_growth_yoy_pct ?? null;
      } else if (pred.metric === 'ebitda_margin_pct') {
        actualValue = futureSnap.current_metrics?.ebitda_margin_pct ?? null;
      } else if (pred.metric === 'trailing_pe') {
        actualValue = futureSnap.derived_features?.trailing_pe ?? null;
      }

      let predictionMet = false;
      if (actualValue !== null) {
        if (pred.target_operator === '>=' && actualValue >= pred.target_value) predictionMet = true;
        if (pred.target_operator === '>' && actualValue > pred.target_value) predictionMet = true;
        if (pred.target_operator === '<=' && actualValue <= pred.target_value) predictionMet = true;
        if (pred.target_operator === '<' && actualValue < pred.target_value) predictionMet = true;
      }

      if (predictionMet) {
        correctPredictionsCount++;
        entryCorrectCount++;
      }

      resolvedPredictions.push({
        ...pred,
        status: 'MATURED',
        resolved_quarter: futureSnap.quarter,
        resolved_period_end: futureSnap.period_end_date,
        actual_value: actualValue,
        prediction_met: predictionMet
      });
    }

    // 3. Resolve Forward Market Returns across Trading Session Horizons
    const tPrices = pricesByTicker[entry.ticker] || [];
    const entryPriceIdx = tPrices.findIndex(p => p.date >= entry.decision_timestamp);

    let price1Q_Return = null;
    let price2Q_Return = null;
    let price4Q_Return = null;

    let market1Q_Matured = false;
    let market2Q_Matured = false;
    let market4Q_Matured = false;

    if (entryPriceIdx !== -1) {
      const basePrice = tPrices[entryPriceIdx].close;
      if (entryPriceIdx + 63 < tPrices.length) {
        price1Q_Return = Number((((tPrices[entryPriceIdx + 63].close - basePrice) / basePrice) * 100).toFixed(2));
        market1Q_Matured = true;
      }
      if (entryPriceIdx + 126 < tPrices.length) {
        price2Q_Return = Number((((tPrices[entryPriceIdx + 126].close - basePrice) / basePrice) * 100).toFixed(2));
        market2Q_Matured = true;
      }
      if (entryPriceIdx + 252 < tPrices.length) {
        price4Q_Return = Number((((tPrices[entryPriceIdx + 252].close - basePrice) / basePrice) * 100).toFixed(2));
        market4Q_Matured = true;
      }
    }

    // 4. Decouple 3 Dimensions
    // A. Thesis Accuracy
    let thesisAccuracy = 'PENDING';
    if (entryMaturedCount > 0) {
      thesisAccuracy = (entryCorrectCount / entryMaturedCount) >= 0.5 ? 'CORRECT' : 'INCORRECT';
    }

    // B. Investment Outcome
    let investmentOutcome = 'PENDING';
    if (price2Q_Return !== null) {
      investmentOutcome = price2Q_Return > 0 ? 'PROFITABLE' : 'LOSS';
    } else if (price1Q_Return !== null) {
      investmentOutcome = price1Q_Return > 0 ? 'PROFITABLE' : 'LOSS';
    }

    // C. Decision Correctness (Given action taken and outcomes)
    let decisionCorrectness = 'PENDING';
    const action = entry.proposed_action;
    if (thesisAccuracy !== 'PENDING') {
      if (action === 'ADD' || action === 'RE_ACCUMULATE') {
        decisionCorrectness = (thesisAccuracy === 'CORRECT' && (investmentOutcome === 'PROFITABLE' || investmentOutcome === 'PENDING')) ? 'CORRECT' : 'INCORRECT';
      } else if (action === 'HOLD') {
        decisionCorrectness = thesisAccuracy === 'CORRECT' ? 'CORRECT' : 'INCORRECT';
      } else if (action === 'GATE' || action === 'KILL') {
        // Exit is correct if thesis of slowdown was correct OR if price dropped (loss avoided)
        decisionCorrectness = (thesisAccuracy === 'CORRECT' || investmentOutcome === 'LOSS') ? 'CORRECT' : 'INCORRECT';
      }
    }

    resolvedOutcomes.push({
      prediction_id: entry.prediction_id,
      ticker: entry.ticker,
      quarter: entry.quarter,
      decision_timestamp: entry.decision_timestamp,
      proposed_action: entry.proposed_action,
      maturity_status: entryMaturedCount > 0 ? 'MATURED' : 'PENDING',
      matured_predictions_count: entryMaturedCount,
      correct_predictions_count: entryCorrectCount,
      thesis_accuracy: thesisAccuracy,
      decision_correctness: decisionCorrectness,
      investment_outcome: investmentOutcome,
      market_returns: {
        forward_63d_pct: price1Q_Return,
        forward_126d_pct: price2Q_Return,
        forward_252d_pct: price4Q_Return,
        status_63d: market1Q_Matured ? 'MATURED' : 'PENDING',
        status_126d: market2Q_Matured ? 'MATURED' : 'PENDING',
        status_252d: market4Q_Matured ? 'MATURED' : 'PENDING'
      },
      predictions: resolvedPredictions
    });
  }

  const overallAccuracyPct = maturedPredictionsCount > 0 
    ? Number(((correctPredictionsCount / maturedPredictionsCount) * 100).toFixed(1)) 
    : 0;

  const resolutionSummary = {
    total_evaluations: resolvedOutcomes.length,
    total_predictions: totalPredictionsCount,
    matured_predictions: maturedPredictionsCount,
    pending_predictions: pendingPredictionsCount,
    correct_predictions: correctPredictionsCount,
    overall_prediction_accuracy_pct: overallAccuracyPct
  };

  const auditDir = path.resolve(process.cwd(), 'audit');
  fs.writeFileSync(path.join(auditDir, 'RESOLVED_DECISION_OUTCOMES.json'), JSON.stringify({ summary: resolutionSummary, outcomes: resolvedOutcomes }, null, 2));

  console.log(`✅ Resolved Forward Outcomes:`);
  console.log(`   - Total Predictions:   ${totalPredictionsCount}`);
  console.log(`   - Matured Predictions: ${maturedPredictionsCount}`);
  console.log(`   - Pending Predictions: ${pendingPredictionsCount}`);
  console.log(`   - Correct Predictions: ${correctPredictionsCount} (${overallAccuracyPct}%)`);
  console.log(`💾 Saved: audit/RESOLVED_DECISION_OUTCOMES.json\n`);

  return { summary: resolutionSummary, outcomes: resolvedOutcomes };
}
