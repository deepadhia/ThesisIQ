import axios from "axios";

async function getRawAnnouncements() {
  console.log("=========================================");
  console.log("FETCHING RAW NSE ANNOUNCEMENTS FOR ANANTRAJ");
  console.log("=========================================");

  // Create date chunks for 3 years
  const symbol = "ANANTRAJ";
  const chunks = [
    { from: "09-05-2025", to: "06-08-2025" },
    { from: "07-08-2025", to: "04-11-2025" },
    { from: "05-11-2025", to: "02-02-2026" },
    { from: "03-02-2026", to: "03-05-2026" },
    { from: "04-05-2026", to: "19-05-2026" },
    { from: "01-01-2025", to: "08-05-2025" },
    { from: "01-01-2024", to: "31-12-2024" },
    { from: "01-01-2023", to: "31-12-2023" }
  ];

  const allAnns = [];

  for (const chunk of chunks) {
    const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${symbol}&from_date=${chunk.from}&to_date=${chunk.to}`;
    console.log(`Fetching: ${chunk.from} to ${chunk.to}...`);

    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.nseindia.com/get-quotes/equity?symbol=ANANTRAJ"
        },
        timeout: 10000
      });

      if (response.data && Array.isArray(response.data)) {
        allAnns.push(...response.data);
        console.log(`  Found ${response.data.length} announcement(s)`);
      }
    } catch (err) {
      console.warn(`  Failed for chunk ${chunk.from} - ${chunk.to}: ${err.message}`);
    }
    // Small delay to be polite
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nTotal announcements fetched from NSE: ${allAnns.length}`);
  
  // Deduplicate by desc/subject/date
  const uniqueAnns = [];
  const seenIds = new Set();
  for (const ann of allAnns) {
    const id = ann.seqId || ann.desc || ann.subject;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      uniqueAnns.push(ann);
    }
  }
  console.log(`Unique announcements: ${uniqueAnns.length}`);

  // Dump matching titles or anything interesting
  console.log("\nSearching for any potential order, capex, agreement, or major corporate filings:");
  let found = 0;
  uniqueAnns.forEach(ann => {
    const desc = (ann.desc || "").toLowerCase();
    const subject = (ann.subject || "").toLowerCase();
    const isPotentiallyRelevant = 
      desc.includes("order") || desc.includes("contract") || desc.includes("mou") || 
      desc.includes("capex") || desc.includes("expansion") || desc.includes("signing") ||
      desc.includes("agreement") || desc.includes("bagging") ||
      subject.includes("order") || subject.includes("contract") || subject.includes("mou") ||
      subject.includes("capex") || subject.includes("expansion") || subject.includes("signing") ||
      subject.includes("agreement") || subject.includes("bagging");

    if (isPotentiallyRelevant) {
      found++;
      console.log(`[POTENTIAL WIN]`);
      console.log(`  Date: ${ann.attchmentDate || ann.fld_DocDateTime}`);
      console.log(`  Subject: ${ann.subject}`);
      console.log(`  Description: ${ann.desc}`);
      console.log(`  Attachment: ${ann.attachment || "none"}`);
    }
  });

  if (found === 0) {
    console.log("No announcements matched order/contract/capex/mou keywords.");
    console.log("\nHere are a few representative announcements to see what Anant Raj files:");
    uniqueAnns.slice(0, 15).forEach(ann => {
      console.log(`  - Date: ${ann.attchmentDate || ann.fld_DocDateTime} | Subject: ${ann.subject} | Desc: ${ann.desc}`);
    });
  }
}

getRawAnnouncements();
