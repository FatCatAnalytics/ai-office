import { useEffect, useRef, useState } from "react";
import type { AgentState } from "../types";

interface Props {
  agents: AgentState[];
}

// ─── Isometric math helpers ───────────────────────────────────────────────────
// Convert grid (col, row) to isometric screen (x, y)
// Standard iso: x = (col - row) * tileW/2, y = (col + row) * tileH/2
const TILE_W = 120;
const TILE_H = 60;
const GRID_OFFSET_X = 480;
const GRID_OFFSET_Y = 80;

function isoX(col: number, row: number) {
  return GRID_OFFSET_X + (col - row) * (TILE_W / 2);
}
function isoY(col: number, row: number) {
  return GRID_OFFSET_Y + (col + row) * (TILE_H / 2);
}

// ─── Floor tile ───────────────────────────────────────────────────────────────
function FloorTile({ col, row, shade }: { col: number; row: number; shade?: boolean }) {
  const x = isoX(col, row);
  const y = isoY(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const fill = shade ? "#1a2235" : "#1e2a3d";
  const stroke = "#263348";
  return (
    <polygon
      points={`${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}`}
      fill={fill}
      stroke={stroke}
      strokeWidth="1"
    />
  );
}

// ─── Desk with monitor ────────────────────────────────────────────────────────
function IsoDesk({ col, row, color, isWorking }: { col: number; row: number; color: string; isWorking: boolean }) {
  const x = isoX(col, row);
  const y = isoY(col, row);

  // Desk top surface (isometric box top)
  const deskH = 18;
  const deskW = TILE_W * 0.7;
  const deskD = TILE_H * 0.55;
  const hw = deskW / 2;

  return (
    <g>
      {/* Desk body - front face */}
      <polygon
        points={`
          ${x - hw},${y + deskD * 0.3}
          ${x - hw},${y + deskD * 0.3 + deskH}
          ${x},${y + deskD * 0.6 + deskH}
          ${x},${y + deskD * 0.6}
        `}
        fill="#2d3a52"
        stroke="#3a4a68"
        strokeWidth="0.5"
      />
      {/* Desk body - right face */}
      <polygon
        points={`
          ${x},${y + deskD * 0.6}
          ${x},${y + deskD * 0.6 + deskH}
          ${x + hw},${y + deskD * 0.3 + deskH}
          ${x + hw},${y + deskD * 0.3}
        `}
        fill="#243044"
        stroke="#3a4a68"
        strokeWidth="0.5"
      />
      {/* Desk top surface */}
      <polygon
        points={`
          ${x - hw},${y + deskD * 0.3}
          ${x},${y}
          ${x + hw},${y + deskD * 0.3}
          ${x},${y + deskD * 0.6}
        `}
        fill="#364d6e"
        stroke="#4a6080"
        strokeWidth="0.5"
      />
      {/* Color accent strip on desk edge */}
      <polygon
        points={`
          ${x - hw},${y + deskD * 0.3}
          ${x - hw},${y + deskD * 0.3 + 3}
          ${x},${y + deskD * 0.6 + 3}
          ${x},${y + deskD * 0.6}
        `}
        fill={color}
        opacity="0.7"
      />

      {/* Monitor stand */}
      <line
        x1={x - 5} y1={y + deskD * 0.2}
        x2={x - 5} y2={y + deskD * 0.2 - 22}
        stroke="#4a5a7a"
        strokeWidth="2"
      />
      {/* Monitor screen (isometric face) */}
      <polygon
        points={`
          ${x - 20},${y + deskD * 0.2 - 36}
          ${x + 12},${y + deskD * 0.2 - 22}
          ${x + 12},${y + deskD * 0.2 - 42}
          ${x - 20},${y + deskD * 0.2 - 56}
        `}
        fill={isWorking ? "#0d1f35" : "#0a1520"}
        stroke={isWorking ? color : "#2a3a50"}
        strokeWidth="1.5"
      />
      {/* Monitor screen glow */}
      {isWorking && (
        <>
          <polygon
            points={`
              ${x - 18},${y + deskD * 0.2 - 38}
              ${x + 10},${y + deskD * 0.2 - 25}
              ${x + 10},${y + deskD * 0.2 - 40}
              ${x - 18},${y + deskD * 0.2 - 53}
            `}
            fill={color}
            opacity="0.15"
          />
          {/* Code lines on screen */}
          {[0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1={x - 14 + i * 1} y1={y + deskD * 0.2 - 50 + i * 6}
              x2={x + 4 + i * 0.5} y2={y + deskD * 0.2 - 43 + i * 6}
              stroke={color}
              strokeWidth="1"
              opacity={0.4 + i * 0.1}
            />
          ))}
        </>
      )}
      {/* Keyboard */}
      <polygon
        points={`
          ${x - 14},${y + deskD * 0.5}
          ${x - 2},${y + deskD * 0.38}
          ${x + 4},${y + deskD * 0.44}
          ${x - 8},${y + deskD * 0.56}
        `}
        fill="#2a3a52"
        stroke="#3a4a62"
        strokeWidth="0.5"
      />
      {/* Mouse */}
      <ellipse cx={x + 10} cy={y + deskD * 0.44} rx={4} ry={3}
        transform={`rotate(-30, ${x + 10}, ${y + deskD * 0.44})`}
        fill="#2a3a52" stroke="#3a4a62" strokeWidth="0.5"
      />
      {/* Coffee cup */}
      <rect x={x + hw - 18} y={y + deskD * 0.15} width={8} height={9} rx={1}
        fill="#8B6914" stroke="#a07820" strokeWidth="0.5"
      />
      <line x1={x + hw - 10} y1={y + deskD * 0.18} x2={x + hw - 7} y2={y + deskD * 0.22}
        stroke="#8B6914" strokeWidth="1.5"
      />
    </g>
  );
}

// ─── Agent character ──────────────────────────────────────────────────────────
// Each agent has a unique outfit color and hair style
const AGENT_STYLES = [
  { shirt: "#6366f1", hair: "#2d1b00", skin: "#f4a261", hairStyle: "short" },   // manager - purple
  { shirt: "#22c55e", hair: "#1a1a1a", skin: "#c68642", hairStyle: "medium" },  // frontend - green
  { shirt: "#3b82f6", hair: "#8B4513", skin: "#f5cba7", hairStyle: "short" },   // backend - blue
  { shirt: "#f59e0b", hair: "#4a0000", skin: "#e8b89a", hairStyle: "long" },    // qa - amber
  { shirt: "#ec4899", hair: "#1a1a1a", skin: "#fad7b0", hairStyle: "bun" },     // uiux - pink
  { shirt: "#14b8a6", hair: "#2d2d2d", skin: "#c8a882", hairStyle: "medium" },  // devops - teal
];

function AgentCharacter({
  col, row, agentIndex, status, isTyping, isCelebrating
}: {
  col: number; row: number; agentIndex: number;
  status: string; isTyping: boolean; isCelebrating: boolean;
}) {
  const x = isoX(col, row);
  const y = isoY(col, row);
  const style = AGENT_STYLES[agentIndex] || AGENT_STYLES[0];

  // Character sits behind the desk, slightly elevated
  const cx = x - 8;
  const cy = y - 14;

  const isIdle = status === "idle";
  const isDone = status === "done";

  return (
    <g>
      {/* Chair */}
      <ellipse cx={cx} cy={cy + 26} rx={14} ry={7} fill="#1e2d42" stroke="#2a3d58" strokeWidth="0.5" />
      <rect x={cx - 5} y={cy + 20} width={10} height={14} rx={2} fill="#243350" stroke="#2a3d58" strokeWidth="0.5" />
      {/* Chair back */}
      <rect x={cx - 7} y={cy + 6} width={14} height={16} rx={3}
        fill="#1e2d42" stroke="#2a3d58" strokeWidth="0.5"
      />

      {/* Body / torso */}
      <rect x={cx - 9} y={cy + 8} width={18} height={14} rx={4}
        fill={style.shirt} stroke={style.shirt} strokeWidth="0.5"
      />
      {/* Shirt collar */}
      <polygon
        points={`${cx - 3},${cy + 8} ${cx + 3},${cy + 8} ${cx},${cy + 13}`}
        fill="white" opacity="0.3"
      />

      {/* Arms */}
      {isTyping ? (
        <>
          {/* Arms extended to keyboard */}
          <line x1={cx - 9} y1={cy + 14} x2={cx - 16} y2={cy + 20} stroke={style.skin} strokeWidth="5" strokeLinecap="round" />
          <line x1={cx + 9} y1={cy + 14} x2={cx + 4} y2={cy + 20} stroke={style.skin} strokeWidth="5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <line x1={cx - 9} y1={cy + 12} x2={cx - 13} y2={cy + 22} stroke={style.skin} strokeWidth="5" strokeLinecap="round" />
          <line x1={cx + 9} y1={cy + 12} x2={cx + 5} y2={cy + 22} stroke={style.skin} strokeWidth="5" strokeLinecap="round" />
        </>
      )}

      {/* Neck */}
      <rect x={cx - 4} y={cy + 2} width={8} height={8} rx={3} fill={style.skin} />

      {/* Head */}
      <ellipse cx={cx} cy={cy - 2} rx={11} ry={12} fill={style.skin} />

      {/* Hair */}
      {style.hairStyle === "short" && (
        <ellipse cx={cx} cy={cy - 8} rx={11} ry={7} fill={style.hair} />
      )}
      {style.hairStyle === "medium" && (
        <>
          <ellipse cx={cx} cy={cy - 8} rx={11} ry={7} fill={style.hair} />
          <rect x={cx - 11} y={cy - 4} width={5} height={8} rx={2} fill={style.hair} />
          <rect x={cx + 6} y={cy - 4} width={5} height={8} rx={2} fill={style.hair} />
        </>
      )}
      {style.hairStyle === "long" && (
        <>
          <ellipse cx={cx} cy={cy - 8} rx={11} ry={7} fill={style.hair} />
          <rect x={cx - 11} y={cy - 4} width={4} height={16} rx={2} fill={style.hair} />
          <rect x={cx + 7} y={cy - 4} width={4} height={16} rx={2} fill={style.hair} />
        </>
      )}
      {style.hairStyle === "bun" && (
        <>
          <ellipse cx={cx} cy={cy - 8} rx={11} ry={7} fill={style.hair} />
          <circle cx={cx + 6} cy={cy - 13} r={5} fill={style.hair} />
        </>
      )}

      {/* Eyes */}
      {isCelebrating ? (
        <>
          <path d={`M ${cx - 5} ${cy - 3} Q ${cx - 3} ${cy - 6} ${cx - 1} ${cy - 3}`} stroke="#1a1a1a" strokeWidth="1.5" fill="none" />
          <path d={`M ${cx + 1} ${cy - 3} Q ${cx + 3} ${cy - 6} ${cx + 5} ${cy - 3}`} stroke="#1a1a1a" strokeWidth="1.5" fill="none" />
        </>
      ) : isIdle ? (
        <>
          <ellipse cx={cx - 3} cy={cy - 2} rx={2} ry={1.5} fill="#1a1a1a" opacity="0.6" />
          <ellipse cx={cx + 3} cy={cy - 2} rx={2} ry={1.5} fill="#1a1a1a" opacity="0.6" />
        </>
      ) : (
        <>
          <circle cx={cx - 3} cy={cy - 2} r={2.5} fill="#1a1a1a" />
          <circle cx={cx + 3} cy={cy - 2} r={2.5} fill="#1a1a1a" />
          <circle cx={cx - 2.2} cy={cy - 2.8} r={0.8} fill="white" />
          <circle cx={cx + 3.8} cy={cy - 2.8} r={0.8} fill="white" />
        </>
      )}

      {/* Mouth */}
      {isCelebrating ? (
        <path d={`M ${cx - 4} ${cy + 4} Q ${cx} ${cy + 8} ${cx + 4} ${cy + 4}`} stroke="#1a1a1a" strokeWidth="1.5" fill="#ff8888" />
      ) : isTyping ? (
        <ellipse cx={cx} cy={cy + 4} rx={2.5} ry={1.5} fill="#c0805a" />
      ) : (
        <path d={`M ${cx - 3} ${cy + 4} Q ${cx} ${cy + 6} ${cx + 3} ${cy + 4}`} stroke="#8B5E3C" strokeWidth="1.2" fill="none" />
      )}

      {/* Celebrate sparkles */}
      {isCelebrating && (
        <>
          <text x={cx - 20} y={cy - 20} fontSize="12">✨</text>
          <text x={cx + 10} y={cy - 25} fontSize="10">⭐</text>
        </>
      )}
    </g>
  );
}

// ─── Speech bubble ────────────────────────────────────────────────────────────
function SpeechBubble({ col, row, text, color }: { col: number; row: number; text: string; color: string }) {
  const x = isoX(col, row) + 20;
  const y = isoY(col, row) - 60;
  const maxLen = 22;
  const display = text.length > maxLen ? text.slice(0, maxLen) + "…" : text;

  return (
    <g>
      <rect x={x - 4} y={y - 14} width={display.length * 6.2 + 8} height={20} rx={8}
        fill="#0f1929" stroke={color} strokeWidth="1.2" opacity="0.95"
      />
      {/* Tail */}
      <polygon
        points={`${x + 4},${y + 6} ${x + 2},${y + 14} ${x + 12},${y + 6}`}
        fill="#0f1929" stroke={color} strokeWidth="1"
      />
      <text x={x} y={y} fontSize="9" fill={color} fontFamily="JetBrains Mono, monospace">
        {display}
      </text>
    </g>
  );
}

// ─── Plant decoration ─────────────────────────────────────────────────────────
function Plant({ col, row }: { col: number; row: number }) {
  const x = isoX(col, row);
  const y = isoY(col, row);
  return (
    <g>
      {/* Pot */}
      <ellipse cx={x} cy={y + 8} rx={10} ry={5} fill="#8B4513" />
      <rect x={x - 10} y={y + 5} width={20} height={10} rx={2} fill="#6B3410" />
      {/* Leaves */}
      <ellipse cx={x - 8} cy={y - 5} rx={9} ry={6} fill="#16a34a" transform={`rotate(-30, ${x - 8}, ${y - 5})`} />
      <ellipse cx={x + 8} cy={y - 8} rx={9} ry={6} fill="#15803d" transform={`rotate(20, ${x + 8}, ${y - 8})`} />
      <ellipse cx={x} cy={y - 12} rx={8} ry={7} fill="#16a34a" />
    </g>
  );
}

// ─── Bookshelf ────────────────────────────────────────────────────────────────
function Bookshelf({ col, row }: { col: number; row: number }) {
  const x = isoX(col, row);
  const y = isoY(col, row);
  const w = 50; const h = 40;
  return (
    <g>
      {/* Back */}
      <rect x={x - w / 2} y={y - h} width={w} height={h} rx={2} fill="#2d1f0e" stroke="#3d2a12" strokeWidth="0.5" />
      {/* Shelves */}
      {[0, 1, 2].map(i => (
        <rect key={i} x={x - w / 2 + 2} y={y - h + 10 + i * 12} width={w - 4} height={2} fill="#4a3520" />
      ))}
      {/* Books */}
      {[
        { hue: "#e63946", bx: -20 }, { hue: "#2a9d8f", bx: -13 },
        { hue: "#e9c46a", bx: -6 }, { hue: "#f4a261", bx: 1 },
        { hue: "#6366f1", bx: 8 }, { hue: "#ec4899", bx: 14 },
      ].map((b, i) => (
        <rect key={i} x={x + b.bx} y={y - h + 3 + (i % 3) * 12} width={5} height={9} rx={0.5} fill={b.hue} />
      ))}
    </g>
  );
}

// ─── Whiteboard ───────────────────────────────────────────────────────────────
function Whiteboard({ col, row, hasContent }: { col: number; row: number; hasContent: boolean }) {
  const x = isoX(col, row);
  const y = isoY(col, row);
  return (
    <g>
      <rect x={x - 45} y={y - 70} width={90} height={55} rx={3} fill="#e8f0fe" stroke="#94a3b8" strokeWidth="1.5" />
      <rect x={x - 42} y={y - 67} width={84} height={49} rx={2} fill={hasContent ? "#f0f9ff" : "#e8f0fe"} />
      {hasContent && (
        <>
          <line x1={x - 35} y1={y - 60} x2={x + 10} y2={y - 60} stroke="#6366f1" strokeWidth="1.5" />
          <line x1={x - 35} y1={y - 52} x2={x + 25} y2={y - 52} stroke="#6366f1" strokeWidth="1.5" />
          <line x1={x - 35} y1={y - 44} x2={x + 5} y2={y - 44} stroke="#3b82f6" strokeWidth="1" />
          <circle cx={x + 20} cy={y - 44} r={6} fill="none" stroke="#22c55e" strokeWidth="1.5" />
          <line x1={x + 17} y1={y - 44} x2={x + 23} y2={y - 44} stroke="#22c55e" strokeWidth="1" />
          <line x1={x + 20} y1={y - 47} x2={x + 20} y2={y - 41} stroke="#22c55e" strokeWidth="1" />
        </>
      )}
      {/* Stand legs */}
      <line x1={x - 25} y1={y - 15} x2={x - 30} y2={y + 5} stroke="#94a3b8" strokeWidth="2" />
      <line x1={x + 25} y1={y - 15} x2={x + 30} y2={y + 5} stroke="#94a3b8" strokeWidth="2" />
    </g>
  );
}

// ─── Water cooler ─────────────────────────────────────────────────────────────
function WaterCooler({ col, row }: { col: number; row: number }) {
  const x = isoX(col, row);
  const y = isoY(col, row);
  return (
    <g>
      <rect x={x - 8} y={y - 30} width={16} height={28} rx={3} fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.5" />
      <ellipse cx={x} cy={y - 30} rx={7} ry={10} fill="#93c5fd" stroke="#60a5fa" strokeWidth="0.5" />
      <rect x={x - 3} y={y - 8} width={6} height={5} rx={1} fill="#60a5fa" />
    </g>
  );
}

// ─── Agent desk layout positions ──────────────────────────────────────────────
// [col, row] grid positions for 6 agents in the iso world
const AGENT_POSITIONS: [number, number][] = [
  [2, 0], // manager - top
  [0, 1], // frontend - left
  [4, 1], // backend - right
  [1, 3], // qa - bottom left
  [3, 3], // uiux - bottom right
  [2, 4], // devops - bottom center
];

const AGENT_COLORS = ["#6366f1", "#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#14b8a6"];
const AGENT_IDS = ["manager", "frontend", "backend", "qa", "uiux", "devops"];

// ─── Main component ───────────────────────────────────────────────────────────
export default function IsometricOffice({ agents }: Props) {
  const [tick, setTick] = useState(0);

  // Typing animation tick
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 600);
    return () => clearInterval(id);
  }, []);

  const getAgent = (id: string) => agents.find((a) => a.id === id);

  // Floor grid: 5 cols x 6 rows
  const floorTiles: [number, number][] = [];
  for (let c = 0; c < 6; c++) {
    for (let r = 0; r < 6; r++) {
      floorTiles.push([c, r]);
    }
  }

  // Render order: back to front (higher col+row = front)
  const renderOrder = [...AGENT_POSITIONS.entries()].sort(
    (a, b) => (a[1][0] + a[1][1]) - (b[1][0] + b[1][1])
  );

  return (
    <div className="w-full h-full overflow-hidden flex items-center justify-center" style={{ background: "linear-gradient(180deg, #0a0f1a 0%, #0d1520 100%)" }}>
      <svg
        viewBox="0 100 960 620"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", maxHeight: "100%" }}
      >
        {/* Ambient gradient background */}
        <defs>
          <radialGradient id="ambientGlow" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#1a2a4a" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#080d14" stopOpacity="0" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width="960" height="800" fill="url(#ambientGlow)" />

        {/* Floor tiles */}
        {floorTiles.map(([c, r]) => (
          <FloorTile key={`${c}-${r}`} col={c} row={r} shade={(c + r) % 2 === 0} />
        ))}

        {/* Back decorations */}
        <Bookshelf col={0} row={0} />
        <Whiteboard col={3} row={0} hasContent={agents.some(a => a.status !== "idle")} />
        <Plant col={5} row={0} />
        <Plant col={5} row={2} />
        <WaterCooler col={5} row={4} />

        {/* Render desks + agents back to front */}
        {renderOrder.map(([i, [col, row]]) => {
          const agentId = AGENT_IDS[i];
          const agent = getAgent(agentId);
          const color = AGENT_COLORS[i];
          const status = agent?.status ?? "idle";
          const isWorking = status === "working";
          const isThinking = status === "thinking";
          const isDone = status === "done";
          const isTyping = isWorking && tick % 2 === 0;
          const isCelebrating = isDone;
          const currentTask = agent?.currentTask;

          return (
            <g key={agentId}>
              <IsoDesk col={col} row={row} color={color} isWorking={isWorking || isThinking} />
              <AgentCharacter
                col={col} row={row}
                agentIndex={i}
                status={status}
                isTyping={isTyping}
                isCelebrating={isCelebrating}
              />
              {currentTask && (isWorking || isThinking || isDone) && (
                <SpeechBubble col={col} row={row} text={currentTask} color={color} />
              )}
            </g>
          );
        })}

        {/* Ceiling light effect */}
        {AGENT_POSITIONS.map(([col, row], i) => {
          const agent = getAgent(AGENT_IDS[i]);
          const isActive = agent?.status === "working" || agent?.status === "thinking";
          if (!isActive) return null;
          const x = isoX(col, row);
          const y = isoY(col, row);
          return (
            <ellipse key={i} cx={x} cy={y - 20} rx={35} ry={20}
              fill={AGENT_COLORS[i]} opacity="0.06" filter="url(#glow)"
            />
          );
        })}
      </svg>
    </div>
  );
}
