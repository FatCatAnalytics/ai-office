import { useEffect, useState, useRef, useCallback } from "react";
import type { AgentState, Project } from "../types";

import bgImg       from "@assets/sprite_office_floor.png";
import managerImg  from "@assets/sprite_manager.png";
import frontendImg from "@assets/sprite_frontend.png";
import backendImg  from "@assets/sprite_backend.png";
import qaImg       from "@assets/sprite_qa.png";
import uiuxImg     from "@assets/sprite_uiux.png";
import devopsImg   from "@assets/sprite_devops.png";

interface Props {
  agents: AgentState[];
  project: Project | null;
}

// ─── Agent config ──────────────────────────────────────────────────────────────
const AGENT_IDS    = ["manager","frontend","backend","qa","uiux","devops"];
const AGENT_IMGS   = [managerImg, frontendImg, backendImg, qaImg, uiuxImg, devopsImg];
const AGENT_COLORS = ["#6366f1","#22c55e","#3b82f6","#f59e0b","#ec4899","#14b8a6"];
const AGENT_NAMES  = ["Manager","Frontend Dev","Backend Dev","QA Engineer","UI/UX Designer","DevOps Eng."];

// ─── World / room dimensions ───────────────────────────────────────────────────
// The background image is 1024×1024 and contains a single isometric room.
// We render it at ROOM_SIZE × ROOM_SIZE in world pixels.
// The floor diamond in image-fraction coords:
//   back  = (0.50, 0.42)   left  = (0.04, 0.63)
//   right = (0.96, 0.63)   front = (0.50, 0.855)
const ROOM_SIZE = 1800; // px in world space (big enough to pan around)

// Convert image-fraction (0..1) → world pixel coordinate
function imgToWorld(fx: number, fy: number): [number, number] {
  return [fx * ROOM_SIZE, fy * ROOM_SIZE];
}

// ─── Agent positions (image-fraction coords, bottom-centre of each sprite) ────
// Spread across the room in a loose 2×3 grid on the floor diamond.
// Floor spans roughly x: 0.12..0.88, y: 0.46..0.84 (visible floor area)
// Layout (back→front, left→right in isometric space):
//
//        [manager]
//   [frontend]   [backend]
//   [qa]              [uiux]
//        [devops]
//
const AGENT_POSITIONS: [number, number][] = [
  [0.50, 0.520],   // 0 manager   — back centre
  [0.27, 0.595],   // 1 frontend  — mid-back left
  [0.73, 0.595],   // 2 backend   — mid-back right
  [0.30, 0.690],   // 3 qa        — mid-front left
  [0.70, 0.690],   // 4 uiux      — mid-front right
  [0.50, 0.770],   // 5 devops    — front centre
];

// Sprite size as fraction of room size
const SPRITE_FRAC = 0.115; // ~207px at ROOM_SIZE=1800

// ─── Pan/Zoom constants ────────────────────────────────────────────────────────
const ZOOM_MIN   = 0.28;
const ZOOM_MAX   = 2.0;
const ZOOM_STEP  = 0.09;
const ZOOM_INIT  = 0.52;   // show roughly the full room on load

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function fmt(n: number) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(n);
}

// ─── Progress Ring ─────────────────────────────────────────────────────────────
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
function StatsHUD({ project, agents, sparkData }: {
  project: Project|null; agents: AgentState[]; sparkData: number[];
}) {
  const active = agents.filter(a => a.status !== "idle").length;
  return (
    <div className="absolute top-3 right-3 flex flex-col gap-2 pointer-events-none"
      style={{ width:158, zIndex:50 }}>

      <div className="rounded-xl p-3" style={{ background:"rgba(8,14,26,0.93)", border:"1px solid #1e3050" }}>
        <div style={{ fontSize:8, color:"#64748b", letterSpacing:"0.08em", fontFamily:"Inter",
          textTransform:"uppercase", marginBottom:8 }}>Project Progress</div>
        <div className="flex items-center gap-3">
          <ProgressRing pct={project?.progress??0} color="#6366f1" size={52}/>
          <div>
            <div style={{ fontSize:10, color:"#94a3b8", fontFamily:"monospace" }}>
              {project?.tasksCompleted??0}/{project?.tasksTotal??7} tasks
            </div>
            <div style={{ fontSize:9, marginTop:3, fontFamily:"monospace",
              color: project?.status==="completed" ? "#10b981" : project ? "#f59e0b" : "#475569" }}>
              {project?.status==="completed" ? "✓ Done" : project ? "● Running" : "○ Idle"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl p-3" style={{ background:"rgba(8,14,26,0.93)", border:"1px solid #1e3050" }}>
        <div style={{ fontSize:8, color:"#64748b", letterSpacing:"0.08em", fontFamily:"Inter",
          textTransform:"uppercase", marginBottom:8 }}>
          Agents · {active}/{agents.length} active
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {agents.map(a => {
            const i = AGENT_IDS.indexOf(a.id);
            const c = AGENT_COLORS[i] || "#64748b";
            return (
              <div key={a.id} title={a.name} style={{
                width:11, height:11, borderRadius:"50%",
                background: a.status==="idle" ? "#1e3050" : c,
                border:`1.5px solid ${c}`,
                boxShadow: a.status!=="idle" ? `0 0 5px ${c}` : "none",
                transition:"all 0.3s",
              }}/>
            );
          })}
        </div>
      </div>

      {[
        { label:"Tokens",       value:fmt(project?.tokensUsed??0),                   color:"#f59e0b" },
        { label:"Cost Today",   value:`$${(project?.costToday??0).toFixed(2)}`,       color:"#10b981" },
        { label:"Avg Response", value:`${(project?.avgResponseTime??0).toFixed(1)}s`, color:"#06b6d4" },
      ].map(m => (
        <div key={m.label} className="rounded-xl px-3 py-2 flex items-center justify-between"
          style={{ background:"rgba(8,14,26,0.93)", border:"1px solid #1e3050" }}>
          <span style={{ fontSize:8, color:"#64748b", fontFamily:"Inter",
            textTransform:"uppercase", letterSpacing:"0.08em" }}>{m.label}</span>
          <span style={{ fontSize:13, color:m.color,
            fontFamily:"JetBrains Mono,monospace", fontWeight:700 }}>{m.value}</span>
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
function MiniMap({ pan, zoom, vpW, vpH, agents }: {
  pan:[number,number]; zoom:number; vpW:number; vpH:number; agents:AgentState[];
}) {
  const W = 120, H = 120;
  const scale = W / ROOM_SIZE;

  const vpLeft  = (-pan[0] / zoom) * scale;
  const vpTop   = (-pan[1] / zoom) * scale;
  const vpRectW = (vpW / zoom) * scale;
  const vpRectH = (vpH / zoom) * scale;

  return (
    <div className="absolute bottom-3 right-3 rounded-xl overflow-hidden pointer-events-none"
      style={{ width:W, height:H, zIndex:50,
        border:"1px solid #1e3050", background:"rgba(8,14,26,0.92)",
        boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }}>

      {/* Room background thumbnail */}
      <img src={bgImg} alt="" style={{ position:"absolute", inset:0,
        width:"100%", height:"100%", opacity:0.35, objectFit:"cover" }} draggable={false}/>

      <svg width={W} height={H} style={{ position:"absolute", inset:0 }}>
        {/* Agent dots */}
        {AGENT_IDS.map((id, i) => {
          const [fx, fy] = AGENT_POSITIONS[i];
          const mx = fx * W, my = fy * H;
          const a = agents.find(ag => ag.id === id);
          const active = a && a.status !== "idle";
          const c = AGENT_COLORS[i];
          return (
            <g key={id}>
              {active && <circle cx={mx} cy={my} r={6} fill={c} opacity={0.18}/>}
              <circle cx={mx} cy={my} r={3.5} fill={active ? c : "#334155"}
                stroke={c} strokeWidth="1"/>
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
        fontSize:7, color:"#475569", fontFamily:"Inter",
        letterSpacing:"0.06em", textTransform:"uppercase" }}>
        map
      </div>
    </div>
  );
}

// ─── Single agent (rendered in world space) ────────────────────────────────────
function AgentSprite({ idx, agent, zoom }: {
  idx: number; agent: AgentState|undefined; zoom: number;
}) {
  const [fx, fy] = AGENT_POSITIONS[idx];
  const [wx, wy] = imgToWorld(fx, fy);
  const sw = ROOM_SIZE * SPRITE_FRAC;

  const color    = AGENT_COLORS[idx];
  const status   = agent?.status ?? "idle";
  const isActive = status === "working" || status === "thinking";
  const isDone   = status === "done";
  const isIdle   = status === "idle";
  const task     = agent?.currentTask;

  // Label font: keep readable regardless of zoom
  const labelSize = Math.round(clamp(9 / zoom, 7, 12));

  return (
    <div
      data-testid={`sprite-${AGENT_IDS[idx]}`}
      style={{
        position: "absolute",
        left: wx - sw / 2,
        top:  wy - sw,       // bottom-centre anchor
        width: sw,
        zIndex: 10 + idx,    // back-to-front ordering
        transition: "filter 0.4s ease",
        filter: isIdle
          ? "grayscale(55%) brightness(0.6)"
          : isDone
          ? `drop-shadow(0 0 ${14/zoom}px ${color}) brightness(1.08)`
          : isActive
          ? `drop-shadow(0 0 ${9/zoom}px ${color}88)`
          : "none",
      }}
    >
      {/* Floor shadow */}
      <div style={{
        position:"absolute", bottom:0, left:"50%",
        transform:"translateX(-50%)",
        width: sw * 0.55, height: sw * 0.07,
        background:"radial-gradient(ellipse, rgba(0,0,0,0.6) 0%, transparent 70%)",
        borderRadius:"50%",
      }}/>

      {/* Active glow */}
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

      {/* Speech bubble */}
      {task && (isActive || isDone) && (
        <div style={{
          position:"absolute",
          bottom: sw + 4,
          left:"50%", transform:"translateX(-50%)",
          whiteSpace:"nowrap", pointerEvents:"none",
        }}>
          <div style={{
            background:"rgba(8,14,26,0.95)", border:`1.5px solid ${color}`,
            color, padding:`${clamp(4/zoom,3,6)}px ${clamp(10/zoom,6,14)}px`,
            borderRadius: clamp(20/zoom, 10, 24),
            fontSize: clamp(10/zoom, 7, 12),
            fontFamily:"JetBrains Mono,monospace", fontWeight:600,
            boxShadow:`0 2px 14px ${color}44`, lineHeight:1.3,
          }}>
            {task.length > 28 ? task.slice(0,28)+"…" : task}
          </div>
          <div style={{ display:"flex", justifyContent:"center", marginTop:-1 }}>
            <div style={{ width:0, height:0,
              borderLeft:`${clamp(4/zoom,3,6)}px solid transparent`,
              borderRight:`${clamp(4/zoom,3,6)}px solid transparent`,
              borderTop:`${clamp(5/zoom,4,7)}px solid ${color}`,
            }}/>
          </div>
        </div>
      )}

      {/* Sprite image */}
      <img src={AGENT_IMGS[idx]} alt={AGENT_NAMES[idx]}
        style={{ width:"100%", display:"block", userSelect:"none" }} draggable={false}/>

      {/* Name label */}
      <div style={{
        position:"absolute",
        bottom: -(labelSize * 2.4),
        left:"50%", transform:"translateX(-50%)",
        whiteSpace:"nowrap",
        display:"flex", alignItems:"center",
        gap: clamp(4/zoom, 3, 6),
        padding:`${clamp(3/zoom,2,5)}px ${clamp(8/zoom,5,12)}px`,
        background:"rgba(8,14,26,0.90)",
        border:`1px solid ${color}55`,
        borderRadius: clamp(20/zoom, 10, 24),
        pointerEvents:"none",
      }}>
        <div style={{
          width: clamp(5/zoom, 4, 7), height: clamp(5/zoom, 4, 7),
          borderRadius:"50%", flexShrink:0,
          background: isIdle ? "#334155" : isDone ? "#10b981" : color,
          boxShadow: isActive ? `0 0 ${clamp(4/zoom,3,6)}px ${color}` : "none",
          transition:"all 0.3s",
        }}/>
        <span style={{
          fontSize: labelSize,
          color: isIdle ? "#64748b" : "#e2e8f0",
          fontFamily:"Inter,sans-serif", fontWeight:600, lineHeight:1,
        }}>
          {AGENT_NAMES[idx]}
        </span>
      </div>

      {/* Celebration */}
      {isDone && (
        <div style={{
          position:"absolute", right:0, top: -(clamp(26/zoom, 18, 32)),
          fontSize: clamp(16/zoom, 10, 20),
          pointerEvents:"none",
          animation:"celebBounce 0.6s ease infinite alternate",
        }}>
          🎉
        </div>
      )}
    </div>
  );
}

// ─── Zoom controls ─────────────────────────────────────────────────────────────
function ZoomControls({ onIn, onOut, onReset, zoom }: {
  onIn:()=>void; onOut:()=>void; onReset:()=>void; zoom:number;
}) {
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
          transition:"border-color 0.15s",
        }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "#6366f1")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "#1e3050")}
        >{b.label}</button>
      ))}
      <div style={{ textAlign:"center", marginTop:1,
        fontSize:9, color:"#475569", fontFamily:"JetBrains Mono,monospace" }}>
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}

// ─── Drag hint ─────────────────────────────────────────────────────────────────
function DragHint() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 4000);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div className="absolute pointer-events-none" style={{
      bottom: 50, left:"50%", transform:"translateX(-50%)",
      zIndex:60, background:"rgba(8,14,26,0.85)", border:"1px solid #1e3050",
      borderRadius:12, padding:"8px 16px",
      fontSize:11, color:"#64748b", fontFamily:"Inter",
      display:"flex", alignItems:"center", gap:8,
      animation:"fadeOut 0.5s ease 3.5s forwards",
    }}>
      <span style={{ fontSize:16 }}>✋</span>
      Drag to pan · Scroll to zoom
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function IsometricOffice({ agents, project }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vpDims, setVpDims]     = useState({ w:900, h:600 });
  const [pan,    setPan ]        = useState<[number,number]>([0,0]);
  const [zoom,   setZoom]        = useState(ZOOM_INIT);
  const [sparkData, setSparkData] = useState<number[]>([0,0,0,0,0]);

  const dragRef   = useRef<{ sx:number; sy:number; sp:[number,number] }|null>(null);
  const isDragging = useRef(false);

  // ── Resize observer ──
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0]; if (!e) return;
      const w = e.contentRect.width, h = e.contentRect.height;
      setVpDims({ w, h });
      // Centre the room on first render
      setPan(p => (p[0] === 0 && p[1] === 0)
        ? [(w - ROOM_SIZE * ZOOM_INIT) / 2, (h - ROOM_SIZE * ZOOM_INIT) / 2]
        : p
      );
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Spark data ──
  useEffect(() => {
    if (project?.progress !== undefined)
      setSparkData(d => [...d.slice(-9), project.progress]);
  }, [project?.progress]);

  const clampPan = useCallback((px:number, py:number, z:number): [number,number] => {
    const ww = ROOM_SIZE * z, wh = ROOM_SIZE * z;
    const pad = 150;
    return [
      clamp(px, -(ww - pad), vpDims.w - pad),
      clamp(py, -(wh - pad), vpDims.h - pad),
    ];
  }, [vpDims]);

  // ── Mouse drag ──
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, sp: pan };
    e.preventDefault();
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging.current = true;
    if (!isDragging.current) return;
    const [spx, spy] = dragRef.current.sp;
    setPan(clampPan(spx + dx, spy + dy, zoom));
  }, [zoom, clampPan]);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // ── Touch ──
  const touchRef = useRef<{ sx:number; sy:number; sp:[number,number]; d0?:number; z0?:number }|null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchRef.current = { sx:e.touches[0].clientX, sy:e.touches[0].clientY, sp:pan };
    } else if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[1].clientX-e.touches[0].clientX, e.touches[1].clientY-e.touches[0].clientY);
      touchRef.current = { sx:0, sy:0, sp:pan, d0:d, z0:zoom };
    }
  }, [pan, zoom]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touchRef.current) return;
    if (e.touches.length === 1 && !touchRef.current.d0) {
      const dx = e.touches[0].clientX - touchRef.current.sx;
      const dy = e.touches[0].clientY - touchRef.current.sy;
      setPan(clampPan(touchRef.current.sp[0]+dx, touchRef.current.sp[1]+dy, zoom));
    } else if (e.touches.length === 2 && touchRef.current.d0) {
      const d = Math.hypot(e.touches[1].clientX-e.touches[0].clientX, e.touches[1].clientY-e.touches[0].clientY);
      const newZ = clamp((touchRef.current.z0??zoom) * (d/touchRef.current.d0), ZOOM_MIN, ZOOM_MAX);
      setZoom(newZ);
    }
  }, [zoom, clampPan]);

  const onTouchEnd = useCallback(() => { touchRef.current = null; }, []);

  // ── Scroll-to-zoom (toward cursor) ──
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

  const centredPan = useCallback((z: number): [number,number] => [
    (vpDims.w - ROOM_SIZE * z) / 2,
    (vpDims.h - ROOM_SIZE * z) / 2,
  ], [vpDims]);

  const get = (id: string) => agents.find(a => a.id === id);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{
        background:"linear-gradient(160deg,#070d18 0%,#0a1420 100%)",
        cursor: dragRef.current ? "grabbing" : "grab",
        userSelect:"none",
      }}
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
      `}</style>

      {/* ═══ Pannable world ═══════════════════════════════════════════════════ */}
      <div style={{
        position:"absolute",
        left: pan[0], top: pan[1],
        width: ROOM_SIZE, height: ROOM_SIZE,
        transformOrigin:"0 0",
        transform:`scale(${zoom})`,
        willChange:"transform",
      }}>
        {/* Single large room background */}
        <img
          src={bgImg}
          alt="office"
          draggable={false}
          style={{
            position:"absolute", inset:0,
            width: ROOM_SIZE, height: ROOM_SIZE,
            userSelect:"none",
            filter:"brightness(0.91) contrast(1.04)",
          }}
        />

        {/* Edge vignette to soften transparent borders */}
        <div style={{
          position:"absolute", inset:0, pointerEvents:"none",
          background:"radial-gradient(ellipse 82% 75% at 50% 52%, transparent 50%, rgba(5,9,18,0.5) 100%)",
        }}/>

        {/* Agent sprites */}
        {AGENT_IDS.map((_, i) => (
          <AgentSprite key={AGENT_IDS[i]} idx={i} agent={get(AGENT_IDS[i])} zoom={zoom}/>
        ))}
      </div>

      {/* ═══ Fixed HUD overlays ═══════════════════════════════════════════════ */}
      <StatsHUD project={project} agents={agents} sparkData={sparkData}/>

      <MiniMap pan={pan} zoom={zoom} vpW={vpDims.w} vpH={vpDims.h} agents={agents}/>

      <ZoomControls
        onIn  ={() => {
          const nz = clamp(zoom + ZOOM_STEP*2, ZOOM_MIN, ZOOM_MAX);
          const c = centredPan(nz);
          // Zoom toward centre
          setPan(([px,py]) => {
            const cx = vpDims.w/2, cy = vpDims.h/2;
            const wx = (cx-px)/zoom, wy = (cy-py)/zoom;
            return clampPan(cx-wx*nz, cy-wy*nz, nz);
          });
          setZoom(nz);
        }}
        onOut ={() => {
          const nz = clamp(zoom - ZOOM_STEP*2, ZOOM_MIN, ZOOM_MAX);
          setPan(([px,py]) => {
            const cx = vpDims.w/2, cy = vpDims.h/2;
            const wx = (cx-px)/zoom, wy = (cy-py)/zoom;
            return clampPan(cx-wx*nz, cy-wy*nz, nz);
          });
          setZoom(nz);
        }}
        onReset={() => {
          setZoom(ZOOM_INIT);
          setPan(centredPan(ZOOM_INIT));
        }}
        zoom={zoom}
      />

      {/* Active project banner */}
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
              Click "New Project" to start a simulation
            </span>
          </div>
        )}
      </div>

      <DragHint/>
    </div>
  );
}
