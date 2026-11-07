/**
 * Is this filing a results STATEMENT (numbers to verify, immediate flash) or something else that merely mentions results?
 * Real failure: the worker treated ANY earnings-flagged filing that mentions "financial results" but has no statement rows as a
 * scanned statement. A board-meeting intimation (MOREPENLAB, 1.7k characters) and a concall intimation (JSLL, 2.7k) therefore went
 * down the statement path: OCR for pages that do not exist, a failure alert or an unverified flash.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { looksLikeStatementFiling } from "../services/filing-classifier.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => fs.readFileSync(path.resolve(here, "fixtures/real-layouts", name), "utf8");
const base = { isEarningsRelease: true, isTranscript: false, isAudio: false };

describe("looksLikeStatementFiling", () => {
  it.each(["General Updates", "Updates", "Announcement under Regulation 30 (LODR)-Analyst / Investor Meet"])(
    "a concall intimation filed as '%s' is not a statement (real JSLL letter)", (title) => {
      expect(looksLikeStatementFiling({ ...base, title, docText: fx("JSLL_concall-intimation_2026-11-05.txt") })).toBe(false);
    });

  it("a board-meeting intimation that only announces the date of the results meeting is not a statement (real MOREPENLAB letter)", () => {
    expect(looksLikeStatementFiling({ ...base, title: "Updates", docText: fx("MOREPENLAB_board-intimation_2026-10-22.txt") })).toBe(false);
    expect(looksLikeStatementFiling({ ...base, title: "Outcome of Board Meeting", docText: fx("MOREPENLAB_board-intimation_2026-10-22.txt") })).toBe(false);
  });

  it("the outcome letter that says the results were approved IS a statement filing even though its statement pages are images (real MOREPENLAB letter)", () => {
    expect(looksLikeStatementFiling({ ...base, title: "Updates", docText: fx("MOREPENLAB_outcome-letter_2026-10-27.txt") })).toBe(true);
  });

  it("a filing with real statement rows is a statement (real SBCL results)", () => {
    expect(looksLikeStatementFiling({ ...base, title: "Outcome of Board Meeting", docText: fx("SBCL_2026-11-04.txt") })).toBe(true);
  });

  it("a long results filing whose text layer has NO statement rows (cover letter + auditor's report, statements are images: SKIPPER) is still a statement", () => {
    const docText = "Independent Auditor's Review Report on the unaudited financial results of the company for the quarter ended September 30, 2026. ".repeat(120);
    expect(docText.length).toBeGreaterThan(8000);
    expect(looksLikeStatementFiling({ ...base, title: "Outcome of Board Meeting", docText })).toBe(true);
  });

  it("not a statement: decks, press releases, transcripts, recordings, and filings not flagged as earnings without statement rows", () => {
    const docText = fx("SBCL_2026-11-04.txt");
    expect(looksLikeStatementFiling({ ...base, title: "Investor Presentation", docText })).toBe(false);
    expect(looksLikeStatementFiling({ ...base, title: "Press Release", docText })).toBe(false);
    expect(looksLikeStatementFiling({ ...base, title: "Outcome of Board Meeting", docText, isTranscript: true })).toBe(false);
    expect(looksLikeStatementFiling({ ...base, title: "Outcome of Board Meeting", docText, isAudio: true })).toBe(false);
    expect(looksLikeStatementFiling({ ...base, isEarningsRelease: false, title: "Updates", docText: "financial results un-audited ".repeat(500) })).toBe(false);
  });
});
