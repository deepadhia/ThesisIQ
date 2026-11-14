/** Exchange filing discovery only. Parsing and metric authorization happen downstream. */
const API_URL = 'https://www.nseindia.com/api/integrated-filing-results';
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function exchangeDate(value, withTime = false) {
  const match = String(value ?? '').trim().match(withTime
    ? /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
    : /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;
  const [, day, mon, year, hour = '0', minute = '0', second = '0'] = match;
  const month = MONTHS[mon.toUpperCase()];
  if (month === undefined) return null;
  const utc = Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second));
  const date = new Date(utc);
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== month || date.getUTCDate() !== Number(day)) return null;
  return withTime ? new Date(utc - 330 * 60_000).toISOString() : date.toISOString().slice(0, 10);
}

function officialUrl(value, path, extension) {
  try {
    const url = new URL(value);
    const prefix = path ? `/corporate/${path}/` : '/corporate/';
    if (url.protocol !== 'https:' || url.hostname !== 'nsearchives.nseindia.com' ||
        !url.pathname.startsWith(prefix) || !url.pathname.toLowerCase().endsWith(extension) ||
        url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeIntegratedFiling(row) {
  if (!row || row.type !== 'Integrated Filing- Financials') return null;
  const basis = String(row.consolidated ?? '').toLowerCase();
  if (!['consolidated', 'standalone'].includes(basis)) return null;
  const periodEnd = exchangeDate(row.qe_Date);
  const broadcastAt = exchangeDate(row.broadcast_Date, true);
  const xbrlUrl = officialUrl(row.xbrl, 'xbrl', '.xml');
  if (!periodEnd || !broadcastAt || !xbrlUrl || !/^[A-Z0-9&.-]+$/.test(row.symbol ?? '')) return null;
  return {
    symbol: row.symbol, periodEnd, basis, broadcastAt,
    sequenceId: String(row.seq_Id ?? ''), revision: String(row.type_Sub ?? ''),
    xbrlUrl, ixbrlUrl: officialUrl(row.ixbrl, 'ixbrl', '.html'),
    pdfUrl: officialUrl(row.pdf_attach, '', '.pdf'),
    source: 'NSE integrated-filing-results',
  };
}

export function selectCurrentFilings(rows, { symbol, periodEnd }) {
  if (!symbol || (periodEnd != null && !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd))) throw new Error('Symbol and valid period end are required');
  if (!Array.isArray(rows)) throw new Error('NSE integrated filing response is not a list');
  return rows.map(normalizeIntegratedFiling).filter(row => row?.symbol === symbol && (periodEnd == null || row.periodEnd === periodEnd));
}

export function checkLegacyResultFreshness(legacyRows, officialFilings) {
  const legacyPeriodEnd = (legacyRows ?? []).map(row => row.period_end_date).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')).sort().at(-1) ?? null;
  const officialPeriodEnd = (officialFilings ?? []).map(row => row.periodEnd).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')).sort().at(-1) ?? null;
  return { fresh: Boolean(legacyPeriodEnd && officialPeriodEnd && legacyPeriodEnd >= officialPeriodEnd), legacyPeriodEnd, officialPeriodEnd };
}

export async function discoverNseIntegratedFilings({ symbol, periodEnd, fetcher = fetch }) {
  if (!/^[A-Z0-9&.-]+$/.test(symbol ?? '') || (periodEnd != null && !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd))) {
    throw new Error('Valid NSE symbol and period end are required');
  }
  const url = new URL(API_URL);
  for (const [key, value] of Object.entries({ index: 'equities', type: 'Integrated Filing- Financials', symbol, page: '1', size: '100' })) {
    url.searchParams.set(key, value);
  }
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    url.searchParams.set('page', String(page));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response;
    try {
      response = await fetcher(url, { headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        Accept: 'application/json', Referer: 'https://www.nseindia.com/companies-listing/corporate-integrated-filing',
      }, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`NSE integrated filing API returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.data) || !Number.isSafeInteger(Number(payload.totalCount))) {
      throw new Error('NSE integrated filing API returned an invalid payload');
    }
    rows.push(...payload.data);
    if (rows.length >= Number(payload.totalCount)) return selectCurrentFilings(rows, { symbol, periodEnd });
    if (!payload.data.length) throw new Error('NSE integrated filing pagination stopped before totalCount');
  }
  throw new Error('NSE integrated filing pagination exceeded 20 pages');
}
