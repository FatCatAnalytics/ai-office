/**
 * officeWaypoints — pre-computed wander targets in world (px) coordinates.
 *
 * Stage 6.7: each team zone gets a handful of waypoints inside its rug
 * footprint (so agents don't walk into walls). A shared "common" zone is
 * built from the corridor strip between team rows + the lounge area so
 * agents can mingle across teams.
 *
 * Keep this file in sync with the iso constants in IsometricOffice.tsx.
 * The duplication is deliberate — re-exporting from IsometricOffice would
 * pull the whole SVG component into anything that needs a waypoint.
 */

const TW = 120;
const TH = 60;
const ORIGIN_X = 1300;
const ORIGIN_Y = 280;

function iso(col: number, row: number): [number, number] {
  return [
    ORIGIN_X + (col - row) * TW / 2,
    ORIGIN_Y + (col + row) * TH / 2,
  ];
}

export interface Waypoint {
  x: number;
  y: number;
}

// Spriteype → wander zone key. Each agent type has a "home" zone.
export const WANDER_ZONES: Record<string, string> = {
  manager: "manager",
  frontend: "frontend",
  pm: "frontend",
  backend: "backend",
  dbarchitect: "backend",
  qa: "qa",
  uiux: "uiux",
  devops: "devops",
  secengineer: "devops",
  datascientist: "data",
  harvester: "data",
};

// Source-of-truth zone rectangles (must mirror ZONES in IsometricOffice.tsx).
// We sample interior tiles a half-step in from the edge so agents stay on
// the rug rather than clipping the wall outline.
const ZONE_RECTS: Record<string, { col: number; row: number; w: number; d: number }> = {
  manager:  { col: 10, row: 1,  w: 5, d: 4 },
  frontend: { col: 1,  row: 6,  w: 6, d: 5 },
  backend:  { col: 9,  row: 6,  w: 6, d: 5 },
  qa:       { col: 17, row: 6,  w: 5, d: 5 },
  uiux:     { col: 1,  row: 13, w: 6, d: 5 },
  devops:   { col: 9,  row: 13, w: 6, d: 5 },
  data:     { col: 17, row: 13, w: 5, d: 5 },
};

function sampleZone(rect: { col: number; row: number; w: number; d: number }): Waypoint[] {
  const out: Waypoint[] = [];
  // Sample interior at half-step grid for natural-feeling stop spots.
  for (let dc = 0.5; dc < rect.w; dc += 1) {
    for (let dr = 0.5; dr < rect.d; dr += 1) {
      const [x, y] = iso(rect.col + dc, rect.row + dr);
      out.push({ x, y });
    }
  }
  return out;
}

// "Common" — corridor + lounge points anyone can wander to.
function buildCommonWaypoints(): Waypoint[] {
  const out: Waypoint[] = [];
  // Horizontal corridors between zone rows
  for (let c = 2; c < 22; c += 2) {
    out.push({ x: iso(c, 11)[0], y: iso(c, 11)[1] }); // between row 6 and row 13
    out.push({ x: iso(c, 5)[0],  y: iso(c, 5)[1]  }); // between manager and team row
  }
  // Lounge area (LOUNGE in IsometricOffice: col 21..23, row 2..6)
  for (let c = 21; c < 24; c += 1) {
    for (let r = 2; r < 7; r += 2) {
      const [x, y] = iso(c + 0.5, r + 0.5);
      out.push({ x, y });
    }
  }
  return out;
}

export const WAYPOINT_TABLE: Record<string, Waypoint[]> = {
  manager:  sampleZone(ZONE_RECTS.manager),
  frontend: sampleZone(ZONE_RECTS.frontend),
  backend:  sampleZone(ZONE_RECTS.backend),
  qa:       sampleZone(ZONE_RECTS.qa),
  uiux:     sampleZone(ZONE_RECTS.uiux),
  devops:   sampleZone(ZONE_RECTS.devops),
  data:     sampleZone(ZONE_RECTS.data),
  common:   buildCommonWaypoints(),
};
