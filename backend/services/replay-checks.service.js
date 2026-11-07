/**
 * Checks for the pre-deploy replay (backend/scripts/replay-real-filings.js): a parsed results statement is judged against things that
 * must hold whatever the company, so a failure class that went live once is caught on real filings before the next deploy.
 * Pure. Each code is a real incident: SCALE_IMPLAUSIBLE / UNIT_DISAGREES_WITH_FILING (SJS 2026-11-04), SEGMENT_NAME_DUPLICATE
 * (HBLENGINE 2026-11-07, the filing's own "Etectronics"), NOT_PARSED (every statement that needed OCR).
 */
import { scaleSanity } from "./scale-sanity.service.js";

const UNIT_NAME = { crore: "CRORES", lakh: "LAKHS", million: "MILLIONS" };
const LEVEL_RANK = { PASS: 0, WARN: 1, FAIL: 2 };

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * @param {{fin: object|null, declaredUnit: "crore"|"lakh"|"million"|null, snapshot: {market_cap?: number, pe_ratio?: number}|null}} input
 * @returns {{level: "PASS"|"WARN"|"FAIL", issues: Array<{level: "WARN"|"FAIL", code: string, text: string}>}}
 */
export function checkParsedResult({ fin, declaredUnit = null, snapshot = null } = {}) {
  const issues = [];
  const add = (level, code, text) => issues.push({ level, code, text });

  if (!fin || !fin.revenue) {
    add("WARN", "NOT_PARSED", "the statement could not be parsed from the text layer (it needs OCR)");
  } else {
    const sc = scaleSanity({ patCr: fin.patAttributable ?? fin.patConsolidated, marketCapCr: snapshot?.market_cap, pe: snapshot?.pe_ratio });
    if (sc.suspect) add("FAIL", "SCALE_IMPLAUSIBLE", sc.reason);
    if (declaredUnit && fin.unit && UNIT_NAME[declaredUnit] !== fin.unit) {
      add("WARN", "UNIT_DISAGREES_WITH_FILING", `parsed as ${fin.unit} but the filing declares ${declaredUnit}s`);
    }
    if (Number.isFinite(fin.ebitdaMarginPct) && (fin.ebitdaMarginPct > 90 || fin.ebitdaMarginPct < -100)) {
      add("FAIL", "MARGIN_IMPOSSIBLE", `EBITDA margin ${fin.ebitdaMarginPct}% cannot be right`);
    }
    for (const g of [fin.revenueYoYGrowthPct, fin.patYoYGrowthPct]) {
      if (Number.isFinite(g) && Math.abs(g) > 400) { add("WARN", "GROWTH_EXTREME", `a YoY change of ${g}% should be checked against the filing`); break; }
    }
    const flags = Array.isArray(fin.segmentRedFlags) ? fin.segmentRedFlags : [];
    for (let i = 0; i < flags.length; i++) {
      for (let j = i + 1; j < flags.length; j++) {
        const a = flags[i], b = flags[j];
        if ((a.metric || "revenue") === (b.metric || "revenue") && editDistance(String(a.segment), String(b.segment)) <= 2) {
          add("FAIL", "SEGMENT_NAME_DUPLICATE", `${a.segment} and ${b.segment} look like one segment listed twice`);
        }
      }
    }
  }
  const level = issues.reduce((w, i) => (LEVEL_RANK[i.level] > LEVEL_RANK[w] ? i.level : w), "PASS");
  return { level, issues };
}
