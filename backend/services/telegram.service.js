import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "../config/env.js";

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
export async function sendAnnouncementAlert({
  ticker, title, priority, impact, summary, confidence,
  key_data, deep_dive_indicator, result_date,
  is_earnings_release, concall_type, concall_date, concall_time, is_rescheduled, category, exchangeTimestamp, docUrl, source = "BSE"
}) {
  const priorityEmoji  = priority === "HIGH" ? "🔴" : priority === "MEDIUM" ? "🟡" : "⚪";
  const impactEmoji    = impact === "POSITIVE" ? "📈" : impact === "NEGATIVE" ? "📉" : "⚖️";
  const confidenceBadge = confidence === "HIGH" ? "✅ HIGH" : "⚠️ LOW";
  const categoryLabel  = category ? `[${category.toUpperCase()}]` : "";
  
  // Format the exchange timestamp to IST
  const timestamp = exchangeTimestamp 
    ? new Date(exchangeTimestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : getIstTimestamp();

  // ── Header ────────────────────────────────────────────────────────────────
  let message = `🚀 *${priority} IMPACT ALERT*\n`;
  message    += `${impactEmoji} *${impact.toUpperCase()}* | *${ticker.toUpperCase()}*\n`;
  message    += `_${category ? category : "General"}_ • 🏛️ ${source}\n`;
  message    += `─────────────────────────\n`;

  // ── Earnings Release Banner ───────────────────────────────────────────────
  if (is_earnings_release) {
    message += `💰 *FINANCIAL RESULTS DECLARED* 💰\n`;
    message += `─────────────────────────\n`;
  }

  // ── Concall / Transcript Banner ───────────────────────────────────────────
  if (concall_type) {
    if (concall_type === "transcript") {
      message += `📄 *CONCALL TRANSCRIPT OUT* 📄\n`;
    } else if (concall_type === "audio") {
      message += `🎧 *CONCALL AUDIO RECORDING OUT* 🎧\n`;
    } else if (concall_type === "scheduled") {
      if (is_rescheduled) {
        message += `🔄 *CONCALL RESCHEDULED* 🔄\n`;
      } else {
        message += `📅 *CONCALL SCHEDULED / INTIMATION* 📅\n`;
      }
    } else {
      message += `🎤 *CONCALL COMPLETED* 🎤\n`;
    }
    message += `─────────────────────────\n`;

    // Add concall date/time info if available
    if (concall_date) {
      let dateStr = concall_date;
      try {
        const parsedDate = new Date(concall_date);
        if (!isNaN(parsedDate.getTime())) {
          dateStr = parsedDate.toLocaleDateString("en-IN", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }
      } catch (e) {
        // use raw date string if parsing fails
      }
      
      const timeStr = concall_time ? ` at ${concall_time}` : "";
      message += `🎙️ *Concall Details:* ${dateStr}${timeStr}\n`;
      message += `─────────────────────────\n`;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  message += `📋 *Summary*\n${summary}\n\n`;

  // ── Key Figures ───────────────────────────────────────────────────────────
  if (key_data && key_data !== "No specific figures disclosed." && key_data !== "No specific figures extracted.") {
    message += `📊 *Key Data & Metrics*\n${key_data}\n\n`;
  }

  // ── Investment Thesis / Risk ──────────────────────────────────────────────
  if (deep_dive_indicator) {
    message += `🔍 *Investment Context*\n${deep_dive_indicator}\n\n`;
  }

  // ── Meta info ─────────────────────────────────────────────────────────────
  message += `🎯 *AI Confidence:* ${confidenceBadge}\n`;

  // ── Next Results Date ─────────────────────────────────────────────────────
  if (result_date) {
    message += `📅 *Next Results:* ${result_date}\n`;
  }

  // ── Document Link ─────────────────────────────────────────────────────────
  if (docUrl) {
    message += `\n📄 [View Official Filing →](${docUrl})\n`;
  }

  message += `─────────────────────────\n`;
  message += `_"${title}"_\n`;
  message += `_🕐 ${timestamp}_`;

  return sendTelegramMessage(message);
}

// ─── Run Summary ──────────────────────────────────────────────────────────────

/**
 * Sends a post-scan run summary to Telegram.
 * Gives you visibility into every run — not just when alerts fire.
 *
 * @param {object} stats
 * @param {number} stats.stocksScanned      - Total stocks checked
 * @param {number} stats.newAnnouncements   - New announcements found (after dedup)
 * @param {number} stats.alertsSent         - HIGH priority alerts sent to Telegram
 * @param {number} stats.bseErrors          - Stocks where BSE fetch failed
 * @param {number} stats.nseErrors          - Stocks where NSE fetch failed
 * @param {number} stats.durationMs         - Total run time in ms
 * @param {string} [stats.runUrl]           - GitHub Actions run URL
 * @param {boolean} [stats.isDryRun]        - Was this a dry run?
 */
export async function sendRunSummary({
  stocksScanned, newAnnouncements, alertsSent,
  bseErrors = 0, nseErrors = 0, durationMs = 0,
  runUrl, isDryRun = false
}) {
  const durationSec = (durationMs / 1000).toFixed(1);
  const timestamp   = getIstTimestamp();

  // Don't send a summary if nothing interesting happened and no errors
  const isQuiet = newAnnouncements === 0 && bseErrors === 0 && nseErrors === 0;
  if (isQuiet) {
    console.log(`[SUMMARY] Quiet run — no new announcements. Skipping Telegram summary.`);
    return;
  }

  let status;
  if (alertsSent > 0)          status = `🟢 ${alertsSent} alert${alertsSent > 1 ? "s" : ""} sent`;
  else if (newAnnouncements > 0) status = "🟡 New filings found (below threshold)";
  else                           status = "🔵 Clean run — no new announcements";

  let message = `📊 *Scan Summary* ${isDryRun ? "_(DRY RUN)_" : ""}\n`;
  message    += `─────────────────────────\n`;
  message    += `🏢 *Stocks scanned:* ${stocksScanned}\n`;
  message    += `📋 *New filings found:* ${newAnnouncements}\n`;
  message    += `📣 *Alerts sent:* ${alertsSent}\n`;

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
