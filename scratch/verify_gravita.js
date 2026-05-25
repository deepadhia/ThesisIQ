import pkg from 'pg';
import { DATABASE_URL } from '../backend/config/env.js';

const { Pool } = pkg;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verify() {
  try {
    const stockRes = await pool.query("SELECT id, ticker FROM public.stocks WHERE ticker ILIKE 'GRAVITA%';");
    if (stockRes.rows.length === 0) {
      console.log("GRAVITA not found in stocks table.");
      return;
    }
    const stockId = stockRes.rows[0].id;
    console.log(`Found GRAVITA: ${stockId}`);

    const metricsRes = await pool.query(
      "SELECT * FROM public.xbrl_metrics_quarterly WHERE stock_id = $1 ORDER BY period_end_date DESC LIMIT 1",
      [stockId]
    );

    if (metricsRes.rows.length === 0) {
      console.log("No XBRL metrics found for GRAVITA.");
      return;
    }

    const row = metricsRes.rows[0];
    console.log("Latest XBRL Metrics (Extracted):");
    console.log(`Quarter: ${row.quarter}`);
    console.log(`Revenue: ${row.revenue_from_ops}`);
    console.log(`Receivables: ${row.receivables}`);
    console.log(`Inventory: ${row.inventory}`);
    console.log(`Trade Payables: ${row.trade_payables}`);
    console.log(`Working Capital Days: ${row.working_capital_days}`);
    console.log(`Segments: ${JSON.stringify(row.segments, null, 2)}`);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

verify();
