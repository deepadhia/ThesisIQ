-- Migration: Portfolio Capacity Engines & Normalized Valuation Ledger
-- Description: Stores forward physical capacity, contracted order backlog, normalized asset turnover, 
-- and milestone-gated capital deployment tranches for long-duration compounders.

CREATE TABLE IF NOT EXISTS portfolio_capacity_engines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  engine_name TEXT NOT NULL,
  engine_type TEXT NOT NULL CHECK (
    engine_type IN (
      'GREENFIELD_CAPEX',
      'ORDER_BOOK_BACKLOG',
      'PLATFORM_M_AND_A',
      'CAPACITY_DEBOTTLENECK',
      'PRODUCT_LINE_TRANSITION'
    )
  ),
  status TEXT NOT NULL DEFAULT 'UNDER_CONSTRUCTION' CHECK (
    status IN (
      'ANNOUNCED',
      'UNDER_CONSTRUCTION',
      'TRIAL_COMMISSIONING',
      'COMMERCIAL_BILLING',
      'SCALED'
    )
  ),
  unbilled_capex_cr NUMERIC NOT NULL DEFAULT 0.0,
  contracted_backlog_cr NUMERIC NOT NULL DEFAULT 0.0,
  current_runrate_revenue_cr NUMERIC NOT NULL,
  full_capacity_revenue_cr NUMERIC NOT NULL,
  normalized_ebitda_margin_pct NUMERIC NOT NULL,
  normalized_pat_margin_pct NUMERIC NOT NULL,
  normalized_full_capacity_pat_cr NUMERIC NOT NULL,
  target_commissioning_quarter TEXT NOT NULL,
  milestone_tranches JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_rationale TEXT,
  rationale_claim_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticker, engine_name)
);

CREATE INDEX IF NOT EXISTS idx_capacity_engines_ticker ON portfolio_capacity_engines(ticker);
