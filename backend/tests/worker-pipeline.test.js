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
  tableJson: null
}));

vi.mock('../config/env.js', () => ({
  NVIDIA_API_KEY: 'test-key',
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
      if (text.includes('FROM corporate_announcements ca') && text.includes('JOIN stocks')) return { rows: [state.item] };
      if (text.includes('RETURNING (event_analysis->>\'deep_dive_attempts\')')) return { rows: [{ attempts: state.attempts || 1 }] };
      return { rows: [] };
    })
  }
}));

vi.mock('../services/announcement.service.js', async () => {
  const actual = await vi.importActual('../services/announcement.service.js');
  return { ...actual, extractTextFromPdfUrl: vi.fn(async () => state.docText) };
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

import { processPendingDeepDives } from '../workers/quarterly-deepdive-worker.js';
import { getThesisContract } from '../services/thesis-driver-context.service.js';

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
      const body = String(init?.body || '');
      const content = body.includes('financial data transcriber') && state.tableJson
        ? state.tableJson
        : JSON.stringify(state.llmVerdict || llmVerdictJson());
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

describe('quarterly deep-dive worker', () => {
  beforeEach(() => {
    state.calls = [];
    state.sends = [];
    state.sendImpl = null;
    state.attempts = 1;
    state.llmVerdict = null;
    state.tableJson = null;
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
    expect(state.calls.some(c => c.sql.includes("'deep_dive_attempts'"))).toBe(true);
  });

  it('after the attempts are exhausted, verified numbers are still delivered with an honest "AI unavailable" banner', async () => {
    stubFetch('fail');
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

  it('a concall transcript is judged on thesis drivers, is not labelled a thesis deviation, and uses the concall template', async () => {
    const turn = (who, text) => `${who}: ${text}\n`;
    const transcript = 'Transcript of the Earnings Conference Call held on October 24, 2026\n' +
      turn('Moderator', 'Ladies and gentlemen, welcome to the Shakti Pumps Q2 FY27 earnings call.') +
      Array.from({ length: 60 }, (_, i) => turn('Management', `Point ${i}: dispatch run-rate under PM-KUSUM Component B and C continues; receivable days from state discoms were 128 days and we expect improvement of 10 days by Q4 as subsidy tranches get released.`)).join('') +
      turn('Moderator', 'Question and Answer session begins.');
    state.docText = transcript;
    state.item = { ...baseItem(), title: 'Analysts/Institutional Investor Meet/Con. Call Updates', deep_dive_status: 'pending_stage2', attachment_url: 'https://nsearchives.nseindia.com/corporate/SHAKTIPUMP_Transcript.pdf', is_earnings_release: false };

    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(1);
    expect(state.sends).toHaveLength(1);
    const msg = state.sends[0];
    expect(msg).toContain('Concall Audit');
    expect(msg).toContain('THESIS DRIVER CHECK');
    expect(msg).not.toContain('Thesis Deviation');
    expect(msg).not.toContain('Quarterly Results Flash Note');
  });

  it('material result filings whose PDF text is unreadable are retried, never analysed from the title alone', async () => {
    state.docText = '';
    const res = await processPendingDeepDives({ announcementIds: ['aaaaaaaa-0000-0000-0000-000000000001'], deadlineAt: Date.now() + 20000 });
    expect(res.processed).toBe(0);
    expect(state.sends).toHaveLength(0);
    expect(state.calls.some(c => c.sql.includes("deep_dive_status = 'completed'"))).toBe(false);
    expect(state.calls.some(sqlIncludes("'deep_dive_attempts'"))).toBe(true);
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
});
