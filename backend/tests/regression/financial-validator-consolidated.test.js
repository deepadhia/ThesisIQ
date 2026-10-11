import { describe, it, expect } from 'vitest';
import { extractDeterministicFinancials } from '../../services/financial-validator.service.js';

describe('Financial Validator: Consolidated-First & Stress Invariant Suite', () => {

  const multiSectionFilingCrores = `
COMPANY ABC LIMITED
CIN: L12345MH2000PLC123456
Outcome of Board Meeting held on October 25, 2026
Submission of Unaudited Standalone and Consolidated Financial Results for the quarter ended September 30, 2026.

STATEMENT OF STANDALONE UNAUDITED FINANCIAL RESULTS FOR THE QUARTER ENDED SEPTEMBER 30, 2026
(₹ in Crores)
Particulars | Quarter Ended 30-09-2026 | Quarter Ended 30-06-2026 | Quarter Ended 30-09-2025
Revenue from operations 500.00 450.00 400.00
Other income 10.00 8.00 5.00
Total Income 510.00 458.00 405.00
Cost of materials consumed 250.00 220.00 200.00
Finance costs 20.00 18.00 15.00
Depreciation and amortisation 25.00 22.00 20.00
Total expenses 420.00 380.00 340.00
Profit before tax 90.00 78.00 65.00
Profit for the period (Net Profit after Tax) 67.50 58.50 48.75

STATEMENT OF CONSOLIDATED UNAUDITED FINANCIAL RESULTS FOR THE QUARTER ENDED SEPTEMBER 30, 2026
(₹ in Crores)
Particulars | Quarter Ended 30-09-2026 | Quarter Ended 30-06-2026 | Quarter Ended 30-09-2025
Revenue from operations 950.00 850.00 760.00
Other income 15.00 12.00 10.00
Total Income 965.00 862.00 770.00
Cost of materials consumed 480.00 430.00 380.00
Finance costs 35.00 32.00 30.00
Depreciation and amortisation 45.00 40.00 38.00
Total expenses 790.00 710.00 640.00
Profit before tax 175.00 152.00 130.00
Profit for the period (Net Profit after Tax) 131.25 114.00 97.50
`;

  it('prioritizes Consolidated Financial Results over Standalone in multi-section filings', () => {
    const fin = extractDeterministicFinancials(multiSectionFilingCrores);
    expect(fin).not.toBeNull();
    expect(fin.isFinancialResult).toBe(true);

    // Consolidated metrics must be prioritized
    expect(fin.revenue).toBe(950);
    expect(fin.patConsolidated).toBe(131.25);
    expect(fin.patAttributable).toBe(131.25);
    expect(fin.patStandalone).toBe(67.5);

    // EBITDA = PBT (175) + Finance (35) + Depreciation (45) = 255
    expect(fin.ebitda).toBe(255);
    expect(fin.ebitdaMarginPct).toBe(26.84);

    // Revenue YoY: (950 - 760) / 760 = +25%
    expect(fin.revenueYoYGrowthPct).toBe(25);
    // Revenue QoQ: (950 - 850) / 850 = +11.76%
    expect(fin.revenueQoQGrowthPct).toBe(11.76);
  });

  it('safely extracts single-entity pure standalone filings without failing', () => {
    const standaloneFiling = `
COMPANY XYZ LIMITED
STATEMENT OF STANDALONE UNAUDITED FINANCIAL RESULTS FOR THE QUARTER ENDED SEPTEMBER 30, 2026
(₹ in Lakhs)
Particulars | Quarter Ended 30-09-2026 | Quarter Ended 30-06-2026 | Quarter Ended 30-09-2025
Revenue from operations 30000.00 28000.00 25000.00
Other income 500.00 400.00 300.00
Total Income 30500.00 28400.00 25300.00
Cost of materials consumed 15000.00 14000.00 12500.00
Finance costs 1000.00 900.00 800.00
Depreciation and amortisation 1500.00 1400.00 1300.00
Total expenses 25000.00 23500.00 21000.00
Profit before tax 5500.00 4900.00 4300.00
Profit for the period 4125.00 3675.00 3225.00
`;

    const fin = extractDeterministicFinancials(standaloneFiling);
    expect(fin).not.toBeNull();
    // 30,000 Lakhs / 100 = 300 Cr
    expect(fin.revenue).toBe(300);
    // 4,125 Lakhs / 100 = 41.25 Cr
    expect(fin.patConsolidated).toBe(41.25);
    expect(fin.patStandalone).toBe(41.25);
    // EBITDA = (5500 + 1000 + 1500) / 100 = 80 Cr
    expect(fin.ebitda).toBe(80);
    expect(fin.ebitdaMarginPct).toBe(26.67);
  });

  it('is not fooled by Page 1 cover letters mentioning Consolidated when only Standalone exists', () => {
    const coverLetterTrap = `
COMPANY TRAP LIMITED
Outcome of Board Meeting to consider Unaudited Standalone and Consolidated Financial Results.
The Board reviewed the business environment.
STATEMENT OF STANDALONE UNAUDITED FINANCIAL RESULTS FOR THE QUARTER ENDED SEPTEMBER 30, 2026
(₹ in Crores)
Particulars | Quarter Ended 30-09-2026 | Quarter Ended 30-06-2026 | Quarter Ended 30-09-2025
Revenue from operations 120.00 110.00 100.00
Profit before tax 30.00 28.00 25.00
Finance costs 5.00 4.00 3.00
Depreciation 7.00 6.00 5.00
Net Profit after Tax 22.50 21.00 18.75
`;

    const fin = extractDeterministicFinancials(coverLetterTrap);
    expect(fin).not.toBeNull();
    expect(fin.revenue).toBe(120);
    expect(fin.patConsolidated).toBe(22.5);
    // EBITDA = 30 + 5 + 7 = 42
    expect(fin.ebitda).toBe(42);
    expect(fin.ebitdaMarginPct).toBe(35);
  });

  it('accurately normalizes unit scales across Crores, Millions, and Lakhs', () => {
    const millionsFiling = `
COMPANY GLOBAL LIMITED
CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED SEPTEMBER 30, 2026
(Rs. in Millions)
Revenue from operations 5000.00 4500.00 4000.00
Profit before tax 1000.00 900.00 800.00
Finance costs 100.00 90.00 80.00
Depreciation 200.00 180.00 160.00
Profit for the period 750.00 675.00 600.00
`;

    const fin = extractDeterministicFinancials(millionsFiling);
    expect(fin).not.toBeNull();
    // 5,000 Million / 10 = 500 Cr
    expect(fin.revenue).toBe(500);
    // 750 Million / 10 = 75 Cr
    expect(fin.patConsolidated).toBe(75);
    // EBITDA = (1000 + 100 + 200) / 10 = 130 Cr
    expect(fin.ebitda).toBe(130);
    expect(fin.ebitdaMarginPct).toBe(26);
  });

  it('correctly handles exceptional gains and computes Normalised PAT', () => {
    const exceptionalFiling = `
COMPANY SPECIAL LIMITED
STATEMENT OF CONSOLIDATED FINANCIAL RESULTS
(₹ in Crores)
Revenue from operations 800.00 750.00 700.00
Profit before exceptional item and tax 120.00 110.00 100.00
Exceptional gain on sale of property 35.00 0.00 0.00
Profit before tax 155.00 110.00 100.00
Finance costs 15.00 14.00 12.00
Depreciation 25.00 24.00 22.00
Profit for the period 116.25 82.50 75.00
`;

    const fin = extractDeterministicFinancials(exceptionalFiling);
    expect(fin).not.toBeNull();
    expect(fin.revenue).toBe(800);
    expect(fin.patConsolidated).toBe(116.25);
    expect(fin.exceptionalGain).toBe(35);
    expect(fin.normalisedPat).toBe(81.25); // 116.25 - 35 = 81.25
  });

  it('flags segment red flags when a core business segment contracts >15% YoY', () => {
    const segmentFiling = `
COMPANY TECH LIMITED
STATEMENT OF CONSOLIDATED FINANCIAL RESULTS
Revenue from operations 1000.00 900.00 800.00
Profit before tax 200.00 180.00 160.00
Profit after tax 150.00 135.00 120.00

Segment Results
1. Industrial Batteries 120.00 110.00 100.00
2. Defence & Aviation 25.00 40.00 50.00
`;

    const fin = extractDeterministicFinancials(segmentFiling);
    expect(fin).not.toBeNull();
    expect(fin.segmentRedFlags.length).toBeGreaterThan(0);
    const defenceFlag = fin.segmentRedFlags.find(f => f.segment.includes('DEFENCE'));
    expect(defenceFlag).toBeDefined();
    // 25 vs 50 = -50% decline
    expect(defenceFlag.yoyDeclinePct).toBe(-50);
    expect(fin.isYoYDecline).toBe(true);
  });
});
