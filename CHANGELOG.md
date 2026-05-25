# Changelog

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
