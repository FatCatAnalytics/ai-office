import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DollarSign, Zap, ArrowDownLeft, ArrowUpRight, RefreshCw, TrendingUp, Activity } from "lucide-react";
import { PROVIDER_COLORS } from "../types";

interface BudgetRow {
  provider: string;
  modelId: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  costUsd: number;
}

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function fmtCost(n: number) {
  if (n >= 1) return "$" + n.toFixed(4);
  if (n >= 0.001) return "$" + n.toFixed(4);
  return "$" + n.toFixed(6);
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  kimi: "Kimi",
  deepseek: "DeepSeek",
};

function ProviderBadge({ provider }: { provider: string }) {
  const color = PROVIDER_COLORS[provider] ?? "#64748b";
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
      {PROVIDER_LABEL[provider] ?? provider}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3 border border-slate-800 bg-slate-900/60">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ background: `${color}22`, border: `1px solid ${color}33` }}>
        <Icon size={15} style={{ color }} />
      </div>
      <div>
        <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
        <div className="text-lg font-bold text-slate-100 font-mono leading-tight">{value}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

export default function BudgetPage() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading, refetch } = useQuery<BudgetRow[]>({
    queryKey: ["/api/budget"],
    queryFn: () => apiRequest("GET", "/api/budget").then(r => r.json()),
    refetchInterval: 5000,
  });

  // Live runs broadcast `aioffice:budget_update` from useWebSocket whenever a
  // worker records token usage. Invalidating the query gives near-instant
  // updates during streaming runs (the 5s polling interval is the fallback).
  useEffect(() => {
    const onBudgetUpdate = () => {
      qc.invalidateQueries({ queryKey: ["/api/budget"] });
    };
    window.addEventListener("aioffice:budget_update", onBudgetUpdate);
    return () => window.removeEventListener("aioffice:budget_update", onBudgetUpdate);
  }, [qc]);

  const totalCost   = rows.reduce((s, r) => s + r.costUsd, 0);
  const totalTokens = rows.reduce((s, r) => s + r.totalTokens, 0);
  const totalIn     = rows.reduce((s, r) => s + r.tokensIn, 0);
  const totalOut    = rows.reduce((s, r) => s + r.tokensOut, 0);
  const totalReqs   = rows.reduce((s, r) => s + r.requests, 0);

  // Group by provider for the provider summary strip
  const byProvider = Object.entries(
    rows.reduce<Record<string, { cost: number; tokens: number }>>((acc, r) => {
      if (!acc[r.provider]) acc[r.provider] = { cost: 0, tokens: 0 };
      acc[r.provider].cost += r.costUsd;
      acc[r.provider].tokens += r.totalTokens;
      return acc;
    }, {})
  ).sort((a, b) => b[1].cost - a[1].cost);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <DollarSign size={15} className="text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">Token Budget</span>
          <span className="text-xs text-slate-500 ml-1">per model breakdown</span>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          data-testid="button-refresh-budget">
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll px-5 py-4 space-y-5">

        {/* Top summary cards */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard icon={DollarSign} label="Total Cost"      value={fmtCost(totalCost)}  sub="all time"            color="#f59e0b" />
          <StatCard icon={Zap}        label="Total Tokens"    value={fmt(totalTokens)}    sub={`${totalReqs} calls`} color="#06b6d4" />
          <StatCard icon={ArrowDownLeft} label="Tokens In"    value={fmt(totalIn)}        sub="input"               color="#8b5cf6" />
          <StatCard icon={ArrowUpRight}  label="Tokens Out"   value={fmt(totalOut)}       sub="output"              color="#10b981" />
        </div>

        {/* Provider bar */}
        {byProvider.length > 0 && (
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Cost by provider</div>
            <div className="flex gap-0 rounded-lg overflow-hidden h-3 bg-slate-800">
              {byProvider.map(([provider, stats]) => {
                const pct = totalCost > 0 ? (stats.cost / totalCost) * 100 : 0;
                const color = PROVIDER_COLORS[provider] ?? "#64748b";
                return (
                  <div
                    key={provider}
                    style={{ width: `${pct}%`, background: color }}
                    title={`${PROVIDER_LABEL[provider] ?? provider}: ${fmtCost(stats.cost)}`}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-2">
              {byProvider.map(([provider, stats]) => {
                const color = PROVIDER_COLORS[provider] ?? "#64748b";
                const pct = totalCost > 0 ? (stats.cost / totalCost * 100).toFixed(1) : "0";
                return (
                  <div key={provider} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                    <span className="text-slate-400">{PROVIDER_LABEL[provider] ?? provider}</span>
                    <span className="text-slate-500">{pct}%</span>
                    <span className="text-slate-400 font-mono">{fmtCost(stats.cost)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per-model table */}
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Per-model breakdown</div>

          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-slate-600 text-sm">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-slate-600 rounded-xl border border-slate-800 bg-slate-900/30">
              <Activity size={24} className="opacity-40" />
              <div className="text-sm text-center">
                <div className="text-slate-400 font-medium mb-1">No token data yet</div>
                <div className="text-xs text-slate-600">Run a project to start tracking usage.<br/>In SIM mode, each completed task generates token records.</div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <table className="w-full text-xs" data-testid="budget-table">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/80">
                    <th className="text-left px-4 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Model</th>
                    <th className="text-right px-3 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Requests</th>
                    <th className="text-right px-3 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Tokens In</th>
                    <th className="text-right px-3 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Tokens Out</th>
                    <th className="text-right px-3 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Total</th>
                    <th className="text-right px-4 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const color = PROVIDER_COLORS[row.provider] ?? "#64748b";
                    const costShare = totalCost > 0 ? (row.costUsd / totalCost) * 100 : 0;
                    return (
                      <tr
                        key={`${row.provider}-${row.modelId}`}
                        className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30 transition-colors"
                        data-testid={`budget-row-${i}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ProviderBadge provider={row.provider} />
                            <span className="font-mono text-slate-200">{row.modelId}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-300">{row.requests.toLocaleString()}</td>
                        <td className="px-3 py-3 text-right font-mono text-purple-400">{fmt(row.tokensIn)}</td>
                        <td className="px-3 py-3 text-right font-mono text-emerald-400">{fmt(row.tokensOut)}</td>
                        <td className="px-3 py-3 text-right font-mono text-cyan-400">{fmt(row.totalTokens)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Cost bar */}
                            <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${costShare}%`, background: color }}
                              />
                            </div>
                            <span className="font-mono font-semibold" style={{ color }}>{fmtCost(row.costUsd)}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {rows.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-700 bg-slate-900/60">
                      <td className="px-4 py-2.5 text-slate-400 font-semibold">Total</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300 font-semibold">{totalReqs.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-purple-400 font-semibold">{fmt(totalIn)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-400 font-semibold">{fmt(totalOut)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-cyan-400 font-semibold">{fmt(totalTokens)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-amber-400">{fmtCost(totalCost)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Cost per token info */}
        {rows.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp size={12} className="text-slate-500" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">Effective rates</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {rows.map(row => {
                const rate = row.totalTokens > 0 ? (row.costUsd / row.totalTokens * 1000).toFixed(5) : "—";
                return (
                  <div key={`${row.provider}-${row.modelId}`} className="text-xs text-slate-500">
                    <span className="font-mono text-slate-400">{row.modelId}</span>
                    <span className="mx-1 text-slate-700">·</span>
                    <span className="font-mono text-slate-400">${rate}/1K tok</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
