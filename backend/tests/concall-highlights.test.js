/**
 * Concall highlights in the analyst write-up format (guidance & outlook with what CHANGED, numbers, business, capex, initiatives,
 * risks, analyst take). The figures below are the ones management stated on the real SJS Enterprises Q2 FY27 call (2026-11-05,
 * transcribed from the company's own recording): the call cut revenue-growth guidance and raised the margin guidance, and an
 * earlier version of the pipeline reported none of it.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  segmentCall, splitTranscript, mergeConcallHighlights, parseHighlightReply, buildHighlightPrompts, HIGHLIGHT_LIST_FIELDS
} from "../services/concall-highlights.service.js";
import {
  buildDigestItem, compactHighlights, guidanceCutsOf, formatConcallHighlightsBlock, formatThesisDigestMessage, buildSignalRationale
} from "../services/thesis-digest.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const real = (name) => fs.readFileSync(path.resolve(here, "fixtures/real-layouts", name), "utf8");

const SJS_HIGHLIGHTS = {
  guidance_changes: [
    "Revenue growth outlook: 1.5 to 2x industry growth -> 1.2 to 1.5x (cut), due to the global macroeconomic environment",
    "EBITDA margin guidance: 27-28% -> 29-30% (raised), on cost efficiencies and a better product mix"
  ],
  annual_guidance: ["Export revenue share: 14-15% by FY28"],
  quarterly_guidance: [],
  multi_year_targets: ["Chrome plating: double capacity in the next three to four years"],
  financial_performance: [
    "Consolidated revenue (Q2 FY27): 16.9% YoY growth to rupees 2827.3 million",
    "Q2 FY27 EBITDA: 23.1% growth to Rs. 896.4 million, margin 31% (144 bps improvement)",
    "Q2 FY27 PAT: 34.8% growth to Rs. 583.3 million"
  ],
  business_performance: ["Automotive business growth (Q2 FY27): 21.7% YoY, industry growth 13.2%", "New customers added: Harman, Tadmi, Tata Motors"],
  operational_highlights: ["Bangalore plant expansion complete, commercial production starting in Q3 FY27", "Total capex FY26-FY28: Rs. 2700 to 2850 million, funded from internal accruals"],
  growth_initiatives: ["Automotive display facility in Pune operational in Q2 FY28, capex Rs. 650 million"],
  key_positives: ["Record 31% EBITDA margin", "Strong net cash position of Rs 3,318.7 million"],
  key_challenges: ["Consumer segment hit by weak demand and rationalisation of low-margin products"],
  key_monitorables: ["Ramp-up of the new Pune and Bangalore capacity"],
  management_tone: "Confident, disciplined",
  key_takeaway: "Record Q2 margin, but management cut its FY27 revenue growth outlook while raising margin guidance."
};

describe("transcript splitting: an hour-long call is read in parts, not cut at its first 40%", () => {
  const sentence = "Management said that demand remained healthy in the quarter. ";
  it("a short transcript stays whole", () => {
    expect(splitTranscript("Short call. ".repeat(50))).toHaveLength(1);
    expect(splitTranscript("")).toEqual([]);
  });
  it("a 53,000-character call (the real SJS recording) becomes three parts that together hold all of it", () => {
    const text = sentence.repeat(Math.ceil(53441 / sentence.length));
    const parts = splitTranscript(text);
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(20500);
    expect(parts.join(" ").replace(/\s+/g, " ").length).toBeGreaterThan(text.replace(/\s+/g, " ").length - 10);
  });
  it("a call longer than three parts can hold keeps its beginning and its end", () => {
    const text = `START ${"filler sentence here. ".repeat(4000)} END-OF-QA`;
    const parts = splitTranscript(text);
    expect(parts.length).toBeLessThanOrEqual(3);
    expect(parts[0]).toContain("START");
    expect(parts[parts.length - 1]).toContain("END-OF-QA");
  });
});

describe("merging the per-part model results", () => {
  it("concatenates, drops near-duplicates, and prefers a takeaway that reports a cut", () => {
    const merged = mergeConcallHighlights([
      { guidance_changes: ["Revenue growth outlook: 1.5 to 2x -> 1.2 to 1.5x (cut), due to macro"], financial_performance: ["Q2 FY27 EBITDA margin: 31%"], key_takeaway: "Record quarter with strong margins.", management_tone: "Confident" },
      { guidance_changes: ["revenue growth: 1.5x to 2x -> 1.2x to 1.5x (cut), due to macro"], financial_performance: ["Q2 FY27 EBITDA margin: 31%", "PAT up 34.8% to Rs. 583.3 million"], key_takeaway: "Management cut FY27 revenue growth guidance on the call." },
      null
    ]);
    expect(merged.guidance_changes).toHaveLength(1);
    expect(merged.financial_performance).toHaveLength(2);
    expect(merged.key_takeaway).toMatch(/cut/);
    expect(merged.management_tone).toBe("Confident");
    expect(merged.management_guidance).toEqual([]);
    expect(mergeConcallHighlights([null, undefined])).toBeNull();
  });
  it("parses a fenced JSON reply and rejects prose", () => {
    expect(parseHighlightReply("```json\n{\"key_takeaway\":\"x\"}\n```")).toEqual({ key_takeaway: "x" });
    expect(parseHighlightReply("no json here")).toBeNull();
  });
  it("the prompt names every list the formatter reads, and holds no company name or sample figure (AGENTS.md rule 6)", () => {
    const { system, user } = buildHighlightPrompts({ ticker: "ABC", companyName: "Abc Ltd", text: "transcript", partIndex: 1, partCount: 3 });
    for (const f of HIGHLIGHT_LIST_FIELDS) expect(user).toContain(`"${f}"`);
    expect(user).toContain("part 2 of 3");
    expect(`${system}${user}`).not.toMatch(/SJS|Shivalik|Transrail|₹\s?\d|Rs\.?\s?\d/i);
  });
  it("asks for forward commitments across fiscal years and business scopes without treating a segment target as group guidance", () => {
    const { user } = buildHighlightPrompts({ ticker: "ABC", companyName: "Abc Ltd", text: "transcript" });
    expect(user).toMatch(/future fiscal year/i);
    expect(user).toMatch(/segment|subsidiary/i);
    expect(user).toMatch(/milestone/i);
    expect(user).toMatch(/scope.*(?:company|segment)/i);
  });
});

describe("guidance cuts are recognised by the marker the model writes, not by words elsewhere in the bullet", () => {
  it("a revision marked (cut) is a cut even when the reason says 'increased'", () => {
    expect(guidanceCutsOf({ guidance_changes: ["Revenue growth: 1.5x -> 1.2x (cut), due to increased costs"] })).toHaveLength(1);
  });
  it("a raise, a reaffirmation and an unrelated word like 'execution' are not cuts", () => {
    expect(guidanceCutsOf({ guidance_changes: ["EBITDA margin: 27% -> 29% (raised)", "Capex: Rs 270 million (reaffirmed)", "Execution remained strong"] })).toEqual([]);
  });
  it("an unmarked bullet that says the guidance was reduced is a cut", () => {
    expect(guidanceCutsOf({ guidance_changes: ["Management reduced the FY27 volume outlook"] })).toHaveLength(1);
  });
});

describe("the analyst write-up block", () => {
  const item = { kind: "CONCALL", title: "Earnings Call", url: "https://example.org/call.pdf", highlights: compactHighlights(SJS_HIGHLIGHTS) };
  const block = formatConcallHighlightsBlock(item, "[Earnings Call](https://example.org/call.pdf)");

  it("has the seven sections in the analyst's order", () => {
    const order = ["GUIDANCE & OUTLOOK", "QUARTERLY NUMBERS", "BUSINESS & SEGMENTS", "CAPACITY & CAPEX", "NEW INITIATIVES", "RISKS & CONCERNS", "ANALYST TAKE"].map((t) => block.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("shows a cut with 🔻 and a raise with 🔺, before the other guidance", () => {
    expect(block).toMatch(/🔻 Revenue growth outlook: 1\.5 to 2x industry growth -> 1\.2 to 1\.5x \(cut\)/);
    expect(block).toMatch(/🔺 EBITDA margin guidance: 27-28% -> 29-30% \(raised\)/);
    expect(block.indexOf("🔻")).toBeLessThan(block.indexOf("Export revenue share"));
  });
  it("carries what to monitor and the bottom line", () => {
    expect(block).toContain("👀 Monitor: Ramp-up of the new Pune and Bangalore capacity");
    expect(block).toContain("🔑 Record Q2 margin, but management cut its FY27 revenue growth outlook");
  });
  it("an empty section is left out, and a filing without highlights renders nothing", () => {
    const sparse = formatConcallHighlightsBlock({ kind: "CONCALL", highlights: compactHighlights({ guidance_changes: [], financial_performance: ["Revenue: 10% growth to Rs. 100 crore"], key_takeaway: null }) }, "x");
    expect(sparse).toContain("QUARTERLY NUMBERS");
    expect(sparse).not.toContain("NEW INITIATIVES");
    expect(formatConcallHighlightsBlock({ kind: "CONCALL" }, "x")).toBe("");
    expect(compactHighlights({})).toBeNull();
  });
  it("Telegram Markdown characters inside model text are neutralised", () => {
    const b = formatConcallHighlightsBlock({ kind: "CONCALL", highlights: compactHighlights({ financial_performance: ["Revenue *grew* [a lot] to `Rs. 100` crore in Q2"] }) }, "x");
    expect(b).not.toMatch(/Revenue \*grew\*|\[a lot\]|`Rs/);
  });
});

describe("the digest for a concall (SJS, 2026-11-05)", () => {
  const callItem = buildDigestItem({
    kind: "CONCALL", title: "Earnings Call (audio)", url: "https://example.org/call.mp3", filedAt: "2026-11-05T09:25:00.000Z",
    verdict: { final_action: "HOLD / MONITOR", conviction_score: 5, verdict_summary: "Record margin; growth guidance cut.", concall_highlights: SJS_HIGHLIGHTS }
  });
  const board = [{ driver: "Operating EBITDA Margin Resilience (>24%)", status: "CONFIRMED", evidence: "Q2 EBITDA margin 31%", materiality: "HIGH", asOf: "2026-11-05T09:25:00.000Z" }];
  const msg = formatThesisDigestMessage({
    ticker: "SJS", companyName: "SJS Enterprises Ltd", items: [callItem], board, financialsBlock: "",
    fin: null, periodLabel: "Q2 FY27", concall: { status: "ANALYSED" }
  });

  it("stores the cut on the item", () => {
    expect(callItem.guidanceCuts).toHaveLength(1);
    expect(callItem.highlights.guidance_changes).toHaveLength(2);
  });
  it("leads with the call write-up, ahead of the driver board", () => {
    expect(msg.indexOf("GUIDANCE & OUTLOOK")).toBeGreaterThan(0);
    expect(msg.indexOf("GUIDANCE & OUTLOOK")).toBeLessThan(msg.indexOf("DRIVER BOARD"));
  });
  it("says the signal rests on the guidance cut, so 'drivers intact' next to HOLD is explained", () => {
    expect(msg).toMatch(/management cut guidance on the call: Revenue growth outlook/);
  });
  it("is one message that fits Telegram's 4096-character limit", () => {
    expect(msg.length).toBeLessThan(4096);
  });
  it("buildSignalRationale reports the concall as analysed", () => {
    expect(buildSignalRationale({ lead: callItem, board, fin: null, concall: { status: "ANALYSED" }, itemKinds: ["CONCALL"], cuts: callItem.guidanceCuts })).toContain("✅ analysed");
  });
});

describe("the same highlight report for an investor presentation / press release", () => {
  it("asks about the presentation, not a call transcript, and keeps the abstract-only rule (AGENTS.md rule 6)", () => {
    const { system, user } = buildHighlightPrompts({ ticker: "ABC", companyName: "Abc Ltd", text: "Slide text", docKind: "presentation" });
    expect(`${system} ${user}`).toMatch(/presentation highlight/i);
    expect(`${system} ${user}`).not.toMatch(/conference call transcript/i);
    expect(user).toContain('"guidance_changes"');
    expect(user).toContain('"operational_highlights"');
    // the call prompt is unchanged
    const call = buildHighlightPrompts({ ticker: "ABC", companyName: "Abc Ltd", text: "Call text" });
    expect(`${call.system} ${call.user}`).toMatch(/concall highlight/i);
    expect(`${call.system} ${call.user}`).not.toMatch(/presentation highlight/i);
  });
});

import { sanitizeConcallHighlights } from "../services/institutional-guard.service.js";

describe("highlight list caps (a call write-up listed up to 18 bullets in one section)", () => {
  it("mergeConcallHighlights keeps each list short: changes first, at most 8 changes / 10 of the others / 6 positives", () => {
    const many = (p, n) => Array.from({ length: n }, (_, i) => `${p} item number ${i} with its own distinct wording alpha${i} beta${i * 7}`);
    const merged = mergeConcallHighlights([{ guidance_changes: many("g", 14), financial_performance: many("f", 18), key_positives: many("p", 12) }]);
    expect(merged.guidance_changes).toHaveLength(8);
    expect(merged.financial_performance).toHaveLength(10);
    expect(merged.key_positives).toHaveLength(6);
    expect(merged.guidance_changes[0]).toContain("item number 0");   // order kept: the earliest survive
  });
});

describe("a name the transcript spells differently is not thrown away as invented (Whisper spelling)", () => {
  const doc = "We added new customers this quarter including Harman and Tata Motors and Stellantis in North America. " + "Passenger vehicle demand was healthy. ".repeat(5);
  it("keeps a bullet whose capitalised name is within one or two letters of a word the transcript contains", () => {
    const out = sanitizeConcallHighlights({ business_performance: ["New customers added: Harmon, Tata Motors", "Order from Stellantis in North America"] }, doc);
    expect(out.business_performance).toHaveLength(2);
  });
  it("still drops a name that is not in the transcript at all", () => {
    const out = sanitizeConcallHighlights({ business_performance: ["New customers added: Zorblax Industries"] }, doc);
    expect(out.business_performance).toHaveLength(0);
  });
});

describe("segmentCall: prepared remarks vs analyst Q&A, from the moderator's own cues (no model call)", () => {
  it("ELECON (real call: 'We take the first question from the line of CA Garvit Goyal from Serene Alpha Analytics')", () => {
    const seg = segmentCall(real("ELECON_call-transcript_2026-10-22.txt"));
    expect(seg.qa.length).toBeGreaterThanOrEqual(10);
    expect(seg.qa[0]).toMatchObject({ analyst: "Garvit Goyal", company: "Serene Alpha Analytics" });
    expect(seg.qa[1]).toMatchObject({ analyst: "Raj Shah", company: "Enam AMC" });
    expect(seg.qa[2]).toMatchObject({ analyst: "Pathanjali Srinivasan", company: "Sundaram Mutual Fund" });
    expect(seg.prepared).toContain("Harshit Kapadia:");          // management's opening
    expect(seg.prepared).not.toMatch(/^Garvit Goyal:/m);          // no analyst turn leaks into the prepared remarks
    expect(seg.qa[0].text).toMatch(/^Moderator\s*:/);             // an exchange starts at the moderator's turn
  });
  it("POLICYBZR (real call: the host is labelled 'Management:' and there is no Moderator)", () => {
    const seg = segmentCall(real("POLICYBZR_call-transcript-60k-cap_2026-11-04.txt"));
    expect(seg.qa.length).toBeGreaterThanOrEqual(9);
    expect(seg.qa.slice(0, 3).map((e) => [e.analyst, e.company])).toEqual([["Sachin Salgaonkar", "BofA"], ["Manas Agarwal", "Bernstein"], ["Nidhesh Jain", "Investec"]]);
    expect(seg.prepared.length).toBeGreaterThan(5000);
  });
  it("SHAKTIPUMP (real call: an individual investor, and a company name that wraps over a line)", () => {
    const seg = segmentCall(real("SHAKTIPUMP_call-transcript_2026-10-31.txt"));
    expect(seg.qa[0].analyst).toBe("Varun Agrawal");
    expect(seg.qa[1]).toMatchObject({ analyst: "Dipak Rathod" });
    expect(seg.qa[1].company).toMatch(/^Marwadi Shares and Finance Limited/);
    expect(seg.qa[2]).toMatchObject({ analyst: "Deepak Purswani", company: "SVAN Investments" });
  });
  it("the pieces rebuild the call: nothing is lost or duplicated", () => {
    const t = real("ELECON_call-transcript_2026-10-22.txt");
    const seg = segmentCall(t);
    expect(`${seg.prepared}${seg.qa.map((e) => e.text).join("")}`).toBe(t);
  });
  it("an ANALYST saying 'last question from my end' (real CCL sentence) is not a new exchange", () => {
    const t = [
      "Moderator: The next question is from the line of Rahul Maheshwary from Ambit Investment Advisors.",
      "Rahul Maheshwary: First question on margins.",
      "Management: Margins will hold.",
      "Rahul Maheshwary: Right. And any -- last question from my end. Any wallet share increase you're witnessing from large customers? And the next question from the",
      "Management: Yes.",
      "Moderator: The next question is from the line of Vivek Ganguly from TCG AMC.",
      "Vivek Ganguly: Hello."
    ].join("\n");
    expect(segmentCall(t).qa.map((e) => e.analyst)).toEqual(["Rahul Maheshwary", "Vivek Ganguly"]);
  });
  it("an analyst introduced without a firm is not given 'please unmute your mic' as a company (real POLICYBZR line)", () => {
    const t = "Management: Our next question is from the line of Ashwin Mehta. Ashwin, please unmute your mic.\nAshwin Mehta: Hello.\nManagement: Thank you.";
    expect(segmentCall(t).qa[0]).toMatchObject({ analyst: "Ashwin Mehta", company: null });
  });
  it("a host without 'the line of' still counts when the host is the speaker (Zoom-style calls)", () => {
    const t = "Host: Our next question is from Rahul Maheshwary of Ambit.\nRahul Maheshwary: Hello.\nHost: The next question is from Vivek Ganguly at TCG AMC. Please go ahead.\nVivek Ganguly: Hi.";
    expect(segmentCall(t).qa.map((e) => e.analyst)).toEqual(["Rahul Maheshwary", "Vivek Ganguly"]);
  });
  it("no Q&A cue (a monologue, a deck, a Whisper transcript with no moderator) gives no structure", () => {
    expect(segmentCall("Management: Welcome. ".repeat(500)).qa).toBeNull();
    expect(segmentCall("").qa).toBeNull();
  });
});

describe("splitTranscript on structure: cut between exchanges, never inside an answer", () => {
  it("every part after the first starts at a moderator / host turn that introduces an analyst (real ELECON call)", () => {
    const parts = splitTranscript(real("ELECON_call-transcript_2026-10-22.txt"));
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.length).toBeLessThanOrEqual(3);
    for (const p of parts.slice(1)) expect(p).toMatch(/^(?:Moderator|MODERATOR|Management)\s*:[^\n]*\n?[^\n]*question[^\n]*\n?[^\n]*from/i);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(20500);
  });
  it("a call that nearly fills the three parts (real POLICYBZR, 60,000 characters) is still cut between exchanges, not by the equal-split fallback", () => {
    const parts = splitTranscript(real("POLICYBZR_call-transcript-60k-cap_2026-11-04.txt"));
    expect(parts).toHaveLength(3);
    for (const p of parts.slice(1)) expect(p).toMatch(/^Management\s*:[^\n]*\n?[^\n]*question[^\n]*\n?[^\n]*from/i);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(20500);
  });
  it("a call twice the budget keeps the prepared remarks whole and a trimmed exchange of EVERY analyst, the last one included (it used to chop the middle)", () => {
    const one = real("POLICYBZR_call-transcript-60k-cap_2026-11-04.txt");
    const doubled = `${one}\n${one.replace(/Sachin Salgaonkar/g, "Zed Lastperson")}`;
    expect(doubled.length).toBeGreaterThan(100000);
    const parts = splitTranscript(doubled);
    expect(parts.length).toBeLessThanOrEqual(3);
    const joined = parts.join("\n");
    expect(joined.length).toBeLessThanOrEqual(61000);
    const prepared = segmentCall(doubled).prepared;
    expect(joined).toContain(prepared.slice(0, 3000));
    expect(joined).toContain(prepared.slice(-3000));
    for (const name of ["Sachin Salgaonkar", "Manas Agarwal", "Nidhesh Jain", "Zed Lastperson"]) expect(joined, name).toContain(name);
  });
  it("a call with no structure is split exactly as before", () => {
    const text = "Management said that demand remained healthy in the quarter. ".repeat(Math.ceil(53441 / 61));
    expect(splitTranscript(text)).toHaveLength(3);
  });
});
