/**
 * Signal Computation Script for Thesis KPI Shadow Engine v1.0
 * Computes like-for-like YoY/QoQ, growth acceleration, driver evolution states, and economic relevance.
 */

import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { computeObservationDeltas } from '../services/kpi-shadow.service.js';

export async function computeThesisKpiSignals() {
  console.log('--- 🧮 Step: Computing Thesis KPI Signals & Driver States ---');

  const { rows: rawObs } = await pool.query(`
    SELECT * FROM thesis_kpi_observations
    ORDER BY company ASC, metric_id ASC, period_type ASC
  `);

  if (rawObs.length === 0) {
    console.log('⚠️ No observations found to compute.');
    return { computedCount: 0 };
  }

  const enriched = computeObservationDeltas(rawObs, 0.01);
  let updatedCount = 0;

  for (const obs of enriched) {
    await pool.query(
      `UPDATE thesis_kpi_observations
       SET qoq_delta = $1,
           yoy_delta = $2,
           growth_rate = $3,
           growth_acceleration = $4,
           growth_direction = $5,
           driver_state = $6,
           economic_relevance = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [
        obs.qoq_delta,
        obs.yoy_delta,
        obs.growth_rate,
        obs.growth_acceleration,
        obs.growth_direction,
        obs.driver_state,
        obs.economic_relevance,
        obs.id
      ]
    );
    updatedCount++;
  }

  console.log(`✅ Computed and updated ${updatedCount} KPI observation signals in DB.\n`);
  return { computedCount: updatedCount };
}

if (process.argv[1]?.endsWith('compute-thesis-kpi-signals.js')) {
  computeThesisKpiSignals()
    .then(() => pool.end())
    .catch(err => {
      console.error('❌ Signal computation failed:', err);
      pool.end();
      process.exit(1);
    });
}
