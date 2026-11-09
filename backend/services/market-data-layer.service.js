/**
 * Phase 4A: Market Data Foundation Service & Gate 1 Freshness Layer
 * Enforces 100% Programmatic Math, Strict Provenance Lineage, and Gate 1 Freshness Control.
 */
import { assessSnapshotFreshness } from './valuation-inputs.service.js';

export function validateMarketDataSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      isValid: false,
      status: "VALUATION_BLOCKED",
      errorCode: "MALFORMED_MARKET_SNAPSHOT",
      errorMessage: "Snapshot object is missing or invalid."
    };
  }

  const ticker = snapshot.ticker;
  const period = snapshot.period;
  const asOfDate = snapshot.asOfDate || snapshot.marketDataAsOf;
  const retrievedAt = snapshot.retrievedAt;
  const marketDataSource = snapshot.marketDataSource;
  const sourceDocumentId = snapshot.sourceDocumentId;
  const sourceHash = snapshot.sourceHash;
  const sharePrice = snapshot.sharePrice;
  const sharesOutstanding = snapshot.sharesOutstanding;
  const marketCap = snapshot.marketCap;
  const freshnessStatus = snapshot.freshnessStatus;

  // 1. Provenance Check
  if (!ticker || !period || !asOfDate || !retrievedAt || !marketDataSource || !sourceDocumentId || !sourceHash) {
    return {
      isValid: false,
      status: "VALUATION_BLOCKED",
      errorCode: "MISSING_PROVENANCE_LINEAGE",
      errorMessage: "Market data snapshot missing mandatory provenance fields (source, retrievedAt, asOfDate, sourceDocumentId, sourceHash)."
    };
  }

  // 2. Programmatic Calculation Integrity Check (marketCap = sharePrice * sharesOutstanding)
  const price = parseFloat(sharePrice);
  const shares = parseFloat(sharesOutstanding);
  const cap = parseFloat(marketCap);

  if (![price, shares, cap].every(Number.isFinite) || price <= 0 || shares <= 0 || cap <= 0) {
    return {
      isValid: false,
      status: "VALUATION_BLOCKED",
      errorCode: "MALFORMED_MARKET_SNAPSHOT",
      errorMessage: "Share price or shares outstanding are non-numeric or non-positive."
    };
  }

  const expectedCap = price * shares;
  const capVariancePct = Math.abs((cap - expectedCap) / expectedCap) * 100;

  if (capVariancePct > 0.1) { // 0.1% tolerance
    return {
      isValid: false,
      status: "VALUATION_BLOCKED",
      errorCode: "MALFORMED_MARKET_SNAPSHOT",
      errorMessage: `Programmatic calculation mismatch: Market Cap (${cap}) does not match sharePrice * sharesOutstanding (${expectedCap.toFixed(2)}). Variance: ${capVariancePct.toFixed(2)}%.`
    };
  }

  // 3. Gate 1 Freshness Enforcement
  if (!assessSnapshotFreshness(asOfDate).fresh || !Number.isFinite(new Date(retrievedAt).getTime()) || new Date(retrievedAt).getTime() > Date.now() + 300000) {
    return { isValid: false, status: 'VALUATION_BLOCKED', errorCode: 'MARKET_DATA_EXPIRED', errorMessage: 'Market quote date is stale, missing or in the future; freshness labels cannot override its date.' };
  }
  if (freshnessStatus === "EXPIRED") {
    return {
      isValid: false,
      status: "VALUATION_BLOCKED",
      errorCode: "MARKET_DATA_EXPIRED",
      errorMessage: "Market data snapshot is EXPIRED. Downstream valuation computation is strictly forbidden."
    };
  }

  if (freshnessStatus === "STALE_WARNING") {
    return {
      isValid: true,
      status: "VALUATION_ALLOWED_WITH_WARNING",
      warningMessage: "Market data is stale. Downstream valuation allowed with explicit warning flag.",
      calculatedMarketCap: expectedCap
    };
  }

  if (freshnessStatus === "FRESH") {
    return {
      isValid: true,
      status: "VALUATION_ALLOWED",
      calculatedMarketCap: expectedCap
    };
  }

  return {
    isValid: false,
    status: "VALUATION_BLOCKED",
    errorCode: "MALFORMED_MARKET_SNAPSHOT",
    errorMessage: `Unrecognized freshnessStatus '${freshnessStatus}'. Must be FRESH, STALE_WARNING, or EXPIRED.`
  };
}

/**
 * Ingests & Persists Market Data Snapshot to Supabase DB (Fails closed if validation fails)
 */
export async function ingestMarketDataSnapshot(snapshot, pool) {
  const validation = validateMarketDataSnapshot(snapshot);

  if (!validation.isValid) {
    return {
      success: false,
      status: validation.status,
      errorCode: validation.errorCode,
      errorMessage: validation.errorMessage,
      persistedRecord: null
    };
  }

  const asOfDate = snapshot.asOfDate || snapshot.marketDataAsOf;
  const {
    ticker, period, retrievedAt, marketDataSource, marketDataVersion = 1,
    sourceDocumentId, sourceHash, freshnessStatus, sharePrice, sharesOutstanding,
    marketCap, netDebt = null, dilutionWarrantsImpactPct = null,
    ttmRevenue, ttmEbitda, ttmEbit, ttmPat, ttmEps, ttmFcf = null, rocePct = null,
    peRatio, evEbitdaRatio, peHistoricalPercentile = null
  } = snapshot;

  const programmaticEV = netDebt !== null && netDebt !== '' && Number.isFinite(Number(netDebt))
    ? Number(marketCap) + Number(netDebt) : null;

  const query = `
    INSERT INTO market_data_snapshots (
      ticker, period, market_data_as_of, market_data_retrieved_at, market_data_source,
      market_data_version, source_document_id, source_hash, freshness_status,
      share_price, shares_outstanding, market_cap, enterprise_value, net_debt,
      dilution_warrants_impact_pct, ttm_revenue, ttm_ebitda, ttm_ebit, ttm_pat,
      ttm_eps, ttm_fcf, roce_pct, pe_ratio, ev_ebitda_ratio, pe_historical_percentile
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
    )
    ON CONFLICT (ticker, period, market_data_as_of) DO UPDATE SET
      freshness_status = EXCLUDED.freshness_status,
      share_price = EXCLUDED.share_price,
      shares_outstanding = EXCLUDED.shares_outstanding,
      market_cap = EXCLUDED.market_cap,
      enterprise_value = EXCLUDED.enterprise_value,
      net_debt = EXCLUDED.net_debt,
      dilution_warrants_impact_pct = EXCLUDED.dilution_warrants_impact_pct,
      ttm_revenue = EXCLUDED.ttm_revenue,
      ttm_ebitda = EXCLUDED.ttm_ebitda,
      ttm_ebit = EXCLUDED.ttm_ebit,
      ttm_pat = EXCLUDED.ttm_pat,
      ttm_eps = EXCLUDED.ttm_eps,
      ttm_fcf = EXCLUDED.ttm_fcf,
      roce_pct = EXCLUDED.roce_pct,
      ev_ebitda_ratio = EXCLUDED.ev_ebitda_ratio,
      pe_historical_percentile = EXCLUDED.pe_historical_percentile,
      market_data_source = EXCLUDED.market_data_source,
      market_data_version = EXCLUDED.market_data_version,
      source_document_id = EXCLUDED.source_document_id,
      source_hash = EXCLUDED.source_hash,
      pe_ratio = EXCLUDED.pe_ratio,
      market_data_retrieved_at = EXCLUDED.market_data_retrieved_at
    RETURNING *;
  `;

  const values = [
    ticker, period, asOfDate, retrievedAt, marketDataSource, marketDataVersion,
    sourceDocumentId, sourceHash, freshnessStatus, sharePrice, sharesOutstanding,
    marketCap, programmaticEV, netDebt, dilutionWarrantsImpactPct, ttmRevenue,
    ttmEbitda, ttmEbit, ttmPat, ttmEps, ttmFcf, rocePct, peRatio, evEbitdaRatio, peHistoricalPercentile
  ];

  const { rows } = await pool.query(query, values);
  
  return {
    success: true,
    status: validation.status,
    warningMessage: validation.warningMessage || null,
    persistedRecord: rows[0]
  };
}

/**
 * Retrieves Snapshot and Enforces Gate 1 Downstream Blocking
 */
export async function getMarketDataSnapshot(ticker, period, pool, options = {}) {
  let query = `
    SELECT * FROM market_data_snapshots
    WHERE ticker = $1 AND period = $2
  `;
  const values = [ticker, period];

  if (options.asOfDate) {
    query += ` AND market_data_as_of = $3`;
    values.push(options.asOfDate);
  }

  query += ` ORDER BY market_data_as_of DESC LIMIT 1;`;
  const { rows } = await pool.query(query, values);

  if (rows.length === 0) {
    return {
      status: "VALUATION_BLOCKED",
      errorCode: "MISSING_MARKET_SNAPSHOT",
      errorMessage: `No market data snapshot found for ${ticker} (${period}).`
    };
  }

  const record = rows[0];

  if (record.freshness_status === "EXPIRED" || !assessSnapshotFreshness(record.market_data_as_of).fresh) {
    return {
      status: "VALUATION_BLOCKED",
      errorCode: "MARKET_DATA_EXPIRED",
      errorMessage: `Market data snapshot for ${ticker} (${period}) is EXPIRED. Downstream valuation execution blocked.`
    };
  }

  return {
    status: record.freshness_status === "STALE_WARNING" ? "VALUATION_ALLOWED_WITH_WARNING" : "VALUATION_ALLOWED",
    snapshot: record
  };
}
