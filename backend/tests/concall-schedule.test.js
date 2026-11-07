/**
 * JSLL 2026-11-05: the "concall scheduled" alert said "When: Thu, 05 Nov 2026 11:00 AM" while its own summary said 16-Nov: the
 * date picked was the LETTER's date (and an LLM hint was weighed as if it were text). The call is on Monday 16 November.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { extractConcallSchedule } from "../services/announcement.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const letter = fs.readFileSync(path.resolve(here, "fixtures/real-layouts/JSLL_concall-intimation_2026-11-05.txt"), "utf8");
const NOW = new Date("2026-11-05T11:30:00Z");

describe("extractConcallSchedule on the real JSLL intimation", () => {
  it("picks the call date (16 Nov, 11:00), not the letter date, the board-meeting date or the earlier intimation date", () => {
    const sch = extractConcallSchedule(`Analysts/Institutional Investor Meet/Con. Call Updates\n${letter}`, {}, NOW);
    expect(sch.date).toBe("2026-11-16");
    expect(sch.time).toBe("11:00");
  });

  it("a wrong date hint from the model does not override the date the document prints", () => {
    const sch = extractConcallSchedule(`Analysts/Institutional Investor Meet/Con. Call Updates\n${letter}`, { date: "2026-11-05", time: "11:00" }, NOW);
    expect(sch.date).toBe("2026-11-16");
  });

  it("the hint is still used when the document prints no date at all", () => {
    expect(extractConcallSchedule("Earnings call details in the attached letter", { date: "2026-11-10", time: "15:00" }, NOW).date).toBe("2026-11-10");
  });

  it("a plain '... conference call on 7th November 2026 at 4:00 PM' is read, and a 'Date:' header on the letter is ignored", () => {
    const sch = extractConcallSchedule("Date: 5th November, 2026\nThe Company will host an earnings conference call on 7th November 2026 at 4:00 PM IST.", {}, NOW);
    expect(sch.date).toBe("2026-11-07");
    expect(sch.time).toBe("16:00");
  });

  it("a letter that names only its own date and a board-meeting date has no call date", () => {
    const sch = extractConcallSchedule("Date: 5th November, 2026\nThe Board meeting will be held on 14th November, 2026 to consider the results.", {}, NOW);
    expect(sch.date).toBeNull();
  });
});
