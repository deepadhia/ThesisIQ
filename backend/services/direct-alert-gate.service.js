/**
 * Allocation gate for a DIRECT scanner alert (a filing alerted on its own, not via the results / deck / call worker).
 * Extracted from scan() so it is unit-tested: the market-cap lookup and the amount estimate are injected.
 *
 * Returns { boarded, eventAnalysis }. `boarded` true means: do not push, the filing is listed on the end-of-day allocation board
 * (its row carries `board_pending` + `board_item`). Anything uncertain pushes: a failed market-cap lookup never hides an alert.
 */

import { classifyDirectEvent, boardEntryFrom } from "./allocation-relevance.service.js";

const firstSentence = (t) => String(t || "").split(/(?<=[.!?])\s+/)[0] || "";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole IST days from `now` to a YYYY-MM-DD date; null when the date is not readable. */
function daysUntilIst(ymd, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  const todayIst = new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.parse(`${todayIst}T00:00:00Z`)) / 86400e3);
}

export async function decideDirectAlertGate({
  shouldHaveAlerted, isDuplicateEvent = false, isConcallScheduleAlert = false, gateEnabled = true,
  ticker, title = "", filingCategory = "GENERAL", aiResult = {}, announcementText = "", eventAnalysis = null,
  getMarketCapCr, estimateAmountCr, concallSchedule = null, isRescheduled = false, now = Date.now()
} = {}) {
  const pass = { boarded: false, eventAnalysis };
  // Only a filing that was about to be alerted on its own is judged.
  if (!gateEnabled || !shouldHaveAlerted || isDuplicateEvent) return pass;

  // A concall-date heads-up says only WHEN a call is: one message per stock per quarter. A call more than a day away goes on the
  // daily board with its date; a call today or tomorrow, or with no readable date, is pushed (the board would come too late).
  if (isConcallScheduleAlert) {
    const days = daysUntilIst(concallSchedule?.date, now);
    if (days === null || days <= 1) return pass;
    const [, mm, dd] = /^\d{4}-(\d{2})-(\d{2})$/.exec(concallSchedule.date);
    const when = `${Number(dd)} ${MONTHS[Number(mm) - 1]}${concallSchedule.time ? `, ${concallSchedule.time} IST` : ""}`;
    const gist = `Earnings call ${when}${isRescheduled ? " (rescheduled)" : ""}.`;
    console.log(`[ALLOCATION GATE] ${ticker}: concall on ${when}; listed on the allocation board, not pushed: ${title}`);
    return { boarded: true, eventAnalysis: { ...(eventAnalysis || {}), board_pending: true, board_item: boardEntryFrom({ ticker, kinds: ["CONCALL_SCHEDULE"], gist }) } };
  }

  let marketCapCr = null;
  try {
    const cap = await getMarketCapCr(ticker);
    marketCapCr = cap === null || cap === undefined || Number.isNaN(Number(cap)) ? null : Number(cap);
  } catch (err) {
    console.warn(`[ALLOCATION GATE] Market cap lookup failed for ${ticker} (the alert is pushed): ${err.message}`);
    return pass;
  }

  const amountCr = estimateAmountCr ? estimateAmountCr(`${title}\n${String(announcementText || "").slice(0, 6000)}`) : null;
  const direct = classifyDirectEvent({ category: filingCategory, priority: aiResult.priority, impact: aiResult.impact, amountCr, marketCapCr });
  if (direct.push) return pass;

  const summary = firstSentence(aiResult.summary);
  const gist = `${direct.reason}.${summary ? ` ${summary}` : ""}`;
  console.log(`[ALLOCATION GATE] ${ticker}: ${direct.reason}; listed on the allocation board, not pushed: ${title}`);
  return {
    boarded: true,
    eventAnalysis: { ...(eventAnalysis || {}), board_pending: true, board_item: boardEntryFrom({ ticker, kinds: [filingCategory], gist }) }
  };
}
