-- Missing provider facts must remain unknown. Preserve required quote/provenance fields.
-- No row updates, data deletion or financial backfill. Apply through the normal migration process.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE public.market_data_snapshots
  ALTER COLUMN enterprise_value DROP NOT NULL,
  ALTER COLUMN net_debt DROP NOT NULL,
  ALTER COLUMN net_debt DROP DEFAULT,
  ALTER COLUMN dilution_warrants_impact_pct DROP DEFAULT,
  ALTER COLUMN ttm_revenue DROP NOT NULL,
  ALTER COLUMN ttm_ebitda DROP NOT NULL,
  ALTER COLUMN ttm_ebit DROP NOT NULL,
  ALTER COLUMN ttm_pat DROP NOT NULL,
  ALTER COLUMN ttm_eps DROP NOT NULL,
  ALTER COLUMN pe_ratio DROP NOT NULL,
  ALTER COLUMN ev_ebitda_ratio DROP NOT NULL;
COMMIT;
