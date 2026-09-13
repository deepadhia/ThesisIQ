# 🧠 ThesisIQ — Fundamental Research & Decision Intelligence Platform

A production-oriented research and decision platform for long-term equity analysis.

ThesisIQ combines **quarterly thesis governance**, **dual-lens valuation analysis**, **multi-source financial data reconciliation**, and an **asymmetric valuation watchdog** to determine whether an investment thesis is strengthening, intact, under pressure, or breaking — while continuously evaluating whether the market's expectations remain consistent with the underlying business runway.

> **Core principle:** Separate *business quality*, *evidence*, *valuation expectations*, and *capital allocation* instead of collapsing them into a single stock score.

---

## What This System Does

### Core Operating Question

> **If I were deciding whether to own this company today, is the original reason I bought it MORE credible, EQUALLY credible, or LESS credible than 3 months ago?**
>
> **And does the current valuation leave sufficient room for execution error?**

ThesisIQ evaluates these questions through two independent analytical lenses.

### The Two Independent Lenses

| Lens                                  | Purpose                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| **1. Business Thesis State**          | Is the fundamental reason for owning the company still valid?        |
| **2. Valuation Expectation Analysis** | How much future growth is already embedded in the current valuation? |

The two lenses remain independent until the **capital-allocation decision surface**, preventing valuation from overriding a deteriorating thesis or business quality from automatically justifying an expensive entry.

---

# System Architecture

```text
                         DATA SOURCES
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   XBRL / Filings       Corporate Events      Market Prices
        │                     │                     │
   Concall Data         Management Guidance    Price History
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                 ┌─────────────────────────┐
                 │   INGESTION & NORMALIZE │
                 │                         │
                 │ • Deduplication         │
                 │ • Validation             │
                 │ • Point-in-time storage  │
                 └────────────┬────────────┘
                              ▼
                    PostgreSQL / Supabase
                              │
                              ▼
                 ┌─────────────────────────┐
                 │     DECISION ENGINE     │
                 ├─────────────────────────┤
                 │ 1. Quantitative Ranking │
                 │ 2. KPI / Price Engine   │
                 │ 3. Thesis State Engine  │
                 │ 4. Valuation Engine     │
                 └────────────┬────────────┘
                              ▼
                 ┌─────────────────────────┐
                 │ CAPITAL ALLOCATION      │
                 │ DECISION SURFACE        │
                 └────────────┬────────────┘
                              ▼
                 ┌─────────────────────────┐
                 │ VALUATION WATCHDOG      │
                 │                         │
                 │ • Risk gates             │
                 │ • Stress testing         │
                 │ • State transitions      │
                 │ • Alert qualification    │
                 └────────────┬────────────┘
                              ▼
                    Notification / Telegram
```

---

# Decision Engine

## Layer 1 — Quantitative Ranking

Pure mathematical ranking across the portfolio universe.

* Deterministic calculations
* No runtime mutation of ranking inputs
* Explicit valuation and growth assumptions
* Reproducible outputs

## Layer 2 — Market & KPI Integrity

Maintains consistent market and trailing financial metrics.

* Corporate-action-adjusted prices
* Rolling 52-week high/low
* TTM earnings
* P/E denominator consistency
* Margin and unit-economics tracking
* Point-in-time market snapshots
* Mathematical valuation invariants

## Layer 3 — Thesis Governance

Each company has explicit falsifiable business drivers.

```text
STRENGTHENING
      ↓
INTACT
      ↓
WATCH
      ↓
AT_RISK
      ↓
BROKEN
```

`INSUFFICIENT_EVIDENCE` is used when the available evidence is inadequate to make a reliable state determination.

Drivers are evaluated against evidence extracted from filings, announcements, presentations, and management commentary.

## Layer 4 — Decision Surface

The system combines:

```text
Business Thesis State
        +
Valuation Expectation Gap
        +
Quality / Cash Controls
        ↓
Capital Allocation Tier
```

---

# Dual-Lens Valuation Architecture

ThesisIQ does not treat valuation as an absolute truth.

Instead it asks:

> **What growth is the current market price already demanding, and how much room exists between that requirement and the underwritten business trajectory?**

### Reverse-DCF

The valuation engine derives market-implied growth from the current trailing valuation.

```text
Expectation Gap
=
Underwritten CAGR
-
Market-Implied Growth
```

### Stress Testing

The underwritten growth assumption is deliberately reduced by 20%.

```text
Stress CAGR
=
Underwritten CAGR × 0.80

Stress Cushion
=
Stress CAGR − Market-Implied Growth
```

This produces a deterministic robustness classification:

```text
HIGHLY_RESILIENT
RESILIENT
SENSITIVE
VULNERABLE
```

The stress test is an underwriting-risk control, not a prediction of future returns.

---

# Asymmetric Valuation Watchdog

The daily watchdog evaluates the portfolio for candidates that simultaneously satisfy multiple risk controls.

### Qualification Gates

1. Opportunity-tier threshold
2. Trailing valuation limit
3. Expectation-gap threshold
4. Minimum stressed cushion
5. Healthy thesis state
6. ROCE quality
7. Cash-conversion / working-capital controls

A candidate must pass the required controls before an alert can be dispatched.

### State-Transition Justification

Alerts are not generated merely because a formula remains true.

Each alert attempts to answer:

```text
What changed?
        +
Why does that change justify attention now?
```

This reduces repetitive notifications and makes alerts actionable.

### Anti-Spam / Idempotency

Telegram alerts use a PostgreSQL-backed per-ticker cooldown.

```text
Candidate qualifies
       ↓
Check previous dispatch
       ↓
 ┌─────┴─────┐
 │           │
Recent      Expired
alert        cooldown
 │           │
 ▼           ▼
Suppress    Dispatch
             │
             ▼
        Persist event
```

---

# Opportunity Classification

| Tier                            | Meaning                                                       | Capital Action                     |
| ------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| 🟢 `TOP_CONVICTION_DISLOCATION` | Strong asymmetry with required risk controls satisfied        | Prime fresh-capital candidate      |
| 🟡 `COMPOUNDING_AT_FAIR_PRICE`  | Healthy business with balanced risk/reward                    | Hold core position                 |
| 🔵 `OVERVALUED_COMPOUNDER`      | Strong business but valuation leaves limited margin of safety | Capital protection / avoid chasing |
| 🟠 `WATCHLIST_FRICTION`         | Thesis or evidence requires additional validation             | Pause incremental capital          |
| 🔴 `STRUCTURAL_VALUE_TRAP`      | Broken or materially deteriorating thesis                     | Zero allocation / systematic exit  |

---

# Production Benchmark Cases

The watchdog is tested against deliberately constructed scenarios representing different failure modes.

| Case               | Valuation | Stress Cushion | Cash Integrity     | Result             |
| ------------------ | --------: | -------------: | ------------------ | ------------------ |
| HBL Engineering    |     25.0× |         +10.4% | 0.90 CFO/PAT, 70d  | 🟢 Qualified       |
| Time Technoplast   |     18.2× |          +6.7% | 0.85 CFO/PAT, 75d  | 🟢 Qualified       |
| CCL Products       |     33.4× |           0.0% | 0.80 CFO/PAT, 80d  | 🟡 Fair-price gate |
| Transrail Lighting |     13.2× |         +12.8% | 0.55 CFO/PAT, 115d | 🟠 Cash-flow gate  |
| Shakti Pumps       |         — |  Broken thesis | 0.15 CFO/PAT, 140d | 🔴 Structural gate |

The benchmark cases demonstrate that **cheap valuation alone does not produce an actionable allocation signal**.

---

# Data Reliability & Integrity

ThesisIQ treats data correctness as a first-class system concern.

### Key invariants

* No manual database patching
* Point-in-time financial snapshots
* Trailing and forward valuation isolation
* Corporate-action-aware price history
* Mathematical market-cap validation
* No static ticker-specific decision branches
* Explicit evidence provenance
* Deterministic decision rules

### Example

```text
Incorrect:
Forward PAT → TTM P/E → Reverse DCF

Correct:
TTM PAT → TTM P/E
                 │
                 ▼
          Market-implied growth
                 │
                 ▼
        Compare against independently
        underwritten future growth
```

This prevents forward earnings assumptions from contaminating the trailing valuation layer.

---

# Testing

ThesisIQ uses invariant-driven testing rather than relying exclusively on happy-path unit tests.

```text
Asymmetric Mispricing Ranking       22/22 PASS
Market Valuation Integrity          33/33 PASS
Valuation Watchdog                  29/29 PASS
Thesis State Engine                  8/8 PASS
Driver-Level Contracts               5/5 PASS
Walk-Forward Replay                  5/5 PASS
Drawdown / Alpha Validation          4/4 PASS
Production Benchmark                 5/5 PASS
Vitest                                PASS
```

### Walk-Forward Validation

Historical replay is used to verify that decision logic does not consume information that would not have been available at the decision point.

This is particularly important for financial systems where accidental future-information leakage can make backtests appear significantly better than they actually are.

---

# Automation

The backend runs continuously on Oracle Cloud.

### Nightly reconciliation

```text
Daily Price Refresh
        ↓
Inter-Quarter Data Reconciliation
        ↓
Corporate Announcement Processing
        ↓
Management Commitment Reconciliation
        ↓
Valuation Watchdog
        ↓
Qualified Notifications
```

The system also supports standalone daily watchdog execution and benchmark dry-runs.

---

# Cloudflare Dispatcher

A lightweight Cloudflare Worker provides an authenticated bridge for triggering backend operations externally without exposing the backend execution surface directly.

---

# Tech Stack

| Layer          | Technology                                       |
| -------------- | ------------------------------------------------ |
| Frontend       | React, Vite, TypeScript, Tailwind CSS, shadcn/ui |
| Backend        | Node.js, Express, ESM                            |
| Database       | PostgreSQL / Supabase                            |
| LLM Pipeline   | NVIDIA NIM / Llama-3.3-70B                       |
| Edge           | Cloudflare Workers                               |
| Data Access    | SQL / PostgreSQL                                 |
| Charts         | Recharts                                         |
| Client State   | TanStack React Query                             |
| Valuation      | Programmatic Reverse-DCF                         |
| Notifications  | Telegram                                         |
| Infrastructure | Oracle Cloud                                     |

---

# Database Model

Core tables include:

```text
stocks
prices
quarterly_snapshots
market_data_snapshots
valuation_dislocation_alerts
xbrl_filings
xbrl_metrics_quarterly
financial_results
management_promises
corporate_announcements
transcript_analysis
```

The database acts as the **point-in-time source of truth** for financial, market, evidence, and decision-state data.

---

# Repository Structure

```text
thesis-iq/
│
├── backend/
│   ├── scripts/
│   │   ├── archive/
│   │   ├── run-nightly-reconciliation.js
│   │   ├── run-daily-valuation-watchdog.js
│   │   ├── run-asymmetric-mispricing-ranking.js
│   │   └── test-*.js
│   │
│   ├── services/
│   │   ├── asymmetric-mispricing-ranking.service.js
│   │   ├── valuation-dislocation-watchdog.service.js
│   │   ├── portfolio-market-valuation.service.js
│   │   ├── thesis-state-engine.service.js
│   │   ├── announcement.service.js
│   │   └── ...
│   │
│   ├── workers/
│   ├── routes/
│   ├── controllers/
│   ├── db/
│   └── server.js
│
├── cloudflare-dispatcher/
├── docs/
├── node_downloader/
├── src/
└── supabase/
```

---

# Engineering Design Principles

1. **Data integrity before decision logic**
2. **Point-in-time correctness**
3. **Deterministic decision surfaces**
4. **No manual database overrides**
5. **No ticker-specific hardcoded business logic**
6. **Trailing and forward valuation isolation**
7. **Explicit falsifiable thesis drivers**
8. **Risk controls before capital-allocation signals**
9. **Idempotent notification behaviour**
10. **Calibrated language — models produce candidates, not valuation truth**
11. **Historical replay must not leak future information**
12. **Failures should be observable and recoverable**

---

# Status

**Status:** Production
**Current Universe:** 18 companies
**Architecture:** Full-stack / data-processing platform
**License:** Private / Proprietary

> ThesisIQ is a personal research and engineering project. It is not investment advice.
