/**
 * Alerts that carry no investment information (2026-11-04/05): JSLL "incorporation of Ayugenomics, investment ₹3.00 lakh" and
 * SKIPPER "incorporation of Evergrid India, paid-up capital ₹1 Cr" were each sent as "🟢 POSITIVE — Strategic Catalyst / Value
 * Accretive", with a model-invented rationale ("domestic HVDC corridor contracts").
 */
import { describe, it, expect } from "vitest";
import { isImmaterialSubsidiaryFormation, largestRupeeAmountCr } from "../services/announcement.service.js";

describe("largestRupeeAmountCr reads every way an Indian filing writes an amount", () => {
  it("lakh, crore, million and full rupees", () => {
    expect(largestRupeeAmountCr("subscribe for ₹3.00 Lakhs")).toBeCloseTo(0.03, 4);
    expect(largestRupeeAmountCr("authorised capital of Rs. 25.00 Cr and paid-up capital of Rs. 1.00 Cr")).toBe(25);
    expect(largestRupeeAmountCr("investment of Rs. 50,00,00,000 (Rupees Fifty Crores only)")).toBe(50);
    expect(largestRupeeAmountCr("Rs. 1,250 million")).toBeCloseTo(125, 4);
    expect(largestRupeeAmountCr("no amount here")).toBeNull();
  });
});

describe("a small subsidiary formation is not an alert", () => {
  const jsll = "Board Meeting Outcome for Approval For The Proposed Incorporation Of A Subsidiary. The Board approved the incorporation of Ayugenomics Private Limited; the Company will subscribe to 60% of its equity share capital for a consideration of Rs. 3,00,000. Authorised share capital Rs. 5,00,000.";
  const skipper = "Intimation of incorporation of wholly owned subsidiary, Evergrid India Private Limited, to carry out transmission and EPC works. Authorised capital Rs. 25.00 Cr, paid-up capital Rs. 1.00 Cr.";
  it("JSLL (₹3 lakh) and SKIPPER (₹25 Cr authorised, ₹1 Cr paid up) are immaterial", () => {
    expect(isImmaterialSubsidiaryFormation("Board Meeting Outcome for Approval For The Proposed Incorporation Of A Subsidiary", jsll)).toBe(true);
    expect(isImmaterialSubsidiaryFormation("Updates", skipper)).toBe(true);
  });
  it("a formation with no amount stated is immaterial too", () => {
    expect(isImmaterialSubsidiaryFormation("Incorporation of wholly owned subsidiary", "The Company has incorporated a wholly owned subsidiary named X Private Limited.")).toBe(true);
  });
  it("a large investment in a new subsidiary is still an alert", () => {
    expect(isImmaterialSubsidiaryFormation("Incorporation of wholly owned subsidiary", "The Company incorporated a wholly owned subsidiary and will invest Rs. 300 crore in a new plant through it.")).toBe(false);
  });
  it("other events are never classed as a formation: an acquisition, an order, a capex announcement", () => {
    expect(isImmaterialSubsidiaryFormation("Acquisition of 51% stake", "The Company acquires 51% of Abc Ltd for Rs. 2 Cr.")).toBe(false);
    expect(isImmaterialSubsidiaryFormation("Receipt of order", "Order worth Rs. 5 crore received.")).toBe(false);
  });
});
