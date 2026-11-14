import { describe, it, expect, vi } from "vitest";
import {
  splitTranscript,
  transcriptCoverage,
  createSourceManifest,
  resumeOrInitManifest,
  recordRangeResult,
  reconcileQualifyingAnswers,
  promoteExplicitForwardTargets
} from "../services/concall-highlights.service.js";

describe("Priority 1: Exhaustive Call and Deck Coverage", () => {
  const sentence = "The company delivered strong operational performance across key divisions. ";
  // Create an SBCL-length transcript (approx 65,200 chars) with structured analyst exchanges
  const buildSbclLengthTranscript = () => {
    let text = "Harshit Kapadia: Good day and welcome to the conference call. " + sentence.repeat(160) + "\n\n";
    // 14 analyst exchanges
    for (let i = 1; i <= 14; i++) {
      text += `Moderator: The next question is from the line of Analyst ${i} from Firm ${i}.\n`;
      text += `Analyst ${i}: Could you clarify performance in segment ${i}?\n`;
      if (i === 4) {
        text += `Analyst 4: We noticed US shunt revenue declined in the quarter.\n`;
        text += `Management: Yes, reported US shunt revenue declined.\n\n`;
      } else if (i === 12) {
        text += `Analyst 12: By year end, what will be our capacity utilisation?\n`;
        text += `Management: By the end of this year, capacity utilisation should be around 55%.\n\n`;
      } else if (i === 13) {
        text += `Analyst 13: Following up on the US shunt decline, can you give more color on customer demand?\n`;
        text += `Management: Actually, sales to US customers now ship directly to end users in Asia, so geographic revenue is showing up in Asia rather than lost customer demand.\n\n`;
      } else {
        text += `Management: ` + sentence.repeat(65) + `\n\n`;
      }
    }
    return text;
  };

  it("exhaustive splitTranscript covers all 65,000+ characters of an SBCL-length call without truncation", () => {
    const text = buildSbclLengthTranscript();
    expect(text.length).toBeGreaterThan(65000);

    const parts = splitTranscript(text, { exhaustive: true });
    // Must generate 4 parts so each is under 20,500 chars
    expect(parts.length).toBeGreaterThanOrEqual(4);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(20500);
      expect(p).not.toContain(" […] "); // no lossy trimming!
    }

    const coverage = transcriptCoverage(text, parts);
    expect(coverage.complete).toBe(true);
    expect(coverage.omittedChars).toBe(0);
    // Late Q&A content is retained
    const joined = parts.join("\n");
    expect(joined).toContain("capacity utilisation should be around 55%");
    expect(joined).toContain("sales to US customers now ship directly to end users in Asia");
  });

  it("reconcileQualifyingAnswers clarifies an apparent US shunt drag with late Q&A explanation", () => {
    const highlights = {
      key_challenges: [
        "US shunt revenue: declined in the quarter",
        "Raw material freight volatility"
      ]
    };
    const transcript = `
      Earlier: Analyst observed US shunt revenue declined.
      Late Q&A: Management clarified that sales to US customers now ship directly to end users in Asia, so geographic revenue is showing up in Asia.
    `;

    const reconciled = reconcileQualifyingAnswers(highlights, transcript);
    expect(reconciled.key_challenges[0]).toContain("Management clarified in Q&A");
    expect(reconciled.key_challenges[0]).toContain("shipments to US customers now deliver directly to Asian end users");
    // Unrelated challenge untouched
    expect(reconciled.key_challenges[1]).toBe("Raw material freight volatility");
  });

  it("persistent source manifest tracks ranges, supports resume on restart, and invalidates on changed hash", () => {
    const text = buildSbclLengthTranscript();
    const manifest = createSourceManifest({
      docText: text,
      attachmentUrl: "https://example.com/sbcl-transcript.pdf"
    });

    expect(manifest.sha256).toBeDefined();
    expect(manifest.ranges.length).toBeGreaterThanOrEqual(4);
    expect(manifest.status).toBe("IN_PROGRESS");
    expect(manifest.ranges[0].status).toBe("PENDING");

    // Complete part 0 and part 1
    recordRangeResult(manifest, 0, { key_positives: ["Positive 1"] });
    recordRangeResult(manifest, 1, { key_positives: ["Positive 2"] });
    expect(manifest.ranges[0].status).toBe("COMPLETE");
    expect(manifest.ranges[1].status).toBe("COMPLETE");
    expect(manifest.status).toBe("IN_PROGRESS");

    // Simulate restart: resume manifest with identical text
    const resumed = resumeOrInitManifest(manifest, {
      docText: text,
      attachmentUrl: "https://example.com/sbcl-transcript.pdf"
    });
    expect(resumed.ranges[0].status).toBe("COMPLETE");
    expect(resumed.ranges[0].result).toEqual({ key_positives: ["Positive 1"] });
    expect(resumed.ranges[1].status).toBe("COMPLETE");
    expect(resumed.ranges[2].status).toBe("PENDING");

    // Invalidate when text changes (e.g. revision)
    const modifiedText = text + " Extra updated addendum statement.";
    const fresh = resumeOrInitManifest(manifest, {
      docText: modifiedText,
      attachmentUrl: "https://example.com/sbcl-transcript.pdf"
    });
    expect(fresh.sha256).not.toBe(manifest.sha256);
    expect(fresh.ranges[0].status).toBe("PENDING");
    expect(fresh.ranges[0].result).toBeNull();
  });
});
