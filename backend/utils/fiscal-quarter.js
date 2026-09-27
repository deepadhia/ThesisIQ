/**
 * Canonical Fiscal Quarter Utility (backend/utils/fiscal-quarter.js)
 * 
 * Single source of truth for Indian Fiscal Quarters parsing, representation,
 * chronological ordering, and comparison.
 * 
 * Standardizes representations:
 *   - 'Q1_FY27', 'FY27-Q1', 'Q1 FY27', 'Jun 2026', 'FY2027-Q1'
 * into a numerical sort key: (fiscalYear * 100 + quarter) -> 2701, 2604.
 * 
 * Guarantees:
 *   - 'Q4_FY26' (2604) < 'Q1_FY27' (2701)
 *   - Zero string comparison bugs (e.g. eliminates ASCII '3' > '1' failure)
 */

/**
 * Parses any quarter string into a canonical fiscal object.
 * @param {string} qInput - The raw quarter string
 * @returns {{ fiscalYear: number, quarter: number, key: number, label: string, raw: string }}
 */
export function parseFiscalQuarter(qInput) {
  if (!qInput || typeof qInput !== 'string') {
    return { fiscalYear: 0, quarter: 0, key: 0, label: 'UNKNOWN', raw: String(qInput || '') };
  }

  const s = qInput.trim();

  // Pattern 1: Q1_FY27 or Q1_FY2027 or Q1 FY27 or Q1-FY27
  let m = s.match(/^Q(\d)[\s_-]?FY(\d{2}|\d{4})$/i);
  if (m) {
    let fy = parseInt(m[2], 10);
    if (m[2].length === 4) fy = fy % 100;
    const q = parseInt(m[1], 10);
    if (q >= 1 && q <= 4 && fy >= 0 && fy <= 99) {
      return {
        fiscalYear: fy,
        quarter: q,
        key: fy * 100 + q,
        label: `Q${q}_FY${fy.toString().padStart(2, '0')}`,
        raw: s
      };
    }
  }

  // Pattern 2: FY27-Q1 or FY2027-Q1 or FY27 Q1 or FY27_Q1
  m = s.match(/^FY(\d{2}|\d{4})[\s_-]?Q(\d)$/i);
  if (m) {
    let fy = parseInt(m[1], 10);
    if (m[1].length === 4) fy = fy % 100;
    const q = parseInt(m[2], 10);
    if (q >= 1 && q <= 4 && fy >= 0 && fy <= 99) {
      return {
        fiscalYear: fy,
        quarter: q,
        key: fy * 100 + q,
        label: `Q${q}_FY${fy.toString().padStart(2, '0')}`,
        raw: s
      };
    }
  }

  // Pattern 3: Month Year (e.g. Jun 2026 -> Q1 FY27, Sep 2025 -> Q2 FY26, Dec 2025 -> Q3 FY26, Mar 2026 -> Q4 FY26)
  m = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s_-]?(\d{2}|\d{4})$/i);
  if (m) {
    const month = m[1].toLowerCase();
    let year = parseInt(m[2], 10);
    if (year < 100) year = 2000 + year;

    let q = 1;
    let fy = year % 100;

    if (['apr', 'may', 'jun'].includes(month)) {
      q = 1;
      fy = (year + 1) % 100; // June 2026 is Q1 FY27
    } else if (['jul', 'aug', 'sep'].includes(month)) {
      q = 2;
      fy = (year + 1) % 100; // Sep 2025 is Q2 FY26
    } else if (['oct', 'nov', 'dec'].includes(month)) {
      q = 3;
      fy = (year + 1) % 100; // Dec 2025 is Q3 FY26
    } else if (['jan', 'feb', 'mar'].includes(month)) {
      q = 4;
      fy = year % 100; // Mar 2026 is Q4 FY26
    }

    return {
      fiscalYear: fy,
      quarter: q,
      key: fy * 100 + q,
      label: `Q${q}_FY${fy.toString().padStart(2, '0')}`,
      raw: s
    };
  }

  // Fallback for FY only (e.g. FY26)
  m = s.match(/^FY(\d{2}|\d{4})$/i);
  if (m) {
    let fy = parseInt(m[1], 10);
    if (m[1].length === 4) fy = fy % 100;
    return {
      fiscalYear: fy,
      quarter: 0,
      key: fy * 100,
      label: `FY${fy.toString().padStart(2, '0')}`,
      raw: s
    };
  }

  return { fiscalYear: 0, quarter: 0, key: 0, label: s, raw: s };
}

/**
 * Ascending comparator: 2601 < 2602 < 2603 < 2604 < 2701
 */
export function compareFiscalQuarters(a, b) {
  const pa = typeof a === 'object' && a?.key !== undefined ? a : parseFiscalQuarter(a);
  const pb = typeof b === 'object' && b?.key !== undefined ? b : parseFiscalQuarter(b);
  if (pa.key !== pb.key) return pa.key - pb.key;
  if (pa.key > 0 && pa.key === pb.key) return 0;
  return String(pa.raw || '').localeCompare(String(pb.raw || ''));
}

/**
 * Descending comparator: 2701 > 2604 > 2603 > 2602 > 2601
 */
export function compareFiscalQuartersDesc(a, b) {
  return compareFiscalQuarters(b, a);
}

export const compareFiscalQuartersAsc = compareFiscalQuarters;

export function isBefore(a, b) {
  return compareFiscalQuarters(a, b) < 0;
}

export function isAfter(a, b) {
  return compareFiscalQuarters(a, b) > 0;
}

export function isEqual(a, b) {
  return compareFiscalQuarters(a, b) === 0;
}

export function sortFiscalQuarters(quarters, desc = false) {
  const arr = [...quarters];
  return arr.sort(desc ? compareFiscalQuartersDesc : compareFiscalQuarters);
}

export function latestQuarter(quarters) {
  if (!quarters || quarters.length === 0) return null;
  const sorted = sortFiscalQuarters(quarters, true);
  return sorted[0];
}

/**
 * Calculates prior / next fiscal quarter by offset.
 * Example: getQuarterOffset('Q1_FY27', -1) -> 'Q4_FY26'
 * Example: getQuarterOffset('Q1_FY27', -4) -> 'Q1_FY26'
 */
export function getQuarterOffset(quarterStr, offset = 0) {
  const p = parseFiscalQuarter(quarterStr);
  if (!p.fiscalYear || !p.quarter) return null;

  let totalQ = p.fiscalYear * 4 + (p.quarter - 1) + offset;
  let targetFy = Math.floor(totalQ / 4);
  let targetQ = (totalQ % 4) + 1;

  return `Q${targetQ}_FY${targetFy.toString().padStart(2, '0')}`;
}

/**
 * Calculates absolute linear quarter distance: (a - b) in quarters.
 * Positive if a is after b, negative if a is before b, 0 if same quarter.
 * Example: getQuarterDistance('Q1_FY27', 'Q4_FY26') -> 1
 * Example: getQuarterDistance('Q1_FY27', 'Q1_FY26') -> 4
 */
export function getQuarterDistance(a, b) {
  const pa = parseFiscalQuarter(a);
  const pb = parseFiscalQuarter(b);
  if (!pa.fiscalYear || !pa.quarter || !pb.fiscalYear || !pb.quarter) return null;
  const totalQa = pa.fiscalYear * 4 + (pa.quarter - 1);
  const totalQb = pb.fiscalYear * 4 + (pb.quarter - 1);
  return totalQa - totalQb;
}

