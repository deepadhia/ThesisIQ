/**
 * BSE session warm-up: a failed warm-up used to be "cached" as an empty cookie, but the cache check required a non-empty cookie, so
 * EVERY stock of a scan paid the homepage request again (15 s timeout each when the site hangs: 20 stocks = 5 minutes of a
 * 150 s scan budget). A failed (or cookie-less) warm-up now holds for a short time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Production runs on plain Node (AbortSignal.timeout exists); the jsdom test environment's AbortSignal lacks it.
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms).unref?.();
    return controller.signal;
  };
}

vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));

const { fetchBseAnnouncements, resetBseSession } = await import("../services/announcement.service.js");

const apiOk = () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ Table: [] }), text: async () => "{}" });

describe("BSE warm-up is not repeated for every stock", () => {
  let homepageHits;
  beforeEach(() => {
    resetBseSession();
    homepageHits = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a failed warm-up is asked once, not once per stock", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url) === "https://www.bseindia.com/") { homepageHits++; throw new TypeError("fetch failed"); }
      return apiOk();
    }));
    for (const scrip of ["515055", "532493", "519600", "505700"]) await fetchBseAnnouncements(scrip, 7, { retryDelayMs: 0 });
    expect(homepageHits).toBe(1);
  });

  it("a homepage that answers without a cookie is not asked again for every stock either", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url) === "https://www.bseindia.com/") { homepageHits++; return { ok: true, status: 200, headers: { get: () => null, getSetCookie: () => [] } }; }
      return apiOk();
    }));
    for (const scrip of ["515055", "532493", "519600"]) await fetchBseAnnouncements(scrip, 7, { retryDelayMs: 0 });
    expect(homepageHits).toBe(1);
  });

  it("a failed warm-up is retried after its short hold has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        if (String(url) === "https://www.bseindia.com/") { homepageHits++; throw new TypeError("fetch failed"); }
        return apiOk();
      }));
      await fetchBseAnnouncements("515055", 7, { retryDelayMs: 0 });
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await fetchBseAnnouncements("532493", 7, { retryDelayMs: 0 });
      expect(homepageHits).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
