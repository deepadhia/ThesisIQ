/**
 * NVIDIA NIM Service (Geforce Now API)
 * Uses OpenSource models (Llama 3.1) for intelligence classification.
 */

import { NVIDIA_API_KEY } from "../config/env.js";
import { extractDeterministicFinancials } from "./financial-validator.service.js";
import { applyInstitutionalGuard } from "./institutional-guard.service.js";

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * Classifies a corporate announcement using NVIDIA NIM.
 * @param {string} ticker
 * @param {string} announcementText
 * @param {string} title
 * @returns {Promise<object>}
 */
export async function classifyAnnouncementWithNim(ticker, announcementText, title, investmentThesis = null) {
  if (!NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY not configured.");
  }

  let displayThesis = investmentThesis;
  if (investmentThesis && typeof investmentThesis === 'string' && investmentThesis.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(investmentThesis);
      if (parsed.primary_thesis) {
        displayThesis = parsed.primary_thesis;
      }
    } catch (e) {
      // Not JSON or parse failed, use raw string
    }
  }

  const thesisSection = displayThesis 
    ? `── Investment Thesis (Context) ──\n${displayThesis}\n`
    : "";

  // Cap text to 32,000 chars for comprehensive full-document NIM processing
  let cappedText = announcementText || "";
  if (cappedText.length > 32000) {
    const half = 15000;
    cappedText = `${cappedText.substring(0, half)}\n\n[... TRUNCATED MIDDLE CONTENT FOR FAST NIM LATENCY ...]\n\n${cappedText.substring(cappedText.length - half)}`;
  }

  const prompt = `
    You are a sharp, top-tier Indian equity research analyst writing institutional flash alerts for portfolio managers.
    Analyze this BSE/NSE corporate filing and return a high-signal, non-redundant, institutional-grade classification.
    
    Ticker: ${ticker}
    Announcement Title: ${title}

    ${thesisSection}

    ── Core Investment Objective ──
    Evaluate if this announcement reinforces or breaks the primary investment thesis.
    Extract the operational and financial core with ZERO generic filler, ZERO repetitive text, and 100% numerical precision.

    ── Priority Standards ──
    HIGH:
      • Manufacturing Plant Commissionings, Capacity Expansions, and Commercial Production Milestones.
      • Large Order Wins (>10% annual revenue), Major Tenders, Contract Awards.
      • Regulatory Approvals, Patents, Licenses, PESO/FDA Clearances, Strategic Moats, Defence Trial Orders.
      • Quarterly / Annual Financial Results and Earnings Releases.
      • M&A, Restructuring, Demergers, Spin-offs, Mergers.
      • Completed AGMs / Annual Reports with substantive Chairman/MD addresses, multi-year forward guidance, or special resolutions (QIP, Preferential Issues).
      • Material CXO/Auditor exits, Credit Rating Downgrades, Regulatory/IT/ED Actions.
    MEDIUM:
      • Moderate order wins, Dividends, Credit Rating Upgrades/Affirmations on debt, standard capacity maintenance, Scheduled concalls.
    LOW:
      • Routine compliance filings, share certificate loss, routine voting tallies without management speeches, future AGM date notices without special business, window closure notices, newspaper publications.

    ── Structured Extraction & Formatting Rules ──
    1. EXECUTIVE TAKEAWAY (1-2 sentences): Explain the core event, headline numbers (₹Cr, %, MW, km/yr), and its immediate strategic significance.
    2. FORWARD CATALYSTS & STRATEGIC MOATS: List specific forward-looking operational drivers (regulatory approvals, defence trials, commercial off-take agreements, capacity commissioning dates, guidance targets) ONLY if explicitly disclosed in this text. If none, return [].
    3. FINANCIAL & OPERATING HIGHLIGHTS: List individual metric strings (e.g. Order value, Revenue, EBITDA margin, PAT) ONLY if explicitly disclosed in this text. If filing is non-financial, return an empty array [].
    4. CAPITAL ALLOCATION & BALANCE SHEET: List specific actions (QIP details, Debt reduction, Merger terms, Capex outlay, Bonus/Split ratio, Dividend per share) ONLY if explicitly stated in this text. If none, return an empty array [].
    5. STRICT ZERO-HALLUCINATION & ANTI-DUPLICATION RULE: Extract ONLY facts present in this document. NEVER invent figures, company names, or copy example templates. If an event type is not present, return an empty array [].
    6. DYNAMIC UNIT NORMALIZATION: Convert all Lakhs / Millions into standardized INR CRORES (₹ Cr) with explicit labels.

    Return ONLY a valid JSON object matching this schema:
    {
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "impact": "POSITIVE" | "NEGATIVE" | "NEUTRAL",
      "confidence": "HIGH" | "LOW",
      "summary": "1-2 sentence high-impact executive takeaway answering 'What happened and why does it matter?'.",
      "forward_catalysts": [
        "Category or Milestone: Specific verified operational driver from this document..."
      ],
      "financial_metrics": [
        "Metric Name: Explicit figure with unit and YoY/QoQ comparison from this document..."
      ],
      "corporate_actions": [
        "Action Type: Explicit transaction size and terms from this document..."
      ],
      "key_data": "Formatted single summary line of key figures if applicable, else null.",
      "deep_dive_indicator": "1 sharp line detailing the exact thesis risk or catalyst.",
      "thesis_strengthened": "1 sharp line on how this event impacts the core investment thesis.",
      "is_earnings_release": true | false,
      "result_date": "YYYY-MM-DD or null",
      "concall_date": "YYYY-MM-DD or null",
      "concall_time": "HH:MM or null",
      "is_rescheduled": true | false,
      "is_agm": true | false,
      "agm_status": "scheduled" | "completed" | null,
      "has_substantive_business_insights": true | false
    }

    Announcement Text:
    ${cappedText}
  `;

  const ACTIVE_MODELS = [
    "meta/llama-3.2-11b-vision-instruct",
    "openai/gpt-oss-20b",
    "nvidia/nemotron-3-super-120b-a12b"
  ];
  const MAX_RETRIES = 4;
  const BASE_DELAY_MS = 2000;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const currentModel = ACTIVE_MODELS[(attempt - 1) % ACTIVE_MODELS.length];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout (NIM can be slow)

    try {
      const response = await fetch(NIM_BASE_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: currentModel,
          messages: [
            {
              role: "system",
              content: "You are a highly rigorous, institutional-grade Indian equity research analyst. Your summaries must begin with a clear, high-level qualitative verdict of whether the results/news are overall good (strong/expansion), flat/neutral, or bad (weak/contraction) relative to expectations or thesis, followed by the key supporting metrics. Completely avoid generic boilerplate advice.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 1800,
          response_format: { type: "json_object" },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorData = {};
        try {
          errorData = await response.json();
        } catch (_) {}
        console.error(`[AI ERROR] NVIDIA NIM model ${currentModel} failed (attempt ${attempt}/${MAX_RETRIES}):`, errorData);
        
        lastError = new Error(`NVIDIA NIM API error (${currentModel}): ${errorData.title || response.statusText || response.status}`);
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * attempt;
          console.warn(`[NIM] Falling back to next model in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      try {
        const cleanJson = content.replace(/```json\n?/, "").replace(/\n?```/, "").trim();
        const parsed = JSON.parse(cleanJson);

        // Apply Deterministic Financial Extractor & Post-Processing Guard Layer
        const finData = extractDeterministicFinancials(announcementText);
        parsed._raw_text = announcementText;
        return applyInstitutionalGuard(parsed, finData, title, ticker);
      } catch (err) {
        console.error(`Failed to parse NIM response as JSON (attempt ${attempt}/${MAX_RETRIES}):`, content);
        if (attempt < MAX_RETRIES) {
          console.warn(`[NIM] Invalid JSON response, retrying...`);
          continue;
        }
        throw new Error("AI output was not valid JSON.");
      }
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      if (err.name === "AbortError") {
        lastError = new Error("NVIDIA NIM API request timed out (90s)");
      }

      const isNetworkOrTimeout = err.name === "TypeError" || err.name === "AbortError" || err.message.includes("fetch");
      if (isNetworkOrTimeout && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * attempt;
        console.warn(`[RETRY] NIM classification attempt ${attempt} failed. Retrying in ${delay}ms: ${lastError.message}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError;
}
