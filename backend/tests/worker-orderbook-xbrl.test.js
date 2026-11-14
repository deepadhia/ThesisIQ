import { describe, it, expect } from "vitest";
import {
  buildVerifiedFinancialsBlock,
  buildStage1Message
} from "../workers/quarterly-deepdive-worker.js";
import { extractOrderBookMetrics } from "../services/orderbook-parser.service.js";

describe("Worker Order Book & XBRL Integration", () => {
  it("renders order book metrics inside buildVerifiedFinancialsBlock", () => {
    const fin = {
      revenue: 176.66,
      revenueYoYGrowthPct: 15.2,
      ebitda: 25.0,
      ebitdaMarginPct: 14.15,
      patConsolidated: 12.35,
      patYoYGrowthPct: 8.5,
      statementScope: "CONSOLIDATED",
      orderBook: {
        orderBookTotalCr: 4707.59,
        line: "📦 *Order Book:* ₹3,937 Cr (standalone) | ₹4,707.59 Cr (consolidated) • Book-to-Bill: 4.1x"
      }
    };

    const block = buildVerifiedFinancialsBlock(fin);
    expect(block).toContain("• *Revenue:* ₹176.66 Cr (+15.2% YoY)");
    expect(block).toContain("• *Order Book:* ₹3,937 Cr (standalone) | ₹4,707.59 Cr (consolidated) • Book-to-Bill: 4.1x");
  });

  it("renders order book metrics in buildStage1Message when order_book is present in verdict", () => {
    const text = `
      Astra Microwave reports Q2 results.
      Standalone order book was ₹3,937 Cr.
      Consolidated order book reached ₹4,707.59 Cr.
      Order inflows for the quarter were ₹420 Cr.
    `;
    const ob = extractOrderBookMetrics(text, { trailingRevenueCr: 1140 });

    const msg = buildStage1Message({
      item: { ticker: "ASTRAMICRO", title: "Financial Results for Q2 FY27", filing_date: "2026-11-12" },
      verdict: {
        action_signal: "HOLD",
        conviction_score: 7,
        verdict_summary: "Robust order book execution with steady order inflows.",
        order_book: ob,
        thesis_gate_result: { decisionExplanation: "Order book intact; holding position." }
      },
      activeFin: {
        revenue: 228.0,
        revenueYoYGrowthPct: 18.0,
        patConsolidated: 26.5,
        patYoYGrowthPct: 14.0,
        statementScope: "CONSOLIDATED"
      },
      finSource: "THIS_FILING",
      periodLabel: "Q2 FY27"
    });

    expect(msg).toContain("ASTRAMICRO");
    expect(msg).toContain("*Order Book:* ₹3,937 Cr (standalone) | ₹4,707.59 Cr (consolidated)");
    expect(msg).toContain("Inflows: ₹420 Cr");
    expect(msg).toContain("Book-to-Bill: 4.1x");
  });

  it("renders order book in buildStage1Message even if activeFin is not present (presentation/deck)", () => {
    const ob = {
      orderBookTotalCr: 4707.59,
      line: "📦 *Order Book:* ₹4,707.59 Cr (consolidated) • Inflows: ₹420 Cr"
    };

    const msg = buildStage1Message({
      item: { ticker: "ASTRAMICRO", title: "Investor Presentation November 2026", filing_date: "2026-11-12" },
      verdict: {
        action_signal: "HOLD",
        conviction_score: 7,
        verdict_summary: "Strong order backlog pipeline.",
        order_book: ob,
        thesis_gate_result: { decisionExplanation: "Backlog remains robust." }
      },
      activeFin: null,
      finSource: null,
      periodLabel: "Q2 FY27"
    });

    expect(msg).toContain("ASTRAMICRO");
    expect(msg).toContain("Investor Presentation");
    expect(msg).toContain("📦 *Order Book:* ₹4,707.59 Cr (consolidated) • Inflows: ₹420 Cr");
  });
});
