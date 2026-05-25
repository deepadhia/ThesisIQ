import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../backend/db/pool.js';
import { parseXbrlFile } from '../backend/services/xbrl/index.js';
import { mergeXbrlData } from '../backend/services/xbrl/canonicalMergeEngine.js';

// Setup paths
const DATA_DIR = path.resolve('data_node');
const ticker = 'QPOWER';

function findLocalXbrlFile(ticker, quarter) {
  const symbolDir = path.join(DATA_DIR, ticker);
  if (!fs.existsSync(symbolDir)) return null;
  const quarterDir = path.join(symbolDir, quarter);
  if (!fs.existsSync(quarterDir)) return null;
  const files = fs.readdirSync(quarterDir);
  const xbrlFile = files.find(f => f.toLowerCase().endsWith('.xml'));
  return xbrlFile ? path.join(quarterDir, xbrlFile) : null;
}

async function fixQpower() {
  console.log("Starting offline re-merge for QPOWER...");
  const client = await pool.connect();
  try {
    // 1. Get stock details
    const stockRes = await client.query("SELECT id FROM stocks WHERE UPPER(ticker) = 'QPOWER'");
    if (!stockRes.rows[0]) {
      console.error("QPOWER stock not found");
      return;
    }
    const stock_id = stockRes.rows[0].id;

    // 2. Load all existing quarterly metrics for QPOWER
    const metricsRes = await client.query(
      "SELECT * FROM xbrl_metrics_quarterly WHERE stock_id = $1",
      [stock_id]
    );
    const existingRows = metricsRes.rows;
    console.log(`Found ${existingRows.length} existing quarters in database.`);

    // 3. Clear out all old fallback values so we start fresh!
    console.log("Resetting all old fallback fields to clean slate...");
    await client.query(
      `UPDATE xbrl_metrics_quarterly
       SET cash_and_bank = CASE WHEN metric_metadata->'cash_and_bank'->>'source' = 'fallback' THEN NULL ELSE cash_and_bank END,
           borrowings = CASE WHEN metric_metadata->'borrowings'->>'source' = 'fallback' THEN NULL ELSE borrowings END,
           receivables = CASE WHEN metric_metadata->'receivables'->>'source' = 'fallback' THEN NULL ELSE receivables END,
           inventory = CASE WHEN metric_metadata->'inventory'->>'source' = 'fallback' THEN NULL ELSE inventory END,
           trade_payables = CASE WHEN metric_metadata->'trade_payables'->>'source' = 'fallback' THEN NULL ELSE trade_payables END,
           cfo = CASE WHEN metric_metadata->'cfo'->>'source' = 'fallback' THEN NULL ELSE cfo END,
           capex = CASE WHEN metric_metadata->'capex'->>'source' = 'fallback' THEN NULL ELSE capex END,
           equity = CASE WHEN metric_metadata->'equity'->>'source' = 'fallback' THEN NULL ELSE equity END
       WHERE stock_id = $1`,
      [stock_id]
    );

    // Reload the cleaned rows to use as base quarterMap
    const cleanMetricsRes = await client.query(
      "SELECT * FROM xbrl_metrics_quarterly WHERE stock_id = $1",
      [stock_id]
    );
    const quarterMap = new Map();
    cleanMetricsRes.rows.forEach(r => quarterMap.set(r.quarter, r));

    // 4. Process each local quarter XML folder chronologically (ascending)
    const symbolDir = path.join(DATA_DIR, ticker);
    if (!fs.existsSync(symbolDir)) {
      console.error("Local data directory not found for QPOWER");
      return;
    }

    const localQDirs = fs.readdirSync(symbolDir)
      .filter(d => d.startsWith('FY'))
      .sort(); // Sort to process chronologically older first!

    console.log(`Found ${localQDirs.length} local quarter folders:`, localQDirs);

    for (const qDir of localQDirs) {
      const xmlPath = findLocalXbrlFile(ticker, qDir);
      if (!xmlPath) continue;

      console.log(`Processing local XML filing for ${qDir}...`);
      const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
      const parseResult = await parseXbrlFile(xmlContent);
      if (!parseResult.success || !parseResult.data.metrics) {
        console.warn(`Failed to parse XML for ${qDir}`);
        continue;
      }

      const { metrics: xmlResults } = parseResult.data;

      for (const [qLabel, xmlMetrics] of Object.entries(xmlResults)) {
        // Load current state of the DB to use as history context (most recent first)
        const { rows: history } = await client.query(
          "SELECT * FROM xbrl_metrics_quarterly WHERE stock_id = $1 ORDER BY period_end_date DESC NULLS LAST",
          [stock_id]
        );

        let row = quarterMap.get(qLabel);
        if (!row) {
          // If no row exists, create a basic placeholder
          row = {
            quarter: qLabel,
            confidence: 'xml_only',
            metric_sources: {},
            metric_metadata: {}
          };
        }

        // Run the fixed mergeXbrlData engine!
        const { merged } = mergeXbrlData(row, {
          metrics: { [qLabel]: xmlMetrics },
          segments: parseResult.data.segments?.filter(s => s.quarter === qLabel) || [],
          confidence: 95
        }, history);

        Object.assign(row, merged);

        // Save back to the database!
        await client.query(
          `UPDATE xbrl_metrics_quarterly
           SET cash_and_bank = $1, borrowings = $2, receivables = $3, inventory = $4,
               trade_payables = $5, cfo = $6, capex = $7, equity = $8,
               receivable_days = $9, inventory_days = $10, payable_days = $11,
               working_capital_days = $12, net_cash = $13, cfo_pat_ratio = $14,
               metric_metadata = $15, reliability_score = $16, source_preferred = $17,
               updated_at = now()
           WHERE stock_id = $18 AND quarter = $19`,
          [
            row.cash_and_bank, row.borrowings, row.receivables, row.inventory,
            row.trade_payables, row.cfo, row.capex, row.equity,
            row.receivable_days, row.inventory_days, row.payable_days,
            row.working_capital_days, row.net_cash, row.cfo_pat_ratio,
            JSON.stringify(row.metric_metadata || {}), row.reliability_score || 0, row.source_preferred || 'xbrl',
            stock_id, qLabel
          ]
        );
        console.log(`  Updated ${qLabel}: Net Cash = ${row.net_cash != null ? (row.net_cash / 10000000).toFixed(2) + ' Cr' : 'null'}`);
        
        // Update local map so subsequent loop iterations see the newly saved row!
        quarterMap.set(qLabel, row);
      }
    }

    console.log("All quarters successfully re-merged and saved!");
  } catch (err) {
    console.error("Offline fix failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

fixQpower();
