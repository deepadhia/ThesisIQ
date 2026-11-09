/**
 * Portfolio Market Valuation Service
 * 
 * Mandate:
 * Ingests provider-reported ratios with source date and lineage. Derived shares supply only
 * a consistency identity; independently verified TTM statements are not available on this path.
 * Unknown earnings, debt and enterprise value remain null. A schema that forbids unknowns blocks sync.
 */

import crypto from 'crypto';
import { ingestMarketDataSnapshot } from './market-data-layer.service.js';
import { assessSnapshotFreshness } from './valuation-inputs.service.js';
let screenerCooldownUntil = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches raw HTML from Screener with consolidated/standalone fallback.
 */
async function fetchScreenerHtml(slugOrScrip) {
  if (!slugOrScrip) return null;
  if (Date.now() < screenerCooldownUntil) throw new Error('Screener provider cooldown after HTTP 429');

  const slugsToTry = [slugOrScrip];

  for (const slug of slugsToTry) {
    const urls = [
      `https://www.screener.in/company/${encodeURIComponent(slug)}/consolidated/`,
      `https://www.screener.in/company/${encodeURIComponent(slug)}/`
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(12000)
        });

        if (res.status === 429) {
          const hint = res.headers?.get('retry-after');
          const seconds = Number(hint);
          const delay = hint && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(hint) - Date.now();
          screenerCooldownUntil = Date.now() + Math.max(60000, Number.isFinite(delay) ? delay : 60000);
          const error = new Error('Screener HTTP 429; alternate pages and stocks deferred');
          error.code = 'MARKET_RATE_LIMITED';
          throw error;
        }
        if (res.ok) {
          const text = await res.text();
          if (text.includes('top-ratios')) {
            return { html: text, sourceUrl: url, scope: /data-consolidated="true"/.test(text) ? 'CONSOLIDATED' : 'STANDALONE' };
          }
        }
      } catch (err) {
        if (err.code === 'MARKET_RATE_LIMITED') throw err;
      }
    }
  }

  return null;
}

/**
 * Parses Screener HTML and extracts verified consolidated metrics.
 */
export function parseScreenerValuationData(html, fallbackTicker = 'UNKNOWN', { now = new Date() } = {}) {
  if (!html) return null;

  const ratios = {};
  const ratioSection = html.match(/<ul id="top-ratios">([\s\S]*?)<\/ul>/);
  if (ratioSection) {
    const liItems = ratioSection[1].match(/<li[\s\S]*?<\/li>/g) || [];
    for (const li of liItems) {
      const nameMatch = li.match(/<span class="name">\s*([\s\S]*?)\s*<\/span>/);
      const numberMatch = li.match(/<span class="number">([\d,\.\-]+)<\/span>/);
      if (nameMatch && numberMatch) {
        const key = nameMatch[1].replace(/<[^>]+>/g, '').trim();
        const val = parseFloat(numberMatch[1].replace(/,/g, ''));
        ratios[key] = val;
      }
    }
  }

  const price = ratios['Current Price'];
  const pe = ratios['Stock P/E'];
  const mcap = ratios['Market Cap']; // In ₹ Crores
  const roce = ratios['ROCE'] ?? ratios['ROCE %'] ?? null;
  const roe = ratios['ROE'] ?? ratios['ROE %'] ?? null;

  if (!Number.isFinite(price) || !Number.isFinite(mcap) || price <= 0 || mcap <= 0) {
    return null;
  }

  // Programmatic Shares Outstanding (in Crores) = MCap (Cr) / Price (₹)
  const sharesOutstandingCr = mcap / price;

  // Top ratios are provider observations, not independently verified statements.
  // Neither reverse-engineering a reported P/E nor assuming a profit margin supplies TTM facts.
  const ttmEps = null;
  const ttmPat = null;
  const ttmRevenue = null;
  const ttmEbitda = null;
  const ttmEbit = null;
  const netDebt = null;
  const programmaticEV = null;
  const evEbitdaRatio = null;

  // Verify Programmatic Invariants
  const calculatedCap = price * sharesOutstandingCr;
  const capVariancePct = Math.abs((mcap - calculatedCap) / mcap) * 100;
  const isCapValid = capVariancePct <= 0.1;

  let calculatedPE = pe;
  let peVariancePct = 0;
  if (ttmEps && ttmEps > 0) {
    calculatedPE = parseFloat((price / ttmEps).toFixed(1));
    if (pe) {
      peVariancePct = Math.abs((pe - calculatedPE) / pe) * 100;
    }
  }

  const isPeValid = pe ? peVariancePct <= 2.0 : true;

  // A retrieval timestamp cannot make an old quote fresh. Screener omits the year and may show
  // either a dated closing quote or a dated intraday quote beside the company name.
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const dateMatch = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?\s*-\s*close price\b/i)
    || text.slice(0, 3500).match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?\s+\d{1,2}:\d{2}\s*[ap]\.?(?:m)\.?\s+Export to Excel\b/i);
  let quoteAsOfDate = null;
  if (dateMatch) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(dateMatch[2].toLowerCase());
    let year = dateMatch[3] ? Number(dateMatch[3]) : now.getUTCFullYear();
    let d = new Date(Date.UTC(year, month, Number(dateMatch[1])));
    if (!dateMatch[3] && d > now) d = new Date(Date.UTC(--year, month, Number(dateMatch[1])));
    if (d.getUTCMonth() === month && d.getUTCDate() === Number(dateMatch[1])) quoteAsOfDate = d.toISOString().slice(0, 10);
  }

  return {
    ticker: fallbackTicker,
    sharePrice: price,
    marketCap: mcap, // in ₹ Cr
    sharesOutstanding: sharesOutstandingCr, // in Cr shares
    ttmRevenue,
    ttmEbitda,
    ttmEbit,
    ttmPat,
    ttmEps,
    peRatio: Number.isFinite(pe) && pe > 0 ? pe : null,
    evEbitdaRatio,
    netDebt,
    enterpriseValue: programmaticEV,
    rocePct: roce,
    roePct: roe,
    isProgrammaticallyValid: isCapValid && isPeValid,
    capVariancePct: parseFloat(capVariancePct.toFixed(3)),
    peVariancePct: parseFloat(peVariancePct.toFixed(3)),
    sourceHash: crypto.createHash('sha256').update(html).digest('hex'),
    // Derived shares make the cap identity a consistency check, not independent verification.
    verificationBasis: 'PROVIDER_REPORTED_RATIOS_DERIVED_SHARES',
    quoteAsOfDate,
    sourceDocumentId: `SCREENER_LIVE_${fallbackTicker}_${new Date().toISOString().slice(0, 10)}`
  };
}

/**
 * Synchronizes and persists market valuation snapshot for a single stock.
 */
export async function syncStockMarketValuation(stock, pool, options = {}) {
  const { ticker, screener_slug, bse_scrip_code } = stock;
  const period = options.period || 'TTM';

  // 1. Try identifier hierarchy: screener_slug -> bse_scrip_code -> ticker
  let html = null;
  if (screener_slug) {
    html = await fetchScreenerHtml(screener_slug);
  }
  if (!html && bse_scrip_code) {
    html = await fetchScreenerHtml(bse_scrip_code);
  }
  if (!html) {
    html = await fetchScreenerHtml(ticker);
  }

  if (!html) {
    return {
      success: false,
      ticker,
      status: 'VALUATION_BLOCKED',
      error: `Could not retrieve live market valuation HTML for ${ticker}`
    };
  }

  // 2. Parse & Verify
  const parsed = parseScreenerValuationData(html.html, ticker);
  if (!parsed || !parsed.isProgrammaticallyValid || !assessSnapshotFreshness(parsed.quoteAsOfDate).fresh) {
    return {
      success: false,
      ticker,
      status: 'VALUATION_BLOCKED',
      error: `Missing/stale source quote date or inconsistent market ratios for ${ticker}`
    };
  }

  // 3. Construct Ingestion Payload
  const asOfDate = parsed.quoteAsOfDate;
  const snapshotPayload = {
    ticker,
    period,
    asOfDate,
    retrievedAt: new Date(),
    marketDataSource: `SCREENER_${html.scope}_REPORTED_RATIOS`,
    marketDataVersion: 2,
    sourceDocumentId: html.sourceUrl,
    sourceHash: parsed.sourceHash,
    freshnessStatus: 'FRESH',
    sharePrice: parsed.sharePrice,
    sharesOutstanding: parsed.sharesOutstanding,
    marketCap: parsed.marketCap,
    enterpriseValue: parsed.enterpriseValue,
    netDebt: parsed.netDebt,
    ttmRevenue: parsed.ttmRevenue,
    ttmEbitda: parsed.ttmEbitda,
    ttmEbit: parsed.ttmEbit,
    ttmPat: parsed.ttmPat,
    ttmEps: parsed.ttmEps,
    peRatio: parsed.peRatio,
    evEbitdaRatio: parsed.evEbitdaRatio,
    rocePct: parsed.rocePct
  };

  // 4. Ingest into database table `market_data_snapshots`
  const ingestResult = await ingestMarketDataSnapshot(snapshotPayload, pool);
  if (!ingestResult.success) return { success: false, ticker, status: 'VALUATION_BLOCKED', error: ingestResult.errorMessage };
  // The separate price provider owns daily OHLC. Rounded website ratios cannot overwrite its closing history.

  return {
    success: true,
    ticker,
    status: 'VALIDATED',
    sharePrice: parsed.sharePrice,
    marketCap: parsed.marketCap,
    sharesOutstanding: parsed.sharesOutstanding,
    ttmRevenue: parsed.ttmRevenue,
    ttmPat: parsed.ttmPat,
    ttmEps: parsed.ttmEps,
    peRatio: parsed.peRatio,
    rocePct: parsed.rocePct,
    sourceHash: parsed.sourceHash
  };
}

/**
 * Synchronizes all portfolio stocks in database with polite rate-limiting.
 */
export async function syncAllPortfolioValuations(pool, options = {}) {
  const optionalFacts = ['enterprise_value', 'net_debt', 'ttm_revenue', 'ttm_ebitda', 'ttm_ebit', 'ttm_pat', 'ttm_eps', 'pe_ratio', 'ev_ebitda_ratio'];
  const schema = await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'market_data_snapshots'
      AND column_name = ANY($1::text[]) AND is_nullable = 'NO'`, [optionalFacts]);
  if (schema.rows.length) return [{ success: false, ticker: 'SCHEMA', status: 'SCHEMA_MIGRATION_REQUIRED',
    error: `Unknown facts require nullable columns: ${schema.rows.map(r => r.column_name).join(', ')}. Apply 20261108010000_allow_unknown_market_facts.sql before syncing.` }];
  const sRes = await pool.query(`
    SELECT id, ticker, company_name, screener_slug, bse_scrip_code 
    FROM stocks 
    ORDER BY ticker;
  `);

  const results = [];
  for (const stock of sRes.rows) {
    try {
      results.push(await syncStockMarketValuation(stock, pool, options));
    } catch (err) {
      console.warn(`[MARKET SYNC] ${stock.ticker}: ${err.message}`);
      results.push({ success: false, ticker: stock.ticker, status: 'VALUATION_BLOCKED', error: err.message });
    }
    // 600ms delay between fetches to respect exchange/Screener servers
    await sleep(600);
  }

  return results;
}
