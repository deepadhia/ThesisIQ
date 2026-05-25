/**
 * Compute per-quarter portfolio ranks from existing quarterly_snapshots JSON / columns.
 *
 * Ranking is thesis-first, then confidence (keep in sync with src/lib/snapshotPortfolioRank.ts):
 *   score = thesis_tier * 1000 + confidence(0–100)
 *   tier: strengthening=4, stable=3, weakening=2, broken=1, unknown=0
 *
 * Usage:
 *   node --env-file=.env.local backend/scripts/compute-quarterly-ranks.js
 *   node --env-file=.env.local backend/scripts/compute-quarterly-ranks.js --out quarterly-ranks.json
 *   node --env-file=.env.local backend/scripts/compute-quarterly-ranks.js --apply
 *
 * --apply also updates stocks.portfolio_* (consolidated score + portfolio list rank).
 * Keep trajectory math in sync with src/lib/snapshotPortfolioRank.ts.
 *
 * Requires DATABASE_URL (same as db:migrate).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pkg from "pg";

const { Client } = pkg;

dotenv.config({ path: ".env.local" });
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseQuarterLabel(quarter) {
  if (!quarter || typeof quarter !== "string") return null;
  const s = quarter.trim();
  let m = s.match(/^Q(\d)_FY(\d{2}|\d{4})$/i);
  if (m) {
    let fy = parseInt(m[2], 10);
    if (m[2].length === 4) fy = fy % 100;
    const q = parseInt(m[1], 10);
    if (q >= 1 && q <= 4 && fy >= 0 && fy <= 99) return { fy, q, raw: s };
  }
  m = s.match(/^FY(\d{2}|\d{4})-Q(\d)$/i);
  if (m) {
    let fy = parseInt(m[1], 10);
    if (m[1].length === 4) fy = fy % 100;
    const q = parseInt(m[2], 10);
    if (q >= 1 && q <= 4 && fy >= 0 && fy <= 99) return { fy, q, raw: s };
  }
  return { fy: 0, q: 0, raw: s };
}

function compareQuarterAsc(a, b) {
  const pa = parseQuarterLabel(a);
  const pb = parseQuarterLabel(b);
  if (pa.fy !== pb.fy) return pa.fy - pb.fy;
  if (pa.q !== pb.q) return pa.q - pb.q;
  return String(a).localeCompare(String(b));
}

function compareQuarterDesc(a, b) {
  return compareQuarterAsc(b, a);
}

function thesisTierFromRow(row) {
  const obj = parseRaw(row.raw_ai_output);
  const thesis = (row.thesis_status || obj?.snapshot?.thesis_status || "").toLowerCase().trim();
  if (thesis === "strengthening") return 4;
  if (thesis === "stable") return 3;
  if (thesis === "weakening") return 2;
  if (thesis === "broken") return 1;
  return 0;
}

function parseRaw(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

function confidenceFromRow(row) {
  const col = row.confidence_score;
  if (col != null && Number.isFinite(Number(col))) {
    return Math.max(0, Math.min(100, Number(col)));
  }
  const obj = parseRaw(row.raw_ai_output);
  const snap = obj?.snapshot;
  if (snap && typeof snap.confidence_score === "number" && Number.isFinite(snap.confidence_score)) {
    return Math.max(0, Math.min(100, snap.confidence_score));
  }
  if (snap && typeof snap.confidence_score === "string") {
    const n = parseFloat(snap.confidence_score);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  if (obj && typeof obj.conviction_score === "number" && Number.isFinite(obj.conviction_score)) {
    return Math.max(0, Math.min(100, obj.conviction_score));
  }
  return 0;
}

function rankScoreFromRow(row) {
  return thesisTierFromRow(row) * 1000 + confidenceFromRow(row);
}

const TRAJECTORY_WINDOW = 5;
const TRAJECTORY_BONUS_MAX = 900;
const TRAJECTORY_PENALTY_MAX = 500;

function dedupeSnapshotsPerQuarter(rows) {
  const map = new Map();
  for (const row of rows) {
    const k = `${row.stock_id}\t${row.quarter || ""}`;
    const prev = map.get(k);
    if (!prev) map.set(k, row);
    else {
      const tnew = row.created_at ? new Date(row.created_at).getTime() : 0;
      const tp = prev.created_at ? new Date(prev.created_at).getTime() : 0;
      if (tnew > tp) map.set(k, row);
    }
  }
  return Array.from(map.values());
}

function sortSnapshotsByQuarterDesc(rows) {
  return [...rows].sort((a, b) => {
    const cmp = compareQuarterDesc(a.quarter, b.quarter);
    if (cmp !== 0) return cmp;
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
}

function trajectoryBonusFromRows(rows) {
  const desc = sortSnapshotsByQuarterDesc(rows);
  if (desc.length < 2) return 0;
  const chrono = desc.slice(0, TRAJECTORY_WINDOW).reverse();
  const tiers = chrono.map(thesisTierFromRow);
  let raw = 0;
  for (let i = 0; i < tiers.length - 1; i++) {
    const d = tiers[i + 1] - tiers[i];
    if (d > 0) raw += 160 * d;
    else if (d < 0) raw -= 200 * Math.abs(d);
    else if (tiers[i + 1] >= 3) raw += 35;
  }
  let nonDec = true;
  for (let i = 0; i < tiers.length - 1; i++) {
    if (tiers[i + 1] < tiers[i]) nonDec = false;
  }
  if (nonDec) {
    if (tiers.length >= 4) raw += 220;
    else if (tiers.length >= 3) raw += 140;
  }
  return Math.max(-TRAJECTORY_PENALTY_MAX, Math.min(TRAJECTORY_BONUS_MAX, raw));
}

function buildPortfolioListRows(dbRows) {
  const canonical = dedupeSnapshotsPerQuarter(dbRows);
  const byStock = new Map();
  for (const r of canonical) {
    if (!byStock.has(r.stock_id)) byStock.set(r.stock_id, []);
    byStock.get(r.stock_id).push(r);
  }
  const out = [];
  for (const [stockId, rows] of byStock) {
    const desc = sortSnapshotsByQuarterDesc(rows);
    const latest = desc[0];
    if (!latest) continue;
    const latestScore = rankScoreFromRow(latest);
    const trajectoryBonus = trajectoryBonusFromRows(rows);
    const consolidated = latestScore + trajectoryBonus;
    out.push({
      stock_id: stockId,
      ticker: latest.ticker || "",
      score: consolidated,
      consolidated,
      trajectoryBonus,
      latestScore,
    });
  }
  return assignRanks(out);
}

/** Competition ranking: 1,2,2,4 for descending scores. */
function assignRanks(rows) {
  const sorted = [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.ticker).localeCompare(String(b.ticker));
  });
  let prevRank = 0;
  let prevScore = null;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (prevScore === null || r.score !== prevScore) {
      prevRank = i + 1;
      prevScore = r.score;
    }
    r.rank = prevRank;
  }
  return sorted;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const apply = args.includes("--apply");

  if (!DATABASE_URL) {
    console.error("DATABASE_URL is not set. Use .env.local at repo root (same as db:migrate).");
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const { rows: dbRows } = await client.query(`
      SELECT
        qs.id,
        qs.stock_id,
        qs.quarter,
        qs.confidence_score,
        qs.thesis_status,
        qs.raw_ai_output,
        qs.created_at,
        s.ticker,
        s.company_name
      FROM quarterly_snapshots qs
      INNER JOIN stocks s ON s.id = qs.stock_id
      ORDER BY qs.quarter ASC, qs.stock_id ASC, qs.created_at DESC
    `);

    /** @type {Map<string, Map<string, typeof dbRows[0]>>} quarter -> stock_id -> latest row */
    const byQuarter = new Map();
    for (const row of dbRows) {
      const q = row.quarter || "";
      if (!byQuarter.has(q)) byQuarter.set(q, new Map());
      const stockMap = byQuarter.get(q);
      if (!stockMap.has(row.stock_id)) stockMap.set(row.stock_id, row);
    }

    const byQuarterRanked = {};
    const cohortSizes = {};

    for (const [quarter, stockMap] of byQuarter) {
      const entries = [];
      for (const row of stockMap.values()) {
        const score = rankScoreFromRow(row);
        entries.push({
          snapshot_id: row.id,
          stock_id: row.stock_id,
          ticker: row.ticker,
          company_name: row.company_name,
          score,
        });
      }
      const ranked = assignRanks(entries);
      cohortSizes[quarter] = ranked.length;
      byQuarterRanked[quarter] = ranked.map((r) => ({
        rank: r.rank,
        cohort_size: ranked.length,
        score: r.score,
        ticker: r.ticker,
        company_name: r.company_name,
        snapshot_id: r.snapshot_id,
      }));
    }

    const quartersChrono = Object.keys(byQuarterRanked).sort(compareQuarterAsc);

    /** @type {Record<string, Array<{ quarter: string; rank: number; cohort_size: number; score: number; delta_rank: number | null }>>} */
    const byTicker = {};
    for (const q of quartersChrono) {
      for (const row of byQuarterRanked[q]) {
        if (!byTicker[row.ticker]) byTicker[row.ticker] = [];
        byTicker[row.ticker].push({
          quarter: q,
          rank: row.rank,
          cohort_size: row.cohort_size,
          score: row.score,
          delta_rank: null,
        });
      }
    }
    for (const ticker of Object.keys(byTicker)) {
      const series = byTicker[ticker].sort((a, b) => compareQuarterAsc(a.quarter, b.quarter));
      for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1];
        const cur = series[i];
        cur.delta_rank = cur.rank - prev.rank;
      }
      byTicker[ticker] = series;
    }

    const improving = [];
    for (const [ticker, series] of Object.entries(byTicker)) {
      for (const row of series) {
        if (row.delta_rank != null && row.delta_rank < 0) {
          improving.push({
            ticker,
            quarter: row.quarter,
            rank: row.rank,
            cohort_size: row.cohort_size,
            delta_rank_vs_previous_quarter: row.delta_rank,
            score: row.score,
          });
        }
      }
    }

    const portfolioListRanked = buildPortfolioListRows(dbRows);
    const listCohort = portfolioListRanked.length;
    const portfolio_list = portfolioListRanked.map((r) => ({
      rank: r.rank,
      cohort_size: listCohort,
      ticker: r.ticker,
      stock_id: r.stock_id,
      consolidated_score: r.consolidated,
      trajectory_bonus: r.trajectoryBonus,
      latest_quarter_sort_score: r.latestScore,
    }));

    const report = {
      generated_at: new Date().toISOString(),
      quarters: quartersChrono,
      cohort_sizes: cohortSizes,
      by_quarter: byQuarterRanked,
      by_ticker_time_series: byTicker,
      improving_rank_vs_previous_imported_quarter: improving.sort((a, b) =>
        compareQuarterDesc(a.quarter, b.quarter),
      ),
      portfolio_list,
      notes: [
        "Rank is within each quarter label only (stocks without a row for that quarter are not in the cohort).",
        "delta_rank_vs_previous_quarter: negative means rank number went down (e.g. 5 -> 2 = better).",
        "portfolio_list: cross-stock rank by consolidated score (latest quarter + trajectory). --apply writes stocks.portfolio_* and snapshot portfolio_rank.",
      ],
    };

    const json = JSON.stringify(report, null, 2);
    if (outPath) {
      const abs = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
      fs.writeFileSync(abs, json, "utf8");
      console.log(`Wrote ${abs}`);
    } else {
      console.log(json);
    }

    if (apply) {
      let updatedSnaps = 0;
      await client.query("BEGIN");
      try {
        await client.query(`
          UPDATE stocks SET
            portfolio_consolidated_score = NULL,
            portfolio_trajectory_bonus = NULL,
            portfolio_latest_quarter_sort_score = NULL,
            portfolio_list_rank = NULL,
            portfolio_list_cohort_size = NULL,
            portfolio_scores_updated_at = NULL
        `);

        for (const q of quartersChrono) {
          const list = byQuarterRanked[q];
          const n = list.length;
          for (const item of list) {
            await client.query(
              `UPDATE quarterly_snapshots
               SET portfolio_rank = $1,
                   portfolio_cohort_size = $2,
                   portfolio_rank_score = $3
               WHERE id = $4`,
              [item.rank, n, item.score, item.snapshot_id],
            );
            updatedSnaps++;
          }
        }

        const cohort = portfolioListRanked.length;
        let updatedStocks = 0;
        for (const r of portfolioListRanked) {
          await client.query(
            `UPDATE stocks SET
               portfolio_consolidated_score = $1,
               portfolio_trajectory_bonus = $2,
               portfolio_latest_quarter_sort_score = $3,
               portfolio_list_rank = $4,
               portfolio_list_cohort_size = $5,
               portfolio_scores_updated_at = now()
             WHERE id = $6`,
            [r.consolidated, r.trajectoryBonus, r.latestScore, r.rank, cohort, r.stock_id],
          );
          updatedStocks++;
        }

        await client.query("COMMIT");
        console.error(
          `Applied ranks: ${updatedSnaps} quarterly_snapshots row(s), ${updatedStocks} stocks (portfolio list cohort=${cohort}).`,
        );
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
