/**
 * useAgentMovement — Sims-like wandering for office agents.
 *
 * Stage 6.7: agents with status "idle" wander between waypoints in their
 * affinity zone (or a shared common area). Agents with status "working" or
 * "thinking" snap back to their assigned desk so the existing comm-arc and
 * desk-allocation logic continues to work unchanged.
 *
 * Returns a Map<agentId, AgentPose> that is updated via rAF. The pose is
 * read by the IsometricOffice sprite layer.
 *
 * Respects prefers-reduced-motion: when enabled, every agent is parked at
 * its desk position with no animation.
 */
import { useEffect, useRef, useState } from "react";
import type { Agent } from "../types";
import type { DeskAssignmentMap } from "../components/IsometricOffice";
import { WANDER_ZONES, WAYPOINT_TABLE, type Waypoint } from "../lib/officeWaypoints";

export type MovementState = "sit" | "walking" | "mingling";

export interface AgentPose {
  x: number;
  y: number;
  state: MovementState;
  facing: 1 | -1;     // 1 = facing right, -1 = facing left
}

export type AgentPoseMap = Map<string, AgentPose>;

// Pixel-per-second wander speed (slow Sims-like saunter).
const WALK_SPEED = 36;
// Min/max seconds an agent will linger at a mingle waypoint.
const MINGLE_MIN_MS = 2500;
const MINGLE_MAX_MS = 6500;
// Min/max seconds an agent will pause between idle moves to a new waypoint.
const IDLE_PAUSE_MIN_MS = 1500;
const IDLE_PAUSE_MAX_MS = 4500;

interface AgentRuntime {
  pose: AgentPose;
  target: Waypoint | null;
  // ms timestamp when the current mingling/pause expires
  pauseUntil: number;
  // Last status seen, to detect transitions
  lastStatus: string;
  // The desk anchor we were last assigned (for snap-back)
  deskX: number;
  deskY: number;
}

// Pick a wander zone for an agent. Manager wanders the whole floor;
// others stick to their affinity zone with occasional mingle excursions.
function pickWanderZone(agent: Agent, mingleChance = 0.25): string {
  // Manager and PMs roam common areas often.
  if (agent.spriteType === "manager" || agent.spriteType === "pm") {
    return Math.random() < 0.6 ? "common" : (WANDER_ZONES[agent.spriteType] ?? "common");
  }
  // Everyone else: stay home most of the time, occasionally mingle.
  const home = WANDER_ZONES[agent.spriteType] ?? "common";
  return Math.random() < mingleChance ? "common" : home;
}

function pickWaypoint(zoneKey: string): Waypoint | null {
  const waypoints = WAYPOINT_TABLE[zoneKey];
  if (!waypoints || waypoints.length === 0) return null;
  return waypoints[Math.floor(Math.random() * waypoints.length)];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener(handler);
    };
  }, []);
  return reduced;
}

export function useAgentMovement(
  agents: Agent[],
  deskMap: DeskAssignmentMap,
): AgentPoseMap {
  const reducedMotion = usePrefersReducedMotion();
  // The runtime state lives in a ref to avoid re-renders on every frame.
  const runtimeRef = useRef<Map<string, AgentRuntime>>(new Map());
  // The state we hand back to React — updated at most ~20fps for re-render.
  const [poses, setPoses] = useState<AgentPoseMap>(() => new Map());

  // Re-seed runtime whenever the agent roster or desk assignments change.
  useEffect(() => {
    const next = runtimeRef.current;
    const seen = new Set<string>();
    for (const agent of agents) {
      const desk = deskMap.get(agent.id);
      if (!desk) continue;
      const [dx, dy] = desk;
      seen.add(agent.id);
      const existing = next.get(agent.id);
      if (existing) {
        existing.deskX = dx;
        existing.deskY = dy;
      } else {
        next.set(agent.id, {
          pose: { x: dx, y: dy, state: "sit", facing: 1 },
          target: null,
          pauseUntil: 0,
          lastStatus: agent.status,
          deskX: dx,
          deskY: dy,
        });
      }
    }
    // Drop runtime entries for agents that have been removed.
    for (const id of next.keys()) {
      if (!seen.has(id)) next.delete(id);
    }
  }, [agents, deskMap]);

  // Animation loop. Skipped entirely when reduced-motion is active —
  // agents simply render at their desks.
  useEffect(() => {
    if (reducedMotion) {
      // Force every pose to desk position.
      const snap: AgentPoseMap = new Map();
      for (const agent of agents) {
        const desk = deskMap.get(agent.id);
        if (!desk) continue;
        snap.set(agent.id, { x: desk[0], y: desk[1], state: "sit", facing: 1 });
      }
      setPoses(snap);
      return;
    }

    let raf = 0;
    let lastTs = performance.now();
    let lastEmit = 0;

    const tick = (ts: number) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000); // clamp to 50ms steps
      lastTs = ts;
      const runtime = runtimeRef.current;
      let dirty = false;

      for (const agent of agents) {
        const r = runtime.get(agent.id);
        if (!r) continue;

        const statusChanged = r.lastStatus !== agent.status;
        r.lastStatus = agent.status;

        const shouldSit =
          agent.status === "working" ||
          agent.status === "thinking" ||
          agent.status === "blocked" ||
          agent.status === "done";

        if (shouldSit) {
          // Walk back to desk if we drifted away, otherwise sit.
          const dx = r.deskX - r.pose.x;
          const dy = r.deskY - r.pose.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 1.5) {
            if (r.pose.state !== "sit") {
              r.pose.state = "sit";
              r.pose.x = r.deskX;
              r.pose.y = r.deskY;
              dirty = true;
            }
          } else {
            const step = WALK_SPEED * dt;
            const k = Math.min(1, step / dist);
            r.pose.x += dx * k;
            r.pose.y += dy * k;
            r.pose.state = "walking";
            r.pose.facing = dx >= 0 ? 1 : -1;
            r.target = null;
            dirty = true;
          }
          continue;
        }

        // Idle / mingling agent.
        if (statusChanged) {
          // Just transitioned to idle — start a short pause then wander.
          r.pauseUntil = ts + randomBetween(IDLE_PAUSE_MIN_MS, IDLE_PAUSE_MAX_MS);
          r.target = null;
          r.pose.state = "mingling";
          dirty = true;
        }

        if (!r.target) {
          if (ts < r.pauseUntil) {
            // Still mingling — nothing to do this frame.
            continue;
          }
          // Pick a new waypoint.
          const zoneKey = pickWanderZone(agent);
          const wp = pickWaypoint(zoneKey);
          if (!wp) continue;
          r.target = wp;
          r.pose.state = "walking";
        }

        const dx = r.target.x - r.pose.x;
        const dy = r.target.y - r.pose.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
          // Arrived. Mingle for a bit then pick a new waypoint.
          r.pose.x = r.target.x;
          r.pose.y = r.target.y;
          r.pose.state = "mingling";
          r.target = null;
          r.pauseUntil = ts + randomBetween(MINGLE_MIN_MS, MINGLE_MAX_MS);
          dirty = true;
          continue;
        }
        const step = WALK_SPEED * dt;
        const k = Math.min(1, step / dist);
        r.pose.x += dx * k;
        r.pose.y += dy * k;
        r.pose.facing = dx >= 0 ? 1 : -1;
        r.pose.state = "walking";
        dirty = true;
      }

      // Push to React at most ~20fps to avoid render churn.
      if (dirty && ts - lastEmit > 50) {
        lastEmit = ts;
        const snap: AgentPoseMap = new Map();
        for (const [id, r] of runtime) snap.set(id, { ...r.pose });
        setPoses(snap);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [agents, deskMap, reducedMotion]);

  return poses;
}
