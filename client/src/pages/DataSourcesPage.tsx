// Stage 6: Data Sources — lists registered connectors, their reliability
// baseline, and lets the user run a quick probe by company name.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plug, Play } from "lucide-react";
import { getJson, postJson } from "@/lib/investment";
import type { DataSource } from "@/lib/investment";

interface ProbeOutcome {
  results: Array<{ connector: string; title: string; url: string; sourceType: string; publisher?: string; reliabilityScore: number }>;
  errors: Array<{ connector: string; error: string }>;
  durationsMs: Record<string, number>;
}

export default function DataSourcesPage() {
  const { data: sources } = useQuery<DataSource[]>({
    queryKey: ["/api/investment/data-sources"],
    queryFn: () => getJson("/api/investment/data-sources"),
  });

  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [ticker, setTicker] = useState("");
  const [selected, setSelected] = useState<string | "">("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeOutcome | null>(null);

  const probe = async () => {
    if (!companyName.trim()) return;
    setBusy(true); setResult(null);
    try {
      const r = await postJson<ProbeOutcome>("/api/investment/data-sources/probe", {
        companyName: companyName.trim(),
        website: website.trim() || undefined,
        ticker: ticker.trim() || undefined,
        connector: selected || undefined,
      });
      setResult(r);
    } catch (e) {
      setResult({ results: [], errors: [{ connector: "client", error: String((e as Error).message) }], durationsMs: {} });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="page-data-sources">
      <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <Plug className="text-cyan-400" size={22}/> Data Sources
      </h1>
      <p className="text-sm text-slate-500">
        Public, free connectors. Paid feeds (PitchBook, Bloomberg, FactSet) are intentionally not wired — the platform stays
        public-data-first.
      </p>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid="panel-connector-list">
        <div className="text-sm font-semibold text-slate-200 mb-3">Registered connectors</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(sources ?? []).map((s) => (
            <div key={s.name} className="p-3 rounded-lg bg-slate-800/50 flex items-center justify-between" data-testid={`connector-${s.name}`}>
              <div>
                <div className="text-sm font-semibold text-slate-200">{s.name}</div>
                <div className="text-xs text-slate-500">[{s.sourceType}] reliability {(s.reliabilityBaseline * 100).toFixed(0)}%</div>
              </div>
              <div className="text-xs text-slate-400">
                {s.requiresKey ? (s.keyConfigured ? "key set" : "no key") : "public"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid="panel-probe">
        <div className="text-sm font-semibold text-slate-200 mb-3">Quick connector probe</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Company name *" value={companyName} onChange={(e) => setCompanyName(e.target.value)} data-testid="probe-input-name"/>
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Website" value={website} onChange={(e) => setWebsite(e.target.value)} data-testid="probe-input-website"/>
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} data-testid="probe-input-ticker"/>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" data-testid="probe-select-connector">
            <option value="">All connectors</option>
            {(sources ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <button disabled={!companyName.trim() || busy} onClick={probe}
          className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)" }}
          data-testid="button-probe">
          <Play size={12} className="inline mr-1"/> {busy ? "Probing…" : "Run probe"}
        </button>

        {result && (
          <div className="mt-4 space-y-2" data-testid="probe-result">
            <div className="text-xs text-slate-400">
              {result.results.length} result(s), {result.errors.length} error(s) — durations: {Object.entries(result.durationsMs).map(([k, v]) => `${k}=${v}ms`).join(", ")}
            </div>
            {result.results.map((r, i) => (
              <div key={i} className="p-3 rounded-lg bg-slate-800/50" data-testid={`probe-row-${i}`}>
                <div className="text-sm text-slate-200">{r.title}</div>
                <div className="text-xs text-slate-500">[{r.connector} · {r.sourceType}] {r.publisher ?? ""} · reliability {(r.reliabilityScore * 100).toFixed(0)}%</div>
                <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300 break-all">{r.url}</a>
              </div>
            ))}
            {result.errors.length > 0 && (
              <div className="text-xs text-rose-400">
                Errors: {result.errors.map((e) => `${e.connector}: ${e.error}`).join("; ")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
