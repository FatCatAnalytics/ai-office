// Stage 6: Market Signals — chronological feed of detected events.

import { useQuery } from "@tanstack/react-query";
import { Activity, ExternalLink } from "lucide-react";
import { getJson, fmtDate } from "@/lib/investment";
import type { MarketSignal, Company } from "@/lib/investment";
import { SeverityPill } from "./ResearchDashboard";

export default function MarketSignalsPage() {
  const { data: signals } = useQuery<MarketSignal[]>({
    queryKey: ["/api/investment/signals", "limit=100"],
    queryFn: () => getJson("/api/investment/signals?limit=100"),
    refetchInterval: 15_000,
  });
  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/investment/companies"],
    queryFn: () => getJson("/api/investment/companies"),
  });

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="page-signals">
      <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <Activity className="text-cyan-400" size={22}/> Market Signals
      </h1>
      <p className="text-sm text-slate-500">
        Cross-source signal feed. High-severity items are likely to change a thesis; info-level items are FYI.
      </p>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
        {(signals ?? []).length === 0 && <p className="text-xs text-slate-500">No signals yet.</p>}
        <div className="space-y-2">
          {(signals ?? []).map((s) => {
            const co = s.companyId ? companies?.find((c) => c.id === s.companyId) : null;
            return (
              <div key={s.id} className="p-3 rounded-lg bg-slate-800/50" data-testid={`signal-${s.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{s.title}</div>
                    <div className="text-xs text-slate-500">
                      {s.kind} · {co?.name ?? "—"} · {fmtDate(s.publishedAt ?? s.capturedAt)}
                    </div>
                    {s.detail && <div className="text-xs text-slate-400 mt-1">{s.detail}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <SeverityPill severity={s.severity}/>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                        <ExternalLink size={10}/>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
