// Stage 6.12.2 — FatCat Isometric Office mode (approved asset-backed).
//
// The mode renders the approved FatCat isometric-office artwork as the visual
// canvas. The painted scene already shows the Manager FatCat on the central
// dais with specialist FatCats at their desks; we overlay the *live* app on top
// of it: a mode header, a project/status strip, transparent clickable hotspots
// positioned over each visible FatCat seat (driven by the dynamic roster), a
// left project/evidence panel, a right activity stream, and a selected-agent
// detail panel. Roster roles beyond the painted seats fall into a "bench" list.
//
// No generated emoji/circle avatars are used — the cats come entirely from the
// approved artwork; the roster only drives the labels/status/hotspots over it.

import { useMemo, useState } from "react";
import { Activity, FolderOpen, FileText, Layers, Users } from "lucide-react";
import officeImage from "@assets/fatcat/fatcat_isometric_office.jpg";
import type { Agent, AgentEvent, Project } from "../../types";
import {
  buildRoster, classifyWorkflow, workflowLabel,
  FATCAT_STATUS_META, type RosterSlot,
} from "../../lib/fatcatRoster";
import {
  FatCatStyles, StatusPill, AgentDetailPanel, useReducedMotion,
} from "./shared";

interface Props {
  agents: Agent[];
  project: Project | null;
  events: AgentEvent[];
}

// Hotspot seats expressed as a percentage of the artwork box. Each entry maps a
// painted FatCat in the approved image to a clickable overlay. Ordered so the
// roster's specialists (after the manager) land on sensible seats. Tuned to the
// approved isometric-office artwork.
const SEATS: { x: number; y: number; w: number; h: number }[] = [
  { x: 27.5, y: 33, w: 13, h: 26 }, // research (upper-left desk)
  { x: 70.5, y: 33, w: 13, h: 28 }, // qa (upper-right, clipboard cat)
  { x: 84,   y: 50, w: 13, h: 30 }, // engineering (far-right, headphones cat)
  { x: 66,   y: 64, w: 13, h: 30 }, // data (centre-right, tablet cat)
  { x: 38,   y: 64, w: 13, h: 30 }, // investment (centre-left, document cat)
  { x: 15,   y: 56, w: 13, h: 30 }, // writing (lower-left, writing cat)
];
// The manager seat (central dais) sits roughly here in the artwork.
const MANAGER_SEAT = { x: 50, y: 26, w: 18, h: 34 };

export default function IsometricOfficeMode({ agents, project, events }: Props) {
  const reduced = useReducedMotion();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const roster = useMemo(() => buildRoster({ project, agents }), [project, agents]);
  const workflow = useMemo(
    () => classifyWorkflow({ name: project?.name, description: project?.description }),
    [project],
  );

  const manager = roster.find((r) => r.archetype === "manager") ?? roster[0];
  const specialists = roster.filter((r) => r !== manager);
  const seated = specialists.slice(0, SEATS.length);
  const bench = specialists.slice(SEATS.length);
  const selected = roster.find((r) => r.key === selectedKey) ?? null;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden" style={{ background: "#060b16" }}>
      <FatCatStyles />

      {/* Header band */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 flex-shrink-0" style={{ background: "rgba(8,12,24,0.6)" }}>
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

      {/* 3-column body: left panel | canvas | right panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: project / evidence panel */}
        <aside className="hidden lg:flex flex-col w-60 border-r border-slate-800/80 p-3 gap-3 overflow-y-auto custom-scroll" style={{ background: "rgba(8,12,24,0.45)" }}>
          <ProjectCard project={project} workflowName={workflowLabel(workflow)} />
          <EvidencePanel project={project} roster={roster} />
          {bench.length > 0 && <BenchPanel bench={bench} onSelect={setSelectedKey} />}
        </aside>

        {/* Centre: approved image canvas with overlaid hotspots */}
        <main className="flex-1 relative overflow-auto custom-scroll" style={{ background: "#060b16" }}>
          {/* Scene wrapper keeps the image aspect ratio so hotspots stay aligned.
              On narrow screens it can scroll; min-width prevents horrible crop. */}
          <div
            className="relative mx-auto"
            style={{
              width: "100%",
              minWidth: 640,
              maxWidth: 1280,
              aspectRatio: "1152 / 769",
            }}
          >
            <img
              src={officeImage}
              alt="FatCat isometric office: the Manager FatCat on a central dais with specialist FatCats at desks around an open-plan office."
              className="absolute inset-0 w-full h-full object-cover select-none"
              draggable={false}
            />

            {/* Manager hotspot */}
            <Hotspot
              slot={manager}
              seat={MANAGER_SEAT}
              manager
              selected={selectedKey === manager.key}
              onSelect={() => setSelectedKey(manager.key)}
              reduced={reduced}
            />

            {/* Specialist hotspots over painted seats */}
            {seated.map((slot, i) => (
              <Hotspot
                key={slot.key}
                slot={slot}
                seat={SEATS[i]}
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

// ─── Hotspot: transparent click target + status outline over a painted cat ────
function Hotspot({
  slot, seat, manager, selected, onSelect, reduced,
}: {
  slot: RosterSlot;
  seat: { x: number; y: number; w: number; h: number };
  manager?: boolean;
  selected: boolean;
  onSelect: () => void;
  reduced: boolean;
}) {
  const statusColor = FATCAT_STATUS_META[slot.status].color;
  const active = slot.status === "working" || slot.status === "verifying";
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${slot.name}, ${slot.roleLabel}, ${FATCAT_STATUS_META[slot.status].label}`}
      className="group absolute focus:outline-none"
      style={{
        left: `${seat.x}%`,
        top: `${seat.y}%`,
        width: `${seat.w}%`,
        height: `${seat.h}%`,
        transform: "translate(-50%,-50%)",
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        zIndex: manager ? 20 : 10,
      }}
    >
      {/* Status glow outline over the painted cat. Subtle by default, brighter
          when active or selected, so we enhance rather than cover the artwork. */}
      <span
        aria-hidden
        className={!reduced && active ? "fc-motion" : undefined}
        style={{
          position: "absolute",
          inset: "6%",
          borderRadius: "16px",
          border: `2px solid ${statusColor}`,
          boxShadow: selected
            ? `0 0 22px ${statusColor}cc, 0 0 0 2px ${statusColor}`
            : active
              ? `0 0 16px ${statusColor}88`
              : "none",
          opacity: selected ? 1 : active ? 0.85 : 0,
          transition: "opacity 160ms ease",
          animation: !reduced && active && !selected ? "fcPulse 2.4s ease-in-out infinite" : undefined,
        }}
      />
      {/* Group-hover ring so idle seats still reveal they are interactive. */}
      <span
        aria-hidden
        className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{
          position: "absolute",
          inset: "6%",
          borderRadius: "16px",
          border: `1.5px dashed ${slot.color}aa`,
          transition: "opacity 160ms ease",
        }}
      />
      {/* Name plate anchored under the seat. */}
      <span
        className="opacity-90 group-hover:opacity-100"
        style={{
          position: "absolute",
          left: "50%",
          bottom: -6,
          transform: "translateX(-50%)",
          padding: "3px 9px",
          borderRadius: 10,
          background: "rgba(6,10,20,0.92)",
          border: `1.5px solid ${selected ? slot.color : slot.color + "66"}`,
          boxShadow: selected ? `0 0 14px ${slot.color}66` : "0 2px 8px rgba(0,0,0,0.6)",
          whiteSpace: "nowrap",
          maxWidth: 170,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
          {slot.name}
        </span>
        <span style={{ fontSize: 9, color: "#94a3b8" }}>{slot.roleLabel}</span>
      </span>
    </button>
  );
}

// ─── Bench panel (roster roles beyond the painted seats) ──────────────────────
function BenchPanel({ bench, onSelect }: { bench: RosterSlot[]; onSelect: (k: string) => void }) {
  return (
    <div className="rounded-xl border border-slate-800 p-3" style={{ background: "rgba(13,20,33,0.8)" }}>
      <div className="flex items-center gap-2 mb-2">
        <Users size={13} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Bench</span>
      </div>
      <div className="space-y-1.5">
        {bench.map((slot) => (
          <button
            key={slot.key}
            onClick={() => onSelect(slot.key)}
            aria-label={`${slot.name}, ${slot.roleLabel}, ${FATCAT_STATUS_META[slot.status].label}`}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left focus:outline-none focus:ring-1"
            style={{ background: "rgba(8,12,24,0.7)", border: `1px solid ${slot.color}33` }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: FATCAT_STATUS_META[slot.status].color, flexShrink: 0 }} />
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-semibold text-slate-200 truncate">{slot.name}</span>
              <span className="block text-slate-500" style={{ fontSize: 9 }}>{slot.roleLabel}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
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
    <div className="flex items-center gap-1.5 px-3 border-t border-slate-800/80 overflow-x-auto flex-shrink-0" style={{ height: 44, background: "rgba(8,12,24,0.7)" }}>
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
