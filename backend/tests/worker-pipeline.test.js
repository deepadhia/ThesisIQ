/**
 * End-to-end invariants for the quarterly deep-dive worker (results / presentation / concall alerts).
 * The DB, Telegram and the NIM LLM are mocked; everything else (classifier, parser, guard, gates, thesis drivers,
 * message builders) is the real code.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const shaktiText = fs.readFileSync(path.resolve(here, 'fixtures/shaktipump-q2fy27-results.txt'), 'utf8');

const state = vi.hoisted(() => ({
  calls: [],
  item: null,
  docText: '',
  sends: [],
  sendImpl: null,
  llmMode: 'ok',
  llmVerdict: null,
  tableJson: null,
  highlightsJson: null,
  nimBodies: [],
  ocrText: '',
  pdfFailReason: 'NO_TEXT',
  pdfFailDetail: '',
  digestStore: new Map(),
  otherPending: 0
}));

vi.mock('../config/env.js', () => ({
  NVIDIA_API_KEY: 'test-key',
  GROQ_API_KEY: '',
  TELEGRAM_BOT_TOKEN: 'tok',
  TELEGRAM_CHAT_ID: '1',
  GEMINI_API_KEY: '',
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
      if (text.includes("event_analysis->>'digest_pending' = 'true'")) return { rows: [...state.digestStore.values()].filter(r => !r.sent) };
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

import { processPendingDeepDives, flushThesisDigests } from '../workers/quarterly-deepdive-worker.js';
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
      else if (body.includes('concall highlight') && state.highlightsJson) content = state.highlightsJson;
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
    state.nimBodies = [];
    state.ocrText = '';
    state.pdfFailReason = 'NO_TEXT';
    state.pdfFailDetail = '';
    state.item = baseItem();
    state.docText = shaktiText;
    stubFetch('ok');
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
    expect(msg).not.toMatch(/-3642|-65\.6/);             // the old garbage numbers

    const sendIdx = state.calls.findIndex(c => c.sql === '__SEND__');
    const completedIdx = state.calls.findIndex(c => c.sql.includes("deep_dive_status = 'completed'"));
    expect(sendIdx).toBeGreaterThan(-1);
    expect(completedIdx).toBeGreaterThan(sendIdx);       // alert first, completion after
    expect(state.calls.some(c => c.sql.includes("'needs_review'"))).toBe(false);
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
});
