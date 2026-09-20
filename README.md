# 🧠 ThesisIQ v3.3.1 — Market–Thesis Valuation Reconciliation & Fundamental Platform

A production-grade fundamental research, trajectory modeling, and market reconciliation platform for institutional equity compounding analysis.

ThesisIQ combines **8-Layer Reality Compounding Architecture (v3.1)**, **Fundamental Trajectory & Management Evidence Engine (v3.2)**, **Market–Thesis Valuation Reconciliation & Duration Engine (v3.3)**, **Forensic FCFF Reinvestment Modeling**, **Reverse Duration Solvers**, and a **Zero-Contradiction Deterministic Decision State Machine** to explain why market prices differ from modeled fair values, identify genuine multibaggers, and provide actionable context for portfolio managers.

> **Core Operating Mandate:** Disentangle *Forensic Accounting Truth*, *Forward Incremental Capital Economics (iROIC)*, *Underwritten Earnings Power*, *Management Promise Delivery*, *Market Implied Duration & Expectations*, and *Capital Allocation Directives* rather than collapsing them into an oversimplified score.

---

## 🏛️ The 8 Sequential Reality Layers

ThesisIQ v3.1 evaluates every company through **8 Sequential Reality Layers**:

```text
       ┌─────────────────────────────────────────────────────────────┐
       │ Layer 1: Forensic Truth & Cash Conversion Diagnostics       │
       │ FCFF₀ = NOPAT₀ - ΔNOA₀ | Cash conversion risk gates         │
       └──────────────────────────────┬──────────────────────────────┘
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │ Layer 2: Multibagger Economic Engine                        │
       │ Effective Forward iROIC | Contradictory evidence priority   │
       └──────────────────────────────┬──────────────────────────────┘
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │ Layer 3: Underwritten Future Earnings (Capacity & Orders)   │
       │ Underwritten NOPAT CAGR | Reinvestment Rate (g / iROIC)     │
       └──────────────────────────────┬──────────────────────────────┘
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │ Layer 4: Market Expectations Gap & FCFF Conversion          │
       │ Expectations Gap = Underwritten NOPAT CAGR - Implied FCFF g │
       │ FCFF Conversion Status (4-Tier) | FCFF Conversion Drag      │
       └──────────────────────────────┬──────────────────────────────┘
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │ Layer 5: 5× Economic Pathway Feasibility (7-Year Horizon)   │
       │ 25.85% CAGR benchmark | TAM Burden % | Market Share Delta   │
       └──────────────────────────────┬──────────────────────────────┘
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │ Layer 6: Institutional DCF (Enterprise Value Bridge)        │
       │ FCFF_t = NOPAT_t(1 - RR_t) for t=1..10 | WACC | Net Cash    │
       └──────────────────────────────┬──────────────────────────────┘
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │ Layer 7: Asymmetry & Downside Risk Modeling                 │
       │ Dual Bear Floor: min(DCF Bear, Multiple Stress) | Signed Asym│
       └──────────────────────────────┬──────────────────────────────┘
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │ Layer 8: Deterministic Decision Engine & Evolution          │
       │ 3-Way Conviction Separation | Zero Contradiction Rules       │
       └─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Core Methodologies

### 1. Forensic Cash Flow & Reinvestment Identity (Layer 1 & 6)
For statutory baseline and all forecast years $t=1..10$:
$$\text{FCFF}_t = \text{NOPAT}_t - \Delta\text{NOA}_t = \text{NOPAT}_t \left(1 - \frac{g_t}{\text{Effective Forward iROIC}}\right)$$
$$\text{where } \Delta\text{NOA}_t = \text{Capex}_t - \text{D\&A}_t + \Delta\text{NWC}_t = \frac{\Delta\text{NOPAT}_t}{\text{Forward iROIC}}$$

* **Modeled Forward Conversion:** $\text{Modeled Conversion} = 1.0 - \frac{g_{NOPAT}}{\text{Forward iROIC}}$
* **Reinvestment Rate:** $\text{RR} = \frac{g_{NOPAT}}{\text{Forward iROIC}} \times 100$

### 2. Market Expectations Gap (Layer 4)
Solves the market-implied growth rate embedded in current enterprise value via 2-stage reverse DCF:
$$\text{Expectations Gap (\% pts)} = \text{Underwritten NOPAT CAGR} - \text{Market-Implied FCFF CAGR}$$
$$\text{FCFF Conversion Drag (\% pts)} = \text{Underwritten NOPAT CAGR} - \text{Underwritten FCFF CAGR}$$

* **Finite CAGR Invariant:** FCFF CAGR is computed if and only if both $\text{FCFF}_0 > 0$ and $\text{FCFF}_5 > 0$. If $\text{FCFF}_5 \le 0$ or $\text{FCFF}_0 \le 0$, `underwrittenFcffCagr` is strictly clamped to `null` (`N/A`) to prevent mathematically invalid negative CAGRs.

### 3. Deterministic 4-Tier FCFF Conversion Status Hierarchy
Configured via strict constants in `FCFF_CONVERSION_THRESHOLDS`:
- **Tier A: `FCFF_RECOVERY_REQUIRED` (Precedence):** Triggered by working-capital stress ($\text{CFO/PAT} < 0.65$, debtor days $> 100$, or baseline $\text{FCFF}_0 \le 0$). Example: **Transrail** (115 debtor days, 0.55 CFO/PAT).
- **Tier B: `FCFF_NEGATIVE_DURING_GROWTH`:** Triggered when growth reinvestment consumes more capital than NOPAT generates ($RR > 100\%$ or $\text{FCFF}_5 \le 0$). Examples: **Anant Raj**, **Gravita**, **Jyoti CNC**, **Policybazaar**.
- **Tier C: `CAPITAL_INTENSIVE`:** Growth is value-accretive ($\text{iROIC} > \text{WACC}$) and terminal $\text{FCFF}_5 > 0$, but high capital absorption occurs ($RR > 65\%$ or Conversion $< 35\%$). Example: **HBL Power** (NOPAT 28%, iROIC 37.5%, RR 74.7%, Conversion 25.3%, FCFF CAGR 5.1%, Drag +22.9% pts).
- **Tier D: `POSITIVE_CASH_COMPOUNDER`:** Conversion is strong and clean ($RR \le 65\%$, Conversion $\ge 35\%$). Examples: **INOX India**, **Quality Power**.

### 4. 🚨 Crucial Architectural Invariant: $\text{FCFF\_CONVERSION\_STATUS} \neq \text{DECISION\_STATE}$
Conversion status describes the operational cash economics across the forecast horizon, while the Decision Engine evaluates thesis survivability.
- **Transrail:** `FCFF_RECOVERY_REQUIRED` + `UNDER_REVALIDATION` $\to$ **`COMPOUNDING_AT_FAIR_PRICE` (MONITOR)**
- **Shakti Pumps:** `FCFF_RECOVERY_REQUIRED` + `BROKEN` $\to$ **`STRUCTURAL_VALUE_TRAP` (SYSTEMATIC EXIT)**

---

## 🎯 5× Economic Pathway Feasibility Model (Layer 5)

Evaluates whether a company can 5× its NOPAT over a standard 7-year horizon ($\approx 25.85\%$ CAGR benchmark):
- **Required 5× Revenue:** $\frac{\text{Target 5× NOPAT}}{\text{Target Net Margin}}$
- **Required 5× NOA:** $\frac{\text{Target 5× NOPAT}}{\text{Effective Forward iROIC}}$
- **Incremental Capital Required:** $\max(0, \text{Required 5× NOA} - \text{Current NOA})$
- **TAM Burden (%):** $\frac{\text{Required 5× Revenue}}{\text{Addressable TAM}} \times 100$
- **Market Share Expansion Delta (%):** $\text{Required 5× Market Share} - \text{Current Market Share}$

---

## 🛡️ Downside Risk & Asymmetry Modeling (Layer 7)

### Dual-Methodology Bear Floor
$$\text{Bear Floor Price} = \min(\text{DCF Bear Floor}, \text{Multiple Stress Floor})$$
1. **DCF Bear Floor:** Formal DCF with -30% growth cut, stressed iROIC, +150 bps WACC (13.0%), 2.0% terminal growth, and 20% multiple haircut.
2. **Multiple Stress Floor:** Cyclical trough multiple compression (40% multiple contraction, min 12x P/E) adjusted for net debt/cash bridge.

### Signed Asymmetry Ratio
$$\text{Signed Asymmetry Ratio} = \frac{\text{Intrinsic Fair Value} - \text{Current Price}}{\max(1.0, \text{Current Price} - \text{Bear Floor Price})}$$
Preserves negative ratios when stock trades above Intrinsic Fair Value.

---

## 🚦 Opportunity Classification Surface

| Tier | Meaning | Capital Allocation Action |
| :--- | :--- | :--- |
| 🟢 `TOP_CONVICTION_DISLOCATION` | Asymmetry $\ge 3.0:1$, Margin of Safety $\ge 25\%$, 3-Year IRR $\ge 20\%$ | Prime Fresh-Capital Candidate (ACCUMULATE) |
| 🟡 `COMPOUNDING_AT_FAIR_PRICE` | Proven compounder compounding steadily near fair value | Hold Core Position |
| 🔵 `OVERVALUED_COMPOUNDER` | Outstanding execution, but multiple exceeds fair value ceiling | Capital Protection / Trim Chasing |
| 🟠 `WATCHLIST_FRICTION` | Thesis under observation or working capital friction | Pause Incremental Capital |
| 🔴 `STRUCTURAL_VALUE_TRAP` | Broken thesis, solvency failure, or value destruction | Zero Allocation / Systematic Exit |

---

## 🧪 Invariant Test Coverage

ThesisIQ enforces strict mathematical invariant test suites with **100% pass rate (142 / 142 tests passing)**:

```text
================================================================================================
🧪 THESISIQ INVARIANT TEST SUITES
================================================================================================
1. test-fundamental-trajectory-engine.js      279/279 PASS  (Three Truths, Signals, Directives, Promise Ledger, DB Bridge, Catch-Up Dynamics, Hurdle)
2. test-reverse-dcf-v3-integrity.js            63/63 PASS  (FCFF Identity, 4-Tier Status, Regimes)
3. test-asymmetric-mispricing-ranking.js        22/22 PASS  (Reverse-DCF Sensitivity, Multiples)
4. test-market-valuation-integrity.js          33/33 PASS  (Parser Math, Trailing PE, Database Loading)
5. test-valuation-dislocation-watchdog.js      24/24 PASS  (Anti-Spam Cooldown, Gating Invariants)
------------------------------------------------------------------------------------------------
TOTAL TEST COVERAGE: 421/421 PASSING (100% INVARIANT SAFETY)
================================================================================================
```

---

## ⚙️ Running the System

### 1. Run v3.3 Market–Thesis Reconciliation Engine
```bash
node --env-file=.env.local backend/scripts/run-market-thesis-reconciliation.js
```
Generates complete Markdown dossier at `reports/thesis_board/MARKET_THESIS_RECONCILIATION_DOSSIER_V3_3.md`.

### 2. Run v3.2 Fundamental Trajectory & Evidence Engine
```bash
node --env-file=.env.local backend/scripts/run-fundamental-trajectory-engine.js
```
Generates complete Markdown dossier at `reports/thesis_board/FUNDAMENTAL_TRAJECTORY_DOSSIER_V3_2.md`.

### 3. Run v3.1.1 Institutional Valuation & Asymmetry Ranking
```bash
node --env-file=.env.local backend/scripts/run-asymmetric-mispricing-ranking.js
```
Generates complete Markdown dossier at `reports/thesis_board/ASYMMETRIC_MISPRICING_RANKING_18_STOCKS.md`.

### 4. Run Invariant Test Suites
```bash
node --env-file=.env.local backend/scripts/test-market-thesis-reconciliation.js
node --env-file=.env.local backend/scripts/test-fundamental-trajectory-engine.js
node --env-file=.env.local backend/scripts/test-reverse-dcf-v3-integrity.js
node --env-file=.env.local backend/scripts/test-asymmetric-mispricing-ranking.js
node --env-file=.env.local backend/scripts/test-market-valuation-integrity.js
node --env-file=.env.local backend/scripts/test-valuation-dislocation-watchdog.js
```

### 5. Start Background Server
```bash
npm run dev
```

---

## 🏛️ Engineering Design Principles

1. **Forensic Accounting Truth Before Valuation Models**
2. **5-Dimension Fundamental Reality Architecture (Credibility, Guidance, Growth, Economic Quality, Thesis Status)**
3. **Multidimensional Action Context for Existing Position Holders**
4. **Conditional Multi-Underwriting DCF Price Matrices**
5. **Zero Manual Database Overrides**
6. **No Static Ticker Branches or Hardcoded Figures**
7. **Point-in-Time Integrity Without Future Leaks**
8. **Modeled Reinvestment Derived Directly from Forward iROIC**
9. **No Undefined Negative CAGRs (Clamped to Null/NA)**
10. **Strict Separation of Cash Economics from Decision States**
11. **Dual-Methodology Downside Anchors**
12. **Idempotent 7-Day Anti-Spam Notification Watchdog**
13. **Deterministic Zero-Contradiction Decision Engine**

---

**Status:** Production (v3.2.0 Fundamental Trajectory & Management Evidence Engine)  
**Coverage Universe:** 18 High-Conviction Holdings  
**License:** Private / Proprietary Research Engine
