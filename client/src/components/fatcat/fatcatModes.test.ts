// Stage 6.12.x — guards that the FatCat visual modes are asset-backed AND that
// they render live, data-bound status with NO hover/selection boxes.
//
// History:
//   • 6.12   shipped emoji/CSS placeholder cats — a visual miss.
//   • 6.12.2 replaced them with the approved FatCat artwork as the canvas, the
//     roster only driving overlay hotspots/labels.
//   • 6.12.4 moved feedback onto a per-card highlight box (CardHighlight) shown
//     on hover/selection or when an agent was live.
//   • this stage REMOVES those hover/selection highlight boxes entirely (the
//     founder asked for "no hovering selection boxes" and "no active areas")
//     and replaces them with a small, always-present, data-bound StatusBadge so
//     each cat card reflects its agent's LIVE status (Idle / Processing… /
//     Reviewing… / Blocked / Complete).
//
// There is no DOM test environment configured (vitest runs in node, no jsdom),
// so these guards assert at the source level. The StatusBadge's status→label
// mapping is exercised directly in fatcatRoster.test.ts via the exported helper
// data; here we assert the rendering wiring and the absence of the old chrome.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { statusBadgeLabel } from "./shared";
import { mapAgentStatus } from "../../lib/fatcatRoster";
import type { Agent } from "../../types";

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
    }
  });

  // ── No hover / selection / active-area boxes anywhere ─────────────────────
  // The founder's explicit ask: "remove the hovering selection boxes, they do
  // not add any value" and "do not have any active areas". These guard against
  // any of the old highlight-box machinery being reintroduced.

  it("the hover/selection highlight box component is gone", () => {
    // CardHighlight (and the older WorkingHighlight) drew rectangular outline /
    // glow boxes over the cards on hover/selection/active — fully removed.
    expect(read(SHARED)).not.toMatch(/CardHighlight|WorkingHighlight/);
    for (const file of [ISO, MISSION]) {
      expect(read(file)).not.toMatch(/CardHighlight|WorkingHighlight/);
    }
  });

  it("no mode tracks a hovered-key or reveals chrome on hover/focus", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      // No hovered-key state and no mouse/focus handlers that would light up a
      // box. Clicking a cat still works (onClick={onSelect}).
      expect(src).not.toMatch(/hoveredKey|setHoveredKey/);
      expect(src).not.toMatch(/onMouseEnter|onMouseLeave/);
      expect(src).not.toMatch(/revealed=/);
      expect(src).toMatch(/onClick=\{onSelect\}/);
    }
  });

  it("no reveal-on-hover ring/tooltip/dot CSS survives in shared styles", () => {
    const css = read(SHARED);
    expect(css).not.toMatch(/fc-hot-ring|fc-hot-tip|fc-dot-quiet|fc-dot-active/);
    // The reveal opacity gate that used hover/focus to fade chrome in is gone.
    expect(css).not.toMatch(/:hover\s+\.fc-hot-ring|fc-hot-on/);
  });

  it("renders NO status box, ring, or working-glow over the cat in either mode", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      expect(src).not.toMatch(/fc-dot-active|fc-dot-quiet/);
      expect(src).not.toMatch(/WorkingHighlight/);
      expect(src).not.toMatch(/fc-hot-ring|fc-hot-tip/);
    }
  });

  it("does not render an always-on nameplate/label box over the artwork", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      expect(src).not.toMatch(/opacity-90 group-hover/);
      expect(src).not.toMatch(/Name plate anchored/);
    }
  });

  it("does not rely on a browser default focus outline over the art", () => {
    const css = read(SHARED);
    expect(css).toMatch(/\.fc-hot\s*\{[^}]*outline:\s*none/);
    for (const file of [ISO, MISSION]) {
      expect(read(file)).toMatch(/className="fc-hot absolute"/);
    }
  });

  // ── Live, data-bound status badge per cat card ────────────────────────────

  it("both modes render a live StatusBadge bound to each slot's status", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      expect(src).toMatch(/StatusBadge/);
      // The badge is driven by the slot's real (live-agent) status, not a
      // constant or random value.
      expect(src).toMatch(/<StatusBadge[\s\S]*?status=\{manager\.status\}/);
      expect(src).toMatch(/status=\{slot\.status\}/);
    }
  });

  it("the StatusBadge has no border-box outline and is centred on the card edge", () => {
    const css = read(SHARED);
    const badge = css.slice(css.indexOf("export function StatusBadge"), css.indexOf("function statusBadgeLabel"));
    // It's a small pill, not a full-card outline: it uses a pill radius and a
    // translate to sit just outside the card edge — never an inset:0 frame.
    expect(badge).toMatch(/borderRadius:\s*999/);
    expect(badge).not.toMatch(/inset:\s*0/);
  });

  it("a cat card reflects the agent's live status prop (working → Processing…)", () => {
    // End-to-end mapping the badge uses: live Agent.status → FatCatStatus →
    // human label. A genuinely working agent's card must read "Processing…".
    const working: Agent["status"] = "working";
    expect(statusBadgeLabel(mapAgentStatus(working))).toBe("Processing…");

    // Other real states map to their own labels (not random/fake values).
    expect(statusBadgeLabel(mapAgentStatus("thinking"))).toBe("Reviewing…");
    expect(statusBadgeLabel(mapAgentStatus("blocked"))).toBe("Blocked");
    expect(statusBadgeLabel(mapAgentStatus("done"))).toBe("Complete");
    // An idle agent shows a calm "Idle" with no flashy state.
    expect(statusBadgeLabel(mapAgentStatus("idle"))).toBe("Idle");
  });

  // ── Dynamic per-archetype × status CAT sprites ────────────────────────────

  it("both modes render a FatCatSprite bound to each slot's archetype + status", () => {
    for (const file of [ISO, MISSION]) {
      const src = read(file);
      expect(src).toMatch(/FatCatSprite/);
      // The manager and committee/specialist sprites are data-bound, not constant.
      expect(src).toMatch(/<FatCatSprite[\s\S]*?archetype=\{manager\.archetype\}[\s\S]*?status=\{manager\.status\}/);
      expect(src).toMatch(/archetype=\{slot\.archetype\}/);
      expect(src).toMatch(/status=\{slot\.status\}/);
    }
  });

  it("the sprite is an object-contain transparent figure, not a box/frame", () => {
    const css = read(SHARED);
    const sprite = css.slice(css.indexOf("export function FatCatSprite"), css.indexOf("export function StatusPill"));
    expect(sprite).toMatch(/objectFit:\s*["']contain["']/);
    expect(sprite).toMatch(/background:\s*["']transparent["']/);
    // No border/outline frame is drawn around the cat.
    expect(sprite).not.toMatch(/border:\s*[`"']?\d/);
    expect(sprite).not.toMatch(/inset:\s*0/);
  });

  it("keeps hotspot hit zones tight (no oversized rectangles spanning panels)", () => {
    // Guard against regressing to huge seats.
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
