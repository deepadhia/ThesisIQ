import { z } from "zod";
import { pool } from "../db/pool.js";
import { parseFiscalQuarter } from "../utils/fiscal-quarter.js";

const geminiPromiseUpdateSchema = z.object({
  id: z.string().uuid(),
  new_status: z.enum(["kept", "broken", "pending"]),
  resolved_in_quarter: z.string().nullable().optional(),
  evidence: z.string().optional(),
});

const geminiNewPromiseSchema = z.object({
  promise_text: z.string().min(1),
  made_in_quarter: z.string().min(1),
  target_deadline: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional().nullable(),
});

export async function importGeminiResponseToDb({ stockId, quarter, payload }) {
  const parsedQ = parseFiscalQuarter(quarter);
  const normalizedQuarter =
    parsedQ && parsedQ.label !== "UNKNOWN" ? parsedQ.label : quarter;
  // Zod-validate again server-side for zero-trust (front-end payload is untrusted).
  const validated = z
    .object({
      summary: z.string().nullable().optional(),
      dodged_questions: z.array(z.string()).default([]),
      red_flags: z.array(z.string()).default([]),
      metrics: z.record(z.unknown()).default({}),
      signals: z
        .object({
          bullish: z.array(z.string()).default([]),
          warnings: z.array(z.string()).default([]),
          bearish: z.array(z.string()).default([]),
        })
        .optional()
        .nullable(),
      key_changes: z.array(z.string()).default([]),
      thesis_status: z.string().nullable().optional(),
      thesis_status_reason: z.string().nullable().optional(),
      thesis_momentum: z.string().nullable().optional(),
      thesis_drift_status: z.string().nullable().optional(),
      confidence_score: z.number().int().min(0).max(100).nullable().optional(),
      thesis_score: z.number().int().min(0).max(100).nullable().optional(),
      valuation_score: z.number().int().min(0).max(100).nullable().optional(),
      conviction_score: z.number().int().min(0).max(100).nullable().optional(),
      action_decision: z.string().nullable().optional(),
      position_size: z.string().nullable().optional(),
      promise_updates: z.array(geminiPromiseUpdateSchema).default([]),
      new_promises: z.array(geminiNewPromiseSchema).default([]),
      raw: z.unknown().optional(),
      // --- Signal Intelligence V6 ---
      primary_metric_momentum: z
        .object({
          direction: z.enum(["accelerating", "decelerating", "stable"]),
          reason: z.string().optional(),
        })
        .nullable()
        .optional(),
      thesis_dependency: z
        .object({
          driver: z.enum([
            "execution",
            "capacity_expansion",
            "demand_tailwind",
            "pricing",
          ]),
          reliance: z.enum(["proven", "developing", "speculative"]),
          risk_level: z.enum(["low", "medium", "high"]),
        })
        .nullable()
        .optional(),
      execution_quality: z
        .object({
          applicable: z.boolean(),
          status: z.enum(["strong", "moderate", "weak", "NA"]),
          reason: z.string().optional(),
        })
        .nullable()
        .optional(),
      // --- V12 fields ---
      decision_blockers: z.array(z.string()).optional().nullable(),
      deterioration_quarters: z.number().int().min(0).optional().nullable(),
      data_quality_score: z.number().min(0).max(100).optional().nullable(),
      official_filing_present: z.boolean().optional().nullable(),
    })
    .parse(payload);

  // Start DB transaction for deterministic state.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // node-postgres does not automatically serialize JS objects/arrays to jsonb.
    // Explicit JSON.stringify prevents "Expected ':' but found '}'" JSON parse errors.
    const dodgedQuestionsJson = JSON.stringify(validated.dodged_questions);
    const redFlagsJson = JSON.stringify(validated.red_flags);
    const metricsJson = JSON.stringify(validated.metrics);
    const rawAiOutputJson = JSON.stringify(validated.raw ?? payload);

    // 1) Upsert quarterly snapshot
    await client.query(
      `INSERT INTO quarterly_snapshots
        (stock_id, quarter, summary, dodged_questions, red_flags, metrics, raw_ai_output,
         thesis_status, thesis_status_reason, thesis_score, valuation_score, conviction_score,
         final_action, position_size, scoring_version,
         decision_blockers, deterioration_quarters, data_quality_score, official_filing_present)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (stock_id, quarter) DO UPDATE SET
         summary = EXCLUDED.summary,
         dodged_questions = EXCLUDED.dodged_questions,
         red_flags = EXCLUDED.red_flags,
         metrics = EXCLUDED.metrics,
         raw_ai_output = EXCLUDED.raw_ai_output,
         thesis_status = EXCLUDED.thesis_status,
         thesis_status_reason = EXCLUDED.thesis_status_reason,
         thesis_score = EXCLUDED.thesis_score,
         valuation_score = EXCLUDED.valuation_score,
         conviction_score = EXCLUDED.conviction_score,
         final_action = EXCLUDED.final_action,
         position_size = EXCLUDED.position_size,
         scoring_version = EXCLUDED.scoring_version,
         decision_blockers = EXCLUDED.decision_blockers,
         deterioration_quarters = EXCLUDED.deterioration_quarters,
         data_quality_score = EXCLUDED.data_quality_score,
         official_filing_present = EXCLUDED.official_filing_present`,
      [
        stockId,
        normalizedQuarter,
        validated.summary ?? null,
        dodgedQuestionsJson,
        redFlagsJson,
        metricsJson,
        rawAiOutputJson,
        validated.thesis_status ?? null,
        validated.thesis_status_reason ?? null,
        validated.thesis_score ?? null,
        validated.valuation_score ?? null,
        validated.conviction_score ?? null,
        validated.action_decision ?? null,
        validated.position_size ?? null,
        "V12",
        // V12 intelligence columns
        validated.decision_blockers?.length ? validated.decision_blockers : [],
        validated.deterioration_quarters ?? 0,
        validated.data_quality_score ?? null,
        validated.official_filing_present ?? null,
      ],
    );

    // 2) Update V5-ish columns if present
    if (
      validated.thesis_momentum != null ||
      validated.thesis_drift_status != null ||
      validated.confidence_score != null
    ) {
      await client.query(
        `UPDATE quarterly_snapshots
         SET thesis_momentum = COALESCE($1, thesis_momentum),
             thesis_drift_status = COALESCE($2, thesis_drift_status),
             confidence_score = COALESCE($3, confidence_score)
         WHERE stock_id = $4 AND quarter = $5`,
        [
          validated.thesis_momentum ?? null,
          validated.thesis_drift_status ?? null,
          validated.confidence_score ?? null,
          stockId,
          normalizedQuarter,
        ],
      );
    }

    // 3) Signal Intelligence V6 — write if any of the 3 fields are present
    if (
      validated.primary_metric_momentum != null ||
      validated.thesis_dependency != null ||
      validated.execution_quality != null
    ) {
      await client.query(
        `UPDATE quarterly_snapshots
         SET primary_metric_momentum = COALESCE($1, primary_metric_momentum),
             thesis_dependency       = COALESCE($2, thesis_dependency),
             execution_quality       = COALESCE($3, execution_quality)
         WHERE stock_id = $4 AND quarter = $5`,
        [
          validated.primary_metric_momentum
            ? JSON.stringify(validated.primary_metric_momentum)
            : null,
          validated.thesis_dependency
            ? JSON.stringify(validated.thesis_dependency)
            : null,
          validated.execution_quality
            ? JSON.stringify(validated.execution_quality)
            : null,
          stockId,
          normalizedQuarter,
        ],
      );

      // Deterministic computed flag — no LLM subjectivity
      // Condition A: speculative reliance + weak execution (execution failure)
      // Condition B: decelerating primary metric + not yet proven reliance (momentum deterioration)
      const isHighRisk =
        (validated.thesis_dependency?.reliance === "speculative" &&
          validated.execution_quality?.applicable === true &&
          validated.execution_quality?.status === "weak") ||
        (validated.primary_metric_momentum?.direction === "decelerating" &&
          validated.thesis_dependency?.reliance !== "proven");
      await client.query(
        `UPDATE quarterly_snapshots SET is_high_risk_thesis = $1 WHERE stock_id = $2 AND quarter = $3`,
        [isHighRisk, stockId, normalizedQuarter],
      );
    }

    // 4) Zero-trust ledger update: only update promises that are actually pending in DB.
    const pendingRes = await client.query(
      "SELECT id FROM management_promises WHERE stock_id = $1 AND status = 'pending'",
      [stockId],
    );
    const pendingIds = new Set((pendingRes.rows || []).map((r) => r.id));

    let updatedCount = 0;
    let skippedHallucinated = 0;

    for (const pu of validated.promise_updates) {
      if (pu.new_status === "pending") continue;

      // Only accept kept/broken transitions for IDs currently pending.
      if (!pendingIds.has(pu.id)) {
        skippedHallucinated++;
        continue;
      }

      await client.query(
        `UPDATE management_promises
         SET status = $1,
             resolved_in_quarter = $2
         WHERE id = $3`,
        [pu.new_status, pu.resolved_in_quarter ?? quarter, pu.id],
      );

      updatedCount++;
    }

    // 4) Insert new promises (deduplicate by text + made_in_quarter)
    let insertedCount = 0;
    const newPromises = validated.new_promises || [];
    if (newPromises.length > 0) {
      const existingRes = await client.query(
        "SELECT promise_text, made_in_quarter FROM management_promises WHERE stock_id = $1",
        [stockId],
      );
      const existingSet = new Set(
        (existingRes.rows || []).map(
          (r) => `${r.promise_text}::${r.made_in_quarter}`,
        ),
      );

      const rowsToInsert = [];
      for (const np of newPromises) {
        const madeIn = np.made_in_quarter || quarter;
        const key = `${np.promise_text}::${madeIn}`;
        if (existingSet.has(key)) continue;

        rowsToInsert.push({
          stock_id: stockId,
          promise_text: np.promise_text,
          made_in_quarter: madeIn,
          target_deadline: np.target_deadline ?? null,
          status: "pending",
        });
      }

      for (const row of rowsToInsert) {
        await client.query(
          `INSERT INTO management_promises (stock_id, promise_text, made_in_quarter, target_deadline, status)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            row.stock_id,
            row.promise_text,
            row.made_in_quarter,
            row.target_deadline,
            row.status,
          ],
        );
        insertedCount++;
      }
    }

    await client.query("COMMIT");

    return {
      updatedCount,
      insertedCount,
      skippedHallucinated,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
