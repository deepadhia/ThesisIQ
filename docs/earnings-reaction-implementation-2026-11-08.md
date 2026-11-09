# Earnings reaction and accuracy hardening — 8 November 2026

**Subsequent live update (9 November IST):** See `docs/handoff-2026-11-09-live-repair.md`. The nullable-facts migration was applied with backup, all 20 tracked market snapshots synchronized, and 18 latest results rebuilt. The paragraph below records the earlier pre-migration stage.

Implemented locally, with existing uncommitted fixes preserved. No commit, push, deployment, filing replay, Telegram send or schema migration was executed. The audited valuation synchronization was attempted; its first insert failed because the live schema forbids unknown optional facts. A subsequent preflight reported the same blocker before any insert.

## Observed price behaviour

| Stock | Result publication basis | First reaction close vs previous close | Since pre-results close through Nov 8 | Nov 8 session |
|---|---|---:|---:|---:|
| TIMETECHNO | Stored own NSE results publication Nov 5 after close | -1.98% (Nov 6) | +2.14% | +4.20% |
| HBLENGINE | Own verified BSE results Nov 7; issuer PDF also dated Nov 7 | -4.52% (Nov 8) | -4.52% | -4.52% |
| HSCL | Oct 16 results; issuer integrated filing confirms after-close meeting | -8.30% (Oct 19) | -12.75% | +1.46% |
| SKIPPER | Stored NSE verified statement Oct 30 at 14:10 IST, generic General Updates title | -3.43% (Oct 30, mixed pre/post-news daily bar) | +1.57% | +0.04% |

These are descriptive observations, not explanations of causation or allocation recommendations. HSCL's later recovery does not erase the earlier post-results decline. TIMETECHNO's initial decline and subsequent recovery must be shown separately. SKIPPER's intraday release prevents a daily close-to-close move being labelled a pure post-announcement return. Consensus expectations are unknown.

The first-session and cumulative figures above independently match the raw closes in the NSE UDiFF daily files for Oct 16/19/29/30 and Nov 5/6/8. The runtime additionally calculates benchmark-relative D1/D3/D5 on Yahoo provider-adjusted closes. For these four reported endpoints the raw NSE returns agree with the adjusted-history calculations to two decimals. This cross-check does not certify all other securities or all intermediate D3/D5 bars.

Primary closing-data source pattern: `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip`.

- [Nov 8 official closing file](https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261108_F_0000.csv.zip)
- [Nov 6 official closing file](https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261106_F_0000.csv.zip)
- [Nov 5 official closing file](https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261105_F_0000.csv.zip)
- [Oct 19 official closing file](https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261019_F_0000.csv.zip)
- [Oct 16 official closing file](https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261016_F_0000.csv.zip)
- [Oct 30 official closing file](https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261030_F_0000.csv.zip)
- [Oct 29 official closing file](https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261029_F_0000.csv.zip)

Nov 8 is a real Sunday Muhurat trading session, confirmed by [NSE CMTR76941](https://nsearchives.nseindia.com/content/circulars/CMTR76941.pdf). The calendar override is exchange data with its source, not issuer logic. The conservative completion cutoff includes post-close at 16:00 IST. During the special session, the calculation leaves its daily observation pending. Short-session volume is not compared with a full-day volume baseline.

Exact event times retain the stored exchange-timestamp qualification. Legacy HSCL stored timestamps appear shifted relative to the issuer/exchange document times; both candidate times are after close, so the daily event window is unchanged. No historical timestamp rows were patched.

## Generic architecture and integration

- `earnings-reaction.service.js` separates a pure calculator from the history provider. Explicit zoned publication times, observed session dates, completed bars and adjusted closes are required. Invalid, duplicate, stale or incomplete history fails closed. The benchmark must match exact baseline and endpoint dates; absent benchmark returns remain null. A missing security session relative to available benchmark history blocks the count.
- Outputs include first/third/fifth completed reaction-session returns, latest cumulative and latest-session returns, Nifty 500 excess returns in percentage points, opening gap, open-to-close response, pre-results 5/20-session run-up, worst close versus baseline, and comparable relative volume where data permit. D3/D5 stay pending until enough sessions complete. These are provider-adjusted returns, not a claim that all adjustment events are independently audited.
- The history client uses a four-second whole-request deadline, at most two active requests, a bounded 128-entry ten-minute cache, in-flight coalescing, and provider-wide in-process cooldown on HTTP 429. It does not retry or launch a portfolio-sized burst. There is no new queue/database dependency. Across processes the market-history cache/cooldown are independent; the existing OCR quota coordination remains database-backed.
- Results alerts add this measured context only for this filing's verified statement; LLM-supplied market-reaction fields are discarded. The calculation does not enter or promote the fundamental gate. Data failure remains visible as unavailable and does not suppress delivery.
- The nightly thesis-board generator refreshes the reaction report, allowing D3/D5 to mature without reprocessing filings. The dedicated `report-earnings-reaction.js` CLI is DB-read-only and sends no messages. It supports `--tickers=` and `--output=`. It selects statement-bearing own-company results, including generic exchange titles, and anchors duplicate statements to the first disclosure of the latest identifiable reporting quarter. Date-only fallback grouping is qualified rather than inventing a period.
- The existing 19 issuer hurdle contracts moved unchanged to `backend/config/thesis-hurdles.json`. Generic evaluation now enforces the previously ignored revenue-growth threshold and checks every configured structural target rather than treating non-VAP targets as confirmed without evidence. Those targets are analyst thesis data; moving them does not independently re-underwrite them.

## Accuracy corrections beyond the price feature

- Removed assumed 12% profit margins, 18% EBITDA margins, assumed EBIT conversion, default P/E 25 and zero-debt/EV assumptions from the market importer. P/E-derived PAT/EPS are no longer persisted as verified statement facts. Source closing date replaces retrieval date as the quote date; an unrecognised date blocks sync. Consolidated/standalone source labels follow the fetched page, and rounded website quotes no longer overwrite daily price history.
- Screener HTTP 429 also triggers an in-process provider cooldown. Alternate pages and later stocks do not repeat requests during that pause; individual sync failures remain blocked rather than aborting or claiming successful portfolio synchronization.
- Snapshot ingestion/retrieval computes freshness from the date instead of trusting FRESH labels, rejects future/nonfinite values, preserves unknown debt/EV as null and updates source lineage and optional financial fields on conflicts. An ingestion failure cannot be reported as successful.
- Long-form synthesis now requires the latest snapshot's verified statement and source-filing provenance. It no longer supplies static company Q1 figures under a newer quarter. Removed ticker-specific percentage rejection messages, unconditional rejection of a particular percentage, a fabricated margin-contraction magnitude, and a hardcoded capacity-utilisation check. Current source facts are included even when a template lacks the metrics placeholder. Limited narrative checks are labelled as limited, rather than a guarantee that the complete report is verified.

## Production blocker and rollout

`supabase/migrations/20261108010000_allow_unknown_market_facts.sql` is prepared, not applied. It relaxes NOT NULL on unsupported optional financial fields and removes debt/dilution defaults. It leaves required quote/provenance fields, rows and financial history intact. Lock and statement deadlines bound its execution. Live schema preflight currently blocks the importer before any quote fetch or insert.

After approval, apply this migration through the normal migration process, deploy the reviewed changes, rerun the audited market synchronization, verify its rows/source dates, then perform the existing smoke check. These steps must complete before valuation-based allocation advice. Do not silently reuse old synthetic financial fields in historical snapshots.

The previous backed-up parser/foreign-filing repair plan remains separate and unapplied. In particular, the known SJS unit-corrupted stored snapshot still requires the approved audited rebuild; this feature does not repair existing financial rows. Existing written synthesis reports were not retroactively rebuilt or relabelled. Previous parser/executor research and fixture results remain in the associated November 8 notes.

## Verification

Regression tests were first observed failing for fabricated importer facts, future-date acceptance, missing data/schema preflight, event-window boundaries, generic exchange titles, quarter duplicate anchoring, stale session coverage, current synthesis grounding, literal-percentage false positives and ignored configured hurdles. No prior assertion was removed or weakened. The final lint, heart and full-suite results are recorded in the completion note and exported logs.

Final verification: backend lint completed without errors; heart suite 21 files / 522 tests passed; full suite 67 files / 1,059 tests passed. The read-only report completed for all four requested examples and a separate portfolio run completed for 18 tracked equities with eligible verified result events. The live audited valuation sync returned `SCHEMA_MIGRATION_REQUIRED`, with zero validated snapshots. No schema migration, deployment or stored-financial repair has been applied.
