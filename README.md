# 🏛️ Multibagger Live — Institutional Equity Thesis Watchdog

A production-grade fundamental research platform for long-term equity investing. Combines **quarterly thesis governance**, **dual-lens valuation architecture**, and an **asymmetric dislocation watchdog** to track whether the investment thesis of each portfolio company is strengthening, intact, or breaking — and whether any are currently mispriced relative to their underwritten growth runway.

---

## What This System Does

```
CORE OPERATING QUESTION:
"If I were deciding whether to own this company today, is the original reason
I bought it MORE credible, EQUALLY credible, or LESS credible than 3 months ago?
And is the market currently pricing in less growth than I've underwritten?"
```

### The Two Independent Lenses

| Lens | Purpose |
|---|---|
| **1. Business Thesis State** | Is the reason I own this company still valid? |
| **2. Dual-Lens Valuation Watchdog** | Is the market pricing in less growth than I've underwritten (Reverse-DCF)? |

These two lenses are evaluated **independently** and synthesized only at the capital allocation decision point.

---

## System Architecture

```
═══════════════════════════════════════════════════════════════════════════
                  MULTI-SOURCE STATUTORY INGESTION PIPELINES
═══════════════════════════════════════════════════════════════════════════
  1. Concall Transcripts & Presentations   → Management Commitments & Guidance
  2. Statutory XBRL Filings (NSE/BSE)      → Normalized P&L, Balance Sheet
  3. LODR Corporate Announcements (Live)   → NIM Llama-3.3-70B LLM Pipeline
  4. Daily Market Prices                   → Corporate Action Adjusted Price Sync
                                          │
                                          ▼
                       PostgreSQL (Supabase) — Point-in-Time Storage
                                          │
                                          ▼
═══════════════════════════════════════════════════════════════════════════
                         4-LAYER DECISION ENGINE
═══════════════════════════════════════════════════════════════════════════

 LAYER 1 — FROZEN QUANTITATIVE RANKING
 • Pure mathematical portfolio rank (18 stocks, invariant, zero runtime mutation)

 LAYER 2 — SHADOW KPI & ROLLING PRICE ENGINE
 • Trailing 365-day 52W High/Low | P/E denominator consistency | Unit margin tracking

 LAYER 3 — DRIVER CONTRACTS & FALSIFICATION KILL-SWITCHES
 • 3–6 explicit falsifiable drivers per company evaluated against NIM-extracted evidence
 • Canonical 6-state thesis enum: STRENGTHENING | INTACT | WATCH | AT_RISK | BROKEN | INSUFFICIENT_EVIDENCE

 LAYER 4 — DUAL-LENS CAPITAL ALLOCATION DECISION SURFACE
 • Synthesizes Thesis State + Reverse-DCF Expectation Gap → Capital allocation tier
                                          │
                                          ▼
═══════════════════════════════════════════════════════════════════════════
               ASYMMETRIC VALUATION DISLOCATION WATCHDOG (DAILY)
═══════════════════════════════════════════════════════════════════════════
 • Reverse-DCF Solver: Derives market-implied growth from trailing P/E
 • Expectation Gap: Underwritten CAGR − Market-Implied Growth
 • Stressed Cushion: Gap after -20% growth haircut → Thesis robustness classification
 • 6 Risk Controls: Valuation gate | Asymmetry gate | Stress cushion | Thesis health | ROCE | Cash conversion
 • 7-Day Anti-Spam Cooldown: Immutable PostgreSQL cooldown per ticker
 • State Transition Justification: What changed + why it justifies attention now
```

---

## Opportunity Tier Classification

| Tier | Condition | Capital Action |
|---|---|---|
| 🟢 `TOP_CONVICTION_DISLOCATION` | Score ≥ 80, pristine cash flow, wide stressed gap | **Prime fresh capital deployment** |
| 🟡 `COMPOUNDING_AT_FAIR_PRICE` | Healthy business, balanced risk/reward | **Hold core position** |
| 🔵 `OVERVALUED_COMPOUNDER` | Superb execution, but priced for perfection | **Capital protection trim** |
| 🟠 `WATCHLIST_FRICTION` | Thesis or evidence under pressure | **Pause additions** |
| 🔴 `STRUCTURAL_VALUE_TRAP` | Broken/weakening thesis | **Zero allocation / Systematic exit** |

### Verified Benchmark Behaviour (5-Case Dry Run)

| Stock | TTM P/E | Stressed Cushion | Cash Integrity | Tier | Watchdog Decision |
|---|---|---|---|---|---|
| **HBL Engineering** | 25.0× | +10.4% `HIGHLY_RESILIENT` | 0.90 CFO/PAT, 70d | `TOP_CONVICTION_DISLOCATION` | 🟢 Alert Dispatched |
| **Time Technoplast** | 18.2× | +6.7% `RESILIENT` | 0.85 CFO/PAT, 75d | `TOP_CONVICTION_DISLOCATION` | 🟢 Alert Dispatched |
| **CCL Products** | 33.4× | 0.0% `SENSITIVE` | 0.80 CFO/PAT, 80d | `COMPOUNDING_AT_FAIR_PRICE` | 🟡 Gated — Fair Price |
| **Transrail Lighting** | 13.2× | +12.8% `HIGHLY_RESILIENT` | **0.55 CFO/PAT, 115d** | `COMPOUNDING_AT_FAIR_PRICE` | 🟠 Gated — Cash Watch |
| **Shakti Pumps** | 16.0× | N/A `BROKEN` | **0.15 CFO/PAT, 140d** | `STRUCTURAL_VALUE_TRAP` | 🔴 Gated — Value Trap |

---

## Production Invariant Test Suites

All test suites run against the live PostgreSQL database with zero mocks:

```bash
# Asymmetric Mispricing Ranking — 22/22 PASS
node --env-file=.env.local backend/scripts/test-asymmetric-mispricing-ranking.js

# Market Valuation Integrity (trailing vs. forward P/E isolation) — 33/33 PASS
node --env-file=.env.local backend/scripts/test-market-valuation-integrity.js

# Valuation Dislocation Watchdog & 7-Day Anti-Spam Cooldown — 29/29 PASS
node --env-file=.env.local backend/scripts/test-valuation-dislocation-watchdog.js

# Thesis State Engine — 8/8 PASS
node --env-file=.env.local backend/scripts/test-thesis-state-engine.js

# Driver-Level Thesis Contracts — 5/5 PASS
node --env-file=.env.local backend/scripts/test-driver-contracts.js

# Walk-Forward Replay (no future-info leakage) — 5/5 PASS
node --env-file=.env.local backend/scripts/test-walk-forward-replay.js

# Price Drawdown Avoidance & Alpha Validation — 4/4 PASS
node --env-file=.env.local backend/scripts/test-price-drawdown-validation.js

# Vitest unit tests
npm test
```

---

## NPM Scripts Reference

```bash
# Development
npm run dev                       # Start Vite frontend dev server
npm run server:dev                # Start Express backend (with .env.local)
npm run server                    # Start Express backend (production)

# Nightly Automation
npm run reconcile:nightly         # Run full nightly reconciliation pipeline

# Valuation Watchdog
npm run watchdog:daily            # Run daily dislocation watchdog (LIVE — sends Telegram)
npm run watchdog:daily:dryrun     # Run daily watchdog in dry-run mode (no Telegram)
npm run watchdog:benchmark        # Run 5-case production benchmark dry-run

# Ranking & Analysis
npm run ranking                   # Run asymmetric mispricing ranking across 18 holdings

# Portfolio Universe
npm run ranks:quarterly           # Compute quarterly universe ranks
npm run ranks:quarterly:apply     # Compute and persist quarterly ranks to DB

# Database
npm run db:migrate                # Run database migrations
npm run db:seed                   # Seed initial portfolio data
npm run onboard:stock             # Onboard a new stock to the universe

# Tests
npm test                          # Run vitest unit tests
```

---

## Server Deployment (Oracle Cloud)

The backend runs continuously on Oracle Cloud. All automation runs **on the server**, not GitHub Actions.

### Nightly Cron (23:30 IST)

```bash
# /etc/cron.d/multibagger or crontab -e
30 23 * * * cd /path/to/multibagger-live && npm run reconcile:nightly >> /var/log/reconciliation.log 2>&1
```

The nightly reconciliation executes:
1. **Daily Price Refresh** — Refreshes closing prices & trailing 365-day 52W High/Low in PostgreSQL
2. **Async Gap Reconciler** — Ingests concall transcripts filed days after board results
3. **BSE/NSE Announcement Scanner** — Real-time LODR ingestion via NIM Llama-3.3-70B
4. **Commitment Reconciler** — Tracks management guidance fulfilment per quarter
5. **Valuation Dislocation Watchdog** — Evaluates all 18 holdings against 6 risk controls; dispatches Telegram alerts for `TOP_CONVICTION_DISLOCATION` candidates with 7-day anti-spam cooldown

### Cloudflare Dispatcher

A lightweight Cloudflare Worker (`cloudflare-dispatcher/`) acts as a secure bridge for triggering backend operations via authenticated HTTP calls from external automations.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui |
| **Backend** | Node.js / Express (ESM) |
| **Database** | Supabase (PostgreSQL) with Row Level Security |
| **LLM Pipeline** | NVIDIA NIM — Llama-3.3-70B (filing extraction & classification) |
| **Edge Dispatcher** | Cloudflare Workers |
| **Charts** | Recharts + TanStack React Query |
| **Valuation Engine** | Programmatic Reverse-DCF solver (10-year horizon, forward-discounting) |

---

## Local Setup

### Prerequisites
- Node.js v18+
- A Supabase project (PostgreSQL) with `DATABASE_URL` configured

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL, TELEGRAM_BOT_TOKEN, GEMINI_API_KEY

# 3. Run frontend dev server
npm run dev

# 4. Run backend server (separate terminal)
npm run server:dev
```

---

## Database Schema (Key Tables)

| Table | Description |
|---|---|
| `stocks` | Portfolio universe — thesis state, conviction, capital action directives |
| `prices` | Daily corporate-action adjusted price history |
| `quarterly_snapshots` | Consolidated quarterly TTM metrics per stock (PAT, EPS, P/E, ROCE, CFO/PAT) |
| `market_data_snapshots` | Point-in-time market data with math-verified invariants (MCap = Price × Shares) |
| `valuation_dislocation_alerts` | Immutable log of watchdog alert dispatches with 7-day cooldown enforcement |
| `xbrl_filings` | Statutory quarterly & annual exchange filing records |
| `xbrl_metrics_quarterly` | Normalized XBRL balance sheet & P&L metrics |
| `financial_results` | Consolidated quarterly financial performance |
| `management_promises` | Tracked management commitments & fulfillment status |
| `corporate_announcements` | Real-time BSE/NSE LODR filings |
| `transcript_analysis` | Concall transcript extraction & credibility scoring |

For detailed schema documentation, see [`docs/DATABASE_SCHEMA_GUIDE.md`](docs/DATABASE_SCHEMA_GUIDE.md).

---

## Repository Structure

```
multibagger-live/
├── backend/
│   ├── scripts/            ← Production runners & test suites
│   │   ├── archive/        ← One-off backfill/migration scripts (preserved, not active)
│   │   ├── run-nightly-reconciliation.js       ← Core nightly pipeline
│   │   ├── run-daily-valuation-watchdog.js     ← Daily dislocation watchdog
│   │   ├── run-asymmetric-mispricing-ranking.js ← Interactive ranking runner
│   │   ├── test-*.js                           ← Invariant test suites
│   │   └── ...
│   ├── services/           ← Core business logic services
│   │   ├── asymmetric-mispricing-ranking.service.js    ← Reverse-DCF & opportunity tier engine
│   │   ├── valuation-dislocation-watchdog.service.js   ← Alert dispatch & cooldown engine
│   │   ├── portfolio-market-valuation.service.js       ← TTM ingestion & math invariants
│   │   ├── thesis-state-engine.service.js              ← 6-state thesis classification
│   │   ├── announcement.service.js                     ← BSE/NSE LODR scanner
│   │   └── ...
│   ├── workers/            ← Background processing workers
│   ├── routes/             ← Express API routes
│   ├── controllers/        ← Route handlers
│   ├── db/                 ← Database pool & utilities
│   └── server.js           ← Express app entrypoint
├── cloudflare-dispatcher/  ← Cloudflare Worker (secure HTTP trigger bridge)
├── docs/                   ← Architecture docs & engineering learnings
│   ├── LEARNINGS_VALUATION_DUAL_LENS.md
│   └── DATABASE_SCHEMA_GUIDE.md
├── node_downloader/        ← BSE/NSE filing downloader (independent Node service)
├── src/                    ← React frontend (Vite + TypeScript)
└── supabase/               ← Supabase migrations & config
```

---

## Key Design Invariants

1. **No Manual Database Patching** — Never run ad-hoc SQL `UPDATE`/`DELETE` to override data. Fix the underlying code.
2. **Multi-Stage Corporate Actions** — Board approval ≠ `Achieved`. Only final regulatory clearance (NCLT, SEBI) can close a commitment.
3. **No Static Ticker Branches** — No hardcoded `if (ticker === "ANANTRAJ")` logic anywhere in the codebase.
4. **Trailing TTM Isolation** — Trailing and forward P/E are strictly isolated; the Reverse-DCF forward-discounts estimates to avoid double-counting growth.
5. **Calibrated Language** — The watchdog says `CANDIDATE MEETS ASYMMETRIC-DISLOCATION CRITERIA`, not `MISPRICING DETECTED`. Risk controls, not valuation truth.
6. **7-Day Anti-Spam** — Telegram alerts enforce an immutable 7-day per-ticker cooldown in PostgreSQL.

---

## Documentation

| Document | Description |
|---|---|
| [`docs/LEARNINGS_VALUATION_DUAL_LENS.md`](docs/LEARNINGS_VALUATION_DUAL_LENS.md) | Institutional learnings: CCL, HSCL trailing vs. forward, Transrail cash-flow gate |
| [`docs/DATABASE_SCHEMA_GUIDE.md`](docs/DATABASE_SCHEMA_GUIDE.md) | Full database schema reference |
| [`docs/INTER_QUARTER_EVENT_RECONCILER_SPEC.md`](docs/INTER_QUARTER_EVENT_RECONCILER_SPEC.md) | Interquarter event reconciliation specification |
| [`docs/GOOGLE_DRIVE_SETUP.md`](docs/GOOGLE_DRIVE_SETUP.md) | Google Drive integration setup |

---

## Status

**Status**: Production  
**Universe**: 18 portfolio holdings  
**License**: Private / Proprietary
