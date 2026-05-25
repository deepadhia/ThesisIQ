import { sortSnapshotsByQuarterDesc } from "@/lib/quarterSort";

const THESIS_TIER: Record<string, number> = {
  strengthening: 4,
  stable: 3,
  weakening: 2,
  broken: 1,
};

export type SnapshotRowLike = {
  stock_id?: string | null;
  quarter?: string | null;
  thesis_status?: string | null;
  confidence_score?: number | null;
  portfolio_rank?: number | null;
  portfolio_cohort_size?: number | null;
  raw_ai_output?: unknown;
};

function parseRawJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      if (typeof p === "object" && p !== null && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/** Normalized lowercase: strengthening | stable | weakening | broken | null */
export function thesisStatusFromSnapshot(snap: SnapshotRowLike): string | null {
  const direct = snap.thesis_status;
  if (typeof direct === "string" && direct.trim()) return direct.trim().toLowerCase();
  const raw = parseRawJson(snap.raw_ai_output);
  const block = raw?.snapshot as Record<string, unknown> | undefined;
  const t = block?.thesis_status;
  return typeof t === "string" && t.trim() ? t.trim().toLowerCase() : null;
}

function thesisTier(snap: SnapshotRowLike): number {
  const th = thesisStatusFromSnapshot(snap);
  if (!th) return 0;
  return THESIS_TIER[th] ?? 0;
}

export function confidenceFromSnapshot(snap: SnapshotRowLike): number {
  if (snap.confidence_score != null && Number.isFinite(Number(snap.confidence_score))) {
    return Math.max(0, Math.min(100, Number(snap.confidence_score)));
  }
  const raw = parseRawJson(snap.raw_ai_output);
  const block = raw?.snapshot as Record<string, unknown> | undefined;
  const c = block?.confidence_score;
  if (typeof c === "number" && Number.isFinite(c)) return Math.max(0, Math.min(100, c));
  if (typeof c === "string") {
    const n = parseFloat(c);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  return 0;
}

/**
 * Higher = better ordering. Thesis tier dominates (strengthening > … > broken), then confidence 0–100.
 * Keep in sync with `backend/scripts/compute-quarterly-ranks.js` rankScoreFromRow.
 */
export function snapshotThesisSortScore(snap: SnapshotRowLike): number {
  return thesisTier(snap) * 1000 + confidenceFromSnapshot(snap);
}

const TRAJECTORY_WINDOW = 5;
const TRAJECTORY_BONUS_MAX = 900;
const TRAJECTORY_PENALTY_MAX = 500;

/**
 * Bonus for thesis trajectory over the last few fiscal quarters (oldest → newest).
 * Rewards non-decreasing tiers and net upgrades; penalizes downgrades.
 */
export function trajectoryBonusFromSnapshots(snapshots: SnapshotRowLike[] | null | undefined): number {
  const desc = sortSnapshotsByQuarterDesc(snapshots || []);
  if (desc.length < 2) return 0;
  const chrono = desc.slice(0, TRAJECTORY_WINDOW).reverse();
  const tiers = chrono.map(thesisTier);
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

/** Listing sort: latest quarter thesis+confidence plus multi-quarter improvement runway. */
export function consolidatedPortfolioSortScore(snapshots: SnapshotRowLike[] | null | undefined): number {
  const desc = sortSnapshotsByQuarterDesc(snapshots || []);
  const latest = desc[0];
  if (!latest) return -1;
  return snapshotThesisSortScore(latest) + trajectoryBonusFromSnapshots(snapshots);
}

export type ActionableVerdictLite = {
  decision: string | null;
  convictionLevel: string | null;
  positionSize: string | null;
};

export function actionableVerdictFromSnapshot(snap: SnapshotRowLike): ActionableVerdictLite {
  const raw = parseRawJson(snap.raw_ai_output);

  // New V7 schema: decision block takes precedence.
  const decisionBlock = raw?.decision;
  if (decisionBlock && typeof decisionBlock === "object" && !Array.isArray(decisionBlock)) {
    const d = decisionBlock as Record<string, unknown>;
    const finalAction = typeof d.final_action === "string" ? d.final_action.trim() || null : null;
    const positionSize = typeof d.position_size === "string" ? d.position_size.trim() || null : null;
    const confidence = typeof d.decision_confidence === "string" ? d.decision_confidence.trim() || null : null;
    if (finalAction) {
      return { decision: finalAction, convictionLevel: confidence, positionSize };
    }
  }

  // Fallback: old V5/V6 actionable_verdict block.
  const v = raw?.actionable_verdict;
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { decision: null, convictionLevel: null, positionSize: null };
  }
  const o = v as Record<string, unknown>;
  const decision = typeof o.decision === "string" ? o.decision.trim() || null : null;
  const convictionLevel =
    typeof o.conviction_level === "string" ? o.conviction_level.trim() || null : null;
  return { decision, convictionLevel, positionSize: null };
}

export type LatestSnapshotQuarterContext = {
  quarter: string;
  thesisStatus: string | null;
  /** Latest quarter only (thesis tier × 1000 + confidence). */
  sortScore: number;
  /** Multi-quarter thesis trajectory bonus (improving / holding vs downgrades). */
  trajectoryBonus: number;
  /** sortScore + trajectoryBonus — use for portfolio list ordering. */
  consolidatedSortScore: number;
  portfolioRank: { rank: number; cohortSize: number } | null;
  verdict: ActionableVerdictLite;
};

/** Newest fiscal quarter row: thesis, sort key, and optional DB portfolio rank (#1 = best in cohort). */
export function latestSnapshotQuarterContext(
  snapshots: SnapshotRowLike[] | null | undefined,
): LatestSnapshotQuarterContext | null {
  const sorted = sortSnapshotsByQuarterDesc(snapshots || []);
  const latest = sorted[0];
  if (!latest) return null;
  const quarter = String(latest.quarter ?? "");
  const thesisStatus = thesisStatusFromSnapshot(latest);
  const sortScore = snapshotThesisSortScore(latest);
  const trajectoryBonus = trajectoryBonusFromSnapshots(snapshots);
  const consolidatedSortScore = sortScore + trajectoryBonus;
  const r = latest.portfolio_rank;
  const n = latest.portfolio_cohort_size;
  const portfolioRank = r != null && n != null ? { rank: r, cohortSize: n } : null;
  const verdict = actionableVerdictFromSnapshot(latest);
  return {
    quarter,
    thesisStatus,
    sortScore,
    trajectoryBonus,
    consolidatedSortScore,
    portfolioRank,
    verdict,
  };
}

export type LatestPortfolioRank = {
  quarter: string;
  rank: number;
  cohortSize: number;
  thesisStatus: string | null;
} | null;

/** DB rank fields only (null if ranks not applied yet). */
export function latestSnapshotPortfolioRank(snapshots: SnapshotRowLike[] | null | undefined): LatestPortfolioRank {
  const ctx = latestSnapshotQuarterContext(snapshots);
  if (!ctx?.portfolioRank) return null;
  return {
    quarter: ctx.quarter,
    rank: ctx.portfolioRank.rank,
    cohortSize: ctx.portfolioRank.cohortSize,
    thesisStatus: ctx.thesisStatus,
  };
}
