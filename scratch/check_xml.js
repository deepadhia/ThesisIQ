import { pool } from '../backend/db/pool.js';
import * as cheerio from 'cheerio';

async function check() {
  const sjsRes = await pool.query("SELECT raw_xbrl_xml FROM xbrl_filings WHERE ticker = 'SJS' ORDER BY quarter DESC LIMIT 1");
  const timeRes = await pool.query("SELECT raw_xbrl_xml FROM xbrl_filings WHERE ticker = 'TIMETECHNO' ORDER BY quarter DESC LIMIT 1");

  function printRev(xml, name) {
    console.log(`\n--- ${name} ---`);
    if(!xml) { console.log('No xml'); return; }
    const $ = cheerio.load(xml, { xmlMode: true });
    $('in-bse-fin\\:RevenueFromOperations, RevenueFromOperations').each((i, el) => {
       console.log(`<${el.name} contextRef="${$(el).attr('contextRef')}" unitRef="${$(el).attr('unitRef')}" decimals="${$(el).attr('decimals')}"> ${$(el).text()} </${el.name}>`);
    });
  }

  printRev(sjsRes.rows[0]?.raw_xbrl_xml, 'SJS');
  printRev(timeRes.rows[0]?.raw_xbrl_xml, 'TIMETECHNO');
  process.exit(0);
}
check();
