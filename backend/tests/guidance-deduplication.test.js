import { describe, it, expect } from 'vitest';
import { deduplicateGuidanceBullets, deduplicateCommitments } from '../services/guidance-dedup.service.js';

describe('Guidance & Commitment Deduplication', () => {
  it('deduplicates identical and near-identical guidance bullets with minor wording differences', () => {
    const rawBullets = [
      "Targeting top line growth of 15% approximately, somewhere between 1300 to ₹1350 Cr for FY27.",
      "Targeting top line growth of approximately 15%, between 1300 to ₹1350 Cr for FY27.",
      "Guiding for steady state EBITDA margin between 26 to 28%.",
      "Targeting a steady state EBITDA margin between 26 to 28% in FY27.",
      "Path towards ₹2,000 Cr in turnover in FY29 plus minus 100."
    ];

    const deduped = deduplicateGuidanceBullets(rawBullets);
    expect(deduped).toHaveLength(3);
    expect(deduped.some(b => b.includes("1300 to") && b.includes("1350"))).toBe(true);
    expect(deduped.some(b => b.includes("26 to 28%"))).toBe(true);
    expect(deduped.some(b => b.includes("2,000 Cr"))).toBe(true);
  });

  it('deduplicates structured commitment objects that target the same metric and number', () => {
    const commitments = [
      { metric: "Revenue", statement: "Targeting top line between 1300 to 1350 Cr", target_value: "1300 to 1350 crores", timeline: "FY27" },
      { metric: "Revenue", statement: "Targeting revenue between 1300 to 1350 Cr for FY27", target_value: "1300 to 1350 Crores", timeline: "FY27" },
      { metric: "EBITDA Margin", statement: "Steady state EBITDA margin 26 to 28%", target_value: "26% to 28%", timeline: "FY27" },
      { metric: "EBITDA Margin", statement: "Operating margin 26-28%", target_value: "26 to 28%", timeline: "FY27" }
    ];

    const deduped = deduplicateCommitments(commitments);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].metric).toBe("Revenue");
    expect(deduped[1].metric).toBe("EBITDA Margin");
  });
});
