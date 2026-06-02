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
  FatCatStyles, AgentDetailPanel, FatCatSprite, GroundShadow, StatusBadge, useReducedMotion, useContainRect,
} from "./shared";

// Intrinsic aspect ratio of the approved Mission Control artwork (1536 × 1024).
const ART_RATIO = 1536 / 1024;

interface Props {
  agents: Agent[];
  project: Project | null;
  events: AgentEvent[];
}

// Re-calibrated against the NEW clean, character-free Mission Control backdrop
// (commit d183f02). The painted committee cards are gone, so these seats place
// the LIVE sprites in a balanced arc around the cyan holographic ring platform
// (rings span ~y58–85%, centre ~y72%): a back pair high on each side, mid pair
// on each flank, and a front pair standing on the ring's front edge. Front
// cats (on the ring) are sized slightly LARGER and back cats SMALLER for depth.
// Each seat is centred via translate(-50%,-50%); feet sit ~y + h/2 so cats land
// on the ring/floor rather than float. Order matches buildRoster assignment.
const SEATS: { x: number; y: number; w: number; h: number }[] = [
  { x: 22, y: 44, w: 9,    h: 22 }, // back-left (smaller)
  { x: 22, y: 62, w: 10,   h: 24 }, // mid-left
  { x: 35, y: 73, w: 11,   h: 26 }, // front-left, on ring (larger)
  { x: 65, y: 73, w: 11,   h: 26 }, // front-right, on ring (larger)
  { x: 78, y: 44, w: 9,    h: 22 }, // back-right (smaller)
  { x: 78, y: 62, w: 10,   h: 24 }, // mid-right
];
// Central FatCat Manager — large, standing prominently on the holographic
// platform. Feet on the ring (~y60%): centre y + h/2 ≈ 59.
const MANAGER_SEAT = { x: 50, y: 42, w: 14, h: 34 };

// Badge anchors: each badge is centred horizontally on its cat and tucked just
// ABOVE the cat's head (anchor="top") so it never covers the face or lands in
// empty floor. y is the cat's head line (seat.y − seat.h/2). Same index order
// as SEATS; MANAGER_BADGE sits above the central manager.
const BADGES: { x: number; y: number; w: number; h: number }[] = SEATS.map((s) => ({
  x: s.x, y: s.y - s.h / 2, w: s.w, h: 4,
}));
const MANAGER_BADGE = {
  x: MANAGER_SEAT.x, y: MANAGER_SEAT.y - MANAGER_SEAT.h / 2, w: MANAGER_SEAT.w, h: 4,
};

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
            {/* Soft contact shadow under each cat's feet so the sprites read as
                planted on the ring/floor instead of floating. Behind sprites. */}
            <GroundShadow rect={MANAGER_SEAT} />
            {seated.map((slot, i) => (
              <GroundShadow key={`shadow-${slot.key}`} rect={SEATS[i]} />
            ))}

            {/* Per-agent CAT figures: transparent per-archetype × per-status
                sprites grounded around the holographic ring at each seat. These
                swap live as the agent's status changes (crossfade, no box/frame). */}
            <FatCatSprite
              archetype={manager.archetype}
              status={manager.status}
              rect={MANAGER_SEAT}
              reduced={reduced}
              alt={`${manager.name} — ${FATCAT_STATUS_META[manager.status].label}`}
            />
            {seated.map((slot, i) => (
              <FatCatSprite
                key={`sprite-${slot.key}`}
                archetype={slot.archetype}
                status={slot.status}
                rect={SEATS[i]}
                reduced={reduced}
                alt={`${slot.name} — ${FATCAT_STATUS_META[slot.status].label}`}
              />
            ))}

            {/* Live status layer: a small data-bound badge tucked just above each
                cat's head, driven by the agent's real status. No boxes /
                outlines / active-area rectangles are drawn over the art. */}
            <StatusBadge rect={MANAGER_BADGE} status={manager.status} reduced={reduced} anchor="top" />
            {seated.map((slot, i) => (
              <StatusBadge
                key={`badge-${slot.key}`}
                rect={BADGES[i]}
                status={slot.status}
                reduced={reduced}
                anchor="top"
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
