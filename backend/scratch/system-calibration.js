import { pool } from '../db/pool.js';
import { calculateAlphaSignals } from '../services/xbrl/decisionEngine.js';

async function calibrate() {
  console.log("=================================================");
  console.log("SYSTEM-WIDE SIGNAL CALIBRATION (HARDEnd ENGINE)");
  console.log("=================================================");

  const { rows: metrics } = await pool.query(`
    SELECT m.*, s.ticker 
    FROM xbrl_metrics_quarterly m
    JOIN stocks s ON s.id = m.stock_id
    ORDER BY m.period_end_date DESC
  `);

  // Group by stock
  const stockGroups = {};
  metrics.forEach(m => {
    if (!stockGroups[m.stock_id]) stockGroups[m.stock_id] = [];
    stockGroups[m.stock_id].push(m);
  });

  const allScores = [];
  const highSignals = [];

  for (const stockId in stockGroups) {
    const stockMetrics = stockGroups[stockId];
    const ticker = stockMetrics[0].ticker;
    console.log(`Processing: ${ticker} (${stockMetrics.length} quarters)`);
    
      stockMetrics.forEach((m, idx) => {
        const alpha = calculateAlphaSignals(stockMetrics, idx);
        if (!alpha) return;

        console.log(`   ${m.quarter}: Score ${alpha.signalStrengthScore}, Conf ${alpha.signalConfidence}%`);
        allScores.push(alpha.signalStrengthScore);

      if (alpha.signalStrengthScore >= 70) {
        console.log(`DEBUG: ${ticker} | Score: ${alpha.signalStrengthScore} | Conf: ${alpha.signalConfidence}%`);
      }

      if (alpha.signalStrengthScore >= 70 && alpha.signalConfidence >= 60) {
        highSignals.push({
          ticker,
          quarter: m.quarter,
          score: alpha.signalStrengthScore,
          conf: alpha.signalConfidence,
          signals: alpha.signals.filter(s => Math.abs(s.adjustedScore) > 30).map(s => s.name)
        });
      }
    });
  }

  // Distribution
  const distribution = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };
  allScores.forEach(s => {
    if (s <= 20) distribution['0-20']++;
    else if (s <= 40) distribution['21-40']++;
    else if (s <= 60) distribution['41-60']++;
    else if (s <= 80) distribution['61-80']++;
    else distribution['81-100']++;
  });

  console.log("\nSCORE DISTRIBUTION:");
  console.table(distribution);

  console.log("\nTOP SIGNAL CLUSTERS (>70 Score, >60% Confidence):");
  highSignals.sort((a, b) => b.score - a.score).slice(0, 20).forEach(s => {
    console.log(`${s.ticker.padEnd(12)} | ${s.quarter.padEnd(8)} | Score: ${s.score} | Conf: ${s.conf}% | Signals: ${s.signals.join(', ')}`);
  });

  process.exit(0);
}

calibrate();
