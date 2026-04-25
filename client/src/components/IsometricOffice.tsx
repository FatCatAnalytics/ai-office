import { useEffect, useState, useRef, useCallback } from "react";
import type { Agent, Project } from "../types";

import bgImg            from "@assets/sprite_office_floor.png";
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

// ─── World & room geometry ────────────────────────────────────────────────────
// The background PNG (1024×1024) is rendered at BG_SCALE × its natural size.
// All floor-position math is expressed in WORLD coordinates (BG_SCALE * px).
const BG_SCALE  = 3.2;          // render the PNG at 3.2× → 3276×3276 px
const BG_PX     = 1024 * BG_SCALE;  // 3276.8 → ~3277

// World canvas is larger than the PNG so there's dark space to pan into
const WORLD_W   = BG_PX * 1.6;
const WORLD_H   = BG_PX * 1.3;

// Where the PNG sits inside the world (centred horizontally, slightly down)
const BG_X      = (WORLD_W - BG_PX) / 2;
const BG_Y      = (WORLD_H - BG_PX) / 2 - 80;

// ── Floor diamond geometry (measured in original 1024px image coordinates) ──
// Top-tip: (512, 494), Bottom-tip: (512, 858)
// Left-tip at y≈620: x=172,  Right-tip at y≈620: x=868
// Wall ridge (back corner of floor): (512, 494) in image
// We convert these to WORLD coords:  worldX = BG_X + imgX * BG_SCALE

function imgToWorld(ix: number, iy: number): [number, number] {
  return [BG_X + ix * BG_SCALE, BG_Y + iy * BG_SCALE];
}

// Key floor landmarks in world coords
const FLOOR_TOP    = imgToWorld(512, 494);   // back corner (top of diamond)
const FLOOR_LEFT   = imgToWorld(172, 620);   // left corner
const FLOOR_RIGHT  = imgToWorld(868, 620);   // right corner
const FLOOR_BOTTOM = imgToWorld(512, 858);   // front corner (bottom tip)

// ─── Zoom / pan ───────────────────────────────────────────────────────────────
const ZOOM_MIN  = 0.12;
const ZOOM_MAX  = 2.5;
const ZOOM_STEP = 0.09;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function fmt(n: number) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(n);
}

// ─── Agent positions in world coords ─────────────────────────────────────────
// We place agents on the floor using barycentric blending of the diamond corners.
// u = left→right,  v = top→bottom on the floor surface.
// Safe playable zone avoids the very edges (walls, plants).
function floorPoint(u: number, v: number): [number, number] {
  // Bilinear interpolation across the floor diamond
  // Top half: interpolate between FLOOR_TOP(left) and FLOOR_TOP(right) for u,
  //           then blend with the mid-left/mid-right edge for v
  // We treat it as 4 corners: top, left, bottom, right
  // Parameterise as: point = top*(1-v) * centre + ... 
  // Simpler: use the two diagonals
  //   horizontal midline at v=0.5: from FLOOR_LEFT to FLOOR_RIGHT
  //   at v=0:  converges to FLOOR_TOP
  //   at v=1:  converges to FLOOR_BOTTOM
  const topX    = FLOOR_TOP[0],    topY    = FLOOR_TOP[1];
  const leftX   = FLOOR_LEFT[0],   leftY   = FLOOR_LEFT[1];
  const rightX  = FLOOR_RIGHT[0],  rightY  = FLOOR_RIGHT[1];
  const botX    = FLOOR_BOTTOM[0], botY    = FLOOR_BOTTOM[1];

  // Left edge at param v: lerp top→left (v:0→0.5) then left→bottom (v:0.5→1)
  let lx: number, ly: number, rx: number, ry: number;
  if (v <= 0.5) {
    const t = v * 2;
    lx = topX  + (leftX  - topX)  * t;
    ly = topY  + (leftY  - topY)  * t;
    rx = topX  + (rightX - topX)  * t;
    ry = topY  + (rightY - topY)  * t;
  } else {
    const t = (v - 0.5) * 2;
    lx = leftX  + (botX - leftX)  * t;
    ly = leftY  + (botY - leftY)  * t;
    rx = rightX + (botX - rightX) * t;
    ry = rightY + (botY - rightY) * t;
  }
  return [lx + (rx - lx) * u, ly + (ry - ly) * u];
}

// Grid of agent positions (u,v) — safe zone keeps agents off the very edges
function computePositions(count: number): [number, number][] {
  const cols = count <= 4 ? 2 : count <= 8 ? 3 : 4;
  const rows = Math.ceil(count / cols);

  // Safe zone: u 0.18..0.82, v 0.12..0.82
  const uMin = 0.18, uMax = 0.82;
  const vMin = 0.12, vMax = 0.80;

  const positions: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (positions.length >= count) break;
      const uT = cols > 1 ? c / (cols - 1) : 0.5;
      const vT = rows > 1 ? r / (rows - 1) : 0.5;
      positions.push([
        uMin + (uMax - uMin) * uT,
        vMin + (vMax - vMin) * vT,
      ]);
    }
  }
  return positions;
}

// Sprite size in world pixels — proportional to the floor size
function spriteWorldPx(count: number): number {
  const floorH = FLOOR_BOTTOM[1] - FLOOR_TOP[1]; // ~1165 world px
  // Each agent should be roughly 1/7th the floor height for 10 agents
  const base = floorH * 0.165;
  if (count <= 4)  return base * 1.15;
  if (count <= 7)  return base * 1.0;
  return base * 0.88;
}

// ─── Extended room SVG (walls + windows beyond the PNG edges) ─────────────────
// The PNG shows a corner room. We extend it by drawing matching wall planes
// to the left and right of the PNG so the space feels larger.
function ExtendedRoom() {
  // Wall colour from the PNG walls: approximately #b8bcc4 (left) and #d0d4da (right)
  // Back ridge in image: approx y=370 at x=512 (in image coords), so world y:
  const [ridgeX,  ridgeY]  = imgToWorld(512, 370);
  const [ridgeL]           = imgToWorld(39,  560);   // left wall top-edge at image left
  const [ridgeR]           = imgToWorld(981, 560);   // right wall top-edge at image right
  // Floor left tip and right tip
  const [flLx, flLy] = FLOOR_LEFT;
  const [flRx, flRy] = FLOOR_RIGHT;
  // Bottom of image content (below the floor front)
  const [, botImgY] = imgToWorld(512, 877);

  // Left wall extension: from image left edge (col 39) extending further left
  // The left wall in the PNG goes from top-left down to floor-left.
  // We project the wall plane further left by mirroring the slope.
  // Wall slope on left side: dx/dy ≈ (512-39)/(560-370) ≈ 473/190 ≈ 2.49 per y
  const wallSlope = (512 - 39) / (560 - 370);  // ~2.49
  const extWidth = BG_PX * 0.7;  // extend this many world px on each side

  // Left extension top edge
  const lExtTopX = BG_X;
  const lExtTopY = BG_Y + 370 * BG_SCALE;
  // Left extension floor edge: same slope going further left
  const lExtFloorX = flLx - extWidth;
  const lExtFloorY = flLy + extWidth / wallSlope * 0.4;

  // Right extension
  const rExtTopX = BG_X + BG_PX;
  const rExtTopY = BG_Y + 370 * BG_SCALE;
  const rExtFloorX = flRx + extWidth;
  const rExtFloorY = flRy + extWidth / wallSlope * 0.4;

  // Wall top: we go up to a ceiling line
  const ceilY = BG_Y + 144 * BG_SCALE;  // top of image content

  return (
    <svg
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      width={WORLD_W} height={WORLD_H}
      overflow="visible"
    >
      <defs>
        {/* Left wall gradient — cool grey, lit from above */}
        <linearGradient id="lwg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#c8ccd4"/>
          <stop offset="60%"  stopColor="#b0b4bc"/>
          <stop offset="100%" stopColor="#989ca4"/>
        </linearGradient>
        {/* Right wall gradient — slightly warmer */}
        <linearGradient id="rwg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#d4d8de"/>
          <stop offset="60%"  stopColor="#c0c4ca"/>
          <stop offset="100%" stopColor="#a8acb4"/>
        </linearGradient>
        {/* Floor extension gradient — warm wood */}
        <linearGradient id="floorExt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#c87030"/>
          <stop offset="100%" stopColor="#a05020"/>
        </linearGradient>
        {/* Window sky gradient */}
        <linearGradient id="nightSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#06101e"/>
          <stop offset="50%"  stopColor="#0d1f36"/>
          <stop offset="100%" stopColor="#162840"/>
        </linearGradient>
        {/* Ceiling gradient */}
        <linearGradient id="ceilGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#2a2e38"/>
          <stop offset="100%" stopColor="#1a1e28"/>
        </linearGradient>
        {/* Baseboard highlight */}
        <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#e8e4dc"/>
          <stop offset="100%" stopColor="#c8c4bc"/>
        </linearGradient>
        {/* Light cone gradient */}
        <radialGradient id="lightCone" cx="50%" cy="0%" r="100%">
          <stop offset="0%"   stopColor="rgba(255,240,200,0.18)"/>
          <stop offset="100%" stopColor="rgba(255,240,200,0)"/>
        </radialGradient>
        {/* Spotlight on floor */}
        <radialGradient id="spotFloor" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(255,240,180,0.22)"/>
          <stop offset="100%" stopColor="rgba(255,240,180,0)"/>
        </radialGradient>
        <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="12" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="windowGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* ── LEFT WALL EXTENSION ─────────────────────────────────────────────── */}
      {/* Main wall plane */}
      <polygon
        points={[
          `${lExtTopX},${ceilY}`,
          `${BG_X},${ceilY}`,
          `${flLx},${flLy}`,
          `${lExtFloorX},${lExtFloorY}`,
        ].join(" ")}
        fill="url(#lwg)"
      />
      {/* Baseboard on left extension */}
      <polygon
        points={[
          `${flLx},${flLy}`,
          `${lExtFloorX},${lExtFloorY}`,
          `${lExtFloorX},${lExtFloorY + 22 * BG_SCALE * 0.3}`,
          `${flLx},${flLy + 22 * BG_SCALE * 0.3}`,
        ].join(" ")}
        fill="url(#baseGrad)"
        opacity="0.85"
      />

      {/* Windows on left extension */}
      {[0.28, 0.68].map((uf, wi) => {
        // Window position along the left wall
        const wx = lExtTopX + (BG_X - lExtTopX) * uf;
        const wFloorX = lExtFloorX + (flLx - lExtFloorX) * uf;
        const wFloorY = lExtFloorY + (flLy - lExtFloorY) * uf;
        const wCeilY  = ceilY;
        // Interpolate x along the wall surface
        const wallH = wFloorY - wCeilY;
        const frameT = 0.15, frameB = 0.72;
        const fTop  = wCeilY + wallH * frameT;
        const fBot  = wCeilY + wallH * frameB;
        const fW    = (BG_X - lExtTopX) * 0.18;
        // Window as a parallelogram (isometric perspective)
        const skewX = (wFloorX - wx) / (wFloorY - wCeilY);
        const p = (y: number) => wx + skewX * (y - wCeilY);
        const pts = [
          `${p(fTop) - fW/2},${fTop}`,
          `${p(fTop) + fW/2},${fTop}`,
          `${p(fBot) + fW/2},${fBot}`,
          `${p(fBot) - fW/2},${fBot}`,
        ].join(" ");
        return (
          <g key={wi} filter="url(#windowGlow)">
            {/* Sky */}
            <polygon points={pts} fill="url(#nightSky)"/>
            {/* City skyline */}
            <CityView
              p={[p(fTop)-fW/2, fTop, p(fBot)-fW/2, fBot]}
              fW={fW} seed={wi * 7}
            />
            {/* Frame */}
            <polygon points={pts} fill="none"
              stroke="#dde4ec" strokeWidth={3 * BG_SCALE * 0.15}/>
            {/* Sill */}
            <line
              x1={p(fBot)-fW/2} y1={fBot}
              x2={p(fBot)+fW/2} y2={fBot}
              stroke="#e8e4dc" strokeWidth={5 * BG_SCALE * 0.15}
            />
          </g>
        );
      })}

      {/* ── RIGHT WALL EXTENSION ────────────────────────────────────────────── */}
      <polygon
        points={[
          `${BG_X + BG_PX},${ceilY}`,
          `${rExtTopX + extWidth},${ceilY}`,
          `${rExtFloorX},${rExtFloorY}`,
          `${flRx},${flRy}`,
        ].join(" ")}
        fill="url(#rwg)"
      />
      {/* Baseboard */}
      <polygon
        points={[
          `${flRx},${flRy}`,
          `${rExtFloorX},${rExtFloorY}`,
          `${rExtFloorX},${rExtFloorY + 22 * BG_SCALE * 0.3}`,
          `${flRx},${flRy + 22 * BG_SCALE * 0.3}`,
        ].join(" ")}
        fill="url(#baseGrad)"
        opacity="0.80"
      />

      {/* Windows on right extension */}
      {[0.25, 0.55, 0.82].map((uf, wi) => {
        const wallStartX = BG_X + BG_PX;
        const wallEndX   = rExtTopX + extWidth;
        const wx = wallStartX + (wallEndX - wallStartX) * uf;
        const wFloorX = flRx + (rExtFloorX - flRx) * uf;
        const wFloorY = flRy + (rExtFloorY - flRy) * uf;
        const wallH   = wFloorY - ceilY;
        const frameT  = 0.14, frameB = 0.70;
        const fTop    = ceilY + wallH * frameT;
        const fBot    = ceilY + wallH * frameB;
        const fW      = (wallEndX - wallStartX) * 0.20;
        const skewX   = (wFloorX - wx) / (wFloorY - ceilY);
        const p = (y: number) => wx + skewX * (y - ceilY);
        const pts = [
          `${p(fTop) - fW/2},${fTop}`,
          `${p(fTop) + fW/2},${fTop}`,
          `${p(fBot) + fW/2},${fBot}`,
          `${p(fBot) - fW/2},${fBot}`,
        ].join(" ");
        return (
          <g key={wi} filter="url(#windowGlow)">
            <polygon points={pts} fill="url(#nightSky)"/>
            <CityView
              p={[p(fTop)-fW/2, fTop, p(fBot)-fW/2, fBot]}
              fW={fW} seed={wi * 13 + 5}
            />
            <polygon points={pts} fill="none"
              stroke="#dde4ec" strokeWidth={3 * BG_SCALE * 0.15}/>
            <line x1={p(fBot)-fW/2} y1={fBot} x2={p(fBot)+fW/2} y2={fBot}
              stroke="#e8e4dc" strokeWidth={5 * BG_SCALE * 0.15}/>
          </g>
        );
      })}

      {/* ── CEILING EXTENSION (fill gap above PNG on sides) ─────────────────── */}
      {/* Left ceiling */}
      <polygon
        points={[
          `0,0`,
          `${BG_X},0`,
          `${BG_X},${ceilY}`,
          `0,${ceilY + 200}`,
        ].join(" ")}
        fill="url(#ceilGrad)"
      />
      {/* Right ceiling */}
      <polygon
        points={[
          `${BG_X + BG_PX},0`,
          `${WORLD_W},0`,
          `${WORLD_W},${ceilY + 200}`,
          `${BG_X + BG_PX},${ceilY}`,
        ].join(" ")}
        fill="url(#ceilGrad)"
      />

      {/* ── CEILING LIGHTS (over extended area) ─────────────────────────────── */}
      {/* Extension ceiling lights */}
      {[
        [lExtTopX + extWidth * 0.3, ceilY + 20],
        [lExtTopX + extWidth * 0.7, ceilY + 20],
        [rExtTopX + extWidth * 0.35, ceilY + 20],
        [rExtTopX + extWidth * 0.70, ceilY + 20],
      ].map(([lx, ly], i) => (
        <g key={i} filter="url(#softGlow)">
          <rect x={lx - 18 * BG_SCALE * 0.3} y={ly - 5 * BG_SCALE * 0.3}
            width={36 * BG_SCALE * 0.3} height={10 * BG_SCALE * 0.3}
            rx={4} fill="#d8dce4" opacity="0.9"/>
          <ellipse cx={lx} cy={ly + 300}
            rx={140 * BG_SCALE * 0.3} ry={60 * BG_SCALE * 0.3}
            fill="url(#spotFloor)" opacity="0.7"/>
        </g>
      ))}

      {/* ── THE ROOM BACKGROUND PNG (placed on top of extensions) ─────────── */}
      {/* rendered as a foreignObject so React handles the img import */}
    </svg>
  );
}

// City skyline drawn inside a window quad
function CityView({ p, fW, seed }: { p: [number, number, number, number]; fW: number; seed: number }) {
  const [x0, y0, x1, y1] = p;  // top-left corner and bottom-left corner of window
  const wH = y1 - y0;

  // Deterministic pseudo-random from seed
  const rng = (n: number) => Math.abs(Math.sin(seed * 9301 + n * 49297) % 1);

  const buildings = Array.from({ length: 8 }, (_, i) => ({
    u:    0.04 + i * 0.12 + rng(i) * 0.04,
    h:    0.45 + rng(i + 10) * 0.45,
    w:    0.08 + rng(i + 20) * 0.05,
    hue:  220 + rng(i + 30) * 30,
    lit:  rng(i + 40) > 0.4,
    lit2: rng(i + 50) > 0.6,
    lit3: rng(i + 60) > 0.55,
  }));

  const stars = Array.from({ length: 12 }, (_, i) => ({
    u: rng(i + 100),
    v: rng(i + 110) * 0.55,
    r: rng(i + 120) > 0.7 ? 2 : 1.2,
  }));

  // Interpolate a point along the left edge of the window parallelogram
  const lerp = (v: number): [number, number] => [x0 + (x1 - x0) * v, y0 + (y1 - y0) * v];

  return (
    <g>
      {/* Stars */}
      {stars.map((s, i) => {
        const [lx, ly] = lerp(s.v);
        const sx = lx + s.u * fW;
        return <circle key={i} cx={sx} cy={ly} r={s.r} fill="white" opacity={0.5 + rng(i)*0.4}/>;
      })}
      {/* Moon */}
      {(() => {
        const [mx, my] = lerp(0.08);
        return (
          <g>
            <circle cx={mx + fW * 0.78} cy={my + wH * 0.12} r={fW * 0.045}
              fill="#f0e8c8" opacity="0.85"/>
            <circle cx={mx + fW * 0.80} cy={my + wH * 0.10} r={fW * 0.035}
              fill="#0d1f36" opacity="0.9"/>
          </g>
        );
      })()}
      {/* Buildings */}
      {buildings.map((b, i) => {
        const [bLx, bLy] = lerp(1.0);
        const bx = x0 + b.u * fW;
        const bTop = y1 - wH * b.h;
        const bW = b.w * fW;
        const bH = y1 - bTop;
        return (
          <g key={i}>
            <rect x={bx} y={bTop} width={bW} height={bH}
              fill={`hsl(${b.hue},18%,${11 + (i%4)*2}%)`}/>
            {/* Lit windows on building */}
            {b.lit  && <rect x={bx+bW*0.15} y={bTop+bH*0.18} width={bW*0.25} height={bH*0.06} rx={1} fill="#f59e0b" opacity="0.9"/>}
            {b.lit2 && <rect x={bx+bW*0.55} y={bTop+bH*0.30} width={bW*0.25} height={bH*0.06} rx={1} fill="#f59e0b" opacity="0.7"/>}
            {b.lit3 && <rect x={bx+bW*0.15} y={bTop+bH*0.50} width={bW*0.25} height={bH*0.06} rx={1} fill="#93c5fd" opacity="0.6"/>}
          </g>
        );
      })}
    </g>
  );
}

// ─── Progress ring ─────────────────────────────────────────────────────────────
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
    <div className="absolute top-3 right-3 flex flex-col gap-2 pointer-events-none" style={{ width:162, zIndex:50 }}>
      <div className="rounded-xl p-3" style={{ background:"rgba(6,10,20,0.94)", border:"1px solid #1e3050" }}>
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
      <div className="rounded-xl p-3" style={{ background:"rgba(6,10,20,0.94)", border:"1px solid #1e3050" }}>
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
          style={{ background:"rgba(6,10,20,0.94)", border:"1px solid #1e3050" }}>
          <span style={{ fontSize:8, color:"#64748b", fontFamily:"Inter", textTransform:"uppercase", letterSpacing:"0.08em" }}>{m.label}</span>
          <span style={{ fontSize:13, color:m.color, fontFamily:"JetBrains Mono,monospace", fontWeight:700 }}>{m.value}</span>
        </div>
      ))}
      <div className="rounded-xl p-3" style={{ background:"rgba(6,10,20,0.94)", border:"1px solid #1e3050" }}>
        <div style={{ fontSize:8, color:"#64748b", letterSpacing:"0.08em", fontFamily:"Inter",
          textTransform:"uppercase", marginBottom:8 }}>Progress Trend</div>
        <Sparkline data={sparkData} color="#6366f1" w={134} h={32}/>
      </div>
    </div>
  );
}

// ─── Mini-map ──────────────────────────────────────────────────────────────────
function MiniMap({ pan, zoom, vpW, vpH, agents, uvPositions }: {
  pan:[number,number]; zoom:number; vpW:number; vpH:number;
  agents:Agent[]; uvPositions:[number,number][];
}) {
  const W = 130, H = 100;
  const scaleX = W / WORLD_W, scaleY = H / WORLD_H;
  const vpLeft  = (-pan[0] / zoom) * scaleX;
  const vpTop   = (-pan[1] / zoom) * scaleY;
  const vpRectW = (vpW / zoom) * scaleX;
  const vpRectH = (vpH / zoom) * scaleY;

  // Floor outline in minimap
  const floorPts = [FLOOR_TOP, FLOOR_RIGHT, FLOOR_BOTTOM, FLOOR_LEFT]
    .map(([x,y]) => `${x*scaleX},${y*scaleY}`).join(" ");

  return (
    <div className="absolute bottom-3 right-3 rounded-xl overflow-hidden pointer-events-none"
      style={{ width:W, height:H, zIndex:50, border:"1px solid #1e3050",
        background:"rgba(6,10,20,0.93)", boxShadow:"0 4px 20px rgba(0,0,0,0.6)" }}>
      <svg width={W} height={H} style={{ position:"absolute", inset:0 }}>
        <polygon points={floorPts} fill="#b8682a" opacity="0.35" stroke="#c87030" strokeWidth="1"/>
        {agents.map((a, i) => {
          const uv = uvPositions[i];
          if (!uv) return null;
          const [wx, wy] = floorPoint(uv[0], uv[1]);
          const active = a.status !== "idle";
          return (
            <g key={a.id}>
              {active && <circle cx={wx*scaleX} cy={wy*scaleY} r={5} fill={a.color} opacity={0.22}/>}
              <circle cx={wx*scaleX} cy={wy*scaleY} r={3} fill={active ? a.color : "#334155"} stroke={a.color} strokeWidth="1"/>
            </g>
          );
        })}
        <rect
          x={clamp(vpLeft,0,W-2)} y={clamp(vpTop,0,H-2)}
          width={clamp(vpRectW,2,W-clamp(vpLeft,0,W))}
          height={clamp(vpRectH,2,H-clamp(vpTop,0,H))}
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
  agent:Agent; wx:number; wy:number; spriteSize:number; zoom:number;
}) {
  const status    = agent.status;
  const isActive  = status === "working" || status === "thinking";
  const isDone    = status === "done";
  const isIdle    = status === "idle";
  const isBlocked = status === "blocked";
  const task      = agent.currentTask;
  const color     = agent.color;
  const sw        = spriteSize;

  const labelSize = Math.round(clamp(12 / zoom, 9, 16));
  const spriteImg = SPRITE_MAP[agent.spriteType] ?? SPRITE_MAP["manager"];

  const filterStyle = isIdle
    ? "grayscale(40%) brightness(0.72)"
    : isBlocked
    ? "grayscale(20%) brightness(0.75) sepia(0.4) hue-rotate(310deg)"
    : isDone
    ? `drop-shadow(0 0 ${16/zoom}px ${color}) brightness(1.1)`
    : isActive
    ? `drop-shadow(0 0 ${10/zoom}px ${color}99)`
    : "none";

  return (
    <div
      data-testid={`sprite-${agent.id}`}
      style={{
        position:"absolute",
        left: wx - sw / 2,
        top:  wy - sw,
        width: sw,
        zIndex: Math.round(wy + 1000),
        transition:"filter 0.4s ease",
        filter: filterStyle,
      }}
    >
      {/* Floor shadow */}
      <div style={{
        position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:sw*0.55, height:sw*0.07,
        background:"radial-gradient(ellipse, rgba(0,0,0,0.6) 0%, transparent 70%)",
        borderRadius:"50%",
      }}/>
      {/* Active glow ring */}
      {isActive && (
        <div style={{
          position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
          width:sw*0.68, height:sw*0.11,
          background:`radial-gradient(ellipse, ${color}60 0%, transparent 70%)`,
          borderRadius:"50%",
          animation:"glowPulse 2s ease-in-out infinite",
        }}/>
      )}
      {/* Blocked indicator */}
      {isBlocked && (
        <div style={{
          position:"absolute", top:-(clamp(20/zoom,14,26)), right:0,
          fontSize:clamp(14/zoom,10,18), pointerEvents:"none",
          animation:"celebBounce 0.8s ease infinite alternate",
        }}>⛔</div>
      )}
      {/* Speech bubble */}
      {task && (isActive || isDone || isBlocked) && (
        <div style={{ position:"absolute", bottom:sw+6, left:"50%", transform:"translateX(-50%)", whiteSpace:"nowrap", pointerEvents:"none" }}>
          <div style={{
            background:"rgba(4,8,20,0.96)", border:`1.5px solid ${isBlocked?"#ef4444":color}`,
            color:isBlocked?"#ef4444":color,
            padding:`${clamp(4/zoom,3,7)}px ${clamp(10/zoom,7,15)}px`,
            borderRadius:clamp(20/zoom,10,24),
            fontSize:clamp(10/zoom,8,13),
            fontFamily:"JetBrains Mono,monospace", fontWeight:600,
            boxShadow:`0 2px 14px ${color}44`, lineHeight:1.3,
          }}>
            {isBlocked?"⚠ Blocked":(task.length>28?task.slice(0,28)+"…":task)}
          </div>
          <div style={{ display:"flex", justifyContent:"center", marginTop:-1 }}>
            <div style={{ width:0, height:0,
              borderLeft:`${clamp(4/zoom,3,6)}px solid transparent`,
              borderRight:`${clamp(4/zoom,3,6)}px solid transparent`,
              borderTop:`${clamp(5/zoom,4,7)}px solid ${isBlocked?"#ef4444":color}`,
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
        bottom:-(labelSize * 2.8),
        left:"50%", transform:"translateX(-50%)",
        whiteSpace:"nowrap",
        display:"flex", alignItems:"center",
        gap:clamp(4/zoom,3,6),
        padding:`${clamp(4/zoom,3,7)}px ${clamp(10/zoom,8,15)}px`,
        background:"rgba(4,8,20,0.95)",
        border:`1.5px solid ${isBlocked?"#ef4444":isActive?color:color+"99"}`,
        borderRadius:clamp(20/zoom,10,24),
        boxShadow:"0 2px 12px rgba(0,0,0,0.85)",
        pointerEvents:"none",
      }}>
        <div style={{
          width:clamp(7/zoom,5,9), height:clamp(7/zoom,5,9),
          borderRadius:"50%", flexShrink:0,
          background:isIdle?"#475569":isDone?"#10b981":isBlocked?"#ef4444":color,
          boxShadow:isActive?`0 0 ${clamp(5/zoom,4,8)}px ${color}`:"none",
          transition:"all 0.3s",
        }}/>
        <span style={{
          fontSize:labelSize, color:"#ffffff",
          fontFamily:"Inter,sans-serif", fontWeight:700, lineHeight:1,
          textShadow:"0 1px 4px rgba(0,0,0,1)",
        }}>
          {agent.name}
        </span>
      </div>
      {/* Done */}
      {isDone && (
        <div style={{
          position:"absolute", right:0, top:-(clamp(26/zoom,18,32)),
          fontSize:clamp(16/zoom,10,20), pointerEvents:"none",
          animation:"celebBounce 0.6s ease infinite alternate",
        }}>🎉</div>
      )}
    </div>
  );
}

// ─── Delegation arcs ───────────────────────────────────────────────────────────
function DelegationArcs({ agents, uvPositions, spriteSize }: {
  agents:Agent[]; uvPositions:[number,number][]; spriteSize:number;
}) {
  const mUV = uvPositions[0];
  if (!mUV) return null;
  const [mx, my] = floorPoint(mUV[0], mUV[1]);
  const mcy = my - spriteSize / 2;
  const activeAgents = agents.slice(1).filter(a => a.status==="working"||a.status==="thinking");
  return (
    <svg style={{ position:"absolute", top:0, left:0, width:WORLD_W, height:WORLD_H,
      pointerEvents:"none", zIndex:5 }} overflow="visible">
      {activeAgents.map(a => {
        const aIdx = agents.indexOf(a);
        const aUV  = uvPositions[aIdx];
        if (!aUV) return null;
        const [ax, ay] = floorPoint(aUV[0], aUV[1]);
        const acy = ay - spriteSize / 2;
        const dx = ax - mx, dy = acy - mcy;
        const cx = mx + dx*0.5, cy = mcy + dy*0.5 - 120;
        return (
          <g key={a.id}>
            <path d={`M ${mx} ${mcy} Q ${cx} ${cy} ${ax} ${acy}`}
              fill="none" stroke={a.color} strokeWidth="2.5" strokeDasharray="12 8"
              opacity="0.55"
              style={{ animation:"dashFlow 1.5s linear infinite" }}/>
            <circle cx={ax} cy={acy} r={8} fill={a.color} opacity={0.25}
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
        { label:"+", action:onIn,    tip:"Zoom in"    },
        { label:"⌂", action:onReset, tip:"Reset view" },
        { label:"−", action:onOut,   tip:"Zoom out"   },
      ].map(b => (
        <button key={b.label} onClick={b.action} title={b.tip} style={{
          width:32, height:32, borderRadius:8,
          background:"rgba(6,10,20,0.93)", border:"1px solid #1e3050",
          color:"#94a3b8", fontSize:16, fontWeight:700, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
        }}
          onMouseEnter={e => (e.currentTarget.style.borderColor="#6366f1")}
          onMouseLeave={e => (e.currentTarget.style.borderColor="#1e3050")}
        >{b.label}</button>
      ))}
      <div style={{ textAlign:"center", marginTop:1, fontSize:9, color:"#475569", fontFamily:"JetBrains Mono,monospace" }}>
        {Math.round(zoom*100)}%
      </div>
    </div>
  );
}

function DragHint() {
  const [show, setShow] = useState(true);
  useEffect(() => { const t = setTimeout(()=>setShow(false), 5000); return ()=>clearTimeout(t); }, []);
  if (!show) return null;
  return (
    <div className="absolute pointer-events-none" style={{
      bottom:50, left:"50%", transform:"translateX(-50%)",
      zIndex:60, background:"rgba(6,10,20,0.90)", border:"1px solid #1e3050",
      borderRadius:12, padding:"8px 18px",
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
  const containerRef  = useRef<HTMLDivElement>(null);
  const [vpDims, setVpDims]       = useState({ w:1200, h:700 });
  const [pan, setPan]             = useState<[number,number]>([0,0]);
  const [zoom, setZoom]           = useState(0.35);
  const [sparkData, setSparkData] = useState<number[]>([0,0,0,0,0]);
  const initialFitDone            = useRef(false);

  const dragRef    = useRef<{sx:number;sy:number;sp:[number,number]}|null>(null);
  const isDragging = useRef(false);

  const uvPositions = computePositions(agents.length);
  const SPRITE_SIZE = spriteWorldPx(agents.length);

  const clampPan = useCallback((px:number, py:number, z:number): [number,number] => {
    const pad = 200;
    return [
      clamp(px, -(WORLD_W*z - pad), vpDims.w - pad),
      clamp(py, -(WORLD_H*z - pad), vpDims.h - pad),
    ];
  }, [vpDims]);

  // Centre the floor in the viewport
  const floorCentredPan = useCallback((z: number): [number,number] => {
    const [fcx, fcy] = floorPoint(0.5, 0.5);
    return [vpDims.w/2 - fcx*z, vpDims.h/2 - fcy*z];
  }, [vpDims]);

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0]; if (!e) return;
      const w = e.contentRect.width, h = e.contentRect.height;
      setVpDims({ w, h });
      if (!initialFitDone.current) {
        initialFitDone.current = true;
        // Zoom so the floor diamond fills ~85% of the viewport width
        const floorWidth = FLOOR_RIGHT[0] - FLOOR_LEFT[0];
        const fz = clamp((w * 0.85) / floorWidth, ZOOM_MIN, ZOOM_MAX);
        setZoom(fz);
        const [fcx, fcy] = floorPoint(0.5, 0.45);
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
    dragRef.current = { sx:e.clientX, sy:e.clientY, sp:pan };
    e.preventDefault();
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx, dy = e.clientY - dragRef.current.sy;
    if (Math.abs(dx)>3||Math.abs(dy)>3) isDragging.current = true;
    if (!isDragging.current) return;
    setPan(clampPan(dragRef.current.sp[0]+dx, dragRef.current.sp[1]+dy, zoom));
  }, [zoom, clampPan]);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  const touchRef = useRef<{sx:number;sy:number;sp:[number,number];d0?:number;z0?:number}|null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length===1) touchRef.current={sx:e.touches[0].clientX,sy:e.touches[0].clientY,sp:pan};
    else if (e.touches.length===2) {
      const d=Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY);
      touchRef.current={sx:0,sy:0,sp:pan,d0:d,z0:zoom};
    }
  }, [pan,zoom]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touchRef.current) return;
    if (e.touches.length===1&&!touchRef.current.d0) {
      setPan(clampPan(touchRef.current.sp[0]+(e.touches[0].clientX-touchRef.current.sx),
        touchRef.current.sp[1]+(e.touches[0].clientY-touchRef.current.sy),zoom));
    } else if (e.touches.length===2&&touchRef.current.d0) {
      const d=Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY);
      setZoom(clamp((touchRef.current.z0??zoom)*(d/touchRef.current.d0),ZOOM_MIN,ZOOM_MAX));
    }
  }, [zoom,clampPan]);

  const onTouchEnd = useCallback(() => { touchRef.current = null; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY>0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(z => {
      const nz = clamp(z+delta, ZOOM_MIN, ZOOM_MAX);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mx=e.clientX-rect.left, my=e.clientY-rect.top;
        setPan(([px,py]) => {
          const wx=(mx-px)/z, wy=(my-py)/z;
          return clampPan(mx-wx*nz, my-wy*nz, nz);
        });
      }
      return nz;
    });
  }, [clampPan]);

  const handleReset = useCallback(() => {
    const floorWidth = FLOOR_RIGHT[0] - FLOOR_LEFT[0];
    const fz = clamp((vpDims.w*0.85)/floorWidth, ZOOM_MIN, ZOOM_MAX);
    setZoom(fz);
    const [fcx, fcy] = floorPoint(0.5, 0.45);
    setPan([vpDims.w/2 - fcx*fz, vpDims.h/2 - fcy*fz]);
  }, [vpDims]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ background:"#060c16", cursor:"grab", userSelect:"none" }}
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
          to { stroke-dashoffset: -40; }
        }
      `}</style>

      {/* ═══ Pannable world ══════════════════════════════════════════════════ */}
      <div style={{
        position:"absolute", left:pan[0], top:pan[1],
        width:WORLD_W, height:WORLD_H,
        transformOrigin:"0 0", transform:`scale(${zoom})`, willChange:"transform",
      }}>

        {/* ── SVG extended walls + windows (behind the PNG) ── */}
        <ExtendedRoom />

        {/* ── Original room PNG — the beautiful background ── */}
        <img
          src={bgImg}
          alt="office"
          draggable={false}
          style={{
            position:"absolute",
            left: BG_X,
            top:  BG_Y,
            width:  BG_PX,
            height: BG_PX,
            userSelect:"none",
            filter:"brightness(0.96) contrast(1.02) saturate(1.05)",
          }}
        />

        {/* ── Delegation arcs ── */}
        <DelegationArcs agents={agents} uvPositions={uvPositions} spriteSize={SPRITE_SIZE}/>

        {/* ── Agent sprites (on top of PNG) ── */}
        {agents.map((agent, i) => {
          const uv = uvPositions[i];
          if (!uv) return null;
          const [wx, wy] = floorPoint(uv[0], uv[1]);
          return (
            <AgentSprite
              key={agent.id}
              agent={agent}
              wx={wx} wy={wy}
              spriteSize={SPRITE_SIZE}
              zoom={zoom}
            />
          );
        })}
      </div>

      {/* ═══ Fixed HUD overlays ══════════════════════════════════════════════ */}
      <StatsHUD project={project} agents={agents} sparkData={sparkData}/>
      <MiniMap pan={pan} zoom={zoom} vpW={vpDims.w} vpH={vpDims.h}
        agents={agents} uvPositions={uvPositions}/>
      <ZoomControls
        onIn={() => {
          const nz = clamp(zoom+ZOOM_STEP*2, ZOOM_MIN, ZOOM_MAX);
          setPan(([px,py]) => {
            const cx=vpDims.w/2, cy=vpDims.h/2;
            return clampPan(cx-(cx-px)/zoom*nz, cy-(cy-py)/zoom*nz, nz);
          });
          setZoom(nz);
        }}
        onOut={() => {
          const nz = clamp(zoom-ZOOM_STEP*2, ZOOM_MIN, ZOOM_MAX);
          setPan(([px,py]) => {
            const cx=vpDims.w/2, cy=vpDims.h/2;
            return clampPan(cx-(cx-px)/zoom*nz, cy-(cy-py)/zoom*nz, nz);
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
            style={{ background:"rgba(6,10,20,0.93)", border:"1px solid #1e3050", maxWidth:240 }}>
            <div className="relative flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-emerald-400"/>
              <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60"/>
            </div>
            <div>
              <div style={{ fontSize:8, color:"#64748b", textTransform:"uppercase",
                letterSpacing:"0.08em", fontFamily:"Inter" }}>Active Project</div>
              <div style={{ fontSize:11, color:"white", fontWeight:600, fontFamily:"Inter" }}>
                {project.name.length>26?project.name.slice(0,26)+"…":project.name}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 rounded-xl"
            style={{ background:"rgba(6,10,20,0.78)", border:"1px solid #1e3050" }}>
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
