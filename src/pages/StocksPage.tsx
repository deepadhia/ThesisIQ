import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useSnapshotCounts, useStocks } from "@/hooks/useStocks";
import { useAllSnapshots } from "@/hooks/usePortfolioData";
import { latestSnapshotQuarterContext } from "@/lib/snapshotPortfolioRank";
import { SnapshotThesisBadge } from "@/components/SnapshotThesisBadge";
import { ActionableVerdictBadges } from "@/components/ActionableVerdictBadges";
import { AddStockDialog } from "@/components/AddStockDialog";
import { PortfolioAiBriefButton } from "@/components/PortfolioAiBriefButton";
import { SentimentBadge } from "@/components/SentimentBadge";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, RefreshCw, Loader2, ChevronDown, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiFetch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function StocksPage() {
  const { data: stocks, isLoading } = useStocks();
  const { data: snapshotCounts } = useSnapshotCounts();
  const { data: allSnapshots } = useAllSnapshots();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [resettingDocs, setResettingDocs] = useState(false);
  const [resettingJson, setResettingJson] = useState(false);

  const refreshActions = [
    { key: "prices", label: "Refresh Prices" },
    { key: "financials", label: "Refresh Financials" },
    { key: "backfill", label: "Backfill 3Y Prices" },
    { key: "results", label: "Fetch Results Dates" },
  ];

  const handleRefresh = async (key: string) => {
    if (!stocks?.length && key !== "results") return;
    setRefreshing(key);

    try {
      if (key === "prices") {
        let success = 0, failed = 0;
        for (const stock of stocks!) {
          try {
            const r = await apiFetch("/api/prices/fetch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ticker: stock.ticker }),
            });
            r.ok ? success++ : failed++;
          } catch { failed++; }
        }
        queryClient.invalidateQueries({ queryKey: ["prices"] });
        toast({ title: "Prices refreshed", description: `${success} updated, ${failed} failed` });

      } else if (key === "financials") {
        let success = 0, failed = 0;
        for (const stock of stocks!) {
          if (success + failed > 0) await new Promise(r => setTimeout(r, 2000));
          try {
            const r = await apiFetch("/api/financials/fetch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                stock_id: stock.id,
                ticker: stock.ticker,
                screener_slug: stock.screener_slug || stock.ticker,
              }),
            });
            r.ok ? success++ : failed++;
          } catch { failed++; }
        }
        queryClient.invalidateQueries({ queryKey: ["financial-metrics"] });
        queryClient.invalidateQueries({ queryKey: ["financial-results"] });
        toast({ title: "Financials refreshed", description: `${success} updated, ${failed} failed` });

      } else if (key === "backfill") {
        const r = await apiFetch("/api/prices/refresh-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backfill: true }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error ?? `Request failed: ${r.status}`);
        queryClient.invalidateQueries({ queryKey: ["prices"] });
        queryClient.invalidateQueries({ queryKey: ["all-prices"] });
        toast({ title: "3Y Price Backfill Complete", description: data?.message || "Historical prices loaded" });

      } else if (key === "results") {
        const { data, error } = await supabase.functions.invoke("fetch-results-calendar");
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["stocks"] });
        toast({ title: "Results dates updated", description: data?.message || `${data?.updated || 0} stocks updated` });
      }
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }

    setRefreshing(null);
  };

  // Fetch latest analysis per stock
  const { data: latestAnalysis } = useQuery({
    queryKey: ["latest-analysis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transcript_analysis")
        .select("stock_id, sentiment_score, management_tone")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map: Record<string, { sentiment_score: number | null; management_tone: string | null }> = {};
      data.forEach((a) => { if (!map[a.stock_id]) map[a.stock_id] = a; });
      return map;
    },
  });

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const { error } = await supabase.from("stocks").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["stocks"] });
      toast({ title: "Stock deleted" });
    }
  };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "Core": return "bg-terminal-green/20 text-terminal-green border-terminal-green/30";
      case "Starter": return "bg-terminal-cyan/20 text-terminal-cyan border-terminal-cyan/30";
      default: return "bg-terminal-amber/20 text-terminal-amber border-terminal-amber/30";
    }
  };

  const snapshotCtxByStockId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof latestSnapshotQuarterContext>>();
    if (!stocks?.length) return map;
    for (const stock of stocks) {
      const snaps = (allSnapshots || []).filter((s) => s.stock_id === stock.id);
      map.set(stock.id, latestSnapshotQuarterContext(snaps));
    }
    return map;
  }, [stocks, allSnapshots]);

  /** Thesis tier → confidence on latest quarter, then snapshot count, then ticker. */
  const sortedStocks = useMemo(() => {
    if (!stocks) return [];
    const counts = snapshotCounts || {};
    return [...stocks].sort((a, b) => {
      const ca = snapshotCtxByStockId.get(a.id) ?? null;
      const cb = snapshotCtxByStockId.get(b.id) ?? null;
      if (ca && cb) {
        if (cb.consolidatedSortScore !== ca.consolidatedSortScore) {
          return cb.consolidatedSortScore - ca.consolidatedSortScore;
        }
      } else if (ca && !cb) return -1;
      else if (!ca && cb) return 1;
      const cna = counts[a.id] || 0;
      const cnb = counts[b.id] || 0;
      if (cnb !== cna) return cnb - cna;
      return (a.ticker || "").localeCompare(b.ticker || "", undefined, { sensitivity: "base" });
    });
  }, [stocks, snapshotCounts, snapshotCtxByStockId]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-mono font-bold text-primary terminal-glow">Stocks</h1>
            <p className="text-sm text-muted-foreground font-mono mt-1">
              Rows sort by <span className="text-foreground/90">consolidated score</span> — latest quarter thesis + confidence, plus trajectory when thesis improves or holds across recent quarters. Cohort #k/n after{" "}
              <code className="text-primary text-xs">npm run ranks:quarterly:apply</code>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <PortfolioAiBriefButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono"
                  disabled={!!refreshing}
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  {refreshing
                    ? refreshActions.find(a => a.key === refreshing)?.label || "Refreshing..."
                    : "Refresh Data"}
                  <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="font-mono">
                {refreshActions.map((action) => (
                  <DropdownMenuItem
                    key={action.key}
                    onClick={() => handleRefresh(action.key)}
                    disabled={!!refreshing}
                    className="text-xs"
                  >
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-xs border-terminal-red/40 text-terminal-red hover:bg-terminal-red/10"
              disabled={resettingDocs}
              onClick={async () => {
                if (resettingDocs) return;
                const confirmReset = window.confirm(
                  "This will delete ALL downloaded filings (local PDFs) and their Google Drive copies for all stocks. This cannot be undone. Continue?",
                );
                if (!confirmReset) return;
                setResettingDocs(true);
                try {
                  const r = await apiFetch("/api/transcripts/reset-all", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                  });
                  const data = await r.json().catch(() => ({}));
                  if (!r.ok || !data?.ok) {
                    throw new Error(data?.error || `Reset failed: ${r.status}`);
                  }
                  toast({
                    title: "All documents reset",
                    description: `Deleted ${data.deleted ?? 0} local file(s) and ${data.deletedFromDrive ?? 0} from Drive.`,
                  });
                } catch (e: any) {
                  toast({
                    title: "Reset documents failed",
                    description: e?.message ?? "Unknown error",
                    variant: "destructive",
                  });
                } finally {
                  setResettingDocs(false);
                }
              }}
            >
              {resettingDocs ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Reset documents
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-xs border-terminal-amber/40 text-terminal-amber hover:bg-terminal-amber/10"
              disabled={resettingJson}
              onClick={async () => {
                if (resettingJson) return;
                const confirmReset = window.confirm(
                  "This will reset all AI JSON outputs (quarterly snapshots + promise ledger) for all stocks. This cannot be undone. Continue?",
                );
                if (!confirmReset) return;
                setResettingJson(true);
                try {
                  const r = await apiFetch("/api/stocks/reset-all-json", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                  });
                  const data = await r.json().catch(() => ({}));
                  if (!r.ok || !data?.ok) throw new Error(data?.error || `Reset failed: ${r.status}`);
                  queryClient.invalidateQueries({ queryKey: ["snapshot-counts"] });
                  toast({
                    title: "AI JSON reset complete",
                    description: "Cleared quarterly_snapshots and management_promises for all stocks.",
                  });
                } catch (e: any) {
                  toast({
                    title: "Reset JSON failed",
                    description: e?.message ?? "Unknown error",
                    variant: "destructive",
                  });
                } finally {
                  setResettingJson(false);
                }
              }}
            >
              {resettingJson ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Reset JSON (AI)
            </Button>
            <AddStockDialog />
          </div>
        </div>

        <Card className="bg-card border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full data-grid">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">Company</th>
                  <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">Ticker</th>
                  <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">Sector</th>
                  <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">Category</th>
                  <th
                    className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider"
                    title="Thesis + cohort rank (#1 = best, thesis-first). Filled by ranks:quarterly:apply"
                  >
                    Thesis / rank
                  </th>
                  <th
                    className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider min-w-[8rem]"
                    title="actionable_verdict from latest quarterly Gemini import"
                  >
                    Verdict
                  </th>
                  <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider" title="Count of imported quarterly snapshots">
                    Snapshots
                  </th>
                  <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider">Next Results</th>
                  <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider">Buy Price</th>
                  <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider">Sentiment</th>
                  <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : !stocks?.length ? (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">No stocks added yet.</td></tr>
                ) : (
                  sortedStocks.map((stock) => {
                    const analysis = latestAnalysis?.[stock.id];
                    const snapN = snapshotCounts?.[stock.id] ?? 0;
                    const snapCtx = snapshotCtxByStockId.get(stock.id) ?? null;
                    const pr = snapCtx?.portfolioRank ?? null;
                    return (
                      <tr
                        key={stock.id}
                        onClick={() => navigate(`/stocks/${stock.id}`)}
                        className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
                      >
                        <td className="p-3 font-semibold text-foreground">{stock.company_name}</td>
                        <td className="p-3 text-primary">{stock.ticker}</td>
                        <td className="p-3 text-muted-foreground">{stock.sector || "—"}</td>
                        <td className="p-3">
                          <Badge variant="outline" className={getCategoryColor(stock.category)}>
                            {stock.category}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          {snapCtx ? (
                            <div className="flex flex-col items-center gap-1.5 min-w-[7rem]">
                              <SnapshotThesisBadge thesisStatus={snapCtx.thesisStatus} />
                              <span className="text-[9px] text-muted-foreground font-mono">{snapCtx.quarter}</span>
                              {pr ? (
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[10px] text-primary border-primary/40"
                                  title="Cohort rank for this quarter (thesis-first ordering)"
                                >
                                  #{pr.rank}/{pr.cohortSize}
                                </Badge>
                              ) : (
                                <span className="text-[9px] text-muted-foreground font-mono">No cohort rank</span>
                              )}
                              {snapCtx.trajectoryBonus !== 0 ? (
                                <span
                                  className={`text-[9px] font-mono tabular-nums ${
                                    snapCtx.trajectoryBonus > 0 ? "text-terminal-green" : "text-terminal-amber"
                                  }`}
                                  title="Trajectory bonus from last few quarters (thesis tier path)"
                                >
                                  {snapCtx.trajectoryBonus > 0 ? "+" : ""}
                                  {snapCtx.trajectoryBonus} momentum
                                </span>
                              ) : null}
                              {stock.portfolio_list_rank != null && stock.portfolio_list_cohort_size != null ? (
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[9px] text-terminal-green border-terminal-green/35 max-w-[9rem] whitespace-normal text-center leading-tight"
                                  title={
                                    stock.portfolio_scores_updated_at
                                      ? `Saved list rank · ${new Date(stock.portfolio_scores_updated_at).toLocaleString()} · run ranks:quarterly:apply to refresh`
                                      : "Saved list rank — run ranks:quarterly:apply to refresh"
                                  }
                                >
                                  List #{stock.portfolio_list_rank}/{stock.portfolio_list_cohort_size}
                                </Badge>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3 text-center align-middle">
                          {snapCtx ? (
                            <ActionableVerdictBadges
                              decision={snapCtx.verdict.decision}
                              convictionLevel={snapCtx.verdict.convictionLevel}
                              positionSize={snapCtx.verdict.positionSize}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono text-xs text-muted-foreground tabular-nums">
                          {snapN}
                        </td>
                        <td className="p-3 text-center">
                          {(stock as any).next_results_date ? (
                            <Badge
                              variant="outline"
                              className={`font-mono text-[10px] ${
                                new Date((stock as any).next_results_date) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                                  ? "text-terminal-amber border-terminal-amber/30 bg-terminal-amber/10"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {new Date((stock as any).next_results_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right">{stock.buy_price ? `₹${stock.buy_price}` : "—"}</td>
                        <td className="p-3 text-center">
                          {analysis?.sentiment_score ? <SentimentBadge score={analysis.sentiment_score} /> : "—"}
                        </td>
                        <td className="p-3 text-center">
                          <button onClick={(e) => handleDelete(e, stock.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
