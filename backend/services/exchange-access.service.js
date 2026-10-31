/**
 * Exchange access health.
 *
 * Cloud IPs are often refused by BSE (HTTP 403). Most stocks are also on NSE, which still answers, so a BSE block costs
 * little for them. A stock listed ONLY on BSE (no NSE symbol) is blind while BSE is blocked: its filings are never seen by
 * that server and nothing used to say so. This module decides when to tell the owner, and how to stop hammering a
 * blocking exchange for stocks that NSE covers.
 */

const BLIND_COOLDOWN_HOURS = 12;
const SKIP_AFTER_BLOCKS = 2;

/**
 * @param {{stocks: {ticker: string, nse_symbol?: string|null}[], bseFailures: Map<string, number|string>}} input
 *        bseFailures: ticker -> status (or reason) for every stock whose BSE fetch failed in this run
 * @returns {{id: string, cooldownHours: number, tickers: string[], text: string}[]}
 */
export function evaluateExchangeAccess({ stocks, bseFailures }) {
  const blind = stocks.filter(s => !s.nse_symbol && bseFailures.has(s.ticker)).map(s => s.ticker);
  if (blind.length === 0) return [];
  const failedTotal = bseFailures.size;
  return [{
    id: "exchange:bse-blind",
    cooldownHours: BLIND_COOLDOWN_HOURS,
    tickers: blind,
    text:
      `BSE did not answer this server (${failedTotal} stock${failedTotal === 1 ? "" : "s"} failed; usually the host's IP is blocked).\n` +
      `Listed only on BSE, so their filings are NOT being seen from here until BSE answers again: ${blind.join(", ")}.\n` +
      `Stocks that are also on NSE are still covered. The GitHub Actions backup may still catch them. ` +
      `Permanent fix: route BSE through a relay (BSE_PROXY_URL, see docs/bse-proxy-worker.md).`
  }];
}

/**
 * Sends one Telegram message for issues whose cooldown has expired and records the cooldown only after the send worked
 * (a failed send is retried on the next run and the error is raised to the caller).
 * @param {{issues: object[], store: {get(k: string): Promise<string|null>, set(k: string, v: string): Promise<void>}, send: (t: string) => Promise<unknown>, now?: Date}} deps
 */
export async function alertExchangeAccess({ issues, store, send, now = new Date() }) {
  const due = [];
  for (const issue of issues) {
    const last = await store.get(`exchange_alert_${issue.id}`);
    const hoursSince = last ? (now.getTime() - new Date(last).getTime()) / 3600000 : Infinity;
    if (!(hoursSince < issue.cooldownHours)) due.push(issue);
  }
  if (due.length === 0) return [];
  const time = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
  const body = due.map(i => i.text).join("\n\n");
  await send(`⚠️ EXCHANGE ACCESS\n──────────────────────────────\n${body}\n──────────────────────────────\n🕐 ${time} IST · ThesisIQ health guard`);
  for (const issue of due) await store.set(`exchange_alert_${issue.id}`, now.toISOString());
  return due;
}

/**
 * After repeated blocks in one run there is no point asking BSE again for stocks NSE also covers (every refused request keeps
 * the IP flagged). Stocks listed only on BSE are always tried: they have no other source.
 */
export function shouldSkipBse({ blockedInRun, hasNse }) {
  return Boolean(hasNse) && blockedInRun >= SKIP_AFTER_BLOCKS;
}
