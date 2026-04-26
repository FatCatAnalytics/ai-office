import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  FolderOpen, Download, Trash2, FileText, FileCode2, Database,
  Sheet, File, RefreshCw, Clock, User, Search, ChevronDown,
} from "lucide-react";
import type { Project, ProjectFile } from "../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtSize(bytes: number) {
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const FILE_TYPE_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  pdf:      { icon: FileText,  color: "#ef4444", label: "PDF" },
  csv:      { icon: Database,  color: "#10b981", label: "CSV" },
  excel:    { icon: Sheet,     color: "#22c55e", label: "Excel" },
  python:   { icon: FileCode2, color: "#f59e0b", label: "Python" },
  json:     { icon: FileCode2, color: "#06b6d4", label: "JSON" },
  markdown: { icon: FileText,  color: "#8b5cf6", label: "Markdown" },
  code:     { icon: FileCode2, color: "#64748b", label: "Code" },
};

function FileTypeBadge({ fileType }: { fileType: string }) {
  const meta = FILE_TYPE_META[fileType] ?? { icon: File, color: "#64748b", label: fileType.toUpperCase() };
  const Icon = meta.icon;
  return (
    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}44` }}>
      <Icon size={10} />
      {meta.label}
    </span>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({ file, onDelete }: { file: ProjectFile; onDelete: (id: number) => void }) {
  const downloadUrl = `/api/files/${file.id}/download`;

  return (
    <tr className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/20 transition-colors group"
      data-testid={`file-row-${file.id}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <FileTypeBadge fileType={file.fileType} />
          <div>
            <div className="text-sm font-mono text-slate-200">{file.filename}</div>
            {file.description && (
              <div className="text-xs text-slate-500 mt-0.5">{file.description}</div>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-slate-400 font-mono">{fmtSize(file.sizeBytes)}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <User size={10} />
          {file.agentId}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <Clock size={10} />
          {fmtTime(file.createdAt)}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <a
            href={downloadUrl}
            download={file.filename}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: "#06b6d418", color: "#06b6d4", border: "1px solid #06b6d433" }}
            data-testid={`download-${file.id}`}>
            <Download size={11} />
            Download
          </a>
          <button
            onClick={() => onDelete(file.id)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 transition-colors border border-transparent hover:border-rose-500/30"
            data-testid={`delete-${file.id}`}>
            <Trash2 size={11} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FilesPage({ projects }: { projects: Project[] }) {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    projects.length > 0 ? projects[0].id : null
  );
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  // Auto-select first project when list loads
  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const { data: files = [], refetch } = useQuery<ProjectFile[]>({
    queryKey: ["/api/projects", selectedProjectId, "files"],
    queryFn: () =>
      selectedProjectId
        ? apiRequest("GET", `/api/projects/${selectedProjectId}/files`).then(r => r.json())
        : Promise.resolve([]),
    enabled: selectedProjectId !== null,
    refetchInterval: 8000,
  });

  // Listen for real-time file_created WS events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === selectedProjectId) {
        queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "files"] });
      }
    };
    window.addEventListener("aioffice:file_created", handler);
    return () => window.removeEventListener("aioffice:file_created", handler);
  }, [selectedProjectId]);

  const deleteMut = useMutation({
    mutationFn: (fileId: number) =>
      apiRequest("DELETE", `/api/files/${fileId}`).then(r => r.json()),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "files"] }),
  });

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const filteredFiles = files.filter(f => {
    const matchSearch = search.trim() === "" ||
      f.filename.toLowerCase().includes(search.toLowerCase()) ||
      f.description.toLowerCase().includes(search.toLowerCase()) ||
      f.agentId.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || f.fileType === typeFilter;
    return matchSearch && matchType;
  });

  const fileTypes = [...new Set(files.map(f => f.fileType))];

  const totalSize = filteredFiles.reduce((s, f) => s + f.sizeBytes, 0);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <FolderOpen size={15} className="text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">Project Files</span>
          {files.length > 0 && (
            <span className="text-xs text-slate-500">{files.length} file{files.length !== 1 ? "s" : ""} · {fmtSize(totalSize)}</span>
          )}
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          data-testid="button-refresh-files">
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>

      {/* Project selector */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 flex-shrink-0 bg-slate-900/40">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-shrink-0">
          <FolderOpen size={11} />
          Project:
        </div>
        <div className="relative flex-1 max-w-xs">
          <select
            value={selectedProjectId ?? ""}
            onChange={e => setSelectedProjectId(Number(e.target.value))}
            className="w-full appearance-none bg-slate-800 border border-slate-700 rounded-lg pl-3 pr-8 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer"
            data-testid="select-project">
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
            data-testid="input-file-search"
          />
        </div>

        {/* Type filter */}
        {fileTypes.length > 1 && (
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer"
            data-testid="select-type-filter">
            <option value="all">All types</option>
            {fileTypes.map(t => (
              <option key={t} value={t}>{t.toUpperCase()}</option>
            ))}
          </select>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto custom-scroll">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <FolderOpen size={32} className="opacity-30" />
            <div className="text-sm text-slate-500">No projects yet</div>
            <div className="text-xs text-slate-600">Create a project to start generating files</div>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <FolderOpen size={28} className="text-slate-700" />
            <div className="text-center">
              <div className="text-sm text-slate-400 font-medium mb-1">
                {files.length === 0 ? "No files yet for this project" : "No files match your filter"}
              </div>
              <div className="text-xs text-slate-600">
                {files.length === 0
                  ? "Files are generated automatically as agents complete tasks.\nMake sure to select output formats when creating the project."
                  : "Try clearing the search or changing the type filter."}
              </div>
            </div>
          </div>
        ) : (
          <table className="w-full text-xs" data-testid="files-table">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-800 bg-slate-900/95 backdrop-blur">
                <th className="text-left px-4 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">File</th>
                <th className="text-left px-3 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Size</th>
                <th className="text-left px-3 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Agent</th>
                <th className="text-left px-3 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Created</th>
                <th className="text-left px-4 py-2.5 text-slate-400 font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map(file => (
                <FileRow key={file.id} file={file} onDelete={id => deleteMut.mutate(id)} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer summary */}
      {filteredFiles.length > 0 && (
        <div className="flex items-center justify-between px-5 py-2 border-t border-slate-800 bg-slate-900/40 flex-shrink-0">
          <div className="flex items-center gap-4 text-xs text-slate-500">
            {Object.entries(
              filteredFiles.reduce<Record<string, number>>((acc, f) => {
                acc[f.fileType] = (acc[f.fileType] ?? 0) + 1;
                return acc;
              }, {})
            ).map(([type, count]) => (
              <span key={type}>
                <span className="font-semibold text-slate-400">{count}</span> {type.toUpperCase()}
              </span>
            ))}
          </div>
          <div className="text-xs text-slate-500">
            Total: <span className="font-mono text-slate-400">{fmtSize(totalSize)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
