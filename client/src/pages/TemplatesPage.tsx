import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CalendarClock, Edit3, Trash2, Play, Plus, X, Save, Power,
  AlertTriangle, CheckCircle2, Loader2, Clock, Repeat,
} from "lucide-react";
import type { ProjectTemplate } from "../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: number | string | null) {
  if (!ts) return "—";
  const d = typeof ts === "string" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtCountdown(targetIso: string | null): string {
  if (!targetIso) return "—";
  const t = new Date(targetIso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = t - Date.now();
  if (diff <= 0) return "due now";
  const sec = Math.floor(diff / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const KIND_META: Record<string, { color: string; label: string; icon: React.ElementType }> = {
  weekly: { color: "#3b82f6", label: "Weekly",  icon: Repeat },
  adhoc:  { color: "#a855f7", label: "Ad-hoc",  icon: Play },
};

// ── Edit / create modal ──────────────────────────────────────────────────────

interface TemplatePatch {
  name?: string;
  description?: string;
  kind?: string;
  prompt?: string;
  scheduleCron?: string;
  enabled?: boolean;
  outputDir?: string;
}

const CRON_PRESETS: { label: string; value: string; hint: string }[] = [
  { label: "Sunday 18:00 UK",   value: "0 18 * * 0",  hint: "Weekly research trigger (BST/GMT auto)" },
  { label: "Tuesday 10:30 UK",  value: "30 10 * * 2", hint: "Weekly delivery slot" },
  { label: "Daily 09:00 UK",    value: "0 9 * * *",   hint: "Every weekday morning" },
  { label: "Heartbeat (5 min)", value: "*/5 * * * *", hint: "Smoke-test only — burns credits if enabled" },
];

function TemplateModal({ template, onClose, onSave }: {
  template: ProjectTemplate | null; // null = create
  onClose: () => void;
  onSave: (patch: TemplatePatch) => Promise<void>;
}) {
  const isNew = !template;
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [kind, setKind] = useState(template?.kind ?? "weekly");
  const [prompt, setPrompt] = useState(template?.prompt ?? "");
  const [scheduleCron, setScheduleCron] = useState(template?.scheduleCron ?? "");
  const [enabled, setEnabled] = useState(template ? template.enabled === 1 : false);
  const [outputDir, setOutputDir] = useState(template?.outputDir ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) { setErr("Name is required"); return; }
    if (!prompt.trim()) { setErr("Prompt is required"); return; }
    if (kind === "weekly" && !scheduleCron.trim()) {
      setErr("Weekly templates need a cron expression");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        kind,
        prompt: prompt.trim(),
        scheduleCron: scheduleCron.trim(),
        enabled,
        outputDir: outputDir.trim(),
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
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        data-testid="modal-edit-template">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-cyan-400"/>
            <h3 className="text-sm font-semibold text-slate-100">
              {isNew ? "New template" : `Edit: ${template!.name}`}
            </h3>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            data-testid="button-close-modal">
            <X size={16}/>
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100
                         focus:outline-none focus:border-cyan-500/60 transition-colors"
              placeholder="e.g. Weekly Analytical Banker"
              data-testid="input-name"/>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Description</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100
                         focus:outline-none focus:border-cyan-500/60 transition-colors"
              placeholder="One-line summary"
              data-testid="input-description"/>
          </div>

          {/* Kind */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Kind</label>
            <div className="flex gap-2">
              {(["weekly", "adhoc"] as const).map(k => {
                const meta = KIND_META[k];
                const active = kind === k;
                return (
                  <button key={k} type="button" onClick={() => setKind(k)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors
                      ${active
                        ? "border-cyan-500/60 bg-cyan-500/10 text-slate-100"
                        : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"}`}
                    data-testid={`button-kind-${k}`}>
                    <meta.icon size={14}/> {meta.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {kind === "weekly"
                ? "Fires on a cron schedule. Tick loop runs every minute."
                : "Manual or 'Run now' only — no schedule."}
            </p>
          </div>

          {/* Cron */}
          {kind === "weekly" && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Cron (UK time / Europe London — DST aware)
              </label>
              <input type="text" value={scheduleCron} onChange={e => setScheduleCron(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono
                           focus:outline-none focus:border-cyan-500/60 transition-colors"
                placeholder="0 18 * * 0"
                data-testid="input-cron"/>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CRON_PRESETS.map(p => (
                  <button key={p.value} type="button" onClick={() => setScheduleCron(p.value)}
                    className="px-2 py-1 text-xs rounded-md border border-slate-800 bg-slate-950 text-slate-400
                               hover:border-slate-700 hover:text-slate-200 transition-colors"
                    title={p.hint}
                    data-testid={`button-preset-${p.value}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Prompt — kicks off the manager when fired
            </label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100
                         focus:outline-none focus:border-cyan-500/60 transition-colors font-mono"
              placeholder="e.g. Research what happened in UK SME finance last week and draft a 600-word newsletter…"
              data-testid="input-prompt"/>
          </div>

          {/* Output dir */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Output dir (optional, relative to repo)
            </label>
            <input type="text" value={outputDir} onChange={e => setOutputDir(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono
                         focus:outline-none focus:border-cyan-500/60 transition-colors"
              placeholder="output/newsletters"
              data-testid="input-output-dir"/>
          </div>

          {/* Enabled */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-950/50">
            <div>
              <div className="text-sm text-slate-100 flex items-center gap-2">
                <Power size={14}/> Enabled
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                When off, the scheduler ignores this template even if cron is set.
              </p>
            </div>
            <button type="button" onClick={() => setEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                ${enabled ? "bg-cyan-500" : "bg-slate-700"}`}
              data-testid="toggle-enabled">
              <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform
                ${enabled ? "translate-x-6" : "translate-x-1"}`}/>
            </button>
          </div>

          {err && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0"/>
              <span>{err}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800 bg-slate-900/80">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-800 bg-slate-950 text-slate-300
                       hover:border-slate-700 hover:text-slate-100 transition-colors"
            data-testid="button-cancel">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                       bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="button-save">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
            {isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [editing, setEditing] = useState<ProjectTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const { data: templates = [], isLoading } = useQuery<ProjectTemplate[]>({
    queryKey: ["/api/templates"],
    queryFn: () => apiRequest("GET", "/api/templates").then(r => r.json()),
    refetchInterval: 30000, // keep countdowns fresh-ish; tick loop is server-side
  });

  // Local 1-second clock so the countdowns tick visibly without spamming the API.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const createMutation = useMutation({
    mutationFn: (patch: TemplatePatch) =>
      apiRequest("POST", "/api/templates", patch).then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      setToast({ kind: "ok", msg: "Template created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TemplatePatch }) =>
      apiRequest("PATCH", `/api/templates/${id}`, patch).then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      setToast({ kind: "ok", msg: "Template updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/templates/${id}`).then(r => {
        if (!r.ok && r.status !== 204) throw new Error(r.statusText);
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      setToast({ kind: "ok", msg: "Template deleted" });
    },
  });

  const handleToggle = async (t: ProjectTemplate) => {
    setBusyId(t.id);
    try {
      await updateMutation.mutateAsync({ id: t.id, patch: { enabled: t.enabled !== 1 } });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const handleRunNow = async (t: ProjectTemplate) => {
    setBusyId(t.id);
    try {
      const r = await apiRequest("POST", `/api/templates/${t.id}/run-now`, {});
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      const { projectId } = await r.json();
      setToast({ kind: "ok", msg: `Fired — project #${projectId} created` });
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setBusyId(id);
    try {
      await deleteMutation.mutateAsync(id);
      setDeletingId(null);
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <CalendarClock size={22} className="text-cyan-400"/>
            Templates
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Recurring project blueprints. Cron schedules use UK time and respect BST/GMT.
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg
                     bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium transition-colors"
          data-testid="button-new-template">
          <Plus size={14}/> New template
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
          <Loader2 size={16} className="animate-spin mr-2"/> Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <div className="border border-dashed border-slate-800 rounded-2xl p-12 text-center">
          <CalendarClock size={32} className="mx-auto text-slate-600 mb-3"/>
          <h3 className="text-sm font-semibold text-slate-300">No templates yet</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Create a weekly template to have the manager research and draft on a recurring
            schedule, or an ad-hoc template you can fire manually.
          </p>
          <button onClick={() => setCreating(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                       bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium transition-colors">
            <Plus size={14}/> New template
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => {
            const meta = KIND_META[t.kind] ?? { color: "#64748b", label: t.kind, icon: Repeat };
            const KindIcon = meta.icon;
            const isEnabled = t.enabled === 1;
            const busy = busyId === t.id;
            const cronInvalid = t.scheduleCron && t.cronError;
            return (
              <div key={t.id}
                className="border border-slate-800 rounded-xl bg-slate-900/40 hover:border-slate-700 transition-colors"
                data-testid={`template-row-${t.id}`}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium"
                          style={{ background: `${meta.color}1a`, color: meta.color }}>
                          <KindIcon size={11}/> {meta.label}
                        </span>
                        {isEnabled ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-green-500/10 text-green-400">
                            <CheckCircle2 size={11}/> Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-slate-800 text-slate-400">
                            Paused
                          </span>
                        )}
                        {cronInvalid && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-red-500/10 text-red-400"
                            title={t.cronError ?? ""}>
                            <AlertTriangle size={11}/> Cron error
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-slate-100 truncate">{t.name}</h3>
                      {t.description && (
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{t.description}</p>
                      )}

                      {/* Schedule + countdown row */}
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <Repeat size={11} className="text-slate-500"/>
                          <span className="font-mono text-slate-300">{t.scheduleCron || "—"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <CalendarClock size={11} className="text-slate-500"/>
                          <span>{t.cronDescription ?? "Manual only"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <Clock size={11} className="text-slate-500"/>
                          <span>
                            {isEnabled && t.nextRunAtIso
                              ? <>next in <span className="text-cyan-300 font-medium">{fmtCountdown(t.nextRunAtIso)}</span></>
                              : <>next: —</>}
                          </span>
                        </div>
                      </div>

                      {/* Last run */}
                      <div className="mt-2 text-xs text-slate-500">
                        Last run: {t.lastRunAtIso ? fmtTime(t.lastRunAtIso) : "never"}
                        {t.lastProjectId != null && (
                          <> · last project <span className="font-mono text-slate-400">#{t.lastProjectId}</span></>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => handleRunNow(t)} disabled={busy}
                        title="Run now"
                        className="p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-300
                                   hover:border-cyan-500/60 hover:text-cyan-300 transition-colors
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid={`button-run-now-${t.id}`}>
                        {busy ? <Loader2 size={14} className="animate-spin"/> : <Play size={14}/>}
                      </button>
                      <button onClick={() => handleToggle(t)} disabled={busy}
                        title={isEnabled ? "Pause" : "Enable"}
                        className={`p-2 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                          ${isEnabled
                            ? "border-green-500/30 bg-green-500/10 text-green-400 hover:border-green-500/60"
                            : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"}`}
                        data-testid={`button-toggle-${t.id}`}>
                        <Power size={14}/>
                      </button>
                      <button onClick={() => setEditing(t)} disabled={busy}
                        title="Edit"
                        className="p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-300
                                   hover:border-slate-700 hover:text-slate-100 transition-colors
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid={`button-edit-${t.id}`}>
                        <Edit3 size={14}/>
                      </button>
                      <button onClick={() => setDeletingId(t.id)} disabled={busy}
                        title="Delete"
                        className="p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-400
                                   hover:border-red-500/60 hover:text-red-400 transition-colors
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid={`button-delete-${t.id}`}>
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {creating && (
        <TemplateModal template={null}
          onClose={() => setCreating(false)}
          onSave={async (patch) => { await createMutation.mutateAsync(patch); }}/>
      )}
      {editing && (
        <TemplateModal template={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await updateMutation.mutateAsync({ id: editing.id, patch }); }}/>
      )}

      {/* Delete confirm */}
      {deletingId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
             onClick={() => setDeletingId(null)}>
          <div onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-400"/>
              <h3 className="text-sm font-semibold text-slate-100">Delete template?</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              This stops the schedule and removes the template. Past projects it created stay.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingId(null)}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-800 bg-slate-950 text-slate-300
                           hover:border-slate-700 hover:text-slate-100 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDelete(deletingId)}
                disabled={busyId === deletingId}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                           bg-red-500 hover:bg-red-400 text-slate-950 font-medium
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {busyId === deletingId
                  ? <Loader2 size={14} className="animate-spin"/>
                  : <Trash2 size={14}/>}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg shadow-lg border text-sm
          ${toast.kind === "ok"
            ? "bg-green-500/15 border-green-500/40 text-green-300"
            : "bg-red-500/15 border-red-500/40 text-red-300"}`}
          data-testid="toast">
          <div className="flex items-center gap-2">
            {toast.kind === "ok"
              ? <CheckCircle2 size={14}/>
              : <AlertTriangle size={14}/>}
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}
