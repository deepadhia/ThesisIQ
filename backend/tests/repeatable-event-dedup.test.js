import { describe, expect, it, vi } from 'vitest';
import { pool } from '../db/pool.js';
import { isEventAlertRecentlySent } from '../services/announcement.service.js';

describe('repeatable contract alerts', () => {
  it('still suppresses the exact source document when the same attachment is seen again', async () => {
    const query = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'prior' }] });
    try {
      expect(await isEventAlertRecentlySent({ ticker: 'EXAMPLE', title: 'Order', summary: 'Order received', attachment_url: 'https://example.test/order.pdf', filing_category: 'ORDER_WIN' })).toBe(true);
    } finally { query.mockRestore(); }
  });
  it('does not suppress a distinct PDF with the same standard title and amount but a different customer', async () => {
    const query = vi.spyOn(pool, 'query').mockImplementation(async sql => ({
      rows: String(sql).includes('attachment_url ILIKE') ? [] : [{
        title: 'Announcement under Regulation 30 (LODR)-Bagging/receiving of order(s) or contract(s)',
        summary: 'Customer Alpha awarded an industrial packaging contract worth ₹35 Cr.',
        filing_category: 'ORDER_WIN'
      }]
    }));
    try {
      expect(await isEventAlertRecentlySent({
        ticker: 'EXAMPLE',
        title: 'Announcement under Regulation 30 (LODR)-Bagging/receiving of order(s) or contract(s)',
        summary: 'Customer Beta awarded an industrial packaging contract worth ₹35 Cr.',
        attachment_url: 'https://example.test/new-contract.pdf',
        filing_category: 'ORDER_WIN'
      })).toBe(false);
    } finally { query.mockRestore(); }
  });
});
