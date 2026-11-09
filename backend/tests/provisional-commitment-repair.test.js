import { describe, expect, it } from 'vitest';
import { isProvisionalOwnershipCommitment } from '../scripts/repair-provisional-commitments.js';

describe('source-backed provisional commitment repair', () => {
  const commitment = { status: 'Achieved', statement: 'Board approved acquisition of 49% equity stake in a 990 MW solar portfolio', target_value: '49% stake in 990 MW' };
  const first = 'The board approved the proposed acquisition of a 49% equity stake in a 990 MW solar portfolio, subject to requisite approvals and agreed conditions.';
  const latest = 'The proposed acquisition of a 49% stake in the 990 MW portfolio remains subject to approvals.';
  it('identifies the same proposed action in two dated sources', () => {
    expect(isProvisionalOwnershipCommitment(commitment, first, latest)).toBe(true);
  });
  it('refuses a different transaction or a confirmed closing', () => {
    expect(isProvisionalOwnershipCommitment(commitment, first, 'A proposed acquisition of 30% in another portfolio remains subject to approvals.')).toBe(false);
    expect(isProvisionalOwnershipCommitment(commitment, first, 'The acquisition of the 49% stake in the 990 MW portfolio has been completed.')).toBe(false);
  });
});
