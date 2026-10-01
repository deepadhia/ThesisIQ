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

      // Resilient fallback: If Telegram Markdown parsing fails due to unescaped characters, retry cleanly
      if (errorData.description && errorData.description.includes("can't parse entities")) {
        console.warn("[TELEGRAM WARN] Retrying alert dispatch without Markdown parse_mode due to entity parsing error...");
        const fallbackRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: text.replace(/[*_`\[\]]/g, ""),
            disable_web_page_preview: true,
          }),
        });
        if (fallbackRes.ok) {
          return await fallbackRes.json();
        }
      }

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
function cleanReaderFriendlyText(text) {
  if (!text) return "";
  return text
    // Convert Indian crore expressions: "Rs. 94.81/- Crores only", "574 crore" -> "₹574 Cr"
    .replace(/(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*(?:\/-)?\s*crores?(?:\s*only)?/gi, " ₹$1 Cr ")
    // Convert Lakhs to ₹ Cr if >= 100 Lakhs, else ₹X Lakhs
    .replace(/(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*(?:\/-)?\s*lakhs?(?:\s*only)?/gi, (match, numStr) => {
      const val = parseFloat(numStr.replace(/,/g, ""));
      return val >= 100 ? ` ₹${(val / 100).toFixed(2)} Cr ` : ` ₹${val.toFixed(2)} Lakhs `;
    })
    // Convert 7 or 8-digit full rupees (e.g. ₹5,00,00,000 or Rs. 10,00,00,000/-) into ₹ Cr
    .replace(/(?:₹|Rs\.?|INR)\s*([\d,]+)(?:\/-)?\s*(?:only)?/gi, (match, numStr) => {
      const cleanNum = parseFloat(numStr.replace(/,/g, ""));
      if (cleanNum >= 10000000) {
        return ` ₹${(cleanNum / 10000000).toFixed(2)} Cr `;
      } else if (cleanNum >= 100000) {
        return ` ₹${(cleanNum / 100000).toFixed(2)} Lakhs `;
      }
      return match;
    })
    .replace(/([\d,]+)\s*\/-(\s*(?:only)?)?/gi, (match, numStr) => {
      const cleanNum = parseFloat(numStr.replace(/,/g, ""));
      if (cleanNum >= 10000000) {
        return ` ₹${(cleanNum / 10000000).toFixed(2)} Cr `;
      } else if (cleanNum >= 100000) {
        return ` ₹${(cleanNum / 100000).toFixed(2)} Lakhs `;
      }
      return match;
    })
    // Clean legalistic boilerplate
    .replace(/pursuant to regulation \d+[^,\.]*[,.]?/gi, "")
    .replace(/under regulation \d+ of (?:the )?sebi [^,\.]*[,.]?/gi, "")
    .replace(/in terms of regulation \d+[^,\.]*[,.]?/gi, "")
    .replace(/pursuant to a rights issue made by [^,\.]*under section \d+[^,\.]*[,.]?/gi, "")
    .replace(/read with sebi master circular[^,\.]*[,.]?/gi, "")
    .replace(/with effect from the appointed date of/gi, "effective")
    .replace(/further to our letter dated[^,\.]*[,.]?/gi, "")
    .replace(/intimation under regulation \d+[^,\.]*[-–]?/gi, "")
    .replace(/hereby informs that|we wish to inform that|this is to inform you that/gi, "announced that")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function formatToBullets(text) {
  if (!text) return "";
  const cleaned = cleanReaderFriendlyText(
    text
      .replace(/^•\s*/, "")
      .replace(/^(summary|executive summary|key takeaways?|highlights?):\s*/i, "")
      .trim()
  );

  // Protect abbreviations, titles, and decimal numbers before splitting
  const protectedText = cleaned
    .replace(/\b(Sr|Jr|Mr|Mrs|Ms|Dr|Prof|Ltd|Inc|Corp|Co|Pvt|Rs|vs|approx|viz|No|Dept|EVP|SVP|VP|CTO|CFO|CEO|MD|AGM|EGM)\./gi, "$1__DOT__")
    .replace(/(\d+)\.(\d+)/g, "$1__DECIMAL__$2");

  const sentences = protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => s
      .replace(/__DOT__/g, ".")
      .replace(/__DECIMAL__/g, ".")
      .trim()
    )
    .filter(Boolean);

  if (sentences.length > 1) {
    return sentences.map(s => `• ${s}`).join("\n");
  }
  return `• ${cleaned}`;
}

export function cleanCompanyName(name) {
  if (!name) return "";
  return name
    .replace(/\s+share\s+price\s*$/i, "")
    .replace(/\s+(?:ltd|limited)\b\.?/gi, " Ltd")
    .replace(/\s+ltd\s+ltd/gi, " Ltd")
    .trim();
}

function isNotDisclosed(val) {
  if (!val) return true;
  const s = String(val).trim().toLowerCase();
  return (
    s === "null" ||
    s === "undefined" ||
    s === "not disclosed" ||
    s === "not applicable" ||
    s === "n/a" ||
    s === "none" ||
    s === "nil" ||
    s.startsWith("not disclosed") ||
    s.startsWith("none disclosed")
  );
}

function isValidBullet(bullet) {
  if (!bullet) return false;
  const s = String(bullet).trim().toLowerCase();
  if (s.length < 5) return false;
  if (
    s.includes("not disclosed") ||
    s.includes("no export orders") ||
    s.includes("none disclosed") ||
    s.includes("voltage classes not disclosed")
  ) {
    return false;
  }
  return true;
}

function cleanBullet(text) {
  if (!text) return "";
  return String(text).replace(/^•\s*/, "").trim();
}

/**
 * Formats a high-impact, professional institutional flash note alert for Telegram.
 */
export function formatAnnouncementMessage(params) {
  const {
    ticker, title, priority = "MEDIUM", impact = "NEUTRAL", summary, confidence,
    forward_catalysts, financial_metrics, corporate_actions,
    key_data, key_omissions_or_risks, deep_dive_indicator, promises_reconciliation, thesis_strengthened, result_date,
    is_earnings_release, concall_type, concall_date, concall_time, is_rescheduled, category, filing_category, exchangeTimestamp, docUrl, source = "NSE",
    is_agm, is_egm, is_postal_ballot, agm_status, agm_highlights, has_substantive_business_insights,
    companyName, thesis_drift_state, root_cause, recovery_state, final_action, action_signal_authorized = false,
    eventAnalysis = null, event_analysis = null
  } = params || {};

  const analysis = eventAnalysis || event_analysis;
  const priorityBadge = priority === "HIGH" ? "🔴 High Priority" : priority === "MEDIUM" ? "🟡 Medium Priority" : "⚪ Low Priority";
  
  // Format the exchange timestamp to IST
  const timestamp = exchangeTimestamp 
    ? new Date(exchangeTimestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : getIstTimestamp();

  // Determine Event Label with strict EGM / Postal Ballot / Milestone separation
  let eventTypeLabel = "Corporate Filing";
  let isMilestoneEvent = false;

  const titleLower = (title || "").toLowerCase();
  const isCommissioningFiling = 
    filing_category === "CAPEX_COMMISSIONING" ||
    titleLower.includes("commercial production") ||
    titleLower.includes("commercial operation") ||
    titleLower.includes("commissioning of plant") ||
    titleLower.includes("plant commissioning");

  const hasSubstantiveInsights = Boolean(
    has_substantive_business_insights ||
    titleLower.includes("speech") ||
    titleLower.includes("address") ||
    titleLower.includes("presentation") ||
    titleLower.includes("investor presentation")
  );

  if (is_earnings_release) eventTypeLabel = "Financial Results & Performance";
  else if (is_agm && (titleLower.includes("presentation") || titleLower.includes("investor presentation"))) {
    eventTypeLabel = "AGM Investor Presentation & Strategy";
  }
  else if (is_agm && (titleLower.includes("speech") || titleLower.includes("address") || (agm_status === "completed" && hasSubstantiveInsights))) {
    eventTypeLabel = "AGM Chairman's Strategic Address";
  }
  else if (is_agm && agm_status === "completed") {
    eventTypeLabel = "AGM Voting Proceedings (Procedural)";
  }
  else if (is_agm) {
    eventTypeLabel = "Annual General Meeting (AGM) Notice";
  }
  else if (is_egm) eventTypeLabel = "Extraordinary General Meeting (EGM) Notice";
  else if (is_postal_ballot) eventTypeLabel = "Postal Ballot Notice";
  else if (isCommissioningFiling) {
    eventTypeLabel = "🏆 Key Thesis Milestone: Capacity Expansion & Commissioning";
    isMilestoneEvent = true;
  }
  else if (filing_category === "ORDER_WIN") eventTypeLabel = "Order Win & Contract Award";
  else if (filing_category === "CAPITAL_RAISE") eventTypeLabel = "Capital Raise & Strategic Infusion";
  else if (filing_category === "CAPITAL_RETURN") eventTypeLabel = "Capital Action (Bonus / Split / Dividend)";
  else if (filing_category === "RESTRUCTURING") eventTypeLabel = "Corporate Restructuring & Scheme of Merger";
  else if (filing_category === "REGULATORY_ACTION") eventTypeLabel = "Regulatory Action / Clearance";
  else if (filing_category === "GOVERNANCE_RISK") eventTypeLabel = "Management / Governance Update";
  else if (filing_category === "CREDIT_EVENT") eventTypeLabel = "Credit Rating Action";
  else if (filing_category === "ACQUISITION") eventTypeLabel = "🤝 M&A / Strategic Acquisition";
  else if (concall_type === "transcript") eventTypeLabel = "Concall Transcript Audit";
  else if (concall_type === "audio") eventTypeLabel = "Concall Audio Recording";

  const cleanedCompany = cleanCompanyName(companyName);
  const companyHeader = cleanedCompany ? `*${ticker.toUpperCase()}* | ${cleanedCompany}` : `*${ticker.toUpperCase()}*`;

  let message = `🏢 ${companyHeader}\n`;
  message    += `📢 *Event:* ${eventTypeLabel} • ${isMilestoneEvent ? "🟢 *High Catalyst*" : priorityBadge}\n`;
  message    += `──────────────────────────────\n\n`;

  // Milestone Highlight Banner
  if (isMilestoneEvent) {
    message += `⭐ *MILESTONE FULFILLMENT:* 🟢 *COMMISSIONED & OPERATIONAL*\n\n`;
  }

  // 1. Executive Summary / What Happened
  if (summary) {
    message += `💡 *Executive Summary:*\n${formatToBullets(summary)}\n\n`;
  }

  // 2. Specialized Key Details / Metrics (strictly deduplicated against summary)
  const summaryLower = (summary || "").toLowerCase();
  
  if (filing_category === "ORDER_WIN" && analysis?.extracted_data) {
    const ext = analysis.extracted_data;
    const orderDetails = [];
    if (ext.order_value_cr && !isNotDisclosed(ext.order_value_cr)) {
      orderDetails.push(`• Total Value: ₹${ext.order_value_cr} Cr`);
    }
    if (ext.revenue_visibility_impact && !isNotDisclosed(ext.revenue_visibility_impact)) {
      const cleanScale = cleanBullet(ext.revenue_visibility_impact)
        .replace(/^(order scale relative to annual run-rate|scale relative to run-rate|relative scale|order scale):\s*/i, "");
      orderDetails.push(`• Relative Scale: ${cleanReaderFriendlyText(cleanScale)}`);
    }
    if (ext.scope_and_voltage && !isNotDisclosed(ext.scope_and_voltage)) {
      orderDetails.push(`• Scope: ${cleanReaderFriendlyText(cleanBullet(ext.scope_and_voltage))}`);
    } else if (Array.isArray(ext.order_breakdown) && ext.order_breakdown.length > 0) {
      const validItems = ext.order_breakdown.filter(b => isValidBullet(b));
      if (validItems.length > 0) {
        orderDetails.push(`• Scope: ${validItems.map(b => cleanReaderFriendlyText(cleanBullet(b))).slice(0, 2).join(", ")}`);
      }
    }
    if (ext.client_name && !isNotDisclosed(ext.client_name)) {
      orderDetails.push(`• Client: ${cleanBullet(ext.client_name)}`);
    }
    if (ext.margin_and_thesis_impact && !isNotDisclosed(ext.margin_and_thesis_impact)) {
      orderDetails.push(`• Margin Driver: ${cleanReaderFriendlyText(cleanBullet(ext.margin_and_thesis_impact))}`);
    } else if (ext.thesis_relevance && !isNotDisclosed(ext.thesis_relevance)) {
      orderDetails.push(`• Margin Driver: ${cleanReaderFriendlyText(cleanBullet(ext.thesis_relevance))}`);
    }
    if (ext.execution_period_months && !isNotDisclosed(ext.execution_period_months)) {
      orderDetails.push(`• Execution Timeline: ${ext.execution_period_months} months`);
    }
    if (orderDetails.length > 0) {
      message += `📊 *Order Highlights:*\n${orderDetails.join("\n")}\n\n`;
    }
  } else if (filing_category === "CAPITAL_RAISE" && analysis?.extracted_data) {
    const ext = analysis.extracted_data;
    const capDetails = [];
    let targetStr = "";
    if (ext.target_entity) {
      if (typeof ext.target_entity === "object") {
        const entName = ext.target_entity.entity || ext.target_entity.name || "";
        const relName = ext.target_entity.relationship ? ` (${ext.target_entity.relationship})` : "";
        targetStr = `${entName}${relName}`.trim();
      } else {
        targetStr = cleanBullet(ext.target_entity);
      }
    }
    targetStr = targetStr.replace(/^(?:rights issue|investment|preferential allotment|qip)\s+(?:in|into)\s+/i, "");
    if (targetStr && !isNotDisclosed(targetStr)) {
      capDetails.push(`• Target Entity: ${cleanReaderFriendlyText(targetStr)}`);
    }
    if (ext.raise_type && !isNotDisclosed(ext.raise_type)) {
      capDetails.push(`• Instrument: ${cleanReaderFriendlyText(cleanBullet(ext.raise_type))}`);
    }
    if (ext.total_amount_cr && !isNotDisclosed(ext.total_amount_cr)) {
      let cumStr = "";
      if (ext.cumulative_infused_cr && !isNotDisclosed(ext.cumulative_infused_cr)) {
        const cVal = String(ext.cumulative_infused_cr).trim();
        cumStr = cVal.includes("Cr") ? ` (Cumulative: ${cVal})` : ` (Cumulative: ₹${cVal} Cr)`;
      }
      capDetails.push(`• Infusion Amount: ₹${ext.total_amount_cr} Cr${cumStr}`);
    } else if (ext.total_amount_raised_cr && !isNotDisclosed(ext.total_amount_raised_cr)) {
      capDetails.push(`• Total Amount Raised: ₹${ext.total_amount_raised_cr} Cr`);
    }
    if (ext.issue_price && !isNotDisclosed(ext.issue_price)) {
      const pVal = String(ext.issue_price).trim();
      const formattedPrice = /^\d+(\.\d+)?$/.test(pVal) ? `₹${pVal}/share at par` : pVal;
      capDetails.push(`• Issue Terms: ${cleanReaderFriendlyText(cleanBullet(formattedPrice))}`);
    }
    if (ext.shareholding_pct && !isNotDisclosed(ext.shareholding_pct)) {
      const sVal = String(ext.shareholding_pct).trim();
      const formattedPct = /^\d+(\.\d+)?$/.test(sVal) ? `${sVal}% ownership retained` : sVal;
      capDetails.push(`• Ownership Post-Issue: ${cleanBullet(formattedPct)}`);
    } else if (ext.dilution_percentage && !isNotDisclosed(ext.dilution_percentage)) {
      capDetails.push(`• Equity Dilution: ${cleanBullet(ext.dilution_percentage)}`);
    }
    if (ext.parent_cash_outflow_cr && !isNotDisclosed(ext.parent_cash_outflow_cr)) {
      capDetails.push(`• Parent Cash Outgo: ${cleanReaderFriendlyText(cleanBullet(ext.parent_cash_outflow_cr))}`);
    }
    if (ext.use_of_proceeds && !isNotDisclosed(ext.use_of_proceeds)) {
      capDetails.push(`• Strategic Purpose: ${cleanReaderFriendlyText(cleanBullet(ext.use_of_proceeds))}`);
    }
    if (capDetails.length > 0) {
      message += `📊 *Capital Infusion Details:*\n${capDetails.join("\n")}\n\n`;
    }
  } else if (filing_category === "RESTRUCTURING" && analysis?.extracted_data) {
    const ext = analysis.extracted_data;
    const restDetails = [];
    let transEntity = "";
    if (ext.transferor_entity) {
      transEntity = typeof ext.transferor_entity === "object" 
        ? (ext.transferor_entity.entity || ext.transferor_entity.name || "") 
        : ext.transferor_entity;
      transEntity = cleanBullet(transEntity);
    }
    if (transEntity && !isNotDisclosed(transEntity)) {
      restDetails.push(`• Merging Entity: ${cleanReaderFriendlyText(transEntity)}`);
    }
    if (ext.scheme_type && !isNotDisclosed(ext.scheme_type)) {
      restDetails.push(`• Structure: ${cleanReaderFriendlyText(cleanBullet(ext.scheme_type))}`);
    }
    if (ext.swap_ratio && !isNotDisclosed(ext.swap_ratio)) {
      restDetails.push(`• Share Swap Ratio: ${cleanReaderFriendlyText(cleanBullet(ext.swap_ratio))}`);
    }
    if (ext.dilution_percentage && !isNotDisclosed(ext.dilution_percentage)) {
      restDetails.push(`• Equity Dilution: ${cleanBullet(ext.dilution_percentage)}`);
    }
    if (ext.financials_absorbed && !isNotDisclosed(ext.financials_absorbed)) {
      let finStr = "";
      if (typeof ext.financials_absorbed === "object") {
        const parts = [];
        if (ext.financials_absorbed.turnover) parts.push(`Revenue: ${cleanReaderFriendlyText(ext.financials_absorbed.turnover)}`);
        if (ext.financials_absorbed.net_profit || ext.financials_absorbed.ebitda) parts.push(`PAT: ${cleanReaderFriendlyText(ext.financials_absorbed.net_profit || ext.financials_absorbed.ebitda)}`);
        if (ext.financials_absorbed.net_worth) parts.push(`Net Worth: ${cleanReaderFriendlyText(ext.financials_absorbed.net_worth)}`);
        finStr = parts.join(" | ");
      } else {
        finStr = cleanReaderFriendlyText(cleanBullet(ext.financials_absorbed));
      }
      if (finStr) {
        restDetails.push(`• Financials Absorbed: ${finStr}`);
      }
    }
    if (ext.strategic_rationale && !isNotDisclosed(ext.strategic_rationale)) {
      restDetails.push(`• Strategic Rationale: ${cleanReaderFriendlyText(cleanBullet(ext.strategic_rationale))}`);
    }
    if (ext.approval_horizon_months && !isNotDisclosed(ext.approval_horizon_months)) {
      restDetails.push(`• Regulatory Horizon: ${cleanBullet(ext.approval_horizon_months)}`);
    } else if (ext.nclt_sebi_stage && !isNotDisclosed(ext.nclt_sebi_stage)) {
      restDetails.push(`• Approval Stage: ${cleanBullet(ext.nclt_sebi_stage)}`);
    }
    if (restDetails.length > 0) {
      message += `📊 *Merger Terms & Valuation:*\n${restDetails.join("\n")}\n\n`;
    }
  } else if (filing_category === "CAPEX_COMMISSIONING" && analysis?.extracted_data) {
    const ext = analysis.extracted_data;
    const capexDetails = [];
    if (ext.capacity_added_or_expanded && !isNotDisclosed(ext.capacity_added_or_expanded)) {
      capexDetails.push(`• Capacity Added: ${cleanReaderFriendlyText(cleanBullet(ext.capacity_added_or_expanded))}`);
    }
    if (ext.facility_location && !isNotDisclosed(ext.facility_location)) {
      capexDetails.push(`• Plant Location: ${cleanBullet(ext.facility_location)}`);
    }
    if (ext.phase_details && !isNotDisclosed(ext.phase_details)) {
      capexDetails.push(`• Milestone Status: ${cleanBullet(ext.phase_details)}`);
    }
    if (ext.backward_integration_impact && !isNotDisclosed(ext.backward_integration_impact)) {
      capexDetails.push(`• Margin Benefit: ${cleanReaderFriendlyText(cleanBullet(ext.backward_integration_impact))}`);
    }
    if (ext.revenue_and_order_visibility && !isNotDisclosed(ext.revenue_and_order_visibility)) {
      capexDetails.push(`• Order Support: ${cleanReaderFriendlyText(cleanBullet(ext.revenue_and_order_visibility))}`);
    }
    if (capexDetails.length > 0) {
      message += `📊 *Capacity & Capex Details:*\n${capexDetails.join("\n")}\n\n`;
    }
  } else if (filing_category === "ACQUISITION" && analysis?.extracted_data) {
    const ext = analysis.extracted_data;
    const acqDetails = [];
    if (ext.target_company && !isNotDisclosed(ext.target_company)) {
      acqDetails.push(`• Target Entity: ${ext.target_company}`);
    }
    if (ext.deal_value_cr && !isNotDisclosed(ext.deal_value_cr)) {
      acqDetails.push(`• Total Consideration: ₹${ext.deal_value_cr} Cr`);
    }
    if (ext.cash_consideration_cr && !isNotDisclosed(ext.cash_consideration_cr)) {
      acqDetails.push(`• Cash Payout: ₹${ext.cash_consideration_cr} Cr`);
    }
    if (ext.equity_swap_cr && !isNotDisclosed(ext.equity_swap_cr)) {
      acqDetails.push(`• Share Swap Consideration: ₹${ext.equity_swap_cr} Cr`);
    }
    if (ext.strategic_rationale && !isNotDisclosed(ext.strategic_rationale)) {
      acqDetails.push(`• Strategic Rationale: ${cleanReaderFriendlyText(ext.strategic_rationale)}`);
    }
    if (acqDetails.length > 0) {
      message += `📊 *M&A Consideration & Synergies:*\n${acqDetails.join("\n")}\n\n`;
    }
  } else {
    // Collect distinct metrics/catalysts without duplication
    const collectedItems = new Set();
    const detailBullets = [];

    const addUniqueBullet = (item) => {
      if (!item) return;
      const clean = cleanReaderFriendlyText(cleanBullet(item));
      if (clean.length < 5 || isNotDisclosed(clean) || clean.toLowerCase().includes("no specific")) return;
      
      const cleanLower = clean.toLowerCase();
      // Extract numeric & key token fingerprint (e.g. "dividend_0.20", "slump_sale")
      const keyTokens = cleanLower.match(/[a-z]{4,}|\d+(?:\.\d+)?/g) || [];
      const fingerprint = keyTokens.slice(0, 3).join("_");

      if (collectedItems.has(cleanLower) || (fingerprint && collectedItems.has(fingerprint))) return;

      // Filter if summary already covers both the topic and figures
      if (summaryLower.includes(cleanLower.slice(0, 25))) return;

      collectedItems.add(cleanLower);
      if (fingerprint) collectedItems.add(fingerprint);
      detailBullets.push(`• ${clean}`);
    };

    // Forward catalysts / AGM highlights
    const catalysts = Array.isArray(forward_catalysts) && forward_catalysts.length > 0 
      ? forward_catalysts 
      : (is_agm && agm_highlights ? (Array.isArray(agm_highlights) ? agm_highlights : [agm_highlights]) : []);
    catalysts.forEach(addUniqueBullet);

    // Financial metrics & Corporate actions
    if (Array.isArray(financial_metrics)) financial_metrics.forEach(addUniqueBullet);
    if (Array.isArray(corporate_actions)) corporate_actions.forEach(addUniqueBullet);

    if (detailBullets.length > 0) {
      const sectionHeader = isCommissioningFiling 
        ? "📊 *Capacity & Capex Details:*"
        : (filing_category === "ACQUISITION" ? "📊 *M&A Consideration & Synergies:*" : ((is_agm && hasSubstantiveInsights) ? "📊 *Strategic Insights & Forward Guidance:*" : "📊 *Key Details:*"));
      message += `${sectionHeader}\n${detailBullets.slice(0, 3).join("\n")}\n\n`;
    }
  }

  // Information Gaps & Omissions (Institutional Red Flags)
  const rawOmission = analysis?.extracted_data?.key_omissions_or_risks || key_omissions_or_risks;
  if (rawOmission && !isNotDisclosed(rawOmission)) {
    const cleanOmission = cleanReaderFriendlyText(cleanBullet(rawOmission));
    if (cleanOmission.length > 5 && !cleanOmission.toLowerCase().includes("none") && !cleanOmission.toLowerCase().includes("null")) {
      message += `⚠️ *Key Information Gaps:*\n• ${cleanOmission}\n\n`;
    }
  }

  // 3. Strategic & Thesis Impact
  const thesisContent = thesis_strengthened || deep_dive_indicator;
  const isAuditedAction = Boolean(action_signal_authorized) && (Boolean(is_earnings_release) || Boolean(concall_type));

  let impactBadge = `⚪ *NEUTRAL* — No Material Thesis Change`;
  if (impact === 'POSITIVE') {
    impactBadge = `🟢 *POSITIVE* — Strategic Catalyst / Value Accretive`;
  } else if (impact === 'NEGATIVE') {
    impactBadge = `🔴 *NEGATIVE* — Potential Thesis Deviation / Headwind`;
  }

  if (isAuditedAction && final_action) {
    const actionUpper = final_action.toUpperCase();
    const actionEmoji = actionUpper.includes('BUY') || actionUpper.includes('ACCUMULATE') ? '🟢' : actionUpper.includes('HOLD') ? '🟡' : '🔴';
    message += `🎯 *Action Verdict:* ${actionEmoji} *${actionUpper}*\n\n`;
  } else {
    message += `🎯 *Thesis Impact:*\n${impactBadge}\n`;
    if (thesisContent && !thesisContent.toLowerCase().includes("no specific") && !thesisContent.toLowerCase().includes("does not reinforce")) {
      const cleanThesis = thesisContent.replace(/^•\s*/, "").trim();
      if (!summaryLower.includes(cleanThesis.slice(0, 30).toLowerCase())) {
        message += `_${cleanThesis}_\n`;
      }
    }
    message += `\n`;
  }

  // 4. Footer
  message += `──────────────────────────────\n`;
  if (docUrl) {
    message += `📄 [View Official Filing →](${docUrl}) • 🕐 ${timestamp} (${source})`;
  } else {
    message += `🕐 ${timestamp} (${source})`;
  }

  return message;
}

/**
 * Sends a high-impact, professional institutional flash note alert to Telegram.
 */
export async function sendAnnouncementAlert(params) {
  const { is_agm, agm_status, has_substantive_business_insights, title = "" } = params || {};
  const tLower = (title || "").toLowerCase();
  const isProceduralVoting = 
    (is_agm && agm_status === "completed" && !has_substantive_business_insights) ||
    tLower.includes("voting result") || 
    tLower.includes("scrutinizer report");

  if (isProceduralVoting) {
    console.log(`[ALERT SUPPRESSED] Procedural AGM/Voting proceedings suppressed from live Telegram dispatch: ${title}`);
    return false;
  }

  const message = formatAnnouncementMessage(params);
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
  message    += `──────────────────────────────\n`;
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

  message += `──────────────────────────────\n`;
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
  const cleanedCompany = cleanCompanyName(companyName);
  const companyHeader = cleanedCompany ? `*${ticker.toUpperCase()}* | ${cleanedCompany}` : `*${ticker.toUpperCase()}*`;
  let message = `🏢 ${companyHeader}\n`;
  message += `🚨 *Event:* Forensic Concall Audit • *Severity:* ${discrepancyScore}/10\n`;
  message += `──────────────────────────────\n`;
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
  message += `──────────────────────────────\n`;
  message += `_Institutional Forensic Concall Audit • 🕐 ${timestamp}_`;

  return sendTelegramMessage(message);
}
