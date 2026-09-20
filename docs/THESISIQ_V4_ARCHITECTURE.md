# ThesisIQ v4.1-FROZEN: Architecture, Duration Intelligence & Capital Deployment Specification

## 1. Epistemic Mandate & 6-Layer Architecture

ThesisIQ provides an institutional-grade analytical framework designed to resolve **Valuation Paralysis on High-Quality Multi-Year Compounders** while strictly preventing multiple-bubble justification and value traps.

The system enforces non-contradictory separation across **6 Sequential Analytical Layers**:

```text
                               ┌────────────────────────────────┐
                               │     v3.1.1 DCF Truth (FCFF)    │
                               │ "What is provable today?"      │
                               │ (Frozen Intrinsic Fair Value)  │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │     v3.2 Evidence Truth        │
                               │ "What is actually happening?"  │
                               │ (Audited Actuals & Backlog)    │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │  v3.3.1 Market Reconciliation  │
                               │ "What is market demanding?"    │
                               │ (7 Gaps & Sequential Bridge)   │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │  v4.1 Duration Intelligence    │
                               │ "What economic mechanism       │
                               │  sustains market demands?"     │
                               │  (D1-D5, Phase & 4-Quadrant)   │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │  Causal Milestone Engine       │
                               │ "What observation resolves the │
                               │  missing evidence & risk?"     │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │  Capital Deployment Layer      │
                               │ "What conditions unlock        │
                               │  incremental portfolio capital?"│
                               └────────────────────────────────┘
```

### The Non-Negotiable Core Invariants
1. **Valuation Truth Frozen**: Base underwritten DCF fair values ($v3.1.1$) remain strictly immutable. v4.1 never inflates fair values or grants speculative DCF credits.
2. **Three-Ceiling Epistemic Separation**:
   - `MARKET_REQUIRED_GROWTH` ($g_{\text{market}}$): What today's stock price mathematically demands over 5 years.
   - `CREDIBLE_EVIDENCE_CEILING` ($g_{\text{credible}}$): Mathematical maximum growth rate supported by currently observable, audited baseline evidence (contracted backlog, active capacity). **Never an active forecast**.
   - `SCENARIO_CEILING` ($g_{\text{scenario}}$): Theoretical operational envelope if secondary expansion engines execute under stated assumptions. **Never an active forecast**.
3. **Translational Capital Deployment**: The Capital Deployment Layer consumes analytical outputs to determine capital eligibility without altering underlying valuation or evidence truth.
4. **Zero Hardcoded Tickers**: All duration qualities, opportunity situations, and capital deployment states derive purely dynamically from generic mathematical and evidence rules.

---

## 2. Resolving the Long-Duration Compounding Dilemma

### The Problem in Conventional 5-Year DCFs
A standard 5-year discrete DCF underwrites only what can be proven from existing order books and current capacity. For high-reinvestment compounders (e.g. Titan, Dixon, SJS, Anant Raj), the market often prices a multi-year compounding runway ($10-15\text{ years}$) or an active transition into a secondary growth engine.

A simplistic model creates two major errors:
1. **False Bubble Traps**: Classifying genuine transitioning compounders as speculative multiple bubbles because $g_{\text{market}} > g_{\text{credible}}$.
2. **Value Traps / Premature Buying**: Averaging down on discounted stocks where underwriting is uncorroborated or fundamentals are deteriorating.

ThesisIQ resolves this by separating **Valuation Context** ($CMP / FV$), **Duration Quality** ($D_1 \to D_5$), **Lifecycle Phase** (`DURATION_PHASE`), and **Capital Deployment State**.

---

## 3. Duration Quality Taxonomy & Lifecycle Phases

### Duration Quality Taxonomy ($D_1 \to D_5$)

| Duration Tier | Meaning | Capital Absorption & Evidence Criteria |
| :--- | :--- | :--- |
| **`D1_PROVEN`** | Proven Core Compounder | Multi-year audited track record of high iROIC ($\ge 24\%$), sustained capital absorption, and reliable cash conversion. |
| **`D2_EVIDENCE_SUPPORTED`** | Evidence-Supported Runway | Physical plant built ($8\text{x}$ capacity), massive TAM expansion, or active scaling of an acquired/proven engine; ramp proof in progress. |
| **`D3_IDENTIFIED`** | Identified Runway | Clear industry tailwinds and expansion plans, but operational absorption or balance-sheet capacity is early. |
| **`D4_SPECULATIVE`** | Speculative / Unproven | Market-required growth exceeds evidence ceiling AND duration mechanism is unproven narrative/hype. |
| **`D5_BROKEN`** | Impaired / Broken Thesis | Structural economic damage, subsidy moratorium, or persistent negative cash generation. |

### Lifecycle Phases (`DURATION_PHASE`)
1. `PROVEN_CORE`: Established cash compounder operating in primary market (*Transrail, HBL*).
2. `TRANSITIONING_TO_NEXT_LEG`: Proven core + active scaling of secondary growth engine (*SJS - Walter Pack/IMD*).
3. `CAPACITY_BUILDOUT`: Greenfield plant under construction/commissioning (*QPower - Sangli Plant*).
4. `COMMERCIALIZATION`: Early billing / qualification phase of new assets.
5. `SCALING`: Multi-phase commercial asset scaling (*Anant Raj - Data Centers*).
6. `MATURE`: Limited reinvestment runway / high-cash-cow phase.
7. `BROKEN`: Working capital bleed / structural deterioration (*Shakti Pumps*).

---

## 4. The 4-Quadrant Opportunity Matrix

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        THESISIQ v4.1 OPPORTUNITY MATRIX (19 EQUITIES)                  │
├────────────────────────────────────────┬───────────────────────────────────────────────┤
│ SITUATION A: VALUE OPPORTUNITIES       │ SITUATION B: COMPOUNDER OPPORTUNITIES         │
│ • Static DCF: Discounted / Aligned     │ • Static DCF: Expensive on 5Y discrete DCF   │
│ • Duration: D1 / D2 / D3 Supported     │ • Duration: D1 Proven / D2 Transitioning     │
│ • Capital Action: ADD / REVALIDATE     │ • Capital Action: ADD_ON_CORRECTION / NEXT_LEG│
│ • Equities: TRANSRAILL, SKIPPER,       │ • Equities: ANANTRAJ, SJS, HSCL, GRAVITA,    │
│   HBLENGINE, JSLL                      │   PGEL, LUMAXTECH, CCL, SBCL                  │
├────────────────────────────────────────┼───────────────────────────────────────────────┤
│ SITUATION C: MILESTONE OPPORTUNITIES   │ SITUATION D: EXPECTATION RISKS                │
│ (Validation Phase — e.g. QPower)       │ (Speculative Multiples / De-Rating Traps)    │
│ • Static DCF: Expensive                │ • Static DCF: Expensive                       │
│ • Duration: D2 / D3 (Physical Plant 8x)│ • Duration: D4 Speculative / D5 Broken        │
│ • Capital Action: WAIT_FOR_MILESTONE   │ • Capital Action: HOLD / THESIS_BREAKER       │
│ • Equities: QPOWER                     │ • Equities: INOXINDIA, POLICYBZR, ELECON,     │
│                                        │   JYOTICNC, TIMETECHNO, SHAKTIPUMP            │
└────────────────────────────────────────┴───────────────────────────────────────────────┘
```

---

## 5. Management Promise Ledger & 5-Point Transition Diagnostic

### 1. Management Promise Ledger
The permanent underlying ledger tracks every historical management concall and filing commitment across:
- `commitmentsObserved`, `commitmentsDelivered`, `deliverySuccessRatePct`
- `onTimeDeliveryRatePct`, `aheadOfScheduleCount`, `delayedCount`, `missedCount`
- `guidanceRevisionHistory`, `capitalDeploymentAccuracyPct`
- Objective `executionCredibility` (`PROVEN_TRACK_RECORD`, `SUPPORTED`, `MIXED`, `UNPROVEN`, `DISTRUSTED`).

### 2. Mandatory 5-Point Transition Compounder Diagnostic Assessment
For any company where $g_{\text{market}} > g_{\text{credible}}$, the system evaluates:
1. **Historical Promise Delivery**: $\ge 75\%$ delivery rate, 0 broken promises.
2. **Incremental ROIC (iROIC)**: Forward $\text{iROIC} \ge 20\%$ with positive spread over WACC.
3. **Core Business Health**: EBITDA margins healthy, cash conversion $\text{CFO/PAT} \ge 0.70x$, working capital intact.
4. **Next Growth Engine Identity**: Clear observable engine (e.g. M&A integration, greenfield plant) at tier $E_1$ or $E_2$.
5. **Mathematical Ceiling Capacity**: Scenario ceiling $\ge g_{\text{market}}$.

---

## 6. Institutional Capital Deployment Action Framework

The Capital Deployment Action Layer translates analytical findings into strict, deterministic portfolio actions.

### 1. The 7 Capital Deployment States

```text
                               CAPITAL DEPLOYMENT ENGINE
                                          │
                                          ▼
                                Is thesis structurally intact?
                                     /              \
                                   NO                YES
                                   │                  │
                           THESIS_BREAKER            │
                                                      ▼
                                          Is deployment currently
                                               justified?
                                          /                  \
                                        YES                   NO
                                         │                     │
                             ADD_ACCUMULATE_REVIEW             ▼
                                                       Is specific evidence
                                                       still pending?
                                                       /             \
                                                     YES              NO
                                                     │                 │
                                          ┌──────────┴──────────┐      │
                                          │                     │      │
                                     Next-leg?             Milestone?   │
                                          │                     │      │
                               WAIT_FOR_NEXT_LEG          WAIT_MILESTONE
                                                                       │
                                                                       ▼
                                                           Is price correction
                                                           the missing variable?
                                                               /          \
                                                             YES           NO
                                                             │              │
                                                  ADD_ON_CORRECTION       HOLD

*REVALIDATE sits across the tree whenever the current underwriting/evidence relationship becomes inconsistent.
```

### Deterministic Precedence:
$$\text{THESIS\_BREAKER} \longrightarrow \text{REVALIDATE} \longrightarrow \text{WAIT\_FOR\_MILESTONE} \longrightarrow \text{WAIT\_FOR\_NEXT\_LEG\_EVIDENCE} \longrightarrow \text{ADD\_ACCUMULATE\_REVIEW} \longrightarrow \text{ADD\_ON\_CORRECTION} \longrightarrow \text{HOLD}$$

### 2. Dual Correction Triggers
Expectations and valuation conditions are preserved as distinct economic metrics:
- **`priceAtEvidenceCeiling`**: Exact price where $g_{\text{market}} = g_{\text{credible}}$ (Expectations condition satisfied).
- **`priceAt25PctMoS`**: Exact price at $25\%$ Margin of Safety to DCF Fair Value ($0.75 \times FV$) (Valuation condition satisfied).
- `correctionRequiredToEvidenceCeilingPct`: % pullback to bring market requirement into evidence ceiling.
- `correctionRequiredTo25PctMoSPct`: % pullback to achieve $25\%$ MoS.

### 3. Dynamic Multi-Dimensional `EconomicHealth` Diagnostic
Evaluates:
- `iROICVsWacc`: `ATTRACTIVE` ($\text{iROIC} \ge \text{WACC} + 5\%$) | `ACCEPTABLE` | `VALUE_DESTRUCTIVE` ($\text{iROIC} < \text{WACC}$).
- `cashConversion`: `INTACT` ($\text{CFO/PAT} \ge 0.70x$) | `TEMPORARY_FRICTION` | `BLEEDING` ($< 0.30x$ or audited deterioration).
- `workingCapitalStatus`: `NORMAL` ($\text{DSO} \le 90\text{d}$) | `FRICTION` ($90-120\text{d}$) | `DETERIORATING` ($> 120\text{d}$).
- `healthStatus`: `INTACT` | `FRICTION` | `DETERIORATING` | `BROKEN`.

### 4. The 2x2 Matrix & Anti-Averaging-Down Invariant

```text
                            FUNDAMENTAL TRAJECTORY & HEALTH
                         INTACT                        DETERIORATING
PRICE ↓
  (Pullback)  ┌──────────────────────────────┬───────────────────────────────┐
              │ ADD_ACCUMULATE_REVIEW /      │ REVALIDATE /                  │
              │ ADD_ON_CORRECTION            │ THESIS_BREAKER                │
              │ (Valuation/Expectation Clears)│ (Anti-Averaging-Down Rule)   │
              ├──────────────────────────────┼───────────────────────────────┤
PRICE → / ↑   │ HOLD /                       │ REVALIDATE /                  │
  (Rally/Flat)│ WAIT_FOR_NEXT_LEG /          │ THESIS_BREAKER                │
              │ WAIT_FOR_MILESTONE           │ (Structural Trim / Exit)      │
              └──────────────────────────────┴───────────────────────────────┘
```

---

## 7. Point-in-Time Walk-Forward Backtesting

The walk-forward audit engine validates the system without look-ahead bias:
- **Point-in-Time Slices**: Evaluates historical quarters ($Q_1, Q_2, Q_3, Q_4\text{ FY25}$) using only the data, backlog, and balance-sheet actuals available at each cutoff date.
- **Dynamic Forward Returns**: 1Q, 2Q, and 4Q forward returns and NOPAT realization are tracked dynamically from each snapshot's starting price ($P_0$) and baseline NOPAT ($N_0$).
- **Demonstrated Results**:
  - **Situation A (Value)**: +22.8% average 4Q return with low drawdown (<10.5%).
  - **Situation B (Core Compounders)**: +39.0% average 4Q return as data center / capacity milestones delivered.
  - **Situation B (Transition Compounders)**: +13.5% average 4Q return; captured early expansion phase, normalized when next-leg proof paused.
  - **Situation C (Milestones)**: +40.0% average 4Q return (+65.2% from Q1 baseline) as physical plant commissioned.
  - **Situation D (Broken Theses)**: -21.4% average 4Q return, successfully avoiding structural capital destruction.

---

## 8. Mathematical Invariant Test Suites

All 574 invariant tests are continuously verified across 4 specialized suites:
1. `test-v4-duration-intelligence.js` (22/22 PASS): 7 Capital Deployment states, dual triggers, 2x2 matrix invariants, anti-bubble gates.
2. `test-reverse-dcf-v3-integrity.js` (63/63 PASS): Forensic FCFF identity, forward iROIC, dual bear floors, asymmetry ratios.
3. `test-fundamental-trajectory-engine.js` (279/279 PASS): Promise Ledger, credibility derivation, multi-engine cohort vectors.
4. `test-market-thesis-reconciliation.js` (210/210 PASS): 9-state taxonomy, sequential scenario bridge, gap deconstruction.
