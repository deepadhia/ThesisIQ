/**
 * Retry policy for filings whose processing failed.
 *
 * Two rules, both learned from silent losses:
 *  1. An AI-provider outage is not the filing's fault: it must never use up the filing's attempts (three attempts at one
 *     per 5-minute cycle were spent in about 15 minutes of overload, and the filing was parked unread).
 *  2. Retries back off (5, 10, 20, 30, 60 minutes) instead of hammering free-tier quotas every cycle.
 *
 * Pure functions only, so the policy is unit-tested without a database.
 */

export const BACKOFF_MINUTES = [5, 10, 20, 30, 60];

/** During an AI outage, verified numbers go out without the AI narrative after this long (alert first, I1). */
export const OUTAGE_DEGRADE_AFTER_MS = 30 * 60 * 1000;
/** A filing with nothing verifiable to show is escalated to a human only after this long in an outage. */
export const OUTAGE_GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;
/** The scanner tells the user once, at this many failed classification attempts, that a filing cannot be classified. */
export const CLASSIFICATION_ALERT_AFTER_FAILURES = 6;

/** How long the whole queue pauses after the AI providers rate-limited us: 10, 30, 60, 120, then 180 minutes. */
export const QUOTA_PAUSE_MINUTES = [10, 30, 60, 120, 180];

/** Pause length after the nth consecutive rate-limited cycle; never shorter than the provider itself asked for. */
export function quotaPauseMs(consecutivePauses, providerRetryAfterMs) {
  const n = Number.isFinite(consecutivePauses) && consecutivePauses >= 1 ? Math.floor(consecutivePauses) : 1;
  const scheduled = QUOTA_PAUSE_MINUTES[Math.min(n, QUOTA_PAUSE_MINUTES.length) - 1] * 60 * 1000;
  return Number.isFinite(providerRetryAfterMs) ? Math.max(scheduled, providerRetryAfterMs) : scheduled;
}

/** `pause` is {until: epoch ms, count: consecutive pauses}; a running pause keeps the queue idle. */
export function isQuotaPaused(pause, nowMs = Date.now()) {
  return Boolean(pause) && Number.isFinite(pause.until) && pause.until > nowMs;
}

/** After a pause the queue works one filing at a time (no burst on a quota that just recovered) until a success clears it. */
export function batchSizeAfterPause(pause, normalBatchSize) {
  return pause && pause.count > 0 ? 1 : normalBatchSize;
}

/** Plain-text Telegram message (no markdown) for a filing the scanner keeps failing to classify. */
export function buildClassificationStuckMessage({ ticker, title, failures, docUrl }) {
  const clean = (s) => String(s || '').replace(/[*_`[\]]/g, '').slice(0, 140);
  return `⚠️ ${clean(ticker).toUpperCase()}: could not classify "${clean(title)}" after ${failures} attempts because the AI providers are failing. Still retrying about hourly; nothing is lost.${docUrl ? `\n${docUrl}` : ''}`;
}

/** Delay before the next retry after the nth consecutive failure (n >= 1); holds at the last step. */
export function backoffDelayMs(failuresSoFar) {
  const n = Number.isFinite(failuresSoFar) && failuresSoFar >= 1 ? Math.floor(failuresSoFar) : 1;
  return BACKOFF_MINUTES[Math.min(n, BACKOFF_MINUTES.length) - 1] * 60 * 1000;
}

/**
 * What to do after the LLM produced no usable output for a filing.
 * @param {object} p
 * @param {boolean} p.chainDown whether every provider has been failing (infrastructure, not this filing)
 * @param {number} [p.attempts] attempts counted so far INCLUDING this one (used when the chain is up)
 * @param {number} p.maxAttempts attempt budget when the chain is up
 * @param {number} [p.outageFirstAtMs] when this filing first met the outage
 * @param {number} [p.outageRetries] outage retries so far INCLUDING this one
 * @param {number} p.nowMs
 * @param {boolean} p.hasVerifiedNumbers whether parser-verified figures exist to deliver without the narrative
 * @returns {{action: 'RETRY'|'DEGRADE'|'ESCALATE', countAttempt: boolean, delayMs: number}}
 */
export function decideLlmFailureAction({ chainDown, attempts = 1, maxAttempts = 3, outageFirstAtMs, outageRetries = 1, nowMs, hasVerifiedNumbers }) {
  if (chainDown) {
    const elapsed = Math.max(0, nowMs - (Number.isFinite(outageFirstAtMs) ? outageFirstAtMs : nowMs));
    if (hasVerifiedNumbers && elapsed >= OUTAGE_DEGRADE_AFTER_MS) return { action: 'DEGRADE', countAttempt: false, delayMs: 0 };
    if (!hasVerifiedNumbers && elapsed >= OUTAGE_GIVE_UP_AFTER_MS) return { action: 'ESCALATE', countAttempt: false, delayMs: 0 };
    return { action: 'RETRY', countAttempt: false, delayMs: backoffDelayMs(outageRetries) };
  }
  if (attempts < maxAttempts) return { action: 'RETRY', countAttempt: true, delayMs: backoffDelayMs(attempts) };
  return { action: hasVerifiedNumbers ? 'DEGRADE' : 'ESCALATE', countAttempt: true, delayMs: 0 };
}
