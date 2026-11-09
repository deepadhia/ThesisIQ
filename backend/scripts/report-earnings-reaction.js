/** Read-only DB + market history report; no Telegram, repairs or snapshot mutations. */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../db/pool.js';
import { loadEarningsReactionBoard, reactionBoardMarkdown } from '../services/earnings-reaction-board.service.js';
const args = process.argv.slice(2);
const arg = name => args.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
const output = path.resolve(arg('--output') || 'reports/earnings-reaction');
try {
  const tickers = arg('--tickers')?.split(',').map(t => t.trim().toUpperCase()).filter(Boolean) || null;
  const report = await loadEarningsReactionBoard(pool, { tickers });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'earnings-reaction.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'earnings-reaction.md'), reactionBoardMarkdown(report));
  console.log(`Read-only reaction report: ${report.stocks.length} verified result events, ${report.status}; ${output}`);
  if (report.status === 'PARTIAL') process.exitCode = 2;
} finally { await pool.end(); }
