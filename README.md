# MBIQ — Portfolio Intelligence Platform

A comprehensive stock portfolio tracker and earnings call analysis tool built with React, Supabase, and AI-powered transcript analysis.

## Tech Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (Postgres, Edge Functions, RLS)
- **Charts**: Recharts
- **State**: TanStack React Query

---

## Local Development Setup

### Prerequisites

- [Node.js](https://github.com/nvm-sh/nvm#installing-and-updating) (v18+)
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) (`npm install -g supabase`)
- [Docker](https://docs.docker.com/get-docker/) (required for local Supabase)

### 1. Clone & Install

```sh
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
npm install
```

### 2. Start Local Supabase

This will spin up a local Postgres database and apply all migrations from `supabase/migrations/`:

```sh
supabase start
```

After starting, the CLI will output local credentials:

```
API URL:    http://127.0.0.1:54321
anon key:   eyJhbGci...
service_role key: eyJhbGci...
DB URL:     postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

### 3. Configure Environment

Create a `.env.local` file in the project root (do **not** commit this file):

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<anon_key_from_supabase_start>
```

Use `.env.frontend.example` for Vite (`VITE_*`) and `.env.example` for the Express backend (`DATABASE_URL`, `JWT_SECRET`, etc.); merge both into `.env.local` for local dev.

### 3.0 Admin login (Express + UI)

The React app and Express API are gated behind a single admin account (JWT in an httpOnly cookie).

1. Add to `.env.local` (same file as `DATABASE_URL`):

   ```env
   JWT_SECRET=<output of: openssl rand -hex 32>
   ```

2. Apply DB migrations (includes `app_admin_users`):

   ```sh
   npm run db:migrate
   ```

3. Set a strong password and seed the admin user (default username `admin`):

   ```env
   ADMIN_SEED_PASSWORD=your_secure_password_at_least_8_chars
   ```

   ```sh
   npm run db:seed:admin
   ```

4. Start the backend (`npm run server`) and frontend (`npm run dev`), then open `/login`.

**Note:** This protects the **Express** API and downloaded **files** under `/files`. The Supabase client in the browser still uses the public anon key; for stronger data isolation you would add Supabase Auth + RLS separately.

### 3.1 Connect Your Own Supabase Project (Cloud)

If you want to use your own hosted Supabase project:

1. Create a new project in the Supabase dashboard.
2. Link this repo to that project:

   ```sh
   supabase login
   supabase link --project-ref <your_project_ref>
   ```

3. Apply the schema + seed data to your project:

   ```sh
   supabase db reset
   ```

4. In `.env.local`, set your cloud project values:

   ```env
   VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<your_anon_public_key>
   ```

5. Set edge function secrets (service role key and external APIs) for that project:

   ```sh
   supabase secrets set SUPABASE_URL=https://<your-project-ref>.supabase.co
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
   supabase secrets set SCREENER_SESSION_ID=<your_screener_session_cookie>
   supabase secrets set SCREENER_CSRF_TOKEN=<your_screener_csrf_token>
   ```

6. Deploy the edge functions:

   ```sh
   supabase functions deploy --project-ref <your_project_ref> --all
   ```

### 4. Configure Edge Function Secrets

Edge functions need secrets to operate. Set them for local development:

```sh
# Required for edge functions to access the database
supabase secrets set SUPABASE_URL=http://127.0.0.1:54321
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key_from_supabase_start>

# Required for Screener.in financial data scraping
supabase secrets set SCREENER_SESSION_ID=<your_screener_session_cookie>
supabase secrets set SCREENER_CSRF_TOKEN=<your_screener_csrf_token>
```

1. Go to [screener.in](https://www.screener.in/) and log in
2. Open browser DevTools → Application → Cookies
3. Copy the values of `sessionid` and `csrftoken`

#### 4.1. Real-Time Announcement Pipeline (Backend only)
To enable the **Thesis-Aware** corporate announcement scanner:
1.  **NVIDIA NIM**: Set `NVIDIA_API_KEY` for Llama 3.1 classification.
2.  **Telegram**: Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for real-time alerts.
3.  **Supabase**: The scanner uses `DATABASE_URL` (Direct PG connection) for high-performance ingestion.
4.  **Investment Thesis**: Ensure the `investment_thesis` column in the `stocks` table is populated for best results.

### 5. Serve Edge Functions Locally

In a separate terminal:

```sh
supabase functions serve
```

### 6. Start the Frontend

```sh
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## Project Structure

```
├── src/
│   ├── components/       # React components
│   ├── hooks/            # Custom React hooks (useStocks, useFinancials, etc.)
│   ├── integrations/     # Auto-generated Supabase client & types
│   ├── lib/              # Utilities, signals detection, types
│   └── pages/            # Route pages (Index, StocksPage, StockDetailPage, etc.)
├── supabase/
│   ├── config.toml       # Supabase project config
│   ├── migrations/       # Database migrations (auto-applied on `supabase start`)
│   └── functions/        # Edge functions
│       ├── fetch-price/          # Yahoo Finance price fetcher
│       ├── fetch-financials/     # Screener.in financial data scraper
│       ├── fetch-deals/          # Bulk/insider deal fetcher
│       ├── fetch-sector-indices/ # Nifty sector index tracker
│       ├── fetch-results-calendar/ # Upcoming results date fetcher
│       ├── refresh-all-prices/   # Batch price refresh
│       ├── refresh-all-financials/ # Batch financials refresh
│       ├── analyze-transcript/   # AI transcript analysis
│       ├── run-priority-backfill.js # Utility for bulk XBRL & Screener backfill
```

## Key Features

- **Dual-Exchange Announcement Scanner**: Integrated real-time ingestion from **BSE** and **NSE** with automated "Merge Model" deduplication.
- **Thesis-Aware AI Classification**: Uses the highly powerful **Llama 3.1 70B** model (via NVIDIA NIM) to classify news not just by topic, but by how it impacts your specific **Investment Thesis**, generating a mandatory **qualitative overall verdict** (overall good/strong, flat, or bad/weak) at the absolute start of every summary.
- **Full Document Intelligence**: Automatic full-scale extraction and analysis of PDF attachments (up to **60,000 characters**), ensuring complete quarterly financial tables, segmental metrics, and auditor reviews are fully parsed and fed to the AI context.
- **Sentiment-First Telegram Alerts**: High-signal, structured notifications that prioritize **IMPACT (POSITIVE/NEGATIVE)** and include portfolio category context, key figures, and direct document links.
- **Automatic Result Date Sync**: Detects upcoming financial result dates in filings and automatically updates the portfolio countdown.
- **Announcements**: On each stock’s detail page, an **Announcements** tab lists downloaded filings (earnings, concall transcripts, investor presentations) by quarter and type with **View** links. Use **Download filings** to fetch from NSE & Screener.
- **Google Drive upload** (optional): Upload announcements to a Drive folder in a structured layout. See [docs/GOOGLE_DRIVE_SETUP.md](docs/GOOGLE_DRIVE_SETUP.md) for creating a service account and API key.

## V12 High-Conviction Truth Layer

The platform now operates on a sophisticated **V12 Truth Layer**, upgrading from speculative AI inference to high-fidelity, mechanically verified official data.

### 1. Official XBRL Hybrid Engine (V3)
- **Deep Extraction Beyond P&L**: Moves beyond simple revenue/profit tracking to extract high-impact metrics including **Receivables, Inventory, Borrowings, Cash & Bank, CFO, Capex, and Equity**.
- **Dual-Engine Logic**: Combines fast NSE API data for core quarterly results with deep local XBRL parsing for balance sheet and cash flow enrichment.
- **Automated Cloud Backup**: Integrated Google Drive archival. Every raw XBRL filing is automatically uploaded to a structured hierarchy (`Announcements/SYMBOL/QUARTER/`) and linked in the database.
- **Unified Announcement Hub**: XBRL filings are cross-referenced in the central corporate feed, allowing one-click access from the UI directly to the source document on Drive.
- **Canonical Normalization**: Automatically standardizes and scales all metrics to Crores, ensuring consistency across diverse filing styles.
- **Automated Validation**: Built-in math checks flag logic errors in corporate reporting (e.g., PAT exceeding Revenue, misstated Expenses).

### 2. Surgical AI Prompt Wiring
- **Quarterly Time-Travel**: The `CopyGeminiPrompt` UI strictly scopes historical data to prevent future knowledge from bleeding into past quarter AI backtests.
- **Truth-Based Momentum**: The `Last 4Q Trend` (Section B) is calculated deterministically from the official XBRL pipeline, not inferred by AI, ensuring high-accuracy `Positive/Negative` momentum signals.

### 3. Dual-Tier Metrics Schema & Hybrid Rules
- **Critical Metrics**: Full source, confidence, and period tracking for high-conviction drivers.
- **Screener Fallback**: Used strategically for annual metrics (ROCE/ROE) and TTM Balance Sheet data when XBRL is sparse.
- **Kill-Switch Supremacy**: High-severity anomalies explicitly override Multibagger Mode for immediate `CUT` signals.
- **Promoter Selling Trends**: Automated detection and penalization of consistent distribution trends over multiple quarters.
- **Explained Cooldown**: Intelligent handling of one-time explained selling events (block deals, PE exits).
- **Event-Driven Intelligence**: Real-time corporate action ingestion (BSE/NSE) that updates conviction in between quarterly reports.

### 4. Decision Engine (Prompt Generator)
- **Mathematical Pre-Processing**: Calculates tolerance-based trends (`±5%` growth, `±0.5%` margins) to filter out noise and extract true momentum before passing data to the LLM.
- **Smart Data Handling**: Auto-detects holes in data, switches to 2-quarter trends dynamically, and labels missing data as `NOT DISCLOSED` to strictly prevent hallucination.
- **Source Attribution**: Injects `Source:` labels alongside pre-processed metrics to guarantee the AI correctly attributes values.
- **Smart Toggles**: UI controls to toggle sections of the prompt (Ownership, Valuations, Previous Verdict) to actively manage the context window size and precision.

### 5. V10 Legacy Features
- **Multibagger Mode**: Protects high-conviction winners from premature exits.
- **Penalty Normalization**: Consolidates overlapping penalties to prevent artificial score collapse.
- **Portfolio Awareness**: Flags theme concentration bounds.
- **Skepticism Discipline**: Actively penalizes structurally perfect management transcripts missing natural business friction.

## Database

All tables have RLS enabled. Migrations in `supabase/migrations/` are applied automatically when you run `supabase start`. Key tables:

| Table | Purpose |
|-------|---------|
| `stocks` | Portfolio stocks with thesis & tracking config |
| `prices` | Daily price history |
| `financial_metrics` | Annual financial data (ROCE, ROE, etc.) |
| `financial_results` | Quarterly results |
| `shareholding` | Quarterly shareholding pattern |
| `peer_comparison` | Peer company metrics |
| `transcript_analysis` | AI-analyzed earnings call data |
| `quarterly_snapshots` | V5 quarterly thesis snapshots |
| `management_promises` | Tracked management commitments |
| `bulk_deals` / `insider_trades` | Deal activity |
| `sector_indices` | Nifty sector index prices |
| `corporate_announcements` | AI-classified real-time filings (BSE/NSE) |

## Useful Commands

```sh
supabase start          # Start local Supabase (applies migrations)
supabase stop           # Stop local Supabase
supabase db reset       # Reset DB and re-apply all migrations
supabase functions serve # Serve edge functions locally
npm run dev             # Start frontend dev server
npm run server          # Start Express backend (Announcement scanner & Files)
npm run build           # Production build
```

## Deployment

- **Frontend**: Deployed via Vercel (see `vercel.json` configuration).
- **Backend & Edge Functions**: Deployed to Supabase Cloud.
- **Worker & Scanner**: Deployed as automated GitHub Actions workflows (see `.github/workflows/`).
