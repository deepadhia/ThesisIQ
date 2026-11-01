/**
 * Deterministic Cash Flow & Earnings Quality Analyzer for ThesisIQ.
 *
 * In Indian corporate reporting (SEBI LODR), companies file full Consolidated Statement of Cash Flows
 * in Q2 (H1) and Q4 (Annual). P&L profit growth without cash conversion or flattered by non-operating
 * accounting credits (hyperinflation adjustments under Ind AS 29, treasury interest, non-controlling interest)
 * creates valuation risk.
 *
 * This service deterministically extracts:
 * 1. Net Cash Flow from Operating Activities (OCF) for current and prior year periods.
 * 2. Operating Profit before Working Capital changes.
 * 3. Working Capital dynamics: Inventory cash drain, Trade Receivables, Trade Payables.
 * 4. Capital Expenditure (Purchase of PPE / fixed assets) and Free Cash Flow (OCF - Capex).
 * 5. Cash Conversion Ratio: (H1 OCF / H1 PAT) * 100.
 * 6. Quality of Earnings: Other income vs PBT, Core EBITDA Margin vs Reported Margin, Hyperinflation adjustments.
 */

const CF_SECTION_START = /(?:cash\s+flow\s+from\s+operating\s+activities|statement\s+of\s+cash\s+flows?|cash\s+flows?\s+from\s+operating\s+activities)/i;

const ROW_PATTERNS = {
  pbtBeforeTax: /(?:net\s+profit\s+before\s+tax|profit\s+before\s+tax(?:\s+and\s+exceptional)?|profit\s*\/\s*\(loss\)\s+before\s+tax)/i,
  operatingProfitBeforeWc: /(?:operating\s+profit\s+before\s+working\s+capital|operating\s+cash\s+flows?\s+before\s+working\s+capital|cash\s+generated\s+from\s+operations\s+before\s+working\s+capital)/i,
  inventory: /(?:\(increase\)\s*\/\s*decrease\s+in\s+inventor|increase\s*\/\s*\(decrease\)\s+in\s+inventor|\binventor(?:y|ies)\b)/i,
  receivables: /(?:\(increase\)\s*\/\s*decrease\s+in\s+trade\s+receivable|increase\s*\/\s*\(decrease\)\s+in\s+trade\s+receivable|\btrade\s+receivables?\b)/i,
  payables: /(?:increase\s*\/\s*\(decrease\)\s+in\s+trade\s+payable|\(increase\)\s*\/\s*decrease\s+in\s+trade\s+payable|\btrade\s+payables?\b)/i,
  cashGeneratedOps: /(?:cash\s+generated\s+from\s+(?:operations|operating\s+activities)|cash\s+flow\s+from\s+operations\s+before\s+taxes)/i,
  taxesPaid: /(?:less\s*:\s*-?\s*income\s+taxes\s+paid|direct\s+taxes\s+paid|income\s+tax(?:\s+paid)?)/i,
  netOperatingCashFlow: /(?:net\s+cash\s+(?:flow\s+)?(?:from|generated\s+from|used\s+in)\s+operating\s+activities|\bnet\s+cash\s+from\s+operating\s+activities\b)/i,
  capex: /(?:purchase\s+of\s+(?:property,\s+plant|ppe|fixed\s+assets|intangible|tangible)|additions\s+to\s+(?:fixed\s+assets|ppe)|capital\s+expenditure)/i
};

const UNIT_PATTERN = /(?:(?:rs\.?|₹|inr|rupees)\s*(?:in\s+)?(crores?|crs?\b|lakhs?|lacs?|millions?|mn\b)|\bin\s+(crores?|crs?\b|lakhs?|lacs?|millions?|mn\b)|\(\s*(?:rs\.?|₹)?\s*(crores?|crs?\b|lakhs?|lacs?|millions?|mn\b)\s*\))/i;

function detectSectionUnit(lines, startIdx) {
  for (let i = Math.max(0, startIdx - 35); i <= Math.min(lines.length - 1, startIdx + 15); i++) {
    const m = lines[i].match(UNIT_PATTERN);
    if (m && lines[i].length < 160) {
      const w = (m[1] || m[2] || m[3] || "").toLowerCase();
      if (w.startsWith("lakh") || w.startsWith("lac")) return { factor: 0.01, name: "LAKHS" };
      if (w.startsWith("million") || w === "mn") return { factor: 0.1, name: "MILLIONS" };
      return { factor: 1, name: "CRORES" };
    }
  }
  return { factor: 1, name: "CRORES" };
}

function parseNumbersFromLine(line) {
  if (!line || typeof line !== "string") return [];
  const matches = line.matchAll(/(?:\(\s*([0-9,]+(?:\.[0-9]+)?)\s*\)|(-?[0-9,]+(?:\.[0-9]+)?))/g);
  const values = [];
  for (const m of matches) {
    const raw = m[1] ? `-${m[1]}` : m[2];
    const clean = raw.replace(/,/g, "");
    const num = parseFloat(clean);
    if (!Number.isNaN(num) && Math.abs(num) < 1e9) {
      values.push(num);
    }
  }
  return values;
}

const round2 = (n) => (n === null || n === undefined ? null : parseFloat(Number(n).toFixed(2)));

/**
 * Deterministically parses cash flow statements from filing text.
 * @param {string} pdfText Raw text of the quarterly/annual filing
 * @returns {object|null} Parsed cash flow metrics normalized to ₹ Crores
 */
export function extractDeterministicCashFlow(pdfText = "") {
  if (!pdfText || typeof pdfText !== "string") return null;

  const lines = pdfText.split("\n").map(l => l.trim()).filter(Boolean);
  const cfSections = [];

  for (let i = 0; i < lines.length; i++) {
    if (CF_SECTION_START.test(lines[i])) {
      let scope = "UNKNOWN";
      for (let j = Math.max(0, i - 25); j <= i; j++) {
        if (/consolidated/i.test(lines[j])) scope = "CONSOLIDATED";
        else if (/standalone|stand-alone/i.test(lines[j]) && scope === "UNKNOWN") scope = "STANDALONE";
      }
      cfSections.push({ startIdx: i, scope });
    }
  }

  if (cfSections.length === 0) return null;

  // Prioritize CONSOLIDATED cash flow statements
  const primarySection = cfSections.find(s => s.scope === "CONSOLIDATED") || cfSections[0];
  const start = primarySection.startIdx;
  const unit = detectSectionUnit(lines, start);
  const f = unit.factor;

  const end = Math.min(lines.length, start + 120);
  const extracted = {
    statementScope: primarySection.scope,
    unit: unit.name,
    operatingCashFlowCr: null,
    operatingCashFlowPriorCr: null,
    operatingProfitBeforeWcCr: null,
    inventoryChangeCr: null,
    receivablesChangeCr: null,
    payablesChangeCr: null,
    cashGeneratedOpsCr: null,
    taxesPaidCr: null,
    capexCr: null,
    freeCashFlowCr: null,
    cashConversionPct: null,
    isCriticalCashDivergence: false,
    isWorkingCapitalDrain: false
  };

  for (let i = start; i < end; i++) {
    const line = lines[i];
    const nums = parseNumbersFromLine(line);
    if (nums.length === 0) continue;

    if (extracted.operatingCashFlowCr === null && ROW_PATTERNS.netOperatingCashFlow.test(line)) {
      extracted.operatingCashFlowCr = round2(nums[0] * f);
      if (nums.length > 1) extracted.operatingCashFlowPriorCr = round2(nums[1] * f);
    } else if (extracted.operatingProfitBeforeWcCr === null && ROW_PATTERNS.operatingProfitBeforeWc.test(line)) {
      extracted.operatingProfitBeforeWcCr = round2(nums[0] * f);
    } else if (extracted.inventoryChangeCr === null && ROW_PATTERNS.inventory.test(line)) {
      extracted.inventoryChangeCr = round2(nums[0] * f);
    } else if (extracted.receivablesChangeCr === null && ROW_PATTERNS.receivables.test(line)) {
      extracted.receivablesChangeCr = round2(nums[0] * f);
    } else if (extracted.payablesChangeCr === null && ROW_PATTERNS.payables.test(line)) {
      extracted.payablesChangeCr = round2(nums[0] * f);
    } else if (extracted.cashGeneratedOpsCr === null && ROW_PATTERNS.cashGeneratedOps.test(line)) {
      extracted.cashGeneratedOpsCr = round2(nums[0] * f);
    } else if (extracted.taxesPaidCr === null && ROW_PATTERNS.taxesPaid.test(line)) {
      extracted.taxesPaidCr = round2(nums[0] * f);
    } else if (extracted.capexCr === null && ROW_PATTERNS.capex.test(line)) {
      extracted.capexCr = round2(Math.abs(nums[0]) * f);
    }
  }

  if (extracted.operatingCashFlowCr !== null && extracted.capexCr !== null) {
    extracted.freeCashFlowCr = round2(extracted.operatingCashFlowCr - extracted.capexCr);
  }

  // Working Capital Drain evaluation
  if (extracted.operatingProfitBeforeWcCr && extracted.inventoryChangeCr !== null) {
    if (extracted.inventoryChangeCr < 0 && Math.abs(extracted.inventoryChangeCr) > 0.5 * Math.abs(extracted.operatingProfitBeforeWcCr)) {
      extracted.isWorkingCapitalDrain = true;
    }
  }

  return extracted;
}

/**
 * Extracts and de-composes earnings quality, isolating Other Income, Hyperinflation, and Attributable PAT.
 * @param {string} pdfText Raw filing text
 * @param {object} [primaryFinancials] Already extracted deterministic financials
 */
export function extractEarningsQualityMetrics(pdfText = "", primaryFinancials = null) {
  if (!pdfText || typeof pdfText !== "string") return null;

  const lines = pdfText.split("\n").map(l => l.trim()).filter(Boolean);
  const result = {
    otherIncomeCr: null,
    otherIncomePctOfPbt: null,
    hyperinflationGainCr: null,
    exceptionalNetCr: null,
    patAttributableCr: null,
    minorityInterestCr: null,
    coreOperatingProfitCr: null,
    coreOperatingMarginPct: null,
    marginFlatteryBps: null
  };

  // 1. Other income search - prioritize consolidated column
  for (let i = 0; i < lines.length; i++) {
    if (/^\W*(?:ii\b|2\b|\bother\s+income\b)/i.test(lines[i]) && /other\s+income/i.test(lines[i])) {
      const nums = parseNumbersFromLine(lines[i]);
      if (nums.length >= 1) {
        const unit = detectSectionUnit(lines, i);
        // If row has multiple numbers (e.g. standalone and consolidated columns), take the largest or matching column
        const val = nums.length > 2 && nums[2] > nums[0] ? nums[2] : nums[0];
        result.otherIncomeCr = round2(val * unit.factor);
        break;
      }
    }
  }

  // 2. Hyperinflation Monetary Gain search (Ind AS 29 / IAS 29)
  for (let i = 0; i < lines.length; i++) {
    if (/hyper\s*inflation|monetary\s+gain.*(?:hyper|inflation)/i.test(lines[i])) {
      const nums = parseNumbersFromLine(lines[i]);
      if (nums.length >= 1) {
        const unit = detectSectionUnit(lines, i);
        result.hyperinflationGainCr = round2(Math.abs(nums[0]) * unit.factor);
        break;
      }
    }
  }

  // 3. Compare with primary financials if provided
  if (primaryFinancials) {
    const pat = primaryFinancials.patConsolidated || primaryFinancials.patStandalone;
    const rev = primaryFinancials.revenue;
    const ebitda = primaryFinancials.ebitda;

    if (result.otherIncomeCr && primaryFinancials.pbt) {
      result.otherIncomePctOfPbt = round2((result.otherIncomeCr / primaryFinancials.pbt) * 100);
    }

    if (primaryFinancials.patAttributable && pat) {
      result.patAttributableCr = primaryFinancials.patAttributable;
      result.minorityInterestCr = round2(pat - primaryFinancials.patAttributable);
    }

    if (ebitda && rev) {
      let coreEbitda = ebitda;
      if (result.hyperinflationGainCr) {
        coreEbitda -= result.hyperinflationGainCr;
      }
      result.coreOperatingProfitCr = round2(coreEbitda);
      result.coreOperatingMarginPct = round2((coreEbitda / rev) * 100);
      const reportedMargin = primaryFinancials.ebitdaMarginPct || round2((ebitda / rev) * 100);
      if (reportedMargin && result.coreOperatingMarginPct) {
        result.marginFlatteryBps = Math.round((reportedMargin - result.coreOperatingMarginPct) * 100);
      }
    }
  }

  return result;
}

/**
 * Formats a clean, high-impact Telegram block for Cash Flow and Earnings Quality.
 * @param {object} cf Parsed cash flow metrics
 * @param {object} eq Parsed earnings quality metrics
 * @param {number} [patCr] Profit after tax for cash conversion calculation
 * @returns {string} Formatted markdown text
 */
export function formatCashFlowAndQualitySection(cf, eq, patCr = null) {
  if (!cf && !eq) return "";

  const lines = [];

  // Cash flow block
  if (cf && cf.operatingCashFlowCr !== null) {
    const priorStr = cf.operatingCashFlowPriorCr !== null ? ` _(vs ₹${cf.operatingCashFlowPriorCr} Cr a year ago)_` : "";
    lines.push(`• *Net Operating Cash Flow (H1):* ₹${cf.operatingCashFlowCr} Cr${priorStr}`);

    if (patCr && patCr > 0) {
      const conv = round2((cf.operatingCashFlowCr / patCr) * 100);
      const isWeak = conv < 40;
      const emoji = isWeak ? "⚠️" : "✅";
      lines.push(`• *Cash Conversion:* ${emoji} ${conv}% of Profit _(₹${cf.operatingCashFlowCr} Cr OCF / ₹${patCr} Cr PAT)_`);
    }

    if (cf.inventoryChangeCr !== null && cf.inventoryChangeCr < 0) {
      lines.push(`• *Working Capital Absorption:* ₹${Math.abs(cf.inventoryChangeCr)} Cr absorbed by inventory buildup`);
    }

    if (cf.freeCashFlowCr !== null) {
      const fcfEmoji = cf.freeCashFlowCr >= 0 ? "🟢" : "🔴";
      lines.push(`• *Free Cash Flow:* ${fcfEmoji} ₹${cf.freeCashFlowCr} Cr _(Capex: ₹${cf.capexCr || 0} Cr)_`);
    }
  }

  // Earnings quality block
  if (eq) {
    if (eq.otherIncomeCr !== null && eq.otherIncomeCr > 5) {
      const pbtShare = eq.otherIncomePctOfPbt ? ` (${eq.otherIncomePctOfPbt}% of PBT)` : "";
      lines.push(`• *Other Income:* ₹${eq.otherIncomeCr} Cr${pbtShare} _(treasury/interest component)_`);
    }

    if (eq.hyperinflationGainCr !== null && eq.hyperinflationGainCr > 0) {
      lines.push(`• *Accounting Note:* ₹${eq.hyperinflationGainCr} Cr one-off monetary gain from hyperinflation accounting (Ind AS 29)`);
    }

    if (eq.minorityInterestCr !== null && eq.minorityInterestCr > 5) {
      lines.push(`• *Shareholder PAT vs Total:* ₹${eq.patAttributableCr} Cr attributable to owners _(₹${eq.minorityInterestCr} Cr minority share)_`);
    }

    if (eq.marginFlatteryBps && eq.marginFlatteryBps > 100) {
      lines.push(`• *Margin Audit:* Reported margin flattered by ~${eq.marginFlatteryBps} bps due to non-operating credits`);
    }
  }

  if (lines.length === 0) return "";
  return `\n💸 *CASH FLOW & EARNINGS QUALITY AUDIT:*\n${lines.join("\n")}\n`;
}

