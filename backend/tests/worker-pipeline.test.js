/**
 * End-to-end invariants for the quarterly deep-dive worker (results / presentation / concall alerts).
 * The DB, Telegram and the NIM LLM are mocked; everything else (classifier, parser, guard, gates, thesis drivers,
 * message builders) is the real code.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const shaktiText = fs.readFileSync(path.resolve(here, 'fixtures/shaktipump-q2fy27-results.txt'), 'utf8');

const state = vi.hoisted(() => {
  // The allocation gate is ON in production; the pre-existing delivery tests assert "every filing is delivered", so they run with it off.
  process.env.ALLOCATION_GATE = 'off';
  return {
  calls: [],
  item: null,
  docText: '',
  sends: [],
  sendImpl: null,
  llmMode: 'ok',
  llmVerdict: null,
  tableJson: null,
  highlightsJson: null,
  whisperText: '',
  twinFailure: false,
  foreignCopies: 0,
  transcriptCovers: false,
  audioTwin: false,
  recentResultsAlert: false,
  earlierRecordingItems: [],
  marketSnapshot: null,
  nimBodies: [],
  ocrText: '',
  pdfFailReason: 'NO_TEXT',
  pdfFailDetail: '',
  digestStore: new Map(),
  otherPending: 0,
  previousRows: [],
  guidanceRows: [],
  outcomeRows: [],
  healthStuck: [],
  boardRows: new Map()
};
});

vi.mock('../config/env.js', () => ({
  NVIDIA_API_KEY: 'test-key',
  GROQ_API_KEY: '',
  TELEGRAM_BOT_TOKEN: 'tok',
  TELEGRAM_CHAT_ID: '1',
  GEMINI_API_KEY: '',
  OPENROUTER_API_KEY: '',
  DATABASE_URL: 'postgres://test'
}));

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(async (sql, params) => {
      const text = String(sql);
      state.calls.push({ sql: text, params });
      // ── thesis digest queue (event_analysis.digest_pending), emulated in memory ──
      if (text.includes("'digest_pending', true")) {
        state.digestStore.set(params[1], { id: params[1], ticker: state.item?.ticker, company_name: state.item?.company_name, filing_date: state.item?.filing_date, digest_item: JSON.parse(params[0]) });
        return { rows: [] };
      }
      // a recording whose call already has an analysed written transcript
      if (text.includes("'transcript_covers_call' AS tag")) return { rows: state.transcriptCovers ? [{ tag: 'transcript_covers_call' }] : [] };
      // foreign-filing guard: how many tracked tickers hold this same attachment
      if (text.includes("'foreign_copies' AS tag")) return { rows: [{ n: state.foreignCopies }] };
      // dead-letter bookkeeping: a sibling filing that failed for the same reason, and a results alert already sent for the stock
      if (text.includes("o.event_analysis->>'audio_media_url' = $3")) return { rows: state.audioTwin ? [{}] : [] };
      if (text.includes("event_analysis->>'pipeline_error' = $3")) return { rows: state.twinFailure ? [{}] : [] };
      if (text.includes("filing_category = 'QUARTERLY_EARNINGS' AND sent_to_telegram = true")) return { rows: state.recentResultsAlert ? [{}] : [] };
      if (text.includes("event_analysis->>'digest_pending' = 'true'")) return { rows: [...state.digestStore.values()].filter(r => !r.sent) };
      // guidance tracking tables: the verified track record read, and the upserts (no rows back)
      if (text.includes("'guidance_outcomes_read' AS tag")) return { rows: state.outcomeRows };
      if (text.includes('INSERT INTO guidance_pacing_history') || text.includes('INSERT INTO guidance_outcomes')) return { rows: [] };
      // guidance pacing: the stock's stored guidance statements
      if (text.includes("'pacing_commitments' AS tag")) return { rows: state.guidanceRows };
      // self-audit: both guidance tracking tables exist
      if (text.includes('information_schema.tables') && text.includes('guidance_outcomes')) return { rows: [{ table_name: 'guidance_pacing_history' }, { table_name: 'guidance_outcomes' }] };
      // self-audit: the stuck-filings check (every other health query falls through to the empty default)
      if (text.includes('AS age_hours') && text.includes("IN ('pending_stage1','pending_stage2','pending_audio')")) return { rows: state.healthStuck };
      // allocation gate: the stock's earlier verdicts, filings parked on the end-of-day board, and the board's own bookkeeping
      if (text.includes("'previous_view' AS tag")) return { rows: state.previousRows };
      if (text.includes("'board_pending', true")) { for (const id of params[1]) { state.boardRows.set(id, { bi: JSON.parse(params[0]), sent: false }); const r = state.digestStore.get(id); if (r) r.sent = true; } return { rows: [] }; }
      if (text.includes("event_analysis->>'board_pending' = 'true'")) return { rows: [...state.boardRows.entries()].filter(([, v]) => !v.sent).map(([id, v]) => ({ id, bi: v.bi })) };
      if (text.includes("'board_sent_at'")) { for (const id of params[0]) { const v = state.boardRows.get(id); if (v) v.sent = true; } return { rows: [] }; }
      // a batch folded into the record instead of sent (press release restating results / transcript repeating a recording write-up)
      if (text.includes("'digest_folded'")) { for (const id of params[1]) { const r = state.digestStore.get(id); if (r) { r.sent = true; r.folded = params[0]; } } return { rows: [] }; }
      if (text.includes('earlier_recording_writeup')) return { rows: state.earlierRecordingItems.map(di => ({ di })) };
      if (text.includes('FROM market_data_snapshots') && text.includes('digest_price_line')) return { rows: state.marketSnapshot ? [state.marketSnapshot] : [] };
      if (text.includes('GROUP BY ticker')) return { rows: state.otherPending ? [{ ticker: state.item?.ticker, n: state.otherPending }] : [] };
      if (text.includes('digest_sent_at')) { for (const id of params[0]) { const r = state.digestStore.get(id); if (r) r.sent = true; } return { rows: [] }; }
      if (text.includes('FROM corporate_announcements ca') && text.includes('JOIN stocks')) return { rows: [state.item] };
      // system_settings key/value store (the quota-pause state lives there), emulated in memory
      if (text.includes('FROM system_settings')) { const v = state.settings[params[0]]; return { rows: v === undefined ? [] : [{ value: v }] }; }
      if (text.includes('INSERT INTO system_settings')) { state.settings[params[0]] = JSON.parse(params[1]); return { rows: [] }; }
      // Attempts are counted PER STAGE (params[2] is the counter name: fetch_attempts, llm_attempts, ...).
      if (text.includes('AS attempts')) {
        const key = params[2];
        state.counters[key] = (state.counters[key] || 0) + 1;
        return { rows: [{ attempts: state.attempts ?? state.counters[key] }] };
      }
      // An AI-provider outage is recorded WITHOUT consuming a processing attempt (first_at = when this filing first met it).
      if (text.includes('llm_outage_first_at') && text.includes('RETURNING')) return { rows: [{ first_at: state.outageFirstAt || new Date().toISOString(), retries: state.outageRetries || 1 }] };
      // The long-form markdown "Strategic Accountability" template that lives in prompt_templates.
      if (text.includes('FROM prompt_templates')) return { rows: [{ template: 'Identify every commitment made by management. For every commitment provide: 1. Original Guidance 2. Evidence Timeline. Finally summarize: Biggest Promise Delivered.' }] };
      return { rows: [] };
    })
  }
}));

vi.mock('../services/announcement.service.js', async () => {
  const actual = await vi.importActual('../services/announcement.service.js');
  return {
    ...actual,
    extractTextFromPdfUrl: vi.fn(async () => state.docText),
    // The worker reads PDFs through the detailed extractor so it can tell "download failed" from "scanned PDF".
    extractPdfTextDetailed: vi.fn(async (_url, opts = {}) => {
      const text = opts.forceOcr ? state.ocrText : state.docText;
      return text ? { text, reason: null, detail: '' } : { text: '', reason: state.pdfFailReason, detail: state.pdfFailDetail };
    })
  };
});

vi.mock('../services/telegram.service.js', async () => {
  const actual = await vi.importActual('../services/telegram.service.js');
  return {
    ...actual,
    sendTelegramMessage: vi.fn(async (text) => {
      state.calls.push({ sql: '__SEND__', params: [text] });
      if (state.sendImpl) return state.sendImpl(text);
      state.sends.push(text);
      return { ok: true };
    }),
    sendPipelineFailureAlert: vi.fn(async () => true),
    sendConcallDiscrepancyAlert: vi.fn(async () => true)
  };
});

// Recordings: the download and the Whisper call are replaced; the link extraction, routing and everything after are real.
vi.mock('../services/audio-transcript-analyzer.service.js', async () => {
  const actual = await vi.importActual('../services/audio-transcript-analyzer.service.js');
  return {
    ...actual,
    resolveAudioMediaUrl: vi.fn(async (url) => {
      if (/(?:youtube\.com|youtu\.be)/i.test(url)) return { type: 'YOUTUBE', url };
      return { type: 'DIRECT_AUDIO', url };
    }),
    isYtDlpAvailable: vi.fn(async () => true),
    downloadYouTubeAudio: vi.fn(async (_url, out) => out),
    downloadAndExtractMp3: vi.fn(async (_url, out) => out),
    transcribeAudioWithGroqWhisper: vi.fn(async () => state.whisperText),
    analyzeAudioWithGemini: vi.fn(async () => ({ executive_summary: 'Gemini audio summary', catalysts: [], commitments: [] }))
  };
});

import { processPendingDeepDives, flushThesisDigests, flushAllocationBoard, flushHealthReport } from '../workers/quarterly-deepdive-worker.js';
import { getThesisContract } from '../services/thesis-driver-context.service.js';
import { sendPipelineFailureAlert } from '../services/telegram.service.js';
import { extractPdfTextDetailed } from '../services/announcement.service.js';
import { resetLlmState } from '../services/llm-failover.service.js';

const drivers = getThesisContract('SHAKTIPUMP').drivers;

function llmVerdictJson(overrides = {}) {
  return {
    credibility_tier: 'Tier 2',
    action_signal: 'ADD',
    conviction_score: 8,
    verdict_summary: 'Profit contracted sharply on a high base while revenue still grew; working capital needs watching.',
    key_drivers: ['Order execution vs working capital'],
    key_positives: ['Revenue grew 11.96% on higher dispatch volumes'],
    key_concerns_and_drags: ['Margin compression from input cost and mix'],
    thesis_operational_kpis: [],
    concall_verification_points: ['Receivable days from state discoms'],
    thesis_driver_assessment: [
      { driver: drivers[1].name, status: 'AT_RISK', evidence: 'PAT fell to 38.51 Cr from 90.71 Cr a year ago on the high FY25 base' },
      { driver: drivers[0].name, status: 'ON_TRACK', evidence: 'Dispatch volumes continued under PM-KUSUM in the quarter per management' }
    ],
    commitments: [],
    ...overrides
  };
}

function stubFetch(mode) {
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('integrate.api.nvidia.com')) {
      if (mode === 'fail') throw new TypeError('fetch failed');
      if (mode === '429') return { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: (h) => (String(h).toLowerCase() === 'retry-after' ? '600' : null) }, json: async () => ({}) };
      const body = String(init?.body || '');
      try { state.nimBodies.push(JSON.parse(body)); } catch { /* not JSON: ignore */ }
      let content;
      if (body.includes('thesis_driver_assessment') && state.proseFirst > 0) {
        state.proseFirst -= 1;
        content = '**Tier 2: Neutral**\n**Credibility** is unproven; the filing shows mixed results and I would HOLD.';
      }
      else if (body.includes('financial data transcriber') && state.tableJson) content = state.tableJson;
      else if ((body.includes('concall highlight') || body.includes('presentation highlight')) && state.highlightsJson) content = state.highlightsJson;
      else content = JSON.stringify(state.llmVerdict || llmVerdictJson());
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

const baseItem = () => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  stock_id: 'stock-1',
  ticker: 'SHAKTIPUMP',
  company_name: 'Shakti Pumps (India) Limited',
  title: 'Outcome of Board Meeting',
  attachment_url: 'https://nsearchives.nseindia.com/corporate/SHAKTIPUMP_23102026182423_OutcomeofBoardMeeting.pdf',
  filing_date: '2026-10-23T12:55:25.000Z',
  deep_dive_status: 'pending_stage1',
  filing_category: 'QUARTERLY_EARNINGS',
  is_earnings_release: true,
  investment_thesis: JSON.stringify({ primary_thesis: 'Policy-driven scaling fueled by PM-KUSUM; watch working capital.' })
});

const sqlIncludes = (needle) => (c) => c.sql.includes(needle);
/** Names of the per-stage attempt counters that were incremented in the current test. */
const attemptKeys = () => state.calls.filter(c => c.sql.includes('AS attempts')).map(c => c.params[2]);

describe('quarterly deep-dive worker', () => {
  beforeEach(() => {
    state.calls = [];
    state.sends = [];
    state.sendImpl = null;
    state.attempts = 1;
    state.settings = {};
    state.counters = {};
    state.outageFirstAt = null;
    state.outageRetries = 1;
    resetLlmState();
    state.digestStore = new Map();
    state.otherPending = 0;
    state.proseFirst = 0;
    state.llmVerdict = null;
    state.tableJson = null;
    state.highlightsJson = null;
    state.twinFailure = false;
    state.foreignCopies = 0;
    state.transcriptCovers = false;
    state.audioTwin = false;
    state.recentResultsAlert = false;
    state.earlierRecordingItems = [];
    state.marketSnapshot = null;
    state.previousRows = [];
    state.guidanceRows = [];
    state.outcomeRows = [];
    state.boardRows = new Map();
    state.nimBodies = [];
    state.ocrText = '';
    state.pdfFailReason = 'NO_TEXT';
    state.pdfFailDetail = '';
    state.item = baseItem();
    state.docText = shaktiText;
    stubFetch('ok');
  });

  it('the alert never carries two opposite calls: a model sentence stating HOLD is dropped when the gates made the final action REASSESS (HBLENGINE 2026-11-07)', async () => {
    state.llmVerdict = llmVerdictJson({ verdict_summary: 'Profit contracted sharply on a high base while revenue still grew. Given the contraction, a HOLD stance is warranted.' });
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0]).toMatch(/REASSESS/);
    expect(state.sends[0]).not.toMatch(/HOLD stance/);
    // the stored verdict (it feeds the board line and the digests later) no longer states the overridden stance either
    const stored = state.calls.filter((c) => c.sql.includes('UPDATE corporate_announcements') && Array.isArray(c.params)).map((c) => JSON.stringify(c.params)).join(' ');
    expect(stored).not.toMatch(/HOLD stance is warranted/);
    expect(stored).toMatch(/Profit contracted sharply on a high base/);
  });

  it('sends the results alert (no ReferenceError), with verified numbers, gate and thesis driver check, BEFORE marking completed', async () => {
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);

    expect(state.sends).toHaveLength(1);
    const msg = state.sends[0];
    expect(msg).toContain('SHAKTIPUMP');
    expect(msg).toContain('₹746.03 Cr');                // verified consolidated revenue
    expect(msg).toContain('-57.55% YoY');                // verified PAT decline, from the filing
    expect(msg).toContain('THESIS GATE AUDIT');
    expect(msg).toContain('THESIS DRIVER CHECK');
    expect(msg).toContain('🟠');
    // readable order: the signal and its reason first, then the verified numbers, then how they score against the thesis
    expect(msg).toContain('➡️ *Why:*');
    expect(msg.indexOf('ACTION SIGNAL')).toBeLessThan(msg.indexOf('➡️ *Why:*'));
    expect(msg.indexOf('➡️ *Why:*')).toBeLessThan(msg.indexOf('VERIFIED FINANCIALS'));
    expect(msg.indexOf('VERIFIED FINANCIALS')).toBeLessThan(msg.indexOf('THESIS GATE AUDIT'));
    expect(msg.indexOf('THESIS GATE AUDIT')).toBeLessThan(msg.indexOf('THESIS DRIVER CHECK'));
    expect(msg).not.toMatch(/-3642|-65\.6/);             // the old garbage numbers

    const sendIdx = state.calls.findIndex(c => c.sql === '__SEND__');
    // the UPDATE that marks the row completed (a SELECT that merely filters on that status, such as the previous-view lookup, is not it)
    const completedIdx = state.calls.findIndex(c => c.sql.includes("SET deep_dive_status = 'completed'"));
    expect(sendIdx).toBeGreaterThan(-1);
    expect(completedIdx).toBeGreaterThan(sendIdx);       // alert first, completion after
    expect(state.calls.some(c => c.sql.includes("'needs_review'"))).toBe(false);
  });

  it('the results flash is compact: one price line instead of a valuation block, capped lists, no long footer (user: overwhelmed)', async () => {
    state.llmVerdict = {
      verdict_summary: 'Profit fell sharply on lower margins. Revenue held. Management did not explain the fall. A fourth sentence that should not be shown.',
      key_positives: ['Order book remained healthy this quarter', 'Dispatch volumes continued to grow steadily', 'New export customer was added recently', 'Capacity utilisation stayed high overall', 'Fifth positive point here'],
      key_concerns_and_drags: ['Receivable days rose during the period', 'Raw material costs went up again', 'A third concern that should be cut', 'A fourth concern that should be cut'],
      concall_verification_points: ['Why did margins fall during the quarter?', 'When will receivables normalise again?', 'Third query that should be cut']
    };
    state.item.deep_dive_status = 'pending_stage1';
    await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    const msg = state.sends[0];
    expect(msg).not.toContain('LIVE VALUATION');
    expect(msg).not.toContain('Fifth positive point');
    expect(msg).not.toContain('third concern');
    expect(msg).not.toContain('Third query');
    expect(msg).not.toContain('fourth sentence');
    expect(msg).not.toContain('Stage 1 snapshot judged against');
    expect(msg.length).toBeLessThan(3400);
  });

  it('worker LLM calls do not use response_format JSON mode (measured 3.5x slower on llama-3.2-11b: 9.9s -> 35.6s, same output)', async () => {
    await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(state.nimBodies.length).toBeGreaterThan(0);
    for (const body of state.nimBodies) {
      expect(body.response_format).toBeUndefined();
    }
  });

  it('a verdict reply in prose is re-asked once for JSON only, and the filing is still analysed (not dead-lettered)', async () => {
    state.proseFirst = 1;
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    const verdictCalls = state.nimBodies.filter(b => JSON.stringify(b.messages).includes('thesis_driver_assessment'));
    expect(verdictCalls.length).toBe(2);                                   // prose, then the strict re-ask
    expect(JSON.stringify(verdictCalls[1].messages)).toMatch(/not valid JSON/i);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0]).not.toContain('AI narrative unavailable');
  });

  it('a verdict that is prose twice is treated as an LLM failure (retry later), never as a fabricated verdict', async () => {
    state.proseFirst = 99;
    vi.useFakeTimers();
    const run = processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 600000 });
    await vi.runAllTimersAsync();
    const res = await run;
    vi.useRealTimers();
    expect(res.processed).toBe(0);
    expect(state.sends).toHaveLength(0);
    expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(false);
  });

  it('the JSON verdict prompt never embeds the long-form markdown report templates (they make the model answer in prose)', async () => {
    await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    const verdictCalls = state.nimBodies.filter(b => JSON.stringify(b.messages).includes('thesis_driver_assessment'));
    expect(verdictCalls.length).toBeGreaterThan(0);
    for (const b of verdictCalls) {
      const prompt = JSON.stringify(b.messages);
      expect(prompt).not.toContain('Identify every commitment made by management');
      expect(prompt).not.toContain('Biggest Promise Delivered');
      expect(prompt).not.toContain('{{company_metrics}}');
    }
  });

  it('a Telegram outage parks the alert for retry instead of losing it, and the filing is still completed', async () => {
    state.sendImpl = async () => { throw new Error('Telegram API error (429): Too Many Requests'); };
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    const parked = state.calls.find(c => c.sql.includes("'alert_pending', true"));
    expect(parked).toBeDefined();
    expect(parked.params[0]).toContain('SHAKTIPUMP');    // full message text is stored for flushPendingAlerts()
    expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(true);
  });

  it('when every LLM call fails it retries later instead of fabricating a "neutral hold" verdict', async () => {
    stubFetch('fail');
    vi.useFakeTimers();
    const run = processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 600000 });
    await vi.runAllTimersAsync();
    const res = await run;
    vi.useRealTimers();

    expect(res.processed).toBe(0);
    expect(res.failed).toBe(1);
    expect(state.sends).toHaveLength(0);
    expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(false);
    // An AI outage is not the filing's fault: it is recorded as an outage, NOT as a consumed attempt,
    // and the filing is held back (retry_not_before) instead of being retried every cycle.
    expect(attemptKeys()).toEqual([]);
    expect(state.calls.some(c => c.sql.includes('llm_outage_first_at'))).toBe(true);
    const defer = state.calls.find(c => c.sql.includes("'retry_not_before'"));
    expect(defer).toBeTruthy();
    const waitMs = new Date(defer.params[0]).getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(4 * 60 * 1000);
    expect(waitMs).toBeLessThan(6 * 60 * 1000);
  });

  it('an outage that has lasted past the grace period still delivers the verified numbers, with an honest "AI unavailable" banner', async () => {
    stubFetch('fail');
    state.outageFirstAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    state.outageRetries = 8;
    vi.useFakeTimers();
    const run = processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 600000 });
    await vi.runAllTimersAsync();
    const res = await run;
    vi.useRealTimers();

    expect(res.processed).toBe(1);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0]).toContain('AI narrative unavailable');
    expect(state.sends[0]).toContain('₹746.03 Cr');
    expect(attemptKeys()).toEqual([]);
    // The AI never produced a verdict, so the alert must not print a made-up conviction or credibility tier,
    // and the stored snapshot must not carry the placeholder conviction either.
    expect(state.sends[0]).not.toMatch(/Conviction: \d+\/10/);
    expect(state.sends[0]).not.toContain('Credibility');
    const snapshot = state.calls.find(c => c.sql.includes('INSERT INTO quarterly_snapshots'));
    expect(snapshot).toBeTruthy();
    expect(snapshot.params[5]).toBeNull();
  });

  it('attempts are counted per stage: earlier download retries never shorten the AI retry budget', async () => {
    state.attempts = null;
    state.counters = { fetch_attempts: 9 };          // the CDN lagged for 9 cycles, then the PDF downloaded
    state.proseFirst = 99;                           // the AI is up but returns unusable output
    vi.useFakeTimers();
    const run = processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 600000 });
    await vi.runAllTimersAsync();
    const res = await run;
    vi.useRealTimers();
    expect(attemptKeys()).toEqual(['llm_attempts']);
    expect(state.counters.llm_attempts).toBe(1);
    expect(res.processed).toBe(0);                   // first unusable reply: retry later, not an instant degrade
    expect(state.sends).toHaveLength(0);
  });

  it('a prose-only reply (AI up, output unusable) is never mistaken for an AI outage', async () => {
    state.proseFirst = 99;
    vi.useFakeTimers();
    const run = processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 600000 });
    await vi.runAllTimersAsync();
    await run;
    vi.useRealTimers();
    expect(state.calls.some(c => c.sql.includes('llm_outage_first_at'))).toBe(false);
    expect(attemptKeys()).toContain('llm_attempts');
  });

  it('when the AI is up but this filing keeps getting unusable output, attempts count and, once exhausted, verified numbers are still delivered', async () => {
    state.proseFirst = 99;
    state.attempts = 3;
    vi.useFakeTimers();
    const run = processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 600000 });
    await vi.runAllTimersAsync();
    const res = await run;
    vi.useRealTimers();

    expect(res.processed).toBe(1);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0]).toContain('AI narrative unavailable');
    expect(state.sends[0]).toContain('₹746.03 Cr');
    expect(state.sends[0]).not.toContain('Deep-dive completed; maintaining neutral hold signal');
  });

  it('a concall transcript is judged on thesis drivers and delivered as a THESIS STATUS digest, never labelled a thesis deviation', async () => {
    const turn = (who, text) => `${who}: ${text}\n`;
    const transcript = 'Transcript of the Earnings Conference Call held on October 24, 2026\n' +
      turn('Moderator', 'Ladies and gentlemen, welcome to the Shakti Pumps Q2 FY27 earnings call.') +
      Array.from({ length: 60 }, (_, i) => turn('Management', `Point ${i}: dispatch run-rate under PM-KUSUM Component B and C continues; receivable days from state discoms were 128 days and we expect improvement of 10 days by Q4 as subsidy tranches get released.`)).join('') +
      turn('Moderator', 'Question and Answer session begins.');
    state.docText = transcript;
    state.item = { ...baseItem(), title: 'Analysts/Institutional Investor Meet/Con. Call Updates', deep_dive_status: 'pending_stage2', attachment_url: 'https://nsearchives.nseindia.com/corporate/SHAKTIPUMP_Transcript.pdf', is_earnings_release: false };
    // Evidence is only kept when this transcript states it (it says 128 days and a 10-day improvement).
    state.llmVerdict = llmVerdictJson({
      thesis_driver_assessment: [
        { driver: drivers[1].name, status: 'AT_RISK', evidence: 'Receivable days from state discoms were 128 days; improvement of 10 days expected by Q4' },
        { driver: drivers[0].name, status: 'ON_TRACK', evidence: 'Dispatch run-rate under PM-KUSUM Component B and C continues' }
      ]
    });

    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    expect(state.sends).toHaveLength(1);
    const msg = state.sends[0];
    expect(msg).toContain('THESIS STATUS');
    expect(msg).toContain('DRIVER BOARD');
    expect(msg).toContain('Concall transcript');
    expect(msg).toContain('Receivable days from state discoms were 128 days');   // the driver's evidence from THIS call, on the board
    expect(msg).not.toContain('Thesis Deviation');
    expect(msg).not.toContain('Quarterly Results Flash Note');
  });

  describe('thesis digest delivery', () => {
    const transcriptItem = () => {
      const turn = (who, text) => `${who}: ${text}\n`;
      state.docText = 'Transcript of the Earnings Conference Call held on October 24, 2026\n' +
        turn('Moderator', 'Ladies and gentlemen, welcome to the Shakti Pumps Q2 FY27 earnings call.') +
        Array.from({ length: 60 }, (_, i) => turn('Management', `Point ${i}: dispatch run-rate under PM-KUSUM Component B and C continues; receivable days from state discoms were 128 days and we expect improvement of 10 days by Q4 as subsidy tranches get released.`)).join('') +
        turn('Moderator', 'Question and Answer session begins.');
      state.item = { ...baseItem(), title: 'Analysts/Institutional Investor Meet/Con. Call Updates', deep_dive_status: 'pending_stage2', attachment_url: 'https://nsearchives.nseindia.com/corporate/SHAKTIPUMP_Transcript.pdf', is_earnings_release: false };
      // Driver evidence must be grounded in THIS transcript (it states 128 days and a 10-day improvement), or it is withdrawn.
      state.llmVerdict = llmVerdictJson({
        thesis_driver_assessment: [
          { driver: drivers[1].name, status: 'AT_RISK', evidence: 'Receivable days from state discoms were 128 days; improvement of 10 days expected by Q4' },
          { driver: drivers[0].name, status: 'ON_TRACK', evidence: 'Dispatch run-rate under PM-KUSUM Component B and C continues' }
        ]
      });
    };
    const run = () => processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });

    it('results filings are NOT digested: they go out immediately with the gate, and nothing is queued', async () => {
      await run();
      expect(state.sends).toHaveLength(1);
      expect(state.sends[0]).toContain('THESIS GATE AUDIT');
      expect(state.digestStore.size).toBe(0);
    });

    it('the digest item is persisted BEFORE the filing is marked completed, and delivered after it is queued', async () => {
      transcriptItem();
      await run();
      const queuedIdx = state.calls.findIndex(c => c.sql.includes("'digest_pending', true"));
      const sendIdx = state.calls.findIndex(c => c.sql === '__SEND__');
      const completedIdx = state.calls.findIndex(c => c.sql.includes("SET deep_dive_status = 'completed'"));
      expect(queuedIdx).toBeGreaterThan(-1);
      expect(completedIdx).toBeGreaterThan(queuedIdx);
      expect(sendIdx).toBeGreaterThan(queuedIdx);
      expect(state.digestStore.get('aaaaaaaa-0000-0000-0000-000000000001').sent).toBe(true);
      expect(state.calls.some(c => c.sql.includes('digest_sent_at'))).toBe(true);
    });

    it('the digest goes out BEFORE the slow optional follow-ups (syntheses / audits) start, not after them (I1)', async () => {
      transcriptItem();
      await run();
      const sendIdx = state.calls.findIndex(c => c.sql === '__SEND__');
      // First optional follow-up of processOneDeepDive (step 10); it always runs, so the ordering below is meaningful.
      const followUpIdx = state.calls.findIndex(c => c.sql.includes("FROM management_commitments WHERE ticker = $1 AND status = 'Pending'"));
      expect(sendIdx).toBeGreaterThan(-1);
      expect(followUpIdx).toBeGreaterThan(-1);
      expect(sendIdx).toBeLessThan(followUpIdx);
    });

    it('two filings of one stock finishing together never double-send the digest (flushes are serialised)', async () => {
      transcriptItem();
      state.digestStore.set('aaaaaaaa-0000-0000-0000-000000000001', { id: 'aaaaaaaa-0000-0000-0000-000000000001', ticker: 'SHAKTIPUMP', company_name: 'Shakti Pumps (India) Limited', filing_date: '2026-10-23T12:55:25.000Z', digest_item: { kind: 'CONCALL', title: 'Transcript', queuedAt: new Date().toISOString(), filedAt: '2026-10-23T12:55:25.000Z', assessment: [] } });
      const [a, b] = await Promise.all([flushThesisDigests(), flushThesisDigests()]);
      expect(a + b).toBe(1);
      expect(state.sends).toHaveLength(1);
    });

    it('a Telegram outage keeps the digest queued (nothing marked sent) and the next flush delivers it', async () => {
      transcriptItem();
      state.sendImpl = async () => { throw new Error('Telegram API error (429): Too Many Requests'); };
      const res = await run();
      expect(res.processed).toBe(1);
      expect(state.sends).toHaveLength(0);
      expect(state.digestStore.get('aaaaaaaa-0000-0000-0000-000000000001').sent).toBeUndefined();
      expect(state.calls.some(c => c.sql.includes('digest_sent_at'))).toBe(false);

      state.sendImpl = null;
      expect(await flushThesisDigests()).toBe(1);
      expect(state.sends).toHaveLength(1);
      expect(state.sends[0]).toContain('THESIS STATUS');
    });

    it('waits while a sibling filing of the same stock is still being processed, but never longer than the max wait', async () => {
      transcriptItem();
      state.otherPending = 1;
      await run();
      expect(state.sends).toHaveLength(0);
      expect(await flushThesisDigests({ now: Date.now() + 31 * 60 * 1000 })).toBe(1);
      expect(state.sends).toHaveLength(1);
    });

    describe('volume: fewer messages (deck + press release batched, repeats folded, price context shown)', () => {
      const mkItem = (id, kind, extra = {}, queuedMinAgo = 1) => {
        const queuedAt = new Date(Date.now() - queuedMinAgo * 60_000).toISOString();
        state.digestStore.set(id, { id, ticker: 'SHAKTIPUMP', company_name: 'Shakti Pumps (India) Limited', filing_date: '2026-10-24T10:00:00.000Z', digest_item: { kind, title: kind === 'PRESS' ? 'Press Release' : kind === 'DECK' ? 'Investor Presentation' : 'Transcript', url: `https://example.test/${id}.pdf`, filedAt: '2026-10-24T10:00:00.000Z', queuedAt, summary: 'Revenue up 12%.', positives: ['PAT up 9%'], concerns: [], guidance: [], commitmentFlags: [], assessment: [], ...extra } });
      };

      const H = 60;

      it('after an alerted results statement, a deck / press release is held (no message yet), and goes out ONCE, together, after 24 h if no call has come', async () => {
        state.item = baseItem();
        state.recentResultsAlert = true;
        mkItem('p1', 'PRESS', { positives: ['Capex of Rs 80 Cr announced'], growthInitiatives: ['New line'] }, 5 * H);
        mkItem('d1', 'DECK', {}, 2 * H);
        expect(await flushThesisDigests()).toBe(0);
        expect(state.sends).toHaveLength(0);
        // 20 h later the OLDEST item (the press release, queued 5 h before) is 25 h old, so the hold is over: one message, both filings
        expect(await flushThesisDigests({ now: Date.now() + 20 * H * 60_000 })).toBe(1);
        expect(state.sends).toHaveLength(1);
        expect(state.sends[0]).toContain('Press Release');
        expect(state.sends[0]).toContain('Investor Presentation');
      });

      it('the call arriving releases the held deck: deck, press release and call go out as ONE message', async () => {
        state.item = baseItem();
        state.recentResultsAlert = true;
        mkItem('p1', 'PRESS', { growthInitiatives: ['New line'] }, 6 * H);
        mkItem('d1', 'DECK', {}, 5 * H);
        mkItem('c1', 'CONCALL', { highlights: { guidance_changes: ['Margin guide: 27-28% -> 29-30% (raised)'] } }, 1);
        expect(await flushThesisDigests()).toBe(1);
        expect(state.sends).toHaveLength(1);
        expect(state.sends[0]).toContain('Press Release');
        expect(state.sends[0]).toContain('Investor Presentation');
        expect([...state.digestStore.values()].every(r => r.sent)).toBe(true);
      });

      it('urgent news is not held for the call: a deck with a guidance cut goes out immediately', async () => {
        state.item = baseItem();
        state.recentResultsAlert = true;
        mkItem('d1', 'DECK', { guidanceCuts: ['Revenue growth outlook 1.5-2x -> 1.2-1.5x (cut)'], highlights: { guidance_changes: ['Revenue growth outlook 1.5-2x -> 1.2-1.5x (cut)'] } }, 3);
        expect(await flushThesisDigests()).toBe(1);
        expect(state.sends).toHaveLength(1);
        expect(state.sends[0]).toContain('cut');
      });

      it('a press release that only restates the results is folded once its 24 h hold is over: nothing sent, the row records why', async () => {
        state.item = baseItem();
        state.recentResultsAlert = true;
        mkItem('p1', 'PRESS', {}, 25 * H);
        expect(await flushThesisDigests()).toBe(0);
        expect(state.sends).toHaveLength(0);
        const row = state.digestStore.get('p1');
        expect(row.sent).toBe(true);
        expect(String(row.folded)).toMatch(/restates the results/i);
      });

      it('without an alerted results statement nothing is held or folded (old behaviour)', async () => {
        state.item = baseItem();
        mkItem('p1', 'PRESS', {}, 1);
        expect(await flushThesisDigests()).toBe(1);
        expect(state.sends).toHaveLength(1);
      });

      it('the written transcript of a call already written up from its recording is folded when it adds no new figure', async () => {
        state.item = baseItem();
        state.earlierRecordingItems = [{ kind: 'CONCALL', source: 'audio', highlights: { guidance_changes: ['Revenue growth outlook: 1.5-2x -> 1.2-1.5x (cut)'], financial_performance: ['Revenue Rs 2,827.3 mn up 16.9%'] } }];
        mkItem('t1', 'CONCALL', { highlights: { guidance_changes: ['Growth guidance lowered to 1.2-1.5x from 1.5-2x'], financial_performance: ['Revenue of 2,827.3 million, growth 16.9%'] } }, 1);
        expect(await flushThesisDigests()).toBe(0);
        expect(state.sends).toHaveLength(0);
        expect(String(state.digestStore.get('t1').folded)).toMatch(/recording/i);
      });

      it('a transcript with a figure the recording write-up lacked is sent', async () => {
        state.item = baseItem();
        state.earlierRecordingItems = [{ kind: 'CONCALL', source: 'audio', highlights: { guidance_changes: ['Revenue growth outlook: 1.5-2x -> 1.2-1.5x (cut)'] } }];
        mkItem('t1', 'CONCALL', { highlights: { guidance_changes: ['Export share targeted at 18% by FY28'] } }, 1);
        expect(await flushThesisDigests()).toBe(1);
        expect(state.sends).toHaveLength(1);
      });

      it('the message carries the live price line from the latest market snapshot', async () => {
        state.item = baseItem();
        state.marketSnapshot = { share_price: '2222', pe_ratio: '37.5', market_cap: '7164', market_data_as_of: new Date().toISOString() };
        mkItem('t1', 'CONCALL', {}, 1);
        expect(await flushThesisDigests()).toBe(1);
        expect(state.sends[0]).toContain('CMP ₹2,222');
        expect(state.sends[0]).toContain('P/E 37.5');
      });
    });

    it('several queued filings of one stock go out as ONE message', async () => {
      state.item = baseItem();
      const queuedAt = new Date().toISOString();
      const mk = (id, kind, title, summary) => state.digestStore.set(id, { id, ticker: 'SHAKTIPUMP', company_name: 'Shakti Pumps (India) Limited', filing_date: '2026-10-24T10:00:00.000Z', digest_item: { kind, title, url: `https://example.test/${id}.pdf`, filedAt: '2026-10-24T10:00:00.000Z', queuedAt, summary, positives: [], concerns: [], guidance: [], commitmentFlags: [], assessment: [{ driver: drivers[0].name, status: 'ON_TRACK', evidence: 'Dispatch volumes continued under PM-KUSUM in the quarter', materiality: 'HIGH', grounded: true }] } });
      mk('d1', 'DECK', 'Investor Presentation', 'Deck shows installations up 24% sequentially.');
      mk('d2', 'CONCALL', 'Earnings Call Transcript', 'Management expects receivable days to improve by Q4.');
      expect(await flushThesisDigests()).toBe(1);
      expect(state.sends).toHaveLength(1);
      expect(state.sends[0]).toContain('Investor Presentation');
      expect(state.sends[0]).toContain('Earnings Call Transcript');
      expect(state.sends[0]).toContain('Dispatch volumes continued under PM-KUSUM');
      expect([...state.digestStore.values()].every(r => r.sent)).toBe(true);
    });
  });

  describe('allocation gate: only what changes the view is pushed; the rest waits on the end-of-day board (user: "only important info useful for share allocation")', () => {
    const ID = 'aaaaaaaa-0000-0000-0000-000000000001';
    const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
    // the Shakti statement with a benign profit (88.00 vs 90.71 a year ago) instead of the -57% fall: no surprise to report
    const benignText = () => shaktiText.replace(/38\.51/g, '88.00').replace(/49\.53/g, '118.00');
    const prevRow = (o = {}) => ({ action: 'HOLD / MONITOR', conviction: '5', hurdle: null, assessment: [], guidance: null, judged_at: daysAgo(30), ...o });
    const holdVerdict = () => ({
      ...llmVerdictJson(), action_signal: 'HOLD', final_action: 'HOLD', conviction_score: 5,
      thesis_driver_assessment: [{ driver: drivers[0].name, status: 'ON_TRACK', evidence: 'Dispatch volumes continued under PM-KUSUM in the quarter per management' }]
    });
    // what the real gate concludes for this statement (the Shakti hurdles are not met): REASSESS THESIS, conviction 4
    const sameView = () => prevRow({ action: 'REASSESS THESIS', conviction: '4' });
    const runFlash = () => processPendingDeepDives({ announcementIds: [ID], deadlineAt: Date.now() + 20000 });

    beforeEach(() => { process.env.ALLOCATION_GATE = 'on'; });
    afterEach(() => { process.env.ALLOCATION_GATE = 'off'; });

    it('results that leave the view unchanged are NOT pushed: recorded on the row for the board, and the filing still completes', async () => {
      state.docText = benignText();
      state.llmVerdict = holdVerdict();
      state.previousRows = [sameView()];
      const res = await runFlash();
      expect(res.processed).toBe(1);
      expect(state.sends).toHaveLength(0);
      expect(state.boardRows.get(ID)?.bi).toMatchObject({ ticker: 'SHAKTIPUMP', kinds: ['RESULTS'], stance: 'REASSESS THESIS' });
      const boardIdx = state.calls.findIndex(c => c.sql.includes("'board_pending', true"));
      const completedIdx = state.calls.findIndex(c => c.sql.includes("SET deep_dive_status = 'completed'"));
      expect(boardIdx).toBeGreaterThan(-1);
      expect(completedIdx).toBeGreaterThan(boardIdx);   // recorded BEFORE it is marked completed (a restart cannot lose it)
    });

    it('the previous view is the last judgement made on VERIFIED numbers: a later deck / press release re-grade without numbers does not replace it (9 same-stock conflicts in 21 days: results said REASSESS, a deck then said HOLD)', async () => {
      state.docText = benignText();
      state.llmVerdict = holdVerdict();
      state.previousRows = [
        prevRow({ action: 'HOLD / MONITOR', conviction: '5', has_fin: false, judged_at: daysAgo(5) }),                  // newest: a deck, no verified numbers (outside the 72 h damper)
        prevRow({ action: 'REASSESS THESIS', conviction: '4', has_fin: true, judged_at: daysAgo(8) })                   // the results judgement
      ];
      await runFlash();
      // the flash concludes REASSESS 4/10; against the authoritative REASSESS 4/10 that is no change (against the deck's HOLD it would have been pushed)
      expect(state.sends).toHaveLength(0);
      expect(state.boardRows.get(ID)?.bi).toMatchObject({ stance: 'REASSESS THESIS' });
    });

    it('a stance change is pushed, with the allocation line first', async () => {
      state.docText = benignText();
      state.llmVerdict = holdVerdict();
      state.previousRows = [prevRow({ action: 'BUY / ACCUMULATE', conviction: '8', judged_at: daysAgo(40) })];
      await runFlash();
      expect(state.sends).toHaveLength(1);
      expect(state.sends[0]).toContain('ALLOCATION');
      expect(state.sends[0]).toMatch(/BUY \/ ACCUMULATE.*REASSESS THESIS/);
      expect(state.sends[0].indexOf('ALLOCATION')).toBeLessThan(state.sends[0].indexOf('ACTION SIGNAL'));
      expect(state.boardRows.size).toBe(0);
    });

    it('a downside surprise (profit -57%) is pushed even though the stance is unchanged', async () => {
      state.llmVerdict = holdVerdict();
      state.previousRows = [sameView()];
      await runFlash();
      expect(state.sends).toHaveLength(1);
      expect(state.sends[0]).toMatch(/profit -57/);
    });

    it('an unknown previous view (lookup failed) pushes rather than hides', async () => {
      state.docText = benignText();
      state.llmVerdict = holdVerdict();
      const { pool } = await import('../db/pool.js');
      const real = vi.mocked(pool.query).getMockImplementation();
      vi.mocked(pool.query).mockImplementation(async (sql, params) => {
        if (String(sql).includes("'previous_view' AS tag")) throw new Error('db down');
        return real(sql, params);
      });
      try { await runFlash(); } finally { vi.mocked(pool.query).mockImplementation(real); }
      expect(state.sends).toHaveLength(1);
      expect(state.sends[0]).toContain('could not be loaded');
    });

    it('the kill switch ALLOCATION_GATE=off restores "every filing is pushed"', async () => {
      process.env.ALLOCATION_GATE = 'off';
      state.docText = benignText();
      state.llmVerdict = holdVerdict();
      state.previousRows = [sameView()];
      await runFlash();
      expect(state.sends).toHaveLength(1);
      expect(state.boardRows.size).toBe(0);
    });

    describe('decks, calls and recordings (digest)', () => {
      const mk = (id, kind, extra = {}) => state.digestStore.set(id, { id, ticker: 'SHAKTIPUMP', company_name: 'Shakti Pumps (India) Limited', filing_date: '2026-10-24T10:00:00.000Z', digest_item: { kind, title: kind === 'DECK' ? 'Investor Presentation' : 'Transcript', url: 'https://example.test/' + id + '.pdf', filedAt: '2026-10-24T10:00:00.000Z', queuedAt: new Date().toISOString(), summary: 'Management reiterated the plan.', positives: ['Order book healthy'], concerns: [], guidance: [], commitmentFlags: [], assessment: [], action: 'HOLD / MONITOR', conviction: 5, ...extra } });

      it('a deck / call that says nothing new goes to the board, not to Telegram', async () => {
        state.item = baseItem();
        state.previousRows = [prevRow()];
        mk('d1', 'DECK');
        expect(await flushThesisDigests()).toBe(0);
        expect(state.sends).toHaveLength(0);
        expect(state.boardRows.get('d1')?.bi).toMatchObject({ ticker: 'SHAKTIPUMP', kinds: ['DECK'] });
      });

      it('a deck that CUTS guidance is pushed at once with the guidance change in the allocation line (no 24 h hold)', async () => {
        state.item = baseItem();
        state.recentResultsAlert = true;
        state.previousRows = [prevRow()];
        mk('d1', 'DECK', { highlights: { guidance_changes: ['Revenue growth outlook: 1.5-2x -> 1.2-1.5x (cut)'] }, guidanceCuts: ['Revenue growth outlook: 1.5-2x -> 1.2-1.5x (cut)'] });
        expect(await flushThesisDigests()).toBe(1);
        expect(state.sends[0]).toContain('ALLOCATION');
        expect(state.sends[0]).toMatch(/guidance cut/i);
      });

      it('a guidance change already stated earlier (the call) is not pushed again by the deck that repeats it', async () => {
        state.item = baseItem();
        state.previousRows = [prevRow({ judged_at: daysAgo(1), guidance: ['Revenue growth outlook: 1.5-2x -> 1.2-1.5x (cut)'] })];
        mk('d1', 'DECK', { highlights: { guidance_changes: ['Growth guidance lowered to 1.2-1.5x from 1.5-2x (cut)'] } });
        expect(await flushThesisDigests()).toBe(0);
        expect(state.sends).toHaveLength(0);
        expect(state.boardRows.has('d1')).toBe(true);
      });

      it('a deck cannot flip the stance by itself (same-day flip-flop damper): a REASSESS read from a deck stays on the board', async () => {
        state.item = baseItem();
        state.previousRows = [prevRow({ action: 'HOLD / MONITOR' })];
        mk('d1', 'DECK', { action: 'REASSESS THESIS', conviction: 3 });
        expect(await flushThesisDigests()).toBe(0);
        expect(state.boardRows.has('d1')).toBe(true);
      });
    });

    describe('the end-of-day allocation board', () => {
      const park = (id, entry) => state.boardRows.set(id, { bi: entry, sent: false });
      const IST = (h, m = 0) => Date.parse('2026-11-06T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00+05:30');

      it('sends ONE message at 18:00 IST listing every parked filing by stock, and marks them sent', async () => {
        park('b1', { ticker: 'SJS', kinds: ['PRESS', 'DECK'], stance: 'HOLD / MONITOR', conviction: 6, gist: 'Nothing changes the view.' });
        park('b2', { ticker: 'TIMETECHNO', kinds: ['CONCALL'], stance: 'HOLD / MONITOR', conviction: 5, gist: 'Call confirms the margin guide.' });
        expect(await flushAllocationBoard({ now: IST(17, 30) })).toBe(0);
        expect(state.sends).toHaveLength(0);
        expect(await flushAllocationBoard({ now: IST(18, 5) })).toBe(1);
        expect(state.sends).toHaveLength(1);
        expect(state.sends[0]).toContain('ALLOCATION BOARD');
        expect(state.sends[0]).toContain('SJS');
        expect(state.sends[0]).toContain('TIMETECHNO');
        expect([...state.boardRows.values()].every(v => v.sent)).toBe(true);
        expect(state.settings.allocation_board_last_sent).toMatchObject({ ymd: '2026-11-06' });
      });

      it('sends nothing when nothing is parked, and only once a day', async () => {
        expect(await flushAllocationBoard({ now: IST(19) })).toBe(0);
        park('b1', { ticker: 'SJS', kinds: ['DECK'], stance: 'HOLD / MONITOR', conviction: 6, gist: 'x' });
        state.settings.allocation_board_last_sent = { ymd: '2026-11-06' };
        expect(await flushAllocationBoard({ now: IST(19) })).toBe(0);
        expect(state.sends).toHaveLength(0);
      });

      it('a failed send keeps the filings parked for the next cycle', async () => {
        park('b1', { ticker: 'SJS', kinds: ['DECK'], stance: 'HOLD / MONITOR', conviction: 6, gist: 'x' });
        state.sendImpl = async () => { throw new Error('Telegram API error (429)'); };
        expect(await flushAllocationBoard({ now: IST(19) })).toBe(0);
        expect(state.boardRows.get('b1').sent).toBe(false);
        state.sendImpl = null;
        expect(await flushAllocationBoard({ now: IST(19, 10) })).toBe(1);
      });
    });
  });

  describe('guidance pacing in the results flash (year to date vs the full-year guide)', () => {
    const ID = 'aaaaaaaa-0000-0000-0000-000000000001';
    const guide = (statement, metric, target_value) => ({ statement, metric, target_value, timeline: 'FY27', quarter: 'Q4 FY26', created_at: '2026-05-20T10:00:00Z' });
    const run = () => processPendingDeepDives({ announcementIds: [ID], deadlineAt: Date.now() + 20000 });

    it('a growth guide the half-year is behind on is shown with the growth the rest of the year must deliver (Shakti H1 +24.5%; guide 35-40% needs +44.6% in H2)', async () => {
      state.guidanceRows = [guide('Full year FY27 revenue growth guidance of 35-40%.', 'Revenue growth FY27', '35-40%')];
      await run();
      const msg = state.sends[0];
      expect(msg).toContain('GUIDANCE PACING (FY27, H1 done)');
      expect(msg).toMatch(/BEHIND/);
      expect(msg).toContain('H1 +24.5%');
      expect(msg).toContain('H2 needs +44.6%');
    });

    it('is stored on the verdict so the next filing can compare, and the old quarter-only annual pacing line is not shown next to it', async () => {
      state.guidanceRows = [guide('Full year FY27 revenue growth guidance of 35-40%.', 'Revenue growth FY27', '35-40%')];
      await run();
      const upd = state.calls.find(c => String(c.params?.[1] || '').includes('"guidance_pacing"'));
      expect(upd).toBeTruthy();
      expect(JSON.parse(upd.params[1]).institutional_verdict.guidance_pacing[0]).toMatchObject({ kind: 'REVENUE_GROWTH', fy: 'FY27', status: 'BEHIND' });
      expect(state.sends[0]).not.toMatch(/ANNUAL PACING (?:ACTIVE|BEHIND|AHEAD)/);
    });

    it('no guidance on file, no pacing block (and nothing breaks)', async () => {
      await run();
      expect(state.sends[0]).not.toContain('GUIDANCE PACING');
    });

    it('with the gate on, a pacing that is BEHIND on first reading is a reason to push', async () => {
      process.env.ALLOCATION_GATE = 'on';
      try {
        state.guidanceRows = [guide('Full year FY27 revenue growth guidance of 35-40%.', 'Revenue growth FY27', '35-40%')];
        state.previousRows = [{ action: 'REASSESS THESIS', conviction: '4', hurdle: null, assessment: [], guidance: null, pacing: null, has_fin: true, judged_at: new Date(Date.now() - 30 * 86400000).toISOString() }];
        await run();
        expect(state.sends).toHaveLength(1);
        expect(state.sends[0]).toMatch(/ALLOCATION.*guidance pacing: Revenue growth FY27 guide .* is BEHIND/s);
      } finally { process.env.ALLOCATION_GATE = 'off'; }
    });
  });

  describe('guidance tracking in the database (pacing history, year-end outcomes, verified track record)', () => {
    const ID = 'aaaaaaaa-0000-0000-0000-000000000001';
    const guide = (statement, metric, target_value, extra = {}) => ({ id: 'cid-' + metric, statement, metric, target_value, timeline: 'FY27', quarter: 'Q4 FY26', created_at: '2026-05-20T10:00:00Z', ...extra });
    const run = () => processPendingDeepDives({ announcementIds: [ID], deadlineAt: Date.now() + 20000 });
    const inserts = (table) => state.calls.filter(c => c.sql.includes('INSERT INTO ' + table));

    it('a half-year reading is stored per guide with its status and numbers (idempotent upsert keyed by stock, year, kind and quarter end)', async () => {
      state.guidanceRows = [guide('Full year FY27 revenue growth guidance of 35-40%.', 'Revenue growth FY27', '35-40%')];
      await run();
      const ins = inserts('guidance_pacing_history');
      expect(ins).toHaveLength(1);
      expect(ins[0].sql).toMatch(/ON CONFLICT \(ticker, fiscal_year, kind, as_of\) DO UPDATE/);
      const [ticker, fy, kind, asOf, ytdLabel, status] = ins[0].params;
      expect([ticker, fy, kind, ytdLabel, status]).toEqual(['SHAKTIPUMP', 'FY27', 'REVENUE_GROWTH', 'H1', 'BEHIND']);
      expect(String(asOf)).toMatch(/2026-09-30/);
      expect(ins[0].params[12]).not.toMatch(/\*/);   // stored as plain text
    });

    it('a March-quarter statement JUDGES the year: the original guide is MISSED, the revised one MET, both are stored, and the alert shows the outcome', async () => {
      state.item = { ...baseItem(), filing_date: '2027-05-20T12:00:00.000Z' };
      state.docText = fs.readFileSync(path.resolve(here, 'fixtures/q4-five-column-synthetic.txt'), 'utf8') + '\n' + 'Outcome of Board Meeting. The Board approved the audited results for the year. '.repeat(6);
      state.guidanceRows = [
        guide('Revised: FY27 full year revenue growth of 15-18%.', 'Revenue growth FY27', '15-18%', { id: 'c-last', created_at: '2026-11-05T10:00:00Z' }),
        guide('FY27 full year revenue growth of 25-28%.', 'Revenue growth FY27', '25-28%', { id: 'c-first', created_at: '2026-05-20T10:00:00Z' })
      ];
      await run();
      expect(state.sends[0]).toContain('GUIDANCE OUTCOME (FY27 full year)');
      expect(state.sends[0]).toMatch(/MET.*Revenue growth FY27 guide 15–18% growth: delivered \+19\.2%/);
      const outcomes = inserts('guidance_outcomes');
      expect(outcomes).toHaveLength(2);
      const byInitial = Object.fromEntries(outcomes.map(o => [o.params[3], o.params[4]]));   // initial -> status
      expect(byInitial).toEqual({ true: 'MISSED', false: 'MET' });
      expect(outcomes.find(o => o.params[3] === true).params[8]).toBe('c-first');
    });

    it('a missing tracking table never blocks the alert', async () => {
      state.guidanceRows = [guide('Full year FY27 revenue growth guidance of 35-40%.', 'Revenue growth FY27', '35-40%')];
      const { pool } = await import('../db/pool.js');
      const real = vi.mocked(pool.query).getMockImplementation();
      vi.mocked(pool.query).mockImplementation(async (sql, params) => {
        if (String(sql).includes('guidance_pacing_history') || String(sql).includes('guidance_outcomes')) throw new Error('relation "guidance_outcomes" does not exist');
        return real(sql, params);
      });
      try { await run(); } finally { vi.mocked(pool.query).mockImplementation(real); }
      expect(state.sends).toHaveLength(1);
      expect(state.sends[0]).toContain('GUIDANCE PACING');
    });

    it('the verified track record of the ORIGINAL guides is shown in the alert, misses first; with none recorded there is no line', async () => {
      await run();
      expect(state.sends[0]).not.toContain('TRACK RECORD');
      state.sends.length = 0;
      state.outcomeRows = [
        { fiscal_year: 'FY26', kind: 'REVENUE_GROWTH', status: 'MET', guided_text: '15–18% growth' },
        { fiscal_year: 'FY26', kind: 'EBITDA_MARGIN', status: 'MISSED', guided_text: '16%' }
      ];
      await run();
      expect(state.sends[0]).toContain('GUIDANCE TRACK RECORD');
      expect(state.sends[0]).toMatch(/1 of 2 met, 1 missed/);
    });
  });

  describe('system check (self-audit): reports silent failures once a day, only when something is wrong', () => {
    const IST = (h) => Date.parse('2026-11-06T' + String(h).padStart(2, '0') + ':00:00+05:30');
    // the audit (correctly) reports a switched-off gate, and this suite runs with it off: switch it on for these tests
    beforeEach(() => { state.healthStuck = []; process.env.ALLOCATION_GATE = 'on'; });
    afterEach(() => { process.env.ALLOCATION_GATE = 'off'; });

    it('reports the allocation gate being switched off', async () => {
      process.env.ALLOCATION_GATE = 'off';
      expect(await flushHealthReport({ now: IST(20) })).toBe(1);
      expect(state.sends[0]).toMatch(/gate is switched OFF/);
    });

    it('stays silent when everything is fine, and before 19:00 IST', async () => {
      expect(await flushHealthReport({ now: IST(20) })).toBe(0);
      state.healthStuck = [{ ticker: 'SJS', status: 'pending_stage1', age_hours: 9 }];
      expect(await flushHealthReport({ now: IST(18) })).toBe(0);
      expect(state.sends).toHaveLength(0);
    });

    it('sends ONE message naming what is stuck, remembers it, and does not repeat the same report the same day', async () => {
      state.healthStuck = [{ ticker: 'SJS', status: 'pending_stage1', age_hours: 9 }];
      expect(await flushHealthReport({ now: IST(20) })).toBe(1);
      expect(state.sends).toHaveLength(1);
      expect(state.sends[0]).toContain('SYSTEM CHECK');
      expect(state.sends[0]).toContain('SJS');
      expect(state.settings.pipeline_health_last).toMatchObject({ ymd: '2026-11-06', fingerprint: 'FILINGS_STUCK' });
      expect(await flushHealthReport({ now: IST(21) })).toBe(0);
      expect(state.sends).toHaveLength(1);
    });

    it('a failed send is retried (nothing is recorded as sent)', async () => {
      state.healthStuck = [{ ticker: 'SJS', status: 'pending_stage1', age_hours: 9 }];
      state.sendImpl = async () => { throw new Error('Telegram API error (429)'); };
      expect(await flushHealthReport({ now: IST(20) })).toBe(0);
      expect(state.settings.pipeline_health_last).toBeUndefined();
      state.sendImpl = null;
      expect(await flushHealthReport({ now: IST(20) })).toBe(1);
    });
  });

  describe('free-tier rate limits (429): pause the queue, then resume one filing at a time, results first', () => {
    const MIN = 60 * 1000;
    const pauseState = () => state.settings.llm_quota_pause;
    const queueSelects = () => state.calls.filter(c => c.sql.includes('deep_dive_status = ANY'));

    it('when every provider rate-limits the call, the whole queue is paused (escalating) and the filing is deferred without consuming attempts', async () => {
      stubFetch('429');
      vi.useFakeTimers();
      const p = processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 600000 });
      await vi.runAllTimersAsync();
      await p;
      vi.useRealTimers();
      expect(pauseState()).toBeTruthy();
      expect(pauseState().count).toBe(1);
      expect(pauseState().until).toBeGreaterThan(Date.now() + 9 * MIN);          // at least the first pause step
      expect(attemptKeys()).toEqual([]);                                         // a rate limit never costs the filing an attempt
      expect(state.sends).toHaveLength(0);
    });

    it('a second rate-limited cycle pauses longer', async () => {
      state.settings.llm_quota_pause = { until: Date.now() - 1000, count: 1 };   // the first pause just ended
      stubFetch('429');
      vi.useFakeTimers();
      const p = processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 600000 });
      await vi.runAllTimersAsync();
      await p;
      vi.useRealTimers();
      expect(pauseState().count).toBe(2);
      expect(pauseState().until).toBeGreaterThan(Date.now() + 29 * MIN);
    });

    it('while a pause is running the queue is not even read: no filing hits the exhausted quota (alerts and digests that need no AI still go out)', async () => {
      state.settings.llm_quota_pause = { until: Date.now() + 30 * MIN, count: 1 };
      const res = await processPendingDeepDives({ deadlineAt: Date.now() + 20000 });
      expect(queueSelects()).toHaveLength(0);
      expect(res.paused).toBe(true);
      expect(res.processed).toBe(0);
      expect(state.calls.some(c => c.sql.includes("event_analysis->>'digest_pending'"))).toBe(true);   // the no-AI digest flush still ran
    });

    it('after a pause the queue works ONE filing at a time, and results are taken before decks and notices', async () => {
      state.settings.llm_quota_pause = { until: Date.now() - 1000, count: 2 };
      await processPendingDeepDives({ deadlineAt: Date.now() + 20000 });
      const select = queueSelects()[0];
      expect(select).toBeTruthy();
      expect(select.sql).toMatch(/LIMIT 1\b/);
      expect(select.sql).toMatch(/ORDER BY\s+\(?CASE WHEN ca\.is_earnings_release/i);
    });

    it('normally the queue still takes a batch of four, results first', async () => {
      await processPendingDeepDives({ deadlineAt: Date.now() + 20000 });
      const select = queueSelects()[0];
      expect(select.sql).toMatch(/LIMIT 4\b/);
      expect(select.sql).toMatch(/ORDER BY\s+\(?CASE WHEN ca\.is_earnings_release/i);
    });

    it('a successful filing clears the pause, so the queue returns to normal batches', async () => {
      state.settings.llm_quota_pause = { until: Date.now() - 1000, count: 2 };
      const res = await processPendingDeepDives({ deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      expect(pauseState()).toEqual({ until: 0, count: 0 });
    });
  });

  describe('what counts as a results statement (live SKIPPER dry run, 2026-10-31)', () => {
    const coverLetter = [
      'Skipper Limited. Outcome of Board Meeting held on 30 October 2026.',
      'The Board approved the Unaudited Standalone and Consolidated Financial Results of the Company for the quarter and half year ended 30th September 2026,',
      'together with the Limited Review Reports of the Statutory Auditors. The Board also approved the acquisition of a wholly owned subsidiary.',
      'The meeting commenced at 1:30 PM and concluded at 4:05 PM. The financial results statements are attached to this letter.'
    ].join('\n');
    const runOne = async () => {
      vi.useFakeTimers();
      const p = processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 600000 });
      await vi.runAllTimersAsync();
      const res = await p;
      vi.useRealTimers();
      return res;
    };
    const forcedOcrCalls = () => vi.mocked(extractPdfTextDetailed).mock.calls.filter(c => c[1]?.forceOcr).length;

    it('an investor presentation that mentions results is a deck, never an "unreadable results statement" (it was retried for hours, then dead-lettered with a false failure alert)', async () => {
      state.item = { ...baseItem(), title: 'Investor Presentation', attachment_url: 'https://nsearchives.nseindia.com/corporate/skipper_30102026142803_INVESTORPRESENTATION.pdf', deep_dive_status: 'pending_stage1' };
      // a deck page that quotes the results table, in a layout the parser cannot read
      state.docText = shaktiText.replace(/Revenue from operations/g, 'Turnover (net)').replace(/Profit before tax/g, 'PBT').replace(/Profit for the period\/year/g, 'Net result') + '\nInvestor Presentation Q2 FY27 financial results highlights';
      vi.mocked(sendPipelineFailureAlert).mockClear();
      await runOne();
      expect(attemptKeys()).not.toContain('unreadable_attempts');
      expect(vi.mocked(sendPipelineFailureAlert)).not.toHaveBeenCalled();
      expect(state.calls.some(c => c.sql.includes("'digest_pending', true"))).toBe(true);   // queued for the thesis-status digest
    });

    it('a press release that quotes results is not a statement either', async () => {
      state.item = { ...baseItem(), title: 'Press Release', attachment_url: 'https://nsearchives.nseindia.com/corporate/skipper_30102026171617_pressreleasefinal.pdf', deep_dive_status: 'pending_stage1' };
      state.docText = 'Press Release. Unaudited financial results Q2 FY27. Revenue from operations grew 10% to Rs 1,384 crore; total income rose; profit before tax up 40%.\n' + 'x'.repeat(300);
      await runOne();
      expect(attemptKeys()).not.toContain('unreadable_attempts');
      expect(state.calls.some(c => c.sql.includes("'digest_pending', true"))).toBe(true);
    });

    it('an investor presentation is written up in the same structure as a call (guidance changes first), from its own text, and a guidance CUT in it vetoes a buy', async () => {
      state.item = { ...baseItem(), title: 'Investor Presentation', attachment_url: 'https://nsearchives.nseindia.com/corporate/deck_Q2.pdf', deep_dive_status: 'pending_stage1' };
      state.docText = 'Investor Presentation Q2 FY27. We have revised our revenue growth outlook to 1.2 to 1.5 times from 1.5 to 2 times. EBITDA margin guidance is raised to 29-30%. Display plant in Pune to be commissioned by Q2 FY28. ' + 'Passenger vehicle segment drove growth in the quarter. '.repeat(8);
      state.highlightsJson = JSON.stringify({
        guidance_changes: ['Revenue growth outlook: 1.5 to 2 times -> 1.2 to 1.5 times (cut)', 'EBITDA margin guidance: raised to 29-30% (raised)'],
        operational_highlights: ['Display plant in Pune to be commissioned by Q2 FY28'],
        key_challenges: ['Passenger vehicle segment drove growth in the quarter']
      });
      await runOne();
      const queued = [...state.digestStore.values()][0]?.digest_item;
      expect(queued).toBeTruthy();
      expect(queued.kind).toBe('DECK');
      expect(queued.highlights?.guidance_changes?.length).toBe(2);
      expect(queued.guidanceCuts?.length).toBe(1);
      expect(String(queued.action)).not.toMatch(/BUY|ADD/);          // the model's buy is vetoed by the cut
      expect(state.nimBodies.some(b => JSON.stringify(b.messages).includes('presentation highlight'))).toBe(true);
    });

    it('a deck whose highlights come back empty or unusable is still queued with its ordinary verdict (never lost, never blocked)', async () => {
      state.item = { ...baseItem(), title: 'Investor Presentation', attachment_url: 'https://nsearchives.nseindia.com/corporate/deck_Q2.pdf', deep_dive_status: 'pending_stage1' };
      state.docText = 'Investor Presentation Q2 FY27. ' + 'Passenger vehicle segment drove growth in the quarter. '.repeat(12);
      state.highlightsJson = 'this is not json';
      await runOne();
      expect(state.calls.some(c => c.sql.includes("'digest_pending', true"))).toBe(true);
    });

    it('a results filing whose statement pages are images (text layer is only the cover letter) is OCR-read and delivered as a verified results alert, not a vague digest', async () => {
      state.item = { ...baseItem(), title: 'Outcome of Board Meeting', is_earnings_release: true };
      state.docText = coverLetter + '\n'.repeat(3) + 'y'.repeat(400);
      state.ocrText = shaktiText;                       // the vision-OCR transcription of the statement pages
      vi.mocked(extractPdfTextDetailed).mockClear();
      const res = await runOne();
      expect(forcedOcrCalls()).toBeGreaterThan(0);
      expect(res.processed).toBe(1);
      expect(state.sends).toHaveLength(1);
      expect(state.sends[0]).toContain('VERIFIED FINANCIALS');
      expect(state.sends[0]).toContain('₹746.03 Cr');
      expect(state.calls.some(c => c.sql.includes("'digest_pending', true"))).toBe(false);   // results are immediate, never digested
    });

    it('if the OCR cannot read those statements it is retried with backoff and NEVER sent as a content-free digest', async () => {
      state.item = { ...baseItem(), title: 'Outcome of Board Meeting', is_earnings_release: true };
      state.docText = coverLetter + '\n' + 'y'.repeat(400);
      state.ocrText = '';
      state.tableJson = JSON.stringify({ scope: 'CONSOLIDATED', unit: 'CRORES', column_dates: [], rows: {} });
      const res = await runOne();
      expect(res.processed).toBe(0);
      expect(state.sends).toHaveLength(0);
      expect(attemptKeys()).toContain('unreadable_attempts');
      expect(state.calls.some(c => c.sql.includes("'digest_pending', true"))).toBe(false);
    });

    it('a notice with nothing in it (a call-recording intimation) completes quietly instead of sending a "No driver evidence yet" digest', async () => {
      state.item = { ...baseItem(), title: 'Analysts/Institutional Investor Meet/Con. Call Updates', is_earnings_release: false, filing_category: 'GENERAL', attachment_url: 'https://nsearchives.nseindia.com/corporate/skipper_30102026203314_concaloutcome.pdf', deep_dive_status: 'pending_stage1' };
      state.docText = 'Skipper Limited has made available the audio recording of the conference call on its website. The recording is in compliance with SEBI regulations and nothing further is disclosed.';
      state.llmVerdict = {
        credibility_tier: 'Tier 2', action_signal: 'HOLD', conviction_score: 5,
        verdict_summary: 'The filing is only a call-recording notice without data.',
        key_drivers: [], key_positives: [], key_concerns_and_drags: [], thesis_operational_kpis: [], concall_verification_points: [],
        thesis_driver_assessment: drivers.map(d => ({ driver: d.name, status: 'NO_EVIDENCE', evidence: '' })),
        commitments: []
      };
      const res = await runOne();
      expect(res.processed).toBe(1);
      expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(true);
      expect(state.calls.some(c => c.sql.includes("'digest_pending', true"))).toBe(false);
      expect(state.sends).toHaveLength(0);
    });

    it('a general outcome that is NOT an earnings release is not forced through OCR', async () => {
      state.item = { ...baseItem(), title: 'Outcome of Board Meeting', is_earnings_release: false, filing_category: 'GENERAL' };
      state.docText = coverLetter + '\n' + 'y'.repeat(400);
      vi.mocked(extractPdfTextDetailed).mockClear();
      await runOne();
      expect(forcedOcrCalls()).toBe(0);
      expect(attemptKeys()).not.toContain('unreadable_attempts');
    });
  });

  it('the queue skips filings that are waiting out a retry backoff, and picks them up again once it has passed', async () => {
    await processPendingDeepDives({ deadlineAt: Date.now() + 20000 });
    const select = state.calls.find(c => c.sql.includes('FROM corporate_announcements ca') && c.sql.includes('deep_dive_status = ANY'));
    expect(select).toBeTruthy();
    expect(select.sql).toContain("retry_not_before");
    expect(select.sql).toMatch(/retry_not_before'\)?\s+IS NULL\s+OR[\s\S]*<=\s*NOW\(\)/);
  });

  it('material result filings whose PDF text is unreadable are retried, never analysed from the title alone', async () => {
    state.docText = '';
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(0);
    expect(state.sends).toHaveLength(0);
    expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(false);
    expect(attemptKeys()).toContain('notext_attempts');
  });

  it('a results PDF the parser cannot read still produces an alert with AI-located, clearly unverified figures', async () => {
    state.docText = shaktiText
      .replace(/Revenue from operations/g, 'Turnover (net)')
      .replace(/Profit before tax/g, 'PBT')
      .replace(/Profit for the period\/year/g, 'Net result');
    state.tableJson = JSON.stringify({
      scope: 'CONSOLIDATED', unit: 'CRORES', column_dates: ['2026-09-30', '2026-06-30', '2025-09-30'],
      rows: { revenue: ['746.03', '858.67', '666.35'], finance_costs: ['18.85', '14.57', '13.30'], depreciation: ['8.10', '7.58', '6.67'], pbt: ['49.53', '71.05', '121.52'], pat: ['38.51', '51.59', '90.71'] }
    });
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    const msg = state.sends[0];
    expect(msg).toContain('AI-LOCATED, UNVERIFIED');
    expect(msg).toContain('₹746.03 Cr');
    expect(msg).toContain('located by AI');
    // unverified figures never populate the quarterly snapshot
    expect(state.calls.some(c => c.sql.includes('INSERT INTO quarterly_snapshots'))).toBe(false);
  });

  describe('a results statement that cannot be read at all', () => {
    // Parser cannot read it, OCR is unavailable, and the AI table fallback finds nothing printed.
    const unreadableStatement = () => {
      state.docText = shaktiText
        .replace(/Revenue from operations/g, 'Turnover (net)')
        .replace(/Profit before tax/g, 'PBT')
        .replace(/Profit for the period\/year/g, 'Net result');
      state.ocrText = '';
      state.tableJson = JSON.stringify({ scope: 'CONSOLIDATED', unit: 'CRORES', column_dates: [], rows: {} });
    };
    const run = () => processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    const verdictCalls = () => state.nimBodies.filter(b => JSON.stringify(b.messages).includes('thesis_driver_assessment'));

    it('gets NO AI narrative written from the garbled text: it is retried instead (a garbled table made the model report a loss for a profitable quarter)', async () => {
      unreadableStatement();
      const res = await run();
      expect(res.processed).toBe(0);
      expect(res.failed).toBe(1);
      expect(state.sends).toHaveLength(0);
      expect(verdictCalls()).toHaveLength(0);                                   // the model never saw the garbled statements
      expect(state.calls.some(c => c.sql.includes("SET deep_dive_status = 'completed'"))).toBe(false);
      expect(attemptKeys()).toContain('unreadable_attempts');
      expect(state.calls.some(sqlIncludes("'retry_not_before'"))).toBe(true);    // backs off instead of retrying every cycle
    });

    it('if the AI providers are down while the figures are being located, it is an outage: no attempt is consumed', async () => {
      unreadableStatement();
      stubFetch('fail');
      vi.useFakeTimers();
      const runP = run();
      await vi.runAllTimersAsync();
      const res = await runP;
      vi.useRealTimers();
      expect(res.processed).toBe(0);
      expect(attemptKeys()).toEqual([]);
      expect(state.calls.some(sqlIncludes('llm_outage_first_at'))).toBe(true);
      expect(state.sends).toHaveLength(0);
    });

    it('after the patience budget it dead-letters with a failure alert and still sends no narrative', async () => {
      unreadableStatement();
      state.attempts = 6;
      const alertsBefore = vi.mocked(sendPipelineFailureAlert).mock.calls.length;
      const res = await run();
      expect(res.processed).toBe(0);
      expect(state.sends).toHaveLength(0);
      expect(verdictCalls()).toHaveLength(0);
      expect(state.calls.some(c => c.sql.includes("'needs_review'"))).toBe(true);
      const alerts = vi.mocked(sendPipelineFailureAlert).mock.calls;
      expect(alerts.length).toBe(alertsBefore + 1);
      expect(alerts[alerts.length - 1][0].error).toMatch(/could not be machine-read/i);
    });

    it('is not triggered when AI-located, text-grounded figures exist (that alert is still sent, clearly unverified)', async () => {
      state.docText = shaktiText.replace(/Revenue from operations/g, 'Turnover (net)').replace(/Profit before tax/g, 'PBT').replace(/Profit for the period\/year/g, 'Net result');
      state.tableJson = JSON.stringify({
        scope: 'CONSOLIDATED', unit: 'CRORES', column_dates: ['2026-09-30', '2026-06-30', '2025-09-30'],
        rows: { revenue: ['746.03', '858.67', '666.35'], finance_costs: ['18.85', '14.57', '13.30'], depreciation: ['8.10', '7.58', '6.67'], pbt: ['49.53', '71.05', '121.52'], pat: ['38.51', '51.59', '90.71'] }
      });
      const res = await run();
      expect(res.processed).toBe(1);
      expect(state.sends[0]).toContain('AI-LOCATED, UNVERIFIED');
    });
  });

  it('a garbled OCR text layer is re-read with vision OCR so the figures are VERIFIED, not merely AI-located', async () => {
    // Native text layer unreadable for the parser (scan with a noisy OCR layer); the vision OCR copy is clean.
    state.docText = shaktiText
      .replace(/Revenue from operations/g, 'Revenue o aperstans')
      .replace(/Profit before tax/g, 'Pofit bfore tx')
      .replace(/Profit for the period\/year/g, 'Profit forthe pred');
    state.ocrText = shaktiText;
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    const msg = state.sends[0];
    expect(msg).toContain('VERIFIED FINANCIALS');
    expect(msg).not.toContain('AI-LOCATED, UNVERIFIED');
    expect(msg).toContain('₹746.03 Cr');
    expect(msg).toContain('-57.55% YoY');
  });

  it('an OCR-read statement with no unit line takes the unit the filing declares: ₹2,827.28 million is ₹282.73 Cr, never ₹2,827.28 Cr (SJS 2026-11-04, a 10x error that was sent)', async () => {
    state.docText = [
      'Outcome of the meeting of the Board of Directors',
      'The Board has considered and approved the un-audited consolidated financial results of the company for the quarter and half year ended September 30, 2026.',
      '(Rs. in million)', '(Rs. in million)', '(Rs. in million)',
      'The statement pages of this scanned filing have no readable text layer.'
    ].join('\n');
    state.ocrText = [
      'Particulars', 'September 30, 2026', 'June 30, 2026', 'September 30, 2025', 'September 30, 2026', 'September 30, 2025',
      'Unaudited Unaudited Unaudited Unaudited Unaudited',
      'I Revenue from operations 2,827.28 2,500.00 2,418.00 5,327.28 4,700.00',
      'II Other income 30.00 25.00 20.00 55.00 40.00',
      'III Total Income (I+II) 2,857.28 2,525.00 2,438.00 5,382.28 4,740.00',
      'IV Expenses', 'Finance costs 20.00 18.00 15.00 38.00 30.00',
      'Depreciation and amortisation expense 100.00 90.00 80.00 190.00 160.00',
      'Total Expenses (IV) 2,200.00 2,000.00 1,900.00 4,200.00 3,700.00',
      'V Profit before tax (III-IV) 657.28 525.00 538.00 1,182.28 1,040.00',
      'VI Tax Expense 165.00 130.00 135.00 295.00 260.00',
      'VII Profit for the period/year (V-VI) 492.28 395.00 403.00 887.28 780.00'
    ].join('\n');
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    const msg = state.sends[0];
    expect(msg).toMatch(/Revenue:\* ₹282\.7/);
    expect(msg).not.toMatch(/2,?827\.28 Cr/);
  });

  it('figures whose scale does not fit the market data are NOT alerted as verified: a quarter bigger than the whole trailing year is withheld and retried, with no AI-located fallback on the same numbers', async () => {
    state.marketSnapshot = { share_price: 100, pe_ratio: 10, market_cap: 100, market_data_as_of: new Date().toISOString() };   // trailing profit 10 Cr; the Shakti quarter is 38.51 Cr
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(0);
    expect(state.sends).toHaveLength(0);
    expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(false);
    expect(attemptKeys()).toContain('unreadable_attempts');              // retried through the existing "cannot trust the statement" path
  });

  it('figures that fit the market data are alerted as before (the scale check never blocks a normal result)', async () => {
    state.marketSnapshot = { share_price: 500, pe_ratio: 26.7, market_cap: 4265, market_data_as_of: new Date().toISOString() };
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    expect(state.sends[0]).toContain('VERIFIED FINANCIALS');
  });

  describe('a guidance cut stated in the last 21 days vetoes a buy on the results that follow (SJS 2026-11-05: guide cut on the call, results alert STRONG BUY 9/10)', () => {
    const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
    const CUT = 'Revenue growth outlook: 1.5 to 2 times industry growth -> 1.2 to 1.5 times (cut), due to the global macro environment';
    // a clean, strong quarter for the Shakti contract: EBITDA margin about 26% against a 15% hurdle, revenue +17%, profit +22%
    const strong = () => [
      '(Rs. in Crores)', 'Particulars', 'September 30, 2026', 'June 30, 2026', 'September 30, 2025', 'September 30, 2026', 'September 30, 2025',
      'Unaudited Unaudited Unaudited Unaudited Unaudited',
      'I Revenue from operations 2,827.28 2,500.00 2,418.00 5,327.28 4,700.00',
      'II Other income 30.00 25.00 20.00 55.00 40.00',
      'III Total Income (I+II) 2,857.28 2,525.00 2,438.00 5,382.28 4,740.00',
      'IV Expenses', 'Finance costs 20.00 18.00 15.00 38.00 30.00',
      'Depreciation and amortisation expense 100.00 90.00 80.00 190.00 160.00',
      'Total Expenses (IV) 2,200.00 2,000.00 1,900.00 4,200.00 3,700.00',
      'V Profit before tax (III-IV) 657.28 525.00 538.00 1,182.28 1,040.00',
      'VI Tax Expense 165.00 130.00 135.00 295.00 260.00',
      'VII Profit for the period/year (V-VI) 492.28 395.00 403.00 887.28 780.00'
    ].join('\n');
    const run = () => processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    const prior = (o = {}) => ({ action: 'HOLD / MONITOR', conviction: '5', hurdle: null, assessment: [], guidance: null, judged_at: daysAgo(2), ...o });

    it('baseline: with no earlier guidance change this strong quarter is a buy', async () => {
      state.docText = `Financial results for the quarter ended September 30, 2026\n${strong()}`;
      state.llmVerdict = llmVerdictJson({ action_signal: 'ADD', conviction_score: 9 });
      await run();
      expect(state.sends[0]).toMatch(/ACTION SIGNAL:[^\n]*(BUY|ADD|ACCUMULATE)/i);
    });

    it('with a revenue-guide cut stated two days earlier the same quarter is HOLD / MONITOR and says why', async () => {
      state.docText = `Financial results for the quarter ended September 30, 2026\n${strong()}`;
      state.llmVerdict = llmVerdictJson({ action_signal: 'ADD', conviction_score: 9 });
      state.previousRows = [prior({ guidance: [CUT] })];
      await run();
      const msg = state.sends[0];
      expect(msg).toMatch(/ACTION SIGNAL:[^\n]*HOLD/i);
      expect(msg).not.toMatch(/ACTION SIGNAL:[^\n]*(BUY|ADD|ACCUMULATE)/i);
      expect(msg).toMatch(/cut guidance/i);
      expect(msg).toContain('1.2 to 1.5 times');
    });

    it('a cut older than 21 days, or one a newer raise has cancelled, does not veto', async () => {
      state.docText = `Financial results for the quarter ended September 30, 2026\n${strong()}`;
      state.llmVerdict = llmVerdictJson({ action_signal: 'ADD', conviction_score: 9 });
      state.previousRows = [prior({ judged_at: daysAgo(40), guidance: [CUT] })];
      await run();
      expect(state.sends[0]).toMatch(/ACTION SIGNAL:[^\n]*(BUY|ADD|ACCUMULATE)/i);
    });
  });

  describe('standalone-only parse of a filing that prints consolidated results', () => {
    const consolidated = fs.readFileSync(path.resolve(here, 'fixtures/anantraj-q2fy27-consolidated.txt'), 'utf8');
    const standaloneOnly = `Statement of Unaudited Standalone Financial Results for the Quarter and Half Year ended September 30, 2026
(Rs., Crores)
Quarter ended Half Year ended Year ended
SI.No. Particulars 30.09.2026 30.06.2026 30.09.2025 30.09.2026 30.09.2025 31.03.2026
(a) Revenue from operations 402.83 400.00 370.64 802.83 730.00 1,500.00
Total income 419.27 414.68 388.05 833.95 759.09 1570.91
(c) Finance costs 1.00 1.00 1.00 2.00 2.00 4.00
(d) Depreciation and amortisation 5.00 5.00 5.00 10.00 10.00 20.00
Profit before tax 108.27 105.42 90.67 213.69 173.39 368.58
Profit for the period 80.96 78.00 74.20 158.96 140.00 300.00
`;
    // Native text: the consolidated heading is present but its rows are unreadable (broken labels).
    const nativeText = consolidated
      .replace(/Revenue from operations/g, 'Rev enue fr om opera tions')
      .replace(/Total income/g, 'Tot al inc ome')
      .replace(/Profit for the period \/year/g, 'Pro fit for')
      + '\n' + standaloneOnly;

    it('is re-read with OCR and the CONSOLIDATED figures are shown, not the standalone ones', async () => {
      state.docText = nativeText;
      state.ocrText = consolidated;
      const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      const msg = state.sends[0];
      expect(msg).toContain('₹661.53 Cr');
      expect(msg).not.toContain('₹402.83');
      expect(msg).not.toContain('Only the STANDALONE statement');
    });

    it('when OCR cannot help, the alert says plainly that only standalone numbers were verified', async () => {
      state.docText = nativeText;
      state.ocrText = '';
      const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      const msg = state.sends[0];
      expect(msg).toContain('Only the STANDALONE statement could be machine-read');
      expect(msg).toContain('standalone');
    });
  });

  it('a download that fails (CDN not ready / HTTP error) keeps being retried far beyond 3 attempts, silently', async () => {
    state.docText = '';
    state.pdfFailReason = 'FETCH_FAILED';
    state.pdfFailDetail = 'Failed to download PDF: 404';
    state.attempts = 5;
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(0);
    expect(state.sends).toHaveLength(0);
    expect(state.calls.some(c => c.sql.includes("'needs_review'"))).toBe(false);
  });

  it('when the download never succeeds the dead-letter reason says "download", not "scanned PDF"', async () => {
    state.docText = '';
    state.pdfFailReason = 'FETCH_FAILED';
    state.pdfFailDetail = 'Failed to download PDF: 404';
    state.attempts = 12;
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(0);
    const esc = state.calls.find(c => c.sql.includes("'needs_review'"));
    expect(esc).toBeDefined();
    expect(esc.params[0]).toMatch(/download/i);
    expect(esc.params[0]).toContain('404');
    expect(esc.params[0]).not.toMatch(/scanned/i);
  });

  it('a genuinely unreadable (scanned) PDF still dead-letters after the normal 3 attempts with an OCR-specific reason', async () => {
    state.docText = '';
    state.pdfFailReason = 'NO_TEXT';
    state.attempts = 3;
    await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    const esc = state.calls.find(c => c.sql.includes("'needs_review'"));
    expect(esc).toBeDefined();
    expect(esc.params[0]).toMatch(/scanned|OCR/i);
  });

  it('a concall alert never repeats prompt-example items or figures the call did not state', async () => {
    const turn = (who, text) => `${who}: ${text}\n`;
    const transcript = 'Transcript of the Earnings Conference Call held on October 24, 2026\n' +
      turn('Moderator', 'Ladies and gentlemen, welcome to the Q2 FY27 earnings call.') +
      Array.from({ length: 60 }, (_, i) => turn('Management', `Point ${i}: receivable days from state discoms were 128 days and we expect improvement of 10 days by Q4; order inflow remained healthy.`)).join('') +
      turn('Moderator', 'Question and Answer session begins.');
    state.docText = transcript;
    state.item = { ...baseItem(), title: 'Analysts/Institutional Investor Meet/Con. Call Updates', deep_dive_status: 'pending_stage2', attachment_url: 'https://nsearchives.nseindia.com/corporate/SHAKTIPUMP_Transcript.pdf', is_earnings_release: false };
    state.highlightsJson = JSON.stringify({
      financial_performance: ['Revenue: ₹3,000 Cr (+20% YoY)', 'EBITDA: ₹600 Cr (+30% YoY, Margin 20%)', 'Order Book total: ₹1,500 Cr'],
      business_performance: ['Aerospace orders: ₹200 Cr', 'Semiconductor Dholera: ₹150 Cr'],
      growth_initiatives: ['Technology partnerships: Wayout Sweden'],
      operational_highlights: ['Receivable days from state discoms were 128 days; improvement of 10 days expected by Q4'],
      quarterly_guidance: ['Next Quarter (Q2): Revenue target ₹1,200 Cr'],
      annual_guidance: ['FY27 Full-Year Revenue Growth: 15-20%'],
      multi_year_targets: ['Vision 2030 / 3-5 Year Target: ₹10,000 Cr, 20% CAGR'],
      key_positives: ['Healthy order inflow'],
      key_challenges: ['Receivable days remain elevated'],
      management_tone: 'Highly Confident, Execution-Driven',
      key_takeaway: 'Poised for strong growth with 25% PAT growth.'
    });

    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    const msg = state.sends[0];
    expect(msg).toContain('128 days');                           // grounded, kept
    expect(msg).toContain('Healthy order inflow');
    for (const leaked of ['Aerospace', 'Dholera', 'Wayout', '₹3,000', '₹600 Cr', '₹1,500', '₹1,200', '₹10,000', '25% PAT']) {
      expect(msg, `alert still contains "${leaked}"`).not.toContain(leaked);
    }
  });

  describe('concall RECORDINGS (SJS / SBCL / TRANSRAILL 2026-11-04..05: a one-paragraph summary, "concall not analysed yet", and a guidance cut that never reached the alert)', () => {
    const audioItem = () => ({ ...baseItem(), title: 'Analysts/Institutional Investor Meet/Con. Call Updates', deep_dive_status: 'pending_audio', filing_category: 'QUARTERLY_EARNINGS', is_earnings_release: false, attachment_url: 'https://nsearchives.nseindia.com/corporate/SHAKTIPUMP_AudioRecording.pdf' });
    const letterWithLink = 'Subject: Submission of audio recording pertaining to Earnings Call of Q2 of FY 2026-27. The audio recording of the same is available on the website of the Company at shaktipumps.com/Docs/FY2627/Q2/call.mp3. Request you to kindly take the above on record. Thank you.';
    const callText = (n = 50) =>
      "Moderator: Ladies and gentlemen, good day and welcome to the Q2 FY27 earnings conference call.\n" +
      Array.from({ length: n }, (_, i) => `Management: Point ${i}: in light of the global macro environment we have recalibrated our FY27 revenue growth outlook to 1.2 to 1.5 times industry growth, from 1.5 to 2 times earlier, while EBITDA margin guidance is now 29-30%.\n`).join('');

    beforeEach(() => {
      process.env.GROQ_API_KEY = 'gsk_test-key';   // the server's key name (GROK_API_KEY alone was the only one the worker looked at)
      state.whisperText = callText();
    });

    it('a recording is transcribed and goes through the concall flow: one digest with the seven-part write-up, the cut as the reason, a buy downgraded', async () => {
      state.item = audioItem();
      state.docText = letterWithLink;
      state.highlightsJson = JSON.stringify({
        guidance_changes: ['Revenue growth outlook: 1.5 to 2 times -> 1.2 to 1.5 times industry growth (cut), due to the global macro environment', 'EBITDA margin guidance: 29-30% (raised)'],
        annual_guidance: ['EBITDA margin: 29-30%'],
        financial_performance: ['EBITDA margin guidance is now 29-30%'],
        key_challenges: ['Global macro environment'],
        management_tone: 'Confident',
        key_takeaway: 'Management cut FY27 revenue growth outlook to 1.2 to 1.5 times industry growth.'
      });
      const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      expect(state.sends).toHaveLength(1);
      const msg = state.sends[0];
      expect(msg).toContain('GUIDANCE & OUTLOOK');
      expect(msg).toMatch(/🔻 Revenue growth outlook: 1\.5 to 2 times -> 1\.2 to 1\.5 times/);
      expect(msg).toContain('Concall (heard from the company');       // says it came from the recording
      expect(msg).toContain('✅ analysed');                              // not "concall not analysed yet"
      expect(msg).toContain('management cut guidance on the call');
      expect(msg).toContain('HOLD / MONITOR');                         // the model's ADD 8/10 is vetoed by the cut
      expect(msg).not.toContain('not analysed yet');
    });

    it('the transcript of the recording is what is analysed (the verdict prompt receives the call text, not the one-page intimation letter)', async () => {
      state.item = audioItem();
      state.docText = letterWithLink;
      state.highlightsJson = JSON.stringify({ key_positives: ['EBITDA margin guidance is now 29-30%'] });
      await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      const verdictCalls = state.nimBodies.filter((b) => JSON.stringify(b.messages).includes('thesis_driver_assessment'));
      expect(verdictCalls.length).toBeGreaterThan(0);
      expect(verdictCalls.some((b) => JSON.stringify(b.messages).includes('recalibrated our FY27 revenue growth outlook'))).toBe(true);
      expect(verdictCalls.every((b) => !JSON.stringify(b.messages).includes('kindly take the above on record'))).toBe(true);
    });

    it('the second exchange copy of the same recording is skipped: one download, one transcription, one write-up', async () => {
      state.item = audioItem();
      state.docText = letterWithLink;
      state.audioTwin = true;
      state.highlightsJson = JSON.stringify({ key_positives: ['EBITDA margin guidance is now 29-30%'] });
      const { transcribeAudioWithGroqWhisper } = await import('../services/audio-transcript-analyzer.service.js');
      vi.mocked(transcribeAudioWithGroqWhisper).mockClear();
      const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      expect(vi.mocked(transcribeAudioWithGroqWhisper)).not.toHaveBeenCalled();
      expect(state.sends).toHaveLength(0);
    });

    it('a recording is skipped when the written transcript of the same call is already analysed: no download, no Whisper, no second write-up of one call', async () => {
      state.item = audioItem();
      state.docText = letterWithLink;
      state.transcriptCovers = true;
      const { downloadAndExtractMp3, transcribeAudioWithGroqWhisper } = await import('../services/audio-transcript-analyzer.service.js');
      vi.mocked(downloadAndExtractMp3).mockClear();
      vi.mocked(transcribeAudioWithGroqWhisper).mockClear();
      const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      expect(vi.mocked(downloadAndExtractMp3)).not.toHaveBeenCalled();
      expect(vi.mocked(transcribeAudioWithGroqWhisper)).not.toHaveBeenCalled();
      expect(state.sends).toHaveLength(0);
      expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(true);   // recorded, never left pending
      // another company's transcript saved under this ticker (the 2026-11-06 flood) never counts as covering the call
      const lookup = state.calls.find(c => c.sql.includes("'transcript_covers_call' AS tag"));
      expect(lookup.sql).toContain("foreign_filing");
      expect(lookup.sql).toMatch(/count\(DISTINCT t\.ticker\)[\s\S]*< 3/);
    });

    it('a recording not published yet (404) is retried with a growing delay, not dead-lettered after two hours (QPOWER: "available once the technical issue is resolved")', async () => {
      state.item = audioItem();
      state.docText = letterWithLink;
      state.attempts = 7;                                    // the old budget (6) would already have given up
      const { downloadAndExtractMp3 } = await import('../services/audio-transcript-analyzer.service.js');
      vi.mocked(downloadAndExtractMp3).mockRejectedValueOnce(new Error('Failed to download audio stream: 404 Not Found'));
      await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'needs_review'"))).toBe(false);
      const defer = state.calls.find(c => c.sql.includes("'retry_not_before'"));
      expect(defer).toBeTruthy();
      const waitMs = new Date(defer.params[0]).getTime() - Date.now();
      expect(waitMs).toBeGreaterThan(2.5 * 60 * 60 * 1000);  // the 7th wait is 3 h
      expect(waitMs).toBeLessThan(3.5 * 60 * 60 * 1000);
    });

    it('a recording that cannot be fetched after the retries is dead-lettered WITHOUT a failure alert: the written transcript covers the call (QPOWER 404, INOXINDIA fetch failed)', async () => {
      state.item = audioItem();
      state.docText = letterWithLink;
      state.attempts = 12;                                   // the retry budget (MAX_AUDIO_ATTEMPTS) is used up
      const { downloadAndExtractMp3 } = await import('../services/audio-transcript-analyzer.service.js');
      vi.mocked(downloadAndExtractMp3).mockRejectedValueOnce(new Error('Failed to download audio stream: 404 Not Found'));
      vi.mocked(sendPipelineFailureAlert).mockClear();
      await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'needs_review'"))).toBe(true);   // still recorded, never silently dropped
      expect(vi.mocked(sendPipelineFailureAlert)).not.toHaveBeenCalled();
    });

    it('an intimation with no readable media link sends nothing and does not raise a failure alert (it used to go out as a full digest saying only that a recording exists)', async () => {
      state.item = audioItem();
      state.docText = 'Subject: Audio recording of the earnings conference call. The audio recording of the call is available on the website of the Company. Request you to kindly take the above on record.';
      vi.mocked(sendPipelineFailureAlert).mockClear();
      const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      expect(state.sends).toHaveLength(0);
      expect(vi.mocked(sendPipelineFailureAlert)).not.toHaveBeenCalled();
      expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(true);
    });

    it('a YouTube recording downloads via yt-dlp and enters the concall transcript pipeline', async () => {
      state.item = audioItem();
      state.docText = 'Subject: Earnings Call. Audio recording link: https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      state.whisperText = 'Managing Director: We delivered 25% revenue growth and maintain 22% margin guidance.';
      const { downloadYouTubeAudio } = await import('../services/audio-transcript-analyzer.service.js');
      vi.mocked(downloadYouTubeAudio).mockClear();
      const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      expect(vi.mocked(downloadYouTubeAudio)).toHaveBeenCalled();
      expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(true);
    });
  });

  describe('failure alerts: one per cause, and none for a deck the results note already covers (SBCL / INOXINDIA 2026-11-04 sent the same alert for the NSE and the BSE copy)', () => {
    const unreadable = () => { state.docText = ''; state.pdfFailReason = 'NO_TEXT'; state.pdfFailDetail = 'no text'; state.attempts = 99; };

    it('the second copy of a filing that fails for the same reason does not raise a second alert', async () => {
      state.item = { ...baseItem(), title: 'Announcement under Regulation 30 (LODR)-Analyst / Investor Meet - Outcome', deep_dive_status: 'pending_stage2', filing_category: 'QUARTERLY_EARNINGS', is_earnings_release: false };
      unreadable();
      state.twinFailure = true;
      vi.mocked(sendPipelineFailureAlert).mockClear();
      await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(vi.mocked(sendPipelineFailureAlert)).not.toHaveBeenCalled();
    });

    it('the first failure is still alerted', async () => {
      state.item = { ...baseItem(), title: 'Announcement under Regulation 30 (LODR)-Analyst / Investor Meet - Outcome', deep_dive_status: 'pending_stage2', filing_category: 'QUARTERLY_EARNINGS', is_earnings_release: false };
      unreadable();
      vi.mocked(sendPipelineFailureAlert).mockClear();
      await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(vi.mocked(sendPipelineFailureAlert)).toHaveBeenCalledTimes(1);
    });

    it('an unreadable investor presentation of a stock whose results were already alerted is dead-lettered quietly', async () => {
      state.item = { ...baseItem(), title: 'Investor Presentation', deep_dive_status: 'pending_stage1', filing_category: 'QUARTERLY_EARNINGS', is_earnings_release: true };
      unreadable();
      state.recentResultsAlert = true;
      vi.mocked(sendPipelineFailureAlert).mockClear();
      await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(vi.mocked(sendPipelineFailureAlert)).not.toHaveBeenCalled();
      expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'needs_review'"))).toBe(true);
    });

    it('a document that three or more tracked tickers hold is another company\'s filing: never read, analysed or alerted, and set aside on its row (NSE ignored the symbol on 2026-11-06)', async () => {
      state.item = { ...baseItem(), title: 'Press Release', attachment_url: 'https://nsearchives.nseindia.com/corporate/DENTA_06112026233924_Denta_Press_Release_Q2_H1_FY27.pdf' };
      state.foreignCopies = 19;
      vi.mocked(extractPdfTextDetailed).mockClear();
      const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      expect(state.sends).toHaveLength(0);
      expect(vi.mocked(extractPdfTextDetailed)).not.toHaveBeenCalled();
      expect(state.nimBodies).toHaveLength(0);
      const setAside = state.calls.find(c => c.sql.includes('foreign_filing') && c.sql.includes("deep_dive_status = 'not_required'"));
      expect(setAside?.params).toEqual(['aaaaaaaa-0000-0000-0000-000000000001']);
      expect(state.calls.some(c => c.sql.includes('INSERT INTO quarterly_snapshots'))).toBe(false);
      expect(state.calls.some(c => c.sql.includes('INSERT INTO management_commitments'))).toBe(false);
    });

    it('a concall INTIMATION filed as earnings ("General Updates", real JSLL letter) is not treated as a results statement: no OCR of statement pages, no failure alert, no results flash', async () => {
      const jsll = fs.readFileSync(path.resolve(here, 'fixtures/real-layouts/JSLL_concall-intimation_2026-11-05.txt'), 'utf8');
      state.item = { ...baseItem(), ticker: 'JSLL', title: 'General Updates', attachment_url: 'https://nsearchives.nseindia.com/corporate/JSLL_05112026121700_Intimation.pdf', filing_category: 'QUARTERLY_EARNINGS', is_earnings_release: true };
      state.docText = jsll;
      vi.mocked(extractPdfTextDetailed).mockClear();
      vi.mocked(sendPipelineFailureAlert).mockClear();
      await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(vi.mocked(extractPdfTextDetailed).mock.calls.some(([, opts]) => opts?.forceOcr)).toBe(false);
      expect(vi.mocked(sendPipelineFailureAlert)).not.toHaveBeenCalled();
      // it went out (if at all) as an ordinary digest item, never as the immediate results flash
      expect(state.sends.every(s => /HOW THIS SIGNAL WAS REACHED/.test(s))).toBe(true);
    });

    it('a document held by only two tickers (a parent and its subsidiary) is still analysed normally', async () => {
      state.foreignCopies = 2;
      const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(res.processed).toBe(1);
      expect(state.sends).toHaveLength(1);
      expect(state.calls.some(c => c.sql.includes('foreign_filing'))).toBe(false);
    });

    it('but an unreadable results STATEMENT is always alerted', async () => {
      state.item = { ...baseItem(), title: 'Outcome of Board Meeting', deep_dive_status: 'pending_stage1', filing_category: 'QUARTERLY_EARNINGS', is_earnings_release: true };
      unreadable();
      state.recentResultsAlert = true;
      vi.mocked(sendPipelineFailureAlert).mockClear();
      await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
      expect(vi.mocked(sendPipelineFailureAlert)).toHaveBeenCalledTimes(1);
    });
  });
});
