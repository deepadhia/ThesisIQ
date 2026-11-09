/**
 * xbrl.service.js — Sprint 3 (Hybrid Engine V2 + V3)
 *
 * Fetches official quarterly financial results from NSE's structured API (V2),
 * and enriches them with deep data from raw XBRL XML filings (V3) if available locally.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pool } from "../db/pool.js";
import { parseXbrlFile } from './xbrl/index.js';
import { mergeXbrlData } from "./xbrl/canonicalMergeEngine.js";
import { uploadSingleFiling, isDriveConfigured } from "./drive.service.js";
import { saveAnnouncement, generateAnnouncementHash } from "./announcement.service.js";
import { formatFinancial } from '../utils/financialFormatter.js';

const NSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/",
  "Connection": "keep-alive",
};

const DATA_DIR = path.resolve(process.cwd(), 'data_node');

/** Parse a numeric string from NSE API — returns null if missing/zero-string */
function parseNum(val) {
  if (val === null || val === undefined || val === "" || val === "0") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/** Parse a non-zero numeric (treats 0 as null for ratio fields) */
function parseNonZero(val) {
  const n = parseNum(val);
  return n === 0 ? null : n;
}

function parseNseDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

function periodEndToQuarter(periodEndDate) {
  if (!periodEndDate) return null;
  const d = new Date(periodEndDate);
  const month = d.getMonth() + 1;
  const year = d.getFullYear();

  let q, fyYear;
  if (month >= 4 && month <= 6) { q = 1; fyYear = year + 1; }
  else if (month >= 7 && month <= 9) { q = 2; fyYear = year + 1; }
  else if (month >= 10 && month <= 12) { q = 3; fyYear = year + 1; }
  else { q = 4; fyYear = year; }

  return `FY${String(fyYear).slice(-2)}-Q${q}`;
}

function normalizeNseRow(row) {
  const periodEnd = parseNseDate(row.re_to_dt);
  const periodStart = parseNseDate(row.re_from_dt);
  const quarter = periodEndToQuarter(periodEnd);

  const revenueFromOps = parseNum(row.re_net_sale) * 100000;
  const otherIncome = parseNum(row.re_oth_inc_new) * 100000;
  const totalIncome = (parseNum(row.re_total_inc) * 100000) || (revenueFromOps + otherIncome);
  
  let patRaw = parseNum(row.re_con_pro_loss) || parseNum(row.re_net_profit) || parseNum(row.re_proloss_ord_act);
  let pat = patRaw ? patRaw * 100000 : null;

  const pbt = parseNum(row.re_pro_loss_bef_tax) * 100000;
  const finCost = parseNum(row.re_int_new) * 100000;
  const depn = parseNum(row.re_depr_und_exp) * 100000;
  const tax = (parseNum(row.re_tax) || parseNum(row.re_curr_tax)) * 100000;
  const exceptionalRaw = parseNonZero(row.re_excepn_items_new) || parseNonZero(row.re_excepn_items) || parseNonZero(row.re_extraord_items);
  const exceptional = exceptionalRaw ? exceptionalRaw * 100000 : null;
  const epsBasic = parseNonZero(row.re_basic_eps_for_cont_dic_opr) ?? parseNonZero(row.re_basic_eps);
  const epsDiluted = parseNonZero(row.re_dilut_eps_for_cont_dic_opr) ?? parseNonZero(row.re_diluted_eps);
  const staffCost = parseNum(row.re_staff_cost) * 100000;
  const rawMat = parseNum(row.re_rawmat_consump) * 100000;
  const otherExp = parseNum(row.re_oth_exp) * 100000;
  const paidUpCap = parseNonZero(row.re_pdup) * 100000;
  const debtEqRatio = parseNonZero(row.re_debt_eqt_rat);

  let totalExpenses = parseNum(row.re_oth_tot_exp) * 100000;
  let confidence = "high";
  const notes = [];

  if (totalIncome != null && pbt != null && totalExpenses != null) {
    const impliedExpenses = totalIncome - pbt;
    const diffPct = Math.abs((totalExpenses - impliedExpenses) / impliedExpenses);
    if (diffPct > 0.05) {
      notes.push(`Validation Warning: total_expenses deviates from Income - PBT.`);
      confidence = "medium";
    }
  }

  let ebitda = null;
  if (pbt != null && finCost != null && depn != null) {
    ebitda = pbt + finCost + depn;
    if (exceptional != null) ebitda -= exceptional;
  }

  const ebitdaMargin = (ebitda != null && revenueFromOps != null && revenueFromOps > 0)
    ? Math.round((ebitda / revenueFromOps) * 10000) / 100
    : null;

  const patMargin = (pat != null && revenueFromOps != null && revenueFromOps > 0)
    ? Math.round((pat / revenueFromOps) * 10000) / 100
    : null;

  const fyYear = periodEnd ? (() => {
    const month = new Date(periodEnd).getMonth() + 1;
    const year = new Date(periodEnd).getFullYear();
    return month >= 4 ? year + 1 : year;
  })() : null;

  return {
    quarter,
    fy_year: fyYear,
    period_end_date: periodEnd,
    period_start_date: periodStart,
    revenue_from_ops: revenueFromOps,
    other_income: otherIncome,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    staff_cost: staffCost,
    raw_material_cost: rawMat,
    other_expenses: otherExp,
    ebitda,
    ebitda_margin_pct: ebitdaMargin,
    finance_cost: finCost,
    depreciation: depn,
    exceptional_items: exceptional,
    pbt,
    tax_expense: tax,
    pat,
    pat_margin_pct: patMargin,
    eps_basic: epsBasic,
    eps_diluted: epsDiluted,
    paid_up_capital: paidUpCap,
    debt_equity_ratio: debtEqRatio,
    confidence,
    notes: notes.join(" | ") || null,
  };
}

export async function fetchNseFinancialResults(nseSymbol) {
  const url = `https://www.nseindia.com/api/results-comparision?index=equities&symbol=${encodeURIComponent(nseSymbol)}`;
  const resp = await fetch(url, { headers: NSE_HEADERS });
  if (!resp.ok) throw new Error(`NSE API returned ${resp.status}`);
  const text = await resp.text();
  if (text.trim().startsWith("<")) throw new Error(`NSE API returned HTML`);
  const data = JSON.parse(text);
  const rows = data.resCmpData || [];
  return {
    rawRows: rows,
    normalized: rows.map(normalizeNseRow).filter(r => r.quarter != null),
  };
}

function enrichWithYoYGrowth(quarters) {
  for (let i = 0; i < quarters.length; i++) {
    const current = quarters[i];
    const currentFy = parseInt(current.quarter.match(/FY(\d+)/)?.[1] ?? "0");
    const currentQ = current.quarter.match(/Q(\d)/)?.[1];
    const priorLabel = `FY${String(currentFy - 1).padStart(2, "0")}-Q${currentQ}`;
    const prior = quarters.find(q => q.quarter === priorLabel);
    if (prior) {
      if (current.revenue_from_ops != null && prior.revenue_from_ops != null && prior.revenue_from_ops !== 0) {
        current.revenue_growth_yoy = Math.round(((current.revenue_from_ops - prior.revenue_from_ops) / prior.revenue_from_ops) * 10000) / 100;
      }
      if (current.pat != null && prior.pat != null && prior.pat !== 0) {
        current.pat_growth_yoy = Math.round(((current.pat - prior.pat) / prior.pat) * 10000) / 100;
      }
    }
  }
}

/**
 * Finds local XBRL XML file for a given ticker and quarter.
 */
function findLocalXbrlFile(ticker, quarter) {
  const symbolDir = path.join(DATA_DIR, ticker);
  if (!fs.existsSync(symbolDir)) return null;

  const quarterDir = path.join(symbolDir, quarter);
  if (!fs.existsSync(quarterDir)) return null;

  const files = fs.readdirSync(quarterDir);
  const xbrlFile = files.find(f => f.toLowerCase().endsWith('.xml'));
  return xbrlFile ? path.join(quarterDir, xbrlFile) : null;
}

export async function fetchAndStoreXbrlMetrics({ stock_id, ticker, bse_scrip_code }) {
  let nseSymbol = ticker.toUpperCase();
  if (nseSymbol === "HBLENGINE") nseSymbol = "HBLPOWER";

  let rawRows, normalized;
  try {
    ({ rawRows, normalized } = await fetchNseFinancialResults(nseSymbol));
  } catch (err) {
    return { ok: false, quarters: 0, error: err.message };
  }

  if (normalized.length === 0) {
    return { ok: false, quarters: 0, error: "No quarterly data returned" };
  }

  // DUAL ENGINE MERGE (V2 + V3)
  const quarterMap = new Map();
  normalized.forEach(r => quarterMap.set(r.quarter, r));

  // Fetch history for fallback and confidence context
  const { rows: history } = await pool.query(
    "SELECT * FROM xbrl_metrics_quarterly WHERE stock_id = $1 ORDER BY period_end_date DESC NULLS LAST LIMIT 4",
    [stock_id]
  );

  const symbolDir = path.join(DATA_DIR, ticker);
  if (fs.existsSync(symbolDir)) {
    const localQDirs = fs.readdirSync(symbolDir).filter(d => d.startsWith('FY'));
    for (const qDir of localQDirs) {
      const xmlPath = findLocalXbrlFile(ticker, qDir);
      if (!xmlPath) continue;

      const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
      const parseResult = await parseXbrlFile(xmlContent);
      if (!parseResult.success || !parseResult.data.metrics) continue;

      const { metrics: xmlResults, quarterDates } = parseResult.data;
      for (const [qLabel, xmlMetrics] of Object.entries(xmlResults)) {
        let row = quarterMap.get(qLabel);
        if (!row) {
          const xmlDate = quarterDates[qLabel];
          row = {
            quarter: qLabel,
            period_end_date: xmlDate || null,
            confidence: 'xml_only',
            notes: 'XML extraction only, no matching NSE API record found.',
            source_preferred: 'xml',
            metric_sources: {}
          };
          
          // Auto-calculate fy_year for XML-only rows
          if (xmlDate) {
            const d = new Date(xmlDate);
            const month = d.getMonth() + 1;
            const year = d.getFullYear();
            row.fy_year = (month >= 4) ? year + 1 : year;
          }

          quarterMap.set(qLabel, row);
        }

        // Merge this specific quarter's XML data into the row
        const { merged, reconciliationLogs } = mergeXbrlData(row, { 
          metrics: { [qLabel]: xmlMetrics }, 
          segments: parseResult.data.segments?.filter(s => s.quarter === qLabel) || [],
          confidence: 95 
        }, history);
        
        Object.assign(row, merged);
        row.reconciliationLogs = (row.reconciliationLogs || []).concat(reconciliationLogs);

        // Segments are now merged and scaled inside mergeXbrlData

        // DRIVE & ANNOUNCEMENT INTEGRATION
        if (qLabel === qDir) {
          try {
            const filename = path.basename(xmlPath);
            const driveResult = await uploadSingleFiling({
              symbol: ticker,
              quarter: qLabel,
              localPath: xmlPath,
              filename
            });
            if (driveResult) {
              row.gdrive_id = driveResult.id;
              row.gdrive_url = driveResult.webViewLink;

              // Also insert into filing_drive_links so it shows up in Section 2 (Official Filings)
              await pool.query(
                `INSERT INTO filing_drive_links (symbol, quarter, filename, drive_file_id, drive_web_link)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (symbol, quarter, filename) DO UPDATE
                   SET drive_file_id = EXCLUDED.drive_file_id, drive_web_link = EXCLUDED.drive_web_link, uploaded_at = now()`,
                [ticker, qLabel, filename, row.gdrive_id, row.gdrive_url]
              );
            }

            // Also save to corporate_announcements so it shows up in the new tab
            const title = `XBRL Financial Results - ${qLabel}`;
            const sourceId = `XBRL_${ticker}_${qLabel}`;
            const titleHash = generateAnnouncementHash(ticker, title, row.period_end_date, sourceId);

            await saveAnnouncement({
              stock_id,
              ticker,
              source_id: sourceId,
              title_hash: titleHash,
              title,
              raw_text: `Deep XBRL extraction for ${ticker} ${qLabel}`,
              priority: "HIGH",
              impact: "NEUTRAL",
              confidence: "HIGH",
              summary: `Integrated Filing (XBRL) enriched with BS/CF metrics.`,
              status: "processed",
              sent_to_telegram: false, // Don't spam telegram for every V3 sync
              is_earnings_release: true,
              attachment_url: row.gdrive_url || null,
              filing_date: row.period_end_date
            });
          } catch (driveErr) {
            console.warn(`[V3 Drive/Ann] Failed for ${ticker} ${qLabel}:`, driveErr.message);
          }
        }
      }
    }
  }

  const finalNormalized = Array.from(quarterMap.values());
  enrichWithYoYGrowth(finalNormalized);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const stored = [];
    for (const m of finalNormalized) {
      // 1. Upsert into xbrl_filings
      const filingRes = await client.query(
        `INSERT INTO xbrl_filings (stock_id, ticker, nse_symbol, quarter, period_end_date, source, status, gdrive_id, gdrive_url)
         VALUES ($1, $2, $3, $4, $5, 'xml_v3', 'parsed', $6, $7)
         ON CONFLICT (stock_id, quarter, source) DO UPDATE
           SET status = 'parsed', updated_at = now(),
               gdrive_id = EXCLUDED.gdrive_id, gdrive_url = EXCLUDED.gdrive_url
         RETURNING id`,
        [stock_id, ticker, nseSymbol, m.quarter, m.period_end_date, m.gdrive_id || null, m.gdrive_url || null]
      );
      const currentFilingId = filingRes.rows[0]?.id;

      // 2. Upsert into xbrl_metrics_quarterly
      await client.query(
        `INSERT INTO xbrl_metrics_quarterly (
            stock_id, ticker, quarter, fy_year, period_end_date, period_start_date,
            revenue_from_ops, pbt, pat, finance_cost, depreciation,
            receivables, inventory, trade_payables, borrowings, cash_and_bank, cfo, capex, equity,
            receivable_days, inventory_days, payable_days, working_capital_days, net_cash, cfo_pat_ratio,
            ebitda, ebitda_margin_pct, pat_margin_pct,
            revenue_growth_yoy, pat_growth_yoy,
            source_preferred, xml_confidence_score, reconciliation_logs, segments,
            gdrive_url, metric_sources, metric_metadata, reliability_score
        )
        VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23, $24, $25,
            $26, $27, $28,
            $29, $30,
            $31, $32, $33, $34,
            $35, $36, $37, $38
        )
        ON CONFLICT (stock_id, quarter) DO UPDATE
        SET
            period_end_date = EXCLUDED.period_end_date,
            revenue_from_ops = EXCLUDED.revenue_from_ops,
            pbt = EXCLUDED.pbt,
            pat = EXCLUDED.pat,
            finance_cost = EXCLUDED.finance_cost,
            receivables = EXCLUDED.receivables,
            inventory = EXCLUDED.inventory,
            trade_payables = EXCLUDED.trade_payables,
            borrowings = EXCLUDED.borrowings,
            cash_and_bank = EXCLUDED.cash_and_bank,
            cfo = EXCLUDED.cfo,
            capex = EXCLUDED.capex,
            receivable_days = EXCLUDED.receivable_days,
            inventory_days = EXCLUDED.inventory_days,
            payable_days = EXCLUDED.payable_days,
            working_capital_days = EXCLUDED.working_capital_days,
            net_cash = EXCLUDED.net_cash,
            cfo_pat_ratio = EXCLUDED.cfo_pat_ratio,
            ebitda = EXCLUDED.ebitda,
            ebitda_margin_pct = EXCLUDED.ebitda_margin_pct,
            metric_sources = EXCLUDED.metric_sources,
            metric_metadata = EXCLUDED.metric_metadata,
            reliability_score = EXCLUDED.reliability_score,
            revenue_growth_yoy = EXCLUDED.revenue_growth_yoy,
            pat_growth_yoy = EXCLUDED.pat_growth_yoy,
            source_preferred = EXCLUDED.source_preferred,
            xml_confidence_score = EXCLUDED.xml_confidence_score,
            reconciliation_logs = EXCLUDED.reconciliation_logs,
            segments = EXCLUDED.segments,
            gdrive_url = EXCLUDED.gdrive_url,
            updated_at = now()`,
        [
          stock_id, ticker, m.quarter, m.fy_year, m.period_end_date, m.period_start_date,
          m.revenue_from_ops, m.pbt, m.pat, m.finance_cost, m.depreciation,
          m.receivables, m.inventory, m.trade_payables, m.borrowings, m.cash_and_bank, m.cfo, m.capex, m.equity,
          m.receivable_days, m.inventory_days, m.payable_days, m.working_capital_days, m.net_cash, m.cfo_pat_ratio,
          m.ebitda, m.ebitda_margin_pct, m.pat_margin_pct,
          m.revenue_growth_yoy, m.pat_growth_yoy,
          m.source_preferred, m.xml_confidence_score, JSON.stringify(m.reconciliationLogs || []), JSON.stringify(m.segments || []),
          m.gdrive_url, JSON.stringify(m.metric_sources || {}), JSON.stringify(m.metric_metadata || {}), m.reliability_score || 0
        ]
      );

      // 3. Optional: Insert into separate tables if needed (Legacy Support)
      if (m.reconciliationLogs && m.reconciliationLogs.length > 0) {
        for (const log of m.reconciliationLogs) {
          await client.query(
            `INSERT INTO xbrl_reconciliation_logs 
               (stock_id, ticker, quarter, field_name, api_val, xml_val, variance_pct, winner_source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [stock_id, ticker, m.quarter, log.field_name, log.api_val, log.xml_val, log.variance_pct, log.winner_source]
          );
        }
      }

      if (m.segments) {
        for (const s of m.segments) {
          const revVal = s.metric === 'revenue' ? s.value : null;
          const profitVal = s.metric === 'profit' ? s.value : null;
          
          await client.query(
            `INSERT INTO xbrl_segments (stock_id, ticker, quarter, segment_name, revenue, profit_loss, xbrl_filing_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (stock_id, quarter, segment_name) DO UPDATE SET
               revenue = COALESCE(EXCLUDED.revenue, xbrl_segments.revenue),
               profit_loss = COALESCE(EXCLUDED.profit_loss, xbrl_segments.profit_loss)`,
            [stock_id, ticker, m.quarter, s.segment_name, revVal, profitVal, currentFilingId]
          );
        }
      }
      stored.push(m.quarter);
    }

    await client.query("COMMIT");
    return { ok: true, quarters: stored.length, stored };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getXbrlMetricsForPrompt(stockId, limitToQuarter = null) {
  let sql = `SELECT * FROM xbrl_metrics_quarterly WHERE stock_id = $1 ORDER BY period_end_date DESC NULLS LAST LIMIT 8`;
  const { rows } = await pool.query(sql, [stockId]);
  if (!limitToQuarter || rows.length === 0) return rows.slice(0, 5);
  const targetIdx = rows.findIndex(r => r.quarter === limitToQuarter);
  if (targetIdx === -1) return rows.slice(0, 5);
  return rows.slice(targetIdx).slice(0, 5);
}

export function formatXbrlQuarterForPrompt(row) {
  const cr = (v) => v != null ? `₹${(v / 10000000).toFixed(2)} Cr` : "N/A";
  const pct = (v) => v != null ? `${v}%` : "N/A";
  const yoy = (v) => v != null ? ` (YoY: ${v > 0 ? "+" : ""}${v}%)` : "";
  const src = (field) => {
    const s = row.metric_sources?.[field];
    if (s === 'xbrl') return "";
    if (s === 'calculated') return " [CALCULATED]";
    if (s === 'api') return " [API SUMMARY]";
    return s ? ` [${s.toUpperCase()}]` : "";
  };

  const lines = [
    `Quarter: ${row.quarter} | Period: ${row.period_start_date || "?"} - ${row.period_end_date || "?"} | Source: ${row.source_preferred}`,
    `Revenue: ${cr(row.revenue_from_ops)}${yoy(row.revenue_growth_yoy)}${src('revenue_from_ops')}`,
    `PAT: ${cr(row.pat)}${yoy(row.pat_growth_yoy)}${src('pat')}`,
  ];

  if (row.ebitda != null) lines.push(`EBITDA: ${cr(row.ebitda)} | Margin: ${pct(row.ebitda_margin_pct)}${src('ebitda')}`);
  
  // BS Enrichment
  if (row.receivables != null || row.inventory != null || row.trade_payables != null) {
    const payStr = row.trade_payables != null ? ` | Payables: ${cr(row.trade_payables)}${src('trade_payables')}` : "";
    lines.push(`Balance Sheet: Receivables: ${cr(row.receivables)}${src('receivables')} | Inventory: ${cr(row.inventory)}${src('inventory')}${payStr} | Borrowings: ${cr(row.borrowings)}${src('borrowings')}`);
    
    // Net Working Capital Analysis
    const wcDays = Number(row.working_capital_days || 0);
    let wcStatus = "Normal";
    if (wcDays < 30) wcStatus = "Extremely Efficient (Negative/Low WC)";
    else if (wcDays < 60) wcStatus = "Healthy";
    else if (wcDays > 120) wcStatus = "Heavy (Cash Trap)";
    else if (wcDays > 180) wcStatus = "CRITICAL (Severely Stretched)";

    const nwc = row.net_working_capital ?? (row.receivables + row.inventory - (row.trade_payables || 0));
    
    lines.push(`Working Capital: Cycle: ${wcDays.toFixed(0)} days | Status: ${wcStatus} | Net Working Capital: ${cr(nwc)}`);
    lines.push(`Derived Metrics: Rec. Days: ${Number(row.receivable_days || 0).toFixed(0)} | Inv. Days: ${Number(row.inventory_days || 0).toFixed(0)} | Pay. Days: ${Number(row.payable_days || 0).toFixed(0)} | Net Cash: ${cr(row.net_cash)}`);
  }

  // CF Enrichment
  if (row.cfo != null) {
    lines.push(`Cash Flow: CFO: ${cr(row.cfo)}${src('cfo')} | Capex: ${cr(row.capex)}${src('capex')} | CFO/PAT: ${Number(row.cfo_pat_ratio || 0).toFixed(2)}`);
  }
  
  if (row.finance_cost != null) lines.push(`Finance Cost: ${cr(row.finance_cost)}${src('finance_cost')}`);
  
  return lines.join("\n");
}
