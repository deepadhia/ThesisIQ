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
    ticker, title, priority, impact, summary, confidence,
    key_data, deep_dive_indicator, promises_reconciliation, thesis_strengthened, result_date,
    is_earnings_release, concall_type, concall_date, concall_time, is_rescheduled, category, exchangeTimestamp, docUrl, source = "NSE",
    is_agm, agm_status, agm_highlights, thesis_drift_state, root_cause, recovery_state, final_action, action_signal_authorized = false
  } = params || {};

  const impactEmoji = impact === "POSITIVE" ? "📈" : impact === "NEGATIVE" ? "📉" : "⚖️";
  
  // Format the exchange timestamp to IST
  const timestamp = exchangeTimestamp 
    ? new Date(exchangeTimestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : getIstTimestamp();

  // ── 1. Clean Compact Header ────────────────────────────────────────────────
  let message = `${impactEmoji} *${ticker.toUpperCase()}* | *${priority.toUpperCase()} PRIORITY*\n`;
  message    += `_${category ? category : "Corporate Announcement"}_ • 🏛️ ${source}\n`;
  message    += `─────────────────────────\n`;

  // ── 2. Event Banner ────────────────────────────────────────────────────────
  if (is_earnings_release) {
    message += `💰 *FINANCIAL RESULTS DECLARED*\n─────────────────────────\n`;
  } else if (is_agm && agm_status === "completed") {
    message += `🏛️ *AGM PROCEEDINGS COMPLETED*\n─────────────────────────\n`;
  } else if (concall_type === "transcript") {
    message += `📄 *CONCALL TRANSCRIPT AUDITED*\n─────────────────────────\n`;
  } else if (concall_type === "audio") {
    message += `🎧 *CONCALL AUDIO RECORDING*\n─────────────────────────\n`;
  }

  // ── 3. Executive Summary (Crisp Bullet Points) ────────────────────────────
  if (summary) {
    message += `📋 *EXECUTIVE SUMMARY*\n${formatToBullets(summary)}\n\n`;
  }

  // ── 3b. AGM Highlights & Speech Takeaways ──────────────────────────────────
  if (is_agm && agm_status === "completed" && agm_highlights) {
    const highlightsText = Array.isArray(agm_highlights) 
      ? agm_highlights.map(h => `• ${h}`).join("\n") 
      : formatToBullets(agm_highlights);
    if (highlightsText && !highlightsText.toLowerCase().includes("null")) {
      message += `🏛️ *AGM HIGHLIGHTS & MANAGEMENT SPEECH*\n${highlightsText}\n\n`;
    }
  }

  // ── 4. Key Financial & Operational Data ──────────────────────────────────
  if (key_data && key_data !== "No specific figures disclosed." && key_data !== "No specific figures extracted.") {
    message += `📊 *KEY METRICS & MECHANICS*\n${formatToBullets(key_data)}\n\n`;
  }

  // ── 5. Primary Thesis Impact ──────────────────────────────────────────────
  const thesisContent = thesis_strengthened || deep_dive_indicator;
  if (thesisContent) {
    message += `🛡️ *THESIS IMPLICATION*\n${formatToBullets(thesisContent)}\n\n`;
  }

  // ── 6. Event Impact & Action Signal (Institutional Gatekeeping) ─────────────
  // IMPORTANT:
  // Event impact and investment action are separate concepts.
  // POSITIVE / NEGATIVE describes how the event affects the thesis.
  // BUY / ACCUMULATE requires explicit authorization from audited
  // earnings/concall analysis passing the applicable quantitative gates.
  // Strategic catalysts must NEVER independently authorize capital allocation.

  const isAuditedAction = Boolean(action_signal_authorized) && (Boolean(is_earnings_release) || Boolean(concall_type));

  if (is_earnings_release && !concall_type && !isAuditedAction) {
    // Raw financial table ingested prior to full concall / quantitative gate audit
    message += `🎯 *EARNINGS AUDIT:* ⏳ *AWAITING CONCALL TRANSCRIPT (Raw Financials Ingested — Pending Gate Audit)*\n`;
  } else if (isAuditedAction && final_action) {
    // Authorized action from completed quarterly deep-dive worker passing quantitative gates
    const actionUpper = final_action.toUpperCase();
    const actionEmoji = actionUpper.includes('BUY') || actionUpper.includes('ACCUMULATE') ? '🟢' : actionUpper.includes('HOLD') ? '🟡' : '🔴';
    message += `🎯 *ACTION SIGNAL:* ${actionEmoji} *${actionUpper}*\n`;
  } else if (impact === 'POSITIVE') {
    // Strategic corporate actions (M&A, restructuring, order wins)
    message += `🎯 *THESIS IMPACT:* 🟢 *POSITIVE* — Strategic Catalyst; Await Earnings Evidence\n`;
  } else if (impact === 'NEGATIVE') {
    message += `🎯 *THESIS IMPACT:* 🔴 *NEGATIVE* — Potential Thesis Deviation; Assess Earnings Impact\n`;
  } else {
    message += `🎯 *THESIS IMPACT:* ⚪ *NEUTRAL* — No Material Thesis Change\n`;
  }

  // ── 7. Document Link & Timestamp Footer ───────────────────────────────────
  if (docUrl) {
    message += `\n📄 [View Official Filing →](${docUrl})\n`;
  }
  message += `─────────────────────────\n`;
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

  let message = `📊 *Daily Processor Scan Summary* ${isDryRun ? "_(DRY RUN)_" : ""}\n`;
  message    += `─────────────────────────\n`;
  message    += `🏢 *Stocks scanned:* ${stocksScanned}\n`;
  message    += `📋 *New filings found:* ${newAnnouncements}\n`;
  message    += `📣 *Alerts sent:* ${alertsSent}\n`;

  // ── Stock-Wise Promises & Guidance Audit Section ──────────────────────────
  if (Object.keys(stockMap).length > 0) {
    message += `\n📌 *STOCK-WISE GUIDANCE & PROMISE AUDIT*\n`;
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

  message += `\n─────────────────────────\n`;
  if (bseErrors > 0 || nseErrors > 0) {
    message += `⚠️ *Fetch errors:* BSE ${bseErrors} | NSE ${nseErrors}\n`;
  }

  message += `⏱️ *Duration:* ${durationSec}s\n`;
  message += `${status}\n`;

  if (runUrl) {
    message += `\n[View Workflow Run →](${runUrl})\n`;
  }

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
  let message = `⚠️ *CONCALL AUDIT: DISCREPANCY DETECTED*\n`;
  message += `🏢 *${(companyName || ticker).toUpperCase()}* (${ticker.toUpperCase()})\n`;
  message += `⚖️ *Forensic Audit Severity:* ${discrepancyScore}/10\n`;
  message += `─────────────────────────\n`;
  message += `🔍 *Audit Summary:*\n${summaryVerdict}\n\n`;

  if (discrepancies && discrepancies.length > 0) {
    message += `📋 *Identified Variances:*\n`;
    for (const d of discrepancies.slice(0, 4)) {
      message += `• *${d.category || "VARIANCE"}:*\n`;
      if (d.audio_claim) message += `  🎙️ _Live Audio:_ "${d.audio_claim.slice(0, 140)}"\n`;
      if (d.written_transcript_claim) message += `  📄 _Transcript:_ "${d.written_transcript_claim.slice(0, 140)}"\n`;
      if (d.investor_implication) message += `  💡 _Impact:_ ${d.investor_implication.slice(0, 140)}\n`;
      message += `\n`;
    }
  }

  message += `─────────────────────────\n`;
  if (docUrl) {
    message += `📄 [View Official Transcript Filing](${docUrl})\n`;
  }
  message += `_🕐 ${timestamp}_`;

  return sendTelegramMessage(message);
}
