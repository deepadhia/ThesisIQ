/**
 * Re-processes verified financial results filings through the quarterly deep-dive pipeline
 * with Telegram suppressed, cleanly re-generating quarterly_snapshots and management_commitments.
 *
 * Usage:
 *   node --env-file=.env.local backend/scripts/reprocess-results-snapshots.js --ids <uuid1>,<uuid2>
 *   node --env-file=.env.local backend/scripts/reprocess-results-snapshots.js --ids <uuid1>,<uuid2> --apply
 *   node --env-file=.env.local backend/scripts/reprocess-results-snapshots.js --resume <backup.json> --apply
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db/pool.js";
import { processPendingDeepDives } from "../workers/quarterly-deepdive-worker.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function parseRepairIds(args, manifest = null) {
  const i = args.indexOf('--ids');
  const ids = i >= 0 ? String(args[i + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : manifest?.remainingIds;
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Supply --ids <uuid>,<uuid> or --resume <backup.json> with remainingIds');
  if (ids.some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) throw new Error('Every repair ID must be a UUID');
  return [...new Set(ids)];
}

/** A pre-existing snapshot is not evidence that this run rebuilt it. Check worker success AND the saved source. */
export function rebuiltIdsForRun(targetIds, result, snapshots) {
  const processed = new Set(result.processedIds || []);
  const saved = new Set(snapshots.filter(s => s.raw_ai_output?.verified_financials?.revenue != null)
    .map(s => s.raw_ai_output?.source_filing?.announcement_id).filter(Boolean));
  return targetIds.filter(id => processed.has(id) && saved.has(id));
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const resumeAt = args.indexOf('--resume');
  if (resumeAt >= 0 && args.includes('--ids')) throw new Error('Use either --ids or --resume');
  const manifest = resumeAt >= 0 ? JSON.parse(fs.readFileSync(args[resumeAt + 1], 'utf8')) : null;
  const targetIds = parseRepairIds(args, manifest);

  console.log(`[REPROCESS] Target filings (${targetIds.length}):`);

  const { rows: filings } = await pool.query(
    `SELECT ca.*, s.company_name
     FROM corporate_announcements ca
     JOIN stocks s ON s.id = ca.stock_id
     WHERE ca.id = ANY($1)
     ORDER BY ca.ticker`,
    [targetIds]
  );

  if (filings.length !== targetIds.length) throw new Error('Some requested filing IDs do not exist; no repair started');
  if (filings.some(f => f.event_analysis?.foreign_filing === true || f.event_analysis?.foreign_filing === 'true')) throw new Error('A requested filing is flagged as foreign; no repair started');

  for (const f of filings) {
    console.log(` - ${f.ticker.padEnd(12)} | ${String(f.filing_date).slice(0, 10)} | ${f.title.slice(0, 50)} | ${f.id}`);
  }

  // Backup current quarterly snapshots for these stocks
  const stockIds = [...new Set(filings.map(f => f.stock_id))];
  const { rows: currentSnapshots } = await pool.query(
    "SELECT * FROM quarterly_snapshots WHERE stock_id = ANY($1)",
    [stockIds]
  );

  console.log(`\nExisting snapshots found for these stocks: ${currentSnapshots.length}`);
  for (const sn of currentSnapshots) {
    console.log(`   ${sn.stock_id}: ${sn.final_action} (${sn.conviction_score}/10) | ${String(sn.summary).slice(0, 70)}...`);
  }

  if (!apply) {
    console.log("\n[DRY RUN] Selection only; no OCR/AI requests or writes. --apply uses the production parser, guards and quota pause, one filing at a time.");
    await pool.end();
    return;
  }

  // Write JSON backup
  const backupDir = path.resolve(here, "../../scratch");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `snapshot-rebuild-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const { rows: commitments } = await pool.query('SELECT * FROM management_commitments WHERE stock_id = ANY($1)', [stockIds]);
  const backup = { currentSnapshots, filings, commitments, targetIds, completedIds: [], remainingIds: targetIds, resumedFrom: resumeAt >= 0 ? args[resumeAt + 1] : null };
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\n[APPLY] Backup written to ${backupPath}`);

  // Reprocess deep dives with Telegram suppressed
  const skipOptionalWork = !args.includes('--with-syntheses');
  console.log(`[APPLY] Executing worker on ${filings.length} filings (skipOptionalWork: ${skipOptionalWork}, paced sequentially)...`);

  const completedIds = [];
  const remainingIds = [...targetIds];
  const combinedResults = { processed: 0, failed: 0, processedIds: [] };

  for (let i = 0; i < targetIds.length; i++) {
    const id = targetIds[i];
    const filing = filings.find(f => f.id === id);
    if (i > 0) {
      console.log(`\n[PACE] Waiting 5 seconds before next filing to respect LLM rate limits...`);
      await new Promise(r => setTimeout(r, 5000));
    }
    console.log(`\n[APPLY ${i + 1}/${targetIds.length}] Processing ${filing?.ticker || id} (${id})...`);
    const result = await processPendingDeepDives({
      suppressTelegram: true,
      announcementIds: [id],
      skipOptionalWork,
      batchSize: 1
    });

    combinedResults.processed += result.processed || 0;
    combinedResults.failed += result.failed || 0;
    if (result.processedIds) combinedResults.processedIds.push(...result.processedIds);

    // Verify resulting snapshot for this filing
    const { rows: latestSnapshots } = await pool.query(
      `SELECT qs.*, s.ticker
       FROM quarterly_snapshots qs
       JOIN stocks s ON s.id = qs.stock_id
       WHERE qs.stock_id = ANY($1)
       ORDER BY s.ticker`,
      [stockIds]
    );

    const stepRebuilt = rebuiltIdsForRun([id], result, latestSnapshots);
    if (stepRebuilt.includes(id)) {
      completedIds.push(id);
      const rIdx = remainingIds.indexOf(id);
      if (rIdx >= 0) remainingIds.splice(rIdx, 1);
      console.log(`[APPLY ${i + 1}/${targetIds.length}] Rebuild confirmed for ${filing?.ticker || id}.`);
    } else {
      console.warn(`[APPLY ${i + 1}/${targetIds.length}] Incomplete or unverified for ${filing?.ticker || id}.`);
    }

    fs.writeFileSync(backupPath, JSON.stringify({ ...backup, result: combinedResults, completedIds, remainingIds }, null, 2));

    if (result.paused) {
      console.warn(`[QUOTA PAUSED] Gemini/LLM quota cooling down. Stopping further filings.`);
      break;
    }
  }

  // Final verification of resulting snapshots
  const { rows: newSnapshots } = await pool.query(
    `SELECT qs.*, s.ticker
     FROM quarterly_snapshots qs
     JOIN stocks s ON s.id = qs.stock_id
     WHERE qs.stock_id = ANY($1)
     ORDER BY s.ticker`,
    [stockIds]
  );

  console.log(`\nConfirmed rebuilt: ${completedIds.length}/${targetIds.length}.`);
  for (const sn of newSnapshots.filter(s => completedIds.includes(s.raw_ai_output?.source_filing?.announcement_id))) {
    const rev = sn.metrics?.revenue_growth?.evidence || sn.metrics?.revenue_growth?.value;
    const pat = sn.metrics?.pat_growth?.evidence || sn.metrics?.pat_growth?.value;
    console.log(` - ${sn.ticker.padEnd(12)} | Action: ${(sn.final_action || 'N/A').padEnd(15)} (${sn.conviction_score}/10) | Rev: ${rev} | PAT: ${pat}`);
  }
  if (remainingIds.length) {
    console.log(`Incomplete: ${remainingIds.length} filing(s). After the cooldown, resume with --resume "${backupPath}" --apply. The manifest preserves the exact remaining IDs.`);
    process.exitCode = 2;
  }

  await pool.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async err => {
    console.error("[FATAL]", err.message);
    await pool.end();
    process.exitCode = 1;
  });
}

