import { useState, useRef, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { Agent, AgentEvent, Project, Task } from "../types";
import {
  Crown, Monitor, Server, Bug, Palette, Rocket, Database, BarChart3, Shield, Briefcase,
  Play, Pause, ChevronDown, Activity, Zap, DollarSign,
  Clock, CheckCircle2, AlertTriangle, XCircle, Info,
  WifiOff, Send, Terminal, GitBranch, Loader2, ArrowUpRight, Circle,
  Users, LayoutDashboard, CalendarDays, FolderOpen, FileBarChart,
  Bot, Plus, Maximize2, ZoomIn, Focus, RotateCcw, Layers,
  UserPlus, ClipboardList, CalendarPlus, FileText, Download,
} from "lucide-react";
import IsometricOffice from "../components/IsometricOffice";

const ICON_MAP: Record<string, React.ElementType> = {
  Crown, Monitor, Server, Bug, Palette, Rocket, Database, BarChart3, Shield, Briefcase,
};
const STATUS_COLORS: Record<string, string> = {
  idle: "text-slate-500", working: "text-emerald-400", thinking: "text-amber-400",
  blocked: "text-rose-400", done: "text-cyan-400",
};
const STATUS_LABELS: Record<string, string> = {
  idle: "Idle", working: "Working", thinking: "Thinking", blocked: "Blocked", done: "Done",
};
const EVENT_STATUS_ICON: Record<string, React.ElementType> = {
  success: CheckCircle2, warning: AlertTriangle, error: XCircle, info: Info,
};
const EVENT_STATUS_COLOR: Record<string, string> = {
  success: "text-emerald-400", warning: "text-amber-400", error: "text-rose-400", info: "text-cyan-400",
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatTokens(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

// ─── Agent desk card (Board View) ─────────────────────────────────────────────
function AgentDesk({ agent }: { agent: Agent }) {
  const Icon = ICON_MAP[agent.icon] || Monitor;
  const isWorking = agent.status === "working";
  const isThinking = agent.status === "thinking";
  return (
    <div className={`desk-card ${agent.status}`}
      style={{ "--agent-color": agent.color } as React.CSSProperties}
      data-testid={`desk-${agent.id}`}>
      <div className="absolute bottom-0 left-0 right-0 h-1 opacity-20 rounded-b-xl"
        style={{ background: agent.color }} />
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `${agent.color}22`, border: `1px solid ${agent.color}44` }}>
              <Icon size={18} style={{ color: agent.color }} />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100 leading-tight">{agent.name}</div>
              <div className="text-xs text-slate-500">{agent.role}</div>
              <div className="text-xs text-slate-600 font-mono">{agent.modelId}</div>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 ${STATUS_COLORS[agent.status]}`}>
            {isWorking && <span className="flex gap-0.5 items-end h-3"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>}
            {isThinking && <Loader2 size={11} className="animate-spin" />}
            {!isWorking && !isThinking && <Circle size={7} fill="currentColor" />}
            <span className="text-xs font-medium">{STATUS_LABELS[agent.status]}</span>
          </div>
        </div>
        <div className="min-h-[36px] flex items-center">
          {agent.currentTask
            ? <div className="flex gap-2 items-start"><Terminal size={12} className="text-slate-500 mt-0.5 flex-shrink-0" /><span className="text-xs text-slate-300 leading-relaxed">{agent.currentTask}</span></div>
            : <span className="text-xs text-slate-600 italic">Awaiting assignment...</span>}
        </div>
        <div className="rounded-md overflow-hidden border border-slate-700/60" style={{ background: "#0d1117" }}>
          <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-700/40">
            <span className="w-2 h-2 rounded-full bg-rose-500/60" /><span className="w-2 h-2 rounded-full bg-amber-500/60" /><span className="w-2 h-2 rounded-full bg-emerald-500/60" />
            <span className="ml-1 text-slate-600 font-mono" style={{ fontSize: 9 }}>terminal</span>
          </div>
          <div className="p-2 font-mono h-10 overflow-hidden">
            {isWorking && <div className="text-emerald-400" style={{ fontSize: 10 }}><span className="text-slate-500">$ </span>{agent.currentTask?.toLowerCase().replace(/ /g, "_") || "..."}_<span className="status-blink">▊</span></div>}
            {isThinking && <div className="text-amber-400" style={{ fontSize: 10 }}><span className="text-slate-500">~ </span>analyzing...<span className="status-blink">▊</span></div>}
            {agent.status === "done" && <div className="text-cyan-400" style={{ fontSize: 10 }}><span className="text-slate-500">$ </span><CheckCircle2 size={10} className="inline mr-1" />task complete ✓</div>}
            {agent.status === "idle" && <div className="text-slate-600" style={{ fontSize: 10 }}><span className="text-slate-500">$ </span>waiting for tasks_</div>}
            {agent.status === "blocked" && <div className="text-rose-400" style={{ fontSize: 10 }}><span className="text-slate-500">! </span>blocked — awaiting manager</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Activity Feed ─────────────────────────────────────────────────────────────
function ActivityFeed({ events, connected }: { events: AgentEvent[]; connected: boolean }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-cyan-400" />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Activity Feed</span>
        </div>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <><div className="live-dot" /><span className="text-xs text-emerald-400 font-medium">Live</span></>
          ) : (
            <><WifiOff size={11} className="text-slate-500" /><span className="text-xs text-slate-500">Offline</span></>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll px-2 py-1.5 space-y-0.5">
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-slate-600">
            <Terminal size={16} />
            <span className="text-xs">Submit a project to start</span>
          </div>
        )}
        {events.map((ev, i) => {
          const StatusIcon = EVENT_STATUS_ICON[ev.status] || Info;
          const color = EVENT_STATUS_COLOR[ev.status] || "text-slate-400";
          return (
            <div key={ev.id ?? i} className="slide-in flex gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-800/50 transition-colors">
              <StatusIcon size={11} className={`${color} flex-shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs leading-snug">
                  <span className="font-semibold text-slate-200">{ev.agentName}</span>{" "}
                  <span className="text-slate-400">{ev.action}</span>
                </div>
                <div className="text-xs text-slate-500 leading-relaxed truncate" style={{ fontSize: 10 }}>{ev.detail}</div>
                <div className="text-slate-600 font-mono mt-0.5" style={{ fontSize: 9 }}>{formatTime(ev.timestamp)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Task flow panel ───────────────────────────────────────────────────────────
function TaskFlowPanel({ agents, tasks }: { agents: Agent[]; tasks: Task[] }) {
  const manager = agents.find(a => a.id === "manager");
  const subAgents = agents.filter(a => a.id !== "manager");
  const getStatus = (agentId: string) => agents.find(a => a.id === agentId)?.status ?? "idle";

  const tasksByAgent: Record<string, Task[]> = {};
  for (const t of tasks) {
    if (!tasksByAgent[t.assignedTo]) tasksByAgent[t.assignedTo] = [];
    tasksByAgent[t.assignedTo].push(t);
  }

  // Show simplified flow diagram matching reference
  const flowNodes = [
    { label: "User Request", color: "#94a3b8", top: true },
    { label: "Manager Agent", color: "#6366f1", isManager: true },
  ];

  const flowSub1 = [
    { label: "Frontend Dev", agent: agents.find(a => a.id === "frontend") },
    { label: "Backend Dev", agent: agents.find(a => a.id === "backend") },
  ];
  const flowSub2 = [
    { label: "QA Engineer", agent: agents.find(a => a.id === "qa") },
    { label: "UI/UX Designer", agent: agents.find(a => a.id === "uiux") },
    { label: "DevOps", agent: agents.find(a => a.id === "devops") },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800">
        <GitBranch size={13} className="text-violet-400" />
        <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Task Flow</span>
        {tasks.length > 0 && <span className="text-xs text-slate-500 ml-auto">{tasks.length} tasks</span>}
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll px-3 py-2">
        {/* Simplified flow */}
        <div className="flex flex-col items-center gap-0" style={{ fontSize: 10 }}>
          {/* User Request */}
          <div className="px-3 py-1.5 rounded-lg text-slate-400 border border-slate-700 bg-slate-800/60 text-xs font-medium w-full text-center">
            User Request
          </div>
          <div className="w-px h-3 bg-slate-700" />
          {/* Manager */}
          <div className="px-3 py-1.5 rounded-lg text-xs font-semibold w-full text-center transition-all"
            style={{
              background: getStatus("manager") !== "idle" ? "#6366f118" : "hsl(222 40% 12%)",
              border: `1px solid ${getStatus("manager") !== "idle" ? "#6366f166" : "hsl(222 25% 18%)"}`,
              color: getStatus("manager") !== "idle" ? "#818cf8" : "#64748b",
            }}>
            {getStatus("manager") === "working" && <span className="inline-flex gap-0.5 items-end h-2.5 mr-1"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>}
            Manager Agent
          </div>
          <div className="w-px h-3 bg-slate-700" />
          {/* Row 1 agents */}
          <div className="flex gap-1.5 w-full justify-center">
            {flowSub1.map(({ label, agent: a }) => {
              const st = a ? getStatus(a.id) : "idle";
              const color = a?.color ?? "#475569";
              const isActive = st !== "idle";
              return (
                <div key={label} className="flex-1 px-2 py-1.5 rounded-lg text-center transition-all"
                  style={{
                    background: isActive ? `${color}15` : "hsl(222 40% 10%)",
                    border: `1px solid ${isActive ? color + "55" : "hsl(222 25% 16%)"}`,
                    color: isActive ? color : "#475569",
                    fontSize: 9,
                    fontWeight: 600,
                  }}>
                  {label}
                </div>
              );
            })}
          </div>
          <div className="w-px h-3 bg-slate-700" />
          {/* Row 2 agents */}
          <div className="flex gap-1 w-full justify-center">
            {flowSub2.map(({ label, agent: a }) => {
              const st = a ? getStatus(a.id) : "idle";
              const color = a?.color ?? "#475569";
              const isActive = st !== "idle";
              return (
                <div key={label} className="flex-1 px-1.5 py-1.5 rounded-lg text-center transition-all"
                  style={{
                    background: isActive ? `${color}15` : "hsl(222 40% 10%)",
                    border: `1px solid ${isActive ? color + "55" : "hsl(222 25% 16%)"}`,
                    color: isActive ? color : "#475569",
                    fontSize: 8,
                    fontWeight: 600,
                  }}>
                  {label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Agent list */}
        {subAgents.length > 0 && (
          <div className="mt-3 space-y-1">
            {subAgents.map(agent => {
              const status = getStatus(agent.id);
              const agentTasks = tasksByAgent[agent.id] ?? [];
              const isActive = status !== "idle";
              return (
                <div key={agent.id} className="rounded-md border transition-all"
                  style={{
                    background: isActive ? `${agent.color}0d` : "hsl(222 40% 9%)",
                    border: `1px solid ${isActive ? agent.color + "33" : "hsl(222 25% 14%)"}`,
                    padding: "5px 8px",
                  }}>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
                      background: status === "idle" ? "#1e3050" : status === "blocked" ? "#ef4444" : agent.color,
                    }} />
                    <span className="text-xs font-medium truncate" style={{ color: isActive ? agent.color : "#64748b", fontSize: 10 }}>
                      {agent.name}
                    </span>
                    {agentTasks.length > 0 && (
                      <span className="ml-auto text-slate-600" style={{ fontSize: 9 }}>{agentTasks.length}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="mt-3 pt-2 border-t border-slate-800 flex flex-wrap gap-x-2.5 gap-y-1">
          {[
            { label: "Done", color: "bg-emerald-400" },
            { label: "In Progress", color: "bg-blue-400" },
            { label: "Blocked", color: "bg-rose-400" },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${item.color}`} />
              <span className="text-slate-500" style={{ fontSize: 9 }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Submit project modal ──────────────────────────────────────────────────────
function SubmitProjectModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (name: string, desc: string, priority: string, deadline?: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [priority, setPriority] = useState("normal");
  const [deadline, setDeadline] = useState("");
  const [loading, setLoading] = useState(false);

  const PRESETS = [
    { name: "Skyline SaaS", desc: "Build a full-stack SaaS dashboard with auth, payments and analytics", priority: "high" },
    { name: "API Gateway", desc: "Design and implement a RESTful API gateway with rate limiting and auth", priority: "normal" },
    { name: "Mobile MVP", desc: "React Native app with onboarding, home screen and push notifications", priority: "normal" },
    { name: "AI Chatbot", desc: "Integrate LLM-powered chat with streaming responses and history", priority: "high" },
  ];

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await onSubmit(name, desc, priority, deadline || undefined);
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" data-testid="task-modal">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Send size={16} className="text-cyan-400" />
            <span className="font-semibold text-slate-100">New Project</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <div className="text-xs text-slate-500 mb-2">Quick presets</div>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map(p => (
                <button key={p.name} onClick={() => { setName(p.name); setDesc(p.desc); setPriority(p.priority); }}
                  className="text-left px-3 py-2 rounded-lg border border-slate-700 hover:border-cyan-500/50 hover:bg-slate-800 transition-all text-xs text-slate-400 hover:text-slate-200"
                  data-testid={`preset-${p.name.toLowerCase().replace(/ /g, "-")}`}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Project Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Skyline Project"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                data-testid="input-project-name" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Description</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)}
                placeholder="Describe what you want the team to build..."
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors resize-none"
                data-testid="input-project-desc" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Priority</label>
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                  data-testid="select-priority">
                  <option value="critical">🔴 Critical</option>
                  <option value="high">🟠 High</option>
                  <option value="normal">🔵 Normal</option>
                  <option value="low">⚪ Low</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Deadline (optional)</label>
                <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                  data-testid="input-deadline" />
              </div>
            </div>
          </div>

          <button onClick={handleSubmit} disabled={!name.trim() || loading}
            className="w-full py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)", color: "#fff" }}
            data-testid="button-submit-project">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {loading ? "Dispatching to Manager..." : "Deploy to AI Office"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Left sidebar ──────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Office Floor", active: true },
  { icon: ClipboardList,   label: "Task Board",   active: false },
  { icon: Bot,             label: "Agents",       active: false },
  { icon: Users,           label: "Teams",        active: false },
  { icon: CalendarDays,    label: "Calendar",     active: false },
  { icon: FolderOpen,      label: "Files",        active: false },
  { icon: FileBarChart,    label: "Reports",      active: false },
];

const AGENT_DOT_COLORS: Record<string, string> = {
  idle:     "#475569",
  working:  "#10b981",
  thinking: "#f59e0b",
  blocked:  "#ef4444",
  done:     "#06b6d4",
};

// ─── Top stats bar ─────────────────────────────────────────────────────────────
function TopStatsBar({ agents, project, tasks }: { agents: Agent[]; project: Project | null; tasks: Task[] }) {
  const totalAgents   = agents.length || 18;
  const activeAgents  = agents.filter(a => a.status !== "idle").length || 14;
  const idleAgents    = agents.filter(a => a.status === "idle").length || 3;
  const blockedAgents = agents.filter(a => a.status === "blocked").length || 1;
  const progress      = project?.progress ?? 68;
  const tasksCompleted = project?.tasksCompleted ?? 24;
  const tasksTotal    = project?.tasksTotal ?? 36;
  const avgResponse   = project?.avgResponseTime ?? 2.4;
  const tokensUsed    = project?.tokensUsed ?? 1200000;
  const costToday     = project?.costToday ?? 4.37;

  return (
    <div className="flex items-center gap-0 border-b border-slate-800 bg-slate-900/70 backdrop-blur flex-shrink-0 overflow-x-auto"
      style={{ height: 48 }}>
      {/* Label */}
      <div className="flex items-center gap-2 px-4 border-r border-slate-800 h-full flex-shrink-0">
        <ChevronDown size={11} className="text-slate-500" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">Office Status</span>
      </div>

      {/* Agent stats */}
      <div className="flex items-center gap-3 px-4 border-r border-slate-800 h-full flex-shrink-0">
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold text-slate-100 font-mono">{totalAgents}</span>
          <span className="text-xs text-slate-500">Total Agents</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold text-emerald-400 font-mono">{activeAgents}</span>
          <span className="text-xs text-slate-500">Active</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold text-slate-400 font-mono">{idleAgents}</span>
          <span className="text-xs text-slate-500">Idle</span>
        </div>
        {blockedAgents > 0 && (
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold text-rose-400 font-mono">{blockedAgents}</span>
            <span className="text-xs text-slate-500">Blocked</span>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-3 px-4 border-r border-slate-800 h-full flex-shrink-0">
        <span className="text-xs text-slate-500 uppercase tracking-wider whitespace-nowrap">Project Progress</span>
        <div className="flex items-center gap-2">
          <div className="w-28 h-2 rounded-full bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: "linear-gradient(90deg, #06b6d4, #8b5cf6)" }} />
          </div>
          <span className="text-lg font-bold text-slate-100 font-mono">{progress}%</span>
        </div>
      </div>

      {/* Tasks completed */}
      <div className="flex items-center gap-2 px-4 border-r border-slate-800 h-full flex-shrink-0">
        <CheckCircle2 size={12} className="text-cyan-400" />
        <span className="text-xs text-slate-500 whitespace-nowrap">Tasks Completed</span>
        <span className="text-lg font-bold text-slate-100 font-mono">{tasksCompleted}</span>
        <span className="text-xs text-slate-600">/ {tasksTotal}</span>
      </div>

      {/* Avg response time */}
      <div className="flex items-center gap-2 px-4 border-r border-slate-800 h-full flex-shrink-0">
        <Clock size={12} className="text-cyan-400" />
        <span className="text-xs text-slate-500 whitespace-nowrap">Avg Response</span>
        <span className="text-lg font-bold text-cyan-400 font-mono">{avgResponse.toFixed(1)}s</span>
      </div>

      {/* Tokens */}
      <div className="flex items-center gap-2 px-4 border-r border-slate-800 h-full flex-shrink-0">
        <Zap size={12} className="text-amber-400" />
        <span className="text-xs text-slate-500">Tokens Used</span>
        <span className="text-lg font-bold text-amber-400 font-mono">{formatTokens(tokensUsed)}</span>
      </div>

      {/* Cost */}
      <div className="flex items-center gap-2 px-4 h-full flex-shrink-0">
        <DollarSign size={12} className="text-emerald-400" />
        <span className="text-xs text-slate-500 whitespace-nowrap">Cost Today</span>
        <span className="text-lg font-bold text-emerald-400 font-mono">${costToday.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ─── Right panel: Quick actions ────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { icon: UserPlus,      label: "Add Agent",       color: "#06b6d4" },
  { icon: ClipboardList, label: "Create Task",      color: "#8b5cf6" },
  { icon: CalendarPlus,  label: "Schedule Meeting", color: "#f59e0b" },
  { icon: FileText,      label: "Generate Report",  color: "#10b981" },
  { icon: Download,      label: "Import Agents",    color: "#64748b" },
];

function QuickActions({ onNewProject }: { onNewProject: () => void }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800">
        <Zap size={13} className="text-amber-400" />
        <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Quick Actions</span>
      </div>
      <div className="p-2 space-y-1">
        {QUICK_ACTIONS.map(action => (
          <button key={action.label}
            onClick={action.label === "Add Agent" ? onNewProject : undefined}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-800/60 transition-all text-left group">
            <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: action.color + "22", border: `1px solid ${action.color}44` }}>
              <action.icon size={11} style={{ color: action.color }} />
            </div>
            <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Bottom bar ────────────────────────────────────────────────────────────────
const SCHEDULE_ITEMS = [
  { time: "9:00 AM",  label: "Standup",       color: "#06b6d4" },
  { time: "10:00 AM", label: "Sprint Planning", color: "#8b5cf6" },
  { time: "12:00 PM", label: "Review Session", color: "#f59e0b" },
  { time: "2:00 PM",  label: "Demo",           color: "#10b981" },
  { time: "4:00 PM",  label: "Retrospective",  color: "#64748b" },
];

function BottomBar({ onCameraChange }: { onCameraChange?: (view: string) => void }) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState<"1x" | "4x">("1x");

  return (
    <div className="flex items-center gap-0 border-t border-slate-800 bg-slate-900/80 backdrop-blur flex-shrink-0 overflow-x-auto"
      style={{ height: 44 }}>
      {/* Time controls */}
      <div className="flex items-center gap-2 px-4 border-r border-slate-800 h-full flex-shrink-0">
        <span className="text-xs text-slate-500 uppercase tracking-wider whitespace-nowrap">Time Controls</span>
        <button
          onClick={() => setIsPlaying(p => !p)}
          className="w-7 h-7 rounded-md flex items-center justify-center border border-slate-700 hover:border-cyan-500/40 text-slate-400 hover:text-cyan-400 transition-all">
          {isPlaying ? <Pause size={11} /> : <Play size={11} />}
        </button>
        <button
          onClick={() => setSpeed(s => s === "1x" ? "4x" : "1x")}
          className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-all ${
            speed === "4x"
              ? "border-cyan-500/40 text-cyan-400 bg-cyan-500/10"
              : "border-slate-700 text-slate-500 hover:border-slate-600"
          }`}>
          {speed}
        </button>
      </div>

      {/* Today's schedule */}
      <div className="flex items-center gap-0 px-4 border-r border-slate-800 h-full flex-shrink-0 flex-1 overflow-x-auto">
        <span className="text-xs text-slate-500 uppercase tracking-wider whitespace-nowrap mr-3">Today's Schedule</span>
        <div className="flex items-center gap-2">
          {SCHEDULE_ITEMS.map((item, i) => (
            <div key={item.label} className="flex items-center gap-1">
              {i > 0 && <div className="w-4 h-px bg-slate-700 mx-0.5" />}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                style={{ background: item.color + "18", border: `1px solid ${item.color}44` }}>
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                <span className="text-slate-400 whitespace-nowrap" style={{ fontSize: 9, fontFamily: "monospace" }}>{item.time}</span>
                <span className="text-slate-300 whitespace-nowrap" style={{ fontSize: 9 }}>{item.label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>


    </div>
  );
}

// ─── Props from AppShell ───────────────────────────────────────────────────────
interface DashboardProps {
  agents: Agent[];
  events: AgentEvent[];
  project: Project | null;
  tasks: Task[];
  connected: boolean;
  showModal: boolean;
  setShowModal: (v: boolean) => void;
  agentMode: "simulation" | "live";
  setAgentMode: (m: "simulation" | "live") => void;
}

// ─── Main dashboard ─────────────────────────────────────────────────────────────
export default function OfficeDashboard({ agents, events, project, tasks, connected, showModal, setShowModal, agentMode, setAgentMode }: DashboardProps) {
  const [activeView, setActiveView] = useState<"sims" | "board">("sims");

  // Sync agentMode from server on mount
  useEffect(() => {
    apiRequest("GET", "/api/settings")
      .then(r => r.json())
      .then((s: Record<string, string>) => {
        const m = s["agent_mode"];
        if (m === "live" || m === "simulation") setAgentMode(m);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModeToggle = async (mode: "simulation" | "live") => {
    setAgentMode(mode);
    await apiRequest("PATCH", "/api/settings", { agent_mode: mode }).catch(() => {});
  };

  const handleSubmitProject = async (name: string, desc: string, priority: string, deadline?: string) => {
    const body: Record<string, unknown> = { name, description: desc, priority };
    if (deadline) body.deadline = new Date(deadline).getTime();
    await apiRequest("POST", "/api/projects", body);
  };

  const activeCount  = agents.filter(a => a.status !== "idle").length;
  const idleCount    = agents.filter(a => a.status === "idle").length;
  const blockedCount = agents.filter(a => a.status === "blocked").length;

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">

      {/* ── Top header (app nav bar) ── */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900/90 backdrop-blur z-10 flex-shrink-0" style={{ minHeight: 48 }}>
        <div className="flex items-center gap-3">
          <nav className="flex gap-1">
            {(["sims", "board"] as const).map(view => (
              <button key={view} onClick={() => setActiveView(view)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                  activeView === view
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                    : "text-slate-500 hover:text-slate-300"
                }`}
                data-testid={`tab-${view}`}>
                {view === "sims" ? "Sims Mode" : "Board View"}
              </button>
            ))}
          </nav>
          {project && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 border-l border-slate-800 pl-3">
              <span className="text-slate-500">Project:</span>
              <span className="font-semibold text-slate-200">{project.name}</span>
              <ArrowUpRight size={11} className="text-cyan-400" />
              <span className="px-1.5 py-0.5 rounded text-xs capitalize"
                style={{
                  background: project.status === "completed" ? "#10b98118" : project.status === "planning" ? "#f59e0b18" : "#3b82f618",
                  color: project.status === "completed" ? "#10b981" : project.status === "planning" ? "#f59e0b" : "#3b82f6",
                }}>
                {project.status}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-emerald-400 font-semibold font-mono">{activeCount}</span><span className="text-slate-600">active</span>
            <span className="text-slate-400 font-semibold font-mono">{idleCount}</span><span className="text-slate-600">idle</span>
            {blockedCount > 0 && <><span className="text-rose-400 font-semibold font-mono">{blockedCount}</span><span className="text-slate-600">blocked</span></>}
          </div>

          {/* Simulation / Live toggle */}
          <div className="flex items-center rounded-lg overflow-hidden border border-slate-700 text-xs font-semibold" data-testid="mode-toggle">
            <button
              onClick={() => handleModeToggle("simulation")}
              data-testid="mode-simulation"
              className="px-3 py-1.5 transition-colors"
              style={agentMode === "simulation"
                ? { background: "#f59e0b22", color: "#f59e0b", borderRight: "1px solid #374151" }
                : { background: "transparent", color: "#6b7280", borderRight: "1px solid #374151" }
              }>
              SIM
            </button>
            <button
              onClick={() => handleModeToggle("live")}
              data-testid="mode-live"
              className="px-3 py-1.5 transition-colors"
              style={agentMode === "live"
                ? { background: "#10b98122", color: "#10b981" }
                : { background: "transparent", color: "#6b7280" }
              }>
              LIVE
            </button>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)", color: "#fff" }}>
            <Send size={12} />
            New Project
          </button>
        </div>
      </header>

      {/* ── Top stats bar ── */}
      <TopStatsBar agents={agents} project={project} tasks={tasks} />

      {/* ── Main 3-column layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* CENTRE: canvas */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
              <Loader2 size={24} className="animate-spin" />
              <span className="text-sm">Loading agents...</span>
            </div>
          ) : activeView === "sims" ? (
            <IsometricOffice agents={agents} project={project} />
          ) : (
            <div className="overflow-y-auto custom-scroll floor-pattern h-full p-5">
              <div className="office-grid max-w-5xl mx-auto">
                {agents.map(agent => <AgentDesk key={agent.id} agent={agent} />)}
              </div>
            </div>
          )}
        </main>

        {/* RIGHT panel */}
        <div className="flex flex-col border-l border-slate-800 bg-slate-900/60 flex-shrink-0 overflow-hidden"
          style={{ width: 220 }}>
          {/* Activity feed - takes most height */}
          <div className="flex flex-col overflow-hidden" style={{ flex: "1 1 0" }}>
            <ActivityFeed events={events} connected={connected} />
          </div>
          {/* Task flow */}
          <div className="flex flex-col overflow-hidden border-t border-slate-800" style={{ flex: "1.2 1 0" }}>
            <TaskFlowPanel agents={agents} tasks={tasks} />
          </div>
          {/* Quick actions */}
          <div className="border-t border-slate-800 flex-shrink-0">
            <QuickActions onNewProject={() => setShowModal(true)} />
          </div>
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <BottomBar />

      {/* Submit modal */}
      {showModal && (
        <SubmitProjectModal
          onClose={() => setShowModal(false)}
          onSubmit={handleSubmitProject}
        />
      )}
    </div>
  );
}
