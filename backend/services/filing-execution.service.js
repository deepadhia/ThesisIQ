import crypto from 'node:crypto';

// Longer than the scanner's 270-second worker budget; killed processes release capacity by expiry.
export const FILING_LEASE_MS = 10 * 60 * 1000;

/**
 * Atomically admit one worker for exactly the row/version it selected. Short row locks work with transaction pooling.
 * The comparison also stops a stale selection from replaying a filing completed by a faster scanner/repair run.
 */
export async function claimFilingExecution(db, item) {
  const owner = crypto.randomUUID();
  const { rows } = await db.query(
    `UPDATE corporate_announcements
     SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) || jsonb_build_object(
       'execution_lease', jsonb_build_object('owner', $2::text, 'until',
         floor(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint + $3::bigint))
     WHERE id = $1
       AND deep_dive_status IS NOT DISTINCT FROM $4::text
       AND (COALESCE(event_analysis, '{}'::jsonb) - 'execution_lease') = ($5::jsonb - 'execution_lease')
       AND COALESCE(event_analysis->>'foreign_filing', 'false') <> 'true'
       AND (event_analysis->>'retry_not_before' IS NULL
         OR (event_analysis->>'retry_not_before')::timestamptz <= NOW())
       AND COALESCE((event_analysis->'execution_lease'->>'until')::bigint, 0)
         <= floor(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
     RETURNING id, 'filing_execution_claim' AS tag`,
    [item.id, owner, FILING_LEASE_MS, item.deep_dive_status, JSON.stringify(item.event_analysis || {})]);
  return rows.length ? { id: item.id, owner } : null;
}

/** A late worker can never remove a replacement worker's lease. */
export async function releaseFilingExecution(db, claim) {
  if (!claim) return;
  await db.query(
    `UPDATE corporate_announcements
     SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) - 'execution_lease'
     WHERE id = $1 AND event_analysis->'execution_lease'->>'owner' = $2`,
    [claim.id, claim.owner]);
}

/** Re-check after slow external calls so a timed-out worker cannot continue into persistence/delivery. */
export async function assertFilingExecution(db, claim) {
  try {
    const { rows } = await db.query(
      `SELECT id, 'filing_execution_owner' AS tag FROM corporate_announcements
       WHERE id = $1 AND event_analysis->'execution_lease'->>'owner' = $2
         AND (event_analysis->'execution_lease'->>'until')::bigint
           > floor(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint`,
      [claim.id, claim.owner]);
    if (rows.length) return;
  } catch (err) {
    throw Object.assign(new Error(`Cannot verify filing ownership: ${err.message}`), { executionLeaseLost: true });
  }
  throw Object.assign(new Error('Filing execution lease expired or was replaced'), { executionLeaseLost: true });
}
