// Stage 6.12.2 — guards that the FatCat visual modes are asset-backed.
//
// Stage 6.12 shipped emoji/CSS placeholder cats (a generated <FatCatAvatar> SVG
// cat head + circle auras), which was a visual miss. Stage 6.12.2 replaces them
// with the approved FatCat artwork used as the canvas, with the roster only
// driving overlay hotspots/labels. There is no DOM test environment configured
// (vitest runs in node, no jsdom), so these guards assert at the source level:
//
//   1. each mode imports its approved image asset and renders it as an <img>;
//   2. no mode (or shared primitive) references the removed placeholder avatar.
//
// If someone reintroduces a generated cat avatar, these tests fail loudly.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

const ISO = "IsometricOfficeMode.tsx";
const MISSION = "MissionControlMode.tsx";
const SHARED = "shared.tsx";

describe("FatCat modes are asset-backed (approved artwork, not placeholders)", () => {
  it("the approved image assets exist in the repo", () => {
    const assets = resolve(here, "../../../../attached_assets/fatcat");
    expect(existsSync(resolve(assets, "fatcat_isometric_office.jpg"))).toBe(true);
    expect(existsSync(resolve(assets, "fatcat_mission_control.jpg"))).toBe(true);
  });

  it("Isometric Office imports and renders the approved image as the canvas", () => {
    const src = read(ISO);
    expect(src).toMatch(/import\s+officeImage\s+from\s+["']@assets\/fatcat\/fatcat_isometric_office\.jpg["']/);
    expect(src).toMatch(/<img[\s\S]*src=\{officeImage\}/);
  });

  it("Mission Control imports and renders the approved image as the canvas", () => {
    const src = read(MISSION);
    expect(src).toMatch(/import\s+missionImage\s+from\s+["']@assets\/fatcat\/fatcat_mission_control\.jpg["']/);
    expect(src).toMatch(/<img[\s\S]*src=\{missionImage\}/);
  });

  it("no mode reintroduces the removed placeholder FatCatAvatar", () => {
    for (const file of [ISO, MISSION, SHARED]) {
      expect(read(file)).not.toMatch(/FatCatAvatar/);
    }
  });

  it("the placeholder FatCatAvatar component is gone", () => {
    expect(existsSync(resolve(here, "FatCatAvatar.tsx"))).toBe(false);
  });

  it("modes do not render emoji cat faces", () => {
    // The literal cat/emoji glyphs that a placeholder implementation might use.
    const emojiCats = /🐱|🐈|😺|😸|🙀/u;
    for (const file of [ISO, MISSION, SHARED]) {
      expect(read(file)).not.toMatch(emojiCats);
    }
  });

  it("hotspots over painted cats carry accessible labels", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      // Every hotspot button advertises name + role + status to screen readers.
      expect(src).toMatch(/aria-label=\{`\$\{slot\.name\}, \$\{slot\.roleLabel\}/);
    }
  });

  it("hotspot buttons are transparent hit areas (no painted box/border on the cat)", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      // The button itself draws nothing over the artwork — it is a pure hit area.
      expect(src).toMatch(/background:\s*["']transparent["']/);
      expect(src).toMatch(/border:\s*["']none["']/);
      expect(src).toMatch(/className="fc-hot absolute"/);
      // The cat no longer carries a ring, tooltip, or dot — feedback moved to the
      // painted info card (see CardHighlight). Assert those are gone from the cat.
      expect(src).not.toMatch(/className="fc-hot-ring"/);
      expect(src).not.toMatch(/className="fc-hot-tip"/);
    }
  });

  it("interaction highlights the painted CARD, not the cat", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      // Each mode imports + renders the shared CardHighlight over a card rect.
      expect(src).toMatch(/CardHighlight/);
      // The card lights up when its agent is live (active) OR on hover/select.
      expect(src).toMatch(/active=\{isActiveStatus\(/);
      expect(src).toMatch(/revealed=\{hovered[Kk]ey === [\s\S]*?selectedKey ===/);
      // The cat hit area drives a shared hovered-key, not its own decoration.
      expect(src).toMatch(/onMouseEnter=\{\(\) => onHover\(slot\.key\)\}/);
      expect(src).toMatch(/onMouseLeave=\{\(\) => onHover\(null\)\}/);
    }
  });

  it("the card-highlight is hidden by default and only shown when active/revealed", () => {
    const css = read(SHARED);
    // CardHighlight is opacity-gated: off unless active or revealed.
    expect(css).toMatch(/const on = active \|\| revealed/);
    expect(css).toMatch(/opacity:\s*on \?\s*1\s*:\s*0/);
  });

  it("does not render an always-on nameplate/label box over the artwork", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      // No persistent label class on the canvas. The previous version anchored a
      // nameplate under each seat with opacity-90 / group-hover; that is gone —
      // labels now live only inside the opt-in .fc-hot-tip tooltip.
      expect(src).not.toMatch(/opacity-90 group-hover/);
      expect(src).not.toMatch(/Name plate anchored/);
    }
  });

  // ── Stage 6.12.4: feedback lives on the painted card, the cat stays clean ──

  it("renders NO status dot, ring, or working-glow over the cat in either mode", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      // None of the old cat-decoration markers survive in the modes.
      expect(src).not.toMatch(/fc-dot-active|fc-dot-quiet/);
      expect(src).not.toMatch(/WorkingHighlight/);
      expect(src).not.toMatch(/fc-hot-ring|fc-hot-tip/);
    }
  });

  it("only genuinely active agents get a persistent card glow; others reveal-only", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      // Active = working/verifying/blocked (via isActiveStatus) → persistent card
      // glow; everything else lights up only on hover/focus/selection.
      expect(src).toMatch(/active=\{isActiveStatus\(/);
    }
  });

  it("does not rely on a browser default focus outline over the art", () => {
    // The hotspot button outline is reset in CSS; focus is surfaced by lighting
    // up the associated card instead.
    const css = read(SHARED);
    expect(css).toMatch(/\.fc-hot\s*\{[^}]*outline:\s*none/);
    for (const file of [ISO, MISSION]) {
      expect(read(file)).toMatch(/className="fc-hot absolute"/);
    }
  });

  it("keyboard focus also lights the card (focus/blur drive the shared hover key)", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      expect(src).toMatch(/onFocus=\{\(\) => onHover\(slot\.key\)\}/);
      expect(src).toMatch(/onBlur=\{\(\) => onHover\(null\)\}/);
    }
  });

  it("keeps hotspot hit zones tight (no oversized rectangles spanning panels)", () => {
    // Guard against regressing to huge seats. Every seat width/height is kept
    // modest so a revealed ring hugs a single cat, never a whole panel.
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      const seatBlock = src.slice(src.indexOf("const SEATS"), src.indexOf("MANAGER_SEAT"));
      const dims = [...seatBlock.matchAll(/w:\s*(\d+(?:\.\d+)?),\s*h:\s*(\d+(?:\.\d+)?)/g)];
      expect(dims.length).toBeGreaterThanOrEqual(6);
      for (const [, w, h] of dims) {
        expect(Number(w)).toBeLessThanOrEqual(14);
        expect(Number(h)).toBeLessThanOrEqual(28);
      }
    }
  });
});
