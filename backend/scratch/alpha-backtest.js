import { pool } from '../db/pool.js';
import { calculateAlphaSignals } from '../services/xbrl/decisionEngine.js';

async function backtest() {
  console.log("=================================================");
  console.log("ALPHA BACKTEST: SCORE VS FUTURE RETURNS");
  console.log("=================================================");

  const { rows: metrics } = await pool.query(`
    SELECT m.*, s.ticker, s.id as stock_id
    FROM xbrl_metrics_quarterly m
    JOIN stocks s ON s.id = m.stock_id
    ORDER BY m.period_end_date ASC
  `);

  const stockGroups = {};
  metrics.forEach(m => {
    if (!stockGroups[m.stock_id]) stockGroups[m.stock_id] = [];
    stockGroups[m.stock_id].push(m);
  });

  const results = [];

  for (const stockId in stockGroups) {
    const stockMetrics = stockGroups[stockId].reverse(); // Sort newest first for calculateAlphaSignals
    const ticker = stockMetrics[0].ticker;

    for (let i = 0; i < stockMetrics.length; i++) {
      const m = stockMetrics[i];
      const alpha = calculateAlphaSignals(stockMetrics, i);
      if (!alpha || alpha.signalConfidence < 60) continue;

      // Assume results published 45 days after quarter end
      const pubDate = new Date(m.period_end_date);
      pubDate.setDate(pubDate.getDate() + 45);
      
      const targetDate = new Date(pubDate);
      targetDate.setDate(targetDate.getDate() + 90); // 3 months later

      // Fetch prices
      const { rows: p1 } = await pool.query(
        "SELECT price FROM prices WHERE stock_id = $1 AND date >= $2 ORDER BY date ASC LIMIT 1",
        [stockId, pubDate.toISOString().split('T')[0]]
      );
      const { rows: p2 } = await pool.query(
        "SELECT price FROM prices WHERE stock_id = $1 AND date >= $2 ORDER BY date ASC LIMIT 1",
        [stockId, targetDate.toISOString().split('T')[0]]
      );

      if (p1[0] && p2[0]) {
        const startPrice = parseFloat(p1[0].price);
        const endPrice = parseFloat(p2[0].price);
        const returns = ((endPrice - startPrice) / startPrice) * 100;

        results.push({
          ticker,
          quarter: m.quarter,
          score: alpha.signalStrengthScore,
          returns: returns.toFixed(2),
          bucket: alpha.signalStrengthScore >= 70 ? 'High' : alpha.signalStrengthScore >= 40 ? 'Mid' : 'Low'
        });
      }
    }
  }

  // Aggregate results by bucket
  const buckets = { High: { count: 0, totalReturn: 0 }, Mid: { count: 0, totalReturn: 0 }, Low: { count: 0, totalReturn: 0 } };
  results.forEach(r => {
    buckets[r.bucket].count++;
    buckets[r.bucket].totalReturn += parseFloat(r.returns);
  });

  console.log("\nBACKTEST RESULTS (3-MONTH RETURNS):");
  Object.keys(buckets).forEach(b => {
    const avg = buckets[b].count > 0 ? (buckets[b].totalReturn / buckets[b].count).toFixed(2) : 0;
    console.log(`${b.padEnd(8)} | Count: ${buckets[b].count.toString().padEnd(4)} | Avg Return: ${avg}%`);
  });

  console.log("\nDETAILED TRADES (HIGH SCORE):");
  results.filter(r => r.score >= 70).sort((a, b) => b.score - a.score).forEach(r => {
    console.log(`${r.ticker.padEnd(12)} | ${r.quarter.padEnd(8)} | Score: ${r.score} | Return: ${r.returns}%`);
  });

  process.exit(0);
}

backtest();
