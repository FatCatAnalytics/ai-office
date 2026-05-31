// Stage 6.12 — shared primitives for the FatCat visual modes.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { AgentEvent } from "../../types";
import {
  FATCAT_STATUS_META, type RosterSlot,
} from "../../lib/fatcatRoster";

/**
 * Given a container ref and the artwork's intrinsic aspect ratio, returns the
 * rectangle (in px, relative to the container) that an object-contain image of
 * that ratio actually occupies — i.e. the letterboxed image box. Hotspots are
 * positioned against THIS rect (not the raw container) so percentage seat
 * coordinates land exactly on the painted cats regardless of container shape.
 */
export function useContainRect(
  ref: React.RefObject<HTMLElement>,
  ratio: number,
): { left: number; top: number; width: number; height: number } {
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const containerRatio = cw / ch;
      let width: number, height: number;
      if (containerRatio > ratio) {
        // container wider than art → height-bound, pillarbox left/right
        height = ch;
        width = ch * ratio;
      } else {
        // container taller than art → width-bound, letterbox top/bottom
        width = cw;
        height = cw / ratio;
      }
      setRect({ left: (cw - width) / 2, top: (ch - height) / 2, width, height });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, ratio]);
  return rect;
}

/** Tracks the user's prefers-reduced-motion setting reactively. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return !!reduced;
}

/** One-time injected keyframes shared across both modes. */
export function FatCatStyles() {
  return (
    <style>{`
      @keyframes fcPulse { 0%,100% { transform: scale(1); opacity: .85 } 50% { transform: scale(1.06); opacity: 1 } }
      @keyframes fcDash  { to { stroke-dashoffset: -32 } }
      @keyframes fcFloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
      @keyframes fcScan  { 0% { opacity:.2 } 50% { opacity:.7 } 100% { opacity:.2 } }
      /* Working-highlight breathing glow for the cat/card that is actively
         doing the work. Subtle so it reads as "this one is live" without
         covering or boxing the approved artwork. */
      @keyframes fcWork { 0%,100% { opacity:.7 } 50% { opacity:1 } }
      @media (prefers-reduced-motion: reduce) {
        .fc-motion { animation: none !important; }
      }
      /* Hotspot buttons never draw a browser default focus outline over the art;
         the only focus affordance is the custom ring revealed below. */
      .fc-hot { outline: none; -webkit-tap-highlight-color: transparent; }
      .fc-hot::-moz-focus-inner { border: 0; }

      /* Hotspot reveal: ring + tooltip are invisible by default so the approved
         artwork stays clean. They fade in only on hover, keyboard focus, or when
         the seat is selected (.fc-hot-on). */
      .fc-hot .fc-hot-ring,
      .fc-hot .fc-hot-tip { opacity: 0; transition: opacity 160ms ease; }
      .fc-hot:hover .fc-hot-ring,
      .fc-hot:focus-visible .fc-hot-ring,
      .fc-hot.fc-hot-on .fc-hot-ring,
      .fc-hot:hover .fc-hot-tip,
      .fc-hot:focus-visible .fc-hot-tip,
      .fc-hot.fc-hot-on .fc-hot-tip { opacity: 1; }

      /* The tiny status dot is persistent ONLY for live/active seats (it carries
         the .fc-dot-active marker). Quiet seats (idle/waiting/complete) that do
         render a dot keep it hidden until the seat is hovered/focused/selected,
         so waiting cats never get a persistent highlight. */
      .fc-hot .fc-dot-quiet { opacity: 0; transition: opacity 160ms ease; }
      .fc-hot:hover .fc-dot-quiet,
      .fc-hot:focus-visible .fc-dot-quiet,
      .fc-hot.fc-hot-on .fc-dot-quiet { opacity: 1; }
    `}</style>
  );
}

/**
 * Working-highlight: a soft glow drawn on the painted element (a committee card
 * in Mission Control, a cat in the Iso office) when its slot is actively doing
 * the work. Shown for live states only (working / verifying / blocked) so idle
 * and settled cats keep the approved artwork completely clean. It is purely
 * decorative — the clickable Hotspot sits above it.
 */
export function WorkingHighlight({
  status, color, radius = 16, reduced,
}: {
  status: RosterSlot["status"];
  color: string;
  radius?: number;
  reduced: boolean;
}) {
  const statusColor = FATCAT_STATUS_META[status].color;
  const animated = status === "working" || status === "verifying";
  return (
    <span
      aria-hidden
      className={!reduced && animated ? "fc-motion" : undefined}
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: radius,
        border: `2px solid ${statusColor}`,
        background: `radial-gradient(ellipse at center, ${statusColor}33 0%, ${statusColor}00 72%)`,
        boxShadow: `0 0 30px ${statusColor}aa, 0 0 12px ${statusColor}cc, inset 0 0 26px ${statusColor}3a`,
        pointerEvents: "none",
        animation: !reduced && animated ? "fcWork 2.6s ease-in-out infinite" : undefined,
      }}
    />
  );
}

/**
 * Card-highlight: a soft glowing outline drawn over a PAINTED info card (the
 * labelled panel beside a cat in the Iso office, or the portrait card in Mission
 * Control). Used instead of ringing the cat itself. It is shown when:
 *   - `active`  → the card's agent is live (persistent breathing glow), or
 *   - `revealed` → the user is hovering / focusing / has selected that agent.
 * Quiet, non-active, non-revealed cards stay completely clean so the resting
 * artwork is untouched. Purely decorative (pointer-events: none).
 */
export function CardHighlight({
  rect, color, status, active, revealed, reduced, radius = 14,
}: {
  rect: { x: number; y: number; w: number; h: number };
  color: string;
  status: RosterSlot["status"];
  active: boolean;
  revealed: boolean;
  reduced: boolean;
  radius?: number;
}) {
  const on = active || revealed;
  const glow = active ? FATCAT_STATUS_META[status].color : color;
  const animated = active && (status === "working" || status === "verifying");
  return (
    <span
      aria-hidden
      className={!reduced && animated ? "fc-motion" : undefined}
      style={{
        position: "absolute",
        left: `${rect.x - rect.w / 2}%`,
        top: `${rect.y - rect.h / 2}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
        borderRadius: radius,
        border: `2px solid ${glow}`,
        background: `radial-gradient(ellipse at center, ${glow}26 0%, ${glow}00 75%)`,
        boxShadow: `0 0 26px ${glow}99, inset 0 0 22px ${glow}33`,
        pointerEvents: "none",
        opacity: on ? 1 : 0,
        transition: "opacity 180ms ease",
        animation: !reduced && animated && on ? "fcWork 2.6s ease-in-out infinite" : undefined,
        zIndex: 5,
      }}
    />
  );
}

export function StatusPill({ status, small }: { status: RosterSlot["status"]; small?: boolean }) {
  const meta = FATCAT_STATUS_META[status];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: small ? "1px 7px" : "2px 9px",
        borderRadius: 999,
        background: `${meta.color}1c`,
        border: `1px solid ${meta.color}55`,
        color: meta.color,
        fontSize: small ? 9 : 10,
        fontWeight: 700,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} />
      {meta.label}
    </span>
  );
}

/** Detail panel shown when an agent FatCat is selected. Shared by both modes. */
export function AgentDetailPanel({
  slot, events, onClose,
}: {
  slot: RosterSlot;
  events: AgentEvent[];
  onClose: () => void;
}) {
  const recent = slot.agent
    ? events.filter((e) => e.agentId === slot.agent!.id || e.agentName === slot.name).slice(0, 6)
    : [];

  return (
    <div
      role="dialog"
      aria-label={`${slot.name} details`}
      style={{
        background: "rgba(8,12,24,0.97)",
        border: `1px solid ${slot.color}55`,
        borderRadius: 14,
        boxShadow: `0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px ${slot.color}22`,
        padding: 14,
        width: 280,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 6,
            background: FATCAT_STATUS_META[slot.status].color,
            boxShadow: `0 0 8px ${FATCAT_STATUS_META[slot.status].color}aa`,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{slot.name}</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{slot.roleLabel}</div>
          <div style={{ marginTop: 4 }}><StatusPill status={slot.status} small /></div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <DetailRow label="Active task" value={slot.task ?? (slot.live ? "Awaiting assignment" : "—")} />
        <DetailRow label="Model" value={slot.modelId ?? (slot.live ? "default" : "—")} mono />
        <DetailRow label="Backed by" value={slot.live ? "Live agent" : "Derived role"} />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569", marginBottom: 4 }}>
          Recent activity
        </div>
        {recent.length === 0 ? (
          <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic" }}>
            {slot.live ? "No recent events." : "Derived from workflow state — no live events yet."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recent.map((e, i) => (
              <div key={e.id ?? i} style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.35 }}>
                <span style={{ color: slot.color, fontWeight: 600 }}>{e.action}</span>{" "}
                <span style={{ color: "#94a3b8" }}>{e.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569" }}>{label}</div>
      <div style={{ fontSize: 12, color: "#e2e8f0", fontFamily: mono ? "JetBrains Mono, monospace" : undefined, wordBreak: "break-word" }}>
        {value}
      </div>
    </div>
  );
}
