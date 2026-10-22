import { describe, test, expect } from 'vitest';
import { classifyFilingForWorker, classifyFilingCategory } from '../services/filing-classifier.service.js';
import { formatAnnouncementMessage } from '../services/telegram.service.js';

describe('Unified Filing Classifier & Dead-Letter Invariant Tests', () => {

  // Test 1: Elecon Case Study (Transcript mentioning audio recording disclaimer must NEVER be routed to audio)
  test('ELECON Transcript with audio disclaimer must classify as STAGE_2_TRANSCRIPT and NOT audio', () => {
    const title = "Analysts/Institutional Investor Meet/Con. Call Updates";
    const attachmentUrl = "https://nsearchives.nseindia.com/corporate/ELECON2_22102026160938_CallTranscript.pdf";
    const docText = `
      ELECON ENGINEERING COMPANY LIMITED
      Transcript of the Conference Call held on Thursday, October 15, 2026.
      Disclaimer: Please note that the audio recording uploaded on October 15, 2026 will prevail in case of any discrepancy.
      Management participants: Mr. Prayasvin Patel - Chairman & Managing Director.
      Moderator: Ladies and gentlemen, good day and welcome to the Elecon Q2 FY27 earnings conference call.
    `;

    const res = classifyFilingForWorker({
      title,
      attachmentUrl,
      docText,
      filingCategory: "QUARTERLY_EARNINGS",
      deepDiveStatus: "pending_stage2"
    });

    expect(res.isTranscript).toBe(true);
    expect(res.isAudio).toBe(false);
    expect(res.stage).toBe("STAGE_2_TRANSCRIPT");
    expect(res.isRoutine).toBe(false);
  });

  // Test 2: HSCL Case Study (Audio recording filing with MP3 link must classify as STAGE_2_AUDIO)
  test('HSCL Audio Recording filing with MP3 link must classify as STAGE_2_AUDIO and extract audioUrl', () => {
    const title = "Analysts/Institutional Investor Meet/Con. Call Updates";
    const attachmentUrl = "https://nsearchives.nseindia.com/corporate/HSCL_22102026215045_EarningsrecordingQ2FY27.pdf";
    const docText = `
      Himadri Speciality Chemical Limited
      Sub: Link of audio recording of the Earnings Conference Call for the second quarter ended September 30, 2026.
      Pursuant to Regulation 30 of SEBI LODR, the audio recording can be accessed at:
      https://himadri.com/pdf/Himadri_Q2_FY27_Concall.mp3
    `;

    const res = classifyFilingForWorker({
      title,
      attachmentUrl,
      docText,
      filingCategory: "QUARTERLY_EARNINGS",
      deepDiveStatus: "pending_audio"
    });

    expect(res.isAudio).toBe(true);
    expect(res.isTranscript).toBe(false);
    expect(res.stage).toBe("STAGE_2_AUDIO");
    expect(res.audioUrl).toBe("https://himadri.com/pdf/Himadri_Q2_FY27_Concall.mp3");
    expect(res.isRoutine).toBe(false);
  });

  // Test 3: Audio Candidate without Media URL must NOT discard document (failsafe)
  test('Audio filing candidate without media URL must NOT claim isAudio=true, allowing document fallback', () => {
    const title = "Analysts/Institutional Investor Meet/Con. Call Updates";
    const attachmentUrl = "https://nsearchives.nseindia.com/corporate/notice.pdf";
    const docText = `
      Outcome of conference call meeting. (No media URL provided).
      Total Revenue from Operations: ₹1,500 Cr.
    `;

    const res = classifyFilingForWorker({
      title,
      attachmentUrl,
      docText,
      filingCategory: "QUARTERLY_EARNINGS",
      deepDiveStatus: "pending_audio"
    });

    expect(res.isAudio).toBe(false);
    expect(res.audioUrl).toBeNull();
  });

  // Test 4: Gravita Case Study (Intimation of upcoming concall must classify as ROUTINE_COMPLIANCE)
  test('Routine concall schedule intimation must classify as ROUTINE_COMPLIANCE', () => {
    const title = "Analysts/Institutional Investor Meet/Con. Call Updates";
    const attachmentUrl = "https://nsearchives.nseindia.com/corporate/GRAVITA_22102026205318_IntimationFINAL28102026.pdf";
    const docText = `
      Gravita India Limited
      Sub: Intimation of schedule of Analyst / Institutional Investor Meet under Regulation 30 of SEBI LODR.
      We wish to inform that the company will hold a conference call on Wednesday, 28th October, 2026 at 3:00 PM IST
      to discuss Q2 FY27 financial results.
    `;

    const res = classifyFilingForWorker({
      title,
      attachmentUrl,
      docText,
      filingCategory: "ROUTINE_COMPLIANCE",
      deepDiveStatus: "not_required"
    });

    expect(res.isRoutine).toBe(true);
    expect(res.isTranscript).toBe(false);
    expect(res.isAudio).toBe(false);
    expect(res.stage).toBe("ROUTINE_COMPLIANCE");
  });

  // Test 5: Core Financial Results Board Outcome must classify as STAGE_1_RESULTS
  test('Financial Results Outcome of Board Meeting must classify as STAGE_1_RESULTS', () => {
    const title = "Outcome of Board Meeting";
    const attachmentUrl = "https://nsearchives.nseindia.com/corporate/Results_Q2.pdf";
    const docText = `
      Outcome of Board Meeting held on October 16, 2026.
      Approved the Unaudited Standalone and Consolidated Financial Results for the quarter and half year ended September 30, 2026.
      Total Revenue from Operations: ₹1,691.43 Crores.
      Net Profit: ₹239.77 Crores.
    `;

    const res = classifyFilingForWorker({
      title,
      attachmentUrl,
      docText,
      filingCategory: "QUARTERLY_EARNINGS",
      deepDiveStatus: "pending_stage1"
    });

    expect(res.isResults).toBe(true);
    expect(res.stage).toBe("STAGE_1_RESULTS");
    expect(res.isRoutine).toBe(false);
  });

  // Test 6: Filing category for HSCL Earnings Recording PDF must be QUARTERLY_EARNINGS, not routine
  test('classifyFilingCategory recognizes Earningsrecording PDF filename as QUARTERLY_EARNINGS', () => {
    const title = "Analysts/Institutional Investor Meet/Con. Call Updates";
    const attachmentUrl = "https://nsearchives.nseindia.com/corporate/HSCL_22102026215045_EarningsrecordingQ2FY27.pdf";
    const category = classifyFilingCategory(title, "", attachmentUrl);
    expect(category).toBe("QUARTERLY_EARNINGS");
  });

  // Test 7: Telegram alert formatting renders rich concall guidance, capacity, and margins
  test('formatAnnouncementMessage renders all concall sections when audio_analysis is passed', () => {
    const msg = formatAnnouncementMessage({
      ticker: "HSCL",
      title: "Analysts/Institutional Investor Meet/Con. Call Updates",
      priority: "HIGH",
      impact: "POSITIVE",
      summary: "Himadri reported strong operational performance.",
      concall_type: "audio",
      audio_analysis: {
        commitments: [
          { statement: "Targeting revenue of ₹11,000 Cr by FY28", metric: "Revenue", target_value: "₹11,000 Cr", timeline: "FY28" }
        ],
        capacity_and_utilization: "Coal Tar Distillation capacity running at 88-95% utilization.",
        margin_and_cost_dynamics: "Coal tar input cost pass-through lag of 1-2 quarters.",
        qa_highlights: [
          { analyst_or_shareholder: "Philip Capital", question: "Gross margin lag?", management_answer: "Sequential margins are stable." }
        ],
        catalysts: [
          "Commercial commissioning of 5,300 MT anode plant in Q3 FY27."
        ]
      }
    });

    expect(msg).toContain("Forward Guidance & Commitments:");
    expect(msg).toContain("₹11,000 Cr");
    expect(msg).toContain("Capacity & Operational Run-Rate:");
    expect(msg).toContain("Margin & Cost Dynamics:");
    expect(msg).toContain("Key Management Q&A Insights:");
    expect(msg).toContain("Strategic Catalysts:");
  });

});
