/**
 * Indian Stock Market (NSE / BSE) Holiday Calendar Service
 * 
 * Accurately tracks official exchange holidays and prevents executing
 * market-hours watchdogs, price syncs, or valuation alerts on market holidays.
 */

export const NSE_BSE_HOLIDAYS = {
  // ── 2024 Holidays ──────────────────────────────────────────────────────────
  "2024-01-22": "Special Ram Mandir Consecration Holiday",
  "2024-01-26": "Republic Day",
  "2024-03-08": "Maha Shivratri",
  "2024-03-25": "Holi",
  "2024-03-29": "Good Friday",
  "2024-04-11": "Id-Ul-Fitr (Ramzan Id)",
  "2024-04-17": "Shri Ram Navami",
  "2024-05-01": "Maharashtra Day",
  "2024-05-20": "General Parliamentary Elections (Mumbai)",
  "2024-06-17": "Bakri Id (Id-Ul-Adha)",
  "2024-07-17": "Muharram",
  "2024-08-15": "Independence Day",
  "2024-10-02": "Mahatma Gandhi Jayanti",
  "2024-11-01": "Diwali Laxmi Pujan (Normal Trading Closed)",
  "2024-11-15": "Guru Nanak Jayanti",
  "2024-11-20": "Maharashtra Assembly Elections",
  "2024-12-25": "Christmas",

  // ── 2025 Holidays ──────────────────────────────────────────────────────────
  "2025-01-26": "Republic Day",
  "2025-02-26": "Maha Shivratri",
  "2025-03-14": "Holi",
  "2025-03-31": "Id-Ul-Fitr",
  "2025-04-10": "Mahavir Jayanti",
  "2025-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
  "2025-04-18": "Good Friday",
  "2025-05-01": "Maharashtra Day",
  "2025-06-07": "Bakri Id",
  "2025-07-06": "Muharram",
  "2025-08-15": "Independence Day",
  "2025-08-27": "Ganesh Chaturthi",
  "2025-10-02": "Mahatma Gandhi Jayanti / Dussehra",
  "2025-10-21": "Diwali Laxmi Pujan (Normal Trading Closed)",
  "2025-10-22": "Diwali Balipratipada",
  "2025-11-05": "Guru Nanak Jayanti",
  "2025-12-25": "Christmas",

  // ── 2026 Holidays ──────────────────────────────────────────────────────────
  "2026-01-26": "Republic Day",
  "2026-02-15": "Maha Shivratri",
  "2026-03-03": "Holi",
  "2026-03-20": "Id-Ul-Fitr (Ramzan Id)",
  "2026-03-31": "Shri Ram Navami",
  "2026-04-03": "Good Friday",
  "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
  "2026-05-01": "Maharashtra Day",
  "2026-05-27": "Bakri Id (Id-Ul-Adha)",
  "2026-06-25": "Muharram",
  "2026-08-15": "Independence Day",
  "2026-09-14": "Ganesh Chaturthi",
  "2026-10-02": "Mahatma Gandhi Jayanti",
  "2026-10-20": "Dussehra",
  "2026-11-08": "Diwali Laxmi Pujan (Normal Trading Closed)",
  "2026-11-10": "Diwali Balipratipada",
  "2026-11-24": "Guru Nanak Jayanti",
  "2026-12-25": "Christmas",

  // ── 2027 Holidays ──────────────────────────────────────────────────────────
  "2027-01-26": "Republic Day",
  "2027-03-05": "Maha Shivratri",
  "2027-03-23": "Holi",
  "2027-03-26": "Good Friday",
  "2027-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
  "2027-04-19": "Shri Ram Navami",
  "2027-05-01": "Maharashtra Day",
  "2027-08-15": "Independence Day",
  "2027-10-02": "Mahatma Gandhi Jayanti",
  "2027-10-19": "Dussehra",
  "2027-11-08": "Diwali Laxmi Pujan",
  "2027-11-23": "Guru Nanak Jayanti",
  "2027-12-25": "Christmas"
};

// ── In-Memory Active Cache & Metadata ─────────────────────────────────────────
let activeHolidaysCache = { ...NSE_BSE_HOLIDAYS };
let lastSyncTimestamp = null;
let activeSource = 'STATIC_BASELINE';

const NSE_MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

/**
 * Parses NSE date string (e.g. "15-Jan-2026", "02-Oct-2026") to "YYYY-MM-DD".
 * @param {string} dateStr
 * @returns {string|null}
 */
export function parseNseTradingDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return null;
  const day = parts[0].padStart(2, '0');
  const month = NSE_MONTH_MAP[parts[1].toLowerCase()];
  const year = parts[2];
  if (!month || !year || !day || isNaN(Number(day)) || isNaN(Number(year))) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Normalizes any date to YYYY-MM-DD format in Asia/Kolkata timezone.
 * @param {Date|string|number} [date]
 * @returns {string} e.g. "2026-10-02"
 */
export function getIstDateYmd(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

export function isWeekend(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(d);
  return weekday === "Sat" || weekday === "Sun";
}

/**
 * Checks if a given date is an official NSE/BSE holiday.
 * @param {Date|string|number} [date]
 * @returns {{ isHoliday: boolean, holidayName: string|null, dateYmd: string, source: string }}
 */
export function getMarketHolidayDetails(date = new Date()) {
  const ymd = getIstDateYmd(date);
  const holidayName = activeHolidaysCache[ymd];
  return {
    isHoliday: Boolean(holidayName),
    holidayName: holidayName || null,
    dateYmd: ymd,
    source: activeSource
  };
}

/**
 * Checks if the Indian stock market (NSE/BSE) is officially OPEN on a given date:
 * Returns true only if it is NOT a weekend AND NOT an exchange holiday.
 * @param {Date|string|number} [date]
 * @returns {boolean}
 */
export function isMarketOpenDay(date = new Date()) {
  if (isWeekend(date)) return false;
  const { isHoliday } = getMarketHolidayDetails(date);
  return !isHoliday;
}

/**
 * Returns a copy of the current active holidays dictionary.
 */
export function getMarketHolidaysMap() {
  return { ...activeHolidaysCache };
}

/**
 * Fetches live trading holidays directly from official NSE API.
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, string>>}
 */
export async function fetchLiveNseTradingHolidays({ timeoutMs = 8000 } = {}) {
  const url = 'https://www.nseindia.com/api/holiday-master?type=trading';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/'
  };

  const reqInit = { headers };
  let timeoutId = null;

  if (!process.env.VITEST && typeof AbortController !== 'undefined') {
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      reqInit.signal = controller.signal;
    } catch {
      // Ignore if cross-realm environment
    }
  }

  try {
    const res = await fetch(url, reqInit);
    if (!res.ok) {
      throw new Error(`NSE holiday API returned status ${res.status}`);
    }
    const data = await res.json();
    const cm = data.CM;
    if (!Array.isArray(cm) || cm.length === 0) {
      throw new Error('NSE holiday API returned empty or invalid CM array');
    }

    const holidays = {};
    for (const item of cm) {
      const ymd = parseNseTradingDate(item.tradingDate);
      if (ymd) {
        // Strip trailing asterisk if present (e.g. Diwali Laxmi Pujan*)
        const cleanDesc = (item.description || 'Market Holiday').replace(/\*+$/, '').trim();
        holidays[ymd] = cleanDesc;
      }
    }
    return holidays;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Loads dynamic market holidays from PostgreSQL system_settings table into memory.
 * @param {import('pg').Pool} pool
 */
export async function loadDynamicMarketHolidays(pool) {
  if (!pool) return { count: Object.keys(activeHolidaysCache).length, source: activeSource };

  try {
    const res = await pool.query(
      "SELECT value, updated_at FROM system_settings WHERE key = 'dynamic_market_holidays' LIMIT 1"
    );
    if (res.rows.length > 0 && res.rows[0].value) {
      const parsed = typeof res.rows[0].value === 'string' ? JSON.parse(res.rows[0].value) : res.rows[0].value;
      if (parsed && typeof parsed.holidays === 'object') {
        activeHolidaysCache = {
          ...NSE_BSE_HOLIDAYS,
          ...parsed.holidays
        };
        lastSyncTimestamp = parsed.last_synced_at || res.rows[0].updated_at;
        activeSource = parsed.source || 'DATABASE_CACHE';
        return {
          loaded: true,
          count: Object.keys(activeHolidaysCache).length,
          lastSyncTimestamp,
          source: activeSource
        };
      }
    }
  } catch (err) {
    console.warn(`[WARN] Failed to load dynamic holidays from database: ${err.message}`);
  }

  return {
    loaded: false,
    count: Object.keys(activeHolidaysCache).length,
    source: activeSource
  };
}

/**
 * Synchronizes market holidays dynamically:
 * 1. Attempts live fetch from official NSE API.
 * 2. Merges with baseline and updates in-memory cache.
 * 3. Persists to PostgreSQL system_settings table if pool provided.
 * 4. Falls back gracefully to database cache or static calendar if live fetch fails.
 * 
 * @param {import('pg').Pool} [pool]
 * @param {{ forceLive?: boolean }} [options]
 * @returns {Promise<{ success: boolean, count: number, source: string, error?: string, fallback?: boolean }>}
 */
export async function syncDynamicMarketHolidays(pool, { forceLive = false } = {}) {
  let liveHolidays = null;
  let fetchError = null;

  try {
    liveHolidays = await fetchLiveNseTradingHolidays();
  } catch (err) {
    fetchError = err.message;
    console.warn(`[WARN] Live NSE holiday fetch failed (${err.message}) — preserving existing cached/static holidays.`);
  }

  if (liveHolidays && Object.keys(liveHolidays).length > 0) {
    activeHolidaysCache = {
      ...NSE_BSE_HOLIDAYS,
      ...liveHolidays
    };
    lastSyncTimestamp = new Date().toISOString();
    activeSource = 'NSE_LIVE';

    if (pool) {
      try {
        const payload = JSON.stringify({
          holidays: liveHolidays,
          last_synced_at: lastSyncTimestamp,
          source: 'NSE_LIVE',
          count: Object.keys(activeHolidaysCache).length
        });

        await pool.query(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES ('dynamic_market_holidays', $1, NOW())
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = NOW();
        `, [payload]);
      } catch (dbErr) {
        console.warn(`[WARN] Failed to persist dynamic holidays to database: ${dbErr.message}`);
      }
    }

    return {
      success: true,
      count: Object.keys(activeHolidaysCache).length,
      source: 'NSE_LIVE',
      liveCount: Object.keys(liveHolidays).length
    };
  }

  // Fallback: If live fetch failed, ensure DB cache is loaded into memory
  if (pool) {
    await loadDynamicMarketHolidays(pool);
  }

  return {
    success: false,
    fallback: true,
    error: fetchError,
    count: Object.keys(activeHolidaysCache).length,
    source: activeSource
  };
}
