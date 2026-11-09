import { describe, it, expect } from 'vitest';
import { scoreParserCandidate } from '../services/parser-benchmark.service.js';

const expected = { revenue: 282.728, pat: 58.03, period: '2026-09-30', scope: 'CONSOLIDATED', unit: 'MILLIONS' };
const fin = { revenue: 282.73, patAttributable: 58.03, quarterEnded: '2026-09-30', statementScope: 'CONSOLIDATED', unit: 'MILLIONS' };
describe('independent parser corpus scoring', () => {
  it('accepts rounding to crore precision only when period, scope and unit agree', () => {
    expect(scoreParserCandidate(fin, expected).status).toBe('PASS');
    expect(scoreParserCandidate({ ...fin, statementScope: 'STANDALONE' }, expected).status).toBe('FAIL');
    expect(scoreParserCandidate({ ...fin, unit: 'CRORES', revenue: 2827.28 }, expected).status).toBe('FAIL');
  });
  it('separates refusal or missing evidence from confident wrong output', () => {
    expect(scoreParserCandidate(null, expected).status).toBe('ABSTAIN');
    expect(scoreParserCandidate({ ...fin, quarterEnded: null }, expected).status).toBe('UNVERIFIED');
    expect(scoreParserCandidate({ ...fin, revenue: 288.99 }, expected).status).toBe('FAIL');
  });
});
