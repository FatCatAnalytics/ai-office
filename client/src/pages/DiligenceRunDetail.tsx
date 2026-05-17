// Stage 6: Diligence Run detail page.
//
// Shows the full diligence trail: sources, claims (with status pills),
// deterministic calculations, contradictions, scoring breakdown, and the
// generated memo. Polls /api/investment/diligence/:id every 4s until the
// run reaches a terminal state.

import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, ExternalLink } from "lucide-react";
import {
  CLAIM_STATUS_STYLES, getJson, fmtDate, fmtScore, safeParse, INVESTMENT_DISCLAIMER,
} from "@/lib/investment";
import type {
  Company, DiligenceRun, Source, Claim, Calculation, Contradiction, InvestmentMemo,
} from "@/lib/investment";
import { StatusPill, SeverityPill } from "./ResearchDashboard";

interface RunDetail {
  run: DiligenceRun;
  company: Company;
  sources: Source[];
  claims: Claim[];
  calculations: Calculation[];
  contradictions: Contradiction[];
  memos: InvestmentMemo[];
}

export default function DiligenceRunDetail() {
  const { id } = useParams();
  const runId = parseInt(String(id), 10);
  const { data, isLoading } = useQuery<RunDetail>({
    queryKey: ["/api/investment/diligence", runId],
    queryFn: () => getJson(`/api/investment/diligence/${runId}`),
    refetchInterval: (q) => {
      const d = q.state.data as RunDetail | undefined;
      const s = d?.run?.status;
      return s === "completed" || s === "failed" || s === "cancelled" ? false : 4_000;
    },
  });

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-slate-400" data-testid="loading">Loading run…</div>;
  }

  const { run, company, sources, claims, calculations, contradictions, memos } = data;
  const redFlags = safeParse<string[]>(run.redFlags, []);
  const openQuestions = safeParse<string[]>(run.openQuestions, []);
  const breakdown = safeParse<Record<string, unknown>>(run.scoreBreakdown, {});
  const inputs = safeParse<{ objective?: string; workflowType?: string; requestedWorkflowType?: string }>(run.inputs, {});
  const objective = (inputs.objective ?? "").trim();

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="page-diligence-detail">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <ClipboardCheck className="text-cyan-400" size={22}/> {company?.name ?? "Run"}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Run #{run.id} · {run.kind} · started {fmtDate(run.startedAt)} · completed {fmtDate(run.completedAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={run.status}/>
          <ScoreBadge label="Confidence" value={fmtScore(run.confidenceScore)} testid="score-confidence"/>
          <ScoreBadge label="Salience" value={fmtScore(run.salienceScore)} testid="score-salience"/>
        </div>
      </div>

      {run.error && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-sm text-rose-300" data-testid="run-error">
          Error: {run.error}
        </div>
      )}

      <Panel title="Research objective" testid="panel-objective">
        <div className="text-sm text-slate-200" data-testid="run-objective">
          {objective || <span className="text-slate-500 italic">General public-data diligence.</span>}
        </div>
        <div className="text-[11px] text-slate-500 mt-2" data-testid="run-workflow-type">
          Workflow: <span className="font-mono">{inputs.workflowType ?? "startup_due_diligence"}</span>
          {inputs.requestedWorkflowType && inputs.requestedWorkflowType !== inputs.workflowType && (
            <> · requested <span className="font-mono">{inputs.requestedWorkflowType}</span> (coerced to startup_due_diligence — only workflow available in this MVP)</>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Claims" testid="panel-claims">
          {claims.length === 0 ? (
            <p className="text-xs text-slate-500">No structured claims extracted.</p>
          ) : (
            <div className="space-y-2">
              {claims.map((c) => {
                const style = CLAIM_STATUS_STYLES[c.status] ?? CLAIM_STATUS_STYLES.unverified;
                return (
                  <div key={c.id} className="p-3 rounded-lg bg-slate-800/50" data-testid={`claim-${c.id}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-slate-300">{c.subject}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
                        style={{ background: style.bg, color: style.fg }} data-testid={`claim-status-${c.id}`}>
                        {style.label}
                      </span>
                    </div>
                    <div className="text-sm text-slate-200">{c.statement}</div>
                    {c.evidenceQuote && (
                      <div className="text-xs text-slate-500 italic mt-1 border-l-2 border-slate-700 pl-2">
                        “{c.evidenceQuote}”
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Deterministic calculations" testid="panel-calculations">
          {calculations.length === 0 ? (
            <p className="text-xs text-slate-500">Insufficient numeric inputs for calculations.</p>
          ) : (
            <div className="space-y-2">
              {calculations.map((calc) => (
                <div key={calc.id} className="p-3 rounded-lg bg-slate-800/50" data-testid={`calc-${calc.id}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">{calc.name}</span>
                    <span className="text-xs font-mono text-cyan-400">
                      {calc.resultValue ?? calc.resultText} {calc.unit ?? ""}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{calc.formula}</div>
                  {calc.explanation && <div className="text-xs text-slate-400 mt-1">{calc.explanation}</div>}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Contradictions" testid="panel-contradictions">
        {contradictions.length === 0 ? (
          <p className="text-xs text-slate-500">None detected.</p>
        ) : (
          <div className="space-y-2">
            {contradictions.map((c) => (
              <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50" data-testid={`contradiction-${c.id}`}>
                <SeverityPill severity={c.severity}/>
                <div className="text-sm text-slate-200">{c.description}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Red flags" testid="panel-redflags">
          {redFlags.length === 0 ? <p className="text-xs text-slate-500">None.</p> : (
            <ul className="text-sm text-slate-200 space-y-1 list-disc pl-4">
              {redFlags.map((f, i) => <li key={i} data-testid={`redflag-${i}`}>{f}</li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Open questions" testid="panel-questions">
          {openQuestions.length === 0 ? <p className="text-xs text-slate-500">None.</p> : (
            <ul className="text-sm text-slate-200 space-y-1 list-disc pl-4">
              {openQuestions.map((q, i) => <li key={i} data-testid={`question-${i}`}>{q}</li>)}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Evidence / sources" testid="panel-sources">
        {sources.length === 0 ? (
          <p className="text-xs text-slate-500">No sources collected.</p>
        ) : (
          <div className="space-y-2">
            {sources.map((s) => (
              <div key={s.id} className="flex items-start justify-between p-3 rounded-lg bg-slate-800/50" data-testid={`source-${s.id}`}>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-200">{s.title}</div>
                  <div className="text-xs text-slate-500">
                    [{s.sourceType}] {s.publisher ?? s.domain ?? "unknown"} · published {fmtDate(s.publishedDate)} · retrieved {fmtDate(s.retrievedDate)} · reliability {(s.reliabilityScore * 100).toFixed(0)}%
                  </div>
                </div>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                  Open <ExternalLink size={10}/>
                </a>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {memos.length > 0 && (
        <Panel title="Investment memo" testid="panel-memo">
          {memos.map((m) => (
            <div key={m.id} className="space-y-2" data-testid={`memo-${m.id}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-200">{m.title}</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">{m.recommendation}</span>
              </div>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-950 p-3 rounded-lg border border-slate-800 max-h-[600px] overflow-y-auto">{m.body}</pre>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Scoring breakdown" testid="panel-scoring">
        <pre className="text-[11px] text-slate-400 whitespace-pre-wrap" data-testid="scoring-breakdown">{JSON.stringify(breakdown, null, 2)}</pre>
      </Panel>

      <div className="text-xs text-slate-600 italic border-t border-slate-800 pt-3" data-testid="disclaimer">
        {INVESTMENT_DISCLAIMER}
      </div>
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

function ScoreBadge({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700 text-xs" data-testid={testid}>
      <span className="text-slate-500 uppercase tracking-wider mr-2">{label}</span>
      <span className="text-slate-100 font-mono font-bold">{value}</span>
    </div>
  );
}
