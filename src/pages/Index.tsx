import { DashboardLayout } from "@/components/DashboardLayout";
import { useStocks, useAllAnalysis } from "@/hooks/useStocks";
import { useAllFinancialMetrics, useAllShareholding, useAllSnapshots, useAllPromises, useAllCommitments } from "@/hooks/usePortfolioData";
import { detectMultibaggerSignals, calculateThesisScore, getThesisStatus, type Signal, type ThesisStatus } from "@/lib/signals";
import { sortSnapshotsByQuarterDesc } from "@/lib/quarterSort";
import { latestSnapshotQuarterContext } from "@/lib/snapshotPortfolioRank";
import { SnapshotThesisBadge } from "@/components/SnapshotThesisBadge";
import { ActionableVerdictBadges } from "@/components/ActionableVerdictBadges";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiFetch";
import {
  BarChart3, TrendingUp, TrendingDown, FileText, Target, Activity,
  ArrowUpRight, ArrowDownRight, RefreshCw, Loader2, Zap, CalendarClock,
  Shield, AlertTriangle, ArrowRight, ChevronUp, ChevronDown, Minus, ExternalLink, Package, ListOrdered,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

function useAllPrices() {
  return useQuery({
    queryKey: ["all-prices"],
    queryFn: async () => {
      // Paginate to get all prices (Supabase default limit is 1000)
      const allData: any[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("prices")
          .select("stock_id, date, price, volume")
          .order("date", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return allData;
    },
  });
}

function useSectorIndices() {
  return useQuery({
    queryKey: ["sector-indices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sector_indices")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

const ReturnBadge = ({ value }: { value: number | null }) => {
  if (value === null) return <span className="font-mono text-muted-foreground text-xs">—</span>;
  const isPositive = value >= 0;
  return (
    <span className={`font-mono text-xs font-semibold flex items-center gap-0.5 ${isPositive ? "text-terminal-green" : "text-terminal-red"}`}>
      {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(value)}%
    </span>
  );
};

const MAX_DATE_GAP_DAYS = 45;

const ThesisStatusBadge = ({ status }: { status: ThesisStatus }) => {
  const config = {
    Strengthening: { color: "text-terminal-green border-terminal-green/30 bg-terminal-green/10", icon: ChevronUp },
    Stable: { color: "text-muted-foreground border-border bg-muted/50", icon: Minus },
    Weakening: { color: "text-terminal-amber border-terminal-amber/30 bg-terminal-amber/10", icon: ChevronDown },
    Broken: { color: "text-terminal-red border-terminal-red/30 bg-terminal-red/10", icon: TrendingDown },
  }[status.status];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`font-mono text-[10px] gap-1 ${config.color}`}>
      <Icon className="h-3 w-3" />
      {status.status}
    </Badge>
  );
};

const Index = () => {
  const { data: stocks } = useStocks();
  const { data: analyses } = useAllAnalysis();
  const { data: allPrices } = useAllPrices();
  const { data: sectorIndicesData } = useSectorIndices();
  const { data: allFinancials } = useAllFinancialMetrics();
  const { data: allShareholding } = useAllShareholding();
  const { data: allSnapshots } = useAllSnapshots();
  const { data: allPromises } = useAllPromises();
  const { data: allCommitments } = useAllCommitments();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [refreshingSectors, setRefreshingSectors] = useState(false);
  const [orderAlerts, setOrderAlerts] = useState<Array<{ stock: any; title: string; date: string; url: string }>>([]);
  const [transcriptAlerts, setTranscriptAlerts] = useState<Array<{ stock: any; title: string; date: string; url: string; type: string; quarter: string }>>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [bulkSyncing, setBulkSyncing] = useState(false);

  const handleScanAnnouncements = async () => {
    setScanning(true);
    try {
      const res = await apiFetch("/api/stocks/scan-announcements", { method: "POST" });
      if (!res.ok) throw new Error("Scan failed");
      toast({ title: "Scan initiated", description: "The scanner is now running in the background. Check Telegram for new alerts." });
      // Refresh local list if needed
      fetchOrderAlerts();
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleBulkSuperSync = async () => {
    const confirm = window.confirm("☢️ NUCLEAR OPTION ☢️\n\nThis will DELETE ALL announcements and documents for ALL shares in the system and start a fresh resync. This will take 10-20 minutes in the background.\n\nAre you absolutely sure?");
    if (!confirm) return;

    setBulkSyncing(true);
    try {
      const res = await apiFetch("/api/transcripts/bulk-super-sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Bulk sync failed");
      
      toast({ 
        title: "Bulk Master Sync Started", 
        description: "Nuclear reset triggered. The system is now resyncing everything for all stocks in the background.",
        variant: "default"
      });
    } catch (err: any) {
      toast({ title: "Bulk Sync Failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkSyncing(false);
    }
  };

  // Fetch new order announcements + transcript links for all stocks
  const fetchOrderAlerts = async () => {
    if (!stocks || stocks.length === 0) return;
    setLoadingOrders(true);
    const allOrders: Array<{ stock: any; title: string; date: string; url: string }> = [];
    const allTranscripts: Array<{ stock: any; title: string; date: string; url: string; type: string; quarter: string }> = [];
    const batches = [];
    for (let i = 0; i < stocks.length; i += 5) {
      batches.push(stocks.slice(i, i + 5));
    }
    for (const batch of batches) {
      await Promise.allSettled(
        batch.map(stock =>
          supabase.functions.invoke("fetch-transcript-links", {
            body: { ticker: stock.ticker, company_name: stock.company_name, screener_slug: stock.screener_slug },
          }).then(({ data }) => {
            if (data?.orders) {
              for (const o of data.orders) {
                allOrders.push({ stock, title: o.title, date: o.date, url: o.url });
              }
            }
            if (data?.transcripts) {
              for (const t of data.transcripts) {
                allTranscripts.push({ stock, title: t.title, date: t.date, url: t.url, type: t.type, quarter: t.quarter });
              }
            }
          })
        )
      );
    }
    allOrders.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    setOrderAlerts(allOrders.slice(0, 10));
    allTranscripts.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    setTranscriptAlerts(allTranscripts);
    setLoadingOrders(false);
  };


  // ── Compute signals & thesis status for each stock ──
  const stockSignals = useMemo(() => {
    if (!stocks) return [];
    return stocks.map(stock => {
      const financials = (allFinancials || []).filter(f => f.stock_id === stock.id);
      const shareholding = (allShareholding || []).filter(s => s.stock_id === stock.id);
      const snapshots = sortSnapshotsByQuarterDesc(
        (allSnapshots || []).filter(s => s.stock_id === stock.id)
      );
      const promises = (allPromises || []).filter(p => p.stock_id === stock.id);
      const commitments = (allCommitments || []).filter(c => c.stock_id === stock.id);
      const stockAnalyses = (analyses || []).filter(a => (a as any).stock_id === stock.id);
      const latestAnalysis = stockAnalyses[0];

      const signals = detectMultibaggerSignals(financials, latestAnalysis, commitments, shareholding, promises, snapshots, stockAnalyses);
      const score = calculateThesisScore(signals);
      const thesisStatus = getThesisStatus(signals, score);

      return { stock, signals, score, thesisStatus };
    });
  }, [stocks, allFinancials, allShareholding, allSnapshots, allPromises, allCommitments, analyses]);

  /** Latest quarter per stock: sort by thesis tier then confidence (#1 cohort rank after ranks:quarterly:apply). */
  const portfolioRankRows = useMemo(() => {
    if (!stocks?.length) return [];
    const rows = stocks.map((stock) => {
      const snaps = (allSnapshots || []).filter((s) => s.stock_id === stock.id);
      const ctx = latestSnapshotQuarterContext(snaps);
      return { stock, ctx };
    });
    return rows.sort((a, b) => {
      if (a.ctx && b.ctx) {
        if (b.ctx.consolidatedSortScore !== a.ctx.consolidatedSortScore) {
          return b.ctx.consolidatedSortScore - a.ctx.consolidatedSortScore;
        }
        return a.stock.ticker.localeCompare(b.stock.ticker, undefined, { sensitivity: "base" });
      }
      if (a.ctx && !b.ctx) return -1;
      if (!a.ctx && b.ctx) return 1;
      return a.stock.ticker.localeCompare(b.stock.ticker, undefined, { sensitivity: "base" });
    });
  }, [stocks, allSnapshots]);

  const portfolioRankCount = portfolioRankRows.filter((r) => r.ctx?.portfolioRank).length;

  // ── Portfolio metrics ──
  const avgScore = stockSignals.length > 0
    ? Math.round(stockSignals.reduce((s, ss) => s + ss.score, 0) / stockSignals.length)
    : 0;
  const strengthening = stockSignals.filter(s => s.thesisStatus.status === "Strengthening").length;
  const weakening = stockSignals.filter(s => s.thesisStatus.status === "Weakening").length;
  const broken = stockSignals.filter(s => s.thesisStatus.status === "Broken").length;

  // Upcoming results
  const upcomingResults = useMemo(() => {
    return (stocks || [])
      .filter(s => s.next_results_date)
      .map(s => {
        const resultsDate = new Date(s.next_results_date!);
        const now = new Date();
        const diffDays = Math.ceil((resultsDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return { ...s, resultsDate, diffDays };
      })
      .filter(s => s.diffDays >= -1 && s.diffDays <= 7)
      .sort((a, b) => a.resultsDate.getTime() - b.resultsDate.getTime());
  }, [stocks]);

  // Action alerts: collect bearish signals across portfolio
  const actionAlerts = useMemo(() => {
    const alerts: { stock: any; signal: Signal; score: number }[] = [];
    stockSignals.forEach(({ stock, signals, score }) => {
      signals
        .filter(s => s.type === "bearish" || s.type === "warning")
        .forEach(signal => alerts.push({ stock, signal, score }));
    });
    // Sort: bearish first, then warning
    alerts.sort((a, b) => (a.signal.type === "bearish" ? 0 : 1) - (b.signal.type === "bearish" ? 0 : 1));
    return alerts.slice(0, 10);
  }, [stockSignals]);

  // ── Price returns ──
  const getPriceNearDate = (series: Array<{ date: string; price: number }>, targetDate: Date): number | null => {
    const targetTs = targetDate.getTime();
    for (const item of series) {
      const itemTs = new Date(item.date).getTime();
      if (itemTs <= targetTs) {
        const diffDays = (targetTs - itemTs) / (1000 * 60 * 60 * 24);
        return diffDays <= MAX_DATE_GAP_DAYS ? item.price : null;
      }
    }
    return null;
  };

  const stockReturns = useMemo(() => {
    if (!stocks || !allPrices || allPrices.length === 0) return [];
    const now = new Date();
    const oneMonthAgo = new Date(now); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const threeMonthsAgo = new Date(now); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const oneYearAgo = new Date(now); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const twoYearsAgo = new Date(now); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const threeYearsAgo = new Date(now); threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

    return stocks.map(stock => {
      const prices = allPrices.filter(p => p.stock_id === stock.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      if (prices.length === 0) return { stock, latestPrice: null, return1m: null, return3m: null, return6m: null, return1y: null, return2y: null, return3y: null, volumeSpike: false };
      const latestPrice = prices[0].price;
      const latestVolume = (prices[0] as any).volume;
      const recentVolumes = prices.slice(1, 21).map(p => (p as any).volume).filter((v: any) => v != null && v > 0);
      const avgVolume = recentVolumes.length > 0 ? recentVolumes.reduce((s: number, v: number) => s + v, 0) / recentVolumes.length : 0;
      const volumeSpike = latestVolume && avgVolume > 0 && latestVolume > avgVolume * 2;
      const calcReturn = (old: number | null | undefined) => old && old > 0 ? Math.round(((latestPrice - old) / old) * 1000) / 10 : null;
      const prevPrice = prices.length > 1 ? prices[1].price : null;
      const dailyChange = prevPrice && prevPrice > 0 ? Math.abs(((latestPrice - prevPrice) / prevPrice) * 100) : 0;
      return {
        stock, latestPrice,
        return1m: calcReturn(getPriceNearDate(prices as any, oneMonthAgo)),
        return3m: calcReturn(getPriceNearDate(prices as any, threeMonthsAgo)),
        return6m: calcReturn(getPriceNearDate(prices as any, sixMonthsAgo)),
        return1y: calcReturn(getPriceNearDate(prices as any, oneYearAgo)),
        return2y: calcReturn(getPriceNearDate(prices as any, twoYearsAgo)),
        return3y: calcReturn(getPriceNearDate(prices as any, threeYearsAgo)),
        volumeSpike: volumeSpike || dailyChange > 3,
      };
    }).sort((a, b) => (b.return1m ?? -999) - (a.return1m ?? -999));
  }, [stocks, allPrices]);

  // Sector indices
  const niftySectorPerformance = useMemo(() => {
    if (!sectorIndicesData || sectorIndicesData.length === 0) return [];
    const now = new Date();
    const oneMonthAgo = new Date(now); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const threeMonthsAgo = new Date(now); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const oneYearAgo = new Date(now); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const byIndex: Record<string, Array<{ date: string; price: number; index_name: string }>> = {};
    for (const row of sectorIndicesData) {
      if (!byIndex[row.index_symbol]) byIndex[row.index_symbol] = [];
      byIndex[row.index_symbol].push({ date: row.date, price: Number(row.price), index_name: row.index_name });
    }
    return Object.entries(byIndex).map(([, prices]) => {
      prices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const latest = prices[0];
      const calc = (old: number | null | undefined) => old && old > 0 ? Math.round(((latest.price - old) / old) * 1000) / 10 : null;
      const prevPrice = prices.length > 1 ? prices[1].price : null;
      const dailyChange = prevPrice && prevPrice > 0 ? ((latest.price - prevPrice) / prevPrice) * 100 : 0;
      return {
        name: latest.index_name, latestPrice: latest.price,
        return1m: calc(getPriceNearDate(prices, oneMonthAgo)),
        return3m: calc(getPriceNearDate(prices, threeMonthsAgo)),
        return1y: calc(getPriceNearDate(prices, oneYearAgo)),
        suddenMove: Math.abs(dailyChange) > 2,
        dailyChange: Math.round(dailyChange * 10) / 10,
      };
    }).sort((a, b) => (b.return1m ?? -999) - (a.return1m ?? -999));
  }, [sectorIndicesData]);

  const handleRefreshSectorIndices = async () => {
    setRefreshingSectors(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-sector-indices");
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["sector-indices"] });
      toast({ title: "Sector indices updated", description: data?.message });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setRefreshingSectors(false);
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return "text-terminal-green";
    if (score >= 55) return "text-terminal-green/80";
    if (score >= 40) return "text-terminal-amber";
    return "text-terminal-red";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-mono font-bold text-primary terminal-glow">
            Portfolio Command Center
          </h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            What requires your attention today?
          </p>
        </div>

        {/* ── TOP CARDS ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className="p-4 bg-card border-border card-glow text-center">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Avg Thesis Score</p>
            <p className={`text-3xl font-mono font-bold ${getScoreColor(avgScore)}`}>{avgScore}</p>
          </Card>
          <Card className="p-4 bg-card border-border card-glow text-center">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Strengthening</p>
            <p className="text-3xl font-mono font-bold text-terminal-green">{strengthening}</p>
          </Card>
          <Card className="p-4 bg-card border-border card-glow text-center">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Weakening</p>
            <p className="text-3xl font-mono font-bold text-terminal-amber">{weakening}</p>
          </Card>
          <Card className="p-4 bg-card border-border card-glow text-center">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Broken</p>
            <p className="text-3xl font-mono font-bold text-terminal-red">{broken}</p>
          </Card>
          <Card className="p-4 bg-card border-border card-glow text-center">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Results This Week</p>
            <p className={`text-3xl font-mono font-bold ${upcomingResults.length > 0 ? "text-terminal-amber" : "text-muted-foreground"}`}>{upcomingResults.length}</p>
          </Card>
        </div>

        {/* ── UPCOMING RESULTS ── */}
        {upcomingResults.length > 0 && (
          <Card className="p-3 bg-card border-border card-glow">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 shrink-0">
                <CalendarClock className="h-4 w-4 text-primary" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Upcoming Results</span>
              </div>
              <div className="flex items-center gap-4 overflow-x-auto">
                {upcomingResults.map(s => {
                  const isToday = s.diffDays === 0;
                  return (
                    <div key={s.id} onClick={() => navigate(`/stocks/${s.id}`)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer transition-colors hover:bg-muted/50 shrink-0 ${
                        isToday ? "border-terminal-red/50 bg-terminal-red/5 animate-pulse" : "border-terminal-amber/40 bg-terminal-amber/5"
                      }`}>
                      <span className="font-mono text-xs font-semibold text-foreground">{s.ticker}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {s.resultsDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                      <Badge variant="outline" className={`font-mono text-[9px] px-1.5 py-0 ${isToday ? "text-terminal-red border-terminal-red/40" : "text-terminal-amber border-terminal-amber/30"}`}>
                        {isToday ? "TODAY" : `${s.diffDays}d`}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

        {/* ── ACTION ALERTS ── */}
        {actionAlerts.length > 0 && (
          <Card className="p-4 bg-card border-border card-glow">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-terminal-red" />
              <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Action Alerts</h3>
            </div>
            <div className="space-y-1.5">
              {actionAlerts.map((alert, i) => (
                <div key={i} onClick={() => navigate(`/stocks/${alert.stock.id}`)}
                  className={`flex items-center justify-between px-3 py-2 rounded-md border cursor-pointer transition-colors hover:bg-muted/50 ${
                    alert.signal.type === "bearish"
                      ? "border-l-2 border-l-terminal-red border-border"
                      : "border-l-2 border-l-terminal-amber border-border"
                  }`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-bold text-primary shrink-0">{alert.stock.ticker}</span>
                    <span className="text-xs text-foreground truncate">{alert.signal.label}</span>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── NEW ORDER ALERTS ── */}
        <Card className="p-4 bg-card border-border card-glow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-terminal-green" />
              <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">New Order Wins</h3>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleScanAnnouncements}
                disabled={scanning}
                className="h-6 px-2 text-[10px] font-mono border-terminal-green/40 hover:bg-terminal-green/10"
              >
                {scanning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1 text-terminal-green" />}
                Trigger Global Scan
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkSuperSync}
                disabled={bulkSyncing}
                className="h-6 px-2 text-[10px] font-mono border-terminal-red/40 text-terminal-red hover:bg-terminal-red/10"
              >
                {bulkSyncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1 text-terminal-red" />}
                Bulk Master Sync (All Shares)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchOrderAlerts}
                disabled={loadingOrders}
                className="h-6 px-2 text-[10px] font-mono"
              >
                {loadingOrders ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                {orderAlerts.length === 0 ? "Quick Refresh" : "Refresh"}
              </Button>
            </div>
          </div>
          {orderAlerts.length === 0 && !loadingOrders && (
            <p className="text-xs text-muted-foreground italic">
              Click "Scan All Stocks" to find new order announcements from BSE filings.
            </p>
          )}
          {orderAlerts.length > 0 && (
            <div className="space-y-1.5">
              {orderAlerts.map((alert, i) => (
                <a
                  key={i}
                  href={alert.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2 rounded-md border border-terminal-green/20 bg-terminal-green/5 hover:bg-terminal-green/10 cursor-pointer transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-bold text-primary shrink-0">{alert.stock.ticker}</span>
                    <span className="text-xs text-foreground truncate">{alert.title}</span>
                    {alert.date && <span className="text-[10px] text-muted-foreground font-mono shrink-0">{alert.date}</span>}
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </a>
              ))}
            </div>
          )}
        </Card>

        {/* ── CONCALL TRANSCRIPTS ── */}
        {transcriptAlerts.length > 0 && (
          <Card className="p-4 bg-card border-border card-glow">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-primary" />
              <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Concall Transcripts ({transcriptAlerts.length})
              </h3>
            </div>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {transcriptAlerts.map((alert, i) => (
                <a
                  key={i}
                  href={alert.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2 rounded-md border border-border hover:bg-muted/50 cursor-pointer transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-bold text-primary shrink-0">{alert.stock.ticker}</span>
                    <span className="text-xs text-foreground truncate">{alert.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {alert.quarter && (
                      <Badge variant="outline" className="font-mono text-[9px] px-1.5 py-0 text-primary border-primary/30">
                        {alert.quarter}
                      </Badge>
                    )}
                    <Badge variant="outline" className={`font-mono text-[9px] px-1.5 py-0 ${
                      alert.type === "concall_transcript" ? "text-primary border-primary/30" :
                      alert.type === "earnings" ? "text-terminal-green border-terminal-green/30" :
                      "text-muted-foreground border-border"
                    }`}>
                      {alert.type === "concall_transcript" ? "Concall" : alert.type === "earnings" ? "Earnings" : alert.type}
                    </Badge>
                    {alert.date && <span className="text-[10px] text-muted-foreground font-mono">{alert.date}</span>}
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </a>
              ))}
            </div>
          </Card>
        )}

        {/* ── PORTFOLIO RANK (quarterly AI cohort) ── */}
        <Card className="p-4 bg-card border-border card-glow overflow-hidden">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-3">
            <div className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-primary" />
              <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Portfolio rank (thesis-first, latest quarter)
              </h3>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground max-w-xl">
              List order uses live <span className="text-foreground">consolidated</span> (latest quarter + trajectory). Column <strong className="text-foreground">List</strong> is the last saved batch from{" "}
              <code className="text-primary">npm run ranks:quarterly:apply</code> (also writes <code className="text-primary">stocks.portfolio_*</code>). Re-run after new imports for conviction.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full data-grid">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider w-14">#</th>
                  <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Stock</th>
                  <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Quarter</th>
                  <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Thesis</th>
                  <th
                    className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider"
                    title="Within-quarter cohort # (thesis-first)."
                  >
                    Q rank
                  </th>
                  <th
                    className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider min-w-[4.5rem]"
                    title="Saved portfolio list rank (consolidated + trajectory) from last ranks:quarterly:apply"
                  >
                    List
                  </th>
                  <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider min-w-[7rem]">
                    Verdict
                  </th>
                  <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Sector</th>
                </tr>
              </thead>
              <tbody>
                {portfolioRankRows.map(({ stock, ctx }, idx) => (
                  <tr
                    key={stock.id}
                    onClick={() => navigate(`/stocks/${stock.id}`)}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                  >
                    <td
                      className="p-2 text-center font-mono text-xs text-muted-foreground tabular-nums align-top"
                      title={
                        ctx
                          ? `Consolidated ${ctx.consolidatedSortScore} = latest ${ctx.sortScore} + trajectory ${ctx.trajectoryBonus >= 0 ? "+" : ""}${ctx.trajectoryBonus}`
                          : undefined
                      }
                    >
                      {idx + 1}
                    </td>
                    <td className="p-2">
                      <span className="font-mono text-sm font-semibold text-primary">{stock.ticker}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">{stock.company_name}</span>
                    </td>
                    <td className="p-2 text-center">
                      {ctx ? (
                        <Badge variant="outline" className="font-mono text-[10px] text-foreground border-border">
                          {ctx.quarter}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {ctx ? (
                        <div className="flex justify-center">
                          <SnapshotThesisBadge thesisStatus={ctx.thesisStatus} />
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {ctx?.portfolioRank ? (
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] text-primary border-primary/40"
                          title="Rank within stocks that have a snapshot for this quarter (thesis-first)"
                        >
                          #{ctx.portfolioRank.rank}/{ctx.portfolioRank.cohortSize}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground" title="Run ranks:quarterly:apply after db migrate">
                          No rank
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center align-top">
                      {stock.portfolio_list_rank != null && stock.portfolio_list_cohort_size != null ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] text-terminal-green border-terminal-green/35"
                            title={
                              stock.portfolio_scores_updated_at
                                ? `Saved ${new Date(stock.portfolio_scores_updated_at).toLocaleString()} · Σ ${stock.portfolio_consolidated_score ?? "—"}`
                                : `Consolidated score ${stock.portfolio_consolidated_score ?? "—"}`
                            }
                          >
                            #{stock.portfolio_list_rank}/{stock.portfolio_list_cohort_size}
                          </Badge>
                          {stock.portfolio_consolidated_score != null ? (
                            <span className="text-[9px] text-muted-foreground font-mono tabular-nums">
                              Σ {Math.round(stock.portfolio_consolidated_score)}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground" title="Run ranks:quarterly:apply to persist list rank">
                          —
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center align-middle">
                      {ctx ? (
                        <ActionableVerdictBadges
                          compact
                          decision={ctx.verdict.decision}
                          convictionLevel={ctx.verdict.convictionLevel}
                          positionSize={ctx.verdict.positionSize}
                        />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{stock.sector || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {portfolioRankCount === 0 && stocks && stocks.length > 0 ? (
            <p className="mt-2 text-[10px] text-terminal-amber font-mono">
              No quarterly cohort rank on snapshots yet — apply migrations and run <code className="text-primary">npm run ranks:quarterly:apply</code> (also fills List rank + Σ on <code className="text-primary">stocks</code>).
            </p>
          ) : null}
        </Card>

        {/* ── THESIS STATUS PER STOCK ── */}
        <Card className="p-4 bg-card border-border card-glow overflow-hidden">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-primary" />
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Thesis Status</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full data-grid">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Stock</th>
                  <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Score</th>
                  <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Status</th>
                  <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Reason</th>
                  <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Signals</th>
                </tr>
              </thead>
              <tbody>
                {stockSignals
                  .sort((a, b) => {
                    const order = { Broken: 0, Weakening: 1, Stable: 2, Strengthening: 3 };
                    return order[a.thesisStatus.status] - order[b.thesisStatus.status];
                  })
                  .map(({ stock, signals, score, thesisStatus }) => {
                    const bullish = signals.filter(s => s.type === "bullish").length;
                    const warning = signals.filter(s => s.type === "warning").length;
                    const bearish = signals.filter(s => s.type === "bearish").length;
                    return (
                      <tr key={stock.id} onClick={() => navigate(`/stocks/${stock.id}`)}
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors">
                        <td className="p-2">
                          <div>
                            <span className="font-mono text-sm font-semibold text-primary">{stock.ticker}</span>
                            <span className="text-[10px] text-muted-foreground ml-2">{stock.investment_thesis || ""}</span>
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          <span className={`font-mono text-lg font-bold ${getScoreColor(score)}`}>{score}</span>
                        </td>
                        <td className="p-2 text-center">
                          <ThesisStatusBadge status={thesisStatus} />
                        </td>
                        <td className="p-2">
                          <span className="text-xs text-muted-foreground">{thesisStatus.reason}</span>
                        </td>
                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-2 font-mono text-[10px]">
                            <span className="text-terminal-green">✓{bullish}</span>
                            <span className="text-terminal-amber">⚠{warning}</span>
                            <span className="text-terminal-red">✗{bearish}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── STOCK RETURNS ── */}
        {stockReturns.length > 0 && stockReturns.some(sr => sr.latestPrice) && (
          <Card className="p-4 bg-card border-border card-glow overflow-hidden">
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-4">Stock Returns</h3>
            <div className="overflow-x-auto">
              <table className="w-full data-grid">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Stock</th>
                    <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Sector</th>
                    <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">CMP (₹)</th>
                     <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">1M</th>
                     <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">3M</th>
                     <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">6M</th>
                     <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">1Y</th>
                     <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">2Y</th>
                     <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">3Y</th>
                  </tr>
                </thead>
                <tbody>
                  {stockReturns.map(({ stock, latestPrice, return1m, return3m, return6m, return1y, return2y, return3y, volumeSpike }) => (
                     <tr key={stock.id} className={`border-b border-border/50 hover:bg-muted/30 cursor-pointer ${volumeSpike ? "bg-terminal-amber/5 border-l-2 border-l-terminal-amber" : ""}`} onClick={() => navigate(`/stocks/${stock.id}`)}>
                       <td className="p-2">
                         <div className="flex items-center gap-1.5">
                           {volumeSpike && <Zap className="h-3 w-3 text-terminal-amber shrink-0" />}
                           <span className="font-mono text-sm font-semibold text-foreground">{stock.ticker}</span>
                         </div>
                       </td>
                       <td className="p-2 text-xs text-muted-foreground">{stock.sector || "—"}</td>
                       <td className="p-2 text-right font-mono text-foreground text-sm">{latestPrice ? `₹${Number(latestPrice).toLocaleString()}` : "—"}</td>
                       <td className="p-2 text-right"><ReturnBadge value={return1m} /></td>
                       <td className="p-2 text-right"><ReturnBadge value={return3m} /></td>
                       <td className="p-2 text-right"><ReturnBadge value={return6m} /></td>
                       <td className="p-2 text-right"><ReturnBadge value={return1y} /></td>
                       <td className="p-2 text-right"><ReturnBadge value={return2y} /></td>
                       <td className="p-2 text-right"><ReturnBadge value={return3y} /></td>
                     </tr>
                   ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── SECTOR INDICES ── */}
        <Card className="p-4 bg-card border-border card-glow">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Nifty Sector Indices</h3>
            <Button variant="ghost" size="sm" onClick={handleRefreshSectorIndices} disabled={refreshingSectors} className="font-mono text-xs h-7 px-2">
              {refreshingSectors ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
          {niftySectorPerformance.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full data-grid">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Index</th>
                    <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Price</th>
                    <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">1M</th>
                    <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">3M</th>
                    <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">1Y</th>
                  </tr>
                </thead>
                <tbody>
                  {niftySectorPerformance.map(({ name, latestPrice, return1m, return3m, return1y, suddenMove, dailyChange }) => (
                    <tr key={name} className={`border-b border-border/50 ${suddenMove ? "bg-terminal-amber/5 border-l-2 border-l-terminal-amber" : ""}`}>
                      <td className="p-2">
                        <div className="flex items-center gap-1.5">
                          {suddenMove && <Zap className="h-3 w-3 text-terminal-amber shrink-0" />}
                          <span className="font-mono text-xs font-semibold text-foreground">{name}</span>
                          {suddenMove && <span className={`text-[9px] font-mono ${dailyChange >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>({dailyChange > 0 ? "+" : ""}{dailyChange}%)</span>}
                        </div>
                      </td>
                      <td className="p-2 text-right font-mono text-xs text-muted-foreground">{latestPrice?.toLocaleString()}</td>
                      <td className="p-2 text-right"><ReturnBadge value={return1m} /></td>
                      <td className="p-2 text-right"><ReturnBadge value={return3m} /></td>
                      <td className="p-2 text-right"><ReturnBadge value={return1y} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-[100px] flex items-center justify-center text-muted-foreground font-mono text-sm">Click refresh to fetch Nifty sector data</div>
          )}
        </Card>

        {/* ── QUICK ACTIONS ── */}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            className="font-mono text-xs h-10 gap-2 border-primary/30 hover:bg-primary/10"
            onClick={handleScanAnnouncements}
            disabled={scanning}
          >
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-4 w-4" />}
            Scan Announcements (Manual)
          </Button>
          <Button variant="outline" className="font-mono text-xs h-10 gap-2 border-border"
            onClick={() => navigate("/add-stock")}>
            <TrendingUp className="h-4 w-4" />
            Add New Stock
          </Button>
          <Button variant="outline" className="font-mono text-xs h-10 gap-2 border-border"
            onClick={() => navigate("/stocks")}>
            <Package className="h-4 w-4" />
            Manage Stocks
          </Button>
          <Button variant="outline" className="font-mono text-xs h-10 gap-2 border-border"
            onClick={() => navigate("/transcripts")}>
            <FileText className="h-4 w-4" />
            Upload Transcript
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
