/**
 * Clean-up plan for the 2026-11-06 foreign-filing flood. Ownership is VERIFIED against NSE's own per-symbol list (never guessed),
 * a ticker whose list cannot be read is left alone and reported, and what the foreign filings wrote (commitments, snapshots) is
 * traced by its text, so nothing that came from a real filing is touched.
 */
import { describe, it, expect } from "vitest";
import { planForeignCleanup } from "../services/foreign-cleanup.service.js";

const NSE = "https://nsearchives.nseindia.com/corporate/";
const row = (o) => ({ id: "r", ticker: "SJS", stock_id: "s-sjs", title: "Updates", attachment_url: `${NSE}SJS_1.pdf`, deep_dive_status: "completed", event_analysis: {}, ...o });
const verified = (map) => new Map(Object.entries(map).map(([t, urls]) => [t, new Set(urls)]));

describe("planForeignCleanup", () => {
  it('traces already flagged foreign sources even when their text contains quotes or newlines', () => {
    const statement = 'The board approved a new "speciality" plant\nfor the following financial year';
    const alien = row({ attachment_url: `${NSE}DENTA_9.pdf`, event_analysis: { foreign_filing: true, commitments: [{ statement }] } });
    const plan = planForeignCleanup({ rows: [alien], verifiedByTicker: verified({ SJS: [`${NSE}SJS_1.pdf`] }), commitments: [{ id: 'c', ticker: 'SJS', statement }] });
    expect(plan.foreign).toEqual([]);
    expect(plan.commitments.map(c => c.id)).toEqual(['c']);
  });

  it('does not delete evidence also present in a verified own-company filing', () => {
    const shared = 'Management expects operating performance to improve in the following financial year';
    const alien = row({ attachment_url: `${NSE}DENTA_9.pdf`, event_analysis: { summary: shared } });
    const own = row({ attachment_url: `${NSE}SJS_1.pdf`, event_analysis: { summary: shared } });
    const plan = planForeignCleanup({ rows: [alien, own], verifiedByTicker: verified({ SJS: [`${NSE}SJS_1.pdf`] }), commitments: [{ id: 'c', ticker: 'SJS', statement: shared }], snapshots: [{ id: 's', stock_id: 's-sjs', summary: shared }] });
    expect(plan.commitments).toEqual([]);
    expect(plan.snapshots).toEqual([]);
  });

  it("a row whose document is in the stock's own NSE list is legitimate; one that is not is foreign", () => {
    const rows = [row({ id: "own", attachment_url: `${NSE}SJS_1.pdf` }), row({ id: "alien", attachment_url: `${NSE}DENTA_9.pdf` })];
    const plan = planForeignCleanup({ rows, verifiedByTicker: verified({ SJS: [`${NSE}SJS_1.pdf`, `${NSE}SJS_2.pdf`] }) });
    expect(plan.foreign.map((r) => r.id)).toEqual(["alien"]);
    expect(plan.unverifiable).toEqual([]);
  });

  it("a ticker whose NSE list could not be read (empty / failed) is NOT judged: its rows are reported as unverifiable, never marked", () => {
    const rows = [row({ id: "a", ticker: "CCL", attachment_url: `${NSE}DENTA_9.pdf` })];
    const plan = planForeignCleanup({ rows, verifiedByTicker: verified({ CCL: [] }) });
    expect(plan.foreign).toEqual([]);
    expect(plan.unverifiable.map((r) => r.id)).toEqual(["a"]);
    expect(planForeignCleanup({ rows, verifiedByTicker: new Map() }).unverifiable).toHaveLength(1);
  });

  it("only NSE documents are judged: a BSE document or a filing with no real attachment is left alone", () => {
    const rows = [
      row({ id: "bse", attachment_url: "https://www.bseindia.com/xml-data/corporate/AttachLive/abc.pdf" }),
      row({ id: "none", attachment_url: `${NSE}-` }),
      row({ id: "null", attachment_url: null })
    ];
    const plan = planForeignCleanup({ rows, verifiedByTicker: verified({ SJS: [`${NSE}SJS_1.pdf`] }) });
    expect(plan.foreign).toEqual([]);
    expect(plan.unverifiable).toEqual([]);
  });

  it("rows already set aside are not planned twice", () => {
    const rows = [row({ id: "done", attachment_url: `${NSE}DENTA_9.pdf`, event_analysis: { foreign_filing: true } })];
    expect(planForeignCleanup({ rows, verifiedByTicker: verified({ SJS: [`${NSE}SJS_1.pdf`] }) }).foreign).toEqual([]);
  });

  it("commitments and snapshots are traced to a foreign row by their text, same stock only; short or generic text is never matched", () => {
    const alien = row({ id: "alien", attachment_url: `${NSE}DENTA_9.pdf`, event_analysis: { summary: "Denta Water reported H1 revenue growth of 22% and targets a new plant in FY28", investment_memo: "x" } });
    const own = row({ id: "own", attachment_url: `${NSE}SJS_1.pdf`, event_analysis: { summary: "SJS guided revenue growth of 1.2-1.5x" } });
    const commitments = [
      { id: "c1", ticker: "SJS", statement: "Targets a new plant in FY28 with 22% revenue growth", evidence_summary: "Denta Water reported H1 revenue growth of 22% and targets a new plant in FY28" },
      { id: "c2", ticker: "SJS", statement: "Revenue growth 1.2-1.5x", evidence_summary: "SJS guided revenue growth of 1.2-1.5x" },
      { id: "c3", ticker: "SJS", statement: "growth", evidence_summary: "x" },
      { id: "c4", ticker: "CCL", statement: "Denta Water reported H1 revenue growth of 22% and targets a new plant in FY28", evidence_summary: "" }
    ];
    const snapshots = [
      { id: "n1", stock_id: "s-sjs", quarter: "Q2_FY27", summary: "Denta Water reported H1 revenue growth of 22% and targets a new plant in FY28 for the group" },
      { id: "n2", stock_id: "s-sjs", quarter: "Q1_FY27", summary: "SJS guided revenue growth of 1.2-1.5x" }
    ];
    const plan = planForeignCleanup({ rows: [alien, own], verifiedByTicker: verified({ SJS: [`${NSE}SJS_1.pdf`] }), commitments, snapshots });
    expect(plan.foreign.map((r) => r.id)).toEqual(["alien"]);
    expect(plan.commitments.map((c) => c.id)).toEqual(["c1"]);     // c4 belongs to another stock's rows; c2 / c3 come from real or too-short text
    expect(plan.snapshots.map((s) => s.id)).toEqual(["n1"]);
  });

  it("a summary of the plan says how many rows were already alerted (those cannot be unsent)", () => {
    const rows = [
      row({ id: "a", attachment_url: `${NSE}D1.pdf`, event_analysis: { alert_sent_at: "2026-11-06T21:00:00Z" } }),
      row({ id: "b", attachment_url: `${NSE}D2.pdf`, event_analysis: { digest_sent_at: "2026-11-06T21:00:00Z" } }),
      row({ id: "c", attachment_url: `${NSE}D3.pdf`, deep_dive_status: "pending_stage1" })
    ];
    const plan = planForeignCleanup({ rows, verifiedByTicker: verified({ SJS: [`${NSE}SJS_1.pdf`] }) });
    expect(plan.summary).toMatchObject({ foreign: 3, alreadyAlerted: 2, stillQueued: 1 });
  });
});
