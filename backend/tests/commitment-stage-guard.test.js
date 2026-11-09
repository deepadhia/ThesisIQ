import { describe, expect, it } from 'vitest';
import { applyInstitutionalGuard } from '../services/institutional-guard.service.js';

describe('multi-stage corporate action commitments', () => {
  const guard = (commitment, title) => applyInstitutionalGuard({ commitments: [commitment] }, null, title, 'EXAMPLE').commitments[0];

  it('keeps an approved but proposed stake purchase pending even when capacity is mentioned', () => {
    const commitment = {
      statement: 'Board approved proposed acquisition of 49% equity stake in a 990 MW solar portfolio, subject to approvals',
      metric: 'Equity Stake Acquisition', timeline: 'FY27 onwards', status: 'Achieved',
      status_rule: 'prompt instruction that must never be stored'
    };
    const result = guard(commitment, 'Press Release');
    expect(result.status).toBe('Pending');
    expect(result).not.toHaveProperty('status_rule');
  });
  it('allows a filing that explicitly confirms completion to retain Achieved', () => {
    const result = guard({ statement: 'Completed acquisition of the equity stake after all conditions were satisfied', metric: 'Acquisition', status: 'Achieved', timeline: 'FY27' }, 'Completion of acquisition');
    expect(result.status).toBe('Achieved');
  });
  it('does not infer ahead-of-schedule delivery from a future target year alone', () => {
    const result = guard({ statement: 'Target to reach 20% EBITDA margin', metric: 'EBITDA Margin', status: 'Achieved', timeline: 'FY28' }, 'Investor Presentation');
    expect(result.status).toBe('Pending');
  });
});
