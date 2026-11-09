/**
 * POLICYBZR (PB Fintech) filed one 143-page "Outcome of Board Meeting" PDF: letter, press release, deck, auditor's review and, on
 * page 130, the consolidated results statement as a scan with a garbled text layer. The extractor kept the first 60,000
 * characters (the statement starts at 91,000) and sent all 143 pages to the vision model, so the stock never had verified
 * numbers. These tests use the REAL pages (fixtures in real-layouts/).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { findStatementPages, looksGarbled, capDocumentText, lettersOnly } from "../services/statement-pages.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => fs.readFileSync(path.resolve(here, "fixtures/real-layouts", n), "utf8");
const STATEMENT = fx("POLICYBZR_consolidated-statement-page_2026-10-30.txt");
const AUDITOR = fx("POLICYBZR_auditor-review-page_2026-10-30.txt");
const NOTES = fx("POLICYBZR_notes-page_2026-10-30.txt");
const shakti = fs.readFileSync(path.resolve(here, "fixtures/shaktipump-q2fy27-results.txt"), "utf8");

const filler = (n) => ({ num: n, text: `Investor presentation slide ${n}. ` + "Core online insurance premium grew strongly in the quarter. ".repeat(40) });
const longDoc = () => [
  ...Array.from({ length: 124 }, (_, i) => filler(i + 1)),     // cover letter, press release, deck
  { num: 125, text: AUDITOR },                                   // auditor's review: talks ABOUT the statement
  ...Array.from({ length: 4 }, (_, i) => filler(126 + i)),
  { num: 130, text: STATEMENT },                                 // the scanned consolidated statement
  { num: 131, text: "CONSOLIDATED STATEMENT OF UNAUDITED CASH FLOWS FOR THE HALF YEAR ENDED SEPTEMBER 30, 2026 " + "operating activities adjustments ".repeat(30) },
  { num: 133, text: NOTES },
];

describe("lettersOnly: spacing and stray characters do not matter", () => {
  it("reads the garbled heading as the heading it is", () => {
    expect(lettersOnly("C ONSOLIDATED STAT EM ENT O F UNAUDITED FINANC IAL RESU LT S")).toBe("consolidatedstatementofunauditedfinancialresults");
  });
});

describe("findStatementPages on the real 143-page filing", () => {
  it("finds the statement page (130) and not the auditor's review, the notes, the cash-flow page or the deck", () => {
    expect(findStatementPages(longDoc())).toEqual([130]);
  });
  it("finds a normal, readable statement too (Shakti)", () => {
    // the statement page of that filing: heading "Statement of Unaudited Consolidated Financial Results" down to the standalone heading
    const statementPage = shakti.split("\n").slice(102, 185).join("\n");
    expect(findStatementPages([{ num: 1, text: "Cover letter. Board approved results." }, { num: 2, text: statementPage }])).toEqual([2]);
  });
  it("finds nothing in a document without a statement", () => {
    expect(findStatementPages(Array.from({ length: 20 }, (_, i) => filler(i + 1)))).toEqual([]);
  });
  it('keeps a statement table with notes underneath, but rejects a notes-only page', () => {
    const table = 'Statement of Unaudited Consolidated Financial Results\nParticulars Revenue from operations Total income Profit before tax';
    expect(findStatementPages([{ num: 1, text: `${table}\nNotes: The above results were reviewed by the audit committee.` }])).toEqual([1]);
    expect(findStatementPages([{ num: 2, text: `Notes: The above results were reviewed. ${table}` }])).toEqual([]);
  });
});

describe("looksGarbled", () => {
  it("the real scanned page is garbled (its labels are broken by spaces, so the statement parser cannot read it)", () => {
    expect(looksGarbled(STATEMENT)).toBe(true);
  });
  it("a clean text-layer statement is not", () => {
    expect(looksGarbled(shakti.split("\n").slice(40, 130).join("\n"))).toBe(false);
  });
  it("an almost empty page is", () => {
    expect(looksGarbled("Revenue")).toBe(true);
  });
});

describe("capDocumentText keeps a statement that starts after the cut", () => {
  it("the old cut (first 60,000 characters) lost it; the capped text now contains the statement page", () => {
    const pages = longDoc();
    const total = pages.map((p) => p.text).join("\n\n").length;
    expect(total).toBeGreaterThan(60000);
    expect(pages.map((p) => p.text).join("\n\n").slice(0, 60000)).not.toContain("UNAUDITED FINANC");   // what was kept before
    const out = capDocumentText(pages);
    expect(out.length).toBeLessThanOrEqual(60000);
    expect(out).toContain("[statement pages]");
    expect(lettersOnly(out)).toContain("consolidatedstatementofunauditedfinancialresults");
    expect(out.startsWith("Investor presentation slide 1.")).toBe(true);   // the beginning (cover letter) is kept
  });
  it("a short document is returned whole, and a long one with no statement keeps its beginning", () => {
    expect(capDocumentText([{ num: 1, text: "short text" }])).toBe("short text");
    const noStmt = Array.from({ length: 200 }, (_, i) => filler(i + 1));
    const out = capDocumentText(noStmt);
    expect(out.length).toBe(60000);
    expect(out).not.toContain("[statement pages]");
  });
});
