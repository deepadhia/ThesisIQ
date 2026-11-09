import { describe, it, expect, vi } from 'vitest';
import { claimFilingExecution, releaseFilingExecution, assertFilingExecution, FILING_LEASE_MS } from '../services/filing-execution.service.js';

describe('filing execution admission', () => {
  it('uses atomic version/status/foreign/retry checks and database time, without a session lock', async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ id: 'row' }] })) };
    const item = { id: 'row', deep_dive_status: 'completed', event_analysis: { old: true } };
    const claim = await claimFilingExecution(db, item);
    const [sql, args] = db.query.mock.calls[0];
    expect(claim.id).toBe('row');
    expect(args).toEqual(['row', claim.owner, FILING_LEASE_MS, 'completed', '{"old":true}']);
    expect(sql).toContain('IS NOT DISTINCT FROM');
    expect(sql).toContain("($5::jsonb - 'execution_lease')");
    expect(sql).toContain('clock_timestamp()');
    expect(sql).toContain('foreign_filing');
    expect(sql).toContain('retry_not_before');
    expect(sql).not.toMatch(/advisory|BEGIN|FOR UPDATE/i);
  });
  it('a busy or stale row is a deferral, never a claim', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    expect(await claimFilingExecution(db, { id: 'row', deep_dive_status: 'pending_stage1' })).toBeNull();
  });
  it('releasing one claim is fenced to its exact owner token', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    await releaseFilingExecution(db, { id: 'row', owner: 'owner-a' });
    const [sql, args] = db.query.mock.calls[0];
    expect(sql).toContain("event_analysis->'execution_lease'->>'owner' = $2");
    expect(args).toEqual(['row', 'owner-a']);
  });
  it('lost ownership and an unreadable ownership store stop the stale worker', async () => {
    const claim = { id: 'row', owner: 'old-owner' };
    await expect(assertFilingExecution({ query: async () => ({ rows: [] }) }, claim)).rejects.toMatchObject({ executionLeaseLost: true });
    await expect(assertFilingExecution({ query: async () => { throw new Error('offline'); } }, claim)).rejects.toMatchObject({ executionLeaseLost: true });
    await expect(assertFilingExecution({ query: async () => ({ rows: [{ id: 'row' }] }) }, claim)).resolves.toBeUndefined();
  });
});
