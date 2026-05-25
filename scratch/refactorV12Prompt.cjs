const fs = require('fs');
const path = 'f:/Personal Projects/multibagger-live/src/components/CopyGeminiPrompt.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Fix Valuation Data Logic (Handling array from useFinancialMetrics)
const targetValuationLogic = `  let filteredValuation = valuation;
  if (limitToQuarter && filteredSnapshots.length > 0) {
    if (valuation && valuation.created_at && new Date(valuation.created_at).getTime() > cutoffDate) {
      filteredValuation = null;
    }
  }`;

const replacementValuationLogic = `  let filteredValuation = null;
  if (Array.isArray(valuation) && valuation.length > 0) {
    // Filter by cutoffDate if applicable, then take the latest
    const validMetrics = limitToQuarter && filteredSnapshots.length > 0
      ? valuation.filter((v: any) => v.created_at && new Date(v.created_at).getTime() <= cutoffDate)
      : valuation;
    
    if (validMetrics.length > 0) {
      filteredValuation = validMetrics[validMetrics.length - 1]; // Latest one
    }
  }`;

content = content.replace(targetValuationLogic, replacementValuationLogic);

// 2. Full Version Cleanup (V11 -> V12)
content = content.replace(/V11/g, 'V12');
content = content.replace(/v11/g, 'v12');

// 3. Prompt Consolidation & Bloat Reduction
// We will replace the entire prompt template literal with a leaner version.

const startMarker = '  const prompt = `**System Role:**';
const endMarker = '    });\n    await validateAndCopy(prompt, "prompt"';
const promptStartIdx = content.indexOf(startMarker);
const promptEndIdx = content.indexOf(endMarker);

if (promptStartIdx !== -1 && promptEndIdx !== -1) {
  const leanPrompt = `  const prompt = \`**System Role:** Lead Indian Equity Research Analyst. Evaluate stock health: Strengthening | Stable | Weakening | Broken.
**Mandate:** Economic reality over narrative. No hallucination. Extreme skepticism for opaque data.

═══════════════════════════════════════
PARAMETERIZED INPUTS
═══════════════════════════════════════
**TICKER:** \${stock.ticker} | **THESIS:** \${coreThesis}
**DIRECTIVES:** \${trackingDirectives}
**MANDATORY METRICS:** \${mandatoryMetricsReadable}
**PRIMARY METRIC:** \${primaryMetricLabel}

═══════════════════════════════════════
STRICT RULE CHECK (KILL SWITCHES)
═══════════════════════════════════════
**Review frequency:** \${reviewFrequencyLine}
**Kill switches / Add conditions:**
\${killSwitchLines}
\${addOnLines}

**MANDATE:** Every rule above must have a corresponding entry in \\\`strict_rule_check.kill_switches\\\` or \\\`add_conditions\\\`. Status: triggered | not_triggered | insufficient_data.

═══════════════════════════════════════
HISTORICAL CONTEXT (ROLLING YTD)
═══════════════════════════════════════
\${rollingSnapshots}

**PROMISE LEDGER:**
\${JSON.stringify(pendingLedger, null, 2)}
**Credibility Score:** \${credibility}

═══════════════════════════════════════
⚠️ HARD LOGIC GATES — V12
═══════════════════════════════════════
1. **THESIS DOMINANCE (RULE 1):** IF thesis_score < 60 → Action: CUT, Size: none. Ignore valuation.
2. **KILL SWITCHES (RULE 2):** HIGH triggered → MUST CUT. MEDIUM triggered → BLOCK BUILD/ADD.
3. **EARNINGS QUALITY (RULE 7/8):** IF OCF/EBITDA < 0.5 OR unexplained WC stretch → Conviction Cap ≤ 60, Size: STARTER.
4. **MOMENTUM (RULE 9):** Evaluate sequential trend: Accelerating (+5), Stable (0), Decelerating 1Q (-5), 2Q+ (-10).
5. **MULTIBAGGER MODE (RULE 11):** If thesis ≥ 80, require 2Q (or 3Q for lumpy EPC/Capex) of deterioration before CUT, UNLESS HIGH kill switch fired.
6. **SKEPTICISM (RULE 14):** If zero warnings/omissions reported → -5 conviction (Low Disclosure Risk).
7. **CYCLE PEAK (RULE 12):** Multi-quarter high margins/growth + blind bullishness → -10 conviction (Cycle Peak Risk).
8. **SOURCE PRIORITY (RULE 17):** Transcript (Truth) > External Data. Conflict → Trust Transcript, -10 conviction.
9. **OWNERSHIP (RULE 22):** Consistent promoter selling (unexplained) → -10 conviction.

═══════════════════════════════════════
🛡️ V12 INTEGRITY & SKEPTICISM
═══════════════════════════════════════
23. **VALUATION HALLUCINATION BAN:** IF Section D is "NOT DISCLOSED" or "SYNCING" → valuation_score = "NOT RATEABLE". Do NOT guess.
24. **EPC/CAPITAL GOODS PENALTY:** IF opaque OCF/WC for execution-heavy businesses → Conviction Cap ≤ 62.
25. **MOMENTUM INTEGRITY:** NEVER mix YoY% with sequential absolute numbers. If trend data missing → Momentum = "Insufficient Data".
26. **TIME-TRAVEL PURITY:** Strictly ignore any data newer than the selected historical quarter.

═══════════════════════════════════════
🧩 SCORING FRAMEWORK
═══════════════════════════════════════
**THESIS (0-100):** Primary Metric (40), Growth Quality (25), Margins (20), Execution Signals (15).
**CONVICTION (0-100):** Management (25), Transparency (20), B/S Strength (20), Consistency (20), Risk Flags (-15).

═══════════════════════════════════════
🌐 DECISION CONTEXT
═══════════════════════════════════════
\${decisionEngineContext}

═══════════════════════════════════════
OUTPUT FORMAT (STRICT JSON — V12)
═══════════════════════════════════════
Return a SINGLE JSON matching the schema provided earlier. No prose.\`;`;

  content = content.substring(0, promptStartIdx) + leanPrompt + "\n" + content.substring(promptEndIdx);
}

fs.writeFileSync(path, content, 'utf8');
console.log('V12.1 Refactor complete: Fixed valuation array logic, cleaned version tags, and compressed prompt.');
