# Project Agent Rules & System Constraints

## 1. Zero Manual Database Patching Rule
- **NEVER** run ad-hoc SQL `UPDATE` or `DELETE` scripts to manually override database rows or force status changes.
- If data or status is incorrect in the database, you **MUST** diagnose and fix the underlying code, LLM prompt, or parser logic so the system automatically computes and extracts the correct state dynamically.
- Exception: committed, idempotent seed scripts that are dry-run by default and back up what they change (e.g. `backend/scripts/seed-stock-theses.js`) are code, not manual patches — but they run with `--apply` ONLY when the user explicitly asks.

## 2. Multi-Stage Regulatory Commitment Evaluation Rule
- For multi-stage corporate actions (e.g., Schemes of Arrangement, Demergers, M&A, QIP allotments, NCLT filings, SEBI approvals):
  - Initial Board Approval **MUST NOT** be marked as `Achieved` for final completion.
  - Initial Board Approval must be extracted with `status = "Pending"` (In Progress).
  - A commitment can **ONLY** be evaluated as `Achieved` when final regulatory clearance (e.g., final NCLT court order, SEBI in-principle approval, or exchange listing intimation) is officially published.

## 3. Dynamic Business Logic Rule
- **NEVER** add static hardcoded ticker branches (e.g., `else if (ticker === "ANANTRAJ")`) or static metric figures in backend worker code.
- All guidance reconciliations, commitment extractions, and credibility scores must be computed dynamically using generic LLM prompts and database schema relations.

## 4. Zero Automatic Git Commits or Pushes Rule
- **NEVER** execute `git commit` or `git push` automatically without getting explicit user confirmation and approval first.
- Always show the exact proposed commit message and changed files to the user, and wait for explicit permission before attempting to commit or push to GitHub.

## 5. Automated Execution & Confirmation Boundary
- **NEVER** execute ad-hoc inline terminal scripts (`node -e "..."`) which defeat IDE security whitelists and trigger repeated permission modals.
- Non-destructive commands (read-only queries, invariant test runners, linting, build verification) must run automatically without interrupting the user.
- The agent **MUST ONLY** ask for user confirmation before destructive or state-mutating actions:
  - Database `UPDATE` / `DELETE` / `DROP` queries
  - File deletions or destructive migrations
  - Git commits and pushes

## 6. Zero Prompt Template Leakage & Strict Document Grounding Rule
- **NEVER** include concrete company names (e.g. `TPL Plastech`), specific synthetic numbers (e.g. `₹800 Cr`, `201.12/sh`, `6,114 Cr`, `+70% 40,800 km/yr`), or literal filler text inside LLM JSON schema templates or system prompts.
- All LLM prompt schemas **MUST** use abstract type descriptors (e.g., `"Metric Name: Explicit figure with unit and YoY/QoQ comparison from this document..."`).
- System prompts **MUST** explicitly enforce that if an event type (e.g., QIP, M&A, Financial Results) is absent from the filing, the LLM must return empty arrays `[]` or `null`.
- All LLM extractions (financial metrics, corporate actions, catalysts) **MUST** be deterministically verified by a post-processing grounding guard (`sanitizeLlmOutput` in `institutional-guard.service.js`) against the raw filing text. Any number or claim ungrounded in the source document **MUST** be dropped before alerting or saving.

## 7. Strict Verified Live Valuation & Database Freshness Invariant
- **NEVER** cite, discuss, or evaluate a stock's valuation multiple (P/E, Market Cap, EV/EBITDA, Share Price) based on unverified assumptions, historical memory, or stale approximations.
- Before generating valuation hurdles, pricing boards, or investment recommendations for the user:
  1. The agent **MUST** verify that live trailing market data (`market_data_snapshots`) is synchronized and up-to-date in PostgreSQL for all evaluated equities.
  2. If data is stale or missing, the agent **MUST** execute the audited synchronization runner (`node backend/scripts/sync-portfolio-market-data.js --force`) to programmatically ingest verified consolidated trailing metrics (CMP, Trailing P/E = CMP / TTM EPS, Mcap, ROCE) before emitting analysis.
  3. All valuation analysis presented to the user **MUST** be explicitly grounded in the freshly verified database snapshot.

---

# PART 2 — THE ALERT PIPELINE ("HEART OF THESISIQ") — READ BEFORE TOUCHING IT

The product exists so that **every result, investor presentation and concall of a tracked stock produces ONE correct,
thesis-judged Telegram alert, quickly**. A silent miss is the worst possible bug. Most past failures were SILENT
(no crash, no alert). Assume that any code you change in this area can fail silently, and prove otherwise.

## 8. Mandatory checklist after ANY edit to the alert pipeline
Files in scope: `backend/scripts/scan-announcements*.js`, `backend/workers/quarterly-deepdive-worker.js`,
`backend/services/{announcement,telegram,nim,filing-classifier,financial-validator,financial-table-fallback,institutional-guard,thesis-gate-evaluator,thesis-driver-context}.service.js`.

Run, in this order, and paste the real output tail in your answer:
1. `npm run lint:backend`  → must print no errors. (Catches undefined variables — the bug that once killed every alert and passed all unit tests.)
2. `npm run test:heart`    → worker end-to-end test + heart invariants.
3. `npm test`              → whole suite.

Rules:
- A passing suite is **not** proof. The original `isCoreEarningsDoc` crash passed 105 tests because nothing exercised the worker. If you change behaviour, **add or extend a test first** (see `backend/tests/worker-pipeline.test.js`).
- **Never weaken, delete or skip an assertion to get green.** If a test fails, the code or your understanding is wrong; say so.
- Do not say "fixed" / "done" without showing the passing output. If you could not run something, say exactly that.

## 9. Facts about the running system (not visible in the code — do not forget)
- **Deployment:** Oracle PM2 runs `scan-announcements-action.js` with cron `*/5 8-23 * * *` (IST) and `--no-autorestart`. **The process is restarted every 5 minutes**, killing anything still running. GitHub Actions (`scan-announcements.yml`, every 30 min) is a failover on the **same Supabase DB**. Hence: (a) anything slow BEFORE the Telegram send can silently lose the alert; (b) two scanners can run at once → `acquireScanLease()` (table `system_settings`, key `scan_lease`) prevents double alerts. DB is the Supabase *transaction* pooler (port 6543): no session advisory locks.
- **Flow:** `scan()` fetches NSE+BSE → classifies (AI) → either alerts directly (orders, capex, credit events, …; and the "concall scheduled" heads-up) **or** queues `deep_dive_status` = `pending_stage1` (results / deck / press release), `pending_stage2` (transcript), `pending_audio` → `processPendingDeepDives()` → verdict + gates → Telegram.
- **BSE API** (`AnnSubCategoryGetData/w`): REQUIRES `strPrevDate`/`strToDate` (YYYYMMDD); use `strCat=-1`, `strType=C`, `pageno`. Rows have `NEWSID` and `ATTACHMENTNAME`; the PDF is `…/corpfiling/AttachLive/<ATTACHMENTNAME>` (**NEWSID is NOT the file name**). Error answers come back as HTTP 200 `{Status:false, Message}` — treat them as errors, never as "0 announcements".
- Node's `fetch` (undici) rejects BSE PDF response headers → `downloadBinary()` falls back to `https` with `insecureHTTPParser`.
- **All exchange timestamps are IST wall-clock with no zone.** Always use `parseExchangeTimestamp()`; never `new Date(rawString)`.
- NSE and BSE publish the SAME PDF under different ids/titles → de-duplicate by content (`findContentDuplicate`), not by title.
- LLM = NVIDIA NIM (`meta/llama-3.2-*`), calls can be slow/429. Keep per-call timeouts short (scanner 40 s, worker 90 s) and retries ≤ 3.

## 10. Hard invariants (each one is a real bug that happened). Never break them.

| # | Invariant | Symptom if broken | Guard |
|---|-----------|-------------------|-------|
| I1 | **Send the alert first, mark `completed` after.** Slow/optional work (syntheses, audits) comes after the send and is deadline-bounded. | Row is `completed` but no Telegram message (process restarted mid-work). | `worker-pipeline.test.js` "BEFORE marking completed" |
| I2 | A failed send is **parked** (`event_analysis.alert_pending=true` + `pending_alert_text`) and re-sent by `flushPendingAlerts()`. Never swallow a send error. | Telegram 429/outage = permanently lost alert. | "Telegram outage parks the alert" |
| I3 | `sendTelegramMessage` **throws** on any non-delivery (incl. not configured). `sendAnnouncementAlert` returns `false` only when its own gate *suppressed* it. Scanner: truthy ⇒ `sent`; thrown ⇒ `failed` (retried); suppressed ⇒ `ignored`. Never record a failure as `ignored` or `sent`. | Alerts counted as sent that were not, or dropped forever. | `heart-pipeline-invariants` Telegram tests |
| I4 | **Never fabricate a verdict.** If all LLM calls fail → `_llm_failed`, retry (max 3 attempts via `deep_dive_attempts`), then deliver verified numbers + gates with an "AI narrative unavailable" banner. No default `ADD`, no "Deep-dive completed; maintaining neutral hold signal". | Fake HOLD, silent skip. | "retries later instead of fabricating" |
| I5 | **Never analyse a material filing from its title alone.** Unreadable PDF text ⇒ retry, then `needs_review` + failure alert. | Verdict invented from a title. | "unreadable are retried" |
| I6 | **Numbers come from code, not the LLM.** Only `extractDeterministicFinancials` (block-based, units per block, header-date column mapping) — or the text-grounded fallback (`financial-table-fallback.service.js`), which is labelled UNVERIFIED and can never authorise a buy. The LLM never computes growth %. No unit re-scaling anywhere except the validator. | PAT −65%, margin −3,642 bps, phantom exceptional gains. | fixtures `shaktipump-…`, `lumaxtech-…` |
| I7 | **Gate order: numbers authorise, vetoes win.** A bearish analysis (TRIM/SELL/EXIT), a BROKEN HIGH-materiality thesis driver, or unverified (AI-located) figures can only *downgrade* a buy, and the gate must never override a bearish call into `ADD`. | "ADD 9/10" on a company flagged for governance risk. | "Thesis gates" tests |
| I8 | Transcripts / decks have no statements: gate = `NOT_APPLICABLE` or uses **carried-forward** verified results. Missing statements must NEVER render as "Thesis Deviation". | Red "deviation" badge on every concall alert. | "transcript … is not labelled a thesis deviation" |
| I9 | **De-duplication must not swallow distinct events.** Compare title+summary only (never the 4,000-char `raw_text`), ignore the company's own name, and treat different ₹ amounts as different events. Generic NSE titles ("Updates", "Press Release") need a per-filing discriminator in the hash. | Two real orders on one day → one alert. | `dedup-and-agm.test.js`, hash test |
| I10 | **Time budget.** Nothing before a Telegram send may take > ~90 s. Scanner stops starting work after 150 s; worker after 270 s; rotate stock order each cycle so no stock starves. | Daemon killed mid-run, alerts never sent. | read the constants in `scan-announcements.js` |
| I11 | All timestamps via `parseExchangeTimestamp`; staleness via `getFilingAgeHours`. Filings older than 72 h (non-earnings) are archived silently so re-enabling a feed never floods Telegram. | Alerts stamped 5.5 h off; backlog floods. | timestamp tests |
| I12 | BSE documents from `ATTACHMENTNAME`; BSE rows from the dated, paginated query. | BSE feed returns nothing / PDFs 404. | `buildBseDocumentUrl` test |
| I13 | Reporting quarter comes from the statement's period end (`quarterFromPeriodEnd`), falling back to filing date. The LLM prompt is told the period. | Wrong quarter labels ("2QFY26" in a Q2 FY27 note). | quarter test |
| I14 | Never persist `_raw_text` (≤60 KB) into `event_analysis` / snapshots. | DB bloat. | grep `_raw_text` before saving |
| I15 | The quarterly snapshot and `verified_financials` carry-forward are written ONLY from verified numbers of THIS filing — never from AI-located figures, transcripts or decks. | Snapshot overwritten with "N/A". | fallback worker test |
| I16 | Concall invitations are not transcripts ("transcript *will be* available…"), and NSE's standard subject "Analysts/Institutional Investor Meet/Con. Call Updates" is NOT a private fund meet. | Invitations analysed as transcripts; scheduled calls never alerted. | concall tests |

## 11. Debugging playbook — "I did not get an alert for X"
Work through these in order. Use **read-only** queries in a script FILE (see rule 5), never ad-hoc `node -e`.
1. Is the stock in `stocks` with `category IN ('Core','Watchlist')` and a correct `bse_scrip_code` / `nse_symbol`?
2. Did the feed return the filing? Run the scanner dry: `node --env-file=.env.local backend/scripts/scan-announcements.js --dry-run --ticker <TICKER>` (saves nothing, sends nothing). Read the `[NEW]`, `[SKIP …]`, `[SUPPRESSED]`, `[SKIP CONTENT-DUP]`, `[PDF DEFER]` lines.
3. Look at the row: `SELECT title,status,sent_to_telegram,deep_dive_status,filing_category,event_analysis->>'alert_pending',event_analysis->>'alert_sent_at',event_analysis->>'deep_dive_attempts',event_analysis->>'pipeline_error' FROM corporate_announcements WHERE ticker=… ORDER BY created_at DESC`.
   - `status='ignored'` + `deep_dive_status='completed'` is NORMAL for worker-handled filings; check `alert_sent_at` / `alert_pending`.
   - `alert_pending=true` → Telegram delivery failed; it is retried every run (check bot token / chat id).
   - `pending_stage1/2/audio` for hours → worker not finishing (LLM down? read `deep_dive_attempts`, `pipeline_error`).
   - `needs_review` → dead-lettered after 3 attempts (a failure alert should have been sent).
   - `failed` → scanner will retry next scan.
4. Wrong content? Re-run the parser on the real PDF (section 12) before blaming the LLM.
5. Never "fix" by editing rows (rule 1). Fix the code, add a test, let the pipeline recompute.

## 12. Working with real filings (do this for every parser / gate bug)
1. Put a script FILE in the scratchpad that calls `extractTextFromPdfUrl(url)` and then `extractDeterministicFinancials(text)`.
2. Open the extracted text and **read the statement by eye**; compute the expected revenue / PBT / PAT / YoY by hand.
3. Copy only the relevant lines (≈100) into `backend/tests/fixtures/<ticker>-<quarter>-results.txt` and assert the hand-computed values.
4. **Never assert numbers you did not verify against the PDF**, and never "fix" a test by copying the parser's output into it.
Known layout traps: heading printed AFTER its table; a standalone mini-table inside the consolidated notes; Lakhs vs Crores per statement; `(12.34)` = loss; yearly-only exceptional item; PDF digit glitches (`1,871.3 6`); seasonal quarters (Q4 > Q1×1.7 is NOT a half-year column); presentations whose slides look like tables.

## 13. Thesis rules (every stock must be judged against its thesis)
- Each stock needs: `stocks.investment_thesis` JSON `{primary_thesis, key_catalysts[], risk_factors[], conviction_drivers[]}` AND a driver contract (`reports/thesis_board/driver-level-thesis-contracts.json`, or `supplementary-thesis-contracts.json` for stocks missing there; entries with `provisional:true` need analyst review).
- The pipeline asks the model to mark each contract driver `CONFIRMED / ON_TRACK / AT_RISK / BROKEN / NO_EVIDENCE` with quoted evidence (`thesis-driver-context.service.js`). BROKEN/CONFIRMED without evidence is downgraded automatically — do not remove that.
- Fill missing thesis data with `node --env-file=.env.local backend/scripts/seed-stock-theses.js` (**dry-run by default**; `--apply` only when the user asks; it backs up first and never overwrites user-written text or non-empty lists).
- The scan logs `No usable thesis … for: <tickers>` when a stock has neither a rich thesis nor a contract — treat that line as a TODO to report to the user.
- Thesis logic is **data**, not code: no per-ticker `if` branches (rule 3). Hurdle numbers live in `SPECIFIC_THESIS_HURDLES` (existing) and contracts.

## 14. Rules for working carefully (you are a smaller model — these matter)
- **Read the whole function and its callers before editing.** Do not patch with blind regex/replace on code you have not read. After each edit run `node --check <file>` AND the checklist in section 8.
- **Write the failing test first** for every bug; then fix; then show both runs.
- Do not add `try { … } catch {}` / `.catch(() => {})` around anything on the alert path. Swallowing is only acceptable for non-critical bookkeeping, with a `console.warn`.
- Do not introduce a new variable without defining it; do not rename a variable in one place only (`npm run lint:backend` will tell you).
- Do not widen or narrow a regex without testing positive AND negative examples (the "investor meet" and "transcript will be available" bugs came from over-broad matching).
- Do not trust the model's numbers, the model's quarter label, or a title as evidence. Trust: parsed statement text, header dates, exchange fields.
- Keep changes small and focused; do not refactor unrelated code in the same change.
- Do not use `node -e "..."` (rule 5) and do not run Python/`sed` one-liners on source files when the Edit tool can do it; for multi-line patches write a script file, re-read the file afterwards and re-run the tests.
- Report faithfully: say what you ran, what passed, what you did NOT verify, and anything you changed outside the request. If a rule here conflicts with a user request, stop and ask.

## 15. Known open items (do not "discover" these again, and do not silently change them)
- The 4-stage financial model / reverse DCF audit is pending (user asked for it AFTER the alert pipeline).
- `MOREPENLAB` uses a provisional contract (repo-derived); needs analyst review.
- GitHub Actions needs the `GEMINI_API_KEY` secret (scanned-PDF OCR, audio).
- `reports/thesis_board/driver-level-thesis-contracts.json` "currentEvidence" is a Q1 FY27 baseline and is not updated automatically.
