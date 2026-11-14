/**
 * Guidance and Commitment Deduplication Service
 *
 * Eliminates redundant, near-duplicate guidance targets from earnings call highlights and audio audits.
 */

function extractNumbers(str) {
  return new Set(
    [...String(str || "").matchAll(/\d+(?:\.\d+)?/g)]
      .map(m => m[0])
      .filter(n => n.length >= 2 || n.includes("."))
  );
}

function normalizeWords(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function wordOverlap(wordsA, wordsB) {
  if (!wordsA.length || !wordsB.length) return 0;
  const setB = new Set(wordsB);
  let shared = 0;
  for (const w of wordsA) {
    if (setB.has(w)) shared++;
  }
  return shared / Math.min(wordsA.length, wordsB.length);
}

/**
 * Deduplicates guidance bullet strings by checking numeric targets and semantic overlap.
 * @param {string[]} bullets
 * @param {number} maxItems
 * @returns {string[]}
 */
export function deduplicateGuidanceBullets(bullets, maxItems = 4) {
  if (!Array.isArray(bullets) || bullets.length === 0) return [];

  const kept = [];
  for (const b of bullets) {
    if (typeof b !== "string" || !b.trim()) continue;
    const clean = b.trim();
    const nums = extractNumbers(clean);
    const words = normalizeWords(clean);

    let isDuplicate = false;
    for (let i = 0; i < kept.length; i++) {
      const existing = kept[i];
      const existingNums = extractNumbers(existing);
      const existingWords = normalizeWords(existing);

      const hasSharedNumbers = nums.size > 0 && [...nums].some(n => existingNums.has(n));
      const overlap = wordOverlap(words, existingWords);

      // If they reference the exact same key numbers and share high vocabulary overlap, they are the same guidance target
      if (hasSharedNumbers && overlap >= 0.5) {
        isDuplicate = true;
        // Prefer the longer, more informative bullet
        if (clean.length > existing.length) {
          kept[i] = clean;
        }
        break;
      }

      if (overlap >= 0.8) {
        isDuplicate = true;
        if (clean.length > existing.length) {
          kept[i] = clean;
        }
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(clean);
    }
  }

  return kept.slice(0, maxItems);
}

/**
 * Deduplicates structured commitment objects by metric and target value numbers.
 * @param {Array<{metric?: string, statement?: string, target_value?: string, timeline?: string}>} commitments
 * @param {number} maxItems
 * @returns {Array}
 */
export function deduplicateCommitments(commitments, maxItems = 5) {
  if (!Array.isArray(commitments) || commitments.length === 0) return [];

  const kept = [];
  for (const c of commitments) {
    if (!c || typeof c !== "object") continue;
    const metric = String(c.metric || "").trim().toLowerCase();
    const target = String(c.target_value || "").trim().toLowerCase();
    const statement = String(c.statement || "").trim().toLowerCase();
    const nums = extractNumbers(`${target} ${statement}`);

    let isDuplicate = false;
    for (let i = 0; i < kept.length; i++) {
      const existing = kept[i];
      const existingMetric = String(existing.metric || "").trim().toLowerCase();
      const existingNums = extractNumbers(`${existing.target_value || ""} ${existing.statement || ""}`);

      const sameMetric = metric === existingMetric || (metric && existingMetric && (metric.includes(existingMetric) || existingMetric.includes(metric)));
      const sameNumbers = nums.size > 0 && [...nums].some(n => existingNums.has(n));

      if (sameMetric && sameNumbers) {
        isDuplicate = true;
        // Keep the more descriptive statement
        if (statement.length > (existing.statement || "").length) {
          kept[i] = c;
        }
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(c);
    }
  }

  return kept.slice(0, maxItems);
}
