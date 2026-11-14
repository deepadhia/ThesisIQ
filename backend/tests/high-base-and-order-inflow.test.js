import { describe, it, expect } from 'vitest';
import { evaluateDualLayerActionGate } from '../services/thesis-gate-evaluator.service.js';

describe('High-Base Normalization & Order Inflow Continuity Guards', () => {
  describe('High-Base Normalization Gate (HBL-type cases)', () => {
    it('normalizes YoY contraction when absolute run-rate hurdle and operating margins are satisfied', () => {
      // HBLENGINE Q2 FY27 scenario:
      // Prior year was an exceptional delivery spike.
      // Q2 FY27 revenue is ₹871 Cr (hurdle is ₹700 Cr), EBITDA margin is 26.4% (hurdle is 16%).
      // YoY is -28.7% revenue and -50.3% PAT.
      const hblFin = {
        revenue: 871.56,
        revenueCr: 871.56,
        revenueYoYGrowthPct: -28.73,
        patConsolidated: 192.51,
        patYoYGrowthPct: -50.29,
        ebitda: 229.8,
        ebitdaMarginPct: 26.37,
        ebitdaMarginBpsDelta: 50,
        isMarginErosion: false
      };

      const gate = evaluateDualLayerActionGate({
        ticker: 'HBLENGINE',
        financialData: hblFin,
        proposedAction: 'HOLD',
        llmConviction: 7,
        driverAssessment: [
          { driver: 'Kavach 4.0 Deployment', status: 'CONFIRMED', materiality: 'HIGH' }
        ]
      });

      // Must NOT be punished as a broken thesis (THESIS_DEVIATION, 4/10)
      expect(gate.statusClassification).toBe('THESIS_INTACT_HIGH_BASE_MONITORING');
      expect(gate.finalAction).toBe('HOLD / MONITOR');
      expect(gate.calibratedConviction).toBeGreaterThanOrEqual(6);
      expect(gate.decisionExplanation).toContain('high-base');
    });

    it('still fails as THESIS_DEVIATION if absolute run-rate or margin hurdle is also breached', () => {
      // If revenue contracts AND falls below the ₹700 Cr hurdle (e.g. ₹600 Cr):
      const breachedFin = {
        revenue: 600,
        revenueCr: 600,
        revenueYoYGrowthPct: -35,
        patConsolidated: 80,
        patYoYGrowthPct: -60,
        ebitda: 90,
        ebitdaMarginPct: 15, // Below 16% hurdle!
        ebitdaMarginBpsDelta: -250,
        isMarginErosion: true
      };

      const gate = evaluateDualLayerActionGate({
        ticker: 'HBLENGINE',
        financialData: breachedFin,
        proposedAction: 'HOLD',
        llmConviction: 5
      });

      expect(gate.statusClassification).toBe('THESIS_DEVIATION');
      expect(gate.finalAction).toBe('REASSESS THESIS');
      expect(gate.calibratedConviction).toBeLessThanOrEqual(4);
    });
  });

  describe('Order Inflow Continuity & Backlog Depletion Guard (Morepen-type cases)', () => {
    it('vetoes BUY and caps conviction when reported growth is high but book-to-bill < 0.8x', () => {
      // MOREPENLAB scenario:
      // High reported numbers from delivering old ₹825 Cr order: +81% revenue, +116% PAT, 16.5% margin.
      // But book-to-bill is only 0.4x (order inflows dried up).
      const morepenFin = {
        revenue: 746.5,
        revenueCr: 746.5,
        revenueYoYGrowthPct: 81.38,
        patConsolidated: 88.89,
        patYoYGrowthPct: 116.58,
        ebitda: 123.1,
        ebitdaMarginPct: 16.49,
        ebitdaMarginBpsDelta: 120,
        isMarginErosion: false
      };

      const operational = {
        bookToBill: 0.42,
        orderInflowCr: 50,
        orderInflowDepleted: true
      };

      const gate = evaluateDualLayerActionGate({
        ticker: 'MOREPENLAB',
        financialData: morepenFin,
        operationalMetrics: operational,
        proposedAction: 'STRONG BUY',
        llmConviction: 9,
        driverAssessment: [
          { driver: 'CDMO Supply Mandate Execution', status: 'CONFIRMED', materiality: 'HIGH' }
        ]
      });

      // Must VETO STRONG BUY / ADD and downgrade to HOLD / MONITOR
      expect(gate.actionAuthorized).toBe(false);
      expect(gate.finalAction).toBe('HOLD / MONITOR');
      expect(gate.calibratedConviction).toBeLessThanOrEqual(6);
      expect(gate.statusClassification).toBe('BACKLOG_DEPLETION_RISK');
      expect(gate.decisionExplanation).toContain('order inflows stalled');
    });

    it('allows ADD/STRONG BUY when both financial beat and order book replenishment are healthy', () => {
      const healthyFin = {
        revenue: 746.5,
        revenueCr: 746.5,
        revenueYoYGrowthPct: 35,
        patConsolidated: 88.89,
        patYoYGrowthPct: 40,
        ebitda: 123.1,
        ebitdaMarginPct: 16.49,
        ebitdaMarginBpsDelta: 50,
        isMarginErosion: false
      };

      const healthyOperational = {
        bookToBill: 1.35,
        orderInflowCr: 950
      };

      const gate = evaluateDualLayerActionGate({
        ticker: 'MOREPENLAB',
        financialData: healthyFin,
        operationalMetrics: healthyOperational,
        proposedAction: 'ADD',
        llmConviction: 8,
        driverAssessment: [
          { driver: 'CDMO Supply Mandate Execution', status: 'CONFIRMED', materiality: 'HIGH' }
        ]
      });

      expect(gate.actionAuthorized).toBe(true);
      expect(['ADD', 'STRONG BUY']).toContain(gate.finalAction);
      expect(gate.calibratedConviction).toBeGreaterThanOrEqual(8);
    });
  });
});
