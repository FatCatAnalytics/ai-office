import { useState, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { Agent, AgentEvent, Project, Task } from "../types";
import {
  Crown, Monitor, Server, Bug, Palette, Rocket, Database, BarChart3, Shield, Briefcase,
  Play, Pause, ChevronDown, Activity, Zap, DollarSign,
  Clock, CheckCircle2, AlertTriangle, XCircle, Info,
  WifiOff, Send, Terminal, GitBranch, Loader2, ArrowUpRight, Circle,
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
  return new Date(ts).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
}
function formatTokens(n: number) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+"M";
  if (n >= 1e3) return (n/1e3).toFixed(1)+"K";
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
        style={{ background: agent.color }}/>
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background:`${agent.color}22`, border:`1px solid ${agent.color}44` }}>
              <Icon size={18} style={{ color: agent.color }}/>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100 leading-tight">{agent.name}</div>
              <div className="text-xs text-slate-500">{agent.role}</div>
              <div className="text-xs text-slate-600 font-mono">{agent.modelId}</div>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 ${STATUS_COLORS[agent.status]}`}>
            {isWorking && <span className="flex gap-0.5 items-end h-3"><span className="typing-dot"/><span className="typing-dot"/><span className="typing-dot"/></span>}
            {isThinking && <Loader2 size={11} className="animate-spin"/>}
            {!isWorking && !isThinking && <Circle size={7} fill="currentColor"/>}
            <span className="text-xs font-medium">{STATUS_LABELS[agent.status]}</span>
          </div>
        </div>
        <div className="min-h-[36px] flex items-center">
          {agent.currentTask
            ? <div className="flex gap-2 items-start"><Terminal size={12} className="text-slate-500 mt-0.5 flex-shrink-0"/><span className="text-xs text-slate-300 leading-relaxed">{agent.currentTask}</span></div>
            : <span className="text-xs text-slate-600 italic">Awaiting assignment...</span>}
        </div>
        <div className="rounded-md overflow-hidden border border-slate-700/60" style={{ background:"#0d1117" }}>
          <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-700/40">
            <span className="w-2 h-2 rounded-full bg-rose-500/60"/><span className="w-2 h-2 rounded-full bg-amber-500/60"/><span className="w-2 h-2 rounded-full bg-emerald-500/60"/>
            <span className="ml-1 text-slate-600 font-mono" style={{ fontSize:9 }}>terminal</span>
          </div>
          <div className="p-2 font-mono h-10 overflow-hidden">
            {isWorking && <div className="text-emerald-400" style={{ fontSize:10 }}><span className="text-slate-500">$ </span>{agent.currentTask?.toLowerCase().replace(/ /g,"_")||"..."}_<span className="status-blink">▊</span></div>}
            {isThinking && <div className="text-amber-400" style={{ fontSize:10 }}><span className="text-slate-500">~ </span>analyzing...<span className="status-blink">▊</span></div>}
            {agent.status==="done" && <div className="text-cyan-400" style={{ fontSize:10 }}><span className="text-slate-500">$ </span><CheckCircle2 size={10} className="inline mr-1"/>task complete ✓</div>}
            {agent.status==="idle" && <div className="text-slate-600" style={{ fontSize:10 }}><span className="text-slate-500">$ </span>waiting for tasks_</div>}
            {agent.status==="blocked" && <div className="text-rose-400" style={{ fontSize:10 }}><span className="text-slate-500">! </span>blocked — awaiting manager</div>}
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-cyan-400"/>
          <span className="text-sm font-semibold text-slate-200">Activity Feed</span>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <><div className="live-dot"/><span className="text-xs text-emerald-400 font-medium">Live</span></>
          ) : (
            <><WifiOff size={12} className="text-slate-500"/><span className="text-xs text-slate-500">Offline</span></>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll px-3 py-2 space-y-1">
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-600">
            <Terminal size={20}/>
            <span className="text-xs">Submit a project to start</span>
          </div>
        )}
        {events.map((ev, i) => {
          const StatusIcon = EVENT_STATUS_ICON[ev.status] || Info;
          const color = EVENT_STATUS_COLOR[ev.status] || "text-slate-400";
          return (
            <div key={ev.id ?? i} className="slide-in flex gap-2.5 py-2 px-2.5 rounded-lg hover:bg-slate-800/50 transition-colors">
              <StatusIcon size={13} className={`${color} flex-shrink-0 mt-0.5`}/>
              <div className="flex-1 min-w-0">
                <div className="text-xs leading-snug">
                  <span className="font-semibold text-slate-200">{ev.agentName}</span>{" "}
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <GitBranch size={14} className="text-violet-400"/>
        <span className="text-sm font-semibold text-slate-200">Task Flow</span>
        {tasks.length > 0 && <span className="text-xs text-slate-500 ml-auto">{tasks.length} tasks</span>}
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll px-3 py-3">
        {/* Manager node */}
        {manager && (
          <div className="flex flex-col items-center mb-3">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all`}
              style={{
                background: getStatus("manager") !== "idle" ? "#6366f118" : "hsl(222 40% 12%)",
                border: `1px solid ${getStatus("manager") !== "idle" ? "#6366f166" : "hsl(222 25% 18%)"}`,
                color: getStatus("manager") !== "idle" ? "#6366f1" : "hsl(215 16% 47%)",
              }}>
              {getStatus("manager") === "working" && <span className="flex gap-0.5 items-end h-3"><span className="typing-dot"/><span className="typing-dot"/><span className="typing-dot"/></span>}
              Manager Agent
            </div>
            <div className="w-px h-4 bg-slate-700"/>
          </div>
        )}

        {/* Agent nodes with their tasks */}
        {subAgents.length === 0 && (
          <div className="text-xs text-slate-600 text-center py-4">No subagents yet</div>
        )}
        <div className="flex flex-col gap-2">
          {subAgents.map(agent => {
            const status = getStatus(agent.id);
            const agentTasks = tasksByAgent[agent.id] ?? [];
            const isActive = status !== "idle";
            return (
              <div key={agent.id} className="rounded-lg border transition-all"
                style={{
                  background: isActive ? `${agent.color}10` : "hsl(222 40% 10%)",
                  border: `1px solid ${isActive ? agent.color+"44" : "hsl(222 25% 16%)"}`,
                  padding: "8px 10px",
                }}>
                <div className="flex items-center gap-2 mb-1">
                  {status === "working" && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping absolute"/>}
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{
                    background: status === "idle" ? "#1e3050" : status === "blocked" ? "#ef4444" : agent.color
                  }}/>
                  <span className="text-xs font-medium" style={{ color: isActive ? agent.color : "#64748b" }}>
                    {agent.name}
                  </span>
                </div>
                {agentTasks.length > 0 && (
                  <div className="pl-4 space-y-1">
                    {agentTasks.slice(0,2).map(t => (
                      <div key={t.id} className="text-xs text-slate-500 truncate flex items-center gap-1">
                        {t.status === "done" ? <CheckCircle2 size={10} className="text-emerald-400 flex-shrink-0"/> :
                         t.status === "blocked" ? <AlertTriangle size={10} className="text-rose-400 flex-shrink-0"/> :
                         t.status === "in_progress" ? <Loader2 size={10} className="text-blue-400 flex-shrink-0 animate-spin"/> :
                         <Circle size={8} className="text-slate-700 flex-shrink-0"/>}
                        {t.title}
                      </div>
                    ))}
                    {agentTasks.length > 2 && <div className="text-xs text-slate-600 pl-4">+{agentTasks.length-2} more</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap gap-x-3 gap-y-1">
          {[
            { label:"Done",        color:"bg-emerald-400" },
            { label:"In Progress", color:"bg-blue-400"    },
            { label:"Blocked",     color:"bg-rose-400"    },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${item.color}`}/>
              <span className="text-xs text-slate-500">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Submit project modal (with priority & deadline) ──────────────────────────
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
    { name:"Skyline SaaS", desc:"Build a full-stack SaaS dashboard with auth, payments and analytics", priority:"high" },
    { name:"API Gateway", desc:"Design and implement a RESTful API gateway with rate limiting and auth", priority:"normal" },
    { name:"Mobile MVP", desc:"React Native app with onboarding, home screen and push notifications", priority:"normal" },
    { name:"AI Chatbot", desc:"Integrate LLM-powered chat with streaming responses and history", priority:"high" },
  ];

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await onSubmit(name, desc, priority, deadline || undefined);
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:"rgba(0,0,0,0.75)" }}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" data-testid="task-modal">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Send size={16} className="text-cyan-400"/>
            <span className="font-semibold text-slate-100">New Project</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          {/* Presets */}
          <div>
            <div className="text-xs text-slate-500 mb-2">Quick presets</div>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map(p => (
                <button key={p.name} onClick={() => { setName(p.name); setDesc(p.desc); setPriority(p.priority); }}
                  className="text-left px-3 py-2 rounded-lg border border-slate-700 hover:border-cyan-500/50 hover:bg-slate-800 transition-all text-xs text-slate-400 hover:text-slate-200"
                  data-testid={`preset-${p.name.toLowerCase().replace(/ /g,"-")}`}>
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
                data-testid="input-project-name"/>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Description</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)}
                placeholder="Describe what you want the team to build..."
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors resize-none"
                data-testid="input-project-desc"/>
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
                  data-testid="input-deadline"/>
              </div>
            </div>
          </div>

          <button onClick={handleSubmit} disabled={!name.trim() || loading}
            className="w-full py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ background:"linear-gradient(135deg, #06b6d4, #8b5cf6)", color:"#fff" }}
            data-testid="button-submit-project">
            {loading ? <Loader2 size={15} className="animate-spin"/> : <Send size={15}/>}
            {loading ? "Dispatching to Manager..." : "Deploy to AI Office"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bottom metrics bar ────────────────────────────────────────────────────────
function MetricsBar({ project, agents }: { project: Project | null; agents: Agent[] }) {
  const activeAgents  = agents.filter(a => a.status !== "idle").length;
  const idleAgents    = agents.filter(a => a.status === "idle").length;
  const blockedAgents = agents.filter(a => a.status === "blocked").length;

  return (
    <div className="flex items-center gap-0 border-t border-slate-800 bg-slate-900/80 backdrop-blur overflow-x-auto">
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800 flex-shrink-0">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Agents</span>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-100 font-semibold">{agents.length}</span><span className="text-slate-600">total</span>
          <span className="text-emerald-400">{activeAgents} active</span>
          <span className="text-slate-600">{idleAgents} idle</span>
          {blockedAgents > 0 && <span className="text-rose-400">{blockedAgents} blocked</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800 flex-shrink-0">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Progress</span>
        <div className="flex items-center gap-2">
          <div className="w-24 h-1.5 rounded-full bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width:`${project?.progress??0}%`, background:"linear-gradient(90deg, #06b6d4, #8b5cf6)" }}/>
          </div>
          <span className="text-sm font-bold text-slate-100 font-mono">{project?.progress??0}%</span>
        </div>
      </div>
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800 flex-shrink-0">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Tasks</span>
        <span className="text-sm font-bold text-slate-100 font-mono">{project?.tasksCompleted??0}</span>
        <span className="text-slate-600 font-mono text-xs">/ {project?.tasksTotal??0}</span>
      </div>
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800 flex-shrink-0">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Avg Response</span>
        <span className="text-sm font-bold text-slate-100 font-mono">{project?.avgResponseTime?.toFixed(1)??"0.0"}s</span>
      </div>
      <div className="flex items-center gap-3 px-5 py-3 border-r border-slate-800 flex-shrink-0">
        <Zap size={12} className="text-amber-400"/>
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Tokens</span>
        <span className="text-sm font-bold text-amber-400 font-mono">{formatTokens(project?.tokensUsed??0)}</span>
      </div>
      <div className="flex items-center gap-3 px-5 py-3 flex-shrink-0">
        <DollarSign size={12} className="text-emerald-400"/>
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Cost Today</span>
        <span className="text-sm font-bold text-emerald-400 font-mono">${project?.costToday?.toFixed(2)??"0.00"}</span>
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
}

// ─── Main dashboard ─────────────────────────────────────────────────────────────
export default function OfficeDashboard({ agents, events, project, tasks, connected, showModal, setShowModal }: DashboardProps) {
  const [activeView, setActiveView] = useState<"sims" | "board">("sims");

  const handleSubmitProject = async (name: string, desc: string, priority: string, deadline?: string) => {
    const body: Record<string, unknown> = { name, description: desc, priority };
    if (deadline) body.deadline = new Date(deadline).getTime();
    await apiRequest("POST", "/api/projects", body);
  };

  const activeCount  = agents.filter(a => a.status !== "idle").length;
  const idleCount    = agents.filter(a => a.status === "idle").length;
  const blockedCount = agents.filter(a => a.status === "blocked").length;

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      {/* Top header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900/80 backdrop-blur z-10 flex-shrink-0">
        <div className="flex items-center gap-4">
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
        </div>

        <div className="flex items-center gap-5 text-xs">
          {project && (
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="text-slate-500">Project:</span>
              <span className="font-semibold text-slate-200">{project.name}</span>
              <ArrowUpRight size={12} className="text-cyan-400"/>
              <span className="px-1.5 py-0.5 rounded text-xs capitalize"
                style={{ background: project.status==="completed" ? "#10b98118" : project.status==="planning" ? "#f59e0b18" : "#3b82f618",
                  color: project.status==="completed" ? "#10b981" : project.status==="planning" ? "#f59e0b" : "#3b82f6" }}>
                {project.status}
              </span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <span className="text-emerald-400 font-semibold font-mono">{activeCount}</span><span className="text-slate-600">active</span>
            <span className="text-slate-400 font-semibold font-mono">{idleCount}</span><span className="text-slate-600">idle</span>
            {blockedCount > 0 && <><span className="text-rose-400 font-semibold font-mono">{blockedCount}</span><span className="text-slate-600">blocked</span></>}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Office canvas / board */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Status bar */}
          <div className="flex items-center gap-6 px-5 py-2.5 border-b border-slate-800 bg-slate-900/40 flex-shrink-0">
            <div className="flex items-center gap-2">
              <ChevronDown size={12} className="text-slate-500"/>
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                {project?.name ?? "Office Floor"}
              </span>
            </div>
            <div className="flex items-center gap-6 text-xs font-mono">
              <div className="flex items-baseline gap-1.5"><span className="text-2xl font-bold text-slate-100">{agents.length}</span><span className="text-slate-500">Agents</span></div>
              <div className="flex items-baseline gap-1.5"><span className="text-2xl font-bold text-slate-100">{tasks.length}</span><span className="text-slate-500">Tasks</span></div>
              <div className="flex items-baseline gap-1.5"><span className="text-2xl font-bold text-slate-100">{blockedCount}</span><span className="text-slate-500">Blocked</span></div>
            </div>
            {project && (
              <div className="ml-auto flex items-center gap-3">
                <div className="text-xs text-slate-500">Progress</div>
                <div className="w-32 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width:`${project.progress}%`, background:"linear-gradient(90deg, #06b6d4, #8b5cf6)" }}/>
                </div>
                <span className="text-xs font-bold text-slate-200 font-mono">{project.progress}%</span>
              </div>
            )}
          </div>

          {/* Office floor / board */}
          <div className="flex-1 overflow-hidden relative">
            {agents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
                <Loader2 size={24} className="animate-spin"/>
                <span className="text-sm">Loading agents...</span>
              </div>
            ) : activeView === "sims" ? (
              <IsometricOffice agents={agents} project={project}/>
            ) : (
              <div className="overflow-y-auto custom-scroll floor-pattern h-full p-5">
                <div className="office-grid max-w-5xl mx-auto">
                  {agents.map(agent => <AgentDesk key={agent.id} agent={agent}/>)}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right panels */}
        <div className="w-72 flex flex-col border-l border-slate-800 bg-slate-900/60 flex-shrink-0">
          <div className="flex-1 overflow-hidden flex flex-col border-b border-slate-800">
            <ActivityFeed events={events} connected={connected}/>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            <TaskFlowPanel agents={agents} tasks={tasks}/>
          </div>
        </div>
      </div>

      {/* Bottom metrics */}
      <MetricsBar project={project} agents={agents}/>

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
