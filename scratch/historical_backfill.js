import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../backend/db/pool.js';

// Parse CLI args
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const targetQuarterArg = args.find(arg => arg.startsWith('--quarter='))?.split('=')[1];
const modelArg = args.find(arg => arg.startsWith('--model='))?.split('=')[1] || 'meta/llama-3.1-405b-instruct';
const tickerArg = args.find(arg => arg.startsWith('--ticker='))?.split('=')[1] || 'QPOWER';

const quarters = targetQuarterArg 
  ? [targetQuarterArg] 
  : [
      'FY25-Q2',
      'FY25-Q3',
      'FY25-Q4',
      'FY26-Q1',
      'FY26-Q2',
      'FY26-Q3'
    ];

function getQuarterEndDate(quarterLabel) {
  const m = quarterLabel.match(/FY(\d{2})-Q([1-4])/);
  if (!m) return null;
  const fySuffix = parseInt(m[1], 10);
  const qtr = parseInt(m[2], 10);
  const endingYear = 2000 + fySuffix;
  const year = qtr === 4 ? endingYear : endingYear - 1;
  const months = { 1: "06-30", 2: "09-30", 3: "12-31", 4: "03-31" };
  return `${year}-${months[qtr]}`;
}

// Trend calculation helpers
function computeTrendDirection(values, tolerance = 5) {
  if (values.length === 3 && values[0] !== null && values[1] === null && values[2] !== null) {
    return "Insufficient Data";
  }
  const validValues = values.filter(v => v !== null && !isNaN(v));
  if (validValues.length === 0) return "No Data";
  if (validValues.length === 1) return "Insufficient Data";
  if (validValues.length === 2) {
    const diff = validValues[1] - validValues[0];
    if (diff > tolerance) return "Improving (2Q)";
    if (diff < -tolerance) return "Deteriorating (2Q)";
    return "Stable (2Q)";
  }
  let monotonicImproving = true;
  for (let i = 1; i < validValues.length; i++) {
    if (validValues[i] <= validValues[i-1]) {
      monotonicImproving = false;
      break;
    }
  }
  if (monotonicImproving) return "Improving";
  if (validValues.length >= 3) {
    const newest = validValues[validValues.length - 1];
    const middle = validValues[validValues.length - 2];
    const oldest = validValues[validValues.length - 3];
    if (middle < oldest - tolerance && newest > middle + tolerance) {
      return "Recovering";
    }
  }
  const newest = validValues[validValues.length - 1];
  const middle = validValues[validValues.length - 2];
  const oldest = validValues[validValues.length - 3];
  const diff1 = middle - oldest;
  const diff2 = newest - middle;
  if (diff1 > tolerance && diff2 > tolerance) return "Improving";
  if (diff1 < -tolerance && diff2 < -tolerance) return "Deteriorating";
  if (Math.abs(diff1) <= tolerance && Math.abs(diff2) <= tolerance) return "Stable";
  if (diff1 > tolerance && Math.abs(diff2) <= tolerance) return "Stable at High Levels";
  if (diff1 < -tolerance && Math.abs(diff2) <= tolerance) return "Stabilizing after Drop";
  return "Mixed";
}

function computeMarginTrend(values, tolerance = 0.5) {
  if (values.length === 3 && values[0] !== null && values[1] === null && values[2] !== null) {
    return "Insufficient Data";
  }
  const validValues = values.filter(v => v !== null && !isNaN(v));
  if (validValues.length === 0) return "No Data";
  if (validValues.length === 1) return "Insufficient Data";
  if (validValues.length === 2) {
    const diff = validValues[1] - validValues[0];
    if (diff > tolerance) return "Expanding (2Q)";
    if (diff < -tolerance) return "Compressing (2Q)";
    return "Stable (2Q)";
  }
  let monotonicExpanding = true;
  for (let i = 1; i < validValues.length; i++) {
    if (validValues[i] <= validValues[i-1]) {
      monotonicExpanding = false;
      break;
    }
  }
  if (monotonicExpanding) return "Expanding";
  const newest = validValues[validValues.length - 1];
  const middle = validValues[validValues.length - 2];
  const oldest = validValues[validValues.length - 3];
  const diff1 = middle - oldest;
  const diff2 = newest - middle;
  if (diff1 > tolerance && diff2 > tolerance) return "Expanding";
  if (diff1 < -tolerance && diff2 < -tolerance) return "Compressing";
  if (Math.abs(diff1) <= tolerance && Math.abs(diff2) <= tolerance) return "Stable";
  if (diff1 > tolerance && Math.abs(diff2) <= tolerance) return "Stable (Expanded)";
  if (diff1 < -tolerance && Math.abs(diff2) <= tolerance) return "Stable (Compressed)";
  return "Volatile";
}

function computeOwnershipTrend(promoter, fii, dii, pledge = []) {
  const flags = [];
  let label = "Stable";
  let details = "";
  if (promoter.length === 3 && promoter[0] !== null && promoter[1] === null && promoter[2] !== null) {
    return { label: "Insufficient Data", details: "Missing intermediate quarter", flags: [] };
  }
  const validPromoter = promoter.filter(v => v !== null);
  if (validPromoter.length >= 2) {
    const newest = validPromoter[validPromoter.length - 1];
    const oldest = validPromoter[0];
    const drop = oldest - newest;
    if (drop > 1.0) {
      label = "Notable Promoter Reduction";
      flags.push(`🟡 Promoter holding dropped by ${drop.toFixed(2)}%`);
    } else if (drop > 0 && drop <= 1.0) {
      const validFii = fii.filter(v => v !== null);
      const validDii = dii.filter(v => v !== null);
      let instRising = false;
      if (validFii.length >= 2 && validDii.length >= 2) {
        const fiiRise = validFii[validFii.length - 1] - validFii[0];
        const diiRise = validDii[validDii.length - 1] - validDii[0];
        if (fiiRise + diiRise > drop * 0.5) instRising = true;
      }
      if (instRising) {
        label = "Neutral/Mixed";
        details = "Promoter slightly down but absorbed by Institutions";
      } else {
        label = "Minor Promoter Reduction";
        flags.push(`🟡 Promoter slightly down (${drop.toFixed(2)}%)`);
      }
    } else if (drop < 0) {
      label = "Promoter Accumulation";
      flags.push(`🟢 Promoter holding increased by ${Math.abs(drop).toFixed(2)}%`);
    }
  }
  const validPledge = pledge.filter(v => v !== null);
  if (validPledge.length >= 2) {
    const newest = validPledge[validPledge.length - 1];
    const oldest = validPledge[0];
    if (newest - oldest > 1.0) {
      flags.push(`🔴 Promoter Pledge Increased significantly (${(newest - oldest).toFixed(2)}%)`);
      label = "Pledge Risk";
    }
  }
  return { label, details, flags };
}

function generateAnomalyFlags(trends) {
  const flags = [];
  if (trends.revTrend === "Deteriorating" && trends.patTrend === "Deteriorating") {
    flags.push("🔴 Growth (Rev & PAT) deteriorating for 3 quarters");
  } else if (trends.revTrend === "Deteriorating") {
    flags.push("🟠 Revenue slowing 3 quarters");
  } else if (trends.patTrend === "Deteriorating") {
    flags.push("🟠 PAT slowing 3 quarters");
  }
  if (trends.marginTrend === "Compressing") {
    flags.push("🔴 Margin compression over 3 quarters");
  } else if (trends.marginTrend === "Expanding") {
    flags.push("🟢 Margin expansion 3 quarters");
  }
  if (trends.debtTrend === "Rising" && (trends.patTrend === "Deteriorating" || trends.patTrend === "Stable")) {
    flags.push("🔴 Debt rising while PAT flat/falling");
  }
  trends.ownershipFlags.forEach(f => flags.push(f));
  return flags;
}

function formatTrendSeries(values, unit = "") {
  if (!values || values.length === 0) return "N/A";
  return values.map(v => v !== null && !isNaN(v) ? `${v}${unit}` : "N/A").join(" → ");
}

// Profile parsers
function parseTrackingProfileConfig(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function getMetricKeysForPrompt(profile, stockMetricKeys) {
  if (profile && profile.metrics && Array.isArray(profile.metrics)) {
    const keys = profile.metrics.filter(m => m.key).map(m => m.key);
    if (keys.length > 0) return keys;
  }
  if (Array.isArray(stockMetricKeys)) {
    return stockMetricKeys;
  }
  return ["revenue_growth", "opm", "pat_growth"];
}

function decisionRulesFromProfile(profile) {
  if (!profile) return { kill_switches: [], add_conditions: [], review_frequency: null };
  const killRaw = profile.kill_switch_conditions ?? profile.killSwitchConditions ?? [];
  const addRaw = profile.add_on_conditions ?? profile.addOnConditions ?? [];
  const freqRaw = profile.review_frequency ?? profile.reviewFrequency ?? null;
  
  const parseRule = (raw, defaultSev) => {
    if (!Array.isArray(raw)) return [];
    return raw.map(item => {
      if (typeof item === 'string') return { rule: item, severity: defaultSev };
      if (item && typeof item === 'object') {
        return {
          rule: item.rule || item.condition || "",
          severity: item.severity === 'high' || item.severity === 'medium' ? item.severity : defaultSev
        };
      }
      return null;
    }).filter(Boolean);
  };

  return {
    kill_switches: parseRule(killRaw, "high"),
    add_conditions: parseRule(addRaw, "medium"),
    review_frequency: freqRaw
  };
}

// Prompt Context Generator (V12)
function buildGeminiContext(stock, promises, snapshots, trackingConfig, limitToQuarter, shareholding, valuation, xbrlMetrics) {
  const allSnapshots = snapshots || [];
  const missingText = "NOT DISCLOSED";

  const pending = promises.filter((p) => p.status === "pending");
  const kept = promises.filter((p) => p.status === "kept");
  const broken = promises.filter((p) => p.status === "broken");

  const pendingLedger = pending.map((p) => ({
    id: p.id,
    promise_text: p.promise_text,
    made_in_quarter: p.made_in_quarter,
    target_deadline: p.target_deadline || "Not specified",
  }));

  const credibility = kept.length + broken.length > 0
    ? `${Math.round((kept.length / (kept.length + broken.length)) * 100)}%`
    : "No resolved promises yet";

  const rollingSnapshotsArray = allSnapshots.slice(0, 4).map((s) => {
    if (s.raw_ai_output && typeof s.raw_ai_output === "object") return s.raw_ai_output;
    const prevMetrics = s.metrics && typeof s.metrics === "object" ? s.metrics : {};
    return {
      quarter: s.quarter,
      snapshot: {
        summary: s.summary ?? null,
        thesis_status: s.thesis_status ?? null,
        thesis_drift: s.thesis_drift_status ? { status: s.thesis_drift_status, reason: s.thesis_drift_reason ?? null } : null,
      },
      metrics: prevMetrics,
      management_analysis: {
        red_flags: Array.isArray(s.red_flags) ? s.red_flags : [],
        dodged_questions: Array.isArray(s.dodged_questions) ? s.dodged_questions : [],
      },
    };
  });

  const rollingSnapshots = JSON.stringify(rollingSnapshotsArray, null, 2);

  // Formatters
  const toCrValue = (val) => {
    if (val == null) return null;
    return Math.round((parseFloat(val) / 10000000) * 100) / 100;
  };
  const toDisplayCrores = (val) => {
    const cr = toCrValue(val);
    return cr != null ? `₹${cr} Cr` : "N/A";
  };

  // Pre-computed Trends
  const revValues = [];
  const patValues = [];
  const marginValues = [];
  const finCostValues = [];
  let trendSource = "N/A";
  let momentumDirection = "Neutral";

  if (xbrlMetrics.length >= 2) {
    trendSource = "xbrl_metrics_quarterly";
    const pastN = xbrlMetrics.slice(0, Math.min(4, xbrlMetrics.length)).reverse();

    for (const r of pastN) {
      revValues.push(toCrValue(r.revenue_from_ops));
      patValues.push(toCrValue(r.pat));
      finCostValues.push(toCrValue(r.finance_cost));
      
      let margin = null;
      if (r.ebitda_margin_pct != null) margin = parseFloat(r.ebitda_margin_pct);
      else if (r.ebitda != null && r.revenue_from_ops != null && parseFloat(r.revenue_from_ops) > 0) {
        margin = Math.round((parseFloat(r.ebitda) / parseFloat(r.revenue_from_ops)) * 1000) / 10;
      }
      marginValues.push(margin);
    }
  }

  const revTrend = computeTrendDirection(revValues, 5);
  const patTrend = computeTrendDirection(patValues, 5);
  const finCostTrend = computeTrendDirection(finCostValues, 5);
  const marginTrend = computeMarginTrend(marginValues, 0.5);

  if (revTrend.includes("Improving") && patTrend.includes("Improving")) {
    momentumDirection = "Positive";
  } else if (revTrend.includes("Deteriorating") || patTrend.includes("Deteriorating")) {
    momentumDirection = "Negative";
  } else {
    momentumDirection = "Mixed";
  }

  let promoterValues = [];
  let fiiValues = [];
  let diiValues = [];
  if (shareholding && shareholding.length > 0) {
    const shPast3 = shareholding.slice(0, 3).reverse();
    promoterValues = shPast3.map((s) => parseFloat(s.promoters) || null);
    fiiValues = shPast3.map((s) => parseFloat(s.fiis) || null);
    diiValues = shPast3.map((s) => parseFloat(s.diis) || null);
  }
  
  const ownershipAnalysis = computeOwnershipTrend(promoterValues, fiiValues, diiValues);
  const autoFlags = generateAnomalyFlags({
    revTrend,
    patTrend,
    marginTrend,
    ownershipFlags: ownershipAnalysis.flags,
  });

  let decisionEngineContext = "";
  
  decisionEngineContext += `SECTION A: Current Quarter Snapshot\n`;
  if (allSnapshots.length > 0) {
    decisionEngineContext += (allSnapshots[0].summary || missingText) + "\n\n";
  } else {
    decisionEngineContext += missingText + "\n\n";
  }

  let trendQ = xbrlMetrics.length >= 2 ? Math.min(4, xbrlMetrics.length) : 0;
  let trendQText = trendQ >= 2 ? `${trendQ}Q Trend` : "Insufficient Data";
  
  decisionEngineContext += `SECTION B: Last ${trendQText}\n`;
  if (trendQ >= 2) {
    decisionEngineContext += `Revenue Trend (₹ Cr): ${formatTrendSeries(revValues)} (${revTrend})\n`;
    decisionEngineContext += `PAT Trend (₹ Cr): ${formatTrendSeries(patValues)} (${patTrend})\n`;
    decisionEngineContext += `Margin Trend: ${formatTrendSeries(marginValues, "%")} (${marginTrend})\n`;
    if (finCostValues.some(v => v != null)) {
      decisionEngineContext += `Finance Cost Trend (₹ Cr): ${formatTrendSeries(finCostValues)} (${finCostTrend})\n`;
    }
    decisionEngineContext += `Momentum Direction: ${momentumDirection}\n`;
    decisionEngineContext += `Source: ${trendSource}\n`;
    decisionEngineContext += `⚠️ STRICT RULE FOR ANALYSIS:\n`;
    decisionEngineContext += `- IF a metric is marked [FALLBACK] and age > 1Q, treat as low reliability.\n`;
    decisionEngineContext += `- IF a metric is marked [INVALID] or has confidence 0, IGNORE it completely for trend/scoring.\n`;
    decisionEngineContext += `- IF age > 2Q, DO NOT USE for trend analysis as it creates fake signals.\n\n`;
  } else {
    decisionEngineContext += `${trendQText}\n\n`;
  }

  decisionEngineContext += `SECTION C: Ownership Trend (Source: shareholding)\n`;
  if (shareholding && shareholding.length > 0) {
    decisionEngineContext += `Promoter: ${formatTrendSeries(promoterValues, "%")}\n`;
    decisionEngineContext += `FII: ${formatTrendSeries(fiiValues, "%")}\n`;
    decisionEngineContext += `DII: ${formatTrendSeries(diiValues, "%")}\n`;
    decisionEngineContext += `Status: ${ownershipAnalysis.label} ${ownershipAnalysis.details ? `- ${ownershipAnalysis.details}` : ""}\n\n`;
  } else {
    decisionEngineContext += missingText + "\n\n";
  }

  const latestValuation = valuation && valuation.length > 0 ? valuation[0] : null;
  const asOf = latestValuation && latestValuation.created_at ? new Date(latestValuation.created_at).toISOString().split('T')[0] : 'Latest';
  decisionEngineContext += `SECTION D: Valuation Snapshot (Source: financial_metrics, As of: ${asOf})\n`;
  if (latestValuation) {
    decisionEngineContext += `Relevant P/E: ${latestValuation.pe_ratio || missingText}\n`;
    decisionEngineContext += `Industry P/E: ${latestValuation.industry_pe || missingText}\n`;
    decisionEngineContext += `EV/EBITDA: ${latestValuation.ev_to_ebitda || missingText}\n`;
    decisionEngineContext += `Market Cap: ${latestValuation.market_cap ? latestValuation.market_cap + ' Cr' : missingText}\n\n`;
  } else {
    decisionEngineContext += missingText + "\n\n";
  }

  decisionEngineContext += `SECTION E: Auto Flags\n`;
  if (autoFlags.length > 0) {
    decisionEngineContext += autoFlags.join("\n") + "\n\n";
  } else {
    decisionEngineContext += "None detected.\n\n";
  }

  const fm = latestValuation;
  const fmYear = fm?.year ? `FY${String(fm.year).slice(-2)}` : "Latest Available";
  decisionEngineContext += `SECTION F: Screener / Fundamental Data (Source: financial_metrics — Annual, ${fmYear})\n`;
  if (fm) {
    decisionEngineContext += `ROCE: ${fm.roce != null ? fm.roce + "%" : missingText}\n`;
    decisionEngineContext += `ROE: ${fm.roe != null ? fm.roe + "%" : missingText}\n`;
    decisionEngineContext += `Debt/Equity: ${fm.debt_equity != null ? fm.debt_equity : missingText}\n`;
    decisionEngineContext += `Operating Margin (OPM): ${fm.opm != null ? fm.opm + "%" : missingText}\n`;
    decisionEngineContext += `Revenue (Cr): ${fm.revenue != null ? fm.revenue : missingText}\n`;
    decisionEngineContext += `Revenue Growth (YoY): ${fm.revenue_growth != null ? fm.revenue_growth + "%" : missingText}\n`;
    decisionEngineContext += `Net Profit (Cr): ${fm.net_profit != null ? fm.net_profit : missingText}\n`;
    decisionEngineContext += `Profit Growth (YoY): ${fm.profit_growth != null ? fm.profit_growth + "%" : missingText}\n`;
    decisionEngineContext += `Free Cash Flow (Cr): ${fm.free_cash_flow != null ? fm.free_cash_flow : missingText}\n`;
    decisionEngineContext += `EPS: ${fm.eps != null ? fm.eps : missingText}\n`;
    decisionEngineContext += `Promoter Holding (Annual): ${fm.promoter_holding != null ? fm.promoter_holding + "%" : missingText}\n`;
  } else {
    decisionEngineContext += missingText + "\n";
  }
  decisionEngineContext += "\n";

  const sectionGxbrl = xbrlMetrics.slice(0, 4); 
  decisionEngineContext += `SECTION G: Official Quarterly Financials (Source: NSE/XBRL Hybrid)\n`;
  if (sectionGxbrl.length > 0) {
    const yoy = (v) => v != null ? ` (YoY: ${v > 0 ? "+" : ""}${v}%)` : "";
    const src = (field, r) => {
      const meta = r.metric_metadata?.[field] || {};
      const s = meta.source || r.metric_sources?.[field];
      const age = meta.age_quarters || 0;
      const valid = meta.derived_valid !== false;
      
      if (!valid) return ` [INVALID: ${meta.invalid_reason || 'STALE'}]`;
      if (s === 'xbrl') return "";
      if (s === 'fallback') return ` [FALLBACK: ${age}Q OLD]`;
      if (s === 'derived') return " [DERIVED]";
      if (s === 'api') return " [API SUMMARY]";
      return s ? ` [${String(s).toUpperCase()}]` : "";
    };

    for (const row of sectionGxbrl) {
      decisionEngineContext += `\n[${row.quarter} | Reliability: ${row.reliability_score || 0}%]\n`;
      decisionEngineContext += `  P&L: Rev: ${toDisplayCrores(row.revenue_from_ops)}${yoy(row.revenue_growth_yoy)}${src('revenue_from_ops', row)} | PAT: ${toDisplayCrores(row.pat)}${yoy(row.pat_growth_yoy)}${src('pat', row)}\n`;
      
      const signals = [];
      if (row.receivables != null && row.revenue_from_ops != null && row.revenue_from_ops > 0) {
        const recDays = Math.round((parseFloat(row.receivables) / parseFloat(row.revenue_from_ops)) * 90);
        signals.push(`Receivable Days: ${recDays}d${src('receivable_days', row)}`);
      }
      if (row.trade_payables != null) {
        signals.push(`Payables: ${toDisplayCrores(row.trade_payables)}${src('trade_payables', row)}`);
      }
      if (row.working_capital_days != null) {
        signals.push(`WC Cycle: ${Math.round(parseFloat(row.working_capital_days))}d${src('working_capital_days', row)}`);
      }
      if (row.cfo != null && row.pat != null && row.pat > 0) {
        const cfoRatio = (parseFloat(row.cfo) / parseFloat(row.pat)).toFixed(2);
        signals.push(`CFO/PAT Ratio: ${cfoRatio}${src('cfo_pat_ratio', row)}`);
      }
      if (row.borrowings != null) {
        signals.push(`Borrowings: ${toDisplayCrores(row.borrowings)}${src('borrowings', row)}`);
      }
      if (signals.length > 0) {
        decisionEngineContext += `  Enrichment: ${signals.join(" | ")}\n`;
      }
      if (row.exceptional_items != null && row.exceptional_items !== 0) {
        decisionEngineContext += `  ⚠️ Exceptional: ${toDisplayCrores(row.exceptional_items)}\n`;
      }
    }
    decisionEngineContext += `\n`;
  } else {
    decisionEngineContext += `NOT FETCHED\n\n`;
  }

  const metricKeys = getMetricKeysForPrompt(trackingConfig, stock.metric_keys);
  const primaryMetricLabel = trackingConfig?.primary_thesis_metric?.label || "Primary Metric";
  const coreThesis = trackingConfig?.core_thesis || stock.investment_thesis || "Compounder story.";
  const trackingDirectives = trackingConfig?.tracking_directives || stock.tracking_directives || "Track FCF and revenue.";
  const decisionRules = decisionRulesFromProfile(trackingConfig);
  const reviewFrequencyLine = decisionRules.review_frequency || "quarterly";
  
  const killSwitchLines = decisionRules.kill_switches.length > 0
    ? decisionRules.kill_switches.map((c, i) => `${i + 1}. [${c.severity.toUpperCase()}] ${c.rule}`).join("\n")
    : "(None configured.)";
    
  const addOnLines = decisionRules.add_conditions.length > 0
    ? decisionRules.add_conditions.map((c, i) => `${i + 1}. [${c.severity.toUpperCase()}] ${c.rule}`).join("\n")
    : "(None configured.)";

  return `**System Role:** You are a **Lead Indian Equity Research Analyst**.

Evaluate if ${stock.ticker} is: Strengthening, Stable, Weakening, or Broken.

═══════════════════════════════════════
PARAMETERIZED INPUTS
═══════════════════════════════════════
**COMPANY TICKER:** ${stock.ticker}
**CORE INVESTMENT THESIS:** ${coreThesis}
**TRACKING DIRECTIVES:** ${trackingDirectives}
**MANDATORY METRICS TO TRACK:** ${metricKeys.join(", ")}
**PRIMARY THESIS METRIC TO EXTRACT:** ${primaryMetricLabel}

═══════════════════════════════════════
STRICT RULE CHECK (MANDATORY — DO NOT SKIP)
═══════════════════════════════════════
**Review frequency:** ${reviewFrequencyLine}
**Kill switch conditions**:
${killSwitchLines}

**Add / higher-conviction conditions**:
${addOnLines}

**MANDATE:**
- For every configured rule line item above, you MUST emit one row in \`strict_rule_check.kill_switches\` or \`strict_rule_check.add_conditions\` with the exact rule text, severity, triggered status, and verbatim transcript/filing evidence.
- \`strict_rule_check.overall_status\`: "fail" if high kill switch triggered; "warning" if medium kill switch triggered; else "pass".

═══════════════════════════════════════
HISTORICAL CONTEXT (ROLLING MEMORY LEDGER)
═══════════════════════════════════════
${rollingSnapshots}

- PENDING PROMISES:
${JSON.stringify(pendingLedger, null, 2)}
Credibility Score: ${credibility}

═══════════════════════════════════════
📊 DECISION ENGINE SIGNALS (PRE-COMPUTED)
═══════════════════════════════════════
${decisionEngineContext}

═══════════════════════════════════════
⚠️ NON-NEGOTIABLE RULES (HARD LOGIC) — V12
═══════════════════════════════════════
1. **THESIS DOMINANCE RULE** (IF thesis_score < 60 → CUT POSITION, ignore valuation).
2. **KILL SWITCH RULE** (HIGH triggered → CUT; MEDIUM triggered → CANNOT ADD).
3. **NO DATA HALLUCINATION RULE** (If missing, value = "NOT DISCLOSED").
4. **CONVICTION CAP RULE** (IF conviction < 60 → Starter size).
5. **VALUATION DISCIPLINE RULE** (IF valuation < 40 → No full size).
6. **PRIMARY METRIC OVERRIDE RULE** (IF primary metric strong AND margins expanding AND no HIGH kill switch → CANNOT CUT due to missing secondary data).
7. **EARNINGS QUALITY RULE** (IF CFO/PAT < 0.5 OR unexplained WC expansion → cap conviction <= 60, Starter size).
8. **GROWTH QUALITY CAP** (If client concentration > 30% or unexplained WC expansion → cap conviction <= 60, starter/half only).
9. **MOMENTUM DIRECTION RULE** QoQ acceleration gives +5, QoQ deceleration 1Q gives -5, QoQ deceleration 2Q+ gives -10.
10. **ADD vs BUILD DISAMBIGUATION** ADD only if prior thesis > 75, current improving, accelerating execution, no new risks. Otherwise BUILD.
11. **MULTIBAGGER MODE RULE** (Thesis >= 80 means no cut on single bad quarter. Skip wait & watch path before cutting. Threshold is 2 quarters of consecutive deterioration, or 3 quarters for project-based/EPC lumpy businesses).
12. **CYCLE PEAK RISK** (If margins & growth at multi-quarter highs and uniform bullishness → reduce conviction by 5-10, no full size).
13. **THESIS DRIFT SEVERITY** (If growth is from unaligned segment → reduce thesis score by 5-15, thesis_drift = evolving).
14. **SKEPTICISM RULE** (If warnings, red flags, omissions all empty → reduce conviction by 5, add low_disclosure_risk).
15. **PENALTY NORMALIZATION** (Consolidate multiple penalties from same root cause, apply only the strongest one).
16. **PORTFOLIO AWARENESS** (Verify theme concentration. Cap FULL positions at 3 in same macro theme).

═══════════════════════════════════════
🎯 OUTPUT JSON SCHEMA (MANDATORY)
═══════════════════════════════════════
Return ONLY a valid JSON object matching:
{
  "summary": "Brief 2-3 sentence overview.",
  "dodged_questions": ["Question 1 omitted", "Question 2 omitted"],
  "red_flags": ["Flag 1", "Flag 2"],
  "metrics": {
    "primary_thesis_metric": { "value": "15%", "evidence": "page 12", "source": "transcript", "confidence": "high", "period": "current_quarter" },
    "revenue_growth": { "value": "20%", "evidence": "page 4" },
    "opm": { "value": "22%", "evidence": "page 5" },
    "pat_growth": { "value": "18%", "evidence": "page 4" }
  },
  "signals": {
    "bullish": ["Strong backlog expansion"],
    "warnings": ["Receivable days expanded from 80 to 98"],
    "bearish": []
  },
  "key_changes": ["None"],
  "thesis_status": "strengthening | stable | weakening | broken",
  "thesis_status_reason": "Rationale for state.",
  "thesis_momentum": "positive | negative | stable",
  "thesis_drift_status": "none | evolving",
  "confidence_score": 85,
  "thesis_score": 82,
  "valuation_score": 65,
  "conviction_score": 75,
  "action_decision": "BUILD POSITION | ADD POSITION | WAIT AND WATCH | CUT POSITION",
  "position_size": "none | starter | half | full",
  "promise_updates": [
    { "id": "uuid-here", "new_status": "kept | broken | pending", "resolved_in_quarter": "${limitToQuarter}", "evidence": "verbatim text" }
  ],
  "new_promises": [
    { "promise_text": "management promised x", "made_in_quarter": "${limitToQuarter}", "target_deadline": "Q4 FY26" }
  ],
  "strict_rule_check": {
    "overall_status": "pass | warning | fail",
    "overall_status_rationale": "one sentence",
    "kill_switches": [
      { "condition": "rule text", "severity": "high | medium", "status": "triggered | not_triggered | insufficient_data", "evidence": "verbatim" }
    ],
    "add_conditions": [
      { "condition": "rule text", "severity": "high | medium", "status": "triggered | not_triggered | insufficient_data", "evidence": "verbatim" }
    ]
  },
  "decision_blockers": ["working_capital_risk"],
  "deterioration_quarters": 0,
  "data_quality_score": 90,
  "official_filing_present": true
}
`;
}

// Call NVIDIA NIM using selected model
async function callNim(ticker, promptContent, selectedModel) {
  const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
  if (!NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY not configured in env");
  }

  const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s timeout for large models

  try {
    const response = await fetch(NIM_BASE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: "You are a financial analyst. Analyze stocks strictly according to the provided V12 rules and framework, and return a clean JSON.",
          },
          {
            role: "user",
            content: promptContent,
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NIM API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    const cleanJson = content.replace(/```json\n?/, "").replace(/\n?```/, "").trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Main backfiller orchestrator
async function backfillStock(ticker, targetQuarters) {
  console.log(`\n🚀 Starting V12 historical backfill for ${ticker}...`);
  console.log(`🧠 Selected Model: ${modelArg}`);
  console.log(`🧪 Execution Mode: ${isDryRun ? 'DRY-RUN (No Database Writes)' : 'LIVE (Commits to Database)'}`);
  
  // 1. Get stock details
  const stockRes = await pool.query("SELECT * FROM stocks WHERE UPPER(ticker) = $1", [ticker.toUpperCase()]);
  if (stockRes.rows.length === 0) {
    console.error(`Stock ${ticker} not found.`);
    return;
  }
  const stock = stockRes.rows[0];
  console.log(`Found Stock: ${stock.company_name} (ID: ${stock.id})`);

  // 2. Load stock tracking profile
  const profileRes = await pool.query("SELECT config FROM stock_tracking_profiles WHERE stock_id = $1", [stock.id]);
  const trackingConfig = profileRes.rows[0] ? parseTrackingProfileConfig(profileRes.rows[0].config) : null;

  // Process quarters chronologically!
  for (const quarter of targetQuarters) {
    console.log(`\n--------------------------------------------`);
    console.log(`⏳ Processing Quarter: ${quarter}...`);
    
    const cutoffDate = getQuarterEndDate(quarter);
    if (!cutoffDate) {
      console.error(`Invalid quarter label format: ${quarter}`);
      continue;
    }
    console.log(`Slicing data as of end date: ${cutoffDate}`);

    // Loading historical quarterly snapshots chronologically older than this target quarter (memory loop)
    const snapshotsRes = await pool.query(
      `SELECT * FROM quarterly_snapshots 
       WHERE stock_id = $1 AND quarter < $2 
       ORDER BY quarter DESC LIMIT 4`,
      [stock.id, quarter]
    );
    const snapshots = snapshotsRes.rows;
    console.log(`  Loaded ${snapshots.length} historical rolling snapshots.`);

    // Load promises pending or resolved before this quarter
    const promisesRes = await pool.query(
      `SELECT * FROM management_promises 
       WHERE stock_id = $1 AND (status = 'pending' OR resolved_in_quarter < $2)`,
      [stock.id, quarter]
    );
    const promises = promisesRes.rows;

    // Load shareholding up to cutoffDate
    const shareholdingRes = await pool.query(
      `SELECT * FROM shareholding 
       WHERE stock_id = $1 AND created_at <= $2 
       ORDER BY created_at DESC`,
      [stock.id, cutoffDate]
    );
    const shareholding = shareholdingRes.rows;

    // Load valuation (financial_metrics) up to cutoffDate
    const valuationRes = await pool.query(
      `SELECT * FROM financial_metrics 
       WHERE stock_id = $1 AND created_at <= $2 
       ORDER BY created_at DESC`,
      [stock.id, cutoffDate]
    );
    const valuation = valuationRes.rows;

    // Load xbrlMetrics up to cutoffDate
    const xbrlMetricsRes = await pool.query(
      `SELECT * FROM xbrl_metrics_quarterly 
       WHERE stock_id = $1 AND period_end_date <= $2 
       ORDER BY period_end_date DESC`,
      [stock.id, cutoffDate]
    );
    const xbrlMetrics = xbrlMetricsRes.rows;
    console.log(`  Loaded ${xbrlMetrics.length} chronological XBRL metrics.`);

    // 3. Compile V12 Prompt Context
    const prompt = buildGeminiContext(stock, promises, snapshots, trackingConfig, quarter, shareholding, valuation, xbrlMetrics);
    
    if (isDryRun) {
      const dryRunFolder = path.join(process.cwd(), 'scratch', 'dry_runs');
      if (!fs.existsSync(dryRunFolder)) {
        fs.mkdirSync(dryRunFolder, { recursive: true });
      }
      const promptFile = path.join(dryRunFolder, `prompt_${ticker}_${quarter}.txt`);
      fs.writeFileSync(promptFile, prompt, 'utf8');
      
      console.log(`\n================== [DRY-RUN FOR ${quarter}] ==================`);
      console.log(`📝 Full V12 Prompt successfully saved for inspection to:`);
      console.log(`   ${promptFile}`);
      console.log(`   (Open this file in VS Code to see all pre-computed financials, XBRL lineages, and rules!)`);
      console.log(`=============================================================\n`);
      console.log(`[DRY-RUN] Would call model ${modelArg} now.`);
      continue;
    }

    console.log(`  Generated V12 Prompt Payload (length: ${prompt.length} chars). Calling NIM...`);

    // 4. Call NVIDIA NIM
    let aiResponse;
    try {
      aiResponse = await callNim(ticker, prompt, modelArg);
    } catch (err) {
      console.error(`❌ AI call failed for ${quarter}:`, err.message);
      continue;
    }

    console.log(`  Successfully received AI JSON payload. Size: ${JSON.stringify(aiResponse).length} chars.`);

    // 5. Save strictly to the shadow/comparison database table
    try {
      const validated = aiResponse;
      const dodgedQuestionsJson = JSON.stringify(validated.dodged_questions ?? []);
      const redFlagsJson = JSON.stringify(validated.red_flags ?? []);
      const metricsJson = JSON.stringify(validated.metrics ?? {});
      const rawAiOutputJson = JSON.stringify(validated);

      await pool.query(
        `INSERT INTO quarterly_snapshots_shadow
          (stock_id, quarter, summary, dodged_questions, red_flags, metrics, raw_ai_output,
           thesis_status, thesis_status_reason, thesis_score, valuation_score, conviction_score,
           final_action, position_size, scoring_version,
           decision_blockers, deterioration_quarters, data_quality_score, official_filing_present)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT (stock_id, quarter) DO UPDATE SET
           summary = EXCLUDED.summary,
           dodged_questions = EXCLUDED.dodged_questions,
           red_flags = EXCLUDED.red_flags,
           metrics = EXCLUDED.metrics,
           raw_ai_output = EXCLUDED.raw_ai_output,
           thesis_status = EXCLUDED.thesis_status,
           thesis_status_reason = EXCLUDED.thesis_status_reason,
           thesis_score = EXCLUDED.thesis_score,
           valuation_score = EXCLUDED.valuation_score,
           conviction_score = EXCLUDED.conviction_score,
           final_action = EXCLUDED.final_action,
           position_size = EXCLUDED.position_size,
           scoring_version = EXCLUDED.scoring_version,
           decision_blockers = EXCLUDED.decision_blockers,
           deterioration_quarters = EXCLUDED.deterioration_quarters,
           data_quality_score = EXCLUDED.data_quality_score,
           official_filing_present = EXCLUDED.official_filing_present`,
        [
          stock.id,
          quarter,
          validated.summary ?? null,
          dodgedQuestionsJson,
          redFlagsJson,
          metricsJson,
          rawAiOutputJson,
          validated.thesis_status ?? null,
          validated.thesis_status_reason ?? null,
          validated.thesis_score ?? null,
          validated.valuation_score ?? null,
          validated.conviction_score ?? null,
          validated.action_decision ?? null,
          validated.position_size ?? null,
          'V12',
          validated.decision_blockers?.length ? validated.decision_blockers : [],
          validated.deterioration_quarters ?? 0,
          validated.data_quality_score ?? null,
          validated.official_filing_present ?? null
        ]
      );
      console.log(`  ✅ Successfully committed V12 shadow snapshot to DB for ${quarter}!`);
    } catch (err) {
      console.error(`❌ Failed to save shadow response into database:`, err.message);
    }
  }
  
  console.log(`\n🎉 Historical backfill operations completed for ${ticker}!`);
}

// Run backfill
async function run() {
  try {
    await backfillStock(tickerArg, quarters);
  } catch (err) {
    console.error("Backfill failed:", err);
  } finally {
    await pool.end();
  }
}

run();
