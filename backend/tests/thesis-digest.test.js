/**
 * The per-stock THESIS STATUS digest: decks / transcripts / audio are batched into one message per stock that leads with
 * where each thesis driver stands (newest evidence across recent filings), not with one filing's generic summary.
 */
import { describe, it, expect } from 'vitest';
import {
  DIGEST_MAX_WAIT_MS,
  routeAlert,
  buildThesisStatusBoard,
  overallThesisStatus,
  shouldSendDigest,
  buildDigestItem,
  isContentFreeDigestItem,
  formatThesisDigestMessage
} from '../services/thesis-digest.service.js';

const drivers = [
  { name: 'Order execution', materiality: 'HIGH' },
  { name: 'Working capital discipline', materiality: 'HIGH' },
  { name: 'Capacity ramp-up', materiality: 'MEDIUM' }
];
const a = (driver, status, evidence) => ({ driver, status, evidence, grounded: true, materiality: drivers.find(d => d.name === driver).materiality });
const NO = (driver) => a(driver, 'NO_EVIDENCE', 'No new evidence in this filing');

describe('routeAlert', () => {
  it('verified statement filings go out immediately; transcripts, decks, audio and press releases are digested', () => {
    expect(routeAlert({ isStatementFiling: true, isTranscript: false, isAudio: false })).toBe('immediate');
    expect(routeAlert({ isStatementFiling: false, isTranscript: true, isAudio: false })).toBe('digest');
    expect(routeAlert({ isStatementFiling: false, isTranscript: false, isAudio: false })).toBe('digest');
    expect(routeAlert({ isStatementFiling: false, isTranscript: false, isAudio: true })).toBe('digest');
    expect(routeAlert({ isStatementFiling: true, isTranscript: true, isAudio: false })).toBe('digest');
  });
});

describe('buildThesisStatusBoard', () => {
  const entries = [
    { filedAt: '2026-10-28T10:00:00Z', source: 'Concall', assessment: [a('Order execution', 'CONFIRMED', 'Order book at 1,450 Cr, up 30% YoY'), NO('Working capital discipline'), NO('Capacity ramp-up')] },
    { filedAt: '2026-10-23T10:00:00Z', source: 'Results', assessment: [a('Order execution', 'AT_RISK', 'Older view that is superseded'), a('Working capital discipline', 'AT_RISK', 'Receivable days rose to 128 from 96'), NO('Capacity ramp-up')] }
  ];

  it('takes the newest evidence per driver and carries older evidence forward when the latest filing was silent', () => {
    const board = buildThesisStatusBoard(entries, drivers);
    expect(board.map(b => b.driver)).toEqual(drivers.map(d => d.name));
    expect(board[0]).toMatchObject({ status: 'CONFIRMED', evidence: 'Order book at 1,450 Cr, up 30% YoY', asOf: '2026-10-28T10:00:00Z' });
    expect(board[1]).toMatchObject({ status: 'AT_RISK', evidence: 'Receivable days rose to 128 from 96', asOf: '2026-10-23T10:00:00Z' });
  });

  it('a driver that no filing has ever addressed stays NO_EVIDENCE (never invented)', () => {
    const board = buildThesisStatusBoard(entries, drivers);
    expect(board[2]).toMatchObject({ status: 'NO_EVIDENCE', asOf: null });
  });

  it('ignores evidence that was never verified against a filing (e.g. rows written before grounding existed)', () => {
    const legacy = [{ filedAt: '2026-10-25T10:00:00Z', source: 'Deck', assessment: [
      { driver: 'Order execution', status: 'CONFIRMED', evidence: 'EV order backlog of 1,500 Cr converted smoothly', materiality: 'HIGH' }       // no grounded stamp
    ] }];
    const board = buildThesisStatusBoard(legacy, drivers);
    expect(board[0]).toMatchObject({ status: 'NO_EVIDENCE', evidence: '' });
    expect(JSON.stringify(board)).not.toContain('1,500');
  });

  it('returns an empty board when the stock has no driver contract', () => {
    expect(buildThesisStatusBoard(entries, [])).toEqual([]);
  });
});

describe('overallThesisStatus', () => {
  const row = (status, materiality = 'HIGH') => ({ driver: 'd', status, evidence: 'x', materiality });
  it('a BROKEN driver makes the thesis red', () => {
    expect(overallThesisStatus([row('BROKEN'), row('CONFIRMED')]).emoji).toBe('🔴');
  });
  it('an AT_RISK driver makes it amber even when others are confirmed', () => {
    expect(overallThesisStatus([row('AT_RISK'), row('CONFIRMED')]).emoji).toBe('🟠');
  });
  it('confirmed / on-track drivers only is green', () => {
    expect(overallThesisStatus([row('CONFIRMED'), row('ON_TRACK')]).emoji).toBe('🟢');
  });
  it('no evidence at all is grey, never green', () => {
    expect(overallThesisStatus([row('NO_EVIDENCE')]).emoji).toBe('⚪');
    expect(overallThesisStatus([]).emoji).toBe('⚪');
  });
});

describe('shouldSendDigest', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  it('sends as soon as the stock has no other filing still being processed', () => {
    expect(shouldSendDigest({ queuedAt: [now - 1000], otherPending: 0, now })).toBe(true);
  });
  it('waits briefly while a sibling filing of the same stock is still queued', () => {
    expect(shouldSendDigest({ queuedAt: [now - 60_000], otherPending: 2, now })).toBe(false);
  });
  it('never holds an item longer than the max wait, even if a sibling is stuck', () => {
    expect(shouldSendDigest({ queuedAt: [now - DIGEST_MAX_WAIT_MS - 1], otherPending: 1, now })).toBe(true);
  });
  it('treats unparseable queue times as already due (never holds forever)', () => {
    expect(shouldSendDigest({ queuedAt: [undefined], otherPending: 3, now })).toBe(true);
  });
});

describe('buildDigestItem', () => {
  it('keeps only compact, user-relevant fields from a verdict', () => {
    const item = buildDigestItem({
      kind: 'CONCALL',
      title: 'Earnings Call Transcript',
      url: 'https://example.test/t.pdf',
      filedAt: '2026-10-28T10:00:00Z',
      queuedAt: '2026-10-28T10:05:00Z',
      verdict: {
        final_action: 'HOLD', conviction_score: 5, credibility_tier: 'Tier 2',
        verdict_summary: 'Order book grew while receivable days stretched.',
        key_positives: ['Order book 1,450 Cr'], key_concerns_and_drags: ['Receivable days 128'],
        concall_highlights: {
          quarterly_guidance: ['Q3 dispatches expected to rise sequentially'], annual_guidance: [],
          operational_highlights: ['Receivable days were 128 versus 96 a year ago'],
          financial_performance: ['Order book 1,450 Cr'], business_performance: [], growth_initiatives: [], multi_year_targets: []
        },
        commitments: [{ statement: 'Cut receivable days by 10', status: 'Delayed', blockers_and_risks: 'Subsidy tranche delay' }, { statement: 'Open new line', status: 'Pending' }],
        thesis_driver_assessment: [a('Order execution', 'CONFIRMED', 'Order book 1,450 Cr')],
        _raw_text: 'SHOULD NEVER BE STORED'
      }
    });
    expect(item).toMatchObject({ kind: 'CONCALL', action: 'HOLD', conviction: 5, queuedAt: '2026-10-28T10:05:00Z' });
    expect(item.positives).toEqual(['Order book 1,450 Cr']);
    expect(item.guidance).toEqual(['Q3 dispatches expected to rise sequentially']);
    expect(item.facts).toEqual(['Order book 1,450 Cr', 'Receivable days were 128 versus 96 a year ago']); // the call's grounded facts
    expect(item.commitmentFlags).toHaveLength(1);              // only Delayed / Missed are flagged
    expect(JSON.stringify(item)).not.toContain('SHOULD NEVER BE STORED');
  });

  it('does not carry the "AI synthesis unavailable" filler as a summary', () => {
    const item = buildDigestItem({ kind: 'DECK', title: 'Investor Presentation', filedAt: '2026-10-28T10:00:00Z', verdict: { _llm_failed: true, verdict_summary: 'AI synthesis unavailable for this filing; verified figures only.' } });
    expect(item.summary).toBe('');
    expect(item.llmFailed).toBe(true);
  });
});

describe('formatThesisDigestMessage', () => {
  const board = buildThesisStatusBoard([
    { filedAt: '2026-10-28T10:00:00Z', source: 'Concall', assessment: [a('Order execution', 'CONFIRMED', 'Order book at 1,450 Cr, up 30% YoY'), a('Working capital discipline', 'AT_RISK', 'Receivable days rose to 128 from 96'), NO('Capacity ramp-up')] }
  ], drivers);
  const items = [
    { kind: 'CONCALL', title: 'Earnings Call Transcript', url: 'https://example.test/t.pdf', filedAt: '2026-10-28T10:00:00Z', action: 'HOLD', conviction: 5, summary: 'Order book grew while receivable days stretched.', positives: ['Order book 1,450 Cr', 'Same positive'], concerns: ['Receivable days 128'], guidance: ['Q3 dispatches expected to rise sequentially'], commitmentFlags: [{ statement: 'Cut receivable days by 10', status: 'Delayed', reason: 'Subsidy tranche delay' }] },
    { kind: 'DECK', title: 'Investor Presentation', url: 'https://example.test/d.pdf', filedAt: '2026-10-28T09:00:00Z', action: 'HOLD', conviction: 5, summary: '', positives: ['same positive'], concerns: [], guidance: [], commitmentFlags: [] },
    { kind: 'AUDIO', title: 'Concall audio recording', url: 'https://example.test/a.pdf', filedAt: '2026-10-28T08:00:00Z', summary: '', positives: [], concerns: [], guidance: [], commitmentFlags: [] }
  ];
  const msg = formatThesisDigestMessage({ ticker: 'SHAKTIPUMP', companyName: 'Shakti Pumps (India) Limited', items, board, overall: overallThesisStatus(board), financialsBlock: '\n📊 *LATEST VERIFIED RESULTS (Q2 FY27):*\n• *Revenue:* ₹746.03 Cr (+11.96% YoY)\n' });

  it('leads with the thesis status before any per-filing detail', () => {
    expect(msg.indexOf('THESIS STATUS')).toBeGreaterThan(-1);
    expect(msg.indexOf('THESIS STATUS')).toBeLessThan(msg.indexOf('Earnings Call Transcript'));
    expect(msg).toContain('🟠');
  });
  it('shows each driver with its newest evidence and date, and collapses silent drivers', () => {
    expect(msg).toContain('Order execution');
    expect(msg).toContain('Order book at 1,450 Cr, up 30% YoY');
    expect(msg).toContain('Receivable days rose to 128 from 96');
    expect(msg).toMatch(/1 driver\(s\) with no evidence yet/);
  });
  it('shows the concall facts that back the driver evidence', () => {
    const withFacts = formatThesisDigestMessage({ ticker: 'X', items: [{ ...items[0], facts: ['Receivable days were 128 versus 96 a year ago'] }], board, overall: overallThesisStatus(board) });
    expect(withFacts).toContain('Receivable days were 128 versus 96 a year ago');
  });
  it('includes the latest verified results, the new items, guidance and flagged commitments', () => {
    expect(msg).toContain('₹746.03 Cr');
    expect(msg).toContain('Q3 dispatches expected to rise sequentially');
    expect(msg).toContain('Delayed');
    expect(msg).toContain('https://example.test/t.pdf');
    expect(msg).toContain('https://example.test/d.pdf');
  });
  it('repeats no bullet that two filings both state, and collapses empty filings to one line', () => {
    expect((msg.match(/same positive/gi) || []).length).toBe(1);
    expect(msg).toMatch(/Also filed:.*Concall audio recording/s);
  });
  it('never labels a missing-statement digest a thesis deviation and always carries the not-advice note', () => {
    expect(msg).not.toContain('Thesis Deviation');
    expect(msg).toMatch(/not (personal )?investment advice/i);
  });
  it('stays well under Telegram limits for a normal stock', () => {
    expect(msg.length).toBeLessThan(3500);
  });
});

describe('digest hygiene (live SKIPPER dry run, 2026-10-31)', () => {
  it('a content-free filing (a recording notice with no figures, no claims, no driver evidence) is recognised so it is not sent as "No driver evidence yet"', () => {
    const empty = buildDigestItem({ kind: 'OTHER', title: 'Con. Call Updates', filedAt: '2026-10-30T15:00:00Z', verdict: {
      verdict_summary: 'The filing provides only a conference call recording notice without any data.',
      key_positives: [], key_concerns_and_drags: [],
      thesis_driver_assessment: drivers.map((d) => ({ driver: d.name, status: 'NO_EVIDENCE', evidence: '' }))
    } });
    expect(isContentFreeDigestItem(empty)).toBe(true);
  });

  it('a filing with any positive, concern, guidance, fact, flagged commitment or driver evidence has content', () => {
    const base = { kind: 'DECK', title: 'Deck', filedAt: '2026-10-30T15:00:00Z' };
    expect(isContentFreeDigestItem(buildDigestItem({ ...base, verdict: { key_positives: ['Order book crossed a record level'] } }))).toBe(false);
    expect(isContentFreeDigestItem(buildDigestItem({ ...base, verdict: { key_concerns_and_drags: ['Margin pressure from input costs'] } }))).toBe(false);
    expect(isContentFreeDigestItem(buildDigestItem({ ...base, verdict: { thesis_driver_assessment: [{ driver: drivers[0].name, status: 'CONFIRMED', evidence: 'Capacity commissioned ahead of schedule' }] } }))).toBe(false);
    expect(isContentFreeDigestItem(buildDigestItem({ ...base, verdict: { commitments: [{ statement: 'Plant commissioning', status: 'Delayed', blockers_and_risks: 'Equipment lead time' }] } }))).toBe(false);
  });

  it('a failed-AI item is never treated as content-free (it must still tell the user a filing arrived)', () => {
    expect(isContentFreeDigestItem(buildDigestItem({ kind: 'DECK', title: 'Deck', filedAt: '2026-10-30T15:00:00Z', verdict: { _llm_failed: true } }))).toBe(false);
  });

  it('the header drops the " share price" suffix that stored company names carry ("Skipper Ltd share price")', () => {
    const msg = formatThesisDigestMessage({ ticker: 'SKIPPER', companyName: 'Skipper Ltd share price', items: [], board: [], overall: overallThesisStatus([]) });
    expect(msg).toContain('*SKIPPER* | Skipper Ltd');
    expect(msg).not.toMatch(/share price/i);
  });
});

describe('signal rationale: the digest says HOW the signal was reached (results -> drivers -> this filing -> concall -> verdict)', () => {
  const fin = { statementScope: 'CONSOLIDATED', revenue: 456.48, revenueYoYGrowthPct: 27.43, ebitda: 99.71, ebitdaMarginPct: 21.84, ebitdaMarginBpsDelta: -295, patAttributable: 66.56, patYoYGrowthPct: 9.41 };
  const gateFail = { classification: 'TEMPORARY_FRICTION', explanation: 'Top-line and profit are expanding but EBITDA margin compressed.', hurdleStatus: 'FAIL', hurdleReason: 'EBITDA Margin 21.84% < target 22%' };
  const board = buildThesisStatusBoard([{ filedAt: '2026-11-03T10:00:00Z', source: 'Deck', assessment: [a('Order execution', 'CONFIRMED', 'Order book at 2,268 Cr, a record'), a('Working capital discipline', 'ON_TRACK', 'Receivable days steady'), NO('Capacity ramp-up')] }], drivers);
  const item = { kind: 'DECK', title: 'Investor Presentation', filedAt: '2026-11-03T10:00:00Z', action: 'HOLD / MONITOR', conviction: 6, summary: 'Strong order book.', positives: ['Order backlog at a record'], concerns: ['EBITDA margin compressed 295 bps YoY'], guidance: [], commitmentFlags: [], gate: gateFail };
  const base = { ticker: 'INOXINDIA', items: [item], board, overall: overallThesisStatus(board), fin, periodLabel: 'Q2 FY27' };

  it('buildDigestItem keeps a compact copy of the gate result and never the raw verdict', () => {
    const di = buildDigestItem({ kind: 'DECK', title: 'Deck', filedAt: '2026-11-03T10:00:00Z', verdict: { final_action: 'HOLD / MONITOR', conviction_score: 6, thesis_gate_result: { statusClassification: 'TEMPORARY_FRICTION', decisionExplanation: 'Margin compressed.', thesisGate: { status: 'FAIL', reason: 'EBITDA Margin 21.84% < target 22%', hurdlesEvaluated: 'Primary: EBITDA margin >= 22%' }, secret: 'x' } } });
    expect(di.gate).toMatchObject({ classification: 'TEMPORARY_FRICTION', hurdleStatus: 'FAIL', hurdleReason: 'EBITDA Margin 21.84% < target 22%' });
    expect(JSON.stringify(di.gate)).not.toContain('secret');
  });

  it('explains why a stock whose drivers are intact is still only HOLD: the missed hurdle is named, with the numbers', () => {
    const msg = formatThesisDigestMessage({ ...base, concall: { status: 'PENDING' } });
    expect(msg).toContain('HOW THIS SIGNAL WAS REACHED');
    expect(msg).toMatch(/Results \(Q2 FY27, consolidated\).*Revenue \+27\.4% YoY/s);
    expect(msg).toContain('EBITDA Margin 21.84% < target 22%');
    expect(msg).toMatch(/Thesis drivers.*1 confirmed · 1 on track/s);
    expect(msg).toMatch(/Verdict: HOLD \/ MONITOR.*hurdle/s);
    // the signal is stated at the top, next to the thesis status, not only in the footer
    expect(msg.indexOf('SIGNAL')).toBeLessThan(msg.indexOf('DRIVER BOARD'));
  });

  it('says plainly when the concall has not been analysed yet, and when it has', () => {
    expect(formatThesisDigestMessage({ ...base, concall: { status: 'PENDING' } })).toMatch(/Concall:.*not analysed yet.*provisional/s);
    expect(formatThesisDigestMessage({ ...base, items: [{ ...item, kind: 'CONCALL' }], concall: { status: 'ANALYSED' } })).toMatch(/Concall:.*analysed/s);
    expect(formatThesisDigestMessage({ ...base, items: [{ ...item, kind: 'CONCALL' }], concall: { status: 'ANALYSED' } })).not.toMatch(/not analysed yet/);
  });

  it('a broken or at-risk driver is the named reason, ahead of any hurdle', () => {
    const risky = buildThesisStatusBoard([{ filedAt: '2026-11-03T10:00:00Z', source: 'Deck', assessment: [a('Order execution', 'CONFIRMED', 'Order book at 2,268 Cr'), a('Working capital discipline', 'AT_RISK', 'Receivable days rose to 128 from 96'), NO('Capacity ramp-up')] }], drivers);
    const msg = formatThesisDigestMessage({ ...base, board: risky, overall: overallThesisStatus(risky) });
    expect(msg).toMatch(/Verdict: HOLD \/ MONITOR.*Working capital discipline/s);
  });

  it('with no verified results the message says so instead of implying a numbers check happened', () => {
    const msg = formatThesisDigestMessage({ ...base, fin: null, periodLabel: null, items: [{ ...item, gate: null }] });
    expect(msg).toMatch(/Results:.*no verified results/s);
  });

  it('a BUY signal is explained by passing numbers and confirmed drivers', () => {
    const buy = { ...item, action: 'BUY / ACCUMULATE', conviction: 8, gate: { classification: 'THESIS_CONFIRMED_BEAT', explanation: 'Numbers beat.', hurdleStatus: 'PASS', hurdleReason: '' } };
    const msg = formatThesisDigestMessage({ ...base, items: [buy], concall: { status: 'ANALYSED' } });
    expect(msg).toMatch(/Verdict: BUY \/ ACCUMULATE.*hurdles/s);
  });

  it('near-identical bullets from one filing ("Rs. 73 Cr" / "₹73 Cr") are shown once', () => {
    const dup = { ...item, concerns: ['Interest expenses increased 22% YoY to Rs. 73 Cr in Q2 FY27.', 'Interest expenses increased 22% YoY to ₹73 Cr in Q2 FY27.', 'Working capital days stood at 82 days in H1FY27.'] };
    const msg = formatThesisDigestMessage({ ...base, items: [dup] });
    const detail = msg.split('NEW SINCE LAST UPDATE')[1];   // the rationale line may quote the main concern once; the detail lists it once too
    expect((detail.match(/Interest expenses increased 22%/g) || []).length).toBe(1);
    expect(detail).toContain('Working capital days stood at 82 days');
  });

  it('stays within Telegram limits with the extra block', () => {
    expect(formatThesisDigestMessage({ ...base, concall: { status: 'PENDING' } }).length).toBeLessThan(3500);
  });
});

describe('driver evidence that admits there is no evidence is not evidence', () => {
  it('a driver marked ON_TRACK/CONFIRMED on text saying the figures are "not separately detailed" becomes NO_EVIDENCE; quantified evidence with a caveat stays', async () => {
    const { normalizeDriverAssessment } = await import('../services/thesis-driver-context.service.js');
    const ds = [{ name: 'Subsidiary turnaround', materiality: 'HIGH' }, { name: 'Order book', materiality: 'HIGH' }, { name: 'Margins', materiality: 'HIGH' }];
    const out = normalizeDriverAssessment([
      { driver: 'Subsidiary turnaround', status: 'ON_TRACK', evidence: 'Consolidated figures reflect subsidiary inclusion, but specific standalone Huron EBITDA figures are not separately detailed in this slide deck excerpt.' },
      { driver: 'Order book', status: 'CONFIRMED', evidence: 'Order book at Rs. 5,082 Cr; segment-wise split not disclosed.' },
      { driver: 'Margins', status: 'AT_RISK', evidence: 'Margin commentary was not provided; consolidated margin fell.' }
    ], ds);
    expect(out.find(o => o.driver === 'Subsidiary turnaround').status).toBe('NO_EVIDENCE');
    expect(out.find(o => o.driver === 'Order book').status).toBe('CONFIRMED');
    expect(out.find(o => o.driver === 'Margins').status).toBe('AT_RISK');   // a risk flag is never erased by this rule
  });
});

describe('dropRestatedFigures: bullets that only repeat the verified headline numbers are not shown a second time', () => {
  const fin = { revenue: 2030.22, patAttributable: 103.94, patConsolidated: 103.94, ebitda: 237.93 };
  it('removes "Consolidated Revenue: ₹2030.22 Cr" and "Attributable PAT: ₹103.94 Cr" but keeps other facts', async () => {
    const { dropRestatedFigures } = await import('../services/thesis-digest.service.js');
    const out = dropRestatedFigures([
      'Consolidated Revenue: ₹2030.22 Cr',
      'Attributable PAT (Q2 FY27): ₹103.94 Cr',
      'Consolidated revenue grew 32.33% YoY to ₹2,030.22 Cr.',
      'International branch revenues (half year): ₹648.01 Cr',
      'Order backlog of ₹14,218 Cr, up from ₹12,000 Cr',
      'Cash and cash equivalents closing balance: ₹607.93 Cr'
    ], fin);
    expect(out).toEqual([
      'International branch revenues (half year): ₹648.01 Cr',
      'Order backlog of ₹14,218 Cr, up from ₹12,000 Cr',
      'Cash and cash equivalents closing balance: ₹607.93 Cr'
    ]);
  });
  it('without verified figures nothing is dropped', async () => {
    const { dropRestatedFigures } = await import('../services/thesis-digest.service.js');
    expect(dropRestatedFigures(['Consolidated Revenue: ₹2030.22 Cr'], null)).toEqual(['Consolidated Revenue: ₹2030.22 Cr']);
  });
  it('a number that merely equals a headline figure inside an unrelated line is kept (needs the revenue/profit/EBITDA label)', async () => {
    const { dropRestatedFigures } = await import('../services/thesis-digest.service.js');
    expect(dropRestatedFigures(['Order book stands at 2030.22 Cr'], fin)).toEqual(['Order book stands at 2030.22 Cr']);
  });
});
