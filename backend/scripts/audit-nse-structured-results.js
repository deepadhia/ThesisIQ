/** Read-only check of NSE's structured results endpoint for one supplied symbol. */
import {fetchNseFinancialResults} from '../services/xbrl.service.js';
import {pool} from '../db/pool.js';
const symbol=process.argv[2];
if (!/^[A-Z0-9&-]{2,30}$/.test(symbol || '')) throw new Error('Pass an NSE symbol');
try {
  const result=await fetchNseFinancialResults(symbol);
  console.log(JSON.stringify({symbol,rows:result.rawRows.length,latest:result.normalized.slice(0,4).map(r=>({quarter:r.quarter,period:r.period_end_date,revenue:r.revenue_from_ops,pat:r.pat,ebitda:r.ebitda,confidence:r.confidence}))},null,2));
} finally {await pool.end();}
