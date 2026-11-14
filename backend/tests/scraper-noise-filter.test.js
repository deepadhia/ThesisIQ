import { describe, it, expect } from 'vitest';
import { classifyDirectEvent } from '../services/allocation-relevance.service.js';
import { decideDirectAlertGate } from '../services/direct-alert-gate.service.js';
import { isContentFreeNotice } from '../services/direct-alert-gate.service.js';

describe('Scraper Noise & Immaterial Alert Gate (Silence Routine Filings)', () => {
  it('boards routine neutral credit rating reaffirmations instead of pushing mobile alerts', () => {
    const direct = classifyDirectEvent({
      category: 'CREDIT_EVENT',
      priority: 'MEDIUM',
      impact: 'NEUTRAL'
    });
    expect(direct.push).toBe(false);
    expect(direct.reason).toContain('neutral');
  });

  it('still pushes credit downgrades or high priority credit events', () => {
    const downgrade = classifyDirectEvent({
      category: 'CREDIT_EVENT',
      priority: 'HIGH',
      impact: 'NEGATIVE'
    });
    expect(downgrade.push).toBe(true);

    const highPrio = classifyDirectEvent({
      category: 'CREDIT_EVENT',
      priority: 'HIGH',
      impact: 'POSITIVE'
    });
    expect(highPrio.push).toBe(true);
  });

  it('boards routine regulatory actions with neutral impact', () => {
    const direct = classifyDirectEvent({
      category: 'REGULATORY_ACTION',
      priority: 'MEDIUM',
      impact: 'NEUTRAL'
    });
    expect(direct.push).toBe(false);
  });

  it('boards micro-acquisitions under 3% market cap (e.g. ₹3 Lakhs vs ₹1,000 Cr cap)', () => {
    const micro = classifyDirectEvent({
      category: 'ACQUISITION',
      priority: 'MEDIUM',
      impact: 'NEUTRAL',
      amountCr: 0.03, // ₹3 Lakhs
      marketCapCr: 1500
    });
    expect(micro.push).toBe(false);
    expect(micro.reason).toMatch(/only 0\.0% of market cap/);
  });

  it('identifies content-free recording notices that announce audio without metrics', () => {
    const summary = "The filing only announces the availability of the Q2 & FY27 results conference call audio and does not disclose any financial metrics.";
    expect(isContentFreeNotice(summary)).toBe(true);

    const validSummary = "Q2 FY27 revenue grew 23% YoY to ₹263 Cr with EBITDA margin expanding to 33.8%.";
    expect(isContentFreeNotice(validSummary)).toBe(false);
  });
});
