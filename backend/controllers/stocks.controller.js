import { resetInsightsForStock, resetAllJsonOutputs } from "../services/stocks.service.js";
import { fetchAndStorePrice } from "../services/price.service.js";
import { fetchAndStoreFinancials } from "../services/financials.service.js";
import { pool } from "../db/pool.js";
import { syncAnnouncementsForTicker } from "../services/announcement.service.js";

/**
 * POST /api/stocks/refresh-screener-data
 * Body: { stock_id: string, ticker: string, screener_slug?: string }
 * Runs live price fetch then Screener financials in one request (same work as two separate calls).
 */
export async function refreshScreenerDataHandler(req, res) {
  try {
    const { stock_id, ticker, screener_slug } = req.body ?? {};
    if (!stock_id || !ticker) {
      return res.status(400).json({
        ok: false,
        error: "stock_id and ticker are required",
      });
    }
    const t = String(ticker).trim().toUpperCase();
    const sid = String(stock_id);
    const slug = screener_slug ? String(screener_slug).trim() : t;

    const priceResult = await fetchAndStorePrice({ ticker: t, backfill: false });
    const financialsResult = await fetchAndStoreFinancials({
      stock_id: sid,
      ticker: t,
      screener_slug: slug,
    });

    const ok = Boolean(priceResult.success && financialsResult.success);
    return res.json({
      ok,
      price: priceResult,
      financials: financialsResult,
    });
  } catch (err) {
    console.error("refresh-screener-data error:", err);
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export async function resetInsightsHandler(req, res) {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing stock id" });
  }

  try {
    await resetInsightsForStock(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("reset-insights error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/** POST /api/stocks/reset-all-json - wipe quarterly AI outputs + promise ledger for all stocks. */
export async function resetAllJsonOutputsHandler(_req, res) {
  try {
    await resetAllJsonOutputs();
    res.json({ ok: true });
  } catch (err) {
    console.error("reset-all-json error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/**
 * POST /api/stocks/scan-announcements
 * Triggers the corporate announcement scanner.
 */
import { scan } from "../scripts/scan-announcements.js";
export async function scanAnnouncementsHandler(_req, res) {
  try {
    // Run scan in background to avoid Render/LoadBalancer timeouts (usually 30s)
    // The first run (30-day catch-up) can take minutes.
    scan().catch(err => console.error("Background scan error:", err));
    
    res.json({ 
      ok: true, 
      message: "Scan initiated in background. Check Telegram for alerts." 
    });
  } catch (err) {
    console.error("scan-announcements error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/**
 * POST /api/stocks
 * Creates a stock and triggers async sync for financials/prices
 */
export async function createStockHandler(req, res) {
  try {
    const { company_name, ticker, sector, category, buy_price, investment_thesis, screener_slug, bse_scrip_code, profileConfig } = req.body;
    
    if (!company_name || !ticker) {
      return res.status(400).json({ ok: false, error: "company_name and ticker are required" });
    }

    const client = await pool.connect();
    let insertedStock;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO stocks (company_name, ticker, sector, category, buy_price, investment_thesis, screener_slug, bse_scrip_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [company_name, ticker.toUpperCase(), sector || null, category || 'Watchlist', buy_price || null, investment_thesis || null, screener_slug || ticker.toUpperCase(), bse_scrip_code || null]
      );
      insertedStock = result.rows[0];

      if (profileConfig) {
        await client.query(
          `INSERT INTO stock_tracking_profiles (stock_id, config) VALUES ($1, $2)
             ON CONFLICT (stock_id) DO UPDATE SET config = EXCLUDED.config`,
          [insertedStock.id, profileConfig]
        );
        let trackingDirectives = null;
        if (typeof profileConfig.tracking_directives === 'string') trackingDirectives = profileConfig.tracking_directives;
        
        let metricKeys = null;
        if (profileConfig.metrics && Array.isArray(profileConfig.metrics)) {
          metricKeys = profileConfig.metrics.filter(m => m.key).map(m => m.key);
        }
        
        if (trackingDirectives || metricKeys) {
           await client.query(
             `UPDATE stocks SET tracking_directives = COALESCE($1, tracking_directives), metric_keys = COALESCE($2, metric_keys) WHERE id = $3`,
             [trackingDirectives, metricKeys ? JSON.stringify(metricKeys) : null, insertedStock.id]
           );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Async trigger: do not await this so the client gets an immediate response
    fetchAndStorePrice({ ticker: insertedStock.ticker, backfill: false }).catch(err => console.error('Price fetch failed:', err));
    fetchAndStoreFinancials({
      stock_id: insertedStock.id,
      ticker: insertedStock.ticker,
      screener_slug: insertedStock.screener_slug
    }).catch(err => console.error('Financial fetch failed:', err));

    return res.json({ ok: true, stock: insertedStock });
  } catch (err) {
    console.error("create-stock error:", err);
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/**
 * GET /api/stocks/:id/announcements
 * Fetches processed corporate announcements for a specific stock.
 */
export async function getAnnouncementsHandler(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ ok: false, error: "stock id is required" });
    }

    // First find the ticker to support old records or ticker-based lookup
    const stockRes = await pool.query("SELECT ticker FROM stocks WHERE id = $1", [id]);
    const ticker = stockRes.rows[0]?.ticker;

    // Deduplicate by title_hash and exclude XBRL filings unless they are results
    const result = await pool.query(
      `SELECT DISTINCT ON (title_hash) * 
       FROM corporate_announcements 
       WHERE (stock_id = $1 OR ticker = $2)
       AND (
         (title NOT ILIKE '%XBRL%' AND summary NOT ILIKE '%XBRL%')
         OR title ILIKE '%Results%'
         OR summary ILIKE '%Results%'
         OR is_earnings_release = true
       )
       ORDER BY title_hash, filing_date DESC 
       LIMIT 100`,
      [id, ticker]
    );

    // Re-sort by filing_date since DISTINCT ON requires sorting by the distinct column first
    const sorted = result.rows.sort((a, b) => 
      new Date(b.filing_date || b.processed_at).getTime() - 
      new Date(a.filing_date || a.processed_at).getTime()
    );

    return res.json({
      ok: true,
      announcements: sorted
    });
  } catch (err) {
    console.error("get-announcements error:", err);
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/**
 * POST /api/stocks/:id/refresh-announcements
 * Manually triggers a fresh sync of NSE/BSE announcements for the given stock.
 */
export async function refreshAnnouncementsHandler(req, res) {
  try {
    const { id } = req.params;
    
    // 1. Get ticker
    const stockRes = await pool.query("SELECT ticker FROM stocks WHERE id = $1", [id]);
    if (stockRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Stock not found" });
    }
    const { ticker } = stockRes.rows[0];

    // 2. Trigger Sync (Lookback 30 days for quick refresh)
    const results = await syncAnnouncementsForTicker(id, ticker, 30);

    return res.json({
      ok: true,
      message: `Sync completed for ${ticker}`,
      results
    });
  } catch (err) {
    console.error("Refresh announcements error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
