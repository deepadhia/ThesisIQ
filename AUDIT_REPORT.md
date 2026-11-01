# 🛡️ ThesisIQ Deep Codebase Audit Report & Bug-Hunting Briefing

**Generated For:** Gemini Argon / Institutional LLM Code Auditor  
**Date:** 2026-11-01  
**Repository:** ThesisIQ (Multibagger Live Tracking & Thesis Evaluation Engine)  
**Security Clearance:** Zero Credentials / No `.env` Secrets Included  

---

## 1. Executive Summary & Audit Scope

ThesisIQ is an automated, real-time institutional equity compounding, duration evaluation, and regulatory announcement pipeline tracking high-growth Indian listed equities.

The core pipeline functions under a critical mandate:
> **Heart of ThesisIQ Invariant:** Every corporate announcement (Financial Results, Investor Presentation, Concall Transcript, Concall Audio) must be deterministically ingested from NSE/BSE, verified against raw statutory PDF text layers, checked against driver-level thesis contracts, and delivered as **one accurate Telegram alert within 90 seconds** without dropping data or inventing metrics.

This audit package provides the complete, un-truncated codebase for exhaustive forensic review:
1. `src_and_scripts_only.txt`: Frontend React components, custom hooks, and operational script runners.
2. `audit_bundle.txt`: Master concatenated codebase archive encompassing all backend services, workers, database models, and test fixtures.
3. `thesisiq_code_audit.zip`: Production ZIP archive ready for IDE / LLM environment execution.

---

## 2. Architecture & Pipeline Dataflow

```text
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
```

---

## 3. Top Critical Bug-Hunting Vectors for Gemini Argon

When auditing the code in `audit_bundle.txt`, prioritize the following high-risk failure modes:

### Vector 1: Statement Parsing & OCR Traps (`backend/services/financial-validator.service.js`)
- **Decimal & Unit Traps:** Look for situations where Lakhs, Crores, or Millions could be conflated or re-scaled twice.
- **OCR Artifacts:** Indian statutory PDFs often contain broken character spacing (e.g. `Depre ci ation`, `Opetations`, `Coniol id:o ted`). Check if regexes fail-closed or fail-open.
- **Multi-Column Column Count Ambiguity:** When note-reference numbers sit between date columns, does the parser correctly resolve 3, 4, 5, or 6 columns without column drift?
- **Segment Assets vs Segment Results:** Ensure balance sheet segment assets/liabilities are never parsed as segment profit/loss rows.

### Vector 2: Worker Daemon Timeouts & Race Conditions (`backend/workers/quarterly-deepdive-worker.js`)
- **Process Restart Boundary (PM2 5-minute SIGKILL):** The production scanner and worker run under PM2 with `--no-autorestart` and are killed every 5 minutes.
- **Alert Sent BEFORE Mark Completed (Invariant I1):** Audit whether slow post-processing (syntheses, audits) can delay Telegram alerts past the 5-minute cutoff.
- **Scan Lease & Dual-Worker Mutex (`system_settings.scan_lease`):** Does `acquireScanLease` prevent overlapping runs between the Oracle VM daemon and GitHub Actions failover?

### Vector 3: LLM Failover & Hallucination Guard (`backend/services/llm.service.js`, `institutional-guard.service.js`)
- **Failover Order:** Groq -> Gemini -> OpenRouter -> NVIDIA NIM (NIM strictly last). Verify that a 429 rate limit or 503 outage on one provider immediately fails over without dropping the filing.
- **Anti-Fabrication Guard (Invariant I4):** If all LLM providers fail, the system must retry (up to 3 attempts), and then degrade honestly with an "AI narrative unavailable" banner. Confirm no default verdicts ("ADD" or "HOLD") are ever invented.
- **Grounding Guard:** Ensure `sanitizeLlmOutput` strips any metric, growth percentage, or financial claim that does not literally exist in the document text.

### Vector 4: Quantitative Hurdle & Thesis Gate Precedence (`backend/services/thesis-gate-evaluator.service.js`)
- **Veto Precedence (Invariant I7):** Can a high conviction score or qualitative narrative override a broken quantitative gate? (Invariant I7 dictates that PAT contraction, margin erosion >100 bps, or broken HIGH-materiality thesis drivers can only *downgrade* a buy, never upgrade).
- **Turnaround Handling:** Verify how loss-to-profit situations (negative base quarter) are computed so division-by-zero or inverted growth percentages do not produce erroneous BUY verdicts.

### Vector 5: Valuation & Reverse-DCF Consistency (`backend/services/asymmetric-mispricing-ranking.service.js`)
- **Market Data Freshness (Invariant 7):** CMP, Trailing P/E, Market Cap, and ROCE must come only from `market_data_snapshots`. Ensure no static placeholder multiples exist in code paths.
- **Reverse DCF Identity:** Verify that implied growth $g_{\text{market}}$ correctly solves the 10-year FCFF equation without look-ahead bias or unrealistic terminal reinvestment assumptions.

---

## 4. Invariant Test Suite Reference

All pipeline code changes must satisfy the 16 Hard Invariants documented in `.agents/AGENTS.md`:
- `npm run lint:backend`: Strict ESLint check (catches undefined variables).
- `npm run test:heart`: Worker pipeline end-to-end suite (`backend/tests/worker-pipeline.test.js`).
- `npm test`: Full project test suite (533 tests across 30 test files).

---

## 5. Verification Checklist for Auditor
- [ ] Scan for unhandled Promise rejections or empty `.catch(() => {})` blocks in the alert path.
- [ ] Check SQL injection boundaries on dynamic queries in `requeue-stuck-filings.js` and `quarterly-deepdive-worker.js`.
- [ ] Verify that exchange timestamps are strictly converted using `parseExchangeTimestamp` (IST wall-clock).
- [ ] Ensure BSE attachment URLs always construct from `ATTACHMENTNAME` rather than `NEWSID`.
