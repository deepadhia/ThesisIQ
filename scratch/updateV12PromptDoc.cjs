const fs = require('fs');
const path = 'f:/Personal Projects/multibagger-live/docs/V12_PROMPT.md';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('⚠️ NON-NEGOTIABLE RULES (HARD LOGIC) — V10', '⚠️ NON-NEGOTIABLE RULES (HARD LOGIC) — V12');

const newRules = `
23. **VALUATION HALLUCINATION BAN (STRICT)**
    IF SECTION D (Valuation Snapshot) is "NOT DISCLOSED" or "FINANCIAL DATA SYNCING":
    → YOU MUST set valuation_score = "NOT RATEABLE" (do not guess a number).
    → YOU MUST state in valuation_commentary: "Valuation cannot be fairly assessed without relevant PE / EVEBITDA / market cap inputs."
    → YOU CANNOT assign a final_action of BUILD or ADD unless the valuation is known or the thesis is overwhelmingly strong and you explicitly note the valuation blind spot.

24. **PROJECT BUSINESS DATA PENALTY**
    IF OCF, Working Capital, and Debt are ALL "NOT DISCLOSED" AND the business model is execution-heavy (e.g. EPC, Project, Capital Goods):
    → YOU MUST cap conviction_score ≤ 62.
    → Rationale: Lack of cash flow visibility in an execution-heavy business is a severe risk, not a neutral event.

25. **MOMENTUM INTEGRITY RULE**
    Momentum evaluation requires 3 comparable data points (either 3 sequential QoQ percentages OR 3 YoY percentages).
    → NEVER mix YoY percentages with absolute sequential numbers (e.g., mixing YoY growth with absolute PAT in Crores).
    → IF SECTION B (Last 3 Quarter Trend) states "Insufficient Data", then primary_metric_momentum.direction MUST be "Insufficient Data".

26. **HISTORICAL PURITY RULE**
    When evaluating a historical quarter, NO data newer than the selected historical quarter may be used anywhere in the prompt or analysis. Ignore modern context.
`;

const splitMarker = '═══════════════════════════════════════\n🧩 SCORING FRAMEWORK';
const newSection = '═══════════════════════════════════════\n🛡️ STRICT SKEPTICISM & INTEGRITY (V12)\n═══════════════════════════════════════\n' + newRules + '\n' + splitMarker;
content = content.replace(splitMarker, newSection);

// Update version string in payload
content = content.replace('system_version: "v11"', 'system_version: "v12"');

// Update heading
content = content.replace('# Decision Engine Prompt Template (V11)', '# Decision Engine Prompt Template (V12)');

fs.writeFileSync(path, content, 'utf8');
console.log('V12_PROMPT.md updated.');
