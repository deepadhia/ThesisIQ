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
  filingLinkText,
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

  it('operations / business bullets sit under neutral headings, never "Capex & Plant" or "Order Book" (POLICYBZR 2026-11-04 showed claims data under both)', () => {
    const fin = { ...item, operations: ['Claims settled in the quarter rose 18% YoY.'], businessExecution: ['Online premium of Rs. 4,200 Cr, up 31%.'] };
    const msg = formatThesisDigestMessage({ ...base, items: [fin] });
    expect(msg).toContain('Claims settled in the quarter');
    expect(msg).toContain('Online premium of Rs. 4,200 Cr');
    expect(msg).not.toMatch(/Capex & Plant Commissioning/);
    expect(msg).not.toMatch(/Order Book Execution/);
  });

  it('stays within Telegram limits with the extra block', () => {
    expect(formatThesisDigestMessage({ ...base, concall: { status: 'PENDING' } }).length).toBeLessThan(3500);
  });
});

describe('investor presentations get the call write-up structure; verified numbers are printed once', () => {
  const hl = { guidance_changes: ['EBITDA margin guidance: raised to 29-30% (raised)'], financial_performance: ['Revenue of 282.7 Cr, up 16.9%'], business_performance: ['Passenger vehicle segment grew strongly'], operational_highlights: ['Display plant commissioning by Q2 FY28'], growth_initiatives: [], key_challenges: ['Global macro environment'], key_positives: [], key_monitorables: [], annual_guidance: [], quarterly_guidance: [], multi_year_targets: [] };
  const deck = { kind: 'DECK', title: 'Investor Presentation', highlights: hl };

  it('a deck with highlights is rendered in numbered sections with its own label, guidance first', async () => {
    const { formatConcallHighlightsBlock } = await import('../services/thesis-digest.service.js');
    const out = formatConcallHighlightsBlock(deck, 'Deck link');
    expect(out).toContain('📑 Investor presentation');
    expect(out.indexOf('GUIDANCE & OUTLOOK')).toBeLessThan(out.indexOf('CAPACITY & CAPEX'));
    expect(out).toContain('🔺');
  });

  it('when verified results exist, the deck\'s own QUARTERLY NUMBERS section is omitted (the numbers are printed once, from the parser); a call keeps it', async () => {
    const { formatConcallHighlightsBlock } = await import('../services/thesis-digest.service.js');
    const fin = { revenue: 282.7, ebitda: 87.6 };
    expect(formatConcallHighlightsBlock(deck, '', (l) => l, fin)).not.toContain('QUARTERLY NUMBERS');
    expect(formatConcallHighlightsBlock(deck, '', (l) => l, null)).toContain('QUARTERLY NUMBERS');
    expect(formatConcallHighlightsBlock({ ...deck, kind: 'CONCALL' }, '', (l) => l, fin)).toContain('QUARTERLY NUMBERS');
  });
});

describe('alert volume: fewer, fuller messages (user: "I get overwhelmed with alerts")', () => {
  const NOW = Date.parse('2026-11-04T10:00:00Z');
  const ago = (min) => new Date(NOW - min * 60_000).toISOString();

  const HOUR = 60;
  it('a deck / press release that follows an alerted results statement is held up to 24 h so it can go out WITH the call (one message per stock per 24 h; SJS 2026-11-04 got press release, deck and call as separate messages)', async () => {
    const { shouldSendDigest, EARNINGS_HOLD_MS } = await import('../services/thesis-digest.service.js');
    expect(EARNINGS_HOLD_MS).toBe(24 * 60 * 60 * 1000);
    expect(shouldSendDigest({ queuedAt: [ago(10)], otherPending: 0, now: NOW, kinds: ['PRESS'], resultsAlerted: true })).toBe(false);
    expect(shouldSendDigest({ queuedAt: [ago(10 * HOUR), ago(2 * HOUR)], otherPending: 0, now: NOW, kinds: ['PRESS', 'DECK'], resultsAlerted: true })).toBe(false);
    expect(shouldSendDigest({ queuedAt: [ago(23 * HOUR)], otherPending: 0, now: NOW, kinds: ['DECK'], resultsAlerted: true })).toBe(false);
    expect(shouldSendDigest({ queuedAt: [ago(24 * HOUR + 1)], otherPending: 0, now: NOW, kinds: ['DECK'], resultsAlerted: true })).toBe(true);
  });

  it('the hold ends as soon as the call arrives (it goes out together with the deck), and never applies without an alerted results statement', async () => {
    const { shouldSendDigest } = await import('../services/thesis-digest.service.js');
    expect(shouldSendDigest({ queuedAt: [ago(2 * HOUR), ago(1)], otherPending: 0, now: NOW, kinds: ['DECK', 'CONCALL'], resultsAlerted: true })).toBe(true);
    expect(shouldSendDigest({ queuedAt: [ago(1)], otherPending: 0, now: NOW, kinds: ['AUDIO'], resultsAlerted: true })).toBe(true);
    expect(shouldSendDigest({ queuedAt: [ago(1)], otherPending: 0, now: NOW, kinds: ['DECK'], resultsAlerted: false })).toBe(true);
    expect(shouldSendDigest({ queuedAt: [ago(1)], otherPending: 0, now: NOW })).toBe(true); // old call signature
  });

  it('urgent news is never held: a guidance cut, a driver at risk / broken, a delayed or missed commitment, or a failed AI read goes out at once', async () => {
    const { shouldSendDigest, hasUrgentDigestItem } = await import('../services/thesis-digest.service.js');
    const base = { kind: 'DECK', guidanceCuts: [], assessment: [], commitmentFlags: [], llmFailed: false };
    expect(hasUrgentDigestItem([base])).toBe(false);
    expect(hasUrgentDigestItem([{ ...base, guidanceCuts: ['Revenue growth outlook 1.5-2x -> 1.2-1.5x (cut)'] }])).toBe(true);
    expect(hasUrgentDigestItem([{ ...base, assessment: [{ driver: 'D', status: 'BROKEN', evidence: 'x' }] }])).toBe(true);
    expect(hasUrgentDigestItem([{ ...base, assessment: [{ driver: 'D', status: 'AT_RISK', evidence: 'x' }] }])).toBe(true);
    expect(hasUrgentDigestItem([{ ...base, commitmentFlags: [{ statement: 's', status: 'Missed' }] }])).toBe(true);
    expect(hasUrgentDigestItem([{ ...base, llmFailed: true }])).toBe(true);
    expect(hasUrgentDigestItem([base, { ...base, kind: 'PRESS', guidanceCuts: ['cut'] }])).toBe(true);
    expect(shouldSendDigest({ queuedAt: [ago(5)], otherPending: 0, now: NOW, kinds: ['DECK'], resultsAlerted: true, urgent: true })).toBe(true);
  });

  const quiet = { kind: 'PRESS', summary: 'Revenue up 16.9%.', positives: ['PAT up 34.8%'], concerns: [], guidance: [], growthInitiatives: [], operations: [], businessExecution: [], commitmentFlags: [], assessment: [], highlights: null, guidanceCuts: [], llmFailed: false };

  it('a press release that only restates results is folded (not sent) once the results were alerted; the reason is stated', async () => {
    const { quietBatchReason } = await import('../services/thesis-digest.service.js');
    expect(quietBatchReason({ items: [quiet], resultsAlerted: true })).toMatch(/press release|restat|nothing new/i);
  });

  it('nothing is folded when it could carry news: a deck, guidance, a flagged commitment, a driver at risk, a new initiative, a failed AI read, or no alerted results', async () => {
    const { quietBatchReason } = await import('../services/thesis-digest.service.js');
    expect(quietBatchReason({ items: [{ ...quiet, kind: 'DECK' }], resultsAlerted: true })).toBeNull();
    expect(quietBatchReason({ items: [{ ...quiet, guidance: ['FY27 revenue growth 13-14%'] }], resultsAlerted: true })).toBeNull();
    expect(quietBatchReason({ items: [{ ...quiet, commitmentFlags: [{ statement: 'x', status: 'Delayed' }] }], resultsAlerted: true })).toBeNull();
    expect(quietBatchReason({ items: [{ ...quiet, assessment: [{ driver: 'D', status: 'AT_RISK', evidence: 'margin fell 200 bps' }] }], resultsAlerted: true })).toBeNull();
    expect(quietBatchReason({ items: [{ ...quiet, growthInitiatives: ['New plant announced'] }], resultsAlerted: true })).toBeNull();
    expect(quietBatchReason({ items: [{ ...quiet, llmFailed: true }], resultsAlerted: true })).toBeNull();
    expect(quietBatchReason({ items: [quiet], resultsAlerted: false })).toBeNull();
    expect(quietBatchReason({ items: [quiet, { ...quiet, kind: 'CONCALL' }], resultsAlerted: true })).toBeNull();
  });

  const audio = { kind: 'CONCALL', source: 'audio', highlights: { guidance_changes: ['Revenue growth outlook: 1.5-2x -> 1.2-1.5x (cut)', 'EBITDA margin guide: 27-28% -> 29-30% (raised)'], financial_performance: ['Revenue Rs 2,827.3 mn, up 16.9%'], operational_highlights: ['Capex Rs 2,700-2,850 mn'] } };
  const transcript = (h) => ({ kind: 'CONCALL', source: null, highlights: h });

  it('the written transcript of a call whose recording was already written up is folded when it adds no figure the write-up lacked (SJS: the same call twice)', async () => {
    const { repeatsEarlierCallWriteup } = await import('../services/thesis-digest.service.js');
    const same = transcript({ guidance_changes: ['Revenue growth guidance lowered to 1.2-1.5x from 1.5-2x'], financial_performance: ['Revenue of 2,827.3 million, growth 16.9%'] });
    expect(repeatsEarlierCallWriteup({ items: [same], earlierItems: [audio] })).toBe(true);
  });

  it('but a transcript carrying a new figure, a different kind of item, or no earlier write-up is NOT folded', async () => {
    const { repeatsEarlierCallWriteup } = await import('../services/thesis-digest.service.js');
    const newFigure = transcript({ guidance_changes: ['Export share targeted at 18% by FY28'] });
    expect(repeatsEarlierCallWriteup({ items: [newFigure], earlierItems: [audio] })).toBe(false);
    expect(repeatsEarlierCallWriteup({ items: [transcript(audio.highlights)], earlierItems: [] })).toBe(false);
    expect(repeatsEarlierCallWriteup({ items: [{ ...transcript(audio.highlights), kind: 'DECK' }], earlierItems: [audio] })).toBe(false);
    expect(repeatsEarlierCallWriteup({ items: [{ ...transcript(audio.highlights), source: 'audio' }], earlierItems: [audio] })).toBe(false);
    expect(repeatsEarlierCallWriteup({ items: [{ kind: 'CONCALL', source: null, highlights: null }], earlierItems: [audio] })).toBe(false);
  });

  it('the digest header carries the live price context with its date, and says so when it is stale', async () => {
    const { buildPriceContextLine } = await import('../services/thesis-digest.service.js');
    const md = { share_price: '2222', pe_ratio: '37.5', market_cap: '7164', market_data_as_of: '2026-11-04T00:00:00.000Z' };
    const line = buildPriceContextLine(md, Date.parse('2026-11-05T06:00:00Z'));
    expect(line).toContain('₹2,222');
    expect(line).toContain('P/E 37.5');
    expect(line).toContain('7,164');
    expect(line).not.toMatch(/stale/i);
    expect(buildPriceContextLine(md, Date.parse('2026-11-20T06:00:00Z'))).toMatch(/stale/i);
    expect(buildPriceContextLine(null, NOW)).toBe('');
    expect(buildPriceContextLine({ share_price: null, pe_ratio: null, market_cap: null }, NOW)).toBe('');
  });

  it('the price line appears in the message under the company line', async () => {
    const { formatThesisDigestMessage, overallThesisStatus } = await import('../services/thesis-digest.service.js');
    const msg = formatThesisDigestMessage({ ticker: 'SJS', companyName: 'SJS Enterprises', items: [], board: [], overall: overallThesisStatus([]), priceLine: '💹 CMP ₹2,222 · P/E 37.5 (as of 04 Nov)' });
    expect(msg).toContain('💹 CMP ₹2,222');
    expect(msg.indexOf('💹')).toBeGreaterThan(msg.indexOf('SJS'));
    expect(msg.indexOf('💹')).toBeLessThan(msg.indexOf('THESIS STATUS'));
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

  it('a driver marked ON_TRACK / CONFIRMED whose evidence is "no new evidence" is NOT shown green (TIMETECHNO / JYOTICNC flash 2026-11-04)', async () => {
    const { normalizeDriverAssessment, formatDriverAssessmentSection } = await import('../services/thesis-driver-context.service.js');
    const ds = [{ name: 'Driver A', materiality: 'HIGH' }, { name: 'Driver B', materiality: 'HIGH' }, { name: 'Driver C', materiality: 'MEDIUM' }];
    const out = normalizeDriverAssessment([
      { driver: 'Driver A', status: 'ON_TRACK', evidence: 'No new evidence in this filing' },
      { driver: 'Driver B', status: 'CONFIRMED', evidence: 'No further information on this driver was provided.' },
      { driver: 'Driver C', status: 'ON_TRACK', evidence: 'Not addressed in this presentation.' }
    ], ds);
    expect(out.map(o => o.status)).toEqual(['NO_EVIDENCE', 'NO_EVIDENCE', 'NO_EVIDENCE']);
    const text = formatDriverAssessmentSection(out);
    expect(text).not.toContain('🟢');
    expect(text).not.toContain('✅');
  });

  it('CONFIRMED needs a figure or a stated completion; "steady positive operating cash flow" is ON_TRACK at best (TIMETECHNO digest 2026-11-04)', async () => {
    const { normalizeDriverAssessment } = await import('../services/thesis-driver-context.service.js');
    const ds = [{ name: 'Cash flow', materiality: 'HIGH' }, { name: 'Plant', materiality: 'HIGH' }, { name: 'Order book', materiality: 'HIGH' }];
    const out = normalizeDriverAssessment([
      { driver: 'Cash flow', status: 'CONFIRMED', evidence: 'Steady positive operating cash flow generation.' },
      { driver: 'Plant', status: 'CONFIRMED', evidence: 'The new plant was commissioned in September and is operational.' },
      { driver: 'Order book', status: 'CONFIRMED', evidence: 'Order book at Rs. 5,082 Cr.' }
    ], ds);
    expect(out.find(o => o.driver === 'Cash flow').status).toBe('ON_TRACK');
    expect(out.find(o => o.driver === 'Plant').status).toBe('CONFIRMED');
    expect(out.find(o => o.driver === 'Order book').status).toBe('CONFIRMED');
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
  it('drops EBITDA margin lines that only repeat the verified margin percentage', async () => {
    const { dropRestatedFigures } = await import('../services/thesis-digest.service.js');
    const finWithMargin = { ...fin, ebitdaMarginPct: 11.72 };
    expect(dropRestatedFigures(['EBITDA Margin: 11.72%', 'New plant commissioned on schedule'], finWithMargin)).toEqual(['New plant commissioned on schedule']);
  });
});

describe('results flash: the same labelled figure is never listed twice (JYOTICNC 2026-11-03 printed "Inventory: ₹1,245.90 Cr" and "Inventory: ₹1,440.52 Cr" under one heading; SBCL listed the same dividend as achieved twice)', async () => {
  const { dedupeByLabel, dedupeNearDuplicates } = await import('../services/thesis-digest.service.js');
  it('keeps the first value of a repeated "Label: value" bullet and leaves unlabelled bullets alone', () => {
    const out = dedupeByLabel(['Inventory: ₹1,245.90 Cr', 'Trade Receivables: ₹505.78 Cr', 'Inventory: ₹1,440.52 Cr', 'Trade Receivables: ₹506.00 Cr', 'Order book execution is on track', 'Order book execution is on track']);
    expect(out).toEqual(['Inventory: ₹1,245.90 Cr', 'Trade Receivables: ₹505.78 Cr', 'Order book execution is on track', 'Order book execution is on track']);
  });
  it('commitments that restate the same dividend (Rs. 2 vs ₹2 per equity share) collapse to one', () => {
    const out = dedupeNearDuplicates(['Interim dividend of ₹2 per equity share', 'Interim dividend of Rs. 2 per equity share']);
    expect(out).toHaveLength(1);
  });
});

describe('guidance pacing in the digest', () => {
  it('buildDigestItem keeps the compact pacing and the message shows it, worst first, under the verified results', async () => {
    const { buildDigestItem, formatThesisDigestMessage, overallThesisStatus } = await import('../services/thesis-digest.service.js');
    const pacing = [
      { key: 'REVENUE_GROWTH|FY27', kind: 'REVENUE_GROWTH', label: 'Revenue growth', fy: 'FY27', ytdLabel: 'H1', restLabel: 'H2', guidedText: '13–14% growth', status: 'BEHIND', line: '🟠 *BEHIND* — Revenue growth FY27 guide 13–14% growth: H1 +7.0%; H2 needs +17.9% to +19.7% YoY' },
      { key: 'EBITDA_MARGIN|FY27', kind: 'EBITDA_MARGIN', label: 'EBITDA margin', fy: 'FY27', ytdLabel: 'H1', restLabel: 'H2', guidedText: '10–11%', status: 'ON_TRACK', line: '✅ *ON TRACK* — EBITDA margin FY27 guide 10–11%: H1 10.4%' }
    ];
    const item = buildDigestItem({ kind: 'CONCALL', title: 'Transcript', filedAt: '2026-11-05T10:00:00Z', verdict: { guidance_pacing: pacing, verdict_summary: 'x' } });
    expect(item.pacing).toHaveLength(2);
    const msg = formatThesisDigestMessage({ ticker: 'SKIPPER', items: [item], board: [], overall: overallThesisStatus([]) });
    expect(msg).toContain('GUIDANCE PACING (FY27, H1 done)');
    expect(msg).toContain('H2 needs +17.9%');
    expect(msg.indexOf('BEHIND')).toBeLessThan(msg.indexOf('ON TRACK'));
  });
  it('no pacing, no block', async () => {
    const { buildDigestItem, formatThesisDigestMessage, overallThesisStatus } = await import('../services/thesis-digest.service.js');
    const item = buildDigestItem({ kind: 'DECK', title: 'Deck', filedAt: '2026-11-05T10:00:00Z', verdict: { verdict_summary: 'x' } });
    expect(item.pacing).toEqual([]);
    expect(formatThesisDigestMessage({ ticker: 'X', items: [item], board: [], overall: overallThesisStatus([]) })).not.toContain('GUIDANCE PACING');
  });
});

describe('filingLinkText: a link says what the filing IS, not the exchange generic subject', () => {
  const item = (kind, title, extra = {}) => ({ kind, title, filedAt: '2026-11-05T10:30:00Z', ...extra });
  it('replaces the generic exchange subjects ("General Updates", "Updates", the Con. Call Updates subject) with the kind and the date', () => {
    expect(filingLinkText(item('OTHER', 'General Updates'))).toBe('Exchange filing, 5 Nov');
    expect(filingLinkText(item('OTHER', 'Updates'))).toBe('Exchange filing, 5 Nov');
    expect(filingLinkText(item('CONCALL', 'Analysts/Institutional Investor Meet/Con. Call Updates'))).toBe('Call transcript, 5 Nov');
    expect(filingLinkText(item('AUDIO', 'Analysts/Institutional Investor Meet/Con. Call Updates'))).toBe('Call recording, 5 Nov');
    expect(filingLinkText(item('CONCALL', 'Analysts/Institutional Investor Meet/Con. Call Updates', { source: 'audio' }))).toBe('Call recording, 5 Nov');
    expect(filingLinkText(item('DECK', 'Updates'))).toBe('Investor presentation, 5 Nov');
    expect(filingLinkText(item('PRESS', 'Announcement under Regulation 30 (LODR)-Press Release / Media Release'))).toBe('Press release, 5 Nov');
  });
  it('keeps a title that already says something', () => {
    expect(filingLinkText(item('OTHER', 'Outcome of Board Meeting'))).toBe('Outcome of Board Meeting');
    expect(filingLinkText(item('DECK', 'Investor Presentation Q2 FY27'))).toBe('Investor Presentation Q2 FY27');
  });
  it('falls back safely: no title, no date', () => {
    expect(filingLinkText({ kind: 'OTHER', title: '' })).toBe('Exchange filing');
    expect(filingLinkText({ kind: 'CONCALL', title: 'Updates', filedAt: 'garbage' })).toBe('Call transcript');
  });
  it('is Markdown-safe (no stray * _ [ ])', () => {
    expect(filingLinkText(item('OTHER', 'Notice [of] *Meeting*'))).toBe('Notice of Meeting');
  });
  it('the digest message uses it in the link', () => {
    const msg = formatThesisDigestMessage({
      ticker: 'JSLL', companyName: 'Jeena Sikho', board: [], overall: null,
      items: [{ ...buildDigestItem({ kind: 'OTHER', title: 'General Updates', url: 'https://x.test/a.pdf', filedAt: '2026-11-05T10:30:00Z', verdict: { verdict_summary: 'Subsidiary formed for a pharmacy chain.' } }) }]
    });
    expect(msg).toContain('[Exchange filing, 5 Nov](https://x.test/a.pdf)');
    expect(msg).not.toContain('[General Updates]');
  });
});
