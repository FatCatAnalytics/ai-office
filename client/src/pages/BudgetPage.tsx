import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DollarSign, Zap, ArrowDownLeft, ArrowUpRight, RefreshCw, TrendingUp, Activity, AlertTriangle, ExternalLink, Wallet } from "lucide-react";
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

// /api/budget/balances row shape (matches hydrateBalance() in server/routes.ts).
interface BalanceRow {
  id: string;
  provider: string;
  modelId: string;
  capUsd: number;
  balanceUsd: number;
  usedUsd: number;
  source: "live" | "tracked" | "manual" | string;
  alertThreshold: number;
  failoverMode: "ask" | "auto" | "block" | string;
  fallbackChain: string[];
  lastFetchedAt: number | null;
  fetchError: string | null;
  pctUsed: number;
}

// Provider "top up" billing pages — opens in a new tab when the operator clicks
// the link. These are public dashboard URLs; the user signs in there.
const PROVIDER_BILLING_URL: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/billing",
  openai:    "https://platform.openai.com/account/billing/overview",
  google:    "https://aistudio.google.com/app/apikey",
  kimi:      "https://platform.moonshot.cn/console/account",
  deepseek:  "https://platform.deepseek.com/usage",
};

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

  // Provider balance caps + tracked spend (Stage 5.x.12). Updated whenever the
  // server broadcasts `balances_update` over the websocket OR every 30 seconds
  // as a fallback. The /refresh endpoint is the only thing that does live API
  // calls, so we only call it on user click.
  const { data: balances = [], refetch: refetchBalances } = useQuery<BalanceRow[]>({
    queryKey: ["/api/budget/balances"],
    queryFn: () => apiRequest("GET", "/api/budget/balances").then(r => r.json()),
    refetchInterval: 30000,
  });

  const [refreshingBalances, setRefreshingBalances] = useState(false);
  const triggerLiveRefresh = async () => {
    if (refreshingBalances) return;
    setRefreshingBalances(true);
    try {
      await apiRequest("POST", "/api/budget/balances/refresh");
      await refetchBalances();
    } catch { /* swallow — toast would be noisy on a poll */ }
    finally { setRefreshingBalances(false); }
  };

  // Live runs broadcast `aioffice:budget_update` from useWebSocket whenever a
  // worker records token usage. Invalidating the query gives near-instant
  // updates during streaming runs (the 5s polling interval is the fallback).
  useEffect(() => {
    const onBudgetUpdate = () => {
      qc.invalidateQueries({ queryKey: ["/api/budget"] });
    };
    const onBalancesUpdate = () => {
      qc.invalidateQueries({ queryKey: ["/api/budget/balances"] });
    };
    window.addEventListener("aioffice:budget_update", onBudgetUpdate);
    window.addEventListener("aioffice:balances_update", onBalancesUpdate);
    return () => {
      window.removeEventListener("aioffice:budget_update", onBudgetUpdate);
      window.removeEventListener("aioffice:balances_update", onBalancesUpdate);
    };
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

        {/* Provider balance caps (Stage 5.x.12) ─────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Wallet size={12} className="text-cyan-400"/>
              <span className="text-xs text-slate-500 uppercase tracking-wider">Provider balances &amp; caps</span>
            </div>
            <button
              onClick={triggerLiveRefresh}
              disabled={refreshingBalances}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50 transition-colors"
              data-testid="button-refresh-balances">
              <RefreshCw size={11} className={refreshingBalances ? "animate-spin" : ""}/>
              {refreshingBalances ? "Refreshing\u2026" : "Refresh live balances"}
            </button>
          </div>

          {balances.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-28 gap-2 text-slate-600 rounded-xl border border-slate-800 bg-slate-900/30">
              <Wallet size={20} className="opacity-40"/>
              <div className="text-xs text-center text-slate-500 px-4">
                No caps set yet. Add per-provider monthly caps in <span className="text-slate-400">Settings &rarr; Budget Caps</span> to see remaining-credit bars and enable auto-failover.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {balances
                .slice()
                .sort((a, b) => b.pctUsed - a.pctUsed)
                .map((b) => {
                  const providerColor = PROVIDER_COLORS[b.provider] ?? "#64748b";
                  const pct = Math.min(1, b.pctUsed);
                  const overThreshold = b.capUsd > 0 && pct >= b.alertThreshold;
                  const exhausted = b.capUsd > 0 && pct >= 1;
                  // bar colour: red when exhausted, amber when over the alert
                  // threshold, otherwise the provider's brand colour.
                  const barColor = exhausted ? "#ef4444" : overThreshold ? "#f59e0b" : providerColor;
                  const billingUrl = PROVIDER_BILLING_URL[b.provider];
                  return (
                    <div
                      key={b.id}
                      className={`rounded-xl border px-3 py-2.5 ${
                        exhausted
                          ? "border-rose-500/40 bg-rose-500/5"
                          : overThreshold
                            ? "border-amber-500/30 bg-amber-500/5"
                            : "border-slate-800 bg-slate-900/50"
                      }`}
                      data-testid={`balance-${b.id}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <ProviderBadge provider={b.provider}/>
                          {b.modelId !== "*" && (
                            <span className="font-mono text-xs text-slate-400 truncate">{b.modelId}</span>
                          )}
                          <span className="text-[10px] text-slate-600 uppercase tracking-wider">{b.source}</span>
                          {exhausted && (
                            <span className="flex items-center gap-1 text-[10px] text-rose-400 uppercase tracking-wider">
                              <AlertTriangle size={10}/> Capped
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-slate-300 flex-shrink-0">
                          {b.capUsd > 0
                            ? <>${b.usedUsd.toFixed(2)}<span className="text-slate-600"> / </span>${b.capUsd.toFixed(2)}</>
                            : <span className="text-slate-500">no cap set</span>}
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct * 100}%`, background: barColor }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-500">
                        <div className="flex items-center gap-2">
                          <span>Failover: <span className="text-slate-400 font-medium">{b.failoverMode}</span></span>
                          {b.source === "live" && b.balanceUsd > 0 && (
                            <span>· Live balance: <span className="font-mono text-slate-400">${b.balanceUsd.toFixed(2)}</span></span>
                          )}
                          {b.fetchError && (
                            <span className="text-rose-400 truncate" title={b.fetchError}>· fetch error</span>
                          )}
                        </div>
                        {billingUrl && (overThreshold || exhausted) && (
                          <a
                            href={billingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors"
                            data-testid={`topup-${b.id}`}>
                            Top up <ExternalLink size={9}/>
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

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
