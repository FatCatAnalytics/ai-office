// Stage 6: Diligence Runs — start a Startup Due Diligence MVP run + list runs.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ClipboardCheck, Play } from "lucide-react";
import { getJson, postJson, fmtDate, fmtScore } from "@/lib/investment";
import type { DiligenceRun, Company } from "@/lib/investment";
import { StatusPill } from "./ResearchDashboard";

export default function DiligenceRunsPage() {
  const qc = useQueryClient();
  const { data: runs } = useQuery<DiligenceRun[]>({
    queryKey: ["/api/investment/diligence"],
    queryFn: () => getJson("/api/investment/diligence"),
    refetchInterval: 5_000,
  });
  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/investment/companies"],
    queryFn: () => getJson("/api/investment/companies"),
    refetchInterval: 30_000,
  });

  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [ticker, setTicker] = useState("");
  const [deckText, setDeckText] = useState("");
  const [modelLink, setModelLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startRun = async () => {
    if (!companyName.trim()) return;
    setBusy(true); setMessage(null); setError(null);
    try {
      const r = await postJson<{ status: string; run?: DiligenceRun; company?: Company }>(
        "/api/investment/diligence/startup",
        {
          companyName: companyName.trim(),
          website: website.trim() || undefined,
          ticker: ticker.trim() || undefined,
          deckText: deckText.trim() || undefined,
          modelLink: modelLink.trim() || undefined,
        },
      );
      setMessage(`Run queued for ${r.company?.name ?? companyName}. Refreshing list…`);
      qc.invalidateQueries({ queryKey: ["/api/investment/diligence"] });
      qc.invalidateQueries({ queryKey: ["/api/investment/companies"] });
      setCompanyName(""); setWebsite(""); setTicker(""); setDeckText(""); setModelLink("");
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="page-diligence-runs">
      <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <ClipboardCheck className="text-cyan-400" size={22}/> Diligence Runs
      </h1>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid="panel-new-run">
        <div className="text-sm font-semibold text-slate-200 mb-3">Start a Startup Due Diligence run</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Company name *" value={companyName} onChange={(e) => setCompanyName(e.target.value)} data-testid="input-company-name"/>
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Website" value={website} onChange={(e) => setWebsite(e.target.value)} data-testid="input-website"/>
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Ticker (if public)" value={ticker} onChange={(e) => setTicker(e.target.value)} data-testid="input-ticker"/>
        </div>
        <textarea
          className="w-full px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200 mb-2"
          placeholder="Paste deck text or summary (optional)"
          rows={3}
          value={deckText}
          onChange={(e) => setDeckText(e.target.value)}
          data-testid="input-deck-text"/>
        <input className="w-full px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200 mb-2" placeholder="Model link (optional)" value={modelLink} onChange={(e) => setModelLink(e.target.value)} data-testid="input-model-link"/>
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Public data only: SEC EDGAR, Companies House, GLEIF, news (RSS/GDELT), OpenAlex, website. No paid feeds.
          </p>
          <button
            disabled={!companyName.trim() || busy}
            onClick={startRun}
            className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)" }}
            data-testid="button-start-run">
            <Play size={12} className="inline mr-1"/> {busy ? "Starting…" : "Start run"}
          </button>
        </div>
        {message && <div className="text-xs text-emerald-400 mt-2" data-testid="message-success">{message}</div>}
        {error && <div className="text-xs text-rose-400 mt-2" data-testid="message-error">{error}</div>}
      </div>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid="panel-runs-list">
        <div className="text-sm font-semibold text-slate-200 mb-3">All runs</div>
        {(runs ?? []).length === 0 && <p className="text-xs text-slate-500">No diligence runs yet.</p>}
        <div className="space-y-2">
          {(runs ?? []).map((r) => {
            const co = companies?.find((c) => c.id === r.companyId);
            return (
              <Link key={r.id} href={`/diligence/${r.id}`}>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 cursor-pointer transition-colors" data-testid={`row-run-${r.id}`}>
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{co?.name ?? `Company #${r.companyId}`}</div>
                    <div className="text-xs text-slate-500">{r.kind} · {fmtDate(r.createdAt)} · {r.summary || "—"}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">conf {fmtScore(r.confidenceScore)} · sal {fmtScore(r.salienceScore)}</span>
                    <StatusPill status={r.status}/>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
