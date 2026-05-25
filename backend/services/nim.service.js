/**
 * NVIDIA NIM Service (Geforce Now API)
 * Uses OpenSource models (Llama 3.1) for intelligence classification.
 */

import { NVIDIA_API_KEY } from "../config/env.js";

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

  const prompt = `
    You are a sharp, highly rigorous Indian equity analyst. Analyze this BSE/NSE corporate announcement and return an institutional-grade, thesis-aware classification.
    
    Ticker: ${ticker}
    Announcement Title: ${title}

    ${thesisSection}

    ── Task ──
    Evaluate if this announcement reinforces or breaks the Investment Thesis provided.
    If no thesis is provided, use general high-quality micro-cap/mid-cap growth investing principles.

    - If the news significantly advances, accelerates, or protects the investment thesis, it is POSITIVE.
    - If it introduces a structural risk, delay, or invalidates a core thesis assumption, it is NEGATIVE.
    - If it is routine compliance or minor news with no thesis impact, it is NEUTRAL.
    - Be decisive. Only use NEUTRAL if there is truly no impact on the thesis.
    - IMPORTANT: If the announcement is an Earnings Release/Financial Result, you MUST evaluate its numbers and margins against the investment thesis.

    ── Strict Content Rules (Zero Boilerplate) ──
    1. ABSOLUTELY FORBID generic fluff or empty advice such as "Investors should review the results to assess progress", "The company's performance is key", "Check the details to decide". This is useless and forbidden.
    2. DETECT SCANNED/EMPTY FILINGS: If the Announcement Text below contains NO actual numbers, details, or outcomes (e.g., it is just a brief intimation of a future meeting or the text is empty/unreadable), your summary MUST explicitly state: "No detailed figures or outcomes are available in this filing (scanned PDF or routine intimation only)." In this case, DO NOT make up generic thesis alignment fluff.
    3. FACTUAL SUMMARY & VERDICT: Your summary must be 2-3 highly analytical sentences. Sentence 1: Factual operational/financial event (with exact figures: ₹Cr, %, margins if available). Sentence 2: Explicit verdict on whether the results/news are overall good (strong growth/expansion), flat/neutral, or bad (contraction/weakness) relative to expectations/thesis, and the main driver. Sentence 3: Specific business impact and concrete actionable implication for the investor.

    ── Priority Rules ──
    HIGH: Earnings Results / Financial Results, Large orders (>10% of annual revenue), M&A / demergers / restructuring, management/auditor exits, capex >20% net worth, credit downgrades, regulatory actions, Product Approvals, Patents, Licenses, Large contract wins.
    MEDIUM: Dividends, board meeting notices, credit rating reaffirmations, allotments, medium-sized orders, general business updates.
    LOW: Routine compliance filings, share certificate loss, voting results, AGM notices, window closure notices, newspaper publications.

    ── Output Rules ──
    - "summary": A 2-3 sentence factual summary that starts with an explicit qualitative verdict (overall strong/good, flat, or weak/bad) and provides a high-level overview of the key numbers and business drivers.
    - "key_data": Extract ALL specific numbers — order value (₹Cr), acquisition cost, capex outlay, revenue %, deal tenure, capacity. If none, write "No specific figures disclosed."
    - "deep_dive_indicator": Name the precise investment thesis risk or opportunity with context.
    - "result_date": YYYY-MM-DD if a board meeting for results is announced. Otherwise null.
    - "is_earnings_release": true only if this is the actual Q-results announcement (not just a board meeting notice).
    - "concall_date": YYYY-MM-DD if a scheduled or rescheduled earnings conference call is mentioned. Otherwise null.
    - "concall_time": HH:MM IST/format or null if a scheduled or rescheduled earnings conference call time is mentioned (e.g. "16:00 IST"). Otherwise null.
    - "is_rescheduled": true if the earnings conference call is explicitly rescheduled, postponed, or revised from a previous date. Otherwise false.

    Return ONLY a valid JSON object:
    {
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "impact": "POSITIVE" | "NEGATIVE" | "NEUTRAL",
      "confidence": "HIGH" | "LOW",
      "summary": "Specific, factual, 2-3 sentence investor-grade summary.",
      "key_data": "All specific figures and numbers extracted.",
      "deep_dive_indicator": "Precise thesis risk/opportunity with context.",
      "result_date": "YYYY-MM-DD or null",
      "is_earnings_release": true | false,
      "concall_date": "YYYY-MM-DD or null",
      "concall_time": "HH:MM or format or null",
      "is_rescheduled": true | false
    }

    Announcement Text:
    ${announcementText}
  `;

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
        model: "meta/llama-3.1-70b-instruct",
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
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[AI ERROR] NVIDIA NIM API failed:", errorData);
      throw new Error(`NVIDIA NIM API error: ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    try {
      const cleanJson = content.replace(/```json\n?/, "").replace(/\n?```/, "").trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.error("Failed to parse NIM response as JSON:", content);
      throw new Error("AI output was not valid JSON.");
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("NVIDIA NIM API request timed out (90s)");
    }
    throw err;
  }
}
