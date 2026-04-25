import { useEffect, useState, useRef, useCallback } from "react";
import type { Agent, Project } from "../types";

import managerImg      from "@assets/sprite_manager.png";
import frontendImg     from "@assets/sprite_frontend.png";
import backendImg      from "@assets/sprite_backend.png";
import qaImg           from "@assets/sprite_qa.png";
import uiuxImg         from "@assets/sprite_uiux.png";
import devopsImg       from "@assets/sprite_devops.png";
import dbarchitectImg  from "@assets/sprite_dbarchitect.png";
import datascientistImg from "@assets/sprite_datascientist.png";
import secengineerImg  from "@assets/sprite_secengineer.png";
import pmImg           from "@assets/sprite_pm.png";

interface Props { agents: Agent[]; project: Project | null; }

const SPRITE_MAP: Record<string, string> = {
  manager: managerImg, frontend: frontendImg, backend: backendImg,
  qa: qaImg, uiux: uiuxImg, devops: devopsImg,
  dbarchitect: dbarchitectImg, datascientist: datascientistImg,
  secengineer: secengineerImg, pm: pmImg,
};

// ─── World constants ──────────────────────────────────────────────────────────
// The world is a large flat 2-D canvas. The isometric room is drawn in SVG
// inside it. World size is intentionally larger than any screen — the user
// scrolls/zooms around.
const WORLD_W  = 4800;   // world pixels wide
const WORLD_H  = 3600;   // world pixels tall

// Fixed zoom range — initial zoom set to show ~1 screen worth of room detail
const ZOOM_MIN  = 0.15;
const ZOOM_MAX  = 3.0;
const ZOOM_STEP = 0.10;

// Starting zoom: show the room at roughly 1:1 detail on a typical screen
const ZOOM_INIT = 0.45;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function fmt(n: number) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(n);
}

// ─── Isometric projection helpers ────────────────────────────────────────────
// We work in "tile" space. The room is COLS×ROWS tiles.
// Each tile maps to screen via standard isometric transform:
//   sx = (col - row) * TILE_W/2 + origin_x
//   sy = (col + row) * TILE_H/2 + origin_y
// TILE_W:TILE_H ratio = 2:1 gives classic isometric look.

const COLS      = 16;   // floor tiles wide
const ROWS      = 12;   // floor tiles deep
const TILE_W    = 160;  // px per tile (isometric width)
const TILE_H    = 80;   // px per tile (isometric height, = TILE_W/2)

// Room origin in world coordinates — roughly centre-left of world
const ORIGIN_X  = WORLD_W / 2;
const ORIGIN_Y  = 600;           // top of back-wall ridge

// Wall height in px
const WALL_H    = 460;

// Convert tile (col, row) → world (x, y) at floor level
function tileToWorld(col: number, row: number): [number, number] {
  const sx = ORIGIN_X + (col - row) * TILE_W / 2;
  const sy = ORIGIN_Y + (col + row) * TILE_H / 2;
  return [sx, sy];
}

// ─── Sprite sizing ────────────────────────────────────────────────────────────
// Sprites are sized in world pixels — roughly 1.8 tiles tall
function spriteWorldPx(count: number): number {
  // TILE_H * 1.8 ≈ 144px — looks natural on the floor
  // Shrink slightly for more agents to avoid overlap
  if (count <= 4)  return TILE_H * 2.2;
  if (count <= 8)  return TILE_H * 1.9;
  return TILE_H * 1.65;
}

// ─── Agent grid positions (in tile space) ────────────────────────────────────
// Place agents across the floor, leaving edge tiles for walls/plants
// Safe tile range: col 2..13, row 2..9
function computePositions(count: number): [number, number][] {
  const cols  = count <= 4 ? 2 : count <= 8 ? 3 : 4;
  const rows  = Math.ceil(count / cols);

  // Distribute evenly across the safe floor zone
  const colMin = 2.5, colMax = 13.5;
  const rowMin = 1.5, rowMax = 9.5;

  const positions: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (positions.length >= count) break;
      const ct = cols > 1 ? c / (cols - 1) : 0.5;
      const rt = rows > 1 ? r / (rows - 1) : 0.5;
      positions.push([
        colMin + (colMax - colMin) * ct,
        rowMin + (rowMax - rowMin) * rt,
      ]);
    }
  }
  return positions;
}

// ─── SVG isometric room ────────────────────────────────────────────────────────
function IsometricRoom() {
  // Floor polygon: four corners of the COLS×ROWS floor grid
  const [fx0, fy0] = tileToWorld(0,    0);     // back corner (origin)
  const [fx1, fy1] = tileToWorld(COLS, 0);     // right corner
  const [fx2, fy2] = tileToWorld(COLS, ROWS);  // front corner
  const [fx3, fy3] = tileToWorld(0,    ROWS);  // left corner

  // Wall tops (same X, shifted up by WALL_H)
  const wTop = (y: number) => y - WALL_H;

  // Left wall: from back corner → left corner → left corner top → back corner top
  const leftWall = [
    [fx0, fy0], [fx3, fy3],
    [fx3, wTop(fy3)], [fx0, wTop(fy0)],
  ];
  // Right wall: from back corner → right corner → right corner top → back corner top
  const rightWall = [
    [fx0, fy0], [fx1, fy1],
    [fx1, wTop(fy1)], [fx0, wTop(fy0)],
  ];

  const pts = (arr: number[][]) => arr.map(p => p.join(",")).join(" ");

  // Floor tile colours — alternating warm wood tones
  const tileColors = ["#c8813a", "#b8722e"];

  // Ceiling light positions (in tile space) along back ridge area
  const lights = [
    [3, 1], [7, 0.5], [11, 1], [14, 2],
  ] as [number, number][];

  // Window positions on LEFT wall: col=0, rows 1..10
  const leftWindows = [
    { row: 1.5, h: 3 },
    { row: 5.5, h: 3 },
  ];
  // Window positions on RIGHT wall: row=0, cols 2..14
  const rightWindows = [
    { col: 2,  w: 3 },
    { col: 6,  w: 3 },
    { col: 10, w: 3 },
  ];

  // City skyline buildings (drawn inside window)
  function CityBuildings({ x, y, w, h }: { x:number; y:number; w:number; h:number }) {
    const blds = [
      { rx:0.05, rw:0.10, rh:0.80 }, { rx:0.17, rw:0.08, rh:0.55 },
      { rx:0.27, rw:0.12, rh:0.90 }, { rx:0.41, rw:0.09, rh:0.65 },
      { rx:0.52, rw:0.14, rh:0.75 }, { rx:0.68, rw:0.08, rh:0.50 },
      { rx:0.78, rw:0.11, rh:0.85 }, { rx:0.90, rw:0.08, rh:0.60 },
    ];
    return (
      <g>
        {/* Sky gradient */}
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a1628"/>
            <stop offset="60%" stopColor="#1a2d4a"/>
            <stop offset="100%" stopColor="#2a4060"/>
          </linearGradient>
        </defs>
        <rect x={x} y={y} width={w} height={h} fill="url(#skyGrad)"/>
        {/* Stars */}
        {[0.1,0.3,0.5,0.7,0.9,0.2,0.6,0.8].map((sx,i) => (
          <circle key={i} cx={x+sx*w} cy={y+(i*0.07+0.05)*h}
            r={1.5} fill="white" opacity={0.6}/>
        ))}
        {/* Buildings */}
        {blds.map((b,i) => (
          <g key={i}>
            <rect
              x={x + b.rx * w} y={y + h * (1 - b.rh)}
              width={b.rw * w} height={h * b.rh}
              fill={`hsl(${220+i*8},${20+i*3}%,${12+i*2}%)`}
            />
            {/* Windows on building */}
            {[0.2,0.45,0.7].map((wy,wi) =>
              [0.2,0.6].map((wxx,wxi) => (
                <rect key={`${wi}-${wxi}`}
                  x={x + (b.rx + b.rw*wxx) * w - 2}
                  y={y + h*(1-b.rh) + h*b.rh*wy - 2}
                  width={3} height={4}
                  fill={Math.random() > 0.4 ? "#f59e0b" : "#1e3050"}
                  opacity={0.9}
                />
              ))
            )}
          </g>
        ))}
      </g>
    );
  }

  return (
    <svg
      width={WORLD_W} height={WORLD_H}
      style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}
    >
      <defs>
        <linearGradient id="leftWallGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9ca3af"/>
          <stop offset="100%" stopColor="#c4c9d4"/>
        </linearGradient>
        <linearGradient id="rightWallGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#d1d5db"/>
          <stop offset="100%" stopColor="#b8bfc9"/>
        </linearGradient>
        <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4823a"/>
          <stop offset="100%" stopColor="#b86a28"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="8" floodOpacity="0.4"/>
        </filter>
        <filter id="glow">
          <feGaussianBlur stdDeviation="6" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        {/* Clip paths for windows */}
        {leftWindows.map((w, i) => {
          const [wx, wy] = tileToWorld(0, w.row);
          const [wx2, wy2] = tileToWorld(0, w.row + w.h);
          const wW = 180, wH = WALL_H * 0.55;
          return (
            <clipPath key={`lwc${i}`} id={`lwclip${i}`}>
              <polygon points={`${wx-wW/2},${wy-WALL_H*0.75} ${wx+wW/2},${wy-WALL_H*0.75} ${wx2+wW/2},${wy2-WALL_H*0.20} ${wx2-wW/2},${wy2-WALL_H*0.20}`}/>
            </clipPath>
          );
        })}
      </defs>

      {/* ── Left wall ── */}
      <polygon points={pts(leftWall)} fill="url(#leftWallGrad)" opacity="0.97"/>

      {/* Left wall windows with city skyline */}
      {leftWindows.map((win, i) => {
        const [wx,  wy]  = tileToWorld(0, win.row);
        const [wx2, wy2] = tileToWorld(0, win.row + win.h);
        // Window frame: a skewed quad on the left wall surface
        const winW = 160, topY = WALL_H * 0.72, botY = WALL_H * 0.22;
        const p1x = wx - winW/2, p1y = wy - topY;
        const p2x = wx + winW/2, p2y = wy - topY;
        const p3x = wx2 + winW/2, p3y = wy2 - botY;
        const p4x = wx2 - winW/2, p4y = wy2 - botY;
        const wW = p2x - p1x, wH = (p3y + p4y)/2 - (p1y + p2y)/2;
        const skyX = Math.min(p1x,p4x), skyY = Math.min(p1y,p2y);
        const skyW = Math.abs(p2x - p4x) + winW;
        const skyH = Math.abs(p4y - p2y) + wH;
        return (
          <g key={i}>
            {/* Sky inside window — approximate with rect clipped */}
            <polygon points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y} ${p4x},${p4y}`}
              fill="#0a1628"/>
            {/* City silhouette */}
            <polygon points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y} ${p4x},${p4y}`}
              fill="none" stroke="#3b5280" strokeWidth="1" opacity="0.5"/>
            {/* Buildings as trapezoid-clipped rects */}
            {[0.08,0.22,0.38,0.54,0.70,0.84].map((bx, bi) => {
              const bh = [0.7,0.5,0.85,0.55,0.75,0.45][bi] ?? 0.6;
              const bwFrac = 0.10;
              // interpolate x,y along the window parallelogram
              const interp = (t: number) => {
                const lx = p1x + (p4x - p1x) * t, ly = p1y + (p4y - p1y) * t;
                const rx = p2x + (p3x - p2x) * t, ry = p2y + (p3y - p2y) * t;
                return { lx, ly, rx, ry };
              };
              const top = interp(1 - bh * 0.85);
              const bot = interp(1.0);
              const cx = top.lx + (top.rx - top.lx) * bx;
              const cy = top.ly + (top.ry - top.ly) * bx;
              const bxE = top.lx + (top.rx - top.lx) * Math.min(bx + bwFrac, 1);
              const byE = top.ly + (top.ry - top.ly) * Math.min(bx + bwFrac, 1);
              const bx2 = bot.lx + (bot.rx - bot.lx) * bx;
              const by2 = bot.ly + (bot.ry - bot.ly) * bx;
              const bx2E = bot.lx + (bot.rx - bot.lx) * Math.min(bx + bwFrac, 1);
              const by2E = bot.ly + (bot.ry - bot.ly) * Math.min(bx + bwFrac, 1);
              return (
                <g key={bi}>
                  <polygon points={`${cx},${cy} ${bxE},${byE} ${bx2E},${by2E} ${bx2},${by2}`}
                    fill={`hsl(${220+bi*10},25%,${14+bi*2}%)`} opacity="0.95"/>
                  {/* Lit windows */}
                  <circle cx={(cx+bxE)/2} cy={(cy+byE+cy+byE)/4 + (by2-cy)*0.3}
                    r={2.5} fill="#f59e0b" opacity={bi%2===0 ? 0.9 : 0.3}/>
                </g>
              );
            })}
            {/* Window frame */}
            <polygon points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y} ${p4x},${p4y}`}
              fill="none" stroke="#e2e8f0" strokeWidth="5" opacity="0.8"/>
            <polygon points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y} ${p4x},${p4y}`}
              fill="none" stroke="#94a3b8" strokeWidth="2" opacity="0.6"/>
            {/* Sill */}
            <line x1={p4x} y1={p4y} x2={p3x} y2={p3y} stroke="#cbd5e1" strokeWidth="4"/>
          </g>
        );
      })}

      {/* Left wall art / decor */}
      {(() => {
        const [ax, ay] = tileToWorld(0, 5);
        return (
          <g>
            <rect x={ax-55} y={ay-WALL_H*0.75} width={110} height={110}
              fill="#c9a96e" rx="3"/>
            <rect x={ax-48} y={ay-WALL_H*0.75+7} width={96} height={96}
              fill="#f0e8d4" rx="2"/>
            <ellipse cx={ax} cy={ay-WALL_H*0.75+55} rx={32} ry={28}
              fill="#c87941" opacity="0.85"/>
            <ellipse cx={ax-10} cy={ay-WALL_H*0.75+68} rx={20} ry={15}
              fill="#1a0f08" opacity="0.8"/>
          </g>
        );
      })()}

      {/* ── Right wall ── */}
      <polygon points={pts(rightWall)} fill="url(#rightWallGrad)" opacity="0.97"/>

      {/* Right wall windows with city skyline */}
      {rightWindows.map((win, i) => {
        const [wx,  wy]  = tileToWorld(win.col, 0);
        const [wx2, wy2] = tileToWorld(win.col + win.w, 0);
        const topY = WALL_H * 0.75, botY = WALL_H * 0.20;
        const p1x = wx,  p1y = wy - topY;
        const p2x = wx2, p2y = wy2 - topY;
        const p3x = wx2, p3y = wy2 - botY;
        const p4x = wx,  p4y = wy - botY;
        return (
          <g key={i}>
            <polygon points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y} ${p4x},${p4y}`}
              fill="#081020"/>
            {[0.1,0.25,0.45,0.65,0.80].map((bx, bi) => {
              const bh = [0.8,0.55,0.9,0.6,0.7][bi] ?? 0.65;
              const wTop = p1y + (p2y - p1y)*bx;
              const wBot = p4y + (p3y - p4y)*bx;
              const wH = wBot - wTop;
              const bTopY = wTop + wH * (1 - bh);
              const bW = (p2x - p1x) * 0.12;
              const bLeft = p1x + (p2x - p1x)*bx - bW/2;
              return (
                <g key={bi}>
                  <rect x={bLeft} y={bTopY} width={bW} height={wH * bh}
                    fill={`hsl(${215+bi*12},22%,${12+bi*3}%)`}/>
                  <rect x={bLeft+bW*0.2} y={bTopY+wH*0.2} width={bW*0.25} height={5}
                    fill="#f59e0b" opacity={bi%2===0 ? 0.9 : 0.2}/>
                </g>
              );
            })}
            {/* Frame */}
            <polygon points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y} ${p4x},${p4y}`}
              fill="none" stroke="#e2e8f0" strokeWidth="5" opacity="0.8"/>
            <line x1={p4x} y1={p4y} x2={p3x} y2={p3y} stroke="#cbd5e1" strokeWidth="4"/>
          </g>
        );
      })}

      {/* Right wall art */}
      {(() => {
        const [ax, ay] = tileToWorld(10, 0);
        return (
          <g>
            <rect x={ax-55} y={ay-WALL_H*0.72} width={110} height={110}
              fill="#c9a96e" rx="3"/>
            <rect x={ax-48} y={ay-WALL_H*0.72+7} width={96} height={96}
              fill="#f0e8d4" rx="2"/>
            <circle cx={ax} cy={ay-WALL_H*0.72+45} r={28} fill="#c87941" opacity="0.8"/>
            <ellipse cx={ax} cy={ay-WALL_H*0.72+72} rx={24} ry={14}
              fill="#1a0f08" opacity="0.75"/>
          </g>
        );
      })()}

      {/* ── Ceiling / back-wall ridge ── */}
      <line
        x1={fx0} y1={fy0 - WALL_H}
        x2={fx1} y2={fy1 - WALL_H}
        stroke="#b0b8c6" strokeWidth="3" opacity="0.6"
      />
      <line
        x1={fx0} y1={fy0 - WALL_H}
        x2={fx3} y2={fy3 - WALL_H}
        stroke="#b0b8c6" strokeWidth="3" opacity="0.6"
      />

      {/* Ceiling lights */}
      {lights.map(([lc, lr], i) => {
        const [lx, ly] = tileToWorld(lc, lr);
        const lightY = ly - WALL_H + 30;
        return (
          <g key={i} filter="url(#glow)">
            {/* Fixture */}
            <rect x={lx-18} y={lightY-8} width={36} height={12}
              rx="4" fill="#d4d8e0"/>
            {/* Cone of light */}
            <polygon
              points={`${lx-14},${lightY+4} ${lx+14},${lightY+4} ${lx+55},${lightY+WALL_H*0.82} ${lx-55},${lightY+WALL_H*0.82}`}
              fill="rgba(255,240,200,0.07)"
            />
            {/* Bright spot on floor */}
            <ellipse cx={lx} cy={lightY+WALL_H*0.82}
              rx={50} ry={20}
              fill="rgba(255,235,180,0.12)"
            />
          </g>
        );
      })}

      {/* ── Baseboard / skirting ── */}
      <polyline
        points={`${fx0},${fy0} ${fx3},${fy3}`}
        stroke="#e8e0d0" strokeWidth="5" opacity="0.5"
      />
      <polyline
        points={`${fx0},${fy0} ${fx1},${fy1}`}
        stroke="#d8d0c0" strokeWidth="5" opacity="0.4"
      />

      {/* ── Floor tiles ── */}
      {Array.from({ length: ROWS }).map((_, row) =>
        Array.from({ length: COLS }).map((_, col) => {
          const [x0,y0] = tileToWorld(col,   row);
          const [x1,y1] = tileToWorld(col+1, row);
          const [x2,y2] = tileToWorld(col+1, row+1);
          const [x3,y3] = tileToWorld(col,   row+1);
          const shade = (col + row) % 2 === 0 ? 0 : 1;
          // Slight brightness variation for wood-plank feel
          const brightness = 0.92 + ((col * 7 + row * 11) % 13) * 0.007;
          const base = shade === 0 ? "#c8783a" : "#b46c2e";
          return (
            <polygon key={`${col}-${row}`}
              points={`${x0},${y0} ${x1},${y1} ${x2},${y2} ${x3},${y3}`}
              fill={base}
              opacity={brightness}
              stroke="#a0581a"
              strokeWidth="0.5"
              strokeOpacity="0.4"
            />
          );
        })
      )}

      {/* ── Floor edge / front border ── */}
      <polygon
        points={`${fx3},${fy3} ${fx2},${fy2} ${fx2},${fy2+12} ${fx3},${fy3+12}`}
        fill="#8a4a18" opacity="0.8"
      />
      <polygon
        points={`${fx1},${fy1} ${fx2},${fy2} ${fx2},${fy2+12} ${fx1},${fy1+12}`}
        fill="#9a5420" opacity="0.8"
      />

      {/* ── Corner plants ── */}
      {[
        tileToWorld(0, ROWS),    // front-left
        tileToWorld(COLS, 0),   // front-right (actually back-right)
      ].map(([px, py], i) => (
        <g key={i}>
          {/* Pot */}
          <ellipse cx={px} cy={py - 4} rx={28} ry={10} fill="#f0f0f0"/>
          <rect x={px-22} y={py-28} width={44} height={28} rx="4" fill="#e8e8e8"/>
          <ellipse cx={px} cy={py-28} rx={22} ry={8} fill="#f8f8f8"/>
          {/* Plant leaves */}
          {[0,60,120,180,240,300].map((deg, li) => {
            const rad = (deg * Math.PI) / 180;
            const lx = px + Math.cos(rad) * 42;
            const ly = py - 80 + Math.sin(rad) * 18;
            return (
              <ellipse key={li}
                cx={(px + lx)/2} cy={(py - 60 + ly)/2 - 15}
                rx={22} ry={9}
                fill={li%2===0 ? "#2d6a2d" : "#1e5a1e"}
                transform={`rotate(${deg-10}, ${(px+lx)/2}, ${(py-60+ly)/2-15})`}
                opacity="0.9"
              />
            );
          })}
          {/* Trunk */}
          <rect x={px-5} y={py-60} width={10} height={35} fill="#5c3d1a" rx="3"/>
        </g>
      ))}

      {/* ── Back-corner plant (small) ── */}
      {(() => {
        const [px, py] = tileToWorld(0, 0);
        return (
          <g>
            <ellipse cx={px} cy={py-6} rx={18} ry={6} fill="#f0f0f0"/>
            <rect x={px-14} y={py-20} width={28} height={18} rx="3" fill="#e8e8e8"/>
            {[0,72,144,216,288].map((deg, li) => {
              const rad = (deg * Math.PI) / 180;
              return (
                <ellipse key={li}
                  cx={px + Math.cos(rad)*26} cy={py-42+Math.sin(rad)*10}
                  rx={14} ry={6}
                  fill={li%2===0 ? "#2d6a2d" : "#1e5a1e"}
                  transform={`rotate(${deg}, ${px+Math.cos(rad)*26}, ${py-42+Math.sin(rad)*10})`}
                  opacity="0.85"
                />
              );
            })}
            <rect x={px-4} y={py-42} width={8} height={24} fill="#5c3d1a" rx="2"/>
          </g>
        );
      })()}
    </svg>
  );
}

// ─── Progress ring ────────────────────────────────────────────────────────────
function ProgressRing({ pct, color, size }: { pct:number; color:string; size:number }) {
  const r=(size-8)/2, circ=2*Math.PI*r, dash=(pct/100)*circ;
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e3050" strokeWidth="5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition:"stroke-dasharray 0.6s ease" }}/>
      <text x={size/2} y={size/2+5} textAnchor="middle" fill="white"
        fontSize="13" fontFamily="JetBrains Mono,monospace" fontWeight="bold">{pct}%</text>
    </svg>
  );
}

function Sparkline({ data, color, w, h }: { data:number[]; color:string; w:number; h:number }) {
  if (data.length < 2) return <div style={{ width:w, height:h, background:"#0c1624", borderRadius:4 }}/>;
  const max=Math.max(...data), min=Math.min(...data), range=max-min||1;
  const pts = data.map((v,i) => {
    const x = 4+(i/(data.length-1))*(w-8);
    const y = h-4-((v-min)/range)*(h-8);
    return `${x},${y}`;
  }).join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg width={w} height={h} style={{ display:"block" }}>
      <rect x={0} y={0} width={w} height={h} rx={4} fill="#0c1624"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" opacity="0.9"/>
      <circle cx={last[0]} cy={last[1]} r={3} fill={color}/>
    </svg>
  );
}

// ─── Stats HUD ─────────────────────────────────────────────────────────────────
function StatsHUD({ project, agents, sparkData }: { project:Project|null; agents:Agent[]; sparkData:number[] }) {
  const active = agents.filter(a => a.status !== "idle").length;
  return (
    <div className="absolute top-3 right-3 flex flex-col gap-2 pointer-events-none" style={{ width:158, zIndex:50 }}>
      <div className="rounded-xl p-3" style={{ background:"rgba(8,14,26,0.93)", border:"1px solid #1e3050" }}>
        <div style={{ fontSize:8, color:"#64748b", letterSpacing:"0.08em", fontFamily:"Inter",
          textTransform:"uppercase", marginBottom:8 }}>Project Progress</div>
        <div className="flex items-center gap-3">
          <ProgressRing pct={project?.progress??0} color="#6366f1" size={52}/>
          <div>
            <div style={{ fontSize:10, color:"#94a3b8", fontFamily:"monospace" }}>
              {project?.tasksCompleted??0}/{project?.tasksTotal??0} tasks
            </div>
            <div style={{ fontSize:9, marginTop:3, fontFamily:"monospace",
              color: project?.status==="completed" ? "#10b981" : project ? "#f59e0b" : "#475569" }}>
              {project?.status==="completed" ? "✓ Done" : project?.status==="planning" ? "● Planning" : project ? "● Running" : "○ Idle"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl p-3" style={{ background:"rgba(8,14,26,0.93)", border:"1px solid #1e3050" }}>
        <div style={{ fontSize:8, color:"#64748b", letterSpacing:"0.08em", fontFamily:"Inter",
          textTransform:"uppercase", marginBottom:8 }}>Agents · {active}/{agents.length} active</div>
        <div className="flex gap-1.5 flex-wrap">
          {agents.map(a => (
            <div key={a.id} title={`${a.name} — ${a.status}`} style={{
              width:11, height:11, borderRadius:"50%",
              background: a.status==="idle" ? "#1e3050" : a.color,
              border:`1.5px solid ${a.color}`,
              boxShadow: a.status!=="idle" ? `0 0 5px ${a.color}` : "none",
              transition:"all 0.3s",
            }}/>
          ))}
        </div>
      </div>

      {[
        { label:"Tokens",       value:fmt(project?.tokensUsed??0),                   color:"#f59e0b" },
        { label:"Cost Today",   value:`$${(project?.costToday??0).toFixed(2)}`,       color:"#10b981" },
        { label:"Avg Response", value:`${(project?.avgResponseTime??0).toFixed(1)}s`, color:"#06b6d4" },
      ].map(m => (
        <div key={m.label} className="rounded-xl px-3 py-2 flex items-center justify-between"
          style={{ background:"rgba(8,14,26,0.93)", border:"1px solid #1e3050" }}>
          <span style={{ fontSize:8, color:"#64748b", fontFamily:"Inter", textTransform:"uppercase", letterSpacing:"0.08em" }}>{m.label}</span>
          <span style={{ fontSize:13, color:m.color, fontFamily:"JetBrains Mono,monospace", fontWeight:700 }}>{m.value}</span>
        </div>
      ))}

      <div className="rounded-xl p-3" style={{ background:"rgba(8,14,26,0.93)", border:"1px solid #1e3050" }}>
        <div style={{ fontSize:8, color:"#64748b", letterSpacing:"0.08em", fontFamily:"Inter",
          textTransform:"uppercase", marginBottom:8 }}>Progress Trend</div>
        <Sparkline data={sparkData} color="#6366f1" w={130} h={32}/>
      </div>
    </div>
  );
}

// ─── Mini-map ──────────────────────────────────────────────────────────────────
function MiniMap({ pan, zoom, vpW, vpH, agents, tilePositions }: {
  pan:[number,number]; zoom:number; vpW:number; vpH:number;
  agents:Agent[]; tilePositions:[number,number][];
}) {
  const W = 130, H = 100;
  const scaleX = W / WORLD_W;
  const scaleY = H / WORLD_H;
  const vpLeft  = (-pan[0] / zoom) * scaleX;
  const vpTop   = (-pan[1] / zoom) * scaleY;
  const vpRectW = (vpW / zoom) * scaleX;
  const vpRectH = (vpH / zoom) * scaleY;

  return (
    <div className="absolute bottom-3 right-3 rounded-xl overflow-hidden pointer-events-none"
      style={{ width:W, height:H, zIndex:50, border:"1px solid #1e3050",
        background:"rgba(8,14,26,0.92)", boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }}>
      <svg width={W} height={H} style={{ position:"absolute", inset:0 }}>
        {/* Floor outline */}
        {(() => {
          const corners = [
            tileToWorld(0,0), tileToWorld(COLS,0),
            tileToWorld(COLS,ROWS), tileToWorld(0,ROWS),
          ].map(([x,y]) => `${x*scaleX},${y*scaleY}`).join(" ");
          return <polygon points={corners} fill="#b8682a" opacity="0.4" stroke="#c87830" strokeWidth="1"/>;
        })()}
        {/* Agents */}
        {agents.map((a, i) => {
          const pos = tilePositions[i];
          if (!pos) return null;
          const [wx, wy] = tileToWorld(pos[0], pos[1]);
          const active = a.status !== "idle";
          return (
            <g key={a.id}>
              {active && <circle cx={wx*scaleX} cy={wy*scaleY} r={5} fill={a.color} opacity={0.2}/>}
              <circle cx={wx*scaleX} cy={wy*scaleY} r={3} fill={active ? a.color : "#334155"} stroke={a.color} strokeWidth="1"/>
            </g>
          );
        })}
        {/* Viewport rect */}
        <rect
          x={clamp(vpLeft, 0, W-2)} y={clamp(vpTop, 0, H-2)}
          width={clamp(vpRectW, 2, W - clamp(vpLeft, 0, W))}
          height={clamp(vpRectH, 2, H - clamp(vpTop, 0, H))}
          fill="rgba(99,102,241,0.10)" stroke="#6366f1" strokeWidth="1.5" rx="2"/>
      </svg>
      <div style={{ position:"absolute", bottom:3, left:5,
        fontSize:7, color:"#475569", fontFamily:"Inter", letterSpacing:"0.06em", textTransform:"uppercase" }}>
        map
      </div>
    </div>
  );
}

// ─── Single agent sprite ───────────────────────────────────────────────────────
function AgentSprite({ agent, wx, wy, spriteSize, zoom }: {
  agent: Agent; wx:number; wy:number; spriteSize:number; zoom: number;
}) {
  const status   = agent.status;
  const isActive = status === "working" || status === "thinking";
  const isDone   = status === "done";
  const isIdle   = status === "idle";
  const isBlocked = status === "blocked";
  const task     = agent.currentTask;
  const color    = agent.color;

  const labelSize = Math.round(clamp(11 / zoom, 9, 15));
  const spriteImg = SPRITE_MAP[agent.spriteType] ?? SPRITE_MAP["manager"];

  const filterStyle = isIdle
    ? "grayscale(45%) brightness(0.7)"
    : isBlocked
    ? "grayscale(20%) brightness(0.75) sepia(0.4) hue-rotate(310deg)"
    : isDone
    ? `drop-shadow(0 0 ${14/zoom}px ${color}) brightness(1.08)`
    : isActive
    ? `drop-shadow(0 0 ${9/zoom}px ${color}88)`
    : "none";

  const sw = spriteSize;

  return (
    <div
      data-testid={`sprite-${agent.id}`}
      style={{
        position: "absolute",
        left: wx - sw / 2,
        top:  wy - sw,
        width: sw,
        zIndex: Math.round(wy),   // isometric depth sort
        transition: "filter 0.4s ease",
        filter: filterStyle,
      }}
    >
      {/* Floor shadow */}
      <div style={{
        position:"absolute", bottom:0, left:"50%",
        transform:"translateX(-50%)",
        width: sw * 0.55, height: sw * 0.07,
        background:"radial-gradient(ellipse, rgba(0,0,0,0.55) 0%, transparent 70%)",
        borderRadius:"50%",
      }}/>

      {/* Active glow ring */}
      {isActive && (
        <div style={{
          position:"absolute", bottom:0, left:"50%",
          transform:"translateX(-50%)",
          width: sw * 0.65, height: sw * 0.10,
          background:`radial-gradient(ellipse, ${color}55 0%, transparent 70%)`,
          borderRadius:"50%",
          animation:"glowPulse 2s ease-in-out infinite",
        }}/>
      )}

      {/* Blocked indicator */}
      {isBlocked && (
        <div style={{
          position:"absolute", top: -(clamp(20/zoom,14,26)), right:0,
          fontSize: clamp(14/zoom,10,18), pointerEvents:"none",
          animation:"celebBounce 0.8s ease infinite alternate",
        }}>⛔</div>
      )}

      {/* Speech bubble */}
      {task && (isActive || isDone || isBlocked) && (
        <div style={{
          position:"absolute",
          bottom: sw + 4,
          left:"50%", transform:"translateX(-50%)",
          whiteSpace:"nowrap", pointerEvents:"none",
        }}>
          <div style={{
            background:"rgba(4,8,18,0.96)", border:`1.5px solid ${isBlocked ? "#ef4444" : color}`,
            color: isBlocked ? "#ef4444" : color,
            padding:`${clamp(4/zoom,3,7)}px ${clamp(10/zoom,7,15)}px`,
            borderRadius: clamp(20/zoom, 10, 24),
            fontSize: clamp(10/zoom, 8, 13),
            fontFamily:"JetBrains Mono,monospace", fontWeight:600,
            boxShadow:`0 2px 14px ${color}44`, lineHeight:1.3,
          }}>
            {isBlocked ? "⚠ Blocked" : (task.length > 28 ? task.slice(0,28)+"…" : task)}
          </div>
          <div style={{ display:"flex", justifyContent:"center", marginTop:-1 }}>
            <div style={{ width:0, height:0,
              borderLeft:`${clamp(4/zoom,3,6)}px solid transparent`,
              borderRight:`${clamp(4/zoom,3,6)}px solid transparent`,
              borderTop:`${clamp(5/zoom,4,7)}px solid ${isBlocked ? "#ef4444" : color}`,
            }}/>
          </div>
        </div>
      )}

      {/* Sprite image */}
      <img src={spriteImg} alt={agent.name}
        style={{ width:"100%", display:"block", userSelect:"none" }} draggable={false}/>

      {/* Name label */}
      <div style={{
        position:"absolute",
        bottom: -(labelSize * 2.8),
        left:"50%", transform:"translateX(-50%)",
        whiteSpace:"nowrap",
        display:"flex", alignItems:"center",
        gap: clamp(4/zoom, 3, 6),
        padding:`${clamp(4/zoom,3,6)}px ${clamp(10/zoom,8,14)}px`,
        background:"rgba(4,8,18,0.95)",
        border:`1.5px solid ${isBlocked ? "#ef4444" : isActive ? color : color+"99"}`,
        borderRadius: clamp(20/zoom, 10, 24),
        boxShadow:"0 2px 10px rgba(0,0,0,0.8)",
        pointerEvents:"none",
      }}>
        <div style={{
          width: clamp(7/zoom, 5, 9), height: clamp(7/zoom, 5, 9),
          borderRadius:"50%", flexShrink:0,
          background: isIdle ? "#475569" : isDone ? "#10b981" : isBlocked ? "#ef4444" : color,
          boxShadow: isActive ? `0 0 ${clamp(5/zoom,4,8)}px ${color}` : "none",
          transition:"all 0.3s",
        }}/>
        <span style={{
          fontSize: labelSize,
          color: "#ffffff",
          fontFamily:"Inter,sans-serif", fontWeight:700, lineHeight:1,
          textShadow:"0 1px 4px rgba(0,0,0,1)",
        }}>
          {agent.name}
        </span>
      </div>

      {/* Done celebration */}
      {isDone && (
        <div style={{
          position:"absolute", right:0, top: -(clamp(26/zoom, 18, 32)),
          fontSize: clamp(16/zoom, 10, 20),
          pointerEvents:"none",
          animation:"celebBounce 0.6s ease infinite alternate",
        }}>🎉</div>
      )}
    </div>
  );
}

// ─── Delegation arcs ───────────────────────────────────────────────────────────
function DelegationArcs({ agents, tilePositions, spriteSize }: {
  agents: Agent[]; tilePositions:[number,number][]; spriteSize:number;
}) {
  const managerPos = tilePositions[0];
  if (!managerPos) return null;
  const [mx, my] = tileToWorld(managerPos[0], managerPos[1]);
  const mcy = my - spriteSize / 2;

  const activeAgents = agents.slice(1).filter(a => a.status === "working" || a.status === "thinking");

  return (
    <svg style={{ position:"absolute", top:0, left:0, width:WORLD_W, height:WORLD_H,
      pointerEvents:"none", zIndex:5 }} overflow="visible">
      {activeAgents.map((a) => {
        const aIdx = agents.indexOf(a);
        const aPos = tilePositions[aIdx];
        if (!aPos) return null;
        const [ax, ay] = tileToWorld(aPos[0], aPos[1]);
        const acy = ay - spriteSize / 2;
        const dx = ax - mx, dy = acy - mcy;
        const cx = mx + dx * 0.5, cy = mcy + dy * 0.5 - 100;
        return (
          <g key={a.id}>
            <path d={`M ${mx} ${mcy} Q ${cx} ${cy} ${ax} ${acy}`}
              fill="none" stroke={a.color} strokeWidth="2.5" strokeDasharray="10 7"
              opacity="0.55"
              style={{ animation:"dashFlow 1.5s linear infinite" }}
            />
            <circle cx={ax} cy={acy} r={7} fill={a.color} opacity={0.28}
              style={{ animation:"glowPulse 2s ease-in-out infinite" }}/>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Zoom controls ─────────────────────────────────────────────────────────────
function ZoomControls({ onIn, onOut, onReset, zoom }: { onIn:()=>void; onOut:()=>void; onReset:()=>void; zoom:number }) {
  return (
    <div className="absolute bottom-3 left-3 flex flex-col gap-1" style={{ zIndex:50 }}>
      {[
        { label:"+", action:onIn,    tip:"Zoom in"   },
        { label:"⌂", action:onReset, tip:"Reset view" },
        { label:"−", action:onOut,   tip:"Zoom out"  },
      ].map(b => (
        <button key={b.label} onClick={b.action} title={b.tip} style={{
          width:32, height:32, borderRadius:8,
          background:"rgba(8,14,26,0.92)", border:"1px solid #1e3050",
          color:"#94a3b8", fontSize:16, fontWeight:700, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
        }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "#6366f1")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "#1e3050")}
        >{b.label}</button>
      ))}
      <div style={{ textAlign:"center", marginTop:1, fontSize:9, color:"#475569", fontFamily:"JetBrains Mono,monospace" }}>
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}

function DragHint() {
  const [show, setShow] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShow(false), 5000); return () => clearTimeout(t); }, []);
  if (!show) return null;
  return (
    <div className="absolute pointer-events-none" style={{
      bottom: 50, left:"50%", transform:"translateX(-50%)",
      zIndex:60, background:"rgba(8,14,26,0.88)", border:"1px solid #1e3050",
      borderRadius:12, padding:"8px 16px",
      fontSize:11, color:"#94a3b8", fontFamily:"Inter",
      display:"flex", alignItems:"center", gap:8,
      animation:"fadeOut 0.5s ease 4.5s forwards",
    }}>
      <span style={{ fontSize:16 }}>✋</span>
      Drag to pan · Scroll or pinch to zoom
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function IsometricOffice({ agents, project }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vpDims, setVpDims]       = useState({ w:1200, h:700 });
  const [pan, setPan]             = useState<[number,number]>([0, 0]);
  const [zoom, setZoom]           = useState(ZOOM_INIT);
  const [sparkData, setSparkData] = useState<number[]>([0,0,0,0,0]);
  const initialFitDone            = useRef(false);

  const dragRef    = useRef<{ sx:number; sy:number; sp:[number,number] }|null>(null);
  const isDragging = useRef(false);

  // Tile positions for each agent
  const tilePositions = computePositions(agents.length);
  const SPRITE_SIZE   = spriteWorldPx(agents.length);

  // Clamp pan so you can't drag the room entirely off-screen
  const clampPan = useCallback((px:number, py:number, z:number): [number,number] => {
    const pad = 200;
    return [
      clamp(px, -(WORLD_W * z - pad), vpDims.w - pad),
      clamp(py, -(WORLD_H * z - pad), vpDims.h - pad),
    ];
  }, [vpDims]);

  // Compute a pan that centres the floor in the viewport at zoom z
  const floorCentrePan = useCallback((z: number): [number,number] => {
    // Floor centre in world coords
    const [fcx, fcy] = tileToWorld(COLS/2, ROWS/2);
    return [
      vpDims.w/2 - fcx * z,
      vpDims.h/2 - fcy * z,
    ];
  }, [vpDims]);

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0]; if (!e) return;
      const w = e.contentRect.width, h = e.contentRect.height;
      setVpDims({ w, h });
      if (!initialFitDone.current) {
        initialFitDone.current = true;
        // Choose zoom so the floor width fills ~80% of viewport width
        const [floorLeft]  = tileToWorld(0, ROWS/2);
        const [floorRight] = tileToWorld(COLS, ROWS/2);
        const floorWidthWorld = floorRight - floorLeft;
        const fz = clamp((w * 0.80) / floorWidthWorld, ZOOM_MIN, ZOOM_MAX);
        setZoom(fz);
        const [fcx, fcy] = tileToWorld(COLS/2, ROWS/2);
        setPan([w/2 - fcx*fz, h/2 - fcy*fz]);
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (project?.progress !== undefined)
      setSparkData(d => [...d.slice(-9), project.progress]);
  }, [project?.progress]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, sp: pan };
    e.preventDefault();
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx, dy = e.clientY - dragRef.current.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging.current = true;
    if (!isDragging.current) return;
    setPan(clampPan(dragRef.current.sp[0] + dx, dragRef.current.sp[1] + dy, zoom));
  }, [zoom, clampPan]);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  const touchRef = useRef<{ sx:number; sy:number; sp:[number,number]; d0?:number; z0?:number }|null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) touchRef.current = { sx:e.touches[0].clientX, sy:e.touches[0].clientY, sp:pan };
    else if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[1].clientX-e.touches[0].clientX, e.touches[1].clientY-e.touches[0].clientY);
      touchRef.current = { sx:0, sy:0, sp:pan, d0:d, z0:zoom };
    }
  }, [pan, zoom]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touchRef.current) return;
    if (e.touches.length === 1 && !touchRef.current.d0) {
      setPan(clampPan(touchRef.current.sp[0]+(e.touches[0].clientX-touchRef.current.sx),
        touchRef.current.sp[1]+(e.touches[0].clientY-touchRef.current.sy), zoom));
    } else if (e.touches.length === 2 && touchRef.current.d0) {
      const d = Math.hypot(e.touches[1].clientX-e.touches[0].clientX, e.touches[1].clientY-e.touches[0].clientY);
      setZoom(clamp((touchRef.current.z0??zoom) * (d/touchRef.current.d0), ZOOM_MIN, ZOOM_MAX));
    }
  }, [zoom, clampPan]);

  const onTouchEnd = useCallback(() => { touchRef.current = null; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(z => {
      const nz = clamp(z + delta, ZOOM_MIN, ZOOM_MAX);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        setPan(([px, py]) => {
          const wx = (mx - px) / z, wy = (my - py) / z;
          return clampPan(mx - wx*nz, my - wy*nz, nz);
        });
      }
      return nz;
    });
  }, [clampPan]);

  const handleReset = useCallback(() => {
    const [floorLeft]  = tileToWorld(0, ROWS/2);
    const [floorRight] = tileToWorld(COLS, ROWS/2);
    const floorWidthWorld = floorRight - floorLeft;
    const fz = clamp((vpDims.w * 0.80) / floorWidthWorld, ZOOM_MIN, ZOOM_MAX);
    setZoom(fz);
    const [fcx, fcy] = tileToWorld(COLS/2, ROWS/2);
    setPan([vpDims.w/2 - fcx*fz, vpDims.h/2 - fcy*fz]);
  }, [vpDims]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ background:"linear-gradient(160deg,#060c16 0%,#09121e 100%)", cursor:"grab", userSelect:"none" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <style>{`
        @keyframes glowPulse {
          0%,100% { opacity:0.4; transform:translateX(-50%) scaleX(1); }
          50%      { opacity:0.9; transform:translateX(-50%) scaleX(1.45); }
        }
        @keyframes celebBounce {
          from { transform:translateY(0); }
          to   { transform:translateY(-8px); }
        }
        @keyframes fadeOut {
          from { opacity:1; }
          to   { opacity:0; }
        }
        @keyframes dashFlow {
          to { stroke-dashoffset: -34; }
        }
      `}</style>

      {/* ═══ Pannable world ═════════════════════════════════════════════════════ */}
      <div style={{
        position:"absolute", left:pan[0], top:pan[1],
        width:WORLD_W, height:WORLD_H,
        transformOrigin:"0 0", transform:`scale(${zoom})`, willChange:"transform",
      }}>
        {/* SVG room — walls, floor, windows, lights, plants */}
        <IsometricRoom />

        {/* Delegation arcs */}
        <DelegationArcs agents={agents} tilePositions={tilePositions} spriteSize={SPRITE_SIZE} />

        {/* Agent sprites */}
        {agents.map((agent, i) => {
          const pos = tilePositions[i];
          if (!pos) return null;
          const [wx, wy] = tileToWorld(pos[0], pos[1]);
          return (
            <AgentSprite
              key={agent.id}
              agent={agent}
              wx={wx}
              wy={wy}
              spriteSize={SPRITE_SIZE}
              zoom={zoom}
            />
          );
        })}
      </div>

      {/* ═══ Fixed HUD overlays ═════════════════════════════════════════════════ */}
      <StatsHUD project={project} agents={agents} sparkData={sparkData}/>
      <MiniMap pan={pan} zoom={zoom} vpW={vpDims.w} vpH={vpDims.h}
        agents={agents} tilePositions={tilePositions}/>
      <ZoomControls
        onIn={() => {
          const nz = clamp(zoom + ZOOM_STEP*2, ZOOM_MIN, ZOOM_MAX);
          setPan(([px,py]) => {
            const cx=vpDims.w/2, cy=vpDims.h/2;
            const wx=(cx-px)/zoom, wy=(cy-py)/zoom;
            return clampPan(cx-wx*nz, cy-wy*nz, nz);
          });
          setZoom(nz);
        }}
        onOut={() => {
          const nz = clamp(zoom - ZOOM_STEP*2, ZOOM_MIN, ZOOM_MAX);
          setPan(([px,py]) => {
            const cx=vpDims.w/2, cy=vpDims.h/2;
            const wx=(cx-px)/zoom, wy=(cy-py)/zoom;
            return clampPan(cx-wx*nz, cy-wy*nz, nz);
          });
          setZoom(nz);
        }}
        onReset={handleReset}
        zoom={zoom}
      />

      {/* Project banner */}
      <div className="absolute pointer-events-none" style={{ bottom:42, left:3, zIndex:50 }}>
        {project ? (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
            style={{ background:"rgba(8,14,26,0.92)", border:"1px solid #1e3050", maxWidth:240 }}>
            <div className="relative flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-emerald-400"/>
              <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60"/>
            </div>
            <div>
              <div style={{ fontSize:8, color:"#64748b", textTransform:"uppercase",
                letterSpacing:"0.08em", fontFamily:"Inter" }}>Active Project</div>
              <div style={{ fontSize:11, color:"white", fontWeight:600, fontFamily:"Inter" }}>
                {project.name.length>26 ? project.name.slice(0,26)+"…" : project.name}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 rounded-xl"
            style={{ background:"rgba(8,14,26,0.75)", border:"1px solid #1e3050" }}>
            <span style={{ fontSize:11, color:"#475569", fontFamily:"Inter" }}>
              Click "New Project" to start
            </span>
          </div>
        )}
      </div>

      <DragHint/>
    </div>
  );
}
