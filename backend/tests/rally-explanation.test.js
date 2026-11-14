import { describe, it, expect } from "vitest";
import {
  classifyRallyOrReaction,
  detectRallyCooling,
  filterValidCandidateCatalysts
} from "../services/rally-explanation.service.js";

describe("Priority 3: Post-Disclosure Reaction and Rally Explanation", () => {
  const publishedAt = "2026-11-05T18:14:00+05:30";

  it("labels THESIS_PROGRESS_WITH_PRICE_CONFIRMATION when thesis progresses and market confirms with excess returns", () => {
    const thesisAssessment = {
      progressState: "PROGRESSING",
      confirmedDrivers: ["Order Book expansion to ₹2,849 Cr", "Revenue +22.5% YoY"],
      atRiskDrivers: []
    };
    const priceReaction = {
      status: "OBSERVED",
      latest: { returnPct: 7.5, excessReturnPp: 6.2 },
      firstRelativeVolume: 2.4,
      windows: {
        D1: { returnPct: 4.5, excessReturnPp: 3.8, status: "OBSERVED" },
        D3: { returnPct: 7.5, excessReturnPp: 6.2, status: "OBSERVED" }
      }
    };
    const events = [
      { publishedAt: "2026-11-05T18:00:00+05:30", title: "Q2 FY27 Financial Results", category: "QUARTERLY_EARNINGS" }
    ];

    const result = classifyRallyOrReaction({
      publishedAt,
      thesisAssessment,
      priceReaction,
      candidateEvents: events
    });

    expect(result.label).toBe("THESIS_PROGRESS_WITH_PRICE_CONFIRMATION");
    expect(result.thesisProgress).toBe(true);
    expect(result.coolingDetected).toBe(false);
    expect(result.explanation).toContain("Fundamental progress confirmed by market performance");
  });

  it("detects rally cooling when a post-filing surge persistent peak draws down across sessions", () => {
    const priceReaction = {
      status: "OBSERVED",
      latest: { returnPct: 1.2, excessReturnPp: 0.5 },
      windows: {
        D1: { returnPct: 8.5, excessReturnPp: 7.2, status: "OBSERVED" },
        D3: { returnPct: 1.2, excessReturnPp: 0.5, status: "OBSERVED" }
      }
    };

    const cooling = detectRallyCooling(priceReaction);
    expect(cooling.coolingDetected).toBe(true);
    expect(cooling.peakReturnPct).toBe(8.5);
    expect(cooling.currentReturnPct).toBe(1.2);
    expect(cooling.drawdownPp).toBeCloseTo(7.3, 1);
  });

  it("labels THESIS_PROGRESS_PRICE_UNCONFIRMED when fundamentals progress but market reaction cools or is flat", () => {
    const thesisAssessment = {
      progressState: "PROGRESSING",
      confirmedDrivers: ["Revenue +35% YoY", "PAT +50% YoY"],
      atRiskDrivers: []
    };
    const priceReaction = {
      status: "OBSERVED",
      latest: { returnPct: 0.5, excessReturnPp: -0.8 },
      windows: {
        D1: { returnPct: 5.0, excessReturnPp: 4.2, status: "OBSERVED" },
        D3: { returnPct: 0.5, excessReturnPp: -0.8, status: "OBSERVED" }
      }
    };

    const result = classifyRallyOrReaction({
      publishedAt,
      thesisAssessment,
      priceReaction,
      candidateEvents: []
    });

    expect(result.label).toBe("THESIS_PROGRESS_PRICE_UNCONFIRMED");
    expect(result.thesisProgress).toBe(true);
    expect(result.coolingDetected).toBe(true);
  });

  it("labels PRICE_MOVE_WITHOUT_VERIFIED_CATALYST when stock rallies sharply without verifiable thesis progress", () => {
    const thesisAssessment = {
      progressState: "NO_EVIDENCE",
      confirmedDrivers: [],
      atRiskDrivers: []
    };
    const priceReaction = {
      status: "OBSERVED",
      latest: { returnPct: 11.2, excessReturnPp: 9.8 },
      windows: {
        D1: { returnPct: 11.2, excessReturnPp: 9.8, status: "OBSERVED" }
      }
    };

    const result = classifyRallyOrReaction({
      publishedAt,
      thesisAssessment,
      priceReaction,
      candidateEvents: []
    });

    expect(result.label).toBe("PRICE_MOVE_WITHOUT_VERIFIED_CATALYST");
    expect(result.thesisProgress).toBe(false);
  });

  it("filters candidate catalysts to strictly exclude events published AFTER the measured move", () => {
    const moveStartTime = new Date("2026-11-05T09:15:00+05:30");
    const moveEndTime = new Date("2026-11-05T15:30:00+05:30");

    const events = [
      { title: "Morning Results Intimation", publishedAt: "2026-11-05T08:30:00+05:30" }, // VALID
      { title: "Evening Order Filing", publishedAt: "2026-11-05T18:14:00+05:30" },       // AFTER MARKET: INVALID
      { title: "Next Day Concall Transcript", publishedAt: "2026-11-06T11:00:00+05:30" } // NEXT DAY: INVALID
    ];

    const valid = filterValidCandidateCatalysts(events, moveEndTime);
    expect(valid).toHaveLength(1);
    expect(valid[0].title).toBe("Morning Results Intimation");
  });
});
