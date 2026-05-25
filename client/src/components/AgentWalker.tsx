/**
 * AgentWalker — full-body chibi-style SVG sprite for idle / wandering agents.
 *
 * Stage 6.7.2: replaces the seated PNG art for idle agents. The figure has a
 * clear head, torso, arms, and legs, and is driven by CSS keyframes so the
 * limbs swing while walking and sway gently while mingling. The shirt and
 * accessory colors come from the agent's role color so the same identity
 * cues (badge dot + name label) keep working at this scale.
 *
 * Two pose variants:
 *   - "walking"  → bob + arm/leg swing
 *   - "mingling" → subtle standing sway
 *
 * Active / seated agents do NOT use this component — they keep the existing
 * seated PNG art so the desk artwork still reads as "sitting at the desk".
 *
 * prefers-reduced-motion zeroes all keyframes via a global rule in
 * IsometricOffice.tsx.
 */
import { memo } from "react";

interface Props {
  /** Hex color string, e.g. "#3b82f6". Used for the shirt + hair accent. */
  color: string;
  /** "walking" → animated limbs; "mingling" → subtle sway. */
  state: "walking" | "mingling";
  /** Render width in px (the figure auto-scales to fit). */
  size: number;
  /** Sprite role hint — drives small accessory variations (glasses, hat, etc.). */
  spriteType?: string;
}

// Hair / skin palettes vary deterministically per spriteType so two agents of
// different teams don't look identical even when the shirt color is similar.
const HAIR_PALETTE: Record<string, string> = {
  manager:      "#1f2937",
  frontend:     "#7c2d12",
  backend:      "#0f172a",
  qa:           "#92400e",
  uiux:         "#4c1d95",
  devops:       "#1e3a8a",
  dbarchitect:  "#374151",
  datascientist:"#581c87",
  secengineer:  "#0c0a09",
  pm:           "#9a3412",
  harvester:    "#1e1b4b",
};

const SKIN_PALETTE: Record<string, string> = {
  manager:      "#f3d3b3",
  frontend:     "#e7c4a0",
  backend:      "#d8a87a",
  qa:           "#f0caa3",
  uiux:         "#eecaa0",
  devops:       "#cf9d70",
  dbarchitect:  "#e8c39a",
  datascientist:"#dfb287",
  secengineer:  "#b88357",
  pm:           "#f1c8a0",
  harvester:    "#e0b48a",
};

function shade(hex: string, amt: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const r = Math.max(0, Math.min(255, parseInt(m.slice(0, 2), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(m.slice(2, 4), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(m.slice(4, 6), 16) + amt));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Renders a 100x140 viewBox figure; the parent scales it. */
function AgentWalkerInner({ color, state, size, spriteType }: Props) {
  const shirt   = color;
  const shirtD  = shade(color, -28);
  const pants   = "#1f2937";
  const pantsD  = "#111827";
  const shoes   = "#0b1220";
  const skin    = SKIN_PALETTE[spriteType ?? "frontend"] ?? "#e7c4a0";
  const skinD   = shade(skin, -20);
  const hair    = HAIR_PALETTE[spriteType ?? "frontend"] ?? "#1f2937";

  // Small accessory per role (drawn over the figure).
  const hasGlasses = ["dbarchitect", "datascientist", "harvester", "secengineer"].includes(spriteType ?? "");
  const hasHeadset = spriteType === "manager" || spriteType === "pm";
  const hasBeanie  = spriteType === "devops";

  const walking = state === "walking";
  const animClass = walking ? "aw-walk" : "aw-mingle";

  return (
    <svg
      width={size}
      height={size * 1.4}
      viewBox="0 0 100 140"
      style={{ display: "block", overflow: "visible" }}
    >
      {/* Shadow under figure */}
      <ellipse cx="50" cy="132" rx="22" ry="4.5" fill="rgba(0,0,0,0.45)" />

      {/* Root group — bob lift while walking */}
      <g className={animClass}>
        {/* Legs — separate groups so they swing in opposite phases */}
        <g className={walking ? "aw-leg-l" : ""}>
          <rect x="40" y="92" width="9" height="28" rx="3" fill={pants} />
          <rect x="40" y="116" width="11" height="6" rx="2" fill={shoes} />
        </g>
        <g className={walking ? "aw-leg-r" : ""}>
          <rect x="51" y="92" width="9" height="28" rx="3" fill={pantsD} />
          <rect x="49" y="116" width="11" height="6" rx="2" fill={shoes} />
        </g>

        {/* Torso — shirt with collar + slight body shading */}
        <path
          d="M30 60 Q30 54 36 52 L64 52 Q70 54 70 60 L72 94 Q60 98 50 98 Q40 98 28 94 Z"
          fill={shirt}
        />
        {/* Shirt shading on the right side */}
        <path
          d="M58 52 L64 52 Q70 54 70 60 L72 94 Q66 96 58 97 Z"
          fill={shirtD}
          opacity="0.7"
        />
        {/* Collar / neckline */}
        <path d="M44 52 Q50 58 56 52 L56 56 Q50 62 44 56 Z" fill={shade(shirt, -45)} opacity="0.85" />
        {/* Belt */}
        <rect x="30" y="92" width="40" height="4" fill="#0b1220" opacity="0.8" />

        {/* Arms — swing in opposite phase to legs */}
        <g className={walking ? "aw-arm-l" : ""}>
          <rect x="22" y="60" width="9" height="30" rx="4" fill={shirt} />
          {/* Hand */}
          <circle cx="26.5" cy="92" r="4.5" fill={skin} />
        </g>
        <g className={walking ? "aw-arm-r" : ""}>
          <rect x="69" y="60" width="9" height="30" rx="4" fill={shirtD} />
          <circle cx="73.5" cy="92" r="4.5" fill={skin} />
        </g>

        {/* Neck */}
        <rect x="44" y="44" width="12" height="10" rx="3" fill={skinD} />

        {/* Head */}
        <ellipse cx="50" cy="32" rx="15" ry="16" fill={skin} />
        {/* Hair */}
        <path
          d="M35 30 Q34 17 50 14 Q66 17 65 30 Q63 22 50 22 Q37 22 35 30 Z"
          fill={hair}
        />
        {/* Side hair tuft */}
        <path d="M34 28 Q33 36 38 38 L38 30 Z" fill={hair} opacity="0.9" />
        {/* Eyes */}
        <ellipse cx="44" cy="33" rx="1.6" ry="2.2" fill="#0b1220" />
        <ellipse cx="56" cy="33" rx="1.6" ry="2.2" fill="#0b1220" />
        {/* Eye highlights */}
        <circle cx="44.5" cy="32.4" r="0.5" fill="#ffffff" />
        <circle cx="56.5" cy="32.4" r="0.5" fill="#ffffff" />
        {/* Mouth */}
        <path d="M46 39 Q50 42 54 39" stroke="#5b1d1d" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        {/* Cheek blush */}
        <circle cx="40" cy="37" r="2" fill="#f59ca0" opacity="0.35" />
        <circle cx="60" cy="37" r="2" fill="#f59ca0" opacity="0.35" />

        {/* Role-color band on chest (small visual identity cue) */}
        <rect x="46" y="62" width="8" height="22" rx="2" fill={shade(color, 35)} opacity="0.8" />

        {/* Accessory: glasses */}
        {hasGlasses && (
          <g stroke="#0b1220" strokeWidth="1.2" fill="none">
            <circle cx="44" cy="33" r="3.4" />
            <circle cx="56" cy="33" r="3.4" />
            <line x1="47.4" y1="33" x2="52.6" y2="33" />
          </g>
        )}

        {/* Accessory: headset */}
        {hasHeadset && (
          <g>
            <path d="M35 22 Q50 8 65 22" stroke="#1f2937" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <rect x="32" y="22" width="5" height="8" rx="2" fill="#1f2937" />
            <rect x="63" y="22" width="5" height="8" rx="2" fill="#1f2937" />
            {/* Mic */}
            <path d="M37 28 Q42 36 44 38" stroke="#1f2937" strokeWidth="1.4" fill="none" />
            <circle cx="44" cy="38" r="1.4" fill={color} />
          </g>
        )}

        {/* Accessory: beanie */}
        {hasBeanie && (
          <>
            <path d="M34 22 Q34 12 50 11 Q66 12 66 22 L66 27 L34 27 Z" fill={color} />
            <rect x="34" y="25" width="32" height="3" fill={shade(color, -30)} />
            <circle cx="50" cy="10" r="2.6" fill={shade(color, 40)} />
          </>
        )}
      </g>
    </svg>
  );
}

export const AgentWalker = memo(AgentWalkerInner);
export default AgentWalker;
