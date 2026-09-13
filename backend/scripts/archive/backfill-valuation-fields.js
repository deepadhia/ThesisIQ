/**
 * Backfill script: map existing JSONB raw_ai_output data to the new
 * explicit columns (thesis_score, valuation_score, conviction_score,
 * final_action, position_size) for all quarterly_snapshots rows that
 * don't yet have them populated.
 *
 * Run once from the backend directory:
 *   node scripts/backfill-valuation-fields.js
 */

import { pool } from "../db/pool.js";

async function run() {
  const client = await pool.connect();
  console.log("Starting backfill of valuation columns…");

  try {
    // Fetch rows where any of the new explicit columns are still NULL
    const { rows } = await client.query(`
      SELECT id, raw_ai_output, confidence_score
      FROM quarterly_snapshots
      WHERE thesis_score IS NULL
         OR valuation_score IS NULL
         OR conviction_score IS NULL
         OR final_action IS NULL
    `);

    console.log(`Found ${rows.length} rows to backfill`);

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      let raw = row.raw_ai_output;

      // raw_ai_output may be a string (old rows) or already parsed
      if (typeof raw === "string") {
        try { raw = JSON.parse(raw); } catch { raw = null; }
      }

      // --- V7 schema: decision block ---
      let thesis_score = null;
      let valuation_score = null;
      let conviction_score = null;
      let final_action = null;
      let position_size = null;

      if (raw && typeof raw === "object") {
        // New V7 scoring block
        const scoring = raw.scoring;
        if (scoring && typeof scoring === "object") {
          thesis_score = typeof scoring.thesis_score === "number" ? scoring.thesis_score : null;
          valuation_score = typeof scoring.valuation_score === "number" ? scoring.valuation_score : null;
          conviction_score = typeof scoring.conviction_score === "number" ? scoring.conviction_score : null;
        }

        // New V7 decision block
        const decision = raw.decision;
        if (decision && typeof decision === "object") {
          final_action = typeof decision.final_action === "string" ? decision.final_action : null;
          position_size = typeof decision.position_size === "string" ? decision.position_size : null;
        }

        // Fallback mapping for old V5/V6 format
        if (!final_action) {
          const av = raw.actionable_verdict;
          if (av && typeof av === "object") {
            final_action = typeof av.decision === "string" ? av.decision : null;
          }
        }

        // Approximate thesis_score from confidence_score if missing (for old rows)
        if (thesis_score == null && row.confidence_score != null) {
          thesis_score = Number(row.confidence_score);
        }

        // Approximate position_size from old conviction_level if missing
        if (!position_size && final_action) {
          const av = raw.actionable_verdict;
          const conviction = av?.conviction_level;
          if (final_action.toUpperCase().includes("CUT")) {
            position_size = "none";
          } else if (conviction === "HIGH") {
            position_size = "full";
          } else if (conviction === "MEDIUM") {
            position_size = "half";
          } else {
            position_size = "starter";
          }
        }
      }

      if (!final_action && thesis_score == null) {
        skipped++;
        continue;
      }

      await client.query(
        `UPDATE quarterly_snapshots
         SET thesis_score    = COALESCE($1, thesis_score),
             valuation_score = COALESCE($2, valuation_score),
             conviction_score = COALESCE($3, conviction_score),
             final_action    = COALESCE($4, final_action),
             position_size   = COALESCE($5, position_size)
         WHERE id = $6`,
        [thesis_score, valuation_score, conviction_score, final_action, position_size, row.id],
      );
      updated++;
    }

    console.log(`Backfill complete. Updated: ${updated} | Skipped (no usable data): ${skipped}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
