import { fetchNseFinancialResults } from "../services/xbrl.service.js";

async function run() {
  const ticker = "QPOWER";
  try {
    const { normalized } = await fetchNseFinancialResults(ticker);
    console.log("Quarters found in API:", normalized.map(r => r.quarter));
  } catch (err) {
    console.error(err);
  }
}

run();
