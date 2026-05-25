import fetch from 'node-fetch';

async function getXbrl() {
  const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w`;
  const params = new URLSearchParams({
    strCat: "-1",
    strScrip: "543387",
    pageno: "1",
    strType: "C"
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "application/json",
      "Origin": "https://www.bseindia.com",
      "Referer": "https://www.bseindia.com/",
    },
  });
  
  const text = await response.text();
  console.log(text.substring(0, 1000));
  process.exit(0);
}
getXbrl();
