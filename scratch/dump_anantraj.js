import { fetchBseAnnouncements, fetchNseAnnouncements } from "../backend/services/announcement.service.js";

async function dump() {
  const ticker = "ANANTRAJ";
  const bseScrip = "515055";
  
  console.log("Fetching BSE...");
  const bse = await fetchBseAnnouncements(bseScrip);
  console.log("BSE Count:", bse.length);
  
  console.log("Fetching NSE...");
  const nse = await fetchNseAnnouncements(ticker);
  console.log("NSE Count:", nse.length);
  
  const all = [...bse.map(a => ({ source: 'BSE', title: a.NEWSSUB, date: a.DT_TM })), ...nse.map(a => ({ source: 'NSE', title: a.NEWSSUB, date: a.DT_TM }))];
  
  console.log(JSON.stringify(all, null, 2));
  process.exit(0);
}

dump();
