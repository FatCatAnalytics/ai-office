// Stage 6.12.2 — FatCat Mission Control mode (approved asset-backed).
//
// The mode renders the approved FatCat "Mission Control" HUD artwork as the
// visual canvas. The painted scene shows the central FatCat Manager flanked by
// the AI committee of specialist FatCats inside a command-center HUD. We overlay
// the live app on top: a command header, transparent clickable hotspots over
// each painted committee FatCat (driven by the dynamic roster), a live task
// stream, a selected-agent detail panel, and a bottom health strip. Roster
// roles beyond the painted committee seats fall into a "bench" list.
//
// No generated emoji/circle avatars are used — the cats come entirely from the
// approved artwork; the roster only drives labels/status/hotspots over it.

import { useMemo, useState } from "react";
import {
  Radar, Terminal, ShieldCheck, DollarSign, Zap, Activity, Gauge, Users,
} from "lucide-react";
import missionImage from "@assets/fatcat/fatcat_mission_control.jpg";
import type { Agent, AgentEvent, Project } from "../../types";
import {
  buildRoster, classifyWorkflow, workflowLabel,
  FATCAT_STATUS_META, isActiveStatus, type RosterSlot,
} from "../../lib/fatcatRoster";
import {
  FatCatStyles, StatusPill, AgentDetailPanel, useReducedMotion,
} from "./shared";

interface Props {
  agents: Agent[];
  project: Project | null;
  events: AgentEvent[];
}

// Hotspot seats as a percentage of the artwork box, calibrated to the painted
// committee FatCat *portraits* in the approved Mission Control artwork. The art
// already paints a portrait card per specialist; these hit zones are sized to
// hug just the cat's head/shoulders inside each card, not the whole card, so a
// revealed ring sits tight on the character rather than boxing the panel. Left
// column then right column, top-to-bottom — the order specialists are assigned.
const SEATS: { x: number; y: number; w: number; h: number }[] = [
  { x: 27, y: 26, w: 8, h: 16 }, // committee upper-left (Prof. Whiskerton)
  { x: 27, y: 49, w: 8, h: 16 }, // committee mid-left (Data Purrson)
  { x: 27, y: 72, w: 8, h: 16 }, // committee lower-left (Agent Clawrence)
  { x: 72, y: 26, w: 8, h: 16 }, // committee upper-right (Counsel Pawsley)
  { x: 72, y: 49, w: 8, h: 16 }, // committee mid-right (SecureCat)
  { x: 72, y: 72, w: 8, h: 16 }, // committee lower-right (Mktg. Meowdison)
];
// Central FatCat Manager — sized to the painted body on the central dais.
const MANAGER_SEAT = { x: 50, y: 35, w: 14, h: 38 };

export default function MissionControlMode({ agents, project, events }: Props) {
  const reduced = useReducedMotion();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const roster = useMemo(() => buildRoster({ project, agents }), [project, agents]);
  const workflow = useMemo(
    () => classifyWorkflow({ name: project?.name, description: project?.description }),
    [project],
  );

  const manager = roster.find((r) => r.archetype === "manager") ?? roster[0];
  const committee = roster.filter((r) => r !== manager);
  const seated = committee.slice(0, SEATS.length);
  const bench = committee.slice(SEATS.length);
  const selected = roster.find((r) => r.key === selectedKey) ?? null;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden" style={{ background: "#05080f" }}>
      <FatCatStyles />

      {/* Command header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 flex-shrink-0" style={{ background: "rgba(5,8,15,0.92)" }}>
        <div className="flex items-center gap-2">
          <Radar size={14} className="text-cyan-400" />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-[0.18em]">FatCat Mission Control</span>
          <span className="text-xs text-cyan-300/80 ml-2 px-2 py-0.5 rounded border border-cyan-500/30 font-mono">
            {workflowLabel(workflow)}
          </span>
        </div>
        <SystemClock reduced={reduced} />
      </div>

      {/* Body: canvas (left/centre) + live side rail */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Centre: approved HUD image canvas with overlaid hotspots */}
        <main className="flex-1 relative overflow-auto custom-scroll" style={{ background: "#05080f" }}>
          <div
            className="relative mx-auto"
            style={{
              width: "100%",
              minWidth: 640,
              maxWidth: 1180,
              aspectRatio: "768 / 512",
            }}
          >
            <img
              src={missionImage}
              alt="FatCat Mission Control HUD: the central FatCat Manager flanked by the AI committee of specialist FatCats inside a command center."
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

            {/* Committee hotspots over painted seats */}
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
            <div className="absolute bottom-3 right-3 z-30">
              <AgentDetailPanel slot={selected} events={events} onClose={() => setSelectedKey(null)} />
            </div>
          )}
        </main>

        {/* Right rail: live task stream + bench (kept off the artwork) */}
        <aside className="hidden xl:flex flex-col w-72 border-l border-slate-800/80 overflow-y-auto custom-scroll p-3 gap-3" style={{ background: "rgba(5,8,15,0.6)" }}>
          <TaskStream events={events} />
          {bench.length > 0 && <BenchPanel bench={bench} onSelect={setSelectedKey} />}
        </aside>
      </div>

      {/* Bottom health strip */}
      <HealthStrip project={project} roster={roster} />
    </div>
  );
}

// ─── Hotspot: invisible hit area over a painted cat ──────────────────────────
// By default the artwork is left completely clean — the button is a transparent
// hit target with NO border, box, glow, or nameplate. Interaction reveals only
// the lightest possible treatment: a tiny status dot at the seat's corner and a
// small floating tooltip, shown on hover / keyboard focus / selection. Nothing
// large is ever painted over a cat's face or body.
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
  const active = isActiveStatus(slot.status);
  const animated = slot.status === "working" || slot.status === "verifying";
  const revealClass = selected ? "fc-hot-on" : "";
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${slot.name}, ${slot.roleLabel}, ${FATCAT_STATUS_META[slot.status].label}`}
      className={`fc-hot group absolute ${revealClass}`}
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
      {/* Tiny status dot. Persistent ONLY for genuinely live cats (working /
          verifying / blocked). Waiting/idle cats render no dot at all; a settled
          "complete" cat gets a quiet dot that only appears on hover/focus/select
          (.fc-dot-quiet) so the resting artwork stays clean. */}
      {slot.status !== "idle" && (
        <span
          aria-hidden
          className={[
            active ? "fc-dot-active" : "fc-dot-quiet",
            !reduced && animated ? "fc-motion" : "",
          ].filter(Boolean).join(" ")}
          style={{
            position: "absolute",
            top: "4%",
            right: "8%",
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: statusColor,
            boxShadow: `0 0 8px ${statusColor}cc`,
            animation: !reduced && animated ? "fcPulse 2.4s ease-in-out infinite" : undefined,
          }}
        />
      )}

      {/* Soft focus ring — hidden until hover/focus/selected (see .fc-hot CSS). */}
      <span
        aria-hidden
        className="fc-hot-ring"
        style={{
          position: "absolute",
          inset: "4%",
          borderRadius: "14px",
          border: `1.5px solid ${slot.color}`,
          boxShadow: `0 0 16px ${slot.color}66`,
        }}
      />

      {/* Lightweight tooltip — hidden until hover/focus/selected, floated above
          the seat so it never sits on the cat's face. */}
      <span
        aria-hidden
        className="fc-hot-tip"
        style={{
          position: "absolute",
          left: "50%",
          top: -8,
          transform: "translate(-50%,-100%)",
          padding: "2px 8px",
          borderRadius: 8,
          background: "rgba(5,8,15,0.95)",
          border: `1px solid ${slot.color}88`,
          boxShadow: "0 4px 14px rgba(0,0,0,0.6)",
          whiteSpace: "nowrap",
          maxWidth: 170,
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
          {slot.name}
        </span>
        <span style={{ display: "block", fontSize: 9, color: "#94a3b8" }}>{slot.roleLabel}</span>
      </span>
    </button>
  );
}

// ─── Panel chrome ────────────────────────────────────────────────────────────
function Panel({ title, icon: Icon, color = "#06b6d4", children }: {
  title: string; icon: React.ElementType; color?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: color + "33", background: "rgba(8,14,26,0.78)" }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: color + "22", background: color + "0c" }}>
        <Icon size={12} style={{ color }} />
        <span className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color }}>{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

// ─── Bench panel (roster roles beyond the painted committee) ──────────────────
function BenchPanel({ bench, onSelect }: { bench: RosterSlot[]; onSelect: (k: string) => void }) {
  return (
    <Panel title="Bench" icon={Users} color="#64748b">
      <div className="space-y-1.5">
        {bench.map((slot) => (
          <button
            key={slot.key}
            onClick={() => onSelect(slot.key)}
            aria-label={`${slot.name}, ${slot.roleLabel}, ${FATCAT_STATUS_META[slot.status].label}`}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left focus:outline-none focus:ring-1"
            style={{ background: "rgba(13,20,33,0.7)", border: `1px solid ${slot.color}33` }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: FATCAT_STATUS_META[slot.status].color, flexShrink: 0 }} />
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-semibold text-slate-200 truncate">{slot.name}</span>
              <span className="block text-slate-500" style={{ fontSize: 9 }}>{slot.roleLabel}</span>
            </span>
            <StatusPill status={slot.status} small />
          </button>
        ))}
      </div>
    </Panel>
  );
}

// ─── Live task stream ────────────────────────────────────────────────────────
function TaskStream({ events }: { events: AgentEvent[] }) {
  return (
    <Panel title="Task Stream" icon={Terminal} color="#06b6d4">
      <div className="space-y-1 max-h-72 overflow-y-auto custom-scroll font-mono" style={{ fontSize: 10 }}>
        {events.length === 0 && <div className="text-slate-600 italic" style={{ fontFamily: "Inter" }}>Awaiting telemetry…</div>}
        {events.slice(0, 30).map((ev, i) => (
          <div key={ev.id ?? i} className="leading-snug">
            <span className="text-slate-600">›</span>{" "}
            <span className="text-cyan-300">{ev.agentName}</span>{" "}
            <span className="text-slate-400">{ev.action}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Bottom health strip ─────────────────────────────────────────────────────
function HealthStrip({ project, roster }: { project: Project | null; roster: RosterSlot[] }) {
  const active = roster.filter((r) => r.status === "working" || r.status === "verifying").length;
  const tokens = project?.tokensUsed ?? 0;
  const cost = project?.costToday ?? 0;
  const avg = project?.avgResponseTime ?? 0;
  const fmtTokens = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));

  return (
    <div className="grid gap-3 p-3 border-t border-slate-800/80 flex-shrink-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", background: "rgba(5,8,15,0.7)" }}>
      <Metric icon={Activity} color="#10b981" label="Active Roles" value={String(active)} />
      <Metric icon={Zap} color="#f59e0b" label="Tokens" value={fmtTokens(tokens)} />
      <Metric icon={DollarSign} color="#10b981" label="Cost Today" value={`$${cost.toFixed(2)}`} />
      <Metric icon={Gauge} color="#06b6d4" label="Avg Response" value={`${avg.toFixed(1)}s`} />
      <Metric icon={ShieldCheck} color="#8b5cf6" label="System" value="Nominal" />
    </div>
  );
}

function Metric({ icon: Icon, color, label, value }: { icon: React.ElementType; color: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border px-3 py-2.5 flex items-center gap-3" style={{ borderColor: color + "33", background: "rgba(8,14,26,0.78)" }}>
      <Icon size={16} style={{ color }} />
      <div>
        <div className="text-lg font-bold font-mono" style={{ color }}>{value}</div>
        <div className="text-slate-500" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      </div>
    </div>
  );
}

// ─── System clock (telemetry flourish) ───────────────────────────────────────
function SystemClock({ reduced }: { reduced: boolean }) {
  return (
    <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-slate-500">
      <span
        className={reduced ? undefined : "fc-motion"}
        style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", animation: reduced ? undefined : "fcPulse 1.8s ease-in-out infinite" }}
      />
      <span>LIVE · {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  );
}
