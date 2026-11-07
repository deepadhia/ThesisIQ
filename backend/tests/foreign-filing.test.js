/**
 * A filing belongs to ONE company. When the same document is saved under three or more tracked tickers the exchange feed answered
 * for the wrong company (NSE NextApi ignored the symbol on 2026-11-06: 522 foreign rows, 110 analysed, 148 already alerted under the
 * wrong ticker). The worker must never analyse or alert such a document, and must not need a manual patch to stop doing so.
 */
import { describe, it, expect, vi } from "vitest";
import { isForeignCopy, countTickersHoldingDocument, setAsideForeignFiling, FOREIGN_COPY_MIN_TICKERS } from "../services/foreign-filing.service.js";

describe("isForeignCopy", () => {
  it("three or more tracked tickers holding the same document is foreign; one or two (a parent and its subsidiary) is not", () => {
    expect(FOREIGN_COPY_MIN_TICKERS).toBe(3);
    expect(isForeignCopy(0)).toBe(false);
    expect(isForeignCopy(1)).toBe(false);
    expect(isForeignCopy(2)).toBe(false);
    expect(isForeignCopy(3)).toBe(true);
    expect(isForeignCopy("19")).toBe(true);
    expect(isForeignCopy(undefined)).toBe(false);
  });
});

describe("isForeignCopy: two holders are judged by the file's own company prefix (the flood stopped before a third copy for some documents)", () => {
  const url = (name) => `https://nsearchives.nseindia.com/corporate/${name}`;
  it("a document named for another company, held by two tracked tickers, is foreign for both", () => {
    // live 2026-11-06: GLAND_..._EarningsCallRecording sat under SKIPPER and TRANSRAILL
    expect(isForeignCopy(2, { attachmentUrl: url("GLAND_06112026221702_EarningsCallRecordingQ2F.mp3"), ticker: "SKIPPER", nseSymbol: "SKIPPER" })).toBe(true);
    expect(isForeignCopy(2, { attachmentUrl: url("VIKRAN123_06112026220959_Intimation.pdf"), ticker: "TRANSRAILL", nseSymbol: "TRANSRAIL" })).toBe(true);
  });
  it("the copy whose prefix IS its own ticker or NSE symbol is the owner's and stays (a parent and its subsidiary filing one document)", () => {
    expect(isForeignCopy(2, { attachmentUrl: url("SKIPPER_06112026221702_Results.pdf"), ticker: "SKIPPER", nseSymbol: "SKIPPER" })).toBe(false);
    expect(isForeignCopy(2, { attachmentUrl: url("TRANSRAIL_06112026221702_Results.pdf"), ticker: "TRANSRAILL", nseSymbol: "TRANSRAIL" })).toBe(false);
    expect(isForeignCopy(2, { attachmentUrl: url("HBLPOWER_06112026221702_Results.pdf"), ticker: "HBLENGINE", nseSymbol: "HBLPOWER" })).toBe(false);
    expect(isForeignCopy(2, { attachmentUrl: url("BIRLACORP1_06112026223901_x.pdf"), ticker: "BIRLACORP", nseSymbol: null })).toBe(false);
  });
  it("one holder is never foreign, whatever the prefix (INOXINDIA files under 'team_', JSLL under staff names)", () => {
    expect(isForeignCopy(1, { attachmentUrl: url("team_06112026221702_x.pdf"), ticker: "INOXINDIA", nseSymbol: "INOXINDIA" })).toBe(false);
  });
  it("three or more holders is foreign even when the prefix happens to match (the owner's own copy is not worth the risk of a wrong alert)", () => {
    expect(isForeignCopy(3, { attachmentUrl: url("SKIPPER_x.pdf"), ticker: "SKIPPER", nseSymbol: "SKIPPER" })).toBe(true);
  });
});

describe("countTickersHoldingDocument", () => {
  it("NSE's 'no attachment' placeholder (…/corporate/-) is not a document: 13 different real filings share it and none of them is foreign", async () => {
    const pool = { query: vi.fn() };
    expect(await countTickersHoldingDocument(pool, { attachmentUrl: "https://nsearchives.nseindia.com/corporate/-" })).toBe(0);
    expect(await countTickersHoldingDocument(pool, { attachmentUrl: "https://nsearchives.nseindia.com/corporate/" })).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("counts the distinct tickers that hold the same attachment (by its URL)", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ n: 19 }] })) };
    const n = await countTickersHoldingDocument(pool, { attachmentUrl: "https://nsearchives.nseindia.com/corporate/MANYAVAR_06112026233002_x.pdf" });
    expect(n).toBe(19);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/count\(DISTINCT ticker\)/i);
    expect(sql).toMatch(/attachment_url = \$1/);
    expect(params).toEqual(["https://nsearchives.nseindia.com/corporate/MANYAVAR_06112026233002_x.pdf"]);
  });

  it("a filing with no attachment cannot be judged and is never called foreign (no query)", async () => {
    const pool = { query: vi.fn() };
    expect(await countTickersHoldingDocument(pool, { attachmentUrl: null })).toBe(0);
    expect(await countTickersHoldingDocument(pool, { attachmentUrl: "  " })).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("setAsideForeignFiling", () => {
  it("takes the row out of every queue (analysis, parked alert, digest, synthesis) and records why", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await setAsideForeignFiling(pool, "row-1");
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/deep_dive_status = 'not_required'/);
    expect(sql).toMatch(/foreign_filing/);
    for (const flag of ["alert_pending", "digest_pending", "synthesis_pending"]) expect(sql).toContain(flag);
    expect(params).toEqual(["row-1"]);
  });
});
