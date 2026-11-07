/**
 * MOREPENLAB filed its Q2 results on 2026-10-27 as four copies ("Outcome of Board Meeting" on NSE: GOVERNANCE_RISK; three BSE copies
 * titled "Financial Results" / "Board Meeting Outcome": GENERAL). Every copy was marked `not_required`, so the worker never read the
 * statement (revenue +81%, profit +117%) and the stock never had a results alert with verified numbers. The same happened to
 * LUMAXTECH (RESTRUCTURING) and QPOWER (CAPITAL_RAISE) in the previous quarter. A results outcome is now recognised from its own
 * title and letter, whatever category the AI classifier picked.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { isResultsOutcomeFiling } from "../services/filing-classifier.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => fs.readFileSync(path.resolve(here, "fixtures/real-layouts", n), "utf8");
const OUTCOME = fx("MOREPENLAB_outcome-letter_2026-10-27.txt");
const INTIMATION = fx("MOREPENLAB_board-intimation_2026-10-22.txt");

describe("a results outcome is recognised from its title and letter", () => {
  it("the real MOREPENLAB outcome letter, under every title it was filed with", () => {
    for (const title of ["Outcome of Board Meeting", "Board Meeting Outcome for Q2 & H1 FY27 Financial Results", "Q2 & H1 FY27 Financial Results", "Results-Financial Results For The Quarter & Half Year Ended 30Th September, 2026."]) {
      expect(isResultsOutcomeFiling({ title, text: OUTCOME }), title).toBe(true);
    }
  });

  it("a board-meeting INTIMATION (the date of the meeting) is not a results filing", () => {
    expect(isResultsOutcomeFiling({ title: "Board Meeting Intimation for  Q-2 FY27 Financial Results", text: INTIMATION })).toBe(false);
    expect(isResultsOutcomeFiling({ title: "Outcome of Board Meeting", text: INTIMATION })).toBe(false);   // even under a misleading title the letter only gives a date
  });

  it("a board outcome that is about something else is not queued as results", () => {
    const fundRaise = "Subject: Outcome of Board Meeting. The Board of Directors approved the issue of non-convertible debentures aggregating to Rs 200 crore and the appointment of an independent director. The meeting concluded at 4 pm.";
    expect(isResultsOutcomeFiling({ title: "Outcome of Board Meeting", text: fundRaise })).toBe(false);
  });

  it("newspaper copies, presentations, press releases, call notices, AGM and voting results are left to their own routes", () => {
    for (const title of ["Copy of Newspaper Publication", "Investor Presentation", "Press Release", "Analysts/Institutional Investor Meet/Con. Call Updates", "Announcement under Regulation 30 (LODR)-Earnings Call Transcript", "Voting results of AGM", "Trading Window Closure"]) {
      expect(isResultsOutcomeFiling({ title, text: OUTCOME }), title).toBe(false);
    }
  });

  it("a results title whose letter text is missing is still recognised by the title alone only when it names the results", () => {
    expect(isResultsOutcomeFiling({ title: "Unaudited Financial Results for the quarter ended September 30, 2026", text: "" })).toBe(false);   // no letter, no evidence: left to the AI category
    expect(isResultsOutcomeFiling({ title: "Unaudited Financial Results for the quarter ended September 30, 2026", text: "Statement of Unaudited Consolidated Financial Results for the quarter ended September 30, 2026 Revenue from operations 746.03 Profit for the period 38.51" })).toBe(true);
  });
});
