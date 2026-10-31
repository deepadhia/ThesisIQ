/**
 * Gemini vision OCR time budget. In production the first model once held the call for ~56 s of a shared 80 s budget
 * (answering 503 "high demand" late), leaving the fallback model 5-24 s, so a scanned results PDF could not be read.
 * Each model now gets its own capped slice, so a slow model cannot starve the next one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../config/env.js', () => ({ NVIDIA_API_KEY: '', GROQ_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', GEMINI_API_KEY: '', DATABASE_URL: 'postgres://test' }));
vi.mock('../db/pool.js', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../services/telegram.service.js', async () => ({ ...(await vi.importActual('../services/telegram.service.js')), sendTelegramMessage: vi.fn(async () => ({ ok: true })) }));

import { ocrPdfWithGemini } from '../services/announcement.service.js';

// Production runs on plain Node (AbortSignal.timeout exists); the jsdom test environment's AbortSignal lacks it.
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

const GOOD_TEXT ='Statement of Consolidated Profit and Loss | Revenue from operations | 1,427.35 | 1,035.51 | '.repeat(3);
const okResponse = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) });
const errResponse = (status) => ({ ok: false, status, text: async () => `{"error":{"code":${status}}}` });
const hangUntilAborted = (init) => new Promise((_, reject) => {
  init.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })));
});
const pdf = new Uint8Array([37, 80, 68, 70]);
const fast = { statementsOnly: true, totalMs: 800, perModelMs: 150, minMs: 30 };

afterEach(() => vi.unstubAllGlobals());

describe('ocrPdfWithGemini time budget', () => {
  it('a model that hangs only loses its own slice; the next model still gets a fair try and succeeds', async () => {
    const urls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      urls.push(String(url));
      return urls.length === 1 ? hangUntilAborted(init) : okResponse(GOOD_TEXT);
    }));
    const t0 = Date.now();
    const text = await ocrPdfWithGemini(pdf, 'k', fast);
    expect(text).toContain('Revenue from operations');
    expect(urls).toHaveLength(2);
    expect(Date.now() - t0).toBeLessThan(600);          // the hang cost ~150 ms (its slice), not the whole budget
  });

  it('control: with no per-model cap (the old behaviour) one hanging model starves the rest and the scan is lost', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => (++n === 1 ? hangUntilAborted(init) : okResponse(GOOD_TEXT))));
    const text = await ocrPdfWithGemini(pdf, 'k', { ...fast, totalMs: 300, perModelMs: 300, minMs: 120 });
    expect(text).toBeNull();
    expect(n).toBe(1);
  });

  it('a 503 from one model moves straight on to the next model', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? errResponse(503) : okResponse(GOOD_TEXT))));
    expect(await ocrPdfWithGemini(pdf, 'k', fast)).toContain('Revenue from operations');
    expect(n).toBe(2);
  });

  it('two slow models in a row still leave the third one its own slice', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => (++n <= 2 ? hangUntilAborted(init) : okResponse(GOOD_TEXT))));
    expect(await ocrPdfWithGemini(pdf, 'k', { ...fast, totalMs: 900 })).toContain('Revenue from operations');
    expect(n).toBe(3);
  });

  it('gives up with null (never partial text) when every model fails, without exceeding the total budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => hangUntilAborted(init)));
    const t0 = Date.now();
    expect(await ocrPdfWithGemini(pdf, 'k', { ...fast, totalMs: 400 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it('still honours the caller acceptance check by moving to the next model', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? okResponse('x'.repeat(120)) : okResponse(GOOD_TEXT))));
    const text = await ocrPdfWithGemini(pdf, 'k', { ...fast, accept: (t) => /Revenue from operations/.test(t) });
    expect(text).toContain('Revenue from operations');
    expect(n).toBe(2);
  });
});
