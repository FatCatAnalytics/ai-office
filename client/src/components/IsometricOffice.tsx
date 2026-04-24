import { useEffect, useState, useRef } from "react";
import type { AgentState, Project } from "../types";

import bgImg      from "@assets/sprite_office_bg.png";
import managerImg from "@assets/sprite_manager.png";
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

// Positions as % of container [left%, top%] for each agent sprite overlay
// Tuned to sit at the 6 desk positions visible in the background image
const POSITIONS: [number, number][] = [
  [36,  8],  // manager    — top-centre desk
  [12, 28],  // frontend   — left desk
  [60, 28],  // backend    — right desk
  [22, 50],  // qa         — bottom-left desk
  [52, 50],  // uiux       — bottom-right desk
  [38, 62],  // devops     — bottom-centre desk
];

// Sprite size as % of container width
const SPRITE_SIZE = 22;

function fmt(n: number) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(n);
}

// ─── Speech Bubble ────────────────────────────────────────────────────────────
function SpeechBubble({ text, color }: { text: string; color: string }) {
  const disp = text.length > 26 ? text.slice(0, 26) + "…" : text;
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none"
      style={{ top: "-32px", zIndex: 20 }}
    >
      <div
        className="px-2.5 py-1 rounded-full text-xs font-mono font-semibold shadow-lg"
        style={{
          background: "rgba(8,14,26,0.92)",
          border: `1.5px solid ${color}`,
          color: color,
          fontSize: 10,
        }}
      >
        {disp}
      </div>
      {/* tail */}
      <div className="flex justify-center">
        <div style={{ width:0, height:0,
          borderLeft:"5px solid transparent",
          borderRight:"5px solid transparent",
          borderTop:`6px solid ${color}`,
          marginTop:"-1px"
        }}/>
      </div>
    </div>
  );
}

// ─── Agent Sprite Overlay ─────────────────────────────────────────────────────
function AgentSprite({ agent, idx, containerW, containerH }: {
  agent: AgentState | undefined;
  idx: number;
  containerW: number;
  containerH: number;
}) {
  const [left, top] = POSITIONS[idx];
  const color = AGENT_COLORS[idx];
  const status = agent?.status ?? "idle";
  const isActive = status === "working" || status === "thinking";
  const isDone = status === "done";
  const isIdle = status === "idle";
  const task = agent?.currentTask;

  const spriteW = (SPRITE_SIZE / 100) * containerW;
  const leftPx  = (left / 100) * containerW;
  const topPx   = (top  / 100) * containerH;

  return (
    <div
      className="absolute"
      style={{
        left: leftPx,
        top: topPx,
        width: spriteW,
        zIndex: 10 + idx,
        transition: "filter 0.4s ease",
        filter: isIdle
          ? "grayscale(60%) brightness(0.7)"
          : isDone
          ? `drop-shadow(0 0 12px ${color}) brightness(1.1)`
          : isActive
          ? `drop-shadow(0 0 8px ${color})`
          : "none",
      }}
      data-testid={`sprite-${AGENT_IDS[idx]}`}
    >
      {/* Glow ring on floor under active agent */}
      {isActive && (
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2"
          style={{
            width: spriteW * 0.7,
            height: spriteW * 0.18,
            background: `radial-gradient(ellipse, ${color}55 0%, transparent 70%)`,
            borderRadius: "50%",
            zIndex: -1,
          }}
        />
      )}

      {/* Pulse ring when working */}
      {isActive && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ animation: "none" }}
        >
          <div
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full"
            style={{
              width: spriteW * 0.5,
              height: spriteW * 0.12,
              background: color,
              opacity: 0.2,
              animation: "pingMid 2s ease-out infinite",
            }}
          />
        </div>
      )}

      {/* The sprite image */}
      <img
        src={AGENT_IMGS[idx]}
        alt={AGENT_NAMES[idx]}
        style={{ width: "100%", display: "block", userSelect: "none" }}
        draggable={false}
      />

      {/* Speech bubble */}
      {task && (isActive || isDone) && (
        <SpeechBubble text={task} color={color} />
      )}

      {/* Name + status label */}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full"
        style={{
          bottom: -18,
          background: "rgba(8,14,26,0.85)",
          border: `1px solid ${color}44`,
          whiteSpace: "nowrap",
          zIndex: 20,
        }}
      >
        <div
          className="rounded-full flex-shrink-0"
          style={{
            width: 6, height: 6,
            background: isIdle ? "#334155" : isDone ? "#10b981" : color,
            boxShadow: isActive ? `0 0 6px ${color}` : "none",
          }}
        />
        <span style={{ fontSize: 9, color: isIdle ? "#64748b" : "#e2e8f0", fontFamily: "Inter, sans-serif", fontWeight: 600 }}>
          {AGENT_NAMES[idx]}
        </span>
      </div>

      {/* Celebrate emoji */}
      {isDone && (
        <div
          className="absolute -top-6 right-0 text-base pointer-events-none"
          style={{ animation: "bounce 0.6s ease infinite alternate" }}
        >
          🎉
        </div>
      )}
    </div>
  );
}

// ─── Progress Ring ────────────────────────────────────────────────────────────
function ProgressRing({ pct, color, size }: { pct: number; color: string; size: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e3050" strokeWidth="6"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text x={size/2} y={size/2+5} textAnchor="middle" fill="white"
        fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="bold">
        {pct}%
      </text>
    </svg>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color, w, h }: { data: number[]; color: string; w: number; h: number }) {
  if (data.length < 2) return <div style={{ width: w, height: h, background: "#0c1624", borderRadius: 4 }} />;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = 4 + (i / (data.length - 1)) * (w - 8);
    const y = h - 4 - ((v - min) / range) * (h - 8);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <rect x={0} y={0} width={w} height={h} rx={4} fill="#0c1624"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" opacity="0.9"/>
      <circle cx={pts.split(" ").pop()!.split(",")[0]} cy={pts.split(" ").pop()!.split(",")[1]}
        r={3} fill={color}/>
    </svg>
  );
}

// ─── Stat Panel ───────────────────────────────────────────────────────────────
function StatPanel({ project, agents, sparkData }: {
  project: Project | null;
  agents: AgentState[];
  sparkData: number[];
}) {
  const active = agents.filter(a => a.status !== "idle").length;
  const COLORS = AGENT_COLORS;

  return (
    <div
      className="absolute top-4 right-4 flex flex-col gap-2"
      style={{ width: 170, zIndex: 30 }}
    >
      {/* Progress card */}
      <div className="rounded-xl p-3" style={{ background: "rgba(8,14,26,0.9)", border: "1px solid #1e3050" }}>
        <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.08em", fontFamily: "Inter", textTransform: "uppercase" }} className="mb-2">
          Project Progress
        </div>
        <div className="flex items-center gap-3">
          <ProgressRing pct={project?.progress ?? 0} color="#6366f1" size={56} />
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
              {project?.tasksCompleted ?? 0}/{project?.tasksTotal ?? 7} tasks
            </div>
            <div style={{ fontSize: 10, color: project?.status === "completed" ? "#10b981" : "#f59e0b", fontFamily: "monospace", marginTop: 2 }}>
              {project?.status === "completed" ? "✓ Done" : project ? "● Running" : "○ Idle"}
            </div>
          </div>
        </div>
      </div>

      {/* Agents card */}
      <div className="rounded-xl p-3" style={{ background: "rgba(8,14,26,0.9)", border: "1px solid #1e3050" }}>
        <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.08em", fontFamily: "Inter", textTransform: "uppercase" }} className="mb-1.5">
          Agents ({active}/{agents.length} active)
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {agents.map((a, i) => (
            <div key={a.id} title={a.name}
              className="rounded-full"
              style={{
                width: 12, height: 12,
                background: a.status === "idle" ? "#1e3050" : COLORS[AGENT_IDS.indexOf(a.id)],
                border: `1.5px solid ${COLORS[AGENT_IDS.indexOf(a.id)]}`,
                boxShadow: a.status !== "idle" ? `0 0 5px ${COLORS[AGENT_IDS.indexOf(a.id)]}` : "none",
                transition: "all 0.3s ease",
              }}
            />
          ))}
        </div>
      </div>

      {/* Metrics */}
      {[
        { label: "Tokens", value: fmt(project?.tokensUsed ?? 0), color: "#f59e0b" },
        { label: "Cost Today", value: `$${(project?.costToday ?? 0).toFixed(2)}`, color: "#10b981" },
        { label: "Avg Response", value: `${(project?.avgResponseTime ?? 0).toFixed(1)}s`, color: "#06b6d4" },
      ].map(m => (
        <div key={m.label} className="rounded-xl px-3 py-2 flex items-center justify-between"
          style={{ background: "rgba(8,14,26,0.9)", border: "1px solid #1e3050" }}>
          <span style={{ fontSize: 9, color: "#64748b", fontFamily: "Inter", textTransform: "uppercase", letterSpacing: "0.08em" }}>{m.label}</span>
          <span style={{ fontSize: 14, color: m.color, fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>{m.value}</span>
        </div>
      ))}

      {/* Sparkline */}
      <div className="rounded-xl p-3" style={{ background: "rgba(8,14,26,0.9)", border: "1px solid #1e3050" }}>
        <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.08em", fontFamily: "Inter", textTransform: "uppercase" }} className="mb-2">
          Progress Trend
        </div>
        <Sparkline data={sparkData} color="#6366f1" w={144} h={36} />
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function IsometricOffice({ agents, project }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 600 });
  const [sparkData, setSparkData] = useState<number[]>([0, 0, 0, 0, 0]);

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0];
      if (e) setDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (project?.progress !== undefined) {
      setSparkData(d => [...d.slice(-9), project.progress]);
    }
  }, [project?.progress]);

  const get = (id: string) => agents.find(a => a.id === id);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ background: "linear-gradient(160deg, #0a1020 0%, #0c1828 100%)" }}
    >
      {/* Keyframe styles */}
      <style>{`
        @keyframes pingMid {
          0%   { transform: translateX(-50%) scaleX(1);   opacity: 0.25; }
          100% { transform: translateX(-50%) scaleX(2.2); opacity: 0; }
        }
        @keyframes bounce {
          from { transform: translateY(0); }
          to   { transform: translateY(-6px); }
        }
      `}</style>

      {/* Office background image — fills container maintaining aspect */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ zIndex: 1 }}
      >
        <img
          src={bgImg}
          alt="office"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            objectPosition: "center top",
            userSelect: "none",
          }}
          draggable={false}
        />
      </div>

      {/* Dark overlay to let UI elements pop */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(5,10,20,0.25)", zIndex: 2 }}
      />

      {/* Agent sprites */}
      <div className="absolute inset-0" style={{ zIndex: 3 }}>
        {AGENT_IDS.map((id, i) => (
          <AgentSprite
            key={id}
            agent={get(id)}
            idx={i}
            containerW={dims.w}
            containerH={dims.h}
          />
        ))}
      </div>

      {/* Stat panel */}
      <StatPanel project={project} agents={agents} sparkData={sparkData} />

      {/* Project banner bottom-left */}
      <div className="absolute bottom-4 left-4" style={{ zIndex: 30 }}>
        {project ? (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
            style={{ background: "rgba(8,14,26,0.92)", border: "1px solid #1e3050", maxWidth: 280 }}>
            <div className="relative flex-shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "Inter" }}>Active Project</div>
              <div style={{ fontSize: 13, color: "white", fontWeight: 600, fontFamily: "Inter" }}>
                {project.name.length > 28 ? project.name.slice(0, 28) + "…" : project.name}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-2 rounded-xl"
            style={{ background: "rgba(8,14,26,0.7)", border: "1px solid #1e3050" }}>
            <span style={{ fontSize: 12, color: "#334155", fontFamily: "Inter" }}>
              Click "New Project" to start a simulation
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
