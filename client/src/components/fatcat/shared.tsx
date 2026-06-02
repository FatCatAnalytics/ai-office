// Stage 6.12 — shared primitives for the FatCat visual modes.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { AgentEvent } from "../../types";
import {
  FATCAT_STATUS_META, isActiveStatus, type FatCatArchetype, type FatCatStatus, type RosterSlot,
} from "../../lib/fatcatRoster";
import { fatcatSprite } from "../../lib/fatcatSprites";

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
      @keyframes fcFloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
      /* Pulsing status dot for a card whose agent is actively working. Subtle —
         it draws the eye to the live worker without boxing the approved art. */
      @keyframes fcDot { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.55); opacity: .55 } }
      /* Crossfade a freshly-swapped sprite in so a status change reads as a calm
         dissolve rather than a hard cut. No movement/scale — just opacity. */
      @keyframes fcSpriteIn { from { opacity: 0 } to { opacity: 1 } }
      @media (prefers-reduced-motion: reduce) {
        .fc-motion { animation: none !important; }
        .fc-sprite { animation: none !important; }
      }
      /* Hotspot buttons stay invisible: no border, no box, no browser focus
         outline drawn over the artwork. They are pure click/hit targets. */
      .fc-hot { outline: none; -webkit-tap-highlight-color: transparent; }
      .fc-hot::-moz-focus-inner { border: 0; }
    `}</style>
  );
}

/**
 * Live status badge anchored over a painted card position. This is the ONLY
 * thing layered on the approved artwork: a tiny pill carrying a status dot +
 * label that is data-bound to the slot's live agent status. There is NO box,
 * outline, frame, or hover/selection rectangle drawn over the art — the badge
 * is the entire visual chrome.
 *
 * Resting (idle / complete) cards stay calm: a dim, static dot and a quiet
 * label. Genuinely live cards (working / verifying / blocked) get a coloured,
 * gently pulsing dot so the eye is drawn to whoever is actually doing work.
 * Purely informational; the clickable Hotspot sits above it.
 */
export function StatusBadge({
  rect, status, reduced, anchor = "bottom",
}: {
  rect: { x: number; y: number; w: number; h: number };
  status: RosterSlot["status"];
  reduced: boolean;
  /** Where the badge sits relative to the card rect. */
  anchor?: "top" | "bottom";
}) {
  const meta = FATCAT_STATUS_META[status];
  const active = isActiveStatus(status);
  // Working/verifying read as in-flight ("Processing…"); blocked is live but not
  // animated; idle/complete are settled and calm.
  const animated = !reduced && (status === "working" || status === "verifying");
  // The badge is centred horizontally on the card and tucked just outside its
  // top or bottom edge so it never covers the painted face/nameplate.
  const top = anchor === "bottom" ? rect.y + rect.h / 2 + 1 : rect.y - rect.h / 2 - 1;
  return (
    <span
      data-fc-status={status}
      style={{
        position: "absolute",
        left: `${rect.x}%`,
        top: `${top}%`,
        transform: anchor === "bottom" ? "translate(-50%,0)" : "translate(-50%,-100%)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(5,8,15,0.78)",
        border: `1px solid ${meta.color}${active ? "88" : "44"}`,
        color: meta.color,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        backdropFilter: "blur(3px)",
        boxShadow: active ? `0 0 10px ${meta.color}55` : "none",
        zIndex: 6,
      }}
    >
      <span
        aria-hidden
        className={animated ? "fc-motion" : undefined}
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          background: meta.color,
          opacity: active ? 1 : 0.65,
          animation: animated ? "fcDot 1.4s ease-in-out infinite" : undefined,
        }}
      />
      {statusBadgeLabel(status)}
    </span>
  );
}

/** Human label for the live badge — in-flight states read as a "…" progress. */
export function statusBadgeLabel(status: RosterSlot["status"]): string {
  switch (status) {
    case "working":   return "Processing…";
    case "verifying": return "Reviewing…";
    case "blocked":   return "Blocked";
    case "complete":  return "Complete";
    default:          return "Idle";
  }
}

/**
 * A subtle soft contact shadow under a cat's feet so the sprite reads as planted
 * on the stage rather than floating. Purely decorative: a low, blurred dark
 * radial ellipse centred on the sprite's foot line (seat.y + seat.h/2) and
 * scaled to the sprite width. Sits BEHIND the sprite (lower z-index) and never
 * draws a box/frame. Honours prefers-reduced-motion implicitly (it's static).
 */
export function GroundShadow({ rect }: { rect: { x: number; y: number; w: number; h: number } }) {
  const footY = rect.y + rect.h / 2;
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: `${rect.x}%`,
        top: `${footY}%`,
        width: `${rect.w * 0.85}%`,
        height: `${rect.w * 0.22}%`,
        transform: "translate(-50%,-65%)",
        borderRadius: "50%",
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.22) 45%, rgba(0,0,0,0) 72%)",
        pointerEvents: "none",
        zIndex: 3,
      }}
    />
  );
}

/**
 * The per-agent CAT figure. Renders the transparent, per-archetype × per-status
 * sprite (resolved via {@link fatcatSprite}) positioned over its seat in the
 * scene. The sprite swaps automatically when the slot's status changes; we key
 * the <img> on its resolved URL so React remounts it and the crossfade replays,
 * giving a calm opacity dissolve on swap (no bounce/flash, respects
 * prefers-reduced-motion). Purely visual — the clickable Hotspot sits above it.
 */
export function FatCatSprite({
  archetype, status, rect, reduced, alt,
}: {
  archetype: FatCatArchetype;
  status: FatCatStatus;
  rect: { x: number; y: number; w: number; h: number };
  reduced: boolean;
  alt: string;
}) {
  const url = fatcatSprite(archetype, status);
  if (!url) return null;
  const active = isActiveStatus(status);
  return (
    <img
      key={url}
      src={url}
      alt={alt}
      draggable={false}
      className={reduced ? undefined : "fc-sprite"}
      style={{
        position: "absolute",
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
        transform: "translate(-50%,-50%)",
        objectFit: "contain",
        background: "transparent",
        pointerEvents: "none",
        userSelect: "none",
        // Live cats sit fully opaque; settled (idle/complete) cats are a touch
        // softer so the active worker reads as the focal point — but every cat
        // stays clearly visible. No box/frame is ever drawn.
        opacity: active ? 1 : 0.92,
        transition: "opacity 220ms ease",
        animation: reduced ? undefined : "fcSpriteIn 260ms ease",
        zIndex: 4,
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
