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

import { useMemo, useRef, useState } from "react";
import { Radar } from "lucide-react";
import missionImage from "@assets/fatcat/fatcat_mission_control.jpg";
import type { Agent, AgentEvent, Project } from "../../types";
import {
  buildRoster, classifyWorkflow, workflowLabel,
  FATCAT_STATUS_META, type RosterSlot,
} from "../../lib/fatcatRoster";
import {
  FatCatStyles, AgentDetailPanel, StatusBadge, useReducedMotion, useContainRect,
} from "./shared";

// Intrinsic aspect ratio of the approved Mission Control artwork (1536 × 1024).
const ART_RATIO = 1536 / 1024;

interface Props {
  agents: Agent[];
  project: Project | null;
  events: AgentEvent[];
}

// Calibrated against the approved Mission Control artwork by overlaying these
// boxes onto the image and tightening each one to its painted committee *card*
// (portrait + name plate). Highlighting the whole card — not just the cat head
// — is intentional: the user asked the active worker's card to light up. Left
// column then right column, top-to-bottom — the order specialists are assigned.
const SEATS: { x: number; y: number; w: number; h: number }[] = [
  { x: 29.5, y: 21,   w: 13, h: 18 }, // committee upper-left (Prof. Whiskerton)
  { x: 29.5, y: 38.5, w: 13, h: 18 }, // committee mid-left (Data Purrson)
  { x: 29.5, y: 55,   w: 13, h: 18 }, // committee lower-left (Agent Clawrence)
  { x: 70.5, y: 21,   w: 13, h: 18 }, // committee upper-right (Counsel Pawsley)
  { x: 70.5, y: 38.5, w: 13, h: 18 }, // committee mid-right (SecureCat)
  { x: 70.5, y: 54,   w: 13, h: 18 }, // committee lower-right (Mktg. Meowdison)
];
// Central FatCat Manager — sized to the painted body on the central dais.
const MANAGER_SEAT = { x: 50, y: 29, w: 16, h: 35 };

export default function MissionControlMode({ agents, project, events }: Props) {
  const reduced = useReducedMotion();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRect = useContainRect(containerRef, ART_RATIO);

  const roster = useMemo(() => buildRoster({ project, agents }), [project, agents]);
  const workflow = useMemo(
    () => classifyWorkflow({ name: project?.name, description: project?.description }),
    [project],
  );

  const manager = roster.find((r) => r.archetype === "manager") ?? roster[0];
  const committee = roster.filter((r) => r !== manager);
  const seated = committee.slice(0, SEATS.length);
  const selected = roster.find((r) => r.key === selectedKey) ?? null;

  // The approved artwork IS the view. We render it object-contain (never
  // cropped) and centre it on a matching dark backdrop. The only things layered
  // on top are: a small live status badge per committee card (data-bound to the
  // agent's real status), the invisible click hotspots, an optional floating
  // detail panel, and a tiny mode chip. There are NO hover/selection boxes,
  // outlines, or active-area rectangles drawn over the painted cats.
  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: "#05080f" }}>
      <FatCatStyles />

      {/* Full-bleed scene: a full-size container holds the object-contain image;
          a hotspot layer is positioned over the *computed* letterboxed image
          rect so percentage seats land exactly on the painted cards at any
          container shape. */}
      <div ref={containerRef} className="absolute inset-0 p-2 sm:p-4">
        <div className="relative w-full h-full">
          <img
            src={missionImage}
            alt="FatCat Mission Control HUD: the central FatCat Manager flanked by the AI committee of specialist FatCats inside a command center."
            className="absolute inset-0 w-full h-full object-contain select-none"
            draggable={false}
          />

          {/* Hotspot layer aligned to the rendered image box */}
          <div
            className="absolute"
            style={{ left: imgRect.left, top: imgRect.top, width: imgRect.width, height: imgRect.height }}
          >
            {/* Live status layer: a small data-bound badge tucked under each
                committee card, driven by the agent's real status. No boxes /
                outlines / active-area rectangles are drawn over the art. */}
            <StatusBadge rect={MANAGER_SEAT} status={manager.status} reduced={reduced} />
            {seated.map((slot, i) => (
              <StatusBadge
                key={`badge-${slot.key}`}
                rect={SEATS[i]}
                status={slot.status}
                reduced={reduced}
              />
            ))}

            {/* Manager hotspot (transparent hit area over the painted cat). */}
            <Hotspot
              slot={manager}
              seat={MANAGER_SEAT}
              manager
              selected={selectedKey === manager.key}
              onSelect={() => setSelectedKey(manager.key)}
            />

            {/* Committee hotspots over painted cards */}
            {seated.map((slot, i) => (
              <Hotspot
                key={slot.key}
                slot={slot}
                seat={SEATS[i]}
                selected={selectedKey === slot.key}
                onSelect={() => setSelectedKey(slot.key)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Tiny floating mode chip (top-left) — does not cover any painted panel. */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2 px-2.5 py-1 rounded-full pointer-events-none"
        style={{ background: "rgba(5,8,15,0.7)", border: "1px solid rgba(6,182,212,0.3)", backdropFilter: "blur(4px)" }}>
        <Radar size={12} className="text-cyan-400" />
        <span className="text-cyan-300/90 font-mono" style={{ fontSize: 10, letterSpacing: "0.08em" }}>{workflowLabel(workflow)}</span>
      </div>

      {/* Selected detail — floating bottom-right, off the painted panels. */}
      {selected && (
        <div className="absolute bottom-3 right-3 z-40">
          <AgentDetailPanel slot={selected} events={events} onClose={() => setSelectedKey(null)} />
        </div>
      )}
    </div>
  );
}

// ─── Hotspot: invisible hit area over a painted committee card ───────────────
// The button is a fully transparent hit target with NO border, box, glow, dot,
// tooltip, or hover/selection rectangle drawn over the artwork. It only opens
// the detail panel on click; the resting artwork stays completely clean and the
// only visible chrome is the small live status badge (see StatusBadge).
function Hotspot({
  slot, seat, manager, selected, onSelect,
}: {
  slot: RosterSlot;
  seat: { x: number; y: number; w: number; h: number };
  manager?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${slot.name}, ${slot.roleLabel}, ${FATCAT_STATUS_META[slot.status].label}`}
      className="fc-hot absolute"
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
    />
  );
}
