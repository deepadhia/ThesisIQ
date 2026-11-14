/**
 * XBRL Fact Provenance Ledger Service
 *
 * Implements an append-only provenance ledger for official Indian XBRL filings.
 * Validates regulatory taxonomy, extracts exact fact-level contexts and units,
 * derives normalized quarter/scope views in Crores, and enforces strict
 * PDF cross-reconciliation before authorizing alert eligibility.
 */

import crypto from "crypto";
import * as cheerio from "cheerio";
import { extractOrderBookMetrics } from "./orderbook-parser.service.js";

const round2 = (n) => (n === null || n === undefined || isNaN(n)) ? null : Math.round(n * 100) / 100;

const KNOWN_INDIAN_TAXONOMIES = [
  /in-capmkt/i,
  /in-bse-fin/i,
  /ind-as/i,
  /in-gaap/i,
  /sebi\.gov\.in/i,
  /mca\.gov\.in/i
];

/**
 * Normalizes absolute INR values to Crores.
 */
function normalizeToCrores(num) {
  if (num === null || num === undefined || isNaN(num)) return null;
  const val = Number(num);
  if (Math.abs(val) >= 1e6) {
    return round2(val / 1e7);
  }
  return round2(val);
}

/**
 * Parses raw XBRL XML text into an immutable fact provenance ledger.
 */
export function parseXbrlFactLedger(xmlContent, metadata = {}) {
  if (typeof xmlContent !== "string" || !xmlContent.trim()) return null;

  const sha256 = crypto.createHash("sha256").update(xmlContent).digest("hex");
  const ledgerId = metadata.filingId ? `ledger-${metadata.filingId}` : `ledger-${sha256.slice(0, 16)}`;

  const $ = cheerio.load(xmlContent, { xmlMode: true });

  // 1. Identify taxonomy and schemaRef
  let schemaRef = null;
  $('*').filter((_, el) => el.name === 'link:schemaRef' || (el.name || '').endsWith(':schemaRef') || el.name === 'schemaRef').each((_, el) => {
    schemaRef = el.attribs?.['xlink:href'] || el.attribs?.['href'] || $(el).attr('xlink:href') || $(el).attr('href') || null;
  });

  if (!schemaRef) {
    const match = /<[^>]*:?schemaRef[^>]+(?:xlink:)?href=["']([^"']+)["']/i.exec(xmlContent);
    if (match) schemaRef = match[1];
  }

  const isValidIndianTaxonomy = KNOWN_INDIAN_TAXONOMIES.some(rx => 
    rx.test(schemaRef || "") || rx.test(xmlContent.slice(0, 2000))
  );

  // 2. Identify entity level fields
  const getField = (name) => {
    let val = null;
    $(`*`).filter((_, el) => {
      const elName = (el.name || "").toLowerCase();
      return elName === name.toLowerCase() || elName.endsWith(`:${name.toLowerCase()}`);
    }).first().each((_, el) => {
      val = $(el).text().trim();
    });
    return val;
  };

  const symbol = getField("Symbol");
  const scripCode = getField("ScripCode");
  const companyName = getField("NameOfTheCompany");
  const periodStart = getField("DateOfStartOfReportingPeriod");
  const periodEnd = getField("DateOfEndOfReportingPeriod");
  const reportingQuarter = getField("ReportingQuarter");
  const nature = getField("NatureOfReportStandaloneConsolidated") || "Consolidated";
  const rounding = getField("LevelOfRounding");
  const currency = getField("DescriptionOfPresentationCurrency") || "INR";

  // 3. Parse contexts
  const contexts = {};
  $('context, *\\:context').each((_, el) => {
    const id = $(el).attr('id');
    if (!id) return;

    const startDate = $(el).find('startDate, *\\:startDate').text().trim() || null;
    const endDate = $(el).find('endDate, *\\:endDate').text().trim() || null;
    const instant = $(el).find('instant, *\\:instant').text().trim() || null;

    let isSegment = false;
    let isConsolidated = /consolidated/i.test(nature);
    let isStandalone = /standalone/i.test(nature);

    const explicitMembers = $(el).find('explicitMember, *\\:explicitMember');
    if (explicitMembers.length > 0) {
      explicitMembers.each((_, mem) => {
        const text = $(mem).text().toLowerCase();
        const dim = ($(mem).attr('dimension') || '').toLowerCase();
        if (dim.includes('segment') || dim.includes('expense') || dim.includes('other')) {
          isSegment = true;
        }
        if (text.includes('consolidated') || dim.includes('consolidated')) {
          isConsolidated = true;
          isStandalone = false;
        } else if (text.includes('standalone') || dim.includes('standalone')) {
          isStandalone = true;
          isConsolidated = false;
        }
      });
    }

    let isYTD = false;
    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      const diffDays = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays > 105) isYTD = true;
    }

    contexts[id] = {
      id,
      startDate,
      endDate,
      instant,
      periodEnd: endDate || instant,
      isSegment,
      isConsolidated,
      isStandalone,
      scope: isConsolidated ? "CONSOLIDATED" : isStandalone ? "STANDALONE" : "UNKNOWN",
      isYTD
    };
  });

  // 4. Collect facts
  const facts = [];
  const notes = [];

  $('*').each((_, el) => {
    const contextRef = $(el).attr('contextRef');
    const unitRef = $(el).attr('unitRef');
    const decimals = $(el).attr('decimals');
    const rawText = $(el).text().trim();
    const name = el.name || "";
    const parts = name.split(':');
    const concept = parts.length > 1 ? parts[1] : parts[0];
    const namespace = parts.length > 1 ? parts[0] : null;

    if (concept.toLowerCase().includes("explanatorytextblock") || concept.toLowerCase().includes("notesonfinancialresults")) {
      notes.push({
        concept,
        contextRef,
        text: rawText
      });
    }

    if (!contextRef) return;

    const ctx = contexts[contextRef] || {};
    const num = parseFloat(rawText);
    const numericValue = !isNaN(num) ? num : null;

    facts.push({
      concept,
      namespace,
      contextRef,
      unitRef: unitRef || null,
      decimals: decimals || null,
      rawValue: rawText,
      numericValue,
      scope: ctx.scope || (nature.toUpperCase().includes("CONSOLIDATED") ? "CONSOLIDATED" : "STANDALONE"),
      periodEnd: ctx.periodEnd || periodEnd,
      isSegment: Boolean(ctx.isSegment),
      isYTD: Boolean(ctx.isYTD)
    });
  });

  return {
    ledgerId,
    filingId: metadata.filingId || null,
    attachmentUrl: metadata.attachmentUrl || null,
    sha256,
    publicationTime: metadata.publicationTime || null,
    taxonomy: {
      schemaRef,
      isValidIndianTaxonomy
    },
    entity: {
      symbol,
      scripCode,
      companyName,
      periodStart,
      periodEnd,
      reportingQuarter,
      nature,
      rounding,
      currency
    },
    extractorVersion: metadata.extractorVersion || "1.0-provenance",
    totalFacts: facts.length,
    facts,
    notes
  };
}

/**
 * Derives normalized financial quarter/scope views from a fact ledger.
 */
export function deriveQuarterScopeViews(factLedger) {
  if (!factLedger || !Array.isArray(factLedger.facts)) return [];

  // Group facts by (periodEnd, scope), filtering out true segments and YTD
  const groups = new Map();

  for (const fact of factLedger.facts) {
    if (fact.isSegment || fact.isYTD) continue;
    if (!fact.periodEnd || !fact.scope) continue;

    const key = `${fact.periodEnd}__${fact.scope}`;
    if (!groups.has(key)) {
      groups.set(key, {
        periodEnd: fact.periodEnd,
        scope: fact.scope,
        facts: []
      });
    }
    groups.get(key).facts.push(fact);
  }

  const views = [];

  for (const group of groups.values()) {
    const factMap = new Map();
    for (const f of group.facts) {
      if (f.numericValue !== null) {
        factMap.set(f.concept.toLowerCase(), f.numericValue);
      }
    }

    const rawRev = factMap.get("revenuefromoperations") ?? factMap.get("income") ?? factMap.get("salesorrevenue");
    const rawPat = factMap.get("profitlossforperiod") ?? factMap.get("profitorlossattributabletoownersofparent") ?? factMap.get("profitlossforperiodfromcontinuingoperations");
    const rawPbt = factMap.get("profitbeforetax") ?? factMap.get("profitbeforeexceptionalitemsandtax");
    const rawFinCost = factMap.get("financecosts") || 0;
    const rawDep = factMap.get("depreciationdepletionandamortisationexpense") || 0;

    const revCr = normalizeToCrores(rawRev);
    const patCr = normalizeToCrores(rawPat);
    const pbtCr = normalizeToCrores(rawPbt);

    let ebitdaCr = null;
    if (rawPbt !== undefined && rawPbt !== null) {
      const sum = Number(rawPbt) + Number(rawFinCost) + Number(rawDep);
      ebitdaCr = normalizeToCrores(sum);
    }

    const ebitdaMarginPct = (revCr && revCr > 0 && ebitdaCr !== null) ? round2((ebitdaCr / revCr) * 100) : null;

    views.push({
      isFinancialResult: true,
      statementScope: group.scope,
      unit: "Crores",
      quarterEnded: group.periodEnd,
      revenue: revCr,
      ebitda: ebitdaCr,
      ebitdaMarginPct,
      pbt: pbtCr,
      patConsolidated: group.scope === "CONSOLIDATED" ? patCr : null,
      patStandalone: group.scope === "STANDALONE" ? patCr : null,
      alertEligible: false,
      provenance: {
        ledgerId: factLedger.ledgerId,
        sha256: factLedger.sha256,
        schemaRef: factLedger.taxonomy.schemaRef,
        taxonomyValidated: factLedger.taxonomy.isValidIndianTaxonomy,
        unit: "INR",
        scope: group.scope,
        periodEnd: group.periodEnd,
        fields: {
          revenue: revCr !== null ? "validated" : null,
          pat: patCr !== null ? "validated" : null,
          ebitda: ebitdaCr !== null ? "validated" : null
        }
      }
    });
  }

  return views;
}

/**
 * Reconciles derived XBRL view against verified PDF financials to authorize alert eligibility.
 */
export function reconcileFactLedgerWithPdf(xbrlFin, pdfFin) {
  if (!xbrlFin) return { alertEligible: false, status: "NO_XBRL_DATA" };
  if (!pdfFin) return { alertEligible: false, status: "UNVERIFIED_PDF" };

  if (xbrlFin.quarterEnded !== pdfFin.quarterEnded || xbrlFin.statementScope !== pdfFin.statementScope) {
    return {
      alertEligible: false,
      status: "SCOPE_OR_PERIOD_MISMATCH",
      details: {
        xbrl: { quarterEnded: xbrlFin.quarterEnded, scope: xbrlFin.statementScope },
        pdf: { quarterEnded: pdfFin.quarterEnded, scope: pdfFin.statementScope }
      }
    };
  }

  const close = (a, b) => {
    if (a === null || b === null || isNaN(a) || isNaN(b)) return false;
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) <= 0.005; // 0.5% tolerance
  };

  const xbrlPat = xbrlFin.patConsolidated ?? xbrlFin.patStandalone;
  const pdfPat = pdfFin.patConsolidated ?? pdfFin.patStandalone;

  const revMatch = close(xbrlFin.revenue, pdfFin.revenue);
  const patMatch = close(xbrlPat, pdfPat);

  if (revMatch && patMatch) {
    return {
      ...xbrlFin,
      alertEligible: true,
      status: "RECONCILED",
      reconciledWithPdf: true
    };
  }

  return {
    ...xbrlFin,
    alertEligible: false,
    status: "DISCREPANCY",
    details: {
      revenueDiff: Math.abs((xbrlFin.revenue || 0) - (pdfFin.revenue || 0)),
      patDiff: Math.abs((xbrlPat || 0) - (pdfPat || 0))
    }
  };
}

/**
 * Extracts order book and order inflow numbers from XBRL explanatory text notes.
 */
export function extractOrderBookFromNotes(factLedger) {
  if (!factLedger || !Array.isArray(factLedger.notes)) return null;

  const combinedNotesText = factLedger.notes.map(n => n.text).join("\n\n");
  if (!combinedNotesText || !/order\s*book|orders\s*booked/i.test(combinedNotesText)) return null;

  const metrics = extractOrderBookMetrics(combinedNotesText);
  if (!metrics || (!metrics.orderBookTotalCr && !metrics.orderInflowCr)) return null;

  return {
    total: metrics.orderBookTotalCr,
    standalone: metrics.orderBookStandaloneCr,
    consolidated: metrics.orderBookConsolidatedCr,
    inflows: metrics.orderInflowCr,
    unit: "Crores",
    line: metrics.line
  };
}
