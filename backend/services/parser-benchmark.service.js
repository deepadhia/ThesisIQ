/** Exact financial meaning, not a parser's internal confidence score, decides whether a candidate passes the corpus. */
export function scoreParserCandidate(fin, expected) {
  if (!fin || !Number.isFinite(fin.revenue)) return { status: 'ABSTAIN', differences: [] };
  const actual = { revenue: fin.revenue, pat: fin.patAttributable ?? fin.patConsolidated,
    period: fin.quarterEnded, scope: fin.statementScope, unit: fin.unit };
  const differences = [];
  for (const [field, want] of Object.entries(expected)) {
    const got = actual[field];
    const missing = got === null || got === undefined || got === 'UNKNOWN';
    const matches = typeof want === 'number' ? Number.isFinite(got) && Math.abs(got - want) <= 0.02 : got === want;
    if (!matches) differences.push({ field, expected: want, actual: got ?? null, kind: missing ? 'MISSING' : 'WRONG' });
  }
  const status = differences.some(d => d.kind === 'WRONG') ? 'FAIL'
    : differences.length || fin.isVerified === false ? 'UNVERIFIED' : 'PASS';
  return { status, differences };
}
