// Stage 6: Research Dashboard — overview of Axl Investment Intelligence
//
// Cards: total companies, runs in progress, completed runs, contradictions
// surfaced, average confidence. Plus a "recent runs" panel that links into
// the diligence detail page.

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { TrendingUp, Building2, ClipboardCheck, AlertTriangle, Activity, ArrowRight } from "lucide-react";
import type { Company, DiligenceRun, Contradiction, MarketSignal } from "@/lib/investment";
import { getJson, fmtScore, fmtDate, INVESTMENT_DISCLAIMER } from "@/lib/investment";

export default function ResearchDashboard() {
  const companies = useQuery<Company[]>({
    queryKey: ["/api/investment/companies"],
    queryFn: () => getJson("/api/investment/companies"),
    refetchInterval: 15_000,
  });
  const runs = useQuery<DiligenceRun[]>({
    queryKey: ["/api/investment/diligence"],
    queryFn: () => getJson("/api/investment/diligence"),
    refetchInterval: 10_000,
  });
  const contradictions = useQuery<Contradiction[]>({
    queryKey: ["/api/investment/contradictions"],
    queryFn: () => getJson("/api/investment/contradictions"),
    refetchInterval: 30_000,
  });
  const signals = useQuery<MarketSignal[]>({
    queryKey: ["/api/investment/signals", "limit=10"],
    queryFn: () => getJson("/api/investment/signals?limit=10"),
    refetchInterval: 20_000,
  });

  const totalCompanies = companies.data?.length ?? 0;
  const completed = (runs.data ?? []).filter((r) => r.status === "completed");
  const running = (runs.data ?? []).filter((r) => r.status === "running" || r.status === "queued");
  const totalContras = contradictions.data?.length ?? 0;
  const avgConfidence = completed.length > 0
    ? completed.reduce((s, r) => s + (r.confidenceScore ?? 0), 0) / completed.length
    : 0;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="page-research-dashboard">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <TrendingUp className="text-cyan-400" size={22}/> Research Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Public-data-first investment intelligence. Source-grounded, calculation-verified, audit-traceable.
          </p>
        </div>
        <Link href="/diligence">
          <button
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)" }}
            data-testid="button-new-diligence">
            Start Diligence Run <ArrowRight size={12} className="inline ml-1"/>
          </button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Building2} label="Companies tracked" value={String(totalCompanies)} color="#06b6d4" testid="stat-companies"/>
        <StatCard icon={ClipboardCheck} label="Runs in progress" value={String(running.length)} sub={`${completed.length} completed`} color="#22c55e" testid="stat-running"/>
        <StatCard icon={AlertTriangle} label="Contradictions" value={String(totalContras)} color="#f59e0b" testid="stat-contras"/>
        <StatCard icon={Activity} label="Avg confidence" value={fmtScore(avgConfidence)} color="#a855f7" testid="stat-confidence"/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Recent diligence runs" testid="panel-recent-runs">
          {(runs.data ?? []).length === 0 && (
            <p className="text-xs text-slate-500">No diligence runs yet. Use Diligence Runs → Start to create one.</p>
          )}
          <div className="space-y-2">
            {(runs.data ?? []).slice(0, 8).map((r) => {
              const co = companies.data?.find((c) => c.id === r.companyId);
              return (
                <Link key={r.id} href={`/diligence/${r.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 cursor-pointer transition-colors" data-testid={`row-run-${r.id}`}>
                    <div>
                      <div className="text-sm font-semibold text-slate-200">{co?.name ?? `Company #${r.companyId}`}</div>
                      <div className="text-xs text-slate-500">{r.kind} · {fmtDate(r.createdAt)} · {r.summary}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={r.status}/>
                      <span className="text-xs text-slate-400">conf {fmtScore(r.confidenceScore)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Panel>

        <Panel title="Latest market signals" testid="panel-signals">
          {(signals.data ?? []).length === 0 && (
            <p className="text-xs text-slate-500">No signals yet.</p>
          )}
          <div className="space-y-2">
            {(signals.data ?? []).map((s) => (
              <div key={s.id} className="p-3 rounded-lg bg-slate-800/50" data-testid={`row-signal-${s.id}`}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-200">{s.title}</div>
                  <SeverityPill severity={s.severity}/>
                </div>
                <div className="text-xs text-slate-500 mt-1">{s.detail}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="text-xs text-slate-600 italic border-t border-slate-800 pt-3" data-testid="disclaimer">
        {INVESTMENT_DISCLAIMER}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color, testid }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string; testid: string;
}) {
  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid={testid}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} style={{ color }}/>
        <span className="text-xs text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function Panel({ title, children, testid }: { title: string; children: React.ReactNode; testid: string }) {
  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid={testid}>
      <div className="text-sm font-semibold text-slate-200 mb-3">{title}</div>
      {children}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    queued:     { bg: "rgba(148,163,184,.15)", fg: "#cbd5e1" },
    running:    { bg: "rgba(34,197,94,.12)",   fg: "#22c55e" },
    completed:  { bg: "rgba(6,182,212,.12)",   fg: "#06b6d4" },
    failed:     { bg: "rgba(239,68,68,.12)",   fg: "#ef4444" },
    cancelled:  { bg: "rgba(245,158,11,.12)",  fg: "#f59e0b" },
  };
  const s = map[status] ?? map.queued;
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{ background: s.bg, color: s.fg }} data-testid={`status-${status}`}>
      {status}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    info:   { bg: "rgba(6,182,212,.12)",  fg: "#06b6d4" },
    low:    { bg: "rgba(34,197,94,.12)",  fg: "#22c55e" },
    medium: { bg: "rgba(245,158,11,.12)", fg: "#f59e0b" },
    high:   { bg: "rgba(239,68,68,.12)",  fg: "#ef4444" },
  };
  const s = map[severity] ?? map.info;
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{ background: s.bg, color: s.fg }} data-testid={`severity-${severity}`}>
      {severity}
    </span>
  );
}
