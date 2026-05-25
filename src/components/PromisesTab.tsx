import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useManagementPromises } from "@/hooks/useStocks";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MOCK_PROMISES = [
  { id: "mock-1", promise_text: "Achieve 25% revenue growth by Q2FY26", made_in_quarter: "Q3FY25", status: "pending", target_deadline: "Q2FY26", resolved_in_quarter: null },
  { id: "mock-2", promise_text: "Reduce debt-to-equity below 0.5", made_in_quarter: "Q2FY25", status: "kept", target_deadline: "Q4FY25", resolved_in_quarter: "Q4FY25" },
  { id: "mock-3", promise_text: "Launch new product line in domestic market", made_in_quarter: "Q1FY25", status: "broken", target_deadline: "Q3FY25", resolved_in_quarter: "Q3FY25" },
  { id: "mock-4", promise_text: "Expand capacity by 30% at Hosur plant", made_in_quarter: "Q2FY25", status: "pending", target_deadline: "Q1FY26", resolved_in_quarter: null },
  { id: "mock-5", promise_text: "Maintain OPM above 18%", made_in_quarter: "Q1FY25", status: "kept", target_deadline: null, resolved_in_quarter: "Q2FY25" },
];

interface Props {
  stockId: string;
}

export function PromisesTab({ stockId }: Props) {
  const { data: dbPromises } = useManagementPromises(stockId);
  const promises = dbPromises && dbPromises.length > 0 ? dbPromises : MOCK_PROMISES;
  const isMock = !dbPromises || dbPromises.length === 0;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [updating, setUpdating] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newPromise, setNewPromise] = useState({ promise_text: "", made_in_quarter: "", target_deadline: "" });
  const [adding, setAdding] = useState(false);

  const kept = promises.filter(p => p.status === "kept").length;
  const broken = promises.filter(p => p.status === "broken").length;
  const pending = promises.filter(p => p.status === "pending").length;
  const resolved = kept + broken;
  const credibility = resolved > 0 ? Math.round((kept / resolved) * 100) : null;

  const handleStatusChange = async (id: string, newStatus: string, currentQuarter?: string) => {
    if (isMock) { toast({ title: "Mock data", description: "Import real data first.", variant: "destructive" }); return; }
    setUpdating(id);
    try {
      const update: Record<string, string | null> = { status: newStatus };
      if (newStatus === "kept" || newStatus === "broken") {
        update.resolved_in_quarter = currentQuarter || null;
      } else {
        update.resolved_in_quarter = null;
      }
      const { error } = await supabase.from("management_promises").update(update).eq("id", id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["management-promises", stockId] });
      toast({ title: "Status updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUpdating(null);
    }
  };

  const handleAdd = async () => {
    if (!newPromise.promise_text || !newPromise.made_in_quarter) {
      toast({ title: "Fill required fields", variant: "destructive" }); return;
    }
    setAdding(true);
    try {
      const { error } = await supabase.from("management_promises").insert({
        stock_id: stockId,
        promise_text: newPromise.promise_text,
        made_in_quarter: newPromise.made_in_quarter,
        target_deadline: newPromise.target_deadline || null,
        status: "pending",
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["management-promises", stockId] });
      setNewPromise({ promise_text: "", made_in_quarter: "", target_deadline: "" });
      setShowAdd(false);
      toast({ title: "Promise added" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isMock) return;
    setUpdating(id);
    try {
      const { error } = await supabase.from("management_promises").delete().eq("id", id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["management-promises", stockId] });
      toast({ title: "Promise deleted" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="space-y-4">
      {isMock && (
        <Card className="p-3 bg-muted/50 border-border rounded">
          <p className="text-xs text-muted-foreground">
            <strong>Mock data shown.</strong> Import a Gemini analysis from the Transcripts page to populate real promises.
          </p>
        </Card>
      )}

      {/* Credibility Score */}
      <Card className="p-4 bg-card border-border card-glow">
        <div className="flex items-center gap-6">
          <div className="text-center min-w-[100px]">
            <p className={`text-4xl font-mono font-bold ${
              credibility === null ? "text-muted-foreground" :
              credibility >= 70 ? "text-terminal-green" :
              credibility >= 40 ? "text-terminal-amber" : "text-terminal-red"
            }`}>
              {credibility !== null ? `${credibility}%` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">Credibility Score</p>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
              <span className="text-terminal-green">{kept} Kept</span>
              <span className="text-terminal-red">{broken} Broken</span>
              <span className="text-terminal-amber">{pending} Pending</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden flex">
              {resolved > 0 && (
                <>
                  <div className="h-full bg-terminal-green" style={{ width: `${(kept / promises.length) * 100}%` }} />
                  <div className="h-full bg-terminal-red" style={{ width: `${(broken / promises.length) * 100}%` }} />
                  <div className="h-full bg-terminal-amber" style={{ width: `${(pending / promises.length) * 100}%` }} />
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Add Promise */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="font-mono text-xs" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="h-3 w-3 mr-1" /> Add Promise
        </Button>
      </div>

      {showAdd && (
        <Card className="p-4 bg-card border-border space-y-3">
          <Input placeholder="Promise text *" value={newPromise.promise_text} onChange={e => setNewPromise(p => ({ ...p, promise_text: e.target.value }))} className="font-mono text-xs" />
          <div className="flex gap-2">
            <Input placeholder="Made in quarter (e.g. Q3FY25) *" value={newPromise.made_in_quarter} onChange={e => setNewPromise(p => ({ ...p, made_in_quarter: e.target.value }))} className="font-mono text-xs" />
            <Input placeholder="Target deadline (e.g. Q1FY26)" value={newPromise.target_deadline} onChange={e => setNewPromise(p => ({ ...p, target_deadline: e.target.value }))} className="font-mono text-xs" />
          </div>
          <Button size="sm" onClick={handleAdd} disabled={adding} className="font-mono text-xs">
            {adding ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Save
          </Button>
        </Card>
      )}

      {/* Promises Table */}
      <Card className="p-4 bg-card border-border card-glow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full data-grid">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Made In</th>
                <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Promise</th>
                <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Deadline</th>
                <th className="text-left p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Resolved In</th>
                <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider">Status</th>
                <th className="text-center p-2 text-muted-foreground text-[10px] uppercase tracking-wider w-10"></th>
              </tr>
            </thead>
            <tbody>
              {promises.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="p-2 text-foreground font-mono text-xs">{p.made_in_quarter}</td>
                  <td className="p-2 text-foreground text-xs max-w-[350px]">{p.promise_text}</td>
                  <td className="p-2 text-muted-foreground text-xs font-mono">{p.target_deadline || "—"}</td>
                  <td className="p-2 text-muted-foreground text-xs font-mono">{p.resolved_in_quarter || "—"}</td>
                  <td className="p-2 text-center">
                    {updating === p.id ? (
                      <Loader2 className="h-3 w-3 animate-spin mx-auto text-muted-foreground" />
                    ) : (
                      <Select
                        value={p.status}
                        onValueChange={(val) => handleStatusChange(p.id, val, p.target_deadline || undefined)}
                        disabled={isMock}
                      >
                        <SelectTrigger className={`h-6 w-[90px] font-mono text-[10px] border-0 bg-transparent ${
                          p.status === "kept" ? "text-terminal-green" :
                          p.status === "broken" ? "text-terminal-red" :
                          "text-terminal-amber"
                        }`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending" className="font-mono text-xs">pending</SelectItem>
                          <SelectItem value="kept" className="font-mono text-xs">kept</SelectItem>
                          <SelectItem value="broken" className="font-mono text-xs">broken</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {!isMock && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(p.id)} disabled={updating === p.id}>
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
