/**
 * Read-only database report of per-stock thesis evidence and market reaction.
 * Writes local artifacts only; never updates the database or sends Telegram.
 * Usage: node --env-file=.env.local backend/scripts/report-thesis-health.js --output=reports/thesis_board
 */
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool.js';
import { loadEarningsReactionBoard } from '../services/earnings-reaction-board.service.js';
import { loadThesisHealthInputs, buildThesisHealthReport, thesisHealthMarkdown } from '../services/thesis-health-tracker.service.js';

const outputArg = process.argv.find(arg => arg.startsWith('--output='));
const outputDir = path.resolve(outputArg?.slice('--output='.length) || 'reports/thesis_board');

export async function reportThesisHealth({ database = pool, output = outputDir, loadReaction = loadEarningsReactionBoard } = {}) {
  const inputs = await loadThesisHealthInputs(database);
  let reactions = [], reactionError = null;
  try {
    reactions = (await loadReaction(database)).stocks || [];
  } catch (err) {
    reactionError = err.message;
  }
  const report = buildThesisHealthReport({ ...inputs, reactions });
  report.marketDataStatus = reactionError ? { status: 'UNAVAILABLE', reason: reactionError } : { status: 'LOADED' };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'thesis-health.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'thesis-health.md'), thesisHealthMarkdown(report));
  return report;
}

if (process.argv[1]?.endsWith('report-thesis-health.js')) {
  reportThesisHealth()
    .then(report => {
      console.log(`Thesis health: ${report.stocks.length} tracked stocks; market ${report.marketDataStatus.status}; ${outputDir}`);
    })
    .catch(err => {
      console.error(`Thesis health report failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
