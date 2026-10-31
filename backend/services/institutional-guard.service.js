/**
 * Post-Processing Institutional Guard Layer
 * 
 * Enforces hard-coded financial rules, mandatory YoY precedence, segment red flag floor,
 * action signal calibration, and multi-stage regulatory status rules over LLM outputs.
 */

/**
 * Validates and refines LLM analysis using deterministic financial guardrails.
 * @param {object} llmOutput Extracted LLM JSON output
 * @param {object} financialData Deterministic financial metrics from validator
 * @param {string} title Filing title
 * @param {string} ticker Stock ticker
 * @returns {object} Validated institutional output
 */
export function applyInstitutionalGuard(llmOutput = {}, financialData = null, title = "", ticker = "") {
  if (!llmOutput || typeof llmOutput !== "object") {
    return llmOutput;
  }

  const guarded = { ...llmOutput };
  const titleLower = (title || "").toLowerCase();

  // 1. Multi-Stage Regulatory Commitment Guard (Rule 2 in AGENTS.md)
  if (guarded.commitments && Array.isArray(guarded.commitments)) {
    guarded.commitments = guarded.commitments.map(comm => {
      const stmtLower = (comm.statement || "").toLowerCase();
      const metricLower = (comm.metric || "").toLowerCase();
      const isOperationalOrFinancialTarget = 
        stmtLower.includes("capacity") ||
        stmtLower.includes("mw ") ||
        stmtLower.includes("mw;") ||
        stmtLower.includes("mtpa") ||
        stmtLower.includes("revenue") ||
        stmtLower.includes("margin") ||
        stmtLower.includes("product mix") ||
        stmtLower.includes("ebitda") ||
        metricLower.includes("capacity") ||
        metricLower.includes("capex") ||
        metricLower.includes("operational");

      const isStrictRegulatoryApproval = 
        (stmtLower.includes("scheme of arrangement") || 
         stmtLower.includes("nclt") || 
         stmtLower.includes("sebi approval") || 
         stmtLower.includes("amalgamation") || 
         stmtLower.includes("demerger") ||
         stmtLower.includes("regulatory approval") ||
         metricLower.includes("regulatory") ||
         metricLower.includes("demerger") ||
         metricLower.includes("nclt")) &&
        !isOperationalOrFinancialTarget;

      const isInitialBoardApproval = 
        titleLower.includes("outcome of board meeting") || 
        titleLower.includes("board meeting outcome") ||
        titleLower.includes("intimation under reg");

      const isFinalClearance = 
        titleLower.includes("court order") || 
        titleLower.includes("nclt order") || 
        titleLower.includes("sebi clearance") || 
        titleLower.includes("listing intimation") || 
        titleLower.includes("effective date");

      if (isStrictRegulatoryApproval && isInitialBoardApproval && !isFinalClearance) {
        return {
          ...comm,
          status: "Pending",
          blockers_and_risks: comm.blockers_and_risks || "Initial Board Approval granted; awaiting statutory shareholder/creditor approval and final NCLT sanction order."
        };
      }

      // Early Execution Guard: Mark 'Achieved Ahead of Schedule' if operational/financial target is met ahead of timeline
      const timelineLower = (comm.timeline || "").toLowerCase();
      const statusLower = (comm.status || "").toLowerCase();
      const isEarlyText = 
        stmtLower.includes("ahead of schedule") || 
        stmtLower.includes("ahead of timeline") || 
        stmtLower.includes("early commissioning") || 
        stmtLower.includes("achieved early") ||
        stmtLower.includes("ahead of target");
      
      const isFutureTargetYear = timelineLower.includes("fy28") || timelineLower.includes("fy29") || timelineLower.includes("fy30") || timelineLower.includes("fy27");

      if ((statusLower === "achieved" || statusLower.includes("achieved")) && (isEarlyText || isFutureTargetYear)) {
        return {
          ...comm,
          status: "Achieved Ahead of Schedule",
          credibility_impact: "high_positive",
          blockers_and_risks: comm.blockers_and_risks || "Target delivered ahead of original management guidance timeline."
        };
      }

      return comm;
    });
  }

  // 2. Financial Guardrails & YoY Precedence Guard (if deterministic financial data exists)
  if (financialData && financialData.isFinancialResult) {
    let summaryText = guarded.summary || guarded.verdict_summary || "";

    // A. Mandatory Financial Highlights & EBITDA Injection across ALL verdicts (YoY + QoQ)
    const revYoYStr = (financialData.revenueYoYGrowthPct !== null && financialData.revenueYoYGrowthPct !== undefined) ? `${financialData.revenueYoYGrowthPct >= 0 ? '+' : ''}${financialData.revenueYoYGrowthPct}% YoY` : null;
    const revQoQStr = (financialData.revenueQoQGrowthPct !== null && financialData.revenueQoQGrowthPct !== undefined) ? `${financialData.revenueQoQGrowthPct >= 0 ? '+' : ''}${financialData.revenueQoQGrowthPct}% QoQ` : null;
    const revStrParts = [revYoYStr, revQoQStr].filter(Boolean);

    const patYoYStr = (financialData.patYoYGrowthPct !== null && financialData.patYoYGrowthPct !== undefined) ? `${financialData.patYoYGrowthPct >= 0 ? '+' : ''}${financialData.patYoYGrowthPct}% YoY` : null;
    const patQoQStr = (financialData.patQoQGrowthPct !== null && financialData.patQoQGrowthPct !== undefined) ? `${financialData.patQoQGrowthPct >= 0 ? '+' : ''}${financialData.patQoQGrowthPct}% QoQ` : null;
    const patStrParts = [patYoYStr, patQoQStr].filter(Boolean);

    // Values are already normalised to Crores by the validator; never re-scale here.
    const safeRevenue = financialData.revenue ?? null;
    const safeEbitda = financialData.ebitda ?? null;
    const safePat = financialData.patAttributable ?? financialData.patConsolidated ?? null;

    guarded.financial_highlights = {
      revenue: safeRevenue !== null ? `₹${safeRevenue} Cr (${revStrParts.join(" | ") || 'N/A'})` : "N/A",
      revenue_yoy: revYoYStr || "N/A",
      revenue_qoq: revQoQStr || "N/A",
      ebitda: safeEbitda !== null ? `₹${safeEbitda} Cr` : "N/A",
      ebitda_margin: (financialData.ebitdaMarginPct !== null && financialData.ebitdaMarginPct !== undefined) ? `${financialData.ebitdaMarginPct}%` : "N/A",
      ebitda_margin_delta: (financialData.ebitdaMarginBpsDelta !== null && financialData.ebitdaMarginBpsDelta !== undefined) ? `${financialData.ebitdaMarginBpsDelta >= 0 ? '+' : ''}${financialData.ebitdaMarginBpsDelta} bps YoY` : "N/A",
      pat_consolidated: safePat !== null ? `₹${safePat} Cr (${patStrParts.join(" | ") || 'N/A'})` : "N/A",
      pat_yoy: patYoYStr || "N/A",
      pat_qoq: patQoQStr || "N/A"
    };

    if (safeEbitda !== null && financialData.ebitdaMarginPct !== null && financialData.ebitdaMarginPct !== undefined) {
      const ebitdaStr = `EBITDA: ₹${safeEbitda} Cr (Margin: ${financialData.ebitdaMarginPct}%${financialData.ebitdaMarginBpsDelta !== null ? `, ${financialData.ebitdaMarginBpsDelta >= 0 ? '+' : ''}${financialData.ebitdaMarginBpsDelta} bps YoY` : ''})`;
      if (!summaryText.includes("EBITDA")) {
        summaryText = `${summaryText} ${ebitdaStr}.`.trim();
      }
      if (guarded.key_drivers && Array.isArray(guarded.key_drivers)) {
        if (!guarded.key_drivers.some(d => d.includes("EBITDA"))) {
          guarded.key_drivers.unshift(`EBITDA: ₹${financialData.ebitda} Cr (${financialData.ebitdaMarginPct}% margin${financialData.ebitdaMarginBpsDelta !== null ? `, ${financialData.ebitdaMarginBpsDelta >= 0 ? '+' : ''}${financialData.ebitdaMarginBpsDelta} bps YoY` : ''})`);
        }
      }
    }

    // B. Mandatory YoY Precedence: Overrule QoQ sequential framing if YoY PAT/Margin contracts
    // (Only prepend if LLM summary does NOT report positive overall growth / strong results)
    const isSummaryPositive = /(?:strong|growing|growth|increased|robust|expansion|up\s+\d+%)/i.test(summaryText) && !summaryText.toLowerCase().includes("decline");
    
    if ((financialData.isYoYDecline || financialData.isMarginErosion) && !isSummaryPositive) {
      let yoyDeclineHeader = "🔴 YoY Earnings Contraction:";
      if (financialData.patYoYGrowthPct !== null && financialData.patYoYGrowthPct < -5) {
        yoyDeclineHeader += ` Consolidated PAT declined ${financialData.patYoYGrowthPct}% YoY (₹${financialData.patAttributable} Cr).`;
      }
      if (financialData.isMarginErosion && financialData.ebitdaMarginBpsDelta !== null) {
        yoyDeclineHeader += ` EBITDA Margin contracted ${financialData.ebitdaMarginBpsDelta} bps YoY to ${financialData.ebitdaMarginPct}%.`;
      }

      // Prepend YoY decline header so it cannot be buried
      if (!summaryText.toLowerCase().includes("yoy earnings contraction") && !summaryText.toLowerCase().includes("declined")) {
        summaryText = `${yoyDeclineHeader} ${summaryText}`.trim();
      }

      // Force impact/verdict to NEGATIVE or NEUTRAL
      if (guarded.impact) guarded.impact = "NEGATIVE";
    }

    // C. Segment Red Flag Scanner & Injection
    if (financialData.segmentRedFlags && financialData.segmentRedFlags.length > 0) {
      for (const flag of financialData.segmentRedFlags) {
        const flagMsg = `🔴 SEGMENT RED FLAG: ${flag.segment} segment result declined ${flag.yoyDeclinePct}% YoY (₹${flag.currentValue} Cr vs ₹${flag.prevValue} Cr).`;
        if (!summaryText.includes(flag.segment)) {
          summaryText = `${summaryText} ${flagMsg}`.trim();
        }
        if (guarded.key_drivers && Array.isArray(guarded.key_drivers)) {
          guarded.key_drivers.unshift(`SEGMENT RED FLAG: ${flag.segment} EBIT down ${flag.yoyDeclinePct}% YoY`);
        }
      }
    }

    // D. Mandatory Exceptional Gain & Normalised PAT Guard Injection (100% Dynamic)
    if (financialData.exceptionalGain !== null && financialData.exceptionalGain > 0) {
      const desc = financialData.exceptionalDescription || "one-time non-operational gain";
      const normPatStr = financialData.normalisedPat !== null ? `₹${financialData.normalisedPat} Cr` : "N/A";
      const normYoYStr = (financialData.normalisedPatYoYGrowthPct !== null && financialData.normalisedPatYoYGrowthPct !== undefined) 
        ? `${financialData.normalisedPatYoYGrowthPct > 0 ? '+' : ''}${financialData.normalisedPatYoYGrowthPct}% YoY` 
        : 'normalised PAT';
      const excNote = `⚠️ EXCEPTIONAL ITEM DISCLOSURE: Reported PAT of ₹${financialData.patConsolidated} Cr includes a one-time gain of ₹${financialData.exceptionalGain} Cr (${desc}). Normalised PAT is ${normPatStr} (${normYoYStr}).`;
      
      if (!summaryText.includes("Exceptional Item") && !summaryText.includes("Normalised PAT")) {
        summaryText = `${summaryText} ${excNote}`.trim();
      }

      if (guarded.financial_highlights) {
        guarded.financial_highlights.exceptional_gain_post_tax = `₹${financialData.exceptionalGain} Cr (${desc})`;
        guarded.financial_highlights.normalised_pat = `${normPatStr} (${normYoYStr})`;
      }

      if (guarded.key_drivers && Array.isArray(guarded.key_drivers)) {
        guarded.key_drivers.unshift(`⚠️ EXCEPTIONAL GAIN: Reported PAT includes ₹${financialData.exceptionalGain} Cr one-time gain. Normalised PAT: ${normPatStr} (${normYoYStr})`);
      }
    }

    // Generic Unverified QoQ Claim Stripper (strips any arbitrary LLM QoQ percentage claim)
    const stripErroneousQoQ = (txt) => {
      if (typeof txt !== "string") return txt;
      return txt
        .replace(/\b\d{1,3}(?:\.\d+)?%\s*qoq(?:\s*revenue|\s*growth|\s*recovery|\s*pat|\s*margin)?\b/gi, "")
        .replace(/\b\d{1,3}(?:\.\d+)?%\s*qoq\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    };

    // Contradiction filter: the LLM often quotes YoY / bps figures from the wrong column or entity.
    // Any LLM sentence quoting a YoY % or bps move that matches NONE of the verified figures is dropped,
    // so the alert never shows two different growth numbers for the same quarter.
    const verifiedPcts = [
      financialData.revenueYoYGrowthPct, financialData.patYoYGrowthPct, financialData.ebitdaYoYGrowthPct,
      financialData.normalisedPatYoYGrowthPct
    ].filter(v => v !== null && v !== undefined && !isNaN(v)).map(Number);
    const verifiedBps = (financialData.ebitdaMarginBpsDelta !== null && financialData.ebitdaMarginBpsDelta !== undefined)
      ? [Number(financialData.ebitdaMarginBpsDelta)] : [];
    const reconcileSummaryWithVerified = (txt) => {
      if (typeof txt !== "string" || (verifiedPcts.length === 0 && verifiedBps.length === 0)) return txt;
      const sentences = txt.split(/(?<=[.!?])\s+/);
      const kept = sentences.filter(sent => {
        if (/EXCEPTIONAL ITEM DISCLOSURE|YoY Earnings Contraction|SEGMENT RED FLAG|^EBITDA:/i.test(sent)) return true;
        const pctClaims = [...sent.matchAll(/([+-]?\d{1,3}(?:\.\d+)?)\s*%\s*(?:yoy|y-o-y|year[-\s]on[-\s]year|growth|increase|decline|rise|fall|expansion|contraction)/gi)]
          .map(m => Math.abs(parseFloat(m[1])));
        const bpsClaims = [...sent.matchAll(/([+-]?\d{2,4})\s*(?:bps|basis\s+points)/gi)].map(m => Math.abs(parseFloat(m[1])));
        const pctBad = pctClaims.length > 0 && verifiedPcts.length > 0 &&
          pctClaims.every(c => !verifiedPcts.some(v => Math.abs(Math.abs(v) - c) <= 1.0));
        const bpsBad = bpsClaims.length > 0 && verifiedBps.length > 0 &&
          bpsClaims.every(c => !verifiedBps.some(v => Math.abs(Math.abs(v) - c) <= 15));
        return !(pctBad || bpsBad);
      });
      const out = kept.join(" ").trim();
      return out.length > 0 ? out : txt;
    };

    // The same contradiction rule for the model's bullet lists (what went well / watch items / KPIs). The summary filter above
    // never reached them, and a model happily writes "EBITDA margin up ~390 bps to ~31.7%" next to the verified +435 bps / 32.56%.
    // A bullet is dropped when it states a bps move or an EBITDA margin that disagrees with the parser-verified figure.
    // Forward-looking statements (guidance, targets) are not measured results, so the margin comparison skips them.
    const verifiedMargin = (financialData.ebitdaMarginPct !== null && financialData.ebitdaMarginPct !== undefined && !isNaN(financialData.ebitdaMarginPct))
      ? Number(financialData.ebitdaMarginPct) : null;
    const FORWARD_LOOKING = /guid|target|expect|aim|outlook|aspir|plan\b|will\b|by\s+fy|fy\s?\d{2}\s?e\b|sustain|maintain/i;
    // Headline revenue / PAT bullets that quote an AMOUNT must quote a verified one (current or comparative). A filing prints
    // standalone, consolidated and "profit for the period" figures side by side, and the model picks any of them.
    const num = (v) => (v === null || v === undefined || isNaN(v) ? null : Number(v));
    const withGrowth = (cur, pctG) => (num(cur) !== null && num(pctG) !== null && num(pctG) > -100 ? num(cur) / (1 + num(pctG) / 100) : null);
    const verifiedRevenue = [num(financialData.revenue), withGrowth(financialData.revenue, financialData.revenueYoYGrowthPct), withGrowth(financialData.revenue, financialData.revenueQoQGrowthPct)].filter(v => v !== null);
    const verifiedPat = [num(financialData.patAttributable), withGrowth(financialData.patAttributable, financialData.patYoYGrowthPct)].filter(v => v !== null);
    const HEADLINE_REVENUE = /\b(?:revenue|total\s+revenue|net\s+sales|turnover)\b/i;
    const HEADLINE_PAT = /\b(?:pat|net\s+profit|profit\s+after\s+tax|profit\s+for\s+the\s+(?:period|quarter|year))\b/i;
    const SEGMENT_WORDS = /segment|vertical|division|business|region|export|domestic|product|plant|subsidiar|standalone/i;
    const amountsIn = amountsInCrore;
    const matchesAny = amountMatchesVerified;
    const quotesUnverifiedAmount = (item, pattern, candidates) => {
      // Half-year / annual / order-book / forward-looking lines are not this quarter's headline figures: not judged here.
      if (candidates.length === 0 || !pattern.test(item) || SEGMENT_WORDS.test(item) || NOT_A_QUARTER_FLOW.test(item)) return false;
      const amounts = amountsIn(item);
      return amounts.length > 0 && amounts.every(a => !matchesAny(a, candidates));
    };
    // Plausibility: a profit-and-loss line for the quarter cannot exceed the quarter's verified revenue (allowing a loss-making
    // quarter more room). Filings print standalone and consolidated figures in "Rs. millions", and the model often writes
    // "crore" for a number that is in millions (QPOWER: "Standalone Revenue ₹740.48 crore" was 740.48 million = ₹74.05 Cr,
    // "Cost of materials ₹333.01 crore" was 333.01 million). The number exists in the filing, so grounding cannot catch it.
    const FLOW_TERMS = /revenue|sales|turnover|income|cost|expense|employee|depreciation|profit|\bpat\b|\bpbt\b|ebitda|tax/i;
    const NOT_A_QUARTER_FLOW = /order\s*(book|inflow|intake)|backlog|inflow|capex|capital|borrowing|debt|net\s*worth|equity|reserve|asset|market\s*cap|cash\s*flow|investing|financing|working\s*capital|inventor|receivable|payable|guid|target|expect|invest|loan|dividend|buyback|raise|fund|issue|acquisition|consideration|valuation|stake|half[-\s]?year|six\s+months|nine\s+months|\b[hf]y?\s?[12]\b|\b9m\b|full[-\s]?year|annual|year\s+ended|ytd|cumulative|fy\s?\d{2}/i;
    const quarterRevenue = num(financialData.revenue);
    const flowCap = quarterRevenue !== null && quarterRevenue > 0 ? quarterRevenue * ((num(financialData.ebitda) ?? 1) > 0 ? 1.02 : 2) : null;
    const exceedsQuarterRevenue = (item) =>
      flowCap !== null && FLOW_TERMS.test(item) && !NOT_A_QUARTER_FLOW.test(item) && amountsInCrore(item).some(v => v > flowCap);
    // The base of a YoY comparison in quarter Qn FYyy is the same quarter of FY(yy-1). The model often writes FY(yy-2) ("...
    // compared to Rs 12,617.87 million in Q2 FY25" in a Q2 FY27 alert): right amount, wrong label. Only comparisons are judged.
    const reportingQuarter = (() => {
      const d = financialData.quarterEnded ? new Date(`${String(financialData.quarterEnded).slice(0, 10)}T00:00:00Z`) : null;
      if (!d || isNaN(d.getTime())) return null;
      const month = d.getUTCMonth() + 1;
      return { q: month >= 4 && month <= 6 ? 1 : month >= 7 && month <= 9 ? 2 : month >= 10 ? 3 : 4, fy: (month >= 4 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()) % 100 };
    })();
    const COMPARISON_WORDS = /compared|\bfrom\b|\bvs\.?\b|versus|against|\byoy\b|year[-\s]on[-\s]year/i;
    const hasWrongBasePeriod = (item) => reportingQuarter !== null && COMPARISON_WORDS.test(item) &&
      [...item.matchAll(/\bQ([1-4])\s*FY\s?'?(\d{2})\b/gi)].some(m => Number(m[1]) === reportingQuarter.q && Number(m[2]) === (reportingQuarter.fy + 98) % 100);
    const contradictsVerified = (item) => {
      if (typeof item !== "string" || GUARD_INJECTED.test(item)) return false;
      if (hasWrongBasePeriod(item)) return true;
      if (exceedsQuarterRevenue(item)) return true;
      if (quotesUnverifiedAmount(item, HEADLINE_REVENUE, verifiedRevenue)) return true;
      if (quotesUnverifiedAmount(item, HEADLINE_PAT, verifiedPat)) return true;
      const bpsClaims = [...item.matchAll(/([+-]?\d{2,4})\s*(?:bps|basis\s+points)/gi)].map(m => Math.abs(parseFloat(m[1])));
      if (bpsClaims.length > 0 && verifiedBps.length > 0 && !FORWARD_LOOKING.test(item) &&
          bpsClaims.every(c => !verifiedBps.some(v => Math.abs(Math.abs(v) - c) <= 15))) return true;
      if (verifiedMargin !== null && !FORWARD_LOOKING.test(item)) {
        const marginClaims = [...item.matchAll(/ebitda\s+margins?[^.\n]{0,60}?(\d{1,2}(?:\.\d+)?)\s*%/gi)].map(m => parseFloat(m[1]));
        const tol = (n) => (Number.isInteger(n) ? 1.0 : 0.15);
        if (marginClaims.length > 0 && marginClaims.every(c => Math.abs(c - verifiedMargin) > tol(c))) return true;
      }
      return false;
    };
    for (const f of ["key_positives", "key_concerns_and_drags", "thesis_operational_kpis", "key_drivers", "concall_verification_points"]) {
      if (Array.isArray(guarded[f])) {
        const kept = guarded[f].filter(item => {
          if (!contradictsVerified(item)) return true;
          console.warn(`[GROUNDING GUARD] Dropped a ${f} item that contradicts the verified figures for ${ticker}: "${String(item).slice(0, 120)}"`);
          return false;
        });
        guarded[f] = kept;
      }
    }

    summaryText = reconcileSummaryWithVerified(stripErroneousQoQ(summaryText));
    if (guarded.key_drivers && Array.isArray(guarded.key_drivers)) {
      guarded.key_drivers = guarded.key_drivers
        .map(d => stripErroneousQoQ(d))
        .filter(d => d.length > 5);
    }

    // Update summary in output
    if (guarded.summary) guarded.summary = summaryText;
    if (guarded.verdict_summary) guarded.verdict_summary = summaryText;

    // D. Action Signal Calibration & Conviction Hard-Cap (1-10 Scale)
    let rawSignal = guarded.action_signal || guarded.final_action || "HOLD";
    let rawScore = guarded.conviction_score || guarded.confidence_score || 5;

    let conv = Math.round(Number(rawScore));
    if (isNaN(conv)) conv = 5;
    if (conv > 10) conv = Math.min(10, Math.round(conv / 10)); // Converts 95 -> 10, 90 -> 9, 85 -> 9, 80 -> 8
    rawScore = Math.max(1, Math.min(10, conv));

    const analysisIsBearish = ["TRIM", "SELL", "REDUCE", "EXIT"].includes(String(rawSignal).trim().toUpperCase());

    if (financialData.isYoYDecline || financialData.isMarginErosion) {
      // Hard-cap signal on YoY contraction: Cannot be BUY or ADD (an explicit TRIM/EXIT stays bearish)
      rawSignal = analysisIsBearish ? rawSignal : "HOLD";
      rawScore = Math.min(rawScore, 5);
    } else if (analysisIsBearish) {
      // Fundamentals are clean but the analysis flagged a bearish reason (governance, guidance cut, ...): never upgrade it
      rawScore = Math.min(rawScore, 5);
    } else if (
      financialData.patYoYGrowthPct !== null && financialData.patYoYGrowthPct >= 10 &&
      financialData.revenueYoYGrowthPct !== null && financialData.revenueYoYGrowthPct >= 5 &&
      !financialData.isMarginErosion
    ) {
      // Clean beat with double-digit growth: Set to ADD or STRONG BUY
      rawSignal = rawScore >= 9 ? "STRONG BUY" : "ADD";
      rawScore = Math.min(10, Math.max(rawScore, 8));
    }

    // Stacked-Condition Conviction Calibration Ceiling Rule:
    // 1. Material Exceptional Gain (> 20% of reported PAT) -> ceiling 7/10 (prevents false high-conviction on distorted PAT)
    // 2. Moderate Revenue Growth (< 15% YoY) -> ceiling 8/10
    // 3. Pending Demerger / NCLT Regulatory Approval -> ceiling 7/10
    // 4. Stacked conditions -> ceiling 7/10 ADD
    const hasMaterialExceptionalGain = 
      financialData.exceptionalGain !== null && 
      financialData.patConsolidated !== null && 
      financialData.patConsolidated > 0 &&
      (financialData.exceptionalGain / financialData.patConsolidated) > 0.20;

    const isModerateRevenueGrowth = financialData.revenueYoYGrowthPct !== null && financialData.revenueYoYGrowthPct < 15.0;
    const hasPendingRegulatoryCommitments = guarded.commitments && guarded.commitments.some(c => 
      c.status === "Pending" && 
      ((c.statement || "").toLowerCase().includes("demerger") || (c.metric || "").toLowerCase().includes("demerger") || (c.statement || "").toLowerCase().includes("nclt"))
    );

    if (!financialData.isYoYDecline) {
      if (hasMaterialExceptionalGain) {
        rawScore = Math.min(rawScore, 7); // Exceptional gain > 20% of PAT distorts headline -> 7/10 ADD
        if (rawSignal === "STRONG BUY") rawSignal = "ADD";
      }
      if (isModerateRevenueGrowth && hasPendingRegulatoryCommitments) {
        rawScore = Math.min(rawScore, 7); // Stacked constraint: 7/10 (cap only; never force a buy signal)
        if (rawSignal === "STRONG BUY") rawSignal = "ADD";
      } else if (hasPendingRegulatoryCommitments) {
        rawScore = Math.min(rawScore, 7); // Regulatory binary risk: 7/10 (cap only)
        if (rawSignal === "STRONG BUY") rawSignal = "ADD";
      } else if (isModerateRevenueGrowth) {
        rawScore = Math.min(rawScore, 8); // Moderate growth constraint: 8/10
        if (rawSignal === "STRONG BUY") rawSignal = "ADD";
      }
    }

    // Standardize Action Signal Vocabulary (STRONG BUY / ADD / HOLD / TRIM / EXIT)
    const standardizeSignal = (sig, score) => {
      const s = (sig || "").toString().trim().toUpperCase();
      if (s === "BUILD POSITION" || s === "ACCUMULATE" || s === "BUY" || s === "STRONG BUY" || s === "ADD") {
        return score >= 9 ? "STRONG BUY" : "ADD";
      }
      if (s === "REDUCE" || s === "SELL" || s === "TRIM") {
        return "TRIM";
      }
      if (s === "EXIT") {
        return "EXIT";
      }
      return "HOLD";
    };

    rawSignal = standardizeSignal(rawSignal, rawScore);

    if (guarded.action_signal) guarded.action_signal = rawSignal;
    if (guarded.final_action) guarded.final_action = rawSignal;
    if (guarded.conviction_score) guarded.conviction_score = rawScore;
    if (guarded.confidence_score) guarded.confidence_score = rawScore;
  } else {
    // Ensure conviction score is 1-10 even if financialData is missing
    let rawScore = guarded.conviction_score || guarded.confidence_score || 5;
    let conv = Math.round(Number(rawScore));
    if (isNaN(conv)) conv = 5;
    if (conv > 10) conv = Math.min(10, Math.round(conv / 10));
    guarded.conviction_score = Math.max(1, Math.min(10, conv));
    guarded.confidence_score = guarded.conviction_score;

    if (guarded.action_signal) {
      guarded.action_signal = guarded.action_signal === "BUILD POSITION" ? "ADD" : guarded.action_signal;
    }
  }

  // 3. Strict Zero-Hallucination & Document Grounding Sanitizer
  return sanitizeLlmOutput(guarded, title, ticker, financialData);
}

const PROMPT_LEAK_PHRASES = [
  "tpl plastech", "silvassa", "201.12", "6,114", "6114", "40,800", "40800",
  "raised ₹800 cr", "won trial order for", "expanded capacity by +70%",
  "peso clearance: specific", "metric name:", "action type:", "category or milestone:"
];

// Unfilled schema/placeholder tokens a model copies back from a prompt. Letter classes are case-SENSITIVE on purpose
// (a real "Plant 2" or "x%" must survive; "₹X Cr", "Z%", "X-Y%", "<figure>" must not).
const PLACEHOLDER_PATTERNS = [
  /(?:₹|Rs\.?|INR)\s*[XYZ]\b/,
  /(?<![A-Za-z0-9])[XYZ]\s*%/,
  /(?<![A-Za-z0-9])[XYZA]\s*[-–]\s*[XYZB]\s*%/,
  /[+-]\s*[XYZ]\s*%/,
  /<[A-Za-z][A-Za-z &\/,'-]{1,140}>/,
  /\bdetails?\s*&\s*figures?\b/i,
  /:\s*(?:details?|figures?|n\/a|tbd)\s*[.]?\s*$/i,
  /^\s*(?:initiative|positive|challenge|driver|catalyst|risk|plant|timeline|concern|point)\s+\d\s*(?:status|details?)?\s*[.:]?\s*$/i
];

/** True when the text still contains an unfilled template token (e.g. "₹X Cr", "Z%", "Initiative 1"). */
/**
 * Whether a quoted amount (in crore) IS one of the verified figures: equal within 0.1%, or equal once the verified figure is
 * rounded to the precision the claim itself uses (a correct "₹294 Cr" for a verified 293.6, a correct "662" for 661.53).
 * Merely "close" is not enough: 156.49 (profit for the period) is 0.25% off the owners' PAT 156.88 and does not match.
 */
export function amountMatchesVerified(amount, candidates) {
  const decimals = (String(amount).split(".")[1] || "").length;
  const scale = 10 ** Math.min(decimals, 6);
  return candidates.some((v) => Math.abs(amount - v) / Math.max(v, 1e-9) <= 0.001 || Math.round(v * scale) / scale === amount);
}

/**
 * Every rupee amount in a text, converted to CRORE so amounts can be compared like for like. Filings print statements in
 * "Rs. millions" (1 crore = 10 million), and the model mixes the units. Only numbers with a currency prefix (₹, Rs, INR) or a
 * unit word count; a bare "42%" or "2026" is not an amount. A prefix with no unit is read as crore (the alert's own unit).
 */
export function amountsInCrore(text) {
  const factor = (unit) => {
    const u = String(unit || "").toLowerCase();
    if (/^(million|millions|mn|mln)$/.test(u)) return 0.1;
    if (/^(lakh|lakhs|lac|lacs)$/.test(u)) return 0.01;
    if (/^(billion|billions|bn)$/.test(u)) return 100;
    return 1; // crore / cr / no unit
  };
  const out = [];
  for (const m of String(text || "").matchAll(/(?:(?<![a-z])(₹|rs\.?|inr)\s*)?([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|millions?|mn\b|mln\b|lakhs?|lacs?|billions?|bn\b)?/gi)) {
    if (!m[1] && !m[3]) continue;
    const n = parseFloat(m[2].replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) continue;
    const v = factor(m[3]);
    out.push(Math.round((v < 1 ? n / Math.round(1 / v) : n * v) * 1e6) / 1e6);
  }
  return out;
}

export function isPlaceholderText(text) {
  if (typeof text !== "string") return false;
  return PLACEHOLDER_PATTERNS.some(re => re.test(text));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds a predicate that says whether every concrete number / percentage in a sentence is backed by the source
 * document (or by a parser-verified percentage). Years, 1-2 digit counts and bps/x ratios are not hard-grounded.
 */
function buildGroundingCheck(rawDocText, verifiedPcts = []) {
  const doc = String(rawDocText || "").toLowerCase();
  const docNoCommas = doc.replace(/,/g, "");
  const hasDoc = doc.length > 50;

  const pctGrounded = (numStr) => {
    const n = parseFloat(numStr);
    if (isNaN(n)) return true;
    if (verifiedPcts.some(v => Math.abs(Math.abs(v) - Math.abs(n)) <= 1.0)) return true;
    const forms = new Set([numStr, String(n)]);
    if (Number.isInteger(n)) forms.add(`${n}.0`);
    for (const f of forms) {
      const re = new RegExp(`(?<![\\d.])${escapeRe(f)}(?:\\s*(?:-|–|to)\\s*\\d+(?:\\.\\d+)?)?\\s*(?:%|per\\s?cent)`);
      if (re.test(docNoCommas)) return true;
    }
    // range printed as "20-22%": the lower bound is grounded by the upper bound's range
    const rangeRe = new RegExp(`(?<![\\d.])${escapeRe(numStr)}\\s*(?:-|–|to)\\s*\\d`);
    return rangeRe.test(docNoCommas) && /%|per\s?cent/.test(docNoCommas);
  };

  return (sentence) => {
    if (!hasDoc) return true;
    for (const m of sentence.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)) {
      if (!pctGrounded(m[1])) return false;
    }
    // Small figures that carry a physical/monetary unit ("45 days", "64 Cr", "300 MW") are claims too: the number must
    // be printed in the source (directly, or as the lakh form of a crore figure).
    for (const m of sentence.matchAll(/(?<![\d.,])(\d{1,2}(?:\.\d+)?)\s*(?:days?|months?|mw|gw|kw|mwh|gwh|mtpa|tpa|mt|tonnes?|crores?|cr|lakhs?)\b/gi)) {
      const n = parseFloat(m[1]);
      const tokenRe = new RegExp(`(?<![\\d.])${escapeRe(m[1])}(?![\\d])`);
      const lakhForm = String(Math.round(n * 100));
      if (!tokenRe.test(docNoCommas) && !docNoCommas.includes(lakhForm)) return false;
    }
    // Absolute figures (>= 3 digits, no % / bps / x suffix) must literally exist in the source.
    for (const m of sentence.matchAll(/(\d{2,}(?:[.,]\d+)*)(\s*(?:%|bps|x\b))?/gi)) {
      if (m[2]) continue;
      const cleanNum = m[1].replace(/,/g, "");
      if (["2024", "2025", "2026", "2027", "2028", "2029", "2030"].includes(cleanNum)) continue;
      if (cleanNum.length < 3) continue;
      const intPart = cleanNum.split(".")[0];
      const asNumber = parseFloat(cleanNum);
      const lakhForm = isNaN(asNumber) ? null : String(Math.round(asNumber * 100));
      if (!docNoCommas.includes(cleanNum) && !docNoCommas.includes(intPart) && !(lakhForm && docNoCommas.includes(lakhForm))) {
        return false;
      }
    }
    return true;
  };
}

/** Item-level filter shared by every list the model writes (placeholders, leak phrases, ungrounded numbers). */
function isItemAcceptable(item, isGrounded) {
  if (!item || typeof item !== "string") return false;
  const itemLower = item.toLowerCase().trim();
  if (itemLower.length < 5) return false;
  if (itemLower.includes("null") || itemLower.includes("undefined")) return false;
  if (PROMPT_LEAK_PHRASES.some(phrase => itemLower.includes(phrase))) return false;
  if (isPlaceholderText(item)) return false;
  return isGrounded(item);
}

/** Sentence-level filter for free text; returns the surviving sentences joined (possibly empty). */
function groundSentences(text, isGrounded) {
  if (typeof text !== "string" || !text.trim()) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences
    .filter(s => !isPlaceholderText(s) && isGrounded(s))
    .join(" ")
    .trim();
}

// Lines the guard itself injects from parser-verified numbers; they are never model claims.
const GUARD_INJECTED = /^(?:⚠️\s*EXCEPTIONAL GAIN|EBITDA:|SEGMENT RED FLAG)|EXCEPTIONAL ITEM DISCLOSURE|YoY Earnings Contraction|SEGMENT RED FLAG/i;

// Capitalised words a model uses freely in generic finance prose; they are not named entities worth grounding.
const ENTITY_STOPWORDS = new Set([
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "revenue", "quarter", "margin", "margins", "order", "orders", "next", "full", "year", "fiscal", "target", "targets",
  "capex", "growth", "guidance", "management", "company", "group", "volume", "volumes", "sales", "export", "exports",
  "domestic", "cash", "debt", "capacity", "plant", "phase", "total", "segment", "business", "ebitda", "mtpa", "cagr",
  "roce", "capital", "profit", "income", "demand", "pricing", "price", "prices", "market", "markets", "product", "products"
]);

/**
 * Names and acronyms (e.g. a partner, plant or subsidiary) the model writes must be said somewhere in the source.
 * A sentence naming something the document never mentions is a hallucination, even when it carries no number.
 */
function buildEntityCheck(rawDocText) {
  const doc = String(rawDocText || "").toLowerCase();
  const hasDoc = doc.length > 50;
  return (sentence) => {
    if (!hasDoc) return true;
    const colon = sentence.indexOf(":");
    const value = colon >= 0 ? sentence.slice(colon + 1) : sentence;
    const tokens = [...value.matchAll(/\b[A-Z][A-Za-z]{3,}\b/g)];
    for (const t of tokens) {
      const atStart = value.slice(0, t.index).trim().length === 0;
      if (atStart) continue; // capitalised only because it starts the sentence
      const word = t[0].toLowerCase();
      if (ENTITY_STOPWORDS.has(word)) continue;
      if (!doc.includes(word)) return false;
    }
    return true;
  };
}

/**
 * Grounds the structured concall highlight block against the transcript text: unfilled template items, and any
 * figure or name the call never states, are dropped (AGENTS.md rule 6). Empty sections stay empty rather than invented.
 */
export function sanitizeConcallHighlights(highlights, rawDocText) {
  if (!highlights || typeof highlights !== "object") return highlights;
  const numbersGrounded = buildGroundingCheck(rawDocText);
  const namesGrounded = buildEntityCheck(rawDocText);
  const isGrounded = (s) => numbersGrounded(s) && namesGrounded(s);
  const out = { ...highlights };
  const LIST_FIELDS = [
    "financial_performance", "business_performance", "growth_initiatives", "operational_highlights",
    "quarterly_guidance", "annual_guidance", "multi_year_targets", "management_guidance",
    "key_positives", "key_challenges", "key_risks", "performance_overview", "segment_highlights"
  ];
  for (const f of LIST_FIELDS) {
    if (Array.isArray(out[f])) out[f] = out[f].filter(item => isItemAcceptable(item, isGrounded));
  }
  if (typeof out.management_tone === "string" && (isPlaceholderText(out.management_tone) || out.management_tone.trim().length < 3)) {
    out.management_tone = null;
  }
  if (typeof out.key_takeaway === "string") {
    const kept = groundSentences(out.key_takeaway, isGrounded);
    out.key_takeaway = kept && kept.length >= 10 ? kept : null;
  }
  // The legacy combined guidance list is rebuilt from the sanitised scoped lists, never from stale content.
  if (Array.isArray(out.management_guidance)) {
    out.management_guidance = [...(out.quarterly_guidance || []), ...(out.annual_guidance || []), ...(out.multi_year_targets || [])];
  }
  return out;
}

/**
 * Strips prompt-leak artifacts, ungrounded numbers, and duplicate entries.
 */
function sanitizeLlmOutput(guarded, title = "", ticker = "", financialData = null) {
  if (!guarded || typeof guarded !== "object") return guarded;

  const rawDocText = (guarded._raw_text || guarded.announcement_text || "").toLowerCase();
  const verifiedPcts = financialData ? [
    financialData.revenueYoYGrowthPct, financialData.revenueQoQGrowthPct, financialData.patYoYGrowthPct,
    financialData.patQoQGrowthPct, financialData.ebitdaYoYGrowthPct, financialData.ebitdaMarginPct,
    financialData.normalisedPatYoYGrowthPct
  ].filter(v => v !== null && v !== undefined && !isNaN(v)).map(Number) : [];
  const isGrounded = buildGroundingCheck(rawDocText, verifiedPcts);
  const sanitizeArray = (arr) => (Array.isArray(arr) ? arr.filter(item => isItemAcceptable(item, isGrounded)) : []);

  if (guarded.forward_catalysts) {
    guarded.forward_catalysts = sanitizeArray(guarded.forward_catalysts);
  }
  if (guarded.financial_metrics) {
    guarded.financial_metrics = sanitizeArray(guarded.financial_metrics);
  }
  if (guarded.corporate_actions) {
    guarded.corporate_actions = sanitizeArray(guarded.corporate_actions);
  }
  if (guarded.thesis_operational_kpis) {
    guarded.thesis_operational_kpis = sanitizeArray(guarded.thesis_operational_kpis);
  }
  // Model-written narrative lists and sentences get the same grounding; lines the guard injected from verified
  // parser numbers are kept as they are.
  for (const f of ["key_positives", "key_concerns_and_drags", "concall_verification_points"]) {
    if (Array.isArray(guarded[f])) guarded[f] = sanitizeArray(guarded[f]);
  }
  if (Array.isArray(guarded.key_drivers)) {
    guarded.key_drivers = guarded.key_drivers.filter(d => (typeof d === "string" && GUARD_INJECTED.test(d)) || isItemAcceptable(d, isGrounded));
  }
  // Thesis-driver evidence is a claim like any other. Ungrounded or placeholder evidence is withdrawn together with the
  // status that rested on it; only evidence verified against the filing is stamped `grounded` (the thesis status board
  // and its carry-forward trust nothing else).
  if (Array.isArray(guarded.thesis_driver_assessment)) {
    const canVerify = rawDocText.length > 50;
    guarded.thesis_driver_assessment = guarded.thesis_driver_assessment.map((a) => {
      if (!a || typeof a !== "object") return a;
      if (a.status === "NO_EVIDENCE") return { ...a, grounded: false };
      const evidence = String(a.evidence || "");
      if (isPlaceholderText(evidence) || !isGrounded(evidence)) {
        console.warn(`[GROUNDING GUARD] Withdrew ungrounded thesis-driver evidence for ${ticker} / ${a.driver}: "${evidence.slice(0, 120)}"`);
        return { ...a, status: "NO_EVIDENCE", evidence: "No new evidence in this filing", grounded: false };
      }
      return { ...a, grounded: canVerify };
    });
  }
  for (const f of ["verdict_summary", "summary"]) {
    if (typeof guarded[f] !== "string" || !guarded[f].trim()) continue;
    const keptSentences = guarded[f].split(/(?<=[.!?])\s+/).filter(s => GUARD_INJECTED.test(s) || (!isPlaceholderText(s) && isGrounded(s)));
    const kept = keptSentences.join(" ").trim();
    guarded[f] = kept || "Figures quoted by the model could not be verified against the filing text — open the filing for the numbers.";
  }

  // Sanitize and ground management commitments against raw filing text
  if (guarded.commitments && Array.isArray(guarded.commitments)) {
    guarded.commitments = guarded.commitments.filter(comm => {
      if (!comm || typeof comm !== "object") return false;
      const stmtLower = (comm.statement || "").toLowerCase().trim();
      const summaryLower = (comm.evidence_summary || "").toLowerCase().trim();
      if (stmtLower.length < 5) return false;

      // Filter out prompt template leaks & hallucination keywords
      if (PROMPT_LEAK_PHRASES.some(phrase => stmtLower.includes(phrase) || summaryLower.includes(phrase))) {
        return false;
      }
      if (stmtLower.includes("covid-19") || summaryLower.includes("covid-19") || stmtLower.includes("pandemic")) {
        return false;
      }

      // Grounding check: verify that specific large numbers (>50) in statement or target appear in docText
      if (rawDocText && rawDocText.length > 50) {
        const textToCheck = `${comm.statement} ${comm.target_value || ''}`;
        const numbers = textToCheck.match(/\b\d{2,}(?:[.,]\d+)?\b/g) || [];
        for (const num of numbers) {
          const cleanNum = num.replace(/,/g, "");
          if (["2024", "2025", "2026", "2027", "2028", "2029", "2030"].includes(cleanNum)) continue;
          if (["10", "12", "15", "18", "20", "22", "25", "30", "35", "40", "50"].includes(cleanNum)) continue;
          if (!rawDocText.includes(cleanNum) && !rawDocText.includes(num)) {
            console.warn(`[GROUNDING GUARD] Suppressed ungrounded commitment token ${num} for ${ticker}: "${comm.statement}"`);
            return false;
          }
        }
      }
      return true;
    });
  }

  // Cross-section deduplication (e.g. don't repeat dividend in both key_data and corporate_actions)
  if (guarded.key_data && guarded.corporate_actions && guarded.corporate_actions.length > 0) {
    const keyDataLower = String(guarded.key_data).toLowerCase();
    guarded.corporate_actions = guarded.corporate_actions.filter(ca => {
      const caLower = String(ca).toLowerCase();
      // If key_data already contains the exact dividend or metric, keep corporate_actions clean
      return !keyDataLower.includes(caLower) && !caLower.includes(keyDataLower);
    });
  }

  return guarded;
}
