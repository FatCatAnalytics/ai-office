// Stage 6: Evidence Graph (MVP).
//
// Simple grouped view of claims by source — a richer node/edge graph is on
// the roadmap (Milestone 2). Provides a company filter and shows the
// company-claim-source chain with status pills so the user can see the
// evidence map at a glance.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { CLAIM_STATUS_STYLES, getJson, fmtDate } from "@/lib/investment";
import type { Company, Claim, Source } from "@/lib/investment";

export default function EvidenceGraphPage() {
  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/investment/companies"],
    queryFn: () => getJson("/api/investment/companies"),
  });
  const [companyId, setCompanyId] = useState<number | null>(null);

  const { data: claims } = useQuery<Claim[]>({
    queryKey: ["/api/investment/claims", companyId],
    queryFn: () => getJson(`/api/investment/claims${companyId ? `?companyId=${companyId}` : ""}`),
    enabled: companyId != null,
  });
  const { data: sources } = useQuery<Source[]>({
    queryKey: ["/api/investment/sources", companyId],
    queryFn: () => getJson(`/api/investment/sources${companyId ? `?companyId=${companyId}` : ""}`),
    enabled: companyId != null,
  });

  const sourceById = new Map<number, Source>((sources ?? []).map((s) => [s.id, s]));
  const grouped = new Map<number, Claim[]>();
  for (const c of claims ?? []) {
    if (c.sourceId == null) continue;
    const arr = grouped.get(c.sourceId) ?? [];
    arr.push(c);
    grouped.set(c.sourceId, arr);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="page-evidence-graph">
      <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <Network className="text-cyan-400" size={22}/> Evidence Graph
      </h1>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Company</label>
          <select
            value={companyId ?? ""}
            onChange={(e) => setCompanyId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200"
            data-testid="select-company">
            <option value="">— select —</option>
            {(companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {companyId == null ? (
        <p className="text-sm text-slate-500">Pick a company to view its claim → source evidence graph.</p>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([sid, group]) => {
            const src = sourceById.get(sid);
            return (
              <div key={sid} className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid={`group-source-${sid}`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{src?.title ?? `Source #${sid}`}</div>
                    <div className="text-xs text-slate-500">
                      [{src?.sourceType}] {src?.publisher ?? src?.domain ?? "unknown"} · {fmtDate(src?.publishedDate)} · reliability {((src?.reliabilityScore ?? 0) * 100).toFixed(0)}%
                    </div>
                  </div>
                  {src?.url && (
                    <a href={src.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300">
                      Open source
                    </a>
                  )}
                </div>
                <div className="space-y-1">
                  {group.map((c) => {
                    const style = CLAIM_STATUS_STYLES[c.status] ?? CLAIM_STATUS_STYLES.unverified;
                    return (
                      <div key={c.id} className="flex items-start gap-2 text-sm text-slate-300" data-testid={`claim-${c.id}`}>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap"
                          style={{ background: style.bg, color: style.fg }}>
                          {style.label}
                        </span>
                        <span><span className="font-mono text-slate-500 mr-1">{c.subject}:</span>{c.statement}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {grouped.size === 0 && <p className="text-sm text-slate-500">No claims linked yet — run a diligence on this company.</p>}
        </div>
      )}
    </div>
  );
}
