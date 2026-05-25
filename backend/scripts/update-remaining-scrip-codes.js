import { pool } from "../db/pool.js";

const mapping = {
  'QPOWER': '544367',
  'INOXINDIA': '544046',
  'JSLL': '544476',
  'SBCL': '513097',
  'ELECON': '505700',
  'ASTRAMICRO': '532493',
  'SJS': '543387',
  'SHAKTIPUMP': '531431',
  'POLICYBZR': '543390',
  'JYOTICNC': '544081'
};

async function update() {
  for (const [ticker, code] of Object.entries(mapping)) {
    try {
      const res = await pool.query(
        "UPDATE stocks SET bse_scrip_code = $1 WHERE ticker = $2",
        [code, ticker]
      );
      console.log(`Updated ${ticker} -> ${code} (${res.rowCount} rows)`);
    } catch (err) {
      console.error(`Failed to update ${ticker}:`, err.message);
    }
  }
  process.exit(0);
}

update().catch(console.error);
