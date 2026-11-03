/**
 * The read-only audit that finds results rows holding wrong stored figures (TRANSRAILL stored PAT 14.74 / period 2025-09-30).
 */
import { describe, it, expect } from 'vitest';
import { diffFinancials, needsCorrection } from '../scripts/audit-stored-financials.js';

const storedBad = { quarterEnded: '2025-09-30', revenue: 2030.22, patAttributable: 14.74, patConsolidated: 14.74, ebitda: null };
const fresh = { quarterEnded: '2026-09-30', revenue: 2030.22, patAttributable: 103.94, patConsolidated: 103.94, ebitda: 237.93 };

describe('diffFinancials', () => {
  it('flags the wrong period and the wrong PAT of the TRANSRAILL row, and the EBITDA the old parser could not read', () => {
    const d = diffFinancials(storedBad, fresh);
    expect(d).toContainEqual({ field: 'quarterEnded', stored: '2025-09-30', fresh: '2026-09-30', kind: 'WRONG' });
    expect(d).toContainEqual({ field: 'pat', stored: 14.74, fresh: 103.94, kind: 'WRONG' });
    expect(d).toContainEqual({ field: 'ebitda', stored: null, fresh: 237.93, kind: 'NEWLY_READ' });
    expect(d.some(x => x.field === 'revenue')).toBe(false);
    expect(needsCorrection(d)).toBe(true);
  });

  it('a row identical to the fresh parse has no differences', () => {
    expect(diffFinancials(fresh, fresh)).toEqual([]);
  });

  it('an EBITDA that only changed because other income is now excluded is informational, not a correction', () => {
    const d = diffFinancials({ ...fresh, ebitda: 251.4 }, fresh);
    expect(d).toEqual([{ field: 'ebitda', stored: 251.4, fresh: 237.93, kind: 'DEFINITION' }]);
    expect(needsCorrection(d)).toBe(false);
  });

  it('a stored PAT the current parser now withholds (failed the sanity guard) must be re-sent, with the reason', () => {
    const d = diffFinancials(storedBad, { ...fresh, patAttributable: null, patConsolidated: null, patRejectedReason: 'PAT 14.74 is 9% of PBT 158.09' });
    expect(d).toContainEqual({ field: 'pat', stored: 14.74, fresh: null, kind: 'MISSING_NOW', note: 'PAT 14.74 is 9% of PBT 158.09' });
    expect(needsCorrection(d)).toBe(true);
  });

  it('a wrong revenue is flagged; a 0.2% rounding difference is not', () => {
    expect(diffFinancials({ ...fresh, revenue: 1000 }, fresh)).toContainEqual({ field: 'revenue', stored: 1000, fresh: 2030.22, kind: 'WRONG' });
    expect(diffFinancials({ ...fresh, revenue: 2026.0 }, fresh).some(x => x.field === 'revenue')).toBe(false);
  });
});

describe('rows the audit cannot reproduce are never recommended for re-send', () => {
  it('stored CONSOLIDATED figures (read by vision OCR from a scanned PDF) vs a plain-text parse that only sees STANDALONE: unverifiable, not wrong', () => {
    const d = diffFinancials(
      { statementScope: 'CONSOLIDATED', revenue: 1427.35, patAttributable: 102.01, ebitda: 133.98, quarterEnded: '2026-09-30' },
      { statementScope: 'STANDALONE', revenue: 786.91, patAttributable: 47.34, ebitda: 72.06, quarterEnded: '2026-09-30' }
    );
    expect(d).toEqual([{ field: 'scope', stored: 'CONSOLIDATED', fresh: 'STANDALONE', kind: 'UNVERIFIABLE' }]);
    expect(needsCorrection(d)).toBe(false);
  });
});
