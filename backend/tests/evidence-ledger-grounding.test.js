import { describe, it, expect } from 'vitest';
import { splitSentencesWithOffsets, sanitizeConcallHighlights } from '../services/institutional-guard.service.js';
import { parseContexts } from '../services/xbrl/contextParser.js';

describe('Evidence Ledger & Sentence-Level Grounding (borrowed from earnings-analyser & earnings-call-analyst)', () => {
  const transcriptText = 
    "Good afternoon everyone. We are strengthening our presence in the hydrogen segment. " +
    "Further, we have secured an order worth INR2.5 crores from NTPC Limited for Type 4 composite hydrogen cylinder storage cascades. " +
    "Our team has been working across several other verticals. " +
    "Additionally, we have secured a significant order worth INR83 crores from a leading PSU for Type 4 composite CNG mobile storage cascades. " +
    "Management remains confident of achieving our long-term objectives.";

  it('splits text into deterministic sentences with exact character offsets', () => {
    const sentences = splitSentencesWithOffsets(transcriptText);
    expect(sentences.length).toBe(6);
    for (const s of sentences) {
      expect(transcriptText.slice(s.start, s.end)).toBe(s.text);
      expect(s.text.length).toBeGreaterThan(0);
    }
    expect(sentences[2].text).toContain('INR2.5 crores');
    expect(sentences[2].text).toContain('NTPC Limited');
    expect(sentences[4].text).toContain('INR83 crores');
    expect(sentences[4].text).toContain('leading PSU');
  });

  it('accepts claims whose figures and entities co-occur in the same sentence or window', () => {
    const validHighlights = {
      growth_initiatives: [
        "Order win: INR83 crores from a leading PSU for Type 4 composite CNG cascades",
        "Order win: INR2.5 crores from NTPC Limited for hydrogen cylinder storage"
      ]
    };
    const sanitized = sanitizeConcallHighlights(validHighlights, transcriptText, null);
    expect(sanitized.growth_initiatives).toHaveLength(2);
    expect(sanitized.growth_initiatives[0]).toContain("INR83 crores");
    expect(sanitized.growth_initiatives[1]).toContain("INR2.5 crores");
  });

  it('rejects cross-paragraph hallucinations fusing an entity from one turn with a number from another', () => {
    // Hallucination: Claims INR83 crores was from NTPC Limited (combines 83 Cr from para 4 with NTPC from para 2)
    const hallucinatedHighlights = {
      growth_initiatives: [
        "Order win: INR83 crores order from NTPC Limited for CNG storage"
      ]
    };
    const sanitized = sanitizeConcallHighlights(hallucinatedHighlights, transcriptText, null);
    expect(sanitized.growth_initiatives).toEqual([]);
  });
});

describe('XBRL Document Scope Resolution (borrowed from india-xbrl-filings)', () => {
  it('correctly assigns isConsolidated to base un-dimensioned contexts when filing is Consolidated', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
    <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:in-capmkt="http://www.sebi.gov.in/xbrl/2025-01-31">
      <in-capmkt:NatureOfReportStandaloneConsolidated>Consolidated</in-capmkt:NatureOfReportStandaloneConsolidated>
      <xbrli:context id="OneD">
        <xbrli:entity><xbrli:identifier scheme="http://www.bseindia.com">532839</xbrli:identifier></xbrli:entity>
        <xbrli:period>
          <xbrli:startDate>2026-04-01</xbrli:startDate>
          <xbrli:endDate>2026-06-30</xbrli:endDate>
        </xbrli:period>
      </xbrli:context>
    </xbrli:xbrl>`;

    const contexts = parseContexts(xml);
    expect(contexts.OneD).toBeDefined();
    expect(contexts.OneD.isConsolidated).toBe(true);
    expect(contexts.OneD.isStandalone).toBeFalsy();
  });
});
