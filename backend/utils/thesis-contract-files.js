/**
 * Where the per-stock thesis contract files (driver-level-thesis-contracts.json, supplementary-thesis-contracts.json) live.
 *
 * They are production INPUTS: every results alert, digest and gate reads them. They used to live only in reports/, which is
 * git-ignored, so a `git pull` on the server and a GitHub Actions checkout never received them (the loader returned nothing,
 * silently) and the hand-written supplementary file was not backed up in git at all. They now live in backend/config/
 * thesis-contracts/ (tracked). The old reports/ locations are still read as a fallback for a local checkout.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const THESIS_CONTRACT_DIR = path.resolve(here, "../config/thesis-contracts");

/** Candidate locations in priority order: the tracked directory first, then the legacy git-ignored reports/ copies. */
export function thesisContractCandidates(fileName, { cwd = process.cwd() } = {}) {
  return [
    path.join(THESIS_CONTRACT_DIR, fileName),
    path.resolve(cwd, `reports/thesis_board/${fileName}`),
    path.resolve(cwd, `../reports/thesis_board/${fileName}`),
    path.resolve(here, `../../reports/thesis_board/${fileName}`)
  ];
}

/** First existing candidate, or null. `exists` and `cwd` are injectable for tests. */
export function findThesisContractFile(fileName, { exists = fs.existsSync, cwd = process.cwd() } = {}) {
  return thesisContractCandidates(fileName, { cwd }).find((p) => exists(p)) ?? null;
}
