/**
 * Foreign-filing guard.
 *
 * One exchange document belongs to ONE company. When the same attachment is saved under three or more tracked tickers, the feed
 * answered for the wrong company (NSE's NextApi ignored the `symbol` parameter on 2026-11-06: 522 foreign rows, 110 analysed and 148
 * alerted under the wrong ticker). The scanner now drops such rows at the source (`selectNseRowsForSymbol`); this is the second line:
 * rows that are already in the queue are set aside by the worker itself, so no manual patch is needed to stop them.
 *
 * Two holders are judged by the file's own company prefix (NSE names files `<SYMBOL>_<ddmmyyyyhhmmss>_<name>`): the flood stopped
 * before a third copy existed for some documents (GLAND / VIKRAN / POLYCAB under SKIPPER and TRANSRAILL), while a parent and its
 * subsidiary may legitimately both hold one document, and then the owner's copy keeps its alert. One holder is never foreign:
 * companies name files after people or teams ("team_", "KAMLESHS_").
 */

export const FOREIGN_COPY_MIN_TICKERS = 3;

/** The company part of an NSE file name (`GLAND_06112026_x.pdf` -> `GLAND`, `BIRLACORP1_...` -> `BIRLACORP`), or "" when it has none. */
function filePrefix(attachmentUrl) {
  const name = String(attachmentUrl || "").split("?")[0].split("/").pop() || "";
  const m = name.match(/^([A-Za-z&-]+?)\d*_/);
  return m ? m[1].toUpperCase() : "";
}

/** A real document: its last path segment carries an extension. NSE's placeholder "…/corporate/-" means "no attachment". */
function isDocumentUrl(url) {
  const name = String(url || "").split("?")[0].split("/").pop() || "";
  return /\.[A-Za-z0-9]{2,5}$/.test(name);
}

const matchesCompany = (prefix, symbols) =>
  Boolean(prefix) && symbols.filter(Boolean).some((s) => {
    const sym = String(s).toUpperCase();
    return sym.startsWith(prefix) || prefix.startsWith(sym);
  });

/**
 * @param {number|string} tickerCount distinct tracked tickers holding the same attachment
 * @param {{attachmentUrl?: string, ticker?: string, nseSymbol?: string|null}} [row] the row being judged (needed for the two-holder case)
 */
export function isForeignCopy(tickerCount, { attachmentUrl, ticker, nseSymbol } = {}) {
  const n = Number(tickerCount) || 0;
  if (n >= FOREIGN_COPY_MIN_TICKERS) return true;
  if (n === 2) {
    const prefix = filePrefix(attachmentUrl);
    return Boolean(prefix) && !matchesCompany(prefix, [ticker, nseSymbol]);   // no readable prefix = cannot judge = not foreign
  }
  return false;
}

/** How many distinct tracked tickers hold this attachment. 0 when the filing has no real attachment (it cannot be judged). */
export async function countTickersHoldingDocument(pool, { attachmentUrl } = {}) {
  const url = attachmentUrl == null ? "" : String(attachmentUrl).trim();
  if (!url || !isDocumentUrl(url)) return 0;
  const { rows } = await pool.query(
    `SELECT 'foreign_copies' AS tag, count(DISTINCT ticker)::int AS n FROM corporate_announcements WHERE attachment_url = $1`,
    [url]
  );
  return Number(rows?.[0]?.n) || 0;
}

/** Take the row out of every queue and record why. The row stays (ticker + source id), so the scanner never re-ingests it. */
export async function setAsideForeignFiling(pool, id) {
  await pool.query(
    `UPDATE corporate_announcements
     SET deep_dive_status = 'not_required',
         event_analysis = (COALESCE(event_analysis, '{}'::jsonb) - 'alert_pending' - 'digest_pending' - 'synthesis_pending' - 'board_pending')
                          || jsonb_build_object('foreign_filing', true, 'foreign_filing_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
     WHERE id = $1`,
    [id]
  );
}
