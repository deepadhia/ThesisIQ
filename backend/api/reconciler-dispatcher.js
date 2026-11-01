import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';
import { detectNegativeVariances } from '../workers/negative-variance-detector.js';
import { reconcileCommitments } from '../workers/commitment-reconciler-worker.js';
import { reconcileInterQuarterEvents } from '../workers/interquarter-reconciler.js';

/**
 * Cloudflare Dispatcher Handler for Daily Automated Portfolio Audit & Ingestion
 */
export async function handleCloudflareDispatcher(req, res) {
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized Cloudflare Dispatcher request' });
  }

  const { action, ticker, sebiPayload } = req.body || {};

  try {
    // 1. Daily Scheduled Dispatcher Task across all portfolio stocks
    if (action === 'DAILY_PORTFOLIO_AUDIT') {
      const { rows: stocks } = await pool.query('SELECT ticker FROM stocks ORDER BY ticker');
      const tickers = stocks.map(s => s.ticker);
      
      const auditSummary = {};
      for (const t of tickers) {
        const variances = await detectNegativeVariances(t, false);
        const commitments = await reconcileCommitments(t, false);
        const interQuarter = await reconcileInterQuarterEvents(t, false);

        auditSummary[t] = {
          variancesDetected: variances.detectedVariances?.length || 0,
          commitmentsAudited: commitments?.length || 0,
          interQuarterMatches: interQuarter?.length || 0
        };
      }

      return res.status(200).json({
        success: true,
        message: 'Cloudflare Dispatcher Daily Portfolio Audit Completed Successfully',
        auditSummary
      });
    }

    // 2. Real-time SEBI Reg 30 Webhook / Event Ingestion
    if (action === 'INGEST_SEBI_REG30' && sebiPayload) {
      const { ticker, event_date, event_type, title, value_in_cr, counterparty, description, bse_filing_url } = sebiPayload;

      const { rows: stock } = await pool.query('SELECT id FROM stocks WHERE ticker = $1', [ticker]);
      if (stock.length === 0) {
        return res.status(404).json({ error: `Stock ${ticker} not found in database` });
      }

      const { rows: inserted } = await pool.query(
        `INSERT INTO interquarter_events 
         (stock_id, ticker, event_date, event_type, title, value_in_cr, counterparty, description, bse_filing_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [stock[0].id, ticker, event_date, event_type, title, value_in_cr, counterparty, description, bse_filing_url]
      );

      // Instantly trigger real-time reconciliation for ticker
      const matches = await reconcileInterQuarterEvents(ticker, false);

      return res.status(200).json({
        success: true,
        message: `SEBI Reg 30 Announcement for ${ticker} Ingested & Reconciled`,
        eventId: inserted[0].id,
        reconciliationMatches: matches.length
      });
    }

    return res.status(400).json({ error: 'Invalid dispatcher action or payload' });

  } catch (err) {
    console.error('Cloudflare Dispatcher Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
