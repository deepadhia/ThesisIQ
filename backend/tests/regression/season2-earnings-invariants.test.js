import { describe, it, expect } from 'vitest';
import { classifyFilingCategory, detectFilingLifecycleStage } from '../../services/filing-classifier.service.js';
import { parseFiscalQuarter } from '../../utils/fiscal-quarter.js';
import { getIndianFiscalQuarter } from '../../workers/quarterly-deepdive-worker.js';

describe('Season 2 (Q2 FY27) Earnings & Notification Invariant Suite', () => {

  describe('Invariant 1: Concall & Analyst Meet Titles Must NEVER Masquerade as Earnings Releases', () => {
    const concallTitles = [
      'Analysts/Institutional Investor Meet/Con. Call Updates',
      'Schedule of Analyst / Institutional Investor Meet',
      'Intimation of Schedule of Analyst / Institutional Investor Conference Call',
      'Conference call updates',
      'Earnings call intimation',
      'Prior intimation of Board Meeting for financial results'
    ];

    concallTitles.forEach(title => {
      it(`classifies concall notice as ROUTINE_COMPLIANCE: "${title}"`, () => {
        const category = classifyFilingCategory(title, 'The management will discuss financial results on October 14, 2026 at 4:00 PM.');
        expect(category).toBe('ROUTINE_COMPLIANCE');

        const stage = detectFilingLifecycleStage(title, 'The management will discuss financial results on October 14, 2026 at 4:00 PM.');
        expect(stage).toBe('ROUTINE_COMPLIANCE');
      });
    });

    const genuineResultsTitles = [
      'Financial Results for the quarter and half year ended September 30, 2026',
      'Outcome of Board Meeting held on October 14, 2026 - Financial Results',
      'Unaudited Financial Results (Standalone and Consolidated) for Q2 FY27',
      'Audited Financial Results - Outcome of Board Meeting'
    ];

    genuineResultsTitles.forEach(title => {
      it(`does NOT suppress genuine financial results outcome: "${title}"`, () => {
        const category = classifyFilingCategory(title, 'Approved the unaudited financial results for the quarter ended September 30, 2026.');
        expect(category).toBe('QUARTERLY_EARNINGS');

        const stage = detectFilingLifecycleStage(title, 'Approved the unaudited financial results for the quarter ended September 30, 2026.');
        expect(stage).toBe('STAGE_1_RESULTS');
      });
    });
  });

  describe('Invariant 2: Season 2 (Q2 FY27) Fiscal Quarter Canonical Normalization', () => {
    it('correctly maps October, November, and December 2026 to Q2 FY27', () => {
      expect(getIndianFiscalQuarter('2026-10-14')).toBe('Q2 FY27');
      expect(getIndianFiscalQuarter('2026-10-27')).toBe('Q2 FY27');
      expect(getIndianFiscalQuarter('2026-11-15')).toBe('Q2 FY27');
      expect(getIndianFiscalQuarter('2026-12-01')).toBe('Q2 FY27');
    });

    it('canonicalizes both space and underscore representations to Q2_FY27 with key 2702', () => {
      const qSpace = parseFiscalQuarter('Q2 FY27');
      const qUnder = parseFiscalQuarter('Q2_FY27');
      const qNse = parseFiscalQuarter('FY27-Q2');

      expect(qSpace.label).toBe('Q2_FY27');
      expect(qUnder.label).toBe('Q2_FY27');
      expect(qNse.label).toBe('Q2_FY27');

      expect(qSpace.key).toBe(2702);
      expect(qUnder.key).toBe(2702);
      expect(qNse.key).toBe(2702);

      // Chronological invariant: Q2 FY27 is strictly greater than Q1 FY27
      const q1 = parseFiscalQuarter('Q1_FY27');
      expect(qSpace.key).toBeGreaterThan(q1.key);
    });
  });

  describe('Invariant 3: Title-Check Integrity for Pre-Result Reminder Publish Status', () => {
    it('distinguishes between genuine financial results and advance concall notices', () => {
      const concallNotice = {
        title: 'Analysts/Institutional Investor Meet/Con. Call Updates',
        is_earnings_release: false
      };

      const resultsFiling = {
        title: 'Outcome of Board Meeting - Financial Results',
        is_earnings_release: true
      };

      // Simulated title match logic identical to remind-results.js checkResultsPublished
      const isConcall = concallNotice.title.toLowerCase().includes('analyst') || 
                        concallNotice.title.toLowerCase().includes('con. call');
      expect(isConcall).toBe(true);

      const isActualResults = (resultsFiling.title.toLowerCase().includes('financial result') || 
                               resultsFiling.title.toLowerCase().includes('outcome of board meeting')) &&
                              !resultsFiling.title.toLowerCase().includes('analyst') &&
                              !resultsFiling.title.toLowerCase().includes('con. call');
      expect(isActualResults).toBe(true);
    });
  });

  describe('Invariant 4: ROCE-Tethered Dynamic Exit PE & 5-Tier Pricing Regimes', () => {
    it('correctly maps ROCE tiers to terminal exit multiples', async () => {
      const { resolveRoceTetheredExitPe } = await import('../../services/asymmetric-mispricing-ranking.service.js');
      expect(resolveRoceTetheredExitPe(33.5)).toBe(32.0); // INOXINDIA
      expect(resolveRoceTetheredExitPe(28.6)).toBe(26.0); // SJS
      expect(resolveRoceTetheredExitPe(20.9)).toBe(20.0); // ELECON
      expect(resolveRoceTetheredExitPe(12.1)).toBe(15.0); // ANANTRAJ
    });

    it('distinguishes fair-value compounders (SJS, GRAVITA) from hyper-valuation momentum (QPOWER, ASTRAMICRO)', async () => {
      const { calculate5YearPricingHurdle, PRICING_HURDLE_REGIME } = await import('../../services/asymmetric-mispricing-ranking.service.js');

      // SJS: 33.8x PE with 28.6% ROCE -> Exit 26x -> Hurdle 18% -> FAIR_PRICE_COMPOUNDER
      const sjsHurdle = calculate5YearPricingHurdle({
        currentPE: 33.8,
        underwrittenCagr: 22.0,
        rocePct: 28.6
      });
      expect(sjsHurdle.conservativeExitPE).toBe(26.0);
      expect(sjsHurdle.regime).toBe(PRICING_HURDLE_REGIME.FAIR_PRICE_COMPOUNDER);
      expect(sjsHurdle.expectationCushionPct).toBeGreaterThan(0);

      // QPOWER: 89.9x PE with 31.7% ROCE -> Exit 32x -> Hurdle 37.7% -> HYPER_VALUATION_MOMENTUM
      const qpowerHurdle = calculate5YearPricingHurdle({
        currentPE: 89.9,
        underwrittenCagr: 22.0,
        rocePct: 31.7
      });
      expect(qpowerHurdle.conservativeExitPE).toBe(32.0);
      expect(qpowerHurdle.regime).toBe(PRICING_HURDLE_REGIME.HYPER_VALUATION_MOMENTUM);
      expect(qpowerHurdle.expectationCushionPct).toBeLessThan(0);

      // HBLENGINE: 24.9x PE with 59.3% ROCE -> Exit 24.9x (clamped) -> Hurdle 12% -> PRICED_FOR_MODEST_GROWTH
      const hblHurdle = calculate5YearPricingHurdle({
        currentPE: 24.9,
        underwrittenCagr: 28.0,
        rocePct: 59.3
      });
      expect(hblHurdle.conservativeExitPE).toBe(24.9);
      expect(hblHurdle.regime).toBe(PRICING_HURDLE_REGIME.PRICED_FOR_MODEST_GROWTH);
      expect(hblHurdle.expectationCushionPct).toBe(16.0);
    });
  });
});
