/**
 * Regression suite for the results / presentation / concall "heart" of ThesisIQ.
 *
 * Each block pins a bug that silently cost real alerts in the Q2 FY27 season:
 *  - statement parser picking the standalone notes table / a yearly-only exceptional item (Shakti, Lumax PDFs)
 *  - BSE feed requiring a date window and PDFs living under ATTACHMENTNAME
 *  - exchange timestamps shifted by 5.5h
 *  - generic NSE titles colliding on the same hash
 *  - over-aggressive event de-duplication swallowing distinct orders
 *  - concall invitations mistaken for transcripts
 *  - gates: bearish analysis / broken thesis driver must veto a buy, turnarounds, filings without statements
 *  - Telegram sender must never report "sent" for an undelivered alert
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { extractDeterministicFinancials } from '../../services/financial-validator.service.js';
import { evaluateDualLayerActionGate } from '../../services/thesis-gate-evaluator.service.js';
import {
  parseExchangeTimestamp,
  getFilingAgeHours,
  generateAnnouncementHash,
  getConcallType
} from '../../services/announcement.service.js';
import { buildBseDocumentUrl, splitTelegramText, sendTelegramMessage } from '../../services/telegram.service.js';
import { classifyFilingForWorker } from '../../services/filing-classifier.service.js';
import {
  buildThesisContext,
  normalizeDriverAssessment,
  summarizeDriverAssessment,
  getThesisContract
} from '../../services/thesis-driver-context.service.js';
import { applyInstitutionalGuard } from '../../services/institutional-guard.service.js';
import { quarterFromPeriodEnd } from '../../workers/quarterly-deepdive-worker.js';
import { extractFinancialsViaLlm } from '../../services/financial-table-fallback.service.js';
import { isEarningsConcallInvite, extractConcallSchedule } from '../../services/announcement.service.js';
import { formatConcallScheduleMessage } from '../../services/telegram.service.js';
import { buildEnrichedThesis } from '../../scripts/seed-stock-theses.js';
import { findThesisGaps } from '../../services/thesis-driver-context.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.resolve(here, '../fixtures', name), 'utf8');

describe('Financial parser on real Q2 FY27 filings', () => {
  it('SHAKTIPUMP: picks the CONSOLIDATED statement even though its heading is printed after the table', () => {
    const fin = extractDeterministicFinancials(fixture('shaktipump-q2fy27-results.txt'));
    expect(fin).not.toBeNull();
    expect(fin.statementScope).toBe('CONSOLIDATED');
    expect(fin.quarterEnded).toBe('2026-09-30');
    expect(fin.revenue).toBe(746.03);          // not the standalone 683.33 / the notes-table 702.56
    expect(fin.revenueYoYGrowthPct).toBe(11.96);
    expect(fin.patConsolidated).toBe(38.51);   // not the standalone 31.03
    expect(fin.patYoYGrowthPct).toBe(-57.55);  // 38.51 vs 90.71
    expect(fin.ebitda).toBe(76.48);            // 49.53 + 18.85 + 8.10
    expect(fin.ebitdaMarginPct).toBe(10.25);
    expect(fin.ebitdaMarginBpsDelta).toBeLessThan(-1000); // real compression, not the absurd -3,642 bps
    expect(fin.ebitdaMarginBpsDelta).toBeGreaterThan(-1200);
    expect(fin.isYoYDecline).toBe(true);
  });

  it('LUMAXTECH: Lakhs are converted once, owners\' PAT is used, and a yearly-only exceptional item is not a quarterly gain', () => {
    const fin = extractDeterministicFinancials(fixture('lumaxtech-q2fy27-results.txt'));
    expect(fin).not.toBeNull();
    expect(fin.statementScope).toBe('CONSOLIDATED');
    expect(fin.unit).toBe('LAKHS');
    expect(fin.revenue).toBe(1555.51);
    expect(fin.revenueYoYGrowthPct).toBe(34.52);
    expect(fin.patAttributable).toBe(105.51);      // owners of Lumax, not the 116.67 total incl. minority
    expect(fin.patTotalIncludingMinority).toBe(116.67);
    expect(fin.patYoYGrowthPct).toBe(57.82);
    expect(fin.patStandalone).toBe(89);
    expect(fin.exceptionalGain).toBeUndefined();   // 1,449.65 belongs to the FY column only
    expect(fin.normalisedPat).toBeNull();
  });

  it('bracketed numbers are losses, and a loss-to-profit swing is flagged as a turnaround', () => {
    const text = `
STATEMENT OF CONSOLIDATED UNAUDITED FINANCIAL RESULTS FOR THE QUARTER ENDED SEPTEMBER 30, 2026
(₹ in Crores)
Particulars | Quarter Ended 30-09-2026 | Quarter Ended 30-06-2026 | Quarter Ended 30-09-2025
Revenue from operations 400.00 380.00 350.00
Finance costs 10.00 10.00 12.00
Depreciation and amortisation 15.00 15.00 14.00
Profit before tax 40.00 30.00 (20.00)
Profit for the period 30.00 22.00 (15.00)
`;
    const fin = extractDeterministicFinancials(text);
    expect(fin.patConsolidated).toBe(30);
    expect(fin.patYoYGrowthPct).toBeNull();
    expect(fin.patTurnaround).toBe('LOSS_TO_PROFIT');
    expect(fin.ebitda).toBe(65);
  });

  it('seasonal Q1 columns are mapped by header dates (Q4 > 1.7x Q1 must not be read as a half-year)', () => {
    const text = `
STATEMENT OF CONSOLIDATED UNAUDITED FINANCIAL RESULTS FOR THE QUARTER ENDED JUNE 30, 2026
(Rs. in Crores)
Particulars 30.06.2026 31.03.2026 30.06.2025 31.03.2026
Revenue from operations 100.00 190.00 80.00 600.00
Finance costs 2.00 3.00 2.00 10.00
Depreciation and amortisation 5.00 5.00 4.00 18.00
Profit before tax 20.00 50.00 15.00 150.00
Profit for the period 15.00 38.00 11.00 112.00
`;
    const fin = extractDeterministicFinancials(text);
    expect(fin.revenueYoYGrowthPct).toBe(25);   // vs 30.06.2025, NOT vs the full-year column
    expect(fin.revenueQoQGrowthPct).toBe(-47.37);
    expect(fin.patYoYGrowthPct).toBe(36.36);
  });

  it('narrative text (concall transcript, press release) never yields fake financials', () => {
    const transcript = `
Moderator: Ladies and gentlemen, welcome to the Q2 FY27 earnings call.
Management: Revenue from operations grew 25% to 540 crores and PAT was 62 crores. Our financial results show strong operating leverage.
Profit before tax improved 30% year on year.
`;
    expect(extractDeterministicFinancials(transcript)).toBeNull();
  });
});

describe('Exchange feed correctness', () => {
  it('BSE documents live under ATTACHMENTNAME (NEWSID 404s)', () => {
    const url = buildBseDocumentUrl('33ecebb6-c8b6-4c91-aee9-08d097d9ef5c', 0, '4cd0293d-888b-40ba-bd9a-ac1b96985a48.pdf');
    expect(url).toBe('https://www.bseindia.com/xml-data/corpfiling/AttachLive/4cd0293d-888b-40ba-bd9a-ac1b96985a48.pdf');
  });

  it('exchange timestamps are pinned to IST, not the server timezone', () => {
    expect(parseExchangeTimestamp('12102026142235')).toBe('2026-10-12T08:52:35.000Z');
    expect(parseExchangeTimestamp('23-Oct-2026 18:25:25')).toBe('2026-10-23T12:55:25.000Z');
    expect(parseExchangeTimestamp('2026-10-23T16:58:29.837')).toBe('2026-10-23T11:28:29.000Z');
    const now = new Date('2026-10-23T13:00:00.000Z').getTime();
    expect(getFilingAgeHours('2026-10-23T18:25:25', now)).toBeCloseTo(0.07, 1); // filed 5 minutes ago, not "in the future"
  });

  it('two different NSE "Updates" on the same day no longer collide, long descriptive titles still dedupe', () => {
    const t = '2026-10-23T15:00:00';
    const a = generateAnnouncementHash('SHAKTIPUMP', 'Updates', t, 'seq-1');
    const b = generateAnnouncementHash('SHAKTIPUMP', 'Updates', t, 'seq-2');
    expect(a).not.toBe(b);
    const longTitle = 'Announcement under Regulation 30 (LODR)-Credit Rating assigned by CRISIL to the bank facilities';
    expect(generateAnnouncementHash('X', longTitle, t, 'seq-1')).toBe(generateAnnouncementHash('X', longTitle, t, 'seq-2'));
  });

  it('a call invitation that promises a future transcript is not a transcript; a real transcript still is', () => {
    const invitation = 'Intimation of Earnings Call. The audio recording and transcript of the call will be made available on the website of the company after the call.';
    expect(getConcallType('Analysts/Institutional Investor Meet/Con. Call Updates', invitation)).not.toBe('transcript');
    const real = 'Transcript of the Earnings Conference Call held on October 16, 2026';
    expect(getConcallType('Analysts/Institutional Investor Meet/Con. Call Updates', real)).toBe('transcript');

    const worker = classifyFilingForWorker({
      title: 'Analysts/Institutional Investor Meet/Con. Call Updates',
      attachmentUrl: 'https://nsearchives.nseindia.com/corporate/X_Intimation.pdf',
      docText: invitation + ' '.repeat(600) + 'Please join the call.',
      deepDiveStatus: 'pending_stage1'
    });
    expect(worker.isTranscript).toBe(false);
  });
});

describe('Thesis gates', () => {
  const goodFin = {
    revenue: 746, revenueYoYGrowthPct: 12, patConsolidated: 150, patYoYGrowthPct: 20,
    ebitda: 260, ebitdaMarginPct: 16, ebitdaMarginBpsDelta: 40, isMarginErosion: false
  };

  it('a clean beat with no veto authorises ADD', () => {
    const g = evaluateDualLayerActionGate({ ticker: 'HBLENGINE', financialData: { ...goodFin, revenue: 800 }, proposedAction: 'HOLD', llmConviction: 7 });
    expect(['ADD', 'STRONG BUY']).toContain(g.finalAction);
  });

  it('a bearish analysis vetoes the buy (gates cannot override a TRIM)', () => {
    const g = evaluateDualLayerActionGate({ ticker: 'HBLENGINE', financialData: { ...goodFin, revenue: 800 }, proposedAction: 'TRIM', llmConviction: 4 });
    expect(g.finalAction).toBe('WATCH / WAIT FOR CONFIRMATION');
    expect(g.statusClassification).toBe('GATES_PASS_ANALYSIS_BEARISH');
  });

  it('a falsified HIGH-materiality thesis driver vetoes the buy', () => {
    const g = evaluateDualLayerActionGate({
      ticker: 'HBLENGINE', financialData: { ...goodFin, revenue: 800 }, proposedAction: 'ADD', llmConviction: 8,
      driverAssessment: [{ driver: 'Defence order conversion', status: 'BROKEN', evidence: 'Defence order book fell 40%', materiality: 'HIGH' }]
    });
    expect(g.finalAction).toBe('REASSESS THESIS');
    expect(g.statusClassification).toBe('THESIS_DRIVER_BROKEN');
  });

  it('loss-to-profit turnaround counts as growth; profit-to-loss fails', () => {
    const up = evaluateDualLayerActionGate({ ticker: 'HBLENGINE', financialData: { ...goodFin, revenue: 800, patYoYGrowthPct: null, patTurnaround: 'LOSS_TO_PROFIT' }, proposedAction: 'ADD', llmConviction: 7 });
    expect(['ADD', 'STRONG BUY']).toContain(up.finalAction);
    const down = evaluateDualLayerActionGate({ ticker: 'HBLENGINE', financialData: { ...goodFin, patYoYGrowthPct: null, patTurnaround: 'PROFIT_TO_LOSS' }, proposedAction: 'ADD', llmConviction: 7 });
    expect(down.finalAction).toBe('REASSESS THESIS');
  });

  it('a transcript / deck with no statements is NOT_APPLICABLE and is never labelled a thesis deviation', () => {
    const g = evaluateDualLayerActionGate({ ticker: 'SHAKTIPUMP', financialData: null, proposedAction: 'ADD', llmConviction: 8, financialsRequired: false });
    expect(g.statusClassification).toBe('NO_FINANCIALS_IN_FILING');
    expect(g.finalAction).toBe('HOLD / MONITOR');
    expect(g.universalGate.status).toBe('NOT_APPLICABLE');
  });

  it('a results filing whose tables could not be parsed fails closed (DATA_UNAVAILABLE), never authorises a buy', () => {
    const g = evaluateDualLayerActionGate({ ticker: 'SHAKTIPUMP', financialData: null, proposedAction: 'ADD', llmConviction: 9, financialsRequired: true });
    expect(g.statusClassification).toBe('DATA_UNAVAILABLE');
    expect(g.actionAuthorized).toBe(false);
  });

  it('Shakti Q2 FY27 real numbers fail the thesis gates (PAT -57%, margin 10.25% < 15% hurdle)', () => {
    const fin = extractDeterministicFinancials(fixture('shaktipump-q2fy27-results.txt'));
    const g = evaluateDualLayerActionGate({ ticker: 'SHAKTIPUMP', financialData: fin, proposedAction: 'ADD', llmConviction: 8 });
    expect(g.actionAuthorized).toBe(false);
    expect(g.finalAction).toBe('REASSESS THESIS');
  });
});

describe('Thesis driver context', () => {
  it('loads the driver contract for covered stocks and builds a verification prompt', () => {
    const contract = getThesisContract('SHAKTIPUMP');
    expect(contract).not.toBeNull();
    const ctx = buildThesisContext('SHAKTIPUMP', JSON.stringify({ primary_thesis: 'Policy-driven scaling' }));
    expect(ctx.text).toContain('Policy-driven scaling');
    expect(ctx.text).toContain('MUST BE TRUE');
    expect(ctx.drivers.length).toBeGreaterThan(0);
  });

  it('driver assessments are validated: unknown drivers dropped, BROKEN without evidence downgraded, every driver present', () => {
    const drivers = getThesisContract('SHAKTIPUMP').drivers;
    const out = normalizeDriverAssessment([
      { driver: drivers[0].name, status: 'BROKEN', evidence: '' },
      { driver: 'Made up driver', status: 'CONFIRMED', evidence: 'something something something' },
      { driver: drivers[1].name, status: 'CONFIRMED', evidence: 'PAT stabilised at 92% of the FY25 run-rate in Q2' }
    ], drivers);
    expect(out).toHaveLength(drivers.length);
    expect(out[0].status).toBe('AT_RISK');
    expect(out[1].status).toBe('CONFIRMED');
    expect(out.some(a => a.driver === 'Made up driver')).toBe(false);
    expect(summarizeDriverAssessment(out).hasSignal).toBe(true);
  });
});

describe('Institutional guard', () => {
  it('does not re-scale already-normalised Crore values (large caps stay correct)', () => {
    const fin = { isFinancialResult: true, revenue: 12500, revenueYoYGrowthPct: 10, ebitda: 2600, ebitdaMarginPct: 20.8, patAttributable: 2100, patConsolidated: 2100, patYoYGrowthPct: 12, isYoYDecline: false, isMarginErosion: false, segmentRedFlags: [] };
    const out = applyInstitutionalGuard({ action_signal: 'ADD', conviction_score: 8, verdict_summary: 'Strong quarter.', key_drivers: [] }, fin, 'Financial Results', 'X');
    expect(out.financial_highlights.revenue).toContain('₹12500 Cr');
  });

  it('pending regulatory commitments cap conviction but never force an ADD over a HOLD/TRIM', () => {
    const fin = { isFinancialResult: true, revenue: 500, revenueYoYGrowthPct: 20, ebitda: 100, ebitdaMarginPct: 20, ebitdaMarginBpsDelta: 10, patAttributable: 60, patConsolidated: 60, patYoYGrowthPct: 20, isYoYDecline: false, isMarginErosion: false, segmentRedFlags: [] };
    const out = applyInstitutionalGuard({
      action_signal: 'TRIM', conviction_score: 6, verdict_summary: 'Governance concern.', key_drivers: [],
      commitments: [{ statement: 'Demerger NCLT approval pending', metric: 'demerger', status: 'Pending', timeline: 'FY27' }]
    }, fin, 'Outcome', 'X');
    expect(out.action_signal).toBe('TRIM');
  });

  it('LLM growth claims that contradict the verified numbers are dropped from the summary', () => {
    const fin = { isFinancialResult: true, revenue: 1555.51, revenueYoYGrowthPct: 34.52, ebitda: 228.2, ebitdaMarginPct: 14.67, ebitdaMarginBpsDelta: -4, patAttributable: 105.51, patConsolidated: 105.51, patYoYGrowthPct: 57.82, isYoYDecline: false, isMarginErosion: false, segmentRedFlags: [] };
    const out = applyInstitutionalGuard({
      action_signal: 'ADD', conviction_score: 8, key_drivers: [],
      verdict_summary: 'Strong Q2 with revenue growth of 21.2% YoY. EBITDA margin expansion of 150 bps YoY. Order book remains healthy.'
    }, fin, 'Outcome', 'X');
    expect(out.verdict_summary).not.toContain('21.2%');
    expect(out.verdict_summary).not.toContain('150 bps');
    expect(out.verdict_summary).toContain('Order book remains healthy');
  });
});

describe('Reporting period & Telegram delivery', () => {
  it('statement period-end maps to the Indian fiscal quarter', () => {
    expect(quarterFromPeriodEnd('2026-09-30')).toBe('Q2 FY27');
    expect(quarterFromPeriodEnd('2026-06-30')).toBe('Q1 FY27');
    expect(quarterFromPeriodEnd('2026-12-31')).toBe('Q3 FY27');
    expect(quarterFromPeriodEnd('2027-03-31')).toBe('Q4 FY27');
  });

  it('long messages split on paragraph boundaries within Telegram limits', () => {
    const para = 'x'.repeat(900);
    const text = Array.from({ length: 12 }, (_, i) => `${i} ${para}`).join('\n\n');
    const chunks = splitTelegramText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.length <= 3900)).toBe(true);
    expect(chunks.join('\n\n').replace(/\s+/g, '').length).toBe(text.replace(/\s+/g, '').length);
  });

  it('sendTelegramMessage THROWS when Telegram is not configured (never reports a phantom send)', async () => {
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) return; // configured env: nothing to assert hermetically
    await expect(sendTelegramMessage('hello')).rejects.toThrow(/not configured/i);
  });
});

describe('Text-grounded fallback for unparseable results tables', () => {
  // Same real Shakti filing, but with the row labels mangled so the rule-based reader cannot anchor on them
  const mangled = fixture('shaktipump-q2fy27-results.txt')
    .replace(/Revenue from operations/g, 'Turnover (net)')
    .replace(/Profit before tax/g, 'PBT')
    .replace(/Profit for the period\/year/g, 'Net result');
  const llmReply = (rev) => JSON.stringify({
    scope: 'CONSOLIDATED', unit: 'CRORES',
    column_dates: ['2026-09-30', '2026-06-30', '2025-09-30'],
    rows: {
      revenue: rev, finance_costs: ['18.85', '14.57', '13.30'], depreciation: ['8.10', '7.58', '6.67'],
      pbt: ['49.53', '71.05', '121.52'], pat: ['38.51', '51.59', '90.71'], pat_owners: null
    }
  });

  it('the rule-based parser really fails on the mangled filing (precondition)', () => {
    expect(extractDeterministicFinancials(mangled)).toBeNull();
  });

  it('accepts figures that literally appear in the filing and computes every ratio deterministically', async () => {
    const fin = await extractFinancialsViaLlm({ docText: mangled, ticker: 'SHAKTIPUMP', runPrompt: async () => llmReply(['746.03', '858.67', '666.35']) });
    expect(fin).not.toBeNull();
    expect(fin.verification).toBe('LLM_LOCATED_TEXT_GROUNDED');
    expect(fin.revenue).toBe(746.03);
    expect(fin.revenueYoYGrowthPct).toBe(11.96);   // computed by code, not by the model
    expect(fin.patYoYGrowthPct).toBe(-57.55);
    expect(fin.ebitda).toBe(76.48);
  });

  it('rejects a transcription containing a figure that is not in the filing text (no AI-guessed numbers)', async () => {
    const fin = await extractFinancialsViaLlm({ docText: mangled, ticker: 'SHAKTIPUMP', runPrompt: async () => llmReply(['760.00', '858.67', '666.35']) });
    expect(fin).toBeNull();
  });

  it('a gate that passes on AI-located figures still refuses to authorise a buy', () => {
    const fin = { revenue: 800, revenueYoYGrowthPct: 12, patConsolidated: 150, patYoYGrowthPct: 20, ebitda: 260, ebitdaMarginPct: 16, ebitdaMarginBpsDelta: 40, isMarginErosion: false };
    const g = evaluateDualLayerActionGate({ ticker: 'HBLENGINE', financialData: fin, proposedAction: 'ADD', llmConviction: 8, financialsVerified: false });
    expect(g.finalAction).toBe('WATCH / WAIT FOR CONFIRMATION');
    expect(g.statusClassification).toBe('UNVERIFIED_FIGURES');
    expect(g.actionAuthorized).toBe(false);
  });
});

describe('Concall scheduled heads-up', () => {
  const NOW = new Date('2026-10-24T05:00:00.000Z');
  const invite = 'Shakti Pumps (India) Limited has scheduled an Earnings Conference Call for Q2 FY27 results on Tuesday, October 28, 2026 at 4:00 PM IST. Link to join: https://services.choruscall.in/DiamondPassRegistration/register?confirmationNumber=12345';

  it('the exchange standard title ("...Investor Meet/Con. Call Updates") is recognised as a scheduled earnings call, not a private meet', () => {
    const title = 'Analysts/Institutional Investor Meet/Con. Call Updates';
    expect(getConcallType(title, invite)).toBe('scheduled');
    expect(isEarningsConcallInvite(title, invite)).toBe(true);
  });

  it('a genuine private fund meeting is still ignored', () => {
    const title = 'Analysts/Institutional Investor Meet/Con. Call Updates';
    expect(isEarningsConcallInvite(title, 'The Company will participate in a one-on-one meeting with fund managers organized by XYZ Securities on 28th October 2026.')).toBe(false);
  });

  it('extracts date, time and joining link; ignores dates in the past', () => {
    const sch = extractConcallSchedule(invite, {}, NOW);
    expect(sch.date).toBe('2026-10-28');
    expect(sch.time).toBe('16:00');
    expect(sch.link).toContain('choruscall');
    const past = extractConcallSchedule('Earnings call was held on 1st October 2026 at 10:00 AM', {}, NOW);
    expect(past.date).toBeNull();
  });

  it('prefers the model-extracted date/time when supplied', () => {
    const sch = extractConcallSchedule('Earnings call details in the attached letter', { date: '2026-10-29', time: '11:30' }, NOW);
    expect(sch.date).toBe('2026-10-29');
    expect(sch.time).toBe('11:30');
  });

  it('formats a short Telegram heads-up with when / join link', () => {
    const msg = formatConcallScheduleMessage({
      ticker: 'SHAKTIPUMP', companyName: 'Shakti Pumps (India) Limited',
      schedule: { date: '2026-10-28', time: '16:00', link: 'https://services.choruscall.in/x' },
      docUrl: 'https://nsearchives.nseindia.com/corporate/x.pdf'
    });
    expect(msg).toContain('Earnings Concall Scheduled');
    expect(msg).toContain('28 Oct 2026');
    expect(msg).toContain('4:00 PM IST');
    expect(msg).toContain('choruscall');
    expect(formatConcallScheduleMessage({ ticker: 'X', schedule: {}, isRescheduled: true })).toContain('Rescheduled');
  });
});

describe('Thesis seeding (never destructive)', () => {
  const lumax = () => getThesisContract('LUMAXTECH');

  it('expands a placeholder thesis around the original wording and fills the empty lists from the driver contract', () => {
    const out = buildEnrichedThesis({
      existingRaw: JSON.stringify({ primary_thesis: 'Auto premiumisation', key_catalysts: [], risk_factors: [], conviction_drivers: [] }),
      contract: lumax()
    });
    const t = JSON.parse(out.thesisJson);
    expect(out.changed).toBe(true);
    expect(t.primary_thesis.startsWith('Auto premiumisation — ')).toBe(true);
    expect(t.primary_thesis).toContain('Thesis holds as long as');
    expect(t.key_catalysts).toHaveLength(4);
    expect(t.risk_factors.every(r => r.includes('falsified if'))).toBe(true);
    expect(t.risk_factors.join(' ')).toContain('EBITDA');   // acronyms keep their case
    expect(t.conviction_drivers[0]).toMatch(/\(HIGH\)$/);
  });

  it('keeps a substantive thesis and any non-empty lists untouched', () => {
    const existing = {
      primary_thesis: 'x'.repeat(200),
      key_catalysts: ['My own catalyst'], risk_factors: ['My own risk'], conviction_drivers: ['My driver']
    };
    const out = buildEnrichedThesis({ existingRaw: JSON.stringify(existing), existingKeyMetrics: 'already set', contract: lumax() });
    expect(out.changed).toBe(false);
    expect(JSON.parse(out.thesisJson)).toEqual(existing);
    expect(out.keyMetrics).toBe('already set');
  });

  it('converts a plain-text thesis to JSON without losing the original text', () => {
    const text = 'Himadri is India\'s only integrated carbon material company. ' + 'y'.repeat(150);
    const out = buildEnrichedThesis({ existingRaw: text, contract: lumax() });
    expect(out.convertedFromPlainText).toBe(true);
    expect(JSON.parse(out.thesisJson).primary_thesis).toBe(text);
  });

  it('does nothing (and says why) for a stock with no contract', () => {
    const out = buildEnrichedThesis({ existingRaw: 'short', contract: null });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe('no driver contract');
  });

  it('MOREPENLAB has a provisional contract from the supplementary file and it is flagged as such', () => {
    const c = getThesisContract('MOREPENLAB');
    expect(c).not.toBeNull();
    expect(c.provisional).toBe(true);
    expect(c.drivers.length).toBeGreaterThanOrEqual(3);
    const out = buildEnrichedThesis({ existingRaw: JSON.stringify({ primary_thesis: 'CDMO' }), contract: c });
    expect(JSON.parse(out.thesisJson).primary_thesis).toContain('Provisional');
  });

  it('findThesisGaps flags only stocks with a placeholder thesis AND no contract', () => {
    const gaps = findThesisGaps([
      { ticker: 'LUMAXTECH', investment_thesis: JSON.stringify({ primary_thesis: 'Auto premiumisation' }) }, // has contract
      { ticker: 'NEWCO', investment_thesis: JSON.stringify({ primary_thesis: 'Growth' }) },                  // gap
      { ticker: 'RICHCO', investment_thesis: JSON.stringify({ primary_thesis: 'z'.repeat(300) }) }           // rich text
    ]);
    expect(gaps).toEqual(['NEWCO']);
  });
});
