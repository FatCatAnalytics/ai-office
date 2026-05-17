// Stage 6: Diligence Runs — start a Startup Due Diligence MVP run + list runs.
// Stage 6.4: surfaces research objective + workflow type as first-class form
// fields so the user can see what shape of run they're starting.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ClipboardCheck, Play } from "lucide-react";
import { getJson, postJson, fmtDate, fmtScore } from "@/lib/investment";
import type { DiligenceRun, Company } from "@/lib/investment";
import { StatusPill } from "./ResearchDashboard";

const OBJECTIVE_PLACEHOLDER =
  "Example: Assess Stripe as a late-stage fintech diligence candidate, focusing on " +
  "valuation risk, growth, competition, regulation, and evidence gaps.";

type WorkflowOption = {
  value: "startup_due_diligence" | "public_equity" | "thesis_review";
  label: string;
  available: boolean;
  note: string;
};

const WORKFLOW_OPTIONS: WorkflowOption[] = [
  {
    value: "startup_due_diligence",
    label: "Startup Due Diligence",
    available: true,
    note: "MVP — gathers public evidence, extracts claims, runs deterministic calculators, drafts a memo.",
  },
  {
    value: "public_equity",
    label: "Public Equity Review (planned)",
    available: false,
    note: "Planned — SEC filings + price action + analyst signal. Not in this MVP.",
  },
  {
    value: "thesis_review",
    label: "Thesis Review (planned)",
    available: false,
    note: "Planned — score an existing investment thesis against current public evidence. Not in this MVP.",
  },
];

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

  const [workflowType, setWorkflowType] = useState<WorkflowOption["value"]>("startup_due_diligence");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [ticker, setTicker] = useState("");
  const [objective, setObjective] = useState("");
  const [deckText, setDeckText] = useState("");
  const [modelLink, setModelLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedWorkflow = WORKFLOW_OPTIONS.find((w) => w.value === workflowType) ?? WORKFLOW_OPTIONS[0];

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
          objective: objective.trim() || undefined,
          workflowType,
          deckText: deckText.trim() || undefined,
          modelLink: modelLink.trim() || undefined,
        },
      );
      setMessage(`Run queued for ${r.company?.name ?? companyName}. Refreshing list…`);
      qc.invalidateQueries({ queryKey: ["/api/investment/diligence"] });
      qc.invalidateQueries({ queryKey: ["/api/investment/companies"] });
      setCompanyName(""); setWebsite(""); setTicker(""); setObjective(""); setDeckText(""); setModelLink("");
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
        <div className="text-sm font-semibold text-slate-200 mb-3">Start a diligence run</div>

        {/* Workflow type — first decision the user makes. Only Startup DD ships in the MVP. */}
        <div className="mb-3" data-testid="field-workflow-type">
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Workflow type
          </label>
          <select
            className="w-full px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200"
            value={workflowType}
            onChange={(e) => setWorkflowType(e.target.value as WorkflowOption["value"])}
            data-testid="select-workflow-type">
            {WORKFLOW_OPTIONS.map((w) => (
              <option key={w.value} value={w.value} disabled={!w.available}>
                {w.label}{!w.available ? " — planned" : ""}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-1" data-testid="help-workflow-type">
            {selectedWorkflow.note}
            {selectedWorkflow.value !== "startup_due_diligence" && " This MVP currently runs Startup Due Diligence only."}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Company name *</label>
            <input className="w-full px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="e.g. Stripe" value={companyName} onChange={(e) => setCompanyName(e.target.value)} data-testid="input-company-name"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Website</label>
            <input className="w-full px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="https://example.com" value={website} onChange={(e) => setWebsite(e.target.value)} data-testid="input-website"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Ticker (if public)</label>
            <input className="w-full px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="e.g. AAPL" value={ticker} onChange={(e) => setTicker(e.target.value)} data-testid="input-ticker"/>
          </div>
        </div>

        {/* Research objective — required for grounded ranking; rendered as its own labelled block. */}
        <div className="mb-3" data-testid="field-objective">
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Research objective / investment question
          </label>
          <textarea
            className="w-full px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200"
            placeholder={OBJECTIVE_PLACEHOLDER}
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            data-testid="input-objective"/>
          <p className="text-[11px] text-slate-500 mt-1" data-testid="help-objective">
            Used to rank source relevance, red flags, questions, and memo focus. Leave blank for a general public-data diligence.
          </p>
        </div>

        <div className="mb-3" data-testid="field-deck-text">
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Paste deck text or summary (optional)
          </label>
          <textarea
            className="w-full px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200"
            placeholder="Paste deck text or an executive summary the company has shared with you."
            rows={3}
            value={deckText}
            onChange={(e) => setDeckText(e.target.value)}
            data-testid="input-deck-text"/>
          <p className="text-[11px] text-slate-500 mt-1" data-testid="help-deck-text">
            Treated as <strong>company-supplied claims</strong>, not verified facts — every claim extracted from this text is tagged <code>company_claimed</code> until corroborated by an independent source.
          </p>
        </div>

        <div className="mb-3" data-testid="field-model-link">
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Financial model link or assumptions (optional)
          </label>
          <input
            className="w-full px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200"
            placeholder="https://… or paste key assumptions (ARR, burn, runway, valuation)"
            value={modelLink}
            onChange={(e) => setModelLink(e.target.value)}
            data-testid="input-model-link"/>
          <p className="text-[11px] text-slate-500 mt-1" data-testid="help-model-link">
            Deterministic calculations (runway, growth, valuation multiples) only run when enough numeric inputs (ARR / burn / valuation / headcount) are present in the deck text, the model link, or the gathered public sources.
          </p>
        </div>

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
