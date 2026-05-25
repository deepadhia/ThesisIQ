import fs from 'node:fs';
import path from 'node:path';
import { parseXbrlFile } from '../backend/services/xbrl/index.js';
import { mergeXbrlData } from '../backend/services/xbrl/canonicalMergeEngine.js';

async function verifyGravitaScaling() {
  const ticker = 'GRAVITA';
  // Q2 (H1) file which contains Balance Sheet
  const xmlPath = 'f:/Personal Projects/multibagger-live/data_node/GRAVITA/FY26-Q2/GRAVITA_FY26-Q2_raw_xbrl_30-SEP-2025_INTEGRATED_FILING_INDAS_1562093_30102025080043_WEB.xml';
  const qLabel = 'FY26-Q2';
  
  console.log(`Reading XML: ${xmlPath}`);
  const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  const parseResult = await parseXbrlFile(xmlContent);
  
  if (!parseResult.success) {
    console.error("Failed to parse XBRL:", parseResult.error);
    return;
  }

  const xmlMetrics = parseResult.data.metrics[qLabel];
  const qSegments = parseResult.data.segments?.filter(s => s.quarter === qLabel) || [];

  // Mock API data (GRAVITA reported ~963.28 Cr for Q2 FY26)
  const apiData = {
    revenue_from_ops: 9632800000.00,
    pat: 1000000000.00 // Hypothetical
  };

  console.log("\n--- Extraction Debug ---");
  console.log(`Available metric keys: ${Object.keys(xmlMetrics).join(', ')}`);
  console.log(`Revenue in XML: ${xmlMetrics.revenue}`);
  console.log(`Trade Payables in XML: ${xmlMetrics.trade_payables}`);
  console.log(`Inventory in XML: ${xmlMetrics.inventory}`);
  console.log(`Receivables in XML: ${xmlMetrics.receivables}`);
  
  console.log(`\nSegments found (${qSegments.length}):`);
  qSegments.forEach(s => {
    console.log(`  - ${s.segment_name} (${s.context}): ${s.value}`);
  });

  const { merged } = mergeXbrlData(apiData, {
    metrics: { [qLabel]: xmlMetrics },
    segments: qSegments,
    confidence: 95
  }, []);

  console.log("\n--- After Merging & Scaling ---");
  console.log(`Scaled Revenue: ${merged.revenue_from_ops}`);
  console.log(`Scaled Trade Payables: ${merged.trade_payables}`);
  console.log(`Scaled Segments:`);
  if (merged.segments) {
    merged.segments.forEach(s => {
      console.log(`  - ${s.segment_name}: ${s.value}`);
    });
  }
  
  console.log("\n--- Derived Metrics ---");
  console.log(`Payable Days: ${merged.payable_days}`);
  console.log(`Working Capital Days: ${merged.working_capital_days}`);
}

verifyGravitaScaling();
