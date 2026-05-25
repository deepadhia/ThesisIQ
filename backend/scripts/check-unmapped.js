import fs from 'fs';
const data = JSON.parse(fs.readFileSync('d:/nse downloader/nse_downloader/screener_links_node.json', 'utf-8'));
const unmapped = ['QPOWER', 'INOXINDIA', 'JSLL', 'SBCL', 'ELECON', 'ASTRAMICRO', 'SJS', 'SHAKTIPUMP', 'POLICYBZR', 'JYOTICNC'];
unmapped.forEach(t => {
  const found = data.filter(item => item.symbol === t);
  console.log(`${t}: ${found.length} entries found`);
  if (found.length > 0) {
    const bseLinks = found.filter(f => f.href && f.href.includes("bseindia.com"));
    console.log(`  BSE Links: ${bseLinks.length}`);
    bseLinks.forEach(l => console.log(`    - ${l.href}`));
  }
});
