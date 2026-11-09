import { describe, it, expect, vi } from 'vitest';
vi.mock('../db/pool.js', () => ({ pool: { query: vi.fn() } }));
import { createOcrQuotaGate, ocrDeferred, ocrRetryAfterMs } from '../services/ocr-quota.service.js';

function harness() {
  let time = 1000000000;
  let state = {};
  const store = {
    async acquire(owner, busyUntil, now) {
      if ((state.until || 0) > now || (state.busyUntil || 0) > now) return null;
      state = { ...state, owner, busyUntil };
      return { ...state };
    },
    async get() { return { ...state }; },
    async finish(owner, value) { if (state.owner === owner) state = { ...value }; }
  };
  return { store, gate: () => createOcrQuotaGate({ store, now: () => time }), advance: ms => { time += ms; }, state: () => state };
}

describe('shared OCR quota', () => {
  it('two processes cannot OCR together; a replacement process observes the persisted pacing window', async () => {
    const h = harness();
    let release;
    let started;
    const entered = new Promise(r => { started = r; });
    const work = h.gate().run(80000, async () => { started(); return new Promise(r => { release = r; }); });
    await entered;
    const other = vi.fn();
    await expect(h.gate().run(80000, other)).rejects.toMatchObject({ code: 'OCR_BUSY' });
    expect(other).not.toHaveBeenCalled();
    release('text');
    await work;
    await expect(h.gate().run(80000, other)).rejects.toMatchObject({ code: 'OCR_BUSY' });
    h.advance(15001);
    await h.gate().run(80000, other);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('429 persists a cooldown across processes, then escalates a repeated quota failure', async () => {
    const h = harness();
    const limited = () => { throw ocrDeferred('OCR_RATE_LIMITED', 1200000, '429'); };
    await expect(h.gate().run(80000, limited)).rejects.toMatchObject({ retryAfterMs: 1200000 });
    await expect(h.gate().run(80000, vi.fn())).rejects.toMatchObject({ code: 'OCR_RATE_LIMITED', retryAfterMs: 1200000 });
    h.advance(1200001);
    await expect(h.gate().run(80000, limited)).rejects.toMatchObject({ retryAfterMs: 1800000 });
    expect(h.state().count).toBe(2);
  });

  it('a successful accepted transcription clears escalation; a null response does not', async () => {
    const h = harness();
    await expect(h.gate().run(80, () => { throw ocrDeferred('OCR_RATE_LIMITED', 1000, '429'); })).rejects.toThrow();
    h.advance(600001);
    await h.gate().run(80, () => null);
    expect(h.state().count).toBe(1);
    h.advance(15001);
    await h.gate().run(80, () => 'accepted');
    expect(h.state().count).toBe(0);
  });

  it('a crashed process lease expires and its late release cannot unlock its replacement', async () => {
    const h = harness();
    let release;
    let started;
    const entered = new Promise(r => { started = r; });
    const work = h.gate().run(80, async () => { started(); return new Promise(r => { release = r; }); });
    await entered;
    h.advance(30081);
    const lease = await h.store.acquire('replacement', 2000000000, 1000030081);
    expect(lease.owner).toBe('replacement');
    release('late result');
    await work;
    expect(h.state().owner).toBe('replacement');
  });

  it('an unavailable shared store defers OCR instead of bursting without protection', async () => {
    const work = vi.fn();
    const gate = createOcrQuotaGate({ store: { acquire: async () => { throw new Error('offline'); } } });
    await expect(gate.run(80000, work)).rejects.toMatchObject({ code: 'OCR_UNAVAILABLE' });
    expect(work).not.toHaveBeenCalled();
  });

  it('honours RetryInfo, Retry-After seconds or dates, choosing the longest valid hint', () => {
    const body = JSON.stringify({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '90.5s' }] } });
    expect(ocrRetryAfterMs({ get: () => '60' }, body)).toBe(90500);
    expect(ocrRetryAfterMs({ get: () => '120' }, body)).toBe(120000);
    const now = Date.parse('2026-11-08T00:00:00Z');
    expect(ocrRetryAfterMs({ get: () => 'Sun, 08 Nov 2026 00:02:00 GMT' }, '{}', now)).toBe(120000);
    expect(ocrRetryAfterMs({ get: () => 'invalid' }, 'bad')).toBe(0);
  });
});
