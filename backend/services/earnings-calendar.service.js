/**
 * ONE earnings-calendar message per day (pure; the reminder script owns the queries and the send).
 *
 * Before, every stock got its own message at 3 days, 1 day, 0 days, +1 day and +3 days around its results: five messages per
 * stock per quarter, three of them identical apart from a date, and the two "post-result" ones only said "review the flash
 * note" (a note the reader had already received). In a results week that was 5-7 messages a day. Now: one message that lists
 * what reports today / tomorrow / in 3 days, and which stocks have reported but whose concall has not been analysed yet.
 */

/** "Shivalik Bimetal Controls Ltd share price" -> "Shivalik Bimetal Controls" */
export function shortCompanyName(name = "", ticker = "") {
  const n = String(name || "")
    .replace(/\s+share\s+price\s*$/i, "")
    .replace(/\b(?:limited|ltd)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return n && n.toLowerCase() !== String(ticker).toLowerCase() ? n : "";
}

const label = (e) => {
  const name = shortCompanyName(e.company, e.ticker);
  return `${String(e.ticker).toUpperCase()}${name ? ` (${name})` : ""}`;
};

const dayLabel = (ymd) => {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isNaN(t) ? ymd : new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
};

/**
 * @param {Array<{ticker:string, company?:string, resultDate:string, diffDays:number, resultsPublished:boolean, concallAnalysed:boolean}>} entries
 *        diffDays = days from today to the results date (3, 1, 0 upcoming; -1..-4 just reported)
 * @param {{todayYmd?:string}} [opts]
 * @returns {string|null} the message, or null when there is nothing worth sending
 */
export function buildEarningsCalendarMessage(entries = [], { todayYmd = "", folded = [] } = {}) {
  const upcoming = (d) => entries.filter((e) => e.diffDays === d && !e.resultsPublished);
  const today = upcoming(0);
  const tomorrow = upcoming(1);
  const in3 = upcoming(3);
  // Reported in the last four days, results are in, and the call has not produced an analysis yet: the one thing still to do.
  const awaitingCall = entries.filter((e) => e.diffDays <= -1 && e.diffDays >= -4 && e.resultsPublished && !e.concallAnalysed);

  if (!today.length && !tomorrow.length && !in3.length && !awaitingCall.length) return null;

  const lines = [`📅 *EARNINGS CALENDAR*${todayYmd ? ` — ${dayLabel(todayYmd)}` : ""}`];
  if (today.length) lines.push(`🚨 *Reports today:* ${today.map(label).join(", ")}`);
  if (tomorrow.length) lines.push(`⏰ *Tomorrow:* ${tomorrow.map(label).join(", ")}`);
  if (in3.length) lines.push(`🗓️ *In 3 days (${dayLabel(in3[0].resultDate)}):* ${in3.map(label).join(", ")}`);
  if (awaitingCall.length) lines.push(`🎙️ *Reported, concall not analysed yet:* ${awaitingCall.map((e) => `${String(e.ticker).toUpperCase()} (${dayLabel(e.resultDate)})`).join(", ")}`);
  // Filings recorded instead of sent (a press release restating the results, a transcript repeating a recording write-up):
  // one short line per stock so nothing is invisible. This never creates a message of its own.
  const foldedByTicker = new Map();
  for (const f of folded || []) {
    if (!f || !f.ticker) continue;
    const kind = /transcript/i.test(f.reason || "") ? "transcript (same call as the recording)" : /press release/i.test(f.reason || "") ? "press release (restates results)" : "filing (nothing new)";
    const list = foldedByTicker.get(f.ticker) || [];
    if (!list.includes(kind)) list.push(kind);
    foldedByTicker.set(f.ticker, list);
  }
  if (foldedByTicker.size) {
    lines.push(`📎 *Folded, nothing new to report:* ${[...foldedByTicker].map(([t, kinds]) => `${String(t).toUpperCase()} ${kinds.join(" + ")}`).join("; ")}`);
  }
  lines.push("_Results notes and call highlights are sent automatically when filed._");
  return lines.join("\n");
}
