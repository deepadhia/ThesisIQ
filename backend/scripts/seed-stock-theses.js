/**
 * Seed / top-up stock investment theses from the driver-level thesis contracts.
 *
 *   node --env-file=.env.local backend/scripts/seed-stock-theses.js            # dry run (default): prints what would change
 *   node --env-file=.env.local backend/scripts/seed-stock-theses.js --apply    # writes (after saving a JSON backup)
 *   node --env-file=.env.local backend/scripts/seed-stock-theses.js --ticker CCL --apply
 *
 * Rules (never destructive):
 *  - a substantive primary_thesis (>= 120 chars) is kept verbatim; a placeholder ("Auto premiumisation") is expanded
 *    around the original wording using the contract's drivers
 *  - key_catalysts / risk_factors / conviction_drivers are only filled when empty
 *  - key_thesis_metrics is only filled when empty
 *  - plain-text theses are converted to the JSON shape with the original text preserved as primary_thesis
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getThesisContract } from "../services/thesis-driver-context.service.js";
import { getThesisHurdleDescription } from "../services/thesis-gate-evaluator.service.js";

const THIN_PRIMARY_CHARS = 120;

const clip = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n - 1).trim()}…` : String(s || ""));
// "Cancellation of..." -> "cancellation of..." but never "EBITDA" -> "eBITDA" / "US/EU" -> "uS/EU"
const lowerFirstWord = (text) => String(text).replace(/^([A-Z])([a-z])/, (_, a, b) => `${a.toLowerCase()}${b}`);
const HIGH_FIRST = (a, b) => (b.materiality === "HIGH") - (a.materiality === "HIGH");

function parseExisting(raw) {
  const text = (raw || "").trim();
  if (!text) return { obj: {}, wasJson: false };
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === "object") return { obj, wasJson: true };
    } catch (_) { /* fall through to plain text */ }
  }
  return { obj: { primary_thesis: text }, wasJson: false };
}

/**
 * Pure builder (unit-tested). Returns the enriched thesis JSON string, key_thesis_metrics suggestion and a change summary.
 */
export function buildEnrichedThesis({ existingRaw, existingKeyMetrics = "", contract, hurdleDescription = null, now = new Date() }) {
  const { obj: existing, wasJson } = parseExisting(existingRaw);
  if (!contract || !Array.isArray(contract.drivers) || contract.drivers.length === 0) {
    return { changed: false, reason: "no driver contract", thesisJson: existingRaw, keyMetrics: existingKeyMetrics, filled: [] };
  }

  const drivers = [...contract.drivers].sort(HIGH_FIRST);
  const next = { ...existing };
  const filled = [];

  const primaryExisting = String(existing.primary_thesis || "").trim();
  if (primaryExisting.length < THIN_PRIMARY_CHARS) {
    const mustBe = drivers.filter(d => d.materiality === "HIGH").slice(0, 3).map(d => d.mustBeTrue).join(" ");
    const lead = primaryExisting ? `${primaryExisting.replace(/[.\s]+$/, "")} — ` : "";
    let composed = `${lead}${contract.thesisTitle}. Thesis holds as long as: ${mustBe}`;
    if (contract.provisional) composed += " [Provisional — derived from repo data; analyst review pending.]";
    next.primary_thesis = clip(composed, 900);
    filled.push("primary_thesis");
  }

  if (!Array.isArray(existing.key_catalysts) || existing.key_catalysts.length === 0) {
    next.key_catalysts = drivers
      .filter(d => d.direction !== "DETERIORATING")
      .map(d => clip(`${d.name}: ${d.mustBeTrue}`, 230));
    if (next.key_catalysts.length) filled.push("key_catalysts");
  }

  if (!Array.isArray(existing.risk_factors) || existing.risk_factors.length === 0) {
    next.risk_factors = drivers.map(d =>
      clip(`${d.direction === "DETERIORATING" ? "Deteriorating — " : ""}${d.name}: falsified if ${lowerFirstWord(d.falsificationTrigger || "n/a")}`, 260)
    );
    filled.push("risk_factors");
  }

  if (!Array.isArray(existing.conviction_drivers) || existing.conviction_drivers.length === 0) {
    next.conviction_drivers = drivers.map(d => `${d.name} (${d.materiality || "MEDIUM"})`);
    filled.push("conviction_drivers");
  }

  if (filled.length > 0) {
    if (!next.thesis_title) next.thesis_title = contract.thesisTitle;
    next.enrichment = {
      source: contract.provisional ? "supplementary-thesis-contracts" : "driver-level-thesis-contracts",
      provisional: Boolean(contract.provisional),
      enriched_at: now.toISOString(),
      filled
    };
  }

  let keyMetrics = existingKeyMetrics || "";
  if (!String(keyMetrics).trim()) {
    keyMetrics = `${drivers.map(d => d.name).join("; ")}${hurdleDescription ? ` | Hurdles — ${hurdleDescription}` : ""}`;
    filled.push("key_thesis_metrics");
  }

  const changed = filled.length > 0 || !wasJson;
  return { changed, thesisJson: JSON.stringify(next), keyMetrics, filled, convertedFromPlainText: !wasJson };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const tickerIdx = args.indexOf("--ticker");
  const onlyTicker = tickerIdx !== -1 ? String(args[tickerIdx + 1] || "").toUpperCase() : null;

  const { pool } = await import("../db/pool.js");
  const { rows } = await pool.query(
    "SELECT id, ticker, investment_thesis, key_thesis_metrics FROM stocks ORDER BY ticker"
  );

  const plan = [];
  for (const row of rows) {
    if (onlyTicker && row.ticker.toUpperCase() !== onlyTicker) continue;
    const result = buildEnrichedThesis({
      existingRaw: row.investment_thesis,
      existingKeyMetrics: row.key_thesis_metrics,
      contract: getThesisContract(row.ticker),
      hurdleDescription: getThesisHurdleDescription(row.ticker)
    });
    plan.push({ row, result });
  }

  console.log(`\n${apply ? "APPLY" : "DRY RUN"} — ${plan.length} stock(s)\n`);
  for (const { row, result } of plan) {
    const status = result.changed ? `fills: ${result.filled.join(", ") || "(format only)"}${result.convertedFromPlainText ? " + plain-text→JSON" : ""}` : `unchanged (${result.reason || "already complete"})`;
    console.log(`${row.ticker.padEnd(11)} ${status}`);
  }

  if (apply) {
    const changedRows = plan.filter(p => p.result.changed);
    if (changedRows.length > 0) {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const backupDir = path.resolve(here, "../../scratch");
      fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `thesis-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(backupPath, JSON.stringify(changedRows.map(p => ({ ticker: p.row.ticker, investment_thesis: p.row.investment_thesis, key_thesis_metrics: p.row.key_thesis_metrics })), null, 2));
      console.log(`\nBackup of previous values written to ${backupPath}`);

      for (const { row, result } of changedRows) {
        await pool.query(
          "UPDATE stocks SET investment_thesis = $1, key_thesis_metrics = $2 WHERE id = $3",
          [result.thesisJson, result.keyMetrics, row.id]
        );
      }
      console.log(`Updated ${changedRows.length} stock thesis row(s).`);
    } else {
      console.log("\nNothing to update.");
    }
  } else {
    console.log("\n(dry run — pass --apply to write)");
  }
  await pool.end?.();
}

import { fileURLToPath as _f } from "url";
if (process.argv[1] && _f(import.meta.url) === process.argv[1]) {
  main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
