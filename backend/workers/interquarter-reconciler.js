import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';

/**
 * Reconciles intermediate SEBI Reg 30 filings and AGM disclosures against management commitments.
 * @param {string} ticker 
 * @param {boolean} dryRun 
 */
export async function reconcileInterQuarterEvents(ticker, dryRun = true) {
  console.log(`\n═══════════════════════════════════════════════════════════════════════════`);
  console.log(`⚡ SEBI REG 30 INTER-QUARTER RECONCILER FOR ${ticker} (${dryRun ? 'DRY-RUN MODE' : 'LIVE DB UPDATE'})`);
  console.log(`═══════════════════════════════════════════════════════════════════════════\n`);

  const { rows: stockRows } = await pool.query(
    "SELECT id, company_name, ticker FROM stocks WHERE ticker = $1",
    [ticker]
  );
  if (stockRows.length === 0) return [];
  const stock = stockRows[0];

  // 1. Fetch inter-quarter events for ticker
  const { rows: events } = await pool.query(
    `SELECT * FROM interquarter_events WHERE stock_id = $1 ORDER BY event_date DESC`,
    [stock.id]
  );

  // 2. Fetch active commitments
  const { rows: comms } = await pool.query(
    `SELECT id, commitment_title, statement, metric, target_value, status FROM management_commitments WHERE ticker = $1`,
    [ticker]
  );

  const matchedReconciliations = [];

  for (const ev of events) {
    for (const c of comms) {
      const combinedText = `${c.commitment_title || ''} ${c.statement || ''} ${c.metric || ''}`.toLowerCase();
      const evText = `${ev.title} ${ev.description} ${ev.counterparty || ''}`.toLowerCase();

      let isMatch = false;
      let matchReason = '';

      // Match Order Wins (e.g. Order Wins, Contracts, Purchase Orders)
      if (ev.event_type === 'ORDER_WIN' && (combinedText.includes('order') || combinedText.includes('contract') || combinedText.includes('po') || combinedText.includes('work'))) {
        if (ev.value_in_cr && ev.value_in_cr > 0) {
          isMatch = true;
          matchReason = `Matched SEBI Reg 30 Order Win: ₹${ev.value_in_cr} Cr from ${ev.counterparty || 'Exchange Disclosure'}`;
        }
      }

      // Match AGM Chairman Speeches & Annual Disclosures
      if (ev.event_type === 'AGM_DISCLOSURE' && (combinedText.includes('capex') || combinedText.includes('guidance') || combinedText.includes('expansion') || combinedText.includes('target'))) {
        isMatch = true;
        matchReason = `Matched Annual AGM Disclosure: ${ev.title} (${ev.event_date})`;
      }

      // Match Post-Results Concall Transcripts
      if (ev.event_type === 'CONCALL_TRANSCRIPT' && (combinedText.includes('guidance') || combinedText.includes('margin') || combinedText.includes('revenue'))) {
        isMatch = true;
        matchReason = `Matched Post-Earnings Concall Management Guidance: ${ev.title}`;
      }

      // Match Maritime / Electric JV Agreements (e.g. HBL Cochin Shipyard JV)
      if (ev.event_type === 'JV_AGREEMENT' && (combinedText.includes('jv') || combinedText.includes('shipyard') || combinedText.includes('joint venture'))) {
        isMatch = true;
        matchReason = `Matched SEBI Reg 30 Joint Venture Disclosure: ${ev.title}`;
      }

      if (isMatch) {
        matchedReconciliations.push({
          commitmentId: c.id,
          commitmentTitle: c.commitment_title || c.metric,
          eventId: ev.id,
          eventType: ev.event_type,
          eventTitle: ev.title,
          eventValueCr: ev.value_in_cr || 'N/A',
          matchReason,
          filingUrl: ev.bse_filing_url || '[BSE_LODR_REG30_DISCLOSURE]'
        });

        // Update DB in LIVE mode
        if (!dryRun) {
          const isFulfillmentEvent = (ev.event_type === 'ORDER_WIN' || ev.event_type === 'JV_AGREEMENT');
          const statusToSet = isFulfillmentEvent ? 'Achieved' : c.status;
          await pool.query(
            `UPDATE management_commitments 
             SET status = $1, 
                 evidence_summary = $2, 
                 guidance_source_ref = $3 
             WHERE id = $4`,
            [
              statusToSet,
              `SEBI Reg 30 Verified: ${matchReason}`,
              ev.bse_filing_url || `[SEBI_REG30:${ev.event_type}_${ev.event_date}]`,
              c.id
            ]
          );
        }
      }
    }
  }

  console.log(`📊 INTER-QUARTER RECONCILIATION MATCHES FOUND (${matchedReconciliations.length}):`);
  if (matchedReconciliations.length > 0) {
    console.table(matchedReconciliations);
  } else {
    console.log(`  No intermediate SEBI Reg 30 events pending reconciliation for ${ticker}.`);
  }

  return matchedReconciliations;
}

// Command Line Test Execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ticker = args[0] || 'SKIPPER';
  const liveMode = args.includes('--live');

  reconcileInterQuarterEvents(ticker, !liveMode)
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
