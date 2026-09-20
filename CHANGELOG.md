# Changelog

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
- **5-Dimension Fundamental Reality Architecture**: First-class tracking of (1) Management Credibility, (2) Guidance Status, (3) Growth Trajectory, (4) Economic Quality, and (5) Thesis Status across 19 cohort stocks.
- **5-Stage Fundamental Decomposition Engine**: `GROWTH_ENGINE` $\to$ `REVENUE_ENGINE` $\to$ `MARGIN_ENGINE` $\to$ `CAPITAL_ENGINE` $\to$ `CASH_CONVERSION_ENGINE`.
- **Stage-by-Stage Bottleneck Diagnostics**: Explicit operational state checks across Demand, Capacity, Utilization, Margins, Working Capital, and ROIC (✅ / ❓ / ❌).
- **New Service & Invariant Test Suite**:
  - `backend/services/fundamental-trajectory-engine.service.js`
  - `backend/scripts/run-fundamental-trajectory-engine.js`
  - `backend/scripts/test-fundamental-trajectory-engine.js` (**270 / 270 invariant tests passed**).
- **Comprehensive Dossier**: Generated `reports/thesis_board/FUNDAMENTAL_TRAJECTORY_DOSSIER_V3_2.md` with Section 4 dedicated to the auditable Management Promise Ledger.

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
