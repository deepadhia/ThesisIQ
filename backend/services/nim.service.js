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

  // Cap text to 8,000 chars (head + tail) to keep LLM response fast (3-5s) and avoid 90s gateway timeouts
  let cappedText = announcementText || "";
  if (cappedText.length > 8000) {
    const half = 4000;
    cappedText = `${cappedText.substring(0, half)}\n\n[... TRUNCATED MIDDLE CONTENT FOR FAST NIM LATENCY ...]\n\n${cappedText.substring(cappedText.length - half)}`;
  }

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

    ── Financial Data Precision & Extraction Rules ──
    1. MANDATORY YOY PRECEDENCE: YoY comparison (e.g. Q1 FY27 vs Q1 FY26) is MANDATORY and MUST take precedence over QoQ sequential comparisons. If PAT contracts YoY (> -10%) or EBITDA margin contracts YoY (> -200 bps), lead with this YoY contraction as the headline financial result. NEVER bury a YoY profit or margin decline behind a QoQ sequential recovery framing.
    2. PAT PRECISION: Always extract 'Net Profit for the period (PAT) attributable to Owners of the Company'. NEVER use intermediate pre-tax, pre-associate, or standalone line items when consolidated tables are present.
    3. MANDATORY EBITDA & MARGINS: For all Financial Results filings, ALWAYS extract or calculate EBITDA (Profit Before Tax + Finance Costs + Depreciation) and EBITDA Margin % (EBITDA / Revenue from Operations * 100). Always state EBITDA YoY % growth and EBITDA Margin bps change.
    4. SEGMENT RED FLAG DETECTION: Extract all segment-wise results (Revenue & EBIT) and explicitly highlight any segment experiencing a YoY revenue/EBIT decline > 20% as a Segment Red Flag (e.g. Segment A EBIT declining > 20% YoY). NEVER claim 'no red flags' when a major segment collapses YoY.
    5. MULTI-SEGMENT THESIS RESPECT: NEVER claim a company has single-segment operations or no diversification when the investment thesis or filing explicitly details multiple verticals (e.g., Real Estate + Data Center + Cloud Services under Ashok Cloud).
    6. ANTI-HALLUCINATION: NEVER report future quarter numbers (e.g. Q2 FY27) as actual achieved performance. Label any forward figure as 'Management Target/Guidance', never actuals.
    7. DYNAMIC UNIT NORMALIZATION ENGINE (Lakhs / Millions / Crores to Crores): Always check the table header for unit indicators such as '(₹ in Lakhs)', '(₹ in Millions)', '(₹ in Mn)', or '(₹ in Crores)'. Convert ALL absolute monetary values (Revenue, EBITDA, PAT) into standardized INR CRORES (₹ Cr):
       • If table is in '₹ in Lakhs': Divide all numbers by 100 to get ₹ Cr (e.g. 26,100 Lakhs = ₹261.0 Cr).
       • If table is in '₹ in Millions' / '₹ in Mn': Divide all numbers by 10 to get ₹ Cr (e.g. 16,938 Mn = ₹1,693.8 Cr, 2,564 Mn = ₹256.4 Cr).
       • If table is in '₹ in Crores': Keep as-is.
       • ALWAYS label monetary values with '₹ Cr' (e.g. 'Revenue: ₹1,693.8 Cr'). NEVER output raw unscaled Millions or Lakhs as Crores.

    ── Strict Content Rules (Zero Boilerplate & Anti-Spam) ──
    1. ABSOLUTELY FORBID generic fluff, administrative meeting narration, or empty advice such as "Investors should review the results to assess progress", "Company held its 26th AGM and passed 4 resolutions", "Resolutions were approved with requisite majority". This is useless administrative noise and strictly forbidden.
    2. DETECT SCANNED/EMPTY FILINGS: If the Announcement Text below contains NO actual numbers, details, or outcomes (e.g., it is just a brief intimation of a future meeting or the text is empty/unreadable), your summary MUST explicitly state: "No detailed figures or outcomes are available in this filing (scanned PDF or routine intimation only)." In this case, DO NOT make up generic thesis alignment fluff.
    3. FACTUAL EXECUTIVE SUMMARY: Your summary must be 2-3 concise, highly analytical sentences focused ONLY on what matters to an equity investor:
       • Sentence 1: The core operational, corporate, or financial event (with exact numbers: Revenue ₹Cr, EBITDA ₹Cr & %, PAT ₹Cr & %, Deal Value ₹Cr, Stake %, Capacity MW/Units).
       • Sentence 2: The direct business rationale and how it impacts operational execution, order backlog, or capacity.
       • Sentence 3: Concrete thesis takeaway without robotic cliché phrases.
    4. FORBID GENERIC AGM / VOTING SUMMARIES: If an AGM filing is merely a statutory notice of meeting date, attendance quorum slip, standard director rotation/reappointment, or routine scrutinizer voting tally with no forward guidance, capex numbers, or management speech:
       • Set priority: "LOW", impact: "NEUTRAL", key_data: "No specific figures disclosed.", agm_highlights: null, has_substantive_business_insights: false.
       • DO NOT manufacture artificial importance for routine administrative votes.
    5. ELEVATE SUBSTANTIVE AGM / MD&A / STRATEGIC DISCLOSURES: If an AGM filing, Chairman/MD address, or Annual Report contains forward guidance (e.g., revenue/margin targets, export pipeline, order backlog ₹Cr), multi-year capex plans (₹Cr outlay, commissioning timelines), capacity additions (units/MW), or high-impact Special Resolutions (QIP > ₹100 Cr, equity dilution, borrowing limit increases > 20% net worth, M&A):
       • Set priority: "HIGH" (if major guidance/capex/QIP) or "MEDIUM".
       • Extract all exact figures into "key_data".
       • Extract bulleted strategic points into "agm_highlights".
       • Set "has_substantive_business_insights": true.

    ── Priority Rules ──
    HIGH: Earnings Results / Financial Results, Large orders (>10% of annual revenue), M&A / demergers / restructuring, material CXO/auditor exits, capex >20% net worth, credit downgrades, regulatory actions, Product Approvals, Patents, Licenses, Large contract wins, Awards, MOU signings with strategic partners, Completed AGMs / Annual Reports with substantive Chairman/MD addresses, forward guidance, capacity additions, or major multi-year targets, Material Special Resolutions (QIPs/Preferential issues > ₹100 Cr).
    MEDIUM: Dividends, credit rating upgrades/downgrades on debt instruments, material allotments, medium-sized orders, general business expansion updates, scheduled earnings conference calls / concalls, Completed AGMs with verified operational reviews or management commentary.
    LOW: Routine compliance filings, share certificate loss, routine voting results without management speeches, future AGM date notices without special business, window closure notices, newspaper publications.
    LOW (ALWAYS, NO EXCEPTIONS): ESG rating updates/certificates, BRSR / sustainability reports, ISO certifications, credit rating affirmations (without upgrade/downgrade), routine non-director staff changes, loss of share certificates, duplicate share certificates, postal ballot notices for routine director re-appointments, future AGM/EGM scheduling notices (without completed proceedings or special resolutions), director re-appointment notices, commission to non-executive directors, routine shareholders meeting attendance notices (pure quorum formalities without management speech/guidance), newspaper publication intimations, routine voting results/scrutinizer reports (without speeches), compliance certificates, board meeting notices that do NOT announce actual financial results. Private one-on-one meetings without public disclosures.

    ── Output Rules ──
    - "summary": A concise 2-3 sentence factual summary that clearly outlines the business event, exact numbers, and direct operational impact.
    - "key_data": Extract ALL specific numbers — order value (₹Cr), acquisition cost, capex outlay, revenue %, deal tenure, capacity. If none, write "No specific figures disclosed."
    - "deep_dive_indicator": 1-2 sharp lines detailing the exact thesis risk or catalyst.
    - "result_date": YYYY-MM-DD if a board meeting for results is announced. Otherwise null.
    - "is_earnings_release": true ONLY when the filing contains actual quarterly or annual financial numbers (revenue, PAT, EBITDA figures). Postal ballot notices, director re-appointments, AGM/EGM notices, commission approvals, and newspaper publications are ALWAYS is_earnings_release: false, NO EXCEPTIONS — even if the word "results" appears in the text.
    - "concall_date": YYYY-MM-DD if a scheduled or rescheduled earnings conference call is mentioned. Otherwise null.
    - "concall_time": HH:MM IST/format or null if a scheduled or rescheduled earnings conference call time is mentioned (e.g. "16:00 IST"). Otherwise null.
    - "is_rescheduled": true if the earnings conference call is explicitly rescheduled, postponed, or revised from a previous date. Otherwise false.
    - "is_agm": true if the filing is an AGM/EGM notice, proceedings, outcome, annual report, shareholders meeting intimation, or postal ballot notice. Otherwise false.
    - "agm_status": "scheduled" if it is a notice/schedule for a future meeting, or "completed" if it is the proceedings/outcome of a meeting that has already occurred. Otherwise null.
    - "agm_highlights": A bulleted 2-4 point summary of key resolutions, Chairman/MD speech points, capex, or forward guidance if agm_status is "completed". If the filing is a purely procedural quorum notice with no speech or numbers disclosed (e.g. routine attendance slip), set to null.
    - "has_substantive_business_insights": true if the filing contains actionable business data (guidance, capex, order book, special resolutions, financial numbers). false if purely procedural/administrative.

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
      "is_rescheduled": true | false,
      "is_agm": true | false,
      "agm_status": "scheduled" | "completed" | null,
      "agm_highlights": "Bulleted highlights of the AGM if completed, or null",
      "has_substantive_business_insights": true | false,
      "thesis_catalyst_metrics": "Key quantitative metrics aligned with Primary Investment Thesis (e.g. Data Center MW, Order Backlog ₹Cr, Export Mix %)",
      "stock_price_drivers": "Key share-price moving catalysts (Free Cash Flow FCF ₹Cr, Debtor/Working Capital Days, Net Debt/Cash ₹Cr, Capacity Commissioning Dates)"
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
