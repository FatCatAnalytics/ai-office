// Experimental Sprite Office mode.
// Renders a premium dark office as React/CSS layers and places each FatCat as an
// independent clickable sprite driven by the live project roster.

import { useMemo, useState, type CSSProperties } from "react";
import { Activity, CheckCircle2, Clock, ExternalLink, Layers, Sparkles, X } from "lucide-react";
import type { Agent, AgentEvent, Project, Task } from "../../types";
import {
  archetypeSpriteUrl,
  buildRoster,
  classifyWorkflow,
  FATCAT_STATUS_META,
  isActiveStatus,
  type FatCatArchetype,
  type RosterSlot,
  workflowLabel,
} from "../../lib/fatcatRoster";
import { AgentDetailPanel, FatCatStyles, StatusPill, useReducedMotion } from "./shared";

interface Props {
  agents: Agent[];
  project: Project | null;
  events: AgentEvent[];
  tasks: Task[];
}

type SeatKey = "manager" | "research" | "qa" | "writing" | "investment" | "data" | "engineering";
type SpecialistSeatKey = Exclude<SeatKey, "manager">;

interface SeatConfig {
  x: number;
  y: number;
  scale: number;
  z: number;
  labelSide: "left" | "right";
  cardDx: number;
  cardDy: number;
}

const SEATS: Record<SeatKey, SeatConfig> = {
  manager:     { x: 50, y: 48, scale: 1.18, z: 42, labelSide: "right", cardDx: 11, cardDy: -36 },
  research:    { x: 26, y: 57, scale: 0.72, z: 31, labelSide: "right", cardDx: 8,  cardDy: -25 },
  qa:          { x: 71, y: 56, scale: 0.72, z: 32, labelSide: "right", cardDx: 8,  cardDy: -24 },
  writing:     { x: 25, y: 80, scale: 0.76, z: 45, labelSide: "right", cardDx: 8,  cardDy: -22 },
  investment:  { x: 42, y: 82, scale: 0.74, z: 46, labelSide: "left",  cardDx: -9, cardDy: -19 },
  data:        { x: 58, y: 82, scale: 0.74, z: 47, labelSide: "right", cardDx: 8,  cardDy: -19 },
  engineering: { x: 76, y: 78, scale: 0.78, z: 48, labelSide: "left",  cardDx: -9, cardDy: -23 },
};

const SPECIALIST_SEATS: SpecialistSeatKey[] = ["research", "qa", "writing", "investment", "data", "engineering"];

const STATUS_TO_COPY: Record<RosterSlot["status"], string> = {
  idle: "Awaiting assignment",
  working: "Working on task",
  verifying: "Checking output",
  blocked: "Needs attention",
  complete: "Complete",
};

const ARCHETYPE_TO_SEAT: Partial<Record<FatCatArchetype, SpecialistSeatKey>> = {
  research: "research",
  diligence: "research",
  qa: "qa",
  factcheck: "qa",
  editor: "qa",
  sourceverify: "qa",
  writer: "writing",
  memo: "writing",
  financial: "data",
  valuation: "data",
  analyst: "data",
  risk: "investment",
  contrarian: "investment",
  cio: "investment",
  engineer: "engineering",
  market: "engineering",
  publish: "engineering",
};

function allocateSeat(archetype: FatCatArchetype, occupied: Set<SeatKey>, fallback: number): SpecialistSeatKey {
  const preferred = ARCHETYPE_TO_SEAT[archetype] ?? SPECIALIST_SEATS[fallback % SPECIALIST_SEATS.length];
  if (!occupied.has(preferred)) return preferred;
  return SPECIALIST_SEATS.find((seat) => !occupied.has(seat)) ?? preferred;
}

function pct(n: number | undefined, fallback = 0) {
  return Math.max(0, Math.min(100, Math.round(n ?? fallback)));
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function taskIsDone(task: Task) {
  return task.status === "done";
}

export default function SpriteOfficeMode({ agents, project, events, tasks }: Props) {
  const reduced = useReducedMotion();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const roster = useMemo(() => buildRoster({ agents, project }), [agents, project]);
  const workflow = useMemo(() => classifyWorkflow({ name: project?.name, description: project?.description }), [project]);

  const manager = roster.find((r) => r.archetype === "manager") ?? roster[0];
  const specialists = roster.filter((r) => r !== manager);
  const visibleSpecialists = specialists.slice(0, SPECIALIST_SEATS.length);
  const bench = specialists.slice(SPECIALIST_SEATS.length);
  const selected = roster.find((r) => r.key === selectedKey) ?? null;
  const activeTasks = tasks.filter((t) => !taskIsDone(t)).slice(0, 6);
  const recentEvents = events.slice(0, 7);
  const progress = pct(project?.progress, roster.some((r) => isActiveStatus(r.status)) ? 48 : 0);

  const seatAssignments = useMemo(() => {
    const occupied = new Set<SeatKey>(["manager"]);
    const assigned = visibleSpecialists.map((slot, i) => {
      const seatKey = allocateSeat(slot.archetype, occupied, i);
      occupied.add(seatKey);
      return { slot, seatKey };
    });
    return manager ? [{ slot: manager, seatKey: "manager" as SeatKey }, ...assigned] : assigned;
  }, [manager, visibleSpecialists]);

  return (
    <div className="sprite-office-root">
      <FatCatStyles />
      <SpriteOfficeStyles />

      <div className="sprite-office-main">
        <section className="sprite-office-canvas" aria-label="Dynamic FatCat AI office">
          <OfficeBackground />

          <div className="sprite-office-topline">
            <div className="sprite-office-breadcrumb">Projects <span>/</span> {project?.name ?? "AI Office"}</div>
            <div className="sprite-office-live"><span /> Live · All systems operational</div>
          </div>

          <ProjectStatusCard project={project} progress={progress} agents={roster} tasks={tasks} />

          {seatAssignments.map(({ slot, seatKey }) => (
            <AgentSpriteButton
              key={slot.key}
              slot={slot}
              seatKey={seatKey}
              selected={selectedKey === slot.key}
              reduced={reduced}
              onSelect={() => setSelectedKey(slot.key)}
            />
          ))}

          <div className="sprite-office-workflow-chip">
            <Layers size={12} />
            <span>{workflowLabel(workflow)}</span>
          </div>

          {bench.length > 0 && <BenchPanel bench={bench} />}
        </section>

        <aside className="sprite-office-side">
          <div className="sprite-panel-header">
            <span>Agent Details</span>
            {selected && <button onClick={() => setSelectedKey(null)} aria-label="Close agent details"><X size={14} /></button>}
          </div>
          {selected ? (
            <AgentDetailPanel slot={selected} events={events} onClose={() => setSelectedKey(null)} />
          ) : (
            <ManagerSummary manager={manager} progress={progress} />
          )}

          <div className="sprite-side-card">
            <div className="sprite-side-title">Active Tasks</div>
            <div className="sprite-task-list">
              {activeTasks.length === 0 ? (
                <div className="sprite-empty">No active tasks yet.</div>
              ) : activeTasks.map((task) => {
                const owner = roster.find((r) => r.agent?.id === task.assignedTo || r.name === task.assignedTo);
                return (
                  <div key={task.id} className="sprite-task-row">
                    <span className="sprite-task-dot" style={{ background: owner?.color ?? "#64748b" }} />
                    <div>
                      <strong>{task.title}</strong>
                      <small>{owner?.name ?? task.assignedTo}</small>
                    </div>
                    <em>{pct(task.progress)}%</em>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>

      <footer className="sprite-office-feed">
        <div className="sprite-feed-title"><Activity size={13} /> Activity Feed</div>
        <div className="sprite-feed-items">
          {recentEvents.length === 0 ? (
            <div className="sprite-feed-empty">Submit a project to start the team.</div>
          ) : recentEvents.map((event, idx) => (
            <div key={event.id ?? idx} className="sprite-feed-item">
              <span className="sprite-feed-icon"><CheckCircle2 size={14} /></span>
              <div>
                <time>{formatTime(event.timestamp)}</time>
                <strong>{event.agentName}</strong>
                <span>{event.action} · {event.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}

function AgentSpriteButton({
  slot, seatKey, selected, reduced, onSelect,
}: {
  slot: RosterSlot;
  seatKey: SeatKey;
  selected: boolean;
  reduced: boolean;
  onSelect: () => void;
}) {
  const seat = SEATS[seatKey];
  const statusMeta = FATCAT_STATUS_META[slot.status];
  const active = isActiveStatus(slot.status);
  const progress = pct(slot.agent?.progress, active ? 64 : slot.status === "complete" ? 100 : 0);
  const cardLeft = seat.x + seat.cardDx;
  const cardTop = seat.y + seat.cardDy;

  return (
    <>
      <button
        className={`sprite-agent ${slot.status} ${selected ? "selected" : ""} ${reduced ? "reduced" : ""}`}
        onClick={onSelect}
        style={{
          left: `${seat.x}%`,
          top: `${seat.y}%`,
          zIndex: seat.z,
          "--scale": seat.scale,
          "--agent-color": slot.color,
          "--status-color": statusMeta.color,
        } as CSSProperties}
        aria-label={`${slot.name}, ${slot.roleLabel}, ${statusMeta.label}`}
      >
        <span className="sprite-agent-glow" />
        <img src={archetypeSpriteUrl(slot.archetype)} alt="" draggable={false} />
      </button>

      <button
        className={`sprite-agent-card ${seat.labelSide} ${selected ? "selected" : ""}`}
        onClick={onSelect}
        style={{
          left: `${cardLeft}%`,
          top: `${cardTop}%`,
          zIndex: seat.z + 18,
          "--agent-color": slot.color,
        } as CSSProperties}
        aria-label={`Open ${slot.name} details`}
      >
        <strong>{slot.name}</strong>
        <StatusPill status={slot.status} small />
        <span>{slot.task ?? STATUS_TO_COPY[slot.status]}</span>
        <i><b style={{ width: `${progress}%` }} /> <em>{progress}%</em></i>
      </button>
    </>
  );
}

function ProjectStatusCard({ project, progress, agents, tasks }: { project: Project | null; progress: number; agents: RosterSlot[]; tasks: Task[] }) {
  const active = agents.filter((a) => isActiveStatus(a.status)).length;
  const complete = tasks.filter(taskIsDone).length;
  return (
    <div className="sprite-project-card">
      <small>Project Status</small>
      <div className="sprite-project-row">
        <strong>{project?.status === "completed" ? "Complete" : "On Track"}</strong>
        <span>{progress}%</span>
      </div>
      <div className="sprite-ring" style={{ "--progress": `${progress}%` } as CSSProperties} />
      <div className="sprite-project-metrics">
        <span><b>{complete}</b> done</span>
        <span><b>{active}</b> active</span>
        <span><b>{agents.length}</b> agents</span>
      </div>
      <p>{project?.description ? project.description.slice(0, 86) : "Manager is ready to delegate work to the FatCat team."}</p>
    </div>
  );
}

function ManagerSummary({ manager, progress }: { manager: RosterSlot; progress: number }) {
  return (
    <div className="sprite-side-card sprite-manager-summary">
      <div className="sprite-manager-avatar">
        <img src={archetypeSpriteUrl(manager.archetype)} alt="" />
      </div>
      <strong>{manager.name}</strong>
      <span>{manager.roleLabel}</span>
      <StatusPill status={manager.status} small />
      <p>{manager.task ?? "Coordinating the team and waiting for the next project instruction."}</p>
      <div className="sprite-progress"><b style={{ width: `${progress}%` }} /></div>
      <button type="button"><ExternalLink size={13} /> View Full Profile</button>
    </div>
  );
}

function BenchPanel({ bench }: { bench: RosterSlot[] }) {
  return (
    <div className="sprite-bench-panel">
      <strong>Bench</strong>
      {bench.map((slot) => (
        <span key={slot.key}>{slot.name}</span>
      ))}
    </div>
  );
}

function OfficeBackground() {
  return (
    <div className="sprite-bg" aria-hidden>
      <div className="sprite-bg-wall" />
      <div className="sprite-bg-logo"><Sparkles size={16} /> Axl.ai</div>
      <div className="sprite-bg-platform" />
      <div className="sprite-bg-dais" />
      <div className="sprite-desk desk-left" />
      <div className="sprite-desk desk-right" />
      <div className="sprite-desk desk-front" />
      <div className="sprite-holo holo-left" />
      <div className="sprite-holo holo-right" />
      <div className="sprite-holo holo-centre" />
      <div className="sprite-plant plant-left" />
      <div className="sprite-plant plant-right" />
      <div className="sprite-neon-route route-a" />
      <div className="sprite-neon-route route-b" />
      <div className="sprite-neon-route route-c" />
    </div>
  );
}

function SpriteOfficeStyles() {
  return (
    <style>{`
      @keyframes fatcat-breathe { 0%,100% { transform: translate(-50%, -100%) scale(var(--scale)); } 50% { transform: translate(-50%, calc(-100% - 5px)) scale(var(--scale)); } }
      @keyframes fatcat-working { 0%,100% { transform: translate(-50%, -100%) rotate(-0.6deg) scale(var(--scale)); } 50% { transform: translate(-50%, calc(-100% - 7px)) rotate(0.6deg) scale(var(--scale)); } }
      .sprite-office-root { height: 100%; min-height: 0; display: flex; flex-direction: column; background: #030712; color: #e5edf8; overflow: hidden; }
      .sprite-office-main { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 306px; border-bottom: 1px solid rgba(148,163,184,.12); }
      .sprite-office-canvas { position: relative; min-height: 0; overflow: hidden; background: radial-gradient(circle at 50% 42%, #15213b 0%, #07111f 43%, #030712 100%); }
      .sprite-office-side { border-left: 1px solid rgba(148,163,184,.12); background: rgba(6,10,22,.78); backdrop-filter: blur(18px); padding: 14px; overflow-y: auto; }
      .sprite-office-topline { position: absolute; top: 18px; left: 24px; right: 24px; z-index: 90; display: flex; justify-content: space-between; align-items: center; pointer-events: none; }
      .sprite-office-breadcrumb { font-size: 13px; font-weight: 700; color: #eef4ff; text-shadow: 0 2px 10px rgba(0,0,0,.5); }
      .sprite-office-breadcrumb span { color: #64748b; margin: 0 8px; }
      .sprite-office-live { color: #94a3b8; font-size: 11px; }
      .sprite-office-live span { display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: #10b981; box-shadow: 0 0 10px #10b981; margin-right: 5px; }
      .sprite-bg { position: absolute; inset: 0; overflow: hidden; }
      .sprite-bg:before { content: ''; position: absolute; inset: 0; background-image: linear-gradient(rgba(59,130,246,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,.08) 1px, transparent 1px); background-size: 42px 42px; transform: perspective(730px) rotateX(58deg) translateY(33%); transform-origin: 50% 100%; opacity: .55; }
      .sprite-bg-wall { position: absolute; left: 19%; right: 16%; top: 8%; height: 25%; border: 1px solid rgba(148,163,184,.12); border-radius: 22px; background: linear-gradient(180deg, rgba(15,23,42,.84), rgba(15,23,42,.16)); box-shadow: inset 0 0 60px rgba(139,92,246,.12); }
      .sprite-bg-logo { position: absolute; left: 34%; top: 15%; z-index: 3; display: flex; align-items: center; gap: 10px; padding: 16px 28px; border-radius: 18px; border: 1px solid rgba(139,92,246,.56); background: rgba(8,12,24,.72); color: #c4b5fd; font-size: 27px; font-weight: 800; box-shadow: 0 0 36px rgba(139,92,246,.5), inset 0 0 20px rgba(139,92,246,.18); }
      .sprite-bg-platform { position: absolute; left: 8%; right: 8%; bottom: 8%; height: 60%; border-radius: 38px; background: linear-gradient(140deg, rgba(15,23,42,.78), rgba(2,6,23,.92)); transform: skewX(-8deg); box-shadow: 0 30px 80px rgba(0,0,0,.65), inset 0 0 0 1px rgba(148,163,184,.10); }
      .sprite-bg-dais { position: absolute; left: 41%; top: 49%; width: 18%; height: 10%; border-radius: 50%; border: 2px solid rgba(99,102,241,.9); background: radial-gradient(circle, rgba(30,41,59,.92), rgba(2,6,23,.88)); box-shadow: 0 0 28px rgba(99,102,241,.95), inset 0 0 28px rgba(59,130,246,.20); }
      .sprite-desk { position: absolute; z-index: 2; border-radius: 14px; background: linear-gradient(135deg, #1f2937, #0f172a); border: 1px solid rgba(148,163,184,.13); box-shadow: 0 20px 40px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.03); }
      .desk-left { left: 12%; bottom: 17%; width: 25%; height: 14%; transform: skewX(-10deg); }
      .desk-right { right: 9%; bottom: 17%; width: 26%; height: 15%; transform: skewX(10deg); }
      .desk-front { left: 38%; bottom: 7%; width: 24%; height: 11%; transform: skewX(-7deg); }
      .sprite-holo { position: absolute; z-index: 4; border-radius: 10px; border: 1px solid rgba(34,211,238,.4); background: linear-gradient(180deg, rgba(14,165,233,.12), rgba(8,47,73,.04)); box-shadow: 0 0 24px rgba(34,211,238,.18); }
      .sprite-holo:after { content: ''; position: absolute; inset: 18% 16%; border-top: 2px solid rgba(34,211,238,.5); border-bottom: 2px solid rgba(139,92,246,.5); opacity: .75; }
      .holo-left { left: 18%; top: 35%; width: 10%; height: 18%; }
      .holo-right { right: 25%; top: 36%; width: 8%; height: 16%; }
      .holo-centre { left: 48%; bottom: 22%; width: 11%; height: 17%; }
      .sprite-plant { position: absolute; z-index: 5; width: 5%; aspect-ratio: 1; border-radius: 50% 50% 10% 10%; background: radial-gradient(circle at 50% 30%, #22c55e, #14532d 58%, #0f172a 60%); filter: drop-shadow(0 12px 16px rgba(0,0,0,.45)); opacity: .75; }
      .plant-left { left: 9%; top: 42%; } .plant-right { right: 13%; top: 29%; }
      .sprite-neon-route { position: absolute; z-index: 6; height: 2px; border-radius: 999px; opacity: .65; filter: drop-shadow(0 0 7px currentColor); }
      .route-a { left: 32%; top: 63%; width: 19%; background: linear-gradient(90deg, transparent, #22d3ee, transparent); transform: rotate(-12deg); color: #22d3ee; }
      .route-b { left: 50%; top: 64%; width: 21%; background: linear-gradient(90deg, transparent, #8b5cf6, transparent); transform: rotate(16deg); color: #8b5cf6; }
      .route-c { left: 40%; top: 75%; width: 18%; background: linear-gradient(90deg, transparent, #34d399, transparent); transform: rotate(42deg); color: #34d399; }
      .sprite-project-card, .sprite-bench-panel, .sprite-agent-card, .sprite-side-card { border: 1px solid rgba(148,163,184,.14); background: rgba(8,13,28,.78); backdrop-filter: blur(14px); box-shadow: 0 16px 50px rgba(0,0,0,.38), inset 0 0 0 1px rgba(255,255,255,.025); }
      .sprite-project-card { position: absolute; z-index: 75; left: 24px; top: 70px; width: 238px; padding: 16px; border-radius: 16px; }
      .sprite-project-card small, .sprite-side-title, .sprite-panel-header { text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; font-size: 10px; font-weight: 800; }
      .sprite-project-row { display: flex; justify-content: space-between; margin-top: 8px; align-items: center; }
      .sprite-project-row strong { color: #34d399; font-size: 18px; } .sprite-project-row span { color: #c4b5fd; font-weight: 900; }
      .sprite-ring { position: absolute; top: 18px; right: 16px; width: 50px; height: 50px; border-radius: 50%; background: conic-gradient(#34d399 var(--progress), rgba(148,163,184,.14) 0); }
      .sprite-ring:after { content: ''; position: absolute; inset: 7px; border-radius: 50%; background: #08111f; }
      .sprite-project-metrics { display: flex; gap: 13px; margin: 14px 0; padding-top: 12px; border-top: 1px solid rgba(148,163,184,.13); } .sprite-project-metrics span { font-size: 11px; color: #94a3b8; } .sprite-project-metrics b { color: #e5edf8; }
      .sprite-project-card p { margin: 0; color: #94a3b8; font-size: 11px; line-height: 1.45; }
      .sprite-agent { position: absolute; border: 0; background: transparent; padding: 0; transform: translate(-50%, -100%) scale(var(--scale)); transform-origin: 50% 100%; cursor: pointer; animation: fatcat-breathe 4.6s ease-in-out infinite; }
      .sprite-agent.working, .sprite-agent.verifying { animation: fatcat-working 2.8s ease-in-out infinite; }
      .sprite-agent.reduced { animation: none !important; }
      .sprite-agent img { display: block; height: min(25vh, 250px); width: auto; pointer-events: none; filter: drop-shadow(0 22px 22px rgba(0,0,0,.55)); }
      .sprite-agent-glow { position: absolute; left: 50%; bottom: 3%; width: 72%; height: 17%; border-radius: 50%; transform: translateX(-50%); background: radial-gradient(circle, var(--status-color), transparent 68%); opacity: .16; filter: blur(7px); }
      .sprite-agent.working .sprite-agent-glow, .sprite-agent.verifying .sprite-agent-glow, .sprite-agent.selected .sprite-agent-glow { opacity: .42; }
      .sprite-agent.blocked .sprite-agent-glow { opacity: .55; }
      .sprite-agent-card { position: absolute; width: 178px; border-radius: 14px; padding: 10px 11px; color: #dbeafe; text-align: left; cursor: pointer; transition: transform .18s ease, opacity .18s ease, border-color .18s ease; }
      .sprite-agent-card.left { transform: translate(-100%, 0); } .sprite-agent-card.right { transform: translate(0, 0); }
      .sprite-agent-card:hover, .sprite-agent-card.selected { opacity: 1; border-color: var(--agent-color); box-shadow: 0 16px 50px rgba(0,0,0,.38), 0 0 18px color-mix(in srgb, var(--agent-color), transparent 50%); }
      .sprite-agent-card strong { display: block; font-size: 12px; margin-bottom: 4px; } .sprite-agent-card span:not(:first-child) { display: block; font-size: 11px; color: #94a3b8; margin-top: 7px; line-height: 1.35; }
      .sprite-agent-card i { display: flex; align-items: center; gap: 8px; margin-top: 8px; height: 5px; border-radius: 999px; background: rgba(148,163,184,.18); font-style: normal; }
      .sprite-agent-card i b { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--agent-color), #22d3ee); } .sprite-agent-card i em { font-style: normal; color: #cbd5e1; font-size: 10px; }
      .sprite-office-workflow-chip { position: absolute; z-index: 80; left: 24px; bottom: 18px; display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-radius: 999px; color: #c4b5fd; background: rgba(8,13,28,.8); border: 1px solid rgba(139,92,246,.25); font-size: 11px; font-weight: 800; }
      .sprite-bench-panel { position: absolute; right: 18px; bottom: 18px; z-index: 80; border-radius: 14px; padding: 10px 12px; display: flex; gap: 8px; align-items: center; font-size: 11px; color: #94a3b8; } .sprite-bench-panel strong { color: #e5edf8; } .sprite-bench-panel span { padding: 3px 7px; border-radius: 999px; background: rgba(148,163,184,.10); }
      .sprite-panel-header { display: flex; justify-content: space-between; align-items: center; margin: 2px 0 12px; } .sprite-panel-header button { color: #94a3b8; background: transparent; border: 0; cursor: pointer; }
      .sprite-side-card { border-radius: 16px; padding: 14px; margin-bottom: 14px; }
      .sprite-manager-summary { text-align: center; } .sprite-manager-avatar { width: 132px; height: 120px; margin: 0 auto 10px; overflow: hidden; border-radius: 14px; background: rgba(15,23,42,.75); } .sprite-manager-avatar img { height: 155px; margin-top: -10px; }
      .sprite-manager-summary strong { display: block; color: #f8fafc; } .sprite-manager-summary > span { display: block; color: #94a3b8; font-size: 11px; margin: 3px 0 8px; }
      .sprite-manager-summary p { color: #cbd5e1; font-size: 12px; line-height: 1.45; } .sprite-progress { height: 7px; border-radius: 999px; background: rgba(148,163,184,.16); overflow: hidden; margin: 13px 0; } .sprite-progress b { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #8b5cf6, #22d3ee); }
      .sprite-manager-summary button { width: 100%; border: 0; border-radius: 10px; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; padding: 10px 12px; font-weight: 800; display: flex; justify-content: center; align-items: center; gap: 7px; }
      .sprite-task-list { margin-top: 12px; display: grid; gap: 10px; } .sprite-task-row { display: grid; grid-template-columns: 8px 1fr auto; gap: 9px; align-items: start; } .sprite-task-dot { width: 8px; height: 8px; border-radius: 999px; margin-top: 5px; } .sprite-task-row strong { display: block; color: #e5edf8; font-size: 12px; } .sprite-task-row small { color: #94a3b8; font-size: 10px; } .sprite-task-row em { color: #c4b5fd; font-size: 11px; font-style: normal; }
      .sprite-empty { color: #64748b; font-size: 12px; }
      .sprite-office-feed { height: 118px; flex-shrink: 0; background: rgba(8,13,28,.88); display: grid; grid-template-columns: 150px 1fr; align-items: center; padding: 0 20px; gap: 16px; }
      .sprite-feed-title { display: flex; gap: 8px; align-items: center; color: #94a3b8; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
      .sprite-feed-items { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(180px, 1fr); gap: 14px; overflow-x: auto; } .sprite-feed-item { display: flex; gap: 9px; align-items: flex-start; min-width: 0; padding-right: 14px; border-right: 1px solid rgba(148,163,184,.11); }
      .sprite-feed-icon { width: 34px; height: 34px; border-radius: 999px; flex-shrink: 0; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #7c3aed, #22c55e); } .sprite-feed-item time { display: block; color: #64748b; font-size: 10px; } .sprite-feed-item strong { display: block; color: #e5edf8; font-size: 12px; } .sprite-feed-item span:last-child { color: #94a3b8; font-size: 11px; line-height: 1.35; }
      .sprite-feed-empty { color: #64748b; font-size: 12px; }
      @media (max-width: 1100px) { .sprite-office-main { grid-template-columns: 1fr; } .sprite-office-side { display: none; } .sprite-agent-card { display: none; } }
      @media (prefers-reduced-motion: reduce) { .sprite-agent { animation: none !important; } }
    `}</style>
  );
}
