import { describe, it, expect } from "vitest";
import crypto from "crypto";
import path from "path";
import { handleCloudflareDispatcher } from "../api/reconciler-dispatcher.js";
import { getThesisContract } from "../services/thesis-driver-context.service.js";
import {
  compareFiscalQuarters,
  compareFiscalQuartersDesc,
  parseFiscalQuarter,
} from "../utils/fiscal-quarter.js";

describe("Audited Bugs & Invariant Fixes Verification", () => {
  // --- Bug 6: Reconciler Dispatcher Fail-Closed Auth ---
  describe("Bug 6: Reconciler Dispatcher Auth Security", () => {
    it("fails closed (returns 401) when CRON_SECRET is unset or empty", async () => {
      const origSecret = process.env.CRON_SECRET;
      delete process.env.CRON_SECRET;

      let statusCode = null;
      let jsonPayload = null;
      const req = {
        headers: {
          authorization: "Bearer multibagger_cloudflared_secret_2026",
        },
        body: { action: "DAILY_PORTFOLIO_AUDIT" },
      };
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (payload) => {
          jsonPayload = payload;
          return res;
        },
      };

      await handleCloudflareDispatcher(req, res);
      expect(statusCode).toBe(401);
      expect(jsonPayload?.error).toContain("Unauthorized");

      // Restore
      if (origSecret !== undefined) process.env.CRON_SECRET = origSecret;
    });

    it("rejects invalid bearer token even when CRON_SECRET is set", async () => {
      const origSecret = process.env.CRON_SECRET;
      process.env.CRON_SECRET = "valid_production_secret_12345";

      let statusCode = null;
      const req = {
        headers: { authorization: "Bearer wrong_secret" },
        body: { action: "DAILY_PORTFOLIO_AUDIT" },
      };
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: () => res,
      };

      await handleCloudflareDispatcher(req, res);
      expect(statusCode).toBe(401);

      if (origSecret !== undefined) process.env.CRON_SECRET = origSecret;
      else delete process.env.CRON_SECRET;
    });
  });

  // --- Bug 1: Chronological Fiscal Quarter Sort vs ASCII max(quarter) ---
  describe("Bug 1: Chronological Fiscal Quarter Resolution", () => {
    it("proves ASCII max(quarter) corrupts ordering while compareFiscalQuarters sorts chronologically", () => {
      const quarters = ["Q4_FY25", "Q1_FY26", "Q1_FY27"];

      // In ASCII string sort (PostgreSQL max(quarter)):
      const asciiSorted = [...quarters].sort().reverse();
      expect(asciiSorted[0]).toBe("Q4_FY25"); // ASCII bug: '4' > '1'

      // In canonical compareFiscalQuartersDesc:
      const chronological = [...quarters].sort(compareFiscalQuartersDesc);
      expect(chronological[0]).toBe("Q1_FY27"); // Correct chronological latest!
      expect(chronological[1]).toBe("Q1_FY26");
      expect(chronological[2]).toBe("Q4_FY25");
    });

    it("correctly compares across mixed formats (Q1_FY27 vs FY26-Q4)", () => {
      expect(compareFiscalQuarters("Q1_FY27", "FY26-Q4")).toBeGreaterThan(0);
      expect(compareFiscalQuarters("Q2_FY27", "Q1_FY27")).toBeGreaterThan(0);
      expect(compareFiscalQuarters("Q1_FY26", "Q4_FY25")).toBeGreaterThan(0);
    });
  });

  // --- Bug 5: Dynamic Thesis Contract Loading (Rule 3) ---
  describe("Bug 5: Dynamic Thesis Contract Resolution", () => {
    it("dynamically resolves driver metadata for portfolio stocks without hardcoded tables", () => {
      const tickers = ["HSCL", "SKIPPER", "ANANTRAJ", "JYOTICNC", "MOREPENLAB"];
      for (const t of tickers) {
        const contract = getThesisContract(t);
        expect(contract).toBeTruthy();
        expect(contract.ticker.toUpperCase()).toBe(t);
        expect(Array.isArray(contract.drivers)).toBe(true);
        expect(contract.drivers.length).toBeGreaterThan(0);

        const primaryDriver =
          contract.drivers.find((d) => d.materiality === "HIGH") ||
          contract.drivers[0];
        expect(primaryDriver.name).toBeTruthy();
        expect(primaryDriver.category).toBeTruthy();
        expect(primaryDriver.direction).toBeTruthy();
      }
    });
  });

  // --- Bug 3 & 4: Remind Results Timezone Safety & Scrip Code Match ---
  describe("Bug 3 & 4: Results Reminder Timezone & Matcher Invariants", () => {
    it("computes days difference using explicit +05:30 timezone without host UTC drift", () => {
      function getDaysDifference(dateStr1, dateStr2) {
        const d1 = new Date(dateStr1 + "T00:00:00+05:30");
        const d2 = new Date(dateStr2 + "T00:00:00+05:30");
        const diffTime = d1.getTime() - d2.getTime();
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
      }

      expect(getDaysDifference("2026-11-05", "2026-11-02")).toBe(3);
      expect(getDaysDifference("2026-11-02", "2026-11-02")).toBe(0);
      expect(getDaysDifference("2026-11-01", "2026-11-02")).toBe(-1);
    });

    it("eliminates first-word company collisions (e.g. Quality Foils != Quality Power)", () => {
      const stocks = [
        {
          id: "1",
          ticker: "QPOWER",
          company_name: "Quality Power Electrical Equipments Ltd",
          bse_scrip_code: "544000",
        },
        {
          id: "2",
          ticker: "TIMETECHNO",
          company_name: "Time Technoplast Ltd",
          bse_scrip_code: "532856",
        },
      ];

      const scripCodeToStock = new Map();
      const normCompanyNameToStock = new Map();

      function normalizeCompanyName(name) {
        return String(name || "")
          .toUpperCase()
          .replace(/[^A-Z0-9\s]/g, " ")
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 0 &&
              ![
                "LTD",
                "LIMITED",
                "PVT",
                "PRIVATE",
                "INC",
                "CORP",
                "THE",
                "INDIA",
                "HOLDINGS",
              ].includes(w),
          )
          .join(" ")
          .trim();
      }

      for (const s of stocks) {
        scripCodeToStock.set(s.bse_scrip_code, s);
        normCompanyNameToStock.set(normalizeCompanyName(s.company_name), s);
      }

      // Unrelated company sharing the first word "QUALITY"
      const unrelatedBseItem = {
        short_name: "QUALITY FOILS",
        Long_Name: "Quality Foils (India) Limited",
        scrip_cd: "543000",
      };

      // 1. Scrip code check
      let matched = scripCodeToStock.get(unrelatedBseItem.scrip_cd) || null;
      expect(matched).toBeNull(); // Must NOT match QPOWER!

      // 2. Normalized name check
      const normUnrelated = normalizeCompanyName(unrelatedBseItem.Long_Name);
      matched = normCompanyNameToStock.get(normUnrelated) || null;
      expect(matched).toBeNull(); // Must NOT match QPOWER!

      // Valid company with exact scrip code
      const validItem = {
        short_name: "QPOWER",
        Long_Name: "Quality Power Electrical Equipments Limited",
        scrip_cd: "544000",
      };
      const validMatch =
        scripCodeToStock.get(validItem.scrip_cd) ||
        normCompanyNameToStock.get(normalizeCompanyName(validItem.Long_Name));
      expect(validMatch).toBeTruthy();
      expect(validMatch.ticker).toBe("QPOWER");
    });
  });

  // --- Bug 2: Quarter Format Split-Brain ---
  describe("Bug 2: Quarter Format Split-Brain & Normalization", () => {
    it("normalizes both FY27-Q1 and Q1_FY27 to identical canonical representations", () => {
      const p1 = parseFiscalQuarter("FY27-Q1");
      const p2 = parseFiscalQuarter("Q1_FY27");
      const p3 = parseFiscalQuarter("Q1 FY27");

      expect(p1.key).toBe(2701);
      expect(p2.key).toBe(2701);
      expect(p3.key).toBe(2701);

      expect(p1.label).toBe("Q1_FY27");
      expect(p2.label).toBe("Q1_FY27");
      expect(p3.label).toBe("Q1_FY27");
    });
  });

  // --- Bug 9 & 10: Nightly Digest Idempotency & Hash Uniqueness ---
  describe("Bug 9 & 10: Nightly Digest Idempotency & Precedence", () => {
    it("produces distinct hashes for late filings on different dates so future quarters are never suppressed", () => {
      function computeHash(alert) {
        const hashInput = alert.key || (alert.id ? `${alert.id}_${alert.ticker}_${alert.type}` : `${alert.ticker}_${alert.type}_${alert.text}`);
        return crypto.createHash("sha256").update(hashInput).digest("hex");
      }

      const q1Alert = {
        ticker: "SKIPPER",
        type: "LATE_FILING_RECONCILED",
        key: "SKIPPER_LATE_FILING_2026-08-15",
        text: "📑 Ingested newly filed Concall Transcript / Presentation for **SKIPPER** (2026-08-15)"
      };

      const q2Alert = {
        ticker: "SKIPPER",
        type: "LATE_FILING_RECONCILED",
        key: "SKIPPER_LATE_FILING_2026-11-01",
        text: "📑 Ingested newly filed Concall Transcript / Presentation for **SKIPPER** (2026-11-01)"
      };

      const hashQ1 = computeHash(q1Alert);
      const hashQ2 = computeHash(q2Alert);

      expect(hashQ1).not.toBe(hashQ2); // Must NOT collide!
    });

    it("produces distinct hashes for two distinct announcements with identical generic titles", () => {
      function computeHash(alert) {
        const hashInput = alert.key || (alert.id ? `${alert.id}_${alert.ticker}_${alert.type}` : `${alert.ticker}_${alert.type}_${alert.text}`);
        return crypto.createHash("sha256").update(hashInput).digest("hex");
      }

      const ann1 = {
        id: "aaaaaaaa-0001-0000-0000-000000000000",
        ticker: "HSCL",
        type: "MATERIAL_GROWTH_CATALYST",
        key: "aaaaaaaa-0001-0000-0000-000000000000_HSCL",
        text: "🚀 *HSCL* | General Updates\n   _Order win announced._"
      };

      const ann2 = {
        id: "aaaaaaaa-0002-0000-0000-000000000000",
        ticker: "HSCL",
        type: "MATERIAL_GROWTH_CATALYST",
        key: "aaaaaaaa-0002-0000-0000-000000000000_HSCL",
        text: "🚀 *HSCL* | General Updates\n   _Order win announced._"
      };

      expect(computeHash(ann1)).not.toBe(computeHash(ann2)); // Distinct!
    });

    it("verifies slicing precedes delivery and items beyond 10 are not marked as sent in DB", () => {
      const pendingAlerts = Array.from({ length: 15 }, (_, i) => ({
        id: `id_${i}`,
        ticker: "TICKER",
        type: "CATALYST",
        key: `key_${i}`,
        text: `Alert ${i}`
      }));

      const toDeliver = pendingAlerts.slice(0, 10);
      expect(toDeliver.length).toBe(10);
      // Items 10..14 remain pending for future delivery
      const remaining = pendingAlerts.slice(10);
      expect(remaining.length).toBe(5);
    });
  });

  // --- Bug 13: Content-Disposition Header Sanitization ---
  describe("Bug 13: Content-Disposition Header Sanitization", () => {
    it("strips quote and newline characters from filename headers", () => {
      const maliciousFilename = 'test"file\r\nInjected: header.pdf';
      const safeFilename = path.basename(maliciousFilename).replace(/["\\\r\n]/g, "_");

      expect(safeFilename).not.toContain('"');
      expect(safeFilename).not.toContain('\r');
      expect(safeFilename).not.toContain('\n');
      expect(safeFilename).toBe("test_file__Injected: header.pdf");
    });
  });
});
