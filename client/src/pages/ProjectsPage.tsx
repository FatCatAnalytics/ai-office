import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  FolderOpen, Edit3, Trash2, Play, Clock, Calendar, AlertTriangle,
  CheckCircle2, Loader2, FileText, X, Save, Folders,
} from "lucide-react";
import type { Project } from "../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { color: string; label: string }> = {
  planning:  { color: "#f59e0b", label: "Planning" },
  active:    { color: "#3b82f6", label: "Active" },
  blocked:   { color: "#ef4444", label: "Blocked" },
  completed: { color: "#10b981", label: "Completed" },
};

const PRIORITY_META: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f59e0b",
  normal:   "#3b82f6",
  low:      "#64748b",
};

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function parseFormats(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x: unknown): x is string => typeof x === "string") : [];
  } catch { return []; }
}

const ALL_FORMATS = [
  { key: "markdown", label: "Markdown" },
  { key: "pdf",      label: "PDF" },
  { key: "csv",      label: "CSV" },
  { key: "excel",    label: "Excel" },
  { key: "json",     label: "JSON" },
  { key: "python",   label: "Python" },
];

// ── Edit modal ───────────────────────────────────────────────────────────────

interface ProjectPatch {
  name?: string;
  description?: string;
  priority?: string;
  deadline?: number | null;
  outputFormats?: string[];
}

function EditProjectModal({ project, onClose, onSave }: {
  project: Project;
  onClose: () => void;
  onSave: (patch: ProjectPatch) => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [priority, setPriority] = useState(project.priority);
  const [formats, setFormats] = useState<string[]>(parseFormats(project.outputFormats));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleFmt = (k: string) => {
    setFormats(prev => prev.includes(k) ? prev.filter(f => f !== k) : [...prev, k]);
  };

  const handleSave = async () => {
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        priority,
        outputFormats: formats,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        data-testid="modal-edit-project">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <Edit3 size={14} className="text-cyan-400" />
            <span className="font-semibold text-slate-100">Edit Project</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors"
                  data-testid="button-close-edit">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Project Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              data-testid="input-edit-name" />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 resize-none"
              data-testid="input-edit-desc" />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              data-testid="select-edit-priority">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Output Formats</label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_FORMATS.map(fmt => {
                const active = formats.includes(fmt.key);
                return (
                  <button key={fmt.key} onClick={() => toggleFmt(fmt.key)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40"
                        : "bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600"
                    }`}
                    data-testid={`toggle-format-${fmt.key}`}>
                    {fmt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {err && (
            <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={12} />
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800 bg-slate-900/40">
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            data-testid="button-cancel-edit">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
            data-testid="button-save-edit">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation modal ────────────────────────────────────────────────

function DeleteProjectModal({ project, onClose, onConfirm }: {
  project: Project;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pull task and file counts so the user knows what's being wiped.
  const { data: tasks = [] } = useQuery<{ id: number }[]>({
    queryKey: ["/api/projects", project.id, "tasks"],
    queryFn: () => apiRequest("GET", `/api/projects/${project.id}/tasks`).then(r => r.json()),
  });
  const { data: files = [] } = useQuery<{ id: number }[]>({
    queryKey: ["/api/projects", project.id, "files"],
    queryFn: () => apiRequest("GET", `/api/projects/${project.id}/files`).then(r => r.json()),
  });

  const handleDelete = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-slate-900 border border-rose-500/30 rounded-2xl shadow-2xl overflow-hidden"
        data-testid="modal-delete-project">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800 bg-rose-500/5">
          <AlertTriangle size={14} className="text-rose-400" />
          <span className="font-semibold text-rose-300">Delete Project</span>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-200">
            Permanently delete <span className="font-semibold text-slate-100">{project.name}</span>?
          </p>
          <p className="text-xs text-slate-400">
            This will remove the project and all related data. This cannot be undone.
          </p>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span>Tasks</span>
              <span className="font-mono text-slate-200">{tasks.length}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Files</span>
              <span className="font-mono text-slate-200">{files.length}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Status</span>
              <span className="font-mono text-slate-200">{STATUS_META[project.status]?.label ?? project.status}</span>
            </div>
          </div>

          {err && (
            <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={12} />
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800 bg-slate-900/40">
          <button onClick={onClose} disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
            data-testid="button-cancel-delete">
            Cancel
          </button>
          <button onClick={handleDelete} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors disabled:opacity-50"
            data-testid="button-confirm-delete">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Delete forever
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({ project, onEdit, onDelete, onResume }: {
  project: Project;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
  onResume: (p: Project) => void;
}) {
  const status = STATUS_META[project.status] ?? { color: "#64748b", label: project.status };
  const formats = parseFormats(project.outputFormats);
  const isLocked = project.status === "active" || project.status === "planning";
  const canResume = project.status === "blocked";

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-colors group"
         data-testid={`project-card-${project.id}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: `${status.color}22`, color: status.color, border: `1px solid ${status.color}44` }}>
              {status.label}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                  style={{ background: `${PRIORITY_META[project.priority] ?? "#64748b"}22`,
                           color: PRIORITY_META[project.priority] ?? "#64748b" }}>
              {project.priority}
            </span>
          </div>
          <div className="text-sm font-bold text-slate-100 truncate" data-testid={`project-name-${project.id}`}>
            {project.name}
          </div>
          {project.description && (
            <div className="text-xs text-slate-500 mt-1 line-clamp-2">{project.description}</div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1 uppercase tracking-wider">
          <span>Progress</span>
          <span className="font-mono text-slate-300">{project.progress}%</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all"
               style={{ width: `${project.progress}%`,
                        background: project.status === "completed"
                          ? "linear-gradient(90deg, #10b981, #06b6d4)"
                          : "linear-gradient(90deg, #06b6d4, #8b5cf6)" }} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-500 mb-3">
        <div className="flex items-center gap-1">
          <CheckCircle2 size={10} className="text-emerald-500/70" />
          <span className="font-mono text-slate-300">{project.tasksCompleted}</span>
          <span>/{project.tasksTotal}</span>
        </div>
        <div className="flex items-center gap-1">
          <Calendar size={10} />
          <span className="font-mono text-slate-300">{fmtTime(project.createdAt).split(",")[0]}</span>
        </div>
        <div className="flex items-center gap-1 justify-end">
          <Clock size={10} />
          <span className="font-mono text-slate-300">${project.costToday.toFixed(2)}</span>
        </div>
      </div>

      {/* Output formats */}
      {formats.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {formats.map(f => (
            <span key={f}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              <FileText size={8} className="inline mr-0.5" />
              {f}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-3 border-t border-slate-800">
        {canResume && (
          <button onClick={() => onResume(project)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25"
            data-testid={`button-resume-${project.id}`}>
            <Play size={10} />
            Resume
          </button>
        )}
        <button onClick={() => onEdit(project)} disabled={isLocked}
          title={isLocked ? `Cannot edit while ${project.status}` : "Edit project"}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid={`button-edit-${project.id}`}>
          <Edit3 size={10} />
          Edit
        </button>
        <button onClick={() => onDelete(project)} disabled={isLocked}
          title={isLocked ? `Cannot delete while ${project.status}` : "Delete project"}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors text-rose-400 border border-transparent hover:bg-rose-500/10 hover:border-rose-500/30 disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
          data-testid={`button-delete-${project.id}`}>
          <Trash2 size={10} />
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const { data: projects = [], refetch } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    queryFn: () => apiRequest("GET", "/api/projects").then(r => r.json()),
    refetchInterval: 8000,
  });

  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Refetch on WS events that change project state.
  useEffect(() => {
    const onChange = () => queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    window.addEventListener("aioffice:project_update", onChange);
    window.addEventListener("aioffice:project_deleted", onChange);
    return () => {
      window.removeEventListener("aioffice:project_update", onChange);
      window.removeEventListener("aioffice:project_deleted", onChange);
    };
  }, []);

  const editMut = useMutation({
    mutationFn: async (args: { id: number; patch: ProjectPatch }) => {
      const r = await apiRequest("PATCH", `/api/projects/${args.id}`, args.patch);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Update failed");
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("DELETE", `/api/projects/${id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Delete failed");
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
  });

  const handleResume = async (p: Project) => {
    setResumeError(null);
    try {
      const r = await apiRequest("POST", `/api/projects/${p.id}/resume`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Resume failed");
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    } catch (e) {
      setResumeError(`${p.name}: ${(e as Error).message}`);
      setTimeout(() => setResumeError(null), 5000);
    }
  };

  const sorted = [...projects].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Folders size={15} className="text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">Projects</span>
          <span className="text-xs text-slate-500">{projects.length} project{projects.length !== 1 ? "s" : ""}</span>
        </div>
        <button onClick={() => refetch()}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          data-testid="button-refresh-projects">
          Refresh
        </button>
      </div>

      {resumeError && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 flex items-center gap-2"
             data-testid="banner-resume-error">
          <AlertTriangle size={12} />
          {resumeError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scroll p-5">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <FolderOpen size={32} className="opacity-30" />
            <div className="text-sm text-slate-500">No projects yet</div>
            <div className="text-xs text-slate-600">Use the New Project button to create one</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sorted.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                onEdit={setEditing}
                onDelete={setDeleting}
                onResume={handleResume}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditProjectModal
          project={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => editMut.mutateAsync({ id: editing.id, patch })}
        />
      )}
      {deleting && (
        <DeleteProjectModal
          project={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteMut.mutateAsync(deleting.id)}
        />
      )}
    </div>
  );
}
