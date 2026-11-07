/**
 * HBLENGINE Q2 FY27 alert: the signal was REASSESS THESIS 4/10 (the PAT-contraction gate overrode the model), but the model's own
 * summary, whose first two sentences go into the flash, ended "...a HOLD stance is warranted". Two opposite calls in one message.
 * A sentence that states a stance different from the final action is dropped.
 */
import { describe, it, expect } from "vitest";
import { dropContradictingStance } from "../services/institutional-guard.service.js";

const HBL = "HBL Engineering reported a significant YoY contraction in Q2 FY27, with consolidated revenue declining 28.73% YoY to ₹871.56 Cr and PAT falling 50.29% YoY to ₹192.51 Cr. Given the profit contraction and cash flow headwinds offsetting operational profitability, a HOLD stance is warranted.";

describe("dropContradictingStance", () => {
  it("drops the model's HOLD sentence when the final action is REASSESS (the real HBLENGINE summary)", () => {
    const out = dropContradictingStance(HBL, "REASSESS THESIS");
    expect(out).toContain("PAT falling 50.29%");
    expect(out).not.toMatch(/HOLD/);
  });
  it("keeps it when the final action agrees (HOLD / MONITOR, legacy HOLD wording)", () => {
    expect(dropContradictingStance(HBL, "HOLD / MONITOR")).toBe(HBL);
    expect(dropContradictingStance(HBL, "HOLD")).toBe(HBL);
  });
  it("buy / add / accumulate are one family, and reassess / trim / sell / exit another", () => {
    expect(dropContradictingStance("Margins held. We recommend BUY on valuation.", "ADD")).toBe("Margins held. We recommend BUY on valuation.");
    expect(dropContradictingStance("Margins held. We recommend BUY on valuation.", "TRIM")).toBe("Margins held.");
    expect(dropContradictingStance("Margins fell. The rating is SELL.", "HOLD / MONITOR")).toBe("Margins fell.");
    expect(dropContradictingStance("Margins fell. The call is to ACCUMULATE.", "REASSESS THESIS")).toBe("Margins fell.");
  });
  it("ordinary words are not stances: lower-case 'add capacity' or 'hold inventory' next to a REASSESS", () => {
    const t = "The company will add capacity and hold inventory at current levels. Orders signal weaker demand.";
    expect(dropContradictingStance(t, "REASSESS THESIS")).toBe(t);
  });
  it("no final action, no text, or nothing contradicting: unchanged; every sentence contradicting: empty", () => {
    expect(dropContradictingStance(HBL, null)).toBe(HBL);
    expect(dropContradictingStance("", "REASSESS THESIS")).toBe("");
    expect(dropContradictingStance(undefined, "REASSESS THESIS")).toBe("");
    expect(dropContradictingStance("A HOLD stance is warranted.", "REASSESS THESIS")).toBe("");
  });
});
