// NSE Financial Results API — inspect full field structure for Skipper
const r = await fetch('https://www.nseindia.com/api/results-comparision?index=equities&symbol=SKIPPER', {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://www.nseindia.com/",
  }
});
const data = await r.json();
const rows = data.resCmpData || [];
console.log(`Total quarters: ${rows.length}`);
console.log('\nAll field names in a row:', Object.keys(rows[0] || {}).join('\n'));
console.log('\n--- Last 2 quarters ---');
console.log(JSON.stringify(rows.slice(0, 2), null, 2));


