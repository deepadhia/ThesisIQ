-- Migration: Guidance tracking (pacing history + verified year-end outcomes)
-- Description: management_commitments is too noisy to carry credibility (hundreds of repeated extractions per stock, "Achieved" 96%
-- on loose AI labels). These two tables hold what can be VERIFIED from the filed statements:
--   guidance_pacing_history : each quarter, where the year to date stands against the full-year guide (and what the rest of the year must deliver)
--   guidance_outcomes       : the full-year result of a guide, judged on the March-quarter statement (MET / PARTIAL / MISSED)
-- Both are written by the deep-dive worker (idempotent upserts) and read for the pacing / track-record lines of an alert.

CREATE TABLE IF NOT EXISTS guidance_pacing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,            -- 'FY27'
  kind TEXT NOT NULL,                   -- REVENUE_GROWTH | REVENUE_ABS | PAT_GROWTH | EBITDA_MARGIN
  as_of DATE NOT NULL,                  -- quarter end of the statement the reading comes from
  ytd_label TEXT,                       -- 'H1' | '9M'
  status TEXT NOT NULL,                 -- AHEAD | ON_TRACK | STRETCH | BEHIND
  basis TEXT,                           -- NULL (full pacing) | RUN_RATE
  guided_text TEXT,
  ytd_growth_pct NUMERIC,
  required_low_pct NUMERIC,
  required_high_pct NUMERIC,
  gap_pts NUMERIC,
  line TEXT,
  statement TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, fiscal_year, kind, as_of)
);

CREATE INDEX IF NOT EXISTS idx_guidance_pacing_history_ticker ON guidance_pacing_history (ticker, fiscal_year, as_of DESC);

CREATE TABLE IF NOT EXISTS guidance_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  kind TEXT NOT NULL,
  initial BOOLEAN NOT NULL DEFAULT TRUE,  -- TRUE: the first guide given for that year (what credibility is judged on); FALSE: the guide in force at year end after revisions
  status TEXT NOT NULL,                   -- MET | PARTIAL | MISSED
  guided_text TEXT,
  line TEXT,
  statement TEXT,
  commitment_id UUID,
  judged_at DATE NOT NULL,                -- the year end the judgement is made on
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, fiscal_year, kind, initial)
);

CREATE INDEX IF NOT EXISTS idx_guidance_outcomes_ticker ON guidance_outcomes (ticker, fiscal_year DESC);
