// Stage 6.14.2 — Mission Control composite renderer.
// Stage 6.15.1 — Adds the live <WorkflowOverviewPanel/> and <TaskStreamPanel/>
// inside the cleared panel interiors of empty_frame.png. The painted panel
// border + header label ("WORKFLOW OVERVIEW" / "CURRENT TASK STREAM") in the
// JPG art still show — only the interiors are transparent, so the React panels
// render against the painted chrome at a sharp seam.
//
// Renders the painted HUD with the cat interiors and nameplate bands cleared
// (empty_frame.png) and composites per-archetype sprite portraits + live HTML
// labels on top. Sprites swap with a cross-dissolve when the roster's archetype
// for a seat changes (e.g. a "diligence" workflow rotates Calcuclaw onto the
// bench during due-diligence flows). All seat geometry is the same set of
// percentage rectangles MissionControlMode.tsx already uses, so hotspots and
// card highlights line up exactly with the sprites.
//
// URL params for live tuning (never used in production but kept in the bundle):
//   ?calibrate=1       — show seat rectangles + coords (sprites + panels hidden)
//   ?calibrate=panels  — show only the panel-zone outlines (sprites visible)

import { useMemo } from "react";
import emptyFrame from "@assets/fatcat/sprites/empty_frame.png";
import {
  archetypeSpriteUrl, FATCAT_STATUS_META, type RosterSlot,
} from "../../lib/fatcatRoster";
import type { Agent, Task } from "../../types";
import WorkflowOverviewPanel from "./WorkflowOverviewPanel";
import TaskStreamPanel from "./TaskStreamPanel";

export interface SeatRect { x: number; y: number; w: number; h: number; }

/**
 * Panel zone rectangles — % of 1536×1024, in `{l,t,r,b}` (left/top/right/bottom)
 * form so they exactly mirror the mask coords in `make_emptied_frame.py`. The
 * React panels render INSIDE these rects, against the painted border + header.
 *
 * If you change these, also update `PANEL_INTERIORS_PCT` in
 * `make_emptied_frame.py` and regenerate `empty_frame.png` so the alpha holes
 * line up.
 */
// Stage 6.15.5: tightened to overlay only the cleared interior. The painted
// main header ("WORKFLOW OVERVIEW" / "CURRENT TASK STREAM") at the top of each
// panel survives the mask and is shown by the empty_frame.png underneath.
//
// Task Stream zone: visual width matches the painted panel border (l=25, r=70.3),
// even though the alpha-mask punch clears further right (to r=75.8) to remove
// painted "Xm ago" timestamps that overflow past the border. The cleared
// negative space beyond r=70.3 stays empty — React renders a tidy bordered
// panel inside the painted frame.
export const PANEL_ZONES_PCT = {
  workflowOverview: { l:  3.0, t: 12.0, r: 22.2, b: 38.0 },
  taskStream:       { l: 25.0, t: 62.5, r: 70.3, b: 75.5 },
} as const;

export type CalibrateMode = false | "seats" | "panels";

interface Props {
  manager: RosterSlot;
  seated: RosterSlot[];
  seats: SeatRect[];
  managerSeat: SeatRect;
  tasks: Task[];
  agents: Agent[];
  /** Override calibrate mode (test/storybook). Falls back to URL `?calibrate=`. */
  calibrate?: CalibrateMode;
}

/** Read `?calibrate=...` once per render — cheap, no router dependency. */
function readCalibrateParam(): CalibrateMode {
  if (typeof window === "undefined") return false;
  try {
    const v = new URLSearchParams(window.location.search).get("calibrate");
    if (v === "1") return "seats";
    if (v === "panels") return "panels";
    return false;
  } catch {
    return false;
  }
}

export default function MissionControlCanvas({
  manager, seated, seats, managerSeat, tasks, agents, calibrate,
}: Props) {
  const calMode: CalibrateMode = calibrate ?? readCalibrateParam();
  const isSeatCal = calMode === "seats";
  const isPanelCal = calMode === "panels";

  // Pair each seat with its slot (skip empties so we don't render a default sprite
  // when the workflow uses fewer than 6 specialists).
  const filledSeats = useMemo(
    () => seated.map((slot, i) => ({ slot, seat: seats[i] })).filter((p) => p.seat),
    [seated, seats],
  );

  return (
    <>
      {/* Background: HUD chrome with cleared seat interiors + nameplate bands
          + cleared panel interiors (WORKFLOW OVERVIEW + CURRENT TASK STREAM). */}
      <img
        src={emptyFrame}
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-fill select-none"
        draggable={false}
      />

      {/* Live data panels — render in both normal mode AND ?calibrate=panels so
          designers can position them against the painted chrome. They are
          hidden only in full seat-calibration mode (?calibrate=1). */}
      {!isSeatCal && (
        <>
          <PanelSlot zone={PANEL_ZONES_PCT.workflowOverview}>
            <WorkflowOverviewPanel tasks={tasks} />
          </PanelSlot>
          <PanelSlot zone={PANEL_ZONES_PCT.taskStream}>
            <TaskStreamPanel tasks={tasks} agents={agents} />
          </PanelSlot>
        </>
      )}

      {/* In ?calibrate=1 mode we hide sprites and labels so the dashed seat rects
          + coord labels read cleanly. Sprite/label placement is validated via the
          idle and diligence screenshots instead. */}
      {!isSeatCal && (
        <>
          {/* Manager sprite (center seat, taller than committee seats). */}
          <SeatSprite slot={manager} seat={managerSeat} kind="manager" />

          {/* Committee sprites (6 seats around the manager). */}
          {filledSeats.map(({ slot, seat }) => (
            <SeatSprite key={slot.key} slot={slot} seat={seat} kind="committee" />
          ))}

          {/* Live name/role/status labels in the cleared nameplate bands. */}
          {/* Stage 6.15.3: lower-row seats (indices 2 and 5 in the SEATS array)
              flip their label pill above the sprite so it doesn't drape into
              the painted task-stream panel that sits immediately below. */}
          <SeatLabel slot={manager} seat={managerSeat} kind="manager" />
          {filledSeats.map(({ slot, seat }, i) => {
            const seatIdx = seats.indexOf(seat);
            const isBottomRow = seatIdx === 2 || seatIdx === 5;
            return (
              <SeatLabel
                key={`lbl-${slot.key}`}
                slot={slot}
                seat={seat}
                kind="committee"
                placement={isBottomRow ? "above" : "below"}
              />
            );
          })}
        </>
      )}

      {/* Calibration overlays */}
      {isSeatCal && <CalibrationOverlay seats={seats} managerSeat={managerSeat} />}
      {isPanelCal && <PanelCalibrationOverlay />}
    </>
  );
}

// ─── PanelSlot: position a child inside a {l,t,r,b}% rect of the canvas ───────
//
// The parent <div> in MissionControlMode is already sized to the letterboxed
// image rect, so we just position absolutely as percentages. We DON'T use the
// translate(-50%, -50%) pattern the seats use — these rects are already in
// edge-anchored {l,t,r,b}% form.

function PanelSlot({
  zone, children,
}: { zone: { l: number; t: number; r: number; b: number }; children: React.ReactNode }) {
  return (
    <div
      className="absolute"
      style={{
        left: `${zone.l}%`,
        top: `${zone.t}%`,
        width: `${zone.r - zone.l}%`,
        height: `${zone.b - zone.t}%`,
        zIndex: 7, // above sprites (3/5), below seat labels (8) and hotspots (10/20)
        pointerEvents: "none", // hotspots stay clickable through the panel area
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

// ─── SeatSprite: per-archetype portrait at a seat rect ─────────────────────────
//
// keyed by archetype so React unmounts/remounts the <img> when the slot's
// archetype changes; the fc-sprite-fade-in animation provides the cross-dissolve.

function SeatSprite({
  slot, seat, kind,
}: { slot: RosterSlot; seat: SeatRect; kind: "manager" | "committee" }) {
  const src = archetypeSpriteUrl(slot.archetype);
  // Painted row centres in empty_frame.png (measured from alpha mask) sit ~17.5pp
  // apart; with sprite h=18pp the rows visibly overlap when all 6 seats are filled
  // (e.g. the diligence workflow). We shrink committee sprites to 15pp tall so
  // adjacent rows leave ~2pp of breathing room while still filling the painted
  // seat band. Manager keeps its larger silhouette (center column has no neighbours).
  const heightScale = kind === "manager" ? 1.15 : 0.85;
  const widthScale  = kind === "manager" ? 1.05 : 0.95;
  const yOffsetPct  = kind === "manager" ? 1   : 1; // nudge ~1% down so paws sit on the painted glow

  return (
    <img
      key={slot.archetype}  // remount on archetype change → triggers fade-in
      src={src}
      alt=""
      aria-hidden
      className="fc-sprite absolute pointer-events-none select-none"
      draggable={false}
      style={{
        left: `${seat.x}%`,
        top: `${seat.y + yOffsetPct}%`,
        width: `${seat.w * widthScale}%`,
        height: `${seat.h * heightScale}%`,
        transform: "translate(-50%, -50%)",
        objectFit: "contain",
        zIndex: kind === "manager" ? 5 : 3,
      }}
    />
  );
}

// ─── SeatLabel: live name + role + status pill in the cleared nameplate band ───

function SeatLabel({
  slot, seat, kind, placement = "below",
}: { slot: RosterSlot; seat: SeatRect; kind: "manager" | "committee"; placement?: "below" | "above" }) {
  const meta = FATCAT_STATUS_META[slot.status];
  // Painted nameplate bands sit just below each portrait, halfway between
  // adjacent row centres. Anchor the pill *centre* (not top) to that band so the
  // pill stays inside its own seat and doesn't overflow into the head of the
  // sprite in the row below. Manager has a wider painted band beneath the dais
  // ("FATCAT MANAGER / Task Orchestrator") so we widen the pill there.
  const bandWidthPct  = kind === "manager" ? seat.w * 1.9 : seat.w * 1.0;
  // Sprite visible bottom is roughly seat.y + (seat.h * heightScale / 2). Pill
  // centre sits ~1pp below that so the pill is fully outside the sprite silhouette
  // and fully inside its own seat band — never touching the head of the sprite
  // in the row below (rows are 17.5pp apart, sprite half-h is ~6.4pp, so 17.5 -
  // 6.4 = 11.1pp of clear vertical space below each sprite for the pill).
  //
  // Stage 6.15.3: bottom-row seats use placement="above" so the pill flips to
  // sit just above the sprite — the painted task-stream panel begins immediately
  // beneath the lower seats, leaving no room for a below-pill without intruding
  // into the panel chrome.
  const halfSpriteH   = kind === "manager" ? seat.h * 0.575 : seat.h * 0.425; // (heightScale/2)
  const bandCenterPct = placement === "above"
    ? seat.y - halfSpriteH - 1.0
    : seat.y + halfSpriteH + 1.0;

  return (
    <div
      className="fc-seat-label absolute pointer-events-none"
      style={{
        left: `${seat.x}%`,
        top: `${bandCenterPct}%`,
        width: `${bandWidthPct}%`,
        transform: "translate(-50%, -50%)",
        zIndex: 8,
      }}
    >
      <div
        className="px-2 py-1 rounded-md text-center"
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          background: "rgba(5, 10, 18, 0.55)",
          backdropFilter: "blur(2px)",
          border: `1px solid ${slot.color}55`,
        }}
      >
        <div
          className="truncate"
          style={{
            fontSize: kind === "manager" ? 13 : 10,
            fontWeight: 700,
            color: slot.color,
            letterSpacing: "0.02em",
          }}
        >
          {slot.name}
        </div>
        <div
          className="truncate"
          style={{
            fontSize: kind === "manager" ? 10 : 8,
            color: "rgba(220, 230, 240, 0.7)",
            marginTop: 1,
          }}
        >
          {slot.roleLabel} · {meta.label}
        </div>
      </div>
    </div>
  );
}

// ─── PanelCalibrationOverlay: dashed panel-zone outlines (?calibrate=panels) ──
//
// Renders ONLY the panel zone rects — sprites + cards + hotspots stay visible
// underneath so designers can tune panel boundaries against the live composite.

function PanelCalibrationOverlay() {
  const entries: { key: string; zone: { l: number; t: number; r: number; b: number }; label: string }[] = [
    { key: "wf", zone: PANEL_ZONES_PCT.workflowOverview, label: "WORKFLOW OVERVIEW" },
    { key: "ts", zone: PANEL_ZONES_PCT.taskStream,       label: "TASK STREAM" },
  ];
  return (
    <>
      {entries.map(({ key, zone, label }) => (
        <div
          key={`panel-cal-${key}`}
          className="absolute pointer-events-none"
          style={{
            left: `${zone.l}%`,
            top: `${zone.t}%`,
            width: `${zone.r - zone.l}%`,
            height: `${zone.b - zone.t}%`,
            border: "1px dashed rgba(125, 211, 252, 0.85)",
            background: "rgba(125, 211, 252, 0.05)",
            zIndex: 60,
            fontFamily: "monospace",
            fontSize: 10,
            color: "rgba(125, 211, 252, 0.95)",
            padding: 4,
          }}
        >
          {label} · l{zone.l}/t{zone.t} · r{zone.r}/b{zone.b}
        </div>
      ))}
    </>
  );
}

// ─── CalibrationOverlay: dashed seat outlines + coord labels (?calibrate=1) ────

function CalibrationOverlay({
  seats, managerSeat,
}: { seats: SeatRect[]; managerSeat: SeatRect }) {
  const all: { seat: SeatRect; label: string }[] = [
    { seat: managerSeat, label: "MANAGER" },
    ...seats.map((s, i) => ({ seat: s, label: `SEAT ${i}` })),
  ];
  return (
    <>
      {all.map(({ seat, label }, i) => (
        <div
          key={`cal-${i}`}
          className="absolute pointer-events-none"
          style={{
            left: `${seat.x}%`,
            top: `${seat.y}%`,
            width: `${seat.w}%`,
            height: `${seat.h}%`,
            transform: "translate(-50%, -50%)",
            border: "1px dashed rgba(255, 200, 0, 0.85)",
            background: "rgba(255, 200, 0, 0.04)",
            zIndex: 50,
            fontFamily: "monospace",
            fontSize: 10,
            color: "rgba(255, 220, 100, 0.95)",
            padding: 2,
          }}
        >
          {label} · {seat.x}/{seat.y} · {seat.w}×{seat.h}
        </div>
      ))}
    </>
  );
}
