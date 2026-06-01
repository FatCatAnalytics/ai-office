// ─── Failover Modal (Stage 5.x.12) ──────────────────────────────────────────
// Listens for the `aioffice:failover_required` window event (fanned out by
// the websocket hook) and pops a modal asking the operator to pick a
// substitute model for a project that just hit a credit cap. Submitting
// posts to /api/projects/:id/failover and the orchestrator resumes with the
// new chain. The modal also offers a one-click "switch to auto-failover for
// this project" toggle so the operator doesn't see this dialog twice for
// the same project mid-run.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PROVIDER_COLORS } from "../types";

interface FailoverEventDetail {
  type: "failover_required";
  projectId: number;
  taskId?: number;
  agentId?: string;
  agentName?: string;
  provider: string;
  modelId: string;
  capUsd?: number;
  usedUsd?: number;
  reason?: string;
  suggestedFallback?: { provider: string; modelId: string; reason: string } | null;
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  kimi: "Kimi",
  deepseek: "DeepSeek",
};

// Hardcoded high-tier candidates the operator can pick from. These mirror the
// fallback chain in server/modelRouter.ts so the UI stays in sync without an
// extra round-trip. If the user has more exotic models pinned, they can still
// type a custom <provider>:<modelId> in the override input.
const QUICK_PICKS: Array<{ provider: string; modelId: string; label: string }> = [
  { provider: "anthropic", modelId: "claude-opus-4-7",    label: "Opus 4.7" },
  { provider: "openai",    modelId: "gpt-5.5",            label: "GPT-5.5" },
  { provider: "google",    modelId: "gemini-3-pro",       label: "Gemini 3 Pro" },
  { provider: "anthropic", modelId: "claude-sonnet-4-6",  label: "Sonnet 4.6" },
  { provider: "deepseek",  modelId: "deepseek-v4-pro",    label: "DeepSeek V4-Pro" },
  { provider: "openai",    modelId: "gpt-4.1",            label: "GPT-4.1" },
];

export function FailoverModal() {
  const [event, setEvent] = useState<FailoverEventDetail | null>(null);
  const [setMode, setSetMode] = useState<"ask" | "auto">("ask");
  const [selected, setSelected] = useState<{ provider: string; modelId: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FailoverEventDetail>).detail;
      if (!detail || typeof detail.projectId !== "number") return;
      setEvent(detail);
      // Pre-select the suggested fallback so the operator can hit Enter.
      if (detail.suggestedFallback && detail.suggestedFallback.provider) {
        setSelected({
          provider: detail.suggestedFallback.provider,
          modelId: detail.suggestedFallback.modelId,
        });
      } else {
        setSelected(null);
      }
      setError(null);
      setSetMode("ask");
    };
    const dismiss = () => setEvent(null);
    window.addEventListener("aioffice:failover_required", handler);
    window.addEventListener("aioffice:failover_resolved", dismiss);
    return () => {
      window.removeEventListener("aioffice:failover_required", handler);
      window.removeEventListener("aioffice:failover_resolved", dismiss);
    };
  }, []);

  if (!event) return null;

  const close = () => {
    setEvent(null);
    setError(null);
  };

  const submit = async () => {
    if (!selected) {
      setError("Pick a substitute model first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest("POST", `/api/projects/${event.projectId}/failover`, {
        provider: selected.provider,
        modelId: selected.modelId,
        mode: setMode,
        // Stage 5.x.26: tell the route which provider to mark unusable.
        // Without this the server can't tell the capped row from the
        // substitute's row and writes the chain to the wrong place.
        cappedProvider: event.provider,
      });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const cappedColor = PROVIDER_COLORS[event.provider] ?? "#f97316";
  const overText = event.capUsd && event.capUsd > 0
    ? `Burned through the $${event.capUsd.toFixed(2)} monthly cap on ${PROVIDER_LABEL[event.provider] ?? event.provider}.`
    : `${PROVIDER_LABEL[event.provider] ?? event.provider} reported its account is out of credit.`;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-slate-950 shadow-2xl shadow-amber-500/10">
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: `${cappedColor}22`, border: `1px solid ${cappedColor}55` }}>
              <AlertTriangle size={17} style={{ color: cappedColor }} />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">Provider out of credit</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Project #{event.projectId}{event.agentName ? ` · ${event.agentName}` : ""}
              </div>
            </div>
          </div>
          <button onClick={close} className="text-slate-500 hover:text-slate-300 transition-colors p-1">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="text-sm text-slate-300 leading-relaxed">
            {overText} The run is paused until you pick a substitute model.
          </div>

          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Pick a substitute</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUICK_PICKS.filter((p) => p.provider !== event.provider).map((p) => {
                const color = PROVIDER_COLORS[p.provider] ?? "#64748b";
                const isSelected = selected?.provider === p.provider && selected?.modelId === p.modelId;
                return (
                  <button
                    key={`${p.provider}:${p.modelId}`}
                    onClick={() => setSelected({ provider: p.provider, modelId: p.modelId })}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs text-left transition-all ${
                      isSelected
                        ? "border-cyan-500 bg-cyan-500/10 text-slate-100"
                        : "border-slate-800 bg-slate-900/60 hover:border-slate-700 text-slate-300"
                    }`}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{p.label}</div>
                      <div className="font-mono text-[10px] text-slate-500 truncate">{p.modelId}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={setMode === "auto"}
              onChange={(e) => setSetMode(e.target.checked ? "auto" : "ask")}
              className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/50"
            />
            Switch this project to auto-failover (skip this dialog next time)
          </label>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800 bg-slate-900/40 rounded-b-2xl">
          <button
            onClick={close}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition-colors"
            disabled={submitting}>
            Dismiss
          </button>
          <button
            onClick={submit}
            disabled={submitting || !selected}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)" }}>
            {submitting ? "Switching\u2026" : selected ? `Switch to ${selected.modelId}` : "Pick a model"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default FailoverModal;
