/**
 * Post-Disclosure Reaction & Rally Explanation Engine
 *
 * Provides two independently-sourced evaluations:
 * 1. Business thesis progress (grounded strictly in company filings, verified drivers, guidance).
 * 2. Plausible price explanation (grounded in timestamped exchange disclosures and event-window returns).
 *
 * Prevents correlation-to-causation fallacies and distinguishes persistent moves from cooled rallies.
 */

const round2 = (n) => (n === null || n === undefined || isNaN(n)) ? null : Math.round(n * 100) / 100;

/**
 * Detects whether an initial price rally has cooled off across successive trading sessions.
 */
export function detectRallyCooling(priceReaction) {
  if (!priceReaction || priceReaction.status !== "OBSERVED") {
    return { coolingDetected: false, peakReturnPct: null, currentReturnPct: null, drawdownPp: 0 };
  }

  const observedReturns = [];
  if (priceReaction.windows) {
    for (const key of Object.keys(priceReaction.windows)) {
      const w = priceReaction.windows[key];
      if (w && w.status === "OBSERVED" && typeof w.returnPct === "number") {
        observedReturns.push(w.returnPct);
      }
    }
  }

  if (priceReaction.latest && typeof priceReaction.latest.returnPct === "number") {
    observedReturns.push(priceReaction.latest.returnPct);
  }

  if (observedReturns.length === 0) {
    return { coolingDetected: false, peakReturnPct: null, currentReturnPct: null, drawdownPp: 0 };
  }

  const peakReturnPct = Math.max(...observedReturns);
  const currentReturnPct = priceReaction.latest?.returnPct ?? observedReturns[observedReturns.length - 1];
  const drawdownPp = round2(peakReturnPct - currentReturnPct);

  // Cooling is identified when an earlier peak (>4% gain) gives up 3+ percentage points
  const coolingDetected = peakReturnPct >= 4.0 && drawdownPp >= 3.0;

  return {
    coolingDetected,
    peakReturnPct: round2(peakReturnPct),
    currentReturnPct: round2(currentReturnPct),
    drawdownPp: Math.max(0, drawdownPp)
  };
}

/**
 * Filters candidate catalysts to strictly exclude events published after the measured window.
 */
export function filterValidCandidateCatalysts(candidateEvents = [], cutoffTime = new Date()) {
  if (!Array.isArray(candidateEvents)) return [];
  const cutoff = new Date(cutoffTime).getTime();
  if (isNaN(cutoff)) return [];

  return candidateEvents.filter(event => {
    if (!event || !event.publishedAt) return false;
    const pubTime = new Date(event.publishedAt).getTime();
    return !isNaN(pubTime) && pubTime <= cutoff;
  });
}

/**
 * Classifies the relationship between verified fundamental progress and market price reaction.
 */
export function classifyRallyOrReaction({
  publishedAt,
  thesisAssessment = {},
  priceReaction = null,
  candidateEvents = []
} = {}) {
  if (!priceReaction || priceReaction.status !== "OBSERVED") {
    return {
      label: "INSUFFICIENT_DATA",
      thesisProgress: false,
      coolingDetected: false,
      explanation: "Market price reaction history is unavailable or incomplete."
    };
  }

  const cooling = detectRallyCooling(priceReaction);
  const cutoff = priceReaction.latest?.date ? new Date(`${priceReaction.latest.date}T15:30:00+05:30`) : new Date();
  const validCatalysts = filterValidCandidateCatalysts(candidateEvents, cutoff);

  const confirmedCount = Array.isArray(thesisAssessment?.confirmedDrivers) ? thesisAssessment.confirmedDrivers.length : 0;
  const atRiskCount = Array.isArray(thesisAssessment?.atRiskDrivers) ? thesisAssessment.atRiskDrivers.length : 0;

  const thesisProgress = thesisAssessment.progressState === "PROGRESSING" || (confirmedCount > 0 && atRiskCount === 0);
  const thesisDeterioration = thesisAssessment.progressState === "DETERIORATING" || atRiskCount > 0;

  const latestReturn = priceReaction.latest?.returnPct ?? 0;
  const excessReturn = priceReaction.latest?.excessReturnPp ?? 0;
  const significantMove = latestReturn >= 4.0 || excessReturn >= 3.0;

  let label;
  let explanation;

  if (thesisProgress && thesisDeterioration) {
    label = "CONFLICTING_EVIDENCE";
    explanation = "Company filings show conflicting indicators: some drivers confirmed while others face margin erosion or delays.";
  } else if (thesisProgress && significantMove && !cooling.coolingDetected) {
    label = "THESIS_PROGRESS_WITH_PRICE_CONFIRMATION";
    explanation = "Fundamental progress confirmed by market performance with sustained excess return over benchmark.";
  } else if (thesisProgress && (cooling.coolingDetected || !significantMove)) {
    label = "THESIS_PROGRESS_PRICE_UNCONFIRMED";
    explanation = cooling.coolingDetected
      ? `Fundamental progress verified from official filings, but post-filing price surge cooled (${cooling.drawdownPp} pp drawdown from peak).`
      : "Fundamental progress verified from official filings, but market price reaction remained muted or unconfirmed.";
  } else if (!thesisProgress && significantMove) {
    label = "PRICE_MOVE_WITHOUT_VERIFIED_CATALYST";
    explanation = `Significant price move (+${latestReturn.toFixed(2)}%) observed without verifiable fundamental catalyst in company filings.`;
  } else {
    label = thesisProgress ? "THESIS_PROGRESS_PRICE_UNCONFIRMED" : "NO_CATALYST_DETECTED";
    explanation = "No decisive fundamental progression or market price confirmation observed.";
  }

  return {
    label,
    thesisProgress,
    coolingDetected: cooling.coolingDetected,
    drawdownPp: cooling.drawdownPp,
    peakReturnPct: cooling.peakReturnPct,
    currentReturnPct: cooling.currentReturnPct,
    candidateCatalysts: validCatalysts,
    explanation: `${explanation} (Price movement is separate evidence; never treat price direction as proof of causation).`
  };
}
