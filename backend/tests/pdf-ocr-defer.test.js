import { describe, it, expect, vi, beforeEach } from 'vitest';
const state = vi.hoisted(() => ({ text: '', pages: [], destroyed: 0, parseError: false, ocrCache: new Map() }));
vi.mock('../config/env.js', () => ({ NVIDIA_API_KEY: '', GROQ_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', GEMINI_API_KEY: 'test-key', OPENROUTER_API_KEY: '', DATABASE_URL: 'postgres://test' }));
vi.mock('../db/pool.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../services/ocr-cache.service.js', async () => ({
  ...(await vi.importActual('../services/ocr-cache.service.js')),
  ocrTextCache: { get: async key => state.ocrCache.get(key) || null, set: async (key, value) => { state.ocrCache.set(key, value); } }
}));
vi.mock('../services/scanned-statement-pages.service.js', async () => ({
  ...(await vi.importActual('../services/scanned-statement-pages.service.js')),
  rotateOcrImages: vi.fn(async images => images.map(image => Uint8Array.from([9, ...image])))
}));
vi.mock('../services/ocr-quota.service.js', async () => ({
  ...(await vi.importActual('../services/ocr-quota.service.js')),
  geminiOcrQuotaGate: { run: (_ms, work) => work() }
}));
vi.mock('pdf-parse', () => ({ PDFParse: class {
  async getText() { if (state.parseError) throw new Error('damaged PDF'); return { text: state.text, pages: state.pages }; }
  async getScreenshot({ partial } = {}) { return { pages: (partial || [1]).map(n => ({ pageNumber: n, data: new Uint8Array([1, 2, n]) })) }; }
  async destroy() { state.destroyed += 1; }
} }));
import { extractPdfTextDetailed, extractTextFromPdfUrl, hasSubstantivePdfText } from '../services/announcement.service.js';

const pdfUrl = 'https://example.test/results.pdf';
// jsdom lacks Node's AbortSignal.timeout; HTTP is synchronous in this propagation harness.
if (typeof AbortSignal.timeout !== 'function') AbortSignal.timeout = () => new AbortController().signal;
beforeEach(() => {
  state.text = ''; state.pages = []; state.destroyed = 0; state.parseError = false; state.ocrCache.clear();
  vi.stubGlobal('fetch', vi.fn(async url => String(url) === pdfUrl
    ? { ok: true, arrayBuffer: async () => new Uint8Array([37,80,68,70]).buffer }
    : { ok: false, status: 429, headers: { get: () => '1200' }, text: async () => '{}' }));
});

describe('PDF OCR deferral propagation', () => {
  it('a scanned PDF preserves 429 and Retry-After without a second download or model burst', async () => {
    const pdf = await extractPdfTextDetailed(pdfUrl);
    expect(pdf).toMatchObject({ text: '', reason: 'OCR_RATE_LIMITED', retryAfterMs: 1200000, ocrUsed: false });
    expect(fetch).toHaveBeenCalledTimes(2); // one document, one OCR request
    expect(state.destroyed).toBe(1);
  });
  it('forced OCR preserves native text and the quota failure, so native text cannot hide an outage', async () => {
    state.text = 'Cover letter announcing financial results. '.repeat(10);
    const pdf = await extractPdfTextDetailed(pdfUrl, { forceOcr: true });
    expect(pdf.reason).toBe('OCR_RATE_LIMITED');
    expect(pdf.text).toContain('Cover letter');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('targeted statement OCR also propagates the quota failure and never resubmits the whole PDF', async () => {
    state.text = 'Statement of Unaudited Consolidated Financial Results\nParticulars\nRev enue from oper ations\nTotal income\n1 2 3 4 5 6 7 8 9\n' + 'a b c d e '.repeat(10);
    state.pages = [{ num: 9, text: state.text }];
    const pdf = await extractPdfTextDetailed(pdfUrl);
    expect(pdf.reason).toBe('OCR_RATE_LIMITED');
    expect(fetch).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(payload.contents[0].parts[0].inline_data.mime_type).toBe('image/png');
    expect(state.destroyed).toBe(2); // native parser and screenshot parser, even though OCR deferred
  });
  it('a native-only audit makes no OCR requests', async () => {
    state.text = 'Readable native text. '.repeat(10);
    const pdf = await extractPdfTextDetailed(pdfUrl, { allowOcr: false });
    expect(pdf.text).toBe(state.text.trim());
    expect(pdf.ocrUsed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.destroyed).toBe(1);
  });
  it('does not certify an image-only deck from its readable cover letter', async () => {
    state.text = 'Cover letter enclosing investor presentation. '.repeat(6);
    state.pages = [
      { num: 1, text: state.text },
      { num: 2, text: '-- 2 of 3 --' },
      { num: 3, text: '-- 3 of 3 --' }
    ];
    const pdf = await extractPdfTextDetailed(pdfUrl);
    expect(pdf.reason).toBe('OCR_RATE_LIMITED');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not send partial cover text to scanner classification when OCR is rate limited', async () => {
    state.text = 'Cover letter enclosing investor presentation. '.repeat(6);
    state.pages = [{ num: 1, text: state.text }, { num: 2, text: '-- 2 of 2 --' }];
    expect(await extractTextFromPdfUrl(pdfUrl)).toBe('');
  });
  it('lets the scanner defer mixed PDFs to the worker without spending OCR quota', async () => {
    state.text = 'Cover letter enclosing investor presentation. '.repeat(6);
    state.pages = [{ num: 1, text: state.text }, { num: 2, text: '-- 2 of 2 --' }];
    expect(await extractTextFromPdfUrl(pdfUrl, { allowOcr: false })).toBe('');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('identifies image-only PDFs for worker OCR in one native pass', async () => {
    state.text = '-- 1 of 2 --\n-- 2 of 2 --';
    state.pages = [{ num: 1, text: '-- 1 of 2 --' }, { num: 2, text: '-- 2 of 2 --' }];
    const pdf = await extractPdfTextDetailed(pdfUrl, { allowOcr: false });
    expect(pdf.reason).toBe('NO_TEXT');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('page markers without filing content trigger OCR instead of passing as a readable presentation', async () => {
    state.text = Array.from({ length: 40 }, (_, i) => `-- ${i + 1} of 40 --`).join('\n');
    state.pages = Array.from({ length: 40 }, (_, i) => ({ num: i + 1, text: `-- ${i + 1} of 40 --` }));
    const pdf = await extractPdfTextDetailed(pdfUrl);
    expect(pdf.reason).toBe('OCR_RATE_LIMITED');
    expect(fetch).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(payload.contents[0].parts[0].inline_data.mime_type).toBe('image/png');
  });
  it('resumes a long image deck from cached page batches and only completes after all pages are read', async () => {
    state.text = Array.from({ length: 12 }, (_, i) => `-- ${i + 1} of 12 --`).join('\n');
    state.pages = Array.from({ length: 12 }, (_, i) => ({ num: i + 1, text: `-- ${i + 1} of 12 --` }));
    let ocrCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async url => String(url) === pdfUrl
      ? { ok: true, arrayBuffer: async () => new Uint8Array([37,80,68,70]).buffer }
      : { ok: true, json: async () => {
        const batch = ++ocrCalls;
        const first = (batch - 1) * 4 + 1;
        const text = Array.from({ length: 4 }, (_, i) => `[PAGE ${first + i}] Management expects capacity and sales to grow in the next fiscal year, subject to commissioning.`).join('\n');
        return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: `Page batch ${batch}. ${text}` }] } }] };
      } }));
    expect((await extractPdfTextDetailed(pdfUrl)).reason).toBe('OCR_PARTIAL');
    expect(ocrCalls).toBe(1);
    expect((await extractPdfTextDetailed(pdfUrl)).reason).toBe('OCR_PARTIAL');
    expect(ocrCalls).toBe(2);
    const complete = await extractPdfTextDetailed(pdfUrl);
    expect(complete.reason).toBeNull();
    expect(complete.text).toContain('Page batch 1');
    expect(complete.text).toContain('Page batch 2');
    expect(complete.text).toContain('Page batch 3');
    expect(ocrCalls).toBe(3);
  });
  it('does not accept a batch that omits an image page', async () => {
    state.text = Array.from({ length: 12 }, (_, i) => `-- ${i + 1} of 12 --`).join('\n');
    state.pages = Array.from({ length: 12 }, (_, i) => ({ num: i + 1, text: `-- ${i + 1} of 12 --` }));
    vi.stubGlobal('fetch', vi.fn(async url => String(url) === pdfUrl
      ? { ok: true, arrayBuffer: async () => new Uint8Array([37,80,68,70]).buffer }
      : { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[PAGE 99] Management expects capacity and sales to grow next fiscal year.' }] } }] }) }));
    const pdf = await extractPdfTextDetailed(pdfUrl);
    expect(pdf.reason).toBe('OCR_UNAVAILABLE');
    expect(state.ocrCache.size).toBe(0);
  });
  it('retries rotated images when a sideways slide is falsely labelled unreadable', async () => {
    state.text = Array.from({ length: 12 }, (_, i) => `-- ${i + 1} of 12 --`).join('\n');
    state.pages = Array.from({ length: 12 }, (_, i) => ({ num: i + 1, text: `-- ${i + 1} of 12 --` }));
    let rotatedCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url) === pdfUrl) return { ok: true, arrayBuffer: async () => new Uint8Array([37,80,68,70]).buffer };
      const firstImage = JSON.parse(opts.body).contents[0].parts[0].inline_data.data;
      const imageBytes = Buffer.from(firstImage, 'base64');
      const rotated = imageBytes[0] === 9;
      if (rotated) rotatedCalls++;
      const pageNums = rotated ? [imageBytes[imageBytes.length - 1]] : [1, 2, 3, 4];
      const pages = pageNums.map(n => `[PAGE ${n}] ${rotated ? 'Management expects capacity and sales to grow in the next fiscal year.' : '[NO READABLE TEXT]'}`).join('\n');
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: pages }] } }] }) };
    }));
    const pdf = await extractPdfTextDetailed(pdfUrl);
    expect(pdf.reason).toBe('OCR_PARTIAL');
    expect(rotatedCalls).toBe(1);
    expect(state.ocrCache.size).toBe(1);
    expect((await extractPdfTextDetailed(pdfUrl)).reason).toBe('OCR_PARTIAL');
    expect(rotatedCalls).toBe(2);
    expect(state.ocrCache.size).toBe(2);
  });
  it('page markers alone are NO_TEXT when OCR is unavailable; real short prose and statement labels remain readable', async () => {
    const markers = Array.from({ length: 40 }, (_, i) => `-- ${i + 1} of 40 --`).join('\n');
    expect(hasSubstantivePdfText(markers)).toBe(false);
    expect(hasSubstantivePdfText('Management expects the new facility to start production next fiscal year.')).toBe(true);
    expect(hasSubstantivePdfText('Statement of consolidated results\nRevenue from operations 123.45 111.11\nProfit before tax 12.34 10.00')).toBe(true);
    state.text = markers;
    const pdf = await extractPdfTextDetailed(pdfUrl, { allowOcr: false });
    expect(pdf).toMatchObject({ text: '', reason: 'NO_TEXT' });
  });
  it('an exhausted OCR attempt is deferred once instead of redownloading the image-only PDF in the same run', async () => {
    state.text = Array.from({ length: 40 }, (_, i) => `-- ${i + 1} of 40 --`).join('\n');
    state.pages = Array.from({ length: 40 }, (_, i) => ({ num: i + 1, text: `-- ${i + 1} of 40 --` }));
    vi.stubGlobal('fetch', vi.fn(async url => String(url) === pdfUrl
      ? { ok: true, arrayBuffer: async () => new Uint8Array([37,80,68,70]).buffer }
      : { ok: true, json: async () => ({ candidates: [] }) }));
    const pdf = await extractPdfTextDetailed(pdfUrl);
    expect(pdf).toMatchObject({ text: '', reason: 'OCR_UNAVAILABLE' });
    expect(fetch.mock.calls.filter(([url]) => String(url) === pdfUrl)).toHaveLength(1);
  });
  it('destroys a parser that throws before falling back to OCR', async () => {
    state.parseError = true;
    const pdf = await extractPdfTextDetailed(pdfUrl);
    expect(pdf.reason).toBe('OCR_RATE_LIMITED');
    expect(state.destroyed).toBe(1);
  });
});
