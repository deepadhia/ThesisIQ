/**
 * The allocation gate for the scanner's direct alerts, as a unit (it used to be inline in scan(), with no test and never seen on a
 * real filing). Pure: the market-cap lookup and the amount estimate are injected.
 */
import { describe, it, expect, vi } from "vitest";
import { decideDirectAlertGate } from "../services/direct-alert-gate.service.js";

const base = (o = {}) => ({
  shouldHaveAlerted: true, isDuplicateEvent: false, isConcallScheduleAlert: false, gateEnabled: true,
  ticker: "SJS", title: "Bagging/Receiving of orders/contracts", filingCategory: "ORDER_WIN",
  aiResult: { priority: "MEDIUM", impact: "POSITIVE", summary: "Order received. Execution over 18 months." },
  announcementText: "Order worth Rs 60 crore received.", eventAnalysis: null,
  getMarketCapCr: async () => 7000, estimateAmountCr: () => 60, ...o
});

describe("decideDirectAlertGate", () => {
  it("a small order is boarded: no push, and the row gets its board record (no stance) merged into the existing event analysis", async () => {
    const r = await decideDirectAlertGate(base({ eventAnalysis: { order_value: "60" } }));
    expect(r.boarded).toBe(true);
    expect(r.eventAnalysis.order_value).toBe("60");
    expect(r.eventAnalysis.board_pending).toBe(true);
    expect(r.eventAnalysis.board_item).toMatchObject({ ticker: "SJS", kinds: ["ORDER_WIN"], stance: null });
    expect(r.eventAnalysis.board_item.gist).toMatch(/0\.9% of market cap/);
    expect(r.eventAnalysis.board_item.gist).toMatch(/Order received\./);
    expect(r.eventAnalysis.board_item.gist).not.toMatch(/Execution over/);   // first sentence only
  });

  it("a material order is pushed (not boarded) and the event analysis is untouched", async () => {
    const ea = { x: 1 };
    const r = await decideDirectAlertGate(base({ estimateAmountCr: () => 400, eventAnalysis: ea }));
    expect(r.boarded).toBe(false);
    expect(r.eventAnalysis).toBe(ea);
  });

  it("structural events always push, routine filings are boarded", async () => {
    expect((await decideDirectAlertGate(base({ filingCategory: "CAPITAL_RAISE", title: "QIP" }))).boarded).toBe(false);
    const routine = await decideDirectAlertGate(base({ filingCategory: "ROUTINE_COMPLIANCE", title: "Compliance certificate", aiResult: { priority: "MEDIUM", impact: "NEUTRAL", summary: "Certificate filed." } }));
    expect(routine.boarded).toBe(true);
    expect(routine.eventAnalysis.board_item.kinds).toEqual(["ROUTINE_COMPLIANCE"]);
  });

  it("when the market cap cannot be read the alert is PUSHED, never hidden", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await decideDirectAlertGate(base({ getMarketCapCr: async () => { throw new Error("db down"); } }));
    expect(r.boarded).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is a no-op when the kill switch is off, for a duplicate, and when nothing was going to be alerted", async () => {
    for (const o of [{ gateEnabled: false }, { isDuplicateEvent: true }, { shouldHaveAlerted: false }]) {
      const r = await decideDirectAlertGate(base(o));
      expect(r.boarded, JSON.stringify(o)).toBe(false);
    }
  });

  it("an unknown market cap (no snapshot) is not guessed: a medium order of any size is boarded, a HIGH one is pushed", async () => {
    expect((await decideDirectAlertGate(base({ getMarketCapCr: async () => null }))).boarded).toBe(true);
    expect((await decideDirectAlertGate(base({ getMarketCapCr: async () => null, aiResult: { priority: "HIGH", impact: "POSITIVE", summary: "Big order." } }))).boarded).toBe(false);
  });

  describe("concall-date heads-up (8 of the last 22 genuine direct alerts: one message per stock per quarter that says only when a call is)", () => {
    const NOW = Date.parse("2026-11-05T10:00:00+05:30");
    const call = (o = {}) => base({
      isConcallScheduleAlert: true, filingCategory: "ROUTINE_COMPLIANCE", title: "Analysts/Institutional Investor Meet/Con. Call Updates",
      aiResult: { priority: "MEDIUM", impact: "NEUTRAL", summary: "Jeena Sikho announced an earnings conference call." },
      concallSchedule: { date: "2026-11-16", time: "16:00" }, now: NOW, ...o
    });

    it("a call more than a day away goes on the daily board with its date and time, not a message of its own", async () => {
      const r = await decideDirectAlertGate(call());
      expect(r.boarded).toBe(true);
      expect(r.eventAnalysis.board_pending).toBe(true);
      expect(r.eventAnalysis.board_item).toMatchObject({ ticker: "SJS", kinds: ["CONCALL_SCHEDULE"], stance: null });
      expect(r.eventAnalysis.board_item.gist).toMatch(/16 Nov/);
      expect(r.eventAnalysis.board_item.gist).toMatch(/16:00/);
    });

    it("a call today or tomorrow still pushes: the board would come too late", async () => {
      for (const date of ["2026-11-05", "2026-11-06"]) expect((await decideDirectAlertGate(call({ concallSchedule: { date, time: "16:00" } }))).boarded, date).toBe(false);
    });

    it("an unknown date is pushed, never hidden (unknown relevance pushes)", async () => {
      expect((await decideDirectAlertGate(call({ concallSchedule: { date: null, time: null } }))).boarded).toBe(false);
      expect((await decideDirectAlertGate(call({ concallSchedule: null }))).boarded).toBe(false);
    });

    it("a reschedule says so on the board", async () => {
      const r = await decideDirectAlertGate(call({ isRescheduled: true }));
      expect(r.eventAnalysis.board_item.gist).toMatch(/rescheduled/i);
    });

    it("with the kill switch off it is pushed as before", async () => {
      expect((await decideDirectAlertGate(call({ gateEnabled: false }))).boarded).toBe(false);
    });
  });
});
