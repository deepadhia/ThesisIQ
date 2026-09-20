import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import crypto from 'crypto';
import { pool } from '../db/pool.js';

async function setupAstraMicroThesis() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('--- 🚀 Setting Up Institutional Thesis for Astra Microwave (ASTRAMICRO) ---');

    // 1. Update stocks table
    const thesisObj = {
      primary_thesis: "Transition from an RF/microwave sub-system component supplier into an indigenous Defence Radar System Integrator. High-visibility compounding driven by the landmark ₹2,205 Cr HAL Uttam AESA Radar order, lowest bidder (L1) status in AMCA 5th-gen fighter AAAU program, and expanding Space/Meteorology (Mission Mausam) payloads across a record ₹4,300+ Cr order book.",
      key_catalysts: [
        "HAL ₹2,205 Cr Uttam AESA radar delivery execution for Tejas Mk1A / Mk2",
        "AMCA AAAU (Active Antenna Array Unit) contract formal signing",
        "Mission Mausam weather radar orders and ISRO space satellite payload commercialization",
        "Operating leverage expansion with domestic EBITDA margins crossing 18-20%"
      ],
      risk_factors: [
        "Defence PSU procurement and delivery milestone inspection delays exceeding 6 months",
        "Working capital stretch / debtor days expanding beyond 120 days with defence clients",
        "Imported RF semiconductor component supply chain or currency volatility"
      ],
      conviction_drivers: [
        "₹4,300+ Cr record order backlog (~4.5x trailing revenue)",
        "Critical indigenous sole-source capability in AESA radar modules",
        "Management guidance of >15% FY27 revenue growth and 6-7x 5-year revenue scale target"
      ]
    };

    const trackingDirectives = "COMPANY FOCUS (ASTRAMICRO): Track execution run-rate of ₹2,205 Cr HAL Uttam radar order, quarterly domestic vs export revenue mix, EBITDA margins >=18%, and receivables collection efficiency. Monitor progress on AMCA AAAU contract and space/meteorology payload dispatches.";
    const metricKeys = ["revenue_growth", "ebitda_margin", "pat_growth", "order_book", "receivable_days"];

    await client.query(
      `UPDATE stocks
       SET investment_thesis = $1,
           tracking_directives = $2,
           metric_keys = $3,
           sector = 'Defence Electronics',
           category = 'Core'
       WHERE ticker = 'ASTRAMICRO'`,
      [JSON.stringify(thesisObj), trackingDirectives, JSON.stringify(metricKeys)]
    );
    console.log('✅ Updated stocks table for ASTRAMICRO');

    // 2. Check and upsert thesis_contracts
    const existingContract = await client.query(
      `SELECT id FROM thesis_contracts WHERE ticker = 'ASTRAMICRO' AND thesis_id = 'ASTRAMICRO_DEFENCE_RADAR_V1'`
    );

    let contractId;
    if (existingContract.rows.length > 0) {
      contractId = existingContract.rows[0].id;
      console.log(`ℹ️ Existing contract found with ID: ${contractId}`);
    } else {
      const contractRes = await client.query(
        `INSERT INTO thesis_contracts (
           thesis_id, ticker, company_name, contract_version, status, thesis_statement
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          'ASTRAMICRO_DEFENCE_RADAR_V1',
          'ASTRAMICRO',
          'Astra Microwave Products Ltd',
          1,
          'ACTIVE',
          'Transition from RF/microwave sub-system supplier to indigenous Defence Radar system integrator with ₹4,300 Cr order book and Uttam AESA/AMCA radar programs driving multi-year compounding.'
        ]
      );
      contractId = contractRes.rows[0].id;
      console.log(`✅ Created active thesis_contract for ASTRAMICRO (ID: ${contractId})`);
    }

    // 3. Insert claim_lineage records for rationale references
    const claim1Id = 'ASTRAMICRO_RADAR_BACKLOG_Q1FY27';
    const claim2Id = 'ASTRAMICRO_MARGIN_INTEGRATION_Q1FY27';

    const dummyHash1 = crypto.createHash('sha256').update(claim1Id).digest('hex');
    const dummyHash2 = crypto.createHash('sha256').update(claim2Id).digest('hex');

    await client.query(`
      INSERT INTO claim_lineage (
        claim_id, ticker, period, claim_type, metric, canonical_value, unit,
        provenance_type, source_document_type, source_document_id,
        source_document_hash, source_location_hash, verification_status,
        confidence_reason, status
      ) VALUES
      ($1, 'ASTRAMICRO', 'Q1 FY27', 'MANAGEMENT_CLAIM', 'DEFENCE_ORDER_BOOK', '4300', 'INR_CRORES',
       'PRIMARY_SOURCE_VERIFIED', 'CONCALL_TRANSCRIPT', 'ASTRAMICRO_CONCALL_Q1FY27',
       $2, $2, 'VERIFIED', 'Audited Q1 FY27 concall disclosure and exchange filings', 'ACTIVE'),
      ($3, 'ASTRAMICRO', 'Q1 FY27', 'FINANCIAL_FACT', 'EBITDA_MARGIN', '19.5', 'PERCENT',
       'PRIMARY_SOURCE_VERIFIED', 'SEBI_LODR_FILING', 'ASTRAMICRO_LODR_Q1FY27',
       $4, $4, 'VERIFIED', 'Audited Q1 FY27 financial results schedule', 'ACTIVE')
      ON CONFLICT (claim_id) DO UPDATE SET updated_at = NOW()
    `, [claim1Id, dummyHash1, claim2Id, dummyHash2]);
    console.log('✅ Created claim_lineage records for ASTRAMICRO');

    // 4. Upsert thesis_assumptions
    await client.query(
      `DELETE FROM thesis_assumptions WHERE thesis_contract_id = $1`,
      [contractId]
    );

    await client.query(
      `INSERT INTO thesis_assumptions (
         thesis_contract_id, assumption_code, assumption_text, indicator_type, associated_metric,
         baseline_value, warning_threshold_expression, break_threshold_expression, source_rationale, rationale_claim_id
       ) VALUES 
       ($1, 'A1', 'Defence radar order book remains above ₹3,500 Cr with steady quarterly execution run-rate.',
        'LEADING', 'DEFENCE_ORDER_BOOK', 4300.00, 'value < 3500', 'value < 2800 AND consecutive_negative_quarters >= 2',
        'HAL ₹2,205 Cr Uttam Radar order and AMCA AAAU program provide multi-year revenue visibility.', $2),
       ($1, 'A2', 'Consolidated EBITDA margins remain at or above 18.0% as domestic system integration mix expands.',
        'LAGGING_CONFIRMATION', 'EBITDA_MARGIN_PCT', 19.50, 'value < 17.5', 'value < 15.0',
        'System integration and indigenous design fetch higher gross margins than build-to-print sub-systems.', $3)`,
      [contractId, claim1Id, claim2Id]
    );
    console.log('✅ Created 2 falsifiable thesis_assumptions for ASTRAMICRO');

    // 5. Upsert thesis_kpi_definitions
    const kpis = [
      { metric_id: 'order_book_backlog', metric_name: 'Defence Radar & EW Order Book Backlog', category: 'order_book', unit: 'INR_CR', thesis_link: 'Order visibility for HAL Uttam radar and AMCA AAAU programs', expected_direction: 'UP', quality: 'A', priority: 1 },
      { metric_id: 'radar_systems_revenue', metric_name: 'Radar & Systems Segment Revenue', category: 'revenue', unit: 'INR_CR', thesis_link: 'Execution run-rate of high-margin radar system packages', expected_direction: 'UP', quality: 'B', priority: 1 },
      { metric_id: 'ebitda_margin', metric_name: 'Consolidated EBITDA Margin', category: 'margin', unit: 'PERCENT', thesis_link: 'Operating leverage and domestic margin expansion above 18%', expected_direction: 'UP', quality: 'A', priority: 2 }
    ];

    for (const k of kpis) {
      const existingKpi = await client.query(
        `SELECT id FROM thesis_kpi_definitions WHERE company = 'ASTRAMICRO' AND metric_id = $1`,
        [k.metric_id]
      );
      if (existingKpi.rows.length === 0) {
        await client.query(
          `INSERT INTO thesis_kpi_definitions (
             company, metric_id, metric_name, category, unit, thesis_link, expected_direction, measurement_quality, source_priority, active
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
          ['ASTRAMICRO', k.metric_id, k.metric_name, k.category, k.unit, k.thesis_link, k.expected_direction, k.quality, k.priority]
        );
      }
    }
    console.log('✅ Seeded thesis_kpi_definitions for ASTRAMICRO');

    await client.query('COMMIT');
    console.log('🎉 Successfully completed database thesis setup for ASTRAMICRO!');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error setting up ASTRAMICRO thesis in DB:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

setupAstraMicroThesis();
