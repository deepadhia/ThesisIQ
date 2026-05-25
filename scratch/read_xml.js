import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

function printRevenue(ticker) {
  console.log('--- ' + ticker + ' ---');
  const dir = path.join('data_node', ticker);
  if (!fs.existsSync(dir)) return;
  const qDirs = fs.readdirSync(dir);
  for (const q of qDirs) {
    const qPath = path.join(dir, q);
    const files = fs.readdirSync(qPath);
    const xml = files.find(f => f.endsWith('.xml'));
    if (xml) {
       const content = fs.readFileSync(path.join(qPath, xml), 'utf-8');
       const $ = cheerio.load(content, { xmlMode: true });
       const revs = $('*').filter((i, el) => (el.name || '').toLowerCase().includes('revenue'));
       console.log(q + ':');
       revs.each((i, el) => {
         console.log(`  <${el.name} contextRef="${$(el).attr('contextRef')}" decimals="${$(el).attr('decimals')}" unitRef="${$(el).attr('unitRef')}">${$(el).text()}</${el.name}>`);
       });
       break;
    }
  }
}

printRevenue('SJS');
