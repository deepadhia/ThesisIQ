# Changelog

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
