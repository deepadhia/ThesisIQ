import { describe, it, expect } from "vitest";
import { buildEarningsCalendarMessage, shortCompanyName } from "../services/earnings-calendar.service.js";

const e = (ticker, diffDays, extra = {}) => ({ ticker, company: `${ticker} Ltd`, resultDate: "2026-11-07", diffDays, resultsPublished: false, concallAnalysed: false, ...extra });

describe("one earnings-calendar message a day (2026-11-03..05 sent a separate message per stock at 3 days, 1 day, 0 days, +1 and +3)", () => {
  it("lists today, tomorrow and in-3-days results in ONE message", () => {
    const msg = buildEarningsCalendarMessage([e("SBCL", 0), e("SJS", 0), e("TIMETECHNO", 1), e("HBLENGINE", 3)], { todayYmd: "2026-11-04" });
    expect(msg.match(/EARNINGS CALENDAR/g)).toHaveLength(1);
    expect(msg).toContain("Reports today:* SBCL, SJS");
    expect(msg).toContain("Tomorrow:* TIMETECHNO");
    expect(msg).toContain("In 3 days (07 Nov):* HBLENGINE");
  });

  it("a stock whose results are already out is not announced as upcoming", () => {
    expect(buildEarningsCalendarMessage([e("SBCL", 0, { resultsPublished: true })])).toBeNull();
  });

  it("after results, only a stock whose concall has NOT been analysed is listed (the old '+1 day: review the flash note' message had no content)", () => {
    const msg = buildEarningsCalendarMessage([
      e("SBCL", -1, { resultsPublished: true, concallAnalysed: true, resultDate: "2026-11-04" }),
      e("JYOTICNC", -2, { resultsPublished: true, concallAnalysed: false, resultDate: "2026-11-03" })
    ]);
    expect(msg).toContain("concall not analysed yet:* JYOTICNC (03 Nov)");
    expect(msg).not.toContain("SBCL");
  });

  it("nothing to say means no message at all", () => {
    expect(buildEarningsCalendarMessage([])).toBeNull();
    expect(buildEarningsCalendarMessage([e("X", 2), e("Y", -7, { resultsPublished: true })])).toBeNull();
  });

  it("company names lose the 'Ltd' and the screener's 'share price' suffix, and a name equal to the ticker is dropped", () => {
    expect(shortCompanyName("Shivalik Bimetal Controls Ltd share price", "SBCL")).toBe("Shivalik Bimetal Controls");
    expect(shortCompanyName("Time Technoplast Limited", "TIMETECHNO")).toBe("Time Technoplast");
    expect(shortCompanyName("SBCL", "SBCL")).toBe("");
  });
});

describe("what was folded instead of sent is listed in the daily calendar message (so nothing disappears silently)", () => {
  const folded = [
    { ticker: "SJS", title: "Press Release", url: "https://example.test/sjs-pr.pdf", reason: "press release only restates the results already alerted; nothing new to report" },
    { ticker: "SJS", title: "Analysts/Institutional Investor Meet/Con. Call Updates", url: null, reason: "the written transcript repeats the recording write-up already sent for this call (no new figure)" }
  ];
  it("adds one compact line per stock to a calendar message that is being sent anyway", () => {
    const msg = buildEarningsCalendarMessage([e("TIMETECHNO", 1)], { todayYmd: "2026-11-05", folded });
    expect(msg).toContain("Folded");
    expect(msg).toContain("SJS");
    expect(msg.match(/SJS/g).length).toBe(1);   // one stock, one mention
    expect(msg).toContain("press release");
    expect(msg).toContain("transcript");
  });
  it("never creates a message of its own: a quiet day with folded items stays silent", () => {
    expect(buildEarningsCalendarMessage([], { todayYmd: "2026-11-05", folded })).toBeNull();
  });
  it("is unchanged when nothing was folded", () => {
    const a = buildEarningsCalendarMessage([e("TIMETECHNO", 1)], { todayYmd: "2026-11-05" });
    const b = buildEarningsCalendarMessage([e("TIMETECHNO", 1)], { todayYmd: "2026-11-05", folded: [] });
    expect(a).toBe(b);
    expect(a).not.toContain("Folded");
  });
});
