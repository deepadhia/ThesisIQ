import { pool } from "../db/pool.js";
import { sendTelegramMessage } from "../services/telegram.service.js";

const NSE_BASE = 'https://www.nseindia.com';
const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/',
};

/**
 * Parses an exchange date string like "26 May 2026" or "26-May-2026"
 * into a timezone-safe "YYYY-MM-DD" format.
 */
function parseExchangeDate(dateStr) {
  if (!dateStr) return null;
  const clean = String(dateStr).replace(/-/g, ' ').replace(/,/g, '').trim();
  const parts = clean.split(/\s+/);
  
  if (parts.length < 3) return null;
  
  const day = parseInt(parts[0], 10);
  const monthStr = parts[1].toLowerCase();
  const year = parseInt(parts[2], 10);
  
  if (isNaN(day) || isNaN(year)) return null;
  
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
  };
  
  const month = months[monthStr.substring(0, 3)];
  if (!month) return null;
  
  const dayStr = String(day).padStart(2, '0');
  return `${year}-${month}-${dayStr}`;
}

/**
 * Calculates the calendar days difference between two YYYY-MM-DD strings.
 * Totally timezone independent.
 */
function getDaysDifference(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1 + 'T00:00:00');
  const d2 = new Date(dateStr2 + 'T00:00:00');
  const diffTime = d1.getTime() - d2.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Formats a raw database date (Date object or string) into a clean local "YYYY-MM-DD" string.
 */
function formatDbDateToYmd(rawDate) {
  if (!rawDate) return null;
  if (rawDate instanceof Date) {
    const y = rawDate.getFullYear();
    const m = String(rawDate.getMonth() + 1).padStart(2, '0');
    const d = String(rawDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(rawDate).split('T')[0];
}

/**
 * Fetches NSE session cookies.
 */
async function getNSECookies() {
  try {
    const resp = await fetch(NSE_BASE, { headers: NSE_HEADERS, redirect: 'follow' });
    await resp.text();
    const cookies = resp.headers.get('set-cookie') || '';
    return cookies.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
  } catch (err) {
    console.warn(`[SYNC] Failed to fetch NSE cookies: ${err.message}. NSE board meetings sync might be skipped.`);
    return "";
  }
}

/**
 * Fetches forthcoming results from BSE and board meetings from NSE,
 * and updates any mismatched or incorrect next results dates in the DB.
 */
export async function syncForthcomingResults() {
  console.log("Starting forthcoming results sync from BSE & NSE...");
  
  // 1. Get tracked stocks
  const { rows: stocks } = await pool.query(
    "SELECT id, ticker, company_name, next_results_date FROM stocks"
  );
  
  const tickerToStock = new Map();
  const nameWords = new Map();
  for (const s of stocks) {
    tickerToStock.set(s.ticker.toUpperCase(), s);
    const words = s.company_name.toUpperCase().split(/\s+/).filter(w => w.length > 2 && !['LTD', 'LIMITED', 'PVT', 'PRIVATE', 'INC', 'CORP', 'THE'].includes(w));
    if (words.length > 0) {
      nameWords.set(words[0], s);
    }
  }

  const matchedIds = new Set();
  const updates = [];

  // Get local YYYY-MM-DD for today to filter past dates timezone-safely
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayYmd = `${y}-${m}-${d}`;

  // 2. Fetch BSE Forthcoming Results Calendar
  try {
    const bseResp = await fetch("https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w", {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.bseindia.com/',
        'Origin': 'https://www.bseindia.com',
      }
    });
    
    if (bseResp.ok) {
      const bseData = await bseResp.json();
      if (Array.isArray(bseData)) {
        console.log(`[SYNC] BSE returned ${bseData.length} forthcoming results.`);
        for (const item of bseData) {
          const bseName = (item.short_name || item.Long_Name || '').toUpperCase();
          const meetingDate = item.meeting_date || '';
          
          const dateStr = parseExchangeDate(meetingDate);
          if (!dateStr) continue;

          // Skip past dates timezone-safely
          if (getDaysDifference(dateStr, todayYmd) < 0) continue;

          let matchedStock = null;
          // Match by ticker (strict exact match to avoid false substring matches like CCL matching CCCL)
          const cleanBseShort = bseName.replace(/[^A-Z0-9]/g, '');
          for (const [ticker, stock] of tickerToStock) {
            const cleanTicker = ticker.replace(/[^A-Z0-9]/g, '');
            if (cleanBseShort === cleanTicker) {
              matchedStock = stock;
              break;
            }
          }

          // Fuzzy name match (only if ticker did not match directly)
          if (!matchedStock) {
            const bseWords = bseName.split(/\s+/).filter(w => w.length > 2 && !['LTD', 'LIMITED', 'PVT', 'PRIVATE', 'INC', 'CORP', 'THE'].includes(w));
            for (const bw of bseWords) {
              if (nameWords.has(bw)) {
                matchedStock = nameWords.get(bw);
                break;
              }
            }
          }

          if (matchedStock && !matchedIds.has(matchedStock.id)) {
            matchedIds.add(matchedStock.id);
            const existingStr = formatDbDateToYmd(matchedStock.next_results_date);
            if (dateStr !== existingStr) {
              updates.push({ id: matchedStock.id, ticker: matchedStock.ticker, date: dateStr, source: 'BSE' });
            }
          }
        }
      }
    } else {
      console.warn(`[SYNC] BSE API returned status ${bseResp.status}`);
    }
  } catch (err) {
    console.error("[SYNC] BSE Forthcoming results fetch failed:", err.message);
  }

  // 3. Fetch NSE Board Meetings Calendar
  try {
    const cookies = await getNSECookies();
    if (cookies) {
      const nseResp = await fetch("https://www.nseindia.com/api/corporate-board-meetings?index=equities", {
        headers: {
          ...NSE_HEADERS,
          'Cookie': cookies
        }
      });
      
      if (nseResp.ok) {
        const meetings = await nseResp.json();
        if (Array.isArray(meetings)) {
          console.log(`[SYNC] NSE returned ${meetings.length} board meetings.`);
          for (const m of meetings) {
            const symbol = (m.bm_symbol || m.symbol || '').toUpperCase();
            const purpose = (m.bm_purpose || m.purpose || '').toLowerCase();
            const dateStrRaw = m.bm_date || m.meetingDate || m.date || '';

            if (!purpose.includes('financial result') && !purpose.includes('quarterly') && !purpose.includes('audited') && !purpose.includes('un-audited')) continue;

            const dateStr = parseExchangeDate(dateStrRaw);
            if (!dateStr) continue;

            // Skip past dates timezone-safely
            if (getDaysDifference(dateStr, todayYmd) < 0) continue;

            const stock = tickerToStock.get(symbol);
            if (stock && !matchedIds.has(stock.id)) {
              matchedIds.add(stock.id);
              const existingStr = formatDbDateToYmd(stock.next_results_date);
              if (meetDateStr !== existingStr) {
                updates.push({ id: stock.id, ticker: stock.ticker, date: dateStr, source: 'NSE' });
              }
            }
          }
        }
      } else {
        console.warn(`[SYNC] NSE API returned status ${nseResp.status}`);
      }
    }
  } catch (err) {
    console.error("[SYNC] NSE Board Meetings fetch failed:", err.message);
  }

  // 4. Save updates to DB
  let updatedCount = 0;
  for (const up of updates) {
    try {
      await pool.query(
        "UPDATE stocks SET next_results_date = $1 WHERE id = $2",
        [up.date, up.id]
      );
      console.log(`[SYNC] Verified & Updated ${up.ticker} results date to ${up.date} (Source: ${up.source})`);
      updatedCount++;
    } catch (err) {
      console.error(`[SYNC ERROR] Failed to update ${up.ticker} next results date:`, err.message);
    }
  }

  console.log(`Finished forthcoming results sync. Total updated: ${updatedCount}`);
}

/**
 * Checks if results have actually been published and recorded as an earnings release in corporate_announcements.
 */
async function checkResultsPublished(stockId, expectedDateStr) {
  // Format the expected date safely to YYYY-MM-DD
  const dateStr = formatDbDateToYmd(expectedDateStr);
  const query = `
    SELECT EXISTS (
      SELECT 1 FROM corporate_announcements
      WHERE stock_id = $1
        AND is_earnings_release = true
        AND (
          (filing_date IS NOT NULL AND filing_date >= $2::date - interval '7 days')
          OR 
          (processed_at >= $2::date - interval '7 days')
        )
    ) as published
  `;
  try {
    const res = await pool.query(query, [stockId, dateStr]);
    return res.rows[0]?.published || false;
  } catch (err) {
    console.error(`[REMINDER ERROR] Failed to verify if results published for stockId ${stockId}:`, err.message);
    return false;
  }
}

export async function checkAndSendReminders({ isDryRun = false } = {}) {
  console.log("Starting Results Reminder Check...");
  
  // 1. Proactively sync the latest results calendar from BSE and NSE
  try {
    await syncForthcomingResults();
  } catch (err) {
    console.error("[REMINDER] Proactive results calendar sync failed:", err.message);
  }

  // 2. Fetch all stocks with next results date
  const { rows: stocks } = await pool.query(
    "SELECT id, ticker, company_name, next_results_date FROM stocks WHERE next_results_date IS NOT NULL"
  );

  // Get local YYYY-MM-DD for today timezone-safely
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayYmd = `${y}-${m}-${d}`;

  let remindersSent = 0;

  for (const stock of stocks) {
    const resultDateStr = formatDbDateToYmd(stock.next_results_date);
    if (!resultDateStr) continue;

    const diffDays = getDaysDifference(resultDateStr, todayYmd);
    let message = null;

    const cleanedCompany = (stock.company_name || stock.ticker)
      .replace(/\s+share\s+price\s*$/i, "")
      .replace(/\s+ltd\b\.?/i, " Ltd")
      .trim();
    const companyHeader = cleanedCompany ? `*${stock.ticker.toUpperCase()}* | ${cleanedCompany}` : `*${stock.ticker.toUpperCase()}*`;

    if (diffDays === 3) {
      // Skip if results were already published (e.g. published early)
      const hasResults = await checkResultsPublished(stock.id, stock.next_results_date);
      if (hasResults) {
        console.log(`[SKIP] Skipped upcoming reminder for ${stock.ticker} (diffDays=3) because results were already published.`);
        continue;
      }
      message = `📅 *UPCOMING EARNINGS CALENDAR*\n` +
        `🏢 ${companyHeader}\n` +
        `──────────────────────────────\n` +
        `📢 *Event:* Board Meeting for Financial Results\n` +
        `🗓️ *Scheduled Date:* ${resultDateStr} (in 3 days)\n` +
        `🎯 *Status:* Pre-Result Stance Active\n` +
        `──────────────────────────────\n` +
        `_Auto-monitoring BSE/NSE feeds for financial results & concall intimation._`;
    } else if (diffDays === 1) {
      // Skip if results were already published
      const hasResults = await checkResultsPublished(stock.id, stock.next_results_date);
      if (hasResults) {
        console.log(`[SKIP] Skipped upcoming reminder for ${stock.ticker} (diffDays=1) because results were already published.`);
        continue;
      }
      message = `📅 *UPCOMING EARNINGS CALENDAR*\n` +
        `🏢 ${companyHeader}\n` +
        `──────────────────────────────\n` +
        `📢 *Event:* Board Meeting for Financial Results\n` +
        `🗓️ *Scheduled Date:* *TOMORROW* (${resultDateStr})\n` +
        `⚡ *Watch Items:* YoY/QoQ revenue growth, EBITDA margin resilience, order intake\n` +
        `──────────────────────────────\n` +
        `_Stage 1 Flash note will trigger automatically upon exchange publication._`;
    } else if (diffDays === 0) {
      // Skip if results were already published
      const hasResults = await checkResultsPublished(stock.id, stock.next_results_date);
      if (hasResults) {
        console.log(`[SKIP] Skipped upcoming reminder for ${stock.ticker} (diffDays=0) because results were already published.`);
        continue;
      }
      message = `🚨 *EARNINGS RELEASE EXPECTED TODAY*\n` +
        `🏢 ${companyHeader}\n` +
        `──────────────────────────────\n` +
        `📢 *Event:* Quarterly Results Board Meeting\n` +
        `🗓️ *Scheduled Date:* *TODAY* (${resultDateStr})\n` +
        `🎯 *System Status:* High-priority scanner active on BSE/NSE corporate feeds\n` +
        `──────────────────────────────\n` +
        `_Stage 1 Flash note will dispatch immediately upon filing receipt._`;
    } else if (diffDays === -1) {
      // 3a. Verify results are actually published for post-result review
      const hasResults = await checkResultsPublished(stock.id, stock.next_results_date);
      if (!hasResults) {
        console.log(`[SKIP] Skipped review reminder for ${stock.ticker} (diffDays=-1): No earnings release found around ${resultDateStr}.`);
        continue;
      }
      message = `📋 *POST-RESULT REVIEW ACTION*\n` +
        `🏢 ${companyHeader}\n` +
        `──────────────────────────────\n` +
        `📢 *Event:* Results Published Yesterday (${resultDateStr})\n` +
        `🔍 *Audit Action:* Review Stage 1 Flash numbers against management commitments\n` +
        `🎯 *Decision Gate:* Verify if thesis assumptions hold or concall queries need tracking\n` +
        `──────────────────────────────\n` +
        `_ThesisIQ Post-Earnings Governance_`;
    } else if (diffDays === -3) {
      // 3b. Verify results are actually published for final post-result reminder
      const hasResults = await checkResultsPublished(stock.id, stock.next_results_date);
      if (!hasResults) {
        console.log(`[SKIP] Skipped final reminder for ${stock.ticker} (diffDays=-3): No earnings release found around ${resultDateStr}.`);
        continue;
      }
      message = `📋 *FINAL POST-RESULT REMINDER*\n` +
        `🏢 ${companyHeader}\n` +
        `──────────────────────────────\n` +
        `📢 *Event:* Results Published 3 Days Ago (${resultDateStr})\n` +
        `🔍 *Audit Action:* Finalize quarterly thesis rating, forward IRR, and allocation posture\n` +
        `──────────────────────────────\n` +
        `_ThesisIQ Portfolio Governance_`;
    }

    if (message) {
      if (isDryRun) {
        console.log(`[DRY RUN] Would send reminder for ${stock.ticker}: diffDays=${diffDays}`);
      } else {
        try {
          await sendTelegramMessage(message);
          console.log(`Sent reminder for ${stock.ticker} (${diffDays} days)`);
          remindersSent++;
        } catch (err) {
          console.error(`Failed to send reminder for ${stock.ticker}:`, err.message);
        }
      }
    }
  }

  console.log(`Finished checking reminders. Sent: ${remindersSent}`);
  return remindersSent;
}

// Check if run directly
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const isDryRun = process.env.DRY_RUN === 'true';
  checkAndSendReminders({ isDryRun }).then(() => {
    process.exit(0);
  }).catch(err => {
    console.error("Fatal error during reminder check:", err);
    process.exit(1);
  });
}
