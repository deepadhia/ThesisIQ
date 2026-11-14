/**
 * Structured Order Book & Backlog Extractor
 *
 * Deterministically parses order book metrics (total, standalone, consolidated, inflows, exports)
 * and computes book-to-bill execution multiples against trailing annual revenue.
 */

function parseAmountToCr(amountStr, unitStr) {
  if (!amountStr || !unitStr) return null;
  const num = parseFloat(amountStr.replace(/,/g, ""));
  if (isNaN(num)) return null;

  const unit = (unitStr || "").toLowerCase();
  if (unit.includes("lakh") || unit.includes("lac")) {
    return Math.round((num / 100) * 100) / 100; // convert lakhs to crores
  }
  if (unit.includes("million") || /^(mn|mln)$/.test(unit)) return Math.round((num / 10) * 100) / 100;
  if (unit.includes("billion") || unit === "bn") return Math.round((num * 100) * 100) / 100;
  return num; // explicit crores
}

export function extractOrderBookMetrics(text, { trailingRevenueCr = null } = {}) {
  if (typeof text !== "string" || !text.trim()) {
    return {
      orderBookStandaloneCr: null,
      orderBookConsolidatedCr: null,
      orderBookTotalCr: null,
      orderInflowCr: null,
      exportOrderBookCr: null,
      bookToBill: null,
      line: null
    };
  }

  let orderBookStandaloneCr = null;
  let orderBookConsolidatedCr = null;
  let orderBookTotalCr = null;
  let exportOrderBookCr = null;
  let orderInflowCr = null;

  // 1. Standalone Order Book
  const saMatch = /(?:standalone\s+order\s*(?:book|backlog)|order\s*(?:book|backlog)\s*(?:stood\s+at\s+)?(?:[₹rs.]*|inr\s*)?[\d,.]+\s*(?:cr\w*|lakh\w*)?\s*standalone)\s*(?:stood\s+at|is|was|were|stands\s+at|of|reached|at)?\s*(?:[₹rs.]*|inr\s*)?\s*([\d,]+(?:\.\d+)?)\s*(cr(?:ores?)?|lakhs?|lacs?|millions?|mn|mln|billions?|bn)\b/i.exec(text);
  if (saMatch) {
    orderBookStandaloneCr = parseAmountToCr(saMatch[1], saMatch[2]);
  } else {
    // Secondary pattern: "standalone order book of ₹3,937.00 Cr"
    const sa2 = /standalone\s+order\s*(?:book|backlog)\s*(?:of|at|stood\s+at|is|was|were|stands\s+at|reached)?\s*(?:[₹rs.]*|inr\s*)?\s*([\d,]+(?:\.\d+)?)\s*(cr(?:ores?)?|lakhs?|lacs?|millions?|mn|mln|billions?|bn)\b/i.exec(text);
    if (sa2) orderBookStandaloneCr = parseAmountToCr(sa2[1], sa2[2]);
  }

  // 2. Consolidated Order Book
  const conMatch = /consolidated\s+order\s*(?:book|backlog)\s*(?:of|at|stood\s+at|is|was|were|stands\s+at|reached)?\s*(?:[₹rs.]*|inr\s*)?\s*([\d,]+(?:\.\d+)?)\s*(cr(?:ores?)?|lakhs?|lacs?|millions?|mn|mln|billions?|bn)\b/i.exec(text);
  if (conMatch) {
    orderBookConsolidatedCr = parseAmountToCr(conMatch[1], conMatch[2]);
  } else {
    const con2 = /(?:order\s*(?:book|backlog)[^.]*?\(\s*consolidated\s*(?:[₹rs.]*|inr\s*)?\s*([\d,]+(?:\.\d+)?)\s*(cr(?:ores?)?|lakhs?|lacs?|millions?|mn|mln|billions?|bn)\s*\))/i.exec(text);
    if (con2) orderBookConsolidatedCr = parseAmountToCr(con2[1], con2[2]);
  }

  // 3. Export Order Book
  const expMatch = /export\s+order\s*(?:book|backlog)\s*(?:of|is|was|at|stood\s+at|reached)?\s*(?:[₹rs.]*|inr\s*)?\s*([\d,]+(?:\.\d+)?)\s*(cr(?:ores?)?|lakhs?|lacs?|millions?|mn|mln|billions?|bn)\b/i.exec(text);
  if (expMatch) {
    exportOrderBookCr = parseAmountToCr(expMatch[1], expMatch[2]);
  }

  // 4. Order Inflows
  const inflowMatch = /(?:order\s+inflows?|inflows?\s+for\s+the\s+quarter|new\s+orders?\s+received|orders?\s+booked)(?:[^.\n]{0,80}?)(?:stood\s+at|of|were|was|is|are|totaled|reached|at|:)\s*(?:[₹rs.]*|inr\s*)?\s*([\d,]+(?:\.\d+)?)\s*(cr(?:ores?)?|lakhs?|lacs?|millions?|mn|mln|billions?|bn)\b/i.exec(text);
  if (inflowMatch) {
    orderInflowCr = parseAmountToCr(inflowMatch[1], inflowMatch[2]);
  } else {
    const directInflow = /(?:order\s+inflows?|inflows?\s+for\s+the\s+quarter|new\s+orders?\s+received|orders?\s+booked)\s*(?:[₹rs.]*|inr\s*)?\s*([\d,]+(?:\.\d+)?)\s*(cr(?:ores?)?|lakhs?|lacs?|millions?|mn|mln|billions?|bn)\b/i.exec(text);
    if (directInflow) orderInflowCr = parseAmountToCr(directInflow[1], directInflow[2]);
  }

  // 5. Generic / Total Order Book if standalone/consolidated wasn't explicitly tagged
  if (!orderBookStandaloneCr && !orderBookConsolidatedCr) {
    const genMatch = /(?:total\s+)?order\s*(?:book|backlog)\s*(?:position\s*)?(?:stands\s+at|stood\s+at|is|was|were|reached|of|at|remains)?\s*(?:[₹rs.]*|inr\s*)?\s*([\d,]+(?:\.\d+)?)\s*(cr(?:ores?)?|lakhs?|lacs?|millions?|mn|mln|billions?|bn)\b/i.exec(text);
    if (genMatch) {
      orderBookTotalCr = parseAmountToCr(genMatch[1], genMatch[2]);
    }
  } else {
    orderBookTotalCr = orderBookConsolidatedCr || orderBookStandaloneCr;
  }

  // Book-to-Bill multiple
  let bookToBill = null;
  const trailingRev = Number(trailingRevenueCr);
  if (orderBookTotalCr && Number.isFinite(trailingRev) && trailingRev > 0) {
    bookToBill = Math.round((orderBookTotalCr / trailingRev) * 100) / 100;
  }

  // Formatted Alert Line
  let line = null;
  if (orderBookTotalCr || orderBookStandaloneCr || orderBookConsolidatedCr) {
    const parts = [];
    const fmtCr = (n) => n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
    if (orderBookStandaloneCr && orderBookConsolidatedCr && orderBookStandaloneCr !== orderBookConsolidatedCr) {
      parts.push(`₹${fmtCr(orderBookStandaloneCr)} Cr (standalone) | ₹${fmtCr(orderBookConsolidatedCr)} Cr (consolidated)`);
    } else {
      const tot = orderBookTotalCr || orderBookConsolidatedCr || orderBookStandaloneCr;
      parts.push(`₹${fmtCr(tot)} Cr`);
    }

    if (exportOrderBookCr) {
      parts.push(`Exports: ₹${exportOrderBookCr.toLocaleString("en-IN")} Cr`);
    }
    if (orderInflowCr) {
      parts.push(`Inflows: ₹${orderInflowCr.toLocaleString("en-IN")} Cr`);
    }
    if (bookToBill) {
      parts.push(`Book-to-Bill: ${bookToBill.toFixed(1)}x`);
    }

    line = `📦 *Order Book:* ${parts.join(" • ")}`;
  }

  return {
    orderBookStandaloneCr,
    orderBookConsolidatedCr,
    orderBookTotalCr,
    orderInflowCr,
    exportOrderBookCr,
    bookToBill,
    line
  };
}
