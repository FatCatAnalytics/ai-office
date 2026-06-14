// Stage 6.14.2 — Mission Control composite renderer.
//
// Renders the painted HUD with the cat interiors and nameplate bands cleared
// (empty_frame.png) and composites per-archetype sprite portraits + live HTML
// labels on top. Sprites swap with a cross-dissolve when the roster's archetype
// for a seat changes (e.g. a "diligence" workflow rotates Calcuclaw onto the
// bench during due-diligence flows). All seat geometry is the same set of
// percentage rectangles MissionControlMode.tsx already uses, so hotspots and
// card highlights line up exactly with the sprites.
//
// A `?calibrate=1` URL parameter shows the seat rectangles and their coords for
// visual tuning — never used in production but kept in the bundle so designers
// can flip it on without a rebuild.

import { useMemo } from "react";
import emptyFrame from "@assets/fatcat/sprites/empty_frame.png";
import {
  archetypeSpriteUrl, FATCAT_STATUS_META, type RosterSlot,
} from "../../lib/fatcatRoster";

export interface SeatRect { x: number; y: number; w: number; h: number; }

interface Props {
  manager: RosterSlot;
  seated: RosterSlot[];
  seats: SeatRect[];
  managerSeat: SeatRect;
  /** Optional explicit override (test/storybook). Falls back to URL ?calibrate=1. */
  calibrate?: boolean;
}

/** Read ?calibrate=1 once per render — cheap, no router dependency. */
function readCalibrateParam(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("calibrate") === "1";
  } catch {
    return false;
  }
}

export default function MissionControlCanvas({
  manager, seated, seats, managerSeat, calibrate,
}: Props) {
  const isCalibrate = calibrate ?? readCalibrateParam();

  // Pair each seat with its slot (skip empties so we don't render a default sprite
  // when the workflow uses fewer than 6 specialists).
  const filledSeats = useMemo(
    () => seated.map((slot, i) => ({ slot, seat: seats[i] })).filter((p) => p.seat),
    [seated, seats],
  );

  return (
    <>
      {/* Background: HUD chrome with cleared seat interiors + nameplate bands. */}
      <img
        src={emptyFrame}
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-fill select-none"
        draggable={false}
      />

      {/* Manager sprite (center seat, taller than committee seats). */}
      <SeatSprite slot={manager} seat={managerSeat} kind="manager" />

      {/* Committee sprites (6 seats around the manager). */}
      {filledSeats.map(({ slot, seat }) => (
        <SeatSprite key={slot.key} slot={slot} seat={seat} kind="committee" />
      ))}

      {/* Live name/role/status labels in the cleared nameplate bands. */}
      <SeatLabel slot={manager} seat={managerSeat} kind="manager" />
      {filledSeats.map(({ slot, seat }) => (
        <SeatLabel key={`lbl-${slot.key}`} slot={slot} seat={seat} kind="committee" />
      ))}

      {/* Calibration overlay — only when ?calibrate=1 */}
      {isCalibrate && <CalibrationOverlay seats={seats} managerSeat={managerSeat} />}
    </>
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
  // Manager is painted larger and shifted slightly down vs the seat rect; the
  // ratios below match the empty_frame.png mask used to clear the painted figure.
  const heightScale = kind === "manager" ? 1.15 : 1.0;
  const yOffsetPct = kind === "manager" ? 1 : 1; // both nudge ~1% down so paws sit on the painted glow

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
        width: `${seat.w * 1.05}%`,
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
  slot, seat, kind,
}: { slot: RosterSlot; seat: SeatRect; kind: "manager" | "committee" }) {
  const meta = FATCAT_STATUS_META[slot.status];
  // Nameplate band y = seat centre + (h * 0.58). Manager has a wider band painted
  // beneath the dais ("FATCAT MANAGER / Task Orchestrator") so we widen it.
  const bandWidthPct = kind === "manager" ? seat.w * 1.9 : seat.w * 1.0;
  const bandTopPct   = seat.y + seat.h * 0.50;

  return (
    <div
      className="fc-seat-label absolute pointer-events-none"
      style={{
        left: `${seat.x}%`,
        top: `${bandTopPct}%`,
        width: `${bandWidthPct}%`,
        transform: "translateX(-50%)",
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
