/**
 * SJS Q2 FY27 (2026-11-04): the consolidated statement page is garbled in the text layer, so the worker re-read it by OCR. The OCR
 * text had no "(Rs. in million)" line, the parser fell back to crores, and the alert printed revenue ₹2,827.28 Cr (a stock with a
 * market value of a few thousand crore) instead of ₹282.7 Cr: a 10x error on an alert that was sent. The filing DECLARES its unit
 * elsewhere in its own text; that declaration is the fallback when the statement block has none.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { extractDeterministicFinancials, detectDocumentUnit } from "../services/financial-validator.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sjsNative = fs.readFileSync(path.resolve(here, "fixtures/real-layouts/SJS_q2fy27-results-native-text_2026-11-04.txt"), "utf8");

// Synthetic statement rows exactly as an OCR transcription delivers them: no unit line, no scope line.
const rows = (unitLine = "") => `${unitLine}
Particulars
September 30, 2026
June 30, 2026
September 30, 2025
September 30, 2026
September 30, 2025
Unaudited Unaudited Unaudited Unaudited Unaudited
I Revenue from operations 2,827.28 2,500.00 2,418.00 5,327.28 4,700.00
II Other income 30.00 25.00 20.00 55.00 40.00
III Total Income (I+II) 2,857.28 2,525.00 2,438.00 5,382.28 4,740.00
IV Expenses
Finance costs 20.00 18.00 15.00 38.00 30.00
Depreciation and amortisation expense 100.00 90.00 80.00 190.00 160.00
Total Expenses (IV) 2,200.00 2,000.00 1,900.00 4,200.00 3,700.00
V Profit before tax (III-IV) 657.28 525.00 538.00 1,182.28 1,040.00
VI Tax Expense 165.00 130.00 135.00 295.00 260.00
VII Profit for the period/year (V-VI) 492.28 395.00 403.00 887.28 780.00
`;

describe("detectDocumentUnit: the unit the filing itself declares", () => {
  it("reads 'million' from the real SJS filing (its statements are printed '(Rs. in million)')", () => {
    expect(detectDocumentUnit(sjsNative)).toBe("million");
  });
  it("an amount written in words in a cover letter ('Rupees Ten Crore only') is not a unit declaration", () => {
    expect(detectDocumentUnit("an investment of ₹10,00,00,000 (Rupees Ten Crore only) was approved on August 06, 2026")).toBeNull();
  });
  it("reads lakhs and crores, accepts 'Rs. in Crores' and '(R, in million ...)' forms", () => {
    expect(detectDocumentUnit("Statement of results\n(Rs. in Lakhs)\nRevenue 1,000")).toBe("lakh");
    expect(detectDocumentUnit("Statement of results\n(₹ in Crores)\nRevenue 1,000")).toBe("crore");
    expect(detectDocumentUnit("(R, in million except per equity share data)")).toBe("million");
  });
  it("conflicting declarations (as many crore as million) are not guessed", () => {
    expect(detectDocumentUnit("(Rs. in million)\n(Rs. in million)\n(Rs. in Crores)\n(Rs. in Crores)")).toBeNull();
    expect(detectDocumentUnit("no unit anywhere")).toBeNull();
    expect(detectDocumentUnit("")).toBeNull();
  });
});

describe("a statement with no unit line takes the unit the filing declares", () => {
  it("without a declared unit the old default (crores) applies, unchanged", () => {
    const fin = extractDeterministicFinancials(rows());
    expect(fin.revenue).toBe(2827.28);
    expect(fin.unit).toBe("CRORES");
  });
  it("with the declared unit 'million' the same rows read as ₹282.73 Cr (1 million = 0.1 crore)", () => {
    const fin = extractDeterministicFinancials(rows(), { declaredUnit: "million" });
    expect(fin.revenue).toBeCloseTo(282.73, 1);
    expect(fin.unit).toBe("MILLIONS");
  });
  it("a unit printed next to the statement beats the document-level declaration", () => {
    const fin = extractDeterministicFinancials(rows("(Rs. in Crores)"), { declaredUnit: "million" });
    expect(fin.revenue).toBe(2827.28);
    expect(fin.unit).toBe("CRORES");
  });
});
