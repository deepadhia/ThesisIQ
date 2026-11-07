/**
 * Finding the results-statement pages inside a long combined filing (pure functions; the extractor owns the PDF and the OCR).
 *
 * POLICYBZR files one 143-page "Outcome of Board Meeting" PDF: cover letter, press release, investor deck, auditor's report and
 * then the statements, whose pages are scans with a garbled text layer ("Rev enu e from op er ati ons"). The extractor kept only
 * the first 60,000 characters (the statements start at character 91,000), and the whole 143 pages were sent to the vision model
 * for OCR, so the stock never had verified numbers. Now: find the statement pages from the text layer (spacing and garbling do
 * not matter: only letters are compared), keep their text in the capped document, and re-read only those few pages by vision
 * when their text layer is garbled.
 */

/** Letters only, lower case: "STAT EM ENT O F UNAUDITED FINANC IAL RESU LT S" -> "statementofunauditedfinancialresults". */
export const lettersOnly = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

// "Statement of Unaudited Financial Results", "...Consolidated Financial Results", "...Standalone and Consolidated Financial Results"
const HEADING = /statementof(?:un)?audited(?:(?:standalone|consolidated)(?:and(?:standalone|consolidated))?)?financialresult|financialresultsforthequarter|resultsforthequarterandhalfyear/;
const TABLE_WORDS = ["particulars", "revenuefromoperation", "totalincome", "profitbeforetax", "profitfortheperiod", "profitfortheyear", "totalexpense"];
// pages that talk ABOUT the statement (the auditor's review, notes) rather than hold it
const NOT_A_TABLE = /independentauditor|limitedreviewreport|wehavereviewed|reviewengagement|notes(?:to|on)(?:the)?(?:standalone|consolidated|unaudited)/;

/**
 * Page numbers (as given by the extractor) of the results statement tables, consolidated first, at most `max`.
 * @param {Array<{num:number, text:string}>} pages
 */
export function findStatementPages(pages = [], max = 4) {
  const hits = [];
  for (const p of pages) {
    const t = lettersOnly(p?.text);
    if (!t || NOT_A_TABLE.test(t.slice(0, 600))) continue;
    if (!HEADING.test(t.slice(0, 1200))) continue;
    const words = TABLE_WORDS.filter((w) => t.includes(w)).length;
    if (words < 2) continue;
    hits.push({ num: p.num, consolidated: /^.{0,300}consolidated/.test(t) || t.slice(0, 600).includes("consolidated"), words });
  }
  return hits.sort((a, b) => Number(b.consolidated) - Number(a.consolidated) || b.words - a.words || a.num - b.num).slice(0, max).map((h) => h.num).sort((a, b) => a - b);
}

/**
 * True when a page's text layer is too damaged for the statement parser: single and double letter fragments dominate the words,
 * or there are almost no readable decimal figures even though labels are present.
 */
export function looksGarbled(text = "") {
  const raw = String(text);
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 20) return true;
  const fragments = words.filter((w) => /^[A-Za-z]{1,2}$/.test(w)).length;
  const figures = (raw.match(/\(?\d[\d,]*\.\d{2}\)?/g) || []).length;
  if (fragments / words.length > 0.22 || figures < 8) return true;
  // Row labels broken by stray spaces ("Rev enu e from op er ati ons"): present when letters are compared, absent as written.
  const spaced = raw.toLowerCase().replace(/\s+/g, " ");
  const letters = lettersOnly(raw);
  const labels = [["revenue from operation", "revenuefromoperation"], ["total income", "totalincome"], ["profit before tax", "profitbeforetax"], ["total expenses", "totalexpense"]];
  const present = labels.filter(([, l]) => letters.includes(l));
  const intact = present.filter(([w]) => spaced.includes(w));
  return present.length >= 2 && intact.length < present.length;
}

/**
 * The text kept for a document: all of it when it fits, otherwise the beginning plus the statement pages (so a statement that
 * starts after the cut is not lost). With no statement page found the beginning is kept, as before.
 * @param {Array<{num:number, text:string}>} pages
 */
export function capDocumentText(pages = [], max = 60000, headChars = 22000) {
  const clean = (s) => String(s || "").replace(/[^\S\r\n]+/g, " ").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const full = clean(pages.map((p) => p?.text || "").join("\n\n"));
  if (full.length <= max) return full;
  const stmtNums = new Set(findStatementPages(pages, 6));
  if (!stmtNums.size) return full.slice(0, max);
  const head = full.slice(0, headChars);
  const stmt = clean(pages.filter((p) => stmtNums.has(p.num)).map((p) => p.text).join("\n\n")).slice(0, max - headChars - 40);
  return `${head}\n\n[statement pages]\n${stmt}`;
}
