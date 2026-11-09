# Parser and executor research for ThesisIQ — 8 November 2026

Research scope: public primary repositories, official documentation and papers; Reddit was used to discover failure modes and candidates. No candidate was installed or benchmarked by this research task, and no production writes, deployment or dependency changes were made. Recommendations below are engineering judgements, not measured accuracy improvements.

**Parent-task measurement update:** the implementation task subsequently benchmarked native readers on seven real filings and independently scored four reviewed statements. Those measured results and the resulting code changes are recorded in `robustness-review-2026-11-08.md`; the research task itself did not run those experiments.

## Decision

Keep the current deterministic financial validator as the authority for numbers. Add independent document readers behind it, with page/cell provenance, and benchmark them on the actual failed filings before choosing a default. The first comparison should be **pdfplumber/Camelot for healthy text tables versus Docling forced OCR for damaged/scanned pages**. PaddleOCR PP-Structure is the next local OCR alternative if Docling does not meet the accuracy/latency target.

For execution, the best future-migration candidate is **pg-boss with polling**, subject to a pinned-version test on the actual Supabase endpoint and runtime. Its semantics map well to the current PostgreSQL data store. An immediate library migration is less valuable than fixing per-filing ownership, resumable stages, quota-aware deferral and stale-owner fencing in the existing executor.

## What Reddit contributed

Two inspected discussions describe inconsistent table layouts, native text fragmentation, OCR digit errors, and cases where separating table geometry from character extraction worked better. They suggest useful experiments, but their tool rankings are anecdotal and are not accepted here as technical proof. [Inconsistent schemas discussion](https://www.reddit.com/r/dataengineering/comments/1uz4fw5/best_way_to_parse_inconsistent_pdf_table_schemas/), [PDF table extraction discussion](https://www.reddit.com/r/dataengineering/comments/19832la/pdf_table_extraction/).

In particular, older advice that Camelot cannot handle scans is incomplete for current upstream: the normal heuristic parsers require native text, while optional neural/OCR extras support image-only documents. See its own current [README](https://github.com/camelot-dev/camelot#readme). Do not select a package using an old Reddit comment without checking its current released API.

## Parser shortlist

| Candidate | Verified capability and constraints | Fit for ThesisIQ |
| --- | --- | --- |
| **pdfplumber** | Character/line/rectangle geometry, configurable tables and visual debugging; designed primarily for machine-generated PDFs. MIT. Python runtime. [README](https://github.com/jsvine/pdfplumber#readme), [licence](https://github.com/jsvine/pdfplumber/blob/stable/LICENSE.txt). | First lightweight independent reader for healthy native text and shifted columns. It does not independently reconstruct missing or wrong glyphs in a broken text layer. |
| **Camelot** | Current upstream has lattice, stream, network/hybrid and optional neural table parsing; optional OCR is required for image-only input. Default pdfium backend avoids additional system dependencies; table quality reports and explicit regions are available. MIT. [README](https://github.com/camelot-dev/camelot#readme), [licence](https://github.com/camelot-dev/camelot/blob/master/LICENSE). | Benchmark ruled financial tables first. Treat its parsing report as structural evidence, never a guarantee that a digit, sign, unit or quarter is correct. Pin a released version that actually contains the selected features. |
| **Docling** | Layout, table structure, local execution, lossless JSON and OCR; Python >=3.10 in current upstream. Code is MIT; model licences are separate. [README](https://github.com/docling-project/docling#readme). Official examples support CPU and accelerator selection, page ranges, and full-page OCR when the text/layout path is unreliable. [CPU/accelerator example](https://github.com/docling-project/docling/blob/main/docs/examples/run_with_accelerator.py), [forced OCR example](https://github.com/docling-project/docling/blob/main/docs/examples/full_page_ocr.py). | Strongest first experiment for SJS/POLICYBZR-style damaged embedded text and selected scanned pages. Run a bounded page subset in a separate process/service, preserve structured cells, and measure cold/warm latency and memory on Oracle hardware. CPU support alone does not establish a suitable latency budget. |
| **PaddleOCR** | The project offers OCR and PP-Structure document/table pipelines. Its documentation distinguishes coordinate-rich PP-Structure output from the VLM route, and lists CPU/GPU deployment options. Code is Apache-2.0. [README](https://github.com/PaddlePaddle/PaddleOCR#readme), [licence](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE). | Candidate local page OCR/table service that can reduce dependence on Gemini quota. Select a specific pipeline/model and benchmark it; aggregate benchmark claims in the project README do not establish financial-cell accuracy on NSE/BSE filings. |
| **gmft / Table Transformer** | gmft supports CPU execution, cropped table images and positional text; its normal path uses PDF text rather than adding OCR. MIT. It documents OCR issues, merged cells and false positives as failure modes. [gmft README](https://github.com/conjuncts/gmft#readme), [licence](https://github.com/conjuncts/gmft/blob/main/LICENSE). TATR needs text extraction or OCR separately to put text into cells. [TATR source](https://github.com/microsoft/table-transformer#readme). | Useful if locating tables or aligning native columns is the main failure. It is not by itself a cure for garbled glyphs or wrong OCR digits. Exporting table crops for a second recognizer is worth testing. |
| **Surya** | Current code is Apache-2.0, while weights use a modified OpenRAIL-M licence with stated commercial eligibility conditions. Current inference uses a VLM server through vLLM on NVIDIA or llama.cpp on CPU/Apple Silicon, and can keep the server warm. [README and licensing/runtime sections](https://github.com/datalab-to/surya#readme). | A separate trial, not a simple permissively licensed drop-in. Confirm the exact checkpoint licence, server lifecycle and measured resource use before adoption. Do not assume historical Surya installation instructions describe the current runtime. |

The conceptual distinction matters: table detection/structure assigns cells; native extraction or OCR supplies characters; ThesisIQ then assigns financial meaning and verifies arithmetic. A geometry score cannot certify numeric semantics. TATR explicitly separates structure recognition from text supply. [TATR](https://github.com/microsoft/table-transformer#readme).

For a damaged native layer, switching from one native reader to another may reproduce the same wrong characters. Docling's force-OCR mode gives an independent raster path. It is slower than its hybrid path according to the example's own comments, so use selected statement pages and a deadline. [Forced OCR source](https://github.com/docling-project/docling/blob/main/docs/examples/full_page_ocr.py).

## Evidence and benchmark to require before integration

The [Table Transformer project](https://github.com/microsoft/table-transformer#readme) publishes inference/evaluation code, GriTS structure metrics, and FinTabNet-related trained models. The [2026 financial QA study](https://arxiv.org/abs/2604.12047) evaluates parser/chunking choices on financial-domain question answering, including TableQuest. Those are useful reproducible public references; QA accuracy and table-structure similarity are different targets from exact revenue/PAT extraction. No public score inspected here proves superiority on ThesisIQ's filings.

Create a small checked-in manifest of real PDFs with independently reviewed statement page numbers, scope, dates, declared units, printed cell strings and expected normalized values. Include SJS, POLICYBZR, SKIPPER, INOXINDIA, TIMETECHNO, consolidated/standalone pairs, notes mini-tables, negatives, missing decimal points and multi-period headers. Obtain expected values from the rendered filings, not from any candidate's output.

Measure each candidate on:

1. Exact printed cell strings and correct row/column alignment, including signs and decimal separators.
2. Correct company, consolidated/standalone scope, quarter-end and cumulative-versus-quarter column.
3. Correct printed unit and one deterministic normalization; retain unscaled source strings.
4. Financial identities: revenue + other income = total income; income minus expenses = PBT; PBT minus tax = PAT where the statement's structure permits; owner plus non-controlling PAT = group PAT.
5. False acceptance: a readable but incorrect figure must fail the corpus check. Report abstention separately from wrong output.
6. Cold and warm wall time, peak memory, CPU cost, pages read, external calls, timeout/restart behaviour and reproducibility with pinned package/model versions.

Promote an alternate reader only for classes where it demonstrably improves the corpus. When independent readers disagree on a material cell, retain both sources, mark that result unverified and defer/escalate; never average the figures. LLMs may locate a printed table, but arithmetic and verified status remain deterministic.

## Executor shortlist

| Candidate | Verified facts | ThesisIQ decision |
| --- | --- | --- |
| **pg-boss** | Current upstream requires Node >=22.12 and PostgreSQL >=13. Uses SKIP LOCKED, deferral, priorities, dead letters, exponential retries and dependency workflows; MIT. [README](https://github.com/timgit/pg-boss#readme). `useListenNotify` defaults false. Its optional listener requires a session-pinned connection and is incompatible with transaction/statement pooling. [Constructor options](https://github.com/timgit/pg-boss/blob/master/docs/api/constructor.md). | Best first migration spike using polling, a pinned compatible release and an isolated database. Verify maintenance/migration behaviour, lease expiry, retry accounting and readiness after restart before production use. |
| **Graphile Worker** | MIT; current requirements are Node >=22.18 and PostgreSQL >=12. [Repository](https://github.com/graphile/worker#readme), [requirements](https://worker.graphile.org/docs/requirements). Has per-job retries and graceful shutdown. Its documented abrupt-exit recovery can leave jobs locked for at least four hours; current source exposes prepared-statement disabling and reset-related options. [Error handling](https://worker.graphile.org/docs/error-handling), [source options](https://github.com/graphile/worker/blob/main/src/interfaces.ts). | Default lifecycle is a poor match for a daemon that is killed/restarted every five minutes. A dedicated long-running process and a tested session/pool configuration would be prerequisites. Do not adopt by only replacing an import. |
| **BullMQ** | MIT, with default Redis operation and global/manual rate limiting; its manual rate-limit exception returns work to wait rather than ordinary failure. [Connections](https://docs.bullmq.io/guide/connections), [rate limiting](https://docs.bullmq.io/guide/rate-limiting). Current official docs also describe an optional PostgreSQL backend requiring PG >=13; it uses a dedicated LISTEN connection, and docs call Redis the more battle-tested backend. [PostgreSQL backend](https://docs.bullmq.io/guide/postgresql). | Redis adds infrastructure; the PG backend is not a transaction-pooler drop-in because its listener requires a persistent session. Inspect and pin an actually available release. Benchmark its lifecycle and backend semantics before choosing it over pg-boss. |

Supabase transaction mode returns a database connection after each transaction and does not preserve session state such as LISTEN or session advisory locks. Session mode/direct connections support those features. The shared transaction endpoint also has prepared-statement restrictions. Thus an executor's support for PostgreSQL in general is not sufficient proof of support for this endpoint. [Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Mechanisms worth adding without a library migration

These are recommendations inferred from ThesisIQ's failures and the queue designs above:

- Atomically claim each filing/stage with an expiring owner token; use owner-token checks on release and write/complete paths so a timed-out old worker cannot overwrite its replacement. Do not use an open SQL transaction for the entire remote LLM call.
- Separate download, native parse, OCR, financial validation, judgement and delivery into resumable stages. Cache successful extraction by document-content hash plus parser/version/options; require the current caller's acceptance checks before reuse. Keep company ownership checks at the filing boundary.
- Apply provider/project quota deferral to all callers; do not make rate-limit pressure consume document-failure attempts. Jitter recovery so multiple processes do not resume as a burst.
- Use a durable alert/outbox identity and record Telegram delivery results. Queue atomicity does not make an external Telegram request exactly-once: a crash after send but before acknowledgement is an ambiguous delivery that must be handled explicitly.
- Split the five-minute scanner lifecycle from a persistent worker if heavier local document models are selected. Allow graceful drain and bounded cancellation; cold-starting a model for each cron tick undermines the throughput benefit.
- Persist provenance and verification version with each accepted result. Older unverified/incorrect snapshots must be recomputed through the corrected pipeline; installing a parser does not repair them retroactively.

No wholesale parser or executor replacement is justified until the corpus and restart/concurrency tests pass. The immediate engineering target is lower false acceptance and safe recovery, not more documents marked completed.

## Follow-up: Tesseract.js as bounded local page OCR

The main task's seven-PDF experiment found that the installed pdfplumber/PyMuPDF readers did not recover SJS's damaged layer, and that an alternate MOREPEN text parse selected different figures. These are results reported by the main task, not measurements performed in this research task. They support withholding a native-reader replacement pending exact source-cell review.

**Tesseract.js is a practical next local OCR trial.** Current upstream is 7.0.0 and requires Node >=16. It wraps the WASM Tesseract engine in Node worker threads, so it does not require an installed Tesseract executable. It reads images, not PDFs: use ThesisIQ's existing renderer on selected statement pages. Reuse a worker for several images and terminate it once finished. [Official README](https://github.com/naptha/tesseract.js#readme), [package metadata](https://github.com/naptha/tesseract.js/blob/master/package.json), [Node worker source](https://github.com/naptha/tesseract.js/blob/master/src/worker-script/node/index.js).

For a prototype against a pinned API:

```js
const worker = await createWorker('eng', 1, {
  langPath: localLanguageDirectory,
  gzip: false,
  cachePath: persistentCacheDirectory,
  cacheMethod: 'readOnly'
});
try {
  await worker.setParameters({ preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(pagePngBuffer, {}, {
    text: true, blocks: true, tsv: true
  });
  // Apply table/financial validation before trusting any value in data.
} finally {
  await worker.terminate();
}
```

`langPath` must contain the provisioned `eng.traineddata` when `gzip:false`. Cache read-only mode does not by itself make operation offline: source code falls back to language loading on a cache miss. Defaults can download language assets from a CDN. Configure a local language path, install assets ahead of runtime, retain their checksum/version, and fail visibly if missing. In Node the worker path defaults to the installed package; avoid copying older browser CDN configuration snippets into the server. [API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [language/cache source](https://github.com/naptha/tesseract.js/blob/master/src/worker-script/index.js), [Node defaults](https://github.com/naptha/tesseract.js/blob/master/src/worker/node/defaultOptions.js).

The library licence is Apache-2.0. The official `tessdata_fast` repository is also Apache-2.0; confirm the licence and provenance of the exact chosen traineddata package instead of assuming all downloadable OCR models share that licence. [Tesseract.js licence](https://github.com/naptha/tesseract.js/blob/master/LICENSE.md), [tessdata_fast licence](https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE).

Implementation considerations inferred for ThesisIQ:

- Render sufficiently high-resolution statement pages; compare full-table and cropped recognition while retaining page/cell locations. Tesseract's API specifically notes resolution affects recognition, and offers rectangle cropping and optional geometry outputs. Plain text is the default output, so request blocks/TSV explicitly. [API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).
- Use one owned worker or a tightly bounded pool. The documented recognition API does not provide an AbortSignal option; terminate the owned worker when the job deadline expires. A bare timeout race leaves OCR consuming CPU after the caller has stopped waiting.
- Compare page-segmentation modes on the corpus; do not enforce a global digits-only whitelist, which would remove row names, units and dates needed by the financial validator.
- Treat OCR confidence as a recognition score, not a calibrated probability that the revenue/PAT is correct. Re-run printed-unit, quarter/scope and arithmetic checks, and preserve disagreements with native extraction.
- Measure cold asset load, warm recognition time and peak memory on the actual Oracle host. No runtime/accuracy improvement is claimed before that test.
