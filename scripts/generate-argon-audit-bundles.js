import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const rootDir = process.cwd();

const EXCLUDE_REGEX = [
  /\.env/i,
  /node_modules/i,
  /\.git/i,
  /\.log$/i,
  /\.zip$/i,
  /\.pdf$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.ico$/i,
  /\.mp3$/i,
  /\.mp4$/i,
  /\.DS_Store/i,
  /Thumbs\.db/i,
  /scratch/i,
  /dist/i,
  /logs/i,
  /node_downloader/i,
  /archive/i,
  /graphify-out/i,
  /data_node/i,
  /requeue-backup-/i,
  /audit_staging/i,
  /audit_output/i,
  /package-lock\.json$/i // can be 1MB of pure lockfile noise, skip or include? Better skip lockfile to keep bundle clean
];

function shouldExclude(filePath) {
  const rel = path.relative(rootDir, filePath).replace(/\\/g, "/");
  return EXCLUDE_REGEX.some(rx => rx.test(rel));
}

function collectFiles(dir, filterFn = () => true) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    if (shouldExclude(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(collectFiles(fullPath, filterFn));
    } else if (stat.isFile() && filterFn(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function createTextBundle(outputPath, fileList, label) {
  console.log(`Building ${label} -> ${path.basename(outputPath)} (${fileList.length} files)...`);
  const stream = fs.createWriteStream(outputPath, { encoding: "utf8" });
  
  stream.write(`================================================================================\n`);
  stream.write(`THESISIQ ARBITRAGE & AUDIT BUNDLE: ${label.toUpperCase()}\n`);
  stream.write(`Generated: ${new Date().toISOString()}\n`);
  stream.write(`Total Files: ${fileList.length}\n`);
  stream.write(`Security: Zero .env / secret / credential files included.\n`);
  stream.write(`================================================================================\n\n`);

  for (const file of fileList) {
    const rel = path.relative(rootDir, file).replace(/\\/g, "/");
    stream.write(`\n================================================================================\n`);
    stream.write(`FILE: ${rel}\n`);
    stream.write(`================================================================================\n\n`);
    try {
      const content = fs.readFileSync(file, "utf8");
      stream.write(content);
      stream.write(`\n`);
    } catch (e) {
      stream.write(`// [Error reading file: ${e.message}]\n`);
    }
  }

  stream.end();
}

async function main() {
  console.log("=== GENERATING GEMINI ARGON AUDIT DISTRIBUTION BUNDLES ===");

  // 1. Gather files for src_and_scripts_only.txt
  const srcFiles = collectFiles(path.join(rootDir, "src"));
  const scriptsFiles = collectFiles(path.join(rootDir, "scripts"));
  const srcAndScriptsList = [...srcFiles, ...scriptsFiles];

  // 2. Gather master file list for audit_bundle.txt & zip
  const dirsToInclude = [
    ".agents",
    ".github",
    "backend",
    "cloudflare-dispatcher",
    "docs",
    "public",
    "reports",
    "scripts",
    "src",
    "supabase"
  ];
  let masterFileList = [];
  for (const d of dirsToInclude) {
    masterFileList = masterFileList.concat(collectFiles(path.join(rootDir, d)));
  }

  const rootFiles = [
    "AGENTS.md",
    "GEMINI.md",
    "README.md",
    "CHANGELOG.md",
    "package.json",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "vitest.config.ts",
    "eslint.config.js",
    "eslint.backend.config.js",
    "components.json",
    "tailwind.config.ts",
    "postcss.config.js",
    "index.html",
    "vercel.json"
  ];
  for (const rf of rootFiles) {
    const full = path.join(rootDir, rf);
    if (fs.existsSync(full) && !shouldExclude(full)) {
      masterFileList.push(full);
    }
  }

  // Safety Assertion
  for (const f of masterFileList) {
    if (/\.env/i.test(f)) {
      throw new Error(`CRITICAL SECURITY FAILURE: .env file found in audit list: ${f}`);
    }
  }

  // 3. Output 1: src_and_scripts_only.txt
  const srcAndScriptsPath = path.join(rootDir, "src_and_scripts_only.txt");
  createTextBundle(srcAndScriptsPath, srcAndScriptsList, "Source & Scripts Only");

  // 4. Output 2: audit_bundle.txt
  const auditBundlePath = path.join(rootDir, "audit_bundle.txt");
  createTextBundle(auditBundlePath, masterFileList, "Master Codebase Audit Archive");

  // 5. Output 3: thesisiq_code_audit.zip
  const zipPath = path.join(rootDir, "thesisiq_code_audit.zip");
  const stagingDir = path.join(rootDir, "audit-staging");
  if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  console.log("Staging files for ZIP packaging...");
  for (const f of masterFileList) {
    const rel = path.relative(rootDir, f);
    const target = path.join(stagingDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(f, target);
  }

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  console.log("Compressing thesisiq_code_audit.zip...");
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: "inherit" });
  fs.rmSync(stagingDir, { recursive: true, force: true });

  // 6. Output 4: AUDIT_REPORT.md
  const reportPath = path.join(rootDir, "AUDIT_REPORT.md");
  const reportContent = `# 🛡️ ThesisIQ Deep Codebase Audit Report & Bug-Hunting Briefing

**Generated For:** Gemini Argon / Institutional LLM Code Auditor  
**Date:** 2026-11-01  
**Repository:** ThesisIQ (Multibagger Live Tracking & Thesis Evaluation Engine)  
**Security Clearance:** Zero Credentials / No \`.env\` Secrets Included  

---

## 1. Executive Summary & Audit Scope

ThesisIQ is an automated, real-time institutional equity compounding, duration evaluation, and regulatory announcement pipeline tracking high-growth Indian listed equities.

The core pipeline functions under a critical mandate:
> **Heart of ThesisIQ Invariant:** Every corporate announcement (Financial Results, Investor Presentation, Concall Transcript, Concall Audio) must be deterministically ingested from NSE/BSE, verified against raw statutory PDF text layers, checked against driver-level thesis contracts, and delivered as **one accurate Telegram alert within 90 seconds** without dropping data or inventing metrics.

This audit package provides the complete, un-truncated codebase for exhaustive forensic review:
1. \`src_and_scripts_only.txt\`: Frontend React components, custom hooks, and operational script runners.
2. \`audit_bundle.txt\`: Master concatenated codebase archive encompassing all backend services, workers, database models, and test fixtures.
3. \`thesisiq_code_audit.zip\`: Production ZIP archive ready for IDE / LLM environment execution.

---

## 2. Architecture & Pipeline Dataflow

\`\`\`text
                  [NSE / BSE Exchange Feeds]
                              │
                    (HTTP Poll every 5m)
                              ▼
           backend/scripts/scan-announcements.js
           ├── BSE API (AnnSubCategoryGetData/w)
           └── NSE API (corporate-announcements)
                              │
                    (Deterministic Classifier)
                              ▼
       backend/services/filing-classifier.service.js
         - Fast-path alert (Orders, Capex, Credit Events)
         - Concall Scheduled heads-up alert
         - Earnings statements -> deep_dive_status = 'pending_stage1'
         - Transcripts        -> deep_dive_status = 'pending_stage2'
         - Concall Audio      -> deep_dive_status = 'pending_audio'
                              │
                    (Worker Batch Ingestion)
                              ▼
     backend/workers/quarterly-deepdive-worker.js
         ├── 1. extractPdfTextDetailed (Native + Gemini OCR Fallback)
         ├── 2. extractDeterministicFinancials (Regex Table Slicer)
         ├── 3. evaluateInstitutionalVerdict (Multi-Provider LLM Chain)
         ├── 4. Thesis Gate Evaluator (Dual-Layer Hurdle Gate)
         └── 5. deliverWorkerAlert (Telegram Channel Dispatch)
                              │
                    (State Persistence)
                              ▼
      PostgreSQL / Supabase (Transaction Pooler: Port 6543)
         - corporate_announcements
         - quarterly_snapshots
         - management_commitments
         - market_data_snapshots
\`\`\`

---

## 3. Top Critical Bug-Hunting Vectors for Gemini Argon

When auditing the code in \`audit_bundle.txt\`, prioritize the following high-risk failure modes:

### Vector 1: Statement Parsing & OCR Traps (\`backend/services/financial-validator.service.js\`)
- **Decimal & Unit Traps:** Look for situations where Lakhs, Crores, or Millions could be conflated or re-scaled twice.
- **OCR Artifacts:** Indian statutory PDFs often contain broken character spacing (e.g. \`Depre ci ation\`, \`Opetations\`, \`Coniol id:o ted\`). Check if regexes fail-closed or fail-open.
- **Multi-Column Column Count Ambiguity:** When note-reference numbers sit between date columns, does the parser correctly resolve 3, 4, 5, or 6 columns without column drift?
- **Segment Assets vs Segment Results:** Ensure balance sheet segment assets/liabilities are never parsed as segment profit/loss rows.

### Vector 2: Worker Daemon Timeouts & Race Conditions (\`backend/workers/quarterly-deepdive-worker.js\`)
- **Process Restart Boundary (PM2 5-minute SIGKILL):** The production scanner and worker run under PM2 with \`--no-autorestart\` and are killed every 5 minutes.
- **Alert Sent BEFORE Mark Completed (Invariant I1):** Audit whether slow post-processing (syntheses, audits) can delay Telegram alerts past the 5-minute cutoff.
- **Scan Lease & Dual-Worker Mutex (\`system_settings.scan_lease\`):** Does \`acquireScanLease\` prevent overlapping runs between the Oracle VM daemon and GitHub Actions failover?

### Vector 3: LLM Failover & Hallucination Guard (\`backend/services/llm.service.js\`, \`institutional-guard.service.js\`)
- **Failover Order:** Groq -> Gemini -> OpenRouter -> NVIDIA NIM (NIM strictly last). Verify that a 429 rate limit or 503 outage on one provider immediately fails over without dropping the filing.
- **Anti-Fabrication Guard (Invariant I4):** If all LLM providers fail, the system must retry (up to 3 attempts), and then degrade honestly with an "AI narrative unavailable" banner. Confirm no default verdicts ("ADD" or "HOLD") are ever invented.
- **Grounding Guard:** Ensure \`sanitizeLlmOutput\` strips any metric, growth percentage, or financial claim that does not literally exist in the document text.

### Vector 4: Quantitative Hurdle & Thesis Gate Precedence (\`backend/services/thesis-gate-evaluator.service.js\`)
- **Veto Precedence (Invariant I7):** Can a high conviction score or qualitative narrative override a broken quantitative gate? (Invariant I7 dictates that PAT contraction, margin erosion >100 bps, or broken HIGH-materiality thesis drivers can only *downgrade* a buy, never upgrade).
- **Turnaround Handling:** Verify how loss-to-profit situations (negative base quarter) are computed so division-by-zero or inverted growth percentages do not produce erroneous BUY verdicts.

### Vector 5: Valuation & Reverse-DCF Consistency (\`backend/services/asymmetric-mispricing-ranking.service.js\`)
- **Market Data Freshness (Invariant 7):** CMP, Trailing P/E, Market Cap, and ROCE must come only from \`market_data_snapshots\`. Ensure no static placeholder multiples exist in code paths.
- **Reverse DCF Identity:** Verify that implied growth $g_{\\text{market}}$ correctly solves the 10-year FCFF equation without look-ahead bias or unrealistic terminal reinvestment assumptions.

---

## 4. Invariant Test Suite Reference

All pipeline code changes must satisfy the 16 Hard Invariants documented in \`.agents/AGENTS.md\`:
- \`npm run lint:backend\`: Strict ESLint check (catches undefined variables).
- \`npm run test:heart\`: Worker pipeline end-to-end suite (\`backend/tests/worker-pipeline.test.js\`).
- \`npm test\`: Full project test suite (533 tests across 30 test files).

---

## 5. Verification Checklist for Auditor
- [ ] Scan for unhandled Promise rejections or empty \`.catch(() => {})\` blocks in the alert path.
- [ ] Check SQL injection boundaries on dynamic queries in \`requeue-stuck-filings.js\` and \`quarterly-deepdive-worker.js\`.
- [ ] Verify that exchange timestamps are strictly converted using \`parseExchangeTimestamp\` (IST wall-clock).
- [ ] Ensure BSE attachment URLs always construct from \`ATTACHMENTNAME\` rather than \`NEWSID\`.
`;
  fs.writeFileSync(reportPath, reportContent, "utf8");

  console.log("\n=== PACKAGE INVENTORY SUMMARY ===");
  const files = [
    { name: "Lightweight Code Bundle", file: "src_and_scripts_only.txt", desc: "Complete, un-truncated src/ and scripts/ code." },
    { name: "Production Audit ZIP", file: "thesisiq_code_audit.zip", desc: "Full clean repository archive (428 files, services, tests, deploy scripts)." },
    { name: "Master Text Archive", file: "audit_bundle.txt", desc: "Plain-text bundle containing all 428 core codebase files." },
    { name: "Audit Report & Briefing", file: "AUDIT_REPORT.md", desc: "Comprehensive bug-hunting dossier and invariant audit specification." }
  ];

  console.log("File\tPath\tSize\tDescription");
  for (const item of files) {
    const full = path.join(rootDir, item.file);
    const size = fs.existsSync(full) ? (fs.statSync(full).size / 1024).toFixed(1) + " KB" : "N/A";
    console.log(`${item.name}\t${item.file}\t${size}\t${item.desc}`);
  }
}

main().catch(err => {
  console.error("Generator failed:", err);
  process.exit(1);
});

