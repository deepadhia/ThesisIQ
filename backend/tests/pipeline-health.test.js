/**
 * The self-audit: the system tells the user when something is silently wrong, instead of the user finding out from a bad alert.
 * Every check here is a failure that really happened: results never read (MOREPENLAB, LUMAXTECH, QPOWER), filings stuck, alerts
 * parked, a board that never went out, results filed with no verified numbers (POLICYBZR), conflicting stances, the gate left off.
 * It speaks only when something is wrong.
 */
import { describe, it, expect, vi } from "vitest";
import { evaluatePipelineHealth, buildHealthMessage, shouldSendHealthReport, gatherHealthSnapshot } from "../services/pipeline-health.service.js";

const ok = () => ({
  stuck: [], parkedAlerts: [], boardBacklog: [], misroutedResults: [], resultsWithoutNumbers: [], conflicts: [],
  gateEnabled: true, unreadableSources: [], guidanceTablesMissing: false
});

describe("evaluatePipelineHealth", () => {
  it('reports expired execution claims that stayed eligible instead of recovering', () => {
    const f = evaluatePipelineHealth({ ...ok(), expiredExecutions: [{ ticker: 'SJS' }] });
    expect(f).toContainEqual(expect.objectContaining({ code: 'EXECUTION_RECOVERY_STALLED', level: 'warn' }));
    expect(f[0].text).toContain('SJS');
  });
  it('reports filings deferred by OCR quota with their retry time', () => {
    const f = evaluatePipelineHealth({ ...ok(), ocrDeferred: [{ ticker: 'SJS', reason: 'OCR_RATE_LIMITED', retryAt: '2026-11-08T10:00:00Z' }] });
    expect(f).toContainEqual(expect.objectContaining({ code: 'OCR_QUOTA_BACKLOG', level: 'warn' }));
    expect(f[0].text).toContain('SJS');
  });
  it("a healthy pipeline has no findings and no message", () => {
    const f = evaluatePipelineHealth(ok());
    expect(f).toEqual([]);
    expect(buildHealthMessage(f)).toBeNull();
  });

  it("results that were never read are critical and name the stock and the filing (the MOREPENLAB / LUMAXTECH / QPOWER failure)", () => {
    const f = evaluatePipelineHealth({ ...ok(), misroutedResults: [{ ticker: "MOREPENLAB", title: "Outcome of Board Meeting", category: "GOVERNANCE_RISK" }] });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: "critical", code: "RESULTS_NOT_QUEUED" });
    expect(f[0].text).toContain("MOREPENLAB");
  });

  it("results filed with no verified numbers is critical (the POLICYBZR failure)", () => {
    const f = evaluatePipelineHealth({ ...ok(), resultsWithoutNumbers: [{ ticker: "POLICYBZR", filedHoursAgo: 52 }] });
    expect(f[0]).toMatchObject({ level: "critical", code: "RESULTS_WITHOUT_NUMBERS" });
    expect(f[0].text).toMatch(/POLICYBZR/);
  });

  it("stuck filings, parked alerts and an old board backlog are warnings with counts and the oldest age", () => {
    const f = evaluatePipelineHealth({
      ...ok(),
      stuck: [{ ticker: "SJS", status: "pending_stage1", ageHours: 9 }, { ticker: "SBCL", status: "pending_audio", ageHours: 30 }],
      parkedAlerts: [{ ticker: "ELECON", ageHours: 3 }],
      boardBacklog: [{ ticker: "SJS", ageHours: 40 }]
    });
    expect(f.map((x) => x.code).sort()).toEqual(["ALERTS_PARKED", "BOARD_BACKLOG", "FILINGS_STUCK"]);
    expect(f.find((x) => x.code === "FILINGS_STUCK").text).toMatch(/2 filing/);
    expect(f.find((x) => x.code === "FILINGS_STUCK").text).toMatch(/30 h/);
  });

  it("missing guidance tracking tables are reported (the migration has not been run)", () => {
    const f = evaluatePipelineHealth({ ...ok(), guidanceTablesMissing: true });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: "warn", code: "GUIDANCE_TABLES_MISSING" });
    expect(f[0].text).toMatch(/db:migrate/);
  });

  it("warns when an analysed call has dated or annual commitments but no extracted forward guidance", () => {
    const f = evaluatePipelineHealth({ ...ok(), guidanceCoverageGaps: [{ ticker: "QPOWER" }] });
    expect(f).toContainEqual(expect.objectContaining({ level: "warn", code: "GUIDANCE_COVERAGE_GAP" }));
    expect(f[0].text).toContain("QPOWER");
    expect(evaluatePipelineHealth({ ...ok(), guidanceCoverageGaps: [] })).toEqual([]);
  });
  it("warns when a completed call or presentation has only a partial highlight read", () => {
    const f = evaluatePipelineHealth({ ...ok(), incompleteHighlights: [{ ticker: "ABC" }] });
    expect(f).toContainEqual(expect.objectContaining({ level: "warn", code: "HIGHLIGHTS_INCOMPLETE" }));
    expect(f[0].text).toContain("ABC");
  });
  it('reports initial board approval incorrectly recorded as a completed acquisition', () => {
    const findings = evaluatePipelineHealth({ ...ok(), prematureCommitments: [{ ticker: 'EXAMPLE' }] });
    expect(findings).toContainEqual(expect.objectContaining({ code: 'PREMATURE_COMMITMENT', level: 'critical' }));
  });
  it("reports unresolved material dead letters even when the old worker sent no failure alert", () => {
    const f = evaluatePipelineHealth({ ...ok(), unresolvedDeadLetters: [{ ticker: "ABC", title: "Investor Presentation" }] });
    expect(f).toContainEqual(expect.objectContaining({ level: "warn", code: "DEAD_LETTER_REVIEW" }));
    expect(f[0].text).toContain("ABC");
  });

  it("the gate being switched off is reported (every alert is being pushed)", () => {
    const f = evaluatePipelineHealth({ ...ok(), gateEnabled: false });
    expect(f[0]).toMatchObject({ level: "warn", code: "GATE_OFF" });
  });

  it("conflicting stances on verified numbers and unreadable sources are reported", () => {
    const f = evaluatePipelineHealth({ ...ok(), conflicts: [{ ticker: "HSCL" }, { ticker: "HSCL" }, { ticker: "QPOWER" }], unreadableSources: ["backend/services/x.js:12"] });
    expect(f.map((x) => x.code).sort()).toEqual(["CONFLICTING_STANCES", "SOURCE_CORRUPTED"]);
    expect(f.find((x) => x.code === "CONFLICTING_STANCES").text).toMatch(/HSCL, QPOWER/);
  });

  it("other companies' filings saved under tracked stocks are critical (NSE ignored the symbol on 2026-11-06: 522 foreign rows, alerts under the wrong ticker)", () => {
    const f = evaluatePipelineHealth({ ...ok(), foreignFilings: [{ sourceId: "MANYAVAR_06112026233002_x.pdf", tickers: ["ANANTRAJ", "CCL", "SJS", "TRANSRAILL"] }, { sourceId: "DENTA_06112026233924_y.pdf", tickers: ["ANANTRAJ", "CCL", "SJS"] }] });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: "critical", code: "FOREIGN_FILINGS" });
    expect(f[0].text).toMatch(/2 filing/);
    expect(f[0].text).toMatch(/other compan/i);
  });

  it("criticals come first and the message stays short (at most 8 finding lines)", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ticker: `T${i}`, title: "Outcome", category: "GENERAL" }));
    const f = evaluatePipelineHealth({ ...ok(), gateEnabled: false, misroutedResults: many });
    expect(f[0].level).toBe("critical");
    const msg = buildHealthMessage(f);
    expect(msg).toMatch(/SYSTEM CHECK/);
    expect(msg.split("\n").filter((l) => /^[•🔴🟠]/.test(l)).length).toBeLessThanOrEqual(8);
    expect(msg).toContain("T0");
  });
});

describe("shouldSendHealthReport: once a day, after 19:00 IST, never the same report twice in a row", () => {
  const at = (h) => Date.parse(`2026-11-06T${String(h).padStart(2, "0")}:00:00+05:30`);
  const f = [{ level: "warn", code: "GATE_OFF", text: "x" }];
  it("needs findings, the evening hour, and a day or a different set of findings since the last report", () => {
    expect(shouldSendHealthReport({ now: at(18), findings: f, last: null })).toBe(false);
    expect(shouldSendHealthReport({ now: at(19), findings: [], last: null })).toBe(false);
    expect(shouldSendHealthReport({ now: at(19), findings: f, last: null })).toBe(true);
    expect(shouldSendHealthReport({ now: at(20), findings: f, last: { ymd: "2026-11-06", fingerprint: "GATE_OFF" } })).toBe(false);
    expect(shouldSendHealthReport({ now: at(20), findings: f, last: { ymd: "2026-11-05", fingerprint: "GATE_OFF" } })).toBe(true);   // same findings, next day: remind once a day
    expect(shouldSendHealthReport({ now: at(20), findings: [...f, { level: "critical", code: "RESULTS_NOT_QUEUED", text: "y" }], last: { ymd: "2026-11-06", fingerprint: "GATE_OFF" } })).toBe(true); // new finding today: say so
  });
});

describe("foreign filings query", () => {
  it("one document stored under three or more tracked tickers is read as foreign; rows already set aside are not counted again", async () => {
    let foreignSql = "";
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes("HAVING")) {
        foreignSql = sql;
        return { rows: [{ source_id: "MANYAVAR_06112026233002_x.pdf", tickers: ["ANANTRAJ", "CCL", "SJS"] }] };
      }
      if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "guidance_pacing_history" }, { table_name: "guidance_outcomes" }] };
      return { rows: [] };
    }) };
    const snap = await gatherHealthSnapshot(pool, { now: Date.now(), gateEnabled: true });
    expect(snap.foreignFilings).toEqual([{ sourceId: "MANYAVAR_06112026233002_x.pdf", tickers: ["ANANTRAJ", "CCL", "SJS"] }]);
    expect(foreignSql).toMatch(/count\(DISTINCT ticker\) >= 3/i);
    expect(foreignSql).toMatch(/foreign_filing/);          // rows already set aside by the clean-up are excluded
    expect(foreignSql).toMatch(/\\\.\(pdf/i);              // document file names only: a title-based id shared by several stocks is not foreign
  });
});

describe("gatherHealthSnapshot reads the database through the injected pool", () => {
  it('queries the ledger for achieved proposed or board-approved ownership actions', async () => {
    let sqlSeen = '';
    const pool = { query: vi.fn(async sql => {
      if (sql.includes('premature_commitment')) { sqlSeen = sql; return { rows: [{ ticker: 'EXAMPLE' }] }; }
      if (sql.includes('information_schema.tables')) return { rows: [{ table_name: 'guidance_pacing_history' }, { table_name: 'guidance_outcomes' }] };
      return { rows: [] };
    }) };
    const snap = await gatherHealthSnapshot(pool);
    expect(snap.prematureCommitments).toEqual([{ ticker: 'EXAMPLE' }]);
    expect(sqlSeen).toMatch(/management_commitments/);
    expect(sqlSeen).toMatch(/Achieved/);
  });
  it("checks completed transcripts with source commitments for missing guidance sections", async () => {
    let sqlSeen = "";
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes("guidance_coverage_gap")) {
        sqlSeen = sql;
        return { rows: [{ ticker: "QPOWER" }] };
      }
      if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "guidance_pacing_history" }, { table_name: "guidance_outcomes" }] };
      return { rows: [] };
    }) };
    const snap = await gatherHealthSnapshot(pool);
    expect(snap.guidanceCoverageGaps).toEqual([{ ticker: "QPOWER" }]);
    expect(sqlSeen).toMatch(/pending_stage2|processed_stage/i);
    expect(sqlSeen).toMatch(/guidance_scope/i);
  });
  it("reads incomplete highlight markers from completed filings", async () => {
    let sqlSeen = "";
    const pool = { query: vi.fn(async sql => {
      if (sql.includes("highlight_extraction")) { sqlSeen = sql; return { rows: [{ ticker: "ABC" }] }; }
      if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "guidance_pacing_history" }, { table_name: "guidance_outcomes" }] };
      return { rows: [] };
    }) };
    const snap = await gatherHealthSnapshot(pool);
    expect(snap.incompleteHighlights).toEqual([{ ticker: "ABC" }]);
    expect(sqlSeen).toMatch(/INCOMPLETE/);
  });
  it("checks unreadable results, decks, press releases and transcripts left in review", async () => {
    let sqlSeen = "";
    const pool = { query: vi.fn(async sql => {
      if (sql.includes("material_dead_letter")) { sqlSeen = sql; return { rows: [{ ticker: "ABC", title: "Investor Presentation" }] }; }
      if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "guidance_pacing_history" }, { table_name: "guidance_outcomes" }] };
      return { rows: [] };
    }) };
    const snap = await gatherHealthSnapshot(pool);
    expect(snap.unresolvedDeadLetters).toEqual([{ ticker: "ABC", title: "Investor Presentation" }]);
    expect(sqlSeen).toMatch(/needs_review/);
    expect(sqlSeen).toMatch(/presentation/);
  });
  it("turns query rows into the snapshot, and a failing query is reported as a finding, not swallowed", async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes("pending_stage1")) return { rows: [{ ticker: "SJS", status: "pending_stage1", age_hours: 9 }] };
      if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "guidance_pacing_history" }, { table_name: "guidance_outcomes" }] };
      return { rows: [] };
    }) };
    const snap = await gatherHealthSnapshot(pool, { now: Date.now(), gateEnabled: true });
    expect(snap.stuck).toEqual([{ ticker: "SJS", status: "pending_stage1", ageHours: 9 }]);
    expect(snap.foreignFilings).toEqual([]);

    const broken = { query: vi.fn(async () => { throw new Error("db down"); }) };
    const snap2 = await gatherHealthSnapshot(broken, { now: Date.now(), gateEnabled: true });
    expect(snap2.queryErrors.length).toBeGreaterThan(0);
    const f = evaluatePipelineHealth(snap2);
    expect(f.some((x) => x.code === "HEALTH_CHECK_FAILED")).toBe(true);
  });
});

describe("a recording still inside its waiting window is not 'stuck'", () => {
  it("pending_audio is reported only after 36 h (the retries run for about 29 h), the written filings after 6 h", async () => {
    let stuckSql = "";
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes("AS age_hours") && sql.includes("pending_audio") && sql.includes("pending_stage1")) stuckSql = sql;
      if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "guidance_pacing_history" }, { table_name: "guidance_outcomes" }] };
      return { rows: [] };
    }) };
    await gatherHealthSnapshot(pool, { now: Date.now(), gateEnabled: true });
    expect(stuckSql).toMatch(/deep_dive_status = 'pending_audio'[\s\S]*36 hours/);
    expect(stuckSql).toMatch(/deep_dive_status <> 'pending_audio'[\s\S]*6 hours/);
  });
});
