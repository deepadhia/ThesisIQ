import { describe, expect, it, vi } from 'vitest';
import { pool } from '../db/pool.js';
import { findContentDuplicate, documentContentHash } from '../services/announcement.service.js';

describe('cross-exchange document identity', () => {
  it('matches the same short PDF under a different exchange filename', async () => {
    const text = 'The company has received an order for supply of equipment to Customer A. '.repeat(4);
    const query = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'earlier', title: 'Order', raw_text: `TITLE: Order\n\nCONTENT:\n${text}`, event_analysis: null }] });
    try { expect((await findContentDuplicate('EXAMPLE', text))?.id).toBe('earlier'); }
    finally { query.mockRestore(); }
  });
  it('keeps separate documents with an identical cover and different material body', async () => {
    const cover = 'Exchange cover letter. '.repeat(55);
    const prior = cover + 'Customer A awarded the first contract. '.repeat(80);
    const next = cover + 'Customer B awarded the second contract. '.repeat(80);
    const query = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'earlier', title: 'Order', raw_text: `TITLE: Order\n\nCONTENT:\n${prior.slice(0, 4000)}`, event_analysis: { content_hash: documentContentHash(prior) } }] });
    try { expect(await findContentDuplicate('EXAMPLE', next)).toBeNull(); }
    finally { query.mockRestore(); }
  });
  it('does not infer equality from a truncated legacy row without a full-document hash', async () => {
    const text = 'First page. '.repeat(450);
    const query = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'earlier', title: 'Order', raw_text: `TITLE: Order\n\nCONTENT:\n${text.slice(0, 4000)}`, event_analysis: null }] });
    try { expect(await findContentDuplicate('EXAMPLE', text)).toBeNull(); }
    finally { query.mockRestore(); }
  });
});
