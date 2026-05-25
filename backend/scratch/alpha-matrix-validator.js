import { pool } from '../db/pool.js';
import { calculateAlphaSignals } from '../services/xbrl/decisionEngine.js';

async function validateMatrix() {
  const tickers = ['TIMETECHNO', 'INOXINDIA', 'CCL', 'QPOWER'];
  
  console.log("=================================================");
  console.log("VALIDATING DECISION INTELLIGENCE LAYER (ALPHA)");
  console.log("=================================================");

  for (const ticker of tickers) {
    const { rows: stocks } = await pool.query("SELECT id FROM stocks WHERE ticker = $1", [ticker]);
    if (stocks.length === 0) continue;
    const stockId = stocks[0].id;

    const { rows: metrics } = await pool.query(
      "SELECT * FROM xbrl_metrics_quarterly WHERE stock_id = $1 ORDER BY period_end_date DESC",
      [stockId]
    );

    console.log(`\nSTOCK: ${ticker} (${metrics.length} quarters)`);

    metrics.forEach((m, idx) => {
      const alpha = calculateAlphaSignals(metrics, idx);
      if (!alpha) return;

      const qStr = `${m.quarter}`.padEnd(8);
      const scoreStr = `Score: ${alpha.alphaScore}`.padEnd(12);
      const confStr = `Conf: ${alpha.signalConfidence}%`.padEnd(12);
      
      console.log(`${qStr} | ${scoreStr} | ${confStr} | Rel: ${m.reliability_score}%`);
      
      // Detailed breakdown for interesting cases
      if (alpha.alphaScore > 0 || alpha.signalConfidence < 100) {
        alpha.signals.forEach(s => {
          if (s.adjustedScore !== 0 || s.trust < 1) {
            console.log(`   - ${s.name.padEnd(10)}: ${s.adjustedScore.toString().padStart(4)} pts (Trust: ${(s.trust*100).toFixed(0)}%)`);
          }
        });
      }
    });
  }

  console.log("\nValidation Complete.");
  process.exit(0);
}

validateMatrix();
