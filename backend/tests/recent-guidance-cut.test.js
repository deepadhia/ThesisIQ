/**
 * SJS 2026-11-04/05: management cut its revenue growth guide (1.5-2x -> 1.2-1.5x) on the call, and the results alert for the same
 * quarter still said STRONG BUY 9/10. A cut on the call vetoed a buy only on the call's own filing. A cut stated in the last 21 days
 * (call, recording, deck of the same stock) must veto a buy on whatever is judged next, unless a NEWER change raised the guide.
 */
import { describe, it, expect } from "vitest";
import { recentGuidanceVeto } from "../services/thesis-digest.service.js";

const CUT = "Revenue growth outlook: 1.5 to 2 times industry growth -> 1.2 to 1.5 times (cut), due to the global macro environment";
const RAISE = "EBITDA margin guidance: 27-28% -> 29-30% (raised), on cost efficiencies";
const REAFFIRM = "Capex plan of Rs. 2700 to 2850 million (reaffirmed)";

describe("recentGuidanceVeto (changes listed newest first)", () => {
  it("a recent cut downgrades a buy to HOLD / MONITOR, conviction at most 5, and names the cut", () => {
    const v = recentGuidanceVeto({ action: "STRONG BUY", conviction: 9, changes: [CUT] });
    expect(v.vetoed).toBe(true);
    expect(v.action).toBe("HOLD / MONITOR");
    expect(v.conviction).toBe(5);
    expect(v.cut).toContain("1.2 to 1.5 times");
  });
  it("every buy wording is covered (BUY, ADD, ACCUMULATE, STRONG BUY, BUY / ACCUMULATE)", () => {
    for (const action of ["BUY", "ADD", "ACCUMULATE", "STRONG BUY", "BUY / ACCUMULATE", "ADD 8/10"]) {
      expect(recentGuidanceVeto({ action, conviction: 8, changes: [CUT] }).vetoed, action).toBe(true);
    }
  });
  it("a hold, a reassess or no action is left alone: the veto only ever downgrades a buy", () => {
    for (const action of ["HOLD / MONITOR", "REASSESS THESIS", "TRIM", null, undefined, ""]) {
      expect(recentGuidanceVeto({ action, conviction: 4, changes: [CUT] }).vetoed, String(action)).toBe(false);
    }
  });
  it("no cut, only raises and reaffirmations: nothing happens", () => {
    expect(recentGuidanceVeto({ action: "BUY", conviction: 8, changes: [RAISE, REAFFIRM] }).vetoed).toBe(false);
    expect(recentGuidanceVeto({ action: "BUY", conviction: 8, changes: [] }).vetoed).toBe(false);
    expect(recentGuidanceVeto({ action: "BUY", conviction: 8, changes: undefined }).vetoed).toBe(false);
  });
  it("a NEWER raise cancels an older cut; a newer cut beats an older raise", () => {
    expect(recentGuidanceVeto({ action: "BUY", conviction: 8, changes: [RAISE, CUT] }).vetoed).toBe(false);
    expect(recentGuidanceVeto({ action: "BUY", conviction: 8, changes: [CUT, RAISE] }).vetoed).toBe(true);
  });
  it("a conviction already at or below 5 is not raised by the veto", () => {
    expect(recentGuidanceVeto({ action: "BUY", conviction: 3, changes: [CUT] }).conviction).toBe(3);
  });
});
