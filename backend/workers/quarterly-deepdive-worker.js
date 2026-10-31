/**
 * Quarterly Deep-Dive Worker
 * Processes queued quarterly filings (pending_stage1 and pending_stage2),
 * executes multi-prompt institutional deep-dives, updates management credibility ledger,
 * and emits actionable ADD / HOLD / TRIM Telegram alerts.
 */

import fs from "fs";
import path from "path";
import { pool } from "../db/pool.js";
import { compareFiscalQuartersDesc, parseFiscalQuarter } from "../utils/fiscal-quarter.js";
import { reconcileGuidanceVsActual, classifyGuidanceScope } from "../utils/guidance-scope.js";
import { extractPdfTextDetailed } from "../services/announcement.service.js";
import { sendTelegramMessage, formatAnnouncementMessage, sendConcallDiscrepancyAlert, sendPipelineFailureAlert } from "../services/telegram.service.js";
import { classifyFilingForWorker } from "../services/filing-classifier.service.js";
import { runLlm } from "../services/llm.service.js";
import { decideLlmFailureAction, backoffDelayMs, quotaPauseMs, isQuotaPaused, batchSizeAfterPause } from "../services/retry-policy.service.js";
import { dbStore } from "../services/llm-health.service.js";
import { extractDeterministicFinancials } from "../services/financial-validator.service.js";
import { applyInstitutionalGuard, sanitizeConcallHighlights } from "../services/institutional-guard.service.js";
import { getVerifiedGroundTruth } from "../services/verified-data-layer.service.js";
import { evaluateDualLayerActionGate } from "../services/thesis-gate-evaluator.service.js";
import { extractFinancialsViaLlm } from "../services/financial-table-fallback.service.js";
import {
  routeAlert,
  buildDigestItem,
  isContentFreeDigestItem,
  buildThesisStatusBoard,
  overallThesisStatus,
  shouldSendDigest,
  formatThesisDigestMessage
} from "../services/thesis-digest.service.js";
import {
  buildThesisContext,
  getThesisContract,
  DRIVER_ASSESSMENT_PROMPT_RULES,
  normalizeDriverAssessment,
  mergeDriverAssessments,
  formatDriverAssessmentSection,
  summarizeDriverAssessment
} from "../services/thesis-driver-context.service.js";
import { buildFactRegistry, validateSynthesisClaims, calculateProgrammaticCommitmentStatus } from "../services/fact-registry.service.js";
import { 
  extractAudioUrlFromFiling, 
  downloadAndExtractMp3, 
  analyzeAudioWithGemini, 
  analyzeTranscriptWithGemini, 
  auditDiscrepancies 
} from "../services/audio-transcript-analyzer.service.js";


/**
 * Truncates text safely to 22,000 characters to prevent 504 gateway timeouts.
 */
function capContext(text = "", maxChars = 14000) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  
  // Preserve start (opening statement) and end (Q&A/guidance)
  const half = Math.floor(maxChars / 2);
  const start = text.substring(0, half);
  const end = text.substring(text.length - half);
  return `${start}\n\n[... TRUNCATED MIDDLE CONTENT FOR NIM RATE LIMIT SAFETY ...]\n\n${end}`;
}

/**
 * Formats a filing date into standard Indian Fiscal Quarter (e.g. Q4 FY24, Q1 FY25).
 */
export function getIndianFiscalQuarter(dateInput) {
  if (!dateInput) return "Latest";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "Latest";

  const month = d.getMonth() + 1;
  const year = d.getFullYear();

  let quarter = "";
  let fy = year;

  if (month >= 4 && month <= 6) {
    quarter = "Q4";
    fy = year;
  } else if (month >= 7 && month <= 9) {
    quarter = "Q1";
    fy = year + 1;
  } else if (month >= 10 && month <= 12) {
    quarter = "Q2";
    fy = year + 1;
  } else {
    quarter = "Q3";
    fy = year;
  }

  const fyShort = (fy % 100).toString().padStart(2, "0");
  return `${quarter} FY${fyShort}`;
}

/**
 * Checks if a guidance statement is procedural noise (SEBI compliance / investor meet boilerplate).
 */
export function isProceduralNoise(statement = "", metric = "") {
  const stmtLower = (statement || "").toLowerCase();
  const metricLower = (metric || "").toLowerCase();

  if (
    metricLower === "transparency" ||
    metricLower === "upsi disclosure" ||
    metricLower === "meeting schedule" ||
    metricLower === "general" ||
    metricLower === "disclosure transparency" ||
    metricLower.includes("dividend")
  ) {
    return true;
  }

  if (
    stmtLower.includes("upsi") ||
    stmtLower.includes("unpublished price sensitive") ||
    stmtLower.includes("investor presentation on the company") ||
    stmtLower.includes("trading window") ||
    stmtLower.includes("closure of trading") ||
    stmtLower.includes("analyst meeting") ||
    stmtLower.includes("institutional investor meeting") ||
    stmtLower.includes("no specific commitments") ||
    stmtLower.includes("schedule of analyst") ||
    stmtLower.includes("declaration of un-audited") ||
    stmtLower.includes("approved un-audited") ||
    stmtLower.includes("standalone financial results") ||
    stmtLower.includes("un-audited financial results") ||
    stmtLower.includes("compliant in disclosing") ||
    stmtLower.includes("dividend payout") ||
    stmtLower.includes("declaration of dividend")
  ) {
    return true;
  }

  return false;
}

/**
 * Runs one LLM prompt for the worker (verdicts, concall highlights, table fallback, syntheses).
 * Provider failover (Groq / Gemini / NIM), circuit breaker, Retry-After handling, a hard per-call time budget and a
 * process-wide concurrency cap live in llm-failover.service.js. (The name is historical: NIM is no longer first.)
 */
async function runNimPrompt(systemPrompt, userPrompt, temperature = 0.05, { maxTotalMs } = {}) {
  return runLlm(systemPrompt, userPrompt, { temperature, ...(maxTotalMs ? { maxTotalMs } : {}) });
}

/**
 * Each verdict chunk call is bounded so a whole transcript (up to 5 chunks on 2 lanes) finishes inside the worker
 * deadline even when providers hang; otherwise the process could be killed before the outage is recorded.
 */
const VERDICT_CHUNK_BUDGET_MS = 75000;

/**
 * Dynamically resolves accurate stage label for alerts and prompt instructions based on filing characteristics.
 */
export function getFilingStageDetails(status, title = "", text = "") {
  const titleLower = (title || "").toLowerCase();

  if (status === "pending_audio") {
    return {
      stageName: "Stage 2: Concall Audio / Recording",
      promptStage: "Stage 2 (Concall Audio / Recording Re-assessment)"
    };
  }

  if (status === "pending_stage2" || titleLower.includes("transcript") || titleLower.includes("concall") || titleLower.includes("earnings call")) {
    return {
      stageName: "Stage 2: Concall Transcript",
      promptStage: "Stage 2 (Concall Transcript Re-assessment)"
    };
  }

  // Stage 1 specialized classifications
  const isAgm = titleLower.includes("agm") || 
                titleLower.includes("annual general meeting") || 
                titleLower.includes("annual report") || 
                titleLower.includes("shareholders meeting") || 
                titleLower.includes("general meeting");

  const isPpt = titleLower.includes("presentation") || 
                titleLower.includes("investor presentation") || 
                titleLower.includes("earnings presentation") || 
                titleLower.includes("investor deck");

  const isResults = titleLower.includes("financial result") || 
                    titleLower.includes("financials") || 
                    titleLower.includes("outcome of board") || 
                    titleLower.includes("un-audited") || 
                    titleLower.includes("unaudited") || 
                    titleLower.includes("audited financial") || 
                    titleLower.includes("quarterly result");

  if (isAgm && !isResults && !isPpt) {
    return {
      stageName: "Stage 1: AGM & Annual Report Notice",
      promptStage: "Stage 1 (AGM Notice & Annual Report Audit)"
    };
  } else if (isPpt && !isResults) {
    return {
      stageName: "Stage 1: Investor Presentation (PPT)",
      promptStage: "Stage 1 (Investor Presentation Deep-Dive)"
    };
  } else if (isResults && isPpt) {
    return {
      stageName: "Stage 1: Earnings Results & PPT",
      promptStage: "Stage 1 (Earnings Results + PPT Audit)"
    };
  } else if (isResults) {
    return {
      stageName: "Stage 1: Financial Results",
      promptStage: "Stage 1 (Quarterly Financial Results Audit)"
    };
  } else if (isAgm) {
    return {
      stageName: "Stage 1: AGM & Annual Report",
      promptStage: "Stage 1 (AGM & Annual Report Audit)"
    };
  }

  return {
    stageName: "Stage 1: Corporate Filing & Updates",
    promptStage: "Stage 1 (Corporate Filing & Business Updates)"
  };
}

const LLM_UNAVAILABLE_SUMMARY = "AI synthesis unavailable for this filing; verified figures only.";
const ACTION_CAUTION_RANK = { EXIT: 0, TRIM: 1, HOLD: 2, ADD: 3, "STRONG BUY": 4, BUY: 3 };

function parseVerdictJson(resText) {
  if (!resText || typeof resText !== "string") return null;
  let cleaned = resText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/,\s*([\}\]])/g, "$1")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    try {
      const sanitised = cleaned
        .replace(/:\s*"([^"]*?)"(?=\s*[,\}])/g, (m, val) => `: "${val.replace(/[\r\n]/g, ' ').replace(/"/g, "'")}"`)
        .replace(/[\r\n\t]/g, " ");
      return JSON.parse(sanitised);
    } catch (e2) {
      const signalMatch = cleaned.match(/"action_signal"\s*:\s*"(BUY|ADD|HOLD|TRIM|EXIT)"/i);
      const scoreMatch = cleaned.match(/"conviction_score"\s*:\s*(\d{1,2})/);
      const credMatch = cleaned.match(/"credibility_tier"\s*:\s*"(Tier\s*[123])"/i);
      const summaryMatch = cleaned.match(/"verdict_summary"\s*:\s*"([^"]+)"/i);
      // Only salvage a genuine summary. A bare/guessed signal must never turn into a fabricated ADD.
      if (summaryMatch) {
        return {
          action_signal: signalMatch ? signalMatch[1].toUpperCase() : "HOLD",
          conviction_score: scoreMatch ? parseInt(scoreMatch[1], 10) : 5,
          credibility_tier: credMatch ? credMatch[1] : "Tier 2",
          verdict_summary: summaryMatch[1],
          key_drivers: [],
          commitments: [],
          _salvaged: true
        };
      }
      console.warn("[WORKER CHUNK WARN] Complete JSON repair fallback triggered:", e2.message);
      return null;
    }
  }
}

/**
 * Formulates Institutional Action Verdict (ADD / HOLD / TRIM + Credibility Tier), judged against the
 * stock's thesis drivers. Never fabricates a verdict: if every LLM call fails the result is flagged `_llm_failed`.
 *
 * @param {object} opts
 * @param {string} [opts.periodLabel] reporting period the filing belongs to (e.g. "Q2 FY27")
 */
export async function evaluateInstitutionalVerdict(ticker, thesis, text, stage, title = "", opts = {}) {
  const systemPrompt = `You are a Chief Investment Officer at an institutional long-only fund evaluating Indian growth equities.
Be extremely decisive, objective, and evidence-driven. Zero fluff allowed.`;

  const stageInfo = getFilingStageDetails(stage, title, text);
  const thesisCtx = buildThesisContext(ticker, thesis);
  const drivers = thesisCtx.drivers;
  const periodLine = opts.periodLabel
    ? `Reporting period of this filing: ${opts.periodLabel}. Treat ONLY ${opts.periodLabel} as the current quarter; never label any other quarter as current.`
    : "";

  // NOTE: the long-form 'strategic_accountability' / 'strategic_evolution' templates in prompt_templates are
  // markdown-report instructions for the syntheses. They must NEVER be appended here: this prompt demands a JSON
  // object, and the longer report template wins, so every chunk came back as prose and the filing dead-lettered.

  // Split long documents into overlapping 10,000-character chunks so the whole Q&A is audited (not just the head/tail)
  const fullText = text || "";
  const llmText = capContext(fullText, 46000);
  const CHUNK_SIZE = 10000;
  const OVERLAP = 1000;
  let textChunks = [];

  if (llmText.length <= CHUNK_SIZE) {
    textChunks = [llmText];
  } else {
    let offset = 0;
    while (offset < llmText.length && textChunks.length < 5) {
      textChunks.push(llmText.substring(offset, offset + CHUNK_SIZE));
      offset += (CHUNK_SIZE - OVERLAP);
    }
  }

  let rateLimitedChunks = 0; // of those, chunks where the providers answered 429 (quota pressure)
  const retryAfterHints = [];
  let outageChunks = 0;   // chunks whose LLM call failed on every provider
  let unusableChunks = 0; // chunks whose reply could not be used (prose, empty, bad JSON)
  const runChunk = async (chunkText, idx) => {
    const userPrompt = `
Ticker: ${ticker}
Stage: ${stageInfo.promptStage}
${periodLine}
Document Part: ${idx + 1} of ${textChunks.length}
Investment Thesis Context:
${thesisCtx.text}

Filing Content (Part ${idx + 1}):
${chunkText}

── Tasks ──
1. Evaluate Management Credibility (Tier 1: High Track Record / Promises Kept | Tier 2: Neutral / Unproven | Tier 3: High Risk / Overpromises).
2. Determine Institutional Action Signal: ADD, HOLD, or TRIM.
3. List 3 concrete reasons supporting this signal.
4. Extract 1-2 core management commitments with target timelines.
5. EXPLICITLY DETECT GUIDANCE DELAYS: If a past commitment (e.g., plant commissioning, margin target, receivable reduction) was pushed back by 1-2 quarters in this concall/PPT, mark status as "Delayed", update the timeline, and extract the EXACT reason management gave into blockers_and_risks.
6. VERIFY EACH THESIS DRIVER listed above against this filing (see thesis driver rules below).

── Institutional Financial & Thesis Rules ──
1. MANDATORY YOY PRECEDENCE: YoY comparison (the current quarter vs the same quarter of the previous year) is MANDATORY and MUST take precedence over QoQ sequential comparisons. If PAT contracts YoY (> -10%) or EBITDA margin contracts YoY (> -200 bps), the summary MUST lead with this YoY contraction as the headline financial result. NEVER bury a YoY profit or margin decline behind a QoQ sequential recovery framing.
2. PAT PRECISION: Always extract Consolidated Net Profit (PAT) attributable to Owners of the Company. NEVER use intermediate pre-tax, pre-associate, or standalone line items when consolidated tables are present.
3. MANDATORY EBITDA & MARGINS: Always extract/calculate EBITDA (PBT + Finance Costs + Depreciation) and EBITDA Margin % (EBITDA / Revenue * 100). Include EBITDA YoY % growth and EBITDA Margin bps expansion/contraction.
4. SEGMENT RED FLAG DETECTION: Extract all segment-wise results (Revenue & EBIT) and explicitly highlight any segment experiencing a YoY revenue/EBIT decline > 20% as a Segment Red Flag (e.g. Segment A EBIT declining > 20% YoY). NEVER claim 'no red flags' when a major segment collapses YoY.
5. MULTI-VERTICAL THESIS RESPECT: NEVER claim a company has single-segment operations or lacks growth catalysts when the investment thesis or filing explicitly details multiple business verticals.
6. ANTI-HALLUCINATION: NEVER report future-period numbers as actual achieved performance. Label any forward figure as 'Management Target/Guidance', never actuals.
7. ACTION SIGNAL RECALIBRATION:
   - If PAT contracts > 15% YoY or EBITDA Margin contracts > 300 bps YoY, Action Signal MUST NOT be BUY/ADD. Evaluate as HOLD (Conviction 5/10) or TRIM (Conviction 4/10).
   - If Revenue, EBITDA and PAT all show a clean double-digit YoY beat with stable or expanding margin alongside live structural catalysts, evaluate Action Signal as ADD (Conviction 8-9/10).
8. STRICT GUIDANCE DISAMBIGUATION: NEVER mix quarterly guidance with full-year annual guidance or multi-year visions.
   - Set guidance_scope = "QUARTERLY" if the target applies strictly to a single upcoming quarter.
   - Set guidance_scope = "ANNUAL" if the target is for the full fiscal year.
   - Set guidance_scope = "MULTI_YEAR" if the target spans 3-5 years.
   - Set guidance_scope = "CAPEX_MILESTONE" for physical plant commissioning, demergers, and capacity expansions.
9. NUMBERS: Quote only figures that appear in the filing text. Do not compute growth rates yourself — the verified numbers are injected separately.
10. NO PLACEHOLDERS: Never output template tokens such as X, Y, Z, "₹X Cr" or "details". If the filing does not state a figure, name the item without a number or omit the item; return an empty list when the filing has nothing for a field.
${DRIVER_ASSESSMENT_PROMPT_RULES}

Return ONLY a valid JSON object:
{
  "credibility_tier": "Tier 1" | "Tier 2" | "Tier 3",
  "action_signal": "ADD" | "HOLD" | "TRIM",
  "conviction_score": 1 to 10,
  "verdict_summary": "2-3 sentence executive summary explaining the ADD/HOLD/TRIM rating.",
  "key_drivers": ["Driver 1", "Driver 2", "Driver 3"],
  "key_positives": ["<a growth beat, margin expansion, contract win or operating-leverage point that THIS filing states>"],
  "key_concerns_and_drags": ["<a margin compression, cost spike, segment decline or working-capital point that THIS filing states>"],
  "thesis_operational_kpis": ["<KPI name>: <figure and unit exactly as printed in THIS filing>"],
  "concall_verification_points": ["<specific open question to verify in the management Q&A>"],
  "thesis_driver_assessment": [
    { "driver": "<exact driver name from the list>", "status": "CONFIRMED" | "ON_TRACK" | "AT_RISK" | "BROKEN" | "NO_EVIDENCE", "evidence": "<=200 chars with facts from THIS filing" }
  ],
  "commitments": [
    {
      "statement": "Commitment text",
      "metric": "Metric name (e.g. Revenue, EBITDA Margin, Plant Commissioning, Receivables Days)",
      "target_value": "Target figure with unit, as stated in the filing",
      "guidance_scope": "QUARTERLY" | "ANNUAL" | "MULTI_YEAR" | "CAPEX_MILESTONE",
      "timeline": "Target quarter, fiscal year or year range exactly as stated in the filing",
      "status": "Pending" | "Achieved" | "Partially Achieved" | "Missed",
      "status_rule": "CRITICAL: For multi-stage regulatory processes (e.g. Demergers, NCLT approvals, QIP allotments, Plant Commissioning), initial Board approval MUST be marked status 'Pending' (In Progress). Mark 'Achieved' ONLY when final operational completion or regulatory clearance is explicitly documented in the evidence.",
      "blockers_and_risks": "If Delayed or Missed, specify the exact reason given by management in concall (e.g. 'Equipment lead time & customs clearance delay by 2 quarters')",
      "credibility_impact": "positive" | "neutral" | "negative"
    }
  ]
}

Respond with the JSON object only. The first character of your reply must be { (no markdown, no headings).
`;
    try {
      const resText = await runNimPrompt(systemPrompt, userPrompt, 0.05, { maxTotalMs: VERDICT_CHUNK_BUDGET_MS });
      const parsed = parseVerdictJson(resText);
      if (parsed) return parsed;
      if (!resText) { unusableChunks += 1; return null; }
      // The model answered in prose. Re-ask once with a strict JSON-only instruction; a prose reply is not an outage.
      console.warn(`[WORKER CHUNK WARN] Part ${idx + 1} reply was not valid JSON; re-asking once for JSON only.`);
      const strictPrompt = `${userPrompt}
Your previous reply was not valid JSON. Reply again with ONLY the JSON object described above: no markdown, no headings, no commentary. The first character of your reply must be { and the last must be }.`;
      const second = parseVerdictJson(await runNimPrompt(systemPrompt, strictPrompt, 0.05, { maxTotalMs: VERDICT_CHUNK_BUDGET_MS }));
      if (!second) unusableChunks += 1;
      return second;
    } catch (err) {
      // chainExhausted: every provider failed for this call (AI outage), as opposed to a reply we could not use
      if (err?.chainExhausted) {
        outageChunks += 1;
        if (err.rateLimited) { rateLimitedChunks += 1; if (Number.isFinite(err.retryAfterMs)) retryAfterHints.push(err.retryAfterMs); }
      } else unusableChunks += 1;
      console.warn(`[WORKER CHUNK WARN] Part ${idx + 1} extraction failed:`, err.message);
    }
    return null;
  };

  // Bounded concurrency (2) keeps NIM 429s rare while still auditing every chunk
  const chunkResults = new Array(textChunks.length).fill(null);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(2, textChunks.length) }, async () => {
    while (cursor < textChunks.length) {
      const idx = cursor++;
      chunkResults[idx] = await runChunk(textChunks[idx], idx);
    }
  });
  await Promise.all(lanes);

  const finData = extractDeterministicFinancials(fullText);

  // Merge and deduplicate commitments & drivers from ALL chunks
  const validResults = chunkResults.filter(Boolean);
  if (validResults.length === 0) {
    // Never fabricate a verdict: flag the failure so the worker can retry / degrade honestly.
    const failed = {
      _llm_failed: true,
      // true only when EVERY failed chunk was a provider outage: that is waited out, not blamed on the filing
      _llm_outage: outageChunks > 0 && unusableChunks === 0,
      _llm_rate_limited: rateLimitedChunks > 0 && unusableChunks === 0,
      _llm_retry_after_ms: retryAfterHints.length ? Math.min(...retryAfterHints) : null,
      credibility_tier: "Tier 2",
      action_signal: "HOLD",
      conviction_score: 5,
      verdict_summary: LLM_UNAVAILABLE_SUMMARY,
      key_drivers: [],
      key_positives: [],
      key_concerns_and_drags: [],
      thesis_operational_kpis: [],
      concall_verification_points: [],
      thesis_driver_assessment: normalizeDriverAssessment([], drivers),
      commitments: []
    };
    failed._raw_text = fullText;
    return applyInstitutionalGuard(failed, finData, title, ticker);
  }

  // Cautious aggregation: the most cautious signal across chunks wins, the average conviction is used,
  // and the weakest credibility tier is kept (one chunk finding an overpromise matters).
  const signalOf = (r) => String(r.action_signal || "HOLD").toUpperCase().trim();
  const cautious = [...validResults].sort((x, y) => (ACTION_CAUTION_RANK[signalOf(x)] ?? 2) - (ACTION_CAUTION_RANK[signalOf(y)] ?? 2))[0];
  const tierNum = (r) => parseInt(String(r.credibility_tier || "Tier 2").replace(/\D/g, ""), 10) || 2;
  const worstTier = Math.max(...validResults.map(tierNum));
  const avgConv = Math.round(validResults.reduce((sum, r) => sum + (Number(r.conviction_score) || 5), 0) / validResults.length);
  const summaryOwner = validResults.find(r => r.verdict_summary) || cautious;

  const mergedVerdict = {
    credibility_tier: `Tier ${worstTier}`,
    action_signal: signalOf(cautious),
    conviction_score: avgConv,
    verdict_summary: summaryOwner.verdict_summary || "",
    key_drivers: [],
    key_positives: [],
    key_concerns_and_drags: [],
    thesis_operational_kpis: [],
    concall_verification_points: [],
    commitments: []
  };

  const seenStatements = new Set();
  const seenDrivers = new Set();
  const seenPositives = new Set();
  const seenDrags = new Set();
  const seenKpis = new Set();
  const seenPoints = new Set();
  const pushUnique = (target, seen, value) => {
    if (typeof value !== "string") return;
    const key = value.toLowerCase();
    if (value && !seen.has(key)) { seen.add(key); target.push(value); }
  };

  for (const res of validResults) {
    (res.key_drivers || []).forEach(d => pushUnique(mergedVerdict.key_drivers, seenDrivers, d));
    (res.key_positives || []).forEach(p => pushUnique(mergedVerdict.key_positives, seenPositives, p));
    (res.key_concerns_and_drags || []).forEach(d => pushUnique(mergedVerdict.key_concerns_and_drags, seenDrags, d));
    (res.thesis_operational_kpis || []).forEach(k => pushUnique(mergedVerdict.thesis_operational_kpis, seenKpis, k));
    (res.concall_verification_points || []).forEach(pt => pushUnique(mergedVerdict.concall_verification_points, seenPoints, pt));
    for (const c of (res.commitments || [])) {
      const sKey = ((c && c.statement) || "").toLowerCase().trim();
      if (sKey && !seenStatements.has(sKey)) {
        seenStatements.add(sKey);
        mergedVerdict.commitments.push(c);
      }
    }
  }

  mergedVerdict.thesis_driver_assessment = mergeDriverAssessments(validResults.map(r => r.thesis_driver_assessment), drivers);
  mergedVerdict._raw_text = fullText;
  return applyInstitutionalGuard(mergedVerdict, finData, title, ticker);
}

/**
 * Reconciles previous quarter guidance against currently reported revenue & growth.
 * Uses strict horizon classification to prevent mixing quarterly guidance with annual guidance.
 */
export async function reconcilePriorGuidanceVsActual(ticker, currentQuarter, currentFinancials = {}) {
  if (!ticker) return null;
  try {
    const { rows } = await pool.query(
      `SELECT statement, metric, target_value, timeline, quarter 
       FROM management_commitments 
       WHERE ticker = $1 
         AND (
           LOWER(metric) LIKE '%revenue%' OR 
           LOWER(metric) LIKE '%topline%' OR
           LOWER(metric) LIKE '%growth%' OR 
           LOWER(metric) LIKE '%guidance%' OR
           LOWER(statement) LIKE '%revenue%' OR
           LOWER(statement) LIKE '%growth%' OR
           LOWER(statement) LIKE '%guidance%'
         )
       ORDER BY created_at DESC LIMIT 15`,
      [ticker]
    );

    if (rows.length === 0) return null;

    return reconcileGuidanceVsActual({
      commitments: rows,
      currentQuarter,
      currentFinancials
    });
  } catch (err) {
    console.warn(`[GUIDANCE RECONCILE WARN] ${ticker}:`, err.message);
    return null;
  }
}

const MAX_DEEP_DIVE_ATTEMPTS = 3;
// A filing whose PDF could not be DOWNLOADED (exchange CDN not replicated yet, 404/5xx, timeout) is not broken:
// the scanner waits for the CDN the same way. At one attempt per 5-minute cycle this is roughly an hour of patience.
const MAX_FETCH_ATTEMPTS = 12;
// A results statement that stays unreadable after OCR is usually an overloaded OCR/LLM provider, not a hopeless PDF:
// about 30 minutes of patience (one attempt per 5-minute cycle) before a failure alert replaces the narrative.
const MAX_UNREADABLE_STATEMENT_ATTEMPTS = 6;
// A concall recording that is not downloadable yet: same backoff, about two hours of patience.
const MAX_AUDIO_ATTEMPTS = 6;

/**
 * Maps a statement period-end date (YYYY-MM-DD) to the Indian fiscal quarter label (e.g. 2026-09-30 -> "Q2 FY27").
 */
export function quarterFromPeriodEnd(isoDate) {
  if (!isoDate) return null;
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  let q;
  if (month >= 4 && month <= 6) q = 1;
  else if (month >= 7 && month <= 9) q = 2;
  else if (month >= 10 && month <= 12) q = 3;
  else q = 4;
  const fy = month >= 4 ? year + 1 : year;
  return `Q${q} FY${String(fy % 100).padStart(2, "0")}`;
}

function resolveReportingQuarter(item, fin) {
  return quarterFromPeriodEnd(fin?.quarterEnded) || getIndianFiscalQuarter(item.filing_date);
}

/**
 * Records a failed processing attempt; returns the new attempt count.
 */
// One counter per failure stage, so retries spent on one problem (e.g. nine download attempts while the exchange CDN
// lagged) never shorten the budget of an unrelated one (an unusable AI reply).
const ATTEMPT_COUNTERS = {
  error: "deep_dive_attempts",
  fetch: "fetch_attempts",
  notext: "notext_attempts",
  unreadable: "unreadable_attempts",
  llm: "llm_attempts",
  audio: "audio_attempts"
};
export const ATTEMPT_COUNTER_KEYS = Object.values(ATTEMPT_COUNTERS);

async function recordDeepDiveAttempt(itemId, message, kind = "error") {
  const key = ATTEMPT_COUNTERS[kind] || ATTEMPT_COUNTERS.error;
  const { rows } = await pool.query(
    `UPDATE corporate_announcements
     SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) || jsonb_build_object(
           'pipeline_error', $1::text,
           'failed_at', NOW(),
           $3::text, COALESCE((event_analysis->>$3)::int, 0) + 1)
     WHERE id = $2
     RETURNING (event_analysis->>$3)::int AS attempts`,
    [String(message || "unknown error").slice(0, 500), itemId, key]
  );
  return rows[0]?.attempts || 1;
}

// ── Free-tier rate limits (HTTP 429) ──
// When every provider rate-limits a call, hammering on with parallel filings only burns time on an exhausted quota. The whole
// queue pauses instead (10, 30, 60, 120, 180 minutes, never less than the provider asked for), then works ONE filing at a
// time, results first, until a success clears the pause. State lives in system_settings so it survives the 5-minute restarts
// and is shared with the GitHub Actions failover.
const QUOTA_PAUSE_KEY = "llm_quota_pause";
const QUOTA_ESCALATION_WINDOW_MS = 6 * 60 * 60 * 1000;

async function readQuotaPause() {
  try {
    const v = await dbStore(pool).get(QUOTA_PAUSE_KEY);
    return v && typeof v === "object" && Number.isFinite(v.until) ? v : null;
  } catch (err) {
    console.warn("[WORKER] Could not read the quota pause:", err.message);
    return null;
  }
}

async function writeQuotaPause(pause) {
  try {
    await dbStore(pool).set(QUOTA_PAUSE_KEY, pause);
  } catch (err) {
    console.warn("[WORKER] Could not record the quota pause:", err.message);
  }
}

/** Records that the AI providers rate-limited us. A pause already running (set by a sibling filing) is left alone; an expired one escalates. */
async function recordQuotaPressure(providerRetryAfterMs) {
  const now = Date.now();
  const previous = await readQuotaPause();
  if (isQuotaPaused(previous, now)) return previous;
  const recent = previous && now - previous.until < QUOTA_ESCALATION_WINDOW_MS;
  const count = recent ? (previous.count || 0) + 1 : 1;
  const pause = { until: now + quotaPauseMs(count, providerRetryAfterMs), count };
  await writeQuotaPause(pause);
  console.warn(`[WORKER] AI providers rate-limited (429). Queue paused for ${Math.round((pause.until - now) / 60000)} min (pause #${count}); then one filing at a time.`);
  return pause;
}

/**
 * Holds a filing back until a later time: the queue skips it until `retry_not_before` has passed, so a failing filing
 * (or an overloaded provider) is not hit again every 5-minute cycle.
 */
async function deferRetry(itemId, delayMs) {
  if (!(delayMs > 0)) return;
  await pool.query(
    `UPDATE corporate_announcements
     SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) || jsonb_build_object('retry_not_before', $1::text)
     WHERE id = $2`,
    [new Date(Date.now() + delayMs).toISOString(), itemId]
  ).catch(e => console.warn("[WORKER] Could not record retry delay:", e.message));
}

/**
 * Records that the AI providers were down when this filing needed them. Unlike recordDeepDiveAttempt this does NOT
 * consume a processing attempt: an outage is not the filing's fault.
 * @returns {{firstAtMs: number, retries: number}} when the filing first met the outage, and how many times since
 */
async function recordLlmOutage(itemId, message) {
  const { rows } = await pool.query(
    `UPDATE corporate_announcements
     SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) || jsonb_build_object(
           'pipeline_error', $1::text,
           'failed_at', NOW(),
           'llm_outage_first_at', COALESCE(event_analysis->>'llm_outage_first_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
           'llm_outage_retries', COALESCE((event_analysis->>'llm_outage_retries')::int, 0) + 1)
     WHERE id = $2
     RETURNING event_analysis->>'llm_outage_first_at' AS first_at, (event_analysis->>'llm_outage_retries')::int AS retries`,
    [String(message || "AI providers unavailable").slice(0, 500), itemId]
  );
  const parsed = rows[0]?.first_at ? new Date(rows[0].first_at).getTime() : NaN;
  return { firstAtMs: Number.isFinite(parsed) ? parsed : Date.now(), retries: rows[0]?.retries || 1 };
}

async function escalateToReview(item, message, suppressTelegram) {
  await pool.query(
    `UPDATE corporate_announcements
     SET deep_dive_status = 'needs_review',
         event_analysis = COALESCE(event_analysis, '{}'::jsonb) || jsonb_build_object('pipeline_error', $1::text, 'failed_at', NOW())
     WHERE id = $2`,
    [String(message || "unknown error").slice(0, 500), item.id]
  );
  if (!suppressTelegram) {
    await sendPipelineFailureAlert({
      ticker: item.ticker,
      title: item.title,
      error: message,
      docUrl: item.attachment_url
    }).catch(e => console.warn("[WORKER ALERT ERROR]:", e.message));
  }
}

/**
 * Sends an alert and records the outcome on the filing row.
 * A failed send is NEVER dropped: the message text is parked on the row and re-sent by flushPendingAlerts().
 */
async function deliverWorkerAlert(item, text, { suppressTelegram = false } = {}) {
  if (suppressTelegram) return { sent: false, suppressed: true };
  try {
    await sendTelegramMessage(text);
    await pool.query(
      `UPDATE corporate_announcements
       SET sent_to_telegram = true,
           event_analysis = (COALESCE(event_analysis, '{}'::jsonb) - 'alert_pending' - 'pending_alert_text' - 'alert_error') || jsonb_build_object('alert_sent_at', NOW())
       WHERE id = $1`,
      [item.id]
    );
    return { sent: true };
  } catch (err) {
    console.error(`[WORKER ALERT] Telegram delivery failed for ${item.ticker}: ${err.message}. Parking alert for retry.`);
    await pool.query(
      `UPDATE corporate_announcements
       SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) || jsonb_build_object('alert_pending', true, 'pending_alert_text', $1::text, 'alert_error', $2::text)
       WHERE id = $3`,
      [text, String(err.message || "").slice(0, 300), item.id]
    ).catch(e => console.error("[WORKER ALERT] Could not park alert:", e.message));
    return { sent: false, error: err };
  }
}

/**
 * Re-sends alerts that failed to deliver in an earlier run (Telegram outage, rate limit, process restart).
 */
export async function flushPendingAlerts(limit = 10) {
  let flushed = 0;
  try {
    const { rows } = await pool.query(
      `SELECT id, ticker, title, event_analysis->>'pending_alert_text' AS txt
       FROM corporate_announcements
       WHERE event_analysis->>'alert_pending' = 'true'
         AND created_at > NOW() - INTERVAL '10 days'
       ORDER BY filing_date DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    for (const row of rows) {
      if (!row.txt) {
        await pool.query(`UPDATE corporate_announcements SET event_analysis = event_analysis - 'alert_pending' WHERE id = $1`, [row.id]);
        continue;
      }
      const res = await deliverWorkerAlert({ id: row.id, ticker: row.ticker }, row.txt);
      if (res.sent) {
        flushed++;
        console.log(`[WORKER ALERT] Re-sent parked alert for ${row.ticker}: ${row.title}`);
      } else {
        break; // Telegram still unavailable; try again next run
      }
    }
  } catch (err) {
    console.warn("[WORKER ALERT] Pending alert flush failed:", err.message);
  }
  return flushed;
}

/**
 * Latest verified financials for a stock (used to judge concall transcripts / decks that carry no statements).
 */
async function loadCarriedFinancials(ticker) {
  try {
    const { rows } = await pool.query(
      `SELECT event_analysis->'institutional_verdict'->'verified_financials' AS vf, filing_date
       FROM corporate_announcements
       WHERE ticker = $1
         AND deep_dive_status = 'completed'
         AND event_analysis->'institutional_verdict'->'verified_financials' IS NOT NULL
         AND COALESCE(filing_date, created_at) > NOW() - INTERVAL '150 days'
       ORDER BY filing_date DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [ticker]
    );
    if (rows.length > 0 && rows[0].vf && typeof rows[0].vf === "object") {
      return { fin: rows[0].vf, filingDate: rows[0].filing_date };
    }
  } catch (err) {
    console.warn(`[WORKER] Could not load carried-forward financials for ${ticker}:`, err.message);
  }
  return null;
}

const fmtPct = (v) => (v === null || v === undefined || isNaN(v)) ? null : `${v >= 0 ? "+" : ""}${v}%`;

/**
 * Verified-number block built straight from the deterministic parser (never from LLM text).
 */
function buildVerifiedFinancialsBlock(fin, { carried = false, periodLabel = null } = {}) {
  if (!fin || fin.revenue === null || fin.revenue === undefined) return "";
  const scope = fin.statementScope && fin.statementScope !== "UNKNOWN" ? fin.statementScope.toLowerCase() : "reported";
  const lines = [];
  const rev = [fmtPct(fin.revenueYoYGrowthPct) && `${fmtPct(fin.revenueYoYGrowthPct)} YoY`, fmtPct(fin.revenueQoQGrowthPct) && `${fmtPct(fin.revenueQoQGrowthPct)} QoQ`].filter(Boolean).join(" | ");
  lines.push(`• *Revenue:* ₹${fin.revenue} Cr${rev ? ` (${rev})` : ""}`);
  if (fin.ebitda !== null && fin.ebitda !== undefined) {
    const bps = (fin.ebitdaMarginBpsDelta !== null && fin.ebitdaMarginBpsDelta !== undefined) ? `, ${fin.ebitdaMarginBpsDelta >= 0 ? "+" : ""}${fin.ebitdaMarginBpsDelta} bps YoY` : "";
    const eYoY = fmtPct(fin.ebitdaYoYGrowthPct);
    lines.push(`• *EBITDA:* ₹${fin.ebitda} Cr${eYoY ? ` (${eYoY} YoY)` : ""} — margin ${fin.ebitdaMarginPct}%${bps}`);
  }
  const patVal = fin.patAttributable ?? fin.patConsolidated;
  if (patVal !== null && patVal !== undefined) {
    const pat = [fmtPct(fin.patYoYGrowthPct) && `${fmtPct(fin.patYoYGrowthPct)} YoY`, fmtPct(fin.patQoQGrowthPct) && `${fmtPct(fin.patQoQGrowthPct)} QoQ`].filter(Boolean).join(" | ");
    const turn = fin.patTurnaround === "LOSS_TO_PROFIT" ? " (turnaround from loss)" : fin.patTurnaround === "PROFIT_TO_LOSS" ? " (swing to loss)" : "";
    lines.push(`• *PAT (owners):* ₹${patVal} Cr${pat ? ` (${pat})` : ""}${turn}`);
  }
  if (fin.exceptionalGain) {
    lines.push(`• ⚠️ *Exceptional gain:* ₹${fin.exceptionalGain} Cr → Normalised PAT ₹${fin.normalisedPat} Cr${fmtPct(fin.normalisedPatYoYGrowthPct) ? ` (${fmtPct(fin.normalisedPatYoYGrowthPct)} YoY)` : ""}`);
  }
  for (const flag of (fin.segmentRedFlags || []).slice(0, 2)) {
    lines.push(`• 🔴 *Segment red flag:* ${flag.segment} down ${Math.abs(flag.yoyDeclinePct)}% YoY (₹${flag.currentValue} Cr vs ₹${flag.prevValue} Cr)`);
  }
  const head = carried
    ? `📊 *LATEST VERIFIED RESULTS${periodLabel ? ` (${periodLabel})` : ""}:*`
    : (fin.verification === "LLM_LOCATED_TEXT_GROUNDED"
        ? `📊 *FINANCIALS — AI-LOCATED, UNVERIFIED (${scope}${periodLabel ? `, ${periodLabel}` : ""}):*`
        : `📊 *VERIFIED FINANCIALS (${scope}${periodLabel ? `, ${periodLabel}` : ""}):*`);
  return `\n${head}\n${lines.join("\n")}\n`;
}

const GATE_BADGES = {
  THESIS_CONFIRMED_BEAT: "🟢 *Thesis Confirmed Beat*",
  GROWING_BUT_THESIS_UNCONFIRMED: "🟡 *Growing, but Thesis Unconfirmed*",
  GATES_PASS_ANALYSIS_BEARISH: "🟡 *Numbers pass, analysis flags a risk*",
  UNVERIFIED_FIGURES: "🟡 *Figures unverified — no buy authorised*",
  THESIS_DRIVER_BROKEN: "🔴 *Thesis Driver Broken*",
  THESIS_DEVIATION: "🔴 *Thesis Deviation*",
  DATA_UNAVAILABLE: "⚪ *Verified data unavailable*",
  NO_CONTRACT: "⚪ *No thesis contract*",
  NO_FINANCIALS_IN_FILING: "⚪ *No financial statements in this filing*",
  NO_FINANCIALS_BEARISH_READ: "🟡 *Cautious read, no statements to confirm*",
  NEUTRAL_HOLD: "⚪ *Neutral*"
};

function buildGateSection(gateInfo) {
  if (!gateInfo || !gateInfo.decisionExplanation) return "";
  const badge = GATE_BADGES[gateInfo.statusClassification] || "⚪ *Gate result*";
  let section = `\n🎯 *THESIS GATE AUDIT:* ${badge}\n• ${gateInfo.decisionExplanation}\n`;
  const hurdle = gateInfo.thesisGate;
  if (hurdle && (hurdle.status === "FAIL" || hurdle.status === "PASS") && hurdle.hurdlesEvaluated && hurdle.hurdlesEvaluated !== "None") {
    section += `• _Thesis hurdles:_ ${hurdle.status === "PASS" ? "✅ met" : `❌ ${hurdle.reason}`}\n`;
  }
  return section;
}

function actionSignalLabel(action) {
  const a = String(action || "").toUpperCase();
  if (a.includes("BUY") || a.includes("ADD")) return "🟢 *BUY / ACCUMULATE*";
  if (a === "WATCH / WAIT FOR CONFIRMATION") return "🟡 *WATCH / WAIT FOR THESIS CONFIRMATION*";
  if (a === "REASSESS THESIS") return "🔴 *REASSESS THESIS*";
  return "🟡 *HOLD / MONITOR*";
}

/** Header line of an alert. When the AI produced no verdict there is no conviction or credibility to report. */
function actionSignalLine(verdict) {
  const label = actionSignalLabel(verdict.final_action || verdict.action_signal);
  if (verdict._llm_failed) return `🎯 *ACTION SIGNAL:* ${label} (set by the thesis gate; the AI verdict was unavailable, so there is no conviction or credibility rating)`;
  return `🎯 *ACTION SIGNAL:* ${label} (Conviction: ${verdict.conviction_score}/10 | Credibility: ${verdict.credibility_tier})`;
}

function cleanCompanyForAlert(item) {
  return (item.company_name || item.ticker)
    .replace(/\s+share\s+price\s*$/i, "")
    .replace(/\s+ltd\b\.?/i, " Ltd")
    .trim();
}

function bulletList(list, max = 3) {
  return (list || []).filter(x => typeof x === "string" && x.length > 5).slice(0, max).map(x => `• ${x.replace(/^•\s*/, "")}`).join("\n");
}

/**
 * Stage-1 flash note: financial results / investor presentation / press release.
 */
function buildStage1Message({ item, verdict, activeFin, finSource, carried, stageName, periodLabel, guidanceSection, commText, degradedNote }) {
  const finBlock = buildVerifiedFinancialsBlock(activeFin, { carried: finSource === "CARRIED_FORWARD", periodLabel: carried?.periodLabel || periodLabel });
  const gateSec = buildGateSection(verdict.thesis_gate_result);
  const driverSec = formatDriverAssessmentSection(verdict.thesis_driver_assessment);
  const kpis = bulletList(verdict.thesis_operational_kpis);
  const pos = bulletList(verdict.key_positives);
  const drags = bulletList(verdict.key_concerns_and_drags);
  const drivers = (verdict.key_drivers || []).filter(d => d && d !== "Results under evaluation" && !/^EBITDA:/i.test(d) && !/RED FLAG|EXCEPTIONAL GAIN/i.test(d));
  const driversText = drivers.length > 0 ? `\n🛡️ *Key Thesis Drivers:*\n${bulletList(drivers)}\n` : "";
  const kpiSec = kpis ? `\n🎯 *THESIS OPERATIONAL KPIS & EXECUTION:*\n${kpis}\n` : "";
  const posSec = pos ? `\n✅ *WHAT WENT WELL:*\n${pos}\n` : "";
  const dragSec = drags ? `\n⚠️ *WATCH ITEMS & DRAGS:*\n${drags}\n` : "";
  const points = bulletList(verdict.concall_verification_points || verdict.dodged_questions || verdict.concall_checklist);
  const concallSec = points ? `\n🎙️ *OPEN QUERIES FOR CONCALL:*\n${points}\n` : "";
  const docLink = item.attachment_url ? `\n📄 [View Official Filing →](${item.attachment_url})` : "";
  const summary = verdict._llm_failed ? "" : `\n📋 *Verdict Summary:*\n${verdict.verdict_summary}\n`;
  const eventLine = /presentation|investor deck/i.test(item.title) && !activeFin
    ? "📑 *Event:* Investor Presentation"
    : `📊 *Event:* Quarterly Results Flash Note • ${stageName}`;

  return `
🏢 *${item.ticker.toUpperCase()}* | ${cleanCompanyForAlert(item)}
${eventLine}
──────────────────────────────
${actionSignalLine(verdict)}
──────────────────────────────${degradedNote}${gateSec}${finBlock}${guidanceSection}${driverSec}${kpiSec}${posSec}${dragSec}${commText}${summary}${driversText}${concallSec}
──────────────────────────────${docLink ? `${docLink}\n` : "\n"}_Stage 1 snapshot judged against the stock's thesis drivers. Concall transcript will verify the open queries._
`.trim();
}

/**
 * Stage-2 concall note (transcript).
 */
function buildConcallMessage({ item, verdict, activeFin, finSource, carried, periodLabel, guidanceSection, commText, degradedNote }) {
  const ch = verdict.concall_highlights || {};
  const section = (title, emoji, list) => (Array.isArray(list) && list.length > 0) ? `\n${emoji} *${title}:*\n${list.map(p => `• ${p}`).join("\n")}\n` : "";
  const gateSec = buildGateSection(verdict.thesis_gate_result);
  const driverSec = formatDriverAssessmentSection(verdict.thesis_driver_assessment);
  const finBlock = buildVerifiedFinancialsBlock(activeFin, { carried: finSource === "CARRIED_FORWARD", periodLabel: carried?.periodLabel || periodLabel });
  const perf = section("FINANCIAL METRICS & ORDER BOOK (from the call)", "📊", ch.financial_performance || ch.performance_overview);
  const biz = section("BUSINESS EXECUTION & CONTRACT WINS", "📦", ch.business_performance || ch.segment_highlights);
  const ops = section("CAPEX & CAPACITY EXPANSION", "🏭", ch.operational_highlights);
  const growth = section("GROWTH INITIATIVES & PARTNERSHIPS", "🚀", ch.growth_initiatives);
  const qG = section("QUARTERLY GUIDANCE (NEXT QUARTER)", "⏱️", ch.quarterly_guidance);
  const aG = section("ANNUAL (FY) GUIDANCE", "📅", ch.annual_guidance);
  const mY = section("MULTI-YEAR / LONG-TERM ROADMAP", "🎯", ch.multi_year_targets);
  const legacyG = (!qG && !aG && !mY) ? section("FORWARD GUIDANCE & TARGETS", "📈", ch.management_guidance) : "";
  const pos = ch.key_positives && ch.key_positives.length ? section("KEY POSITIVES", "✅", ch.key_positives) : (bulletList(verdict.key_positives) ? `\n✅ *KEY POSITIVES:*\n${bulletList(verdict.key_positives)}\n` : "");
  const chal = (ch.key_challenges || ch.key_risks) ? section("KEY RISKS & CHALLENGES", "⚠️", ch.key_challenges || ch.key_risks) : (bulletList(verdict.key_concerns_and_drags) ? `\n⚠️ *KEY RISKS & CHALLENGES:*\n${bulletList(verdict.key_concerns_and_drags)}\n` : "");
  const tone = ch.management_tone ? `\n🗣️ *Management Tone:* ${ch.management_tone}\n` : "";
  const takeaway = ch.key_takeaway ? `\n🔑 *DECISION BOTTOM LINE:*\n• ${ch.key_takeaway}\n` : (verdict._llm_failed ? "" : `\n🔑 *DECISION BOTTOM LINE:*\n• ${verdict.verdict_summary}\n`);
  const docLink = item.attachment_url ? `\n📄 [View Official Filing →](${item.attachment_url})` : "";

  return `
🏢 *${item.ticker.toUpperCase()}* | ${cleanCompanyForAlert(item)}
🎙️ *Event:* Institutional Concall Audit & Forensic Verification
──────────────────────────────
${actionSignalLine(verdict)}
──────────────────────────────${degradedNote}${gateSec}${driverSec}${finBlock}${guidanceSection}${biz}${ops}${growth}${perf}${qG}${aG}${mY}${legacyG}${commText}${pos}${chal}${tone}${takeaway}
──────────────────────────────
${docLink ? `${docLink}\n` : ""}_Institutional Quarterly Concall Deep-Dive_
`.trim();
}

function buildCommitmentsSection(commitments) {
  if (!Array.isArray(commitments) || commitments.length === 0) return "";
  const has = (c, word) => (c.status || "").toLowerCase().includes(word);
  const achieved = commitments.filter(c => has(c, "achieved") && !has(c, "partially"));
  const delayed = commitments.filter(c => has(c, "delayed"));
  const missed = commitments.filter(c => has(c, "missed"));
  const parts = [];
  if (achieved.length > 0) {
    parts.push(`*✅ Fulfilled Commitments:*`);
    achieved.forEach(c => parts.push(`• ${c.statement} (${c.status === "Achieved Ahead of Schedule" ? "⭐ Achieved Ahead of Schedule" : "Achieved"})`));
  }
  if (delayed.length > 0) {
    parts.push(`*⚠️ Delayed Commitments / Guidance Adjustments:*`);
    delayed.forEach(c => parts.push(`• ${c.statement} (Delayed: ${c.blockers_and_risks || c.timeline || "Timeline pushed back"})`));
  }
  if (missed.length > 0) {
    parts.push(`*🔴 Missed Commitments:*`);
    missed.forEach(c => parts.push(`• ${c.statement} (Missed: ${c.blockers_and_risks || "Target not met"})`));
  }
  return parts.length > 0 ? `\n${parts.join("\n")}\n` : "";
}

/**
 * Processes a single queued filing end-to-end. Alert delivery happens BEFORE any slow/optional work, and the
 * filing is only marked 'completed' once the alert is sent or safely parked for retry.
 */
async function processOneDeepDive(item, ctx) {
  const { suppressTelegram, deadlineAt } = ctx;
  console.log(`[WORKER PARALLEL] Processing ${item.ticker} (${item.deep_dive_status}) - Filing Date: ${item.filing_date || 'N/A'}...`);

  // ── 1. Document text ──
  let docText = "";
  let pdfFailure = { reason: null, detail: "" };
  if (item.attachment_url) {
    const pdf = await extractPdfTextDetailed(item.attachment_url);
    docText = pdf.text || "";
    pdfFailure = { reason: pdf.reason, detail: pdf.detail || "" };
  }
  const hasDocText = Boolean(docText) && docText.trim().length >= 50;
  if (!hasDocText) {
    docText = item.title;
  }

  // ── 2. Unified deterministic classification ──
  const classification = classifyFilingForWorker({
    title: item.title,
    attachmentUrl: item.attachment_url,
    docText,
    filingCategory: item.filing_category,
    deepDiveStatus: item.deep_dive_status
  });

  if (classification.isRoutine) {
    console.log(`[WORKER FAST-SKIP] Procedural compliance notice skipped: ${item.ticker} - ${item.title}`);
    await pool.query("UPDATE corporate_announcements SET deep_dive_status = 'not_required' WHERE id = $1", [item.id]);
    return { success: true, skipped: true };
  }

  // Material document whose text could not be read. The PDF is often not on the exchange CDN yet, so retry a few
  // cycles before dead-lettering (the title alone is NEVER analysed as if it were the filing).
  if (!hasDocText && !classification.isAudio && (classification.isTranscript || classification.isResults)) {
    const downloadProblem = Boolean(item.attachment_url) && pdfFailure.reason === "FETCH_FAILED";
    const budget = downloadProblem ? MAX_FETCH_ATTEMPTS : MAX_DEEP_DIVE_ATTEMPTS;
    const failureMessage = !item.attachment_url
      ? "The filing has no attachment URL, so there is no document to analyse"
      : downloadProblem
        ? `Could not download the filing PDF after ${budget} attempts (${pdfFailure.detail || "no response"}). The exchange file may not be published yet`
        : `The PDF has no machine-readable text (scanned image) and OCR did not recover it (${pdfFailure.detail || "no detail"})`;
    const attempts = await recordDeepDiveAttempt(item.id, downloadProblem ? `Download failed: ${pdfFailure.detail || "no response"}` : "Unextractable or empty PDF text", downloadProblem ? "fetch" : "notext");
    if (attempts < budget) {
      console.warn(`[WORKER RETRY] Document text unavailable for ${item.ticker} (${pdfFailure.reason || "NO_TEXT"}; attempt ${attempts}/${budget}). Will retry next cycle.`);
      return { success: false, retry: true };
    }
    console.warn(`[WORKER DEAD-LETTER] Unextractable / unavailable filing text for ${item.ticker}: ${item.title} — ${failureMessage}`);
    await escalateToReview(item, failureMessage, suppressTelegram);
    return { success: false, skipped: true };
  }

  // ── 3. Audio concall ──
  if (classification.audioCandidate && !classification.audioUrl && item.deep_dive_status === "pending_audio") {
    // Recording announced but no parseable media link: tell the user instead of silently dropping the concall.
    const msg = `🏢 *${item.ticker.toUpperCase()}* | ${cleanCompanyForAlert(item)}\n🎙️ *Event:* Concall audio recording published\n──────────────────────────────\n• The company filed the call recording, but the media link could not be extracted automatically.\n• Transcript analysis will follow when the written transcript is filed.\n──────────────────────────────${item.attachment_url ? `\n📄 [View Official Filing →](${item.attachment_url})` : ""}`;
    if (suppressTelegram) {
      await deliverWorkerAlert(item, msg, { suppressTelegram });
    } else {
      await queueDigestItem(item, buildDigestItem({
        kind: "AUDIO",
        title: item.title,
        url: item.attachment_url,
        filedAt: item.filing_date ? new Date(item.filing_date).toISOString() : new Date().toISOString(),
        verdict: { verdict_summary: "Call recording filed, but the media link could not be extracted; the transcript analysis follows when it is filed." }
      }));
    }
    await pool.query("UPDATE corporate_announcements SET deep_dive_status = 'completed' WHERE id = $1", [item.id]);
    return { success: true, ticker: item.ticker, stage: "audio-nolink" };
  }

  if (classification.isAudio && classification.audioUrl) {
    console.log(`[WORKER AUDIO] Ingesting concall audio for ${item.ticker}...`);
    const scratchDir = path.resolve(process.cwd(), "scratch");
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    const mp3Path = path.resolve(scratchDir, `${item.ticker}_audio_${String(item.id).slice(0, 8)}.mp3`);

    try {
      await downloadAndExtractMp3(classification.audioUrl, mp3Path);
      const audioAudit = await analyzeAudioWithGemini(mp3Path, item.ticker, item.company_name, item.investment_thesis);

      const eventAnalysisObj = {
        audio_analysis: audioAudit,
        investment_memo: audioAudit.investment_memo_markdown || null,
        processed_stage: "audio"
      };

      if (audioAudit.commitments && Array.isArray(audioAudit.commitments)) {
        const quarter = getIndianFiscalQuarter(item.filing_date);
        for (const comm of audioAudit.commitments) {
          if (!comm.statement || isProceduralNoise(comm.statement, comm.metric)) continue;
          await pool.query(
            `INSERT INTO management_commitments
              (stock_id, ticker, quarter, statement, metric, target_value, timeline, status, evidence_summary, credibility_impact)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8, 'positive')
             ON CONFLICT DO NOTHING`,
            [item.stock_id, item.ticker, quarter, comm.statement, comm.metric || "Operational", comm.target_value || "As stated", comm.timeline || "Medium Term", audioAudit.executive_summary]
          ).catch(err => console.warn(`[WORKER AUDIO] Commitment save warning:`, err.message));
        }
      }

      // Persist the analysis, then alert, THEN mark completed.
      await pool.query(
        `UPDATE corporate_announcements
         SET summary = COALESCE($1, summary),
             event_analysis = COALESCE(event_analysis, '{}'::jsonb) || $2::jsonb
         WHERE id = $3`,
        [audioAudit.executive_summary, JSON.stringify(eventAnalysisObj), item.id]
      );

      const alertText = formatAnnouncementMessage({
        ticker: item.ticker,
        companyName: item.company_name,
        title: item.title,
        priority: "HIGH",
        impact: "POSITIVE",
        summary: audioAudit.executive_summary,
        confidence: 90,
        concall_type: "audio",
        audio_analysis: audioAudit,
        event_analysis: eventAnalysisObj,
        forward_catalysts: audioAudit.catalysts,
        docUrl: item.attachment_url
      });
      if (suppressTelegram) {
        await deliverWorkerAlert(item, alertText, { suppressTelegram });
      } else {
        await queueDigestItem(item, buildDigestItem({
          kind: "AUDIO",
          title: item.title,
          url: item.attachment_url,
          filedAt: item.filing_date ? new Date(item.filing_date).toISOString() : new Date().toISOString(),
          verdict: { verdict_summary: audioAudit.executive_summary, key_positives: audioAudit.catalysts, commitments: audioAudit.commitments }
        }));
      }
      await pool.query("UPDATE corporate_announcements SET deep_dive_status = 'completed' WHERE id = $1", [item.id]);
      return { success: true, ticker: item.ticker, stage: "audio" };
    } catch (audioErr) {
      console.error(`[WORKER AUDIO ERROR] Failed for ${item.ticker}:`, audioErr.message);
      // A recording that is not published yet (404) or a transient download error is retried with backoff for about two
      // hours before a person is told; it used to be dead-lettered after three back-to-back cycles (about 15 minutes).
      const attempts = await recordDeepDiveAttempt(item.id, `Audio ingestion failed: ${audioErr.message}`, "audio");
      if (attempts >= MAX_AUDIO_ATTEMPTS) {
        await escalateToReview(item, `Audio ingestion failed: ${audioErr.message}`, suppressTelegram);
      } else {
        await deferRetry(item.id, backoffDelayMs(attempts));
      }
      return { success: false, error: audioErr.message };
    }
  }

  // A results STATEMENT is the filing that carries the statement tables. Decks and press releases quote results but are not
  // statements (an investor presentation was retried for hours and then dead-lettered with a false "statements could not be
  // machine-read" alert); they go to the thesis-status digest and are judged against the verified results of the same quarter.
  const isDeckOrPressRelease = /presentation|investor\s+deck|press\s+release|media\s+release/i.test(`${item.title} ${item.attachment_url || ""}`);
  const hasStatementWords = /revenue\s+from\s+operations|total\s+income|profit\s+before\s+tax/i.test(docText);
  const mentionsFinancialResults = /financial\s+results?|un-?audited|audited\s+financial/i.test(`${item.title} ${docText.slice(0, 6000)}`);
  // A results filing (the scanner flagged it an earnings release) whose text layer has NO statement rows at all: the statement
  // pages are images (SKIPPER: 57,366 characters of cover letter and auditor's report, zero statement rows). It is still a
  // statement filing, so it must be OCR-read, not judged from the cover letter.
  const statementPagesAreImages = item.is_earnings_release === true && /outcome|results?/i.test(item.title || "") && !hasStatementWords;
  const looksLikeStatementDoc =
    !classification.isTranscript &&
    !classification.isAudio &&
    !isDeckOrPressRelease &&
    ((mentionsFinancialResults && hasStatementWords) || statementPagesAreImages);

  // ── 4. Verified numbers + reporting period (deterministic, from THIS filing) ──
  let extractedFin = extractDeterministicFinancials(docText);

  // Scanned statements often carry a noisy embedded OCR text layer ("Revenue o aperstans", "Soptember") that the parser
  // rightly refuses. Re-read the pages with vision OCR and parse that instead, so the numbers stay VERIFIED.
  // The same applies when only the STANDALONE statement could be read although the filing prints a consolidated one:
  // the consolidated figures are the ones that matter, so a standalone headline would be a wrong alert.
  const filingHasConsolidatedStatement = /consolidated\s+(?:un-?audited\s+|audited\s+)?financial\s+results|statement\s+of\s+(?:un-?audited\s+|audited\s+)?consolidated/i.test(docText);
  const onlyStandaloneParsed = Boolean(extractedFin?.revenue) && extractedFin.statementScope === "STANDALONE" && filingHasConsolidatedStatement;
  if ((!extractedFin || !extractedFin.revenue || onlyStandaloneParsed) && looksLikeStatementDoc && item.attachment_url) {
    const usable = (f) => Boolean(f?.revenue) && (!onlyStandaloneParsed || f.statementScope === "CONSOLIDATED");
    // A transcription only counts when it parses into the statements we need; otherwise the next OCR model is tried.
    const ocr = await extractPdfTextDetailed(item.attachment_url, {
      forceOcr: true,
      acceptOcr: (t) => usable(extractDeterministicFinancials(t))
    });
    if (ocr.text && ocr.text.trim().length >= 200 && ocr.text !== docText) {
      const ocrFin = extractDeterministicFinancials(ocr.text);
      if (usable(ocrFin)) {
        console.log(`[PDF OCR] ${item.ticker}: embedded text layer was unreadable; vision-OCR text parsed into verified financials.`);
        // Clean statements first (they are what the verdict and the gate read), the embedded text layer after them.
        docText = `${ocr.text}\n\n${docText}`;
        extractedFin = ocrFin;
      }
    }
  }
  const groundTruth = getVerifiedGroundTruth(item.ticker);
  const filingQuarterByDate = getIndianFiscalQuarter(item.filing_date);
  let periodLabel = resolveReportingQuarter(item, extractedFin);

  let deterministicFin = null;
  let finSource = null;
  if (extractedFin && extractedFin.revenue) {
    deterministicFin = extractedFin;
    finSource = "THIS_FILING";
  } else if (groundTruth && groundTruth.revenue && item.filing_date && groundTruth.period === filingQuarterByDate) {
    // Benchmark truth only for the exact period it was verified for
    deterministicFin = {
      isFinancialResult: true,
      revenue: groundTruth.revenue,
      revenueYoYGrowthPct: groundTruth.revenueYoYGrowthPct,
      ebitda: groundTruth.ebitda,
      ebitdaMarginPct: groundTruth.ebitdaMarginPct,
      ebitdaMarginBpsDelta: groundTruth.ebitdaMarginBpsDelta,
      patConsolidated: groundTruth.patConsolidated,
      patAttributable: groundTruth.patConsolidated,
      patYoYGrowthPct: groundTruth.patYoYGrowthPct,
      isYoYDecline: groundTruth.patYoYGrowthPct !== null && groundTruth.patYoYGrowthPct < 0,
      isMarginErosion: Boolean(groundTruth.isMarginErosion) || (groundTruth.ebitdaMarginBpsDelta !== null && groundTruth.ebitdaMarginBpsDelta < -100),
      exceptionalGain: groundTruth.EXCEPTIONAL_ITEM || null,
      normalisedPat: groundTruth.CORE_PAT || null
    };
    finSource = "THIS_FILING";
  }

  // The rule-based reader could not parse a results statement: let the model LOCATE the printed figures, keep only
  // those that literally appear in the filing, and run them through the same deterministic arithmetic.
  // These are shown as unverified and can never authorise a buy.
  let tableLocateOutage = false; // the AI providers were down while the figures were being located
  if (!deterministicFin && looksLikeStatementDoc) {
    const runPrompt = async (...args) => {
      try {
        return await runNimPrompt(...args);
      } catch (err) {
        if (err?.chainExhausted) {
          tableLocateOutage = true;
          if (err.rateLimited) await recordQuotaPressure(err.retryAfterMs);
        }
        throw err;
      }
    };
    const llmFin = await extractFinancialsViaLlm({ docText, ticker: item.ticker, runPrompt });
    if (llmFin && llmFin.revenue) {
      deterministicFin = llmFin;
      finSource = "LLM_GROUNDED";
      periodLabel = resolveReportingQuarter(item, llmFin);
      console.log(`[TABLE FALLBACK] ${item.ticker}: using text-grounded AI-located figures (unverified).`);
    }
  }

  // A results statement nobody could read (parser, OCR and the text-grounded fallback all failed) gets NO AI narrative:
  // a model reading a garbled table confidently reports things like a loss for a profitable quarter, and the grounding
  // guard cannot catch it because the garbled numbers do exist in the text. Retry (OCR/LLM providers are often just
  // overloaded), then dead-letter with a failure alert that links the filing (AGENTS.md I5).
  if (looksLikeStatementDoc && !deterministicFin) {
    const failureMessage = "The results statements could not be machine-read (scanned or garbled PDF; OCR and the text-grounded fallback did not recover them). Open the filing for the numbers.";
    if (tableLocateOutage) {
      // Parser and OCR found nothing AND the AI that would locate the figures was unreachable: that is an outage, not a
      // hopeless PDF. Wait it out without consuming the filing's attempts; escalate only after the give-up time.
      const outage = await recordLlmOutage(item.id, "AI providers unavailable while locating the results figures");
      const decision = decideLlmFailureAction({ chainDown: true, outageFirstAtMs: outage.firstAtMs, outageRetries: outage.retries, nowMs: Date.now(), hasVerifiedNumbers: false });
      if (decision.action === "RETRY") {
        await deferRetry(item.id, decision.delayMs);
        console.warn(`[WORKER RETRY] ${item.ticker}: results statements unreadable while the AI providers are down (attempt not consumed). Retrying in ${Math.round(decision.delayMs / 60000)} min.`);
        return { success: false, retry: true };
      }
      await escalateToReview(item, `${failureMessage} (The AI providers were unavailable for hours.)`, suppressTelegram);
      return { success: false, skipped: true };
    }
    const attempts = await recordDeepDiveAttempt(item.id, "Results statements unreadable after OCR", "unreadable");
    if (attempts < MAX_UNREADABLE_STATEMENT_ATTEMPTS) {
      await deferRetry(item.id, backoffDelayMs(attempts));
      console.warn(`[WORKER RETRY] ${item.ticker}: results statements unreadable (attempt ${attempts}/${MAX_UNREADABLE_STATEMENT_ATTEMPTS}). No narrative from garbled text; retrying in ${Math.round(backoffDelayMs(attempts) / 60000)} min.`);
      return { success: false, retry: true };
    }
    console.warn(`[WORKER DEAD-LETTER] ${item.ticker}: ${item.title} — ${failureMessage}`);
    await escalateToReview(item, failureMessage, suppressTelegram);
    return { success: false, skipped: true };
  }

  // ── 5. Thesis-aware institutional verdict (LLM) ──
  const rawVerdict = await evaluateInstitutionalVerdict(
    item.ticker,
    item.investment_thesis,
    docText,
    item.deep_dive_status,
    item.title,
    { periodLabel }
  );

  let degradedNote = "";
  if (rawVerdict._llm_failed) {
    // Tell "the AI providers are down" (wait, back off, never blame the filing) from "this filing's output was unusable"
    // (counts toward the attempt budget). Verified numbers are delivered after a grace period either way (alert first).
    const chainDown = Boolean(rawVerdict._llm_outage);
    const hasVerifiedNumbers = Boolean(deterministicFin);
    let decision;
    let quotaPause = null;
    if (chainDown) {
      if (rawVerdict._llm_rate_limited) quotaPause = await recordQuotaPressure(rawVerdict._llm_retry_after_ms);
      const outage = await recordLlmOutage(item.id, rawVerdict._llm_rate_limited ? "AI providers rate-limited (429)" : "AI providers unavailable (every provider failed)");
      decision = decideLlmFailureAction({ chainDown: true, outageFirstAtMs: outage.firstAtMs, outageRetries: outage.retries, nowMs: Date.now(), hasVerifiedNumbers });
      // never retry before the quota is expected back
      if (decision.action === "RETRY" && quotaPause) decision = { ...decision, delayMs: Math.max(decision.delayMs, quotaPause.until - Date.now()) };
    } else {
      const attempts = await recordDeepDiveAttempt(item.id, "LLM synthesis returned no usable output", "llm");
      decision = decideLlmFailureAction({ chainDown: false, attempts, maxAttempts: MAX_DEEP_DIVE_ATTEMPTS, nowMs: Date.now(), hasVerifiedNumbers });
    }
    if (decision.action === "RETRY") {
      await deferRetry(item.id, decision.delayMs);
      console.warn(`[WORKER RETRY] LLM synthesis failed for ${item.ticker} (${chainDown ? "AI providers down; attempt not consumed" : "unusable output; attempt counted"}). Retrying in ${Math.round(decision.delayMs / 60000)} min.`);
      return { success: false, retry: true };
    }
    if (decision.action === "ESCALATE") {
      await escalateToReview(item, chainDown
        ? "The AI providers stayed unavailable for hours and no verified numbers could be parsed"
        : "LLM synthesis failed repeatedly and no verified numbers could be parsed", suppressTelegram);
      return { success: false, skipped: true };
    }
    degradedNote = "\n⚠️ _AI narrative unavailable this cycle — verified numbers and thesis gates only._\n";
  }

  // Deterministic guard on top of the LLM verdict, using the SAME numbers shown in the alert
  // (evaluateInstitutionalVerdict already guarded the verdict with this very filing's parsed numbers; only
  // re-apply when the benchmark ground truth supplied different figures, to avoid duplicated injections.)
  rawVerdict._raw_text = docText;
  const verdict = (deterministicFin && deterministicFin !== extractedFin)
    ? applyInstitutionalGuard(rawVerdict, deterministicFin, item.title, item.ticker)
    : rawVerdict;
  const activeFin = deterministicFin;

  // ── 6. Gate: financials for statement filings; carried-forward verified results for transcripts / decks ──
  let gateFin = activeFin;
  let gateSource = finSource;
  let carried = null;
  if (!gateFin && !looksLikeStatementDoc) {
    carried = await loadCarriedFinancials(item.ticker);
    if (carried) {
      gateFin = carried.fin;
      gateSource = "CARRIED_FORWARD";
      carried.periodLabel = quarterFromPeriodEnd(carried.fin?.quarterEnded) || getIndianFiscalQuarter(carried.filingDate);
    }
  }

  const gateResult = evaluateDualLayerActionGate({
    ticker: item.ticker,
    financialData: gateFin,
    proposedAction: verdict.action_signal || verdict.final_action,
    llmConviction: verdict.conviction_score,
    driverAssessment: verdict.thesis_driver_assessment || [],
    financialsRequired: looksLikeStatementDoc,
    financialsSource: gateSource || "THIS_FILING",
    financialsVerified: finSource !== "LLM_GROUNDED"
  });

  // Hard mechanical gate enforcement outside model subjectivity:
  verdict.action_signal = gateResult.finalAction;
  verdict.final_action = gateResult.finalAction;
  verdict.conviction_score = gateResult.calibratedConviction;
  verdict.thesis_gate_result = gateResult;
  verdict.reporting_period = periodLabel;
  if (activeFin && finSource === "THIS_FILING") verdict.verified_financials = activeFin;
  if (finSource === "LLM_GROUNDED") {
    degradedNote += "\n⚠️ _Figures below were located by AI (every number was found in the filing text) but the table layout could not be machine-verified — no buy is authorised on them. Check the filing._\n";
  }
  if (looksLikeStatementDoc && !activeFin) {
    degradedNote += "\n⚠️ _Could not machine-verify the financial tables in this PDF — figures not shown; open the filing._\n";
  }
  if (onlyStandaloneParsed && activeFin?.statementScope === "STANDALONE") {
    degradedNote += "\n⚠️ _Only the STANDALONE statement could be machine-read. This filing also prints consolidated results that could not be verified — the consolidated figures matter more; open the filing._\n";
  }

  console.log(`[DUAL-LAYER GATE] ${item.ticker}: ${gateResult.finalAction} (Status: ${gateResult.statusClassification}, Conviction: ${gateResult.calibratedConviction}/10). ${gateResult.decisionExplanation}`);

  // ── 7. Persist commitments (fast DB work) ──
  const quarter = periodLabel;
  if (verdict.commitments && verdict.commitments.length > 0) {
    for (const comm of verdict.commitments) {
      const statementText = comm.statement || "Management guidance";
      const metricText = comm.metric || "Operational";
      if (isProceduralNoise(statementText, metricText)) continue;

      const { rows: existing } = await pool.query(
        `SELECT id FROM management_commitments WHERE stock_id = $1 AND quarter = $2 AND statement = $3`,
        [item.stock_id, quarter, statementText]
      );

      let normalizedStatus = "Pending";
      const sLower = (comm.status || "").toLowerCase();
      if (sLower.includes("achieved") && !sLower.includes("partially")) normalizedStatus = "Achieved";
      else if (sLower.includes("partially")) normalizedStatus = "Partially Achieved";
      else if (sLower.includes("missed") || sLower.includes("broken")) normalizedStatus = "Missed";

      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO management_commitments
            (stock_id, ticker, quarter, statement, metric, target_value, timeline, status, evidence_summary, credibility_impact, blockers_and_risks)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            item.stock_id, item.ticker, quarter, statementText, metricText,
            comm.target_value || "As stated", comm.timeline || "Medium Term", normalizedStatus,
            verdict.verdict_summary,
            comm.credibility_impact || (verdict.credibility_tier === "Tier 1" ? "positive" : (verdict.credibility_tier === "Tier 3" ? "negative" : "neutral")),
            comm.blockers_and_risks || null
          ]
        ).catch(err => console.warn(`[WORKER] Commitment save warning for ${item.ticker}:`, err.message));
      }
    }
  }

  // ── 8. Quarterly snapshot: only a filing that actually carries this quarter's statements may write it ──
  if (item.stock_id && quarter && activeFin && finSource === "THIS_FILING") {
    const rawQuarter = quarter;
    const parsedQuarter = parseFiscalQuarter(rawQuarter);
    const snapQuarter = (parsedQuarter && parsedQuarter.label !== 'UNKNOWN') ? parsedQuarter.label : rawQuarter;
    const hl = verdict.financial_highlights || {};
    const metricsObj = {
      revenue_growth: { value: hl.revenue_yoy || "N/A", evidence: hl.revenue || "SEBI Filing" },
      pat_growth: { value: hl.pat_yoy || "N/A", evidence: hl.pat_consolidated || "SEBI Filing" },
      opm: { value: hl.ebitda_margin || "N/A", evidence: hl.ebitda_margin_delta || "SEBI Filing" }
    };
    const storable = { ...verdict };
    delete storable._raw_text;

    await pool.query(
      `INSERT INTO quarterly_snapshots
        (stock_id, quarter, summary, thesis_status, thesis_status_reason, conviction_score, final_action, metrics, raw_ai_output)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (stock_id, quarter) DO UPDATE SET
        summary = EXCLUDED.summary,
        thesis_status = EXCLUDED.thesis_status,
        thesis_status_reason = EXCLUDED.thesis_status_reason,
        conviction_score = EXCLUDED.conviction_score,
        final_action = EXCLUDED.final_action,
        metrics = EXCLUDED.metrics,
        raw_ai_output = EXCLUDED.raw_ai_output`,
      [
        item.stock_id,
        snapQuarter,
        verdict.verdict_summary || verdict.summary || "Quarterly financial evaluation completed.",
        verdict.thesis_gate_result?.statusClassification || verdict.thesis_status || "STABLE",
        verdict.thesis_gate_result?.decisionExplanation || "Evaluated via Dual-Layer Quantitative Gate.",
        // No AI verdict means no conviction: store NULL rather than a placeholder that later reads as a real rating
        verdict._llm_failed ? null : (verdict.conviction_score || 5),
        verdict.final_action || verdict.action_signal || "HOLD",
        JSON.stringify(metricsObj),
        JSON.stringify(storable)
      ]
    ).catch(err => console.warn(`[WORKER] Snapshot upsert warning for ${item.ticker} (${snapQuarter}):`, err.message));
  }

  // ── 9. Build + send the alert (BEFORE any slow optional work) ──
  const guidanceComp = activeFin ? await reconcilePriorGuidanceVsActual(item.ticker, quarter, activeFin) : null;
  let guidanceSection = "";
  if (guidanceComp) {
    guidanceSection = guidanceComp.formattedSection || `\n🎯 *PREVIOUS GUIDANCE VS. ACTUAL DELIVERY:*\n• *Prior Guided Target:* ${guidanceComp.guidedValue} _(from ${guidanceComp.priorQuarter})_\n• *Actual Delivered:* ${guidanceComp.actualValue}\n• *Delivery Verdict:* ${guidanceComp.verdictBadge}\n`;
  }
  const commText = buildCommitmentsSection(verdict.commitments);
  const stageInfo = getFilingStageDetails(item.deep_dive_status, item.title, docText);
  const isTranscriptDoc = classification.isTranscript || item.deep_dive_status === "pending_stage2";

  if (isTranscriptDoc) {
    console.log(`[WORKER] Generating concall highlights for ${item.ticker}...`);
    const ch = sanitizeConcallHighlights(await generateStructuredConcallHighlights(item.ticker, item.company_name, docText), docText);
    const hasHighlightContent = ch && [
      "segment_highlights", "business_performance", "financial_performance", "operational_highlights", "growth_initiatives",
      "quarterly_guidance", "annual_guidance", "multi_year_targets", "key_positives", "key_challenges"
    ].some(k => Array.isArray(ch[k]) && ch[k].length > 0);
    if (hasHighlightContent) {
      verdict.concall_highlights = ch;
    }
  }

  const msgCtx = { item, verdict, activeFin: gateFin, finSource: gateSource, carried, stageName: stageInfo.stageName, periodLabel, guidanceSection, commText, degradedNote };
  const alertText = isTranscriptDoc ? buildConcallMessage(msgCtx) : buildStage1Message(msgCtx);

  // Persist the full verdict first (without the bulky raw text), then send, then mark completed.
  const storableVerdict = { ...verdict };
  delete storableVerdict._raw_text;
  await pool.query(
    `UPDATE corporate_announcements
     SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [item.id, JSON.stringify({ institutional_verdict: storableVerdict })]
  );

  // Verified statement filings alert immediately. Transcripts / decks / press releases are queued for ONE per-stock
  // thesis-status digest (sent in this same cycle unless a sibling filing of the stock is still being processed).
  const route = routeAlert({ isStatementFiling: looksLikeStatementDoc, isTranscript: isTranscriptDoc, isAudio: false });
  if (route === "immediate" || suppressTelegram) {
    await deliverWorkerAlert(item, alertText, { suppressTelegram });
  } else {
    const digestItem = buildDigestItem({
      kind: isTranscriptDoc ? "CONCALL" : digestKindFor(item.title),
      title: item.title,
      url: item.attachment_url,
      filedAt: item.filing_date ? new Date(item.filing_date).toISOString() : new Date().toISOString(),
      verdict
    });
    if (isContentFreeDigestItem(digestItem)) {
      // e.g. a call-recording intimation: nothing to judge, so no "No driver evidence yet" message
      console.log(`[WORKER DIGEST] ${item.ticker}: "${item.title}" has no content to report; completed without a digest.`);
    } else {
      await queueDigestItem(item, digestItem);
    }
  }
  await pool.query(
    `UPDATE corporate_announcements
     SET deep_dive_status = 'completed',
         event_analysis = (COALESCE(event_analysis, '{}'::jsonb) - 'pipeline_error' - 'retry_not_before' - 'llm_outage_first_at' - 'llm_outage_retries'
                           - 'deep_dive_attempts' - 'fetch_attempts' - 'notext_attempts' - 'unreadable_attempts' - 'llm_attempts' - 'audio_attempts')
     WHERE id = $1`,
    [item.id]
  );

  // The queued digest goes out NOW if this stock has nothing else waiting: the audits and syntheses below are slow
  // (their LLM/Gemini calls can take minutes) and must never sit in front of the user's update (I1).
  if (route !== "immediate" && !suppressTelegram) {
    await flushThesisDigests();
  }

  // ── 10. Optional follow-ups (never allowed to block or lose the alert) ──
  try {
    await reconcileStockCommitments(item.ticker);
  } catch (err) {
    console.warn(`[WORKER] Commitment reconciliation warning for ${item.ticker}:`, err.message);
  }

  if (isTranscriptDoc) {
    try {
      const { rows: prevAudio } = await pool.query(
        `SELECT id, event_analysis FROM corporate_announcements
         WHERE ticker = $1 AND event_analysis->'audio_analysis' IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [item.ticker]
      );
      if (prevAudio.length > 0 && prevAudio[0].event_analysis?.audio_analysis && (!deadlineAt || Date.now() < deadlineAt - 45000)) {
        console.log(`[WORKER AUDIT] Running Audio-vs-Transcript Discrepancy check for ${item.ticker}...`);
        const transcriptAnalysis = await analyzeTranscriptWithGemini(docText, item.ticker, item.company_name, item.investment_thesis);
        const discrepancyAudit = await auditDiscrepancies(prevAudio[0].event_analysis.audio_analysis, transcriptAnalysis, item.ticker);
        if (discrepancyAudit) {
          await pool.query(
            `UPDATE corporate_announcements SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
            [item.id, JSON.stringify({ discrepancy_audit: discrepancyAudit })]
          );
        }
        if (discrepancyAudit?.has_material_discrepancy && !suppressTelegram) {
          await sendConcallDiscrepancyAlert({
            ticker: item.ticker,
            companyName: item.company_name,
            discrepancyScore: discrepancyAudit.discrepancy_score,
            summaryVerdict: discrepancyAudit.summary_verdict,
            discrepancies: discrepancyAudit.discrepancies,
            docUrl: item.attachment_url
          });
        }
      }
    } catch (auditErr) {
      console.warn(`[WORKER AUDIT WARN] Discrepancy audit error for ${item.ticker}:`, auditErr.message);
    }
  }

  // Heavy multi-report synthesis is best-effort and time-boxed; skipped runs are flagged for a later cycle.
  const timeLeft = deadlineAt ? deadlineAt - Date.now() : Infinity;
  if (timeLeft > 90000) {
    await generateInstitutionalSyntheses(item.ticker).catch(err => console.warn(`[WORKER] Synthesis update warning for ${item.ticker}:`, err.message));
  } else {
    await pool.query(
      `UPDATE corporate_announcements SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) || jsonb_build_object('synthesis_pending', true) WHERE id = $1`,
      [item.id]
    ).catch(() => {});
  }

  console.log(`[WORKER PARALLEL] Completed deep-dive for ${item.ticker} (ID: ${item.id})`);
  return { success: true, ticker: item.ticker };
}

const DIGEST_PENDING_STATUSES = ["pending_stage1", "pending_stage2", "pending_audio"];

/**
 * Queues a processed filing for the per-stock THESIS STATUS digest. The row keeps the compact digest item, so a
 * restart or a Telegram outage can never lose it (flushThesisDigests() re-reads the queue every cycle).
 * A failed write throws on purpose: the filing is then retried instead of being marked completed without an alert.
 */
async function queueDigestItem(item, digestItem) {
  await pool.query(
    `UPDATE corporate_announcements
     SET event_analysis = COALESCE(event_analysis, '{}'::jsonb) || jsonb_build_object('digest_pending', true, 'digest_item', $1::jsonb)
     WHERE id = $2`,
    [JSON.stringify(digestItem), item.id]
  );
}

function digestKindFor(title) {
  if (/presentation|investor deck|earnings deck/i.test(title)) return "DECK";
  if (/press release/i.test(title)) return "PRESS";
  return "OTHER";
}

/**
 * Newest-first driver assessments already stored for a stock (feeds the thesis status board).
 */
async function loadAssessmentHistory(ticker) {
  const { rows } = await pool.query(
    `SELECT COALESCE(filing_date, created_at) AS filed_at, title,
            event_analysis->'institutional_verdict'->'thesis_driver_assessment' AS assessment
     FROM corporate_announcements
     WHERE ticker = $1
       AND event_analysis->'institutional_verdict'->'thesis_driver_assessment' IS NOT NULL
       AND COALESCE(filing_date, created_at) > NOW() - INTERVAL '120 days'
     ORDER BY COALESCE(filing_date, created_at) DESC
     LIMIT 12`,
    [ticker]
  );
  return rows
    .filter(r => Array.isArray(r.assessment))
    .map(r => ({ filedAt: new Date(r.filed_at).toISOString(), source: r.title, assessment: r.assessment }));
}

/**
 * Sends ONE thesis-status message per stock for the queued (non-results) filings. Sent as soon as the stock has no
 * other filing waiting for the worker, and never held beyond DIGEST_MAX_WAIT_MS. Rows are marked sent only AFTER the
 * message went out; a failed send leaves them queued for the next cycle.
 * @returns {Promise<number>} digests sent
 */
export function flushThesisDigests(opts = {}) {
  // Serialised: the worker flushes from several places (and from parallel filings of one stock); two flushes reading the
  // queue at the same moment would each send the same digest.
  const run = digestFlushChain.then(() => flushThesisDigestsOnce(opts));
  digestFlushChain = run.catch(() => {});
  return run;
}
let digestFlushChain = Promise.resolve();

async function flushThesisDigestsOnce({ now = Date.now() } = {}) {
  let sent = 0;
  try {
    const { rows } = await pool.query(
      `SELECT ca.id, ca.ticker, ca.filing_date, s.company_name, ca.event_analysis->'digest_item' AS digest_item
       FROM corporate_announcements ca
       JOIN stocks s ON s.id = ca.stock_id
       WHERE ca.event_analysis->>'digest_pending' = 'true'
         AND ca.created_at > NOW() - INTERVAL '10 days'
       ORDER BY ca.ticker, ca.filing_date`
    );
    if (rows.length === 0) return 0;

    const byTicker = new Map();
    for (const r of rows) {
      if (!r.digest_item || typeof r.digest_item !== "object") continue;
      if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
      byTicker.get(r.ticker).push(r);
    }
    const { rows: pendingRows } = await pool.query(
      `SELECT ticker, COUNT(*)::int AS n
       FROM corporate_announcements
       WHERE deep_dive_status = ANY($1) AND ticker = ANY($2) AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY ticker`,
      [DIGEST_PENDING_STATUSES, [...byTicker.keys()]]
    );
    const otherPending = new Map(pendingRows.map(r => [r.ticker, r.n]));

    for (const [ticker, group] of byTicker) {
      const items = group.map(r => ({ ...r.digest_item, filedAt: r.digest_item.filedAt || new Date(r.filing_date).toISOString() }));
      if (!shouldSendDigest({ queuedAt: items.map(i => i.queuedAt), otherPending: otherPending.get(ticker) || 0, now })) continue;

      const drivers = getThesisContract(ticker)?.drivers || [];
      let history = [];
      try {
        history = await loadAssessmentHistory(ticker);
      } catch (err) {
        console.warn(`[WORKER DIGEST] Could not load driver history for ${ticker}; board uses this batch only:`, err.message);
      }
      const entries = [...items.map(i => ({ filedAt: i.filedAt, source: i.title, assessment: i.assessment })), ...history];
      const board = buildThesisStatusBoard(entries, drivers);

      const carried = await loadCarriedFinancials(ticker);
      const financialsBlock = carried
        ? buildVerifiedFinancialsBlock(carried.fin, { carried: true, periodLabel: quarterFromPeriodEnd(carried.fin?.quarterEnded) || getIndianFiscalQuarter(carried.filingDate) })
        : "";

      const message = formatThesisDigestMessage({ ticker, companyName: group[0].company_name, items, board, overall: overallThesisStatus(board), financialsBlock });
      try {
        await sendTelegramMessage(message);
      } catch (err) {
        console.error(`[WORKER DIGEST] Telegram delivery failed for ${ticker}: ${err.message}. Digest stays queued for the next cycle.`);
        break; // Telegram unavailable: every other stock would fail the same way
      }
      await pool.query(
        `UPDATE corporate_announcements
         SET sent_to_telegram = true,
             event_analysis = (COALESCE(event_analysis, '{}'::jsonb) - 'digest_pending' - 'alert_pending' - 'pending_alert_text' - 'alert_error')
                              || jsonb_build_object('alert_sent_at', NOW(), 'digest_sent_at', NOW())
         WHERE id = ANY($1)`,
        [group.map(r => r.id)]
      );
      sent++;
      console.log(`[WORKER DIGEST] Sent thesis-status digest for ${ticker} (${items.length} filing(s)).`);
    }
  } catch (err) {
    console.error("[WORKER DIGEST] Digest flush failed (items stay queued):", err.message);
  }
  return sent;
}

/**
 * Runs deferred institutional syntheses (one ticker per call) when the scan still has time budget.
 */
async function drainPendingSyntheses(deadlineAt, maxTickers = 1) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (ticker) id, ticker
       FROM corporate_announcements
       WHERE event_analysis->>'synthesis_pending' = 'true' AND created_at > NOW() - INTERVAL '10 days'
       ORDER BY ticker, filing_date DESC NULLS LAST
       LIMIT $1`,
      [maxTickers]
    );
    for (const row of rows) {
      if (deadlineAt && Date.now() > deadlineAt - 90000) return;
      await generateInstitutionalSyntheses(row.ticker).catch(err => console.warn(`[WORKER] Deferred synthesis warning for ${row.ticker}:`, err.message));
      await pool.query(
        `UPDATE corporate_announcements SET event_analysis = event_analysis - 'synthesis_pending' WHERE ticker = $1 AND event_analysis->>'synthesis_pending' = 'true'`,
        [row.ticker]
      );
    }
  } catch (err) {
    console.warn("[WORKER] Pending synthesis drain failed:", err.message);
  }
}

/**
 * Main worker loop function.
 * @param {Object} options - Worker options
 * @param {boolean} [options.suppressTelegram=false] - Whether to skip Telegram alerts (useful during bulk backfills)
 * @param {number} [options.deadlineAt] - epoch ms after which no new filing is started and slow follow-ups are skipped
 */
export async function processPendingDeepDives(options = {}) {
  const { suppressTelegram = false, tickers = null, allowHistorical = false, announcementIds = null, retryFailed = false, deadlineAt = null } = options;
  let batchSize = options.batchSize ?? 4;

  // Alerts that failed to deliver earlier go out first
  if (!suppressTelegram && !announcementIds) {
    await flushPendingAlerts();
  }
  // Queued thesis digests whose sibling filings have finished since the last cycle (or whose send failed) go out now
  if (!suppressTelegram) {
    await flushThesisDigests();
  }

  // A running quota pause keeps the queue idle (everything below needs the AI): nothing is lost, filings stay queued.
  // After it ends, work one filing at a time until a success clears it.
  let quotaPause = null;
  if (!announcementIds) {
    quotaPause = await readQuotaPause();
    if (isQuotaPaused(quotaPause)) {
      console.log(`[WORKER] AI quota pause active until ${new Date(quotaPause.until).toISOString()}; leaving the queue for later.`);
      return { processed: 0, failed: 0, found: 0, paused: true };
    }
    batchSize = batchSizeAfterPause(quotaPause, batchSize);
  }
  console.log(`[WORKER] Polling for pending quarterly deep-dives (parallel batch size: ${batchSize})...`);

  let queryText;
  let queryParams = [];

  const selectCols = `ca.id, ca.stock_id, ca.ticker, ca.title, ca.attachment_url, ca.filing_date, ca.deep_dive_status, ca.filing_category, ca.is_earnings_release,
             s.investment_thesis, s.company_name`;

  if (announcementIds && announcementIds.length > 0) {
    queryText = `SELECT ${selectCols}
      FROM corporate_announcements ca
      JOIN stocks s ON s.id = ca.stock_id
      WHERE ca.id = ANY($1)`;
    queryParams = [announcementIds];
  } else {
    const statuses = retryFailed
      ? ['pending_stage1', 'pending_stage2', 'pending_audio', 'failed']
      : ['pending_stage1', 'pending_stage2', 'pending_audio'];

    queryText = `SELECT ${selectCols}
      FROM corporate_announcements ca
      JOIN stocks s ON s.id = ca.stock_id
      WHERE ca.deep_dive_status = ANY($1)
        AND (s.category IN ('Core', 'Watchlist') OR s.category IS NULL)
        AND (ca.event_analysis->>'retry_not_before' IS NULL
             OR (ca.event_analysis->>'retry_not_before')::timestamptz <= NOW())`;
    queryParams = [statuses];

    if (!allowHistorical && !suppressTelegram) {
      queryText += ` AND ca.created_at >= NOW() - INTERVAL '30 days'`;
    }

    if (tickers && tickers.length > 0) {
      queryParams.push(tickers);
      queryText += ` AND ca.ticker = ANY($${queryParams.length})`;
    }
    // Results first: when the AI quota is scarce the verified results alert is the one that must not wait behind decks and notices
    queryText += ` ORDER BY (CASE WHEN ca.is_earnings_release THEN 0 ELSE 1 END), ca.filing_date DESC, ca.created_at DESC LIMIT ${Number(batchSize) || 4}`;
  }

  const { rows: pendingList } = await pool.query(queryText, queryParams);

  if (pendingList.length === 0) {
    console.log("[WORKER] No pending quarterly deep-dives in queue.");
    if (!suppressTelegram) await drainPendingSyntheses(deadlineAt);
    return { processed: 0, failed: 0, found: 0 };
  }

  console.log(`[WORKER] Found ${pendingList.length} filings. Executing concurrent batch...`);

  const results = await Promise.all(pendingList.map(async (item, idx) => {
    if (idx > 0) await new Promise(r => setTimeout(r, idx * 250));
    if (deadlineAt && Date.now() > deadlineAt) {
      console.log(`[WORKER] Time budget exhausted — leaving ${item.ticker} (${item.title}) queued for the next cycle.`);
      return { success: false, deferred: true };
    }
    try {
      return await processOneDeepDive(item, { suppressTelegram, deadlineAt });
    } catch (err) {
      console.error(`[WORKER ERROR] Deep-dive failed for ${item.ticker} (ID: ${item.id}):`, err.message);
      try {
        const attempts = await recordDeepDiveAttempt(item.id, err.message);
        if (attempts >= MAX_DEEP_DIVE_ATTEMPTS) {
          await escalateToReview(item, err.message, suppressTelegram);
        } else {
          await deferRetry(item.id, backoffDelayMs(attempts));
        }
      } catch (dbErr) {
        console.error("[WORKER ERROR] Could not record failure:", dbErr.message);
      }
      return { success: false, error: err.message };
    }
  }));

  // Rate limit pause between batches
  await new Promise(r => setTimeout(r, 1000));

  const processedCount = results.filter(r => r && r.success).length;
  const failedCount = results.filter(r => r && !r.success && !r.deferred && !r.skipped).length;
  // A filing went through the AI successfully: the quota is back, so the one-at-a-time mode ends
  if (processedCount > 0 && quotaPause && quotaPause.count > 0) {
    await writeQuotaPause({ until: 0, count: 0 });
    console.log("[WORKER] AI quota recovered; back to normal batches.");
  }
  // Deliver this cycle's queued digests BEFORE the slow optional syntheses (alert-first, I1)
  if (!suppressTelegram) await flushThesisDigests();
  if (!suppressTelegram) await drainPendingSyntheses(deadlineAt);
  return { processed: processedCount, failed: failedCount, found: pendingList.length };
}


// Run directly if invoked from CLI
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  processPendingDeepDives().then(res => {
    console.log(`[WORKER] Finished processing ${res.processed} deep-dives.`);
    process.exit(0);
  }).catch(err => {
    console.error("[WORKER FATAL]", err);
    process.exit(1);
  });
}

/**
 * Automatically reconciles past pending commitments for a stock dynamically against reported financials & corporate actions.
 */
export async function reconcileStockCommitments(ticker) {
  if (!ticker) return;

  try {
    // 1. Fetch pending commitments for this ticker
    const { rows: pendingComms } = await pool.query(
      "SELECT id, statement, metric, target_value, timeline FROM management_commitments WHERE ticker = $1 AND status = 'Pending'",
      [ticker]
    );

    if (pendingComms.length === 0) return;

    // 2. Fetch latest filing text & financials
    const { rows: annRows } = await pool.query(
      `SELECT title, attachment_url, event_analysis 
       FROM corporate_announcements 
       WHERE ticker = $1 AND event_analysis IS NOT NULL 
       ORDER BY filing_date DESC LIMIT 1`,
      [ticker]
    );

    if (annRows.length === 0) return;

    const latestAnn = annRows[0];
    const verdict = latestAnn.event_analysis?.institutional_verdict;
    if (!verdict) return;

    // 3. Process each commitment dynamically using strict horizon guard & verified evidence
    for (const comm of pendingComms) {
      const scopeInfo = classifyGuidanceScope(comm);
      const stmtLower = (comm.statement || "").toLowerCase();
      const metricLower = (comm.metric || "").toLowerCase();

      // Guard Rule 2: Multi-stage regulatory approvals MUST NOT be auto-achieved
      const isRegulatoryAction = 
        stmtLower.includes("scheme of arrangement") || 
        stmtLower.includes("nclt") || 
        stmtLower.includes("sebi approval") || 
        stmtLower.includes("demerger") ||
        metricLower.includes("regulatory");

      if (isRegulatoryAction) {
        // Can ONLY be marked achieved if final court order or approval is officially published
        const isFinalApproval = (verdict.verdict_summary || "").toLowerCase().includes("final order") ||
                                (latestAnn.title || "").toLowerCase().includes("final order") ||
                                (verdict.verdict_summary || "").toLowerCase().includes("in-principle approval granted");
        if (isFinalApproval) {
          await pool.query(
            `UPDATE management_commitments 
             SET status = 'Achieved',
                 credibility_impact = 'positive',
                 evidence_summary = $1
             WHERE id = $2`,
            [`Final regulatory clearance confirmed: ${(verdict.verdict_summary || "").substring(0, 150)}...`, comm.id]
          );
        }
        continue;
      }

      // Capex & Plant Commissioning
      if (scopeInfo.scope === 'CAPEX_MILESTONE') {
        const driversText = (verdict.key_drivers || []).join(" ").toLowerCase();
        const summaryText = (verdict.verdict_summary || "").toLowerCase();
        const titleText = (latestAnn.title || "").toLowerCase();
        const fullContext = `${titleText} ${driversText} ${summaryText}`;

        const isActuallyCommissioned = 
          (fullContext.includes("commercial production") || fullContext.includes("commissioned") || fullContext.includes("operational")) &&
          !fullContext.includes("expected to commission") &&
          !fullContext.includes("likely to commission");

        if (isActuallyCommissioned) {
          await pool.query(
            `UPDATE management_commitments 
             SET status = 'Achieved',
                 credibility_impact = 'positive',
                 evidence_summary = $1
             WHERE id = $2`,
            [`Commissioning verified by ${latestAnn.title}: ${(verdict.verdict_summary || "").substring(0, 150)}...`, comm.id]
          );
        }
        continue;
      }

      // Quarterly Guidance Reconciler
      if (scopeInfo.scope === 'QUARTERLY') {
        const currentQ = getIndianFiscalQuarter(latestAnn.filing_date);
        const normCurrentQ = currentQ.replace(/_/g, ' ').toUpperCase();
        const targetQ = scopeInfo.targetQuarter ? scopeInfo.targetQuarter.replace(/_/g, ' ').toUpperCase() : "";

        // Only evaluate if this filing is for the target quarter
        if (targetQ && (targetQ === normCurrentQ || normCurrentQ.includes(targetQ.split(' ')[0]))) {
          const finRev = verdict.financial_highlights?.revenue ? parseFloat(String(verdict.financial_highlights.revenue).replace(/,/g, '')) : null;
          const targetRev = scopeInfo.targetNumericValue;

          if (finRev && targetRev && scopeInfo.targetUnit === 'CR') {
            const isBeat = finRev >= targetRev;
            const status = isBeat ? 'Achieved' : (finRev < targetRev - 5 ? 'Missed' : 'Achieved');
            const impact = isBeat ? 'positive' : 'negative';
            await pool.query(
              `UPDATE management_commitments 
               SET status = $1,
                   credibility_impact = $2,
                   evidence_summary = $3
               WHERE id = $4`,
              [status, impact, `Quarterly result for ${currentQ}: Actual Revenue ₹${finRev} Cr vs Guided ₹${targetRev} Cr (${isBeat ? 'Beat' : 'Missed'})`, comm.id]
            );
          }
        }
        continue;
      }

      // Annual & Multi-Year guidance MUST REMAIN PENDING during intermediate quarters!
      // (Strict horizon isolation: zero false auto-achievements)
    }
  } catch (err) {
    console.warn(`[WORKER] Guidance reconciliation warning for ${ticker}:`, err.message);
  }
}

/**
 * Generates and persists the 4 Institutional Synthesis Reports for a stock using NVIDIA NIM LLM.
 */
export async function generateInstitutionalSyntheses(ticker, force = false) {
  if (!ticker) return;

  console.log(`[SYNTHESIS] Generating 4 Institutional Synthesis Reports for ${ticker}...`);

  try {
    const { rows: stockRows } = await pool.query(
      "SELECT id, company_name, ticker, investment_thesis, key_thesis_metrics FROM stocks WHERE ticker = $1",
      [ticker]
    );
    if (stockRows.length === 0) return;
    const stock = stockRows[0];
    const truth = getVerifiedGroundTruth(ticker);

    const { rows: comms } = await pool.query(
      `SELECT statement, metric, target_value, timeline, status, credibility_impact, blockers_and_risks 
       FROM management_commitments WHERE ticker = $1 ORDER BY created_at DESC`,
      [ticker]
    );

    const { rows: rawSnapshots } = await pool.query(
      `SELECT quarter, thesis_status, thesis_momentum, confidence_score, final_action, summary, metrics, red_flags, dodged_questions
       FROM quarterly_snapshots
       WHERE stock_id = $1`,
      [stock.id]
    );
    const snapshots = [...rawSnapshots].sort((a, b) => compareFiscalQuartersDesc(a.quarter, b.quarter));

    const { rows: interQuarterEvents } = await pool.query(
      `SELECT event_date, event_type, title, value_in_cr, counterparty, description, bse_filing_url
       FROM interquarter_events
       WHERE stock_id = $1
       ORDER BY event_date DESC`,
      [stock.id]
    );

    const latestSnapshot = snapshots.length > 0 ? snapshots[0] : null;
    const latestQuarterLabel = latestSnapshot ? latestSnapshot.quarter : 'N/A';

    const formattedInterQuarterEvents = interQuarterEvents.map(e => 
      `• [${e.event_date}] ${e.event_type}: ${e.title} ${e.value_in_cr ? `(Value: ₹${e.value_in_cr} Cr)` : ''} - ${e.description} [Ref: ${e.bse_filing_url || 'SEBI_LODR_FILING'}]`
    ).join('\n');

    const formattedMetricsHistory = snapshots.map((s, idx) => {
      const m = s.metrics || {};
      const rev = m.revenue_growth ? `Revenue Growth: ${m.revenue_growth.value} [Evidence: ${m.revenue_growth.evidence}]` : 'Revenue Growth: N/A';
      const pat = m.pat_growth ? `PAT Growth: ${m.pat_growth.value} [Evidence: ${m.pat_growth.evidence}]` : 'PAT Growth: N/A';
      const opm = m.opm ? `EBITDA Margin: ${m.opm.value} [Evidence: ${m.opm.evidence}]` : 'EBITDA Margin: N/A';
      const primary = m.primary_thesis_metric ? `Primary Thesis Metric (${m.primary_thesis_metric.metric_name || 'Key Metric'}): ${m.primary_thesis_metric.value} [Evidence: ${m.primary_thesis_metric.evidence}]` : '';

      return `### Quarter: ${s.quarter}${idx === 0 ? ' 🔥 [LATEST CURRENT GROUND TRUTH PERIOD]' : ' (Historical Period)'}
- Thesis Signal: ${s.thesis_status} | Momentum: ${s.thesis_momentum} | Conviction Score: ${s.confidence_score}/100 | Action: ${s.final_action}
- Verified Financial & Thesis Metrics:
  • ${rev}
  • ${pat}
  • ${opm}
  ${primary ? `• ${primary}` : ''}
- Quarterly Executive Summary: ${s.summary || 'N/A'}`;
    }).join('\n\n');

    // Enforce Strict Temporal & Ground Truth Guard (Derives current quarter dynamically from latest snapshot or truth)
    const currentGroundTruthPeriod = (latestSnapshot && latestSnapshot.quarter) ? latestSnapshot.quarter : (truth?.period || 'Q1 FY27');

    let groundTruthBlock = '';
    if (truth && (!latestSnapshot || latestSnapshot.quarter === truth.period)) {
      groundTruthBlock = `
🔥 DEFINITIVE CURRENT REPORTING PERIOD GROUND TRUTH: ${currentGroundTruthPeriod}
(CRITICAL TEMPORAL GUARD: All analysis MUST treat ${currentGroundTruthPeriod} as the current reporting period!)

VERIFIED CANONICAL METRICS (${currentGroundTruthPeriod}):
• TOTAL_REVENUE = ₹${truth.revenue} Cr (${truth.revenueYoYGrowthPct >= 0 ? '+' : ''}${truth.revenueYoYGrowthPct}% YoY)
• CORE_PAT = ₹${truth.patConsolidated} Cr (${truth.patYoYGrowthPct >= 0 ? '+' : ''}${truth.patYoYGrowthPct}% YoY)
• REPORTED_PAT = ${truth.reportedPat ? `₹${truth.reportedPat} Cr (Includes ₹${truth.exceptionalGain} Cr Exceptional Item)` : 'Not Disclosed / Core PAT Only'}
• EBITDA_MARGIN_PCT = ${truth.ebitdaMarginPct}% (${truth.ebitdaMarginBpsDelta >= 0 ? '+' : ''}${truth.ebitdaMarginBpsDelta} bps YoY)
• TOTAL_ORDER_BACKLOG = ${truth.orderBookTotal ? `₹${truth.orderBookTotal} Cr` : 'Not Disclosed'}
• QUARTERLY_ORDER_INFLOW = ${truth.quarterlyOrderInflow ? `₹${truth.quarterlyOrderInflow} Cr booked in ${currentGroundTruthPeriod}` : 'Not Disclosed'}
• EXPORT_BACKLOG = ${truth.exportOrderBook ? `₹${truth.exportOrderBook} Cr` : 'Not Disclosed'}
`;
    } else if (latestSnapshot) {
      const m = latestSnapshot.metrics || {};
      groundTruthBlock = `
🔥 DEFINITIVE CURRENT REPORTING PERIOD GROUND TRUTH: ${currentGroundTruthPeriod}
(CRITICAL TEMPORAL GUARD: All analysis MUST treat ${currentGroundTruthPeriod} as the current reporting period!)

VERIFIED CANONICAL METRICS (${currentGroundTruthPeriod}):
• REVENUE_GROWTH = ${m.revenue_growth ? m.revenue_growth.value : 'N/A'} [Evidence: ${m.revenue_growth?.evidence || 'SEBI Filing'}]
• PAT_GROWTH = ${m.pat_growth ? m.pat_growth.value : 'N/A'} [Evidence: ${m.pat_growth?.evidence || 'SEBI Filing'}]
• EBITDA_MARGIN = ${m.opm ? m.opm.value : 'N/A'} [Evidence: ${m.opm?.evidence || 'SEBI Filing'}]
• LATEST_STATUS = Signal: ${latestSnapshot.thesis_status} | Momentum: ${latestSnapshot.thesis_momentum} | Action: ${latestSnapshot.final_action}
`;
    }

    const metricsPlaceholderContent = [
      `Key Thesis Definition: ${stock.key_thesis_metrics || 'Financial & Operational Performance'}`,
      groundTruthBlock,
      `⚡ VERIFIED SEBI REG 30 INTER-QUARTER DISCLOSURES & AGM DISCLOSURES:`,
      formattedInterQuarterEvents || 'No inter-quarter SEBI Reg 30 disclosures pending.',
      `\nHISTORICAL BASELINE DATA (FOR YoY/QoQ COMPARISON ONLY — NOT CURRENT STATUS):`,
      formattedMetricsHistory || 'No historical quarterly snapshot metrics recorded yet.'
    ].join('\n\n');

    const { rows: promptTemplates } = await pool.query(
      "SELECT name, title, template FROM prompt_templates ORDER BY name"
    );

    // Short-term execution commitments (Filter out ultra-long term >2030 targets and N/A noise)
    const shortTermComms = comms.filter(c => {
      const timeline = (c.timeline || '').toLowerCase();
      const statement = (c.statement || '').toLowerCase();
      if (timeline.includes('2035') || timeline.includes('2040') || timeline.includes('2050')) return false;
      if (statement.includes('n/a') && !c.metric) return false;
      return true;
    });

    const totalComms = shortTermComms.length;
    const achieved = shortTermComms.filter(c => (c.status || '').toLowerCase() === 'achieved').length;
    const missed = shortTermComms.filter(c => (c.status || '').toLowerCase() === 'missed').length;
    const partial = shortTermComms.filter(c => (c.status || '').toLowerCase().includes('partially')).length;
    const pending = shortTermComms.filter(c => (c.status || '').toLowerCase() === 'pending').length;
    const achievedPct = totalComms > 0 ? ((achieved / totalComms) * 100).toFixed(1) : '0.0';
    const missedPct = totalComms > 0 ? ((missed / totalComms) * 100).toFixed(1) : '0.0';
    const partialPct = totalComms > 0 ? ((partial / totalComms) * 100).toFixed(1) : '0.0';
    const pendingPct = totalComms > 0 ? ((pending / totalComms) * 100).toFixed(1) : '0.0';

    const commScorecard = `### Management Short-Term Guidance Execution Scorecard (Empirical Database Totals):
- Active Short-Term Tracked Commitments: ${totalComms}
- 🟢 Achieved / Fulfilled: ${achieved} (${achievedPct}%)
- 🔴 Missed / Broken Guidance: ${missed} (${missedPct}%)
- 🟡 Partially Achieved: ${partial} (${partialPct}%)
- ⏳ Pending / In-Progress: ${pending} (${pendingPct}%)`;

    // High-Density Structural Compression: Preserves short-term active commitments
    const achievedItems = shortTermComms.filter(c => c.status === 'Achieved').map(c => `${c.commitment_title || c.metric} (${c.statement})`).slice(0, 40).join('; ');
    const pendingItems = shortTermComms.filter(c => c.status === 'Pending').map(c => `${c.commitment_title || c.metric} (${c.timeline || 'Ongoing'})`).slice(0, 40).join('; ');
    const missedItems = shortTermComms.filter(c => c.status === 'Missed' || c.status === 'Broken').map(c => `${c.commitment_title || c.statement}`).join('; ');

    const commitmentsSummary = `
🟢 Achieved Commitments Breakdown (${achieved}):
${achievedItems || 'None'}

⏳ Pending & Ongoing Target Commitments Breakdown (${pending}):
${pendingItems || 'None'}
${missed > 0 ? `\n🔴 Missed / Broken Guidance Breakdown (${missed}):\n${missedItems}` : ''}`;

    // Fetch existing synthesis timestamps for ticker
    const { rows: existingSyntheses } = await pool.query(
      "SELECT prompt_name, updated_at FROM stock_syntheses WHERE ticker = $1",
      [ticker]
    );
    const existingMap = new Map(existingSyntheses.map(s => [s.prompt_name, new Date(s.updated_at).getTime()]));
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const nowMs = Date.now();

    for (const p of promptTemplates) {
      // If this prompt was updated in the last 6 hours, skip UNLESS force = true
      const lastUpdated = existingMap.get(p.name);
      if (!force && lastUpdated && (nowMs - lastUpdated < SIX_HOURS_MS)) {
        console.log(`[SYNTHESIS SKIP] Report '${p.title}' for ${ticker} updated recently (${Math.round((nowMs - lastUpdated)/60000)}m ago). Skipping.`);
        continue;
      }

      try {
        console.log(`[SYNTHESIS RUN] Generating report '${p.title}' for ${ticker}...`);
        let promptText = p.template
          .replace(/{{company_metrics}}/g, metricsPlaceholderContent)
          .replace(/{{company_name}}/g, stock.company_name)
          .replace(/{{ticker}}/g, stock.ticker);

        const factLockMandateBlock = `
🔥 IMMUTABLE CANONICAL FACT LOCK MANDATES (${currentGroundTruthPeriod}) 🔥
1. REVENUE GROUND TRUTH: Total Revenue = ₹${truth?.revenue || 'N/A'} Cr (+${truth?.revenueYoYGrowthPct || 'N/A'}% YoY). You MUST cite ONLY +${truth?.revenueYoYGrowthPct || 'N/A'}% as Total Revenue Growth.
2. CORE PAT GROUND TRUTH: Core PAT = ₹${truth?.patConsolidated || 'N/A'} Cr (+${truth?.patYoYGrowthPct || 'N/A'}% YoY). You MUST cite ONLY +${truth?.patYoYGrowthPct || 'N/A'}% as PAT Growth.
3. EBITDA MARGIN GROUND TRUTH: EBITDA Margin = ${truth?.ebitdaMarginPct || 'N/A'}% (${truth?.ebitdaMarginBpsDelta || 0} bps YoY).
4. QUALITATIVE CONVICTION ONLY: Conviction Score MUST be qualitative ONLY ("High", "Medium", "Low"). Outputting numeric "92/100" or "85%" IS FORBIDDEN AND WILL CAUSE IMMEDIATE REPORT REJECTION.
5. METRIC ID & LABEL LOCK:
   - Order Book / Backlog is ORDER BACKLOG ONLY. Never call it Revenue.
   - Export Backlog is EXPORT BACKLOG ONLY. Never call it Export Revenue or the revenue of any business line.
   - Unstated metrics (e.g. Capacity Utilization) MUST be rendered as "NOT DISCLOSED".
   - Do NOT mislabel historical EBITDA growth %, order book growth %, or export mix % as Current Revenue Growth.`;

        const fullPrompt = `${promptText}

Company: ${stock.company_name} (${stock.ticker})
Investment Thesis: ${stock.investment_thesis || 'Growth & Operating Leverage'}

${factLockMandateBlock}

🔥 LATEST REPORTING PERIOD GROUND TRUTH: ${currentGroundTruthPeriod} (CRITICAL MANDATE: All analysis MUST treat ${currentGroundTruthPeriod} as the current reporting period! Do NOT label historical Q3 FY26 as current!)

Multi-Quarter Financial & Operational Snapshots History:
${formattedMetricsHistory || 'No quarterly snapshot history available.'}

${commScorecard}

Compiled Multi-Quarter Management Commitments & Status Tracker:
${commitmentsSummary || 'No explicit commitments tracked yet.'}

── CRITICAL MANDATE FOR REPORT OUTPUT ──
Provide a comprehensive, professional institutional equity research analysis following the exact section structure defined above. Include the exact commitment totals and breakdown percentages from the scorecard above.`;

        const factRegistry = buildFactRegistry(ticker);

        let finalReportContent = null;
        let attemptPrompt = fullPrompt;

        for (let attempt = 1; attempt <= 3; attempt++) {
          console.log(`[SYNTHESIS RE-PROMPT] Attempt ${attempt}/3 executing NIM LLM generation for ${ticker} (${p.title})...`);
          const rawOutput = await runNimPrompt(
            "You are a Senior Managing Director & Chief Equity Strategist at a top-tier institutional fund. You provide 100% evidence-anchored, zero-hallucination institutional equity research reports.",
            attemptPrompt
          );

          if (!rawOutput || rawOutput.length < 50) {
            console.warn(`[SYNTHESIS RE-PROMPT] Attempt ${attempt}/3 returned empty or short output for ${ticker}. Retrying...`);
            continue;
          }

          console.log(`[FACT LOCK VALIDATING] Attempt ${attempt}/3 evaluating 8 Machine Gates for ${ticker}...`);
          const validation = validateSynthesisClaims(rawOutput, factRegistry);
          if (validation.valid) {
            console.log(`[FACT LOCK PASSED] Attempt ${attempt}/3 passed all 8 Machine Gates for ${ticker}!`);
            finalReportContent = rawOutput;
            break;
          } else {
            console.warn(`[FACT LOCK REJECT] Attempt ${attempt}/3 failed validation for ${ticker} (${p.title}):`, validation.errors);
            attemptPrompt = `${fullPrompt}

⚠️ CRITICAL PREVIOUS VALIDATION FAILURE CORRECTION (ATTEMPT ${attempt + 1}):
Your previous output was rejected due to the following FACT LOCK errors:
${validation.errors.map(e => `• ${e}`).join('\n')}

YOU MUST CORRECTION THESE ERRORS IN THIS RE-PROMPT:
1. Do NOT present an order backlog, order book or other forward-looking figure as revenue or as a business line's revenue.
2. Do NOT cite revenue or PAT growth percentages that differ from the CANONICAL_FACTS section given above; use only those figures.
3. Do NOT mark a full-year target 'Achieved' before the year has ended. Use ONLY 'ON_TRACK' or 'AT_RISK'.
4. Do NOT assign a number to capacity utilization if the filing does not state one. Output ONLY 'NOT DISCLOSED'.`;
          }
        }

        if (finalReportContent) {
          // Programmatically prepend Machine-Readable Metadata Header & Q1 FY27 Period Anchor
          const metadataHeader = `<!-- METADATA_HEADER: { "ticker": "${ticker}", "reporting_period": "${currentGroundTruthPeriod}", "fact_lock_version": "1.0", "validation_status": "PASS", "gates_passed": 8, "generated_at": "${new Date().toISOString()}" } -->
**Quarterly Update: ${currentGroundTruthPeriod}**

`;
          // Clean out any accidental legacy Q3 FY26 header lines generated by LLM
          let cleanProse = finalReportContent.replace(/\*\*Quarterly Update:?\s*Q3\s*FY26\*\*/gi, '');
          cleanProse = cleanProse.replace(/Quarterly Update:?\s*Q3\s*FY26/gi, '');
          
          const structuredReportContent = metadataHeader + cleanProse.trim();

          await pool.query(
            `INSERT INTO stock_syntheses (stock_id, ticker, prompt_name, prompt_title, report_content, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (stock_id, prompt_name) 
             DO UPDATE SET report_content = EXCLUDED.report_content, prompt_title = EXCLUDED.prompt_title, updated_at = NOW()`,
            [stock.id, ticker, p.name, p.title, structuredReportContent]
          );
          console.log(`[SYNTHESIS SUCCESS] Saved report '${p.title}' for ${ticker} (Passed Fact Lock Validation & Prepend Metadata Header)`);
        } else {
          console.error(`[SYNTHESIS BLOCK] Report '${p.title}' for ${ticker} BLOCKED from saving due to repeated Fact Lock validation failures.`);
        }
      } catch (err) {
        console.error(`[SYNTHESIS WARNING] Deferred report '${p.title}' for ${ticker} to next run:`, err.message);
        // Continue to next prompt or defer cleanly to subsequent run
      }
    }
  } catch (err) {
    console.error(`[SYNTHESIS ERROR] Failed synthesis for ${ticker}:`, err.message);
  }
}

/**
 * Generates structured, segment-by-segment institutional concall highlights for Telegram.
 */
export async function generateStructuredConcallHighlights(ticker, companyName, docText) {
  if (!docText || docText.length < 300) return null;

  // Clean boilerplate cover letters
  let cleanText = docText;
  const concallStart = docText.toLowerCase().search(/(?:management:|moderator:|management\s+opening|presentation|executive\s+summary|q&a|question\s+and\s+answer|remarks|highlights)/i);
  if (concallStart !== -1 && concallStart < 5000) {
    cleanText = docText.substring(concallStart);
  }
  cleanText = capContext(cleanText, 24000);

  const systemPrompt = `You are a Senior Managing Director & Chief Equity Strategist at a top-tier institutional research firm. Extract a structured concall highlight report from the earnings conference call transcript. You report ONLY what the transcript explicitly states: every figure you write must be printed in the transcript, with its unit and comparison as spoken. If the call does not give a figure or topic, return an empty list for that section. Never estimate, round up, infer, or reuse any number or name from these instructions.`;
  const userPrompt = `
Company: ${companyName} (${ticker})
Concall Transcript Content:
${cleanText}

Extract the following structured sections from the transcript above (and nothing else):
1. "financial_performance": the revenue/income, EBITDA and margin, PAT, order book, export order book, cash position and order inflow figures management stated for the period, each with the comparison management gave.
2. "business_performance": contract wins, customer orders and segment or division performance management described, with the order sizes they stated.
3. "growth_initiatives": new certifications, technology partnerships, new product categories, prototypes and similar initiatives management announced.
4. "operational_highlights": plant commissioning status, facility expansions, capacity and utilisation figures, network growth and execution timelines management stated.
5. "quarterly_guidance": explicit guidance for the next quarter only. Return [] if none was given.
6. "annual_guidance": explicit guidance for the full fiscal year. Return [] if none was given.
7. "multi_year_targets": explicit 3-5 year roadmap or long-term targets. Return [] if none were given.
8. "key_positives": the main positive execution points made on the call (at most 5).
9. "key_challenges": the main risks or headwinds management or analysts raised (at most 4).
10. "management_tone": the tone of management in 2-3 words.
11. "key_takeaway": one sentence bottom line that uses only facts stated on the call.

Rules: no placeholders (never write X, Y, Z or "details"); no figure that is not in the transcript; an empty list is the correct answer when the call is silent on a section.

Return ONLY a valid JSON object with exactly these keys:
{
  "financial_performance": ["<metric name>: <figure with unit and comparison as stated on the call>"],
  "business_performance": ["<order or segment item as stated on the call>"],
  "growth_initiatives": ["<initiative as stated on the call>"],
  "operational_highlights": ["<operational item as stated on the call>"],
  "quarterly_guidance": ["<next-quarter guidance as stated on the call>"],
  "annual_guidance": ["<full-year guidance as stated on the call>"],
  "multi_year_targets": ["<long-term target as stated on the call>"],
  "key_positives": ["<positive point from the call>"],
  "key_challenges": ["<risk or headwind from the call>"],
  "management_tone": "<2-3 words>",
  "key_takeaway": "<one sentence>"
}
`;

  try {
    const resText = await runNimPrompt(systemPrompt, userPrompt, 0.05);
    if (!resText) return null;
    let cleaned = resText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(cleaned);
      if (!parsed.management_guidance) {
        parsed.management_guidance = [
          ...(parsed.quarterly_guidance || []),
          ...(parsed.annual_guidance || []),
          ...(parsed.multi_year_targets || [])
        ];
      }
      return parsed;
    }
  } catch (err) {
    console.warn(`[CONCALL HIGHLIGHTS WARN] Failed for ${ticker}:`, err.message);
  }
  return null;
}

