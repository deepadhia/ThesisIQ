/** Read-only official NSE filing discovery; never writes database rows or sends alerts. */
import { discoverNseIntegratedFilings } from '../services/xbrl/integratedFilingDiscovery.js';

const [symbol, periodEnd] = process.argv.slice(2);
if (!symbol || !periodEnd) {
  console.error('Usage: node backend/scripts/audit-integrated-filings.js NSE_SYMBOL YYYY-MM-DD');
  process.exitCode = 2;
} else {
  try {
    const filings = await discoverNseIntegratedFilings({ symbol, periodEnd });
    console.log(JSON.stringify({ symbol, periodEnd, count: filings.length, filings }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
