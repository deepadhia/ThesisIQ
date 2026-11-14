import { describe, it, expect } from "vitest";
import {
  formatXbrlRowAsFinancials,
  parseXbrlXmlToFinancials,
  reconcileOrEnrichFinancials
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
  });

  it("reconciles and enriches PDF-parsed financials with missing XBRL data", () => {
    const pdfFin = {
      revenue: 176.66,
      patConsolidated: 12.35,
      ebitda: null,
      ebitdaMarginPct: null,
      isVerified: true
    };

    const xbrlFin = {
      revenue: 176.66,
      patConsolidated: 12.35,
      ebitda: 25.0,
      ebitdaMarginPct: 14.15,
      isVerified: true
    };

    const enriched = reconcileOrEnrichFinancials(pdfFin, xbrlFin);
    expect(enriched.ebitda).toBe(25.0);
    expect(enriched.ebitdaMarginPct).toBe(14.15);
    expect(enriched.xbrlReconciled).toBe(true);
  });
});
