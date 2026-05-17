// Stage 6: Companies — list, add, drill-down.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, ExternalLink } from "lucide-react";
import { getJson, postJson, fmtDate } from "@/lib/investment";
import type { Company } from "@/lib/investment";

export default function CompaniesPage() {
  const qc = useQueryClient();
  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/investment/companies"],
    queryFn: () => getJson("/api/investment/companies"),
    refetchInterval: 15_000,
  });

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [ticker, setTicker] = useState("");
  const [kind, setKind] = useState("startup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await postJson("/api/investment/companies", {
        name: name.trim(),
        website: website.trim() || undefined,
        ticker: ticker.trim() || undefined,
        kind,
      });
      setName(""); setWebsite(""); setTicker("");
      qc.invalidateQueries({ queryKey: ["/api/investment/companies"] });
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="page-companies">
      <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <Building2 className="text-cyan-400" size={22}/> Companies
      </h1>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid="panel-add-company">
        <div className="text-sm font-semibold text-slate-200 mb-3">Add company</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name"/>
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Website (optional)" value={website} onChange={(e) => setWebsite(e.target.value)} data-testid="input-website"/>
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Ticker (optional)" value={ticker} onChange={(e) => setTicker(e.target.value)} data-testid="input-ticker"/>
          <div className="flex gap-2">
            <select className="flex-1 px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="select-kind">
              <option value="startup">Startup</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
            <button
              disabled={!name.trim() || busy}
              onClick={submit}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)" }}
              data-testid="button-add-company">
              <Plus size={12} className="inline mr-1"/> Add
            </button>
          </div>
        </div>
        {error && <div className="text-xs text-rose-400 mt-2">{error}</div>}
      </div>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid="panel-companies-list">
        <div className="text-sm font-semibold text-slate-200 mb-3">All companies</div>
        {(companies ?? []).length === 0 && <p className="text-xs text-slate-500">No companies yet. Add one above.</p>}
        <div className="space-y-2">
          {(companies ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50" data-testid={`row-company-${c.id}`}>
              <div>
                <div className="text-sm font-semibold text-slate-200">{c.name}</div>
                <div className="text-xs text-slate-500">
                  {c.kind}{c.ticker ? ` · ${c.ticker}` : ""}{c.sector ? ` · ${c.sector}` : ""} · added {fmtDate(c.createdAt)}
                </div>
              </div>
              {c.website && (
                <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer"
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                  Website <ExternalLink size={10}/>
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
