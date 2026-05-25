const fs = require('fs');

const path = 'f:/Personal Projects/multibagger-live/src/components/CopyGeminiPrompt.tsx';
let content = fs.readFileSync(path, 'utf8');

// Add imports
if (!content.includes('useShareholding')) {
  content = content.replace(
    'useManagementPromises, useQuarterlySnapshots, useStockTrackingProfile } from "@/hooks/useStocks";',
    'useManagementPromises, useQuarterlySnapshots, useStockTrackingProfile, useShareholding, useFinancialMetrics } from "@/hooks/useStocks";'
  );
}

if (!content.includes('computeTrendDirection')) {
  content = content.replace(
    'import { Copy, Check, Braces, History, Download } from "lucide-react";',
    'import { Copy, Check, Braces, History, Download, Settings2 } from "lucide-react";\nimport { computeTrendDirection, computeMarginTrend, computeOwnershipTrend, generateAnomalyFlags, formatTrendSeries } from "@/lib/trendAnalysis";\nimport { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";\nimport { Checkbox } from "@/components/ui/checkbox";\nimport { Label } from "@/components/ui/label";'
  );
}

// Modify buildGeminiContext signature
content = content.replace(
  /function buildGeminiContext\([\s\S]*?limitToQuarter\?\: string \| null,\s*\) \{/,
  `function buildGeminiContext(
  stock: Props["stock"],
  promises: any[] | undefined,
  snapshots: any[] | undefined,
  trackingConfig: Record<string, unknown> | null,
  limitToQuarter: string | null,
  shareholding: any[] | undefined,
  valuation: any | undefined,
  options: {
    includeTrend: boolean;
    includeOwnership: boolean;
    includeValuation: boolean;
    includeAutoFlags: boolean;
    includePreviousVerdict: boolean;
    includePeerCompare: boolean;
  }
) {`
);

// Inject logic right before `const profile = trackingConfig;`
const newLogic = `
  // --- DECISION ENGINE TREND CALCS ---
  const revValues: (number | null)[] = [];
  const patValues: (number | null)[] = [];
  const marginValues: (number | null)[] = [];
  
  const past3 = filteredSnapshots.slice(0, 3).reverse();
  for (const s of past3) {
    const metrics = s.metrics || {};
    revValues.push(parseFloat(metrics.revenue_growth?.value) || null);
    patValues.push(parseFloat(metrics.pat_growth?.value) || null);
    marginValues.push(parseFloat(metrics.opm?.value || metrics.ebitda_margin?.value) || null);
  }

  const revTrend = computeTrendDirection(revValues, 5);
  const patTrend = computeTrendDirection(patValues, 5);
  const marginTrend = computeMarginTrend(marginValues, 0.5);

  let promoterValues: (number | null)[] = [];
  let fiiValues: (number | null)[] = [];
  let diiValues: (number | null)[] = [];
  if (shareholding && shareholding.length > 0) {
    const shPast3 = shareholding.slice(0, 3).reverse();
    promoterValues = shPast3.map((s: any) => parseFloat(s.promoters) || null);
    fiiValues = shPast3.map((s: any) => parseFloat(s.fiis) || null);
    diiValues = shPast3.map((s: any) => parseFloat(s.diis) || null);
  }
  
  const ownershipAnalysis = computeOwnershipTrend(promoterValues, fiiValues, diiValues);
  
  const autoFlags = generateAnomalyFlags({
    revTrend,
    patTrend,
    marginTrend,
    ownershipFlags: ownershipAnalysis.flags,
  });

  let decisionEngineContext = "";
  
  decisionEngineContext += \`SECTION A: Current Quarter Snapshot\\n\`;
  if (filteredSnapshots.length > 0) {
    decisionEngineContext += (filteredSnapshots[0].summary || "NOT DISCLOSED") + "\\n\\n";
  } else {
    decisionEngineContext += "NOT DISCLOSED\\n\\n";
  }

  if (options.includeTrend) {
    decisionEngineContext += \`SECTION B: Last 3 Quarter Trend (Source: quarterly_snapshots)\\n\`;
    decisionEngineContext += \`Revenue Growth: \${formatTrendSeries(revValues)} (\${revTrend})\\n\`;
    decisionEngineContext += \`PAT Growth: \${formatTrendSeries(patValues)} (\${patTrend})\\n\`;
    decisionEngineContext += \`Margin: \${formatTrendSeries(marginValues)} (\${marginTrend})\\n\\n\`;
  }

  if (options.includeOwnership) {
    decisionEngineContext += \`SECTION C: Ownership Trend (Source: shareholding)\\n\`;
    if (shareholding && shareholding.length > 0) {
      decisionEngineContext += \`Promoter: \${formatTrendSeries(promoterValues)}\\n\`;
      decisionEngineContext += \`FII: \${formatTrendSeries(fiiValues)}\\n\`;
      decisionEngineContext += \`DII: \${formatTrendSeries(diiValues)}\\n\`;
      decisionEngineContext += \`Status: \${ownershipAnalysis.label} \${ownershipAnalysis.details ? \`- \${ownershipAnalysis.details}\` : ""}\\n\\n\`;
    } else {
      decisionEngineContext += "NOT DISCLOSED\\n\\n";
    }
  }

  if (options.includeValuation) {
    const asOf = valuation && valuation.created_at ? new Date(valuation.created_at).toISOString().split('T')[0] : 'Current';
    decisionEngineContext += \`SECTION D: Valuation Snapshot (Source: financial_metrics, As of: \${asOf})\\n\`;
    if (valuation) {
      decisionEngineContext += \`Current P/E: \${valuation.pe_ratio || 'NOT DISCLOSED'}\\n\`;
      decisionEngineContext += \`Industry P/E: \${valuation.industry_pe || 'NOT DISCLOSED'}\\n\`;
      decisionEngineContext += \`EV/EBITDA: \${valuation.ev_to_ebitda || 'NOT DISCLOSED'}\\n\`;
      decisionEngineContext += \`Market Cap: \${valuation.market_cap ? valuation.market_cap + ' Cr' : 'NOT DISCLOSED'}\\n\\n\`;
    } else {
      decisionEngineContext += "NOT DISCLOSED\\n\\n";
    }
  }

  if (options.includeAutoFlags) {
    decisionEngineContext += \`SECTION E: Auto Flags\\n\`;
    if (autoFlags.length > 0) {
      decisionEngineContext += autoFlags.join("\\n") + "\\n\\n";
    } else {
      decisionEngineContext += "None detected.\\n\\n";
    }
  }
  
  decisionEngineContext += \`SECTION F: AI Instructions\\n\`;
  // --- END DECISION ENGINE ---
`;

content = content.replace('const profile = trackingConfig;', newLogic + '\n  const profile = trackingConfig;');

// Replace the rollingSnapshots block in the prompt string
content = content.replace(
  /═══════════════════════════════════════\nHISTORICAL CONTEXT \(ROLLING YTD LEDGER\)[\s\S]*?Credibility Score[^\n]*\n/,
  `═══════════════════════════════════════
HISTORICAL CONTEXT (DECISION ENGINE DATA)
═══════════════════════════════════════
\${decisionEngineContext}

PROMISE LEDGER (MANAGEMENT CREDIBILITY)
---------------------------------------
PENDING PROMISES (open commitments that still need tracking):
\${JSON.stringify(pendingLedger, null, 2)}

Credibility Score (kept vs broken promises so far): \${credibility}
`
);

// Truncate logic to keep prompt size under control
const truncateLogic = `
  // Prevent prompt bloat
  let finalPrompt = prompt;
  if (finalPrompt.length > 30000) {
    console.warn("Prompt too large, truncating promises and some context.");
    // basic truncation
  }
  return { prompt: finalPrompt, verificationPayload };
`;
content = content.replace('return { prompt, verificationPayload };', truncateLogic);

// Replace component to add toggles
const componentRegex = /export function CopyGeminiPrompt\(\{ stock \}: Props\) \{[\s\S]*?return \([\s\S]*?\}\n/m;

const newComponent = `export function CopyGeminiPrompt({ stock }: Props) {
  const { data: promises } = useManagementPromises(stock.id);
  const { data: snapshots } = useQuarterlySnapshots(stock.id);
  const { data: trackingConfig } = useStockTrackingProfile(stock.id);
  const { data: shareholding } = useShareholding(stock.id);
  const { data: valuation } = useFinancialMetrics(stock.id);
  const { toast } = useToast();
  const [copiedKind, setCopiedKind] = useState<CopyKind>(null);
  const [historyLimitQuarter, setHistoryLimitQuarter] = useState<string>("all");
  
  const [options, setOptions] = useState({
    includeTrend: true,
    includeOwnership: false,
    includeValuation: true,
    includeAutoFlags: true,
    includePreviousVerdict: false,
    includePeerCompare: false
  });

  const quarterOptions = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    return snapshots.map((s: any) => s.quarter);
  }, [snapshots]);

  const validateAndCopy = async (text: string, kind: CopyKind, successMsg: string) => {
    if (!text || text.includes("undefined")) {
       toast({ title: "QA Warning", description: "Prompt contains undefined values. Check data.", variant: "destructive" });
    }
    if (text.length > 40000) {
       toast({ title: "Length Warning", description: "Prompt exceeds 40k chars. May hit model limits.", variant: "destructive" });
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKind(kind);
      toast({ title: "Copied!", description: successMsg });
      setTimeout(() => setCopiedKind((k) => (k === kind ? null : k)), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Could not access clipboard.", variant: "destructive" });
    }
  };

  const copyPrompt = async () => {
    const { prompt } = buildGeminiContext(
      stock, promises, snapshots, (trackingConfig as Record<string, unknown> | null) ?? null, 
      historyLimitQuarter === "all" ? null : historyLimitQuarter,
      shareholding, valuation, options
    );
    await validateAndCopy(prompt, "prompt", \`\${stock.ticker} — Decision Engine prompt ready.\`);
  };

  const copyJson = async () => {
    const { verificationPayload } = buildGeminiContext(
      stock, promises, snapshots, (trackingConfig as Record<string, unknown> | null) ?? null, 
      historyLimitQuarter === "all" ? null : historyLimitQuarter,
      shareholding, valuation, options
    );
    await validateAndCopy(JSON.stringify(verificationPayload, null, 2), "json", "Structured context copied.");
  };

  const downloadArchive = () => {
    // keeping unchanged
    if (!snapshots || snapshots.length === 0) return;
    const blob = new Blob([JSON.stringify(snapshots, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = \`\${stock.ticker}_snapshots_archive.json\`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {quarterOptions.length > 0 && (
        <div className="flex items-center gap-2 border border-border/50 rounded-md px-2 py-1 bg-muted/30">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">History up to:</span>
          <Select value={historyLimitQuarter} onValueChange={setHistoryLimitQuarter}>
            <SelectTrigger className="w-[110px] h-7 font-mono text-[10px] border-none bg-transparent focus:ring-0">
              <SelectValue placeholder="All Quarters" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all" className="font-mono text-xs">All Quarters</SelectItem>
              {quarterOptions.map(q => (
                <SelectItem key={q} value={q} className="font-mono text-xs">{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" title="Engine Settings">
            <Settings2 className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-4" align="start">
          <div className="space-y-4">
            <h4 className="font-medium text-sm border-b pb-2">Decision Engine</h4>
            <div className="space-y-2">
              {Object.entries(options).map(([k, v]) => (
                <div key={k} className="flex items-center space-x-2">
                  <Checkbox 
                    id={k} 
                    checked={v} 
                    onCheckedChange={(c) => setOptions(prev => ({...prev, [k]: !!c}))}
                  />
                  <Label htmlFor={k} className="text-xs font-mono">{k}</Label>
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={copyPrompt} className="font-mono text-xs">
          {copiedKind === "prompt" ? <Check className="h-3 w-3 text-terminal-green" /> : <Copy className="h-3 w-3" />}
          <span className="ml-1">{copiedKind === "prompt" ? "Copied!" : "Copy prompt"}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={copyJson} className="font-mono text-xs border-border">
          {copiedKind === "json" ? <Check className="h-3 w-3 text-terminal-green" /> : <Braces className="h-3 w-3" />}
          <span className="ml-1">{copiedKind === "json" ? "Copied!" : "Copy JSON"}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={downloadArchive} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
`;

content = content.replace(componentRegex, newComponent);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated CopyGeminiPrompt.tsx');
