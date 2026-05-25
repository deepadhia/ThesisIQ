import axios from "axios";

async function checkRawFields() {
  console.log("=========================================");
  console.log("CHECKING RAW NSE OBJECT FIELDS FOR ANANTRAJ");
  console.log("=========================================");

  const symbol = "ANANTRAJ";
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${symbol}&from_date=01-08-2025&to_date=10-08-2025`;

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
      console.log(`Found ${response.data.length} raw object(s):`);
      response.data.forEach((obj, i) => {
        console.log(`\n--- Object ${i + 1} ---`);
        console.log(JSON.stringify(obj, null, 2));
      });
    } else {
      console.log("No announcements found in this range.");
    }
  } catch (err) {
    console.error("Fetch failed:", err.message);
  }
}

checkRawFields();
