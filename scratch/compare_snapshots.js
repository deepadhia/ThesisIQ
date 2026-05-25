import { pool } from '../backend/db/pool.js';

const args = process.argv.slice(2);
const ticker = args.find(arg => arg.startsWith('--ticker='))?.split('=')[1] || 'QPOWER';

async function run() {
  console.log(`\n🔍 Running V12 Snapshot Comparative Regression Audit for ${ticker}...`);

  // 1. Get stock details
  const stockRes = await pool.query("SELECT id, company_name FROM stocks WHERE UPPER(ticker) = $1", [ticker.toUpperCase()]);
  if (stockRes.rows.length === 0) {
    console.error(`❌ Stock ${ticker} not found.`);
    await pool.end();
    return;
  }
  const stock = stockRes.rows[0];
  console.log(`Found: ${stock.company_name} (ID: ${stock.id})`);

  // 2. Fetch production snapshots
  const prodRes = await pool.query(
    "SELECT * FROM quarterly_snapshots WHERE stock_id = $1 ORDER BY quarter ASC",
    [stock.id]
  );
  const prodSnapshots = prodRes.rows;

  // 3. Fetch shadow (backfilled V12) snapshots
  const shadowRes = await pool.query(
    "SELECT * FROM quarterly_snapshots_shadow WHERE stock_id = $1 ORDER BY quarter ASC",
    [stock.id]
  );
  const shadowSnapshots = shadowRes.rows;

  if (shadowSnapshots.length === 0) {
    console.log(`\n⚠️ No backfilled shadow snapshots found in 'quarterly_snapshots_shadow' for ${ticker}.`);
    console.log(`Run the backfill first:`);
    console.log(`  node --env-file=.env.local scratch/historical_backfill.js --ticker=${ticker}`);
    await pool.end();
    return;
  }

  console.log(`\n========================================================================================`);
  console.log(`📊 SIDE-BY-SIDE SNAPSHOT REGRESSION TABLE`);
  console.log(`========================================================================================`);
  console.log(
    ` ${'Quarter'.padEnd(10)} | ${'Metric'.padEnd(16)} | ${'Production (Old)'.padEnd(20)} | ${'Shadow V12 (New)'.padEnd(20)} | ${'Variance / Delta'.padEnd(18)}`
  );
  console.log(`----------------------------------------------------------------------------------------`);

  const prodMap = new Map(prodSnapshots.map(s => [s.quarter, s]));

  for (const shadow of shadowSnapshots) {
    const prod = prodMap.get(shadow.quarter);
    const qLabel = shadow.quarter;

    const printRow = (metricName, oldVal, newVal, deltaFormatter) => {
      const oldStr = oldVal !== undefined && oldVal !== null ? String(oldVal) : '—';
      const newStr = newVal !== undefined && newVal !== null ? String(newVal) : '—';
      const deltaStr = deltaFormatter ? deltaFormatter(oldVal, newVal) : '';
      console.log(
        ` ${qLabel.padEnd(10)} | ${metricName.padEnd(16)} | ${oldStr.padEnd(20)} | ${newStr.padEnd(20)} | ${deltaStr.padEnd(18)}`
      );
    };

    const numDelta = (o, n) => {
      if (o === null || o === undefined || n === null || n === undefined) return '—';
      const diff = parseFloat(n) - parseFloat(o);
      if (diff > 0) return `🟢 +${diff.toFixed(1)}`;
      if (diff < 0) return `🔴 ${diff.toFixed(1)}`;
      return 'Stable';
    };

    const textDelta = (o, n) => {
      if (!o) return 'New Snapshot 🆕';
      if (String(o).trim().toLowerCase() !== String(n).trim().toLowerCase()) {
        return `⚠️ Changed (Shifted)`;
      }
      return 'Matched ✅';
    };

    // Print core scores
    printRow('Thesis Score', prod?.thesis_score, shadow.thesis_score, numDelta);
    printRow('Valuation Score', prod?.valuation_score, shadow.valuation_score, numDelta);
    printRow('Conviction Score', prod?.conviction_score, shadow.conviction_score, numDelta);
    
    // Print actions
    printRow('Action Decision', prod?.final_action, shadow.final_action, textDelta);
    printRow('Position Size', prod?.position_size, shadow.position_size, textDelta);

    // Print V12 queryables
    const prodBlockers = prod?.decision_blockers ? prod.decision_blockers.join(', ') : '—';
    const shadowBlockers = shadow.decision_blockers ? shadow.decision_blockers.join(', ') : '—';
    printRow('V12 Blockers', prodBlockers, shadowBlockers, textDelta);
    
    printRow('Data Quality', prod?.data_quality_score, shadow.data_quality_score, numDelta);
    
    console.log(`----------------------------------------------------------------------------------------`);
  }

  console.log(`\n🎉 Audit comparison finished successfully.`);
  await pool.end();
}

run();
