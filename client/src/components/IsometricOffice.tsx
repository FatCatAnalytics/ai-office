import { useEffect, useState, useRef } from "react";
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

const AGENT_IDS    = ["manager","frontend","backend","qa","uiux","devops"];
const AGENT_IMGS   = [managerImg, frontendImg, backendImg, qaImg, uiuxImg, devopsImg];
const AGENT_COLORS = ["#6366f1","#22c55e","#3b82f6","#f59e0b","#ec4899","#14b8a6"];
const AGENT_NAMES  = ["Manager","Frontend Dev","Backend Dev","QA Engineer","UI/UX Designer","DevOps Eng."];

// ─── Layout ───────────────────────────────────────────────────────────────────
// The floor image (4:3 ratio) has its isometric diamond floor area spanning:
//   horizontally: ~15% → ~85%  (centre = 50%)
//   vertically:   ~42% → ~95%  (floor centre depth = ~68%)
//
// Isometric rows go back-left to front-right diagonally.
// Arrangement (1 / 2 / 2 / 1 pyramid):
//   Row 0 (top/back):    Manager                  → centre
//   Row 1 (mid-back):    Frontend (left), Backend (right)
//   Row 2 (mid-front):   QA (left),       UI/UX (right)
//   Row 3 (front):       DevOps                   → centre
//
// Positions as [left%, top%] — measured as % of the CONTAINER (not the image)
// These are the anchor point (bottom-centre of the sprite).
// Sprite width = SPRITE_W % of container width.
// Each row is offset: isometric left goes down-left, right goes down-right.

const SPRITE_W_PCT = 28; // sprite width as % of container width

// [left%, top%] — bottom-centre anchor of each sprite
const POSITIONS: [number, number][] = [
  [50.0, 44.0],  // 0 manager   — top centre
  [29.0, 55.0],  // 1 frontend  — mid-back left
  [71.0, 55.0],  // 2 backend   — mid-back right
  [35.5, 69.0],  // 3 qa        — mid-front left
  [64.5, 69.0],  // 4 uiux      — mid-front right
  [50.0, 80.0],  // 5 devops    — front centre
];

function fmt(n: number) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(n);
}

// ─── Speech Bubble ────────────────────────────────────────────────────────────
function SpeechBubble({ text, color }: { text: string; color: string }) {
  const disp = text.length > 26 ? text.slice(0,26)+"…" : text;
  return (
    <div className="absolute left-1/2 pointer-events-none"
      style={{ bottom: "calc(100% + 4px)", transform: "translateX(-50%)", zIndex: 20, whiteSpace: "nowrap" }}>
      <div className="px-2.5 py-1 rounded-full shadow-lg"
        style={{ background:"rgba(8,14,26,0.93)", border:`1.5px solid ${color}`, color, fontSize:10,
          fontFamily:"JetBrains Mono,monospace", fontWeight:600 }}>
        {disp}
      </div>
      <div className="flex justify-center" style={{ marginTop:-1 }}>
        <div style={{ width:0, height:0,
          borderLeft:"5px solid transparent", borderRight:"5px solid transparent",
          borderTop:`6px solid ${color}` }}/>
      </div>
    </div>
  );
}

// ─── Agent Sprite ─────────────────────────────────────────────────────────────
function AgentSprite({ idx, agent, cW, cH }: {
  idx: number; agent: AgentState | undefined; cW: number; cH: number;
}) {
  const [leftPct, topPct] = POSITIONS[idx];
  const color  = AGENT_COLORS[idx];
  const status = agent?.status ?? "idle";
  const isActive   = status === "working" || status === "thinking";
  const isDone     = status === "done";
  const isIdle     = status === "idle";
  const task       = agent?.currentTask;

  const spriteW = (SPRITE_W_PCT / 100) * cW;
  // Position anchor = bottom-centre of sprite
  const left   = (leftPct / 100) * cW - spriteW / 2;
  const bottom = (1 - topPct / 100) * cH; // topPct is from top, convert to bottom

  return (
    <div className="absolute" style={{
      left, bottom,
      width: spriteW,
      zIndex: 10 + idx,
      transition: "filter 0.4s ease",
      filter: isIdle
        ? "grayscale(55%) brightness(0.72)"
        : isDone
        ? `drop-shadow(0 0 14px ${color}) brightness(1.08)`
        : isActive
        ? `drop-shadow(0 0 10px ${color}88)`
        : "none",
    }} data-testid={`sprite-${AGENT_IDS[idx]}`}>

      {/* Floor shadow ellipse */}
      <div className="absolute left-1/2" style={{
        bottom: -4, transform: "translateX(-50%)",
        width: spriteW * 0.55, height: spriteW * 0.1,
        background: `radial-gradient(ellipse, rgba(0,0,0,0.45) 0%, transparent 70%)`,
        borderRadius: "50%", zIndex: -1,
      }}/>

      {/* Active glow on floor */}
      {isActive && (
        <div className="absolute left-1/2" style={{
          bottom: -2, transform: "translateX(-50%)",
          width: spriteW * 0.65, height: spriteW * 0.13,
          background: `radial-gradient(ellipse, ${color}55 0%, transparent 70%)`,
          borderRadius: "50%", zIndex: -1,
          animation: "glowPulse 2s ease-in-out infinite",
        }}/>
      )}

      {/* Speech bubble */}
      {task && (isActive || isDone) && <SpeechBubble text={task} color={color}/>}

      {/* Sprite image */}
      <img src={AGENT_IMGS[idx]} alt={AGENT_NAMES[idx]}
        style={{ width:"100%", display:"block", userSelect:"none" }} draggable={false}/>

      {/* Name label */}
      <div className="absolute left-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full"
        style={{ bottom: -22, transform:"translateX(-50%)", whiteSpace:"nowrap", zIndex:20,
          background:"rgba(8,14,26,0.85)", border:`1px solid ${color}44` }}>
        <div className="rounded-full flex-shrink-0" style={{
          width:6, height:6,
          background: isIdle ? "#334155" : isDone ? "#10b981" : color,
          boxShadow: isActive ? `0 0 6px ${color}` : "none",
          transition: "all 0.3s",
        }}/>
        <span style={{ fontSize:9, color: isIdle ? "#64748b" : "#e2e8f0",
          fontFamily:"Inter,sans-serif", fontWeight:600 }}>
          {AGENT_NAMES[idx]}
        </span>
      </div>

      {/* Celebrate */}
      {isDone && (
        <div className="absolute right-0" style={{ top:-24, fontSize:15,
          pointerEvents:"none", animation:"celebBounce 0.6s ease infinite alternate" }}>
          🎉
        </div>
      )}
    </div>
  );
}

// ─── Progress Ring ────────────────────────────────────────────────────────────
function ProgressRing({ pct, color, size }: { pct:number; color:string; size:number }) {
  const r = (size-8)/2, circ = 2*Math.PI*r, dash = (pct/100)*circ;
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e3050" strokeWidth="5.5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5.5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition:"stroke-dasharray 0.6s ease" }}/>
      <text x={size/2} y={size/2+5} textAnchor="middle" fill="white"
        fontSize="13" fontFamily="JetBrains Mono,monospace" fontWeight="bold">{pct}%</text>
    </svg>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color, w, h }: { data:number[]; color:string; w:number; h:number }) {
  if (data.length < 2) return <div style={{ width:w, height:h, background:"#0c1624", borderRadius:4 }}/>;
  const max=Math.max(...data), min=Math.min(...data), range=max-min||1;
  const pts = data.map((v,i)=>{
    const x=4+(i/(data.length-1))*(w-8);
    const y=h-4-((v-min)/range)*(h-8);
    return `${x},${y}`;
  }).join(" ");
  const lastPt = pts.split(" ").pop()!;
  return (
    <svg width={w} height={h} style={{ display:"block" }}>
      <rect x={0} y={0} width={w} height={h} rx={4} fill="#0c1624"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" opacity="0.9"/>
      <circle cx={lastPt.split(",")[0]} cy={lastPt.split(",")[1]} r={3} fill={color}/>
    </svg>
  );
}

// ─── Stat Panel ───────────────────────────────────────────────────────────────
function StatPanel({ project, agents, sparkData }:
  { project:Project|null; agents:AgentState[]; sparkData:number[] }) {
  const active = agents.filter(a=>a.status!=="idle").length;
  return (
    <div className="absolute top-4 right-4 flex flex-col gap-2" style={{ width:168, zIndex:30 }}>
      {/* Progress */}
      <div className="rounded-xl p-3" style={{ background:"rgba(8,14,26,0.92)", border:"1px solid #1e3050" }}>
        <div style={{ fontSize:9, color:"#64748b", letterSpacing:"0.08em", fontFamily:"Inter",
          textTransform:"uppercase", marginBottom:8 }}>Project Progress</div>
        <div className="flex items-center gap-3">
          <ProgressRing pct={project?.progress??0} color="#6366f1" size={54}/>
          <div>
            <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"monospace" }}>
              {project?.tasksCompleted??0}/{project?.tasksTotal??7} tasks
            </div>
            <div style={{ fontSize:10, marginTop:3, fontFamily:"monospace",
              color: project?.status==="completed" ? "#10b981" : project ? "#f59e0b" : "#475569" }}>
              {project?.status==="completed" ? "✓ Done" : project ? "● Running" : "○ Idle"}
            </div>
          </div>
        </div>
      </div>

      {/* Agents */}
      <div className="rounded-xl p-3" style={{ background:"rgba(8,14,26,0.92)", border:"1px solid #1e3050" }}>
        <div style={{ fontSize:9, color:"#64748b", letterSpacing:"0.08em", fontFamily:"Inter",
          textTransform:"uppercase", marginBottom:8 }}>
          Agents · {active}/{agents.length} active
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {agents.map((a)=>{
            const i = AGENT_IDS.indexOf(a.id);
            const c = AGENT_COLORS[i] || "#64748b";
            return (
              <div key={a.id} title={a.name} className="rounded-full" style={{
                width:12, height:12,
                background: a.status==="idle" ? "#1e3050" : c,
                border:`1.5px solid ${c}`,
                boxShadow: a.status!=="idle" ? `0 0 5px ${c}` : "none",
                transition:"all 0.3s",
              }}/>
            );
          })}
        </div>
      </div>

      {/* Metrics */}
      {[
        { label:"Tokens",       value: fmt(project?.tokensUsed??0),                       color:"#f59e0b" },
        { label:"Cost Today",   value: `$${(project?.costToday??0).toFixed(2)}`,           color:"#10b981" },
        { label:"Avg Response", value: `${(project?.avgResponseTime??0).toFixed(1)}s`,     color:"#06b6d4" },
      ].map(m=>(
        <div key={m.label} className="rounded-xl px-3 py-2 flex items-center justify-between"
          style={{ background:"rgba(8,14,26,0.92)", border:"1px solid #1e3050" }}>
          <span style={{ fontSize:9, color:"#64748b", fontFamily:"Inter",
            textTransform:"uppercase", letterSpacing:"0.08em" }}>{m.label}</span>
          <span style={{ fontSize:14, color:m.color,
            fontFamily:"JetBrains Mono,monospace", fontWeight:700 }}>{m.value}</span>
        </div>
      ))}

      {/* Sparkline */}
      <div className="rounded-xl p-3" style={{ background:"rgba(8,14,26,0.92)", border:"1px solid #1e3050" }}>
        <div style={{ fontSize:9, color:"#64748b", letterSpacing:"0.08em", fontFamily:"Inter",
          textTransform:"uppercase", marginBottom:8 }}>Progress Trend</div>
        <Sparkline data={sparkData} color="#6366f1" w={142} h={34}/>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function IsometricOffice({ agents, project }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w:900, h:600 });
  const [sparkData, setSparkData] = useState<number[]>([0,0,0,0,0]);

  useEffect(()=>{
    const obs = new ResizeObserver(entries=>{
      const e = entries[0];
      if (e) setDims({ w:e.contentRect.width, h:e.contentRect.height });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return ()=>obs.disconnect();
  },[]);

  useEffect(()=>{
    if (project?.progress!==undefined)
      setSparkData(d=>[...d.slice(-9), project.progress]);
  },[project?.progress]);

  const get = (id:string) => agents.find(a=>a.id===id);

  // Render back-to-front: manager (row0) → frontend/backend (row1) → qa/uiux (row2) → devops (row3)
  const renderOrder = [0,1,2,3,4,5];

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden"
      style={{ background:"linear-gradient(160deg,#0a1020 0%,#0c1828 100%)" }}>

      <style>{`
        @keyframes glowPulse {
          0%,100% { opacity:0.5; transform:translateX(-50%) scaleX(1); }
          50%      { opacity:0.9; transform:translateX(-50%) scaleX(1.3); }
        }
        @keyframes celebBounce {
          from { transform:translateY(0); }
          to   { transform:translateY(-7px); }
        }
      `}</style>

      {/* ── Background: clean office room shell ── */}
      {/* Sized so the floor diamond fills the centre of the canvas */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex:1 }}>
        <img src={bgImg} alt="office floor"
          style={{
            // Scale the room to fill ~90% of the container height, centred
            width:"auto", height:"90%",
            maxWidth:"90%",
            objectFit:"contain",
            userSelect:"none",
            // Shift slightly up so floor centre aligns with sprite layout centre
            marginTop:"-4%",
          }}
          draggable={false}
        />
      </div>

      {/* Subtle dark vignette so sprites pop */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background:"radial-gradient(ellipse 80% 70% at 50% 55%, transparent 40%, rgba(5,10,20,0.45) 100%)",
        zIndex:2,
      }}/>

      {/* ── Agent sprites ── */}
      <div className="absolute inset-0" style={{ zIndex:3 }}>
        {renderOrder.map(i=>(
          <AgentSprite key={AGENT_IDS[i]} idx={i} agent={get(AGENT_IDS[i])}
            cW={dims.w} cH={dims.h}/>
        ))}
      </div>

      {/* ── Stat panel ── */}
      <StatPanel project={project} agents={agents} sparkData={sparkData}/>

      {/* ── Project banner ── */}
      <div className="absolute bottom-4 left-4" style={{ zIndex:30 }}>
        {project ? (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
            style={{ background:"rgba(8,14,26,0.92)", border:"1px solid #1e3050", maxWidth:280 }}>
            <div className="relative flex-shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400"/>
              <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60"/>
            </div>
            <div>
              <div style={{ fontSize:9, color:"#64748b", textTransform:"uppercase",
                letterSpacing:"0.08em", fontFamily:"Inter" }}>Active Project</div>
              <div style={{ fontSize:13, color:"white", fontWeight:600, fontFamily:"Inter" }}>
                {project.name.length>28 ? project.name.slice(0,28)+"…" : project.name}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-2 rounded-xl"
            style={{ background:"rgba(8,14,26,0.75)", border:"1px solid #1e3050" }}>
            <span style={{ fontSize:12, color:"#475569", fontFamily:"Inter" }}>
              Click "New Project" to start a simulation
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
