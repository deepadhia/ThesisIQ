const fs = require('fs');
const path = 'f:/Personal Projects/multibagger-live/src/components/CopyGeminiPrompt.tsx';
let lines = fs.readFileSync(path, 'utf8').split('\n');

const startLine = lines.findIndex(l => l.includes('const prompt = `**System Role:**'));
const endLine = lines.findIndex(l => l.includes('await validateAndCopy(prompt, "prompt"'));

if (startLine !== -1 && endLine !== -1) {
  const replacement = `  const prompt = \`**System Role:** Lead Indian Equity Research Analyst. Evaluate stock health: Strengthening | Stable | Weakening | Broken.
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
Return a SINGLE JSON object exactly matching this schema. No prose. No markdown backticks.\`;

  const copyPrompt = async () => {
    const { prompt } = buildGeminiContext(
      stock, promises, snapshots, (trackingConfig as Record<string, unknown> | null) ?? null, 
      historyLimitQuarter === "all" ? null : historyLimitQuarter,
      shareholding, valuation, options
    );
    await validateAndCopy(prompt, "prompt", \`\${stock.ticker} — Decision Engine prompt ready.\`);
  };`;

  lines.splice(startLine, (endLine - startLine) + 1, replacement);
  
  let content = lines.join('\n');
  
  // Also clean up any remaining V11/v11
  content = content.replace(/V11/g, 'V12');
  content = content.replace(/v11/g, 'v12');

  fs.writeFileSync(path, content, 'utf8');
  console.log('Refactored prompt to lean V12 and cleaned version tags.');
} else {
  console.error('Could not find start or end markers for prompt replacement.');
}
