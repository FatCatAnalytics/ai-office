import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Task, Agent, Project } from "../types";
import {
  LayoutGrid, AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw,
  ChevronDown, GitBranch, ArrowRight, Flag,
} from "lucide-react";

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", normal: "#3b82f6", low: "#64748b",
};
const STATUS_LABELS: Record<string, string> = {
  todo: "To Do", in_progress: "In Progress", blocked: "Blocked", done: "Done",
};
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  todo:        { bg: "bg-slate-800/60",   border: "border-slate-700",      text: "text-slate-400"  },
  in_progress: { bg: "bg-blue-500/10",    border: "border-blue-500/40",    text: "text-blue-400"   },
  blocked:     { bg: "bg-rose-500/10",    border: "border-rose-500/40",    text: "text-rose-400"   },
  done:        { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400" },
};

function TaskCard({ task, agents, onReassign }: {
  task: Task; agents: Agent[]; onReassign: (taskId: number, agentId: string) => void;
}) {
  const [showReassign, setShowReassign] = useState(false);
  const assignee = agents.find(a => a.id === task.assignedTo);
  const sc = STATUS_COLORS[task.status] ?? STATUS_COLORS.todo;
  const priorityColor = PRIORITY_COLORS[task.priority] ?? "#64748b";

  return (
    <div className={`rounded-xl border p-4 ${sc.bg} ${sc.border} flex flex-col gap-2.5`}
      data-testid={`task-card-${task.id}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-100 leading-snug">{task.title}</div>
          {task.description && (
            <div className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{task.description}</div>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <Flag size={11} style={{ color: priorityColor }}/>
          <span className="text-xs font-medium capitalize" style={{ color: priorityColor }}>{task.priority}</span>
        </div>
      </div>

      {/* Blocked reason */}
      {task.blockedReason && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle size={11} className="text-rose-400 flex-shrink-0 mt-0.5"/>
          <span className="text-xs text-rose-400 leading-relaxed">{task.blockedReason}</span>
        </div>
      )}

      {/* Assignee */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {assignee && (
            <>
              <div className="w-5 h-5 rounded-full flex-shrink-0"
                style={{ background: assignee.color, boxShadow:`0 0 6px ${assignee.color}66` }}/>
              <span className="text-xs text-slate-400">{assignee.name}</span>
            </>
          )}
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sc.text}`}
          style={{ background:`${sc.text === "text-slate-400" ? "#334155" : ""}` }}>
          {STATUS_LABELS[task.status]}
        </span>
      </div>

      {/* Reassign (Manager action) */}
      {task.status !== "done" && (
        <div className="pt-1 border-t border-slate-700/50">
          {showReassign ? (
            <div className="flex flex-col gap-2">
              <div className="text-xs text-slate-500">Reassign to:</div>
              <div className="flex flex-wrap gap-1.5">
                {agents.filter(a => a.id !== "manager" && a.id !== task.assignedTo).map(a => (
                  <button key={a.id}
                    onClick={() => { onReassign(task.id, a.id); setShowReassign(false); }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-slate-700 text-slate-400 hover:border-cyan-500/50 hover:text-slate-200 transition-colors"
                    data-testid={`reassign-to-${a.id}`}>
                    <div className="w-2 h-2 rounded-full" style={{ background: a.color }}/>
                    {a.name}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowReassign(false)} className="text-xs text-slate-600 hover:text-slate-400">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowReassign(true)}
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-cyan-400 transition-colors"
              data-testid={`button-reassign-${task.id}`}>
              <RefreshCw size={11}/> Manager reassign
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Kanban column ─────────────────────────────────────────────────────────────
function KanbanColumn({ status, tasks, agents, onReassign }: {
  status: string; tasks: Task[]; agents: Agent[];
  onReassign: (taskId: number, agentId: string) => void;
}) {
  const sc = STATUS_COLORS[status] ?? STATUS_COLORS.todo;
  const icons: Record<string, React.ElementType> = {
    todo: Clock, in_progress: Loader2, blocked: AlertTriangle, done: CheckCircle2,
  };
  const Icon = icons[status] ?? Clock;

  return (
    <div className="flex flex-col gap-3 min-w-[240px] flex-1">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Icon size={14} className={sc.text} style={status === "in_progress" ? { animation:"none" } : {}}/>
          <span className={`text-xs font-semibold ${sc.text}`}>{STATUS_LABELS[status]}</span>
        </div>
        <span className={`text-xs ${sc.text} bg-slate-800/60 rounded-full px-2`}>{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {tasks.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-800 py-6 flex items-center justify-center text-xs text-slate-700">
            No tasks
          </div>
        )}
        {tasks.map(t => (
          <TaskCard key={t.id} task={t} agents={agents} onReassign={onReassign}/>
        ))}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
interface TaskBoardProps {
  tasks: Task[];
  project: Project | null;
  agents: Agent[];
}

export default function TaskBoardPage({ tasks: liveTasks, project: liveProject, agents: liveAgents }: TaskBoardProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // Fall back to REST for projects list (for the selector dropdown)
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  // Use live WebSocket data — agents and tasks update in real time
  const agents = liveAgents.length > 0 ? liveAgents : [];

  // Active project: prefer WS live project, allow override via selector
  const activeProject = selectedProjectId
    ? projects.find(p => p.id === selectedProjectId) ?? liveProject
    : liveProject ?? projects.find(p => p.status === "active" || p.status === "planning") ?? projects[0];

  // Tasks: use live WS tasks (already filtered by active project on server)
  // If user selects a different project via dropdown, fall back to REST fetch
  const { data: fetchedTasks = [], isFetching } = useQuery<Task[]>({
    queryKey: ["/api/tasks", selectedProjectId],
    queryFn: () => apiRequest("GET", `/api/projects/${selectedProjectId}/tasks`).then(r => r.json()),
    enabled: !!selectedProjectId && selectedProjectId !== liveProject?.id,
  });

  const tasks = (selectedProjectId && selectedProjectId !== liveProject?.id)
    ? fetchedTasks
    : liveTasks;

  const isLoading = isFetching && tasks.length === 0;

  const reassignMut = useMutation({
    mutationFn: ({ taskId, agentId }: { taskId: number; agentId: string }) =>
      apiRequest("POST", `/api/tasks/${taskId}/reassign`, { assignedTo: agentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  const columns = ["todo", "in_progress", "blocked", "done"] as const;
  const grouped = Object.fromEntries(
    columns.map(s => [s, tasks.filter(t => t.status === s)])
  ) as Record<string, Task[]>;

  const blockedCount = tasks.filter(t => t.status === "blocked").length;

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <LayoutGrid size={16} className="text-violet-400"/>
          <span className="font-semibold text-slate-100">Task Board</span>
          {blockedCount > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center gap-1">
              <AlertTriangle size={10}/> {blockedCount} blocked
            </span>
          )}
        </div>

        {/* Project selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Project:</span>
          <select
            value={activeProject?.id ?? ""}
            onChange={e => setSelectedProjectId(e.target.value ? parseInt(e.target.value) : null)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            data-testid="select-project">
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.status})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        {!activeProject ? (
          <div className="flex items-center justify-center h-full text-slate-600 text-sm">
            Submit a project to see tasks here
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full gap-2 text-slate-500">
            <Loader2 size={18} className="animate-spin"/> Loading tasks...
          </div>
        ) : (
          <div className="flex gap-4 p-6 h-full min-h-0">
            {columns.map(col => (
              <KanbanColumn
                key={col}
                status={col}
                tasks={grouped[col] ?? []}
                agents={agents}
                onReassign={(taskId, agentId) => reassignMut.mutate({ taskId, agentId })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer stats */}
      {activeProject && (
        <div className="flex items-center gap-6 px-6 py-3 border-t border-slate-800 bg-slate-900/60 text-xs text-slate-500">
          <span className="text-slate-300 font-semibold">{activeProject.name}</span>
          <span>{tasks.length} total tasks</span>
          <span className="text-emerald-400">{grouped.done?.length ?? 0} done</span>
          <span className="text-blue-400">{grouped.in_progress?.length ?? 0} in progress</span>
          {blockedCount > 0 && <span className="text-rose-400">{blockedCount} blocked</span>}
          <div className="ml-auto flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full bg-slate-700 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width:`${activeProject.progress}%`, background:"linear-gradient(90deg, #06b6d4, #8b5cf6)" }}/>
            </div>
            <span className="font-mono text-slate-300">{activeProject.progress}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
