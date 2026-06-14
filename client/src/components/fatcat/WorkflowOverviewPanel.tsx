// Stage 6.15.1 — Live Workflow Overview panel.
//
// Replaces the painted "WORKFLOW OVERVIEW" panel in the top-left of the Mission
// Control HUD with a live, data-driven view of the current project's task flow.
//
// Layout (top to bottom, inside the cleared panel interior):
//   1) "Live Task Flow" mini SVG — 5 nodes connected horizontally, one per
//      pipeline phase, lit cyan when that phase has at least one active task.
//   2) 5 phase rows: INTAKE / ANALYZE / VERIFY / SYNTHESIZE / DELIVER with a
//      completion tally driven by tasks per phase.
//   3) Active / Queued counts derived from task status.
//
// Phase classification is heuristic — we look at the task title/description for
// keywords (analyze, verify, synthesize, deliver, intake/plan). This is the
// same shape of mapping the painted panel implied; it's intentionally simple
// and side-effect free.

import { useMemo } from "react";
import type { Task } from "../../types";

/** The 5 phases shown in the live workflow panel. */
export type WorkflowPhase = "intake" | "analyze" | "verify" | "synthesize" | "deliver";

export const WORKFLOW_PHASES: { key: WorkflowPhase; label: string; color: string }[] = [
  { key: "intake",     label: "INTAKE",     color: "#94a3b8" }, // slate
  { key: "analyze",    label: "ANALYZE",    color: "#22d3ee" }, // cyan
  { key: "verify",     label: "VERIFY",     color: "#f59e0b" }, // amber
  { key: "synthesize", label: "SYNTHESIZE", color: "#a78bfa" }, // violet
  { key: "deliver",    label: "DELIVER",    color: "#34d399" }, // emerald
];

/** Pure keyword classifier — exported for unit tests.
 *
 * Order matters: verification tasks frequently DESCRIBE themselves with words
 * like "write tests" (synthesize-flavoured) but they're really QA work, so we
 * check VERIFY before SYNTHESIZE. Likewise, DELIVER is checked last‐among‐late
 * because "publish" / "ship" only fire when the task is genuinely about output.
 */
export function classifyPhase(t: Pick<Task, "title" | "description">): WorkflowPhase {
  const hay = `${t.title ?? ""} ${t.description ?? ""}`.toLowerCase();
  if (/\b(deliver|publish|ship|finalize|export|render)\b/.test(hay)) return "deliver";
  if (/\b(verify|validate|audit|qa|fact[- ]?check|test|review)\b/.test(hay)) return "verify";
  if (/\b(synthesi[sz]e|summari[sz]e|compose|draft|report)\b/.test(hay)) return "synthesize";
  if (/\b(analy[sz]e|research|investigate|gather|extract|model)\b/.test(hay)) return "analyze";
  // Default — anything that doesn't match a later phase is intake / planning.
  return "intake";
}

/** Per-phase counts. Exported for tests. */
export interface PhaseCounts {
  total: number;
  done: number;
  active: number;
}

export function bucketTasks(tasks: Task[]): {
  byPhase: Record<WorkflowPhase, PhaseCounts>;
  totals: { active: number; queued: number; done: number; blocked: number };
} {
  const byPhase: Record<WorkflowPhase, PhaseCounts> = {
    intake:     { total: 0, done: 0, active: 0 },
    analyze:    { total: 0, done: 0, active: 0 },
    verify:     { total: 0, done: 0, active: 0 },
    synthesize: { total: 0, done: 0, active: 0 },
    deliver:    { total: 0, done: 0, active: 0 },
  };
  const totals = { active: 0, queued: 0, done: 0, blocked: 0 };
  for (const t of tasks) {
    const phase = classifyPhase(t);
    byPhase[phase].total += 1;
    if (t.status === "done") {
      byPhase[phase].done += 1;
      totals.done += 1;
    } else if (t.status === "in_progress") {
      byPhase[phase].active += 1;
      totals.active += 1;
    } else if (t.status === "blocked") {
      totals.blocked += 1;
    } else {
      totals.queued += 1;
    }
  }
  return { byPhase, totals };
}

interface Props {
  tasks: Task[];
}

export default function WorkflowOverviewPanel({ tasks }: Props) {
  const { byPhase, totals } = useMemo(() => bucketTasks(tasks), [tasks]);

  return (
    <div
      data-fc-panel="workflow-overview"
      className="w-full h-full flex flex-col"
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        color: "rgba(220, 230, 240, 0.85)",
        padding: "8px 10px",
        // Transparent background — the painted panel border + header label in
        // empty_frame.png are still visible behind us; we render inside the
        // cleared interior only.
        background: "transparent",
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          color: "rgba(125, 211, 252, 0.8)",
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        LIVE TASK FLOW
      </div>

      {/* Mini SVG node graph: 5 nodes left→right, lit when phase has activity. */}
      <LiveFlowGraph byPhase={byPhase} />

      {/* Phase rows — done/total tally + tiny progress bar. */}
      <div className="flex-1 flex flex-col gap-1 mt-2">
        {WORKFLOW_PHASES.map(({ key, label, color }) => {
          const c = byPhase[key];
          const pct = c.total === 0 ? 0 : Math.round((c.done / c.total) * 100);
          const isActive = c.active > 0;
          return (
            <div
              key={key}
              data-fc-phase={key}
              className="flex items-center gap-2"
              style={{ fontSize: 9 }}
            >
              <div
                style={{
                  width: 6, height: 6, borderRadius: 999,
                  background: isActive ? color : `${color}33`,
                  boxShadow: isActive ? `0 0 6px ${color}aa` : "none",
                  flexShrink: 0,
                }}
              />
              <span style={{ width: 64, color: isActive ? color : "rgba(180,195,210,0.6)", fontWeight: 600 }}>
                {label}
              </span>
              <div
                className="flex-1 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.06)", height: 3 }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: color,
                    transition: "width 600ms ease",
                  }}
                />
              </div>
              <span
                className="font-mono tabular-nums"
                style={{ color: "rgba(180,195,210,0.7)", minWidth: 28, textAlign: "right" }}
              >
                {c.done}/{c.total}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer: Active / Queued counts */}
      <div
        className="mt-2 pt-2 flex items-center gap-3"
        style={{
          borderTop: "1px solid rgba(125, 211, 252, 0.15)",
          fontSize: 9,
          color: "rgba(180,195,210,0.75)",
        }}
      >
        <div className="flex items-baseline gap-1">
          <span style={{ color: "#22d3ee", fontWeight: 700, fontSize: 12 }}>{totals.active}</span>
          <span style={{ letterSpacing: "0.08em" }}>ACTIVE</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span style={{ color: "rgba(220,230,240,0.85)", fontWeight: 700, fontSize: 12 }}>{totals.queued}</span>
          <span style={{ letterSpacing: "0.08em" }}>QUEUED</span>
        </div>
        {totals.blocked > 0 && (
          <div className="flex items-baseline gap-1">
            <span style={{ color: "#f87171", fontWeight: 700, fontSize: 12 }}>{totals.blocked}</span>
            <span style={{ letterSpacing: "0.08em" }}>BLOCKED</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LiveFlowGraph: 5-node mini SVG ──────────────────────────────────────────

function LiveFlowGraph({ byPhase }: { byPhase: Record<WorkflowPhase, PhaseCounts> }) {
  // Render 5 nodes evenly spaced inside a 100×24 viewBox, connected by 4 lines.
  const nodes = WORKFLOW_PHASES.map((p, i) => {
    const c = byPhase[p.key];
    const isActive = c.active > 0;
    const isDone = c.total > 0 && c.done === c.total;
    return {
      x: 6 + i * 22,
      cy: 12,
      color: p.color,
      isActive,
      isDone,
    };
  });

  return (
    <svg
      role="img"
      aria-label="Live task flow: 5 pipeline phase nodes"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      style={{ width: "100%", height: 22 }}
    >
      {/* Connecting lines */}
      {nodes.slice(0, -1).map((n, i) => {
        const next = nodes[i + 1];
        const lit = n.isActive || n.isDone || next.isActive;
        return (
          <line
            key={`edge-${i}`}
            x1={n.x + 2} y1={n.cy} x2={next.x - 2} y2={next.cy}
            stroke={lit ? "rgba(125, 211, 252, 0.75)" : "rgba(125, 211, 252, 0.2)"}
            strokeWidth={0.6}
          />
        );
      })}
      {/* Nodes */}
      {nodes.map((n, i) => (
        <g key={`node-${i}`}>
          {n.isActive && (
            <circle cx={n.x} cy={n.cy} r={3.6} fill={`${n.color}33`} />
          )}
          <circle
            cx={n.x}
            cy={n.cy}
            r={2}
            fill={n.isActive || n.isDone ? n.color : "rgba(125,211,252,0.15)"}
            stroke={n.color}
            strokeWidth={n.isActive ? 0.6 : 0.4}
            opacity={n.isActive || n.isDone ? 1 : 0.6}
          />
        </g>
      ))}
    </svg>
  );
}
