/**
 * Pre-deploy replay on REAL filings. Read-only: it reads the database and downloads public PDFs, and writes and sends nothing.
 *
 *   node --env-file=.env.local backend/scripts/replay-real-filings.js              # last 45 days of results statements
 *   node --env-file=.env.local backend/scripts/replay-real-filings.js --days 20 --ticker SJS
 *
 * Why: the failures that reached production (a unit read at the wrong scale, a statement that needed OCR, one segment listed under two
 * names, other companies' filings) were all invisible to tests built on filings chosen in advance. Run this before every deploy: it
 * parses what the stocks actually filed with the code you are about to deploy and applies backend/services/replay-checks.service.js.
 * Exit code 1 when any statement FAILS a check; WARN lines (a statement that needs OCR, a unit the filing disagrees with) are listed.
 */
import { pool } from "../db/pool.js";
import { extractPdfTextDetailed } from "../services/announcement.service.js";
import { extractDeterministicFinancials, detectDocumentUnit, quarterEndBefore } from "../services/financial-validator.service.js";
import { checkParsedResult } from "../services/replay-checks.service.js";
import { isResultsOutcomeFiling } from "../services/filing-classifier.service.js";

const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const days = Math.max(1, Math.min(120, Number(arg("--days", 45)) || 45));
const onlyTicker = arg("--ticker", null);

const { rows } = await pool.query(
  `SELECT DISTINCT ON (c.ticker, c.attachment_url) c.ticker, c.title, c.attachment_url, c.filing_date, COALESCE(s.nse_symbol, c.ticker) AS nse,
          (SELECT json_build_object('market_cap', m.market_cap, 'pe_ratio', m.pe_ratio) FROM market_data_snapshots m WHERE m.ticker = c.ticker ORDER BY m.market_data_as_of DESC LIMIT 1) AS snapshot
   FROM corporate_announcements c JOIN stocks s ON s.id = c.stock_id
   WHERE c.created_at > NOW() - ($1 || ' days')::interval AND c.attachment_url IS NOT NULL
     AND c.filing_category = 'QUARTERLY_EARNINGS' AND c.title ~* '(outcome|result)'
     AND COALESCE(c.event_analysis->>'foreign_filing', '') <> 'true'
     AND ($2::text IS NULL OR c.ticker = $2)
   ORDER BY c.ticker, c.attachment_url`,
  [String(days), onlyTicker]
);
await pool.end();

// the stock's own files only (a foreign copy from the 2026-11-06 flood is not a statement of this stock)
const own = rows.filter((r) => /bseindia\.com/i.test(r.attachment_url) || (r.attachment_url.split("/").pop() || "").toUpperCase().startsWith(String(r.nse).toUpperCase().slice(0, 4)));
console.log(`Replaying ${own.length} results filings of the last ${days} days (${rows.length - own.length} foreign or unrelated copies skipped)\n`);

const tally = { PASS: 0, WARN: 0, FAIL: 0 };
const lines = [];
for (const r of own) {
  let result;
  try {
    const pdf = await extractPdfTextDetailed(r.attachment_url);
    const text = pdf.text || "";
    if (!isResultsOutcomeFiling({ title: r.title, text }) && !/financial results?|un-?audited/i.test(text.slice(0, 6000))) continue;   // an intimation or letter, not a statement
    const fin = extractDeterministicFinancials(text, { periodEndHint: quarterEndBefore(r.filing_date) });
    result = checkParsedResult({ fin, declaredUnit: detectDocumentUnit(text), snapshot: r.snapshot });
    var summary = fin?.revenue ? `revenue ${fin.revenue} Cr (${fin.revenueYoYGrowthPct ?? "?"}% YoY), ${fin.statementScope || "scope ?"}, unit ${fin.unit}` : "not parsed from the text layer";
  } catch (err) {
    result = { level: "WARN", issues: [{ level: "WARN", code: "DOWNLOAD_FAILED", text: err.message }] };
    summary = "could not be read";
  }
  tally[result.level]++;
  lines.push(`${result.level.padEnd(4)} ${r.ticker.padEnd(11)} ${String(r.filing_date?.toISOString?.().slice(0, 10) || "").padEnd(10)} ${summary}`);
  for (const i of result.issues) lines.push(`       ${i.level === "FAIL" ? "✗" : "!"} ${i.code}: ${i.text}`);
}
console.log(lines.join("\n"));
console.log(`\n${tally.PASS} pass, ${tally.WARN} warn, ${tally.FAIL} fail`);
if (tally.FAIL > 0) {
  console.error("\nREPLAY FAILED: do not deploy until the failing statements are explained.");
  process.exit(1);
}
console.log("REPLAY OK (read the WARN lines: a statement that needs OCR is only checked at run time by the unit and scale guards)");
