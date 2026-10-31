/**
 * Wrong Decision Laboratory Service (Layer 3)
 * 
 * Forensic classification and root-cause analysis of every failed or sub-optimal decision.
 * 
 * 5 Exhaustive Failure Categories:
 * 1. FUNDAMENTAL_FALSE_POSITIVE
 * 2. OPPORTUNITY_COST_EXIT
 * 3. PREMATURE_REACCUMULATION
 * 4. VALUATION_TRAP
 * 5. CORRECT_THESIS_WRONG_ACTION
 */

import fs from 'fs';
import path from 'path';

export function runWrongDecisionLaboratory(resolvedOutcomes, evidenceSnapshots, portfolioSummary) {
  console.log("==========================================================================");
  console.log("=== 🔬 EXECUTING WRONG DECISION LABORATORY (FORENSIC FAILURE CLASSIFIER) ===");
  console.log("==========================================================================");

  const failureEntries = [];

  const categoryCounts = {
    FUNDAMENTAL_FALSE_POSITIVE: 0,
    OPPORTUNITY_COST_EXIT: 0,
    PREMATURE_REACCUMULATION: 0,
    VALUATION_TRAP: 0,
    CORRECT_THESIS_WRONG_ACTION: 0
  };

  let failureIdCounter = 1;

  for (const outcome of resolvedOutcomes) {
    if (outcome.maturity_status !== 'MATURED') continue;

    const action = outcome.proposed_action;
    const thesis = outcome.thesis_accuracy;
    const correctness = outcome.decision_correctness;
    const market = outcome.market_returns;
    const fwd63d = market.forward_63d_pct;
    const fwd126d = market.forward_126d_pct;

    let failureCategory = null;
    let rootCause = '';
    let implicatedRule = '';
    let severity = 'LOW';
    let detectableAtTs = false;
    let capitalImpact = 0;

    // Case 1: FUNDAMENTAL_FALSE_POSITIVE (ADD/RE_ACCUMULATE but fundamentals failed)
    if ((action === 'ADD' || action === 'RE_ACCUMULATE') && thesis === 'INCORRECT') {
      failureCategory = 'FUNDAMENTAL_FALSE_POSITIVE';
      rootCause = 'Subsequent quarterly reported revenue growth or EBITDA margin missed underwriting criteria';
      implicatedRule = 'FROZEN_V1 / INITIAL_UNDERWRITING_PASS';
      severity = fwd126d !== null && fwd126d < -15 ? 'HIGH' : 'MEDIUM';
      detectableAtTs = false;
      capitalImpact = fwd126d !== null && fwd126d < 0 ? Math.abs(fwd126d * 5000) : 0;
    }
    // Case 2: OPPORTUNITY_COST_EXIT (Exited on GATE/KILL but stock surged)
    else if ((action === 'GATE' || action === 'KILL') && fwd126d !== null && fwd126d > 20.0) {
      failureCategory = 'OPPORTUNITY_COST_EXIT';
      rootCause = `Position was exited on ${action} rule, but stock rebounded strongly (+${fwd126d}% over 2Q)`;
      implicatedRule = action === 'GATE' ? 'FROZEN_V1 / MARGIN_COMPRESSION_GATE' : 'FROZEN_V1 / STRUCTURAL_COLLAPSE_KILL';
      severity = fwd126d > 40.0 ? 'HIGH' : 'MEDIUM';
      detectableAtTs = true; // Historical volatility or cyclicity was visible at T_S
      capitalImpact = Math.round(fwd126d * 5000);
    }
    // Case 3: PREMATURE_REACCUMULATION (Re-accumulated but stock fell)
    else if (action === 'RE_ACCUMULATE' && fwd126d !== null && fwd126d < -10.0) {
      failureCategory = 'PREMATURE_REACCUMULATION';
      rootCause = 'Position was re-accumulated before full fundamental multi-quarter turnaround was established';
      implicatedRule = 'FROZEN_V1 / RE_ACCUMULATION_TRIGGER';
      severity = 'HIGH';
      detectableAtTs = true;
      capitalImpact = Math.abs(Math.round(fwd126d * 5000));
    }
    // Case 4: VALUATION_TRAP (Fundamentals held, but stock dropped due to PE contraction)
    else if (action === 'ADD' && thesis === 'CORRECT' && fwd126d !== null && fwd126d < -15.0) {
      failureCategory = 'VALUATION_TRAP';
      rootCause = 'Business growth met predictions, but stock suffered severe macro or industry multiple compression';
      implicatedRule = 'FROZEN_V1 / VALUATION_GOVERNOR';
      severity = 'MEDIUM';
      detectableAtTs = true; // Trailing PE elevated at T_S
      capitalImpact = Math.abs(Math.round(fwd126d * 5000));
    }
    // Case 5: CORRECT_THESIS_WRONG_ACTION (Held conservatively while massive acceleration occurred)
    else if (action === 'HOLD' && thesis === 'CORRECT' && fwd126d !== null && fwd126d > 50.0) {
      failureCategory = 'CORRECT_THESIS_WRONG_ACTION';
      rootCause = 'Fundamental inflection was strong (+50% price run), but system remained in passive HOLD instead of scaling into ADD';
      implicatedRule = 'FROZEN_V1 / HOLD_TRANSITION_POLICY';
      severity = 'LOW';
      detectableAtTs = false;
      capitalImpact = Math.round((fwd126d - 20) * 5000);
    }

    if (failureCategory) {
      categoryCounts[failureCategory]++;
      failureEntries.push({
        failure_id: `FAIL_${String(failureIdCounter++).padStart(3, '0')}`,
        ticker: outcome.ticker,
        quarter: outcome.quarter,
        decision_timestamp: outcome.decision_timestamp,
        proposed_action: action,
        failure_category: failureCategory,
        thesis_accuracy: thesis,
        decision_correctness: correctness,
        forward_63d_return_pct: fwd63d,
        forward_126d_return_pct: fwd126d,
        root_cause: rootCause,
        implicated_rule: implicatedRule,
        severity,
        detectable_at_ts: detectableAtTs,
        estimated_capital_impact_inr: capitalImpact
      });
    }
  }

  const labSummary = {
    total_failures_classified: failureEntries.length,
    category_breakdown: categoryCounts,
    total_estimated_capital_impact_inr: failureEntries.reduce((s, f) => s + f.estimated_capital_impact_inr, 0)
  };

  const auditDir = path.resolve(process.cwd(), 'audit');
  fs.writeFileSync(path.join(auditDir, 'WRONG_DECISION_LABORATORY.json'), JSON.stringify({ summary: labSummary, failures: failureEntries }, null, 2));

  console.log(`✅ Wrong Decision Laboratory Classified ${failureEntries.length} Sub-Optimal Decisions:`);
  console.log(`   - Fundamental False Positives:   ${categoryCounts.FUNDAMENTAL_FALSE_POSITIVE}`);
  console.log(`   - Opportunity Cost Exits:        ${categoryCounts.OPPORTUNITY_COST_EXIT}`);
  console.log(`   - Premature Re-accumulations:    ${categoryCounts.PREMATURE_REACCUMULATION}`);
  console.log(`   - Valuation Traps:               ${categoryCounts.VALUATION_TRAP}`);
  console.log(`   - Correct Thesis / Wrong Action: ${categoryCounts.CORRECT_THESIS_WRONG_ACTION}`);
  console.log(`💾 Saved: audit/WRONG_DECISION_LABORATORY.json\n`);

  return { summary: labSummary, failures: failureEntries };
}
