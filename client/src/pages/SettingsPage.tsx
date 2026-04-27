import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Key, CheckCircle2, AlertTriangle, Save, Eye, EyeOff, Loader2, Zap, Globe, Sparkles, RefreshCw, Boxes, Star } from "lucide-react";
import type { Model } from "../types";

interface ProviderConfig {
  key: string;
  label: string;
  color: string;
  description: string;
  envKey: string;
  docsUrl: string;
  models: string[];
}

const PROVIDERS: ProviderConfig[] = [
  {
    key: "anthropic",
    label: "Anthropic",
    color: "#c07b4a",
    description: "Claude models — best for reasoning, code, and long-context tasks",
    envKey: "ANTHROPIC_API_KEY",
    docsUrl: "https://console.anthropic.com/",
    models: [
      "claude-opus-4-7",   // latest flagship
      "claude-sonnet-4-6", // latest balanced
      "claude-haiku-4-5",  // fast + cheap
    ],
  },
  {
    key: "openai",
    label: "OpenAI",
    color: "#10a37f",
    description: "GPT-4.1, o4-mini and o3 — versatile, widely supported",
    envKey: "OPENAI_API_KEY",
    docsUrl: "https://platform.openai.com/api-keys",
    models: [
      "gpt-4.1",       // latest GPT-4 class
      "gpt-4.1-mini",  // cost-efficient
      "o4-mini",       // fast reasoning
      "o3",            // advanced reasoning
    ],
  },
  {
    key: "google",
    label: "Google",
    color: "#4285f4",
    description: "Gemini 2.5 Pro & Flash — multimodal, long-context",
    envKey: "GEMINI_API_KEY",
    docsUrl: "https://aistudio.google.com/app/apikey",
    models: [
      "gemini-2.5-pro",    // flagship
      "gemini-2.5-flash",  // fast + cheap
      "gemini-2.0-flash",  // stable
    ],
  },
  {
    key: "kimi",
    label: "Kimi (Moonshot)",
    color: "#7c3aed",
    description: "Moonshot — 128K context, strong for document analysis",
    envKey: "KIMI_API_KEY",
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
    models: [
      "moonshot-v1-128k",
      "moonshot-v1-32k",
    ],
  },
];

// ─── Stage 4.13: Tavily key card ──────────────────────────────────────────
function TavilyKeyCard({ savedKey, onSave }: { savedKey: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(savedKey || "");
  const [showKey, setShowKey] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setValue(savedKey || ""); setDirty(false); }, [savedKey]);

  const hasKey = savedKey && savedKey.length > 5;
  const handleChange = (v: string) => { setValue(v); setDirty(v !== savedKey); };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 flex flex-col gap-4" data-testid="provider-card-tavily">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold"
            style={{ background:"#22d3ee22", border:"1.5px solid #22d3ee66", color:"#22d3ee" }}>T</div>
          <div>
            <div className="text-sm font-semibold text-slate-100">Tavily</div>
            <div className="text-xs text-slate-500 mt-0.5">Web search + content extraction for research agents (Stage 4.13)</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {hasKey ? (
            <><CheckCircle2 size={14} className="text-emerald-400"/>
              <span className="text-xs text-emerald-400 font-medium">Connected</span></>
          ) : (
            <><AlertTriangle size={14} className="text-amber-400"/>
              <span className="text-xs text-amber-400 font-medium">Not configured</span></>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50">
        <span className="text-xs text-slate-500">Env var:</span>
        <code className="text-xs text-cyan-400 font-mono">TAVILY_API_KEY</code>
        <a href="https://tavily.com" target="_blank" rel="noopener noreferrer"
          className="ml-auto text-xs text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors">
          <Globe size={11}/> Get key
        </a>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs text-slate-400">API Key</label>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={value}
            onChange={e => handleChange(e.target.value)}
            placeholder="tvly-..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 pr-10 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
            data-testid="input-api-key-tavily"
          />
          <button onClick={() => setShowKey(s => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
            {showKey ? <EyeOff size={14}/> : <Eye size={14}/>}
          </button>
        </div>
      </div>
      <div className="text-[10px] text-slate-500 leading-relaxed">
        Used by research agents (deep-search, source-discovery, annual-reports-search, industry-research, web-scraper, doc-specialist, data-val-specialist) for live web search and URL extraction. Without this key those agents fall back to model memory and may produce empty research outputs.
      </div>
      <button
        onClick={() => { onSave(value); setDirty(false); }}
        disabled={!dirty && !!hasKey}
        className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ background: dirty ? "linear-gradient(135deg, #22d3eecc, #22d3ee88)" : undefined,
          border: dirty ? "none" : "1px solid #334155",
          color: dirty ? "#fff" : "#64748b" }}
        data-testid="button-save-key-tavily">
        <Save size={12}/> {dirty ? "Save API Key" : "Saved"}
      </button>
    </div>
  );
}

function ProviderCard({ provider, savedKey, onSave }: {
  provider: ProviderConfig; savedKey: string; onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(savedKey || "");
  const [showKey, setShowKey] = useState(false);
  const [dirty, setDirty] = useState(false);

  const hasKey = savedKey && savedKey.length > 10;

  const handleChange = (v: string) => { setValue(v); setDirty(v !== savedKey); };

  const masked = value ? value.slice(0, 8) + "•".repeat(Math.max(0, value.length - 12)) + value.slice(-4) : "";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 flex flex-col gap-4"
      data-testid={`provider-card-${provider.key}`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold"
            style={{ background:`${provider.color}22`, border:`1.5px solid ${provider.color}66`, color:provider.color }}>
            {provider.label[0]}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">{provider.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{provider.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {hasKey ? (
            <><CheckCircle2 size={14} className="text-emerald-400"/>
              <span className="text-xs text-emerald-400 font-medium">Connected</span></>
          ) : (
            <><AlertTriangle size={14} className="text-amber-400"/>
              <span className="text-xs text-amber-400 font-medium">Not configured</span></>
          )}
        </div>
      </div>

      {/* Env var info */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50">
        <span className="text-xs text-slate-500">Env var:</span>
        <code className="text-xs text-cyan-400 font-mono">{provider.envKey}</code>
        <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer"
          className="ml-auto text-xs text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors">
          <Globe size={11}/> Get key
        </a>
      </div>

      {/* Key input */}
      <div className="flex flex-col gap-2">
        <label className="text-xs text-slate-400">API Key</label>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={value}
            onChange={e => handleChange(e.target.value)}
            placeholder={`sk-... or ${provider.envKey}`}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 pr-10 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
            data-testid={`input-api-key-${provider.key}`}
          />
          <button onClick={() => setShowKey(s => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
            {showKey ? <EyeOff size={14}/> : <Eye size={14}/>}
          </button>
        </div>
      </div>

      {/* Models */}
      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs text-slate-600">Models:</span>
        {provider.models.map(m => (
          <span key={m} className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700/50 font-mono">
            {m}
          </span>
        ))}
      </div>

      <button
        onClick={() => { onSave(value); setDirty(false); }}
        disabled={!dirty && !!hasKey}
        className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ background: dirty ? `linear-gradient(135deg, ${provider.color}cc, ${provider.color}88)` : undefined,
          border: dirty ? "none" : `1px solid #334155`,
          color: dirty ? "#fff" : "#64748b" }}
        data-testid={`button-save-key-${provider.key}`}>
        <Save size={12}/> {dirty ? "Save API Key" : "Saved"}
      </button>
    </div>
  );
}

// ─── Stage 3 readiness ────────────────────────────────────────────────────────
function Stage3Indicator({ settings }: { settings: Record<string, string> }) {
  const checks = [
    { key: "anthropic_api_key", label: "Anthropic API Key" },
    { key: "openai_api_key", label: "OpenAI API Key" },
    { key: "google_api_key", label: "Google API Key" },
    { key: "kimi_api_key", label: "Kimi API Key" },
  ];

  const configured = checks.filter(c => settings[c.key] && settings[c.key].length > 10);
  const pct = Math.round((configured.length / checks.length) * 100);
  const ready = pct >= 50; // at least 2 providers

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={16} className={ready ? "text-emerald-400" : "text-amber-400"}/>
          <span className="font-semibold text-slate-100 text-sm">Stage 3 Readiness</span>
        </div>
        <span className={`text-sm font-bold font-mono ${ready ? "text-emerald-400" : "text-amber-400"}`}>{pct}%</span>
      </div>

      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width:`${pct}%`, background: ready ? "linear-gradient(90deg,#10b981,#06b6d4)" : "linear-gradient(90deg,#f59e0b,#f97316)" }}/>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {checks.map(c => {
          const ok = settings[c.key] && settings[c.key].length > 10;
          return (
            <div key={c.key} className="flex items-center gap-2">
              {ok ? <CheckCircle2 size={13} className="text-emerald-400"/> : <AlertTriangle size={13} className="text-slate-600"/>}
              <span className={`text-xs ${ok ? "text-slate-300" : "text-slate-600"}`}>{c.label}</span>
            </div>
          );
        })}
      </div>

      {ready ? (
        <div className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2">
          ✓ Ready for Stage 3 — real AI agents can be connected
        </div>
      ) : (
        <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          Configure at least 2 providers to unlock Stage 3 (real AI calls)
        </div>
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
// ── Models registry panel ────────────────────────────────────────────────────

function ModelsPanel() {
  const { data: models = [], isLoading } = useQuery<Model[]>({
    queryKey: ["/api/models"],
  });

  const refreshMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/models/refresh").then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/models"] }),
  });

  const ackMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/models/acknowledge"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/models"] }),
  });

  const tierMut = useMutation({
    mutationFn: ({ id, tier }: { id: string; tier: string }) =>
      apiRequest("PATCH", `/api/models/${encodeURIComponent(id)}`, { tier }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/models"] }),
  });

  const enabledMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiRequest("PATCH", `/api/models/${encodeURIComponent(id)}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/models"] }),
  });

  const pinMut = useMutation({
    mutationFn: ({ id, preferredFor }: { id: string; preferredFor: string }) =>
      apiRequest("PATCH", `/api/models/${encodeURIComponent(id)}`, { preferredFor }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/models"] }),
  });

  // Stage 4.9: enroll/unenroll a model in a tier pool. Multi-select: a model
  // can be in any subset of {low, medium, high}. The default (preferredFor)
  // is automatically a member; toggling it OFF demotes it to non-default.
  const poolMut = useMutation({
    mutationFn: ({ id, poolTiers }: { id: string; poolTiers: string[] }) =>
      apiRequest("PATCH", `/api/models/${encodeURIComponent(id)}`, { poolTiers }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/models"] }),
  });

  // Refetch when daily refresh broadcasts.
  useEffect(() => {
    const onRefreshed = () => queryClient.invalidateQueries({ queryKey: ["/api/models"] });
    window.addEventListener("aioffice:models_refreshed", onRefreshed);
    return () => window.removeEventListener("aioffice:models_refreshed", onRefreshed);
  }, []);

  const newCount = models.filter((m) => m.isNew).length;
  const grouped = models.reduce<Record<string, Model[]>>((acc, m) => {
    (acc[m.provider] ||= []).push(m);
    return acc;
  }, {});
  const providers = Object.keys(grouped).sort();
  const lastChecked = models.reduce((max, m) => Math.max(max, m.lastCheckedAt), 0);

  // Helper: parse the pool_tiers JSON column. Server validates the shape, but
  // we still defend against legacy '[]' / null / malformed values.
  const poolFor = (m: Model): string[] => {
    try {
      const arr = JSON.parse(m.poolTiers || "[]");
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  };

  // Pinned-by-tier summary so the operator can see at a glance which model the
  // router will pick for high-tier (Manager planning, QA), medium, and low.
  // Stage 4.9: also list secondary pool members for each tier as a compact
  // "+N more" hint.
  const pinned: Record<"low" | "medium" | "high", Model | undefined> = {
    low: models.find((m) => m.preferredFor === "low" && m.enabled),
    medium: models.find((m) => m.preferredFor === "medium" && m.enabled),
    high: models.find((m) => m.preferredFor === "high" && m.enabled),
  };
  const poolByTier: Record<"low" | "medium" | "high", Model[]> = {
    low: models.filter((m) => poolFor(m).includes("low") && m.enabled),
    medium: models.filter((m) => poolFor(m).includes("medium") && m.enabled),
    high: models.filter((m) => poolFor(m).includes("high") && m.enabled),
  };

  return (
    <div data-testid="settings-models-panel">
      <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Boxes size={11} /> Models registry
        {newCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-200 text-[9px] font-bold flex items-center gap-1"
                data-testid="badge-new-models">
            <Sparkles size={9} /> {newCount} new
          </span>
        )}
      </h3>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
          <button
            onClick={() => refreshMut.mutate()}
            disabled={refreshMut.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 disabled:opacity-50"
            data-testid="button-models-refresh"
          >
            {refreshMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Check now
          </button>
          {newCount > 0 && (
            <button
              onClick={() => ackMut.mutate()}
              disabled={ackMut.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-300 border border-slate-700 hover:bg-slate-800 disabled:opacity-50"
              data-testid="button-models-acknowledge"
            >
              <CheckCircle2 size={11} /> Mark all seen
            </button>
          )}
          <span className="ml-auto text-[10px] text-slate-500 font-mono">
            {lastChecked ? `last checked ${new Date(lastChecked).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : "not yet checked"}
          </span>
        </div>

        {/* Routing pins summary — default model + pool size per tier */}
        <div className="px-3 py-2 border-b border-slate-800 grid grid-cols-3 gap-2 text-[10px]">
          {(["high", "medium", "low"] as const).map((t) => {
            const m = pinned[t];
            const pool = poolByTier[t];
            const extras = pool.filter((p) => p.id !== m?.id).length;
            const tone =
              t === "high" ? "text-violet-300" :
              t === "medium" ? "text-cyan-300" :
              "text-emerald-300";
            return (
              <div key={t} className="rounded-lg bg-slate-950/60 border border-slate-800 px-2 py-1.5">
                <div className={`uppercase tracking-wider font-bold ${tone} flex items-center gap-1`} style={{ fontSize: 9 }}>
                  {t}-tier {t === "high" ? "· manager + QA" : ""}
                  {pool.length > 0 && (
                    <span className="ml-auto px-1 rounded bg-slate-800 text-slate-300 font-mono" title={`${pool.length} model(s) in pool`}>
                      {pool.length}
                    </span>
                  )}
                </div>
                <div className="font-mono text-slate-200 truncate" title={m ? `${m.provider}/${m.modelId}` : "using built-in chain"}>
                  {m ? m.modelId : <span className="text-slate-500">(built-in chain)</span>}
                  {extras > 0 && (
                    <span className="ml-1 text-slate-500" title={`+${extras} other model(s) in this tier's pool`}>
                      +{extras}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {isLoading ? (
          <div className="px-3 py-6 text-xs text-slate-500 flex items-center gap-2 justify-center">
            <Loader2 size={12} className="animate-spin" /> loading models…
          </div>
        ) : models.length === 0 ? (
          <div className="px-3 py-6 text-xs text-slate-500 text-center">
            No models discovered yet. Add provider keys above and press “Check now”.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {providers.map((provider) => (
              <div key={provider} className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-2">{provider}</div>
                <div className="space-y-1">
                  {grouped[provider]
                    .slice()
                    .sort((a, b) => a.modelId.localeCompare(b.modelId))
                    .map((m) => {
                      const pool = poolFor(m);
                      const togglePool = (tier: "low" | "medium" | "high") => {
                        const next = pool.includes(tier)
                          ? pool.filter((t) => t !== tier)
                          : [...pool, tier];
                        poolMut.mutate({ id: m.id, poolTiers: next });
                      };
                      const toggleDefault = (tier: "low" | "medium" | "high") => {
                        // Click the same default to clear it; click a different
                        // tier to make this model the default for that tier.
                        // Setting a default also enrolls the model in that pool
                        // (server-side guarantee).
                        pinMut.mutate({
                          id: m.id,
                          preferredFor: m.preferredFor === tier ? "none" : tier,
                        });
                      };
                      return (
                      <div
                        key={m.id}
                        className="flex items-center gap-2 py-1"
                        data-testid={`model-row-${m.id}`}
                      >
                        <span className="font-mono text-xs text-slate-200 truncate flex-1">{m.modelId}</span>
                        {m.isNew ? (
                          <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200 text-[9px] font-bold flex items-center gap-1">
                            <Sparkles size={8} /> NEW
                          </span>
                        ) : null}
                        <select
                          value={m.tier}
                          onChange={(e) => tierMut.mutate({ id: m.id, tier: e.target.value })}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300"
                          title="Heuristic tier classification (used as a hint only)"
                          data-testid={`select-tier-${m.id}`}
                        >
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                        {/* Stage 4.9: per-tier pool toggles (multi-select).
                            Click the letter chip to add/remove this model
                            from that tier's routing pool. Click the star to
                            make it the tier's DEFAULT pick.
                            Tailwind JIT can't infer dynamic class strings, so
                            tone variants are hard-coded literals below. */}
                        <div className="flex items-center gap-0.5" title="Add to tier pool / set default">
                          {(["low", "medium", "high"] as const).map((tier) => {
                            const inPool = pool.includes(tier);
                            const isDefault = m.preferredFor === tier;
                            const POOL_ON: Record<typeof tier, string> = {
                              low:    "bg-emerald-500/20 text-emerald-200 border-emerald-500/50",
                              medium: "bg-cyan-500/20 text-cyan-200 border-cyan-500/50",
                              high:   "bg-violet-500/20 text-violet-200 border-violet-500/50",
                            };
                            const DEFAULT_ON: Record<typeof tier, string> = {
                              low:    "bg-emerald-500/40 text-emerald-100 border-emerald-500/70",
                              medium: "bg-cyan-500/40 text-cyan-100 border-cyan-500/70",
                              high:   "bg-violet-500/40 text-violet-100 border-violet-500/70",
                            };
                            const DEFAULT_HOVER: Record<typeof tier, string> = {
                              low:    "bg-slate-800 text-slate-500 border-slate-700 hover:text-emerald-200",
                              medium: "bg-slate-800 text-slate-500 border-slate-700 hover:text-cyan-200",
                              high:   "bg-slate-800 text-slate-500 border-slate-700 hover:text-violet-200",
                            };
                            const chipClass = inPool
                              ? POOL_ON[tier]
                              : "bg-slate-800/80 text-slate-500 border-slate-700/60 hover:text-slate-300";
                            const starClass = isDefault
                              ? DEFAULT_ON[tier]
                              : inPool
                              ? DEFAULT_HOVER[tier]
                              : "bg-slate-900 text-slate-700 border-slate-800 cursor-not-allowed";
                            return (
                              <span key={tier} className="inline-flex items-center">
                                <button
                                  onClick={() => togglePool(tier)}
                                  className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-l border border-r-0 ${chipClass}`}
                                  title={inPool
                                    ? `Remove from ${tier}-tier pool`
                                    : `Add to ${tier}-tier pool`}
                                  data-testid={`button-pool-${tier}-${m.id}`}
                                >
                                  {tier.charAt(0).toUpperCase()}
                                </button>
                                <button
                                  onClick={() => toggleDefault(tier)}
                                  disabled={!inPool && !isDefault}
                                  className={`text-[9px] px-1 py-0.5 rounded-r border ${starClass}`}
                                  title={isDefault
                                    ? `Default for ${tier}-tier (click to clear)`
                                    : inPool
                                    ? `Set as default for ${tier}-tier`
                                    : `Add to ${tier}-tier pool first`}
                                  data-testid={`button-default-${tier}-${m.id}`}
                                >
                                  <Star size={9} fill={isDefault ? "currentColor" : "none"} />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => enabledMut.mutate({ id: m.id, enabled: !m.enabled })}
                          className={`text-[10px] px-2 py-0.5 rounded border ${
                            m.enabled
                              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                              : "bg-slate-800 text-slate-500 border-slate-700"
                          }`}
                          title={m.enabled ? "Disable globally" : "Enable globally"}
                          data-testid={`button-toggle-${m.id}`}
                        >
                          {m.enabled ? "on" : "off"}
                        </button>
                      </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data: settings = {}, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
  });

  const saveMut = useMutation({
    mutationFn: (data: Record<string, string>) => apiRequest("PATCH", "/api/settings", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
  });

  const handleSaveKey = (providerKey: string, value: string) => {
    saveMut.mutate({ [`${providerKey}_api_key`]: value });
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800">
        <Settings size={16} className="text-slate-400"/>
        <span className="font-semibold text-slate-100">Settings</span>
        {saveMut.isPending && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 size={12} className="animate-spin"/> Saving...
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-5 space-y-6">
        {/* Stage 3 readiness */}
        <div>
          <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Zap size={11}/> Stage 3 Status
          </h3>
          <Stage3Indicator settings={settings}/>
        </div>

        {/* API Keys */}
        <div>
          <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Key size={11}/> API Keys
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PROVIDERS.map(p => (
              <ProviderCard
                key={p.key}
                provider={p}
                savedKey={settings[`${p.key}_api_key`] ?? ""}
                onSave={(v) => handleSaveKey(p.key, v)}
              />
            ))}
          </div>
        </div>

        {/* Stage 4.13: Web search tools */}
        <div>
          <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Globe size={11}/> Web Search Tools
          </h3>
          <TavilyKeyCard
            savedKey={settings["tavily_api_key"] ?? ""}
            onSave={(v) => saveMut.mutate({ tavily_api_key: v })}
          />
        </div>

        {/* Models registry */}
        <ModelsPanel />

        {/* Info */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500 leading-relaxed space-y-1">
          <div className="font-semibold text-slate-400 mb-2">About Stages</div>
          <div>• <span className="text-slate-300">Stage 1</span> — Visual prototype with simulated events (complete)</div>
          <div>• <span className="text-slate-300">Stage 2</span> — Real task management, manager orchestration, DB persistence (you are here)</div>
          <div>• <span className="text-slate-300">Stage 3</span> — Live AI calls via API keys, real agent thinking, OpenClaw integration</div>
        </div>
      </div>
    </div>
  );
}
