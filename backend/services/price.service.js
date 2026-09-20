import { pool } from "../db/pool.js";

/**
 * Fetch current quote from Yahoo Finance (same logic as Supabase fetch-price).
 * @param {string} symbol - e.g. "RELIANCE.NS" or "RELIANCE"
 * @returns {Promise<{ symbol: string; price: number; volume: number|null; change_percent: number|null; date: string }|null>}
 */
export async function fetchYahooQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) return null;

    let changePercent = null;
    const closes = result?.indicators?.quote?.[0]?.close;
    const timestamps = result?.timestamp;
    if (closes && timestamps && closes.length >= 2) {
      const validCloses = [];
      for (let i = closes.length - 1; i >= 0 && validCloses.length < 2; i--) {
        const c = Number(closes[i]);
        if (Number.isFinite(c) && c > 0) validCloses.push(c);
      }
      if (validCloses.length === 2) {
        changePercent = ((price - validCloses[1]) / validCloses[1]) * 100;
      }
    }
    if (changePercent === null) {
      const prev = Number(meta?.previousClose ?? meta?.chartPreviousClose);
      if (Number.isFinite(prev) && prev > 0) changePercent = ((price - prev) / prev) * 100;
    }

    const formatDate = (epochSeconds) => {
      if (!epochSeconds) return new Date().toISOString().slice(0, 10);
      return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
    };

    return {
      symbol,
      price,
      volume: Number.isFinite(meta?.regularMarketVolume) ? Number(meta.regularMarketVolume) : null,
      change_percent: changePercent != null ? Math.round(changePercent * 100) / 100 : null,
      date: formatDate(Number(meta?.regularMarketTime)),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch 3Y historical daily prices from Yahoo.
 */
export async function fetchYahooHistorical(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3y`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!response.ok) return [];

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    const volumes = result?.indicators?.quote?.[0]?.volume;
    if (!timestamps || !closes) return [];

    const formatDate = (epochSeconds) =>
      new Date(epochSeconds * 1000).toISOString().slice(0, 10);

    const prices = [];
    for (let i = 0; i < timestamps.length; i++) {
      const price = Number(closes[i]);
      if (!Number.isFinite(price) || price <= 0) continue;
      prices.push({
        date: formatDate(timestamps[i]),
        price,
        volume: Number.isFinite(volumes?.[i]) ? Number(volumes[i]) : null,
      });
    }
    return prices;
  } catch {
    return [];
  }
}

/** Discover NSE ticker from Screener company page. */
async function discoverFromScreener(slugOrTicker) {
  try {
    const url = `https://www.screener.in/company/${encodeURIComponent(slugOrTicker)}/`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return null;
    const html = await response.text();
    const nseMatch = html.match(/NSE\s*:\s*(?:<[^>]*>)?\s*([A-Z0-9\-]+)/i);
    return nseMatch?.[1]?.trim().toUpperCase() ?? null;
  } catch {
    return null;
  }
}

/** Fetch current quote directly from Screener.in page. */
export async function fetchScreenerLiveQuote(slugOrTicker) {
  try {
    const slug = encodeURIComponent(slugOrTicker);
    let response = await fetch(`https://www.screener.in/company/${slug}/consolidated/`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (!response.ok) {
      response = await fetch(`https://www.screener.in/company/${slug}/`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
    }
    if (!response.ok) return null;

    const html = await response.text();
    const priceMatch = html.match(/Current Price[\s\S]*?class="number">₹?\s*([0-9,.]+)/i);
    if (!priceMatch) return null;

    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
      symbol: slugOrTicker,
      price,
      volume: null,
      change_percent: null,
      date: new Date().toISOString().slice(0, 10),
      source: "Screener.in"
    };
  } catch {
    return null;
  }
}

/** Build list of Yahoo symbol candidates to try (.NS, .BO, raw). */
export async function resolveYahooCandidates(normalizedTicker, screenerSlug) {
  const baseSymbols = new Set([normalizedTicker]);
  if (screenerSlug && screenerSlug !== normalizedTicker) baseSymbols.add(screenerSlug);
  for (const slug of [screenerSlug, normalizedTicker].filter(Boolean)) {
    const nse = await discoverFromScreener(slug);
    if (nse) baseSymbols.add(nse);
  }
  const candidates = [];
  for (const sym of baseSymbols) {
    candidates.push(`${sym}.NS`, `${sym}.BO`, sym);
  }
  return [...new Set(candidates)];
}

/**
 * Fetch current price for a ticker, resolve stock_id from DB, write to prices table.
 * @param {Object} opts
 * @param {string} opts.ticker - NSE ticker (e.g. RELIANCE)
 * @param {boolean} [opts.backfill] - if true, fetch 3Y history and insert missing dates
 * @returns {Promise<{ success: boolean; price?: number; volume?: number; change_percent?: number; date?: string; error?: string; message?: string; inserted?: number }>}
 */
export async function fetchAndStorePrice({ ticker, backfill = false }) {
  const normalizedTicker = String(ticker).trim().toUpperCase();
  if (!normalizedTicker) {
    return { success: false, error: "Ticker is required" };
  }

  const stockRow = await pool.query(
    "SELECT id, screener_slug FROM stocks WHERE UPPER(TRIM(ticker)) = $1",
    [normalizedTicker],
  );
  const stockId = stockRow.rows[0]?.id ?? null;
  const screenerSlug = stockRow.rows[0]?.screener_slug
    ? String(stockRow.rows[0].screener_slug).trim().toUpperCase()
    : null;

  const candidates = await resolveYahooCandidates(normalizedTicker, screenerSlug);

  if (backfill && stockId) {
    let historicalPrices = [];
    let resolvedSymbol = "";
    for (const symbol of candidates) {
      historicalPrices = await fetchYahooHistorical(symbol);
      if (historicalPrices.length > 0) {
        resolvedSymbol = symbol;
        break;
      }
    }
    if (historicalPrices.length === 0) {
      return { success: false, error: `No historical data for ${normalizedTicker}` };
    }

    const existing = await pool.query(
      "SELECT date FROM prices WHERE stock_id = $1",
      [stockId],
    );
    const existingDates = new Set(existing.rows.map((r) => r.date));

    const toInsert = historicalPrices
      .filter((p) => !existingDates.has(p.date))
      .map((p) => ({
        stock_id: stockId,
        price: p.price,
        volume: p.volume,
        date: p.date,
        change_percent: null,
      }));

    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += 100) {
        const batch = toInsert.slice(i, i + 100);
        const values = batch.flatMap((r) => [stockId, r.price, r.volume, r.change_percent, r.date]);
        const placeholders = batch
          .map((_, idx) => `($${idx * 5 + 1},$${idx * 5 + 2},$${idx * 5 + 3},$${idx * 5 + 4},$${idx * 5 + 5})`)
          .join(",");
        await pool.query(
          `INSERT INTO prices (stock_id, price, volume, change_percent, date) VALUES ${placeholders}`,
          values,
        );
      }
    }

    return {
      success: true,
      symbol: resolvedSymbol,
      inserted: toInsert.length,
      total_fetched: historicalPrices.length,
      skipped_duplicates: historicalPrices.length - toInsert.length,
    };
  }

  // Single current quote
  let result = null;
  for (const symbol of candidates) {
    result = await fetchYahooQuote(symbol);
    if (result) break;
  }

  // Fallback to Screener.in live quote if Yahoo fails
  if (!result) {
    result = await fetchScreenerLiveQuote(screenerSlug || normalizedTicker);
    if (!result && screenerSlug && screenerSlug !== normalizedTicker) {
      result = await fetchScreenerLiveQuote(normalizedTicker);
    }
  }

  if (!result) {
    if (stockId) {
      const last = await pool.query(
        `SELECT price, volume, change_percent, date FROM prices WHERE stock_id = $1 ORDER BY date DESC LIMIT 1`,
        [stockId],
      );
      const row = last.rows[0];
      if (row) {
        return {
          success: true,
          stale: true,
          symbol: normalizedTicker,
          price: Number(row.price),
          volume: row.volume != null ? Number(row.volume) : null,
          change_percent: row.change_percent != null ? Number(row.change_percent) : null,
          date: row.date,
          message: "Live quote unavailable. Returned latest stored price.",
        };
      }
    }
    return {
      success: false,
      error: `Could not fetch live quote for ${normalizedTicker}`,
      tried_symbols: candidates,
    };
  }

  if (stockId) {
    const existing = await pool.query(
      "SELECT id FROM prices WHERE stock_id = $1 AND date = $2",
      [stockId, result.date],
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE prices SET price = $1, volume = $2, change_percent = $3 WHERE id = $4`,
        [result.price, result.volume, result.change_percent, existing.rows[0].id],
      );
    } else {
      await pool.query(
        `INSERT INTO prices (stock_id, price, volume, change_percent, date) VALUES ($1, $2, $3, $4, $5)`,
        [stockId, result.price, result.volume, result.change_percent, result.date],
      );
    }
  }

  return {
    success: true,
    symbol: result.symbol,
    price: result.price,
    volume: result.volume,
    change_percent: result.change_percent,
    date: result.date,
  };
}
