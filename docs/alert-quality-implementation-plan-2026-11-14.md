# Alert quality implementation plan — 14 November 2026

## Goal and current state

Every tracked company's material results, presentation, concall, or news filing should produce a timely, source-linked update that says what changed, why it matters to the thesis, and what remains unverified. A generic company profile, unsupported number, cover-letter summary, or model-declared omission must not become a confident action alert. A failed read must remain visible for retry and review rather than disappearing.

The linked-cover, coverage-status, display-filter, stale-XBRL guard, and false-forensic-path fixes in the [handoff](handoff-2026-11-13-output-audit.md) are **local and tested, not deployed**. The last ordered local gates passed: lint, 569/569 heart tests, 1,158/1,158 full tests. Saved rows and Telegram messages have not been corrected. Passing tests do not prove live filing accuracy.

## Delivery contract

| Outcome | Telegram behavior | Persisted evidence |
| --- | --- | --- |
| Verified material change | One concise update with event/time, the new fact or guidance change, basis and period for each number, thesis effect, main uncertainty, and the PDF actually read. | Filing identity, source URL/hash, page or turn, exact quote, extraction version, coverage, verification and alert IDs. |
| Source or claim incomplete | A short provisional/failure notice only when the filing is material; no unsupported number, buy/exit action, or allegation of an omission. Retry remains queued. | Failure stage, reason, attempt count, provider, `Retry-After`, source coverage, next eligible retry, and dead-letter state. |
| Routine or repeated filing | Fold into a daily board or link-only record with the reason it was not pushed. A later material change must still break through. | Fold reason and source relationship to prior filings. |
| Audio versus written mismatch | No forensic accusation until *both* complete raw sources and the particular claim are verified. | Audio timestamp/quote, written page or turn search evidence, numeric/semantic normalization, reviewer or deterministic verifier outcome. |

The quality gate must be generic across companies. It must fail closed on action authority while retaining a material filing in the retry/review queue. It must not equate a share-price move with proof of its cause.

## Ordered implementation

1. **Retrieval and identity.** Capture the exact NSE/BSE symbol, publication time, attachment, revision and hash. Follow public linked transcript or presentation PDFs from exchange covers; store both cover and extracted URLs and reject a second cover, unrelated company, unreadable PDF, or circular link. Test generic titles and both queue stages. Compare feed completeness against the existing direct scanner and benchmark NSE/BSE libraries before changing providers.
2. **Complete document coverage.** Make long calls and decks resumable by page or speaker turn. Persist processed ranges and extraction outputs so the 5-minute worker restart does not lose work. Verify every page/turn is represented, including final Q&A and slide notes. Keep `INCOMPLETE` until all ranges have passed; route OCR 429 with provider-wide rate limiting, `Retry-After`, jitter, and staged requeues. Trial Docling against native extraction and Gemini OCR on the SBCL scanned deck plus ordinary companies; adopt only if it improves table/figure accuracy and latency under the deployment budget.
3. **Fact and guidance ledger.** Save each candidate claim with source quote, page/turn, document URL/hash, metric, value/unit, fiscal period, standalone/consolidated scope, historical versus forward versus conditional status, and confidence reason. Deduplicate near-identical filings without merging conflicting scope or revisions. Check explicit future targets, cuts, milestones, conditions, and contrary management explanations. Source text that contains OCR/ASR corruption must not by itself authorize a numerical thesis action.
4. **Official results.** Obtain the matching official 2026 NSE taxonomy; run Arelle in an isolated process on the 62-file corpus and current Q2 filings. Preserve XBRL concept, context, dimension, unit, decimals, filing identity and revision in an additive raw-fact ledger. Reconcile same-quarter/same-basis figures against the official statement PDF. Hold conflicts and stale comparison-feed values for review. No flat third-party parser output is authoritative merely because it parses XML.
5. **Alert decision and format.** Use verified results for numerical action authority; use grounded presentations and calls for guidance changes, risks and thesis-driver evidence. Rank genuinely new, material statements before static profile. Show one result figure once, label audio provisional, and prefer written transcript when available. Every pushed alert needs a linked source and a clear reason for its action or abstention. Keep concise failure notices separate from investment signals.
6. **Historical repair and rollout.** Build a dry-run exact-ID replay report that compares old and new facts, message text, source URL, guidance and action; back up affected rows. Prioritize the Time Technoplast false forensic alert, SBCL missed guidance and scanned deck, Astra scope and audio claims, and the premature TRANSRAILL commitment. Follow `.agents/AGENTS.md`: no ad-hoc DB patch; apply only via reviewed, idempotent code with its required authorization. Deploy the tested change, verify the Oracle scanner/worker and one live filing per source type, then review the health dashboard for missed, partial, duplicated or ungrounded alerts.

## Acceptance gates

- The multi-company fixture set includes industrial, financial, and loss-making issuers; current/previous/YTD quarters; standalone/consolidated; revised filings; scanned deck; linked cover; long Q&A; contradictory and conditional guidance. Expected figures and quotes are hand checked against the official files, never copied from parser output.
- Every alert-path change starts with a failing worker regression and then passes `npm run lint:backend`, `npm run test:heart`, `npm test`, syntax and diff checks. A dry-run preview compares actual saved filings before and after the change and explicitly records material facts retained, false claims removed, missed facts, message length and processing time.
- A live smoke check proves a result, a linked deck, and a linked concall are delivered or visibly deferred within the scanner/worker timing budget. A simulated 429, bad PDF, Telegram outage, worker restart, and duplicate scanner must leave a retryable or reviewable state with no false confident alert.
- Historical corrected messages require a separately reviewed source-backed draft; no automatic resend of an old Telegram alert. The user must be told what old false alerts remain visible.

## External reuse decision

The handoff records [Arelle](https://github.com/Arelle/Arelle) for validated XBRL, [nse-xbrl](https://github.com/ShantanuAnant/nse-xbrl) for Indian concept comparison, [Docling](https://github.com/docling-project/docling) for a page-aware PDF trial, and the cited concall projects for sentence/claim evidence ideas. None has passed the project's real multi-company accuracy and deployment gates yet; no replacement is live.

The [repository benchmark plan](parser-repository-benchmark-plan-2026-11-14.md) names every first-wave clone, the hand-checked corpus, measurable acceptance gates, artifacts and rollout sequence.
