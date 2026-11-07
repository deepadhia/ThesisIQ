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

// Deliberately loose: a PDF text layer splits, glues and mis-punctuates numbers ("2,511 .60", "1.41 ,693.28", "2,18.236.50").
// canonicalNumber() decides whether a token really is a number and what it is; dates are never numbers.
const NUMERIC_TOKEN = /^\(?-?[\d,.]*\d[\d,.]*\)?$/;
const DATE_TOKEN = /^\(?\d{1,2}[./]\d{1,2}[./]\d{2,}\)?$/;
const DASH_TOKEN = /^[-–—]$/;
// Table rules and brackets that OCR/text layers glue onto cells: "786.91|", "860,13}", "[2,190.98".
const TABLE_JUNK = /[|{}[\]_~`]/g;
const LINE_FORMULA = /\(\s*\d{1,2}(?:\s*[-+–×x]\s*\d{1,2})+\s*\)/g;

const REVENUE_ROW = /(?:revenue\s+from\s+ope[rt]ations?|sales\s*\/\s*income\s+from\s+ope[rt]ations?|income\s+from\s+ope[rt]ations?|net\s+sales|revenue\s+from\s+sale)/i;
const TOTAL_INCOME_ROW = /^\W*(?:[ivx]+\.?\s+|\d+\.?\s+|[a-z]\)\s+)?total\s+income\b/i;
// "Profit / (Loss)": OCR reads the slash as I, l, 1 or | ("Profit I (Loss) before tax").
// "ProfiU(Loss ) before Tax": OCR turns the "t" of Profit into other letters and spaces the closing bracket, so the word is
// "prof" plus up to three characters and a bracket may be preceded by a space.
const PBT_ROW = /(?:prof\w{0,3}|p,\s*·?olil)\s*(?:[/Il1|]\s*\(?\s*lo(?:ss|[,.]s)\s*\)?\s*)?\(?(?:lo(?:ss|[,.]s)\s*\)?\s*)?before\s+(?:tax|share\s+of)/i;
const PBT_BEFORE_EXC_ROW = /profit\s*(?:[/Il1|]\s*\(?\s*loss\s*\)?\s*)?before\s+exceptional/i;
const PAT_ROW = /(?:net\s+)?profit\s*(?:[/Il1|]\s*\(?\s*loss\s*\)?\s*)?(?:\(\s*loss\s*\)\s*)?(?:after\s+tax\s+)?for\s+the\s+(?:period|quarter|year|half)|(?:net\s+)?profit\s+after\s+tax|(?:net\s+)?prof\w{0,3}\s*[/(]*\s*lo(?:ss|[,.]s)\s*\)?\s*after\s+tax|^\W*(?:[ivx]+\.?\s+|\d+\.?\s+)?profit\s*(?:[/Il1|]\s*\(?\s*loss\s*\)?)?\s*(?:\(\s*loss\s*\)\s*)?for\s+the/i;
const PAT_EXCLUDE = /before|comprehensive|attributable|per\s+share|margin|from\s+discontinued|share\s+of/i;
// "Fi nance costs": a stray space inside the word is a common PDF text-layer glitch.
// "d) Fin a nc e Cos ts": letter-spaced labels.
const FIN_ROW = /^\W*(?:\S{1,3}\s+)?(?:f\s?i\s?n\s?a\s?n\s?c\s?e\s+c\s?o\s?s\s?t\s?s?\b|fi\s?nance\s+costs?|interest\s+expenses?|interest\s+and\s+finance|interest\s+cost)/i;
// "Depreci~tion": the text layer swaps or drops a letter inside the word, so tolerate up to four stray characters between "depre" and "tion".
// "Depreciati on and amortisation": the text layer also splits the word after "ati" ("depreciati" + "on").
const DEP_ROW = /^\W*(?:\S{1,3}\s+)?(?:depre\s*ci\s*ation|depre\w{0,4}\W?\w{0,2}tion|depreci\w{0,3}\s+on\b|amorti[sz]ation)/i;
// "Share of profit in associate": an investment, not operating profit, so it is taken out of EBITDA (SBCL: +62% EBITDA as the
// company reports it only without it). A row that also names a JOINT VENTURE is left in: project joint ventures (EPC firms such as
// TRANSRAILL) are part of the operating business and their EBITDA includes them.
const ASSOCIATE_ROW = /share\s+of\s+(?:net\s+)?(?:profit|loss|\(?\s*loss)[^0-9]{0,60}?associate/i;
const ASSOCIATE_EXCLUDE = /before|after|attributable|comprehensive|joint|\bjv\b/i;
const EXC_ROW = /exceptional\s+(?:item|gain|loss|income|expense)s?/i;
// "III Other income" / "Oth er In co me" (line item between revenue and total income). Not "other operating revenue" (that is revenue),
// not "other comprehensive income", not "total income".
const OTHER_INCOME_ROW = /^\W*(?:[ivx]+\.?\s+|\d+\.?\s+|[a-z]\)\s+)?(?:\S{1,3}\s+)?o\s?t\s?[a-z0-9]{0,3}\s?e\s?r\s+i\s?n\s?c\s?o\s?m\s?e\b(?!\s+(?:tax|for|attrib))/i;
const OTHER_INCOME_EXCLUDE = /operating|comprehensive|total|before|expense/i;
const OWNERS_ROW = /(?:owners|ownets|equity\s+holders|shareholders)\s+of\s+the|owners\s+of\s+[a-z]/i;

const SEGMENT_EXCLUDE_LABEL = /total|less|inter|unallocable|unallocated|eliminat|capital\s+employed|assets|liabilit|tax|interest|finance|other\s+income|profit|net\b|exceptional|depreciation|expenses?|income\b|revenue\s+from\s+operations|segment\s+(?:results?|revenue|information)/i;

const digitCount = (t) => t.replace(/\D/g, "").length;
const hasTwoDecimals = (t) => /[.,]\d{2}\)?$/.test(t);

// Letters an OCR engine prints in place of digits ("197.GO" is 197.60, "268.BO" is 268.80, "l.11" is 1.11).
const OCR_DIGIT = { O: "0", o: "0", G: "6", B: "8", l: "1", I: "1", S: "5", Z: "2" };
const OCR_NUMBER = /^\(?-?[\dOoGBlISZ][\dOoGBlISZ,.]*[.,][\dOoGBlISZ]{2}\)?$/;

/**
 * Repairs a token only when it is unmistakably a damaged number: a decimal separator followed by exactly two characters and
 * at least two genuine digits, with the look-alike letters confined to those positions. A word is never a number.
 */
function repairOcrDigits(token) {
  if (!/[OoGBlISZ]/.test(token) || !OCR_NUMBER.test(token)) return token;
  if ((token.match(/\d/g) || []).length < 2) return token;
  return token.replace(/[OoGBlISZ]/g, (ch) => OCR_DIGIT[ch]);
}

/**
 * Reads one numeric cell whose punctuation may be damaged. The LAST separator is the decimal point when it is followed by
 * 1-2 digits (whatever character it is: "860,13" is 860.13); every earlier separator is a grouping mark and is dropped, so a
 * dot used as a thousands separator ("2,18.236.50") reads the same as the proper form. Nothing here is company-specific.
 * Returns { value, decimals, hasPoint, digits } or null when the token is not a number.
 */
function canonicalNumber(token) {
  if (token === null || token === undefined) return null;
  let t = String(token).trim();
  if (!t) return null;
  if (DASH_TOKEN.test(t)) return { value: null, decimals: 0, hasPoint: false, digits: 0 };
  t = repairOcrDigits(t);
  if (!NUMERIC_TOKEN.test(t) || DATE_TOKEN.test(t)) return null;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  const body = t.replace(/[()\-]/g, "").replace(/[,.]+$/, "");
  if (!/\d/.test(body)) return null;
  const lastSep = Math.max(body.lastIndexOf(","), body.lastIndexOf("."));
  let intPart = body;
  let frac = "";
  if (lastSep >= 0) {
    const tail = body.slice(lastSep + 1);
    const head = body.slice(0, lastSep);
    const lastCh = body[lastSep];
    const earlierDot = head.includes(".");
    const decimalPoint = lastCh === "."
      ? (!earlierDot || tail.length <= 2)     // a normal decimal point; with an earlier dot it must look like decimals
      : tail.length >= 1 && tail.length <= 2;  // a comma that is really the decimal point
    if (decimalPoint) { intPart = head; frac = tail; }
  }
  const digits = intPart.replace(/\D/g, "");
  const n = parseFloat(`${digits || "0"}${frac ? "." + frac : ""}`);
  if (isNaN(n)) return null;
  return { value: negative ? -n : n, decimals: frac.length, hasPoint: frac.length > 0, digits: digits.length };
}

function toNumber(token) {
  const c = canonicalNumber(token);
  return c ? c.value : null;
}

/** Cells that are plain numbers with proper two-decimal form (the row's evidence for how it prints). */
const isCleanDecimal = (c) => c && c.value !== null && c.hasPoint && c.decimals === 2;

/**
 * Digits the text layer dropped punctuation from. When a row prints with two decimals, a cell that has none but carries at
 * least two more digits than any proper cell is the same number with its decimal point lost ("348137" among "1,702.98" is
 * 3,481.37). Rows that print whole numbers, and cells that are plausible as printed, are left alone. In a whole-number row, a
 * dot with exactly three digits after it is a thousands separator that came out as a dot ("2.609" is 2,609).
 */
function restoreLostPunctuation(cells) {
  const real = cells.filter(c => c && c.value !== null);
  const clean = real.filter(isCleanDecimal);
  if (clean.length >= 2 && clean.length >= real.filter(c => c.hasPoint && c.decimals !== 2).length) {
    const widest = Math.max(...clean.map(c => c.digits));
    return cells.map(c => (c && c.value !== null && !c.hasPoint && c.digits >= widest + 2 && c.digits >= 3)
      ? { ...c, value: c.value / 100, decimals: 2, hasPoint: true, digits: c.digits - 2 }
      : c);
  }
  if (real.length >= 2 && !real.some(c => c.hasPoint && c.decimals !== 3)) {
    const plain = real.filter(c => !c.hasPoint);
    if (plain.length >= 2) {
      return cells.map(c => (c && c.value !== null && c.hasPoint && c.decimals === 3)
        ? { ...c, value: Math.round(c.value * 1000), decimals: 0, hasPoint: false, digits: c.digits + 3 }
        : c);
    }
  }
  return cells;
}

/**
 * Joins the pieces of numbers the text layer split apart.
 *   always:                    a piece that starts with a separator belongs to the cell before it  ("39" ",824", "1.41" ",693.28")
 *   when there are too many:   "15,072." "32" / "1,871.3" "6" join; then a short, unfinished cell absorbs the piece after it
 *                              ("74" "65" "0.19" -> 74650.19, "41" "8.06" -> 418.06), leftmost first, until the count is right.
 * Counts only ever shrink towards the column count the clean rows of the same statement agree on; a row that already has
 * that many cells is never touched.
 */
function joinFragments(tokens, expectedCols) {
  let toks = [];
  let pendingSep = null;   // a separator the text layer left standing alone between two pieces ("8,811 . 51")
  for (const cur of tokens) {
    if (/^[,.]$/.test(cur)) {
      if (toks.length && /\d$/.test(toks[toks.length - 1])) pendingSep = cur;
      continue;
    }
    const prev = toks[toks.length - 1];
    if (pendingSep && prev !== undefined && /^\d/.test(cur)) toks[toks.length - 1] = prev + pendingSep + cur;
    else if (prev !== undefined && !DASH_TOKEN.test(prev) && /^[,.]\d/.test(cur) && /\d$/.test(prev)) toks[toks.length - 1] = prev + cur;
    // "4," "141" (a thousands group the text layer separated), but not "59.64," "84.47" (two cells and a stray comma)
    else if (prev !== undefined && /^\d{1,3}(?:,\d{2,3})*,$/.test(prev) && /^\d{3}(?:\.\d+)?$/.test(cur)) toks[toks.length - 1] = prev + cur;
    else toks.push(cur);
    pendingSep = null;
  }
  const finish = (arr) => arr.map(t => t.replace(/,+$/, ""));
  if (!expectedCols || toks.length <= expectedCols) return finish(toks);
  toks = finish(toks);

  const stitched = [];
  for (const cur of toks) {
    const prev = stitched[stitched.length - 1];
    if (prev !== undefined && ((/\.$/.test(prev) && /^\d{1,2}$/.test(cur)) || (/\.\d$/.test(prev) && /^\d$/.test(cur)))) {
      stitched[stitched.length - 1] = prev + cur;
    } else stitched.push(cur);
  }
  toks = stitched;

  // Note-reference integers trailing the cells ("... 2,680.48 5 5") are not cells.
  while (toks.length > expectedCols && /^\d{1,2}$/.test(toks[toks.length - 1])) toks = toks.slice(0, -1);
  // A leading small integer in front of a full set of cells is a note reference ("9 746.03 858.67 666.35 1,604.70").
  if (toks.length === expectedCols + 1 && /^\d{1,2}$/.test(toks[0]) && Number(toks[0]) < 15 && hasTwoDecimals(toks[1])) toks = toks.slice(1);

  const prints2 = toks.filter(hasTwoDecimals).length >= 2;
  const unfinished = (t) => !DASH_TOKEN.test(t) && digitCount(t) <= 5 && (prints2 ? !hasTwoDecimals(t) : /,\d{1,2}$/.test(t));
  while (toks.length > expectedCols) {
    const k = toks.findIndex((t, idx) => idx < toks.length - 1 && unfinished(t) && !DASH_TOKEN.test(toks[idx + 1]) && digitCount(toks[idx + 1]) <= 4);
    if (k < 0) break;
    toks = [...toks.slice(0, k), toks[k] + toks[k + 1], ...toks.slice(k + 2)];
  }
  return toks;
}

/**
 * Parses the trailing run of numeric tokens of a statement row.
 * Returns { label, values } where values preserves column positions (null for "-").
 */
function parseRow(line, expectedCols = null) {
  if (!line || line.length > 400) return null;
  // "Profit before tax (1 - 2)", "(3+4)", "(5-6)": a formula over line numbers in the label is not a column of figures.
  const tokens = line.replace(TABLE_JUNK, " ").replace(LINE_FORMULA, " ").trim().split(/\s+/).filter(Boolean);
  const numeric = [];
  let i = tokens.length - 1;
  // a lone "." or "," between two pieces of a number belongs to the run (joinFragments uses it)
  const inRun = (k) => DASH_TOKEN.test(tokens[k]) || canonicalNumber(tokens[k]) || (/^[,.]$/.test(tokens[k]) && k > 0 && canonicalNumber(tokens[k - 1]) && k < tokens.length - 1 && canonicalNumber(tokens[k + 1]));
  while (i >= 0 && inRun(i)) {
    numeric.unshift(tokens[i]);
    i--;
  }
  const label = tokens.slice(0, i + 1).join(" ");
  if (numeric.length === 0) return null;

  let toks = joinFragments(numeric, expectedCols);

  // Drop trailing note-reference integers ("... 2,680.48 5 5") when there are surplus columns.
  const cap = expectedCols || 6;
  while (toks.length > cap && /^\d{1,2}$/.test(toks[toks.length - 1])) {
    toks = toks.slice(0, -1);
  }
  if (toks.length > cap) toks = toks.slice(0, cap);

  const cells = restoreLostPunctuation(toks.map(canonicalNumber));
  const values = cells.map(c => (c ? c.value : null));
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
    // Tolerates a space the text layer put before a separator ("31.03 .2026") and a stray footnote digit after the year ("30.09.20261").
    { re: /\b(\d{1,2})(?:\s?[\/.,\s]\s?|-)(\d{1,2})(?:\s?[\/.,\s]\s?|-)(\d{4})\d?\b/g, build: (m) => (+m[2] >= 1 && +m[2] <= 12 && +m[1] <= 31) ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null }
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
 * The period the statement says it covers, read from its own heading ("...for the Quarter and Half Year ended September 30, 2026"),
 * looking a few lines above the first row. Used to label the period when the column header is unreadable, and to reject a "header"
 * whose first date is not that period. Returns a Date or null.
 */
function periodEndFromHeading(lines, anchorIdx) {
  // Several heading lines name a period end (the title, "Three months ended 30.09.2026", "Previous three months ended 30.06.2026").
  // The current period is the LATEST of them; a line nearer the table may well be the previous quarter's column.
  const found = [];
  for (let i = anchorIdx - 1; i >= Math.max(0, anchorIdx - 14); i--) {
    // the date may wrap onto the next line of the title ("...Half Year ended" / "September 30, 2026")
    // "SEPTEMBER 30 , 20 26": the text layer spaces the comma and splits the year
    const text = `${lines[i]} ${lines[i + 1] && i + 1 < anchorIdx ? lines[i + 1] : ""}`
      .replace(/(\d)\s+,/g, "$1,").replace(/\b(20)\s(\d{2})\b/g, "$1$2");
    const m = text.match(/(?:quarter|three\s+months?)[^.]{0,60}?\bended\s+(.{6,30})/i);
    if (!m) continue;
    const d = parseDatesFromText(m[1])[0];
    const isMonthEnd = d && new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() === d.getUTCDate();
    if (isMonthEnd) found.push(d);
  }
  return found.length ? found.reduce((a, b) => (b.getTime() > a.getTime() ? b : a)) : null;
}

/**
 * Header dates -> column roles. Returns { yoyIdx, qoqIdx, dates, headingPeriodEnd }.
 */
function mapColumns(lines, anchorIdx, cols) {
  const regionStart = Math.max(0, anchorIdx - 40);
  const region = lines.slice(regionStart, anchorIdx + 1);
  // The column-header row carries several dates on one line; a date in the statement title or a note ("...ended 30th
  // September, 2026") is not a column. When the header's dates cannot be lined up with the columns (an unreadable date such as
  // "30 Sap 2025" shifts everything), do not guess: keep the standard layout (current quarter, previous quarter, year-ago quarter).
  const perLine = region.map(parseDatesFromText);
  const headerRows = perLine.filter(d => d.length >= 2);
  let all;
  if (headerRows.length) {
    all = [];
    for (let k = headerRows.length - 1; k >= 0 && all.length < cols; k--) all = [...headerRows[k], ...all];
    if (all.length !== cols) all = [];
  } else {
    all = parseDatesFromText(region.join("\n"));
  }
  let yoyIdx = cols >= 3 ? 2 : null;
  let qoqIdx = cols >= 2 ? 1 : null;
  let dates = null;
  const headingPeriodEnd = periodEndFromHeading(lines, anchorIdx);

  if (all.length >= cols && cols >= 2) {
    dates = all.slice(all.length - cols);
    // A real column header lists period ends (month-end dates) with the current period first and latest. Dates swept up from
    // a notes page or a previous table ("2026-08-06", "2026-05-26") are not a header: use the standard layout instead.
    const isMonthEnd = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() === d.getUTCDate();
    const looksLikeHeader = dates.every(isMonthEnd) && dates.every(d => d.getTime() <= dates[0].getTime())
      && (!headingPeriodEnd || daysBetween(dates[0], headingPeriodEnd) <= 10);
    if (!looksLikeHeader) dates = null;
  }

  if (dates) {
    const d0 = dates[0];
    let foundYoy = null;
    let foundQoq = null;
    for (let j = 1; j < dates.length; j++) {
      const dj = dates[j];
      const gap = (d0.getTime() - dj.getTime()) / 86400000;
      if (foundYoy === null && gap > 350 && gap < 380) foundYoy = j;
      if (foundQoq === null && gap > 80 && gap < 100) foundQoq = j;
    }
    // Quarter columns always come first and in order (current, previous quarter, year-ago quarter). A header whose previous
    // quarter sits AFTER the year-ago column has been scrambled by the text layer; its dates say nothing about the columns.
    if (foundYoy !== null && foundQoq !== null && foundQoq > foundYoy) {
      dates = null;
    } else {
      if (foundYoy !== null) yoyIdx = foundYoy;
      if (foundQoq !== null) qoqIdx = foundQoq;
    }
    // Without a proper quarter-end header (e.g. only 2 quarter columns) do not invent a YoY column
    if (foundYoy === null && cols < 3) yoyIdx = null;
  }
  return { yoyIdx, qoqIdx, dates, headingPeriodEnd };
}

const UNIT_PATTERN = /(?:(?:rs\.?|₹|inr|rupees)\s*(?:in\s+)?(crores?|crs?\b|lakhs?|lacs?|millions?|mn\b)|\bin\s+(crores?|crs?\b|lakhs?|lacs?|millions?|mn\b)|\(\s*(?:rs\.?|₹)?\s*(crores?|crs?\b|lakhs?|lacs?|millions?|mn\b)\s*\))/i;

function unitFactor(word) {
  const w = String(word || "").toLowerCase();
  if (w.startsWith("lakh") || w.startsWith("lac")) return { factor: 0.01, name: "LAKHS" };
  if (w.startsWith("million") || w === "mn") return { factor: 0.1, name: "MILLIONS" };
  return { factor: 1, name: "CRORES" };
}

function detectUnit(lines, anchorIdx, declaredUnit = null) {
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
  // Nothing printed near the statement or counted in the text handed to the parser (a vision-OCR transcription carries rows only):
  // the unit the same filing declares in its own text is the next best evidence, the crore default the last.
  if (declaredUnit) return { ...unitFactor(declaredUnit), explicit: true, fromDocument: true };
  return { factor: 1, name: "CRORES", explicit: false };
}

/**
 * The unit a filing declares in its own text ("(Rs. in million)", "(Rs. in Lakhs)", "(R, in million except per share data)"), by
 * majority of its declarations; null when it declares none or declares two units equally often. An amount written in words
 * ("Rupees Ten Crore only") is not a declaration. Used when the text a statement is parsed from has lost its unit line.
 * @returns {"crore"|"lakh"|"million"|null}
 */
export function detectDocumentUnit(text = "") {
  const counts = { CRORES: 0, LAKHS: 0, MILLIONS: 0 };
  for (const l of String(text || "").split(/\r?\n/)) {
    const m = l.length < 200 ? l.match(UNIT_PATTERN) : null;
    if (m) counts[unitFactor(m[1] || m[2] || m[3]).name]++;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === 0 || ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0] === "LAKHS" ? "lakh" : ranked[0][0] === "MILLIONS" ? "million" : "crore";
}

const HEADING_EXCLUDE = /report|auditor|review|notice|outcome|submission|approved|pursuant|we\s+have|item\s+no|include|include|enclos|reviewed|resolution|covering/i;

function headingScope(line) {
  if (!line || line.length > 190) return null;
  if (HEADING_EXCLUDE.test(line)) return null;
  const m = line.match(/\b(consolidated|coniol\s*id:?o?\s*ted|standalone|stand-alone)\b/i);
  if (!m) return null;
  const looksLikeHeading =
    /(?:^|\b)(?:statement\s+of\s+)?(?:un-?audited\s+|audited\s+)?(?:consolidated|coniol\s*id:?o?\s*ted|standalone|stand-alone)\b[^.]{0,80}?(?:financial\s+results?|profit\s+and\s+loss|results|revenue|segment)/i.test(line) ||
    /statement\s+of\s+(?:un-?audited\s+|audited\s+)?(?:consolidated|coniol\s*id:?o?\s*ted|standalone|stand-alone)/i.test(line) ||
    /(?:financial\s+results?|profit\s+and\s+loss)[^.]{0,40}\((?:consolidated|standalone)\)/i.test(line);
  if (!looksLikeHeading) return null;
  return /consolidated|coniol/i.test(m[1]) ? "CONSOLIDATED" : "STANDALONE";
}

function findScope(lines, anchorIdx) {
  for (let i = anchorIdx - 1; i >= Math.max(0, anchorIdx - 60); i--) {
    const s = headingScope(lines[i]);
    if (s) return s;
  }
  for (let i = anchorIdx + 1; i <= Math.min(lines.length - 1, anchorIdx + 120); i++) {
    const s = headingScope(lines[i]);
    if (s) return s;
  }
  return "UNKNOWN";
}

/**
 * Locates full statement blocks. Each block carries parsed rows for the quarter columns.
 */
function locateBlocks(lines, declaredUnit = null) {
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
        let row = parseRow(l, cols);
        // A long row label often wraps ("Profit before tax, share of profit in associates and jointly" / "controlled
        // entities (3+4) 187.78 ..."): when the label line carries no numbers, its figures are on the next line.
        if (!row && i + 1 < end) row = parseRow(lines[i + 1], cols);
        if (row && row.values.length === cols) return { idx: i, row };
      }
      return null;
    };

    // Choose the column count that the most statement rows agree on
    // (note-reference integers can make a row look wider than it really is).
    let cols = Math.min(rawRev.values.length, 6);
    let bestScore = -1;
    let bestDecs = -1;
    for (let c = Math.min(rawRev.values.length, 6); c >= 3; c--) {
      const find = rowFinder(c);
      let score = 0;
      let decs = 0;
      for (const rx of [PBT_ROW, PAT_ROW, DEP_ROW, FIN_ROW, TOTAL_INCOME_ROW]) {
        const found = find(rx, { exclude: /exceptional|before\s+exceptional|comprehensive|attributable/i });
        if (found) {
          score++;
          decs += found.row.values.filter(v => v !== null && Math.round(v * 100) === v * 100 && v % 1 !== 0).length;
        }
      }
      if (score > bestScore || (score === bestScore && decs > bestDecs)) {
        bestScore = score;
        bestDecs = decs;
        cols = c;
      }
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
    // Other income sits between revenue and total income: only look there, never in the notes further down.
    const otherIncome = findRow(OTHER_INCOME_ROW, { exclude: OTHER_INCOME_EXCLUDE });
    // Share of an associate's profit printed ABOVE the profit-before-tax line is part of that line but not of operating profit.
    const associateFound = findRow(ASSOCIATE_ROW, { exclude: ASSOCIATE_EXCLUDE });
    const pbtLineIdx = pbtBefore ? pbtBefore.idx : (pbt ? pbt.idx : null);
    const associate = associateFound && associateFound.idx > idx && pbtLineIdx !== null && associateFound.idx < pbtLineIdx ? associateFound : null;

    // Attributable-to-owners row (only trusted when it follows the PAT row under a "Profit attributable to" heading)
    let owners = null;
    const startLooking = pat ? pat.idx + 1 : (pbt ? pbt.idx + 1 : idx + 1);
      for (let i = startLooking; i < Math.min(end, startLooking + 30); i++) {
        if (/(?:(?:profit|l'?rofic)(?:\s+for\s+the\s+(?:period|quarter|year))?\s+attributable\s+to|attributable\s+to\s*:?\s*$)/i.test(lines[i]) && !/comprehensive/i.test(lines[i])) {
          for (let j = i; j < Math.min(end, i + 5); j++) {
            // A "...comprehensive income attributable to:" heading starts a different split (OCI / total comprehensive income):
            // its owners' row is not the profit. When the profit's own owners' row is unreadable, no owners' row is better than that one.
            if (j > i && /comprehensive/i.test(lines[j])) break;
            if (OWNERS_ROW.test(lines[j])) {
              const row = parseRow(lines[j], cols);
              if (row && row.values.length === cols) { owners = { idx: j, row }; break; }
            }
          }
          break;
        }
      }

    // A cell wildly out of scale with its own column's revenue is a mis-read (pieces of a number that happened to complete
    // the column count): blank it so it is neither used nor trusted. The owners' row must also sit near the profit row it splits.
    const inScale = (row) => (row ? row.values.map((v, i) => {
      const r = revRowFixed.values[i];
      return (v === null || r === null || r === undefined || Math.abs(v) <= 2 * Math.abs(r)) ? v : null;
    }) : null);
    const patValues = inScale(pat?.row);
    let ownersValues = inScale(owners?.row);
    if (ownersValues && patValues) {
      const sameScale = ownersValues.slice(0, 3).every((v, i) => {
        const p = patValues[i];
        if (v === null || p === null || v === 0 || p === 0) return true;
        const ratio = Math.abs(v) / Math.abs(p);
        return ratio > 0.1 && ratio < 3;
      });
      if (!sameScale) ownersValues = null;
    }

    const isFull = Boolean(dep || fin) && Boolean(pat || pbt);
    blocks.push({
      anchorIdx: idx,
      cols,
      revenue: revRowFixed.values,
      totalIncome: totalIncome?.row.values || null,
      pbt: inScale(pbt?.row),
      pbtBefore: inScale(pbtBefore?.row),
      pat: patValues,
      owners: ownersValues,
      fin: inScale(fin?.row),
      dep: inScale(dep?.row),
      otherIncome: otherIncome && (!totalIncome || otherIncome.idx < totalIncome.idx) ? inScale(otherIncome.row) : null,
      associate: associate ? inScale(associate.row) : null,
      // revenue, other income and total income on consecutive lines: only then is "revenue + other income = total income" a fact
      // (another income line between them, e.g. "other operating revenue", makes the sum differ legitimately).
      incomeRowsConsecutive: Boolean(otherIncome && totalIncome && otherIncome.idx === idx + 1 && totalIncome.idx === otherIncome.idx + 1),
      exc: exc?.row || null,
      isFull,
      hasStatement: Boolean(pbt || pat),
      scope: findScope(lines, idx),
      unit: detectUnit(lines, idx, declaredUnit),
      colMap: mapColumns(lines, idx, cols)
    });
  }
  // Only trust blocks whose scope is known from a real heading, or that carry parseable header dates.
  return blocks.filter(b => b.hasStatement && (b.scope !== "UNKNOWN" || (b.colMap.dates && b.isFull)));
}

const blockRevenue = (b) => (b.revenue[0] || 0) * b.unit.factor;
const blockRank = (b) => (b.isFull ? 0 : 10) + (b.scope === "CONSOLIDATED" ? 0 : b.scope === "UNKNOWN" ? 1 : 2);

/** Blocks in the order they should be tried: full statements first, consolidated before standalone, larger revenue first. */
function orderBlocks(blocks) {
  // Digits can be lost from a damaged text layer but never invented: when another statement of the same filing (same scope)
  // carries the same revenue 100 times smaller, the larger figure is the same number with its decimal point lost. It is tried last.
  const lostDecimals = (b) => blocks.some(o => o !== b && o.scope === b.scope && blockRevenue(o) > 0 && (() => {
    const ratio = blockRevenue(b) / blockRevenue(o);
    return ratio > 90 && ratio < 110;
  })());
  const rank = (b) => blockRank(b) + (lostDecimals(b) ? 20 : 0);
  return [...blocks].sort((a, b) => rank(a) - rank(b) || blockRevenue(b) - blockRevenue(a));
}

function standaloneFor(primary, blocks) {
  return blocks
    .filter(b => b !== primary && b.scope === "STANDALONE" && b.isFull)
    .sort((a, b) => blockRevenue(b) - blockRevenue(a))[0] || (primary.scope === "STANDALONE" ? primary : null);
}

function pickBlocks(blocks) {
  if (blocks.length === 0) return { primary: null, standalone: null };
  const primary = orderBlocks(blocks)[0];
  return { primary, standalone: standaloneFor(primary, blocks) };
}

const round2 = (n) => parseFloat(n.toFixed(2));
const pct = (cur, prev) => (prev && prev > 0 && cur !== null && cur !== undefined) ? round2(((cur - prev) / prev) * 100) : null;

function scaled(values, idx, factor) {
  if (!values || idx === null || idx === undefined) return null;
  const v = values[idx];
  if (v === null || v === undefined) return null;
  return v * factor;
}

const SEG_REVENUE_HEADER = /^\W*segment\s+revenue\b/i;
const SEG_RESULT_HEADER = /^\W*segment\s+results?\b/i;
const SEG_END = /^\W*(?:segment\s+(?:assets|liabilit)|capital\s+employed)/i;
const SEG_LEGACY_START = /^\W*(?:\d+\.?\s*)?(?:consolidated\s+)?segment\s+(?:results?|revenue|information|wise)|^\W*segment\s+reporting/i;

/** Number of single-character edits between two short strings. */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * Segments whose revenue or result (profit) fell more than 25% YoY.
 * The table is the one of the statement's own scope: a filing prints a standalone and a consolidated segment table (the standalone
 * one first), and the alert used to quote the standalone one under a consolidated headline. Revenue rows and result rows are told
 * apart (`metric`), and a result label the filing itself mis-spells ("Etectronics", HBLENGINE 2026-11-07) is read as the revenue
 * label of the same table it is one or two edits from, so one segment never appears under two names.
 * @returns {Array<{segment:string, metric:"revenue"|"result", currentValue:number, prevValue:number, yoyDeclinePct:number}>}
 */
export function extractSegmentRedFlags(lines, totalRevenueYoyBase, scope = null) {
  const flags = [];
  const tables = [];
  lines.forEach((l, i) => {
    if (!SEG_REVENUE_HEADER.test(l) || l.length > 60) return;
    const title = lines.slice(Math.max(0, i - 10), i).reverse().find((t) => /segment/i.test(t) && /consolidated|standalone/i.test(t)) || "";
    tables.push({ start: i, scope: /consolidated/i.test(title) ? "CONSOLIDATED" : /standalone/i.test(title) ? "STANDALONE" : null });
  });
  let start;
  let split = true;
  if (tables.length) {
    start = ((scope && tables.find((t) => t.scope === scope)) || tables[0]).start;
  } else {
    // no "Segment Revenue / Segment Results" split: the older single-section layout, every row read as revenue
    start = lines.findIndex((l) => SEG_LEGACY_START.test(l) && l.length < 120);
    split = false;
    if (start === -1) return flags;
  }
  let section = "revenue";
  const revenueLabels = [];
  for (let i = start + 1; i < Math.min(start + 40, lines.length); i++) {
    if (SEG_END.test(lines[i])) break;
    if (split && SEG_RESULT_HEADER.test(lines[i])) { section = "result"; continue; }
    if (split && SEG_REVENUE_HEADER.test(lines[i])) break;           // the next table begins
    const row = parseRow(lines[i], null);
    if (!row || row.values.length < 3) continue;
    const label = row.label.replace(/^\W*(?:\d+[.)]?|[a-z]\))\s*/i, "").trim();
    if (label.length < 3 || SEGMENT_EXCLUDE_LABEL.test(label)) continue;
    let name = label.toUpperCase();
    if (section === "revenue") revenueLabels.push(name);
    else if (!revenueLabels.includes(name) && name.length >= 5) {
      const near = revenueLabels.find((r) => editDistance(r, name) <= 2);
      if (near) name = near;
    }
    const cur = row.values[0];
    const prev = row.values[2];
    if (cur === null || prev === null || prev <= 0 || cur < 0) continue;
    const yoy = ((cur - prev) / prev) * 100;
    // Materiality: segment must be a meaningful slice of the year-ago revenue base
    const material = !totalRevenueYoyBase || prev >= 0.03 * totalRevenueYoyBase;
    if (yoy < -25 && material && !flags.some((f) => f.segment === name && f.metric === section)) {
      flags.push({ segment: name, metric: section, currentValue: cur, prevValue: prev, yoyDeclinePct: parseFloat(yoy.toFixed(1)) });
    }
  }
  return flags;
}

/**
 * Extracts and computes financial metrics from raw PDF text.
 * @param {string} pdfText Raw text extracted from PDF
 * @returns {object|null} Financial metrics object, or null when no full statement table is present
 */
export function extractDeterministicFinancials(pdfText = "", { periodEndHint = null, declaredUnit = null } = {}) {
  if (!pdfText || typeof pdfText !== "string") {
    return null;
  }

  const lines = pdfText.split("\n").map(l => l.trim()).filter(Boolean);
  const blocks = locateBlocks(lines, declaredUnit);
  if (blocks.length === 0) {
    return null;
  }

  // A block whose figures fail the plausibility checks (a corrupted consolidated table) must not hide a good one
  // (the standalone table of the same filing): try the blocks in order and return the first that holds up.
  for (const primary of orderBlocks(blocks)) {
    const result = buildResult(primary, standaloneFor(primary, blocks), lines, { periodEndHint });
    if (result) return result;
  }
  return null;
}

/**
 * The quarter end a filing most likely reports: the latest March / June / September / December 31st-or-30th strictly before the
 * filing date. Used only when the statement's own header dates are unreadable (SHAKTIPUMP's real PDF), and only to decide which
 * cumulative columns a layout carries.
 */
export function quarterEndBefore(filingDate) {
  const d = filingDate ? new Date(filingDate) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const ends = [];
  for (const y of [d.getUTCFullYear() - 1, d.getUTCFullYear()]) for (const [m, day] of [[2, 31], [5, 30], [8, 30], [11, 31]]) ends.push(Date.UTC(y, m, day));
  const before = ends.filter((t) => t < d.getTime()).pop();
  return before ? new Date(before).toISOString().slice(0, 10) : null;
}

/**
 * Cumulative columns, by layout (the revenue row must prove it; otherwise null, never a guess):
 *  - Sep / Dec quarter, SIX columns: quarter, previous quarter, year-ago quarter, year to date, year-ago year to date, last full year.
 *  - Sep / Dec quarter, FIVE columns: the same without last full year (some companies do not print it).
 *  - March quarter, FIVE columns: quarter, previous quarter, year-ago quarter, the FULL YEAR just ended, the year before: the
 *    actual outcome that full-year guidance is judged against.
 */
function cumulativeColumns(primary, quarterEnded, periodEndHint = null) {
  if (!primary || ![5, 6].includes(primary.cols)) return null;
  const at = quarterEnded || periodEndHint;
  if (!at) return null;
  const month = Number(String(at).slice(5, 7));
  const r = primary.revenue;
  if (!r || r.length !== primary.cols || r.some((v) => v === null || v === undefined || !(v > 0))) return null;
  const [q0, q1, py, c3, c4, c5] = r;
  if (primary.cols === 5 && month === 3) {
    // full year just ended: roughly four quarters of revenue, and the year before likewise
    if (!(c3 >= q0 * 1.5 && c3 <= q0 * 6 && c4 >= py * 1.5 && c4 <= py * 6)) return null;
    return { fullYear: true };
  }
  const ytdMonths = month === 9 ? 6 : month === 12 ? 9 : null;
  if (!ytdMonths) return null;
  const sumTwo = q0 + q1;
  if (ytdMonths === 6 && Math.abs(c3 - sumTwo) > 0.03 * Math.max(c3, sumTwo)) return null;
  if (ytdMonths === 9 && !(c3 >= sumTwo * 0.97 && c3 <= sumTwo * 2.2)) return null;
  if (!(c4 >= py * 0.97)) return null;
  if (primary.cols === 6 && !(c5 >= c4 * 0.99 && c5 <= c4 * 3.2)) return null;
  return { ytdMonths, hasFyPrior: primary.cols === 6 };
}

function buildResult(primary, standalone, lines, { periodEndHint = null } = {}) {
  const f = primary.unit.factor;
  const { yoyIdx, qoqIdx } = primary.colMap;

  const result = {
    isFinancialResult: true,
    statementScope: primary.scope,
    unit: primary.unit.name,
    quarterEnded: primary.colMap.dates
      ? primary.colMap.dates[0].toISOString().slice(0, 10)
      : ((primary.colMap.headingPeriodEnd || standalone?.colMap?.headingPeriodEnd)?.toISOString().slice(0, 10) ?? null),
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

  // Income identity: revenue + other income = total income, column by column. A column that breaks it holds a mis-read cell
  // (SJS: vision OCR printed 2,827 as 2,327, which became "revenue -3.7%" and a red alert). The current quarter breaking it
  // rejects the block (the caller then tries the next block or the clearly-labelled UNVERIFIED fallback); a comparison column
  // breaking it only withholds the growth rate built on it. Unknown (no other-income or total-income row) is never a failure.
  const incomeIdentity = (idx) => {
    if (idx === null || idx === undefined || !primary.incomeRowsConsecutive || !primary.totalIncome || !primary.otherIncome) return null;
    const r = primary.revenue[idx], o = primary.otherIncome[idx], t = primary.totalIncome[idx];
    if ([r, o, t].some((v) => v === null || v === undefined) || t <= 0 || r <= 0 || o < 0) return null;
    // Total income can neither be below revenue nor several times it: a total-income cell outside that band is itself damaged
    // text ("total income 6", a stray note number), so it proves nothing about the revenue cell. Unknown, not a failure.
    if (t < r * 0.999 || t > r * 1.5) return null;
    return Math.abs(r + o - t) <= Math.max(0.015 * t, 0.02);
  };
  if (incomeIdentity(0) === false) {
    console.warn(`[FINANCIAL VALIDATOR] Rejected block: revenue ${primary.revenue[0]} + other income ${primary.otherIncome[0]} != total income ${primary.totalIncome[0]}. Treating the table as mis-read.`);
    return null;
  }

  // Revenue
  const rev0 = scaled(primary.revenue, 0, f);
  const revSeq = incomeIdentity(qoqIdx) === false ? null : scaled(primary.revenue, qoqIdx, f);
  const revYoy = incomeIdentity(yoyIdx) === false ? null : scaled(primary.revenue, yoyIdx, f);
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

  // EBITDA = PBT before exceptional items + finance costs + depreciation - OTHER INCOME (needs a depreciation row).
  // Other income (treasury, interest, FX gains) is not operating profit; companies report EBITDA without it (Transrail 237.9,
  // Jyoti 131.33 for Q2 FY27). When a statement shows no readable other-income row the figure is the older, inclusive one.
  const ebitdaFor = (idx) => {
    if (idx === null || idx === undefined || !primary.dep) return null;
    const pbtBase = primary.pbtBefore ? primary.pbtBefore[idx] : (primary.pbt ? primary.pbt[idx] : null);
    if (pbtBase === null || pbtBase === undefined) return null;
    const finV = primary.fin ? (primary.fin[idx] ?? 0) : 0;
    const depV = primary.dep[idx] ?? 0;
    let base = pbtBase;
    if (!primary.pbtBefore && idx === 0 && exceptionalFound) base = pbtBase - exceptionalNet / f;
    const otherV = primary.otherIncome ? (primary.otherIncome[idx] ?? 0) : 0;
    const associateV = primary.associate ? (primary.associate[idx] ?? 0) : 0; // a share of profit/(loss) is not operating
    return (base + finV + depV - otherV - associateV) * f;
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

  // Cumulative columns for GUIDANCE PACING and for the full-year outcome (fulfilment of last year's guidance). Reported only when the
  // arithmetic of the columns holds; otherwise every cumulative field is absent.
  const cumulative = cumulativeColumns(primary, result.quarterEnded, periodEndHint);
  if (cumulative && incomeIdentity(3) !== false) {
    const patCum = primary.owners || primary.pat;
    const rev = (i) => scaled(primary.revenue, i, f);
    const fill = (prefix, curIdx, priorIdx, fyPriorIdx) => {
      result[`${prefix}Revenue`] = round2(rev(curIdx));
      result[`${prefix}RevenuePrior`] = round2(rev(priorIdx));
      result[`${prefix}RevenueYoYGrowthPct`] = pct(rev(curIdx), rev(priorIdx));
      const eC = ebitdaFor(curIdx), eP = ebitdaFor(priorIdx);
      if (eC !== null) { result[`${prefix}Ebitda`] = round2(eC); result[`${prefix}EbitdaMarginPct`] = round2((eC / rev(curIdx)) * 100); }
      if (eP !== null) { result[`${prefix}EbitdaPrior`] = round2(eP); result[`${prefix}EbitdaMarginPriorPct`] = round2((eP / rev(priorIdx)) * 100); }
      if (patCum) {
        const pC = scaled(patCum, curIdx, f), pP = scaled(patCum, priorIdx, f);
        if (pC !== null) result[`${prefix}Pat`] = round2(pC);
        if (pP !== null) result[`${prefix}PatPrior`] = round2(pP);
        if (pC !== null && pP !== null && pP > 0) result[`${prefix}PatYoYGrowthPct`] = round2(((pC - pP) / pP) * 100);
      }
      if (fyPriorIdx !== null) {
        result.fyPriorRevenue = round2(rev(fyPriorIdx));
        const eF = ebitdaFor(fyPriorIdx);
        if (eF !== null) result.fyPriorEbitda = round2(eF);
        const pF = patCum ? scaled(patCum, fyPriorIdx, f) : null;
        if (pF !== null) result.fyPriorPat = round2(pF);
      }
    };
    if (cumulative.fullYear) {
      fill("fy", 3, 4, null);
      result.fyEnded = result.quarterEnded || periodEndHint;
    } else {
      result.ytdMonths = cumulative.ytdMonths;
      fill("ytd", 3, 4, cumulative.hasFyPrior ? 5 : null);
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
  result.segmentRedFlags = extractSegmentRedFlags(lines, revYoy, result.statementScope);
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
    // Profit after tax of a profitable quarter sits in a narrow band around its own profit before tax (tax 20-35%, minorities,
    // credits). A figure far outside it is another row (other comprehensive income was read as profit: 14.74 against PBT 158.09)
    // or a mis-read cell. Withhold it and every growth rate built on it: "PAT not available" is honest, a wrong PAT is not.
    const pbt0 = primary.pbt ? scaled(primary.pbt, 0, f) : null;
    const patNow = result.patAttributable ?? result.patConsolidated;
    if (pbt0 !== null && pbt0 > 0 && patNow !== null && patNow > 0) {
      const ratio = patNow / pbt0;
      if (ratio < 0.25 || ratio > 1.6) {
        result.patRejectedReason = `PAT ${patNow} is ${Math.round(ratio * 100)}% of PBT ${round2(pbt0)}: not a plausible profit-after-tax for this statement`;
        console.warn(`[FINANCIAL VALIDATOR] ${result.patRejectedReason}. Clearing PAT fields.`);
        for (const key of ["patConsolidated", "patAttributable", "patTotalIncludingMinority", "patYoYGrowthPct", "patQoQGrowthPct", "normalisedPat", "normalisedPatYoYGrowthPct", "patTurnaround"]) {
          if (key in result) result[key] = null;
        }
      }
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

/** Test-only access to the row tokenizer and block locator (used by the real-layout regression tests). */
export const __testing = { parseRow, locateBlocks, pickBlocks };
