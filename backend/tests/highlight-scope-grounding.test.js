import {describe, expect, it} from 'vitest';
import {sanitizeConcallHighlights} from '../services/institutional-guard.service.js';

// Exchange press release table: the PDF text layer prints two headings, then their tables in that order.
const source = `Standalone Highlights\nConsolidated Highlights\n(Rs. In Cr) Q2FY27 Q2FY26 YOY H1FY27 H1FY26 YOY\nRevenue from Operation 261 213 22.5% 437 410 6.6%\nEBITDA 87 46 87.4% 120 85 41.5%\nPAT 47 21 126.5% 57 34 68.3%\n(Rs. In Cr) Q2FY27 Q2FY26 YOY H1FY27 H1FY26 YOY\nRevenue from Operation 263 215 22.6% 440 414 6.1%\nEBITDA 89 48 86.0% 122 89 37.5%\nPAT 52 24 117.5% 64 40 60.2%`;

describe('presentation and press highlight financial scope', () => {
  it('keeps figures attached to their actual standalone or consolidated table', () => {
    const bullets=['Standalone Revenue Q2FY27: Rs. 261 Cr','Consolidated Revenue Q2FY27: Rs. 263 Cr','Consolidated Revenue H1FY27: Rs. 440 Cr'];
    expect(sanitizeConcallHighlights({financial_performance:bullets},source).financial_performance).toEqual(bullets);
  });
  it('drops a standalone amount falsely labelled consolidated even though that amount appears elsewhere in the PDF', () => {
    const bullets=['Consolidated Revenue Q2FY27: Rs. 261 Cr','Consolidated EBITDA Q2FY27: Rs. 87 Cr','Consolidated PAT H1FY27: Rs. 57 Cr'];
    expect(sanitizeConcallHighlights({financial_performance:bullets},source).financial_performance).toEqual([]);
  });
});
