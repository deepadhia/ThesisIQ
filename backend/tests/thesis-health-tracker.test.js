import { describe, expect, it } from 'vitest';
import { assessThesisHealth, buildThesisHealthReport } from '../services/thesis-health-tracker.service.js';

const stock = { id: 's1', ticker: 'NEWCO', company_name: 'New Company', investment_thesis: 'A generic thesis' };
const snapshot = { quarter: 'Q2 FY27', thesis_status: 'THESIS_STRENGTHENING', thesis_status_reason: 'Core driver improving', conviction_score: 7 };
const result = (overrides = {}) => ({
  id: 'f1', ticker: 'NEWCO', deep_dive_status: 'completed',
  filing_date: '2026-11-05T15:00:00Z', attachment_url: 'https://exchange.example/result.pdf',
  event_analysis: { institutional_verdict: {
    final_action: 'HOLD', conviction_score: 7,
    verified_financials: { isFinancialResult: true, isVerified: true, revenue: 100 },
    thesis_driver_assessment: [{ driver: 'Core growth', status: 'CONFIRMED', evidence: 'Revenue rose 20%' }]
  } }, ...overrides
});
const reaction = { ticker: 'NEWCO', filingId: 'f1', reaction: { status: 'OBSERVED', windows: {
  D1: { status: 'OBSERVED', returnPct: 6 }, D3: { status: 'OBSERVED', returnPct: 3 },
  D5: { status: 'OBSERVED', returnPct: 1 }
}, latest: { status: 'OBSERVED', returnPct: 1 } } };

describe('generic thesis health tracker', () => {
  it('tracks fundamental evidence and conviction without raising them because of a rally', () => {
    const a = assessThesisHealth({ stock, snapshots: [snapshot], filings: [result()], reaction });
    const b = assessThesisHealth({ stock, snapshots: [snapshot], filings: [result()], reaction: null });
    expect(a.fundamental.status).toBe('THESIS_STRENGTHENING');
    expect(a.fundamental.conviction).toBe(7);
    expect(a.fundamental.recordedSnapshotConviction).toBe(7);
    expect(a.fundamental.quarterlyHistory).toEqual([{ quarter: 'Q2 FY27', recordedStatus: 'THESIS_STRENGTHENING', recordedConviction: 7 }]);
    expect(a.fundamental.evidenceSignal).toBe('POSITIVE_RECORDED');
    expect(a.fundamental).toEqual(b.fundamental);
    expect(a.market.reactionStatus).toBe('OBSERVED');
    expect(a.market.observedWindowMaxToLatestPp).toBe(5);
    expect(a.market.windows.D1.returnPct).toBe(6);
    expect(a.attribution).toBe('UNDETERMINED');
  });

  it('does not replace an earlier risk with a later no-evidence deck', () => {
    const later = result({ id: 'f2', filing_date: '2026-11-09T15:00:00Z', event_analysis: {
      institutional_verdict: { final_action: 'HOLD', conviction_score: 9,
        thesis_driver_assessment: [{ driver: 'Core growth', status: 'NO_EVIDENCE', evidence: 'No new evidence' }] }
    } });
    const older = result({ event_analysis: { institutional_verdict: {
      final_action: 'REASSESS', conviction_score: 4,
      verified_financials: { isFinancialResult: true, isVerified: true, revenue: 100 },
      thesis_driver_assessment: [{ driver: 'Core growth', status: 'AT_RISK', evidence: 'Revenue fell 20%' }]
    } } });
    const health = assessThesisHealth({ stock, snapshots: [snapshot], filings: [later, older] });
    expect(health.fundamental.conviction).toBe(4);
    expect(health.fundamental.evidenceSignal).toBe('ADVERSE_RECORDED');
    expect(health.fundamental.drivers[0].status).toBe('AT_RISK');
  });

  it('withholds conviction for incomplete or unverified sources and includes new stocks outside rankings', () => {
    const incomplete = result({ event_analysis: { institutional_verdict: {
      conviction_score: 8, verified_financials: { isFinancialResult: true, isVerified: true },
      highlight_extraction: { status: 'INCOMPLETE' }
    } } });
    const report = buildThesisHealthReport({ stocks: [stock], snapshots: [], filings: [incomplete], reactions: [] });
    expect(report.stocks).toHaveLength(1);
    expect(report.stocks[0].fundamental.conviction).toBeNull();
    expect(report.stocks[0].fundamental.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(report.stocks[0].market.reactionStatus).toBe('UNAVAILABLE');
  });
});
