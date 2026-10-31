/**
 * Valuation board runner: ranks the tracked cohort (Core + Watchlist stocks) with the asymmetric-mispricing engine.
 *
 * Inputs: market facts from market_data_snapshots, analyst assumptions from
 * backend/config/underwriting-assumptions.json (see valuation-inputs.service.js). Stocks with missing or
 * stale inputs are listed with the reason and are NOT ranked; nothing is defaulted.
 *
 * Usage: node --env-file=.env.local backend/scripts/run-asymmetric-mispricing-ranking.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { pool } from '../db/pool.js';
import { rankUniverseByMispricing } from '../services/asymmetric-mispricing-ranking.service.js';
import { loadAuditedPortfolioFromDatabase } from '../services/valuation-inputs.service.js';

dotenv.config({ path: './.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kept so existing scripts that import the loader from here keep working.
export { loadAuditedPortfolioFromDatabase };

const fmt = (v, digits = 1, suffix = '') => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : `${Number(v).toFixed(digits)}${suffix}`);
const signed = (v, suffix = '%') => (v === null || v === undefined ? 'n/a' : `${v > 0 ? '+' : ''}${v}${suffix}`);

export async function runAsymmetricRankingReport() {
  const cohort = await loadAuditedPortfolioFromDatabase(pool);
  const ranked = rankUniverseByMispricing(cohort);
  const complete = ranked.filter((r) => r.dataComplete);
  const incomplete = ranked.filter((r) => !r.dataComplete);

  const rows = complete.map((r, i) => {
    const sc = r.thesisIqScorecard;
    const m = r.metrics;
    return {
      rank: i + 1,
      ticker: r.ticker,
      price: r.price,
      pe: r.pe,
      underwritten: m.expectedCagr,
      implied: m.impliedGrowth,
      gap: m.expectationGap,
      stressGap: m.stressTestedExpectationGap,
      fairValue: sc.fairValuePrice,
      buyBelow: sc.buyBelowPrice,
      asymmetry: sc.asymmetryRatio,
      tier: r.opportunityTier,
      unreachable: m.priceExceedsReachableValue
    };
  });

  console.log('='.repeat(150));
  console.log(`THESISIQ VALUATION BOARD: ${complete.length} evaluated, ${incomplete.length} without enough data`);
  console.log('='.repeat(150));
  console.log('Rank Ticker       CMP      P/E    Underwritten  Implied   Gap      StressGap  FairValue  BuyBelow  Asym     Tier');
  for (const r of rows) {
    console.log(
      `#${r.rank}`.padEnd(5) + r.ticker.padEnd(13) + fmt(r.price, 1).padEnd(9) + fmt(r.pe, 1, 'x').padEnd(7) +
      fmt(r.underwritten, 1, '%').padEnd(14) + (r.unreachable ? 'unreachable' : fmt(r.implied, 1, '%')).padEnd(10) +
      signed(r.gap).padEnd(9) + signed(r.stressGap).padEnd(11) + fmt(r.fairValue, 0).padEnd(11) + fmt(r.buyBelow, 0).padEnd(10) +
      `${r.asymmetry}:1`.padEnd(9) + r.tier
    );
  }
  if (incomplete.length) {
    console.log('\nNOT EVALUATED (no verdict is issued without these inputs):');
    for (const r of incomplete) console.log(`  ${r.ticker.padEnd(13)} ${r.missingInputs.join(', ')}`);
  }

  const reportDir = path.join(__dirname, '..', '..', 'reports', 'thesis_board');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'ASYMMETRIC_MISPRICING_RANKING.md');
  const asOf = [...new Set(cohort.map((e) => (e.marketDataAsOf instanceof Date ? e.marketDataAsOf.toISOString() : String(e.marketDataAsOf || '')).slice(0, 10)).filter(Boolean))].sort();
  let md = `# ThesisIQ valuation board\n\nGenerated: ${new Date().toISOString()}  \nMarket data as of: ${asOf.join(', ') || 'n/a'}  \nCohort: ${cohort.length} tracked stocks (${complete.length} evaluated)\n\nUnderwritten growth comes from \`backend/config/underwriting-assumptions.json\`; everything else from the database. "Implied" is the growth the price already assumes under the shared FCFF model (11.5% WACC); "unreachable" means no growth rate at that return on capital justifies the price.\n\n`;
  md += '| Rank | Ticker | CMP | P/E | Underwritten | Implied | Gap | Stress gap | Fair value | Buy below | Asymmetry | Tier |\n| :-: | :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | :-- |\n';
  for (const r of rows) {
    md += `| ${r.rank} | ${r.ticker} | ${fmt(r.price, 1)} | ${fmt(r.pe, 1, 'x')} | ${fmt(r.underwritten, 1, '%')} | ${r.unreachable ? 'unreachable' : fmt(r.implied, 1, '%')} | ${signed(r.gap)} | ${signed(r.stressGap)} | ${fmt(r.fairValue, 0)} | ${fmt(r.buyBelow, 0)} | ${r.asymmetry}:1 | \`${r.tier}\` |\n`;
  }
  if (incomplete.length) {
    md += '\n## Not evaluated\n\n| Ticker | Missing or stale inputs |\n| :-- | :-- |\n';
    for (const r of incomplete) md += `| ${r.ticker} | ${r.missingInputs.join(', ')} |\n`;
  }
  fs.writeFileSync(reportPath, md, 'utf-8');
  console.log(`\nBoard written to ${reportPath}\n`);
  return ranked;
}

// Auto-execute when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAsymmetricRankingReport()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
