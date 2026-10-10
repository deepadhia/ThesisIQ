import { describe, it, expect } from 'vitest';
import {
  resolveRoceTetheredExitPe,
  computeCapacityValuationMetrics
} from '../services/capacity-normalized-valuation.service.js';

describe('Capacity-Normalized Valuation & P/E Compression Resilience Engine', () => {
  describe('ROCE-Tethered Exit Multiple Derivation', () => {
    it('assigns 35x exit P/E to monopoly/high-moat businesses with ROCE >= 30%', () => {
      expect(resolveRoceTetheredExitPe(33.5)).toBe(35.0); // INOXINDIA
      expect(resolveRoceTetheredExitPe(31.7)).toBe(35.0); // QPOWER
    });

    it('assigns 28x exit P/E to high-reinvestment compounders with ROCE 22-30%', () => {
      expect(resolveRoceTetheredExitPe(25.0)).toBe(28.0);
      expect(resolveRoceTetheredExitPe(22.0)).toBe(28.0);
    });

    it('assigns 22x exit P/E to solid industrial compounders with ROCE 16-22%', () => {
      expect(resolveRoceTetheredExitPe(20.3)).toBe(22.0); // ASTRAMICRO
      expect(resolveRoceTetheredExitPe(16.5)).toBe(22.0); // TIMETECHNO
    });

    it('assigns 16x exit P/E to cyclical or low-return businesses with ROCE < 16%', () => {
      expect(resolveRoceTetheredExitPe(12.0)).toBe(16.0);
    });
  });

  describe('Capacity Metrics & P/E Compression Calculations', () => {
    it('correctly compresses QPOWER P/E from 89.9x trailing to 22.7x on full Sangli capacity', () => {
      const stock = {
        ticker: 'QPOWER',
        company_name: 'Quality Power',
        sector: 'Power',
        share_price: 1547.0,
        pe_ratio: 89.9,
        market_cap: 11984.0,
        ttm_pat: 133.3,
        roce_pct: 31.7
      };

      const engine = {
        engine_name: 'Sangli Greenfield Plant (8x High-Voltage Capacity)',
        engine_type: 'GREENFIELD_CAPEX',
        status: 'UNDER_CONSTRUCTION',
        unbilled_capex_cr: 450.0,
        contracted_backlog_cr: 1100.0,
        current_runrate_revenue_cr: 850.0,
        full_capacity_revenue_cr: 3200.0,
        normalized_ebitda_margin_pct: 24.0,
        normalized_pat_margin_pct: 16.5,
        normalized_full_capacity_pat_cr: 528.0,
        milestone_tranches: [
          { tranche_pct: 30, phase: 'STARTER', status: 'ACHIEVED' },
          { tranche_pct: 35, phase: 'COMMISSIONING', status: 'PENDING' },
          { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', status: 'PENDING' }
        ]
      };

      const res = computeCapacityValuationMetrics(stock, engine);
      expect(res.capacityForwardPe).toBe(22.7); // 11984 / 528 = 22.697 -> 22.7x
      expect(res.exitPe).toBe(35.0); // ROCE 31.7%
      expect(res.terminalScaledMcapCr).toBe(18480.0); // 528 * 35 = 18480 Cr
      expect(res.compressionBufferPct).toBeGreaterThan(50.0); // Massive upside protection
      expect(res.compressionVerdict).toBe('HIGH_UPSIDE_PROTECTED');
      expect(res.authorizedWeightPct).toBe(30);
      expect(res.trancheAction).toBe('STARTER_TRANCHE_ACTIVE');
    });

    it('correctly warns on ASTRAMICRO compression overhang despite ₹4,300 Cr order backlog', () => {
      const stock = {
        ticker: 'ASTRAMICRO',
        company_name: 'Astra Microwave',
        sector: 'Defence Electronics',
        share_price: 1653.0,
        pe_ratio: 83.0,
        market_cap: 15693.0,
        ttm_pat: 189.1,
        roce_pct: 20.3
      };

      const engine = {
        engine_name: 'HAL Uttam AESA Radar Backlog',
        engine_type: 'ORDER_BOOK_BACKLOG',
        status: 'UNDER_CONSTRUCTION',
        contracted_backlog_cr: 4300.0,
        current_runrate_revenue_cr: 950.0,
        full_capacity_revenue_cr: 2200.0,
        normalized_ebitda_margin_pct: 19.5,
        normalized_pat_margin_pct: 14.0,
        normalized_full_capacity_pat_cr: 308.0,
        milestone_tranches: [
          { tranche_pct: 30, phase: 'STARTER', status: 'ACHIEVED' },
          { tranche_pct: 35, phase: 'COMMISSIONING', status: 'PENDING' }
        ]
      };

      const res = computeCapacityValuationMetrics(stock, engine);
      expect(res.capacityForwardPe).toBe(51.0); // 15693 / 308 = 50.95 -> 51.0x
      expect(res.exitPe).toBe(22.0); // ROCE 20.3%
      expect(res.terminalScaledMcapCr).toBe(6776.0); // 308 * 22 = 6776 Cr
      expect(res.compressionBufferPct).toBeLessThan(0); // Overhang detected!
      expect(res.compressionVerdict).toBe('SEVERE_MULTIPLE_BUBBLE');
      expect(res.authorizedWeightPct).toBe(30);
    });
  });
});
