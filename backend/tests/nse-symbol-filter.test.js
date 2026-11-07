/**
 * 2026-11-06: NSE's NextApi `getCorporateAnnouncement` stopped honouring `symbol` and returns the latest 20 filings of the WHOLE
 * market for any symbol (even a made-up one). The scanner saved them under every tracked stock: 522 foreign rows, other companies'
 * results alerted as ANANTRAJ / JYOTICNC / POLICYBZR, and a MOREPENLAB snapshot written from Anupam Rasayan's EPS correction.
 * Checked live (read-only): CCL legacy endpoint returns 747 rows, all symbol CCL; NextApi returns 20 rows of 16 other symbols.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));

const { fetchNseAnnouncements, selectNseRowsForSymbol, isAnnouncementProcessed } = await import("../services/announcement.service.js");
const { pool } = await import("../db/pool.js");

const nowIso = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const row = (symbol, n = 1) => ({
  symbol,
  desc: "Updates",
  dt: nowIso(),
  an_dt: nowIso(),
  sort_date: nowIso(),
  seq_id: `${symbol}-${n}`,
  attchmntFile: `https://nsearchives.nseindia.com/corporate/${symbol}_0611202623${String(n).padStart(2, "0")}00_x.pdf`,
  attchmntText: "text",
});

describe("selectNseRowsForSymbol", () => {
  it("keeps only the rows that belong to the requested symbol", () => {
    const rows = [row("CCL", 1), row("MANAPPURAM", 2), row("ccl", 3), row("GHCL", 4)];
    expect(selectNseRowsForSymbol(rows, "CCL").map((r) => r.seq_id)).toEqual(["CCL-1", "ccl-3"]);
  });

  it("a row with no symbol field is NOT assumed to belong (never guess ownership)", () => {
    expect(selectNseRowsForSymbol([{ desc: "x", seq_id: "1" }], "CCL")).toEqual([]);
  });

  it("knows the HBLPOWER / HBLENGINE rename in both directions", () => {
    expect(selectNseRowsForSymbol([row("HBLENGINE")], "HBLPOWER")).toHaveLength(1);
    expect(selectNseRowsForSymbol([row("HBLPOWER")], "HBLENGINE")).toHaveLength(1);
    expect(selectNseRowsForSymbol([row("GHCL")], "HBLENGINE")).toHaveLength(0);
  });

  it("tolerates a non-array response", () => {
    expect(selectNseRowsForSymbol(null, "CCL")).toEqual([]);
    expect(selectNseRowsForSymbol({ error: "x" }, "CCL")).toEqual([]);
  });
});

describe("fetchNseAnnouncements: never returns another company's filings", () => {
  let calls;
  const respond = (body, ok = true) => ({ ok, status: ok ? 200 : 500, headers: { get: () => "nsit=abc; Path=/" }, json: async () => body, text: async () => JSON.stringify(body) });

  beforeEach(() => {
    calls = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("NextApi answering with the whole market (the 2026-11-06 failure) falls through to the per-symbol endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes("NextApi")) return respond([row("MANAPPURAM", 1), row("GHCL", 2), row("COHANCE", 3)]);
      if (String(url).includes("api/corporate-announcements")) return respond([row("CCL", 4), row("CCL", 5)]);
      return respond("<html>");
    }));
    const out = await fetchNseAnnouncements("CCL");
    expect(out.map((a) => a.NEWS_ID)).toEqual(["CCL-4", "CCL-5"]);
    expect(calls.some((u) => u.includes("api/corporate-announcements?index=equities&symbol=CCL"))).toBe(true);
  });

  it("when NO endpoint has a row of the symbol, the answer is empty (nothing foreign leaks through)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("NextApi")) return respond([row("MANAPPURAM", 1), row("GHCL", 2)]);
      if (String(url).includes("api/corporate-announcements")) return respond([row("GHCL", 3)]);
      return respond("<html>");
    }));
    expect(await fetchNseAnnouncements("ELECON")).toEqual([]);
  });

  it("rows of the symbol in a mixed NextApi answer are kept, the foreign ones dropped", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("NextApi")) return respond([row("SJS", 1), row("GHCL", 2)]);
      return respond([]);
    }));
    const out = await fetchNseAnnouncements("SJS");
    expect(out.map((a) => a.NEWS_ID)).toEqual(["SJS-1"]);
  });

  it("a filing stays recognised whichever id NSE gives it: the NextApi era stored the FILE NAME, the per-symbol endpoint returns a numeric seq_id", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("NextApi")) return respond([]);
      return respond([{ ...row("CCL", 7), seq_id: "106823678", attchmntFile: "https://nsearchives.nseindia.com/corporate/CCL_21102026175354_transcriptccl.pdf" }]);
    }));
    const [a] = await fetchNseAnnouncements("CCL");
    expect(a.NEWS_ID).toBe("106823678");
    expect(a.ALT_IDS).toEqual(expect.arrayContaining(["106823678", "CCL_21102026175354_transcriptccl.pdf"]));

    pool.query.mockClear();
    await isAnnouncementProcessed("CCL", a.NEWS_ID, "hash-1", a.ALT_IDS);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/source_id = ANY\(\$2::text\[\]\)/);
    expect(params[1]).toEqual(expect.arrayContaining(["106823678", "CCL_21102026175354_transcriptccl.pdf"]));
  });

  it("without alternate ids the lookup behaves as before (the id itself, or the title hash)", async () => {
    pool.query.mockClear();
    await isAnnouncementProcessed("CCL", "abc", "hash-1");
    expect(pool.query.mock.calls[0][1][1]).toEqual(["abc"]);
    pool.query.mockClear();
    await isAnnouncementProcessed("CCL", "", "hash-1");
    expect(pool.query.mock.calls[0][1][1]).toBeNull();
  });

  it("a foreign answer is reported (warning), so the next API change is seen in the log", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (String(url).includes("NextApi") ? respond([row("GHCL", 1)]) : respond([]))));
    await fetchNseAnnouncements("SJS");
    expect(console.warn.mock.calls.flat().join(" ")).toMatch(/NSE.*SJS.*other compan/i);
  });
});
