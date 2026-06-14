// Stage 6.15.1 — Live Task Stream panel.
//
// Replaces the painted "CURRENT TASK STREAM" panel in the bottom-center of the
// Mission Control HUD with a live, data-driven feed of the 5 most-recently
// updated tasks. Each row shows:
//   • Verb chip (ANALYZE / VERIFY / SYNTHESIZE / DELIVER / INTAKE / QUEUED)
//   • Task title (truncated)
//   • Assigned agent name (looked up from agents[])
//   • Progress bar (% complete; "done" = 100%, "in_progress" = 50%, etc.)
//   • Relative time ("Xm ago", "Xh ago")
//
// We compute everything from the same `tasks: Task[]` + `agents: Agent[]`
// arrays already flowing through OfficeDashboard. No new server endpoints are
// needed — the WebSocket task_update broadcasts already keep `tasks` fresh.

import { useMemo } from "react";
import type { Agent, Task } from "../../types";
import { classifyPhase, type WorkflowPhase, WORKFLOW_PHASES } from "./WorkflowOverviewPanel";

/** Pure helper: relative time from a unix-ms timestamp to "now" (ms). */
export function formatRelative(updatedAtMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - updatedAtMs);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Pure helper: map task status -> percent shown in the row. */
export function statusToPercent(status: Task["status"]): number {
  if (status === "done") return 100;
  if (status === "in_progress") return 60;
  if (status === "blocked") return 30;
  return 0; // todo
}

/** Pure helper: pick + format the 5 most-recently updated tasks. */
export interface StreamRow {
  id: number;
  title: string;
  phase: WorkflowPhase;
  status: Task["status"];
  percent: number;
  agentId: string;
  updatedAt: number;
}

export function buildStream(tasks: Task[], limit = 5): StreamRow[] {
  const sorted = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  return sorted.map((t) => ({
    id: t.id,
    title: t.title,
    phase: classifyPhase(t),
    status: t.status,
    percent: statusToPercent(t.status),
    agentId: t.assignedTo,
    updatedAt: t.updatedAt,
  }));
}

interface Props {
  tasks: Task[];
  agents: Agent[];
  /** Override "now" for tests — falls back to Date.now() at render time. */
  nowMs?: number;
}

export default function TaskStreamPanel({ tasks, agents, nowMs }: Props) {
  const now = nowMs ?? Date.now();
  const rows = useMemo(() => buildStream(tasks, 5), [tasks]);
  const agentName = (id: string) =>
    agents.find((a) => a.id === id)?.name ?? id.toUpperCase();

  return (
    <div
      data-fc-panel="task-stream"
      className="w-full h-full flex flex-col"
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        color: "rgba(220, 230, 240, 0.85)",
        padding: "8px 14px",
        background: "transparent",
      }}
    >
      {rows.length === 0 && (
        <div
          className="flex-1 flex items-center justify-center"
          style={{ fontSize: 10, color: "rgba(180,195,210,0.5)", letterSpacing: "0.08em" }}
        >
          NO ACTIVE TASKS
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const meta = WORKFLOW_PHASES.find((p) => p.key === r.phase)!;
          const verb = r.status === "todo" ? "QUEUED" : meta.label;
          const isQueued = r.status === "todo";
          return (
            <div
              key={r.id}
              data-fc-task-row={r.id}
              className="flex items-center gap-2"
              style={{ fontSize: 10 }}
            >
              {/* Title */}
              <div
                className="truncate"
                style={{
                  flex: "0 0 36%",
                  color: "rgba(225,235,245,0.9)",
                  fontWeight: 500,
                }}
                title={r.title}
              >
                {r.title}
              </div>

              {/* Verb chip */}
              <div
                style={{
                  flex: "0 0 76px",
                  textAlign: "center",
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: isQueued ? "rgba(255,255,255,0.05)" : `${meta.color}22`,
                  border: `1px solid ${isQueued ? "rgba(255,255,255,0.15)" : `${meta.color}55`}`,
                  color: isQueued ? "rgba(180,195,210,0.7)" : meta.color,
                  fontWeight: 700,
                  fontSize: 8.5,
                  letterSpacing: "0.08em",
                }}
              >
                {verb}
              </div>

              {/* Agent name */}
              <div
                className="truncate font-mono"
                style={{
                  flex: "0 0 22%",
                  color: "rgba(180,195,210,0.75)",
                  fontSize: 9,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
                title={agentName(r.agentId)}
              >
                {agentName(r.agentId)}
              </div>

              {/* Progress bar */}
              <div
                className="flex-1 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.06)", height: 4 }}
              >
                <div
                  style={{
                    width: `${r.percent}%`,
                    height: "100%",
                    background: r.status === "blocked" ? "#f87171" : meta.color,
                    transition: "width 600ms ease",
                  }}
                />
              </div>

              {/* Percent */}
              <div
                className="font-mono tabular-nums"
                style={{
                  flex: "0 0 32px",
                  textAlign: "right",
                  color: "rgba(180,195,210,0.8)",
                  fontSize: 9,
                }}
              >
                {r.percent === 0 ? "--" : `${r.percent}%`}
              </div>

              {/* Relative time */}
              <div
                className="font-mono"
                style={{
                  flex: "0 0 44px",
                  textAlign: "right",
                  color: "rgba(180,195,210,0.55)",
                  fontSize: 9,
                }}
              >
                {formatRelative(r.updatedAt, now)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
