import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "../config/env.js";
import { pool } from "../db/pool.js";

/**
 * Telegram Bot Service
 * Sends formatted alerts to a configured Telegram chat.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the current time formatted in IST (Indian Standard Time).
 * @returns {string} e.g. "11:42 AM IST"
 */
function getIstTimestamp() {
  return new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).toUpperCase() + " IST";
}

/**
 * Builds a BSE filing document URL from a NEWS_ID and PDFFLAG.
 * PDFFLAG routing (reverse-engineered from BSE AngularJS controller):
 *   0 → AttachLive (current filings)
 *   1 → AttachHis  (historical filings)
 *   2 → CorpAttachment (corporate actions)
 *
 * @param {string|number} newsId
 * @param {number} pdfFlag - 0, 1, or 2
 * @returns {string|null}
 */
export function buildBseDocumentUrl(newsId, pdfFlag) {
  if (!newsId) return null;
  const basePaths = {
    0: "AttachLive",
    1: "AttachHis",
    2: "CorpAttachment",
  };
  const base = basePaths[Number(pdfFlag)] ?? "AttachLive";
  return `https://www.bseindia.com/xml-data/corpfiling/${base}/${newsId}.pdf`;
}

// ─── Core send ────────────────────────────────────────────────────────────────

/**
 * Sends a message to the configured Telegram chat.
 * @param {string} text - Markdown formatted text.
 */
export async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("Telegram bot token or chat ID not configured.");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: "Markdown",
        // Disable web page preview so PDF links don't expand into huge blocks
        disable_web_page_preview: true,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[TELEGRAM ERROR] API failed:", errorData);
      throw new Error(`Telegram API error: ${errorData.description}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Telegram API request timed out (20s)");
    }
    throw err;
  }
}

// ─── Announcement Alert ───────────────────────────────────────────────────────

/**
 * Formats and sends a detailed corporate announcement alert.
 * For HIGH priority: includes BSE document link, timestamp, and deep analysis.
 *
 * @param {object} params
 * @param {string}  params.ticker
 * @param {string}  params.title              - Raw announcement title (from BSE/NSE)
 * @param {string}  params.priority           - HIGH | MEDIUM | LOW
 * @param {string}  params.impact             - POSITIVE | NEGATIVE | NEUTRAL
 * @param {string}  params.summary            - AI-generated summary (multi-sentence)
 * @param {string}  params.confidence         - HIGH | LOW
 * @param {string}  [params.key_data]         - Specific numbers/figures extracted
 * @param {string}  [params.deep_dive_indicator] - Why investor should dig deeper
 * @param {string}  [params.result_date]      - YYYY-MM-DD of next results
 * @param {string}  [params.news_id]          - BSE NEWS_ID for document link
 * @param {number}  [params.pdf_flag]         - BSE PDFFLAG (0/1/2) for URL routing
 * @param {string}  [params.source]           - "BSE" | "NSE"
 */
function formatToBullets(text) {
  if (!text) return "";
  const cleaned = text.trim();
  if (cleaned.startsWith("•") || cleaned.startsWith("-") || cleaned.startsWith("*")) {
    return cleaned;
  }
  // Convert multi-sentence paragraphs into crisp bullet points
  const sentences = cleaned.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(s => s.trim()).filter(Boolean);
  if (sentences.length > 1) {
    return sentences.map(s => `• ${s}`).join("\n");
  }
  return `• ${cleaned}`;
}

/**
 * Sends a high-impact, institutional-grade announcement alert to Telegram.
 */
export async function sendAnnouncementAlert(params) {
  const {
    ticker, title, priority = "MEDIUM", impact = "NEUTRAL", summary, confidence,
    forward_catalysts, financial_metrics, corporate_actions,
    key_data, deep_dive_indicator, promises_reconciliation, thesis_strengthened, result_date,
    is_earnings_release, concall_type, concall_date, concall_time, is_rescheduled, category, filing_category, exchangeTimestamp, docUrl, source = "NSE",
    is_agm, agm_status, agm_highlights, companyName, thesis_drift_state, root_cause, recovery_state, final_action, action_signal_authorized = false
  } = params || {};

  const priorityEmoji = priority === "HIGH" ? "🔴 HIGH" : priority === "MEDIUM" ? "🟡 MEDIUM" : "⚪ LOW";
  
  // Format the exchange timestamp to IST
  const timestamp = exchangeTimestamp 
    ? new Date(exchangeTimestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : getIstTimestamp();

  // Determine Event Label
  let eventTypeLabel = "Corporate Filing";
  if (is_earnings_release) eventTypeLabel = "Financial Results & Performance";
  else if (is_agm && agm_status === "completed") eventTypeLabel = "AGM Proceedings & Strategic Address";
  else if (is_agm) eventTypeLabel = "Annual General Meeting Notice";
  else if (filing_category === "CAPEX_COMMISSIONING") eventTypeLabel = "Capacity Expansion & Plant Commissioning";
  else if (filing_category === "ORDER_WIN") eventTypeLabel = "Order Win & Contract Award";
  else if (filing_category === "CAPITAL_RAISE") eventTypeLabel = "Capital Raise (QIP / Preferential Issue)";
  else if (filing_category === "CAPITAL_RETURN") eventTypeLabel = "Capital Action (Bonus / Split / Dividend)";
  else if (filing_category === "RESTRUCTURING") eventTypeLabel = "Corporate Restructuring & Scheme of Arrangement";
  else if (filing_category === "REGULATORY_ACTION") eventTypeLabel = "⚖️ Regulatory Action / Clearance / Order";
  else if (filing_category === "GOVERNANCE_RISK") eventTypeLabel = "⚠️ Governance / Auditor / Legal Risk Alert";
  else if (filing_category === "CREDIT_EVENT") eventTypeLabel = "💳 Credit Rating Action";
  else if (filing_category === "ACQUISITION") eventTypeLabel = "🤝 M&A / Strategic Investment / Joint Venture";
  else if (concall_type === "transcript") eventTypeLabel = "Concall Transcript Audit";
  else if (concall_type === "audio") eventTypeLabel = "Concall Audio Recording";

  const companyHeader = companyName ? `${ticker.toUpperCase()} (${companyName})` : ticker.toUpperCase();
  const categoryHeader = category ? category : "Watchlist";

  let message = `🏢 *${companyHeader}*\n`;
  message    += `*Event:* ${eventTypeLabel} | *Priority:* ${priorityEmoji}\n`;
  message    += `*Exchange:* ${source} • *Category:* ${categoryHeader}\n`;
  message    += `────────────────────────────────────────────\n`;

  // 1. Bottom-Line Up Front (Key Takeaway)
  if (summary) {
    message += `💡 *KEY TAKEAWAY*\n${formatToBullets(summary)}\n\n`;
  }

  // 2. Forward Catalysts & Regulatory Moats
  const catalysts = Array.isArray(forward_catalysts) && forward_catalysts.length > 0 
    ? forward_catalysts 
    : (is_agm && agm_highlights ? (Array.isArray(agm_highlights) ? agm_highlights : [agm_highlights]) : null);

  if (catalysts && catalysts.length > 0) {
    const cleanCatalysts = catalysts
      .filter(c => c && !String(c).toLowerCase().includes("null") && String(c).trim().length > 5)
      .map(c => c.startsWith("•") ? c : `• ${c}`)
      .join("\n");
    if (cleanCatalysts) {
      message += `🚀 *FORWARD CATALYSTS & REGULATORY MOATS*\n${cleanCatalysts}\n\n`;
    }
  }

  // 3. Financial & Operating Highlights
  if (Array.isArray(financial_metrics) && financial_metrics.length > 0) {
    const cleanMetrics = financial_metrics
      .filter(m => m && String(m).trim().length > 3)
      .map(m => m.startsWith("•") ? m : `• ${m}`)
      .join("\n");
    if (cleanMetrics) {
      message += `📊 *FINANCIAL & OPERATING HIGHLIGHTS*\n${cleanMetrics}\n\n`;
    }
  } else if (key_data && key_data !== "No specific figures disclosed." && key_data !== "No specific figures extracted." && !catalysts) {
    const splitMetrics = key_data.split(";").map(s => s.trim()).filter(Boolean);
    const formattedData = splitMetrics.map(s => `• ${s.replace(/^•\s*/, "")}`).join("\n");
    message += `📊 *KEY METRICS & MECHANICS*\n${formattedData}\n\n`;
  }

  // 4. Capital Allocation & Corporate Actions
  if (Array.isArray(corporate_actions) && corporate_actions.length > 0) {
    const cleanActions = corporate_actions
      .filter(a => a && String(a).trim().length > 3)
      .map(a => a.startsWith("•") ? a : `• ${a}`)
      .join("\n");
    if (cleanActions) {
      message += `🏛️ *CAPITAL ALLOCATION & BALANCE SHEET*\n${cleanActions}\n\n`;
    }
  }

  // 5. Primary Thesis Impact & Gate Verdict
  const thesisContent = thesis_strengthened || deep_dive_indicator;
  if (thesisContent && !thesisContent.toLowerCase().includes("no specific")) {
    message += `🛡️ *THESIS IMPLICATION*\n${formatToBullets(thesisContent)}\n\n`;
  }

  // 6. Action Signal / Thesis Impact
  const isAuditedAction = Boolean(action_signal_authorized) && (Boolean(is_earnings_release) || Boolean(concall_type));

  if (is_earnings_release && !concall_type && !isAuditedAction) {
    message += `🎯 *EARNINGS GATE:* ⏳ *AWAITING CONCALL TRANSCRIPT (Raw Financials Ingested)*\n`;
  } else if (isAuditedAction && final_action) {
    const actionUpper = final_action.toUpperCase();
    const actionEmoji = actionUpper.includes('BUY') || actionUpper.includes('ACCUMULATE') ? '🟢' : actionUpper.includes('HOLD') ? '🟡' : '🔴';
    message += `🎯 *ACTION SIGNAL:* ${actionEmoji} *${actionUpper}*\n`;
  } else if (impact === 'POSITIVE') {
    message += `🎯 *THESIS IMPACT:* 🟢 *POSITIVE* — Strategic Catalyst; Await Earnings Evidence\n`;
  } else if (impact === 'NEGATIVE') {
    message += `🎯 *THESIS IMPACT:* 🔴 *NEGATIVE* — Potential Thesis Deviation; Assess Earnings Impact\n`;
  } else {
    message += `🎯 *THESIS IMPACT:* ⚪ *NEUTRAL* — No Material Thesis Change\n`;
  }

  // 7. Footer
  if (docUrl) {
    message += `\n📄 [View Official Filing →](${docUrl})\n`;
  }
  message += `────────────────────────────────────────────\n`;
  message += `_Filing: "${title}" • 🕐 ${timestamp}_`;

  return sendTelegramMessage(message);
}

// ─── Run Summary ──────────────────────────────────────────────────────────────

/**
 * Sends a post-scan run summary to Telegram.
 * In live daemon mode, this is SILENT unless alerts were sent.
 */
export async function sendRunSummary({
  stocksScanned, newAnnouncements, alertsSent,
  bseErrors = 0, nseErrors = 0, durationMs = 0,
  runUrl, isDryRun = false
}) {
  const durationSec = (durationMs / 1000).toFixed(1);
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  // In 24/7 daemon mode, NEVER send summary if 0 alerts were sent (prevents 5-minute spam)
  if (alertsSent === 0 && !isDryRun) {
    console.log(`[SUMMARY] 0 alerts sent. Quiet daemon run — skipping Telegram summary.`);
    return;
  }

  // Fetch commitments fulfilled (Achieved) or broken (Missed) in the last 24 hours only if there are live events
  let fulfilledPromises = [];
  let brokenPromises = [];
  try {
    const { rows: fulfilled } = await pool.query(
      `SELECT ticker, metric, statement, evidence_summary 
       FROM management_commitments 
       WHERE status = 'Achieved' 
         AND created_at > NOW() - INTERVAL '24 hours' 
       ORDER BY created_at DESC LIMIT 5`
    );
    fulfilledPromises = fulfilled;

    const { rows: missed } = await pool.query(
      `SELECT ticker, metric, statement, evidence_summary 
       FROM management_commitments 
       WHERE status = 'Missed' 
         AND created_at > NOW() - INTERVAL '24 hours' 
       ORDER BY created_at DESC LIMIT 5`
    );
    brokenPromises = missed;
  } catch (err) {
    console.warn("[SUMMARY] Failed to query recent commitment reconciliations:", err.message);
  }

  // Group commitments by stock ticker
  const stockMap = {};

  for (const f of fulfilledPromises) {
    const t = f.ticker.toUpperCase();
    if (!stockMap[t]) stockMap[t] = { fulfilled: [], missed: [] };
    stockMap[t].fulfilled.push(f);
  }

  for (const m of brokenPromises) {
    const t = m.ticker.toUpperCase();
    if (!stockMap[t]) stockMap[t] = { fulfilled: [], missed: [] };
    stockMap[t].missed.push(m);
  }

  let status;
  if (alertsSent > 0)          status = `🟢 ${alertsSent} alert${alertsSent > 1 ? "s" : ""} sent`;
  else if (newAnnouncements > 0) status = "🟡 New filings found (below threshold)";
  else                           status = "🔵 Clean run — no new announcements";

  let message = `📊 *DAILY PROCESSOR SCAN SUMMARY* ${isDryRun ? "_(DRY RUN)_" : ""}\n`;
  message    += `────────────────────────────────────────────\n`;
  message    += `🏢 *Stocks Scanned:* ${stocksScanned}\n`;
  message    += `📋 *New Filings Found:* ${newAnnouncements}\n`;
  message    += `📣 *Alerts Dispatched:* ${alertsSent}\n`;
  message    += `⏱️ *Duration:* ${durationSec}s | *Status:* ${status}\n`;

  // ── Stock-Wise Promises & Guidance Audit Section ──────────────────────────
  if (Object.keys(stockMap).length > 0) {
    message += `\n📌 *GUIDANCE & PROMISE RECONCILIATIONS*\n`;
    for (const [ticker, data] of Object.entries(stockMap)) {
      message += `\n🏢 *${ticker}*\n`;
      for (const f of data.fulfilled) {
        message += `  • 🟢 *Fulfilled (${f.metric}):* ${(f.evidence_summary || f.statement).substring(0, 110)}\n`;
      }
      for (const m of data.missed) {
        message += `  • 🔴 *Broken/Missed (${m.metric}):* ${(m.evidence_summary || m.statement).substring(0, 110)}\n`;
      }
    }
  }

  if (bseErrors > 0 || nseErrors > 0) {
    message += `\n⚠️ *Fetch Errors:* BSE ${bseErrors} | NSE ${nseErrors}\n`;
  }

  if (runUrl) {
    message += `\n📄 [View Workflow Run →](${runUrl})\n`;
  }

  message += `────────────────────────────────────────────\n`;
  message += `_🕐 ${timestamp}_`;

  return sendTelegramMessage(message);
}

/**
 * Sends a high-priority Telegram alert when a discrepancy is detected
 * between live Concall Audio and the official Written Transcript.
 */
export async function sendConcallDiscrepancyAlert({
  ticker,
  companyName,
  discrepancyScore = 5,
  summaryVerdict,
  discrepancies = [],
  docUrl
}) {
  const timestamp = getIstTimestamp();
  const companyHeader = companyName ? `${ticker.toUpperCase()} (${companyName})` : ticker.toUpperCase();
  let message = `⚠️ *${companyHeader}*\n`;
  message += `*Event:* Forensic Concall Audit | *Severity:* ${discrepancyScore}/10 🚨\n`;
  message += `────────────────────────────────────────────\n`;
  message += `🔍 *AUDIT SUMMARY*\n${formatToBullets(summaryVerdict)}\n\n`;

  if (discrepancies && discrepancies.length > 0) {
    message += `📋 *IDENTIFIED VARIANCES*\n`;
    for (const d of discrepancies.slice(0, 4)) {
      message += `• *${d.category || "VARIANCE"}:*\n`;
      if (d.audio_claim) message += `  🎙️ _Live Audio:_ "${d.audio_claim.slice(0, 140)}"\n`;
      if (d.written_transcript_claim) message += `  📄 _Transcript:_ "${d.written_transcript_claim.slice(0, 140)}"\n`;
      if (d.investor_implication) message += `  💡 _Impact:_ ${d.investor_implication.slice(0, 140)}\n`;
      message += `\n`;
    }
  }

  if (docUrl) {
    message += `📄 [View Official Transcript Filing →](${docUrl})\n`;
  }
  message += `────────────────────────────────────────────\n`;
  message += `_Institutional Forensic Concall Audit • 🕐 ${timestamp}_`;

  return sendTelegramMessage(message);
}
