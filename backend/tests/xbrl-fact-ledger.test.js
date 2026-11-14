import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  parseXbrlFactLedger,
  deriveQuarterScopeViews,
  reconcileFactLedgerWithPdf,
  extractOrderBookFromNotes
} from "../services/xbrl-fact-ledger.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const astraXmlPath = path.resolve(
  here,
  "../../data_node/ASTRAMICRO/FY27-Q1/ASTRAMICRO_FY27-Q1_raw_xbrl_30-JUN-2026_INTEGRATED_FILING_INDAS_1711094_10082026052315_WEB.xml"
);
const eleconXmlPath = path.resolve(
  here,
  "../../data_node/ELECON/FY27-Q1/ELECON_FY27-Q1_raw_xbrl_30-JUN-2026_INTEGRATED_FILING_INDAS_1690409_10072026035914_WEB.xml"
);

describe("Priority 2: Official XBRL Fact Provenance Ledger", () => {
  it("parses ASTRAMICRO raw XML into an append-only fact provenance ledger with exact taxonomy and units", () => {
    const xmlContent = fs.readFileSync(astraXmlPath, "utf8");
    const ledger = parseXbrlFactLedger(xmlContent, {
      filingId: "test-astra-filing-01",
      attachmentUrl: "https://nsearchives.nseindia.com/corporate/xbrl/ASTRAMICRO_FY27Q1.xml"
    });

    expect(ledger).toBeTruthy();
    expect(ledger.filingId).toBe("test-astra-filing-01");
    expect(ledger.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(ledger.taxonomy.isValidIndianTaxonomy).toBe(true);
    expect(ledger.taxonomy.schemaRef).toContain("in-capmkt-ent-2026-01-31.xsd");
    expect(ledger.entity.symbol).toBe("ASTRAMICRO");
    expect(ledger.entity.periodEnd).toBe("2026-06-30");
    expect(ledger.entity.nature).toBe("Consolidated");
    expect(ledger.totalFacts).toBeGreaterThan(30);

    const revFact = ledger.facts.find(f => f.concept === "RevenueFromOperations" && f.scope === "CONSOLIDATED");
    expect(revFact).toBeTruthy();
    expect(revFact.unitRef).toBe("INR");
    expect(revFact.numericValue).toBe(1766622000);
  });

  it("derives normalized consolidated financial views in Crores with complete audit provenance", () => {
    const xmlContent = fs.readFileSync(astraXmlPath, "utf8");
    const ledger = parseXbrlFactLedger(xmlContent, {
      filingId: "test-astra-filing-01",
      attachmentUrl: "https://nsearchives.nseindia.com/corporate/xbrl/ASTRAMICRO_FY27Q1.xml"
    });

    const views = deriveQuarterScopeViews(ledger);
    expect(views).toBeTruthy();
    const conView = views.find(v => v.statementScope === "CONSOLIDATED" && v.quarterEnded === "2026-06-30");
    expect(conView).toBeTruthy();
    expect(conView.revenue).toBe(176.66); // 1766622000 / 1e7
    expect(conView.patConsolidated).toBe(12.35); // 123483000 / 1e7
    expect(conView.ebitda).toBe(35.46); // PBT (12.75) + FinCost (10.81) + Dep (11.89)
    expect(conView.ebitdaMarginPct).toBe(20.07); // 35.46 / 176.66 * 100
    expect(conView.alertEligible).toBe(false); // Unreconciled with PDF is not alert eligible
    expect(conView.provenance.taxonomyValidated).toBe(true);
  });

  it("reconciles derived XBRL view against verified PDF financials to authorize alert eligibility", () => {
    const xmlContent = fs.readFileSync(astraXmlPath, "utf8");
    const ledger = parseXbrlFactLedger(xmlContent, {
      filingId: "test-astra-filing-01",
      attachmentUrl: "https://nsearchives.nseindia.com/corporate/xbrl/ASTRAMICRO_FY27Q1.xml"
    });

    const views = deriveQuarterScopeViews(ledger);
    const conView = views.find(v => v.statementScope === "CONSOLIDATED" && v.quarterEnded === "2026-06-30");

    // Exact matching PDF
    const matchingPdfFin = {
      quarterEnded: "2026-06-30",
      statementScope: "CONSOLIDATED",
      revenue: 176.66,
      patConsolidated: 12.35
    };
    const reconciled = reconcileFactLedgerWithPdf(conView, matchingPdfFin);
    expect(reconciled.status).toBe("RECONCILED");
    expect(reconciled.alertEligible).toBe(true);

    // Mismatched revenue PDF
    const divergingPdfFin = {
      quarterEnded: "2026-06-30",
      statementScope: "CONSOLIDATED",
      revenue: 250.00,
      patConsolidated: 12.35
    };
    const rejected = reconcileFactLedgerWithPdf(conView, divergingPdfFin);
    expect(rejected.status).toBe("DISCREPANCY");
    expect(rejected.alertEligible).toBe(false);
  });

  it("extracts verified order book and inflow figures from XBRL explanatory notes", () => {
    const xmlContent = fs.readFileSync(astraXmlPath, "utf8");
    const ledger = parseXbrlFactLedger(xmlContent, {
      filingId: "test-astra-filing-01",
      attachmentUrl: "https://nsearchives.nseindia.com/corporate/xbrl/ASTRAMICRO_FY27Q1.xml"
    });

    const orderBook = extractOrderBookFromNotes(ledger);
    expect(orderBook).toBeTruthy();
    expect(orderBook.total).toBe(2849.09);
    expect(orderBook.inflows).toBe(431.91);
    expect(orderBook.unit).toBe("Crores");
  });

  it("parses multi-segment industrial issuer (ELECON) with segment revenue breakdown", () => {
    const xmlContent = fs.readFileSync(eleconXmlPath, "utf8");
    const ledger = parseXbrlFactLedger(xmlContent, {
      filingId: "test-elecon-filing-01",
      attachmentUrl: "https://nsearchives.nseindia.com/corporate/xbrl/ELECON_FY27Q1.xml"
    });

    expect(ledger.entity.symbol).toBe("ELECON");
    const views = deriveQuarterScopeViews(ledger);
    const conView = views.find(v => v.statementScope === "CONSOLIDATED" && v.quarterEnded === "2026-06-30");
    expect(conView.revenue).toBe(520.56); // 5205600000 / 1e7
    expect(conView.patConsolidated).toBe(70.35); // 703500000 / 1e7
    expect(conView.ebitda).toBe(131.03); // PBT (93.16) + FinCost (8.11) + Dep (29.76)
  });
});
