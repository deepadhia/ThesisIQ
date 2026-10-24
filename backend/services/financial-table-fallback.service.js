/**
 * Text-grounded LLM fallback for results PDFs whose statement tables the rule-based parser cannot read.
 *
 * The model is only asked to LOCATE the printed figures (it never calculates or estimates). Every figure it
 * returns must literally appear in the filing text; anything else is discarded. The accepted figures are then
 * re-assembled into a synthetic statement and pushed through the SAME deterministic arithmetic as normal
 * filings (YoY, QoQ, EBITDA, margin bps), so no growth number is ever produced by the model.
 *
 * The result is flagged `verification: "LLM_LOCATED_TEXT_GROUNDED"`: shown to the user as unverified, and the
 * thesis gate refuses to authorise a buy on it.
 */

import { extractDeterministicFinancials } from "./financial-validator.service.js";

const ROW_LABELS = {
  revenue: "Revenue from operations",
  finance_costs: "Finance costs",
  depreciation: "Depreciation and amortisation expense",
  pbt_before_exceptional: "Profit before exceptional items and tax",
  pbt: "Profit before tax",
  pat: "Profit for the period"
};

/**
 * Picks the part of the document that most likely holds the P&L (windows around "Revenue from operations" rows).
 */
export function selectStatementRegion(docText, maxChars = 14000) {
  const lines = String(docText || "").split("\n");
  const anchors = [];
  lines.forEach((l, i) => {
    if (/revenue\s+from\s+operations|income\s+from\s+operations|total\s+income/i.test(l) && /\d/.test(l)) anchors.push(i);
  });
  if (anchors.length === 0) return "";

  const ranges = [];
  for (const a of anchors) {
    const from = Math.max(0, a - 45);
    const to = Math.min(lines.length, a + 60);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  let out = "";
  for (const [from, to] of ranges) {
    const chunk = lines.slice(from, to).join("\n");
    if ((out + chunk).length > maxChars) break;
    out += `${chunk}\n-----\n`;
  }
  return out.trim();
}

function detectDocUnit(text) {
  const lower = String(text || "").toLowerCase();
  const lakh = /(?:rs\.?|₹|inr)\s*(?:in\s+)?(?:lakhs?|lacs?)|in\s+(?:lakhs?|lacs?)\b/.test(lower);
  const crore = /(?:rs\.?|₹|inr)\s*(?:in\s+)?crores?|in\s+crores?\b|\(\s*(?:rs\.?|₹)?\s*cr(?:s|ore)?\s*\)/.test(lower);
  const million = /(?:rs\.?|₹|inr)\s*(?:in\s+)?millions?|in\s+millions?\b/.test(lower);
  if (lakh && !crore && !million) return "LAKHS";
  if (crore && !lakh && !million) return "CRORES";
  if (million && !lakh && !crore) return "MILLIONS";
  return null;
}

const NUM_RE = /^\(?-?[\d,]+(?:\.\d+)?\)?$/;

function normaliseCell(raw) {
  if (raw === null || raw === undefined) return { text: "-", numeric: null };
  const t = String(raw).replace(/\s+/g, "").replace(/^₹/, "");
  if (/^[-–—]$/.test(t) || t === "" || /^null$/i.test(t)) return { text: "-", numeric: null };
  if (!NUM_RE.test(t)) return { text: "-", numeric: null, invalid: true };
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  const digits = t.replace(/[(),]/g, "").replace(/^-/, "");
  return { text: t, numeric: negative ? -parseFloat(digits) : parseFloat(digits), digits };
}

function isoToDotted(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/**
 * @param {object} args
 * @param {string} args.docText full filing text
 * @param {string} args.ticker
 * @param {(system:string,user:string,temp?:number)=>Promise<string>} args.runPrompt LLM runner
 * @returns {Promise<object|null>} deterministic-shaped financials flagged as text-grounded LLM output, or null
 */
export async function extractFinancialsViaLlm({ docText, ticker, runPrompt }) {
  const region = selectStatementRegion(docText);
  if (!region || region.length < 300 || typeof runPrompt !== "function") return null;

  const system = "You are a meticulous financial data transcriber. You copy printed numbers exactly and never calculate, estimate or infer any figure.";
  const user = `
Ticker: ${ticker}
Below is text extracted from an Indian company's quarterly financial results filing (it may contain both Consolidated and Standalone statements, and half-year / year columns).

TASK: transcribe the statement of PROFIT AND LOSS for the PRIMARY entity (prefer CONSOLIDATED; use STANDALONE only if no consolidated statement exists).
Only transcribe the QUARTER columns, in this order: [current quarter, immediately preceding quarter, same quarter of the previous year]. Skip half-year / nine-month / year columns.
Copy every value EXACTLY as printed (keep commas and brackets, e.g. "1,55,550.53" or "(12.34)"). Use null for a cell that is not printed. NEVER calculate a value.

Return ONLY this JSON:
{
  "scope": "CONSOLIDATED" | "STANDALONE",
  "unit": "CRORES" | "LAKHS" | "MILLIONS",
  "column_dates": ["YYYY-MM-DD current quarter end", "YYYY-MM-DD previous quarter end", "YYYY-MM-DD year-ago quarter end"],
  "rows": {
    "revenue": ["...", "...", "..."],               // Revenue from operations
    "finance_costs": ["...", "...", "..."],
    "depreciation": ["...", "...", "..."],           // Depreciation and amortisation expense
    "pbt_before_exceptional": ["...", "...", "..."], // Profit before exceptional items and tax (null if not printed)
    "pbt": ["...", "...", "..."],                    // Profit before tax
    "pat": ["...", "...", "..."],                    // Profit for the period (total, after tax)
    "pat_owners": ["...", "...", "..."]              // Profit attributable to owners of the company (null if not printed)
  }
}

FILING TEXT:
${region}
`;

  let parsed;
  try {
    const out = await runPrompt(system, user, 0);
    const cleaned = String(out || "").replace(/```json/gi, "").replace(/```/g, "").trim();
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    if (a === -1 || b <= a) return null;
    parsed = JSON.parse(cleaned.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1"));
  } catch (err) {
    console.warn(`[TABLE FALLBACK] LLM extraction failed for ${ticker}: ${err.message}`);
    return null;
  }

  const rows = parsed?.rows || {};
  const dates = Array.isArray(parsed?.column_dates) ? parsed.column_dates.map(isoToDotted).filter(Boolean) : [];
  if (dates.length < 3) return null;
  const cols = 3;

  // ── Grounding: every transcribed figure must literally exist in the filing text ──
  const haystack = String(docText).replace(/,/g, "");
  const grounded = (cell) => {
    if (cell.numeric === null) return true;
    const re = new RegExp(`(?<![\\d.])${cell.digits.replace(/\./g, "\\.")}(?![\\d])`);
    return re.test(haystack);
  };

  const accepted = {};
  for (const key of [...Object.keys(ROW_LABELS), "pat_owners"]) {
    const arr = Array.isArray(rows[key]) ? rows[key].slice(0, cols) : [];
    while (arr.length < cols) arr.push(null);
    const cells = arr.map(normaliseCell);
    if (cells.some(c => c.invalid)) continue;
    if (cells.every(c => c.numeric === null)) continue;
    if (!cells.every(grounded)) {
      console.warn(`[TABLE FALLBACK] ${ticker}: discarded row "${key}" — figure(s) not found in the filing text.`);
      continue;
    }
    accepted[key] = cells.map(c => c.text);
  }

  // Minimum viable statement: revenue with all three quarter columns and a profit row
  const complete = (row) => row && row.every(v => v !== "-");
  if (!complete(accepted.revenue) || !(accepted.pat || accepted.pbt)) return null;

  const docUnit = detectDocUnit(docText);
  const unit = docUnit || (["CRORES", "LAKHS", "MILLIONS"].includes(String(parsed.unit).toUpperCase()) ? String(parsed.unit).toUpperCase() : "CRORES");
  const unitText = unit === "LAKHS" ? "Lakhs" : unit === "MILLIONS" ? "Millions" : "Crores";
  const scope = String(parsed.scope).toUpperCase() === "STANDALONE" ? "STANDALONE" : "CONSOLIDATED";

  const lines = [
    `STATEMENT OF ${scope} UNAUDITED FINANCIAL RESULTS`,
    `(Rs. in ${unitText})`,
    `Particulars ${dates.slice(0, cols).join(" ")}`,
    `${ROW_LABELS.revenue} ${accepted.revenue.join(" ")}`
  ];
  if (accepted.finance_costs) lines.push(`${ROW_LABELS.finance_costs} ${accepted.finance_costs.join(" ")}`);
  if (accepted.depreciation) lines.push(`${ROW_LABELS.depreciation} ${accepted.depreciation.join(" ")}`);
  if (accepted.pbt_before_exceptional) lines.push(`${ROW_LABELS.pbt_before_exceptional} ${accepted.pbt_before_exceptional.join(" ")}`);
  if (accepted.pbt) lines.push(`${ROW_LABELS.pbt} ${accepted.pbt.join(" ")}`);
  if (accepted.pat) lines.push(`${ROW_LABELS.pat} ${accepted.pat.join(" ")}`);
  if (accepted.pat_owners) {
    lines.push("Profit attributable to:");
    lines.push(`a) Owners of the Company ${accepted.pat_owners.join(" ")}`);
  }

  const fin = extractDeterministicFinancials(lines.join("\n"));
  if (!fin) return null;
  return { ...fin, verification: "LLM_LOCATED_TEXT_GROUNDED" };
}
