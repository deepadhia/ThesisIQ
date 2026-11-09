/** Source-verified repair of a prematurely achieved ownership commitment. Dry-run by default. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import { extractPdfTextDetailed } from '../services/announcement.service.js';

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const OWNERSHIP = /\b(acquisition|acquire|stake|equity|merger|amalgamation|investment)\b/i;
const PROVISIONAL = /\b(propos(?:ed|al)|subject\s+to|remains?\s+subject|pending\s+(?:approval|completion)|board\s+approv(?:ed|al))\b/i;
const FINAL = /\b(acquisition|transaction|stake|investment)\b.{0,100}\b(completed|closed|consummated|finalised|finalized)\b|\b(completed|closed|consummated|finalised|finalized)\b.{0,100}\b(acquisition|transaction|stake|investment)\b/i;

function anchors(value) {
  const text = String(value || '').replace(/,/g, '').toLowerCase();
  return [...new Set([...text.matchAll(/\b\d+(?:\.\d+)?\s*(?:%|mw|gw)\b/g)].map(m => m[0].replace(/\s+/g, '')))];
}

/** Conservative predicate: two independent source dates must show the same still-provisional transaction. */
export function isProvisionalOwnershipCommitment(commitment, firstText, latestText) {
  const statement = String(commitment?.statement || '');
  if (!/^achieved\b/i.test(String(commitment?.status || '')) || !OWNERSHIP.test(statement) || !PROVISIONAL.test(statement)) return false;
  const expected = anchors(`${statement} ${commitment?.target_value || ''}`);
  if (!expected.length) return false;
  const first = String(firstText || '').replace(/,/g, '').toLowerCase();
  const latest = String(latestText || '').replace(/,/g, '').toLowerCase();
  if (![first, latest].every(t => OWNERSHIP.test(t) && PROVISIONAL.test(t) && expected.every(a => t.replace(/\s+/g, '').includes(a)))) return false;
  return !FINAL.test(latest);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? '' : process.argv[index + 1];
  if (!UUID.test(value || '')) throw new Error(`${name} requires a UUID`);
  return value;
}

function sourceDate(row) {
  const value = row.filing_date || row.created_at;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Source date is missing');
  return date;
}

async function sourceText(row) {
  if (!/^https:\/\//i.test(String(row.attachment_url || ''))) throw new Error(`Source ${row.id} has no HTTPS attachment`);
  const extracted = await extractPdfTextDetailed(row.attachment_url, { allowOcr: false });
  if (extracted.reason || String(extracted.text || '').length < 300) throw new Error(`Source ${row.id} is not natively readable: ${extracted.reason || 'too short'}`);
  return extracted.text;
}

async function main() {
  const id = argument('--commitment-id');
  const firstId = argument('--source-id');
  const latestId = argument('--confirm-id');
  const apply = process.argv.includes('--apply');
  const { rows: commitments } = await pool.query('SELECT * FROM management_commitments WHERE id=$1', [id]);
  const { rows: sources } = await pool.query('SELECT * FROM corporate_announcements WHERE id=ANY($1::uuid[])', [[firstId, latestId]]);
  if (commitments.length !== 1 || sources.length !== 2) throw new Error('Commitment or source missing');
  const commitment = commitments[0];
  const first = sources.find(row => row.id === firstId);
  const latest = sources.find(row => row.id === latestId);
  if (!first || !latest || first.stock_id !== commitment.stock_id || latest.stock_id !== commitment.stock_id || first.ticker !== latest.ticker || first.ticker !== commitment.ticker) throw new Error('Sources do not match commitment stock and ticker');
  if (sources.some(row => row.event_analysis?.foreign_filing === true || row.event_analysis?.foreign_filing === 'true')) throw new Error('Foreign filing cannot verify a commitment');
  if (sourceDate(first) >= sourceDate(latest)) throw new Error('Source dates are not ordered');
  const [firstText, latestText] = await Promise.all([sourceText(first), sourceText(latest)]);
  if (!isProvisionalOwnershipCommitment(commitment, firstText, latestText)) throw new Error('Provisional ownership evidence did not match; no repair');
  const later = await pool.query(`SELECT id,title,filing_date FROM corporate_announcements WHERE stock_id=$1 AND filing_date>$2 AND event_analysis->'foreign_filing' IS DISTINCT FROM 'true'::jsonb AND (title ~* '(acqui|stake|investment|merger|amalgamat|complet|closing)') ORDER BY filing_date`, [commitment.stock_id, latest.filing_date]);
  if (later.rows.length) throw new Error(`Later potentially relevant filing needs manual source review: ${later.rows.map(row => row.id).join(', ')}`);
  const evidence = `Proposed ownership transaction remains subject to approvals or conditions as of ${sourceDate(latest).toISOString().slice(0, 10)}; verified against source announcements ${first.id} and ${latest.id}.`;
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scratch');
  const base = `provisional-commitment-${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const report = { id, stockId: commitment.stock_id, ticker: commitment.ticker, sourceIds: [firstId, latestId], beforeStatus: commitment.status, afterStatus: 'Pending', evidence, apply };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) { console.log('[DRY RUN] No database or filesystem writes.'); return; }
  fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, `${base}-backup.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ commitment, sources }, null, 2), { flag: 'wx' });
  console.log(`[APPLY] Immutable backup: ${backupPath}`);
  const changed = await pool.query(`UPDATE management_commitments SET status='Pending', credibility_impact='neutral', evidence_summary=$1 WHERE id=$2 AND status=$3 AND statement=$4 RETURNING *`, [evidence, id, commitment.status, commitment.statement]);
  if (changed.rows.length !== 1) throw new Error('Commitment changed concurrently; backup saved, no repair applied');
  const afterPath = path.join(dir, `${base}-after.json`);
  fs.writeFileSync(afterPath, JSON.stringify({ backupPath, after: changed.rows[0] }, null, 2), { flag: 'wx' });
  console.log(`[APPLY] Verified row: ${afterPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
