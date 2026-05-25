import { pool } from "../db/pool.js";

async function verify() {
  const { rows } = await pool.query(`
    SELECT quarter, revenue_from_ops, receivables, inventory, trade_payables, working_capital_days 
    FROM xbrl_metrics_quarterly 
    WHERE ticker = 'GRAVITA' 
    ORDER BY period_end_date DESC 
    LIMIT 3
  `);
  
  for (const r of rows) {
    const rev = parseFloat(r.revenue_from_ops);
    const rec = parseFloat(r.receivables) || 0;
    const inv = parseFloat(r.inventory) || 0;
    const pay = parseFloat(r.trade_payables) || 0;
    const wcDays = parseFloat(r.working_capital_days);
    
    let expectedWcDays = 0;
    if (rev > 0) {
      expectedWcDays = ((rec + inv - pay) / rev) * 90;
    }
    
    console.log(`Quarter: ${r.quarter}`);
    console.log(`Revenue: ${rev}, Rec: ${rec}, Inv: ${inv}, Payables: ${pay}`);
    console.log(`Computed WC Days in DB: ${wcDays}`);
    console.log(`Expected WC Days: ${expectedWcDays}`);
    console.log(`Match? ${Math.abs(wcDays - expectedWcDays) < 0.1 ? 'YES' : 'NO'}`);
    console.log('---');
  }
  process.exit(0);
}

verify();
