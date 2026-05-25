const fs = require('fs');
const path = 'f:/Personal Projects/multibagger-live/src/components/CopyGeminiPrompt.tsx';
let content = fs.readFileSync(path, 'utf8');

// The logic should look something like this:
/*
  const cutoffDate = filteredSnapshots.length > 0 ? new Date(filteredSnapshots[0].created_at).getTime() : Date.now();

  let filteredShareholding = shareholding || [];
  if (limitToQuarter && filteredSnapshots.length > 0) {
    filteredShareholding = (shareholding || []).filter((s: any) => new Date(s.created_at).getTime() <= cutoffDate);
  }

  let filteredValuation = valuation;
  if (limitToQuarter && filteredSnapshots.length > 0) {
    if (valuation && valuation.created_at && new Date(valuation.created_at).getTime() > cutoffDate) {
      filteredValuation = null;
    }
  }

  // and then replace shareholding with filteredShareholding and valuation with filteredValuation in the rest of the logic.
*/

// First, replace `let promoterValues` section
const targetOwnership = `  let promoterValues: (number | null)[] = [];
  let fiiValues: (number | null)[] = [];
  let diiValues: (number | null)[] = [];
  if (shareholding && shareholding.length > 0) {
    const shPast3 = shareholding.slice(0, 3).reverse();`;

const replacementOwnership = `  const cutoffDate = filteredSnapshots.length > 0 && filteredSnapshots[0].created_at 
    ? new Date(filteredSnapshots[0].created_at).getTime() 
    : Date.now();

  let filteredShareholding = shareholding || [];
  if (limitToQuarter && filteredSnapshots.length > 0) {
    filteredShareholding = (shareholding || []).filter((s: any) => s.created_at && new Date(s.created_at).getTime() <= cutoffDate);
  }

  let filteredValuation = valuation;
  if (limitToQuarter && filteredSnapshots.length > 0) {
    if (valuation && valuation.created_at && new Date(valuation.created_at).getTime() > cutoffDate) {
      filteredValuation = null;
    }
  }

  let promoterValues: (number | null)[] = [];
  let fiiValues: (number | null)[] = [];
  let diiValues: (number | null)[] = [];
  if (filteredShareholding && filteredShareholding.length > 0) {
    const shPast3 = filteredShareholding.slice(0, 3).reverse();`;

content = content.replace(targetOwnership, replacementOwnership);

// replace the check `if (shareholding && shareholding.length > 0)` in SECTION C
content = content.replace('if (shareholding && shareholding.length > 0) {', 'if (filteredShareholding && filteredShareholding.length > 0) {');

// replace valuation usages
const targetValuation = `  if (options.includeValuation) {
    const asOf = valuation && valuation.created_at ? new Date(valuation.created_at).toISOString().split('T')[0] : 'Current';
    decisionEngineContext += \`SECTION D: Valuation Snapshot (Source: financial_metrics, As of: \${asOf})\\n\`;
    if (valuation) {
      decisionEngineContext += \`Relevant P/E: \${valuation.pe_ratio || 'NOT DISCLOSED'}\\n\`;
      decisionEngineContext += \`Industry P/E: \${valuation.industry_pe || 'NOT DISCLOSED'}\\n\`;
      decisionEngineContext += \`EV/EBITDA: \${valuation.ev_to_ebitda || 'NOT DISCLOSED'}\\n\`;
      decisionEngineContext += \`Market Cap: \${valuation.market_cap ? valuation.market_cap + ' Cr' : 'NOT DISCLOSED'}\\n\\n\`;
    } else {
      decisionEngineContext += "NOT DISCLOSED\\n\\n";
    }`;

const replacementValuation = `  if (options.includeValuation) {
    const asOf = filteredValuation && filteredValuation.created_at ? new Date(filteredValuation.created_at).toISOString().split('T')[0] : (limitToQuarter ? 'Historical valuation unavailable' : 'Current');
    decisionEngineContext += \`SECTION D: Valuation Snapshot (Source: financial_metrics, As of: \${asOf})\\n\`;
    if (filteredValuation) {
      decisionEngineContext += \`Relevant P/E: \${filteredValuation.pe_ratio || 'NOT DISCLOSED'}\\n\`;
      decisionEngineContext += \`Industry P/E: \${filteredValuation.industry_pe || 'NOT DISCLOSED'}\\n\`;
      decisionEngineContext += \`EV/EBITDA: \${filteredValuation.ev_to_ebitda || 'NOT DISCLOSED'}\\n\`;
      decisionEngineContext += \`Market Cap: \${filteredValuation.market_cap ? filteredValuation.market_cap + ' Cr' : 'NOT DISCLOSED'}\\n\\n\`;
    } else {
      decisionEngineContext += "NOT DISCLOSED\\n\\n";
    }`;

content = content.replace(targetValuation, replacementValuation);

fs.writeFileSync(path, content, 'utf8');
console.log('Time-travel logic injected.');
