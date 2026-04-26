/**
 * IsometricOffice — full SVG isometric office floor
 *
 * Coordinate system:
 *   iso(col, row) → screen (x, y)
 *   x = (col - row) * TW/2 + ORIGIN_X
 *   y = (col + row) * TH/2 + ORIGIN_Y
 *
 * The "world" is a large 2D canvas. The user pans/zooms freely.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import type { Agent, Project } from "../types";

import managerImg       from "@assets/sprite_manager.png";
import frontendImg      from "@assets/sprite_frontend.png";
import backendImg       from "@assets/sprite_backend.png";
import qaImg            from "@assets/sprite_qa.png";
import uiuxImg          from "@assets/sprite_uiux.png";
import devopsImg        from "@assets/sprite_devops.png";
import dbarchitectImg   from "@assets/sprite_dbarchitect.png";
import datascientistImg from "@assets/sprite_datascientist.png";
import secengineerImg   from "@assets/sprite_secengineer.png";
import pmImg            from "@assets/sprite_pm.png";

interface Props { agents: Agent[]; project: Project | null; }

const SPRITE_MAP: Record<string, string> = {
  manager: managerImg, frontend: frontendImg, backend: backendImg,
  qa: qaImg, uiux: uiuxImg, devops: devopsImg,
  dbarchitect: dbarchitectImg, datascientist: datascientistImg,
  secengineer: secengineerImg, pm: pmImg,
};

// ─── Isometric grid constants ─────────────────────────────────────────────────
const TW = 120;   // tile width  (screen px per tile)
const TH = 60;    // tile height (TW/2 = classic 2:1 isometric)

// Office grid size
const COLS = 24;
const ROWS = 20;

// Wall height above floor
const WALL_H = 220;

// World canvas size (large so user can pan)
const WORLD_W = 3600;
const WORLD_H = 2400;

// Grid origin in world coords — floor top-back corner lands here
const ORIGIN_X = 1300;
const ORIGIN_Y = 280;

function iso(col: number, row: number): [number, number] {
  return [
    ORIGIN_X + (col - row) * TW / 2,
    ORIGIN_Y + (col + row) * TH / 2,
  ];
}

// ─── Zoom / pan ───────────────────────────────────────────────────────────────
const ZOOM_MIN  = 0.18;
const ZOOM_MAX  = 2.5;
const ZOOM_STEP = 0.08;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function fmt(n: number) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(n);
}

// ─── Team zone definitions ────────────────────────────────────────────────────
// Each zone: anchor tile (col, row), width in cols, depth in rows
interface Zone {
  id: string;
  label: string;
  col: number; row: number;
  w: number;   d: number;
  color: string;
  // Desk positions within zone (relative tile offsets)
  desks: [number, number][];
}

const ZONES: Zone[] = [
  {
    id: "manager", label: "Manager Agent",
    col: 10, row: 1, w: 5, d: 4,
    color: "#a855f7",
    desks: [[2, 2]],            // centre of 5w x 4d
  },
  {
    id: "frontend", label: "Frontend Dev Team",
    col: 1, row: 6, w: 6, d: 5,
    color: "#3b82f6",
    desks: [[1,2],[3,2],[1,4],[3,4]],   // centred rows in 6w x 5d
  },
  {
    id: "backend", label: "Backend Dev Team",
    col: 9, row: 6, w: 6, d: 5,
    color: "#10b981",
    desks: [[1,2],[3,2],[1,4],[3,4]],
  },
  {
    id: "qa", label: "QA Team",
    col: 17, row: 6, w: 5, d: 5,
    color: "#f59e0b",
    desks: [[1,2],[3,2],[2,4]],
  },
  {
    id: "uiux", label: "UI/UX Design Team",
    col: 1, row: 13, w: 6, d: 5,
    color: "#ec4899",
    desks: [[1,2],[3,2],[2,4]],
  },
  {
    id: "devops", label: "DevOps Team",
    col: 9, row: 13, w: 6, d: 5,
    color: "#06b6d4",
    desks: [[1,2],[3,2],[1,4],[3,4]],
  },
  {
    id: "data", label: "Data Team",
    col: 17, row: 13, w: 5, d: 5,
    color: "#8b5cf6",
    desks: [[1,2],[3,2],[2,4]],
  },
  {
    id: "hotdesk", label: "Hot Desk Zone",
    col: 2, row: 19, w: 9, d: 4,
    color: "#64748b",
    desks: [[1,2],[3,2],[5,2],[7,2],[2,4],[4,4],[6,4]],
  },
];

// Future Expansion zone (separate — just an outline, no desks)
const EXPANSION = { col: 13, row: 19, w: 10, d: 6 };

// Meeting area (lounge)
const LOUNGE = { col: 21, row: 2, w: 3, d: 5 };

// ─── Desk slot coordinates per agent type → zone + desk index ────────────────
// Maps agent spriteType → [zoneId, deskIndex]
const AGENT_DESK_MAP: Record<string, [string, number]> = {
  manager:      ["manager",  0],
  frontend:     ["frontend", 0],
  backend:      ["backend",  0],
  qa:           ["qa",       0],
  uiux:         ["uiux",     0],
  devops:       ["devops",   0],
  dbarchitect:  ["backend",  1],
  datascientist:["data",     0],
  secengineer:  ["devops",   1],
  pm:           ["frontend", 1],
};

function getAgentDeskPos(agent: Agent): [number, number] | null {
  const entry = AGENT_DESK_MAP[agent.spriteType];
  if (!entry) return null;
  const [zoneId, deskIdx] = entry;
  const zone = ZONES.find(z => z.id === zoneId);
  if (!zone) return null;
  const desk = zone.desks[deskIdx % zone.desks.length];
  if (!desk) return null;
  return iso(zone.col + desk[0], zone.row + desk[1]);
}

// ─── SVG floor tile ───────────────────────────────────────────────────────────
function tilePoly(col: number, row: number): string {
  const [x0, y0] = iso(col,   row);
  const [x1, y1] = iso(col+1, row);
  const [x2, y2] = iso(col+1, row+1);
  const [x3, y3] = iso(col,   row+1);
  return `${x0},${y0} ${x1},${y1} ${x2},${y2} ${x3},${y3}`;
}

// Zone outline polygon (the boundary of a rectangular zone)
function zonePoly(col: number, row: number, w: number, d: number): string {
  const [x0, y0] = iso(col,   row);
  const [x1, y1] = iso(col+w, row);
  const [x2, y2] = iso(col+w, row+d);
  const [x3, y3] = iso(col,   row+d);
  return `${x0},${y0} ${x1},${y1} ${x2},${y2} ${x3},${y3}`;
}

// Zone label position (top-front of zone)
function zoneLabel(col: number, row: number, w: number): [number, number] {
  const [cx, cy] = iso(col + w/2, row);
  return [cx, cy - 14];
}

// ─── SVG Office Room ──────────────────────────────────────────────────────────
function OfficeRoom() {
  // Floor corners
  const [fx0, fy0] = iso(0,    0);      // back corner
  const [fx1, fy1] = iso(COLS, 0);      // right corner
  const [fx2, fy2] = iso(COLS, ROWS);   // front corner
  const [fx3, fy3] = iso(0,    ROWS);   // left corner

  // Wall tops
  const wt = (y: number) => y - WALL_H;

  // Left wall corners (back → left → left-top → back-top)
  const leftWall  = [[fx0,fy0],[fx3,fy3],[fx3,wt(fy3)],[fx0,wt(fy0)]];
  // Right wall corners (back → right → right-top → back-top)
  const rightWall = [[fx0,fy0],[fx1,fy1],[fx1,wt(fy1)],[fx0,wt(fy0)]];
  const pts = (a: number[][]) => a.map(p=>p.join(",")).join(" ");

  // Ceiling line (just the ridge)
  // Window positions on right wall: col 4, 8, 14, 18 at row=0
  const rightWindows = [4, 8, 14, 18];
  // Window positions on left wall: row 4, 10, 16 at col=0
  const leftWindows  = [4, 10, 16];

  // Floor: dark hardwood planks — horizontal planks with grain variation
  // Planks run along the "column" axis (iso diagonal), each 1 tile wide
  // We use the column index to pick a plank shade, row adds micro grain
  const floorTiles = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // Plank index alternates every 2 cols for plank-width feel
      const plank = Math.floor(c / 2) % 4;
      const grain = ((c * 7 + r * 13) % 10) * 0.4;
      // Dark walnut palette: hue ~22, sat 35-42%, lum 22-30%
      const lumBase = [24, 27, 22, 29][plank];
      const satBase = [38, 35, 40, 36][plank];
      const lum = lumBase + grain;
      const sat = satBase;
      // Subtle grout/seam between planks
      const isSeam = (c % 2 === 0);
      floorTiles.push(
        <polygon key={`t${c}-${r}`}
          points={tilePoly(c, r)}
          fill={`hsl(22,${sat}%,${lum.toFixed(1)}%)`}
          stroke={isSeam ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.08)"}
          strokeWidth={isSeam ? "1" : "0.4"}
        />
      );
    }
  }
  // Ambient floor lighting — warm glow from ceiling lights pooling on floor
  const floorAmbient = (
    <>
      {/* Overall warm ambient overlay — makes floor feel lit from above */}
      <polygon
        points={`${fx0},${fy0} ${fx1},${fy1} ${fx2},${fy2} ${fx3},${fy3}`}
        fill="rgba(255,220,160,0.07)"
      />
      {/* Central lighter area (main overhead lighting) */}
      <ellipse
        cx={(fx0+fx2)/2} cy={(fy0+fy2)/2 + 60}
        rx={TW*7} ry={TH*7}
        fill="rgba(255,230,180,0.08)"
      />
    </>
  );

  // Zone rugs — solid coloured rugs like in the reference image
  // Each zone has a clear rug that defines the team area
  const RUG_INSET = 0.35; // inset from zone edge so rug doesn't touch walls
  function rugPoly(col: number, row: number, w: number, d: number) {
    const ci = col + RUG_INSET, ri = row + RUG_INSET;
    const wi = w - RUG_INSET*2, di = d - RUG_INSET*2;
    return zonePoly(ci, ri, wi, di);
  }
  const zoneAreas = ZONES.filter(z => z.id !== "hotdesk").map(z => (
    <g key={`za-${z.id}`}>
      {/* Rug shadow */}
      <polygon
        points={rugPoly(z.col, z.row+0.15, z.w, z.d)}
        fill="rgba(0,0,0,0.18)"
      />
      {/* Rug base */}
      <polygon
        points={rugPoly(z.col, z.row, z.w, z.d)}
        fill={z.color}
        opacity="0.22"
      />
      {/* Rug inner border — thin inset line for that rug texture feel */}
      <polygon
        points={rugPoly(z.col + 0.2, z.row + 0.2, z.w - 0.4, z.d - 0.4)}
        fill="none"
        stroke={z.color}
        strokeWidth="1.5"
        opacity="0.35"
      />
    </g>
  ));

  // Zone outlines — solid coloured border matching the rug, no dash
  const zoneOutlines = ZONES.filter(z => z.id !== "hotdesk").map(z => (
    <polygon key={`zo-${z.id}`}
      points={rugPoly(z.col, z.row, z.w, z.d)}
      fill="none"
      stroke={z.color}
      strokeWidth="2"
      opacity="0.6"
    />
  ));
  // Hot desk keeps dashed outline
  const hotDeskOutline = (() => {
    const z = ZONES.find(h => h.id === "hotdesk")!;
    return (
      <polygon
        points={zonePoly(z.col, z.row, z.w, z.d)}
        fill="rgba(100,116,139,0.06)"
        stroke="#64748b"
        strokeWidth="2"
        strokeDasharray="10 6"
        opacity="0.7"
      />
    );
  })();

  // Zone labels — pill with zone colour tint
  const zoneLabels = ZONES.map(z => {
    const [lx, ly] = zoneLabel(z.col, z.row, z.w);
    return (
      <g key={`zl-${z.id}`}>
        <rect x={lx-52} y={ly-13} width={104} height={20} rx="10"
          fill="rgba(8,14,26,0.88)" stroke={z.color} strokeWidth="1" strokeOpacity="0.5"/>
        <text x={lx} y={ly+2}
          textAnchor="middle" fill={z.color}
          fontSize="11" fontFamily="Inter,sans-serif" fontWeight="700"
          letterSpacing="0.04em">
          {z.label}
        </text>
      </g>
    );
  });

  // Future expansion zone
  const [ex, ey] = zoneLabel(EXPANSION.col, EXPANSION.row, EXPANSION.w);
  const expansionEl = (
    <g>
      <polygon
        points={zonePoly(EXPANSION.col, EXPANSION.row, EXPANSION.w, EXPANSION.d)}
        fill="rgba(99,102,241,0.04)"
        stroke="#6366f1"
        strokeWidth="2"
        strokeDasharray="14 8"
        opacity="0.5"
      />
      <text x={ex} y={ey+2} textAnchor="middle"
        fill="#6366f1" fontSize="12" fontFamily="Inter,sans-serif"
        fontWeight="600" opacity="0.7" letterSpacing="0.06em">
        FUTURE EXPANSION ZONE
      </text>
      {/* Plus icon */}
      {(() => {
        const [cx, cy] = iso(EXPANSION.col + EXPANSION.w/2, EXPANSION.row + EXPANSION.d/2);
        return (
          <g>
            <circle cx={cx} cy={cy} r={20} fill="rgba(99,102,241,0.15)"
              stroke="#6366f1" strokeWidth="1.5" opacity="0.6"/>
            <text x={cx} y={cy+6} textAnchor="middle"
              fill="#6366f1" fontSize="22" fontFamily="Inter,sans-serif" opacity="0.7">+</text>
          </g>
        );
      })()}
    </g>
  );

  // Hot desk "+" icons
  const hotZone = ZONES.find(z => z.id === "hotdesk")!;
  const emptyDesks = hotZone.desks.slice(4).map((d, i) => {
    const [dx, dy] = iso(hotZone.col + d[0], hotZone.row + d[1]);
    return (
      <g key={`hd${i}`}>
        <circle cx={dx} cy={dy-20} r={16} fill="rgba(100,116,139,0.2)"
          stroke="#64748b" strokeWidth="1.5" strokeDasharray="5 3"/>
        <text x={dx} y={dy-14} textAnchor="middle"
          fill="#64748b" fontSize="18" fontFamily="Inter,sans-serif">+</text>
      </g>
    );
  });

  // Lounge (sofas + coffee table)
  const loungeEl = (() => {
    const [lx, ly] = iso(LOUNGE.col + 1, LOUNGE.row + 1);
    return (
      <g>
        {/* Rug */}
        <polygon
          points={zonePoly(LOUNGE.col, LOUNGE.row, LOUNGE.w, LOUNGE.d)}
          fill="rgba(139,92,246,0.08)"
          stroke="rgba(139,92,246,0.3)" strokeWidth="1.5"
        />
        {/* Sofa back */}
        <ellipse cx={lx-20} cy={ly+10} rx={40} ry={14}
          fill="#4a3f35" opacity="0.9"/>
        <ellipse cx={lx-20} cy={ly+4} rx={34} ry={10}
          fill="#5c4f44" opacity="0.9"/>
        {/* Coffee table */}
        <ellipse cx={lx+25} cy={ly+20} rx={22} ry={10}
          fill="#7c6a55" opacity="0.85"/>
        <ellipse cx={lx+25} cy={ly+16} rx={18} ry={8}
          fill="#8c7a65" opacity="0.9"/>
      </g>
    );
  })();

  // Plants (corners and scattered)
  const plantPositions = [
    [0, 0], [COLS, 0], [0, ROWS], [COLS, ROWS],
    [0, ROWS/2], [COLS, ROWS/2],
    [5, 5], [19, 5], [5, 17], [19, 17],
  ] as [number,number][];

  const plants = plantPositions.map(([pc, pr], i) => {
    const [px, py] = iso(pc, pr);
    const size = [0,1,2,3].includes(i) ? 1 : 0.7;
    return (
      <g key={`pl${i}`}>
        {/* Pot */}
        <ellipse cx={px} cy={py} rx={12*size} ry={5*size} fill="#e8e8e8" opacity="0.9"/>
        <rect x={px-10*size} y={py-16*size} width={20*size} height={16*size}
          rx={3} fill="#f0f0f0" opacity="0.85"/>
        {/* Leaves */}
        {[0,60,120,180,240,300].map((deg, li) => {
          const rad = deg * Math.PI / 180;
          return (
            <ellipse key={li}
              cx={px + Math.cos(rad)*26*size}
              cy={py - 30*size + Math.sin(rad)*10*size}
              rx={16*size} ry={7*size}
              fill={li%2===0 ? "#2d6a2d" : "#1e5c1e"}
              transform={`rotate(${deg-15},${px+Math.cos(rad)*26*size},${py-30*size+Math.sin(rad)*10*size})`}
              opacity="0.92"
            />
          );
        })}
        <rect x={px-4*size} y={py-34*size} width={8*size} height={22*size}
          rx={2} fill="#5c3d1a" opacity="0.8"/>
      </g>
    );
  });

  // Big screen on back wall (between left+right walls, near top)
  const [scx, scy] = iso(COLS/2, 0);
  const screenW = 200, screenH = 110;
  const screenEl = (
    <g>
      {/* Screen frame */}
      <rect x={scx-screenW/2} y={scy-WALL_H+20}
        width={screenW} height={screenH}
        rx="8" fill="#1a1f2e" stroke="#2a3650" strokeWidth="3"/>
      {/* Screen content — project dashboard */}
      <rect x={scx-screenW/2+6} y={scy-WALL_H+26}
        width={screenW-12} height={screenH-12}
        rx="4" fill="#0d1520"/>
      {/* Bars on screen */}
      {[0,1,2,3,4].map(i => (
        <rect key={i}
          x={scx-screenW/2+12+i*34} y={scy-WALL_H+60}
          width={24} height={30+i*8}
          rx="2"
          fill={["#6366f1","#3b82f6","#10b981","#f59e0b","#ec4899"][i]}
          opacity="0.9"
        />
      ))}
      <text x={scx} y={scy-WALL_H+40}
        textAnchor="middle" fill="#94a3b8"
        fontSize="8" fontFamily="Inter,sans-serif" letterSpacing="0.08em">
        PROJECT DASHBOARD
      </text>
      {/* Screen glow */}
      <rect x={scx-screenW/2} y={scy-WALL_H+20}
        width={screenW} height={screenH}
        rx="8" fill="none"
        stroke="#6366f1" strokeWidth="1" opacity="0.4"/>
    </g>
  );

  // Ceiling spotlights — brighter pools on dark floor
  const spotlightCols = [3, 7, 12, 17, 21];
  const spotlightRow  = 0;
  const spotlights = spotlightCols.map((c, i) => {
    const [lx, ly] = iso(c, spotlightRow);
    const lY = ly - WALL_H + 10;
    return (
      <g key={i}>
        {/* light cone */}
        <polygon
          points={`${lx-5},${lY+4} ${lx+5},${lY+4} ${lx+60},${lY+WALL_H*0.88} ${lx-60},${lY+WALL_H*0.88}`}
          fill="rgba(255,240,200,0.06)"/>
        {/* floor pool — brighter on dark wood */}
        <ellipse cx={lx} cy={lY+WALL_H*0.9}
          rx={65} ry={26}
          fill="rgba(255,235,180,0.18)"/>
        {/* fixture dot */}
        <circle cx={lx} cy={lY} r={5} fill="#fffde8" opacity="0.9"/>
      </g>
    );
  });

  // Helper: draw a proper isometric window on a wall face.
  // On the RIGHT wall (col axis), moving along col shifts x by +TW/2, y by +TH/2.
  // On the LEFT wall (row axis), moving along row shifts x by -TW/2, y by +TH/2.
  // Windows are rectangular on the wall face: the horizontal edges follow the
  // wall's lean and the vertical edges are purely vertical (dx=0).
  //
  // Right wall: anchor at iso(col, 0). Step right = iso(col+W, 0) - iso(col,0).
  // Left  wall: anchor at iso(0, row). Step right = iso(0, row+W) - iso(0,row).

  function isoWindow(
    ax: number, ay: number,   // top-left anchor on wall (screen coords)
    stepX: number, stepW: number, // horizontal step per unit & width in units
    wallH: number,            // full wall height in px
    wUnits: number,           // window width in iso units
  ) {
    const winH  = wallH * 0.42;       // window height = 42% of wall
    const topOff = wallH * 0.14;      // gap from wall top to window top
    // horizontal step vector (follows wall lean):
    const dx = stepX * wUnits;
    const dy = stepW * wUnits;
    // Four corners — vertical edges are purely vertical (x unchanged, y +winH)
    const x0 = ax,      y0 = ay - wallH + topOff;
    const x1 = ax + dx, y1 = y0 + dy;
    const x2 = x1,      y2 = y1 + winH;
    const x3 = x0,      y3 = y0 + winH;
    const pts3 = `${x0},${y0} ${x1},${y1} ${x2},${y2} ${x3},${y3}`;
    // frame inset (3px)
    const fi = 3;
    const fi2 = fi * 0.5;
    const ix0=x0+fi, iy0=y0+fi, ix1=x1-fi, iy1=y1+fi,
          ix2=x2-fi, iy2=y2-fi2, ix3=x3+fi, iy3=y3-fi2;
    const ipts = `${ix0},${iy0} ${ix1},${iy1} ${ix2},${iy2} ${ix3},${iy3}`;
    return { pts: pts3, ipts, x0, y0, x1, y1, x2, y2, x3, y3,
             ix0, iy0, ix1, iy1, ix2, iy2, ix3, iy3 };
  }

  // Right wall step: moving +1 col from row=0 shifts by (TW/2, TH/2)
  const rStepX = TW / 2, rStepY = TH / 2;
  const rightWindowEls = rightWindows.map((wc, i) => {
    const [ax, ay] = iso(wc, 0);
    const w = isoWindow(ax, ay, rStepX, rStepY, WALL_H, 2);
    return (
      <g key={i}>
        {/* Dark glass */}
        <polygon points={w.pts} fill="#0a1a2e" opacity="0.94"/>
        {/* Night sky gradient tint */}
        <polygon points={w.pts} fill="rgba(30,60,120,0.18)"/>
        {/* White frame */}
        <polygon points={w.pts} fill="none" stroke="#e8ddd0" strokeWidth="5" opacity="0.9"/>
        {/* Inner frame */}
        <polygon points={w.ipts} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
        {/* Horizontal glazing bar (mid-height) */}
        <line
          x1={w.x0} y1={(w.y0+w.y3)/2}
          x2={w.x1} y2={(w.y1+w.y2)/2}
          stroke="#e8ddd0" strokeWidth="2" opacity="0.6"/>
        {/* Window sill */}
        <line x1={w.x3} y1={w.y3} x2={w.x2} y2={w.y2}
          stroke="#d4c8b8" strokeWidth="6" opacity="0.9"/>
      </g>
    );
  });

  // Left wall step: moving +1 row from col=0 shifts by (-TW/2, TH/2)
  const lStepX = -TW / 2, lStepY = TH / 2;
  const leftWindowEls = leftWindows.map((wr, i) => {
    const [ax, ay] = iso(0, wr);
    const w = isoWindow(ax, ay, lStepX, lStepY, WALL_H, 2);
    return (
      <g key={i}>
        {/* Dark glass */}
        <polygon points={w.pts} fill="#0a1a2e" opacity="0.94"/>
        <polygon points={w.pts} fill="rgba(30,60,120,0.18)"/>
        {/* White frame */}
        <polygon points={w.pts} fill="none" stroke="#e8ddd0" strokeWidth="5" opacity="0.9"/>
        <polygon points={w.ipts} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
        {/* Glazing bar */}
        <line
          x1={w.x0} y1={(w.y0+w.y3)/2}
          x2={w.x1} y2={(w.y1+w.y2)/2}
          stroke="#e8ddd0" strokeWidth="2" opacity="0.6"/>
        {/* Sill */}
        <line x1={w.x3} y1={w.y3} x2={w.x2} y2={w.y2}
          stroke="#d4c8b8" strokeWidth="6" opacity="0.9"/>
      </g>
    );
  });

  return (
    <svg
      width={WORLD_W} height={WORLD_H}
      style={{ position:"absolute", top:0, left:0, overflow:"visible" }}
    >
      <defs>
        {/* Warm cream walls like reference image */}
        <linearGradient id="leftWallG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#b8a898"/>
          <stop offset="50%"  stopColor="#d4c8b8"/>
          <stop offset="100%" stopColor="#e8ddd0"/>
        </linearGradient>
        <linearGradient id="rightWallG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#ede4d8"/>
          <stop offset="50%"  stopColor="#d8cec2"/>
          <stop offset="100%" stopColor="#bfb4a8"/>
        </linearGradient>
        <linearGradient id="ceilG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#22283a"/>
          <stop offset="100%" stopColor="#161c2c"/>
        </linearGradient>
        {/* Wall top ridge shadow */}
        <linearGradient id="wallTopG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(0,0,0,0.35)"/>
          <stop offset="100%" stopColor="rgba(0,0,0,0)"/>
        </linearGradient>
        <filter id="softShadow">
          <feDropShadow dx="0" dy="3" stdDeviation="5" floodOpacity="0.35"/>
        </filter>
      </defs>

      {/* ── Background — covers entire area above + behind walls ── */}
      <rect x={0} y={0} width={WORLD_W} height={WORLD_H} fill="#1a1f2e"/>

      {/* ── Left wall ── warm cream */}
      <polygon points={pts(leftWall)} fill="url(#leftWallG)"/>
      {/* Shadow under ceiling on left wall */}
      <polygon
        points={`${fx0},${wt(fy0)} ${fx3},${wt(fy3)} ${fx3},${wt(fy3)+40} ${fx0},${wt(fy0)+40}`}
        fill="url(#wallTopG)"/>
      {leftWindowEls}
      {/* Left-wall baseboard */}
      <polygon
        points={`${fx0},${fy0} ${fx3},${fy3} ${fx3},${fy3+12} ${fx0},${fy0+12}`}
        fill="#c8b89a" opacity="0.9"/>

      {/* ── Right wall ── warm cream */}
      <polygon points={pts(rightWall)} fill="url(#rightWallG)"/>
      {/* Shadow under ceiling on right wall */}
      <polygon
        points={`${fx0},${wt(fy0)} ${fx1},${wt(fy1)} ${fx1},${wt(fy1)+40} ${fx0},${wt(fy0)+40}`}
        fill="url(#wallTopG)"/>
      {rightWindowEls}
      {/* Right-wall baseboard */}
      <polygon
        points={`${fx0},${fy0} ${fx1},${fy1} ${fx1},${fy1+12} ${fx0},${fy0+12}`}
        fill="#c8b89a" opacity="0.8"/>

      {/* ── Big screen on back wall ── */}
      {screenEl}

      {/* ── Ceiling spotlights ── */}
      {spotlights}

      {/* ── Floor tiles ── */}
      {floorTiles}

      {/* ── Ambient floor lighting overlay ── */}
      {floorAmbient}

      {/* ── Zone rugs ── */}
      {zoneAreas}

      {/* ── Lounge area ── */}
      {loungeEl}

      {/* ── Plants ── */}
      {plants}

      {/* ── Zone rug outlines ── */}
      {zoneOutlines}

      {/* ── Hot desk outline ── */}
      {hotDeskOutline}

      {/* ── Zone labels ── */}
      {zoneLabels}

      {/* ── Future expansion ── */}
      {expansionEl}

      {/* ── Hot desk empty placeholders ── */}
      {hotZone && hotDesks()}
    </svg>
  );

  function hotDesks() {
    // Empty desks in hot-desk zone (shown as dashed circles with +)
    const hz = ZONES.find(z => z.id === "hotdesk")!;
    return hz.desks.map((d, i) => {
      const [dx, dy] = iso(hz.col + d[0], hz.row + d[1]);
      const occupied = i < 2; // first 2 slots occupied by real agents at runtime
      if (occupied) return null;
      return (
        <g key={`hd-empty-${i}`}>
          <ellipse cx={dx} cy={dy-8} rx={28} ry={12}
            fill="rgba(100,116,139,0.12)"
            stroke="#475569" strokeWidth="1.5" strokeDasharray="6 4"/>
          <text x={dx} y={dy-3} textAnchor="middle"
            fill="#64748b" fontSize="16" fontFamily="Inter,sans-serif" opacity="0.8">+</text>
        </g>
      );
    }).filter(Boolean);
  }
}

// ─── Delegation / communication arcs ─────────────────────────────────────────
function CommArcs({ agents }: { agents: Agent[] }) {
  const mgr = agents.find(a => a.spriteType === "manager");
  if (!mgr) return null;
  const mPos = getAgentDeskPos(mgr);
  if (!mPos) return null;

  const active = agents.filter(a =>
    a.spriteType !== "manager" &&
    (a.status === "working" || a.status === "thinking")
  );

  return (
    <svg style={{ position:"absolute", top:0, left:0, width:WORLD_W, height:WORLD_H,
      pointerEvents:"none", zIndex:10 }} overflow="visible">
      {active.map(a => {
        const aPos = getAgentDeskPos(a);
        if (!aPos) return null;
        const [mx, my] = mPos, [ax, ay] = aPos;
        const cy = (my + ay) / 2 - 80;
        return (
          <g key={a.id}>
            <path
              d={`M ${mx} ${my-40} Q ${(mx+ax)/2} ${cy} ${ax} ${ay-40}`}
              fill="none" stroke={a.color} strokeWidth="2"
              strokeDasharray="8 5" opacity="0.55"
              style={{ animation:"dashFlow 2s linear infinite" }}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Minimap ──────────────────────────────────────────────────────────────────
function MiniMap({ pan, zoom, vpW, vpH, agents }: {
  pan:[number,number]; zoom:number; vpW:number; vpH:number; agents:Agent[];
}) {
  const W=130, H=100;
  const sx = W/WORLD_W, sy = H/WORLD_H;
  const [fx0,fy0]=iso(0,0);   const [fx1,fy1]=iso(COLS,0);
  const [fx2,fy2]=iso(COLS,ROWS); const [fx3,fy3]=iso(0,ROWS);
  const floorPts = [[fx0,fy0],[fx1,fy1],[fx2,fy2],[fx3,fy3]]
    .map(([x,y])=>`${x*sx},${y*sy}`).join(" ");
  const vpL=clamp((-pan[0]/zoom)*sx,0,W), vpT=clamp((-pan[1]/zoom)*sy,0,H);
  const vpW2=clamp((vpW/zoom)*sx,2,W), vpH2=clamp((vpH/zoom)*sy,2,H);

  return (
    <div className="absolute bottom-3 right-3 rounded-xl overflow-hidden pointer-events-none"
      style={{ width:W,height:H,zIndex:50,border:"1px solid #1e3050",
        background:"rgba(6,10,20,0.93)",boxShadow:"0 4px 20px rgba(0,0,0,0.6)" }}>
      <svg width={W} height={H}>
        <polygon points={floorPts} fill="#b86828" opacity="0.3" stroke="#c87030" strokeWidth="1"/>
        {ZONES.map(z => {
          const [zx,zy]=iso(z.col+z.w/2, z.row+z.d/2);
          return <circle key={z.id} cx={zx*sx} cy={zy*sy} r={3}
            fill={z.color} opacity="0.5"/>;
        })}
        {agents.map(a => {
          const pos = getAgentDeskPos(a);
          if (!pos) return null;
          return <circle key={a.id} cx={pos[0]*sx} cy={pos[1]*sy} r={3.5}
            fill={a.status==="idle"?"#334155":a.color}
            stroke={a.color} strokeWidth="1"/>;
        })}
        <rect x={vpL} y={vpT} width={vpW2} height={vpH2}
          fill="rgba(99,102,241,0.10)" stroke="#6366f1" strokeWidth="1.5" rx="2"/>
      </svg>
      <div style={{ position:"absolute",bottom:3,left:5,fontSize:7,color:"#475569",
        fontFamily:"Inter",letterSpacing:"0.06em",textTransform:"uppercase" }}>map</div>
    </div>
  );
}

// ─── Agent sprite ─────────────────────────────────────────────────────────────
const SPRITE_PX = 160; // world px

function AgentSprite({ agent, zoom }: { agent: Agent; zoom: number }) {
  const pos = getAgentDeskPos(agent);
  if (!pos) return null;
  const [wx, wy] = pos;

  const isActive  = agent.status === "working" || agent.status === "thinking";
  const isDone    = agent.status === "done";
  const isIdle    = agent.status === "idle";
  const isBlocked = agent.status === "blocked";
  const color     = agent.color;
  const task      = agent.currentTask;

  const labelSz = Math.round(clamp(12/zoom, 9, 15));
  const img = SPRITE_MAP[agent.spriteType] ?? SPRITE_MAP["manager"];

  const filterStyle = isIdle
    ? "grayscale(40%) brightness(0.7)"
    : isBlocked
    ? "grayscale(20%) sepia(0.4) hue-rotate(310deg) brightness(0.75)"
    : isActive
    ? `drop-shadow(0 0 ${10/zoom}px ${color}aa)`
    : "none";

  return (
    <div style={{
      position:"absolute",
      left: wx - SPRITE_PX/2,
      top:  wy - SPRITE_PX,
      width: SPRITE_PX,
      zIndex: Math.round(wy + 500),
      filter: filterStyle,
      transition:"filter 0.4s",
    }}>
      {/* Floor shadow */}
      <div style={{
        position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:SPRITE_PX*0.55, height:SPRITE_PX*0.07,
        background:"radial-gradient(ellipse,rgba(0,0,0,0.55) 0%,transparent 70%)",
        borderRadius:"50%",
      }}/>

      {/* Active glow ring */}
      {isActive && (
        <div style={{
          position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
          width:SPRITE_PX*0.7, height:SPRITE_PX*0.10,
          background:`radial-gradient(ellipse,${color}55 0%,transparent 70%)`,
          borderRadius:"50%", animation:"glowPulse 2s ease-in-out infinite",
        }}/>
      )}

      {/* Blocked badge */}
      {isBlocked && (
        <div style={{
          position:"absolute", top:-(clamp(22/zoom,14,28)), right:0,
          fontSize:clamp(14/zoom,10,18), animation:"bounce 0.8s infinite alternate",
        }}>⛔</div>
      )}

      {/* Speech bubble */}
      {task && (isActive || isDone || isBlocked) && (
        <div style={{
          position:"absolute", bottom:SPRITE_PX+4,
          left:"50%", transform:"translateX(-50%)",
          whiteSpace:"nowrap", pointerEvents:"none",
        }}>
          <div style={{
            background:"rgba(4,8,20,0.96)",
            border:`1.5px solid ${isBlocked?"#ef4444":color}`,
            color:isBlocked?"#ef4444":color,
            padding:`${clamp(4/zoom,3,7)}px ${clamp(10/zoom,7,14)}px`,
            borderRadius:clamp(18/zoom,10,22),
            fontSize:clamp(10/zoom,8,13),
            fontFamily:"JetBrains Mono,monospace", fontWeight:600,
            boxShadow:`0 2px 12px ${color}44`,
          }}>
            {isBlocked?"⚠ Blocked":(task.length>26?task.slice(0,26)+"…":task)}
          </div>
          <div style={{display:"flex",justifyContent:"center",marginTop:-1}}>
            <div style={{width:0,height:0,
              borderLeft:`${clamp(4/zoom,3,6)}px solid transparent`,
              borderRight:`${clamp(4/zoom,3,6)}px solid transparent`,
              borderTop:`${clamp(5/zoom,4,7)}px solid ${isBlocked?"#ef4444":color}`,
            }}/>
          </div>
        </div>
      )}

      {/* Sprite */}
      <img src={img} alt={agent.name}
        style={{width:"100%",display:"block",userSelect:"none"}} draggable={false}/>

      {/* Name label */}
      <div style={{
        position:"absolute",
        bottom:-(labelSz*2.8),
        left:"50%", transform:"translateX(-50%)",
        whiteSpace:"nowrap",
        display:"flex", alignItems:"center",
        gap:clamp(4/zoom,3,5),
        padding:`${clamp(4/zoom,3,6)}px ${clamp(9/zoom,7,13)}px`,
        background:"rgba(4,8,20,0.95)",
        border:`1.5px solid ${isBlocked?"#ef4444":isActive?color:color+"99"}`,
        borderRadius:clamp(18/zoom,10,22),
        boxShadow:"0 2px 10px rgba(0,0,0,0.85)",
        pointerEvents:"none",
      }}>
        <div style={{
          width:clamp(7/zoom,5,8), height:clamp(7/zoom,5,8),
          borderRadius:"50%", flexShrink:0,
          background:isIdle?"#475569":isDone?"#10b981":isBlocked?"#ef4444":color,
          boxShadow:isActive?`0 0 ${clamp(5/zoom,4,7)}px ${color}`:"none",
          transition:"all 0.3s",
        }}/>
        <span style={{
          fontSize:labelSz, color:"#fff",
          fontFamily:"Inter,sans-serif", fontWeight:700, lineHeight:1,
          textShadow:"0 1px 4px rgba(0,0,0,1)",
        }}>{agent.name}</span>
      </div>

      {isDone && (
        <div style={{
          position:"absolute", right:0, top:-(clamp(26/zoom,18,32)),
          fontSize:clamp(16/zoom,10,20), animation:"bounce 0.6s infinite alternate",
        }}>🎉</div>
      )}
    </div>
  );
}

// ─── Zoom controls ─────────────────────────────────────────────────────────────
function ZoomControls({ onIn,onOut,onReset,zoom }: {
  onIn:()=>void; onOut:()=>void; onReset:()=>void; zoom:number;
}) {
  return (
    <div className="absolute bottom-3 left-3 flex flex-col gap-1" style={{zIndex:50}}>
      {[{l:"+",fn:onIn,tip:"Zoom in"},{l:"⌂",fn:onReset,tip:"Reset"},{l:"−",fn:onOut,tip:"Zoom out"}]
        .map(b=>(
          <button key={b.l} onClick={b.fn} title={b.tip} style={{
            width:32,height:32,borderRadius:8,
            background:"rgba(6,10,20,0.93)",border:"1px solid #1e3050",
            color:"#94a3b8",fontSize:16,fontWeight:700,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
          }}
            onMouseEnter={e=>(e.currentTarget.style.borderColor="#6366f1")}
            onMouseLeave={e=>(e.currentTarget.style.borderColor="#1e3050")}
          >{b.l}</button>
        ))}
      <div style={{textAlign:"center",marginTop:1,fontSize:9,color:"#475569",fontFamily:"monospace"}}>
        {Math.round(zoom*100)}%
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function IsometricOffice({ agents, project }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vpDims, setVpDims] = useState({ w:1200, h:700 });
  const [pan,  setPan]      = useState<[number,number]>([0,0]);
  const [zoom, setZoom]     = useState(0.38);
  const initDone            = useRef(false);

  const dragRef    = useRef<{sx:number;sy:number;sp:[number,number]}|null>(null);
  const isDragging = useRef(false);
  const touchRef   = useRef<{sx:number;sy:number;sp:[number,number];d0?:number;z0?:number}|null>(null);

  const clampPan = useCallback((px:number,py:number,z:number):[number,number]=>{
    const pad=150;
    return [
      clamp(px,-(WORLD_W*z-pad),vpDims.w-pad),
      clamp(py,-(WORLD_H*z-pad),vpDims.h-pad),
    ];
  },[vpDims]);

  useEffect(()=>{
    const obs = new ResizeObserver(entries=>{
      const e=entries[0]; if(!e) return;
      const w=e.contentRect.width, h=e.contentRect.height;
      setVpDims({w,h});
      if(!initDone.current){
        initDone.current=true;
        // Floor width in world px: right corner x - left corner x
        const [floorRx]=iso(COLS,0); const [floorLx]=iso(0,ROWS);
        const floorW = floorRx - floorLx;
        const fz = clamp(w*0.88/floorW, ZOOM_MIN, ZOOM_MAX);
        // Centre on floor mid-point
        const [fcx,fcy]=iso(COLS/2,ROWS/2);
        setPan([w/2-fcx*fz, h/2-fcy*fz]);
        setZoom(fz);
      }
    });
    if(containerRef.current) obs.observe(containerRef.current);
    return ()=>obs.disconnect();
  },[]);

  const onMouseDown = useCallback((e:React.MouseEvent)=>{
    if(e.button!==0) return;
    isDragging.current=false;
    dragRef.current={sx:e.clientX,sy:e.clientY,sp:pan};
    e.preventDefault();
  },[pan]);

  const onMouseMove = useCallback((e:React.MouseEvent)=>{
    if(!dragRef.current) return;
    const dx=e.clientX-dragRef.current.sx, dy=e.clientY-dragRef.current.sy;
    if(Math.abs(dx)>3||Math.abs(dy)>3) isDragging.current=true;
    if(!isDragging.current) return;
    setPan(clampPan(dragRef.current.sp[0]+dx, dragRef.current.sp[1]+dy, zoom));
  },[zoom,clampPan]);

  const onMouseUp = useCallback(()=>{ dragRef.current=null; },[]);

  const onTouchStart = useCallback((e:React.TouchEvent)=>{
    if(e.touches.length===1)
      touchRef.current={sx:e.touches[0].clientX,sy:e.touches[0].clientY,sp:pan};
    else if(e.touches.length===2){
      const d=Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY);
      touchRef.current={sx:0,sy:0,sp:pan,d0:d,z0:zoom};
    }
  },[pan,zoom]);

  const onTouchMove = useCallback((e:React.TouchEvent)=>{
    e.preventDefault();
    if(!touchRef.current) return;
    if(e.touches.length===1&&!touchRef.current.d0)
      setPan(clampPan(touchRef.current.sp[0]+(e.touches[0].clientX-touchRef.current.sx),
        touchRef.current.sp[1]+(e.touches[0].clientY-touchRef.current.sy),zoom));
    else if(e.touches.length===2&&touchRef.current.d0){
      const d=Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY);
      setZoom(clamp((touchRef.current.z0??zoom)*(d/touchRef.current.d0),ZOOM_MIN,ZOOM_MAX));
    }
  },[zoom,clampPan]);

  const onTouchEnd = useCallback(()=>{ touchRef.current=null; },[]);

  const onWheel = useCallback((e:React.WheelEvent)=>{
    e.preventDefault();
    const delta=e.deltaY>0?-ZOOM_STEP:ZOOM_STEP;
    setZoom(z=>{
      const nz=clamp(z+delta,ZOOM_MIN,ZOOM_MAX);
      const rect=containerRef.current?.getBoundingClientRect();
      if(rect){
        const mx=e.clientX-rect.left, my=e.clientY-rect.top;
        setPan(([px,py])=>{
          const wx=(mx-px)/z, wy=(my-py)/z;
          return clampPan(mx-wx*nz, my-wy*nz, nz);
        });
      }
      return nz;
    });
  },[clampPan]);

  const handleReset = useCallback(()=>{
    const [floorRx]=iso(COLS,0); const [floorLx]=iso(0,ROWS);
    const floorW=floorRx-floorLx;
    const fz=clamp(vpDims.w*0.88/floorW,ZOOM_MIN,ZOOM_MAX);
    const [fcx,fcy]=iso(COLS/2,ROWS/2);
    setPan([vpDims.w/2-fcx*fz,vpDims.h/2-fcy*fz]);
    setZoom(fz);
  },[vpDims]);

  // Active project banner
  const hasProject = !!project;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden"
      style={{background:"#060c16",cursor:dragRef.current?"grabbing":"grab",userSelect:"none"}}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove}
      onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
    >
      <style>{`
        @keyframes glowPulse{0%,100%{opacity:.4;transform:translateX(-50%) scaleX(1)}50%{opacity:.9;transform:translateX(-50%) scaleX(1.45)}}
        @keyframes bounce{from{transform:translateY(0)}to{transform:translateY(-7px)}}
        @keyframes dashFlow{to{stroke-dashoffset:-40}}
        @keyframes fadeOut{from{opacity:1}to{opacity:0}}
      `}</style>

      {/* ═══ Pannable world ══════════════════════════════════════════════════ */}
      <div style={{
        position:"absolute", left:pan[0], top:pan[1],
        width:WORLD_W, height:WORLD_H,
        transformOrigin:"0 0", transform:`scale(${zoom})`, willChange:"transform",
      }}>
        {/* SVG room: floor, walls, zones, windows, lights, plants */}
        <OfficeRoom/>

        {/* Communication arcs */}
        <CommArcs agents={agents}/>

        {/* Agent sprites — sorted by Y for correct depth */}
        {[...agents]
          .sort((a,b)=>{
            const pa=getAgentDeskPos(a); const pb=getAgentDeskPos(b);
            return (pa?.[1]??0)-(pb?.[1]??0);
          })
          .map(agent=>(
            <AgentSprite key={agent.id} agent={agent} zoom={zoom}/>
          ))
        }
      </div>

      {/* ═══ Fixed HUD ════════════════════════════════════════════════════════ */}
      <MiniMap pan={pan} zoom={zoom} vpW={vpDims.w} vpH={vpDims.h} agents={agents}/>
      <ZoomControls onIn={()=>{
        const nz=clamp(zoom+ZOOM_STEP*2,ZOOM_MIN,ZOOM_MAX);
        setPan(([px,py])=>{const cx=vpDims.w/2,cy=vpDims.h/2;return clampPan(cx-(cx-px)/zoom*nz,cy-(cy-py)/zoom*nz,nz);});
        setZoom(nz);
      }} onOut={()=>{
        const nz=clamp(zoom-ZOOM_STEP*2,ZOOM_MIN,ZOOM_MAX);
        setPan(([px,py])=>{const cx=vpDims.w/2,cy=vpDims.h/2;return clampPan(cx-(cx-px)/zoom*nz,cy-(cy-py)/zoom*nz,nz);});
        setZoom(nz);
      }} onReset={handleReset} zoom={zoom}/>

      {/* Project banner */}
      {hasProject && (
        <div className="absolute pointer-events-none"
          style={{bottom:42,left:3,zIndex:50}}>
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
            style={{background:"rgba(6,10,20,0.93)",border:"1px solid #1e3050",maxWidth:260}}>
            <div className="relative flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-emerald-400"/>
              <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60"/>
            </div>
            <div>
              <div style={{fontSize:8,color:"#64748b",textTransform:"uppercase",
                letterSpacing:"0.08em",fontFamily:"Inter"}}>Active Project</div>
              <div style={{fontSize:11,color:"white",fontWeight:600,fontFamily:"Inter"}}>
                {project!.name.length>28?project!.name.slice(0,28)+"…":project!.name}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drag hint */}
      <DragHint/>
    </div>
  );
}

function DragHint() {
  const [show,setShow]=useState(true);
  useEffect(()=>{const t=setTimeout(()=>setShow(false),5000);return()=>clearTimeout(t);},[]);
  if(!show) return null;
  return (
    <div className="absolute pointer-events-none" style={{
      bottom:50,left:"50%",transform:"translateX(-50%)",zIndex:60,
      background:"rgba(6,10,20,0.90)",border:"1px solid #1e3050",
      borderRadius:12,padding:"8px 18px",fontSize:11,color:"#94a3b8",
      fontFamily:"Inter",display:"flex",alignItems:"center",gap:8,
      animation:"fadeOut 0.5s ease 4.5s forwards",
    }}>
      <span style={{fontSize:16}}>✋</span>
      Drag to pan · Scroll to zoom
    </div>
  );
}
