import { pool } from '../db/pool.js';

async function checkPrices() {
  const { rows } = await pool.query(`
    SELECT date, price 
    FROM prices 
    WHERE stock_id = (SELECT id FROM stocks WHERE ticker = 'TIMETECHNO') 
    AND date > '2024-01-01' 
    ORDER BY date ASC 
    LIMIT 10
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

checkPrices();
