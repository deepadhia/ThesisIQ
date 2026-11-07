/**
 * Guidance pacing: where the year-to-date stands against what management guided for the full year, and what the rest of the year
 * must deliver. Stock prices move on guidance and on whether it is being fulfilled. Figures: the real SHAKTIPUMP Q2 FY27 statement
 * (see ytd-columns.test.js): H1 revenue 1,604.70 vs 1,288.85 (+24.51%), FY26 revenue 2,697.61, so last year's H2 = 1,408.76.
 */
import { describe, it, expect } from "vitest";
import { computeGuidancePacing, formatPacingSection, pacingSeverity, PACING } from "../services/guidance-pacing.service.js";

const fin = {
  quarterEnded: "2026-09-30", ytdMonths: 6,
  ytdRevenue: 1604.7, ytdRevenuePrior: 1288.85, fyPriorRevenue: 2697.61, ytdRevenueYoYGrowthPct: 24.51,
  ytdEbitda: 146.89, ytdEbitdaPrior: 279.52, fyPriorEbitda: 421.7, ytdEbitdaMarginPct: 9.15, ytdEbitdaMarginPriorPct: 21.69, ebitdaMarginPct: 7.5,
  ytdPat: 90.1, ytdPatPrior: 187.54, fyPriorPat: 257.58, ytdPatYoYGrowthPct: -51.96
};
const g = (statement, metric, target_value, extra = {}) => ({ statement, metric, target_value, timeline: "FY27", quarter: "Q4 FY26", ...extra });

describe("revenue growth guidance", () => {
  it("AHEAD when the rest of the year needs less growth than the half-year delivered (guide 20-25%: H2 needs +15.9% to +25.5%, H1 grew +24.5%)", () => {
    const r = computeGuidancePacing({ commitments: [g("We guide for FY27 full year revenue growth of 20-25%.", "Revenue growth FY27", "20-25%")], fin });
    expect(r.items).toHaveLength(1);
    const it = r.items[0];
    expect(it.kind).toBe("REVENUE_GROWTH");
    expect(it.requiredLowPct).toBeCloseTo(15.88, 1);   // (2697.61 * 1.20 - 1604.70) / 1408.76 - 1
    expect(it.requiredHighPct).toBeCloseTo(25.45, 1);  // (2697.61 * 1.25 - 1604.70) / 1408.76 - 1
    expect(it.status).toBe("AHEAD");
  });

  it("BEHIND when the rest of the year must grow far faster than the half-year did (guide 35-40%: H2 needs +44.6%)", () => {
    const it = computeGuidancePacing({ commitments: [g("Full year FY27 revenue growth guidance of 35-40%.", "Revenue growth FY27", "35-40%")], fin }).items[0];
    expect(it.requiredLowPct).toBeCloseTo(44.6, 1);
    expect(it.gapPts).toBeCloseTo(20.1, 0);
    expect(it.status).toBe("BEHIND");
    expect(it.line).toMatch(/BEHIND/);
    expect(it.line).toMatch(/H1 \+24\.5%/);
    expect(it.line).toMatch(/H2 needs \+44\.6%/);
  });

  it("STRETCH in between (guide 28%: needs +31.2% in H2 vs +24.5%)", () => {
    const it = computeGuidancePacing({ commitments: [g("FY27 full year revenue growth of 28%", "Revenue growth FY27", "28%")], fin }).items[0];
    expect(it.status).toBe("STRETCH");
  });

  it("the thresholds are the documented ones", () => {
    expect(PACING).toMatchObject({ aheadPts: -5, onTrackPts: 3, stretchPts: 10 });
  });
});

describe("revenue in rupees", () => {
  it("a full-year revenue target is compared with the year to date (FY27 target Rs 3,300 Cr: H2 needs 1,695.3 Cr = +20.3%, ON_TRACK against H1 +24.5%)", () => {
    const it = computeGuidancePacing({ commitments: [g("We target full year FY27 revenue of Rs 3,300 crores.", "Revenue FY27", "₹3,300 Cr")], fin }).items[0];
    expect(it.kind).toBe("REVENUE_ABS");
    expect(it.requiredLowPct).toBeCloseTo(20.3, 1);
    expect(it.status).toBe("ON_TRACK");
    expect(it.line).toMatch(/1,695/);
  });

  it("a target BELOW the year to date is not 'already met': real data showed such figures are segments or mis-extractions (CCL 'Rs 550 Cr'), so it is ignored", () => {
    expect(computeGuidancePacing({ commitments: [g("FY27 revenue of Rs 1,500 crores for the full year.", "Revenue FY27", "₹1,500 Cr")], fin }).items).toEqual([]);
  });
});

describe("EBITDA margin guidance", () => {
  it("compares the year-to-date margin with the guided band (guide 10-11%, H1 9.15%: STRETCH, within one point below)", () => {
    const it = computeGuidancePacing({ commitments: [g("FY27 full year EBITDA margin guidance of 10-11%.", "EBITDA margin FY27", "10-11%")], fin }).items[0];
    expect(it.kind).toBe("EBITDA_MARGIN");
    expect(it.status).toBe("STRETCH");
    expect(it.line).toMatch(/9\.2%|9\.15%/);
  });
  it("BEHIND more than a point below the band, ON_TRACK inside it, AHEAD above it", () => {
    const run = (t) => computeGuidancePacing({ commitments: [g(`FY27 full year EBITDA margin of ${t}.`, "EBITDA margin FY27", t)], fin }).items[0].status;
    expect(run("12-13%")).toBe("BEHIND");
    expect(run("8-9%")).toBe("AHEAD");
    expect(computeGuidancePacing({ commitments: [g("FY27 full year EBITDA margin of 9-10%.", "EBITDA margin FY27", "9-10%")], fin }).items[0].status).toBe("ON_TRACK");
  });
});

describe("profit growth guidance", () => {
  it("uses the profit base of last year and says BEHIND when profit is falling against a growth guide (guide +20%: H1 PAT -52%)", () => {
    const it = computeGuidancePacing({ commitments: [g("FY27 full year PAT growth of 20%.", "PAT growth FY27", "20%")], fin }).items[0];
    expect(it.kind).toBe("PAT_GROWTH");
    expect(it.status).toBe("BEHIND");
  });
});

describe("what is never pacing", () => {
  it("nothing without year-to-date figures (a Q1 / Q4 statement, or an unreadable one)", () => {
    expect(computeGuidancePacing({ commitments: [g("FY27 full year revenue growth of 20-25%.", "Revenue growth FY27", "20-25%")], fin: { ...fin, ytdMonths: null, ytdRevenue: null } }).items).toEqual([]);
    expect(computeGuidancePacing({ commitments: [g("x", "Revenue growth FY27", "20%")], fin: null }).items).toEqual([]);
  });
  it("guidance for another year, quarterly guidance, multi-year targets and capex are ignored", () => {
    const items = computeGuidancePacing({ commitments: [
      g("FY28 full year revenue growth of 20-25%.", "Revenue growth FY28", "20-25%", { timeline: "FY28" }),
      g("Next quarter revenue growth of 12%.", "Revenue growth Q3 FY27", "12%", { timeline: "Q3 FY27" }),
      g("Revenue CAGR of 25% over the next 5 years.", "Revenue CAGR", "25%"),
      g("Capex of Rs 300 crores in FY27.", "Capex FY27", "₹300 Cr")
    ], fin }).items;
    expect(items).toEqual([]);
  });
  it("a revision replaces the earlier guide: the newest statement of a kind wins", () => {
    const newer = g("Revised: FY27 full year revenue growth of 15-18%.", "Revenue growth FY27", "15-18%", { created_at: "2026-11-05" });
    const older = g("FY27 full year revenue growth of 35-40%.", "Revenue growth FY27", "35-40%", { created_at: "2026-08-05" });
    const r = computeGuidancePacing({ commitments: [newer, older], fin });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].guidedText).toMatch(/15/);
  });
  it("a nine-month statement speaks of 9M and the last quarter", () => {
    const f9 = { ...fin, quarterEnded: "2026-12-31", ytdMonths: 9, ytdRevenue: 2500, ytdRevenuePrior: 2000, fyPriorRevenue: 2697.61, ytdRevenueYoYGrowthPct: 25 };
    const it = computeGuidancePacing({ commitments: [g("FY27 full year revenue growth of 30%.", "Revenue growth FY27", "30%")], fin: f9 }).items[0];
    expect(it.line).toMatch(/9M/);
    expect(it.line).toMatch(/Q4 needs/);
  });
});

describe("formatting and severity", () => {
  it("orders the worst first and keeps it short", () => {
    const items = computeGuidancePacing({ commitments: [
      g("FY27 full year revenue growth of 20-25%.", "Revenue growth FY27", "20-25%"),
      g("FY27 full year EBITDA margin of 12-13%.", "EBITDA margin FY27", "12-13%")
    ], fin }).items;
    const text = formatPacingSection(items);
    expect(text).toMatch(/GUIDANCE PACING/);
    expect(text.indexOf("BEHIND")).toBeLessThan(text.indexOf("AHEAD"));
    expect(text.split("\n").length).toBeLessThanOrEqual(5);
  });
  it("severity orders AHEAD < ON_TRACK < STRETCH < BEHIND, and an empty list formats to nothing", () => {
    expect(["BEHIND", "AHEAD", "STRETCH", "ON_TRACK"].sort((a, b) => pacingSeverity(a) - pacingSeverity(b))).toEqual(["AHEAD", "ON_TRACK", "STRETCH", "BEHIND"]);
    expect(formatPacingSection([])).toBe("");
  });
});

describe("implausible targets are not paced (a segment or quarterly figure mistaken for the full-year guide)", () => {
  it("an absolute revenue target below the year to date, or far outside last year's revenue, is ignored (CCL 'Rs 550 Cr' vs H1 2,411 Cr; LUMAXTECH 'Rs 2,500 Cr' vs H1 2,919 Cr)", () => {
    const run = (t, f = fin) => computeGuidancePacing({ commitments: [g(`We target FY27 full year revenue of ${t}.`, "Revenue FY27", `₹${t} Cr`)], fin: f }).items;
    expect(run("550")).toEqual([]);
    expect(run("1,500")).toEqual([]);                                   // below the half-year already reported
    expect(run("9,000")).toEqual([]);                                   // more than 3x last year
    expect(run("3,300")).toHaveLength(1);                               // a normal target still works
    expect(run("1,500", { ...fin, fyPriorRevenue: null })).toEqual([]); // without a base the year-to-date floor still applies
  });
});

describe("run-rate fallback when the filing does not print last year's full year (TRANSRAIL prints five columns)", () => {
  const noBase = { ...fin, fyPriorRevenue: null, fyPriorEbitda: null, fyPriorPat: null };
  it("a growth guide is compared with the year-to-date growth and the line says it is a run-rate", () => {
    const behind = computeGuidancePacing({ commitments: [g("FY27 full year revenue growth of 35-40%.", "Revenue growth FY27", "35-40%")], fin: noBase }).items[0];
    expect(behind.status).toBe("BEHIND");
    expect(behind.basis).toBe("RUN_RATE");
    expect(behind.line).toMatch(/run-rate/i);
    expect(behind.line).not.toMatch(/needs/);                        // it does not pretend to know what the rest of the year must deliver
    expect(computeGuidancePacing({ commitments: [g("FY27 full year revenue growth of 20-25%.", "Revenue growth FY27", "20-25%")], fin: noBase }).items[0].status).toBe("ON_TRACK");
    expect(computeGuidancePacing({ commitments: [g("FY27 full year revenue growth of 15-20%.", "Revenue growth FY27", "15-20%")], fin: noBase }).items[0].status).toBe("AHEAD");
  });
  it("the margin guide needs no base and is unchanged", () => {
    expect(computeGuidancePacing({ commitments: [g("FY27 full year EBITDA margin of 10-11%.", "EBITDA margin FY27", "10-11%")], fin: noBase }).items[0].status).toBe("STRETCH");
  });
});

describe("year-end outcome: was the full-year guide fulfilled? (management credibility)", () => {
  // the synthetic March-quarter statement of ytd-columns.test.js: FY revenue 3,100 vs 2,600 (+19.23%), margin 16.32%, PAT 327 vs 247 (+32.39%)
  const fy = { quarterEnded: "2027-03-31", fyEnded: "2027-03-31", fyRevenue: 3100, fyRevenuePrior: 2600, fyRevenueYoYGrowthPct: 19.23, fyEbitda: 506, fyEbitdaMarginPct: 16.32, fyPat: 327, fyPatPrior: 247, fyPatYoYGrowthPct: 32.39 };
  const out = (statement, metric, tv) => computeGuidancePacing({ commitments: [g(statement, metric, tv)], fin: fy });

  it("growth: MET at or above the bottom of the band, PARTIAL within 1.5 points below it, MISSED further below", () => {
    expect(out("FY27 full year revenue growth of 15-18%.", "Revenue growth FY27", "15-18%").items[0]).toMatchObject({ final: true, status: "MET" });
    expect(out("FY27 full year revenue growth of 20%.", "Revenue growth FY27", "20%").items[0].status).toBe("PARTIAL");
    expect(out("FY27 full year revenue growth of 25%.", "Revenue growth FY27", "25%").items[0].status).toBe("MISSED");
    expect(out("FY27 full year revenue growth of 15-18%.", "Revenue growth FY27", "15-18%").items[0].line).toMatch(/delivered \+19\.2%/);
  });
  it("rupee revenue: MET when reached, MISSED when more than 3% short", () => {
    expect(out("FY27 full year revenue of Rs 3,000 crores.", "Revenue FY27", "₹3,000 Cr").items[0].status).toBe("MET");
    expect(out("FY27 full year revenue of Rs 3,300 crores.", "Revenue FY27", "₹3,300 Cr").items[0].status).toBe("MISSED");
    expect(out("FY27 full year revenue of Rs 3,150 crores.", "Revenue FY27", "₹3,150 Cr").items[0].status).toBe("PARTIAL");   // 98.4% of target
  });
  it("margin: MET at or above the bottom, PARTIAL within half a point, MISSED below that", () => {
    expect(out("FY27 full year EBITDA margin of 16%.", "EBITDA margin FY27", "16%").items[0].status).toBe("MET");
    expect(out("FY27 full year EBITDA margin of 16.6%.", "EBITDA margin FY27", "16.6%").items[0].status).toBe("PARTIAL");
    expect(out("FY27 full year EBITDA margin of 17%.", "EBITDA margin FY27", "17%").items[0].status).toBe("MISSED");
  });
  it("the guide of ANOTHER year is not judged, and severity ranks MET best, MISSED worst", () => {
    expect(computeGuidancePacing({ commitments: [g("FY28 full year revenue growth of 15%.", "Revenue growth FY28", "15%", { timeline: "FY28" })], fin: fy }).items).toEqual([]);
    expect(["MISSED", "MET", "PARTIAL"].sort((a, b) => pacingSeverity(a) - pacingSeverity(b))).toEqual(["MET", "PARTIAL", "MISSED"]);
  });
});

describe("year end: the FIRST guide of the year is the credibility test, and a revision is visible", () => {
  const fy = { quarterEnded: "2027-03-31", fyEnded: "2027-03-31", fyRevenue: 3100, fyRevenuePrior: 2600, fyRevenueYoYGrowthPct: 19.23, fyEbitda: 506, fyEbitdaMarginPct: 16.32 };
  it("a guide cut during the year and then met is MET against the revised guide but MISSED against the original, and says so", () => {
    const original = g("FY27 full year revenue growth of 25-28%.", "Revenue growth FY27", "25-28%", { created_at: "2026-05-20", id: "c-first" });
    const revised = g("Revised: FY27 full year revenue growth of 15-18%.", "Revenue growth FY27", "15-18%", { created_at: "2026-11-05", id: "c-last" });
    const it = computeGuidancePacing({ commitments: [original, revised], fin: fy }).items[0];
    expect(it.status).toBe("MET");                       // the guide in force
    expect(it.commitmentId).toBe("c-last");
    expect(it.initial.status).toBe("MISSED");            // what management said at the start
    expect(it.initial.commitmentId).toBe("c-first");
    expect(it.revised).toBe(true);
  });
  it("a guide that was never revised has the same initial and in-force judgement", () => {
    const it = computeGuidancePacing({ commitments: [g("FY27 full year revenue growth of 15-18%.", "Revenue growth FY27", "15-18%", { id: "c1" })], fin: fy }).items[0];
    expect(it.initial.status).toBe(it.status);
    expect(it.revised).toBe(false);
  });
});

import { formatTrackRecord } from "../services/guidance-pacing.service.js";

describe("the verified track record shown in an alert (management credibility)", () => {
  const rows = [
    { fiscal_year: "FY26", kind: "REVENUE_GROWTH", status: "MET", guided_text: "15–18% growth" },
    { fiscal_year: "FY26", kind: "EBITDA_MARGIN", status: "MISSED", guided_text: "16%" },
    { fiscal_year: "FY25", kind: "REVENUE_ABS", status: "MET", guided_text: "₹2,500 Cr" },
    { fiscal_year: "FY25", kind: "REVENUE_GROWTH", status: "PARTIAL", guided_text: "20% growth" }
  ];
  it("says how many original full-year guides were met, and lists the misses and partials first", () => {
    const text = formatTrackRecord(rows);
    expect(text).toMatch(/GUIDANCE TRACK RECORD/);
    expect(text).toMatch(/2 of 4 met/);
    expect(text).toMatch(/1 partial/);
    expect(text).toMatch(/1 missed/);
    expect(text.indexOf("EBITDA margin")).toBeLessThan(text.indexOf("Revenue growth"));   // the miss is named before the hits
    expect(text.trim().split("\n").length).toBeLessThanOrEqual(5);   // header + at most four lines
  });
  it("nothing recorded yet means no line (no invented record)", () => {
    expect(formatTrackRecord([])).toBe("");
    expect(formatTrackRecord(null)).toBe("");
  });
});

describe("statements that are NOT a full-year company guide are not paced (found by running on the real database, each statement verbatim)", () => {
  const run = (statement, metric, tv, f = fin) => computeGuidancePacing({ commitments: [g(statement, metric, tv)], fin: f }).items;

  it("a multi-year guide is not a FY27 guide (ANANTRAJ: 'Revenue growth of 20% YoY for the next two years')", () => {
    expect(run("We expect to achieve Revenue growth of 20% YoY for the next two years.", "Revenue growth FY27", "20%")).toEqual([]);
    expect(run("Revenue CAGR of 20% over the next three years in FY27.", "Revenue growth", "20%")).toEqual([]);
  });

  it("a segment or brand figure is not company revenue (CCL: 'Domestic branded retail Continental coffee brand scaling at >30% YoY')", () => {
    expect(run("Domestic branded retail Continental coffee brand scaling at >30% YoY.", "Revenue growth FY27", "30%")).toEqual([]);
    expect(run("Export segment revenue growth of 25% for FY27.", "Revenue growth FY27", "25%")).toEqual([]);
    // ...but a consolidated / overall statement that mentions a segment as the DRIVER still counts
    expect(run("Mid double-digit consolidated revenue growth (~15%) for FY27, led by the export segment.", "Revenue growth FY27", "15%")).toHaveLength(1);
  });

  it("a first-half or quarterly figure is not a full-year guide (CCL: 'EBITDA growth of approximately 15% for the first half'), unless the statement also names the full year", () => {
    expect(run("EBITDA growth of approximately 15% for the first half.", "EBITDA margin FY27", "18.7%")).toEqual([]);
    expect(run("FY27E Revenue growth guidance of 20-22% (H1 FY27 on track at 18%)", "Revenue growth FY27", "20-22%")).toHaveLength(1);   // TRANSRAIL: full-year guide with an H1 aside
  });

  it("a margin that cannot be this company's EBITDA margin is a different measure (TRANSRAIL: '2.02% to 3.5%' against a real 11.8%)", () => {
    expect(run("EBITDA margin expected to remain around 2.02% to 3.5% range with long-term target stability.", "EBITDA margin FY27", "2.02-3.5%", { ...fin, ytdEbitdaMarginPct: 11.8 })).toEqual([]);
    expect(run("FY27 full year EBITDA margin of 10-11%.", "EBITDA margin FY27", "10-11%")).toHaveLength(1);
  });

  it("the guards do not remove a normal full-year guide", () => {
    expect(run("We are targeting a revenue growth of 20% YoY for FY27, driven by our auto premiumisation strategy.", "Revenue growth FY27", "20%")).toHaveLength(1);
    expect(run("Maintain overall EBITDA margin in the range of 22% to 24% for the year.", "EBITDA margin FY27", "22-24%", { ...fin, ytdEbitdaMarginPct: 22.2 })).toHaveLength(1);
  });
});

describe("a margin guide must be a statement about a margin (the AI extraction mis-files sentences under a margin metric)", () => {
  const run = (statement, tv) => computeGuidancePacing({ commitments: [g(statement, "EBITDA margin FY27", tv)], fin }).items;
  it("EBITDA GROWTH and unrelated sentences filed under 'EBITDA margin' are ignored (CCL, TRANSRAIL, verbatim)", () => {
    expect(run("FY27 consolidated EBITDA growth guidance in line with volume growth at around 15%", "15%")).toEqual([]);
    expect(run("International Turnkey Transmission Lines & Substation EPC Execution", "11%")).toEqual([]);
  });
  it("a real margin statement still counts", () => {
    expect(run("Maintain overall EBITDA margin in the range of 9% to 10% for the year in FY27.", "9-10%")).toHaveLength(1);
  });
});
