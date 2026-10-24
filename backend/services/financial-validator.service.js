/**
 * Deterministic Financial Validator & EBITDA Engine
 *
 * Programmatically extracts, validates, and computes key financial metrics
 * (Revenue, EBITDA, EBITDA Margin %, Consolidated PAT, Segment declines) directly
 * from parsed financial statement table text.
 *
 * Design (v2 — block based):
 *  1. Locate every FULL profit & loss statement block in the PDF text (anchored on a
 *     "Revenue from operations" row that carries a complete set of numeric columns).
 *  2. Decide the scope (CONSOLIDATED / STANDALONE) of each block from the nearest
 *     genuine statement heading — looking BEFORE and AFTER the block, because PDF text
 *     extraction frequently emits a page heading after the table it belongs to.
 *  3. Read the unit (Crores / Lakhs / Millions) from the declaration nearest to the block,
 *     never from a stray "lakh" elsewhere in the document.
 *  4. Map columns (current quarter / previous quarter / year-ago quarter) from the
 *     header dates instead of guessing, so seasonal quarters are never mistaken for
 *     half-year columns.
 *  5. Parse bracketed negatives "(12.34)", repair PDF digit glitches ("1,871.3 6"),
 *     and refuse partial rows (e.g. a yearly-only exceptional item) rather than guess.
 *
 * Narrative text (concall transcripts, press releases, slides) never forms a full
 * statement block, so it returns null instead of garbage numbers.
 */

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};

const NUMERIC_TOKEN = /^\(?-?[\d,]+\.?\d*\)?$/;
const DASH_TOKEN = /^[-–—]$/;

const REVENUE_ROW = /(?:revenue\s+from\s+operations?|sales\s*\/\s*income\s+from\s+operations?|income\s+from\s+operations?|net\s+sales|revenue\s+from\s+sale)/i;
const TOTAL_INCOME_ROW = /^\W*(?:[ivx]+\.?\s+|\d+\.?\s+|[a-z]\)\s+)?total\s+income\b/i;
const PBT_ROW = /profit\s*(?:\/\s*\(?\s*loss\s*\)?\s*)?\(?(?:loss\)?\s*)?before\s+(?:tax|share\s+of)/i;
const PBT_BEFORE_EXC_ROW = /profit\s*(?:\/\s*\(?\s*loss\s*\)?\s*)?before\s+exceptional/i;
const PAT_ROW = /(?:net\s+)?profit\s*(?:\/\s*\(?\s*loss\s*\)?\s*)?(?:\(\s*loss\s*\)\s*)?(?:after\s+tax\s+)?for\s+the\s+(?:period|quarter|year|half)|(?:net\s+)?profit\s+after\s+tax|^\W*(?:[ivx]+\.?\s+|\d+\.?\s+)?profit\s*(?:\/\s*\(?\s*loss\s*\)?)?\s*(?:\(\s*loss\s*\)\s*)?for\s+the/i;
const PAT_EXCLUDE = /before|comprehensive|attributable|per\s+share|margin|from\s+discontinued|share\s+of/i;
const FIN_ROW = /^\W*(?:\S{1,3}\s+)?(?:finance\s+costs?|interest\s+expenses?|interest\s+and\s+finance|interest\s+cost)/i;
const DEP_ROW = /^\W*(?:\S{1,3}\s+)?(?:depreciation|amortisation|amortization)/i;
const EXC_ROW = /exceptional\s+(?:item|gain|loss|income|expense)s?/i;
const OWNERS_ROW = /(?:owners|equity\s+holders|shareholders)\s+of\s+the|owners\s+of\s+[a-z]/i;

const SEGMENT_EXCLUDE_LABEL = /total|less|inter|unallocable|unallocated|eliminat|capital\s+employed|assets|liabilit|tax|interest|finance|other\s+income|profit|net\b|exceptional|depreciation|expenses?|income\b|revenue\s+from\s+operations|segment\s+(?:results?|revenue|information)/i;

function toNumber(token) {
  if (token === null || token === undefined) return null;
  const t = String(token).trim();
  if (!t || DASH_TOKEN.test(t)) return null;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  const cleaned = t.replace(/[(),]/g, "").replace(/^-/, "").replace(/\.$/, "");
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

/**
 * Parses the trailing run of numeric tokens of a statement row.
 * Returns { label, values } where values preserves column positions (null for "-").
 */
function parseRow(line, expectedCols = null) {
  if (!line || line.length > 400) return null;
  const tokens = line.trim().split(/\s+/);
  const numeric = [];
  let i = tokens.length - 1;
  while (i >= 0 && (NUMERIC_TOKEN.test(tokens[i]) || DASH_TOKEN.test(tokens[i]))) {
    numeric.unshift(tokens[i]);
    i--;
  }
  const label = tokens.slice(0, i + 1).join(" ");
  if (numeric.length === 0) return null;

  let toks = numeric;

  // PDF glitch repair: "15,072. 32" -> "15,072.32", "1,871.3 6" -> "1,871.36"
  const repair = (arr) => {
    const out = [];
    for (let k = 0; k < arr.length; k++) {
      const cur = arr[k];
      const next = arr[k + 1];
      if (next !== undefined && /\.$/.test(cur) && /^\d{1,2}$/.test(next)) {
        out.push(cur + next);
        k++;
      } else if (next !== undefined && /\.\d$/.test(cur) && /^\d$/.test(next)) {
        out.push(cur + next);
        k++;
      } else {
        out.push(cur);
      }
    }
    return out;
  };

  if (expectedCols && toks.length > expectedCols) {
    toks = repair(toks);
  }

  // Drop trailing note-reference integers ("... 2,680.48 5 5") when there are surplus columns.
  const cap = expectedCols || 6;
  while (toks.length > cap && /^\d{1,2}$/.test(toks[toks.length - 1])) {
    toks = toks.slice(0, -1);
  }
  if (toks.length > cap) toks = toks.slice(0, cap);

  const values = toks.map(toNumber);
  // A leading single-digit note reference in front of real columns (e.g. "9 746.03 858.67 666.35")
  if (!expectedCols && values.length >= 4 && values[0] !== null && Number.isInteger(values[0]) && Math.abs(values[0]) < 15 && values[1] !== null && Math.abs(values[1]) > 15) {
    values.shift();
  }
  return { label, values };
}

function parseDatesFromText(text) {
  const dates = [];
  const patterns = [
    { re: /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi, build: (m) => new Date(Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2])) },
    { re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?,?\s+(\d{4})\b/gi, build: (m) => new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1])) },
    { re: /\b(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})\b/g, build: (m) => (+m[2] >= 1 && +m[2] <= 12 && +m[1] <= 31) ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null }
  ];
  for (const { re, build } of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const d = build(m);
      if (d && !isNaN(d.getTime())) dates.push({ index: m.index, date: d });
    }
  }
  return dates.sort((a, b) => a.index - b.index).map(x => x.date);
}

function daysBetween(a, b) {
  return Math.abs((a.getTime() - b.getTime()) / 86400000);
}

/**
 * Header dates -> column roles. Returns { yoyIdx, qoqIdx, dates }.
 */
function mapColumns(lines, anchorIdx, cols) {
  const regionStart = Math.max(0, anchorIdx - 40);
  const headerText = lines.slice(regionStart, anchorIdx + 1).join("\n");
  const all = parseDatesFromText(headerText);
  let yoyIdx = cols >= 3 ? 2 : null;
  let qoqIdx = cols >= 2 ? 1 : null;
  let dates = null;

  if (all.length >= cols && cols >= 2) {
    dates = all.slice(all.length - cols);
    const d0 = dates[0];
    let foundYoy = null;
    let foundQoq = null;
    for (let j = 1; j < dates.length; j++) {
      const dj = dates[j];
      const gap = (d0.getTime() - dj.getTime()) / 86400000;
      if (foundYoy === null && gap > 350 && gap < 380) foundYoy = j;
      if (foundQoq === null && gap > 80 && gap < 100) foundQoq = j;
    }
    if (foundYoy !== null) yoyIdx = foundYoy;
    if (foundQoq !== null) qoqIdx = foundQoq;
    // Without a proper quarter-end header (e.g. only 2 quarter columns) do not invent a YoY column
    if (foundYoy === null && cols < 3) yoyIdx = null;
  }
  return { yoyIdx, qoqIdx, dates };
}

const UNIT_PATTERN = /(?:(?:rs\.?|₹|inr|rupees)\s*(?:in\s+)?(crores?|crs?\b|lakhs?|lacs?|millions?|mn\b)|\bin\s+(crores?|crs?\b|lakhs?|lacs?|millions?|mn\b)|\(\s*(?:rs\.?|₹)?\s*(crores?|crs?\b|lakhs?|lacs?|millions?|mn\b)\s*\))/i;

function unitFactor(word) {
  const w = String(word || "").toLowerCase();
  if (w.startsWith("lakh") || w.startsWith("lac")) return { factor: 0.01, name: "LAKHS" };
  if (w.startsWith("million") || w === "mn") return { factor: 0.1, name: "MILLIONS" };
  return { factor: 1, name: "CRORES" };
}

function detectUnit(lines, anchorIdx) {
  let best = null;
  for (let d = 0; d <= 80; d++) {
    for (const idx of d === 0 ? [anchorIdx] : [anchorIdx - d, anchorIdx + d]) {
      if (idx < 0 || idx >= lines.length) continue;
      const m = lines[idx].match(UNIT_PATTERN);
      if (m && lines[idx].length < 200) {
        best = unitFactor(m[1] || m[2] || m[3]);
        return { ...best, explicit: true };
      }
    }
  }
  // Document-wide majority
  const counts = { CRORES: 0, LAKHS: 0, MILLIONS: 0 };
  for (const l of lines) {
    const m = l.length < 200 ? l.match(UNIT_PATTERN) : null;
    if (m) counts[unitFactor(m[1] || m[2] || m[3]).name]++;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (top[1] > 0) {
    return { ...unitFactor(top[0] === "LAKHS" ? "lakh" : top[0] === "MILLIONS" ? "million" : "crore"), explicit: true };
  }
  return { factor: 1, name: "CRORES", explicit: false };
}

const HEADING_EXCLUDE = /report|auditor|review|notice|outcome|submission|approved|pursuant|we\s+have|item\s+no|include|include|enclos|reviewed|resolution|covering/i;

function headingScope(line) {
  if (!line || line.length > 190) return null;
  if (HEADING_EXCLUDE.test(line)) return null;
  const m = line.match(/\b(consolidated|standalone|stand-alone)\b/i);
  if (!m) return null;
  const looksLikeHeading =
    /(?:^|\b)(?:statement\s+of\s+)?(?:un-?audited\s+|audited\s+)?(?:consolidated|standalone|stand-alone)\b[^.]{0,80}?(?:financial\s+results?|profit\s+and\s+loss|results)/i.test(line) ||
    /statement\s+of\s+(?:un-?audited\s+|audited\s+)?(?:consolidated|standalone|stand-alone)/i.test(line) ||
    /(?:financial\s+results?|profit\s+and\s+loss)[^.]{0,40}\((?:consolidated|standalone)\)/i.test(line);
  if (!looksLikeHeading) return null;
  return /consolidated/i.test(m[1]) ? "CONSOLIDATED" : "STANDALONE";
}

function findScope(lines, anchorIdx) {
  for (let i = anchorIdx - 1; i >= Math.max(0, anchorIdx - 60); i--) {
    const s = headingScope(lines[i]);
    if (s) return s;
  }
  for (let i = anchorIdx + 1; i <= Math.min(lines.length - 1, anchorIdx + 90); i++) {
    const s = headingScope(lines[i]);
    if (s) return s;
  }
  return "UNKNOWN";
}

/**
 * Locates full statement blocks. Each block carries parsed rows for the quarter columns.
 */
function locateBlocks(lines) {
  const anchors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 400) continue;
    const isRev = REVENUE_ROW.test(line) && !/^\W*(?:note|refer)/i.test(line);
    if (!isRev) continue;
    const row = parseRow(line);
    if (row && row.values.filter(v => v !== null).length >= 3 && row.values.length >= 3) {
      anchors.push(i);
    }
  }
  // Fallback anchor on "Total income" when no revenue rows exist (financials with only total income)
  if (anchors.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      if (TOTAL_INCOME_ROW.test(lines[i])) {
        const row = parseRow(lines[i]);
        if (row && row.values.filter(v => v !== null).length >= 3) anchors.push(i);
      }
    }
  }

  const blocks = [];
  for (let a = 0; a < anchors.length; a++) {
    const idx = anchors[a];
    const nextAnchor = anchors[a + 1] !== undefined ? anchors[a + 1] : lines.length;
    const end = Math.min(idx + 60, nextAnchor, lines.length);

    const rawRev = parseRow(lines[idx]);
    if (!rawRev) continue;

    const rowFinder = (cols) => (regex, { exclude = null, startFrom = idx } = {}) => {
      for (let i = startFrom; i < end; i++) {
        const l = lines[i];
        if (!regex.test(l)) continue;
        if (exclude && exclude.test(l)) continue;
        const row = parseRow(l, cols);
        if (row && row.values.length === cols) return { idx: i, row };
      }
      return null;
    };

    // Choose the column count that the most statement rows agree on
    // (note-reference integers can make a row look wider than it really is).
    let cols = Math.min(rawRev.values.length, 6);
    let bestScore = -1;
    for (let c = Math.min(rawRev.values.length, 6); c >= 3; c--) {
      const find = rowFinder(c);
      const score = [PBT_ROW, PAT_ROW, DEP_ROW, FIN_ROW, TOTAL_INCOME_ROW]
        .map(rx => (find(rx, { exclude: /exceptional|before\s+exceptional|comprehensive|attributable/i }) ? 1 : 0))
        .reduce((x, y) => x + y, 0);
      if (score > bestScore) { bestScore = score; cols = c; }
    }
    if (cols < 3) continue;

    const revRowFixed = parseRow(lines[idx], cols);
    if (!revRowFixed || revRowFixed.values.length !== cols) continue;

    const findRow = rowFinder(cols);
    const pbt = findRow(PBT_ROW, { exclude: /exceptional/i });
    const pbtBefore = findRow(PBT_BEFORE_EXC_ROW);
    const patStart = pbt ? pbt.idx + 1 : idx + 1;
    const pat = findRow(PAT_ROW, { exclude: PAT_EXCLUDE, startFrom: patStart });
    const fin = findRow(FIN_ROW);
    const dep = findRow(DEP_ROW);
    const exc = findRow(EXC_ROW, { exclude: /before|profit/i });
    const totalIncome = findRow(TOTAL_INCOME_ROW);

    // Attributable-to-owners row (only trusted when it follows the PAT row under a "Profit attributable to" heading)
    let owners = null;
    if (pat) {
      for (let i = pat.idx + 1; i < Math.min(end, pat.idx + 30); i++) {
        if (/profit(?:\s+for\s+the\s+(?:period|quarter|year))?\s+attributable\s+to|attributable\s+to\s*:?\s*$/i.test(lines[i]) && !/comprehensive/i.test(lines[i])) {
          for (let j = i; j < Math.min(end, i + 5); j++) {
            if (OWNERS_ROW.test(lines[j])) {
              const row = parseRow(lines[j], cols);
              if (row && row.values.length === cols) { owners = { idx: j, row }; break; }
            }
          }
          break;
        }
      }
    }

    const isFull = Boolean(dep || fin) && Boolean(pat || pbt);
    blocks.push({
      anchorIdx: idx,
      cols,
      revenue: revRowFixed.values,
      totalIncome: totalIncome?.row.values || null,
      pbt: pbt?.row.values || null,
      pbtBefore: pbtBefore?.row.values || null,
      pat: pat?.row.values || null,
      owners: owners?.row.values || null,
      fin: fin?.row.values || null,
      dep: dep?.row.values || null,
      exc: exc?.row || null,
      isFull,
      hasStatement: Boolean(pbt || pat),
      scope: findScope(lines, idx),
      unit: detectUnit(lines, idx),
      colMap: mapColumns(lines, idx, cols)
    });
  }
  // Only trust blocks whose scope is known from a real heading, or that carry parseable header dates.
  return blocks.filter(b => b.hasStatement && (b.scope !== "UNKNOWN" || (b.colMap.dates && b.isFull)));
}

function pickBlocks(blocks) {
  if (blocks.length === 0) return { primary: null, standalone: null };
  const rank = (b) => (b.isFull ? 0 : 10) + (b.scope === "CONSOLIDATED" ? 0 : b.scope === "UNKNOWN" ? 1 : 2);
  const revenueOf = (b) => (b.revenue[0] || 0) * b.unit.factor;
  const sorted = [...blocks].sort((a, b) => rank(a) - rank(b) || revenueOf(b) - revenueOf(a));
  const primary = sorted[0];
  const standalone = blocks
    .filter(b => b !== primary && b.scope === "STANDALONE" && b.isFull)
    .sort((a, b) => revenueOf(b) - revenueOf(a))[0] || (primary.scope === "STANDALONE" ? primary : null);
  return { primary, standalone };
}

const round2 = (n) => parseFloat(n.toFixed(2));
const pct = (cur, prev) => (prev && prev > 0 && cur !== null && cur !== undefined) ? round2(((cur - prev) / prev) * 100) : null;

function scaled(values, idx, factor) {
  if (!values || idx === null || idx === undefined) return null;
  const v = values[idx];
  if (v === null || v === undefined) return null;
  return v * factor;
}

function extractSegmentRedFlags(lines, totalRevenueYoyBase) {
  const flags = [];
  const start = lines.findIndex(l => /^\W*(?:\d+\.?\s*)?(?:consolidated\s+)?segment\s+(?:results?|revenue|information|wise)|^\W*segment\s+reporting/i.test(l) && l.length < 120);
  if (start === -1) return flags;
  for (let i = start + 1; i < Math.min(start + 40, lines.length); i++) {
    const row = parseRow(lines[i], null);
    if (!row || row.values.length < 3) continue;
    const label = row.label.replace(/^\W*(?:\d+[.)]?|[a-z]\))\s*/i, "").trim();
    if (label.length < 3 || SEGMENT_EXCLUDE_LABEL.test(label)) continue;
    const cur = row.values[0];
    const prev = row.values[2];
    if (cur === null || prev === null || prev <= 0 || cur < 0) continue;
    const yoy = ((cur - prev) / prev) * 100;
    // Materiality: segment must be a meaningful slice of the year-ago revenue base
    const material = !totalRevenueYoyBase || prev >= 0.03 * totalRevenueYoyBase;
    if (yoy < -25 && material) {
      const name = label.toUpperCase();
      if (!flags.some(f => f.segment === name)) {
        flags.push({ segment: name, currentValue: cur, prevValue: prev, yoyDeclinePct: parseFloat(yoy.toFixed(1)) });
      }
    }
  }
  return flags;
}

/**
 * Extracts and computes financial metrics from raw PDF text.
 * @param {string} pdfText Raw text extracted from PDF
 * @returns {object|null} Financial metrics object, or null when no full statement table is present
 */
export function extractDeterministicFinancials(pdfText = "") {
  if (!pdfText || typeof pdfText !== "string") {
    return null;
  }

  const lines = pdfText.split("\n").map(l => l.trim()).filter(Boolean);
  const blocks = locateBlocks(lines);
  if (blocks.length === 0) {
    return null;
  }

  const { primary, standalone } = pickBlocks(blocks);
  if (!primary) return null;

  const f = primary.unit.factor;
  const { yoyIdx, qoqIdx } = primary.colMap;

  const result = {
    isFinancialResult: true,
    statementScope: primary.scope,
    unit: primary.unit.name,
    quarterEnded: primary.colMap.dates ? primary.colMap.dates[0].toISOString().slice(0, 10) : null,
    revenue: null,
    revenueYoYGrowthPct: null,
    ebitda: null,
    ebitdaMarginPct: null,
    ebitdaYoYGrowthPct: null,
    ebitdaMarginBpsDelta: null,
    patStandalone: null,
    patConsolidated: null,
    patAttributable: null,
    patYoYGrowthPct: null,
    isYoYDecline: false,
    isMarginErosion: false,
    segmentRedFlags: []
  };

  // Revenue
  const rev0 = scaled(primary.revenue, 0, f);
  const revSeq = scaled(primary.revenue, qoqIdx, f);
  const revYoy = scaled(primary.revenue, yoyIdx, f);
  if (rev0 !== null) result.revenue = round2(rev0);
  result.revenueQoQGrowthPct = pct(rev0, revSeq);
  if (result.revenueQoQGrowthPct === null) delete result.revenueQoQGrowthPct;
  result.revenueYoYGrowthPct = pct(rev0, revYoy);

  // Exceptional items: derive the signed net effect from PBT - PBT-before-exceptional (only trusted for full rows)
  let exceptionalNet = 0;
  let exceptionalFound = false;
  if (primary.pbt && primary.pbtBefore) {
    const e0 = (primary.pbt[0] ?? 0) - (primary.pbtBefore[0] ?? 0);
    if (Math.abs(e0) > 1e-6) {
      exceptionalNet = e0 * f;
      exceptionalFound = true;
    }
  } else if (primary.exc && primary.exc.values.length === primary.cols && primary.exc.values[0] !== null) {
    const lbl = primary.exc.label.toLowerCase();
    const mag = Math.abs(primary.exc.values[0]) * f;
    if (mag > 0) {
      if (/gain|income|profit/.test(lbl)) { exceptionalNet = mag; exceptionalFound = true; }
      else if (/loss|expense/.test(lbl)) { exceptionalNet = -mag; exceptionalFound = true; }
    }
  }

  // EBITDA = PBT before exceptional items + finance costs + depreciation (needs a depreciation row)
  const ebitdaFor = (idx) => {
    if (idx === null || idx === undefined || !primary.dep) return null;
    const pbtBase = primary.pbtBefore ? primary.pbtBefore[idx] : (primary.pbt ? primary.pbt[idx] : null);
    if (pbtBase === null || pbtBase === undefined) return null;
    const finV = primary.fin ? (primary.fin[idx] ?? 0) : 0;
    const depV = primary.dep[idx] ?? 0;
    let base = pbtBase;
    if (!primary.pbtBefore && idx === 0 && exceptionalFound) base = pbtBase - exceptionalNet / f;
    return (base + finV + depV) * f;
  };

  const ebitda0 = ebitdaFor(0);
  if (ebitda0 !== null) {
    result.ebitda = round2(ebitda0);
    if (result.revenue && result.revenue > 0) {
      result.ebitdaMarginPct = round2((ebitda0 / result.revenue) * 100);
    }
    const ebitdaSeq = ebitdaFor(qoqIdx);
    if (ebitdaSeq !== null && ebitdaSeq > 0) {
      result.ebitdaQoQGrowthPct = round2(((ebitda0 - ebitdaSeq) / ebitdaSeq) * 100);
    }
    const ebitdaYoy = ebitdaFor(yoyIdx);
    if (ebitdaYoy !== null) {
      if (ebitdaYoy > 0) result.ebitdaYoYGrowthPct = round2(((ebitda0 - ebitdaYoy) / ebitdaYoy) * 100);
      if (revYoy && revYoy > 0) {
        const prevMargin = (ebitdaYoy / revYoy) * 100;
        result.ebitdaMarginBpsDelta = Math.round((result.ebitdaMarginPct - prevMargin) * 100);
        if (result.ebitdaMarginBpsDelta < -100) result.isMarginErosion = true;
      }
    }
  }

  // PBT YoY contraction flag
  if (primary.pbt && yoyIdx !== null) {
    const p0 = primary.pbt[0];
    const pY = primary.pbt[yoyIdx];
    if (p0 !== null && pY !== null && pY > 0 && ((p0 - pY) / pY) * 100 < -10) result.isYoYDecline = true;
  }

  // PAT (owners' share when disclosed, else total profit for the period)
  const patSeries = primary.owners || primary.pat;
  if (patSeries) {
    const pat0 = scaled(patSeries, 0, f);
    if (pat0 !== null) {
      result.patAttributable = round2(pat0);
      result.patConsolidated = round2(primary.pat ? (scaled(primary.pat, 0, f) ?? pat0) : pat0);
      if (primary.owners) result.patConsolidated = round2(pat0); // gate & alerts speak in owners' PAT
      result.patTotalIncludingMinority = primary.pat ? round2(scaled(primary.pat, 0, f)) : null;

      const patSeq = scaled(patSeries, qoqIdx, f);
      if (patSeq !== null && patSeq > 0) result.patQoQGrowthPct = round2(((pat0 - patSeq) / patSeq) * 100);

      const patYoy = scaled(patSeries, yoyIdx, f);
      if (patYoy !== null) {
        if (patYoy > 0) {
          const rawPatYoY = round2(((pat0 - patYoy) / patYoy) * 100);
          result.patYoYGrowthPct = rawPatYoY;
          if (rawPatYoY < -5.0) result.isYoYDecline = true;
        } else if (patYoy <= 0 && pat0 > 0) {
          result.patTurnaround = "LOSS_TO_PROFIT";
        } else if (patYoy <= 0 && pat0 <= 0) {
          result.patTurnaround = pat0 >= patYoy ? "LOSS_NARROWED" : "LOSS_WIDENED";
        }
        if (patYoy > 0 && pat0 <= 0) {
          result.patTurnaround = "PROFIT_TO_LOSS";
          result.isYoYDecline = true;
        }
      }
    }
  }

  // Standalone PAT (when a separate standalone statement exists)
  if (standalone && standalone.pat) {
    const sp = scaled(standalone.pat, 0, standalone.unit.factor);
    if (sp !== null) result.patStandalone = round2(sp);
  } else if (primary.scope === "STANDALONE" || primary.scope === "UNKNOWN") {
    result.patStandalone = result.patConsolidated;
  }

  // Exceptional item & normalised PAT
  result.exceptionalDescription = null;
  if (exceptionalFound && exceptionalNet > 0) {
    result.exceptionalGain = round2(exceptionalNet);
    result.exceptionalDescription = "Exceptional Item";
    if (result.patConsolidated !== null) {
      result.normalisedPat = round2(result.patConsolidated - result.exceptionalGain);
      const patYoyBase = patSeries ? scaled(patSeries, yoyIdx, f) : null;
      if (patYoyBase !== null && patYoyBase > 0) {
        result.normalisedPatYoYGrowthPct = parseFloat((((result.normalisedPat - patYoyBase) / patYoyBase) * 100).toFixed(1));
      }
    }
  } else {
    result.normalisedPat = null;
    result.normalisedPatYoYGrowthPct = null;
  }

  // Segment red flags (generic, materiality-filtered)
  result.segmentRedFlags = extractSegmentRedFlags(lines, revYoy);
  if (result.segmentRedFlags.some(fl => fl.yoyDeclinePct < -30)) result.isYoYDecline = true;

  // Unit sanity: when no unit was declared and the magnitude looks like Lakhs, rescale
  if (!primary.unit.explicit && result.revenue !== null && result.revenue >= 50000) {
    const k = 0.01;
    for (const key of ["revenue", "ebitda", "patConsolidated", "patAttributable", "patStandalone", "exceptionalGain", "normalisedPat", "patTotalIncludingMinority"]) {
      if (typeof result[key] === "number") result[key] = round2(result[key] * k);
    }
  }

  // Plausibility filters
  if (result.revenue !== null) {
    if (result.revenue > 50000 || result.revenue < 1) {
      console.warn(`[FINANCIAL VALIDATOR] Rejected out-of-bounds revenue (₹${result.revenue} Cr). Falling back to LLM.`);
      return null;
    }
    if (result.revenueYoYGrowthPct !== null && (result.revenueYoYGrowthPct > 500 || result.revenueYoYGrowthPct < -95)) {
      console.warn(`[FINANCIAL VALIDATOR] Rejected garbled YoY revenue growth (${result.revenueYoYGrowthPct}%). Falling back to LLM.`);
      return null;
    }
    if (result.patConsolidated !== null && (result.patConsolidated > result.revenue * 1.5 || result.patConsolidated < -10000)) {
      console.warn(`[FINANCIAL VALIDATOR] Rejected garbled PAT (₹${result.patConsolidated} Cr vs Revenue ₹${result.revenue} Cr). Clearing PAT fields.`);
      result.patConsolidated = null;
      result.patAttributable = null;
      result.patYoYGrowthPct = null;
      result.normalisedPat = null;
    }
    if (result.ebitdaMarginPct !== null && (result.ebitdaMarginPct > 95 || result.ebitdaMarginPct < -100)) {
      result.ebitda = null;
      result.ebitdaMarginPct = null;
      result.ebitdaMarginBpsDelta = null;
      result.isMarginErosion = false;
    }
  }

  return result;
}
