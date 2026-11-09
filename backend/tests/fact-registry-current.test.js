import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildFactRegistry, validateSynthesisClaims, currentSynthesisTruth } from '../services/fact-registry.service.js';
import { evaluateThesisSpecificHurdle } from '../services/thesis-gate-evaluator.service.js';

describe('synthesis facts come from the current verified statement for every company', () => {
  it('keeps issuer thesis hurdles in configuration, outside the generic evaluator', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve('backend/config/thesis-hurdles.json'), 'utf8'));
    expect(Object.keys(config).length).toBeGreaterThan(0);
    const source = fs.readFileSync(path.resolve('backend/services/thesis-gate-evaluator.service.js'), 'utf8');
    expect(source).not.toMatch(/const SPECIFIC_THESIS_HURDLES\s*=\s*\{/);
  });
  it('enforces a configured revenue-growth hurdle, including missing evidence', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve('backend/config/thesis-hurdles.json'), 'utf8'));
    const [ticker, rule] = Object.entries(config).find(([, r]) => r.primary.minRevenueGrowthPct !== undefined);
    expect(evaluateThesisSpecificHurdle(ticker, { revenueYoYGrowthPct: rule.primary.minRevenueGrowthPct - 1 }).status).toBe('FAIL');
    expect(evaluateThesisSpecificHurdle(ticker, {}).status).toBe('UNAVAILABLE');
  });
  it('never confirms an undisclosed structural metric merely because it is not the VAP metric', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve('backend/config/thesis-hurdles.json'), 'utf8'));
    const [ticker, rule] = Object.entries(config).find(([, r]) => r.structural?.targetExportMixPct !== undefined);
    const fin = { ebitdaMarginPct: rule.primary.minEbitdaMarginPct + 1 };
    expect(evaluateThesisSpecificHurdle(ticker, fin).structuralConfirmed).toBe(false);
    expect(evaluateThesisSpecificHurdle(ticker, fin, { exportMixPct: rule.structural.targetExportMixPct + 1 }).structuralConfirmed).toBe(true);
  });
  it('never falls back to a named-company historical fixture', () => {
    expect(buildFactRegistry('TIMETECHNO')).toBeNull();
  });
  it('requires source provenance and verified statement numbers in the quarterly snapshot', () => {
    expect(currentSynthesisTruth({ quarter: 'Q2_FY27', raw_ai_output: {} })).toBeNull();
    const snapshot = { quarter: 'Q2_FY27', raw_ai_output: { source_filing: { announcement_id: 'id', attachment_url: 'https://exchange.test/report.pdf' }, verified_financials: { isFinancialResult: true, revenue: 200, revenueYoYGrowthPct: 19.8 } } };
    expect(currentSynthesisTruth(snapshot)).toMatchObject({ revenue: 200, period: 'Q2_FY27' });
  });
  it('accepts an accurately reported percentage regardless of previously problematic figures', () => {
    const registry = buildFactRegistry('AAA', { period: 'Q2_FY27', revenue: 200, revenueYoYGrowthPct: 19.8 });
    expect(validateSynthesisClaims('Revenue growth: 19.8%', registry).valid).toBe(true);
    expect(validateSynthesisClaims('35% YoY revenue growth', registry).valid).toBe(false);
    expect(validateSynthesisClaims('Revenue growth: 35%', registry).valid).toBe(false);
    expect(validateSynthesisClaims('Revenue grew 35% YoY', registry).valid).toBe(false);
  });
  it('checks a labelled quarter-on-quarter revenue change against QoQ, not YoY', () => {
    const registry = buildFactRegistry('AAA', {period:'Q2_FY27',revenue:638.94,revenueYoYGrowthPct:10.52,revenueQoQGrowthPct:22.74});
    expect(validateSynthesisClaims('Revenue grew 22.74% QoQ while YoY revenue growth was 10.52%.', registry).valid).toBe(true);
    expect(validateSynthesisClaims('Revenue growth: 22.74% QoQ', registry).valid).toBe(true);
    expect(validateSynthesisClaims('Revenue grew 35% QoQ', registry).valid).toBe(false);
  });
  it('never manufactures a margin contraction magnitude when missing', () => {
    const registry = buildFactRegistry('AAA', { period: 'Q2_FY27', isMarginErosion: true });
    const alert = [...registry.riskAlerts.values()][0];
    expect(alert.bps_delta).toBeNull();
    expect(alert.description).not.toMatch(/\d/);
  });
  it('validates disclosed capacity for any figure and rejects an invented one', () => {
    const known = buildFactRegistry('AAA', { period: 'Q2_FY27', capacityUtilizationPct: 23.56 });
    expect(validateSynthesisClaims('Capacity utilization: 23.56%', known).valid).toBe(true);
    expect(validateSynthesisClaims('Capacity utilization: 70%', known).valid).toBe(false);
    const unknown = buildFactRegistry('AAA', { period: 'Q2_FY27' });
    expect(validateSynthesisClaims('Capacity utilization: 70%', unknown).valid).toBe(false);
  });
});
