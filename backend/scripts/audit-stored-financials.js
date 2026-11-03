/**
 * READ-ONLY audit of the verified financials stored on already-processed results filings.
 *
 * Why: parser bugs wrote wrong numbers into corporate_announcements.event_analysis.institutional_verdict.verified_financials
 * (TRANSRAILL Q2 FY27 stored PAT 14.74 instead of 103.94 and the period 2025-09-30), and those rows are CARRIED FORWARD into every
 * later concall / deck digest. This script re-reads each stored results document with the CURRENT parser and reports which rows
 * differ, in which field, and how. It never writes anything (AGENTS.md rule 1): to repair, deploy the fixed code and run
 *
 *   node --env-file=.env.local backend/scripts/requeue-stuck-filings.js --ids <id,id,...>            # dry run
 *   node --env-file=.env.local backend/scripts/requeue-stuck-filings.js --ids <id,id,...> --apply    # after you approve
 *
 * which re-queues those rows so the worker recomputes and re-sends them corrected (it backs the old values up first).
 *
 *   node --env-file=.env.local backend/scripts/audit-stored-financials.js [--since 2026-09-01] [--ticker TRANSRAILL] [--limit 60]
 */
import { pathToFileURL } from "url";
import { pool } from "../db/pool.js";
import { extractTextFromPdfUrl } from "../services/announcement.service.js";
import { extractDeterministicFinancials } from "../services/financial-validator.service.js";

const relDiff = (a, b) => (a === null || a === undefined || b === null || b === undefined || b === 0 ? null : Math.abs(a - b) / Math.abs(b));

/**
 * Compares the stored figures of a filing with a fresh parse. Returns a list of { field, stored, fresh, kind } where kind is
 *   WRONG        the stored figure is not the one the statement prints (revenue / PAT / period)
 *   MISSING_NOW  the stored figure is present but the current parser withholds it (failed the sanity guard)
 *   NEWLY_READ   the current parser reads a figure the stored row lacks (e.g. PAT, EBITDA)
 *   DEFINITION   EBITDA changed because it now excludes other income (informational: stored margins are on the old basis)
 *   UNVERIFIABLE the stored row is consolidated but the plain text layer only yields standalone (scanned PDF read by OCR): not comparable
 * Pure, so it is unit-tested.
 */
export function diffFinancials(stored, fresh) {
  const out = [];
  if (!stored || !fresh) return out;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // The stored row may have been read by vision OCR from a scanned PDF (consolidated), while this audit only sees the PDF's text
  // layer (standalone). Different scopes are not comparable: say so instead of calling either one wrong.
  if (stored.statementScope === "CONSOLIDATED" && fresh.statementScope === "STANDALONE") {
    return [{ field: "scope", stored: "CONSOLIDATED", fresh: "STANDALONE", kind: "UNVERIFIABLE" }];
  }

  if (stored.quarterEnded && fresh.quarterEnded && String(stored.quarterEnded).slice(0, 10) !== String(fresh.quarterEnded).slice(0, 10)) {
    out.push({ field: "quarterEnded", stored: String(stored.quarterEnded).slice(0, 10), fresh: String(fresh.quarterEnded).slice(0, 10), kind: "WRONG" });
  } else if (!stored.quarterEnded && fresh.quarterEnded) {
    out.push({ field: "quarterEnded", stored: null, fresh: String(fresh.quarterEnded).slice(0, 10), kind: "NEWLY_READ" });
  }

  const revDiff = relDiff(num(fresh.revenue), num(stored.revenue));
  if (revDiff !== null && revDiff > 0.005) out.push({ field: "revenue", stored: stored.revenue, fresh: fresh.revenue, kind: "WRONG" });

  const storedPat = num(stored.patAttributable ?? stored.patConsolidated);
  const freshPat = num(fresh.patAttributable ?? fresh.patConsolidated);
  if (storedPat !== null && freshPat === null) out.push({ field: "pat", stored: storedPat, fresh: null, kind: "MISSING_NOW", note: fresh.patRejectedReason || null });
  else if (storedPat === null && freshPat !== null) out.push({ field: "pat", stored: null, fresh: freshPat, kind: "NEWLY_READ" });
  else if (storedPat !== null && freshPat !== null && relDiff(freshPat, storedPat) > 0.02) out.push({ field: "pat", stored: storedPat, fresh: freshPat, kind: "WRONG" });

  const storedE = num(stored.ebitda);
  const freshE = num(fresh.ebitda);
  if (storedE === null && freshE !== null) out.push({ field: "ebitda", stored: null, fresh: freshE, kind: "NEWLY_READ" });
  else if (storedE !== null && freshE !== null && relDiff(freshE, storedE) > 0.02) out.push({ field: "ebitda", stored: storedE, fresh: freshE, kind: "DEFINITION" });
  return out;
}

/** True when the row needs to be re-sent: any figure the user saw was WRONG, withheld now, or the period was wrong. */
export const needsCorrection = (diffs) => diffs.some((d) => d.kind === "WRONG" || d.kind === "MISSING_NOW");

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const since = argValue(args, "--since") || new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const ticker = argValue(args, "--ticker");
  const limit = parseInt(argValue(args, "--limit") || "60", 10);

  const { rows } = await pool.query(
    `SELECT id, ticker, title, attachment_url, filing_date,
            event_analysis->'institutional_verdict'->'verified_financials' AS vf
     FROM corporate_announcements
     WHERE deep_dive_status = 'completed'
       AND event_analysis->'institutional_verdict'->'verified_financials' IS NOT NULL
       AND filing_date >= $1::date
       AND attachment_url IS NOT NULL
       AND ($2::text IS NULL OR ticker = $2)
     ORDER BY ticker, filing_date
     LIMIT $3`,
    [since, ticker || null, limit]
  );
  console.log(`Auditing ${rows.length} stored results row(s) filed since ${since}...\n`);

  const toFix = [];
  for (const r of rows) {
    let fresh = null;
    try {
      const text = await extractTextFromPdfUrl(r.attachment_url);
      fresh = text ? extractDeterministicFinancials(text) : null;
    } catch (err) {
      console.log(`  ?  ${r.ticker.padEnd(11)} ${String(r.filing_date).slice(0, 10)}  could not re-read the document: ${err.message}`);
      continue;
    }
    if (!fresh) { console.log(`  ?  ${r.ticker.padEnd(11)} ${String(r.filing_date).slice(0, 10)}  current parser reads no statement from this document (title: ${r.title.slice(0, 50)})`); continue; }
    const diffs = diffFinancials(r.vf, fresh);
    if (diffs.length === 0) { console.log(`  ok ${r.ticker.padEnd(11)} ${String(r.filing_date).slice(0, 10)}`); continue; }
    const bad = needsCorrection(diffs);
    console.log(`  ${bad ? "!!" : "~~"} ${r.ticker.padEnd(11)} ${String(r.filing_date).slice(0, 10)}  ${r.id}`);
    for (const d of diffs) console.log(`       ${d.kind.padEnd(11)} ${d.field}: stored ${d.stored} -> now ${d.fresh}${d.note ? `  (${d.note})` : ""}`);
    if (bad) toFix.push(r.id);
  }

  console.log(`\n${toFix.length} row(s) hold wrong figures that were alerted or carried forward.`);
  if (toFix.length) {
    console.log("To have the worker recompute and re-send them corrected (review the dry run first; --apply only after you approve):");
    console.log(`  node --env-file=.env.local backend/scripts/requeue-stuck-filings.js --ids ${toFix.join(",")}`);
  }
  console.log("\nLegend: !! wrong figures (re-send)   ~~ informational only (EBITDA now excludes other income; margin basis changed)   ok = identical");
  await pool.end();
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
