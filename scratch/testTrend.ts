import { computeTrendDirection, computeMarginTrend, computeOwnershipTrend } from "../src/lib/trendAnalysis";

console.log("--- TEST CASES ---");

// Case A: 62, 51, 43
console.log("Case A:", computeTrendDirection([62, 51, 43])); // Expected: Decelerating

// Case B: 20, 19, 21
console.log("Case B:", computeTrendDirection([20, 19, 21])); // Expected: Stable / Mixed

// Case C: 10.1, 10.2, 10.1
console.log("Case C:", computeMarginTrend([10.1, 10.2, 10.1])); // Expected: Stable Margin

// Case D: Promoter 66.5, 66.4, 65.1
console.log("Case D:", computeOwnershipTrend([66.5, 66.4, 65.1], [10, 10, 10.1], [5, 5, 5])); // Expected: Notable reduction

// Case E: 15, 35, 18
console.log("Case E:", computeTrendDirection([15, 35, 18])); // Expected: Mixed / Volatile

// Case F: 12.4, 11.8, 10.9
console.log("Case F:", computeMarginTrend([12.4, 11.8, 10.9])); // Expected: Compressing

// Case G: 66.5, null, 65.1
console.log("Case G (Promoter):", computeOwnershipTrend([66.5, null, 65.1], [], []).label); // Expected: Partial / Insufficient
console.log("Case G (Trend):", computeTrendDirection([66.5, null, 65.1])); // Expected: Insufficient Data
