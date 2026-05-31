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

  it("hotspot buttons are transparent hit areas (no painted box/border)", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      // The button itself draws nothing over the artwork.
      expect(src).toMatch(/background:\s*["']transparent["']/);
      expect(src).toMatch(/border:\s*["']none["']/);
      // Reveal chrome is opt-in via the .fc-hot class, not always-on.
      expect(src).toMatch(/className=\{`fc-hot /);
      expect(src).toMatch(/className="fc-hot-ring"/);
      expect(src).toMatch(/className="fc-hot-tip"/);
    }
  });

  it("the ring + tooltip are hidden by default and revealed only on hover/focus/selected", () => {
    const css = read(SHARED);
    // Default state: both reveal layers start fully transparent.
    expect(css).toMatch(/\.fc-hot \.fc-hot-ring,[\s\S]*?\.fc-hot \.fc-hot-tip\s*\{\s*opacity:\s*0/);
    // Revealed only via hover, keyboard focus, or the selected (.fc-hot-on) state.
    expect(css).toMatch(/\.fc-hot:hover \.fc-hot-ring/);
    expect(css).toMatch(/\.fc-hot:focus-visible \.fc-hot-ring/);
    expect(css).toMatch(/\.fc-hot\.fc-hot-on \.fc-hot-tip\s*\{\s*opacity:\s*1/);
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
});
