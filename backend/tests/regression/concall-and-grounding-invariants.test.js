import { describe, test, expect } from 'vitest';
import { applyInstitutionalGuard } from '../../services/institutional-guard.service.js';
import { getConcallType } from '../../services/announcement.service.js';

describe('Regression & Invariant Tests: Concall Routing, Grounding Guard & Pipeline Invariants', () => {

  // ✅ TEST 1: Concall LODR Circular Titles Must Be Recognized
  test('LODR standardized title "Analysts/Institutional Investor Meet/Con. Call Updates" must classify as concall', () => {
    const title = "Analysts/Institutional Investor Meet/Con. Call Updates";
    const audioText = "Link of audio recording of the Earnings Conference Call for Q2 FY27: https://www.example.com/audio.mp3";
    const transcriptText = "Transcript of the Earnings Conference Call held on October 16, 2026";

    expect(getConcallType(title, audioText)).toBe('audio');
    expect(getConcallType(title, transcriptText)).toBe('transcript');
  });

  // ✅ TEST 2: Sanitize LLM Output Drops Hallucinated Commitments (e.g. COVID-19 or Prompt Leaks)
  test('applyInstitutionalGuard must suppress hallucinated commitments and prompt leak tokens', () => {
    const mockDocText = `
      CCL Products (India) Limited
      Consolidated Financial Results for the Quarter ended September 30, 2026.
      Total Revenue from Operations: ₹1,210.76 Crores.
      Net Profit for the period: ₹130.09 Crores.
      Management targets 15% volume growth for FY27.
    `;

    const rawVerdict = {
      _raw_text: mockDocText,
      commitments: [
        {
          statement: "Management guided for 15% volume growth for FY27",
          metric: "Volume",
          target_value: "15%",
          timeline: "FY27",
          status: "Pending"
        },
        {
          statement: "EBITDA margin expansion of 100-150 bps YoY for next quarter amid COVID-19 pandemic",
          metric: "EBITDA margin",
          target_value: "100-150 bps",
          timeline: "Q3 FY27",
          status: "Pending",
          evidence_summary: "Concerns about margin compression and the impact of the COVID-19 pandemic on the business."
        },
        {
          statement: "Expanded capacity by +70% in Silvassa plant",
          metric: "Capacity",
          target_value: "+70%",
          timeline: "FY27",
          status: "Achieved"
        },
        {
          statement: "Targeting revenue of ₹9,850 Cr by FY28", // Ungrounded number 9,850 not in docText
          metric: "Revenue",
          target_value: "₹9,850 Cr",
          timeline: "FY28",
          status: "Pending"
        }
      ]
    };

    const guarded = applyInstitutionalGuard(rawVerdict, null, "Outcome of Board Meeting", "CCL");

    // Must keep the verified grounded commitment
    expect(guarded.commitments.length).toBe(1);
    expect(guarded.commitments[0].statement).toContain("15% volume growth");

    // Must drop the COVID-19 hallucination
    const hasCovid = guarded.commitments.some(c => (c.statement + (c.evidence_summary || '')).toLowerCase().includes("covid-19"));
    expect(hasCovid).toBe(false);

    // Must drop prompt leak template phrase ("Silvassa")
    const hasSilvassa = guarded.commitments.some(c => c.statement.toLowerCase().includes("silvassa"));
    expect(hasSilvassa).toBe(false);

    // Must drop ungrounded number ("9,850")
    const hasUngroundedNum = guarded.commitments.some(c => c.statement.includes("9,850"));
    expect(hasUngroundedNum).toBe(false);
  });

  // ✅ TEST 3: Grounded Operational Commitments with Valid Dates Pass Cleanly
  test('applyInstitutionalGuard preserves fully grounded management commitments', () => {
    const rawDocText = "The company expects to commission the 6,000 MT freeze-dried coffee plant by Q4 FY27.";
    const rawVerdict = {
      _raw_text: rawDocText,
      commitments: [
        {
          statement: "Commission 6,000 MT freeze-dried coffee plant by Q4 FY27",
          metric: "Capacity",
          target_value: "6,000 MT",
          timeline: "Q4 FY27",
          status: "Pending"
        }
      ]
    };

    const guarded = applyInstitutionalGuard(rawVerdict, null, "Concall Transcript", "CCL");
    expect(guarded.commitments.length).toBe(1);
    expect(guarded.commitments[0].statement).toBe("Commission 6,000 MT freeze-dried coffee plant by Q4 FY27");
  });

});
