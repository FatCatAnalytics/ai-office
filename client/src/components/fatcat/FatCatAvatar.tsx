// Stage 6.12 — stylised CSS/SVG FatCat mascot avatar.
//
// No image asset is required: the cat head is drawn with SVG so it can be tinted
// per-agent and re-coloured by status. A small role glyph (lucide icon) sits on
// the cat's chest/badge so each archetype reads at a glance. These are
// placeholders in the brand direction (rounded, premium, dark) and can later be
// swapped for real FatCat artwork without touching the visual modes.

import {
  Crown, Search, PenTool, FileEdit, BarChart3, ShieldCheck, BadgeCheck,
  Send, ClipboardCheck, Link2, Calculator, AlertTriangle, Radio, FileText,
  Briefcase, TrendingUp, Scale, Wrench,
} from "lucide-react";
import type { FatCatArchetype, FatCatStatus } from "../../lib/fatcatRoster";
import { FATCAT_STATUS_META } from "../../lib/fatcatRoster";

const ROLE_GLYPH: Record<FatCatArchetype, React.ElementType> = {
  manager: Crown,
  research: Search,
  editor: FileEdit,
  writer: PenTool,
  analyst: BarChart3,
  qa: ClipboardCheck,
  factcheck: BadgeCheck,
  publish: Send,
  diligence: Briefcase,
  sourceverify: Link2,
  financial: Calculator,
  risk: AlertTriangle,
  market: Radio,
  memo: FileText,
  cio: ShieldCheck,
  valuation: TrendingUp,
  contrarian: Scale,
  engineer: Wrench,
};

export function archetypeGlyph(a: FatCatArchetype): React.ElementType {
  return ROLE_GLYPH[a] ?? Briefcase;
}

interface Props {
  archetype: FatCatArchetype;
  color: string;
  status: FatCatStatus;
  size?: number;
  /** Manager gets a subtle crown notch + larger ears. */
  manager?: boolean;
  /** Disable status motion (respects prefers-reduced-motion at call sites). */
  reducedMotion?: boolean;
}

// A compact, brand-styled cat head in SVG. Drawn in a 100×100 viewBox.
export default function FatCatAvatar({
  archetype, color, status, size = 72, manager = false, reducedMotion = false,
}: Props) {
  const statusColor = FATCAT_STATUS_META[status].color;
  const Glyph = archetypeGlyph(archetype);
  const active = status === "working" || status === "verifying";

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {/* Status aura ring */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: -3,
          borderRadius: "50%",
          border: `2px solid ${statusColor}`,
          boxShadow: active ? `0 0 ${size * 0.22}px ${statusColor}99` : "none",
          opacity: status === "idle" ? 0.45 : 0.9,
          animation: active && !reducedMotion ? "fcPulse 2.2s ease-in-out infinite" : undefined,
        }}
      />
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block" }}>
        <defs>
          <radialGradient id={`fcBody-${color}`} cx="50%" cy="38%" r="70%">
            <stop offset="0%" stopColor={lighten(color, 0.35)} />
            <stop offset="65%" stopColor={color} />
            <stop offset="100%" stopColor={darken(color, 0.35)} />
          </radialGradient>
        </defs>

        {/* Ears */}
        <polygon points={manager ? "20,40 26,8 44,30" : "22,42 28,14 46,32"} fill={darken(color, 0.15)} />
        <polygon points={manager ? "80,40 74,8 56,30" : "78,42 72,14 54,32"} fill={darken(color, 0.15)} />
        <polygon points="26,36 30,18 40,30" fill={lighten(color, 0.3)} opacity="0.7" />
        <polygon points="74,36 70,18 60,30" fill={lighten(color, 0.3)} opacity="0.7" />

        {/* Head */}
        <circle cx="50" cy="54" r="34" fill={`url(#fcBody-${color})`} stroke={darken(color, 0.4)} strokeWidth="1.5" />

        {/* Cheeks / chonk */}
        <ellipse cx="34" cy="64" rx="11" ry="9" fill={lighten(color, 0.12)} opacity="0.5" />
        <ellipse cx="66" cy="64" rx="11" ry="9" fill={lighten(color, 0.12)} opacity="0.5" />

        {/* Eyes — blink-free, status-tinted glow when active */}
        <ellipse cx="40" cy="50" rx="5.5" ry={status === "complete" ? 1.6 : 6.5} fill="#0b1020" />
        <ellipse cx="60" cy="50" rx="5.5" ry={status === "complete" ? 1.6 : 6.5} fill="#0b1020" />
        {status !== "complete" && (
          <>
            <circle cx="41.5" cy="48" r="1.8" fill={active ? statusColor : "#e2e8f0"} />
            <circle cx="61.5" cy="48" r="1.8" fill={active ? statusColor : "#e2e8f0"} />
          </>
        )}

        {/* Nose + mouth */}
        <polygon points="47,60 53,60 50,64" fill={darken(color, 0.5)} />
        <path d="M50 64 Q45 69 41 65" stroke={darken(color, 0.5)} strokeWidth="1.4" fill="none" />
        <path d="M50 64 Q55 69 59 65" stroke={darken(color, 0.5)} strokeWidth="1.4" fill="none" />

        {/* Whiskers */}
        <g stroke={lighten(color, 0.4)} strokeWidth="1" opacity="0.7">
          <line x1="18" y1="58" x2="34" y2="60" />
          <line x1="18" y1="64" x2="34" y2="64" />
          <line x1="82" y1="58" x2="66" y2="60" />
          <line x1="82" y1="64" x2="66" y2="64" />
        </g>

        {/* Manager crown notch */}
        {manager && (
          <polygon points="38,22 44,30 50,20 56,30 62,22 60,34 40,34" fill="#fde047" stroke="#ca8a04" strokeWidth="0.8" />
        )}
      </svg>

      {/* Role badge */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -2,
          bottom: -2,
          width: size * 0.36,
          height: size * 0.36,
          borderRadius: "50%",
          background: "#0b1020",
          border: `1.5px solid ${color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
        }}
      >
        <Glyph size={size * 0.2} style={{ color }} />
      </div>
    </div>
  );
}

// ─── colour helpers (no deps) ────────────────────────────────────────────────
function clampByte(n: number) { return Math.max(0, Math.min(255, Math.round(n))); }
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((c) => clampByte(c).toString(16).padStart(2, "0")).join("");
}
export function lighten(hex: string, amt: number) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}
export function darken(hex: string, amt: number) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}
