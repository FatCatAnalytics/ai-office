// Stage 6.14.2 — composite renderer source-shape tests.
//
// We don't have @testing-library/react in the bundle, so these tests do what
// the rest of the fatcat test suite does: read the component source and assert
// the contract we care about (right exports, right imports, right wiring).
// Behavioural tests for the sprite URL lookup live in fatcatRoster.test.ts.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const CANVAS = resolve(here, "MissionControlCanvas.tsx");
const SHARED = resolve(here, "shared.tsx");
const read = (p: string) => readFileSync(p, "utf-8");

describe("MissionControlCanvas — composite renderer", () => {
  it("imports the emptied HUD frame as the background asset", () => {
    const src = read(CANVAS);
    expect(src).toMatch(/import\s+emptyFrame\s+from\s+["']@assets\/fatcat\/sprites\/empty_frame\.png["']/);
    expect(src).toMatch(/<img[\s\S]*src=\{emptyFrame\}/);
  });

  it("uses archetypeSpriteUrl() to resolve per-seat sprites", () => {
    const src = read(CANVAS);
    expect(src).toMatch(/import[\s\S]*archetypeSpriteUrl[\s\S]*from[\s\S]*fatcatRoster/);
    expect(src).toMatch(/archetypeSpriteUrl\(slot\.archetype\)/);
  });

  it("keys each sprite <img> by archetype so React remounts on swap (triggers fade-in)", () => {
    const src = read(CANVAS);
    // Each SeatSprite renders <img key={slot.archetype} ...>
    expect(src).toMatch(/key=\{slot\.archetype\}/);
    // And the class triggers the fcSpriteFadeIn animation.
    expect(src).toMatch(/className="fc-sprite[^"]*"/);
  });

  it("renders a separate sprite for the manager (taller scale) and the committee seats", () => {
    const src = read(CANVAS);
    expect(src).toMatch(/<SeatSprite\s+slot=\{manager\}/);
    expect(src).toMatch(/filledSeats\.map/);
    // Manager and committee branches diverge on heightScale. Manager is upscaled,
    // committee is downscaled to leave breathing room between adjacent painted rows.
    expect(src).toMatch(/kind === "manager" \? 1\.15 : 0\.85/);
  });

  it("overlays live name + role + status in the cleared nameplate band", () => {
    const src = read(CANVAS);
    expect(src).toMatch(/SeatLabel/);
    expect(src).toMatch(/\{slot\.name\}/);
    expect(src).toMatch(/\{slot\.roleLabel\}/);
    // The status meta label feeds into the same pill.
    expect(src).toMatch(/FATCAT_STATUS_META\[slot\.status\]/);
  });

  it("?calibrate=1 toggles a seat-outline overlay (read from window.location.search)", () => {
    const src = read(CANVAS);
    expect(src).toMatch(/URLSearchParams/);
    // Stage 6.15.1: calibrate mode is now tri-state (false | "seats" | "panels").
    // ?calibrate=1 still resolves to "seats" for backwards-compatibility.
    expect(src).toMatch(/if \(v === "1"\) return "seats"/);
    expect(src).toMatch(/CalibrationOverlay/);
  });

  it("exposes a `calibrate` prop override so tests/storybook can force the overlay without window", () => {
    const src = read(CANVAS);
    // Stage 6.15.1: prop is `CalibrateMode` (false | "seats" | "panels").
    expect(src).toMatch(/calibrate\?: CalibrateMode/);
    expect(src).toMatch(/calibrate \?\? readCalibrateParam\(\)/);
  });

  // ─── Stage 6.15.1 ──────────────────────────────────────────────────

  it("exports PANEL_ZONES_PCT mirroring the alpha-mask coords in make_emptied_frame.py", () => {
    const src = read(CANVAS);
    expect(src).toMatch(/export const PANEL_ZONES_PCT/);
    // Stage 6.15.5: tightened to match the new empty_frame punch zones so the
    // painted header + outer border survive the alpha mask.
    expect(src).toMatch(/workflowOverview:\s*\{\s*l:\s*3\.0,\s*t:\s*12\.0,\s*r:\s*22\.2,\s*b:\s*38\.0\s*\}/);
    expect(src).toMatch(/taskStream:\s*\{\s*l:\s*25\.0,\s*t:\s*62\.5,\s*r:\s*70\.3,\s*b:\s*75\.5\s*\}/);
  });

  it("renders WorkflowOverviewPanel and TaskStreamPanel inside PanelSlots", () => {
    const src = read(CANVAS);
    expect(src).toMatch(/import WorkflowOverviewPanel from "\.\/WorkflowOverviewPanel"/);
    expect(src).toMatch(/import TaskStreamPanel from "\.\/TaskStreamPanel"/);
    expect(src).toMatch(/<PanelSlot zone=\{PANEL_ZONES_PCT\.workflowOverview\}>/);
    expect(src).toMatch(/<PanelSlot zone=\{PANEL_ZONES_PCT\.taskStream\}>/);
    expect(src).toMatch(/<WorkflowOverviewPanel tasks=\{tasks\}/);
    expect(src).toMatch(/<TaskStreamPanel tasks=\{tasks\} agents=\{agents\}/);
  });

  it("passes pointer-events: none on PanelSlot so hotspots stay clickable through the panel", () => {
    const src = read(CANVAS);
    // The PanelSlot wrapper must NOT trap pointer events — sprite hotspots sit
    // partly under the painted task-stream panel, and they must stay clickable.
    expect(src).toMatch(/pointerEvents:\s*"none"/);
  });

  it("?calibrate=panels renders the PanelCalibrationOverlay (sprites stay visible)", () => {
    const src = read(CANVAS);
    expect(src).toMatch(/if \(v === "panels"\) return "panels"/);
    expect(src).toMatch(/isPanelCal && <PanelCalibrationOverlay/);
    // PanelCalibrationOverlay is gated by isPanelCal, NOT isSeatCal, so sprites
    // remain rendered for the live-composite preview the designer is tuning.
    expect(src).toMatch(/function PanelCalibrationOverlay/);
  });

  it("hides sprites + live labels + panels only in seat-calibration mode (?calibrate=1)", () => {
    const src = read(CANVAS);
    // Both the sprite block and the panel block must be gated by `!isSeatCal`.
    const seatGuards = src.match(/\{!isSeatCal && \(/g) ?? [];
    expect(seatGuards.length).toBeGreaterThanOrEqual(2);
  });

  it("the fcSpriteFadeIn keyframe is defined in shared FatCatStyles", () => {
    const src = read(SHARED);
    expect(src).toMatch(/@keyframes fcSpriteFadeIn/);
    expect(src).toMatch(/\.fc-sprite \{ animation: fcSpriteFadeIn/);
    // And respects prefers-reduced-motion.
    expect(src).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.fc-sprite \{ animation: none/);
  });

  it("does not re-import the original missionImage (cats now come from sprites)", () => {
    const src = read(CANVAS);
    expect(src).not.toMatch(/fatcat_mission_control\.jpg/);
  });
});
