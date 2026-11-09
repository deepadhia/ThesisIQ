/**
 * Clean-up plan for the 2026-11-06 foreign-filing flood (pure; the script does the I/O).
 *
 * Ownership is VERIFIED, never guessed: a row is foreign only when its NSE document is missing from the NSE per-symbol list of that
 * very stock. A stock whose list could not be read is left alone and reported. What the foreign filings wrote is traced by text
 * (a commitment or snapshot whose text sits inside a foreign row of the SAME stock), so rows from real filings are never touched.
 */

const NSE_HOST = /^https:\/\/nsearchives\.nseindia\.com\/corporate\//i;
const isNseDocument = (url) => NSE_HOST.test(String(url || "")) && /\.[A-Za-z0-9]{2,5}$/.test(String(url).split("?")[0].split("/").pop() || "");
const MIN_TRACE_CHARS = 30;

const stringValues = (value) => typeof value === 'string' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(stringValues) : [];
const textOf = (row) => stringValues(row.event_analysis || {}).join(' ');
const traceable = (text) => String(text || "").trim().length >= MIN_TRACE_CHARS;
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * @param {{rows: object[], verifiedByTicker: Map<string, Set<string>>, commitments?: object[], snapshots?: object[]}} input
 *   rows: corporate_announcements rows created since the flood began (id, ticker, stock_id, attachment_url, deep_dive_status, event_analysis)
 *   verifiedByTicker: ticker -> attachment URLs NSE itself lists for that stock (an empty or missing set = not verifiable)
 */
export function planForeignCleanup({ rows = [], verifiedByTicker = new Map(), commitments = [], snapshots = [] } = {}) {
  const foreign = [];
  const allForeign = [];
  const legitimate = [];
  const unverifiable = [];
  for (const r of rows) {
    if (!isNseDocument(r.attachment_url)) continue;
    const own = verifiedByTicker.get(r.ticker);
    if (!own || own.size === 0) {
      if (!r.event_analysis?.foreign_filing) unverifiable.push(r);
      continue;
    }
    if (!own.has(r.attachment_url)) {
      allForeign.push(r);
      if (!r.event_analysis?.foreign_filing) foreign.push(r);
    } else {
      legitimate.push(r);
    }
  }

  // what the foreign rows of a stock wrote: traced by text, same stock only (includes rows already set aside)
  const textByStock = new Map();
  for (const r of allForeign) textByStock.set(r.stock_id, `${textByStock.get(r.stock_id) || ""} ${norm(textOf(r))}`);
  const tickerOfStock = new Map(allForeign.map((r) => [r.stock_id, r.ticker]));
  const textByTicker = new Map();
  for (const r of allForeign) textByTicker.set(r.ticker, `${textByTicker.get(r.ticker) || ""} ${norm(textOf(r))}`);
  const ownByTicker = new Map();
  const ownByStock = new Map();
  for (const r of legitimate) {
    ownByTicker.set(r.ticker, `${ownByTicker.get(r.ticker) || ''} ${norm(textOf(r))}`);
    ownByStock.set(r.stock_id, `${ownByStock.get(r.stock_id) || ''} ${norm(textOf(r))}`);
  }

  const inForeignText = (haystack, needle) => traceable(needle) && haystack && haystack.includes(norm(needle));
  const tracedCommitments = commitments.filter((c) =>
    (inForeignText(textByTicker.get(c.ticker), c.statement) || inForeignText(textByTicker.get(c.ticker), c.evidence_summary)) &&
    !inForeignText(ownByTicker.get(c.ticker), c.statement) && !inForeignText(ownByTicker.get(c.ticker), c.evidence_summary));
  const tracedSnapshots = snapshots.filter((s) => {
    const hay = textByStock.get(s.stock_id);
    // a snapshot summary is long: its first 60 characters identify the source
    const prefix = norm(s.summary).slice(0, 60);
    return hay && traceable(s.summary) && hay.includes(prefix) && !ownByStock.get(s.stock_id)?.includes(prefix);
  });

  const alerted = (r) => Boolean(r.event_analysis?.alert_sent_at || r.event_analysis?.digest_sent_at);
  return {
    foreign,
    unverifiable,
    commitments: tracedCommitments,
    snapshots: tracedSnapshots,
    summary: {
      foreign: foreign.length,
      alreadyAlerted: foreign.filter(alerted).length,
      stillQueued: foreign.filter((r) => /^pending_/.test(r.deep_dive_status || "")).length,
      unverifiable: unverifiable.length,
      commitments: tracedCommitments.length,
      snapshots: tracedSnapshots.length,
      tickers: [...new Set(foreign.map((r) => r.ticker))].sort(),
      stocksTouched: tickerOfStock.size
    }
  };
}
