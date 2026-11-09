/**
 * Offline, no DB/AI/network: score a reader's per-page text against visually reviewed financial cells.
 * node backend/scripts/benchmark-parser-candidate.js --dir <corpus-dir> --reader pdfplumber [--out <report.json>]
 * Input files: <case-id>-<reader>.json, arrays of {num,text}. Missing files/figures reduce coverage; wrong cells fail the run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDeterministicFinancials, detectDocumentUnit } from '../services/financial-validator.service.js';
import { capDocumentText } from '../services/statement-pages.service.js';
import { scoreParserCandidate } from '../services/parser-benchmark.service.js';

function main() {
  const args = process.argv.slice(2);
  const arg = flag => { const i = args.indexOf(flag); return i < 0 ? null : args[i+1]; };
  const dir = arg('--dir'), reader = arg('--reader');
  if (!dir || !reader || !/^[a-zA-Z0-9_-]+$/.test(reader)) throw new Error('Supply --dir <corpus-dir> --reader <name>');
  const manifest = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/parser-benchmark-manifest.json', import.meta.url), 'utf8'));
  const results = manifest.cases.map(item => {
    const file = path.join(dir, `${item.id}-${reader}.json`);
    if (!fs.existsSync(file)) return { id: item.id, status: 'ABSTAIN', differences: [], reason: 'Reader output missing' };
    const pages = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(pages) || pages.some(p => !Number.isInteger(p.num) || typeof p.text !== 'string')) throw new Error(`Invalid reader output: ${item.id}`);
    // Use the production capping/validation path, without inventing a reporting date or unit from the expected answer.
    const text = capDocumentText(pages);
    const fin = extractDeterministicFinancials(text, { declaredUnit: detectDocumentUnit(text) });
    return { id: item.id, ...scoreParserCandidate(fin, item.expected), financials: fin };
  });
  const counts = Object.fromEntries(['PASS','FAIL','UNVERIFIED','ABSTAIN'].map(s => [s, results.filter(r => r.status === s).length]));
  const report = { reader, cases: results.length, counts, verifiedCoverage: counts.PASS/results.length, results };
  if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reader, cases: results.length, counts, verifiedCoverage: report.verifiedCoverage }, null, 2));
  if (counts.FAIL) process.exitCode = 1;
  else if (counts.UNVERIFIED || counts.ABSTAIN) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (err) { console.error(err.message); process.exitCode = 1; }
}
