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

import { useMemo, useRef, useState } from "react";
import { Layers } from "lucide-react";
import officeImage from "@assets/fatcat/fatcat_isometric_office.jpg";
import type { Agent, AgentEvent, Project } from "../../types";
import {
  buildRoster, classifyWorkflow, workflowLabel,
  FATCAT_STATUS_META, type RosterSlot,
} from "../../lib/fatcatRoster";
import {
  FatCatStyles, AgentDetailPanel, FatCatSprite, GroundShadow, StatusBadge, useReducedMotion, useContainRect,
} from "./shared";

// Intrinsic aspect ratio of the approved isometric-office artwork (1536 × 1024).
const ART_RATIO = 1536 / 1024;

interface Props {
  agents: Agent[];
  project: Project | null;
  events: AgentEvent[];
}

// Re-calibrated against the NEW clean, character-free isometric-office backdrop
// (commit d183f02). The painted cats are gone, so these seats now place the
// LIVE sprites grounded on the empty stage: a loose semicircle around the
// glowing central platform (top edge ~y60%, bottom ~y82%) and out toward the
// desks, evenly spaced with no overlap. Front cats (nearer the platform front
// edge) are sized slightly LARGER and back cats SMALLER so the arc reads with
// depth. Each seat is centred via translate(-50%,-50%); the cat's feet sit at
// roughly y + h/2, tuned to land on the platform / floor rather than float.
// Order matches how buildRoster assigns specialists (after the manager).
const SEATS: { x: number; y: number; w: number; h: number }[] = [
  { x: 30, y: 56, w: 10,   h: 24 }, // left of platform, by left desks (mid)
  { x: 42, y: 62, w: 10.5, h: 25 }, // front-left of platform (larger)
  { x: 55, y: 68, w: 11,   h: 26 }, // front-centre, on platform front edge (largest)
  { x: 68, y: 62, w: 10.5, h: 25 }, // front-right of platform (larger)
  { x: 80, y: 56, w: 10,   h: 24 }, // right, by right desks (mid)
  { x: 21, y: 44, w: 9,    h: 22 }, // back-left, by back desks (smallest)
];
// The manager seat — the large FatCat standing prominently on the central
// platform. Feet rest on the platform top (~y60%): centre y + h/2 ≈ 62.
const MANAGER_SEAT = { x: 55, y: 49, w: 12, h: 30 };

// Badge anchors: each badge is centred horizontally on its cat and sits just
// ABOVE the cat's head (anchor="top") so it never covers the face or lands in
// empty floor. y is the cat's head line (seat.y − seat.h/2) and h is a small
// pill height the StatusBadge nudges the badge above. Same index order as SEATS.
const BADGES: { x: number; y: number; w: number; h: number }[] = SEATS.map((s) => ({
  x: s.x, y: s.y - s.h / 2, w: s.w, h: 4,
}));
const MANAGER_BADGE = {
  x: MANAGER_SEAT.x, y: MANAGER_SEAT.y - MANAGER_SEAT.h / 2, w: MANAGER_SEAT.w, h: 4,
};

export default function IsometricOfficeMode({ agents, project, events }: Props) {
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
  const specialists = roster.filter((r) => r !== manager);
  const seated = specialists.slice(0, SEATS.length);
  const selected = roster.find((r) => r.key === selectedKey) ?? null;

  // The approved artwork IS the view: rendered object-contain (never cropped),
  // centred on a matching dark backdrop. The only things over it are a small
  // data-bound status badge per painted info card, invisible click hotspots, an
  // optional floating detail panel, and a tiny mode chip. There are NO
  // hover/selection boxes, outlines, or active-area rectangles over the cats.
  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: "#060b16" }}>
      <FatCatStyles />

      <div ref={containerRef} className="absolute inset-0 p-2 sm:p-4">
        <div className="relative w-full h-full">
          <img
            src={officeImage}
            alt="FatCat isometric office: the Manager FatCat on a central dais with specialist FatCats at desks around an open-plan office."
            className="absolute inset-0 w-full h-full object-contain select-none"
            draggable={false}
          />

          {/* Hotspot layer aligned to the rendered image box */}
          <div
            className="absolute"
            style={{ left: imgRect.left, top: imgRect.top, width: imgRect.width, height: imgRect.height }}
          >
            {/* Soft contact shadow under each cat's feet so the sprites read as
                planted on the stage instead of floating. Drawn behind sprites. */}
            <GroundShadow rect={MANAGER_SEAT} />
            {seated.map((slot, i) => (
              <GroundShadow key={`shadow-${slot.key}`} rect={SEATS[i]} />
            ))}

            {/* Per-agent CAT figures: transparent per-archetype × per-status
                sprites grounded on the empty stage at each seat. These swap
                live as the agent's status changes (crossfade, no box/frame). */}
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

            {/* Specialist hotspots over painted cats */}
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

      {/* Tiny floating mode chip (top-left). */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2 px-2.5 py-1 rounded-full pointer-events-none"
        style={{ background: "rgba(8,12,24,0.7)", border: "1px solid rgba(139,92,246,0.3)", backdropFilter: "blur(4px)" }}>
        <Layers size={12} className="text-violet-400" />
        <span className="text-slate-200/90" style={{ fontSize: 10, letterSpacing: "0.04em" }}>{workflowLabel(workflow)}</span>
      </div>

      {/* Selected detail — floating top-right, off the painted panels. */}
      {selected && (
        <div className="absolute top-3 right-3 z-40">
          <AgentDetailPanel slot={selected} events={events} onClose={() => setSelectedKey(null)} />
        </div>
      )}
    </div>
  );
}

// ─── Hotspot: invisible hit area over a painted cat ──────────────────────────
// The button is a fully transparent hit target with NO border, box, glow, dot,
// tooltip, or hover/selection rectangle painted over the cat. It only opens the
// detail panel on click; every cat's face and body stays completely clean and
// the only visible chrome is the small live status badge (see StatusBadge).
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
