import { describe, it, expect } from 'vitest';
import { formatConcallHighlightsBlock, formatThesisDigestMessage } from '../services/thesis-digest.service.js';
import { formatAnnouncementMessage } from '../services/telegram.service.js';

describe('Telegram Formatting & Spacing Invariants', () => {
  it('does NOT aggressively clip bullet text at 150 characters in concall highlights', () => {
    const longGuidance = "By the end of this year, capacity utilization should reach approximately 55% as new customer validations for advanced shunt resistors convert into regular commercial dispatches across domestic smart meter projects.";
    expect(longGuidance.length).toBeGreaterThan(200);

    const item = {
      kind: 'CONCALL',
      title: 'Earnings Call',
      highlights: {
        annual_guidance: [longGuidance]
      }
    };

    const block = formatConcallHighlightsBlock(item, 'https://example.com/call.pdf');
    // Bullet should NOT be truncated with '…' at 150 chars
    expect(block).toContain(longGuidance);
  });

  it('provides clean vertical double-spacing between guidance bullets and sections', () => {
    const item = {
      kind: 'CONCALL',
      title: 'Earnings Call',
      highlights: {
        annual_guidance: [
          'FY27 revenue guidance targeted at 15% growth.',
          'FY27 blended EBITDA margin targeted at 20-21%.'
        ],
        key_challenges: [
          'US shunt revenue saw temporary geographic re-allocation.',
          'Input raw material alloy lead times lengthened slightly.'
        ]
      }
    };

    const block = formatConcallHighlightsBlock(item, 'https://example.com/call.pdf');
    // Sections should be separated by double newlines (\n\n)
    expect(block).toContain('*GUIDANCE & OUTLOOK*\n\n•');
    // Distinct bullets should have breathing room (\n\n)
    expect(block).toContain('FY27 revenue guidance targeted at 15% growth.\n\n• FY27 blended EBITDA margin targeted at 20-21%.');
  });

  it('formatAnnouncementMessage formats key details with clean vertical spacing', () => {
    const msg = formatAnnouncementMessage({
      ticker: 'SBCL',
      companyName: 'Shivalik Bimetal Controls Ltd',
      title: 'Earnings Call Transcript',
      summary: 'Delivered strong H1 performance with consolidated revenue up 39%. Operating leverage expanded EBITDA margins.',
      concall_type: 'transcript',
      concall_highlights: {
        annual_guidance: [
          'Targeting 55% capacity utilization by end of FY27.',
          'Busbar vertical expected to contribute 200 crores in FY28.'
        ]
      }
    });

    // Verify double newline separation
    expect(msg).toContain('Targeting 55% capacity utilization by end of FY27.\n\n• Busbar vertical expected to contribute ₹200 Cr in FY28.');
  });
});
