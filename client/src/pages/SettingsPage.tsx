import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Key, CheckCircle2, AlertTriangle, Save, Eye, EyeOff, Loader2, Zap, Globe } from "lucide-react";

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
      "claude-haiku-3-5",  // fast + cheap
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
