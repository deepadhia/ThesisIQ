/**
 * Thesis Driver Context Service
 *
 * Turns each stock's driver-level thesis contract (backend/config/thesis-contracts/driver-level-thesis-contracts.json)
 * into (a) a prompt block telling the analysis exactly which thesis drivers to verify against a new
 * result / presentation / concall, (b) a sanitised per-driver assessment, and (c) a Telegram section.
 *
 * Every filing is therefore judged against the thesis ("what must be true" / "what would falsify it"),
 * not just against generic growth numbers.
 */

import fs from "fs";
import { findThesisContractFile } from "../utils/thesis-contract-files.js";

let cachedContracts = null;

export function loadThesisContracts() {
  if (cachedContracts) return cachedContracts;
  const map = new Map();
  const readInto = (fileName, { override, required = false }) => {
    try {
      const contractsPath = findThesisContractFile(fileName);
      if (!contractsPath) {
        // Not silent any more: without this file no stock has a driver board and every digest says "no driver evidence".
        if (required) console.warn(`[THESIS DRIVERS] ${fileName} not found (expected in backend/config/thesis-contracts/). No stock will have thesis drivers.`);
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(contractsPath, "utf8"));
      const list = parsed.contracts || parsed || [];
      for (const c of list) {
        if (!c || !c.ticker) continue;
        const key = String(c.ticker).toUpperCase();
        if (override || !map.has(key)) map.set(key, c);
      }
    } catch (err) {
      console.warn(`[THESIS DRIVERS] Could not load ${fileName}:`, err.message);
    }
  };
  readInto("driver-level-thesis-contracts.json", { override: true, required: true });
  readInto("supplementary-thesis-contracts.json", { override: false });
  cachedContracts = map;
  return map;
}

export function getThesisContract(ticker) {
  return loadThesisContracts().get(String(ticker || "").toUpperCase().trim()) || null;
}

/**
 * The stored investment_thesis is usually JSON ({"primary_thesis": "..."}); some rows are plain text.
 */
export function extractPrimaryThesis(rawThesis) {
  if (!rawThesis) return "";
  const t = String(rawThesis).trim();
  if (t.startsWith("{")) {
    try {
      const parsed = JSON.parse(t);
      const parts = [parsed.primary_thesis];
      if (Array.isArray(parsed.key_catalysts) && parsed.key_catalysts.length) parts.push(`Catalysts: ${parsed.key_catalysts.join("; ")}`);
      if (Array.isArray(parsed.risk_factors) && parsed.risk_factors.length) parts.push(`Risks: ${parsed.risk_factors.join("; ")}`);
      if (Array.isArray(parsed.conviction_drivers) && parsed.conviction_drivers.length) parts.push(`Conviction drivers: ${parsed.conviction_drivers.join("; ")}`);
      return parts.filter(Boolean).join(" | ");
    } catch (_) {
      return t;
    }
  }
  return t;
}

/**
 * Stocks the pipeline cannot judge against a real thesis: a placeholder-length thesis AND no driver contract.
 * @param {Array<{ticker:string, investment_thesis?:string}>} stocks
 * @returns {string[]} tickers
 */
export function findThesisGaps(stocks = []) {
  return stocks
    .filter(st => extractPrimaryThesis(st.investment_thesis).length < 120 && !getThesisContract(st.ticker))
    .map(st => st.ticker);
}

/**
 * Prompt block: primary thesis + the drivers that must be verified against the filing.
 */
export function buildThesisContext(ticker, rawThesis) {
  const primary = extractPrimaryThesis(rawThesis);
  const contract = getThesisContract(ticker);
  const lines = [];
  lines.push(primary ? `Primary thesis: ${primary}` : "Primary thesis: Growth investing, clean balance sheet, high ROCE.");
  if (contract) {
    if (contract.thesisTitle) lines.push(`Thesis contract: ${contract.thesisTitle}`);
    const drivers = Array.isArray(contract.drivers) ? contract.drivers : [];
    if (drivers.length) {
      lines.push("Thesis drivers to verify against THIS filing (each has a 'must be true' condition and a falsification trigger):");
      drivers.forEach((d, i) => {
        lines.push(`${i + 1}. ${d.name} [${d.materiality || "MEDIUM"} materiality] — MUST BE TRUE: ${d.mustBeTrue || "n/a"} | FALSIFIED IF: ${d.falsificationTrigger || "n/a"}`);
      });
    }
  }
  return { text: lines.join("\n"), contract, drivers: contract?.drivers || [] };
}

export const DRIVER_ASSESSMENT_PROMPT_RULES = `
── Thesis Driver Verification (MANDATORY when thesis drivers are listed) ──
For EVERY listed thesis driver return one entry in "thesis_driver_assessment":
  • status = "CONFIRMED" (this filing provides evidence the driver is working), "ON_TRACK" (consistent, not conclusive),
    "AT_RISK" (evidence of slippage but the falsification trigger is not met), "BROKEN" (the falsification trigger is
    EXPLICITLY met by facts in this filing), or "NO_EVIDENCE" (the filing does not address this driver).
  • evidence = <=200 characters quoting concrete facts / numbers from THIS filing. For NO_EVIDENCE write "No new evidence in this filing".
  • NEVER mark BROKEN or CONFIRMED without quoting a figure or statement from the filing. Do NOT reuse the contract's old evidence.`;

const VALID_STATUS = new Set(["CONFIRMED", "ON_TRACK", "AT_RISK", "BROKEN", "NO_EVIDENCE"]);
const STATUS_SEVERITY = { BROKEN: 4, AT_RISK: 3, CONFIRMED: 2, ON_TRACK: 1, NO_EVIDENCE: 0 };

function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Validates an LLM driver assessment against the contract: only known drivers, valid statuses,
 * evidence required for BROKEN / CONFIRMED (otherwise downgraded), every contract driver present.
 */
export function normalizeDriverAssessment(rawAssessments, drivers = []) {
  if (!drivers.length) return [];
  const byName = new Map(drivers.map(d => [normalizeName(d.name), d]));
  const out = new Map();

  const arr = Array.isArray(rawAssessments) ? rawAssessments : [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const key = normalizeName(raw.driver || raw.name);
    let contractDriver = byName.get(key);
    if (!contractDriver) {
      // tolerate partial names from the model
      for (const [k, d] of byName.entries()) {
        if (key && (k.includes(key) || key.includes(k))) { contractDriver = d; break; }
      }
    }
    if (!contractDriver) continue;

    let status = String(raw.status || "").toUpperCase().replace(/[\s-]+/g, "_");
    if (!VALID_STATUS.has(status)) status = "NO_EVIDENCE";
    let evidence = String(raw.evidence || "").replace(/\s+/g, " ").trim().slice(0, 220);
    const hasEvidence = evidence.length >= 12 && !/^no new evidence/i.test(evidence);
    if ((status === "BROKEN" || status === "CONFIRMED") && !hasEvidence) {
      status = status === "BROKEN" ? "AT_RISK" : "ON_TRACK";
    }
    if (status === "NO_EVIDENCE") evidence = "No new evidence in this filing";

    const prev = out.get(contractDriver.name);
    if (!prev || STATUS_SEVERITY[status] > STATUS_SEVERITY[prev.status]) {
      out.set(contractDriver.name, {
        driver: contractDriver.name,
        status,
        evidence,
        materiality: contractDriver.materiality || "MEDIUM",
        falsificationTrigger: contractDriver.falsificationTrigger || null
      });
    }
  }

  return drivers.map(d => out.get(d.name) || {
    driver: d.name,
    status: "NO_EVIDENCE",
    evidence: "No new evidence in this filing",
    materiality: d.materiality || "MEDIUM",
    falsificationTrigger: d.falsificationTrigger || null
  });
}

/**
 * Merges several partial assessments (one per transcript chunk): the most informative / most severe status wins.
 */
export function mergeDriverAssessments(list, drivers = []) {
  const flat = [];
  for (const a of list) if (Array.isArray(a)) flat.push(...a);
  return normalizeDriverAssessment(flat, drivers);
}

export function summarizeDriverAssessment(assessment = []) {
  const broken = assessment.filter(a => a.status === "BROKEN");
  const atRisk = assessment.filter(a => a.status === "AT_RISK");
  const confirmed = assessment.filter(a => a.status === "CONFIRMED");
  const onTrack = assessment.filter(a => a.status === "ON_TRACK");
  const noEvidence = assessment.filter(a => a.status === "NO_EVIDENCE");
  const highBroken = broken.filter(a => String(a.materiality).toUpperCase() === "HIGH");
  const highAtRisk = atRisk.filter(a => String(a.materiality).toUpperCase() === "HIGH");
  return { broken, atRisk, confirmed, onTrack, noEvidence, highBroken, highAtRisk, hasSignal: assessment.length > 0 && noEvidence.length < assessment.length };
}

const STATUS_EMOJI = { CONFIRMED: "✅", ON_TRACK: "🟢", AT_RISK: "🟠", BROKEN: "🔴", NO_EVIDENCE: "⚪" };

/**
 * Telegram section "THESIS DRIVER CHECK" (silent drivers are collapsed into one line).
 */
export function formatDriverAssessmentSection(assessment = []) {
  if (!assessment.length) return "";
  const s = summarizeDriverAssessment(assessment);
  if (!s.hasSignal) {
    return `\n🧭 *THESIS DRIVER CHECK:* ⚪ This filing did not speak to any thesis driver.\n`;
  }
  const order = ["BROKEN", "AT_RISK", "CONFIRMED", "ON_TRACK"];
  const rows = [];
  for (const st of order) {
    for (const a of assessment.filter(x => x.status === st)) {
      rows.push(`${STATUS_EMOJI[st]} *${a.driver}* — ${a.evidence}`);
      if (st === "BROKEN" && a.falsificationTrigger) rows.push(`   ↳ _Falsification trigger hit:_ ${a.falsificationTrigger}`);
    }
  }
  if (s.noEvidence.length > 0) {
    rows.push(`⚪ _${s.noEvidence.length} driver(s) not addressed in this filing_`);
  }
  return `\n🧭 *THESIS DRIVER CHECK:*\n${rows.join("\n")}\n`;
}
