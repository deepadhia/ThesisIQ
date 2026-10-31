/**
 * Regression tests for the bad alerts of 2026-10-28 (HSCL concall, ANANTRAJ deck / results, GRAVITA results,
 * QPOWER concall invite). Every test is a real defect that reached Telegram.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';
import {
  applyInstitutionalGuard,
  sanitizeConcallHighlights,
  isPlaceholderText,
  amountsInCrore,
  amountMatchesVerified
} from '../../services/institutional-guard.service.js';
import { classifyFilingCategory, isNewspaperPublicationFiling } from '../../services/filing-classifier.service.js';
import { sanitizeResultDate, stripOcrMarkdown } from '../../services/announcement.service.js';
import { extractDeterministicFinancials } from '../../services/financial-validator.service.js';
import { formatConcallScheduleMessage, formatAnnouncementMessage } from '../../services/telegram.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '../..');

describe('prompt template leakage (AGENTS.md rule 6)', () => {
  test('placeholder detector recognises unfilled template tokens and ignores real figures', () => {
    for (const bad of [
      'Data Center Revenue: ₹X Cr (+Y% YoY)',
      'Capacity Utilization: Z%',
      'Aerospace orders: details & figures',
      'FY27 Full-Year Revenue Growth: X-Y%',
      'Initiative 1',
      '<Metric name>: <figure with unit>'
    ]) {
      expect(isPlaceholderText(bad), bad).toBe(true);
    }
    for (const good of [
      'Order backlog ₹1,234 Cr (+18% YoY)',
      'Capacity utilisation at 82% in Q2',
      'Plant 2 commissioned in October',
      'Copper EBITDA at ₹84,671/MT'
    ]) {
      expect(isPlaceholderText(good), good).toBe(false);
    }
  });

  test('prompts in the alert path carry no concrete company names, example figures or filler schema text', () => {
    const files = ['workers/quarterly-deepdive-worker.js', 'services/institutional-guard.service.js', 'services/audio-transcript-analyzer.service.js'];
    const banned = [
      /Aerospace orders/, /Semiconductor Dholera/, /Wayout/, /Savli|Kandla|Chakan/, /CERN\/ITER/,
      /Ashok Cloud/, /29% margin/, /Vision 2030 ₹10,000/, /Highly Confident, Execution-Driven/,
      /Revenue: ₹X Cr/, /Capacity Utilization Z%/, /details & figures/,
      // the synthesis re-prompt told EVERY stock to use another company's facts
      /₹1,140 Cr/, /\+8\.31% Rev/, /\+0\.16% PAT/, /LNG Business/,
      // the audio prompt's literal example targets
      /'₹10,000 Cr'/, /80-85% utilization/, /'Q2 FY27' for quarterly/
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.resolve(backendRoot, rel), 'utf8');
      // the guard's own placeholder tests may mention generic tokens, but never the leaked concrete strings
      for (const re of banned) expect(src, `${rel} still contains ${re}`).not.toMatch(re);
    }
  });

  test('guard drops placeholder and ungrounded KPIs / summary claims from a deck that has no such numbers', () => {
    const deck = `Anant Raj Limited Investor Presentation Q2 FY27
      Data centre capacity under development: 300 MW. Rental income grew to Rs. 120 crore.
      Residential projects: Navya and Estate One. Occupancy stood at 82% in operational towers.`;
    const out = applyInstitutionalGuard({
      _raw_text: deck,
      action_signal: 'HOLD', conviction_score: 6, credibility_tier: 'Tier 1',
      verdict_summary: 'Results show a 21% YoY increase in data center revenue and a 29% margin. Data centre capacity under development is 300 MW.',
      key_drivers: ['Hyperscale roll-out of 300 MW'],
      key_positives: ['Strong growth in data center revenue and margin', 'Occupancy stood at 82% in operational towers'],
      key_concerns_and_drags: ['Working capital stretch of 45 days'],
      thesis_operational_kpis: ['Data Center Revenue: ₹X Cr (+21% YoY)', 'EBITDA Margin: 29%', 'Capacity Utilization: Z%', 'Data centre capacity under development: 300 MW']
    }, null, 'Investor Presentation', 'ANANTRAJ');

    expect(out.thesis_operational_kpis).toEqual(['Data centre capacity under development: 300 MW']);
    expect(out.verdict_summary).not.toMatch(/21%|29%/);
    expect(out.verdict_summary).toContain('300 MW');
    expect(out.key_positives).toEqual(['Strong growth in data center revenue and margin', 'Occupancy stood at 82% in operational towers']);
    expect(out.key_concerns_and_drags).toEqual([]);              // "45 days" appears nowhere in the deck
  });

  test('guard keeps percentages that are verified by the parser even when worded differently in the filing', () => {
    const out = applyInstitutionalGuard({
      _raw_text: 'Revenue from operations 746.03 666.35 Profit for the period 38.51 90.71',
      action_signal: 'HOLD', conviction_score: 5,
      verdict_summary: 'Revenue grew 11.96% YoY while profit contracted 57.55% YoY.',
      key_drivers: []
    }, { isFinancialResult: true, revenue: 746.03, revenueYoYGrowthPct: 11.96, patAttributable: 38.51, patConsolidated: 38.51, patYoYGrowthPct: -57.55, isYoYDecline: true, isMarginErosion: false }, 'Financial Results', 'X');
    expect(out.verdict_summary).toContain('11.96%');
    expect(out.verdict_summary).toContain('57.55%');
  });

  test('concall highlights: leaked example items and figures that the call never states are removed, grounded ones stay', () => {
    const transcript = `Moderator: Welcome to the Q2 FY27 earnings call.
      Management: Revenue for the quarter was Rs. 1,427 crore, up 38% year on year. Copper EBITDA per tonne was Rs. 84,671.
      We expect capacity to reach 59,200 MTPA at Mundra by FY29. Our order inflow was healthy and exports remained firm.`;
    const raw = {
      financial_performance: ['Revenue: ₹3,000 Cr (+20% YoY)', 'EBITDA: ₹600 Cr (+30% YoY, Margin 20%)', 'Revenue: ₹1,427 Cr (+38% YoY)', 'Copper EBITDA: ₹84,671/MT'],
      business_performance: ['Aerospace orders: details & figures', 'Semiconductor Dholera: details'],
      growth_initiatives: ['Initiative 1', 'Initiative 2'],
      operational_highlights: ['Copper capacity to reach 59,200 MTPA at Mundra by FY29'],
      quarterly_guidance: ['Next Quarter (Q2): Revenue target ₹X Cr', 'Next Quarter Margin: Y%'],
      annual_guidance: ['FY27 Full-Year Revenue Growth: X-Y%'],
      multi_year_targets: ['Vision 2030 / 3-5 Year Target: ₹10,000 Cr, 20% CAGR'],
      key_positives: ['Strong order book', 'Growing exports'],
      key_challenges: ['Logistics and freight costs'],
      management_tone: 'Confident',
      key_takeaway: 'Poised for strong growth with 25% PAT growth.'
    };
    const out = sanitizeConcallHighlights(raw, transcript);

    expect(out.financial_performance).toEqual(['Revenue: ₹1,427 Cr (+38% YoY)', 'Copper EBITDA: ₹84,671/MT']);
    expect(out.business_performance).toEqual([]);
    expect(out.growth_initiatives).toEqual([]);
    expect(out.operational_highlights).toEqual(['Copper capacity to reach 59,200 MTPA at Mundra by FY29']);
    expect(out.quarterly_guidance).toEqual([]);
    expect(out.annual_guidance).toEqual([]);
    expect(out.multi_year_targets).toEqual([]);
    expect(out.key_positives).toEqual(['Strong order book', 'Growing exports']);
    expect(out.key_takeaway).toBeFalsy();                         // "25% PAT growth" is not in the call
    expect(out.management_tone).toBe('Confident');
  });
});

describe('filing routing', () => {
  const coverLetter = `ANANT RAJ LIMITED
    Subject: Outcome of the Board Meeting held on Wednesday, October 28, 2026
    the Board of Directors has, inter-alia, considered and approved the Unaudited Financial Results (Standalone and Consolidated)
    of the Company along with the Limited Review Reports for the quarter and half year ended September 30, 2026.
    The Board also noted the status of the composite scheme of arrangement pending before the NCLT.
    Revenue from operations 402.83 372.0`;

  test('a financial-results cover letter that merely mentions a scheme is QUARTERLY_EARNINGS, not RESTRUCTURING', () => {
    expect(classifyFilingCategory('Updates', coverLetter, 'https://nsearchives.nseindia.com/corporate/X_Outcome_28102026.pdf')).toBe('QUARTERLY_EARNINGS');
  });

  test('a genuine restructuring filing is still RESTRUCTURING', () => {
    expect(classifyFilingCategory('Scheme of Arrangement - Demerger approved by Board', 'The board approved the composite scheme of arrangement.', '')).toBe('RESTRUCTURING');
    // title names the scheme even though the body also contains results wording
    expect(classifyFilingCategory('Scheme of Arrangement', coverLetter, '')).toBe('RESTRUCTURING');
    expect(classifyFilingCategory('Updates', 'The Board approved the composite scheme of arrangement for demerger of the business.', '')).toBe('RESTRUCTURING');
  });

  test('a rating letter that quotes results is not turned into earnings, and results with a rating mention still are', () => {
    expect(classifyFilingCategory('Credit Rating', 'CRISIL has upgraded the credit rating of bank facilities.', '')).toBe('CREDIT_EVENT');
    expect(classifyFilingCategory('Outcome of Board Meeting', coverLetter.replace('composite scheme of arrangement', 'CRISIL rating'), '')).toBe('QUARTERLY_EARNINGS');
  });

  test('newspaper clippings are recognised so they never raise a thin standalone alert', () => {
    expect(isNewspaperPublicationFiling('Copy of Newspaper Publication', 'https://nsearchives.nseindia.com/corporate/GRAVITA_FinalNewspaper28102026.pdf')).toBe(true);
    expect(isNewspaperPublicationFiling('Updates', 'https://nsearchives.nseindia.com/corporate/X_NewspaperAdvt.pdf')).toBe(true);
    expect(isNewspaperPublicationFiling('Outcome of Board Meeting', 'https://nsearchives.nseindia.com/corporate/X_Outcome.pdf')).toBe(false);
  });
});

describe('scanned results PDF read by vision OCR (GRAVITA Q2 FY27)', () => {
  // Raw Gemini transcription of the consolidated statement of a scanned PDF whose embedded text layer was garbage.
  const raw = fs.readFileSync(path.resolve(here, '../fixtures/gravita-q2fy27-consolidated-ocr.txt'), 'utf8');

  test('markdown tables from the OCR model become plain statement rows the parser can read', () => {
    const clean = stripOcrMarkdown(raw);
    expect(clean).not.toMatch(/\*\*|\|/);
    expect(clean).toMatch(/^\s*Revenue from operations 1,427\.35 1,475\.06 1,035\.50 /m);
  });

  test('the cleaned transcription parses into VERIFIED consolidated numbers (hand-checked against the printed statement)', () => {
    const fin = extractDeterministicFinancials(stripOcrMarkdown(raw));
    expect(fin).not.toBeNull();
    expect(fin.statementScope).toBe('CONSOLIDATED');
    expect(fin.quarterEnded).toBe('2026-09-30');
    expect(fin.revenue).toBe(1427.35);
    expect(fin.revenueYoYGrowthPct).toBeCloseTo(37.84, 1);     // (1427.35-1035.50)/1035.50
    expect(fin.ebitda).toBeCloseTo(151.98, 2);                  // PBT 124.21 + finance 13.88 + depreciation 13.89
    expect(fin.ebitdaMarginPct).toBeCloseTo(10.65, 1);
    expect(fin.patAttributable).toBe(102.01);                   // owners of the holding company
    expect(fin.patYoYGrowthPct).toBeCloseTo(6.27, 1);           // 102.01 vs 95.99
  });

  test('the markdown form is NOT parseable as-is (why the cleaning step exists)', () => {
    expect(extractDeterministicFinancials(raw)).toBeNull();
  });
});

describe('consolidated statement with PDF text-layer glitches (ANANTRAJ Q2 FY27)', () => {
  // "2,511 .60", "S53.66", "Ot her income" and a "Profit before tax" label wrapped onto the next line.
  const text = fs.readFileSync(path.resolve(here, '../fixtures/anantraj-q2fy27-consolidated.txt'), 'utf8');

  test('the consolidated block is parsed (not silently replaced by a standalone one) with hand-checked numbers', () => {
    const fin = extractDeterministicFinancials(text);
    expect(fin).not.toBeNull();
    expect(fin.statementScope).toBe('CONSOLIDATED');
    expect(fin.quarterEnded).toBe('2026-09-30');
    expect(fin.revenue).toBe(661.53);
    expect(fin.revenueYoYGrowthPct).toBeCloseTo(4.87, 1);       // (661.53-630.79)/630.79
    expect(fin.ebitda).toBeCloseTo(215.37, 2);                  // PBT 187.78 + finance 1.09 + depreciation 26.50
    expect(fin.ebitdaMarginPct).toBeCloseTo(32.55, 1);          // 215.37 / 661.53
    expect(fin.patAttributable).toBe(156.88);                   // owners of the company
    expect(fin.patYoYGrowthPct).toBeCloseTo(13.58, 1);          // 156.88 vs 138.12
  });

  // Live dry run 2026-10-31: the model wrote "EBITDA margin expanded ~390 bps YoY to ~31.7%" under a verified 32.56% / +435 bps.
  // 31.7 passed the old flat +/-1.0 percentage tolerance and bps claims were never checked in the bullet lists.
  test('bullets that contradict the verified EBITDA margin or bps move are dropped; consistent and forward-looking ones stay', () => {
    const fin = extractDeterministicFinancials(text);
    expect(fin.ebitdaMarginBpsDelta).toBe(435);
    const out = applyInstitutionalGuard({
      _raw_text: text,
      action_signal: 'ADD', conviction_score: 8, credibility_tier: 'Tier 2',
      verdict_summary: 'Structural catalysts remain intact.',
      key_drivers: [],
      key_positives: [
        'EBITDA margin expanded ~390 bps YoY to ~31.7%',                 // contradicts 435 bps / 32.56%
        'EBITDA margin expanded 435 bps YoY to 32.56%',                  // matches the parser
        'Management targets an EBITDA margin of 33.5% next year',       // guidance, not a measured result
        'Consolidated revenue of Rs 661.53 Cr'                           // unrelated, grounded
      ],
      key_concerns_and_drags: ['EBITDA margin fell 120 bps QoQ to 30.1%'],  // contradicts verified bps and margin
      thesis_operational_kpis: []
    }, fin, 'Outcome of Board Meeting', 'ANANTRAJ');

    expect(out.key_positives).not.toContain('EBITDA margin expanded ~390 bps YoY to ~31.7%');
    expect(out.key_positives).toContain('EBITDA margin expanded 435 bps YoY to 32.56%');
    expect(out.key_positives).toContain('Management targets an EBITDA margin of 33.5% next year');
    expect(out.key_positives).toContain('Consolidated revenue of Rs 661.53 Cr');
    expect(out.key_concerns_and_drags).toEqual([]);
  });

  // Live dry run 2026-10-31 (QPOWER): a bare KPI line "Revenue: 740.48 million" (standalone) sat under the consolidated headline of
  // ₹293.6 Cr, and a correctly rounded "₹294 Cr" must not be treated as a mismatch just because it is 0.14% off.
  test('a bare "Revenue: amount" line must carry the verified revenue; a correctly rounded amount matches; half-year and order-book lines are not judged', () => {
    expect(amountMatchesVerified(294, [293.6])).toBe(true);          // rounded to the claim's own precision
    expect(amountMatchesVerified(293.6, [293.6])).toBe(true);
    expect(amountMatchesVerified(662, [661.53])).toBe(true);
    expect(amountMatchesVerified(293, [293.6])).toBe(false);          // 293 is not 293.6 rounded
    expect(amountMatchesVerified(74.048, [293.6])).toBe(false);       // a different scope
    expect(amountMatchesVerified(156.49, [156.88])).toBe(false);      // profit for the period vs owners' PAT: still a mismatch

    const fin = extractDeterministicFinancials(text);
    const out = applyInstitutionalGuard({
      _raw_text: text,
      action_signal: 'ADD', conviction_score: 8, credibility_tier: 'Tier 2',
      verdict_summary: 'Structural catalysts remain intact.',
      key_drivers: [],
      key_positives: [],
      key_concerns_and_drags: [],
      thesis_operational_kpis: [
        'Revenue: ₹491.17 crore',                  // a bare revenue line that is not the verified revenue (a different scope's figure) -> drop
        'Revenue: ₹661.53 crore',                  // the verified revenue -> keep
        'Revenue visibility from an order book of ₹491.17 crore'   // forward-looking order book -> not judged
      ]
    }, fin, 'Outcome of Board Meeting', 'ANANTRAJ');
    expect(out.thesis_operational_kpis).not.toContain('Revenue: ₹491.17 crore');
    expect(out.thesis_operational_kpis).toContain('Revenue: ₹661.53 crore');
    expect(out.thesis_operational_kpis).toContain('Revenue visibility from an order book of ₹491.17 crore');
  });

  // Live dry runs 2026-10-31 (QPOWER and SKIPPER, both Q2 FY27): the model wrote "... compared to Rs 12,617.87 million in Q2 FY25".
  // The amount is the right prior-year figure; the LABEL is two years back (the base of a YoY comparison in Q2 FY27 is Q2 FY26).
  test('a comparison against the same quarter TWO fiscal years back (a wrong base-period label) is dropped; the correct base year stays', () => {
    const fin = extractDeterministicFinancials(text);
    expect(fin.quarterEnded).toBe('2026-09-30');
    const out = applyInstitutionalGuard({
      _raw_text: text,
      action_signal: 'ADD', conviction_score: 8, credibility_tier: 'Tier 2',
      verdict_summary: 'Structural catalysts remain intact.',
      key_drivers: [],
      key_positives: [
        'Revenue from operations of Rs 661.53 Cr compared to Rs 630.80 Cr in Q2 FY25',   // wrong base label -> drop
        'Revenue from operations of Rs 661.53 Cr compared to Rs 630.80 Cr in Q2 FY26',   // correct base -> keep
        'Highest quarterly revenue since Q2 FY25'                                          // not a YoY comparison -> keep
      ],
      key_concerns_and_drags: [], thesis_operational_kpis: []
    }, fin, 'Outcome of Board Meeting', 'ANANTRAJ');
    expect(out.key_positives).not.toContain('Revenue from operations of Rs 661.53 Cr compared to Rs 630.80 Cr in Q2 FY25');
    expect(out.key_positives).toContain('Revenue from operations of Rs 661.53 Cr compared to Rs 630.80 Cr in Q2 FY26');
    expect(out.key_positives).toContain('Highest quarterly revenue since Q2 FY25');
  });

  // Live dry run 2026-10-31 (QPOWER, statement printed in Rs. millions): the model wrote "Standalone Revenue: ₹740.48 crore"
  // (it is 740.48 MILLION = ₹74.05 Cr) and "Cost of materials consumed ₹333.01 crore" (333.01 million, standalone), both larger
  // than the consolidated revenue of ₹293.6 Cr. The number exists in the filing, so the grounding guard let both through.
  test('rupee amounts are compared in one unit (crore), so million-vs-crore slips are recognised', () => {
    expect(amountsInCrore('₹740.48 million')).toEqual([74.048]);
    expect(amountsInCrore('INR 913.86 millions')).toEqual([91.386]);
    expect(amountsInCrore('Rs 1,250 lakh')).toEqual([12.5]);
    expect(amountsInCrore('₹2,000 crore')).toEqual([2000]);
    expect(amountsInCrore('Rs. 294 Cr')).toEqual([294]);
    expect(amountsInCrore('₹5 billion')).toEqual([500]);
    expect(amountsInCrore('no amounts here, only 42% growth')).toEqual([]);
  });

  test('a profit-and-loss line larger than the verified revenue is a unit or scope error and is dropped; balance-sheet and order-book figures are not judged', () => {
    const fin = extractDeterministicFinancials(text);
    expect(fin.revenue).toBeCloseTo(661.53, 1);
    const out = applyInstitutionalGuard({
      _raw_text: text,
      action_signal: 'ADD', conviction_score: 8, credibility_tier: 'Tier 2',
      verdict_summary: 'Structural catalysts remain intact.',
      key_drivers: [],
      key_positives: [
        'Standalone Revenue: ₹956.59 crore',                      // 956.59 IS printed in the filing (a half-year figure) but exceeds the quarter's revenue -> drop
        'Total expenses of ₹491.17 crore for the quarter',        // a normal expense line below revenue -> keep
        'Order book of ₹1,917.14 crore'                           // an order book can exceed revenue -> not judged
      ],
      key_concerns_and_drags: ['Cost of materials consumed increased to ₹1,917.14 crore'],  // a cost line above revenue -> drop
      thesis_operational_kpis: []
    }, fin, 'Outcome of Board Meeting', 'ANANTRAJ');
    expect(out.key_positives).not.toContain('Standalone Revenue: ₹956.59 crore');
    expect(out.key_positives).toContain('Order book of ₹1,917.14 crore');
    expect(out.key_positives).toContain('Total expenses of ₹491.17 crore for the quarter');
    expect(out.key_concerns_and_drags).toEqual([]);
  });

  // Live dry run 2026-10-31 (GRAVITA): the "open queries for the concall" asked about a "369 bps margin compression" under a
  // verified -174 bps. The contradiction filter never covered that list.
  test('open queries for the concall that quote a bps move or margin contradicting the verified figures are dropped', () => {
    const fin = extractDeterministicFinancials(text);
    const out = applyInstitutionalGuard({
      _raw_text: text,
      action_signal: 'ADD', conviction_score: 8, credibility_tier: 'Tier 2',
      verdict_summary: 'Structural catalysts remain intact.',
      key_drivers: [], key_positives: [], key_concerns_and_drags: [], thesis_operational_kpis: [],
      concall_verification_points: [
        'Explain the drivers behind the 390 bps YoY EBITDA margin expansion',          // contradicts +435 bps: drop
        'Is the 435 bps EBITDA margin expansion sustainable?',                           // matches: keep
        'Clarify the order inflow pipeline for the next two quarters'                    // no figure: keep
      ]
    }, fin, 'Outcome of Board Meeting', 'ANANTRAJ');
    expect(out.concall_verification_points).not.toContain('Explain the drivers behind the 390 bps YoY EBITDA margin expansion');
    expect(out.concall_verification_points).toContain('Is the 435 bps EBITDA margin expansion sustainable?');
    expect(out.concall_verification_points).toContain('Clarify the order inflow pipeline for the next two quarters');
  });

  // Live dry run 2026-10-31 (GRAVITA): "Revenue from operations remains resilient at Rs 786.91 Cr" was printed under the
  // verified consolidated revenue of Rs 1,427.35 Cr (a standalone figure from the same filing). A headline-metric bullet
  // that states an amount matching none of the verified figures (current or comparative) is dropped.
  test('bullets quoting a revenue or PAT amount that is not the verified consolidated figure are dropped (mixed-scope figures)', () => {
    const fin = extractDeterministicFinancials(text);
    expect(fin.revenue).toBeCloseTo(661.53, 1);
    const priorYearRevenue = (fin.revenue / (1 + fin.revenueYoYGrowthPct / 100)).toFixed(2);
    const out = applyInstitutionalGuard({
      _raw_text: text,
      action_signal: 'ADD', conviction_score: 8, credibility_tier: 'Tier 2',
      verdict_summary: 'Structural catalysts remain intact.',
      key_drivers: [],
      key_positives: [
        'Revenue from operations remains resilient at Rs 400.00 Cr for the quarter',   // another scope's figure: drop
        'Revenue from operations of Rs 661.53 Cr',                                       // verified: keep
        `Revenue from operations was Rs ${priorYearRevenue} Cr a year ago`,              // verified comparative: keep
        'Revenue from operations grew steadily',                                          // no amount: keep
        'Revenue from operations in the real estate segment was Rs 491.17 Cr',            // a segment, not the headline: keep
        'PAT up 13% to ₹156.49 Cr',                                                        // profit incl. minority, not the owners' PAT: drop
        'PAT attributable to owners of Rs 156.88 Cr'                                       // verified owners' PAT: keep
      ],
      key_concerns_and_drags: [],
      thesis_operational_kpis: []
    }, fin, 'Outcome of Board Meeting', 'ANANTRAJ');

    expect(out.key_positives).not.toContain('Revenue from operations remains resilient at Rs 400.00 Cr for the quarter');
    expect(out.key_positives).not.toContain('PAT up 13% to ₹156.49 Cr');
    expect(out.key_positives).toContain('Revenue from operations of Rs 661.53 Cr');
    expect(out.key_positives).toContain(`Revenue from operations was Rs ${priorYearRevenue} Cr a year ago`);
    expect(out.key_positives).toContain('Revenue from operations grew steadily');
    expect(out.key_positives).toContain('Revenue from operations in the real estate segment was Rs 491.17 Cr');
    expect(out.key_positives).toContain('PAT attributable to owners of Rs 156.88 Cr');
  });
});

describe('concall invitation formatting', () => {
  test('a quarter-end date is never shown as the "Results date"', () => {
    expect(sanitizeResultDate('2026-09-30', '2026-10-28T14:20:08.000Z')).toBeNull();
    expect(sanitizeResultDate('2026-03-31', '2026-04-20T10:00:00.000Z')).toBeNull();
    expect(sanitizeResultDate('2026-08-01', '2026-10-28T14:20:08.000Z')).toBeNull();   // months before the filing
    expect(sanitizeResultDate('2026-10-27', '2026-10-28T14:20:08.000Z')).toBe('2026-10-27');
    expect(sanitizeResultDate('2026-11-05', '2026-10-28T14:20:08.000Z')).toBe('2026-11-05');
    expect(sanitizeResultDate(null, '2026-10-28T14:20:08.000Z')).toBeNull();
    expect(sanitizeResultDate('garbage', '2026-10-28T14:20:08.000Z')).toBeNull();
  });

  test('the summary line ends on a word boundary, never mid-word', () => {
    const summary = 'Quality Power Electrical Equipments Ltd has scheduled an Earnings Conference Call with Analysts/Investors for Q2 FY27 on November 2, 2026, to discuss Un-audited (Standalone and Consolidated) Financial Results for the quarter and half year ended September 30, 2026.';
    const msg = formatConcallScheduleMessage({ ticker: 'QPOWER', companyName: 'Quality Power', schedule: { date: '2026-11-02', time: '12:30' }, summary });
    const line = msg.split('\n').find(l => l.startsWith('• '));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/\bqua$/);
    expect(line.endsWith('…') || line.endsWith('.')).toBe(true);
    expect(msg).toContain('Mon, 02 Nov 2026');
  });

  test('management Q&A answers are not chopped mid-sentence with a bare "..."', () => {
    const long = 'Management stated that West Asia disruptions increased transit times and the lead working capital cycle is about 80-90 days. New procurement geography tie-ups booked last quarter are reaching plants in Q3. In addition, domestic RCM implementation under GST will unlock substantial domestic battery scrap supply for formal recyclers, narrowing the informal-formal price gap over the coming quarters as enforcement tightens.';
    const text = formatAnnouncementMessage({
      ticker: 'GRAVITA', companyName: 'Gravita India', title: 'Concall', priority: 'HIGH', impact: 'POSITIVE', summary: 'Summary line.',
      concall_type: 'audio',
      audio_analysis: { qa_highlights: [{ analyst_or_shareholder: 'Analyst', question: 'Why did lead volumes decline?', management_answer: long }] }
    });
    const ans = text.split('\n').find(l => l.includes('*A:*'));
    expect(ans).toBeDefined();
    expect(ans).not.toMatch(/\.\.\.$/);
    expect(ans).toContain('RCM implementation');
    expect(ans).toMatch(/[.…]$/);
  });
});
