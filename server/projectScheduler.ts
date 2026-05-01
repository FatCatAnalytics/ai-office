// ─── Project template scheduler (Stage 5.1) ────────────────────────────────
// Single setInterval loop. Once a minute we scan project_templates for any
// row where enabled=1 AND nextRunAt <= now, then for each due template we
// spawn a fresh row in the projects table and hand it to the same
// runManagerOrchestration() entry point that powers manual /api/projects
// POSTs. After firing we recompute nextRunAt from the cron expression so
// the loop is self-healing — even if the server is offline at the cron
// moment, the very next tick after restart will catch up.
//
// Catch-up policy: we DO fire a single missed run after a long downtime
// (otherwise a Sunday outage would silently skip the weekly newsletter).
// We do NOT fire backlogged runs — if the server was down for a full
// month we don't want four newsletters spawning at once. The check is
// simple: nextRunAt <= now → fire ONCE, then advance.
//
// Concurrency: SQLite handles a single ms-resolution UPDATE atomically, so
// we use a transactional "claim" pattern — read+update nextRunAt before
// kicking the orchestrator. Two scheduler instances would never run from
// one DB but the claim pattern still makes the code easier to reason
// about under a manual `Run now` race.
// ─────────────────────────────────────────────────────────────────────────────

import { storage } from "./storage";
import { nextRun, validateCron } from "./cron";
import type { ProjectTemplate } from "@shared/schema";

// Resolved at boot so the scheduler can fire projects through the same code
// path as the manual POST /api/projects route. Stored as a setter so we
// avoid an import cycle between routes.ts ↔ projectScheduler.ts.
let kickoff: ((projectId: number) => void) | null = null;
export function setSchedulerKickoff(fn: (projectId: number) => void) {
  kickoff = fn;
}

let scheduled = false;
let logFn: (msg: string) => void = () => {};

const TICK_MS = 60_000; // one minute

/**
 * Compute and persist nextRunAt for a freshly-edited or freshly-fired
 * template. Anchored to `from` so that:
 *   • on edit (template create / cron change), we anchor to `now` and the
 *     UI sees the next future fire time immediately.
 *   • after a fire, we anchor to the moment we fired (lastRunAt) so a
 *     brief tick lag never causes us to compute the SAME slot twice.
 *
 * Returns the new nextRunAt epoch-ms, or null if the cron expression is
 * empty (kind=adhoc, ad-hoc-only template — no schedule).
 */
export function recomputeNextRun(template: ProjectTemplate, from: Date): number | null {
  if (!template.scheduleCron || !template.scheduleCron.trim()) return null;
  const valid = validateCron(template.scheduleCron);
  if (valid) {
    logFn(`[scheduler] template ${template.id} has invalid cron "${template.scheduleCron}": ${valid}`);
    return null;
  }
  const next = nextRun(template.scheduleCron, from);
  return next ? next.getTime() : null;
}

/**
 * Spawn a project from a template and kick off orchestration. Exposed so
 * the API "Run now" endpoint and the cron tick share the same logic.
 *
 * Returns the new project id (so the API route can 201-redirect to it).
 */
export function fireTemplate(templateId: number, opts: { reason: "scheduled" | "manual" }): number | null {
  const template = storage.getProjectTemplate(templateId);
  if (!template) {
    logFn(`[scheduler] fireTemplate: template ${templateId} not found`);
    return null;
  }
  if (!kickoff) {
    logFn(`[scheduler] fireTemplate: kickoff not registered yet — bootstrap order bug`);
    return null;
  }

  // Build a project name that's unique-ish per fire so the user can tell
  // weekly runs apart in the projects list. We use the London-local ISO
  // date because users think in their local time, not UTC.
  const stamp = new Date().toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).split("/").reverse().join("-"); // DD/MM/YYYY → YYYY-MM-DD

  const project = storage.createProject({
    name: `${template.name} — ${stamp}`,
    description: template.prompt,
    priority: "normal",
    status: "planning",
    progress: 0,
    deadline: null,
    outputFormats: JSON.stringify(["markdown"]),
    tasksTotal: 0,
    tasksCompleted: 0,
    tokensUsed: 0,
    costToday: 0,
    avgResponseTime: 0,
    templateId: template.id,
  });

  // Persist the fire on the template row immediately, BEFORE kicking off the
  // orchestrator. If the orchestrator throws we still don't want to re-fire
  // the same slot a minute later — the user can re-run manually if needed.
  const now = Date.now();
  const nextAt = recomputeNextRun(template, new Date(now));
  storage.updateProjectTemplate(template.id, {
    lastRunAt: now,
    nextRunAt: nextAt,
    lastProjectId: project.id,
    updatedAt: now,
  });

  logFn(
    `[scheduler] fired template ${template.id} "${template.name}" (${opts.reason}) ` +
    `→ project ${project.id}; next run: ${nextAt ? new Date(nextAt).toISOString() : "(none)"}`,
  );

  // Async — orchestrator runs forever via WebSocket events. We don't await.
  try {
    kickoff(project.id);
  } catch (err) {
    logFn(`[scheduler] kickoff threw for project ${project.id}: ${(err as Error).message}`);
  }

  return project.id;
}

async function tick() {
  const now = Date.now();
  let templates: ProjectTemplate[];
  try {
    templates = storage.getDueProjectTemplates(now);
  } catch (err) {
    logFn(`[scheduler] tick: getDueProjectTemplates threw: ${(err as Error).message}`);
    return;
  }
  if (templates.length === 0) return;

  for (const t of templates) {
    fireTemplate(t.id, { reason: "scheduled" });
  }
}

/**
 * Boot the scheduler. Idempotent — calling twice is a no-op so re-imports
 * during dev hot-reload don't double-tick. Pass a `log` callback for
 * console wiring (server/index.ts uses its own log()); messages are kept
 * one-line and prefixed with `[scheduler]` for grep-ability in journalctl.
 */
export function startProjectScheduler(log: (msg: string) => void = () => {}) {
  if (scheduled) return;
  scheduled = true;
  logFn = log;

  // Run an initial backfill: any template with nextRunAt = NULL but a valid
  // cron expression gets it computed from "now" so the UI never shows
  // "Next: never" after a fresh deploy. Templates with a cron whose validate
  // call fails are skipped — surfaced in logs only, not crashed on.
  try {
    const all = storage.getProjectTemplates();
    const fromNow = new Date();
    for (const t of all) {
      if (t.nextRunAt != null) continue;
      if (!t.scheduleCron || !t.scheduleCron.trim()) continue;
      const next = recomputeNextRun(t, fromNow);
      if (next == null) continue;
      storage.updateProjectTemplate(t.id, { nextRunAt: next, updatedAt: Date.now() });
      log(`[scheduler] backfilled nextRunAt for template ${t.id} → ${new Date(next).toISOString()}`);
    }
  } catch (err) {
    log(`[scheduler] boot backfill failed: ${(err as Error).message}`);
  }

  log(`[scheduler] starting (tick every ${TICK_MS / 1000}s)`);
  // Fire immediately on boot in case a template was due during downtime.
  // setImmediate keeps the boot sequence non-blocking.
  setImmediate(() => { void tick(); });
  setInterval(() => { void tick(); }, TICK_MS).unref();
}
