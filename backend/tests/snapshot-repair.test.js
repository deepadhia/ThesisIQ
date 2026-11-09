import { describe, it, expect, vi } from 'vitest';
vi.mock('../db/pool.js', () => ({ pool: { query: vi.fn(), end: vi.fn() } }));
vi.mock('../workers/quarterly-deepdive-worker.js', () => ({ processPendingDeepDives: vi.fn() }));
import { parseRepairIds, rebuiltIdsForRun } from '../scripts/reprocess-results-snapshots.js';
import { pool } from '../db/pool.js';
import { captureFollowupState, replayFollowupIds, completedFollowupIds } from '../scripts/reprocess-followup-filings.js';

const a = 'aaaaaaaa-0000-0000-0000-000000000001';
const b = 'aaaaaaaa-0000-0000-0000-000000000002';
describe('snapshot repair accounting', () => {
  it('requires explicit IDs, validates them, and resumes only the remaining IDs', () => {
    expect(() => parseRepairIds([])).toThrow('Supply --ids');
    expect(() => parseRepairIds(['--ids', '--apply'])).toThrow('UUID');
    expect(parseRepairIds(['--ids', `${a},${a},${b}`])).toEqual([a, b]);
    expect(parseRepairIds([], { remainingIds: [b] })).toEqual([b]);
  });
  it('old snapshots, deferred/skipped filings and snapshots without verified numbers never count as rebuilt', () => {
    const snapshot = { raw_ai_output: { source_filing: { announcement_id: a }, verified_financials: { revenue: 12 } } };
    expect(rebuiltIdsForRun([a], { processedIds: [] }, [snapshot])).toEqual([]);
    expect(rebuiltIdsForRun([a], { processedIds: [a] }, [snapshot])).toEqual([a]);
    expect(rebuiltIdsForRun([b], { processedIds: [b] }, [snapshot])).toEqual([]);
    expect(rebuiltIdsForRun([a], { processedIds: [a] }, [{ raw_ai_output: { source_filing: { announcement_id: a } } }])).toEqual([]);
  });
});

describe('follow-up replay backup', () => {
  it('captures every table the worker can write for the selected stocks before replay', async () => {
    const query = vi.mocked(pool.query);
    query.mockResolvedValue({ rows: [] });
    const state = await captureFollowupState([{ id: a, stock_id: 'stock-1', ticker: 'EXAMPLE' }]);
    expect(Object.keys(state.tables).sort()).toEqual([
      'corporate_announcements', 'guidance_outcomes', 'guidance_pacing_history',
      'management_commitments', 'quarterly_snapshots', 'stock_syntheses'
    ].sort());
    expect(query.mock.calls.map(([sql]) => String(sql))).toEqual(expect.arrayContaining([
      expect.stringContaining('FROM management_commitments'),
      expect.stringContaining('FROM guidance_outcomes'),
      expect.stringContaining('FROM guidance_pacing_history'),
      expect.stringContaining('FROM quarterly_snapshots')
    ]));
  });
  it('replays exact IDs sequentially and stops after the first quota deferral', async () => {
    const run = vi.fn().mockResolvedValueOnce({ processed: 1, processedIds: [a] }).mockResolvedValueOnce({ paused: true, processedIds: [] });
    const wait = vi.fn();
    const result = await replayFollowupIds([a, b, 'aaaaaaaa-0000-0000-0000-000000000003'], { run, wait });
    expect(run.mock.calls.map(([opts]) => opts.announcementIds)).toEqual([[a], [b]]);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(result.processedIds).toEqual([a]);
    expect(result.stoppedOn).toBe(b);
  });
  it('counts a replay only when the new verdict names and hashes its own source', () => {
    const rows = [{ id: a, deep_dive_status: 'completed', action: 'HOLD', source_document: { announcement_id: a, text_sha256: 'a'.repeat(64) } }];
    expect(completedFollowupIds([a], { processedIds: [a] }, rows)).toEqual([a]);
    expect(completedFollowupIds([a], { processedIds: [] }, rows)).toEqual([]);
    expect(completedFollowupIds([a], { processedIds: [a] }, [{ ...rows[0], source_document: { announcement_id: b, text_sha256: 'a'.repeat(64) } }])).toEqual([]);
    expect(completedFollowupIds([a], { processedIds: [a] }, [{ ...rows[0], source_document: null }])).toEqual([]);
  });
});
