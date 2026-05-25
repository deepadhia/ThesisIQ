import { useState } from "react";
import { useParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useStock, useStockAnalysis, useStockCommitments, useManagementPromises, useQuarterlySnapshots } from "@/hooks/useStocks";
import { useFinancialMetrics, useFinancialResults, useStockPrices, useShareholding, usePeerComparison, useXbrlMetrics } from "@/hooks/useFinancials";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { SentimentBadge } from "@/components/SentimentBadge";
import { ToneBadge } from "@/components/ToneBadge";
import { InvestmentThesisEditor } from "@/components/InvestmentThesisEditor";
import { PromisesTab } from "@/components/PromisesTab";
import { SnapshotsTab } from "@/components/SnapshotsTab";
import { CopyGeminiPrompt } from "@/components/CopyGeminiPrompt";
import { ImportGeminiResponse } from "@/components/ImportGeminiResponse";
import { MasterPromptEditor } from "@/components/MasterPromptEditor";
import { DealsTab } from "@/components/DealsTab";
import { ThesisScore } from "@/components/ThesisScore";
import { ThesisTimeline } from "@/components/ThesisTimeline";
import { ManagementCredibility } from "@/components/ManagementCredibility";
import { ThesisDriftAlert } from "@/components/ThesisDriftAlert";
import { SnapshotThesisBadge } from "@/components/SnapshotThesisBadge";
import { CorporateAnnouncements } from "@/components/CorporateAnnouncements";
import { detectMultibaggerSignals, calculateThesisScore, getThesisStatus } from "@/lib/signals";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, ComposedChart,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiUrl } from "@/lib/apiFetch";
import {
  RefreshCw, Loader2, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, Target, AlertTriangle, Zap, Quote,
  BarChart3, Activity, Shield, FileText, Users, Briefcase, ExternalLink, Trash2, Newspaper, PieChart, Download
} from "lucide-react";
import { QuarterlyMetricsTab } from "@/components/QuarterlyMetricsTab";
import { DecisionAlpha } from "@/components/DecisionAlpha";
import { GoogleDriveStatus } from "@/components/GoogleDriveStatus";


const chartTooltipStyle = {
  background: "hsl(220 18% 9%)",
  border: "1px solid hsl(220 14% 16%)",
  borderRadius: 8,
  fontFamily: "JetBrains Mono",
  fontSize: 11,
  color: "hsl(210 20% 90%)",
};

/** Google Drive `uc?export=download` when local `/files/...` is missing (Drive-only rows). */
function driveDirectDownloadUrl(f: {
  drive_file_id?: string | null;
  drive_web_link?: string | null;
}): string | null {
  const fid = typeof f.drive_file_id === "string" && f.drive_file_id.trim() ? f.drive_file_id.trim() : null;
  if (fid) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fid)}`;
  }
  const link = typeof f.drive_web_link === "string" ? f.drive_web_link.trim() : "";
  if (link) {
    const fromPath = link.match(/\/file\/d\/([^/?#]+)/);
    const fromQuery = link.match(/[?&]id=([^&]+)/);
    const extracted = fromPath?.[1] ?? fromQuery?.[1];
    if (extracted) {
      return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(extracted)}`;
    }
  }
  return null;
}

function downloadBlob(blob: Blob, filename?: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename || "download";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

function openInNewTab(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function StockDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: stock, isLoading } = useStock(id!);
  const { data: analyses } = useStockAnalysis(id!);
  const { data: commitments } = useStockCommitments(id!);
  const { data: financials } = useFinancialMetrics(id!);
  const { data: quarterlyResults } = useFinancialResults(id!);
  const { data: prices } = useStockPrices(id!);
  const { data: shareholding } = useShareholding(id!);
  const { data: peers } = usePeerComparison(id!);
  const { data: promises } = useManagementPromises(id!);
  const { data: snapshots } = useQuarterlySnapshots(id!);
  const { data: xbrlMetrics } = useXbrlMetrics(id!);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [fetchingScreenerData, setFetchingScreenerData] = useState(false);
  const [resettingInsights, setResettingInsights] = useState(false);
  const [resettingFiles, setResettingFiles] = useState(false);
  const [superSyncing, setSuperSyncing] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [syncingMissing, setSyncingMissing] = useState(false);

  const { data: filingsData, isLoading: filingsLoading, refetch: refetchFilings } = useQuery({
    queryKey: ["transcripts-files", stock?.ticker],
    queryFn: async () => {
      const r = await apiFetch(`/api/transcripts/files/${encodeURIComponent(stock!.ticker)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!stock?.ticker,
  });
  const filings = (filingsData?.ok && Array.isArray(filingsData.files)) ? filingsData.files : [];

  const { data: driveStatusData } = useQuery({
    queryKey: ["transcripts-drive-status"],
    queryFn: async () => {
      const r = await apiFetch(apiUrl("/api/transcripts/drive-status"), { cache: "no-store" });
      if (!r.ok) throw new Error(`Drive status: ${r.status}`);
      const data = await r.json();
      return { driveConfigured: data?.driveConfigured === true, needsConnect: data?.needsConnect === true };
    },
    staleTime: 0,
    refetchOnMount: true,
  });
  const driveConfigured = driveStatusData?.driveConfigured === true;
  const needsConnect = driveStatusData?.needsConnect === true;
  const [uploadingToDrive, setUploadingToDrive] = useState(false);
  const [lastUploadErrors, setLastUploadErrors] = useState<Array<{ symbol: string; quarter: string; filename: string; error: string }> | null>(null);
  const [announcementCategoryFilter, setAnnouncementCategoryFilter] = useState<string | null>(null); // null = All
  const [deletingFileKey, setDeletingFileKey] = useState<string | null>(null);
  const [fetchingFilingsForStock, setFetchingFilingsForStock] = useState(false);

  /** Single API: live quote + Screener financials (same as old Price + Financials buttons). */
  const handleFetchScreenerData = async () => {
    if (!stock) return;
    setFetchingScreenerData(true);
    try {
      const r = await apiFetch("/api/stocks/refresh-screener-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stock_id: stock.id,
          ticker: stock.ticker,
          screener_slug: stock.screener_slug || stock.ticker,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({
          title: "Refresh failed",
          description: data?.error || `Request failed: ${r.status}`,
          variant: "destructive",
        });
        return;
      }
      const priceOk = data?.price?.success === true;
      const finOk = data?.financials?.success === true;
      queryClient.invalidateQueries({ queryKey: ["prices", id] });
      queryClient.invalidateQueries({ queryKey: ["financial-metrics", id] });
      queryClient.invalidateQueries({ queryKey: ["financial-results", id] });
      queryClient.invalidateQueries({ queryKey: ["shareholding", id] });
      queryClient.invalidateQueries({ queryKey: ["peers", id] });

      const priceLine =
        priceOk && data.price?.price != null ? `Price ₹${data.price.price}` : `Price: ${data?.price?.error || "failed"}`;
      const finLine = finOk ? "Financials updated" : `Financials: ${data?.financials?.error || "failed"}`;

      if (priceOk && finOk) {
        toast({
          title: "Screener data updated",
          description: `${stock.ticker} — ${priceLine}; ${finLine}.`,
        });
      } else if (priceOk || finOk) {
        toast({
          title: "Partial update",
          description: `${priceLine}. ${finLine}.`,
        });
      } else {
        toast({
          title: "Screener refresh failed",
          description: `${priceLine}. ${finLine}.`,
          variant: "destructive",
        });
      }
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Request failed", variant: "destructive" });
    } finally {
      setFetchingScreenerData(false);
    }
  };

  const handleResetInsights = async () => {
    if (!stock) return;
    if (resettingInsights) return;
    setResettingInsights(true);
    try {
      const response = await apiFetch(`/api/stocks/${stock.id}/reset-insights`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error || `Reset failed with status ${response.status}`;
        throw new Error(message);
      }

      // Invalidate caches so UI refreshes
      queryClient.invalidateQueries({ queryKey: ["stock", id] });
      queryClient.invalidateQueries({ queryKey: ["stocks"] });
      queryClient.invalidateQueries({ queryKey: ["management-promises", id] });
      queryClient.invalidateQueries({ queryKey: ["quarterly-snapshots", id] });

      toast({
        title: "Insights reset",
        description: "Prompts, snapshots, and promises have been cleared for this stock.",
      });
    } catch (err: any) {
      toast({
        title: "Reset failed",
        description: err?.message ?? "Could not reset prompts and snapshots.",
        variant: "destructive",
      });
    } finally {
      setResettingInsights(false);
    }
  };

  const handleResetFiles = async (period: "3m" | "6m" | "1y") => {
    if (!stock) return;
    if (resettingFiles) return;
    setResettingFiles(true);
    try {
      const r = await apiFetch("/api/transcripts/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, symbol: stock.ticker }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Reset failed: ${r.status}`);
      await queryClient.invalidateQueries({ queryKey: ["transcripts-files", stock.ticker] });
      const periodLabel = period === "3m" ? "3 months" : period === "6m" ? "6 months" : "1 year";
      const localMsg = data?.deleted ? `${data.deleted} local file(s)` : "";
      const driveMsg = data?.deletedFromDrive ? `${data.deletedFromDrive} from Drive` : "";
      const parts = [localMsg, driveMsg].filter(Boolean);
      const description = parts.length ? `Removed: ${parts.join(", ")} (last ${periodLabel}).` : `Done. No files in last ${periodLabel}.`;
      toast({
        title: "Files reset",
        description,
      });
    } catch (err: unknown) {
      toast({
        title: "Reset failed",
        description: err instanceof Error ? err.message : "Could not reset files.",
        variant: "destructive",
      });
    } finally {
      setResettingFiles(false);
    }
  };

  const handleUploadToDrive = async () => {
    if (!stock) return;
    if (uploadingToDrive) return;
    setUploadingToDrive(true);
    setLastUploadErrors(null);
    try {
      const r = await apiFetch("/api/transcripts/upload-to-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: stock.ticker }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({
          title: "Upload failed",
          description: data?.error ?? `Status ${r.status}`,
          variant: "destructive",
        });
        return;
      }
      const n = data.uploaded ?? 0;
      const errs = Array.isArray(data.errors) ? data.errors : [];
      if (errs.length > 0) setLastUploadErrors(errs);
      else setLastUploadErrors(null);
      toast({
        title: "Uploaded to Drive",
        description: n ? `${n} file(s) uploaded for ${stock.ticker}.` : "No new files to upload.",
      });
      if (errs.length > 0) {
        toast({
          title: "Some uploads failed",
          description: `${errs.length} file(s) failed. Use Retry to try again.`,
          variant: "destructive",
        });
      }
      if (n > 0 || errs.length > 0) refetchFilings();
    } catch (err: unknown) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploadingToDrive(false);
    }
  };

  const handleDeleteFiling = async (quarter: string, filename: string) => {
    if (!stock?.ticker) return;
    const key = `${quarter}-${filename}`;
    setDeletingFileKey(key);
    try {
      const r = await apiFetch("/api/transcripts/delete-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: stock.ticker, quarter, filename }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        toast({
          title: "Delete failed",
          description: data?.error ?? "Could not delete file.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "File deleted",
        description: data.deletedFromDrive ? "Removed locally and from Google Drive." : "Removed.",
      });
      await refetchFilings();
    } catch (err: unknown) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeletingFileKey(null);
    }
  };

  const handleSuperSync = async () => {
    if (!stock) return;
    if (superSyncing) return;
    
    const confirm = window.confirm("This will DELETE ALL announcements and files for this stock, then fetch everything fresh. Continue?");
    if (!confirm) return;

    setSuperSyncing(true);
    try {
      const r = await apiFetch("/api/transcripts/super-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockId: stock.id, ticker: stock.ticker }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Super sync failed: ${r.status}`);
      
      toast({
        title: "Master Sync Complete",
        description: `Reset done. Synced ${data.announcementsSynced || 0} news items and started file downloads.`,
      });
      
      // Refresh all related data
      queryClient.invalidateQueries({ queryKey: ["corporate-announcements", stock.id] });
      queryClient.invalidateQueries({ queryKey: ["transcripts-files", stock.ticker] });
      queryClient.invalidateQueries({ queryKey: ["xbrl-metrics", stock.id] });
      queryClient.invalidateQueries({ queryKey: ["quarterly-metrics-xbrl", stock.id] });
      
      refetchFilings();
    } catch (err: any) {
      toast({
        title: "Master Sync Failed",
        description: err?.message ?? "Error during deep sync.",
        variant: "destructive",
      });
    } finally {
      setSuperSyncing(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!stock?.ticker) return;
    if (downloadingZip) return;
    setDownloadingZip(true);
    try {
      const downloadUrl = apiUrl(`/api/transcripts/download-zip/${encodeURIComponent(stock.ticker)}`);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", `${stock.ticker}_FY25_FY26_Filings.zip`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: "Download Initiated",
        description: `Downloading zipped filings for ${stock.ticker}...`,
      });
    } catch (err: any) {
      toast({
        title: "Download Failed",
        description: err.message || "Could not download zip file",
        variant: "destructive",
      });
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleSyncMissing = async () => {
    if (!stock?.ticker) return;
    if (syncingMissing) return;
    setSyncingMissing(true);
    try {
      const res = await apiFetch("/api/transcripts/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: [stock.ticker],
          onlyMissing: true,
          uploadAfterDownload: true,
          window: "3y",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data?.error || "Sync failed");

      toast({
        title: "Sync Complete",
        description: `Successfully checked and synced all pending quarters (FY25/FY26/coming quarters) for ${stock.ticker}.`,
      });

      // Refetch files
      refetchFilings();
      queryClient.invalidateQueries({ queryKey: ["transcripts-files", stock.ticker] });
      queryClient.invalidateQueries({ queryKey: ["transcripts-drive-status"] });
    } catch (err: any) {
      toast({
        title: "Sync Failed",
        description: err.message || "Could not sync missing filings",
        variant: "destructive",
      });
    } finally {
      setSyncingMissing(false);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground font-mono">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
        </div>
      </DashboardLayout>
    );
  }

  if (!stock) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground font-mono">Stock not found</div>
      </DashboardLayout>
    );
  }

  const latestAnalysis = analyses?.[0];
  const latestFinancial = financials?.[financials.length - 1];
  const latestPrice = prices?.[0];

  // Find latest non-null value for each metric across all years (iterate backwards)
  const latestVal = (key: string) => {
    if (!financials) return null;
    for (let i = financials.length - 1; i >= 0; i--) {
      const v = (financials[i] as any)[key];
      if (v !== null && v !== undefined && v !== 0) return v;
    }
    return null;
  };

  const achievedCount = commitments?.filter(c => c.status === "Achieved").length || 0;
  const totalCommitments = commitments?.length || 0;
  const credibility = totalCommitments > 0 ? Math.round((achievedCount / totalCommitments) * 100) : null;

  // Multibagger signal detection
  const signals = detectMultibaggerSignals(financials || [], latestAnalysis, commitments || [], shareholding || [], promises || [], snapshots || [], analyses || []);
  const thesisStatus = getThesisStatus(signals, calculateThesisScore(signals));

  // Chart data
  const sentimentData = analyses?.map(a => ({
    quarter: a.quarter,
    score: a.sentiment_score || 0,
    year: a.year,
  })).reverse() || [];

  const yearlyChartData = financials?.map(f => ({
    year: f.year,
    revenue: (f as any).revenue,
    netProfit: (f as any).net_profit,
    opm: (f as any).opm,
    eps: (f as any).eps,
    roce: f.roce,
    roe: f.roe,
    revGrowth: f.revenue_growth,
    profGrowth: f.profit_growth,
    fcf: f.free_cash_flow,
    de: f.debt_equity,
  })) || [];

  const quarterlyChartData = quarterlyResults?.map(q => ({
    quarter: q.quarter,
    revenue: q.revenue,
    opm: q.ebitda_margin,
  })) || [];

  const priceChartData = prices?.slice().reverse().map(p => ({
    date: p.date,
    price: p.price,
    change: p.change_percent,
  })) || [];

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* ── HEADER BAR ── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-mono font-bold text-primary terminal-glow">{stock.ticker}</h1>
                <Badge variant="outline" className="font-mono text-[10px]">{stock.category}</Badge>
                {stock.sector && (
                  <Badge variant="secondary" className="font-mono text-[10px]">{stock.sector}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-foreground text-sm">{stock.company_name}</p>
                {stock.next_results_date && (
                  <Badge
                    variant="outline"
                    className={`font-mono text-[10px] ${
                      new Date(stock.next_results_date) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                        ? "text-terminal-amber border-terminal-amber/30 bg-terminal-amber/10 animate-pulse"
                        : "text-muted-foreground"
                    }`}
                  >
                    📅 Results: {new Date(stock.next_results_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    {new Date(stock.next_results_date) <= new Date() && " (Due!)"}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {latestPrice && (
              <div className="flex items-center gap-2 mr-4">
                <span className="text-xl font-mono font-bold text-foreground">₹{Number(latestPrice.price).toLocaleString()}</span>
                {latestPrice.change_percent !== null && (
                  <span className={`flex items-center font-mono text-sm font-semibold ${latestPrice.change_percent >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                    {latestPrice.change_percent >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    {Math.abs(latestPrice.change_percent).toFixed(2)}%
                  </span>
                )}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleFetchScreenerData}
              disabled={fetchingScreenerData}
              className="font-mono text-xs"
              title="Live price + Screener.in financials in one request"
            >
              {fetchingScreenerData ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              <span className="ml-1 hidden sm:inline">Price &amp; financials</span>
              <span className="ml-1 sm:hidden">Data</span>
            </Button>
            <CopyGeminiPrompt stock={stock} />
            <ImportGeminiResponse stockId={stock.id} ticker={stock.ticker} />
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetInsights}
              disabled={resettingInsights}
              className="font-mono text-xs border-terminal-red/40 text-terminal-red hover:bg-terminal-red/10"
            >
              {resettingInsights ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              <span className="ml-1">Reset AI insights</span>
            </Button>
          </div>
        </div>

        {/* ── TOP RATIOS BAR ── */}
        {financials && financials.length > 0 && (
          <div className="grid grid-cols-4 md:grid-cols-8 gap-1">
            <RatioCard label="ROCE" value={latestVal("roce")} suffix="%" good={(latestVal("roce") ?? 0) >= 15} />
            <RatioCard label="ROE" value={latestVal("roe")} suffix="%" good={(latestVal("roe") ?? 0) >= 15} />
            <RatioCard label="D/E" value={latestVal("debt_equity")} good={(latestVal("debt_equity") ?? 999) <= 1} />
            <RatioCard label="OPM" value={latestVal("opm")} suffix="%" good={(latestVal("opm") ?? 0) >= 15} />
            <RatioCard label="Rev Growth" value={latestVal("revenue_growth")} suffix="%" good={(latestVal("revenue_growth") ?? 0) >= 15} />
            <RatioCard label="Prof Growth" value={latestVal("profit_growth")} suffix="%" good={(latestVal("profit_growth") ?? 0) >= 15} />
            <RatioCard label="EPS" value={latestVal("eps")} good={(latestVal("eps") ?? 0) > 0} />
            <RatioCard label="Promoter %" value={latestVal("promoter_holding")} suffix="%" good={(latestVal("promoter_holding") ?? 0) >= 50} />
          </div>
        )}

        {/* ── THESIS DRIFT ALERT + ACTION VERDICT ── */}
        {(() => {
          const latestSnap = snapshots?.[0] as any;
          if (!latestSnap) return null;
          const rawOut = latestSnap.raw_ai_output as any;
          const driftStatus = latestSnap.thesis_drift_status || rawOut?.snapshot?.thesis_drift?.status || null;
          const driftReason = rawOut?.snapshot?.thesis_drift?.reason || null;
          const actionVerdict = rawOut?.actionable_verdict as any;
          const actionDecision = actionVerdict?.decision ?? null;
          const actionConviction = actionVerdict?.conviction_level ?? null;

          return (
            <div className="grid grid-cols-1 md:grid-cols-[2fr_minmax(0,1fr)] gap-3 items-start">
              <ThesisDriftAlert driftStatus={driftStatus} driftReason={driftReason} />
              {actionDecision && (
                <Card className="p-3 bg-card border-border card-glow">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Actionable Verdict
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge
                      variant="outline"
                      className={`font-mono text-[10px] ${
                        String(actionDecision).includes("BUILD")
                          ? "text-terminal-green border-terminal-green/40"
                          : String(actionDecision).includes("CUT")
                            ? "text-terminal-red border-terminal-red/40"
                            : "text-terminal-amber border-terminal-amber/40"
                      }`}
                    >
                      {actionDecision}
                    </Badge>
                    {actionConviction && (
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] text-muted-foreground border-muted-foreground/40"
                      >
                        {actionConviction}
                      </Badge>
                    )}
                  </div>
                  {actionVerdict?.action_rationale && (
                    <p className="text-[11px] text-foreground/80 leading-snug">
                      {actionVerdict.action_rationale}
                    </p>
                  )}
                </Card>
              )}
            </div>
          );
        })()}

        {/* ── THESIS SCORE + MULTIBAGGER SIGNALS ── */}
        {signals.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4">
            <ThesisScore signals={signals} />
            <Card className="p-4 bg-card border-border card-glow">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-terminal-amber" /> Multibagger Signals
              </h3>
              <div className="flex flex-wrap gap-2">
                {signals.map((s, i) => (
                  <Badge key={i} variant="outline" className={`font-mono text-[10px] ${
                    s.type === "bullish" ? "text-terminal-green border-terminal-green/30 bg-terminal-green/10" :
                    s.type === "warning" ? "text-terminal-amber border-terminal-amber/30 bg-terminal-amber/10" :
                    "text-terminal-red border-terminal-red/30 bg-terminal-red/10"
                  }`}>
                    {s.type === "bullish" ? "✓" : s.type === "warning" ? "⚠" : "✗"} {s.label}
                  </Badge>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ── THESIS + BUY PRICE + RESULTS DATE ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InvestmentThesisEditor stockId={stock.id} thesis={stock.investment_thesis} />
          <MasterPromptEditor stockId={stock.id} trackingDirectives={stock.tracking_directives} metricKeys={stock.metric_keys} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-4">
          {stock.buy_price && (
            <Card className="p-4 bg-card border-border card-glow flex flex-col items-center justify-center min-w-[120px]">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Buy Price</p>
              <p className="text-2xl font-mono font-bold text-foreground">₹{Number(stock.buy_price).toLocaleString()}</p>
              {latestPrice && stock.buy_price && (
                <p className={`font-mono text-xs mt-1 ${Number(latestPrice.price) >= Number(stock.buy_price) ? "text-terminal-green" : "text-terminal-red"}`}>
                  {((Number(latestPrice.price) - Number(stock.buy_price)) / Number(stock.buy_price) * 100).toFixed(1)}% return
                </p>
              )}
            </Card>
          )}
          <Card className="p-4 bg-card border-border card-glow flex flex-col items-center justify-center min-w-[140px]">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">BSE Scrip Code</p>
            <Input
              className="bg-transparent border border-border rounded px-2 py-1 font-mono text-xs text-foreground w-[100px] text-center"
              defaultValue={stock.bse_scrip_code || ""}
              placeholder="5XXXXX"
              maxLength={6}
              onBlur={async (e) => {
                const val = e.target.value.trim() || null;
                if (val === stock.bse_scrip_code) return;
                const { error } = await supabase.from("stocks").update({ bse_scrip_code: val }).eq("id", stock.id);
                if (error) {
                  toast({ title: "Update failed", description: error.message, variant: "destructive" });
                } else {
                  queryClient.invalidateQueries({ queryKey: ["stock", id] });
                  toast({ title: "BSE Scrip Code updated", description: val ? `Set to ${val}` : "Cleared" });
                }
              }}
            />
          </Card>
          <Card className="p-4 bg-card border-border card-glow flex flex-col items-center justify-center min-w-[140px]">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Next Results</p>
            <input
              type="date"
              className="bg-transparent border border-border rounded px-2 py-1 font-mono text-xs text-foreground w-[130px] text-center"
              defaultValue={(stock as any).next_results_date || ""}
              onBlur={async (e) => {
                const val = e.target.value || null;
                const current = (stock as any).next_results_date || null;
                if (val === current) return;
                await supabase.from("stocks").update({ next_results_date: val } as any).eq("id", stock.id);
                queryClient.invalidateQueries({ queryKey: ["stock", id] });
                queryClient.invalidateQueries({ queryKey: ["stocks"] });
                toast({ title: "Results date updated", description: val ? `Set to ${val}` : "Cleared" });
              }}
            />
            {(stock as any).next_results_date && (
              <p className={`font-mono text-[10px] mt-1 ${
                new Date((stock as any).next_results_date) <= new Date() ? "text-terminal-red" :
                new Date((stock as any).next_results_date) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) ? "text-terminal-amber" :
                "text-muted-foreground"
              }`}>
                {Math.ceil((new Date((stock as any).next_results_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days
              </p>
            )}
          </Card>
        </div>

        {/* ── DECISION ALPHA LAYER ── */}
        {xbrlMetrics && xbrlMetrics.length > 0 && (
          <DecisionAlpha alphaSignals={xbrlMetrics[0].alpha_signals} />
        )}

        {/* ── MAIN TABBED CONTENT ── */}
        <Tabs defaultValue="overview" className="w-full min-w-0">
          <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] rounded-md [scrollbar-width:thin]">
            <TabsList className="bg-card border border-border inline-flex w-max min-w-full flex-nowrap justify-start gap-0.5 h-auto min-h-10 p-1 [&>*]:shrink-0">
            <TabsTrigger value="overview" className="font-mono text-xs gap-1.5">
              <BarChart3 className="h-3 w-3" /> Overview
            </TabsTrigger>
            <TabsTrigger value="financials" className="font-mono text-xs gap-1.5">
              <Activity className="h-3 w-3" /> Financials
            </TabsTrigger>
            {totalCommitments > 0 && (
              <TabsTrigger value="commitments" className="font-mono text-xs gap-1.5">
                <Shield className="h-3 w-3" /> Commitments
              </TabsTrigger>
            )}
            <TabsTrigger value="promises" className="font-mono text-xs gap-1.5">
              <Target className="h-3 w-3" /> Promises
            </TabsTrigger>
            <TabsTrigger value="snapshots" className="font-mono text-xs gap-1.5">
              <FileText className="h-3 w-3" /> Snapshots
            </TabsTrigger>
            <TabsTrigger value="deals" className="font-mono text-xs gap-1.5">
              <Briefcase className="h-3 w-3" /> Deals
            </TabsTrigger>
            <TabsTrigger value="timeline" className="font-mono text-xs gap-1.5">
              <TrendingUp className="h-3 w-3" /> Timeline
            </TabsTrigger>
            <TabsTrigger value="announcements" className="font-mono text-xs gap-1.5">
              <FileText className="h-3 w-3" /> Announcements
            </TabsTrigger>
            <TabsTrigger value="quarterly" className="font-mono text-xs gap-1.5">
              <PieChart className="h-3 w-3" /> Quarterly Metrics
            </TabsTrigger>
            </TabsList>
          </div>

          {/* ═══ OVERVIEW TAB ═══ */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Price Chart */}
              <Card className="p-4 bg-card border-border card-glow">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Price History</h3>
                {priceChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={priceChartData}>
                      <defs>
                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(142 70% 45%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(142 70% 45%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 16%)" />
                      <XAxis dataKey="date" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Area type="monotone" dataKey="price" stroke="hsl(142 70% 45%)" fill="url(#priceGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState text="No price data. Use Price & financials above." />
                )}
              </Card>

              {/* Revenue & Profit Trend */}
              <Card className="p-4 bg-card border-border card-glow">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Revenue & Profit (Cr)</h3>
                {yearlyChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={yearlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 16%)" />
                      <XAxis dataKey="year" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                      <Bar dataKey="revenue" name="Revenue" fill="hsl(200 80% 55%)" radius={[2, 2, 0, 0]} opacity={0.7} />
                      <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke="hsl(142 70% 45%)" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState text="No financial data. Use Price & financials above." />
                )}
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* ROCE/ROE Trend */}
              {yearlyChartData.some(d => d.roce || d.roe) && (
                <Card className="p-4 bg-card border-border card-glow">
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">ROCE & ROE Trend (%)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={yearlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 16%)" />
                      <XAxis dataKey="year" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <ReferenceLine y={15} stroke="hsl(215 15% 35%)" strokeDasharray="3 3" label={{ value: "15%", fill: "hsl(215 15% 40%)", fontSize: 9 }} />
                      <Line type="monotone" dataKey="roce" name="ROCE" stroke="hsl(142 70% 45%)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="roe" name="ROE" stroke="hsl(185 80% 55%)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Sentiment Trend */}
              <Card className="p-4 bg-card border-border card-glow">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Sentiment Trend (from AI Analysis)</h3>
                {sentimentData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={sentimentData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 16%)" />
                      <XAxis dataKey="quarter" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 10]} tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <ReferenceLine y={7} stroke="hsl(142 70% 45%)" strokeDasharray="3 3" strokeOpacity={0.4} />
                      <ReferenceLine y={4} stroke="hsl(0 72% 50%)" strokeDasharray="3 3" strokeOpacity={0.4} />
                      <Line type="monotone" dataKey="score" stroke="hsl(185 80% 55%)" strokeWidth={2} dot={{ fill: "hsl(185 80% 55%)", r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState text="No analysis yet. Upload a transcript on the Transcripts page → AI analyzes it automatically." />
                )}
              </Card>
            </div>

            {/* Transcript analysis (Transcripts page) — full detail lives here; Snapshots tab = quarterly Gemini JSON */}
            {latestAnalysis ? (
              <>
                <Card className="p-3 bg-muted/50 border-border rounded">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>Transcripts</strong> flow: paste an earnings call → drivers, risks, tone, sentiment.{" "}
                    <strong>Snapshots</strong> tab holds quarterly Gemini imports (thesis, metrics, raw JSON).
                  </p>
                </Card>
                <Card className="p-5 bg-card border-border card-glow">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
                    <div>
                      <h3 className="font-mono text-sm font-semibold text-foreground">
                        {latestAnalysis.quarter} {latestAnalysis.year}
                      </h3>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">Latest concall transcript analysis</p>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      {latestAnalysis.management_tone && <ToneBadge tone={latestAnalysis.management_tone} />}
                      {latestAnalysis.sentiment_score && <SentimentBadge score={latestAnalysis.sentiment_score} size="md" />}
                    </div>
                  </div>

                  {latestAnalysis.analysis_summary && (
                    <p className="text-sm text-foreground leading-relaxed mb-5">{latestAnalysis.analysis_summary}</p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                    {latestAnalysis.guidance && (
                      <InfoCard icon={<Target className="h-3.5 w-3.5 text-terminal-cyan" />} title="Guidance" text={latestAnalysis.guidance} />
                    )}
                    {latestAnalysis.demand_outlook && (
                      <InfoCard icon={<TrendingUp className="h-3.5 w-3.5 text-terminal-green" />} title="Demand Outlook" text={latestAnalysis.demand_outlook} />
                    )}
                    {latestAnalysis.capacity_expansion && (
                      <InfoCard icon={<BarChart3 className="h-3.5 w-3.5 text-terminal-amber" />} title="Capacity Expansion" text={latestAnalysis.capacity_expansion} />
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {latestAnalysis.growth_drivers && (
                      <InsightList title="Growth Drivers" items={latestAnalysis.growth_drivers as string[]} icon={<TrendingUp className="h-3 w-3" />} color="terminal-green" />
                    )}
                    {latestAnalysis.risks && (
                      <InsightList title="Risks" items={latestAnalysis.risks as string[]} icon={<AlertTriangle className="h-3 w-3" />} color="terminal-red" />
                    )}
                    {latestAnalysis.margin_drivers && (
                      <InsightList title="Margin Drivers" items={latestAnalysis.margin_drivers as string[]} icon={<TrendingUp className="h-3 w-3" />} color="terminal-cyan" />
                    )}
                    {latestAnalysis.industry_tailwinds && (
                      <InsightList title="Industry Tailwinds" items={latestAnalysis.industry_tailwinds as string[]} icon={<Zap className="h-3 w-3" />} color="terminal-blue" />
                    )}
                    {latestAnalysis.hidden_signals && (
                      <InsightList title="Hidden Signals" items={latestAnalysis.hidden_signals as string[]} icon={<Zap className="h-3 w-3" />} color="terminal-amber" />
                    )}
                  </div>

                  {latestAnalysis.important_quotes && (latestAnalysis.important_quotes as string[]).length > 0 && (
                    <div className="mt-5">
                      <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                        <Quote className="h-3 w-3" /> Important Quotes
                      </h4>
                      <div className="space-y-2">
                        {(latestAnalysis.important_quotes as string[]).map((q, i) => (
                          <blockquote key={i} className="text-xs text-muted-foreground italic border-l-2 border-terminal-cyan/40 pl-3 py-1">
                            &ldquo;{q}&rdquo;
                          </blockquote>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>

                {analyses && analyses.length > 1 && (
                  <Card className="p-4 bg-card border-border card-glow">
                    <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Older concall analyses</h3>
                    <div className="space-y-2">
                      {analyses.slice(1).map((a) => (
                        <div key={a.id} className="p-3 bg-muted rounded border border-border/50 hover:border-border transition-colors">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <span className="font-mono text-xs font-semibold text-foreground">{a.quarter} {a.year}</span>
                            <div className="flex gap-2">
                              {a.management_tone && <ToneBadge tone={a.management_tone} />}
                              {a.sentiment_score && <SentimentBadge score={a.sentiment_score} />}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{a.analysis_summary}</p>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </>
            ) : snapshots && snapshots.length > 0 ? (
              <Card className="p-5 bg-card border-border card-glow space-y-4">
                <div>
                  <h3 className="font-mono text-sm font-semibold text-foreground">Quarterly AI (Gemini) — no concall transcript run yet</h3>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    You have <strong>{snapshots.length}</strong> imported snapshot(s). Thesis, scores, metrics, and raw JSON are in the{" "}
                    <strong className="text-foreground">Snapshots</strong> tab. To get classic transcript extraction (drivers, risks, tone), open{" "}
                    <strong className="text-foreground">Transcripts</strong> and analyze an earnings call for this stock.
                  </p>
                </div>
                {snapshots[0] && (
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Latest quarter preview</p>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="font-mono text-xs font-semibold">{snapshots[0].quarter}</span>
                      <SnapshotThesisBadge thesisStatus={snapshots[0].thesis_status} />
                      {snapshots[0].portfolio_rank != null && snapshots[0].portfolio_cohort_size != null && (
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] text-primary border-primary/40"
                          title="Cohort rank for this quarter (thesis-first, then confidence)"
                        >
                          #{snapshots[0].portfolio_rank}/{snapshots[0].portfolio_cohort_size}
                        </Badge>
                      )}
                    </div>
                    {snapshots[0].summary && (
                      <p className="text-xs text-muted-foreground line-clamp-4">{snapshots[0].summary}</p>
                    )}
                  </div>
                )}
              </Card>
            ) : (
              <Card className="p-5 bg-card border-border card-glow">
                <p className="text-sm text-muted-foreground leading-relaxed text-center">
                  No concall analysis and no quarterly snapshots yet. Use <strong className="text-foreground">Transcripts</strong> (paste a call) or{" "}
                  <strong className="text-foreground">Snapshots</strong> (import Gemini JSON) to add research.
                </p>
              </Card>
            )}

            {/* Management Credibility (3 dimensions) */}
            <ManagementCredibility promises={promises || []} analyses={analyses || []} commitments={commitments || []} />
          </TabsContent>

          {/* ═══ FINANCIALS TAB ═══ */}
          <TabsContent value="financials" className="space-y-4 mt-4">
            {/* Profit & Loss Table */}
            {financials && financials.length > 0 && (
              <Card className="p-4 bg-card border-border card-glow overflow-hidden">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Profit & Loss (₹ Cr)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full data-grid">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Year</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Revenue</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Rev Growth</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Net Profit</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Prof Growth</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">OPM %</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">EPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financials.map((f) => (
                        <tr key={f.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="p-2 font-semibold text-foreground">{f.year}</td>
                          <td className="p-2 text-right text-foreground font-mono">
                            {(f as any).revenue != null ? Number((f as any).revenue).toLocaleString() : "—"}
                          </td>
                          <td className="p-2 text-right">
                            <ColoredValue value={f.revenue_growth} suffix="%" goodAbove={15} />
                          </td>
                          <td className="p-2 text-right text-foreground font-mono">
                            {(f as any).net_profit != null ? Number((f as any).net_profit).toLocaleString() : "—"}
                          </td>
                          <td className="p-2 text-right">
                            <ColoredValue value={f.profit_growth} suffix="%" goodAbove={15} />
                          </td>
                          <td className="p-2 text-right">
                            <ColoredValue value={(f as any).opm} suffix="%" goodAbove={15} />
                          </td>
                          <td className="p-2 text-right text-foreground font-mono">
                            {(f as any).eps != null ? (f as any).eps : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Key Ratios Table */}
            {financials && financials.length > 0 && (
              <Card className="p-4 bg-card border-border card-glow overflow-hidden">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Key Ratios</h3>
                <div className="overflow-x-auto">
                  <table className="w-full data-grid">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Year</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">ROCE %</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">ROE %</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">D/E</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">FCF (Cr)</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Promoter %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financials.map((f) => (
                        <tr key={f.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="p-2 font-semibold text-foreground">{f.year}</td>
                          <td className="p-2 text-right">
                            <ColoredValue value={f.roce} suffix="%" goodAbove={15} />
                          </td>
                          <td className="p-2 text-right">
                            <ColoredValue value={f.roe} suffix="%" goodAbove={15} />
                          </td>
                          <td className="p-2 text-right">
                            <ColoredValue value={f.debt_equity} goodBelow={1} />
                          </td>
                          <td className="p-2 text-right">
                            <ColoredValue value={f.free_cash_flow} goodAbove={0} />
                          </td>
                          <td className="p-2 text-right">
                            <ColoredValue value={f.promoter_holding} suffix="%" goodAbove={50} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Shareholding Pattern (Quarterly) */}
            {shareholding && shareholding.length > 0 && (
              <>
                <Card className="p-4 bg-card border-border card-glow">
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Shareholding Pattern (%)</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={shareholding}>
                      <defs>
                        <linearGradient id="promoterGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(142 70% 45%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(142 70% 45%)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fiiGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(200 80% 55%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(200 80% 55%)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="diiGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(45 90% 55%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(45 90% 55%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 16%)" />
                      <XAxis dataKey="quarter" tick={{ fill: "hsl(215 15% 50%)", fontSize: 9, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" height={50} />
                      <YAxis tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                      <Area type="monotone" dataKey="promoters" name="Promoters" stroke="hsl(142 70% 45%)" fill="url(#promoterGrad)" strokeWidth={2} />
                      <Area type="monotone" dataKey="fiis" name="FIIs" stroke="hsl(200 80% 55%)" fill="url(#fiiGrad)" strokeWidth={2} />
                      <Area type="monotone" dataKey="diis" name="DIIs" stroke="hsl(45 90% 55%)" fill="url(#diiGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>

                <Card className="p-4 bg-card border-border card-glow overflow-hidden">
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Quarterly Shareholding</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full data-grid">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Quarter</th>
                          <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Promoters</th>
                          <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">FIIs</th>
                          <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">DIIs</th>
                          <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Public</th>
                          <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Others</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...shareholding].reverse().map((sh, idx) => {
                          const prev = [...shareholding].reverse()[idx + 1];
                          const pChange = prev && sh.promoters != null && prev.promoters != null ? sh.promoters - prev.promoters : null;
                          const fChange = prev && sh.fiis != null && prev.fiis != null ? sh.fiis - prev.fiis : null;
                          const dChange = prev && sh.diis != null && prev.diis != null ? sh.diis - prev.diis : null;
                          return (
                            <tr key={sh.id} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="p-2 font-semibold text-foreground">{sh.quarter}</td>
                              <td className="p-2 text-right">
                                <span className="font-mono text-foreground">{sh.promoters != null ? `${sh.promoters}%` : "—"}</span>
                                {pChange !== null && pChange !== 0 && (
                                  <span className={`ml-1 text-[10px] font-mono ${pChange > 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                                    {pChange > 0 ? "↑" : "↓"}{Math.abs(pChange).toFixed(1)}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-right">
                                <span className="font-mono text-foreground">{sh.fiis != null ? `${sh.fiis}%` : "—"}</span>
                                {fChange !== null && fChange !== 0 && (
                                  <span className={`ml-1 text-[10px] font-mono ${fChange > 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                                    {fChange > 0 ? "↑" : "↓"}{Math.abs(fChange).toFixed(1)}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-right">
                                <span className="font-mono text-foreground">{sh.diis != null ? `${sh.diis}%` : "—"}</span>
                                {dChange !== null && dChange !== 0 && (
                                  <span className={`ml-1 text-[10px] font-mono ${dChange > 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                                    {dChange > 0 ? "↑" : "↓"}{Math.abs(dChange).toFixed(1)}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-right font-mono text-muted-foreground">{sh.public_holding != null ? `${sh.public_holding}%` : "—"}</td>
                              <td className="p-2 text-right font-mono text-muted-foreground">{sh.others != null ? `${sh.others}%` : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}

            {/* Charts */}
            {yearlyChartData.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="p-4 bg-card border-border card-glow">
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">OPM & EPS Trend</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={yearlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 16%)" />
                      <XAxis dataKey="year" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="opm" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="eps" orientation="right" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                      <Bar yAxisId="eps" dataKey="eps" name="EPS (₹)" fill="hsl(200 80% 55%)" radius={[2, 2, 0, 0]} opacity={0.6} />
                      <Line yAxisId="opm" type="monotone" dataKey="opm" name="OPM %" stroke="hsl(45 90% 55%)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Card>

                <Card className="p-4 bg-card border-border card-glow">
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Growth Trend</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={yearlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 16%)" />
                      <XAxis dataKey="year" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <ReferenceLine y={0} stroke="hsl(215 15% 35%)" />
                      <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                      <Bar dataKey="revGrowth" name="Revenue %" fill="hsl(200 80% 55%)" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="profGrowth" name="Profit %" fill="hsl(142 70% 45%)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>
            )}

            {/* Quarterly Results */}
            {quarterlyResults && quarterlyResults.length > 0 && (
              <Card className="p-4 bg-card border-border card-glow overflow-hidden">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Quarterly Results</h3>
                <div className="overflow-x-auto">
                  <table className="w-full data-grid">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Quarter</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Revenue (Cr)</th>
                        <th className="text-right p-2 text-muted-foreground text-[10px] uppercase tracking-wider">OPM %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quarterlyResults.map((q) => (
                        <tr key={q.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="p-2 font-semibold text-foreground">{q.quarter}</td>
                          <td className="p-2 text-right text-foreground font-mono">
                            {q.revenue !== null ? Number(q.revenue).toLocaleString() : "—"}
                          </td>
                          <td className="p-2 text-right">
                            <ColoredValue value={q.ebitda_margin} suffix="%" goodAbove={15} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Quarterly Chart */}
            {quarterlyChartData.length > 0 && (
              <Card className="p-4 bg-card border-border card-glow">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Quarterly Revenue & OPM</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={quarterlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 16%)" />
                    <XAxis dataKey="quarter" tick={{ fill: "hsl(215 15% 50%)", fontSize: 9, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" height={50} />
                    <YAxis yAxisId="rev" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="opm" orientation="right" tick={{ fill: "hsl(215 15% 50%)", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar yAxisId="rev" dataKey="revenue" name="Revenue (Cr)" fill="hsl(200 80% 55%)" radius={[2, 2, 0, 0]} />
                    <Line yAxisId="opm" type="monotone" dataKey="opm" name="OPM %" stroke="hsl(45 90% 55%)" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>
            )}

            {(!financials || financials.length === 0) && (!quarterlyResults || quarterlyResults.length === 0) && (
              <EmptyState text="No financial data. Use Price & financials on the stock header." />
            )}
          </TabsContent>

          {/* ═══ COMMITMENTS TAB ═══ */}
          <TabsContent value="commitments" className="space-y-4 mt-4">
            {commitments && commitments.length > 0 ? (
              <>
                <Card className="p-4 bg-card border-border card-glow">
                  <div className="flex items-center gap-6">
                    <div className="text-center min-w-[100px]">
                      <p className={`text-4xl font-mono font-bold ${
                        (credibility ?? 0) >= 70 ? "text-terminal-green" : (credibility ?? 0) >= 40 ? "text-terminal-amber" : "text-terminal-red"
                      }`}>
                        {credibility ?? 0}%
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-1">Credibility Score</p>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                        <span>{achievedCount} Achieved</span>
                        <span>{commitments.filter(c => c.status === "Missed").length} Missed</span>
                        <span>{commitments.filter(c => c.status === "Pending").length} Pending</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                        <div className="h-full bg-terminal-green" style={{ width: `${totalCommitments > 0 ? (achievedCount / totalCommitments) * 100 : 0}%` }} />
                        <div className="h-full bg-terminal-red" style={{ width: `${totalCommitments > 0 ? (commitments.filter(c => c.status === "Missed").length / totalCommitments) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-4 bg-card border-border card-glow overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full data-grid">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Quarter</th>
                          <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Commitment</th>
                          <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Metric</th>
                          <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Target</th>
                          <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Timeline</th>
                          <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {commitments.map((c) => (
                          <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="p-2 text-foreground font-mono text-xs">{c.quarter}</td>
                            <td className="p-2 text-foreground text-xs max-w-[300px]">{c.statement}</td>
                            <td className="p-2 text-muted-foreground text-xs">{c.metric || "—"}</td>
                            <td className="p-2 text-muted-foreground text-xs font-mono">{c.target_value || "—"}</td>
                            <td className="p-2 text-muted-foreground text-xs">{c.timeline || "—"}</td>
                            <td className="p-2 text-center">
                              <Badge variant="outline" className={`font-mono text-[10px] ${
                                c.status === "Achieved" ? "text-terminal-green border-terminal-green/30 bg-terminal-green/10" :
                                c.status === "Missed" ? "text-terminal-red border-terminal-red/30 bg-terminal-red/10" :
                                "text-terminal-amber border-terminal-amber/30 bg-terminal-amber/10"
                              }`}>{c.status}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            ) : (
              <EmptyState text="No commitments tracked yet. Analyze a transcript to extract management commitments." />
            )}
          </TabsContent>

          {/* ═══ PROMISES TAB ═══ */}
          <TabsContent value="promises" className="space-y-4 mt-4">
            <PromisesTab stockId={id!} />
          </TabsContent>

          {/* ═══ SNAPSHOTS TAB ═══ */}
          <TabsContent value="snapshots" className="space-y-4 mt-4">
            <SnapshotsTab stockId={id!} />
          </TabsContent>

          {/* ═══ DEALS TAB ═══ */}
          <TabsContent value="deals" className="space-y-4 mt-4">
            <DealsTab stockId={stock.id} ticker={stock.ticker} />
          </TabsContent>

          {/* ═══ TIMELINE TAB ═══ */}
          <TabsContent value="timeline" className="space-y-4 mt-4">
            <ThesisTimeline snapshots={snapshots || []} promises={promises || []} />
          </TabsContent>

          {/* ═══ ANNOUNCEMENTS TAB ═══ */}
          <TabsContent value="announcements" className="space-y-6 mt-4">
            {/* ── Section 1: Live News Feed ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <Newspaper className="h-4 w-4 text-primary" />
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">
                  Live News Feed (NSE/BSE)
                </h3>
              </div>
              <div className="flex justify-between items-center bg-muted/20 p-3 rounded-lg border border-dashed border-border mb-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">Master Reset &amp; Super Sync</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">Delete all announcements + all documents, then resync from scratch (1yr lookback).</p>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleSuperSync} 
                  disabled={superSyncing}
                  className="font-mono text-xs border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10 h-8"
                >
                  {superSyncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Nuclear Reset &amp; Sync
                </Button>
              </div>
              <CorporateAnnouncements stockId={id!} />
            </div>

            <Separator className="bg-border/40" />

            {/* ── Section 2: Official Filings (PDFs) ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <FileText className="h-4 w-4 text-primary" />
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">
                  Official Filings (PDFs)
                </h3>
              </div>
              
              <Card className="p-4 bg-card border-border card-glow min-w-0 overflow-hidden">
                <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-start sm:justify-between">
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground min-w-0">
                    Downloaded filings — earnings, concall transcripts, investor presentations
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:justify-end sm:max-w-none">
                    <GoogleDriveStatus />
                    {driveConfigured && (
                      <>
                        {filings.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleUploadToDrive}
                            disabled={uploadingToDrive}
                            className="font-mono text-xs shrink-0"
                          >
                            {uploadingToDrive ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                            <span className="ml-1">Upload to Drive</span>
                          </Button>
                        )}
                        {lastUploadErrors && lastUploadErrors.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleUploadToDrive}
                            disabled={uploadingToDrive}
                            className="font-mono text-xs border-terminal-amber/50 text-terminal-amber hover:bg-terminal-amber/10 shrink-0"
                          >
                            {uploadingToDrive ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            <span className="ml-1">Retry failed ({lastUploadErrors.length})</span>
                          </Button>
                        )}
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const result = await refetchFilings();
                        if (result.data?.ok && Array.isArray(result.data.files)) {
                          const n = result.data.files.length;
                          toast({
                            title: "Refreshed",
                            description: n > 0 ? `${n} filing(s) listed.` : "No filings in data folder.",
                          });
                        }
                      }}
                      className="font-mono text-xs shrink-0"
                    >
                      {filingsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      <span className="ml-1">Refresh</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadZip}
                      disabled={downloadingZip}
                      className="font-mono text-xs border-terminal-green/30 text-terminal-green hover:bg-terminal-green/10 shrink-0 h-9"
                    >
                      {downloadingZip ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Download className="h-3 w-3 mr-1" />}
                      Download ZIP (FY25/FY26)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSyncMissing}
                      disabled={syncingMissing}
                      className="font-mono text-xs border-primary/30 text-primary hover:bg-primary/10 shrink-0 h-9"
                    >
                      {syncingMissing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      Sync Pending Quarters
                    </Button>
                  </div>
                </div>

                {filingsLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground font-mono text-sm">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
                  </div>
                ) : filings.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground font-mono text-sm">
                    No filings found. Click <strong>Sync Pending Quarters</strong> above to check for and sync all missing documents.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {[
                        { value: null, label: "All" },
                        { value: "earnings_result", label: "Earnings" },
                        { value: "concall_transcript", label: "Concalls" },
                        { value: "investor_presentation", label: "Presentations" },
                        { value: "raw_xbrl", label: "XBRL Files" },
                      ].map(({ value, label }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setAnnouncementCategoryFilter(value)}
                          className={`rounded-full px-3 py-1 font-mono text-xs border transition-colors ${
                            announcementCategoryFilter === value ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <Accordion type="multiple" className="w-full">
                      {(() => {
                        const filtered = announcementCategoryFilter ? filings.filter((f: any) => f.category === announcementCategoryFilter) : filings;
                        if (filtered.length === 0 && announcementCategoryFilter) {
                          return (
                            <div className="py-8 text-center text-muted-foreground font-mono text-xs opacity-50">
                              No {announcementCategoryFilter.replace(/_/g, " ")} files found for this ticker.
                            </div>
                          );
                        }
                        const byQuarter = filtered.reduce((acc: any, f: any) => {
                          const q = f.quarter || "Unknown";
                          if (!acc[q]) acc[q] = [];
                          acc[q].push(f);
                          return acc;
                        }, {});
                        return Object.entries(byQuarter).map(([q, qFiles]: [string, any]) => (
                          <AccordionItem key={q} value={q}>
                            <AccordionTrigger className="hover:no-underline py-2 px-1">
                              <span className="font-mono text-xs font-bold">{q}</span>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <tbody>
                                    {qFiles.map((f: any) => (
                                      <tr key={f.filename} className="border-b border-border/50">
                                        <td className="p-2 font-mono">
                                          {f.filename}
                                          {f.localMissing && (
                                            <Badge variant="outline" className="ml-2 h-3 text-[8px] border-primary/30 text-primary uppercase">Drive Only</Badge>
                                          )}
                                        </td>
                                        <td className="p-2 text-right">
                                          <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            onClick={() => {
                                              const targetUrl = f.url || f.drive_web_link;
                                              if (targetUrl) window.open(targetUrl, "_blank");
                                            }}
                                            disabled={!f.url && !f.drive_web_link}
                                          >
                                            View
                                          </Button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ));
                      })()}
                    </Accordion>
                  </>
                )}
              </Card>
            </div>
          </TabsContent>

          {/* ═══ QUARTERLY METRICS TAB ═══ */}
          <TabsContent value="quarterly" className="space-y-4 mt-4">
            <QuarterlyMetricsTab stockId={id!} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// Signal detection moved to @/lib/signals.ts

// ── HELPER COMPONENTS ──

function RatioCard({ label, value, suffix, good }: {
  label: string; value: number | null; suffix?: string; good: boolean;
}) {
  const color = value === null ? "text-muted-foreground" : good ? "text-terminal-green" : "text-terminal-amber";
  return (
    <div className="bg-card border border-border rounded p-3 text-center card-glow">
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={`text-lg font-mono font-bold ${color}`}>
        {value !== null ? `${value}${suffix || ""}` : "—"}
      </p>
    </div>
  );
}

function ColoredValue({ value, suffix, goodAbove, goodBelow }: {
  value: number | null; suffix?: string; goodAbove?: number; goodBelow?: number;
}) {
  if (value === null) return <span className="font-mono text-muted-foreground">—</span>;
  
  let isGood = false;
  if (goodAbove !== undefined) isGood = value >= goodAbove;
  if (goodBelow !== undefined) isGood = value <= goodBelow;

  return (
    <span className={`font-mono ${isGood ? "text-terminal-green" : value < 0 ? "text-terminal-red" : "text-terminal-amber"}`}>
      {value}{suffix || ""}
    </span>
  );
}

function InfoCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="p-3 bg-muted rounded border border-border/50">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
        {icon} {title}
      </p>
      <p className="text-xs text-foreground leading-relaxed">{text}</p>
    </div>
  );
}

function InsightList({ title, items, icon, color }: {
  title: string; items: string[]; icon: React.ReactNode; color: string;
}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="p-3 bg-muted rounded border border-border/50">
      <h4 className={`font-mono text-[10px] uppercase tracking-wider text-${color} mb-2 flex items-center gap-1.5`}>
        {icon} {title}
      </h4>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-foreground flex items-start gap-2">
            <span className={`mt-1.5 h-1 w-1 rounded-full flex-shrink-0 bg-${color}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-[200px] flex items-center justify-center text-muted-foreground font-mono text-xs text-center px-4">
      {text}
    </div>
  );
}
