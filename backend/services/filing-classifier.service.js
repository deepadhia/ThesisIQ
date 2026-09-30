/**
 * Filing Classifier Service
 * Categorizes BSE/NSE filings into 8 specialized categories and extracts
 * institutional-grade event mechanics (swap ratios, dilution %, order values, rating changes, fine amounts).
 */

import { NVIDIA_API_KEY } from "../config/env.js";

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * Deterministic keyword classification into one of 8 filing categories.
 */
export function classifyFilingCategory(title = "", text = "") {
  const titleLower = (title || "").toLowerCase();
  const combined = `${title} ${text}`.toLowerCase();

  // 0. PROCEDURAL_ROUTINE_COMPLIANCE (Trading Window, Loss of Share, Board Meeting Notices, Investor Meet Intimations)
  const PROCEDURAL_ROUTINE_TITLES = [
    "trading window",
    "closure of trading window",
    "closure of trading",
    "trading window closure",
    "loss of share certificate",
    "duplicate share certificate",
    "compliance certificate",
    "certificate under reg",
    "certificate under regulation",
    "board meeting intimation",
    "prior intimation of board meeting",
    "notice of board meeting",
    "schedule of analyst",
    "schedule of institutional",
    "newspaper publication",
    "newspaper advertisement",
    "voting results",
    "scrutinizer report"
  ];
  if (PROCEDURAL_ROUTINE_TITLES.some(p => titleLower.includes(p))) {
    return "ROUTINE_COMPLIANCE";
  }

  // 1. RESTRUCTURING (Demerger, Merger, Spin-off, Slump sale)
  if (
    combined.includes("scheme of arrangement") ||
    combined.includes("demerger") ||
    combined.includes("amalgamation") ||
    combined.includes("spin-off") ||
    combined.includes("spinoff") ||
    combined.includes("slump sale") ||
    combined.includes("merger")
  ) {
    return "RESTRUCTURING";
  }

  // 2. CAPITAL_RAISE (QIP, Preferential Issue, Rights Issue, Warrants, FPO)
  if (
    combined.includes("qip") ||
    combined.includes("qualified institutions placement") ||
    combined.includes("preferential allotment") ||
    combined.includes("preferential issue") ||
    combined.includes("rights issue") ||
    combined.includes("issuance of warrants") ||
    combined.includes("warrant allotment") ||
    combined.includes("fund raising") ||
    combined.includes("raising of funds")
  ) {
    return "CAPITAL_RAISE";
  }

  // 3. CAPITAL_RETURN (Bonus Issue, Stock Split, Buyback, Special Dividend)
  if (
    combined.includes("bonus issue") ||
    combined.includes("issue of bonus") ||
    combined.includes("bonus shares") ||
    combined.includes("stock split") ||
    combined.includes("sub-division") ||
    combined.includes("buyback") ||
    combined.includes("buy-back") ||
    combined.includes("special dividend")
  ) {
    return "CAPITAL_RETURN";
  }

  // 4. CAPEX_COMMISSIONING (Plant commissioning, Capacity Expansion, Brownfield/Greenfield additions)
  const isClarificationNotice = titleLower.includes("clarification on") || titleLower.includes("clarification regarding") || titleLower.includes("fire incident");
  if (
    !isClarificationNotice && (
      combined.includes("brownfield") ||
      combined.includes("greenfield") ||
      combined.includes("capacity expansion") ||
      combined.includes("expansion of capacity") ||
      combined.includes("capacity addition") ||
      combined.includes("commercial production") ||
      combined.includes("commissioning of plant") ||
      combined.includes("commissioning of") ||
      combined.includes("commissioned") ||
      combined.includes("new manufacturing facility") ||
      combined.includes("setting up of manufacturing") ||
      combined.includes("expansion of manufacturing") ||
      combined.includes("commenced commercial operation") ||
      combined.includes("commencement of commercial") ||
      combined.includes("commercial operation date") ||
      combined.includes("plant expansion") ||
      combined.includes("new production facility")
    )
  ) {
    return "CAPEX_COMMISSIONING";
  }

  // 4b. ORDER_WIN (Bagging of orders, LOA, Contract Win, Tender award)
  if (
    combined.includes("bagging of order") ||
    combined.includes("order win") ||
    combined.includes("letter of award") ||
    combined.includes("loa received") ||
    combined.includes("contract win") ||
    combined.includes("secures order") ||
    combined.includes("secured order") ||
    combined.includes("award of contract") ||
    combined.includes("awarded contract") ||
    combined.includes("receipt of order") ||
    combined.includes("received order") ||
    combined.includes("work order") ||
    combined.includes("purchase order") ||
    combined.includes("new order") ||
    combined.includes("lowest bidder") ||
    combined.includes("l1 bidder")
  ) {
    return "ORDER_WIN";
  }

  // 5. CREDIT_EVENT (Rating revision/upgrade/downgrade on debt instruments)
  const isDebtRatingAgency = /\b(crisil|care ratings?|icra|ind-ra|india ratings|brickwork|acuite)\b/i.test(combined);
  const isCreditAction = /\b(credit rating|debt rating|rating revision|rating upgrade|rating downgrade|bank facilities rating|commercial paper rating)\b/i.test(combined);
  const isEsgOnly = /\besg (rating|score|impact)\b/i.test(combined) && !isCreditAction;
  
  if ((isDebtRatingAgency || isCreditAction) && !isEsgOnly) {
    return "CREDIT_EVENT";
  }

  // 6. REGULATORY_ACTION (Penalties, Litigation, SEBI/MCA orders, Approvals, PESO, FDA)
  if (
    combined.includes("penalty") ||
    combined.includes("fine imposed") ||
    combined.includes("order passed by") ||
    combined.includes("sebi order") ||
    combined.includes("enforcement directorate") ||
    combined.includes("search and seizure") ||
    combined.includes("income tax raid") ||
    combined.includes("litigation update") ||
    combined.includes("show cause notice") ||
    combined.includes("adjudication order") ||
    combined.includes("restraint order") ||
    combined.includes("debarred") ||
    combined.includes("peso approval") ||
    combined.includes("regulatory approval") ||
    combined.includes("environmental clearance") ||
    combined.includes("patent granted")
  ) {
    return "REGULATORY_ACTION";
  }

  // 7. GOVERNANCE_RISK (Auditor/CXO resignation, Default, NCLT/IBC, Forensic Audit, Raids, Factory Closures, Rumor Clarifications)
  if (
    combined.includes("resignation of statutory auditor") ||
    combined.includes("resignation of auditor") ||
    combined.includes("auditor resignation") ||
    combined.includes("resignation of chief financial officer") ||
    combined.includes("resignation of cfo") ||
    combined.includes("resignation of managing director") ||
    combined.includes("resignation of director") ||
    combined.includes("cessation of") ||
    combined.includes("default in payment") ||
    combined.includes("default on payment") ||
    combined.includes("insolvency") ||
    combined.includes("nclt") ||
    combined.includes("cirp") ||
    combined.includes("corporate insolvency") ||
    combined.includes("forensic audit") ||
    combined.includes("fraud") ||
    combined.includes("plant closure") ||
    combined.includes("factory closure") ||
    combined.includes("strike") ||
    combined.includes("lockout") ||
    combined.includes("clarification on news") ||
    combined.includes("clarification regarding news") ||
    combined.includes("response to news") ||
    combined.includes("news verification")
  ) {
    return "GOVERNANCE_RISK";
  }

  // 8. ACQUISITION (Acquisition, Investment in Subsidiary, Stake Purchase, JV)
  if (
    combined.includes("acquisition of") ||
    combined.includes("investment in subsidiary") ||
    combined.includes("stake acquisition") ||
    combined.includes("joint venture agreement") ||
    combined.includes("incorporation of subsidiary") ||
    combined.includes("strategic partnership") ||
    combined.includes("mou signed")
  ) {
    return "ACQUISITION";
  }

  // 9. QUARTERLY_EARNINGS (Financial results, investor presentation)
  if (
    combined.includes("financial results") ||
    combined.includes("un-audited financial results") ||
    combined.includes("audited financial results") ||
    combined.includes("investor presentation") ||
    combined.includes("earnings presentation") ||
    (combined.includes("outcome of board meeting") && (combined.includes("results") || combined.includes("quarter")))
  ) {
    return "QUARTERLY_EARNINGS";
  }

  return "GENERAL";
}

/**
 * Detects the multi-stage lifecycle of a filing (Stage 1 Results, Stage 1 PPT, Stage 2 Transcript, Stage 2 Audio, Corporate Action, Routine).
 */
export function detectFilingLifecycleStage(title = "", text = "", url = "") {
  const tLower = (title || "").toLowerCase();
  const txtLower = (text || "").toLowerCase();
  const urlLower = (url || "").toLowerCase();
  const combined = `${tLower} ${urlLower} ${txtLower.slice(0, 3000)}`;

  // 0. Explicit Routine Secretarial & Procedural Compliance Filter
  const isRoutineSecretarial =
    tLower.includes("voting result") ||
    tLower.includes("scrutinizer") ||
    tLower.includes("newspaper publication") ||
    tLower.includes("newspaper advertisement") ||
    tLower.includes("trading window") ||
    tLower.includes("loss of share") ||
    tLower.includes("duplicate share") ||
    tLower.includes("compliance certificate") ||
    tLower.includes("certificate under reg") ||
    tLower.includes("record date") ||
    tLower.includes("appointment of") ||
    tLower.includes("cessation of") ||
    urlLower.includes("votingresult") ||
    urlLower.includes("scrutinizer") ||
    urlLower.includes("newspaper");

  if (isRoutineSecretarial && !tLower.includes("financial result") && !combined.includes("un-audited financial")) {
    return "ROUTINE_COMPLIANCE";
  }

  // 1. Concall Transcript (Stage 2)
  if (
    urlLower.includes("transcript") ||
    tLower.includes("transcript") ||
    combined.includes("transcript of the earnings") ||
    combined.includes("transcript of conference call") ||
    combined.includes("transcript of earnings call") ||
    combined.includes("earnings call transcript") ||
    combined.includes("concall transcript")
  ) {
    return "STAGE_2_TRANSCRIPT";
  }

  // 2. Concall Audio Recording (Stage 2)
  if (
    urlLower.includes("audio") ||
    urlLower.includes("recording") ||
    tLower.includes("audio recording") ||
    tLower.includes("recording of earnings") ||
    combined.includes("audio recording of the") ||
    combined.includes("link for audio recording") ||
    combined.includes("recording of the earnings call") ||
    combined.includes("recording of the concall")
  ) {
    return "STAGE_2_AUDIO";
  }

  // 3. Investor Presentation (Stage 1 PPT)
  if (
    urlLower.includes("presentation") ||
    urlLower.includes("investorppt") ||
    urlLower.includes("earningpresentation") ||
    tLower.includes("investor presentation") ||
    tLower.includes("earnings presentation") ||
    tLower.includes("investor deck") ||
    tLower.includes("presentation on the unaudited") ||
    tLower.includes("presentation on the financial")
  ) {
    return "STAGE_1_PPT";
  }

  // 4. Financial Results Release (Stage 1 Results)
  const isFinancialResultDoc =
    tLower.includes("financial result") ||
    tLower.includes("un-audited financial") ||
    tLower.includes("unaudited financial") ||
    tLower.includes("audited financial") ||
    tLower.includes("financial results for the quarter") ||
    (tLower.includes("outcome of board meeting") && (combined.includes("financial result") || combined.includes("un-audited") || combined.includes("unaudited") || combined.includes("standalone and consolidated results"))) ||
    (urlLower.includes("financial_result") || urlLower.includes("resultrelease") || urlLower.includes("financialresults"));

  if (isFinancialResultDoc && !isRoutineSecretarial) {
    return "STAGE_1_RESULTS";
  }

  // 5. Major Corporate Actions
  const cat = classifyFilingCategory(title, text);
  if (["ORDER_WIN", "CAPEX_COMMISSIONING", "CAPITAL_RAISE", "CAPITAL_RETURN", "RESTRUCTURING", "ACQUISITION", "REGULATORY_ACTION", "CREDIT_EVENT"].includes(cat)) {
    return "MAJOR_CORPORATE_ACTION";
  }

  // 6. Routine Compliance Notice
  return "ROUTINE_COMPLIANCE";
}

/**
 * Category-specific NIM prompt generator for institutional detail extraction.
 */
function getCategoryPrompt(category, ticker, announcementText, investmentThesis = "") {
  const thesisCtx = investmentThesis ? `Investment Thesis: ${investmentThesis}\n` : "";

  const categoryInstructions = {
    RESTRUCTURING: `
Extract restructurings details (Demergers, Mergers, Spin-Offs):
- scheme_type: Nature of transaction (e.g. Amalgamation / Merger by Absorption, Demerger, Slump Sale)
- transferor_entity: Entity/subsidiary being merged (with existing ownership % if stated in text)
- transferee_entity: Resulting parent / operating entity
- swap_ratio: Exact share exchange ratio explicitly stated in this document (e.g. X shares of transferee for Y shares of transferor)
- dilution_percentage: Equity dilution percentage or new shares to be issued to public shareholders, if stated
- financials_absorbed: Turnover and EBITDA or PAT of the merged entity absorbed by the parent (stated with unit; note if figures are in Lakhs or Crores)
- nclt_sebi_stage: Current approval stage and appointed date
- approval_horizon_months: Indicative or statutory approval timeline (e.g. NCLT, SEBI/Exchanges & shareholder approvals)
- strategic_rationale: Stated operational synergies, cost efficiencies, or structural simplification
- key_omissions_or_risks: Critical missing terms or regulatory approval risks
`,
    CAPEX_COMMISSIONING: `
Extract Plant Commissioning & Capacity Expansion details:
- capacity_added_or_expanded: Capacity addition metric with explicit unit from this document
- facility_location: Manufacturing plant or facility location stated in this document
- phase_details: Phase number and current operational status stated in this document
- backward_integration_impact: Operational impact on margins or supply chain independence
- revenue_and_order_visibility: Stated support for order backlog execution
- key_omissions_or_risks: Any disclosed capex overruns, gestation period, or trial run conditions
`,
    CAPITAL_RAISE: `
Extract Capital Raise details (QIP, Preferential Issue, Rights Issue, Subsidiary Infusion):
- raise_type: Method of issuance (e.g. Rights Issue, QIP, Preferential Allotment, Subsidiary Infusion)
- target_entity: Entity receiving capital and relationship (e.g. wholly-owned or material subsidiary, or parent company)
- total_amount_cr: Total capital amount in ₹ Crores explicitly stated in this document
- cumulative_infused_cr: Cumulative capital infused to date vs approved limit, if stated
- parent_cash_outflow_cr: Explicit cash outgo from parent balance sheet, if stated
- shareholding_pct: Post-issue shareholding percentage stated in this document
- issue_price: Issue price per share and face value stated in this document
- use_of_proceeds: Stated operational purpose or deployment of funds
- key_omissions_or_risks: Crucial terms withheld by management (e.g. undisclosed valuation, unstated subscription share, or missing pricing)
`,
    ORDER_WIN: `
Extract Order Bagging & Contract Win details:
- order_value_cr: Total order or contract value in ₹ Crores explicitly stated in this document
- order_breakdown: List ONLY positive substantive project components (scope, geography, product lines). NEVER include negative statements like "not disclosed" or "none disclosed".
- scope_and_voltage: Technical engineering scope explicitly stated in this document
- client_name: Client, counterparty, or developer name if disclosed, or "Anonymous Developer" if withheld
- execution_period_months: Execution timeline in months if explicitly stated, else null
- revenue_visibility_impact: Order scale relative to annual run-rate or order backlog if stated or calculable
- margin_and_thesis_impact: Product mix characteristics (e.g. higher-margin manufactured items vs generic EPC)
- key_omissions_or_risks: Red flags or withheld details (e.g. counterparty anonymity, unstated delivery timeline)
`,
    CAPITAL_RETURN: `
Extract Capital Return details (Bonus, Split, Buyback, Dividend):
- bonus_ratio: e.g., "1:1" or "Not Applicable"
- split_ratio: e.g., "1 to 5" or "Not Applicable"
- buyback_price: Buyback price in ₹ and size in ₹Cr
- record_date: Record date if announced
- promoter_holding_impact: Impact on promoter ownership %
`,
    CREDIT_EVENT: `
Extract Credit Rating changes:
- rating_agency: e.g., CRISIL, CARE, ICRA
- new_rating: Rating designation (e.g., AA+, A1+)
- rating_action: Upgrade, Downgrade, Reaffirmation, Outlook Change
- borrowing_cost_impact: Impact on interest cost and balance sheet strength
`,
    REGULATORY_ACTION: `
Extract Regulatory Actions, Clearances & Penalties:
- regulatory_body: e.g., SEBI, Income Tax, GST Department, NCLT, PESO, USFDA, RDSO
- approval_or_action: Nature of clearance, certification, penalty, or restriction
- fine_amount_cr: Fine/penalty amount in ₹ Cr or ₹ Lakhs (if applicable)
- material_risk_or_catalyst: Impact on operational execution and market access
`,
    GOVERNANCE_RISK: `
Extract Governance, Auditor, Executive, Default & Legal Risk details:
- event_type: Auditor Resignation, CXO/KMP Resignation, Loan Default, Insolvency/NCLT, Search/Seizure/Raid, Forensic Audit, Plant Closure, Rumor Clarification
- key_parties_involved: Names of resigning auditor/executives/lenders/authorities
- stated_reasons: Exact explanation given in the filing
- financial_exposure_cr: Default amount, claim amount, or financial loss in ₹ Cr
- governance_risk_verdict: High Risk Red Flag vs Transitory Administrative Event
`,
    ACQUISITION: `
Extract Acquisition & Investment details:
- target_name: Target company or entity acquired
- deal_value_cr: Deal size/investment in ₹ Crores
- stake_acquired_pct: Stake % acquired
- strategic_rationale: Key reason for acquisition
`,
    QUARTERLY_EARNINGS: `
Extract Quarterly Earnings key highlights:
- revenue_cr: Revenue in ₹ Crores and YoY/QoQ %
- pat_cr: Net Profit in ₹ Crores and YoY/QoQ %
- ebitda_margin_pct: Operating margin %
- segmental_highlights: Key division performance
`,
    GENERAL: `
Extract General Corporate Action details:
- key_event: Primary event described
- operational_impact: Impact on company operations
- financial_impact: Impact on finances/cash flow
`
  };

  const instruction = categoryInstructions[category] || categoryInstructions.GENERAL;

  return `
You are a top-tier Indian Equity Analyst. Extract structured data for this corporate filing of ticker ${ticker}.
Category: ${category}
${thesisCtx}

Instruction:
${instruction}

Filing Content:
${announcementText}

Rule: Output ONLY a valid JSON object matching this structure:
{
  "category": "${category}",
  "verdict": "POSITIVE" | "NEGATIVE" | "NEUTRAL",
  "summary": "1-2 sentence executive summary focused on financial/operational mechanics.",
  "extracted_data": {
    /* Put the exact fields requested above in category instruction here */
  }
}
If any metric is not disclosed in the text, use null. NEVER output filler strings like "Not Disclosed" or "None". Never hallucinate missing numbers.
`;
}

/**
 * Executes specialized NIM extraction for corporate actions.
 */
export async function extractCorporateActionDetails(category, ticker, announcementText, investmentThesis = "") {
  if (category === "GENERAL" || !NVIDIA_API_KEY) {
    return null;
  }

  // Cap text to 32,000 chars for comprehensive full-document NIM processing
  let cappedText = announcementText || "";
  if (cappedText.length > 32000) {
    const half = 15000;
    cappedText = `${cappedText.substring(0, half)}\n\n[... TRUNCATED MIDDLE CONTENT FOR FAST NIM LATENCY ...]\n\n${cappedText.substring(cappedText.length - half)}`;
  }

  const prompt = getCategoryPrompt(category, ticker, cappedText, investmentThesis);
  const ACTIVE_MODELS = [
    "meta/llama-3.2-11b-vision-instruct",
    "openai/gpt-oss-20b",
    "nvidia/nemotron-3-super-120b-a12b"
  ];
  const MAX_RETRIES = 4;
  const BASE_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const currentModel = ACTIVE_MODELS[(attempt - 1) % ACTIVE_MODELS.length];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout

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
              content: "You are a quantitative corporate action parser for Indian financial filings. Extract precise numeric mechanics and facts with zero fluff.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.05,
          max_tokens: 1500,
          response_format: { type: "json_object" },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[NIM ACTION] Model ${currentModel} failed status ${response.status} (attempt ${attempt}/${MAX_RETRIES})`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, BASE_DELAY_MS * attempt));
          continue;
        }
        return null;
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      let cleanJson = content.replace(/```json\n?/, "").replace(/\n?```/, "").trim();
      const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanJson = jsonMatch[0];
      }
      return JSON.parse(cleanJson);
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn(`[NIM ACTION] Attempt ${attempt}/${MAX_RETRIES} failed for ${ticker}:`, err.message);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, BASE_DELAY_MS * attempt));
        continue;
      }
      return null;
    }
  }

  return null;
}
