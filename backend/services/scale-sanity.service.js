/**
 * Scale sanity: a single quarter's profit cannot exceed the whole trailing year's profit.
 *
 * SJS 2026-11-04: ₹580.3 million of quarterly profit was read as ₹580.3 crore (the OCR text had lost its unit line) and went out as
 * a verified alert, 10x too large. A check against the stock's own history needs a previous verified quarter, which a stock may
 * not have; the market snapshot always exists. Trailing profit = market cap / P/E (crore). Measured on the 16 real verified results
 * of the tracked stocks, quarterly PAT / trailing PAT is 0.24 to 0.47; the SJS misread is 2.82. The ceiling is 1.0.
 * Unknown inputs (no snapshot, a loss, a negative P/E) are trusted: nothing is withheld on a guess.
 */

export const MAX_QUARTER_TO_TRAILING_PROFIT = 1.0;

/** @returns {{suspect: boolean, ratio: number|null, trailingProfitCr?: number, reason?: string}} */
export function scaleSanity({ patCr, marketCapCr, pe } = {}) {
  const pat = Number(patCr);
  const mcap = Number(marketCapCr);
  const multiple = Number(pe);
  if (!(pat > 0) || !(mcap > 0) || !(multiple > 0)) return { suspect: false, ratio: null };
  const trailingProfitCr = mcap / multiple;
  const ratio = pat / trailingProfitCr;
  if (ratio <= MAX_QUARTER_TO_TRAILING_PROFIT) return { suspect: false, ratio };
  return {
    suspect: true,
    ratio,
    trailingProfitCr,
    reason: `the quarter's profit read as ₹${pat.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr is ${ratio.toFixed(1)} times the whole trailing year's ₹${trailingProfitCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr (market cap / P/E): probably a unit error`
  };
}
