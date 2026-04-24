import { useEffect, useState } from "react";
import type { AgentState, Project } from "../types";

interface Props {
  agents: AgentState[];
  project: Project | null;
}

// ─── Iso math ─────────────────────────────────────────────────────────────────
const TW = 100; // tile width
const TH = 50;  // tile height
const OX = 500; // origin x (horizontal centre of SVG)
const OY = 160; // origin y (top of grid)

function ix(col: number, row: number) { return OX + (col - row) * (TW / 2); }
function iy(col: number, row: number) { return OY + (col + row) * (TH / 2); }

// ─── Floor tile ───────────────────────────────────────────────────────────────
function Tile({ c, r }: { c: number; r: number }) {
  const x = ix(c, r), y = iy(c, r), hw = TW / 2, hh = TH / 2;
  const even = (c + r) % 2 === 0;
  return (
    <polygon
      points={`${x},${y-hh} ${x+hw},${y} ${x},${y+hh} ${x-hw},${y}`}
      fill={even ? "#19243a" : "#1c2840"}
      stroke="#22304d" strokeWidth="0.8"
    />
  );
}

// ─── Wall ─────────────────────────────────────────────────────────────────────
function Wall({ c, r }: { c: number; r: number }) {
  const x = ix(c, r), y = iy(c, r), hw = TW / 2, hh = TH / 2, wh = 60;
  return (
    <g>
      <polygon points={`${x-hw},${y} ${x},${y+hh} ${x},${y+hh-wh} ${x-hw},${y-wh}`}
        fill="#141e30" stroke="#1e2d45" strokeWidth="0.5" />
      <polygon points={`${x},${y+hh} ${x+hw},${y} ${x+hw},${y-wh} ${x},${y+hh-wh}`}
        fill="#111926" stroke="#1e2d45" strokeWidth="0.5" />
    </g>
  );
}

// ─── Desk ─────────────────────────────────────────────────────────────────────
function Desk({ c, r, color, active }: { c: number; r: number; color: string; active: boolean }) {
  const x = ix(c, r), y = iy(c, r);
  const dw = TW * 0.72, dd = TH * 0.6, dh = 16;
  const hw = dw / 2;

  return (
    <g>
      {/* desk front-left face */}
      <polygon points={`${x-hw},${y+dd*0.28} ${x-hw},${y+dd*0.28+dh} ${x},${y+dd*0.58+dh} ${x},${y+dd*0.58}`}
        fill="#2c3a54" stroke="#3a4d6a" strokeWidth="0.5"/>
      {/* desk front-right face */}
      <polygon points={`${x},${y+dd*0.58} ${x},${y+dd*0.58+dh} ${x+hw},${y+dd*0.28+dh} ${x+hw},${y+dd*0.28}`}
        fill="#233048" stroke="#3a4d6a" strokeWidth="0.5"/>
      {/* desk top */}
      <polygon points={`${x-hw},${y+dd*0.28} ${x},${y} ${x+hw},${y+dd*0.28} ${x},${y+dd*0.58}`}
        fill="#344766" stroke="#4a6080" strokeWidth="0.5"/>
      {/* colour accent */}
      <polygon points={`${x-hw},${y+dd*0.28} ${x-hw},${y+dd*0.28+3} ${x},${y+dd*0.58+3} ${x},${y+dd*0.58}`}
        fill={color} opacity="0.75"/>

      {/* Monitor stand */}
      <line x1={x-4} y1={y+dd*0.18} x2={x-4} y2={y+dd*0.18-24} stroke="#4a5a7a" strokeWidth="2"/>
      {/* Monitor */}
      <polygon points={`${x-22},${y+dd*0.18-38} ${x+10},${y+dd*0.18-22} ${x+10},${y+dd*0.18-44} ${x-22},${y+dd*0.18-60}`}
        fill={active ? "#0d1f35" : "#0a1520"} stroke={active ? color : "#253550"} strokeWidth="1.5"/>
      {active && <>
        <polygon points={`${x-20},${y+dd*0.18-40} ${x+8},${y+dd*0.18-25} ${x+8},${y+dd*0.18-42} ${x-20},${y+dd*0.18-57}`}
          fill={color} opacity="0.12"/>
        {[0,1,2,3].map(i=>(
          <line key={i} x1={x-16+i} y1={y+dd*0.18-54+i*7} x2={x+4+i*0.4} y2={y+dd*0.18-47+i*7}
            stroke={color} strokeWidth="1" opacity={0.35+i*0.12}/>
        ))}
      </>}

      {/* Keyboard */}
      <polygon points={`${x-14},${y+dd*0.5} ${x-2},${y+dd*0.38} ${x+4},${y+dd*0.43} ${x-8},${y+dd*0.55}`}
        fill="#283a52" stroke="#374e68" strokeWidth="0.5"/>
      {/* Mouse */}
      <ellipse cx={x+10} cy={y+dd*0.43} rx={3.5} ry={2.5}
        transform={`rotate(-28,${x+10},${y+dd*0.43})`} fill="#283a52" stroke="#374e68" strokeWidth="0.5"/>
      {/* Coffee */}
      <rect x={x+hw-18} y={y+dd*0.14} width={7} height={8} rx={1} fill="#7a5810" stroke="#9a7020" strokeWidth="0.5"/>
      <line x1={x+hw-11} y1={y+dd*0.17} x2={x+hw-8} y2={y+dd*0.21} stroke="#7a5810" strokeWidth="1.5"/>
    </g>
  );
}

// ─── Person ───────────────────────────────────────────────────────────────────
const STYLES = [
  { shirt:"#6366f1", hair:"#2d1800", skin:"#f0a070", hs:"short" },
  { shirt:"#22c55e", hair:"#1a1a1a", skin:"#c88040", hs:"medium" },
  { shirt:"#3b82f6", hair:"#7a3800", skin:"#f5c8a0", hs:"short" },
  { shirt:"#f59e0b", hair:"#3a0000", skin:"#e8a880", hs:"long" },
  { shirt:"#ec4899", hair:"#111111", skin:"#fad0a0", hs:"bun" },
  { shirt:"#14b8a6", hair:"#2a2a2a", skin:"#c8a070", hs:"medium" },
];

function Person({ c, r, idx, status, typing, celebrate }:
  { c:number; r:number; idx:number; status:string; typing:boolean; celebrate:boolean }) {
  const x = ix(c,r), y = iy(c,r);
  const s = STYLES[idx] || STYLES[0];
  const px = x - 8, py = y - 10;
  const idle = status === "idle";

  return (
    <g>
      {/* Chair base */}
      <ellipse cx={px} cy={py+28} rx={13} ry={6} fill="#1a2840" stroke="#253550" strokeWidth="0.5"/>
      <rect x={px-5} y={py+22} width={10} height={12} rx={2} fill="#202e48"/>
      {/* Chair back */}
      <rect x={px-7} y={py+6} width={14} height={15} rx={3} fill="#1a2840" stroke="#253550" strokeWidth="0.5"/>

      {/* Body */}
      <rect x={px-9} y={py+8} width={18} height={14} rx={4} fill={s.shirt}/>
      {/* Collar */}
      <polygon points={`${px-3},${py+8} ${px+3},${py+8} ${px},${py+13}`} fill="white" opacity="0.25"/>

      {/* Arms */}
      {typing ? <>
        <line x1={px-9} y1={py+14} x2={px-15} y2={py+21} stroke={s.skin} strokeWidth="4.5" strokeLinecap="round"/>
        <line x1={px+9} y1={py+14} x2={px+3}  y2={py+21} stroke={s.skin} strokeWidth="4.5" strokeLinecap="round"/>
      </> : <>
        <line x1={px-9} y1={py+13} x2={px-12} y2={py+22} stroke={s.skin} strokeWidth="4.5" strokeLinecap="round"/>
        <line x1={px+9} y1={py+13} x2={px+5}  y2={py+22} stroke={s.skin} strokeWidth="4.5" strokeLinecap="round"/>
      </>}

      {/* Neck */}
      <rect x={px-4} y={py+1} width={8} height={9} rx={3} fill={s.skin}/>
      {/* Head */}
      <ellipse cx={px} cy={py-3} rx={10} ry={11} fill={s.skin}/>

      {/* Hair */}
      {s.hs==="short" && <ellipse cx={px} cy={py-9} rx={10} ry={6} fill={s.hair}/>}
      {s.hs==="medium" && <>
        <ellipse cx={px} cy={py-9} rx={10} ry={6} fill={s.hair}/>
        <rect x={px-10} y={py-5} width={4} height={8} rx={2} fill={s.hair}/>
        <rect x={px+6}  y={py-5} width={4} height={8} rx={2} fill={s.hair}/>
      </>}
      {s.hs==="long" && <>
        <ellipse cx={px} cy={py-9} rx={10} ry={6} fill={s.hair}/>
        <rect x={px-10} y={py-5} width={4} height={16} rx={2} fill={s.hair}/>
        <rect x={px+6}  y={py-5} width={4} height={16} rx={2} fill={s.hair}/>
      </>}
      {s.hs==="bun" && <>
        <ellipse cx={px} cy={py-9} rx={10} ry={6} fill={s.hair}/>
        <circle cx={px+5} cy={py-14} r={5} fill={s.hair}/>
      </>}

      {/* Eyes */}
      {celebrate ? <>
        <path d={`M${px-5},${py-4} Q${px-3},${py-7} ${px-1},${py-4}`} stroke="#111" strokeWidth="1.5" fill="none"/>
        <path d={`M${px+1},${py-4} Q${px+3},${py-7} ${px+5},${py-4}`} stroke="#111" strokeWidth="1.5" fill="none"/>
      </> : idle ? <>
        <ellipse cx={px-3} cy={py-3} rx={2} ry={1.4} fill="#111" opacity="0.55"/>
        <ellipse cx={px+3} cy={py-3} rx={2} ry={1.4} fill="#111" opacity="0.55"/>
      </> : <>
        <circle cx={px-3} cy={py-3} r={2.4} fill="#111"/>
        <circle cx={px+3} cy={py-3} r={2.4} fill="#111"/>
        <circle cx={px-2.2} cy={py-3.7} r={0.7} fill="white"/>
        <circle cx={px+3.8} cy={py-3.7} r={0.7} fill="white"/>
      </>}

      {/* Mouth */}
      {celebrate
        ? <path d={`M${px-4},${py+4} Q${px},${py+8} ${px+4},${py+4}`} stroke="#111" strokeWidth="1.4" fill="#ff8888"/>
        : typing
          ? <ellipse cx={px} cy={py+4} rx={2} ry={1.4} fill="#b07050"/>
          : <path d={`M${px-3},${py+4} Q${px},${py+6} ${px+3},${py+4}`} stroke="#8B5E3C" strokeWidth="1.1" fill="none"/>
      }

      {/* Sparkles on done */}
      {celebrate && <>
        <text x={px-22} y={py-18} fontSize="13" style={{userSelect:"none"}}>✨</text>
        <text x={px+10}  y={py-22} fontSize="11" style={{userSelect:"none"}}>⭐</text>
      </>}
    </g>
  );
}

// ─── Speech bubble ────────────────────────────────────────────────────────────
function Bubble({ c, r, text, color }: { c:number; r:number; text:string; color:string }) {
  const x = ix(c,r)+22, y = iy(c,r)-58;
  const disp = text.length > 24 ? text.slice(0,24)+"…" : text;
  const bw = disp.length * 5.8 + 14;
  return (
    <g style={{pointerEvents:"none"}}>
      <rect x={x-4} y={y-14} width={bw} height={20} rx={8}
        fill="#0c1624" stroke={color} strokeWidth="1.2" opacity="0.96"/>
      <polygon points={`${x+6},${y+6} ${x+4},${y+15} ${x+14},${y+6}`}
        fill="#0c1624" stroke={color} strokeWidth="1"/>
      <text x={x+2} y={y} fontSize="8.5" fill={color} fontFamily="JetBrains Mono, monospace">{disp}</text>
    </g>
  );
}

// ─── Decorations ──────────────────────────────────────────────────────────────
function Plant({ c, r }: { c:number; r:number }) {
  const x = ix(c,r), y = iy(c,r);
  return <g>
    <ellipse cx={x} cy={y+8} rx={9} ry={4.5} fill="#7a3a10"/>
    <rect x={x-9} y={y+5} width={18} height={9} rx={2} fill="#5a2c0c"/>
    <ellipse cx={x-7} cy={y-4} rx={8} ry={5.5} fill="#16a34a" transform={`rotate(-30,${x-7},${y-4})`}/>
    <ellipse cx={x+7} cy={y-7} rx={8} ry={5.5} fill="#15803d" transform={`rotate(25,${x+7},${y-7})`}/>
    <ellipse cx={x}   cy={y-11} rx={7} ry={6} fill="#16a34a"/>
  </g>;
}

function Shelf({ c, r }: { c:number; r:number }) {
  const x = ix(c,r), y = iy(c,r);
  const books = ["#e63946","#2a9d8f","#e9c46a","#f4a261","#6366f1","#ec4899","#14b8a6","#f97316"];
  return <g>
    <rect x={x-28} y={y-44} width={56} height={44} rx={2} fill="#2a1c0c" stroke="#3a2810" strokeWidth="0.5"/>
    {[0,1,2].map(i=><rect key={i} x={x-26} y={y-44+11+i*13} width={52} height={2} fill="#3a2810"/>)}
    {books.map((b,i)=>(
      <rect key={i} x={x-22+i*6} y={y-42+(i%3)*12} width={4.5} height={10} rx={0.5} fill={b}/>
    ))}
  </g>;
}

function Whiteboard({ c, r, active }: { c:number; r:number; active:boolean }) {
  const x = ix(c,r), y = iy(c,r);
  return <g>
    <rect x={x-52} y={y-72} width={104} height={60} rx={3} fill="#dde8f8" stroke="#8a9ab8" strokeWidth="1.5"/>
    <rect x={x-48} y={y-68} width={96} height={52} rx={2} fill={active?"#f0f8ff":"#e8f0fc"}/>
    {active && <>
      <text x={x-42} y={y-52} fontSize="8" fill="#6366f1" fontFamily="monospace" fontWeight="bold">BUILD · SHIP · SCALE</text>
      <line x1={x-42} y1={y-42} x2={x+20} y2={y-42} stroke="#6366f1" strokeWidth="1.5"/>
      <line x1={x-42} y1={y-32} x2={x+35} y2={y-32} stroke="#3b82f6" strokeWidth="1"/>
      <line x1={x-42} y1={y-22} x2={x+10} y2={y-22} stroke="#3b82f6" strokeWidth="1"/>
      <circle cx={x+38} cy={y-28} r={8} fill="none" stroke="#22c55e" strokeWidth="1.5"/>
      <line x1={x+34} y1={y-28} x2={x+42} y2={y-28} stroke="#22c55e" strokeWidth="1.2"/>
      <line x1={x+38} y1={y-32} x2={x+38} y2={y-24} stroke="#22c55e" strokeWidth="1.2"/>
    </>}
    <line x1={x-30} y1={y-12} x2={x-35} y2={y+8} stroke="#8a9ab8" strokeWidth="2"/>
    <line x1={x+30} y1={y-12} x2={x+35} y2={y+8} stroke="#8a9ab8" strokeWidth="2"/>
  </g>;
}

function Cooler({ c, r }: { c:number; r:number }) {
  const x = ix(c,r), y = iy(c,r);
  return <g>
    <rect x={x-8} y={y-32} width={16} height={30} rx={3} fill="#c8d8e8" stroke="#a0b4c8" strokeWidth="0.5"/>
    <ellipse cx={x} cy={y-32} rx={6} ry={9} fill="#90c0f0" stroke="#60a0e8" strokeWidth="0.5"/>
    <rect x={x-4} y={y-8} width={8} height={5} rx={1} fill="#60a0f0"/>
  </g>;
}

// ─── Stat overlay card (floats in scene) ──────────────────────────────────────
function StatCard({ x, y, label, value, color, sub }:
  { x:number; y:number; label:string; value:string; color:string; sub?:string }) {
  return (
    <g>
      <rect x={x} y={y} width={90} height={40} rx={6} fill="#0c1624" stroke={color} strokeWidth="1" opacity="0.92"/>
      <text x={x+8} y={y+14} fontSize="8" fill={color} fontFamily="Inter, sans-serif" opacity="0.8">{label}</text>
      <text x={x+8} y={y+30} fontSize="14" fill={color} fontFamily="JetBrains Mono, monospace" fontWeight="bold">{value}</text>
      {sub && <text x={x+60} y={y+30} fontSize="8" fill={color} fontFamily="monospace" opacity="0.6">{sub}</text>}
    </g>
  );
}

// ─── Mini sparkline ───────────────────────────────────────────────────────────
function Sparkline({ x, y, data, color }: { x:number; y:number; data:number[]; color:string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const w = 80, h = 24;
  const pts = data.map((v, i) => {
    const sx = x + (i / (data.length - 1)) * w;
    const sy = y + h - ((v - min) / range) * h;
    return `${sx},${sy}`;
  }).join(" ");
  return (
    <g>
      <rect x={x} y={y-2} width={w} height={h+4} rx={4} fill="#0c1624" stroke={color} strokeWidth="0.8" opacity="0.85"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" opacity="0.9"/>
    </g>
  );
}

// ─── Agent positions ──────────────────────────────────────────────────────────
const POS: [number,number][] = [
  [3,1], // manager   — top centre
  [1,2], // frontend  — left
  [5,2], // backend   — right
  [2,4], // qa        — bottom left
  [4,4], // uiux      — bottom right
  [3,5], // devops    — bottom centre
];
const COLORS = ["#6366f1","#22c55e","#3b82f6","#f59e0b","#ec4899","#14b8a6"];
const IDS    = ["manager","frontend","backend","qa","uiux","devops"];

function fmt(n:number){ return n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?(n/1e3).toFixed(1)+"K":String(n); }

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function IsometricOffice({ agents, project }: Props) {
  const [tick, setTick] = useState(0);
  const [sparkData, setSparkData] = useState<number[]>([0,0,0,0,0]);

  useEffect(() => {
    const id = setInterval(() => setTick(t=>t+1), 500);
    return () => clearInterval(id);
  }, []);

  // build sparkline from project progress over time
  useEffect(() => {
    if (project?.progress) {
      setSparkData(d => [...d.slice(-9), project.progress]);
    }
  }, [project?.progress]);

  const get = (id:string) => agents.find(a=>a.id===id);
  const activeCount = agents.filter(a=>a.status!=="idle").length;

  // floor grid
  const tiles: [number,number][] = [];
  for(let c=0;c<8;c++) for(let r=0;r<8;r++) tiles.push([c,r]);

  // sort agents back-to-front
  const sorted = POS.map((pos,i)=>({i,pos})).sort((a,b)=>(a.pos[0]+a.pos[1])-(b.pos[0]+b.pos[1]));

  const hasProject = !!project;

  return (
    <div className="w-full h-full" style={{background:"linear-gradient(180deg,#080e1a 0%,#0c1422 100%)"}}>
      <svg viewBox="0 0 1000 760" preserveAspectRatio="xMidYMid meet"
        style={{width:"100%",height:"100%"}}>
        <defs>
          <radialGradient id="oGlow" cx="50%" cy="35%" r="55%">
            <stop offset="0%" stopColor="#1a3060" stopOpacity="0.5"/>
            <stop offset="100%" stopColor="#080e1a" stopOpacity="0"/>
          </radialGradient>
          <filter id="fg">
            <feGaussianBlur stdDeviation="4" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* Background glow */}
        <rect x="0" y="0" width="1000" height="760" fill="url(#oGlow)"/>

        {/* Floor */}
        {tiles.map(([c,r])=><Tile key={`${c}${r}`} c={c} r={r}/>)}

        {/* Back walls (row 0) */}
        {[0,1,2,3,4,5,6,7].map(c=><Wall key={c} c={c} r={0}/>)}

        {/* Decorations */}
        <Shelf c={0} r={1}/>
        <Shelf c={7} r={1}/>
        <Whiteboard c={3} r={0} active={hasProject}/>
        <Whiteboard c={4} r={0} active={hasProject}/>
        <Plant c={0} r={3}/>
        <Plant c={7} r={3}/>
        <Plant c={0} r={6}/>
        <Plant c={7} r={6}/>
        <Cooler c={6} r={5}/>

        {/* Desks + people (back to front) */}
        {sorted.map(({i,pos:[c,r]})=>{
          const id = IDS[i];
          const agent = get(id);
          const color = COLORS[i];
          const status = agent?.status ?? "idle";
          const active = status==="working"||status==="thinking";
          const typing = status==="working" && tick%2===0;
          const done = status==="done";
          const task = agent?.currentTask;
          return (
            <g key={id}>
              <Desk c={c} r={r} color={color} active={active}/>
              <Person c={c} r={r} idx={i} status={status} typing={typing} celebrate={done}/>
              {task && (active||done) && <Bubble c={c} r={r} text={task} color={color}/>}
              {/* Active desk glow */}
              {active && (
                <ellipse cx={ix(c,r)} cy={iy(c,r)-15} rx={38} ry={22}
                  fill={color} opacity="0.07" filter="url(#fg)"/>
              )}
            </g>
          );
        })}

        {/* ── Floating stat overlay cards (top-right of scene) ── */}
        {/* Progress ring-style card */}
        <g>
          <rect x={812} y={20} width={170} height={130} rx={10}
            fill="#0c1624" stroke="#1e3050" strokeWidth="1" opacity="0.95"/>
          <text x={830} y={44} fontSize="9" fill="#64748b" fontFamily="Inter,sans-serif"
            textAnchor="start" letterSpacing="1">PROJECT PROGRESS</text>
          {/* Arc progress */}
          <circle cx={897} cy={100} r={34} fill="none" stroke="#1e3050" strokeWidth="6"/>
          <circle cx={897} cy={100} r={34} fill="none" stroke="#6366f1" strokeWidth="6"
            strokeDasharray={`${(project?.progress??0)/100*213.6} 213.6`}
            strokeLinecap="round"
            transform="rotate(-90 897 100)"/>
          <text x={897} y={106} fontSize="18" fill="white" textAnchor="middle"
            fontFamily="JetBrains Mono,monospace" fontWeight="bold">
            {project?.progress??0}%
          </text>
          <text x={897} y={122} fontSize="8" fill="#64748b" textAnchor="middle"
            fontFamily="monospace">
            {project?.tasksCompleted??0}/{project?.tasksTotal??7} tasks
          </text>
        </g>

        {/* Active agents card */}
        <g>
          <rect x={812} y={162} width={170} height={52} rx={8}
            fill="#0c1624" stroke="#1e3050" strokeWidth="1" opacity="0.95"/>
          <text x={830} y={180} fontSize="9" fill="#64748b" fontFamily="Inter,sans-serif" letterSpacing="1">AGENTS</text>
          <text x={830} y={202} fontSize="20" fill="#22c55e" fontFamily="JetBrains Mono,monospace" fontWeight="bold">
            {activeCount}
          </text>
          <text x={858} y={202} fontSize="10" fill="#64748b" fontFamily="monospace"> / {agents.length} active</text>
          {/* Agent status dots */}
          {agents.map((a,i)=>(
            <circle key={a.id} cx={905+i*11} cy={183} r={4}
              fill={a.status==="idle"?"#1e3050":COLORS[IDS.indexOf(a.id)]}
              stroke={COLORS[IDS.indexOf(a.id)]} strokeWidth="1"/>
          ))}
        </g>

        {/* Tokens + Cost */}
        <StatCard x={812} y={226} label="TOKENS USED" value={fmt(project?.tokensUsed??0)} color="#f59e0b"/>
        <StatCard x={812} y={278} label="COST TODAY"  value={`$${(project?.costToday??0).toFixed(2)}`} color="#10b981"/>
        <StatCard x={812} y={330} label="AVG RESPONSE" value={`${(project?.avgResponseTime??0).toFixed(1)}s`} color="#06b6d4"/>

        {/* Sparkline — progress over time */}
        <g>
          <rect x={812} y={382} width={170} height={52} rx={8}
            fill="#0c1624" stroke="#1e3050" strokeWidth="1" opacity="0.95"/>
          <text x={820} y={398} fontSize="9" fill="#64748b" fontFamily="Inter,sans-serif" letterSpacing="1">PROGRESS TREND</text>
          <Sparkline x={820} y={402} data={sparkData} color="#6366f1"/>
        </g>

        {/* Project name banner bottom-left */}
        {project && (
          <g>
            <rect x={12} y={690} width={280} height={48} rx={8}
              fill="#0c1624" stroke="#1e3050" strokeWidth="1" opacity="0.95"/>
            <circle cx={32} cy={714} r={6} fill="#22c55e"/>
            <circle cx={32} cy={714} r={6} fill="#22c55e" opacity="0.4">
              <animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite"/>
            </circle>
            <text x={46} y={710} fontSize="10" fill="#94a3b8" fontFamily="Inter,sans-serif">Active Project</text>
            <text x={46} y={726} fontSize="13" fill="white" fontFamily="Inter,sans-serif" fontWeight="600">
              {project.name.length>28?project.name.slice(0,28)+"…":project.name}
            </text>
          </g>
        )}

        {/* Idle hint */}
        {!project && (
          <text x={500} y={700} textAnchor="middle" fontSize="13" fill="#334155"
            fontFamily="Inter,sans-serif">Click "New Project" to start a simulation</text>
        )}
      </svg>
    </div>
  );
}
