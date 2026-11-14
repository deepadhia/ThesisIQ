import { describe, it, expect } from "vitest";
import {
  formatXbrlRowAsFinancials,
  parseXbrlXmlToFinancials,
  reconcileOrEnrichFinancials,
  resolveXbrlFinancialsForFiling
} from "../services/xbrl-alert-bridge.service.js";

describe("XBRL Alert Bridge Service", () => {
  it("formats database xbrl_metrics_quarterly row into normalized verified financials", () => {
    const row = {
      ticker: "ASTRAMICRO",
      quarter: "FY27-Q1",
      period_end_date: "2026-06-30T00:00:00.000Z",
      revenue_from_ops: "1766622000.00", // ₹176.66 Cr in absolute INR
      pat: "123483000.00",             // ₹12.35 Cr in absolute INR
      ebitda: "250000000.00",          // ₹25.00 Cr in absolute INR
      revenue_growth_yoy: 15.2,
      pat_growth_yoy: 8.5
    };

    const fin = formatXbrlRowAsFinancials(row);
    expect(fin).toBeDefined();
    expect(fin.revenue).toBe(176.66);
    expect(fin.patConsolidated).toBe(12.35);
    expect(fin.ebitda).toBe(25.0);
    expect(fin.ebitdaMarginPct).toBe(14.15);
    expect(fin.revenueYoYGrowthPct).toBe(15.2);
    expect(fin.isVerified).toBe(true);
    expect(fin.source).toBe("XBRL_XML");
    expect(fin.alertEligible).toBe(false);
    expect(fin.statementScope).toBe("CONSOLIDATED");
  });

  it("parses raw XBRL XML text into verified financials", async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
    <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:in-capmkt="http://www.sebi.gov.in/xbrl/2025-01-31">
      <in-capmkt:NatureOfReportStandaloneConsolidated>Consolidated</in-capmkt:NatureOfReportStandaloneConsolidated>
      <xbrli:context id="Q1_2026">
        <xbrli:entity><xbrli:identifier scheme="http://www.bseindia.com">532839</xbrli:identifier></xbrli:entity>
        <xbrli:period>
          <xbrli:startDate>2026-04-01</xbrli:startDate>
          <xbrli:endDate>2026-06-30</xbrli:endDate>
        </xbrli:period>
      </xbrli:context>
      <in-capmkt:RevenueFromOperations contextRef="Q1_2026">1766622000</in-capmkt:RevenueFromOperations>
      <in-capmkt:ProfitLossForPeriod contextRef="Q1_2026">123483000</in-capmkt:ProfitLossForPeriod>
      <in-capmkt:ProfitBeforeTax contextRef="Q1_2026">160000000</in-capmkt:ProfitBeforeTax>
      <in-capmkt:FinanceCosts contextRef="Q1_2026">40000000</in-capmkt:FinanceCosts>
      <in-capmkt:DepreciationAndAmortisationExpense contextRef="Q1_2026">50000000</in-capmkt:DepreciationAndAmortisationExpense>
    </xbrli:xbrl>`;

    const fin = await parseXbrlXmlToFinancials(xml);
    expect(fin).toBeDefined();
    expect(fin.revenue).toBe(176.66);
    expect(fin.patConsolidated).toBe(12.35);
    // EBITDA = PBT (16 Cr) + Fin Cost (4 Cr) + Dep (5 Cr) = 25 Cr
    expect(fin.ebitda).toBe(25.0);
    expect(fin.isVerified).toBe(true);
    expect(fin.source).toBe("XBRL_XML");
    expect(fin.quarterEnded).toBe("2026-06-30");
  });

  it("selects the latest dated quarter even when prior-period contexts appear first", async () => {
    const xml = `<?xml version="1.0"?><xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:in-capmkt="http://www.sebi.gov.in/xbrl/2025-01-31">
      <in-capmkt:NatureOfReportStandaloneConsolidated>Consolidated</in-capmkt:NatureOfReportStandaloneConsolidated>
      <xbrli:context id="prior"><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
      <xbrli:context id="current"><xbrli:period><xbrli:startDate>2026-07-01</xbrli:startDate><xbrli:endDate>2026-09-30</xbrli:endDate></xbrli:period></xbrli:context>
      <in-capmkt:RevenueFromOperations contextRef="prior">1000000000</in-capmkt:RevenueFromOperations>
      <in-capmkt:RevenueFromOperations contextRef="current">2000000000</in-capmkt:RevenueFromOperations>
    </xbrli:xbrl>`;
    const fin = await parseXbrlXmlToFinancials(xml);
    expect(fin.quarterEnded).toBe("2026-09-30");
    expect(fin.revenue).toBe(200);
    expect(fin.alertEligible).toBe(false);
  });

  it("reconciles and enriches PDF-parsed financials with missing XBRL data", () => {
    const pdfFin = {
      revenue: 176.66,
      patConsolidated: 12.35,
      ebitda: null,
      ebitdaMarginPct: null,
      isVerified: true,
      quarterEnded: "2026-06-30",
      statementScope: "CONSOLIDATED"
    };

    const xbrlFin = {
      revenue: 176.66,
      patConsolidated: 12.35,
      ebitda: 25.0,
      ebitdaMarginPct: 14.15,
      isVerified: true,
      alertEligible: true,
      quarterEnded: "2026-06-30",
      statementScope: "CONSOLIDATED"
    };

    const enriched = reconcileOrEnrichFinancials(pdfFin, xbrlFin);
    expect(enriched.ebitda).toBe(25.0);
    expect(enriched.ebitdaMarginPct).toBe(14.15);
    expect(enriched.xbrlReconciled).toBe(true);
  });

  it("does not import EBITDA from a different revenue, reporting period, or statement scope", () => {
    const pdf = { revenue: 200, patConsolidated: 12.35, ebitda: null, quarterEnded: "2026-09-30", statementScope: "CONSOLIDATED", isVerified: true };
    const xbrl = { revenue: 176.66, patConsolidated: 12.35, ebitda: 25, quarterEnded: "2026-09-30", statementScope: "CONSOLIDATED", isVerified: true, alertEligible: true };
    expect(reconcileOrEnrichFinancials(pdf, xbrl)).toEqual(pdf);
    expect(reconcileOrEnrichFinancials(pdf, { ...xbrl, revenue: 200, quarterEnded: "2026-06-30" })).toEqual(pdf);
    expect(reconcileOrEnrichFinancials(pdf, { ...xbrl, revenue: 200, statementScope: "STANDALONE" })).toEqual(pdf);
    expect(reconcileOrEnrichFinancials({ ...pdf, patConsolidated: 10 }, { ...xbrl, revenue: 200, patConsolidated: 20 }))
      .toEqual({ ...pdf, patConsolidated: 10 });
    expect(reconcileOrEnrichFinancials(null, { ...xbrl, alertEligible: false })).toBeNull();
    expect(reconcileOrEnrichFinancials({ ...pdf, revenue: 176.66, patConsolidated: 12.35 },
      { ...xbrl, patConsolidated: 12.35, alertEligible: false }))
      .toEqual({ ...pdf, revenue: 176.66, patConsolidated: 12.35 });
  });

  it("does not authorize a legacy quarterly row without exact filing provenance and unit metadata", async () => {
    const pool = { query: async () => ({ rows: [{
      ticker: "EXAMPLE", period_end_date: "2026-09-30", revenue_from_ops: "1766622000", pat: "123483000",
      ebitda: "250000000", source: "nse_api", metric_metadata: {}
    }] }) };
    expect(await resolveXbrlFinancialsForFiling("EXAMPLE", "2026-09-30", pool, {
      attachmentUrl: "https://example.test/filing.pdf"
    })).toBeNull();
    expect(await resolveXbrlFinancialsForFiling("EXAMPLE", null, pool, {
      attachmentUrl: "https://example.test/filing.pdf"
    })).toBeNull();
  });

  it("accepts only an explicitly validated same-filing INR row and preserves a negative profit", async () => {
    const sourceUrl = "https://example.test/official-results.pdf";
    const pool = { query: async () => ({ rows: [{
      ticker: "EXAMPLE", period_end_date: "2026-09-30", revenue_from_ops: "1766622000",
      pat: "-123483000", ebitda: "250000000", source: "validated_xml",
      metric_metadata: { alert_provenance: {
        taxonomy_validated: true, unit: "INR", scope: "CONSOLIDATED", period_end: "2026-09-30",
        source_url: sourceUrl, fields: { revenue_from_ops: "validated", pat: "validated" }
      } }
    }] }) };
    const fin = await resolveXbrlFinancialsForFiling("EXAMPLE", "2026-09-30", pool, { attachmentUrl: sourceUrl });
    expect(fin.alertEligible).toBe(true);
    expect(fin.revenue).toBe(176.66);
    expect(fin.patConsolidated).toBe(-12.35);
    expect(fin.patStandalone).toBeNull();
    expect(fin.ebitda).toBeNull();
    expect(await resolveXbrlFinancialsForFiling("EXAMPLE", "2026-09-30", pool, {
      attachmentUrl: "https://example.test/other-results.pdf"
    })).toBeNull();
  });
});
