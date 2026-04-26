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
// The PNG (1024×1024) is rendered at a FIXED large size in world space.
// We do NOT tile — just one PNG, centred in the world.
const BG_SCALE = 2400 / 1024;   // ~2.34375
const BG_PX    = 2400;           // rendered size in world px

const WORLD_W  = 5000;
const WORLD_H  = 4000;
const BG_X     = (WORLD_W - BG_PX) / 2;         // 1300
const BG_Y     = (WORLD_H - BG_PX) / 2 - 100;   // 700

// ── Floor diamond in world coords ──
// Pixel coords from image analysis, scaled up by BG_SCALE and offset by BG_X/BG_Y
const FLOOR_TOP:    [number, number] = [BG_X + 512 * BG_SCALE, BG_Y + 494 * BG_SCALE];
const FLOOR_LEFT:   [number, number] = [BG_X + 172 * BG_SCALE, BG_Y + 620 * BG_SCALE];
const FLOOR_RIGHT:  [number, number] = [BG_X + 868 * BG_SCALE, BG_Y + 620 * BG_SCALE];
const FLOOR_BOTTOM: [number, number] = [BG_X + 512 * BG_SCALE, BG_Y + 858 * BG_SCALE];

// ─── Zoom / pan ───────────────────────────────────────────────────────────────
const ZOOM_MIN  = 0.10;
const ZOOM_MAX  = 3.0;
const ZOOM_STEP = 0.09;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function fmt(n: number) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
}

// ─── Bilinear floor interpolation ────────────────────────────────────────────
// u=0..1 left-to-right, v=0..1 top-to-front on the floor diamond.
// We treat the diamond as two triangles (top half and bottom half).
function floorPoint(u: number, v: number): [number, number] {
  const topX   = FLOOR_TOP[0],    topY   = FLOOR_TOP[1];
  const leftX  = FLOOR_LEFT[0],   leftY  = FLOOR_LEFT[1];
  const rightX = FLOOR_RIGHT[0],  rightY = FLOOR_RIGHT[1];
  const botX   = FLOOR_BOTTOM[0], botY   = FLOOR_BOTTOM[1];

  // Left edge at param v: top→left for v:0→0.5, left→bottom for v:0.5→1
  // Right edge at param v: top→right for v:0→0.5, right→bottom for v:0.5→1
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

// ─── Agent grid positions ─────────────────────────────────────────────────────
// Safe zone u: 0.18..0.82, v: 0.15..0.78 — keeps all agents on the floor
function computePositions(count: number): [number, number][] {
  const cols = count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);

  const uMin = 0.18, uMax = 0.82;
  const vMin = 0.15, vMax = 0.78;

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

// Fixed sprite size: 200px in world space — looks good at any agent count
const SPRITE_SIZE = 200;

// ─── Progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ pct, color, size }: { pct: number; color: string; size: number }) {
  const r = (size - 8) / 2, circ = 2 * Math.PI * r, dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e3050" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.6s ease" }} />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fill="white"
        fontSize="13" fontFamily="JetBrains Mono,monospace" fontWeight="bold">{pct}%</text>
    </svg>
  );
}

function Sparkline({ data, color, w, h }: { data: number[]; color: string; w: number; h: number }) {
  if (data.length < 2) return <div style={{ width: w, height: h, background: "#0c1624", borderRadius: 4 }} />;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = 4 + (i / (data.length - 1)) * (w - 8);
    const y = h - 4 - ((v - min) / range) * (h - 8);
    return `${x},${y}`;
  }).join(" ");
  const lastPt = pts.split(" ").pop()!.split(",");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <rect x={0} y={0} width={w} height={h} rx={4} fill="#0c1624" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" opacity="0.9" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r={3} fill={color} />
    </svg>
  );
}

// ─── Stats HUD (top-right overlay) ─────────────────────────────────────────────
function StatsHUD({ project, agents, sparkData }: { project: Project | null; agents: Agent[]; sparkData: number[] }) {
  const active = agents.filter(a => a.status !== "idle").length;
  return (
    <div className="absolute top-3 right-3 flex flex-col gap-2 pointer-events-none" style={{ width: 162, zIndex: 50 }}>
      <div className="rounded-xl p-3" style={{ background: "rgba(6,10,20,0.94)", border: "1px solid #1e3050" }}>
        <div style={{ fontSize: 8, color: "#64748b", letterSpacing: "0.08em", fontFamily: "Inter",
          textTransform: "uppercase", marginBottom: 8 }}>Project Progress</div>
        <div className="flex items-center gap-3">
          <ProgressRing pct={project?.progress ?? 0} color="#6366f1" size={52} />
          <div>
            <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>
              {project?.tasksCompleted ?? 0}/{project?.tasksTotal ?? 0} tasks
            </div>
            <div style={{ fontSize: 9, marginTop: 3, fontFamily: "monospace",
              color: project?.status === "completed" ? "#10b981" : project ? "#f59e0b" : "#475569" }}>
              {project?.status === "completed" ? "✓ Done" : project?.status === "planning" ? "● Planning" : project ? "● Running" : "○ Idle"}
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-xl p-3" style={{ background: "rgba(6,10,20,0.94)", border: "1px solid #1e3050" }}>
        <div style={{ fontSize: 8, color: "#64748b", letterSpacing: "0.08em", fontFamily: "Inter",
          textTransform: "uppercase", marginBottom: 8 }}>Agents · {active}/{agents.length} active</div>
        <div className="flex gap-1.5 flex-wrap">
          {agents.map(a => (
            <div key={a.id} title={`${a.name} — ${a.status}`} style={{
              width: 11, height: 11, borderRadius: "50%",
              background: a.status === "idle" ? "#1e3050" : a.color,
              border: `1.5px solid ${a.color}`,
              boxShadow: a.status !== "idle" ? `0 0 5px ${a.color}` : "none",
              transition: "all 0.3s",
            }} />
          ))}
        </div>
      </div>
      {[
        { label: "Tokens",       value: fmt(project?.tokensUsed ?? 0),                   color: "#f59e0b" },
        { label: "Cost Today",   value: `$${(project?.costToday ?? 0).toFixed(2)}`,       color: "#10b981" },
        { label: "Avg Response", value: `${(project?.avgResponseTime ?? 0).toFixed(1)}s`, color: "#06b6d4" },
      ].map(m => (
        <div key={m.label} className="rounded-xl px-3 py-2 flex items-center justify-between"
          style={{ background: "rgba(6,10,20,0.94)", border: "1px solid #1e3050" }}>
          <span style={{ fontSize: 8, color: "#64748b", fontFamily: "Inter", textTransform: "uppercase", letterSpacing: "0.08em" }}>{m.label}</span>
          <span style={{ fontSize: 13, color: m.color, fontFamily: "JetBrains Mono,monospace", fontWeight: 700 }}>{m.value}</span>
        </div>
      ))}
      <div className="rounded-xl p-3" style={{ background: "rgba(6,10,20,0.94)", border: "1px solid #1e3050" }}>
        <div style={{ fontSize: 8, color: "#64748b", letterSpacing: "0.08em", fontFamily: "Inter",
          textTransform: "uppercase", marginBottom: 8 }}>Progress Trend</div>
        <Sparkline data={sparkData} color="#6366f1" w={134} h={32} />
      </div>
    </div>
  );
}

// ─── Mini-map (bottom-right overlay) ───────────────────────────────────────────
function MiniMap({ pan, zoom, vpW, vpH, agents, uvPositions }: {
  pan: [number, number]; zoom: number; vpW: number; vpH: number;
  agents: Agent[]; uvPositions: [number, number][];
}) {
  const W = 130, H = 100;
  const scaleX = W / WORLD_W, scaleY = H / WORLD_H;
  const vpLeft  = (-pan[0] / zoom) * scaleX;
  const vpTop   = (-pan[1] / zoom) * scaleY;
  const vpRectW = (vpW / zoom) * scaleX;
  const vpRectH = (vpH / zoom) * scaleY;

  // Floor diamond outline in minimap coords
  const floorPts = [FLOOR_TOP, FLOOR_RIGHT, FLOOR_BOTTOM, FLOOR_LEFT]
    .map(([x, y]) => `${x * scaleX},${y * scaleY}`).join(" ");

  return (
    <div className="absolute bottom-3 right-3 rounded-xl overflow-hidden pointer-events-none"
      style={{ width: W, height: H, zIndex: 50, border: "1px solid #1e3050",
        background: "rgba(6,10,20,0.93)", boxShadow: "0 4px 20px rgba(0,0,0,0.6)" }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <polygon points={floorPts} fill="#b8682a" opacity="0.35" stroke="#c87030" strokeWidth="1" />
        {agents.map((a, i) => {
          const uv = uvPositions[i];
          if (!uv) return null;
          const [wx, wy] = floorPoint(uv[0], uv[1]);
          const active = a.status !== "idle";
          return (
            <g key={a.id}>
              {active && <circle cx={wx * scaleX} cy={wy * scaleY} r={5} fill={a.color} opacity={0.22} />}
              <circle cx={wx * scaleX} cy={wy * scaleY} r={3}
                fill={active ? a.color : "#334155"} stroke={a.color} strokeWidth="1" />
            </g>
          );
        })}
        <rect
          x={clamp(vpLeft, 0, W - 2)} y={clamp(vpTop, 0, H - 2)}
          width={clamp(vpRectW, 2, W - clamp(vpLeft, 0, W))}
          height={clamp(vpRectH, 2, H - clamp(vpTop, 0, H))}
          fill="rgba(99,102,241,0.10)" stroke="#6366f1" strokeWidth="1.5" rx="2" />
      </svg>
      <div style={{ position: "absolute", bottom: 3, left: 5,
        fontSize: 7, color: "#475569", fontFamily: "Inter", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        map
      </div>
    </div>
  );
}

// ─── Single agent sprite ───────────────────────────────────────────────────────
function AgentSprite({ agent, wx, wy, spriteSize, zoom }: {
  agent: Agent; wx: number; wy: number; spriteSize: number; zoom: number;
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
    ? `drop-shadow(0 0 ${16 / zoom}px ${color}) brightness(1.1)`
    : isActive
    ? `drop-shadow(0 0 ${10 / zoom}px ${color}99)`
    : "none";

  return (
    <div
      data-testid={`sprite-${agent.id}`}
      style={{
        position: "absolute",
        left: wx - sw / 2,
        top:  wy - sw,
        width: sw,
        zIndex: Math.round(wy + 1000),
        transition: "filter 0.4s ease",
        filter: filterStyle,
      }}
    >
      {/* Floor shadow */}
      <div style={{
        position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: sw * 0.55, height: sw * 0.07,
        background: "radial-gradient(ellipse, rgba(0,0,0,0.6) 0%, transparent 70%)",
        borderRadius: "50%",
      }} />
      {/* Active glow ring */}
      {isActive && (
        <div style={{
          position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: sw * 0.68, height: sw * 0.11,
          background: `radial-gradient(ellipse, ${color}60 0%, transparent 70%)`,
          borderRadius: "50%",
          animation: "glowPulse 2s ease-in-out infinite",
        }} />
      )}
      {/* Blocked indicator */}
      {isBlocked && (
        <div style={{
          position: "absolute", top: -(clamp(20 / zoom, 14, 26)), right: 0,
          fontSize: clamp(14 / zoom, 10, 18), pointerEvents: "none",
          animation: "celebBounce 0.8s ease infinite alternate",
        }}>⛔</div>
      )}
      {/* Speech bubble */}
      {task && (isActive || isDone || isBlocked) && (
        <div style={{ position: "absolute", bottom: sw + 6, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", pointerEvents: "none" }}>
          <div style={{
            background: "rgba(4,8,20,0.96)", border: `1.5px solid ${isBlocked ? "#ef4444" : color}`,
            color: isBlocked ? "#ef4444" : color,
            padding: `${clamp(4 / zoom, 3, 7)}px ${clamp(10 / zoom, 7, 15)}px`,
            borderRadius: clamp(20 / zoom, 10, 24),
            fontSize: clamp(10 / zoom, 8, 13),
            fontFamily: "JetBrains Mono,monospace", fontWeight: 600,
            boxShadow: `0 2px 14px ${color}44`, lineHeight: 1.3,
          }}>
            {isBlocked ? "⚠ Blocked" : (task.length > 28 ? task.slice(0, 28) + "…" : task)}
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: -1 }}>
            <div style={{ width: 0, height: 0,
              borderLeft: `${clamp(4 / zoom, 3, 6)}px solid transparent`,
              borderRight: `${clamp(4 / zoom, 3, 6)}px solid transparent`,
              borderTop: `${clamp(5 / zoom, 4, 7)}px solid ${isBlocked ? "#ef4444" : color}`,
            }} />
          </div>
        </div>
      )}
      {/* Sprite image */}
      <img src={spriteImg} alt={agent.name}
        style={{ width: "100%", display: "block", userSelect: "none" }} draggable={false} />
      {/* Name label */}
      <div style={{
        position: "absolute",
        bottom: -(labelSize * 2.8),
        left: "50%", transform: "translateX(-50%)",
        whiteSpace: "nowrap",
        display: "flex", alignItems: "center",
        gap: clamp(4 / zoom, 3, 6),
        padding: `${clamp(4 / zoom, 3, 7)}px ${clamp(10 / zoom, 8, 15)}px`,
        background: "rgba(4,8,20,0.95)",
        border: `1.5px solid ${isBlocked ? "#ef4444" : isActive ? color : color + "99"}`,
        borderRadius: clamp(20 / zoom, 10, 24),
        boxShadow: "0 2px 12px rgba(0,0,0,0.85)",
        pointerEvents: "none",
      }}>
        <div style={{
          width: clamp(7 / zoom, 5, 9), height: clamp(7 / zoom, 5, 9),
          borderRadius: "50%", flexShrink: 0,
          background: isIdle ? "#475569" : isDone ? "#10b981" : isBlocked ? "#ef4444" : color,
          boxShadow: isActive ? `0 0 ${clamp(5 / zoom, 4, 8)}px ${color}` : "none",
          transition: "all 0.3s",
        }} />
        <span style={{
          fontSize: labelSize, color: "#ffffff",
          fontFamily: "Inter,sans-serif", fontWeight: 700, lineHeight: 1,
          textShadow: "0 1px 4px rgba(0,0,0,1)",
        }}>
          {agent.name}
        </span>
      </div>
      {/* Done emoji */}
      {isDone && (
        <div style={{
          position: "absolute", right: 0, top: -(clamp(26 / zoom, 18, 32)),
          fontSize: clamp(16 / zoom, 10, 20), pointerEvents: "none",
          animation: "celebBounce 0.6s ease infinite alternate",
        }}>🎉</div>
      )}
    </div>
  );
}

// ─── Delegation arcs ───────────────────────────────────────────────────────────
function DelegationArcs({ agents, uvPositions, spriteSize }: {
  agents: Agent[]; uvPositions: [number, number][]; spriteSize: number;
}) {
  const mUV = uvPositions[0];
  if (!mUV) return null;
  const [mx, my] = floorPoint(mUV[0], mUV[1]);
  const mcy = my - spriteSize / 2;
  const activeAgents = agents.slice(1).filter(a => a.status === "working" || a.status === "thinking");
  return (
    <svg style={{ position: "absolute", top: 0, left: 0, width: WORLD_W, height: WORLD_H,
      pointerEvents: "none", zIndex: 5 }} overflow="visible">
      {activeAgents.map(a => {
        const aIdx = agents.indexOf(a);
        const aUV  = uvPositions[aIdx];
        if (!aUV) return null;
        const [ax, ay] = floorPoint(aUV[0], aUV[1]);
        const acy = ay - spriteSize / 2;
        const dx = ax - mx, dy = acy - mcy;
        const cx = mx + dx * 0.5, cy = mcy + dy * 0.5 - 120;
        return (
          <g key={a.id}>
            <path d={`M ${mx} ${mcy} Q ${cx} ${cy} ${ax} ${acy}`}
              fill="none" stroke={a.color} strokeWidth="2.5" strokeDasharray="12 8"
              opacity="0.55"
              style={{ animation: "dashFlow 1.5s linear infinite" }} />
            <circle cx={ax} cy={acy} r={8} fill={a.color} opacity={0.25}
              style={{ animation: "glowPulse 2s ease-in-out infinite" }} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Zoom controls (bottom-left overlay) ──────────────────────────────────────
function ZoomControls({ onIn, onOut, onReset, zoom }: { onIn: () => void; onOut: () => void; onReset: () => void; zoom: number }) {
  return (
    <div className="absolute bottom-3 left-3 flex flex-col gap-1" style={{ zIndex: 50 }}>
      {[
        { label: "+", action: onIn,    tip: "Zoom in"    },
        { label: "⌂", action: onReset, tip: "Reset view" },
        { label: "−", action: onOut,   tip: "Zoom out"   },
      ].map(b => (
        <button key={b.label} onClick={b.action} title={b.tip} style={{
          width: 32, height: 32, borderRadius: 8,
          background: "rgba(6,10,20,0.93)", border: "1px solid #1e3050",
          color: "#94a3b8", fontSize: 16, fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "#6366f1")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "#1e3050")}
        >{b.label}</button>
      ))}
      <div style={{ textAlign: "center", marginTop: 1, fontSize: 9, color: "#475569", fontFamily: "JetBrains Mono,monospace" }}>
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
      bottom: 50, left: "50%", transform: "translateX(-50%)",
      zIndex: 60, background: "rgba(6,10,20,0.90)", border: "1px solid #1e3050",
      borderRadius: 12, padding: "8px 18px",
      fontSize: 11, color: "#94a3b8", fontFamily: "Inter",
      display: "flex", alignItems: "center", gap: 8,
      animation: "fadeOut 0.5s ease 4.5s forwards",
    }}>
      <span style={{ fontSize: 16 }}>✋</span>
      Drag to pan · Scroll or pinch to zoom
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function IsometricOffice({ agents, project }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const [vpDims, setVpDims]       = useState({ w: 1200, h: 700 });
  const [pan, setPan]             = useState<[number, number]>([0, 0]);
  const [zoom, setZoom]           = useState(0.30);
  const [sparkData, setSparkData] = useState<number[]>([0, 0, 0, 0, 0]);
  const initialFitDone            = useRef(false);

  const dragRef    = useRef<{ sx: number; sy: number; sp: [number, number] } | null>(null);
  const isDragging = useRef(false);

  const uvPositions = computePositions(agents.length);

  const clampPan = useCallback((px: number, py: number, z: number): [number, number] => {
    const pad = 200;
    return [
      clamp(px, -(WORLD_W * z - pad), vpDims.w - pad),
      clamp(py, -(WORLD_H * z - pad), vpDims.h - pad),
    ];
  }, [vpDims]);

  const getInitialFit = useCallback((w: number, h: number): { zoom: number; pan: [number, number] } => {
    // Zoom so the floor diamond width fills ~88% of viewport width
    const floorWidth = FLOOR_RIGHT[0] - FLOOR_LEFT[0];
    const fz = clamp((w * 0.88) / floorWidth, ZOOM_MIN, ZOOM_MAX);
    // Centre on the floor's midpoint
    const [fcx, fcy] = floorPoint(0.5, 0.45);
    return {
      zoom: fz,
      pan:  [w / 2 - fcx * fz, h / 2 - fcy * fz],
    };
  }, []);

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0]; if (!e) return;
      const w = e.contentRect.width, h = e.contentRect.height;
      setVpDims({ w, h });
      if (!initialFitDone.current) {
        initialFitDone.current = true;
        const { zoom: fz, pan: fp } = getInitialFit(w, h);
        setZoom(fz);
        setPan(fp);
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [getInitialFit]);

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

  const touchRef = useRef<{ sx: number; sy: number; sp: [number, number]; d0?: number; z0?: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) touchRef.current = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, sp: pan };
    else if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      touchRef.current = { sx: 0, sy: 0, sp: pan, d0: d, z0: zoom };
    }
  }, [pan, zoom]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touchRef.current) return;
    if (e.touches.length === 1 && !touchRef.current.d0) {
      setPan(clampPan(touchRef.current.sp[0] + (e.touches[0].clientX - touchRef.current.sx),
        touchRef.current.sp[1] + (e.touches[0].clientY - touchRef.current.sy), zoom));
    } else if (e.touches.length === 2 && touchRef.current.d0) {
      const d = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      setZoom(clamp((touchRef.current.z0 ?? zoom) * (d / touchRef.current.d0), ZOOM_MIN, ZOOM_MAX));
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
          return clampPan(mx - wx * nz, my - wy * nz, nz);
        });
      }
      return nz;
    });
  }, [clampPan]);

  const handleReset = useCallback(() => {
    const { zoom: fz, pan: fp } = getInitialFit(vpDims.w, vpDims.h);
    setZoom(fz);
    setPan(fp);
  }, [vpDims, getInitialFit]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ background: "#060c16", cursor: "grab", userSelect: "none" }}
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
        position: "absolute", left: pan[0], top: pan[1],
        width: WORLD_W, height: WORLD_H,
        transformOrigin: "0 0", transform: `scale(${zoom})`, willChange: "transform",
      }}>

        {/* ── SINGLE background PNG — fixed size, no tiling ── */}
        <img
          src={bgImg}
          alt="office"
          draggable={false}
          style={{
            position: "absolute",
            left: BG_X,
            top:  BG_Y,
            width:  BG_PX,
            height: BG_PX,
            userSelect: "none",
            imageRendering: "auto",
          }}
        />

        {/* ── Delegation arcs ── */}
        <DelegationArcs agents={agents} uvPositions={uvPositions} spriteSize={SPRITE_SIZE} />

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
      <StatsHUD project={project} agents={agents} sparkData={sparkData} />
      <MiniMap pan={pan} zoom={zoom} vpW={vpDims.w} vpH={vpDims.h}
        agents={agents} uvPositions={uvPositions} />
      <ZoomControls
        onIn={() => {
          const nz = clamp(zoom + ZOOM_STEP * 2, ZOOM_MIN, ZOOM_MAX);
          setPan(([px, py]) => {
            const cx = vpDims.w / 2, cy = vpDims.h / 2;
            return clampPan(cx - (cx - px) / zoom * nz, cy - (cy - py) / zoom * nz, nz);
          });
          setZoom(nz);
        }}
        onOut={() => {
          const nz = clamp(zoom - ZOOM_STEP * 2, ZOOM_MIN, ZOOM_MAX);
          setPan(([px, py]) => {
            const cx = vpDims.w / 2, cy = vpDims.h / 2;
            return clampPan(cx - (cx - px) / zoom * nz, cy - (cy - py) / zoom * nz, nz);
          });
          setZoom(nz);
        }}
        onReset={handleReset}
        zoom={zoom}
      />

      {/* Project banner (bottom-left) */}
      <div className="absolute pointer-events-none" style={{ bottom: 42, left: 3, zIndex: 50 }}>
        {project ? (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
            style={{ background: "rgba(6,10,20,0.93)", border: "1px solid #1e3050", maxWidth: 240 }}>
            <div className="relative flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase",
                letterSpacing: "0.08em", fontFamily: "Inter" }}>Active Project</div>
              <div style={{ fontSize: 11, color: "white", fontWeight: 600, fontFamily: "Inter" }}>
                {project.name.length > 26 ? project.name.slice(0, 26) + "…" : project.name}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 rounded-xl"
            style={{ background: "rgba(6,10,20,0.78)", border: "1px solid #1e3050" }}>
            <span style={{ fontSize: 11, color: "#475569", fontFamily: "Inter" }}>
              Click "New Project" to start
            </span>
          </div>
        )}
      </div>

      <DragHint />
    </div>
  );
}
