/**
 * Real-world PDF layouts (corpus audit, 2026-10-31): of 41 results documents from the 20 tracked stocks only 12 parsed. The
 * rest broke on GENERAL text-layer problems, not on any company's format. Fixtures are the full real documents.
 *   - stray table characters glued to numbers:        "786.91|  860,13}  1,647.04)"
 *   - numbers split by the text layer:                "39 ,824  49 ,6 18"   "74 65 0.1 9"   "180569.1 5"   "1,36,361 .57"
 *   - a dot where a comma belongs / comma for a dot:  "1.41 ,693.28"   "1,02,637,29"   "2,18.236.50"
 *   - punctuation lost entirely:                      "12107624" (= 1,21,076.24)   "348137" (= 3,481.37)
 *   - a corrupted block that used to reject the WHOLE document although a good (standalone) block existed
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { extractDeterministicFinancials, __testing } from '../services/financial-validator.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const doc = (name) => fs.readFileSync(path.resolve(here, `fixtures/real-layouts/${name}.txt`), 'utf8');
const { parseRow } = __testing;

describe('row tokenizer: repairs the text-layer damage seen in real filings', () => {
  it('strips table characters glued to numbers and restores a dropped decimal when every sibling has one', () => {
    const r = parseRow('Revenue from operations. 786.91| 860,13} 852.20| 1,647.04) 1,702.98 348137', 6);
    expect(r.values).toEqual([786.91, 860.13, 852.20, 1647.04, 1702.98, 3481.37]);
  });

  it('stitches numbers the text layer split apart, using the column count the clean rows agree on', () => {
    expect(parseRow('Revenue from operations 53,466 39 ,824 49 ,6 18 93,290 90,626', 5).values).toEqual([53466, 39824, 49618, 93290, 90626]);
    expect(parseRow('Revenue from operations (Net) 74 65 0.1 9 57012.81 41157.58 131663 .00 83681.46 180569.1 5', 6).values)
      .toEqual([74650.19, 57012.81, 41157.58, 131663.00, 83681.46, 180569.15]);
  });

  it('fixes a space before the decimals, a dot where an Indian-grouping comma belongs and a comma where the decimal point belongs', () => {
    expect(parseRow('a) Revenue from operations 1,36,361 .57 1.41 ,693.28 1,02,637,29 4,87,033.03', 4).values)
      .toEqual([136361.57, 141693.28, 102637.29, 487033.03]);
  });

  it('restores punctuation that was lost entirely, from the sibling cells', () => {
    expect(parseRow('Total Revenue from operations 12107624 | 1,20,04462 1,12,672.61 2,41,120.85 2,18,236.50 4,45737.34', 6).values)
      .toEqual([121076.24, 120044.62, 112672.61, 241120.85, 218236.50, 445737.34]);
    expect(parseRow('a) Revenue from Operations 12107624 | 12004262 11267261 24112086 2,18.236.50 445737.34', 6).values)
      .toEqual([121076.24, 120042.62, 112672.61, 241120.86, 218236.50, 445737.34]);
  });

  it('joins pieces separated by a lone separator or a thousands group, without merging two cells split by a stray comma', () => {
    expect(parseRow('a) Owners of the Company 8,663. 99 8,811 . 51 4, 141 .92 27,885.68', 4).values).toEqual([8663.99, 8811.51, 4141.92, 27885.68]);
    expect(parseRow('Profit before tax 59.64, 84.47] 102.27) 144.11) 188.17 362.58', 6).values).toEqual([59.64, 84.47, 102.27, 144.11, 188.17, 362.58]);
  });

  it('a row label that carries a formula over line numbers is not part of the numbers: "(1 - 2)", "(3+4)", "(5-6)"', () => {
    expect(parseRow('3 Profit before tax (1 - 2) 1,316.20 13,984.70 1,725.29 24,504.61', 4).values).toEqual([1316.20, 13984.70, 1725.29, 24504.61]);
    expect(parseRow('5. Profit before Tax (3+4) 11653.95 7452.74 4569.49 19106.69 6121.13 11992.00', 6).values).toHaveLength(6);
    expect(parseRow('Profit for the period/year (3 - 4) 982.25 10,526.35 1,299.62 17,783.73').values).toEqual([982.25, 10526.35, 1299.62, 17783.73]);
    expect(parseRow('Change in stock (12) 5.00 6.00 7.00').values).toEqual([-12, 5, 6, 7]);
  });

  it('leaves clean rows untouched, and never rewrites genuine integers', () => {
    expect(parseRow('Revenue from operations 746.03 858.67 666.35 1,604.70 1,200.00 2,500.00', 6).values).toEqual([746.03, 858.67, 666.35, 1604.70, 1200.00, 2500.00]);
    expect(parseRow('Number of employees 1200 1180 1100', 3).values).toEqual([1200, 1180, 1100]);
    // a whole-number cell that is plausible as printed (500 among ~100-300 siblings) is not "restored"
    expect(parseRow('Total expenses 500 120.50 130.25 740.75 250.10 900.20', 6).values).toEqual([500, 120.50, 130.25, 740.75, 250.10, 900.20]);
  });
});

describe('whole real documents', () => {
  it('GRAVITA (pipes and braces on every cell): revenue and YoY are read', () => {
    const f = extractDeterministicFinancials(doc('GRAVITA_2026-10-27'));
    expect(f).not.toBeNull();
    expect(f.revenue).toBeCloseTo(786.91, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(-7.66, 1);
  });

  it('ELECON (numbers split by spaces, "Profit I (Loss)" for "Profit / (Loss)", statement in lakhs): the consolidated statement is read', () => {
    const f = extractDeterministicFinancials(doc('ELECON_2026-10-14'));
    expect(f).not.toBeNull();
    expect(f.unit).toBe('LAKHS');
    expect(f.statementScope).toBe('CONSOLIDATED');
    // consolidated row: 63,894 | 52,056 | 57,813 (lakhs)
    expect(f.revenue).toBeCloseTo(638.94, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(10.52, 1);
    expect(f.revenueQoQGrowthPct).toBeCloseTo(22.74, 1);
    // 12,476 PBT + 1,033 finance + 3,260 depreciation = 16,769 lakh, less other income 1,979 lakh = 14,790 lakh
    expect(f.ebitda).toBeCloseTo(147.90, 2);
    expect(f.ebitdaMarginPct).toBeCloseTo(23.15, 2);
    expect(f.patConsolidated).toBeCloseTo(96.35, 2);
    expect(f.patYoYGrowthPct).toBeCloseTo(9.84, 1);
  });

  it('HSCL (OCR character noise "Opetations", "Coniol id:o ted", "Profill", statement in crores): consolidated statement is read', () => {
    const f = extractDeterministicFinancials(doc('HSCL_2026-10-16'));
    expect(f).not.toBeNull();
    expect(f.unit).toBe('CRORES');
    expect(f.statementScope).toBe('CONSOLIDATED');
    expect(f.revenue).toBeCloseTo(1691.43, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(57.93, 1);
    expect(f.revenueQoQGrowthPct).toBeCloseTo(18.13, 1);
    // 307.34 + 27.72 + 21.69 = 356.75, less other income 11.79 (the filing's own EBITDA definition subtracts it)
    expect(f.ebitda).toBeCloseTo(344.96, 2);
    expect(f.ebitdaMarginPct).toBeCloseTo(20.39, 2);
    expect(f.patConsolidated).toBeCloseTo(232.32, 2);
    expect(f.patYoYGrowthPct).toBeCloseTo(31.51, 1);
  });

  it('ELECON standalone block alone (numbers split by spaces): 53,466 | 39,824 | 49,618 lakhs', () => {
    const text = doc('ELECON_2026-10-14').split('\n').slice(0, 130).join('\n');
    const f = extractDeterministicFinancials(text);
    expect(f).not.toBeNull();
    expect(f.statementScope).toBe('STANDALONE');
    expect(f.revenue).toBeCloseTo(534.66, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(7.76, 1);
    expect(f.revenueQoQGrowthPct).toBeCloseTo(34.26, 1);
  });

  it('LUMAX (space before decimals, dot for comma, comma for dot): consolidated revenue and growth are read', () => {
    const f = extractDeterministicFinancials(doc('LUMAXTECH_2026-08-10'));
    expect(f).not.toBeNull();
    expect(f.statementScope).toBe('CONSOLIDATED');
    expect(f.revenue).toBeCloseTo(1363.62, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(32.86, 1);
    expect(f.revenueQoQGrowthPct).toBeCloseTo(-3.76, 1);
  });

  it('MOREPENLAB (heavily fragmented numbers): revenue and growth are read', () => {
    const f = extractDeterministicFinancials(doc('MOREPENLAB_2026-10-27'));
    expect(f).not.toBeNull();
    expect(f.revenue).toBeCloseTo(746.50, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(81.38, 1);
    expect(f.revenueQoQGrowthPct).toBeCloseTo(30.94, 1);
  });

  it('LUMAX: the owners\' profit is the owners\' row (86.64 Cr), not the pieces of it that happened to fit the column count', () => {
    const f = extractDeterministicFinancials(doc('LUMAXTECH_2026-08-10'));
    expect(f.patAttributable).toBeCloseTo(86.64, 1);
    expect(f.patTotalIncludingMinority).toBeCloseTo(98.64, 1);
  });

  it('a profit row wildly out of scale with its revenue, or an owners row far from the profit row it splits, is not trusted', () => {
    const head = 'Consolidated Financial Results (Rs. in Lakhs)\nParticulars 30.09.2026 30.06.2026 30.09.2025\nRevenue from operations 100000.00 90000.00 80000.00\nTotal income 101000.00 91000.00 81000.00\nFinance costs 1000.00 1000.00 1000.00\nDepreciation and amortisation 2000.00 2000.00 2000.00\nProfit before tax 20000.00 18000.00 15000.00\n';
    const f = extractDeterministicFinancials(`${head}Profit for the period 15000.00 13000.00 11000.00\nProfit attributable to:\na) Owners of the Company 51.00 4.00 141.92\n`);
    expect(f.patAttributable).toBeCloseTo(150, 1);   // the profit row, not the mis-read owners row
    const g = extractDeterministicFinancials(`${head}Profit for the period 9999999.00 13000.00 11000.00\n`);
    expect(g.patConsolidated === null || g.patConsolidated < 1000).toBe(true);
  });

  it('ASTRAMICRO (profit rows labelled "(1 - 2)" and "(3 - 4)"): profit is 982.25 lakh = 9.82 Cr, not the line numbers', () => {
    const f = extractDeterministicFinancials(doc('ASTRAMICRO_2026-08-10'));
    expect(f).not.toBeNull();
    expect(f.revenue).toBeCloseTo(176.21, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(-10.67, 1);
    expect(f.patConsolidated).toBeCloseTo(9.82, 2);
  });

  it('SJS (full statement printed WITHOUT decimal points, next to a clean summary table of the same figures): the clean figures are used, never a 100x revenue', () => {
    const f = extractDeterministicFinancials(doc('SJS_2026-08-06'));
    expect(f).not.toBeNull();
    expect(f.unit).toBe('MILLIONS');
    expect(f.revenue).toBeCloseTo(145.53, 2);              // Rs. 1,455.32 million
    expect(f.revenueYoYGrowthPct).toBeCloseTo(17.63, 1);
    expect(f.patConsolidated).toBeCloseTo(59.74, 2);       // Rs. 597.39 million
  });

  it('two statements of one filing that differ by exactly the lost decimal point: the one with the larger figure is the damaged one', () => {
    const clean = 'Standalone summary (Rs. in million)\nParticulars 30.06.2026 31.03.2026 30.06.2025\n1 Total Revenue from Operations 1,455.32 1,470.85 1,237.22\n2 Profit before tax 757.08 497.83 365.25\n3 Net Profit after tax 597.39 382.65 273.13\n';
    const damaged = 'STATEMENT OF STANDALONE FINANCIAL RESULTS (Rs. in million)\nParticulars 30.06.2026 31.03.2026 30.06.2025\na) Revenue from operations 145532 147085 123722\nFinance costs 355 372 326\nDepreciation and amortization expense 49.01 67.19 49.35\nProfit before tax 757.08 149783 365.25\nNet profit for the period 739 38268 530\n';
    const f = extractDeterministicFinancials(clean + damaged);
    expect(f.revenue).toBeCloseTo(145.53, 2);
  });

  it('CCL (corrupted consolidated block): a document is never rejected whole while a good block exists; the good figures are returned', () => {
    const f = extractDeterministicFinancials(doc('CCL_2026-10-15'));
    expect(f).not.toBeNull();
    // either the repaired consolidated statement or, failing that, the clean standalone one: never nothing, never a wrong magnitude
    if (f.statementScope === 'CONSOLIDATED') {
      expect(f.revenue).toBeCloseTo(1210.76, 1);
      expect(f.revenueYoYGrowthPct).toBeCloseTo(7.46, 1);
    } else {
      expect(f.statementScope).toBe('STANDALONE');
      expect(f.revenue).toBeCloseTo(685.05, 2);
      expect(f.revenueYoYGrowthPct).toBeCloseTo(22.51, 1);
    }
  });

  it('a corrupted primary block falls back to the next block instead of rejecting the document', () => {
    // two blocks: a good standalone one and a consolidated one with an impossible revenue magnitude
    const good = 'Standalone Financial Results (Rs. in Crores)\nParticulars 30.09.2026 30.06.2026 30.09.2025\nRevenue from operations 100.00 90.00 80.00\nTotal income 101.00 91.00 81.00\nFinance costs 1.00 1.00 1.00\nDepreciation and amortisation 2.00 2.00 2.00\nProfit before tax 20.00 18.00 15.00\nProfit for the period 15.00 13.00 11.00\n';
    const bad = '\nConsolidated Financial Results (Rs. in Crores)\nParticulars 30.09.2026 30.06.2026 30.09.2025\nRevenue from operations 99999999 90.00 80.00\nTotal income 101.00 91.00 81.00\nFinance costs 1.00 1.00 1.00\nDepreciation and amortisation 2.00 2.00 2.00\nProfit before tax 20.00 18.00 15.00\nProfit for the period 15.00 13.00 11.00\n';
    const f = extractDeterministicFinancials(good + bad);
    expect(f).not.toBeNull();
    expect(f.revenue).toBeLessThan(50000);
  });
});

describe('TRANSRAILL Q2 FY27 (OCR letters inside numbers, header split over two lines, OCI "owners" row): the statement is read for the right period', () => {
  // Consolidated statement, Rs. crore, columns: Sep-26 | Jun-26 | Sep-25 | H1 Sep-26 | H1 Sep-25. Verified by eye against the PDF:
  //   revenue 2,030.22 | 1,702.45 | 1,534.25      profit for the period 103.94 | 107.88 | 92.42 ("197.GO" is OCR for 197.60)
  //   PBT before exceptional 158.09 | 144.01 | 125.02    finance 73.38 | 55.72 | 60.33    depreciation 19.93 | 19.49 | 14.80
  // The previous parser returned PAT = 14.74 (the OTHER COMPREHENSIVE INCOME "owners" row), period 2025-09-30, EBITDA null.
  const f = extractDeterministicFinancials(doc('TRANSRAILL_2026-11-03'));

  it('reads the profit for the period (103.94), never the other-comprehensive-income row (14.74)', () => {
    expect(f.statementScope).toBe('CONSOLIDATED');
    expect(f.patConsolidated).toBeCloseTo(103.94, 2);
    expect(f.patAttributable).toBeCloseTo(103.94, 2);
    expect(f.patYoYGrowthPct).toBeCloseTo(12.47, 1);   // (103.94 - 92.42) / 92.42
    expect(f.patQoQGrowthPct).toBeCloseTo(-3.65, 1);   // (103.94 - 107.88) / 107.88
  });

  it('labels the period from the statement heading when the column header is unusable: 2026-09-30, not 2025-09-30', () => {
    expect(f.quarterEnded).toBe('2026-09-30');
  });

  it('computes EBITDA when the depreciation label is damaged ("Depreci~tion & amortisation")', () => {
    expect(f.revenue).toBeCloseTo(2030.22, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(32.33, 1);
    // 158.09 + 73.38 + 19.93 - other income 13.47 = 237.93: the company's own "EBITDA Rs. 238 Cr" (press release)
    expect(f.ebitda).toBeCloseTo(237.93, 2);
    expect(f.ebitdaMarginPct).toBeCloseTo(11.72, 1);
    expect(f.ebitdaYoYGrowthPct).toBeCloseTo(27.81, 1); // vs 125.02 + 60.33 + 14.80 - 13.99 = 186.16
  });

  it('row tokenizer: a letter the OCR put in place of a digit is read as that digit only inside a number', () => {
    expect(parseRow('Profit for the period 103.94 107.88 92.42 211.82 197.GO', 5).values).toEqual([103.94, 107.88, 92.42, 211.82, 197.60]);
    expect(parseRow('Profit 156.89 143.69 122.72 300.58 268.BO', 5).values).toEqual([156.89, 143.69, 122.72, 300.58, 268.80]);
    // words are never numbers
    expect(parseRow('Owners of the company BO', 1)).toBeNull();
    expect(parseRow('Note GO', 1)).toBeNull();
  });
});

describe('JYOTICNC Q2 FY27 (OCR "ProfiU(Loss)", letter-spaced "Fin a nc e Cos ts", consolidated header printed out of order, year printed "20 26")', () => {
  // Hand-checked against the PDF. Consolidated, Rs. crore, columns: Q2 FY27 | Q1 FY27 | Q2 FY26 | H1 FY27 | H1 FY26 | FY26
  //   revenue 602.01 | 508.47 | 507.90     PBT before exceptional 103.72 | 73.41 | 109.05    finance 13.92    depreciation 15.97
  //   net profit after tax 72.58 | 57.14 | 85.50  (company deck: PAT 72.6 Cr vs 85.5 Cr, -15.1%); standalone PAT 114.89
  // The consolidated header prints "30-Sep-26 30-Sep-25 31-Mar-26 30-Sep-26 30-Jun-26 30-Sep-25" (not the real column order), so
  // reading the year-ago column from it would pick the PREVIOUS QUARTER (508.47) as the base.
  // Before the fix no statement was recognised at all: the filing got no results alert, only a "could not be machine-read" failure.
  const f = extractDeterministicFinancials(doc('JYOTICNC_2026-11-03'));

  it('recognises the consolidated statement and its revenue growth against the year-ago quarter (507.90), not the previous quarter', () => {
    expect(f).not.toBeNull();
    expect(f.statementScope).toBe('CONSOLIDATED');
    expect(f.revenue).toBeCloseTo(602.01, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(18.53, 1);
    expect(f.revenueQoQGrowthPct).toBeCloseTo(18.40, 1);
  });

  it('reads the consolidated profit after tax: 72.58 Cr, down 15.1% YoY (the decline the investor deck reports)', () => {
    expect(f.patConsolidated).toBeCloseTo(72.58, 2);
    expect(f.patYoYGrowthPct).toBeCloseTo(-15.11, 1);
    expect(f.isYoYDecline).toBe(true);
    expect(f.patStandalone).toBeCloseTo(114.89, 2);
  });

  it('labels the period 2026-09-30 and computes EBITDA from PBT + finance + depreciation', () => {
    expect(f.quarterEnded).toBe('2026-09-30');
    // 103.72 + 13.92 + 15.97 - other income 2.28 = 131.33: exactly the "EBITA" row the company prints (21.8% margin in its deck)
    expect(f.ebitda).toBeCloseTo(131.33, 2);
  });
});

describe('sanity guard: a profit figure that cannot belong to this statement is withheld, never shown', () => {
  const stmt = (patRow) => `
STATEMENT OF CONSOLIDATED UNAUDITED FINANCIAL RESULTS FOR THE QUARTER ENDED SEPTEMBER 30, 2026
(Rs. in Crores)
Particulars | Quarter Ended 30-09-2026 | Quarter Ended 30-06-2026 | Quarter Ended 30-09-2025
Revenue from operations 2,000.00 1,700.00 1,500.00
Other income 13.00 16.00 14.00
Total income 2,013.00 1,716.00 1,514.00
Finance costs 73.00 55.00 60.00
Depreciation and amortisation 20.00 19.00 15.00
Total expenses 1,855.00 1,572.00 1,392.00
Profit before tax 158.00 144.00 122.00
${patRow}
`;
  it('PAT of 14.74 against PBT of 158.00 (9%) is withheld with a reason; growth figures built on it are withheld too', () => {
    const f = extractDeterministicFinancials(stmt('Profit for the period 14.74 0.61 10.87'));
    expect(f).not.toBeNull();
    expect(f.revenue).toBe(2000);
    expect(f.patConsolidated).toBeNull();
    expect(f.patAttributable).toBeNull();
    expect(f.patYoYGrowthPct).toBeNull();
    expect(f.patRejectedReason).toMatch(/PBT/);
  });
  it('a normal PAT / PBT relationship (about 70%) is kept', () => {
    const f = extractDeterministicFinancials(stmt('Profit for the period 110.00 100.00 90.00'));
    expect(f.patConsolidated).toBe(110);
    expect(f.patRejectedReason).toBeUndefined();
  });
  it('a tax credit that lifts PAT above PBT is kept (within 1.6x)', () => {
    const f = extractDeterministicFinancials(stmt('Profit for the period 180.00 150.00 120.00'));
    expect(f.patConsolidated).toBe(180);
  });
});

describe('period label when the column header is garbled and names several dates (HSCL: "Three months ended 30.09.2026 ... Previous three months ended 30 06,2026")', () => {
  it('is the LATEST period end named in the heading lines (the current quarter), never the previous quarter that is printed nearer to the table', () => {
    const f = extractDeterministicFinancials(doc('HSCL_2026-10-16'));
    expect(f.quarterEnded).toBe('2026-09-30');
  });
});

describe('SBCL Q2 FY27 (split label "Depreciati on", share of profit of an associate between PBT lines): EBITDA is read, operating only', () => {
  const f = extractDeterministicFinancials(doc('SBCL_2026-11-04'));
  it('reads the consolidated statement in lakhs: revenue 197.79 Cr, up 43.95% on the year-ago quarter', () => {
    expect(f.statementScope).toBe('CONSOLIDATED');
    expect(f.revenue).toBeCloseTo(197.79, 2);
    expect(f.revenueYoYGrowthPct).toBeCloseTo(43.95, 1);
  });
  it('EBITDA = 4,566.10 (profit before the associate) + 210.52 + 540.94 - 297.12 other income = 5,020.44 lakh = 50.20 Cr (25.38% margin)', () => {
    expect(f.ebitda).toBeCloseTo(50.20, 2);
    expect(f.ebitdaMarginPct).toBeCloseTo(25.38, 1);
  });
  it('year-ago EBITDA is 3,016.55 + 114.23 + 336.28 - 359.66 = 3,107.40 lakh: +61.6% (the company reports +62%), margin +276 bps', () => {
    expect(f.ebitdaYoYGrowthPct).toBeCloseTo(61.6, 1);
    expect(f.ebitdaMarginBpsDelta).toBeGreaterThan(270);
    expect(f.ebitdaMarginBpsDelta).toBeLessThan(282);
  });
  it('the share of profit of the associate (114.36 lakh) is NOT operating profit: leaving it in would give 51.35 Cr', () => {
    expect(f.ebitda).toBeLessThan(51);
  });
});

describe('income identity: revenue + other income must equal total income in the same column (SJS: a vision-OCR misread of 2,827 as 2,327 produced "revenue -3.7%" and a red alert)', () => {
  const stmt = (rev0) => `
STATEMENT OF UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED 30 SEPTEMBER 2026
(Rs. in Crores)
Particulars | Quarter Ended 30-09-2026 | Quarter Ended 30-06-2026 | Quarter Ended 30-09-2025
Revenue from operations ${rev0} 261.00 241.76
Other income 5.28 9.14 11.47
Total income 288.00 270.14 253.23
Finance costs 5.51 9.60 10.98
Depreciation and amortisation expense 17.53 18.83 26.50
Total expenses 210.00 198.00 190.00
Profit before tax 78.00 72.14 63.23
Net profit for the period 58.30 54.00 43.00
`;
  it('a consistent statement is read (282.72 + 5.28 = 288.00)', () => {
    const r = extractDeterministicFinancials(stmt('282.72'));
    expect(r).not.toBeNull();
    expect(r.revenue).toBeCloseTo(282.72, 2);
  });
  it('a revenue cell that does not add up with other income to total income is not shown as verified (232.73 + 5.28 != 288.00)', () => {
    const r = extractDeterministicFinancials(stmt('232.73'));
    expect(r).toBeNull();
  });
});
