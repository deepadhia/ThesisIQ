const fs = require('fs');
const p = 'f:/Personal Projects/multibagger-live/src/components/AddStockDialog.tsx';
let lines = fs.readFileSync(p, 'utf8').split('\n');

// We know setLoading(true) is at line 163 (1-indexed). So lines[162] is setLoading(true);
// and the end of the block is around line 247:     })();

let startIdx = lines.findIndex(l => l.includes('setLoading(true);') && l.includes('const { data: inserted, error }'));
// wait, setLoading(true) is on its own line: `    setLoading(true);`
startIdx = lines.findIndex(l => l.includes('setLoading(true);'));
let endIdx = lines.findIndex(l => l.includes('    })();')) + 1; // inclusive

const replacement = `    setLoading(true);
    
    try {
      const res = await apiFetch("/api/stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: cn,
          ticker: t,
          sector: sector.trim() || null,
          category,
          buy_price: buyPrice ? Number(buyPrice) : null,
          investment_thesis: thesis.trim() || null,
          screener_slug: slug,
          bse_scrip_code: bseScripCode.trim() || null,
          profileConfig
        })
      });
      
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to add stock via API");
      }
      
      const stockId = data.stock.id;
      
      queryClient.invalidateQueries({ queryKey: ["stock", stockId] });
      queryClient.invalidateQueries({ queryKey: ["stocks"] });
      if (profileConfig) {
        queryClient.invalidateQueries({ queryKey: ["stock-tracking-profile", stockId] });
      }
      
      setLoading(false);
      setOpen(false);

      toast({
        title: "Stock added",
        description: \`Fetching price, financials & filings for \${t} in background…\`,
      });

      // Transcripts fetch still triggered from UI side for now, 
      // but financials/price are strictly handled by the backend event.
      (async () => {
        try {
          await apiFetch("/api/transcripts/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbols: [t],
              onlyMissing: true,
              uploadAfterDownload: true,
              window: "1y",
            }),
          });
          queryClient.invalidateQueries({ queryKey: ["transcripts-files"] });
        } catch (_) {}
      })();
    } catch (err: any) {
      setLoading(false);
      toast({ title: "Error", description: err.message || "Failed to add stock", variant: "destructive" });
    }`;

lines.splice(startIdx, endIdx - startIdx, replacement);

// Also need to import apiFetch if not imported
if (!lines.some(l => l.includes('import { apiFetch } from'))) {
  lines.unshift('import { apiFetch } from "@/lib/apiFetch";');
}

fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('Updated AddStockDialog.tsx with correct architecture.');
