/**
 * AGENTS.md rule 6: every LLM claim is verified against the filing text before it is alerted or saved.
 * Thesis-driver evidence was the one place that escaped the guard, so a model could "confirm" a driver with an
 * invented number. Evidence is now grounded; only grounded evidence is stamped `grounded: true` (the thesis status
 * board trusts nothing else).
 */
import { describe, it, expect } from 'vitest';
import { applyInstitutionalGuard } from '../services/institutional-guard.service.js';

const filing = 'Order book stood at 1,450 Cr at the end of the quarter. Receivable days were 128 days compared with 96 days a year ago. ' +
  'Management reiterated that execution of the new line is on schedule for the third quarter.';

const entry = (driver, status, evidence) => ({ driver, status, evidence, materiality: 'HIGH' });
const verdictWith = (assessment, raw = filing) => ({
  action_signal: 'HOLD', conviction_score: 5, credibility_tier: 'Tier 2', verdict_summary: 'Order book grew.',
  key_drivers: [], commitments: [], thesis_driver_assessment: assessment, _raw_text: raw
});
const byDriver = (out, name) => out.thesis_driver_assessment.find(a => a.driver === name);

describe('thesis driver evidence grounding', () => {
  const out = applyInstitutionalGuard(verdictWith([
    entry('A', 'CONFIRMED', 'Order book stood at 1,450 Cr at the end of the quarter'),
    entry('B', 'AT_RISK', 'Receivable days rose to 340 days from 96 a year ago'),
    entry('C', 'CONFIRMED', 'Revenue of ₹X Cr beat the stated target'),
    entry('D', 'ON_TRACK', 'Management reiterated execution of the new line is on schedule'),
    entry('E', 'NO_EVIDENCE', 'No new evidence in this filing')
  ]), null, 'Earnings Call Transcript', 'TEST');

  it('keeps and stamps evidence whose numbers are printed in the filing', () => {
    expect(byDriver(out, 'A')).toMatchObject({ status: 'CONFIRMED', grounded: true });
  });
  it('drops evidence containing a number the filing never states, and withdraws the status that rested on it', () => {
    expect(byDriver(out, 'B')).toMatchObject({ status: 'NO_EVIDENCE', evidence: 'No new evidence in this filing' });
    expect(byDriver(out, 'B').grounded).not.toBe(true);
  });
  it('drops template placeholders such as ₹X Cr', () => {
    expect(byDriver(out, 'C')).toMatchObject({ status: 'NO_EVIDENCE' });
  });
  it('keeps number-free evidence (nothing to contradict) and stamps it grounded', () => {
    expect(byDriver(out, 'D')).toMatchObject({ status: 'ON_TRACK', grounded: true });
  });
  it('never stamps NO_EVIDENCE rows as grounded', () => {
    expect(byDriver(out, 'E').grounded).not.toBe(true);
  });

  it('cannot verify anything without filing text, so nothing is stamped grounded', () => {
    const noText = applyInstitutionalGuard(verdictWith([entry('A', 'ON_TRACK', 'Order book stood at 1,450 Cr')], ''), null, 'Filing', 'TEST');
    expect(byDriver(noText, 'A').grounded).not.toBe(true);
  });
});
