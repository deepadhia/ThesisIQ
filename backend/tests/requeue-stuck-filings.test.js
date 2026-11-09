import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({ pool: { query: vi.fn(), end: vi.fn() } }));

import { defaultSinceDate, stageForFiling } from '../scripts/requeue-stuck-filings.js';

describe('requeue-stuck-filings helpers', () => {
  it('defaults to the day after the latest fiscal quarter end', () => {
    expect(defaultSinceDate(new Date('2026-10-29T10:00:00Z'))).toBe('2026-10-01');
    expect(defaultSinceDate(new Date('2026-07-20T10:00:00Z'))).toBe('2026-07-01');
    expect(defaultSinceDate(new Date('2027-01-15T10:00:00Z'))).toBe('2027-01-01');
    expect(defaultSinceDate(new Date('2026-05-02T10:00:00Z'))).toBe('2026-04-01');
  });

  it('puts each filing back into the queue its own title / file name belongs to', () => {
    expect(stageForFiling('Analysts/Institutional Investor Meet/Con. Call Updates', 'https://x/HSCLTranscriptQ2FY27.pdf')).toBe('pending_stage2');
    expect(stageForFiling('Analysts/Institutional Investor Meet/Con. Call Updates', 'https://x/GRAVITA_callrecording27102026.pdf')).toBe('pending_audio');
    expect(stageForFiling('Analysts/Institutional Investor Meet/Con. Call Updates', 'https://x/POLICYBZR_28102026.pdf', 'Audio ingestion failed: Failed to download audio stream: 404 Not Found')).toBe('pending_audio');
    expect(stageForFiling('Outcome of Board Meeting', 'https://x/ANANTRAJ_Outcome_28102026.pdf')).toBe('pending_stage1');
    expect(stageForFiling('Investor Presentation', 'https://x/Investorpresentation27102026.pdf')).toBe('pending_stage1');
  });
});

import { buildSelection } from '../scripts/requeue-stuck-filings.js';

describe('buildSelection: --only re-queues exactly the named rows', () => {
  const ids = ['cecfe84e-d1b6-4c09-a019-0cd31af725fb', '04b82c32-627d-45e6-bd08-fd2c902fe7f1'];
  it('without --only it also selects the stuck needs_review / failed rows of the quarter (unchanged behaviour)', () => {
    const s = buildSelection({ since: '2026-10-01', ids });
    expect(s.sql).toMatch(/needs_review/);
    expect(s.params).toEqual(['2026-10-01', ids]);
  });
  it('with --only it selects nothing but the named ids', () => {
    const s = buildSelection({ since: '2026-10-01', ids, only: true });
    expect(s.sql).not.toMatch(/needs_review/);
    expect(s.sql).toMatch(/id = ANY\(\$1::uuid\[\]\)/);
    expect(s.params).toEqual([ids]);
  });
  it('neither selection mode can revive a flagged foreign filing', () => {
    for (const only of [true, false]) {
      const s = buildSelection({ since: '2026-10-01', ids, only });
      expect(s.sql).toMatch(/COALESCE\(event_analysis->>'foreign_filing', 'false'\) <> 'true'/);
    }
  });
});
