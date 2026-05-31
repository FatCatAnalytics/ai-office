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
});
