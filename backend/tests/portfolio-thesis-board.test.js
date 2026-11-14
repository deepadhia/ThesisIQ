import { describe, expect, it } from 'vitest';
import { buildPortfolioBoardRows } from '../scripts/generate-portfolio-thesis-board.js';

describe('portfolio board includes every tracked stock', () => {
  it('does not drop new stocks when the frozen ranking file is missing', () => {
    const healthReport = { stocks: [{
      ticker: 'NEWCO', fundamental: {
        status: 'INSUFFICIENT_EVIDENCE', statusQuarter: null,
        recordedSnapshotConviction: null, evidenceSignal: 'INSUFFICIENT_EVIDENCE'
      }, attribution: 'UNDETERMINED'
    }] };
    const rows = buildPortfolioBoardRows({ rankings: [], healthReport, snapshotMap: new Map() });
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe('NEWCO');
    expect(rows[0].rank).toBeNull();
    expect(rows[0].consolidatedScore).toBeNull();
    expect(rows[0].thesisBucket).toContain('Unassessed');
  });
});
