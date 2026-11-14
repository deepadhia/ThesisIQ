import { describe, it, expect } from 'vitest';
import { extractOrderBookMetrics } from '../services/orderbook-parser.service.js';

describe('Structured Order Book Parser', () => {
  it('extracts standalone and consolidated order books from Astra Microwave disclosure', () => {
    const text = "Astra Microwave reported standalone order book of ₹3,937.00 Cr and consolidated order book of ₹4,707.59 Cr as of September 30, 2026.";
    const result = extractOrderBookMetrics(text, { trailingRevenueCr: 1155 });

    expect(result.orderBookStandaloneCr).toBe(3937);
    expect(result.orderBookConsolidatedCr).toBe(4707.59);
    expect(result.orderBookTotalCr).toBe(4707.59);
    expect(result.bookToBill).toBeCloseTo(4.08, 1);
    expect(result.line).toContain("₹3,937 Cr (standalone)");
    expect(result.line).toContain("₹4,707.59 Cr (consolidated)");
    expect(result.line).toContain("Book-to-Bill: 4.1x");
  });

  it('extracts export order book and order inflows when stated', () => {
    const text = "Total order book stands at Rs. 1,686 crores, including export order book of Rs. 1,140 crores. Inflows for the quarter were Rs. 520 Cr.";
    const result = extractOrderBookMetrics(text, { trailingRevenueCr: 800 });

    expect(result.orderBookTotalCr).toBe(1686);
    expect(result.exportOrderBookCr).toBe(1140);
    expect(result.orderInflowCr).toBe(520);
    expect(result.bookToBill).toBeCloseTo(2.11, 1);
  });

  it('returns nulls cleanly when no order book is disclosed in the document', () => {
    const text = "The company declared an interim dividend of Rs. 2 per share. Cash flows remained positive.";
    const result = extractOrderBookMetrics(text);

    expect(result.orderBookTotalCr).toBeNull();
    expect(result.line).toBeNull();
  });
});
