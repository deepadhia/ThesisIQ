import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeIntegratedFiling, selectCurrentFilings, discoverNseIntegratedFilings, checkLegacyResultFreshness } from '../services/xbrl/integratedFilingDiscovery.js';

const filing = (overrides = {}) => ({
  symbol: 'EXAMPLE', qe_Date: '30-SEP-2026', consolidated: 'Consolidated',
  broadcast_Date: '12-Nov-2026 18:11:11', type: 'Integrated Filing- Financials',
  type_Sub: 'Original', seq_Id: '212897',
  xbrl: 'https://nsearchives.nseindia.com/corporate/xbrl/EXAMPLE_WEB.xml',
  ixbrl: 'https://nsearchives.nseindia.com/corporate/ixbrl/EXAMPLE_WEB.html',
  ...overrides,
});

test('normalizes exact exchange filing identity and provenance', () => {
  const row = normalizeIntegratedFiling(filing());
  assert.equal(row.symbol, 'EXAMPLE');
  assert.equal(row.periodEnd, '2026-09-30');
  assert.equal(row.basis, 'consolidated');
  assert.equal(row.broadcastAt, '2026-11-12T12:41:11.000Z');
  assert.equal(row.xbrlUrl, filing().xbrl);
});

test('rejects foreign symbols, periods, missing basis, and untrusted URLs', () => {
  const rows = [
    filing(),
    filing({ symbol: 'FOREIGN' }),
    filing({ qe_Date: '30-JUN-2026' }),
    filing({ consolidated: null }),
    filing({ xbrl: 'https://example.com/fake.xml' }),
  ];
  const selected = selectCurrentFilings(rows, { symbol: 'EXAMPLE', periodEnd: '2026-09-30' });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].basis, 'consolidated');
});

test('preserves standalone and consolidated revisions instead of collapsing them', () => {
  const selected = selectCurrentFilings([
    filing(),
    filing({ consolidated: 'Standalone', seq_Id: '212895' }),
    filing({ type_Sub: 'Revised', seq_Id: '212900', broadcast_Date: '13-Nov-2026 10:00:00' }),
  ], { symbol: 'EXAMPLE', periodEnd: '2026-09-30' });
  assert.equal(selected.length, 3);
  assert.deepEqual(selected.map(row => row.basis), ['consolidated', 'standalone', 'consolidated']);
  assert.equal(selected[2].revision, 'Revised');
});

test('paginates historical filings and checks exact symbol after server filtering', async () => {
  const pages = [];
  const result = await discoverNseIntegratedFilings({ symbol: 'EXAMPLE', periodEnd: '2026-09-30',
    fetcher: async url => {
      pages.push(Number(url.searchParams.get('page')));
      return { ok: true, json: async () => ({ totalCount: 101, data: pages.length === 1
        ? Array.from({ length: 100 }, () => filing({ qe_Date: '30-JUN-2026' }))
        : [filing(), filing({ symbol: 'FOREIGN' })] }) };
    },
  });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.length, 1);
});

test('discovers all periods for a symbol when checking the newest official filing', async () => {
  const result = await discoverNseIntegratedFilings({ symbol: 'EXAMPLE',
    fetcher: async () => ({ ok: true, json: async () => ({ totalCount: 3, data: [
      filing({ qe_Date: '30-JUN-2026' }),
      filing({ qe_Date: '30-SEP-2026' }),
      filing({ symbol: 'FOREIGN', qe_Date: '31-DEC-2026' }),
    ] }) }),
  });
  assert.deepEqual(result.map(row => row.periodEnd), ['2026-06-30', '2026-09-30']);
});

test('holds legacy sync when its newest period trails official integrated filings', () => {
  const official = [normalizeIntegratedFiling(filing({ qe_Date: '30-SEP-2026' }))];
  assert.deepEqual(checkLegacyResultFreshness([{ period_end_date: '2026-06-30' }], official), {
    fresh: false, legacyPeriodEnd: '2026-06-30', officialPeriodEnd: '2026-09-30',
  });
  assert.equal(checkLegacyResultFreshness([{ period_end_date: '2026-09-30' }], official).fresh, true);
  assert.equal(checkLegacyResultFreshness([{ period_end_date: '2026-09-30' }], []).fresh, false);
});
