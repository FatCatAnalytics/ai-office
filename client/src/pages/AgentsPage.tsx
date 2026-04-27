import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, Model } from "../types";
import { MODEL_CATALOG, SPRITE_TYPES, PROVIDER_COLORS } from "../types";
import {
  Crown, Monitor, Server, Bug, Palette, Rocket, Database, BarChart3,
  Shield, Briefcase, Globe, Plus, Pencil, Trash2, X, Save, ChevronDown,
  GitBranch, Users, Circle, CheckCircle2, Loader2, AlertTriangle,
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  Crown, Monitor, Server, Bug, Palette, Rocket, Database, BarChart3, Shield, Briefcase, Globe,
};

const STATUS_COLORS: Record<string, string> = {
  idle: "text-slate-500", working: "text-emerald-400",
  thinking: "text-amber-400", blocked: "text-rose-400", done: "text-cyan-400",
};
const STATUS_DOT: Record<string, string> = {
  idle: "#334155", working: "#22c55e", thinking: "#f59e0b", blocked: "#ef4444", done: "#06b6d4",
};

function parseCapabilities(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return []; }
}

interface AgentFormData {
  id: string;
  name: string;
  role: string;
  spriteType: string;
  provider: string;
  modelId: string;
  systemPrompt: string;
  capabilities: string;
  color: string;
  icon: string;
  reportsTo: string;
}

const defaultForm: AgentFormData = {
  id: "", name: "", role: "", spriteType: "frontend",
  provider: "anthropic", modelId: "claude-opus-4-7",
  systemPrompt: "", capabilities: "", color: "#6366f1", icon: "Monitor",
  reportsTo: "manager",
};

function AgentModal({
  agent, agents, onClose,
}: { agent: Agent | null; agents: Agent[]; onClose: () => void }) {
  const isEdit = !!agent;
  const [form, setForm] = useState<AgentFormData>(agent ? {
    id: agent.id, name: agent.name, role: agent.role, spriteType: agent.spriteType,
    provider: agent.provider, modelId: agent.modelId, systemPrompt: agent.systemPrompt,
    capabilities: parseCapabilities(agent.capabilities).join(", "),
    color: agent.color, icon: agent.icon, reportsTo: agent.reportsTo ?? "manager",
  } : defaultForm);

  // Stage 4.9: pull live registry models so newly-released ones (Gemini 3,
  // GPT-5.5, Kimi K2.6, Opus 4-7…) appear in the agent picker without a code
  // change. The static MODEL_CATALOG is still merged in as a fallback so the
  // dropdown is never empty before the first registry refresh.
  const { data: registry = [] } = useQuery<Model[]>({
    queryKey: ["/api/models"],
  });

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("POST", "/api/agents", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/agents"] }); onClose(); },
  });
  const updateMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("PATCH", `/api/agents/${agent!.id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/agents"] }); onClose(); },
  });

  const busy = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    const caps = form.capabilities.split(",").map(s => s.trim()).filter(Boolean);
    const payload = { ...form, capabilities: caps };
    if (isEdit) updateMut.mutate(payload);
    else createMut.mutate(payload);
  };

  // Merge: union of (a) every enabled model in the registry and (b) the static
  // fallback list, deduped by modelId. Discovered providers (anything that
  // shows up in the registry) are always offered even if MODEL_CATALOG doesn't
  // know about them.
  const providerOptions = (() => {
    const fromRegistry = Array.from(new Set(
      registry.filter((m) => m.enabled).map((m) => m.provider),
    ));
    const fromCatalog = Object.keys(MODEL_CATALOG);
    return Array.from(new Set([...fromRegistry, ...fromCatalog])).sort();
  })();

  const providerLabel = (key: string) =>
    MODEL_CATALOG[key]?.label ?? key.charAt(0).toUpperCase() + key.slice(1);

  const modelsForProvider = (provider: string): string[] => {
    const live = registry
      .filter((m) => m.provider === provider && m.enabled)
      .map((m) => m.modelId);
    const fallback = MODEL_CATALOG[provider]?.models ?? [];
    // Live entries first (most current), fallback fills any gaps.
    return Array.from(new Set([...live, ...fallback]));
  };

  const models = modelsForProvider(form.provider);
  // If the agent's saved modelId no longer exists in the merged list (e.g. the
  // operator disabled it), keep it visible so the dropdown still reflects what
  // is actually persisted — the operator can pick a new one if desired.
  const modelsWithCurrent = form.modelId && !models.includes(form.modelId)
    ? [form.modelId, ...models]
    : models;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:"rgba(0,0,0,0.75)" }}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl max-h-[90vh] overflow-y-auto custom-scroll">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <span className="font-semibold text-slate-100">{isEdit ? "Edit Agent" : "New Agent"}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl">×</button>
        </div>

        <div className="p-6 space-y-4">
          {/* ID + Name */}
          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Agent ID (unique slug)</label>
                <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
                  placeholder="e.g. ml-specialist"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                  data-testid="input-agent-id"/>
              </div>
            )}
            <div className={isEdit ? "col-span-2" : ""}>
              <label className="text-xs text-slate-400 mb-1 block">Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. ML Specialist"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                data-testid="input-agent-name"/>
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Role</label>
            <input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              placeholder="e.g. Machine Learning Engineer"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              data-testid="input-agent-role"/>
          </div>

          {/* Provider + Model — live from registry, fallback to MODEL_CATALOG */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Provider</label>
              <select value={form.provider} onChange={e => {
                const next = e.target.value;
                setForm(f => ({
                  ...f,
                  provider: next,
                  modelId: modelsForProvider(next)[0] ?? "",
                }));
              }}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                data-testid="select-provider">
                {providerOptions.map((k) => (
                  <option key={k} value={k}>{providerLabel(k)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                Model
                <span className="text-slate-600 ml-1 font-normal">
                  ({registry.filter((m) => m.provider === form.provider && m.enabled).length} live)
                </span>
              </label>
              <select value={form.modelId} onChange={e => setForm(f => ({ ...f, modelId: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                data-testid="select-model">
                {modelsWithCurrent.length === 0 && (
                  <option value="">— no models discovered yet —</option>
                )}
                {modelsWithCurrent.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Sprite + Icon + Color */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Sprite</label>
              <select value={form.spriteType} onChange={e => setForm(f => ({ ...f, spriteType: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                data-testid="select-sprite">
                {SPRITE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Icon</label>
              <select value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                data-testid="select-icon">
                {Object.keys(ICON_MAP).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Color</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-10 h-9 rounded bg-slate-800 border border-slate-700 cursor-pointer"
                  data-testid="input-color"/>
                <span className="text-xs text-slate-500 font-mono">{form.color}</span>
              </div>
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Capabilities (comma-separated)</label>
            <input value={form.capabilities} onChange={e => setForm(f => ({ ...f, capabilities: e.target.value }))}
              placeholder="e.g. react, typescript, css, ui"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              data-testid="input-capabilities"/>
            <p className="text-xs text-slate-600 mt-1">Manager uses these to route tasks to the right agent</p>
          </div>

          {/* Reports to */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Reports to</label>
            <select value={form.reportsTo} onChange={e => setForm(f => ({ ...f, reportsTo: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              data-testid="select-reports-to">
              <option value="manager">Manager Agent</option>
              {agents.filter(a => a.id !== agent?.id && a.id !== "manager").map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* System Prompt */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">System Prompt</label>
            <textarea value={form.systemPrompt} onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
              placeholder="Describe the agent's expertise, personality and approach..."
              rows={4}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 resize-none"
              data-testid="input-system-prompt"/>
          </div>

          <button onClick={handleSave} disabled={busy || !form.name.trim()}
            className="w-full py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background:"linear-gradient(135deg, #06b6d4, #8b5cf6)", color:"#fff" }}
            data-testid="button-save-agent">
            {busy ? <Loader2 size={15} className="animate-spin"/> : <Save size={15}/>}
            {busy ? "Saving..." : "Save Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Org Chart ──────────────────────────────────────────────────────────────────
function OrgChart({ agents }: { agents: Agent[] }) {
  const manager = agents.find(a => a.id === "manager");
  const reports = agents.filter(a => a.id !== "manager");

  if (!manager) return null;

  const Icon = ICON_MAP[manager.icon] || Crown;

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {/* Manager node */}
      <div className="flex flex-col items-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-2"
          style={{ background:`${manager.color}22`, border:`2px solid ${manager.color}` }}>
          <Icon size={24} style={{ color: manager.color }}/>
        </div>
        <div className="text-xs font-semibold text-slate-200">{manager.name}</div>
        <div className="text-xs text-slate-500">{manager.role}</div>
        <div className="text-xs mt-1 px-2 py-0.5 rounded-full" style={{ background:`${manager.color}22`, color: manager.color, fontSize:9 }}>
          {manager.provider} · {manager.modelId}
        </div>
      </div>

      {/* Connector line */}
      <div className="w-px h-6 bg-slate-700"/>

      {/* Subagent grid */}
      {reports.length > 0 && (
        <div className="flex flex-wrap gap-3 justify-center">
          {reports.map(a => {
            const AIcon = ICON_MAP[a.icon] || Monitor;
            return (
              <div key={a.id} className="flex flex-col items-center gap-1">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ background:`${a.color}22`, border:`1.5px solid ${a.color}66` }}>
                  <AIcon size={18} style={{ color: a.color }}/>
                </div>
                <div className="text-xs text-slate-300 font-medium text-center" style={{ maxWidth:70, fontSize:9 }}>{a.name}</div>
                <div className="text-xs rounded px-1" style={{ background:`${a.color}18`, color:a.color, fontSize:8 }}>
                  {a.modelId.split("-").slice(0,2).join("-")}
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[a.status] }}/>
                  <span className={`text-xs ${STATUS_COLORS[a.status]}`} style={{ fontSize:8 }}>{a.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Agent card ────────────────────────────────────────────────────────────────
function AgentCard({ agent, onEdit, onDelete }: {
  agent: Agent; onEdit: () => void; onDelete: () => void;
}) {
  const Icon = ICON_MAP[agent.icon] || Monitor;
  const caps = parseCapabilities(agent.capabilities);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 flex flex-col gap-3 hover:border-slate-700 transition-colors"
      data-testid={`agent-card-${agent.id}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background:`${agent.color}22`, border:`1.5px solid ${agent.color}66` }}>
            <Icon size={20} style={{ color: agent.color }}/>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">{agent.name}</div>
            <div className="text-xs text-slate-500">{agent.role}</div>
          </div>
        </div>
        <div className="flex gap-1">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: STATUS_DOT[agent.status] }}/>
            <span className={`text-xs ${STATUS_COLORS[agent.status]}`}>{agent.status}</span>
          </div>
        </div>
      </div>

      {/* Model badge */}
      <div className="flex gap-2 flex-wrap">
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background:`${PROVIDER_COLORS[agent.provider] ?? "#64748b"}22`,
            color: PROVIDER_COLORS[agent.provider] ?? "#94a3b8",
            border:`1px solid ${PROVIDER_COLORS[agent.provider] ?? "#475569"}44` }}>
          {agent.provider}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
          {agent.modelId}
        </span>
      </div>

      {/* Capabilities */}
      {caps.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {caps.slice(0,5).map(c => (
            <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700/50">
              {c}
            </span>
          ))}
          {caps.length > 5 && (
            <span className="text-xs text-slate-600">+{caps.length-5}</span>
          )}
        </div>
      )}

      {agent.currentTask && (
        <div className="text-xs text-slate-400 bg-slate-800/60 rounded-lg px-2 py-1.5 border border-slate-700/50 truncate">
          ▸ {agent.currentTask}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {agent.id !== "manager" && (
          <>
            <button onClick={onEdit}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-cyan-500/50 transition-colors"
              data-testid={`button-edit-${agent.id}`}>
              <Pencil size={12}/> Edit
            </button>
            <button onClick={onDelete}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700/50 text-rose-500/70 hover:text-rose-400 hover:border-rose-500/50 transition-colors"
              data-testid={`button-delete-${agent.id}`}>
              <Trash2 size={12}/>
            </button>
          </>
        )}
        {agent.id === "manager" && (
          <button onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-cyan-500/50 transition-colors"
            data-testid="button-edit-manager">
            <Pencil size={12}/> Configure
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main agents page ─────────────────────────────────────────────────────────
export default function AgentsPage() {
  const [editAgent, setEditAgent] = useState<Agent | null | undefined>(undefined); // undefined = closed, null = new
  const [view, setView] = useState<"grid" | "org">("grid");

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    refetchInterval: 5000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/agents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/agents"] }),
  });

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Users size={16} className="text-cyan-400"/>
          <span className="font-semibold text-slate-100">Agent Roster</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{agents.length} agents</span>
        </div>
        <div className="flex gap-2">
          {/* View toggle */}
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
            {(["grid", "org"] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  view === v ? "bg-cyan-500/20 text-cyan-400" : "text-slate-500 hover:text-slate-300"
                }`}>{v === "grid" ? "Grid" : "Org Chart"}</button>
            ))}
          </div>
          <button onClick={() => setEditAgent(null)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
            style={{ background:"linear-gradient(135deg, #06b6d4, #8b5cf6)", color:"#fff" }}
            data-testid="button-new-agent">
            <Plus size={13}/> New Agent
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-5">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-slate-500">
            <Loader2 size={18} className="animate-spin"/> Loading agents...
          </div>
        ) : view === "org" ? (
          <div className="max-w-2xl mx-auto">
            <OrgChart agents={agents}/>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onEdit={() => setEditAgent(agent)}
                onDelete={() => {
                  if (confirm(`Delete ${agent.name}?`)) deleteMut.mutate(agent.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {editAgent !== undefined && (
        <AgentModal
          agent={editAgent}
          agents={agents}
          onClose={() => setEditAgent(undefined)}
        />
      )}
    </div>
  );
}
