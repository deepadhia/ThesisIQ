/**
 * Deterministic Financial Validator & EBITDA Engine
 * 
 * Programmatically extracts, validates, and computes key financial metrics
 * (Revenue, EBITDA, EBITDA Margin %, Consolidated PAT, Segment EBIT) directly
 * from parsed financial statement table text.
 */

/**
 * Extracts and computes financial metrics from raw PDF text.
 * @param {string} pdfText Raw text extracted from PDF
 * @returns {object} Financial metrics object
 */
export function extractDeterministicFinancials(pdfText = "") {
  if (!pdfText || typeof pdfText !== "string") {
    return null;
  }

  const lines = pdfText.split("\n").map(l => l.trim()).filter(Boolean);
  const fullTextLower = pdfText.toLowerCase();

  const isFinancialResult = 
    fullTextLower.includes("statement of unaudited") || 
    fullTextLower.includes("statement of audited") || 
    fullTextLower.includes("financial results") || 
    fullTextLower.includes("revenue from operations") ||
    fullTextLower.includes("profit before tax");

  if (!isFinancialResult) {
    return null;
  }

  const result = {
    isFinancialResult: true,
    revenue: null,
    revenueYoYGrowthPct: null,
    ebitda: null,
    ebitdaMarginPct: null,
    ebitdaYoYGrowthPct: null,
    ebitdaMarginBpsDelta: null,
    patStandalone: null,
    patConsolidated: null,
    patAttributable: null,
    patYoYGrowthPct: null,
    isYoYDecline: false,
    isMarginErosion: false,
    segmentRedFlags: []
  };

  // Helper to parse numbers and detect unit scale (Millions vs Lakhs vs Crores)
  const isMillions = fullTextLower.includes("in million") || fullTextLower.includes("rs. millions") || fullTextLower.includes("in mn") || fullTextLower.includes("in rs. millions");
  const isLakhs = !isMillions && (fullTextLower.includes("lakh") || fullTextLower.includes("lacs") || fullTextLower.includes("in lac"));

  // Consolidated Statement Slicer: Prioritize Consolidated Financial Results Table if present
  let incomeStatementLines = lines;
  const isConsolidatedMentioned = 
    fullTextLower.includes("consolidated") && 
    (fullTextLower.includes("statement of consolidated") || 
     fullTextLower.includes("consolidated financial results") || 
     fullTextLower.includes("consolidated unaudited") || 
     fullTextLower.includes("consolidated audited") ||
     fullTextLower.includes("consolidated statement of profit and loss"));

  if (isConsolidatedMentioned) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isNumberedList = /^\s*\d+[\.\)]/i.test(line);
      // Heading must specify consolidated results/P&L and NOT be a cover letter, notice, resolution, or audit report
      const isConsolidatedHeading = 
        !isNumberedList &&
        /(?:statement\s+of\s+consolidated\s+(?:un-?audited|audited)?\s*financial\s+results|consolidated\s+(?:un-?audited|audited)?\s*financial\s+results|consolidated\s+statement\s+of\s+profit\s+and\s+loss|statement\s+of\s+profit\s+and\s+loss\s+\(consolidated\))/i.test(line) &&
        !/(?:report|auditor|independent\s+auditor|limited\s+review|notice|outcome|covering|board\s+meeting|agenda|submission\s+of|approved\s+the|taken\s+on\s+record|resolution|pursuant\s+to|we\s+have\s+reviewed|item\s+no)/i.test(line);

      if (isConsolidatedHeading) {
        // Lookahead up to 35 lines for core income statement line items
        const hasIncomeRows = lines.slice(i + 1, i + 35).some(subLine => 
          /(?:revenue\s+from\s+operations|income\s+from\s+operations|total\s+income|cost\s+of\s+materials|expenses)/i.test(subLine)
        );

        if (hasIncomeRows) {
          incomeStatementLines = lines.slice(i);
          break;
        }
      }
    }
  }

  const parseRowNumbers = (linePattern, sourceLines = incomeStatementLines) => {
    for (let i = 0; i < sourceLines.length; i++) {
      // Guard against matching giant multi-line narrative paragraphs (> 400 chars)
      if (sourceLines[i].length > 400) continue;

      if (linePattern.test(sourceLines[i])) {
        // Search current line and next 2 lines for column numbers
        const textToSearch = `${sourceLines[i]} ${sourceLines[i + 1] || ""} ${sourceLines[i + 2] || ""}`;
        
        // Remove CIN numbers, BSE codes, phone numbers, dates, 4-digit years, PIN codes, item numbers, and arithmetic references (e.g. "(3-4)")
        const sanitized = textToSearch
          .replace(/^\s*\d+[\s\|\.\)]\s*/, "") // Leading item number (e.g. "5|", "3|", "1. ")
          .replace(/\(\s*\d+\s*[-–+]\s*\d+\s*\)/g, "") // Arithmetic column formula references like (3-4) or (1-2)
          .replace(/\bL\d{5}[A-Z0-9]+\b/gi, "") // Any CIN number (e.g. L40109TG1986PLC006745)
          .replace(/\b5\d{5}\b/g, "") // 6-digit BSE code
          .replace(/\b400\s*\d{3}\b/g, "") // Pin code
          .replace(/\b(?:\+?91[\-\s]?)?[6-9]\d{9}\b/g, "") // 10-digit mobile numbers
          .replace(/\b\d{3,5}[\-\s]\d{6,8}\b/g, "") // Landline/STD numbers
          .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi, "") // Full Date (e.g. August 08, 2026)
          .replace(/\b\d{2}[\/\.-]\d{2}[\/\.-]\d{4}\b/g, "") // Date dd/mm/yyyy
          .replace(/\b20\d{2}\b/g, ""); // 4-digit years (e.g. 2026)

        const matches = sanitized.match(/-?\d+(?:,\d+)*(?:\.\d+)?/g);
        if (matches) {
          let numbers = matches
            .map(m => parseFloat(m.replace(/,/g, "")))
            .filter(n => !isNaN(n) && Math.abs(n) > 0.05 && Math.abs(n) < 50000000 && n !== 517271);
          
          // Drop single-digit note reference numbers (e.g. Note 9, 1, 2) when followed by financial numbers
          if (numbers.length >= 2 && numbers[0] < 15 && Number.isInteger(numbers[0]) && numbers[1] > 15) {
            numbers = numbers.slice(1);
          }

          if (numbers.length >= 1) {
            // Convert Millions or Lakhs to Crores
            return numbers.map(n => {
              if (isMillions) {
                if (n > 1000000) return parseFloat((n / 1000).toFixed(2));
                return parseFloat((n / 10).toFixed(2));
              }
              if (isLakhs) {
                // If 2 decimal places were stripped by PDF font encoding (e.g. 12107624 instead of 121076.24)
                if (n > 1000000) return parseFloat((n / 10000).toFixed(2));
                return parseFloat((n / 100).toFixed(2));
              }
              return n;
            });
          }
        }
      }
    }
    return null;
  };

  // 1. Revenue / Sales from Operations (YoY & QoQ Engine)
  let revNumbers = parseRowNumbers(/(?:sales\/income\s+from\s+operations|revenue\s+from\s+operations|total\s+income|income\s+from\s+operations|^I\.\s*[\d,])/i);
  // Fail-safe: If consolidated slice failed to locate revenue, fallback to entire document
  if (!revNumbers && incomeStatementLines !== lines) {
    revNumbers = parseRowNumbers(/(?:sales\/income\s+from\s+operations|revenue\s+from\s+operations|total\s+income|income\s+from\s+operations|^I\.\s*[\d,])/i, lines);
  }
  if (revNumbers && revNumbers.length >= 1) {
    result.revenue = revNumbers[0];
    
    // Detect if column 1 is a 6-month half-year total (H1) rather than sequential 3-month quarter
    const isCol1HalfYear = revNumbers.length >= 4 && revNumbers[1] > 1.7 * revNumbers[0];
    const seqRev = isCol1HalfYear ? null : revNumbers[1];
    const yoyRev = isCol1HalfYear ? revNumbers[3] : revNumbers[2];

    if (seqRev && seqRev > 0) {
      result.revenueQoQGrowthPct = parseFloat((((result.revenue - seqRev) / seqRev) * 100).toFixed(2));
    }
    if (yoyRev && yoyRev > 0) {
      result.revenueYoYGrowthPct = parseFloat((((result.revenue - yoyRev) / yoyRev) * 100).toFixed(2));
    }
  }

  // 2. Segment Results & Red Flag Table Parser
  const segResultsStart = lines.findIndex(l => /segment\s+results/i.test(l));
  if (segResultsStart !== -1) {
    for (let i = segResultsStart; i < Math.min(segResultsStart + 25, lines.length); i++) {
      const line = lines[i];
      const matches = line.match(/(industrial\s+batteries|defence\s*&\s*aviation|electronics|batteries|defence)/i);
      if (matches) {
        const segName = matches[1].toUpperCase();
        const sanitizedLine = line.replace(/^\s*\d+[\.\)]\s*/, "");
        const nums = sanitizedLine.match(/-?\d+(?:,\d+)*(?:\.\d+)?/g);
        if (nums && nums.length >= 3) {
          const curVal = parseFloat(nums[0].replace(/,/g, ""));
          const prevYrVal = parseFloat(nums[2].replace(/,/g, ""));
          if (!isNaN(curVal) && !isNaN(prevYrVal) && prevYrVal > 0) {
            const yoyChangePct = parseFloat((((curVal - prevYrVal) / prevYrVal) * 100).toFixed(1));
            if (yoyChangePct < -15.0) {
              result.segmentRedFlags.push({
                segment: segName,
                currentValue: curVal,
                prevValue: prevYrVal,
                yoyDeclinePct: yoyChangePct
              });
              result.isYoYDecline = true;
            }
          }
        }
      }
    }
  }

  // 3. Profit Before Tax (PBT) & EBITDA Engine (YoY & QoQ)
  const pbtNumbers = parseRowNumbers(/(?:total\s+profit\s+before\s+tax|profit\s+before\s+tax|pbt\b)/i);
  const finNumbers = parseRowNumbers(/(?:finance\s+costs|interest\s+expense)/i);
  const depNumbers = parseRowNumbers(/(?:depreciation|amortisation)/i);

  if (pbtNumbers && pbtNumbers.length >= 1) {
    const isPbtCol1HalfYear = pbtNumbers.length >= 4 && pbtNumbers[1] > 1.7 * pbtNumbers[0];
    const currentPbt = pbtNumbers[0];
    const currentFin = (finNumbers && finNumbers.length >= 1) ? finNumbers[0] : 0;
    const currentDep = (depNumbers && depNumbers.length >= 1) ? depNumbers[0] : 0;

    result.ebitda = parseFloat((currentPbt + currentFin + currentDep).toFixed(2));

    if (result.revenue && result.revenue > 0) {
      result.ebitdaMarginPct = parseFloat(((result.ebitda / result.revenue) * 100).toFixed(2));
    }

    if (!isPbtCol1HalfYear && pbtNumbers.length >= 2) {
      const seqPbt = pbtNumbers[1];
      const seqFin = (finNumbers && finNumbers.length >= 2) ? finNumbers[1] : 0;
      const seqDep = (depNumbers && depNumbers.length >= 2) ? depNumbers[1] : 0;
      const seqEbitda = seqPbt + seqFin + seqDep;
      if (seqEbitda > 0) {
        result.ebitdaQoQGrowthPct = parseFloat((((result.ebitda - seqEbitda) / seqEbitda) * 100).toFixed(2));
      }
    }

    const prevPbtIdx = isPbtCol1HalfYear ? 3 : 2;
    if (pbtNumbers.length > prevPbtIdx && result.revenue) {
      const prevPbt = pbtNumbers[prevPbtIdx];
      const prevFin = (finNumbers && finNumbers.length > prevPbtIdx) ? finNumbers[prevPbtIdx] : 0;
      const prevDep = (depNumbers && depNumbers.length > prevPbtIdx) ? depNumbers[prevPbtIdx] : 0;
      const prevEbitda = prevPbt + prevFin + prevDep;
      const prevRev = (revNumbers && revNumbers.length > prevPbtIdx) ? revNumbers[prevPbtIdx] : null;

      if (prevEbitda > 0) {
        result.ebitdaYoYGrowthPct = parseFloat((((result.ebitda - prevEbitda) / prevEbitda) * 100).toFixed(2));
      }
      if (prevRev && prevRev > 0) {
        const prevMargin = (prevEbitda / prevRev) * 100;
        result.ebitdaMarginBpsDelta = Math.round((result.ebitdaMarginPct - prevMargin) * 100);
        if (result.ebitdaMarginBpsDelta < -100) {
          result.isMarginErosion = true;
        }
      }
      // PBT YoY Contraction Check
      const pbtYoY = ((currentPbt - prevPbt) / prevPbt) * 100;
      if (pbtYoY < -10.0) {
        result.isYoYDecline = true;
      }
    }
  }

  // 4. Consolidated PAT & Exceptional Items Engine (YoY & QoQ)
  let patNumbers = parseRowNumbers(/(?:(?:net\s+)?profit\s+(?:\(loss\)\s+)?for\s+the\s+period|profit\s+attributable\s+to\s+owners|profit\s+after\s+tax|net\s+profit\s+after\s+tax)/i);
  // Fail-safe: If consolidated slice didn't find PAT line, fallback to document
  if (!patNumbers && incomeStatementLines !== lines) {
    patNumbers = parseRowNumbers(/(?:(?:net\s+)?profit\s+(?:\(loss\)\s+)?for\s+the\s+period|profit\s+attributable\s+to\s+owners|profit\s+after\s+tax|net\s+profit\s+after\s+tax)/i, lines);
  }

  if (patNumbers && patNumbers.length >= 1) {
    const isPatCol1HalfYear = patNumbers.length >= 4 && patNumbers[1] > 1.7 * patNumbers[0];
    result.patAttributable = patNumbers[0];
    result.patConsolidated = patNumbers[0];

    if (!isPatCol1HalfYear && patNumbers.length >= 2 && patNumbers[1] > 0) {
      result.patQoQGrowthPct = parseFloat((((result.patAttributable - patNumbers[1]) / patNumbers[1]) * 100).toFixed(2));
    }

    const prevPatIdx = isPatCol1HalfYear ? 3 : 2;
    if (patNumbers.length > prevPatIdx && patNumbers[prevPatIdx] > 0) {
      const prevYearPat = patNumbers[prevPatIdx];
      const rawPatYoY = parseFloat((((result.patAttributable - prevYearPat) / prevYearPat) * 100).toFixed(2));
      // Annual column mismatch safeguard: If PAT appears to drop >75% but revenue growth is positive/flat, it's comparing a 3-month quarter against a 12-month annual column.
      if (rawPatYoY < -75.0 && (result.revenueYoYGrowthPct === null || result.revenueYoYGrowthPct > -10.0)) {
        console.warn(`[FINANCIAL VALIDATOR] Rejected annual column PAT mismatch (${rawPatYoY}%). Leaving patYoYGrowthPct clean.`);
        result.patYoYGrowthPct = null;
      } else {
        result.patYoYGrowthPct = rawPatYoY;
        if (result.patYoYGrowthPct < -5.0) {
          result.isYoYDecline = true;
        }
      }
    }
  }

  // Populate patStandalone if standalone section exists earlier in document
  if (incomeStatementLines !== lines) {
    const standalonePat = parseRowNumbers(/(?:(?:net\s+)?profit\s+(?:\(loss\)\s+)?for\s+the\s+period|profit\s+after\s+tax|net\s+profit\s+after\s+tax)/i, lines);
    if (standalonePat && standalonePat.length >= 1) {
      result.patStandalone = standalonePat[0];
    }
  } else {
    result.patStandalone = result.patConsolidated;
  }

  // Pure standalone fallback: If patConsolidated is null but patStandalone exists
  if (result.patConsolidated === null && result.patStandalone !== null) {
    result.patConsolidated = result.patStandalone;
    result.patAttributable = result.patStandalone;
  }

  // Exceptional Items & Normalised PAT Computation (Fully Dynamic)
  let exceptionalDescription = null;
  // Match explicit exceptional item line and prevent false match on "profit before exceptional item"
  const excNumbers = parseRowNumbers(/^(?!.*(?:profit|loss)\s+before).*?(?:exceptional\s+(?:item|gain|loss)|profit\s+on\s+sale\s+of\s+asset|non-recurring\s+gain)/i);
  if (excNumbers && excNumbers.length >= 1) {
    result.exceptionalGain = excNumbers[0];
  }

  const excLineMatch = pdfText.match(/(?:(?<!(?:profit|loss)\s+before\s+)exceptional\s+(?:item|gain)|profit\s+on\s+sale\s+of\s+[^\n.,]+)/i);
  if (excLineMatch) {
    exceptionalDescription = excLineMatch[0].trim();
  }
  result.exceptionalDescription = exceptionalDescription;

  if (result.patConsolidated !== null && result.exceptionalGain !== null) {
    result.normalisedPat = parseFloat((result.patConsolidated - result.exceptionalGain).toFixed(2));
    if (patNumbers && patNumbers.length >= 3 && patNumbers[2] > 0) {
      const prevPat = patNumbers[2];
      result.normalisedPatYoYGrowthPct = parseFloat((((result.normalisedPat - prevPat) / prevPat) * 100).toFixed(1));
    }
  }

  // Segment Red Flag Scanner (detects segment EBIT declines > 20% YoY)
  const segmentKeywords = ["electronics", "batteries", "defence", "aviation", "real estate", "data center", "cloud", "cables", "towers"];
  for (const kw of segmentKeywords) {
    if (fullTextLower.includes(kw)) {
      const reg = new RegExp(`${kw}.*?(-?\\d+(?:,\\d+)*(?:\\.\\d+)?)`, "i");
      const match = pdfText.match(reg);
      if (match) {
        // Match segment lines for YoY contraction
        const segLineIdx = lines.findIndex(l => l.toLowerCase().includes(kw));
        if (segLineIdx !== -1 && segLineIdx < lines.length) {
          const rawLine1 = (lines[segLineIdx] || "").replace(/^\s*\d+[\.\)]\s*/, "");
          const rawLine2 = (lines[segLineIdx + 1] || "").replace(/^\s*\d+[\.\)]\s*/, "");
          const numbers = rawLine1.match(/-?\d+(?:,\d+)*(?:\.\d+)?/g) || rawLine2.match(/-?\d+(?:,\d+)*(?:\.\d+)?/g);
          if (numbers && numbers.length >= 3) {
            const currentSeg = parseFloat(numbers[0].replace(/,/g, ""));
            const prevSeg = parseFloat(numbers[2].replace(/,/g, ""));
            if (!isNaN(currentSeg) && !isNaN(prevSeg) && prevSeg > 0) {
              const segYoY = ((currentSeg - prevSeg) / prevSeg) * 100;
              if (segYoY < -20) {
                // Avoid duplicate segment flags
                if (!result.segmentRedFlags.some(f => f.segment.includes(kw.toUpperCase()))) {
                  result.segmentRedFlags.push({
                    segment: kw.toUpperCase(),
                    currentValue: currentSeg,
                    prevValue: prevSeg,
                    yoyDeclinePct: parseFloat(segYoY.toFixed(1))
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  // 5. Sanity Check Filter: Reject garbled/corrupted extractions (e.g. from scanned image PDFs or column misalignments)
  if (result.revenue !== null) {
    if (result.revenue > 30000 || result.revenue < 1) {
      console.warn(`[FINANCIAL VALIDATOR] Rejected out-of-bounds revenue (₹${result.revenue} Cr). Falling back to LLM.`);
      return null;
    }
    if (result.revenueYoYGrowthPct !== null && (result.revenueYoYGrowthPct > 500 || result.revenueYoYGrowthPct < -95)) {
      console.warn(`[FINANCIAL VALIDATOR] Rejected garbled YoY revenue growth (${result.revenueYoYGrowthPct}%). Falling back to LLM.`);
      return null;
    }
    if (result.ebitdaMarginPct !== null && (result.ebitdaMarginPct > 95 || result.ebitdaMarginPct < 1.0)) {
      console.warn(`[FINANCIAL VALIDATOR] Rejected garbled EBITDA margin (${result.ebitdaMarginPct}%). Falling back to LLM.`);
      return null;
    }
    if (result.patConsolidated !== null && (result.patConsolidated > result.revenue || result.patConsolidated < -10000)) {
      console.warn(`[FINANCIAL VALIDATOR] Rejected garbled PAT (₹${result.patConsolidated} Cr vs Revenue ₹${result.revenue} Cr). Falling back to LLM.`);
      return null;
    }
  }

  return result;
}
