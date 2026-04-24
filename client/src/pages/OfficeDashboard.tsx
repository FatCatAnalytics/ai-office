import { useState, useRef, useEffect } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { apiRequest } from "@/lib/queryClient";
import type { AgentState, AgentEvent, Project } from "../types";
import {
  Crown, Monitor, Server, Bug, Palette, Rocket,
  Play, Pause, ChevronDown, Activity, Zap, DollarSign,
  Clock, CheckCircle2, AlertTriangle, XCircle, Info,
  Wifi, WifiOff, Send, LayoutDashboard, Users, FileText,
  Settings, Terminal, GitBranch, BarChart3, Loader2,
  ArrowUpRight, Circle
} from "lucide-react";
import IsometricOffice from "../components/IsometricOffice";

const ICON_MAP: Record<string, React.ElementType> = {
  Crown, Monitor, Server, Bug, Palette, Rocket,
};

const STATUS_COLORS: Record<string, string> = {
  idle: "text-slate-500",
  working: "text-emerald-400",
  thinking: "text-amber-400",
  blocked: "text-rose-400",
  done: "text-cyan-400",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  thinking: "Thinking",
  blocked: "Blocked",
  done: "Done",
};

const EVENT_STATUS_ICON: Record<string, React.ElementType> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
};

const EVENT_STATUS_COLOR: Record<string, string> = {
  success: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-rose-400",
  info: "text-cyan-400",
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTokens(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

// ─── Agent Desk Card ──────────────────────────────────────────────────────────
function AgentDesk({ agent }: { agent: AgentState }) {
  const Icon = ICON_MAP[agent.icon] || Monitor;
  const isWorking = agent.status === "working";
  const isThinking = agent.status === "thinking";

  return (
    <div
      className={`desk-card ${agent.status}`}
      style={{ "--agent-color": agent.color } as React.CSSProperties}
      data-testid={`desk-${agent.id}`}
    >
      {/* Desk floor indicator */}
      <div className="absolute bottom-0 left-0 right-0 h-1 opacity-20 rounded-b-xl"
        style={{ background: agent.color }} />

      <div className="p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `${agent.color}22`, border: `1px solid ${agent.color}44` }}
            >
              <Icon size={18} style={{ color: agent.color }} />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100 leading-tight">{agent.name}</div>
              <div className="text-xs text-slate-500">{agent.role}</div>
            </div>
          </div>

          {/* Status badge */}
          <div className={`flex items-center gap-1.5 ${STATUS_COLORS[agent.status]}`}>
            {isWorking && (
              <span className="flex gap-0.5 items-end h-3">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
            )}
            {isThinking && <Loader2 size={11} className="animate-spin" />}
            {!isWorking && !isThinking && (
              <Circle size={7} fill="currentColor" />
            )}
            <span className="text-xs font-medium">{STATUS_LABELS[agent.status]}</span>
          </div>
        </div>

        {/* Current task */}
        <div className="min-h-[36px] flex items-center">
          {agent.currentTask ? (
            <div className="flex gap-2 items-start">
              <Terminal size={12} className="text-slate-500 mt-0.5 flex-shrink-0" />
              <span className="text-xs text-slate-300 leading-relaxed">{agent.currentTask}</span>
            </div>
          ) : (
            <span className="text-xs text-slate-600 italic">Awaiting assignment...</span>
          )}
        </div>

        {/* Monitor decoration */}
        <div className="rounded-md overflow-hidden border border-slate-700/60" style={{ background: "#0d1117" }}>
          <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-700/40">
            <span className="w-2 h-2 rounded-full bg-rose-500/60" />
            <span className="w-2 h-2 rounded-full bg-amber-500/60" />
            <span className="w-2 h-2 rounded-full bg-emerald-500/60" />
            <span className="ml-1 text-slate-600 font-mono" style={{ fontSize: 9 }}>terminal</span>
          </div>
          <div className="p-2 font-mono h-10 overflow-hidden">
            {isWorking && (
              <div className="text-emerald-400" style={{ fontSize: 10 }}>
                <span className="text-slate-500">$ </span>
                <span className={agent.currentTask ? "" : "opacity-50"}>
                  {agent.currentTask?.toLowerCase().replace(/ /g, "_") || "..."}_
                </span>
                <span className="status-blink">▊</span>
              </div>
            )}
            {isThinking && (
              <div className="text-amber-400" style={{ fontSize: 10 }}>
                <span className="text-slate-500">~ </span>analyzing...
                <span className="status-blink">▊</span>
              </div>
            )}
            {agent.status === "done" && (
              <div className="text-cyan-400" style={{ fontSize: 10 }}>
                <span className="text-slate-500">$ </span>
                <CheckCircle2 size={10} className="inline mr-1" />
                task complete ✓
              </div>
            )}
            {agent.status === "idle" && (
              <div className="text-slate-600" style={{ fontSize: 10 }}>
                <span className="text-slate-500">$ </span>
                waiting for tasks_
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Activity Feed ─────────────────────────────────────────────────────────────
function ActivityFeed({ events, connected }: { events: AgentEvent[]; connected: boolean }) {
  const feedRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">Activity Feed</span>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <div className="live-dot" />
              <span className="text-xs text-emerald-400 font-medium">Live</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-slate-500" />
              <span className="text-xs text-slate-500">Offline</span>
            </>
          )}
        </div>
      </div>

      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto custom-scroll px-3 py-2 space-y-1"
      >
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-600">
            <Terminal size={20} />
            <span className="text-xs">Submit a project to start</span>
          </div>
        )}
        {events.map((ev, i) => {
          const StatusIcon = EVENT_STATUS_ICON[ev.status] || Info;
          const color = EVENT_STATUS_COLOR[ev.status] || "text-slate-400";
          return (
            <div
              key={ev.id ?? i}
              className="slide-in flex gap-2.5 py-2 px-2.5 rounded-lg hover:bg-slate-800/50 transition-colors"
            >
              <StatusIcon size={13} className={`${color} flex-shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs leading-snug">
                  <span className="font-semibold text-slate-200">{ev.agentName}</span>
                  {" "}
                  <span className="text-slate-400">{ev.action}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 leading-relaxed truncate">{ev.detail}</div>
                <div className="text-xs text-slate-600 font-mono mt-0.5">{formatTime(ev.timestamp)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Task Flow Panel ───────────────────────────────────────────────────────────
const TASK_FLOW_NODES = [
  { id: "user", label: "User Request", x: "50%", type: "input" },
  { id: "manager", label: "Manager Agent", x: "50%", type: "agent", agentId: "manager" },
  { id: "frontend", label: "Frontend Dev", x: "20%", type: "agent", agentId: "frontend" },
  { id: "backend", label: "Backend Dev", x: "80%", type: "agent", agentId: "backend" },
  { id: "qa", label: "QA Engineer", x: "35%", type: "agent", agentId: "qa" },
  { id: "uiux", label: "UI/UX Designer", x: "65%", type: "agent", agentId: "uiux" },
  { id: "devops", label: "DevOps Engineer", x: "50%", type: "agent", agentId: "devops" },
];

const AGENT_COLORS_MAP: Record<string, string> = {
  manager: "#6366f1",
  frontend: "#22c55e",
  backend: "#3b82f6",
  qa: "#f59e0b",
  uiux: "#ec4899",
  devops: "#14b8a6",
};

function TaskFlowPanel({ agents }: { agents: AgentState[] }) {
  const getStatus = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.status ?? "idle";

  const nodeRows = [
    [TASK_FLOW_NODES[0]],
    [TASK_FLOW_NODES[1]],
    [TASK_FLOW_NODES[2], TASK_FLOW_NODES[3]],
    [TASK_FLOW_NODES[4], TASK_FLOW_NODES[5]],
    [TASK_FLOW_NODES[6]],
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <GitBranch size={14} className="text-violet-400" />
        <span className="text-sm font-semibold text-slate-200">Task Flow</span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll px-4 py-4">
        <div className="flex flex-col gap-2">
          {nodeRows.map((row, rowIdx) => (
            <div key={rowIdx} className="flex gap-2 justify-center">
              {row.map((node) => {
                const status = node.agentId ? getStatus(node.agentId) : "active";
                const color = node.agentId ? AGENT_COLORS_MAP[node.agentId] : "#06b6d4";
                const isActive = status === "working" || status === "thinking" || status === "done";

                return (
                  <div
                    key={node.id}
                    className="flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 relative"
                    style={{
                      background: isActive ? `${color}18` : "hsl(222 40% 12%)",
                      border: `1px solid ${isActive ? color + "66" : "hsl(222 25% 18%)"}`,
                      color: isActive ? color : "hsl(215 16% 47%)",
                      minWidth: 90,
                    }}
                    data-testid={`flow-${node.id}`}
                  >
                    {status === "working" && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    )}
                    {node.label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap gap-x-3 gap-y-1">
          {[
            { label: "Completed", color: "bg-emerald-400" },
            { label: "In Progress", color: "bg-blue-400" },
            { label: "Blocked", color: "bg-rose-400" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${item.color}`} />
              <span className="text-xs text-slate-500">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Submit Task Modal ─────────────────────────────────────────────────────────
function SubmitTaskModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string, desc: string) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);

  const PRESETS = [
    { name: "Skyline Project", desc: "Build a full-stack SaaS dashboard with auth, payments and analytics" },
    { name: "API Gateway", desc: "Design and implement a RESTful API gateway with rate limiting and auth" },
    { name: "Mobile App MVP", desc: "React Native app with onboarding, home screen and push notifications" },
    { name: "AI Chatbot", desc: "Integrate LLM-powered chat with streaming responses and history" },
  ];

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await onSubmit(name, desc);
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" data-testid="task-modal">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Send size={16} className="text-cyan-400" />
            <span className="font-semibold text-slate-100">New Project</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Presets */}
          <div>
            <div className="text-xs text-slate-500 mb-2">Quick presets</div>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => { setName(p.name); setDesc(p.desc); }}
                  className="text-left px-3 py-2 rounded-lg border border-slate-700 hover:border-cyan-500/50 hover:bg-slate-800 transition-all text-xs text-slate-400 hover:text-slate-200"
                  data-testid={`preset-${p.name.toLowerCase().replace(/ /g, "-")}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Project Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Skyline Project"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                data-testid="input-project-name"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Description</label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Describe what you want the team to build..."
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors resize-none"
                data-testid="input-project-desc"
              />
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!name.trim() || loading}
            className="w-full py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)", color: "#fff" }}
            data-testid="button-submit-project"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {loading ? "Dispatching..." : "Deploy to AI Office"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bottom Metrics Bar ────────────────────────────────────────────────────────
function MetricsBar({ project, agents }: { project: Project | null; agents: AgentState[] }) {
  const activeAgents = agents.filter((a) => a.status !== "idle").length;
  const idleAgents = agents.filter((a) => a.status === "idle").length;
  const blockedAgents = agents.filter((a) => a.status === "blocked").length;

  return (
    <div className="flex items-center gap-0 border-t border-slate-800 bg-slate-900/80 backdrop-blur">
      {/* Time controls */}
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Time</span>
        <div className="flex gap-1">
          <button className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors" data-testid="btn-pause">
            <Pause size={12} />
          </button>
          <button className="p-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 transition-colors" data-testid="btn-play">
            <Play size={12} />
          </button>
          <button className="px-2 py-1 rounded text-xs font-mono font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors" data-testid="btn-speed">
            2x
          </button>
        </div>
      </div>

      {/* Agent status */}
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Agents</span>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-100 font-semibold">{agents.length}</span>
          <span className="text-slate-600">total</span>
          <span className="text-emerald-400">{activeAgents} active</span>
          <span className="text-slate-600">{idleAgents} idle</span>
          {blockedAgents > 0 && <span className="text-rose-400">{blockedAgents} blocked</span>}
        </div>
      </div>

      {/* Project progress */}
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Progress</span>
        <div className="flex items-center gap-2">
          <div className="w-24 h-1.5 rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${project?.progress ?? 0}%`,
                background: "linear-gradient(90deg, #06b6d4, #8b5cf6)",
              }}
            />
          </div>
          <span className="text-sm font-bold text-slate-100 font-mono">{project?.progress ?? 0}%</span>
        </div>
      </div>

      {/* Tasks */}
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Tasks</span>
        <div className="flex items-baseline gap-1">
          <span className="text-sm font-bold text-slate-100 font-mono">{project?.tasksCompleted ?? 0}</span>
          <span className="text-slate-600 font-mono text-xs">/ {project?.tasksTotal ?? 7}</span>
        </div>
      </div>

      {/* Avg response */}
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Avg Response</span>
        <span className="text-sm font-bold text-slate-100 font-mono">{project?.avgResponseTime?.toFixed(1) ?? "0.0"}s</span>
      </div>

      {/* Tokens */}
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800">
        <Zap size={12} className="text-amber-400" />
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Tokens</span>
        <span className="text-sm font-bold text-amber-400 font-mono">{formatTokens(project?.tokensUsed ?? 0)}</span>
      </div>

      {/* Cost */}
      <div className="flex items-center gap-3 px-5 py-3">
        <DollarSign size={12} className="text-emerald-400" />
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Cost Today</span>
        <span className="text-sm font-bold text-emerald-400 font-mono">${project?.costToday?.toFixed(2) ?? "0.00"}</span>
      </div>
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────────
function Sidebar({ project, agents, onNewProject }: {
  project: Project | null;
  agents: AgentState[];
  onNewProject: () => void;
}) {
  return (
    <div className="flex flex-col w-52 border-r border-slate-800 bg-slate-900/60 backdrop-blur h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-slate-800">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 17l10 5 10-5" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 12l10 5 10-5" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-bold text-slate-100">AI Office</div>
          <div className="text-xs text-slate-500">Virtual Workspace</div>
        </div>
      </div>

      {/* Project info */}
      {project && (
        <div className="mx-3 mt-3 p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="live-dot" style={{ width: 6, height: 6 }} />
            <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Active</span>
          </div>
          <div className="text-xs font-semibold text-slate-200 mb-1">{project.name}</div>
          <div className="text-xs text-slate-500 leading-relaxed line-clamp-2">{project.description}</div>
          <div className="mt-2 flex items-center justify-between">
            <div className="w-full h-1 rounded-full bg-slate-700 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${project.progress}%`, background: "linear-gradient(90deg, #06b6d4, #8b5cf6)" }}
              />
            </div>
            <span className="ml-2 text-xs font-mono text-cyan-400 font-bold">{project.progress}%</span>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-1">
        {[
          { icon: LayoutDashboard, label: "Office Floor", active: true },
          { icon: BarChart3, label: "Task Board" },
          { icon: Users, label: "Agents" },
          { icon: FileText, label: "Files" },
          { icon: Settings, label: "Settings" },
        ].map((item) => (
          <div
            key={item.label}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              item.active
                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
            }`}
          >
            <item.icon size={14} />
            {item.label}
          </div>
        ))}
      </nav>

      {/* Agents list */}
      <div className="px-3 pb-3">
        <div className="text-xs text-slate-600 uppercase tracking-wider mb-2 px-1">Agents</div>
        <div className="space-y-1">
          {agents.map((agent) => (
            <div key={agent.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: agent.color }} />
              <span className="text-xs text-slate-400 flex-1 truncate">{agent.name}</span>
              <span className={`text-xs ${STATUS_COLORS[agent.status]}`}>{STATUS_LABELS[agent.status]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────────────────────────
export default function OfficeDashboard() {
  const { agents, events, project, connected } = useWebSocket();
  const [showModal, setShowModal] = useState(false);
  const [activeView, setActiveView] = useState<"sims" | "board" | "flow" | "analytics">("sims");

  const handleSubmitProject = async (name: string, desc: string) => {
    await apiRequest("POST", "/api/projects", { name, description: desc });
  };

  const activeCount = agents.filter((a) => a.status !== "idle").length;
  const idleCount = agents.filter((a) => a.status === "idle").length;
  const blockedCount = agents.filter((a) => a.status === "blocked").length;

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Top header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900/80 backdrop-blur z-10">
        {/* Left: Logo + project name */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                <path d="M2 17l10 5 10-5" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                <path d="M2 12l10 5 10-5" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="font-bold text-slate-100 text-sm">AI Office</span>
          </div>

          {/* View tabs */}
          <nav className="flex gap-1">
            {(["sims", "board", "flow", "analytics"] as const).map((view) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                  activeView === view
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                    : "text-slate-500 hover:text-slate-300"
                }`}
                data-testid={`tab-${view}`}
              >
                {view === "sims" ? "Sims Mode" : view === "board" ? "Board View" : view === "flow" ? "Flow View" : "Analytics"}
              </button>
            ))}
          </nav>
        </div>

        {/* Center: Project status */}
        <div className="flex items-center gap-5 text-xs">
          {project && (
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="text-slate-500">Project:</span>
              <span className="font-semibold text-slate-200">{project.name}</span>
              <ArrowUpRight size={12} className="text-cyan-400" />
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 font-mono">
              <span className="text-emerald-400 font-semibold">{activeCount}</span>
              <span className="text-slate-600">active</span>
            </div>
            <div className="flex items-center gap-1 font-mono">
              <span className="text-slate-400 font-semibold">{idleCount}</span>
              <span className="text-slate-600">idle</span>
            </div>
            {blockedCount > 0 && (
              <div className="flex items-center gap-1 font-mono">
                <span className="text-rose-400 font-semibold">{blockedCount}</span>
                <span className="text-slate-600">blocked</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions + connection */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            {connected ? (
              <><Wifi size={12} className="text-emerald-400" /><span className="text-emerald-400">Connected</span></>
            ) : (
              <><WifiOff size={12} className="text-slate-500" /><span className="text-slate-500">Offline</span></>
            )}
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)", color: "#fff" }}
            data-testid="button-new-project"
          >
            <Send size={12} />
            New Project
          </button>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar project={project} agents={agents} onNewProject={() => setShowModal(true)} />

        {/* Center: Office canvas */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Office status bar */}
          <div className="flex items-center gap-6 px-5 py-2.5 border-b border-slate-800 bg-slate-900/40">
            <div className="flex items-center gap-2">
              <ChevronDown size={12} className="text-slate-500" />
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                {project?.name ?? "Office Status"}
              </span>
            </div>
            <div className="flex items-center gap-5 text-xs font-mono">
              <div>
                <span className="text-2xl font-bold text-slate-100">{agents.length}</span>
                <span className="text-slate-500 ml-1">Agents</span>
              </div>
              <div>
                <span className="text-2xl font-bold text-slate-100">{idleCount}</span>
                <span className="text-slate-500 ml-1">Idle</span>
              </div>
              <div>
                <span className="text-2xl font-bold text-slate-100">{blockedCount}</span>
                <span className="text-slate-500 ml-1">Blocked</span>
              </div>
            </div>

            {/* Mini progress */}
            {project && (
              <div className="ml-auto flex items-center gap-3">
                <div className="text-xs text-slate-500">Project Progress</div>
                <div className="w-32 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${project.progress}%`, background: "linear-gradient(90deg, #06b6d4, #8b5cf6)" }}
                  />
                </div>
                <span className="text-xs font-bold text-slate-200 font-mono">{project.progress}%</span>
              </div>
            )}
          </div>

          {/* Office floor */}
          <div className="flex-1 overflow-hidden relative">
            {agents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
                <Loader2 size={24} className="animate-spin" />
                <span className="text-sm">Loading agents...</span>
              </div>
            ) : activeView === "sims" ? (
              <IsometricOffice agents={agents} project={project} />
            ) : (
              <div className="overflow-y-auto custom-scroll floor-pattern h-full p-5">
                <div className="office-grid max-w-3xl mx-auto">
                  {agents.map((agent) => (
                    <AgentDesk key={agent.id} agent={agent} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right panels */}
        <div className="w-72 flex flex-col border-l border-slate-800 bg-slate-900/60">
          {/* Activity feed — top half */}
          <div className="flex-1 overflow-hidden flex flex-col border-b border-slate-800">
            <ActivityFeed events={events} connected={connected} />
          </div>
          {/* Task flow — bottom half */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <TaskFlowPanel agents={agents} />
          </div>
        </div>
      </div>

      {/* Bottom metrics */}
      <MetricsBar project={project} agents={agents} />

      {/* Submit modal */}
      {showModal && (
        <SubmitTaskModal
          onClose={() => setShowModal(false)}
          onSubmit={handleSubmitProject}
        />
      )}
    </div>
  );
}
