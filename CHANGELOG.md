# Changelog

## [v3.3.1] - 2026-09-20 (Market–Thesis Reconciliation & Duration Integrity Patch)

### Fixed & Enhanced
- **Strict 3-Quantity Epistemic Separation**:
  - `MARKET_REQUIRED_ECONOMICS`: What current market price mathematically demands ($g_{\text{market}}$, $T_{\text{req}}$, $\text{Margin}_{\text{req}}$, $\text{iROIC}_{\text{req}}$, $\text{Capital}_{\text{req}}$).
  - `EVIDENCE_SUPPORTED_ECONOMICS`: What audited delivery, physical plant scale, and order book burn actively confirm today ($g_{\text{evidence}}$, $T_{\text{visible}}$, observed iROIC, DSO, CFO/PAT).
  - `THEORETICAL_BULL_ECONOMICS`: Unconstrained hypothetical bull math; strictly decoupled with `isEvidenceSupported: false` flag so speculative simulations never masquerade as evidence.
- **Sequential Scenario Bridge (`SEQUENTIAL_SCENARIO_BRIDGE`)**:
  - Relabeled the waterfall to explicitly denote a sequential milestone progression rather than additive Shapley attribution, preventing false precision from interacting non-linear parameters (growth, duration, terminal ROIC).
  - Eliminated waterfall overshoot bug (e.g. SJS overshooting CMP to zero out residual); enforces exact identity: $P_0 + \sum \Delta P_i + \text{UNEXPLAINED\_MARKET\_PREMIUM} \equiv P_{\text{market}}$.
- **Market-vs-Evidence Gap Quantification (`marketEvidenceGap`)**:
  - Computes explicit spread: $g_{\text{market}}$ vs $g_{\text{underwritten}}$ vs $g_{\text{evidence\_max}}$ (e.g. QPower: $+25.9\text{ pp}$ vs underwriting, $-20.1\text{ pp}$ vs evidence ceiling; SJS: $+13.6\text{ pp}$ over evidence ceiling; HBL: $+9.5\text{ pp}$ over evidence ceiling).
- **9-State Epistemic Reality Taxonomy (`RECONCILIATION_REALITY_STATE`)**:
  - Added `DISLOCATION_UNDERWRITING_REVALIDATION` to distinguish valuation discounts caused by uncorroborated / under-supported underwriting (e.g. HBL) from genuine temporary operational friction (`DISLOCATION_TEMPORARY_FRICTION` e.g. Transrail's 115d DSO).
- **Terminology Refinement**:
  - Replaced misleading "explained by expansion math" statements with precise framing: `93.2% of the market premium can be reconstructed through explicit future-economic assumptions, but commercial utilization and billing proof remain pending.`
- **100% Invariant Test Verification**:
  - `test-market-thesis-reconciliation.js` (210/210 PASS).
  - `test-fundamental-trajectory-engine.js` (279/279 PASS). Total: 489/489 tests passing (100% success).

### Added
- **Market–Thesis Reconciliation Layer (`market-thesis-reconciliation.service.js`)**:
  - Standalone modular analytical layer explaining what economic assumptions the market is implicitly capitalizing when $\text{Market EV} \neq \text{Model Underwritten EV}$.
  - Operates bilaterally across the universe:
    - *Market Premium Side*: Investigates "What is the market already pricing?" (Growth, Duration, Operating Leverage, Terminal Transformation, Optionality).
    - *Market Discount Side*: Investigates "Why is the market discounting it?" (Working capital friction, capex cycles, earnings troughs, or structural impairment).
- **The 7 Core Economic Gaps (Deconstructed for Every Equity)**:
  1. *Growth Gap*: $\Delta g = g_{\text{req}} - g_{\text{underwritten}}$ (% pts).
  2. *Duration Gap*: $\Delta T = T_{\text{req}} - T_{\text{underwritten}}$ (Years of superior compounding required at realistic growth rates).
  3. *Margin Gap*: $\Delta \text{Margin} = \text{EBITDA Margin}_{\text{req}} - \text{EBITDA Margin}_{\text{underwritten}}$ (bps / % pts).
  4. *iROIC Gap*: $\Delta \text{iROIC} = \text{iROIC}_{\text{req}} - \text{iROIC}_{\text{forward}}$ (% pts).
  5. *Reinvestment Gap*: $\Delta \text{Capital} = \text{NOA}_{\text{req}} - \text{NOA}_{\text{capacity}}$ (₹ Cr & capital absorption feasibility).
  6. *Optionality Gap*: Unmodeled economic value from new product lines (HVDC/FACTS), megaproject tenders, and M&A vectors (Sukrut, Exxpand).
  7. *Terminal Economics Gap*: $\Delta \text{Terminal ROIC} = \text{Terminal ROIC}_{\text{req}} - \text{Terminal ROIC}_{\text{base}}$ (% pts) & Terminal Margin shift.
- **8-State Epistemic Reality Taxonomy (`RECONCILIATION_REALITY_STATE`)**:
  - `UNDERVALUED_THESIS_SUPPORTED`, `UNDERVALUED_FUTURE_OPTIONALITY`, `FAIR_THESIS_ALIGNED`, `EXPENSIVE_EXPLAINABLE`, `EXPENSIVE_UNPROVEN`, `EXPENSIVE_UNEXPLAINED`, `DISLOCATION_TEMPORARY_FRICTION`, `BROKEN`.
- **Multi-Horizon DCF Engine (`calculateMultiHorizonFcffDcf`)**:
  - Parameterized compounding duration ($T \in [3, 20]$ years), non-linear operating leverage margin ramp, dynamic incremental ROIC, and terminal ROIC transformation.
- **Reverse Duration Solver (`solveRequiredCompoundingDuration`)**:
  - Numerically solves for the required compounding duration $T_{\text{req}}$ at candidate growth rates (20%, 25%, 28%, 30%, 32%, 35%, 40%) and builds the sensitivity grid.
- **Valuation Gap Waterfall Bridge (`buildValuationGapWaterfallBridge`)**:
  - Bridges Base Fair Value to Market Price: $P_0 + \Delta\text{Growth} + \Delta\text{OpLev} + \Delta\text{Duration} + \Delta\text{Terminal} + \Delta\text{Optionality} + \text{Speculative} \equiv P_{\text{market}}$.
  - Deep-dive for QPower proves **93.2% of the ₹987.83 price gap is explained by tangible evidence** (Sangli 8x capacity, 10Y duration, 33.9% iROIC, and HVDC mix), deriving `EXPENSIVE_EXPLAINABLE`.
- **New Invariant Test Suite & Dossier**:
  - `backend/scripts/test-market-thesis-reconciliation.js` (**107 / 107 invariant tests passed**).
  - `backend/scripts/run-market-thesis-reconciliation.js` generating `reports/thesis_board/MARKET_THESIS_RECONCILIATION_DOSSIER_V3_3.md`.

## [v3.2.0] - 2026-09-20 (Fundamental Trajectory & Management Evidence Engine)

### Added
- **The Three Truths Architecture**:
  - *Observed Reality*: Audited historical & TTM performance (YoY growth, EBITDA margin, verified order backlog, CFO/PAT, DSO, iROIC). Strictly cannot alter DCF.
  - *Forward Scenario*: Theoretical operational capacity potential across specialized sub-engines (`modeledNopatCagr`).
  - *Evidence Confidence & Evidence-Adjusted Potential*: Explicit discount factor $\alpha \in [0.50, 1.00]$ computing `evidenceAdjustedPotentialCagr` ($= \text{modeledNopatCagr} \times \alpha$). Represents evidence-backed operational potential, NOT an economic forecast.
  - *Underwriting*: Immutable v3.1.1 baseline assumptions. Can ONLY be modified via explicit human analyst approval.
- **Underwriting Status Taxonomy (`UNDERWRITING_STATUS`)**:
  - First-class states: `VALID`, `SUPPORTED_BY_EVIDENCE`, `UNDER_REVIEW`, `STALE`, `TOO_AGGRESSIVE`, `TOO_CONSERVATIVE`, `BROKEN`.
  - Disentangles business quality from underwriting validity (e.g. HBL's business is strengthening, while its 28% underwritten CAGR is `TOO_AGGRESSIVE` relative to pure backlog execution pacing).
- **Structured Position & Capital Directives (Non-Prescriptive)**:
  - `existingPositionStatus`: `HOLD_CORE_AND_MONITOR`, `HOLD_CORE_AWAITING_CASH_CONVERSION`, `HOLD_CORE_COMPOUNDING`, `TRIM_VALUATION_EXTREME`, `REDUCE_ON_DETERIORATION`, `EXIT_THESIS_BROKEN`.
  - `newCapitalStatus`: `WAIT_FOR_VALUATION_HURDLE`, `WAIT_FOR_CASH_CONVERSION`, `REVIEW_UNDERWRITING_BEFORE_ADDING`, `SELECTIVE_TRANCHE_DEPLOYMENT`, `DEPLOYMENT_SUPPORTED_BY_VALUATION`, `BLOCKED_EXTREME_VALUATION`, `BLOCKED_THESIS_BROKEN`.
  - Replaces prescriptive portfolio weight commands with decoupled institutional directives.
- **Invariant 6 - No Scenario-to-Action Leakage**:
  - Enforces that theoretical forward model scenarios alone NEVER produce `REVISION_SUPPORTED_ACCELERATION`, `REVISION_SUPPORTED_DECELERATION`, or capital deployments.
  - Revision signals strictly require multi-period audited evidence ($\ge 2$ quarters) and economic confirmation.
- **Independent Valuation Hurdle Price Math**:
  - Renamed from pullback target to `VALUATION_HURDLE_PRICE` / `MODEL_ACCUMULATION_THRESHOLD`.
  - Formula: $P_{\text{hurdle}} = FV \times (1 - \text{MoS}_{\text{required}})$; mathematically verified in both directions.
- **Management Promise Ledger & Dynamic Credibility Reconciliation**:
  - Permanent underlying data structure tracking historical concall/SEBI claims across `Company`, `Quarter`, `Management Claim`, `Claim Type`, `Source`, `Date`, `Evidence Tier`, `Target Metric`, `Deadline`, `Actual Reported Delivery`, `Variance`, `Delivery Status`, and `Credibility Impact`.
  - Dynamic reconciliation engine `evaluateManagementPromiseLedger` answering: *"What did management say 4 quarters ago, and how much of it actually happened?"*
  - Objective credibility derivation (`AHEAD`, `ON_TRACK`, `MIXED`, `BEHIND`, `BROKEN`) replacing subjective management-quality scores with an auditable evidence trail.
- **Fundamental Catch-Up vs Price Catch-Up Dynamics (`CATCH_UP_DYNAMICS_REGIME`)**:
  - Longitudinal trajectory velocity tracking: $\Delta\text{Price (\% Move)}$, $\Delta\text{NOPAT Trajectory (\% Move)}$, $\Delta\text{Fair Value (\% Move)}$, and $\text{Trajectory Gap (\% pts)}$.
  - Deterministic 4-regime taxonomy: `FUNDAMENTALS_AHEAD_OF_PRICE`, `PRICE_AND_FUNDAMENTALS_ALIGNED`, `PRICE_AHEAD_OF_FUNDAMENTALS`, and `FUNDAMENTALS_DETERIORATING`.
  - Disentangles genuine economic catch-up from pure multiple/expectation expansion.
- **5-Dimension Fundamental Reality Architecture**: First-class tracking of (1) Management Credibility, (2) Guidance Status, (3) Growth Trajectory, (4) Economic Quality, and (5) Thesis Status across 19 cohort stocks.
- **5-Stage Fundamental Decomposition Engine**: `GROWTH_ENGINE` $\to$ `REVENUE_ENGINE` $\to$ `MARGIN_ENGINE` $\to$ `CAPITAL_ENGINE` $\to$ `CASH_CONVERSION_ENGINE`.
- **Stage-by-Stage Bottleneck Diagnostics**: Explicit operational state checks across Demand, Capacity, Utilization, Margins, Working Capital, and ROIC (✅ / ❓ / ❌).
- **New Service & Invariant Test Suite**:
  - `backend/services/fundamental-trajectory-engine.service.js`
  - `backend/scripts/run-fundamental-trajectory-engine.js`
  - `backend/scripts/test-fundamental-trajectory-engine.js` (**279 / 279 invariant tests passed**).
- **Comprehensive Dossier**: Generated `reports/thesis_board/FUNDAMENTAL_TRAJECTORY_DOSSIER_V3_2.md` with Section 4 dedicated to the Fundamental Catch-Up vs Price Catch-Up Velocity Board.

## [v3.1.1] - 2026-09-20 (FCFF Metric-Integrity & 4-Tier Conversion Patch)

### Added
- **4-Tier `FCFF_CONVERSION_STATUS` Hierarchy**: Configured constants (`FCFF_CONVERSION_THRESHOLDS`) deterministically categorizing operational cash flow into `POSITIVE_CASH_COMPOUNDER`, `CAPITAL_INTENSIVE`, `FCFF_NEGATIVE_DURING_GROWTH`, and `FCFF_RECOVERY_REQUIRED`.
- **Modeled Forward Conversion vs. Accounting Separation**: Explicit metrics for `reinvestmentRatePct` ($RR = g / \text{Forward iROIC}$), `modeledFcffConversionPct` ($1 - RR$), and statutory baseline conversion $\text{FCFF}_0 / \text{NOPAT}_0$.
- **Orthogonal Cash vs. Decision State Invariant**: Codified invariant $\text{FCFF\_CONVERSION\_STATUS} \neq \text{DECISION\_STATE}$, ensuring operational cash recovery status (e.g. Transrail vs Shakti Pumps) is decoupled from thesis survivability.
- **FCFF Invariant Tests**: Expanded test suite in `backend/scripts/test-reverse-dcf-v3-integrity.js` to 63 invariant tests (142 total system tests across 4 suites).

### Fixed
- **Negative FCFF CAGR Bug**: Clamped mathematically invalid/undefined negative CAGRs to `null` (`N/A`) when forecast $\text{FCFF}_5 \le 0$ or baseline $\text{FCFF}_0 \le 0$.
- **FCFF Conversion Drag Null-Safety**: `fcffConversionDragPct` is calculated as $\text{NOPAT CAGR} - \text{FCFF CAGR}$ only when FCFF CAGR is mathematically valid; otherwise rendered as `N/A`.
- **Matrix Formatting**: Section 3 Market Expectations Matrix updated with full Reinvestment Rate, Modeled Conversion, FCFF CAGR, Drag, and Conversion Status columns.

## [v3.1.0] - 2026-09-19 (Institutional Asymmetric Compounding Engine)

### Added
- **8-Layer Reality Architecture**:
  1. *Layer 1: Forensic Truth & Cash Diagnostics* ($\text{FCFF}_0 = \text{NOPAT}_0 - \Delta\text{NOA}_0$, accounting identity).
  2. *Layer 2: Multibagger Economic Engine* (Evidence-weighted Effective Forward iROIC across 4 confidence tiers with non-linear negative recency priority).
  3. *Layer 3: Underwritten Future Earnings* (Capacity/order-book anchored NOPAT CAGR).
  4. *Layer 4: Market Expectations Gap & FCFF Conversion* ($\text{Expectations Gap} = \text{Underwritten NOPAT CAGR} - \text{Market-Implied FCFF CAGR}$).
  5. *Layer 5: 5× Economic Pathway Feasibility* (7-Year Horizon @ 25.85% CAGR external reference benchmark, TAM burden %, Market Share Delta).
  6. *Layer 6: Institutional DCF* ($\text{FCFF}_t = \text{NOPAT}_t (1 - g_t / \text{Forward iROIC})$ for $t=1..10 \to \text{WACC} \to \text{Net Debt/Cash Bridge}$).
  7. *Layer 7: Asymmetry & Downside Risk* (Dual Bear Floor: $\min(\text{DCF Bear}, \text{Multiple Stress})$, Signed Asymmetry Ratio, Model Buy Below, Model Trim Above).
  8. *Layer 8: Deterministic Decision Engine* (Zero Contradictions, 3-Way Conviction Separation: Economic Conviction, Valuation Conviction, Thesis Confidence).
- **Dual-Methodology Bear Floor**: Stressed DCF (-30% growth, stressed iROIC, +150 bps WACC) anchored against trough multiple compression floor.
- **Signed Asymmetry Ratio**: Correctly signed risk-reward metric $((FV - CMP) / (CMP - Bear))$ with explicit negative ratios for overvalued multiples.
- **Decision Engine Consistency**: Fixed state machine contradiction where stocks below hurdle rate were previously misclassified as top conviction dislocations.

## [V12.0.0] - 2026-05-02
### Added
- **Decision Engine V12**: Introduced strict skepticism and integrity rules (Rules 23-26).
- **Valuation Hallucination Ban**: Mandatory `NOT RATEABLE` state if Screener data is missing.
- **Project Business Data Penalties**: Tiered conviction caps for EPC/Capital Goods businesses with missing OCF/WC data.
- **Momentum Integrity**: Explicit rules preventing the mixing of YoY% and sequential absolute numbers.
- **Historical Purity**: Rigid time-travel constraints banning modern context in historical evaluations.
- **Auto-Sync on Add**: Backend orchestration to trigger financial data fetch immediately upon adding a new stock.
- **Syncing Status Badge**: UI indicator in CopyGeminiPrompt when data is being fetched in the background.

### Changed
- Refactored `AddStockDialog` to use a single backend endpoint `POST /api/stocks` for creation and orchestration.
- Updated `CopyGeminiPrompt` to implement time-travel filtering for valuation and shareholding metrics.
- Archived `V11_PROMPT.md` to `docs/archive/`.

## [V11.0.0] - 2026-05-01
- Initial Decision Engine release with Source-Aware Hybrid Intelligence.
