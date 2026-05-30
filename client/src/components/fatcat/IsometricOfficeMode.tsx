// Stage 6.12 — FatCat Isometric Office mode.
//
// Playful-premium 2.5D office board. The manager FatCat sits centrally on a
// raised dais; specialist FatCats sit at desks arranged around it on an
// isometric floor. Glowing connection lines link the manager to any active
// specialist. A left panel summarises the project/evidence; a right panel shows
// the live task/activity stream; a bottom rail shows the workflow pipeline.
//
// Desks are positioned with CSS transforms (translate + a light isometric skew)
// rather than a true SVG projection — this keeps the FatCat SVG avatars crisp,
// the layout responsive, and click/keyboard targets simple. On narrow screens
// the floor collapses to a stacked roster list.

import { useMemo, useState } from "react";
import { Activity, FolderOpen, FileText, Layers } from "lucide-react";
import type { Agent, AgentEvent, Project } from "../../types";
import {
  buildRoster, classifyWorkflow, workflowLabel,
  FATCAT_STATUS_META, type RosterSlot,
} from "../../lib/fatcatRoster";
import FatCatAvatar from "./FatCatAvatar";
import {
  FatCatStyles, StatusPill, AgentDetailPanel, useReducedMotion,
} from "./shared";

interface Props {
  agents: Agent[];
  project: Project | null;
  events: AgentEvent[];
}

// Isometric desk positions (percentage of the floor box) for up to 8 specialists,
// arranged in a diamond around the central manager dais.
const DESK_LAYOUT: { x: number; y: number }[] = [
  { x: 50, y: 14 },
  { x: 78, y: 30 },
  { x: 86, y: 58 },
  { x: 68, y: 80 },
  { x: 32, y: 80 },
  { x: 14, y: 58 },
  { x: 22, y: 30 },
  { x: 50, y: 92 },
];

export default function IsometricOfficeMode({ agents, project, events }: Props) {
  const reduced = useReducedMotion();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const roster = useMemo(() => buildRoster({ project, agents }), [project, agents]);
  const workflow = useMemo(
    () => classifyWorkflow({ name: project?.name, description: project?.description }),
    [project],
  );

  const manager = roster.find((r) => r.archetype === "manager") ?? roster[0];
  const specialists = roster.filter((r) => r !== manager).slice(0, DESK_LAYOUT.length);
  const selected = roster.find((r) => r.key === selectedKey) ?? null;

  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: "radial-gradient(circle at 50% 30%, #11182e 0%, #060b16 70%)" }}>
      <FatCatStyles />

      {/* Header band */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80" style={{ background: "rgba(8,12,24,0.6)" }}>
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-violet-400" />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">FatCat Isometric Office</span>
          <span className="text-xs text-slate-500 ml-2 px-2 py-0.5 rounded-full border border-slate-700">
            {workflowLabel(workflow)}
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-xs">
          {Object.entries(FATCAT_STATUS_META).map(([k, m]) => (
            <span key={k} className="flex items-center gap-1.5 text-slate-500">
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: m.color }} />
              {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* 3-column body: left panel | floor | right panel */}
      <div className="flex h-[calc(100%-86px)]">
        {/* Left: project / evidence panel */}
        <aside className="hidden lg:flex flex-col w-60 border-r border-slate-800/80 p-3 gap-3 overflow-y-auto custom-scroll" style={{ background: "rgba(8,12,24,0.45)" }}>
          <ProjectCard project={project} workflowName={workflowLabel(workflow)} />
          <EvidencePanel project={project} roster={roster} />
        </aside>

        {/* Centre: isometric floor (desktop/tablet) + stacked roster (mobile) */}
        <main className="flex-1 relative overflow-hidden">
          {/* Mobile fallback: stacked roster list */}
          <div className="md:hidden h-full overflow-y-auto custom-scroll p-3 space-y-2">
            {roster.map((slot) => (
              <RosterRow key={slot.key} slot={slot} onSelect={() => setSelectedKey(slot.key)} reduced={reduced} />
            ))}
          </div>

          {/* Desktop/tablet: isometric board */}
          <div className="hidden md:block h-full relative" style={{ perspective: 1200 }}>
            <IsoFloor reduced={reduced} />

            {/* Connection lines from manager to active specialists */}
            <ConnectionLines manager={manager} specialists={specialists} reduced={reduced} />

            {/* Manager dais (centre) */}
            <DeskNode
              slot={manager}
              x={50} y={48}
              manager
              selected={selectedKey === manager.key}
              onSelect={() => setSelectedKey(manager.key)}
              reduced={reduced}
            />

            {/* Specialist desks */}
            {specialists.map((slot, i) => (
              <DeskNode
                key={slot.key}
                slot={slot}
                x={DESK_LAYOUT[i].x}
                y={DESK_LAYOUT[i].y}
                selected={selectedKey === slot.key}
                onSelect={() => setSelectedKey(slot.key)}
                reduced={reduced}
              />
            ))}
          </div>

          {/* Selected detail — floating */}
          {selected && (
            <div className="absolute top-3 right-3 z-30">
              <AgentDetailPanel slot={selected} events={events} onClose={() => setSelectedKey(null)} />
            </div>
          )}
        </main>

        {/* Right: live activity stream */}
        <aside className="hidden xl:flex flex-col w-64 border-l border-slate-800/80 overflow-hidden" style={{ background: "rgba(8,12,24,0.45)" }}>
          <ActivityPanel events={events} />
        </aside>
      </div>

      {/* Bottom: workflow pipeline rail */}
      <PipelineRail roster={roster} onSelect={setSelectedKey} />
    </div>
  );
}

// ─── Isometric floor backdrop ────────────────────────────────────────────────
function IsoFloor({ reduced }: { reduced: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: "50%", top: "52%",
        width: "78%", height: "70%",
        transform: "translate(-50%,-50%) rotateX(58deg) rotateZ(45deg)",
        transformStyle: "preserve-3d",
        background:
          "repeating-linear-gradient(0deg, rgba(99,102,241,0.10) 0 1px, transparent 1px 56px)," +
          "repeating-linear-gradient(90deg, rgba(99,102,241,0.10) 0 1px, transparent 1px 56px)",
        borderRadius: 18,
        boxShadow: "0 0 120px rgba(99,102,241,0.18) inset, 0 30px 80px rgba(0,0,0,0.5)",
        border: "1px solid rgba(99,102,241,0.18)",
      }}
    >
      {/* central glow under manager dais */}
      <div
        className={reduced ? undefined : "fc-motion"}
        style={{
          position: "absolute", left: "50%", top: "50%", width: 180, height: 180,
          transform: "translate(-50%,-50%)",
          background: "radial-gradient(circle, rgba(168,85,247,0.35) 0%, transparent 70%)",
          borderRadius: "50%",
          animation: reduced ? undefined : "fcScan 4s ease-in-out infinite",
        }}
      />
    </div>
  );
}

// ─── A desk node = a FatCat avatar + name plate ──────────────────────────────
function DeskNode({
  slot, x, y, manager, selected, onSelect, reduced,
}: {
  slot: RosterSlot; x: number; y: number; manager?: boolean;
  selected: boolean; onSelect: () => void; reduced: boolean;
}) {
  const size = manager ? 96 : 66;
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${slot.name}, ${slot.roleLabel}, ${FATCAT_STATUS_META[slot.status].label}`}
      className="group focus:outline-none"
      style={{
        position: "absolute",
        left: `${x}%`, top: `${y}%`,
        transform: "translate(-50%,-50%)",
        zIndex: manager ? 20 : 10 + Math.round(y),
        cursor: "pointer",
        background: "none", border: "none", padding: 0,
      }}
    >
      {/* desk pad */}
      <div
        style={{
          position: "absolute", left: "50%", bottom: -10,
          width: size * 1.25, height: size * 0.34,
          transform: "translateX(-50%) rotateX(60deg)",
          background: `radial-gradient(ellipse, ${slot.color}33 0%, transparent 72%)`,
          borderRadius: "50%",
        }}
      />
      <div
        className={!reduced && (slot.status === "working" || slot.status === "verifying") ? "fc-motion" : undefined}
        style={{ animation: !reduced && (slot.status === "working") ? "fcFloat 3s ease-in-out infinite" : undefined }}
      >
        <FatCatAvatar
          archetype={slot.archetype} color={slot.color} status={slot.status}
          size={size} manager={manager} reducedMotion={reduced}
        />
      </div>
      {/* name plate */}
      <div
        style={{
          marginTop: 6,
          padding: "3px 9px",
          borderRadius: 10,
          background: "rgba(6,10,20,0.92)",
          border: `1.5px solid ${selected ? slot.color : slot.color + "66"}`,
          boxShadow: selected ? `0 0 14px ${slot.color}66` : "0 2px 8px rgba(0,0,0,0.6)",
          whiteSpace: "nowrap",
          maxWidth: 150,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis" }}>
          {slot.name}
        </div>
        <div style={{ fontSize: 9, color: "#94a3b8" }}>{slot.roleLabel}</div>
      </div>
    </button>
  );
}

// ─── Glowing connection lines from manager → active specialists ──────────────
function ConnectionLines({
  manager, specialists, reduced,
}: { manager: RosterSlot; specialists: RosterSlot[]; reduced: boolean }) {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 5 }} preserveAspectRatio="none" viewBox="0 0 100 100">
      {specialists.map((slot, i) => {
        if (slot.status === "idle") return null;
        const target = DESK_LAYOUT[i];
        const midX = (50 + target.x) / 2;
        const midY = (48 + target.y) / 2 - 6;
        return (
          <path
            key={slot.key}
            d={`M 50 48 Q ${midX} ${midY} ${target.x} ${target.y}`}
            fill="none"
            stroke={slot.color}
            strokeWidth="0.5"
            strokeDasharray="2 1.5"
            opacity={0.65}
            className={reduced ? undefined : "fc-motion"}
            style={{ animation: reduced ? undefined : "fcDash 1.6s linear infinite" }}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

// ─── Roster row (mobile fallback) ────────────────────────────────────────────
function RosterRow({ slot, onSelect, reduced }: { slot: RosterSlot; onSelect: () => void; reduced: boolean }) {
  return (
    <button
      onClick={onSelect}
      aria-label={`${slot.name}, ${slot.roleLabel}, ${FATCAT_STATUS_META[slot.status].label}`}
      className="w-full flex items-center gap-3 p-2.5 rounded-xl border text-left"
      style={{ background: "rgba(8,12,24,0.7)", borderColor: slot.color + "44" }}
    >
      <FatCatAvatar archetype={slot.archetype} color={slot.color} status={slot.status} size={44} manager={slot.archetype === "manager"} reducedMotion={reduced} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-100 truncate">{slot.name}</div>
        <div className="text-xs text-slate-500">{slot.roleLabel}</div>
      </div>
      <StatusPill status={slot.status} small />
    </button>
  );
}

// ─── Left panels ─────────────────────────────────────────────────────────────
function ProjectCard({ project, workflowName }: { project: Project | null; workflowName: string }) {
  return (
    <div className="rounded-xl border border-slate-800 p-3" style={{ background: "rgba(13,20,33,0.8)" }}>
      <div className="flex items-center gap-2 mb-2">
        <FolderOpen size={13} className="text-cyan-400" />
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Project</span>
      </div>
      {project ? (
        <>
          <div className="text-sm font-semibold text-slate-100 leading-tight">{project.name}</div>
          <div className="text-xs text-slate-500 mt-0.5">{workflowName}</div>
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${project.progress}%`, background: "linear-gradient(90deg,#06b6d4,#8b5cf6)" }} />
            </div>
            <span className="text-xs font-mono text-cyan-400 font-bold">{project.progress}%</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-center">
            <Stat label="Tasks" value={`${project.tasksCompleted}/${project.tasksTotal}`} />
            <Stat label="Status" value={project.status} />
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-600 italic">No active project. Submit one to staff the office.</div>
      )}
    </div>
  );
}

function EvidencePanel({ project, roster }: { project: Project | null; roster: RosterSlot[] }) {
  const verifying = roster.filter((r) => r.status === "verifying");
  const blocked = roster.filter((r) => r.status === "blocked");
  return (
    <div className="rounded-xl border border-slate-800 p-3" style={{ background: "rgba(13,20,33,0.8)" }}>
      <div className="flex items-center gap-2 mb-2">
        <FileText size={13} className="text-amber-400" />
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Evidence & Checks</span>
      </div>
      <div className="space-y-1.5 text-xs">
        <LineItem ok={blocked.length === 0} label={blocked.length ? `${blocked.length} blocked role(s)` : "No blockers"} />
        <LineItem ok={verifying.length > 0} label={verifying.length ? `${verifying.length} verification pass(es) running` : "No active verification"} neutral={verifying.length === 0} />
        <LineItem ok={!!project && project.progress >= 100} label={project && project.progress >= 100 ? "Workflow complete" : "Workflow in progress"} neutral />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/40 py-1.5">
      <div className="text-xs font-semibold text-slate-200 capitalize">{value}</div>
      <div className="text-slate-500" style={{ fontSize: 9 }}>{label}</div>
    </div>
  );
}

function LineItem({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
  const color = neutral ? "#64748b" : ok ? "#10b981" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span className="text-slate-400">{label}</span>
    </div>
  );
}

// ─── Right activity panel ────────────────────────────────────────────────────
function ActivityPanel({ events }: { events: AgentEvent[] }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800">
        <Activity size={13} className="text-cyan-400" />
        <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Task Activity</span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll p-2 space-y-1.5">
        {events.length === 0 && <div className="text-xs text-slate-600 italic px-1">No activity yet.</div>}
        {events.slice(0, 40).map((ev, i) => (
          <div key={ev.id ?? i} className="rounded-lg px-2 py-1.5" style={{ background: "rgba(13,20,33,0.7)" }}>
            <div className="text-xs leading-snug">
              <span className="font-semibold text-slate-200">{ev.agentName}</span>{" "}
              <span className="text-slate-400">{ev.action}</span>
            </div>
            <div className="text-slate-500 truncate" style={{ fontSize: 10 }}>{ev.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Bottom pipeline rail ────────────────────────────────────────────────────
function PipelineRail({ roster, onSelect }: { roster: RosterSlot[]; onSelect: (k: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 px-3 border-t border-slate-800/80 overflow-x-auto" style={{ height: 44, background: "rgba(8,12,24,0.7)" }}>
      <span className="text-xs text-slate-500 uppercase tracking-wider whitespace-nowrap mr-2">Pipeline</span>
      {roster.map((slot, i) => (
        <div key={slot.key} className="flex items-center gap-1.5 flex-shrink-0">
          {i > 0 && <div className="w-4 h-px bg-slate-700" />}
          <button
            onClick={() => onSelect(slot.key)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md focus:outline-none focus:ring-1"
            style={{ background: `${slot.color}14`, border: `1px solid ${slot.color}44` }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: FATCAT_STATUS_META[slot.status].color }} />
            <span className="text-slate-300 whitespace-nowrap" style={{ fontSize: 10 }}>{slot.roleLabel}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
