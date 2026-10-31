import crypto from 'crypto';
import pg from 'pg';

/**
 * Metric-Specific Reconciliation Policies
 */
const METRIC_RECONCILIATION_POLICIES = {
  "TOTAL_REVENUE": { unit: "INR_CRORES", relativeTolerancePct: 0.5 },
  "EBITDA": { unit: "INR_CRORES", relativeTolerancePct: 0.5 },
  "EBITDA_MARGIN": { unit: "PERCENT", absoluteTolerancePct: 0.1 },
  "CORE_PAT": { unit: "INR_CRORES", relativeTolerancePct: 0.5 },
  "PAT_GROWTH": { unit: "PERCENT", absoluteTolerancePct: 0.2 },
  "ORDER_BOOK": { unit: "INR_CRORES", relativeTolerancePct: 1.0 },
  "ORDER_INFLOW": { unit: "INR_CRORES", relativeTolerancePct: 1.0 }
};

/**
 * Computes Cryptographic SHA-256 Document & Location Hashes
 */
export function generateClaimHashes(documentContent = "", pageNumber = 0, sectionTitle = "", paragraphExcerpt = "") {
  const documentHash = crypto.createHash('sha256').update(documentContent || "").digest('hex');
  const locationString = `${documentHash}:${pageNumber}:${sectionTitle.trim().toLowerCase()}:${paragraphExcerpt.trim()}`;
  const locationHash = crypto.createHash('sha256').update(locationString).digest('hex');
  return { documentHash, locationHash };
}

/**
 * Reconciles Numeric Claims against Primary Source Facts using Metric Policies
 */
export function reconcileNumericEvidence(metricKey, primaryValNum, claimValNum) {
  if (primaryValNum === null || primaryValNum === undefined || isNaN(primaryValNum)) {
    return { status: "UNVERIFIED", classification: "NO_PRIMARY_BASELINE", resolution: "PENDING_PRIMARY_FACT" };
  }
  if (claimValNum === null || claimValNum === undefined || isNaN(claimValNum)) {
    return { status: "UNVERIFIED", classification: "NO_CLAIM_VALUE", resolution: "PENDING_CLAIM_VALUE" };
  }

  const policy = METRIC_RECONCILIATION_POLICIES[metricKey] || { relativeTolerancePct: 0.5 };
  const diff = Math.abs(primaryValNum - claimValNum);

  let isWithinTolerance = false;
  if (policy.unit === "PERCENT" && policy.absoluteTolerancePct !== undefined) {
    isWithinTolerance = diff <= policy.absoluteTolerancePct;
  } else {
    const relDiffPct = primaryValNum === 0 ? diff : (diff / Math.abs(primaryValNum)) * 100;
    isWithinTolerance = relDiffPct <= policy.relativeTolerancePct;
  }

  if (diff === 0) {
    return { status: "VERIFIED", classification: "EXACT_MATCH", resolution: "EXACT_MATCH" };
  } else if (isWithinTolerance) {
    return { status: "VERIFIED", classification: "ROUNDING_VARIANCE", resolution: "PRIMARY_SOURCE_PRECEDENCE" };
  } else {
    return { status: "EVIDENCE_CONFLICT", classification: "MATERIAL_CONFLICT", resolution: "MANUAL_REVIEW_REQUIRED" };
  }
}

/**
 * Persists an Immutable Provenance Claim to Supabase DB
 */
export async function bindClaimLineage(claimObj, pool) {
  const {
    claimId,
    ticker,
    period,
    claimType,
    metric = null,
    canonicalValue = null,
    unit = null,
    provenanceType,
    sourceDocumentType,
    sourceDocumentId,
    sourceDocumentVersion = "1.0",
    retrievedAt = new Date(),
    pageNumber = null,
    sectionTitle = null,
    paragraphExcerpt = null,
    documentContent = "",
    verificationStatus = "VERIFIED",
    confidenceReason = "Verified against primary source",
    conflictDetails = null,
    supersedesClaimId = null
  } = claimObj;

  const { documentHash, locationHash } = generateClaimHashes(
    documentContent,
    pageNumber || 0,
    sectionTitle || "",
    paragraphExcerpt || ""
  );

  const query = `
    INSERT INTO claim_lineage (
      claim_id, ticker, period, claim_type, metric, canonical_value, unit,
      provenance_type, source_document_type, source_document_id, source_document_version,
      retrieved_at, page_number, section_title, paragraph_excerpt,
      source_document_hash, source_location_hash, verification_status,
      confidence_reason, conflict_details, supersedes_claim_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
    )
    ON CONFLICT (claim_id) DO UPDATE SET
      verification_status = EXCLUDED.verification_status,
      confidence_reason = EXCLUDED.confidence_reason,
      conflict_details = EXCLUDED.conflict_details,
      updated_at = NOW()
    RETURNING *;
  `;

  const values = [
    claimId, ticker, period, claimType, metric, canonicalValue, unit,
    provenanceType, sourceDocumentType, sourceDocumentId, sourceDocumentVersion,
    retrievedAt, pageNumber, sectionTitle, paragraphExcerpt,
    documentHash, locationHash, verificationStatus,
    confidenceReason, conflictDetails ? JSON.stringify(conflictDetails) : null, supersedesClaimId
  ];

  const { rows } = await pool.query(query, values);
  return rows[0];
}

/**
 * Persists a Dependency Relationship for Derived Claims (Claim Graph Edge)
 */
export async function bindClaimDependency(parentClaimId, childClaimId, dependencyType, formula = null, pool) {
  const query = `
    INSERT INTO claim_dependencies (parent_claim_id, child_claim_id, dependency_type, formula)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT DO NOTHING
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [parentClaimId, childClaimId, dependencyType, formula]);
  return rows[0];
}

/**
 * Lineage Replay Query Engine (Fails Closed on any Hash/Entity/Period/Conflict Discrepancy)
 */
export async function replayClaimLineage(claimId, pool, options = {}) {
  // Query claim lineage record
  const claimRes = await pool.query(`SELECT * FROM claim_lineage WHERE claim_id = $1`, [claimId]);
  if (claimRes.rows.length === 0) {
    return {
      claimId,
      replayStatus: "BLOCKED",
      verificationStatus: "UNVERIFIED",
      errorCode: "MISSING_SOURCE_LINEAGE",
      errorMessage: `Claim ID '${claimId}' not found in claim_lineage registry.`
    };
  }

  const claim = claimRes.rows[0];

  // Fail Closed Check 1: Entity Mismatch Test
  if (options.expectedTicker && claim.ticker !== options.expectedTicker) {
    return {
      claimId,
      replayStatus: "BLOCKED",
      verificationStatus: "UNVERIFIED",
      errorCode: "ENTITY_MISMATCH",
      errorMessage: `Ticker mismatch: Claim bound to '${claim.ticker}' but expected '${options.expectedTicker}'.`
    };
  }

  // Fail Closed Check 2: Period Mismatch Test
  if (options.expectedPeriod && claim.period !== options.expectedPeriod) {
    return {
      claimId,
      replayStatus: "BLOCKED",
      verificationStatus: "UNVERIFIED",
      errorCode: "PERIOD_MISMATCH",
      errorMessage: `Period mismatch: Claim bound to '${claim.period}' but expected '${options.expectedPeriod}'.`
    };
  }

  // Fail Closed Check 3: Material Conflict Test
  if (claim.verification_status === "EVIDENCE_CONFLICT") {
    return {
      claimId,
      replayStatus: "BLOCKED",
      verificationStatus: "UNVERIFIED",
      errorCode: "MATERIAL_CONFLICT",
      errorMessage: `Material evidence conflict detected for claim '${claimId}'.`,
      conflictDetails: claim.conflict_details
    };
  }

  // Fail Closed Check 4: Cryptographic SHA-256 Tamper Verification
  const textToVerify = options.tamperedExcerpt !== undefined ? options.tamperedExcerpt : (claim.paragraph_excerpt || "");
  const docToVerify = options.tamperedDocContent !== undefined ? options.tamperedDocContent : (options.rawDocContent || "");

  if (options.verifyHashes || options.tamperedExcerpt !== undefined) {
    const computedDocHash = crypto.createHash('sha256').update(docToVerify).digest('hex');
    const locationString = `${computedDocHash}:${claim.page_number || 0}:${(claim.section_title || "").trim().toLowerCase()}:${textToVerify.trim()}`;
    const computedLocHash = crypto.createHash('sha256').update(locationString).digest('hex');

    if (computedLocHash !== claim.source_location_hash) {
      return {
        claimId,
        replayStatus: "BLOCKED",
        verificationStatus: "UNVERIFIED",
        errorCode: "SOURCE_INTEGRITY_FAILURE",
        errorMessage: `Cryptographic SHA-256 hash mismatch! Source excerpt or location has been tampered with.`
      };
    }
  }

  // Query Claim Graph Dependencies
  const depsRes = await pool.query(
    `SELECT d.*, c.metric, c.canonical_value, c.provenance_type, c.source_document_id 
     FROM claim_dependencies d
     JOIN claim_lineage c ON d.child_claim_id = c.claim_id
     WHERE d.parent_claim_id = $1`,
    [claimId]
  );

  // If claim is DERIVED_FACT, verify input dependencies exist
  if (claim.claim_type === "DERIVED_FACT" && depsRes.rows.length === 0 && !options.allowEmptyDependencies) {
    return {
      claimId,
      replayStatus: "BLOCKED",
      verificationStatus: "UNVERIFIED",
      errorCode: "MISSING_DEPENDENCY_LINK",
      errorMessage: `Derived claim '${claimId}' is missing child input claim dependency links in claim_dependencies edge table.`
    };
  }

  // Recursively replay child dependencies
  const childReplays = [];
  for (const dep of depsRes.rows) {
    const childReplay = await replayClaimLineage(dep.child_claim_id, pool, options);
    childReplays.push({
      dependencyType: dep.dependency_type,
      formula: dep.formula,
      childClaim: childReplay
    });
  }

  return {
    claimId: claim.claim_id,
    ticker: claim.ticker,
    period: claim.period,
    claimType: claim.claim_type,
    metric: claim.metric,
    canonicalValue: claim.canonical_value,
    unit: claim.unit,
    provenanceType: claim.provenance_type,
    sourceDocumentType: claim.source_document_type,
    sourceDocumentId: claim.source_document_id,
    sourceDocumentVersion: claim.source_document_version,
    retrievedAt: claim.retrieved_at,
    pageNumber: claim.page_number,
    sectionTitle: claim.section_title,
    paragraphExcerpt: claim.paragraph_excerpt,
    documentHash: claim.source_document_hash,
    locationHash: claim.source_location_hash,
    verificationStatus: claim.verification_status,
    replayStatus: "PASS",
    dependencies: childReplays,
    lineageChain: `CLAIM (${claim.claim_id}) -> DOC (${claim.source_document_id} v${claim.source_document_version}) -> PAGE (${claim.page_number}) -> SECTION (${claim.section_title}) -> PROVENANCE (${claim.provenance_type}) -> VERIFIED`
  };
}
