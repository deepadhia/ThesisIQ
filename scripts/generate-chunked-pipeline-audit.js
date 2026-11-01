import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve("audit_core_pipeline");
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

console.log("Generating chunked pipeline audit files (< 80 KB each)...");

// 1. quarterly-deepdive-worker.js (Split into Part 1 and Part 2)
const workerPath = path.resolve("backend/workers/quarterly-deepdive-worker.js");
const workerContent = fs.readFileSync(workerPath, "utf8");
const workerLines = workerContent.split("\n");
const midPoint = Math.floor(workerLines.length / 2);

const workerPart1 = [
  "// =========================================================================",
  "// FILE: backend/workers/quarterly-deepdive-worker.js (PART 1 of 2)",
  `// Lines 1 to ${midPoint} of ${workerLines.length}`,
  "// =========================================================================\n",
  ...workerLines.slice(0, midPoint),
].join("\n");

const workerPart2 = [
  "// =========================================================================",
  "// FILE: backend/workers/quarterly-deepdive-worker.js (PART 2 of 2)",
  `// Lines ${midPoint + 1} to ${workerLines.length} of ${workerLines.length}`,
  "// =========================================================================\n",
  ...workerLines.slice(midPoint),
].join("\n");

fs.writeFileSync(
  path.join(OUT_DIR, "1a_quarterly-deepdive-worker_part1.txt"),
  workerPart1,
  "utf8",
);
fs.writeFileSync(
  path.join(OUT_DIR, "1b_quarterly-deepdive-worker_part2.txt"),
  workerPart2,
  "utf8",
);

// 2. scan-announcements.js
const scanPath = path.resolve("backend/scripts/scan-announcements.js");
const scanContent = fs.readFileSync(scanPath, "utf8");
fs.writeFileSync(
  path.join(OUT_DIR, "2_scan-announcements.txt"),
  [
    "// =========================================================================",
    "// FILE: backend/scripts/scan-announcements.js",
    "// =========================================================================\n",
    scanContent,
  ].join("\n"),
  "utf8",
);

// 3. financial-validator.service.js
const valPath = path.resolve("backend/services/financial-validator.service.js");
const valContent = fs.readFileSync(valPath, "utf8");
fs.writeFileSync(
  path.join(OUT_DIR, "3_financial-validator.service.txt"),
  [
    "// =========================================================================",
    "// FILE: backend/services/financial-validator.service.js",
    "// =========================================================================\n",
    valContent,
  ].join("\n"),
  "utf8",
);

// 4. thesis-gate-evaluator.service.js
const gatePath = path.resolve(
  "backend/services/thesis-gate-evaluator.service.js",
);
const gateContent = fs.readFileSync(gatePath, "utf8");
fs.writeFileSync(
  path.join(OUT_DIR, "4_thesis-gate-evaluator.service.txt"),
  [
    "// =========================================================================",
    "// FILE: backend/services/thesis-gate-evaluator.service.js",
    "// =========================================================================\n",
    gateContent,
  ].join("\n"),
  "utf8",
);

// 5. llm.service.js + institutional-guard.service.js
const llmPath = path.resolve("backend/services/llm.service.js");
const guardPath = path.resolve(
  "backend/services/institutional-guard.service.js",
);
const llmContent = fs.readFileSync(llmPath, "utf8");
const guardContent = fs.readFileSync(guardPath, "utf8");

const combinedLLM = [
  "// =========================================================================",
  "// FILE: backend/services/llm.service.js",
  "// =========================================================================\n",
  llmContent,
  "\n// =========================================================================",
  "// FILE: backend/services/institutional-guard.service.js",
  "// =========================================================================\n",
  guardContent,
].join("\n");

fs.writeFileSync(
  path.join(OUT_DIR, "5_llm-and-institutional-guard.service.txt"),
  combinedLLM,
  "utf8",
);

// Report generated files
console.log("\n--- Chunked Pipeline Audit Inventory ---");
const files = fs.readdirSync(OUT_DIR);
for (const f of files) {
  const stat = fs.statSync(path.join(OUT_DIR, f));
  const kb = (stat.size / 1024).toFixed(1);
  console.log(
    `- ${f}: ${kb} KB (${stat.size} bytes) [${stat.size < 80000 ? "✅ < 80 KB" : "⚠️ > 80 KB"}]`,
  );
}
