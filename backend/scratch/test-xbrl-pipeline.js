import { getTagsForMetric } from '../services/xbrl/aliasDictionary.js';
import { mergeXbrlData } from '../services/xbrl/canonicalMergeEngine.js';
import { formatXbrlQuarterForPrompt } from '../services/xbrl.service.js';

console.log("=== 1. Testing Alias Dictionary ===");
const payablesTags = getTagsForMetric('trade_payables');
console.log("Trade Payables Tags:", payablesTags);
console.log("Contains 'TradePayables':", payablesTags.includes('TradePayables') ? "✅ PASSED" : "❌ FAILED");

console.log("\n=== 2. Testing Canonical Merge Engine (Segment Scaling & Trade Payables) ===");
const apiData = {
    revenue_from_ops: 100000000, // 10 Crores
    pat: 10000000 // 1 Crore
};

const xmlParsedData = {
    metrics: {
        "FY24-Q1": {
            revenue: 10, // 10 Crores in Crores (needs 10000000 scaling)
            pat: 1,      
            trade_payables: 5 // 5 Crores
        }
    },
    segments: [
        { quarter: "FY24-Q1", segment_name: "Towers", metric: "revenue", value: 6 },
        { quarter: "FY24-Q1", segment_name: "PVC", metric: "revenue", value: 4 }
    ],
    confidence: 95
};

const { merged } = mergeXbrlData(apiData, xmlParsedData);

console.log("Merged Trade Payables:", merged.trade_payables);
console.log("Trade Payables is 5 Crores (50,000,000):", merged.trade_payables === 50000000 ? "✅ PASSED" : "❌ FAILED");

console.log("Merged Segment 1 (Towers) Scaled Value:", merged.segments[0].value);
console.log("Segment 1 is 6 Crores (60,000,000):", merged.segments[0].value === 60000000 ? "✅ PASSED" : "❌ FAILED");

console.log("Payable Days:", merged.payable_days);
console.log("Working Capital Days:", merged.working_capital_days);

console.log("\n=== 3. Testing Format Prompt (Working Capital Status) ===");
const promptRow = {
    quarter: "FY24-Q1",
    period_start_date: "2023-04-01",
    period_end_date: "2023-06-30",
    source_preferred: "merged",
    revenue_from_ops: 100000000, // 10 Cr
    pat: 10000000, // 1 Cr
    receivables: 20000000, // 2 Cr
    inventory: 30000000, // 3 Cr
    trade_payables: 40000000, // 4 Cr
    working_capital_days: ((20000000 + 30000000 - 40000000) / 100000000) * 90 // 9 days
};

const promptOutput = formatXbrlQuarterForPrompt(promptRow);
console.log("Prompt Output:");
console.log(promptOutput);
console.log("\nContains 'Payables: ₹4.00 Cr':", promptOutput.includes("Payables: ₹4.00 Cr") ? "✅ PASSED" : "❌ FAILED");
console.log("Contains 'Cycle: 9 days':", promptOutput.includes("Cycle: 9 days") ? "✅ PASSED" : "❌ FAILED");
console.log("Contains 'Extremely Efficient':", promptOutput.includes("Extremely Efficient") ? "✅ PASSED" : "❌ FAILED");
