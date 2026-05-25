import { pool } from '../db/pool.js';
const stocks = await pool.query(`SELECT ticker, bse_scrip_code FROM stocks ORDER BY ticker`);
console.log('Stocks + BSE codes:\n', JSON.stringify(stocks.rows, null, 2));
await pool.end();
