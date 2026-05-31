// Stage 6.12 — FatCat Mission Control mode.
//
// A serious command-center read on the same roster the Isometric Office shows.
// The Manager FatCat / AI committee sits in a central command pod, ringed by
// analytical panels: workflow overview, model routing/status, source
// verification & evidence alerts, the live task stream, and a cost / usage /
// system-health strip. The tone is Jarvis-like and original — concentric rings,
// HUD framing, monospace telemetry — not a copy of any film UI.
//
// Responsive: the grid collapses to a single column on tablet, and to a stacked
// roster + key panels on mobile.

import { useMemo, useState } from "react";
import {
  Radar, Cpu, ShieldCheck, Terminal, Gauge, DollarSign, Zap, Activity,
} from "lucide-react";
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
  const selected = roster.find((r) => r.key === selectedKey) ?? null;

  return (
    <div className="w-full h-full overflow-y-auto custom-scroll" style={{ background: "radial-gradient(circle at 50% 0%, #0a1326 0%, #05080f 60%)" }}>
      <FatCatStyles />

      {/* Command header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 sticky top-0 z-20" style={{ background: "rgba(5,8,15,0.92)", backdropFilter: "blur(8px)" }}>
        <div className="flex items-center gap-2">
          <Radar size={14} className="text-cyan-400" />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-[0.18em]">FatCat Mission Control</span>
          <span className="text-xs text-cyan-300/80 ml-2 px-2 py-0.5 rounded border border-cyan-500/30 font-mono">
            {workflowLabel(workflow)}
          </span>
        </div>
        <SystemClock reduced={reduced} />
      </div>

      {/* Main grid */}
      <div className="grid gap-3 p-3" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(12, minmax(0,1fr))" }}>
          {/* Left column: workflow + model routing */}
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-3">
            <WorkflowOverview roster={roster} project={project} workflowName={workflowLabel(workflow)} />
            <ModelRouting roster={roster} />
          </div>

          {/* Centre: command pod + committee ring */}
          <div className="col-span-12 lg:col-span-6">
            <CommandPod
              manager={manager}
              committee={committee}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              reduced={reduced}
            />
          </div>

          {/* Right column: source verification + task stream */}
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-3">
            <SourceVerification roster={roster} />
            <TaskStream events={events} />
          </div>
        </div>

        {/* Bottom strip: cost / usage / health */}
        <HealthStrip project={project} roster={roster} />
      </div>

      {/* Selected detail overlay */}
      {selected && (
        <div className="fixed bottom-4 right-4 z-40">
          <AgentDetailPanel slot={selected} events={events} onClose={() => setSelectedKey(null)} />
        </div>
      )}
    </div>
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

// ─── Central command pod ─────────────────────────────────────────────────────
function CommandPod({
  manager, committee, selectedKey, onSelect, reduced,
}: {
  manager: RosterSlot; committee: RosterSlot[];
  selectedKey: string | null; onSelect: (k: string) => void; reduced: boolean;
}) {
  return (
    <section className="rounded-xl border border-cyan-500/25 relative overflow-hidden" style={{ background: "rgba(8,14,26,0.6)", minHeight: 360 }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-cyan-500/20" style={{ background: "rgba(6,182,212,0.06)" }}>
        <ShieldCheck size={12} className="text-cyan-400" />
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-400">AI Committee · Manager FatCat</span>
      </div>

      {/* Concentric HUD rings + central manager */}
      <div className="relative flex items-center justify-center" style={{ height: 240 }}>
        {[200, 150, 100].map((d, i) => (
          <div
            key={d}
            aria-hidden
            className={reduced ? undefined : "fc-motion"}
            style={{
              position: "absolute", width: d, height: d, borderRadius: "50%",
              border: `1px solid rgba(6,182,212,${0.12 + i * 0.06})`,
              boxShadow: `0 0 24px rgba(6,182,212,0.08) inset`,
              animation: reduced ? undefined : `fcScan ${4 + i}s ease-in-out infinite`,
            }}
          />
        ))}
        <button
          onClick={() => onSelect(manager.key)}
          aria-pressed={selectedKey === manager.key}
          aria-label={`${manager.name}, ${manager.roleLabel}, ${FATCAT_STATUS_META[manager.status].label}`}
          className="relative z-10 flex flex-col items-center focus:outline-none"
          style={{ background: "none", border: "none", cursor: "pointer" }}
        >
          <FatCatAvatar archetype="manager" color={manager.color} status={manager.status} size={92} manager reducedMotion={reduced} />
          <div className="mt-1.5 text-sm font-bold text-slate-100">{manager.name}</div>
          <div className="text-xs text-slate-500">{manager.roleLabel}</div>
          <div className="mt-1"><StatusPill status={manager.status} small /></div>
        </button>
      </div>

      {/* Committee strip */}
      <div className="px-3 pb-3 pt-1">
        <div className="text-xs text-slate-600 uppercase tracking-wider mb-2">Committee</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
          {committee.map((slot) => {
            const sel = selectedKey === slot.key;
            return (
              <button
                key={slot.key}
                onClick={() => onSelect(slot.key)}
                aria-pressed={sel}
                aria-label={`${slot.name}, ${slot.roleLabel}, ${FATCAT_STATUS_META[slot.status].label}`}
                className="flex flex-col items-center gap-1 rounded-lg p-2 focus:outline-none"
                style={{
                  background: sel ? slot.color + "1c" : "rgba(13,20,33,0.7)",
                  border: `1px solid ${sel ? slot.color : slot.color + "33"}`,
                  boxShadow: sel ? `0 0 12px ${slot.color}55` : "none",
                }}
              >
                <FatCatAvatar archetype={slot.archetype} color={slot.color} status={slot.status} size={40} reducedMotion={reduced} />
                <span className="text-slate-300 text-center leading-tight" style={{ fontSize: 9 }}>{slot.roleLabel}</span>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: FATCAT_STATUS_META[slot.status].color }} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Workflow overview ───────────────────────────────────────────────────────
function WorkflowOverview({ roster, project, workflowName }: {
  roster: RosterSlot[]; project: Project | null; workflowName: string;
}) {
  const done = roster.filter((r) => r.status === "complete").length;
  return (
    <Panel title="Workflow" icon={Gauge} color="#8b5cf6">
      <div className="text-sm font-semibold text-slate-100">{workflowName}</div>
      <div className="text-xs text-slate-500 mb-3">{project?.name ?? "No active project"}</div>
      <div className="space-y-1.5">
        {roster.map((slot, i) => (
          <div key={slot.key} className="flex items-center gap-2">
            <span className="text-slate-600 font-mono w-4 text-right" style={{ fontSize: 9 }}>{i + 1}</span>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: FATCAT_STATUS_META[slot.status].color, flexShrink: 0 }} />
            <span className="text-xs text-slate-400 truncate flex-1">{slot.roleLabel}</span>
            <span className="text-slate-600" style={{ fontSize: 9 }}>{FATCAT_STATUS_META[slot.status].label}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full rounded-full bg-violet-500" style={{ width: `${roster.length ? (done / roster.length) * 100 : 0}%` }} />
        </div>
        <span className="text-xs font-mono text-violet-300">{done}/{roster.length}</span>
      </div>
    </Panel>
  );
}

// ─── Model routing / status ──────────────────────────────────────────────────
function ModelRouting({ roster }: { roster: RosterSlot[] }) {
  const live = roster.filter((r) => r.live && r.modelId);
  return (
    <Panel title="Model Routing" icon={Cpu} color="#3b82f6">
      {live.length === 0 ? (
        <div className="text-xs text-slate-600 italic">Routing resolves once live agents are assigned. Roles below are fit-for-purpose defaults.</div>
      ) : null}
      <div className="space-y-1.5 mt-0.5">
        {roster.map((slot) => (
          <div key={slot.key} className="flex items-center gap-2">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: slot.color, flexShrink: 0 }} />
            <span className="text-xs text-slate-400 truncate flex-1">{slot.roleLabel}</span>
            <span className="text-slate-500 font-mono truncate" style={{ fontSize: 9, maxWidth: 110 }}>
              {slot.modelId ?? (slot.live ? "default" : "—")}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Source verification & evidence alerts ───────────────────────────────────
function SourceVerification({ roster }: { roster: RosterSlot[] }) {
  const verifyRoles = roster.filter((r) =>
    r.archetype === "sourceverify" || r.archetype === "factcheck" || r.archetype === "qa",
  );
  const blocked = roster.filter((r) => r.status === "blocked");
  return (
    <Panel title="Source & Verification" icon={ShieldCheck} color="#22c55e">
      {blocked.length > 0 && (
        <div className="mb-2 rounded-lg px-2 py-1.5 flex items-center gap-2" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)" }}>
          <Zap size={11} className="text-rose-400" />
          <span className="text-xs text-rose-300">{blocked.length} role(s) blocked — evidence gate may have tripped.</span>
        </div>
      )}
      {verifyRoles.length === 0 ? (
        <div className="text-xs text-slate-600 italic">No verification roles in this workflow.</div>
      ) : (
        <div className="space-y-1.5">
          {verifyRoles.map((slot) => (
            <div key={slot.key} className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400 truncate">{slot.roleLabel}</span>
              <StatusPill status={slot.status} small />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── Live task stream ────────────────────────────────────────────────────────
function TaskStream({ events }: { events: AgentEvent[] }) {
  return (
    <Panel title="Task Stream" icon={Terminal} color="#06b6d4">
      <div className="space-y-1 max-h-56 overflow-y-auto custom-scroll font-mono" style={{ fontSize: 10 }}>
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
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
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
