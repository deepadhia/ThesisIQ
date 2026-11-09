# ThesisIQ robustness and parser evaluation — 8 November 2026

The second implementation pass retains the earlier uncommitted fixes. Code is tested locally; no commit, push, deployment, production repair, or Telegram send was performed.

## Implemented and reproduced

**Per-filing execution admission.** Two overlapping `processPendingDeepDives()` calls previously sent two alerts for the same selected filing. The new atomic row claim checks the selected row's status and analysis version, retry time, foreign flag and existing lease. It uses database time and an owner token, works with the transaction pooler, and expires after ten minutes if a process is killed. Claim-store failure defers work without consuming document attempts. Ownership is checked again after slow PDF/OCR calls, before persistence and around the final delivery/completion path. An expired/replaced worker stops, and its late release cannot clear another owner's claim. The self-audit reports eligible jobs still waiting 30 minutes after lease expiry.

This prevents the reproduced overlapping-run failure; it does not establish exactly-once delivery to an external Telegram service across a crash after send but before acknowledgement. Existing parked-alert retry remains in place.

**Persistent OCR cache.** Successful transcriptions are keyed by exact input bytes/page order, prompt and cache schema version. Atomic file writes, a text checksum and a 30-day validity limit protect against partial/corrupted entries. Current caller acceptance checks run again before reuse. Failed, rejected and empty outputs are not cached. This reduces repeated quota use on unchanged pages. The default directory is `scratch/ocr-cache`; `PDF_OCR_CACHE_DIR` changes it and `PDF_OCR_CACHE=off` disables it. Cache failure does not block extraction.

**PDF resource cleanup.** Both native-text parsers and statement screenshot parsers are destroyed on success, parse failure and OCR deferral. Page-image bytes are copied before the screenshot parser is destroyed. Tests reproduced the missing cleanup before the fix.

**Financial false-acceptance guards.** The local OCR experiment exposed a real failure: when "Revenue" was misread as "Revere", the validator promoted total income to revenue and produced an incorrect figure. That fallback is removed. The income identity tolerance is tightened from 1.5% to the larger of 0.01% or 0.03 in the statement's printed units; a smaller digit error that previously passed is now rejected. A real rejected SJS OCR transcription is retained as a regression fixture.

**Statement scope.** The existing MOREPEN filing uses "Statement of Unaudited Financial Results - Consolidated". This heading was read as UNKNOWN. Dash/colon scope headings are now recognised; an auditor sentence mentioning a scope remains excluded. The existing real-document test now requires the correct consolidated scope.

## GitHub/Reddit research and actual experiments

The accompanying research note cites primary source documentation for pdfplumber, Camelot, Docling, PaddleOCR, gmft, Tesseract.js, pg-boss, Graphile Worker and BullMQ. Reddit was used for discovery, not as an accuracy oracle.

Seven PDFs were downloaded and tested with installed **pdfplumber 0.11.4** and **PyMuPDF 1.25.5**: INOXINDIA, JYOTICNC, MOREPENLAB, POLICYBZR, SJS, SKIPPER and TIMETECHNO. The native `pdf-parse 2.4.5` options/table API were also tried on the difficult subset. A local **Tesseract.js 7.0.0** English-fast page-OCR trial was installed only in the temporary benchmark workspace. It is not a production dependency.

Four cases have reviewed expected cells, unit, reporting date and scope in `backend/tests/fixtures/parser-benchmark-manifest.json`. SJS, MOREPEN and SKIPPER were checked visually against rendered exchange statements; JYOTICNC uses the previously hand-reviewed regression fixture and the same BSE PDF. These are a small release gate, not a general accuracy estimate.

The offline production-path benchmark gave:

| Reader feeding the current validator | Pass | Wrong result | Abstain |
| --- | ---: | ---: | ---: |
| pdf-parse 2.4.5 native text | 2 | 0 | 2 |
| pdfplumber 0.11.4 native text | 2 | 1 | 1 |
| PyMuPDF 1.25.5 native text | 3 | 0 | 1 |

The pdfplumber failure was a different MOREPEN revenue/PAT combination. SJS remained unreadable by all three native paths. A local Tesseract.js trial on rendered SJS consolidated page 6 took **8.03 seconds** on this Windows machine and yielded incorrect/missing cells despite a page confidence of 71. Before the new guard, its text could become a false financial result; afterward the real sample is rejected. Thus recognition confidence is not treated as verification.

No replacement parser or OCR engine was promoted to the production path. PyMuPDF's AGPL/commercial licensing also needs consideration before a production integration. Docling forced-page OCR and Camelot's selected-region/neural paths remain experiments to run on the checked corpus; no accuracy/latency claim is made for untested candidates.

For a later queue migration, **pg-boss polling** is the leading research candidate, not an adopted dependency. Its release/runtime requirements, schema lifecycle and restart semantics need an isolated integration test. The report documents why default Graphile abrupt-exit recovery and session-based LISTEN paths are poor fits for the current five-minute scanner/transaction-pooler setup.

## Reproducible candidate gate

```powershell
node backend/scripts/benchmark-parser-candidate.js --dir <reader-output-directory> --reader <name> --out <report.json>
```

Inputs are `<case-id>-<name>.json` arrays of `{num,text}`. The command uses the production text cap and financial validator, then checks independently reviewed revenue, PAT, unit, date and consolidated/standalone scope. Wrong cells fail the command; missing/unverified/abstaining cases return an incomplete result instead of claiming full coverage. It performs no network or DB work.

Source PDF SHA-256 values used in this run:

```text
SJS       E02A3CC89AAFD7535DD9EC5A7BEDB5751DA41D653527EF49C79A5C74B3361AFA
MOREPEN   593BF8FB87952A13419622F002C15E346C2547181EA8096E49FD28BB3A518B63
SKIPPER   9A28E93D530FC18577B0F3098DC02C75FD0E48A021E50F80DE8F3AB650CE4900
JYOTICNC  8D0FC3D32FA09701670E81C3482579355B60C02B8624870CD6F332359D7CA7E2
```

The local English model came from the official `tesseract-ocr/tessdata_fast` repository; its downloaded `eng.traineddata` SHA-256 was `7D4322BD2A7749724879683FC3912CB542F19906C83BCC1A52132556427170B2`.

## Verification

Red tests reproduced duplicate alerting, stale-worker continuation, repeated OCR calls, smaller financial digit errors, total-income substitution, the missing consolidated scope and missing parser destruction. Those regressions now pass.

Final mandatory checks, in order:

```text
> eslint -c eslint.backend.config.js backend scripts
```

No lint errors.

```text
Test Files  18 passed (18)
     Tests  488 passed (488)
```

```text
Test Files  64 passed (64)
     Tests  1025 passed (1025)
```

Changed production JS passed `node --check`, and `git diff --check` passed. The actual claim/ownership/release SQL was compiled with EXPLAIN inside `BEGIN READ ONLY` against PostgreSQL; no lease mutation was executed there. Concurrency and lease-loss behaviour were tested with emulated DB state, not by writing production jobs.

## Remaining live-data step

A final read-only check at **18:21 IST, 8 November 2026** still found SJS Q2 FY27 revenue `2827.28`, owners' PAT `580.3` and unit `CRORES`, without source provenance. The actual consolidated statement is in millions. The earlier eight-filing backed-up repair plan remains prepared; it was not applied by this work. Deployment and the live rebuild remain separate from these local code fixes.
