// Stage 6.12 — deterministic FatCat roster mapper.
//
// Both new visual modes (Isometric Office, Mission Control) render the *same*
// roster of FatCat agents. The roster shown is driven by the active project /
// template / workflow so the office reflects the work actually in flight:
//
//   • The Analytical Banker  → research / editor / writer / QA / fact-check / publishing
//   • SME Analytics          → same editorial shape, SME-flavoured labels
//   • Startup Due Diligence  → diligence / source-verify / financial model / risk / market / memo / CIO
//   • Public Company Thesis  → thesis / valuation / contrarian / source-verify / risk / memo / CIO
//   • generic / unknown      → manager / research / writer / analyst / QA / engineer
//
// The mapper is pure: given a context + the live agents, it returns an ordered
// list of roster slots. Live agents are matched onto the archetype slots when a
// reasonable match exists; otherwise an archetype slot renders as a derived
// (fallback) FatCat so the office never looks empty. This keeps the visual
// modes useful even before any real agent has been provisioned for a workflow.

import type { Agent, Project } from "../types";

export type FatCatStatus = "idle" | "working" | "verifying" | "blocked" | "complete";

export type WorkflowKind =
  | "analytical-banker"
  | "sme-analytics"
  | "startup-due-diligence"
  | "public-company-thesis"
  | "generic";

// Visual archetypes — drive the FatCat avatar look + accent colour. These are
// independent of the existing sprite types so the new modes don't depend on the
// PNG sprite assets.
export type FatCatArchetype =
  | "manager"
  | "research"
  | "editor"
  | "writer"
  | "analyst"
  | "qa"
  | "factcheck"
  | "publish"
  | "diligence"
  | "sourceverify"
  | "financial"
  | "risk"
  | "market"
  | "memo"
  | "cio"
  | "valuation"
  | "contrarian"
  | "engineer";

export interface RosterSlot {
  /** Stable key for React + selection. Derived from the matched agent id when
   *  present, otherwise from the archetype so fallback slots stay stable. */
  key: string;
  archetype: FatCatArchetype;
  /** Human label for the role in this workflow (e.g. "Source Verification"). */
  roleLabel: string;
  /** Display name — the live agent's name, or a friendly archetype name. */
  name: string;
  status: FatCatStatus;
  /** The live task title if known. */
  task: string | null;
  /** Model id when a live agent backs this slot. */
  modelId: string | null;
  /** Accent colour for glows / connection lines / status dots. */
  color: string;
  /** True when a real provisioned agent backs this slot (vs a derived role). */
  live: boolean;
  /** The backing live agent, when present — used by detail panels. */
  agent: Agent | null;
}

export interface RosterContext {
  project: Project | null;
  agents: Agent[];
  /** Optional explicit template name (e.g. from a selected template card). */
  templateName?: string | null;
}

// ─── Archetype presentation ────────────────────────────────────────────────
const ARCHETYPE_COLOR: Record<FatCatArchetype, string> = {
  manager:      "#a855f7",
  research:     "#06b6d4",
  editor:       "#8b5cf6",
  writer:       "#3b82f6",
  analyst:      "#0ea5e9",
  qa:           "#f59e0b",
  factcheck:    "#eab308",
  publish:      "#10b981",
  diligence:    "#06b6d4",
  sourceverify: "#22c55e",
  financial:    "#3b82f6",
  risk:         "#ef4444",
  market:       "#ec4899",
  memo:         "#8b5cf6",
  cio:          "#f97316",
  valuation:    "#3b82f6",
  contrarian:   "#f43f5e",
  engineer:     "#14b8a6",
};

// Cat-pun display names. Painted seats locked to MissionControlMode.tsx;
// secondary archetypes share a personality with the primary that owns the sprite
// (e.g. analyst → Data Purrson, factcheck → Agent Clawrence, valuation → Sir Tabby Calcuclaw).
const ARCHETYPE_FALLBACK_NAME: Record<FatCatArchetype, string> = {
  manager:      "Boss Tabbington",
  research:     "Prof. Whiskerton",
  editor:       "SecureCat",
  writer:       "Data Purrson",
  analyst:      "Data Purrson",
  qa:           "Agent Clawrence",
  factcheck:    "Agent Clawrence",
  publish:      "Mktg. Meowdison",
  diligence:    "Prof. Whiskerton",
  sourceverify: "SecureCat",
  financial:    "Sir Tabby Calcuclaw",
  risk:         "Counsel Pawsley",
  market:       "Mktg. Meowdison",
  memo:         "Data Purrson",
  cio:          "CIO Whiskerstone",
  valuation:    "Sir Tabby Calcuclaw",
  contrarian:   "Counsel Pawsley",
  engineer:     "Mktg. Meowdison",
};

// Maps each archetype to the sprite file slug (under attached_assets/fatcat/sprites/).
// Secondary archetypes reuse the primary's sprite — same personality, different role label.
export const ARCHETYPE_SPRITE_SLUG: Record<FatCatArchetype, string> = {
  manager:      "manager",
  research:     "research",
  editor:       "editor",
  writer:       "writer",
  analyst:      "writer",
  qa:           "qa",
  factcheck:    "qa",
  publish:      "market",
  diligence:    "research",
  sourceverify: "editor",
  financial:    "financial",
  risk:         "risk",
  market:       "market",
  memo:         "writer",
  cio:          "cio",
  valuation:    "financial",
  contrarian:   "risk",
  engineer:     "market",
};

export function archetypeSpriteUrl(a: FatCatArchetype): string {
  return `/attached_assets/fatcat/sprites/${ARCHETYPE_SPRITE_SLUG[a]}.png`;
}

export function archetypeColor(a: FatCatArchetype): string {
  return ARCHETYPE_COLOR[a] ?? "#64748b";
}

// ─── Role plans per workflow ─────────────────────────────────────────────────
// Each plan is an ordered list of { archetype, roleLabel }. Manager is always
// first so it can be rendered centrally in both modes.
interface PlanRole { archetype: FatCatArchetype; roleLabel: string }

const PLANS: Record<WorkflowKind, PlanRole[]> = {
  "analytical-banker": [
    { archetype: "manager",   roleLabel: "Editorial Lead" },
    { archetype: "research",  roleLabel: "Research" },
    { archetype: "editor",    roleLabel: "Angle / Editor" },
    { archetype: "writer",    roleLabel: "Writer" },
    { archetype: "qa",        roleLabel: "QA Reviewer" },
    { archetype: "factcheck", roleLabel: "Fact-Check" },
    { archetype: "publish",   roleLabel: "Publishing" },
  ],
  "sme-analytics": [
    { archetype: "manager",   roleLabel: "Editorial Lead" },
    { archetype: "research",  roleLabel: "SME Research" },
    { archetype: "editor",    roleLabel: "Angle / Editor" },
    { archetype: "writer",    roleLabel: "Newsletter Writer" },
    { archetype: "qa",        roleLabel: "QA Reviewer" },
    { archetype: "factcheck", roleLabel: "Fact-Check" },
    { archetype: "publish",   roleLabel: "Publishing" },
  ],
  "startup-due-diligence": [
    { archetype: "manager",      roleLabel: "Diligence Lead" },
    { archetype: "diligence",    roleLabel: "Due Diligence" },
    { archetype: "sourceverify", roleLabel: "Source Verification" },
    { archetype: "financial",    roleLabel: "Financial Model" },
    { archetype: "risk",         roleLabel: "Risk Assessment" },
    { archetype: "market",       roleLabel: "Market Signal" },
    { archetype: "memo",         roleLabel: "Investment Memo" },
    { archetype: "cio",          roleLabel: "CIO Sign-off" },
  ],
  "public-company-thesis": [
    { archetype: "manager",      roleLabel: "Thesis Lead" },
    { archetype: "research",     roleLabel: "Thesis Research" },
    { archetype: "valuation",    roleLabel: "Valuation" },
    { archetype: "contrarian",   roleLabel: "Contrarian Review" },
    { archetype: "sourceverify", roleLabel: "Source Verification" },
    { archetype: "risk",         roleLabel: "Risk Assessment" },
    { archetype: "memo",         roleLabel: "Investment Memo" },
    { archetype: "cio",          roleLabel: "CIO Sign-off" },
  ],
  "generic": [
    { archetype: "manager",  roleLabel: "Manager" },
    { archetype: "research", roleLabel: "Research" },
    { archetype: "writer",   roleLabel: "Writer" },
    { archetype: "analyst",  roleLabel: "Analyst" },
    { archetype: "qa",       roleLabel: "QA" },
    { archetype: "engineer", roleLabel: "Engineer" },
  ],
};

// ─── Workflow classification ─────────────────────────────────────────────────
// Loosely match on the project name / description / template name. We mirror the
// loose matching the server uses for the editorial pipeline so the office and
// the orchestrator agree on what kind of work is in flight.

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

export function classifyWorkflow(ctx: { name?: string | null; description?: string | null; templateName?: string | null }): WorkflowKind {
  const hay = [norm(ctx.templateName), norm(ctx.name), norm(ctx.description)].join("  ");

  // SME Analytics — check before the generic "analytical banker" so an
  // "SME Analytics" name doesn't get swallowed by a looser banker match.
  if (/\bsme\b/.test(hay) && /(analytic|analysis|newsletter|weekly|report)/.test(hay)) {
    return "sme-analytics";
  }
  if (/analytical\s*banker/.test(hay) || /the\s+banker/.test(hay)) {
    return "analytical-banker";
  }
  if (/(startup|seed|series\s*[a-d]|venture|vc)\b/.test(hay) && /(due\s*diligence|diligence|dd\b)/.test(hay)) {
    return "startup-due-diligence";
  }
  if (/due\s*diligence/.test(hay) && /(startup|company|target|invest)/.test(hay)) {
    return "startup-due-diligence";
  }
  if (/(public\s*company|listed|ticker|equity)/.test(hay) && /(thesis|review|valuation)/.test(hay)) {
    return "public-company-thesis";
  }
  if (/thesis\s*review/.test(hay)) {
    return "public-company-thesis";
  }
  return "generic";
}

// ─── Agent → archetype matching ───────────────────────────────────────────────
// Map a live agent (by role / name / spriteType) onto a plan archetype so its
// real status + task flow onto the right slot. Returns null when no confident
// match exists.

function agentArchetype(agent: Agent): FatCatArchetype | null {
  const hay = `${norm(agent.role)} ${norm(agent.name)} ${norm(agent.spriteType)} ${norm(agent.id)}`;

  if (/manager|lead|orchestrat|cio|chief/.test(hay)) {
    if (/cio|chief\s*invest/.test(hay)) return "cio";
    return "manager";
  }
  if (/fact[\s-]?check/.test(hay)) return "factcheck";
  if (/source|verif|provenance/.test(hay)) return "sourceverify";
  if (/contrarian|bear|devil/.test(hay)) return "contrarian";
  if (/valuation|dcf|multiple/.test(hay)) return "valuation";
  if (/financ|model|projection/.test(hay)) return "financial";
  if (/risk|compliance|legal/.test(hay)) return "risk";
  if (/market|signal|sentiment/.test(hay)) return "market";
  if (/memo|thesis|report\s*writer/.test(hay)) return "memo";
  if (/diligenc/.test(hay)) return "diligence";
  if (/research|harvest|search|analyst|data\s*scientist/.test(hay)) {
    if (/analyst/.test(hay)) return "analyst";
    return "research";
  }
  if (/editor|angle/.test(hay)) return "editor";
  if (/writ|author|copy/.test(hay)) return "writer";
  if (/qa|review|test|quality/.test(hay)) return "qa";
  if (/publish|deploy|release|devops/.test(hay)) return "publish";
  if (/engineer|backend|frontend|dev\b/.test(hay)) return "engineer";
  return null;
}

// ─── Status derivation ─────────────────────────────────────────────────────────
// Map the live Agent status onto a FatCatStatus. When no live agent backs a slot
// we derive a sensible fallback from the project so the office still encodes
// workflow state instead of going flat.

export function mapAgentStatus(s: Agent["status"]): FatCatStatus {
  switch (s) {
    case "working":  return "working";
    case "thinking": return "verifying";
    case "blocked":  return "blocked";
    case "done":     return "complete";
    default:         return "idle";
  }
}

function derivedSlotStatus(role: PlanRole, project: Project | null, indexInPlan: number, planLength: number): FatCatStatus {
  if (!project) return "idle";
  const status = norm(project.status);
  if (status === "completed") return "complete";
  if (status === "blocked")   return "blocked";
  // For planning/active projects, light up a leading prefix of the pipeline
  // proportional to progress so the visual reads as "work flowing through".
  const progress = typeof project.progress === "number" ? project.progress : 0;
  const reached = Math.round((progress / 100) * planLength);
  if (indexInPlan < reached) return "complete";
  if (indexInPlan === reached) {
    // The "frontier" role is the one currently doing the work.
    return role.archetype === "qa" || role.archetype === "factcheck" || role.archetype === "sourceverify"
      ? "verifying"
      : "working";
  }
  return "idle";
}

// ─── Public API ────────────────────────────────────────────────────────────────
export function buildRoster(ctx: RosterContext): RosterSlot[] {
  const workflow = classifyWorkflow({
    name: ctx.project?.name,
    description: ctx.project?.description,
    templateName: ctx.templateName,
  });
  const plan = PLANS[workflow];

  // Index live agents by archetype. Deterministic: sort by id so repeated
  // archetypes (e.g. two researchers) claim slots in a stable order.
  const byArchetype = new Map<FatCatArchetype, Agent[]>();
  const ordered = [...ctx.agents].sort((a, b) => a.id.localeCompare(b.id));
  for (const agent of ordered) {
    const arch = agentArchetype(agent);
    if (!arch) continue;
    const list = byArchetype.get(arch) ?? [];
    list.push(agent);
    byArchetype.set(arch, list);
  }

  const claimed = new Set<string>();
  const slots: RosterSlot[] = plan.map((role, i) => {
    const candidates = byArchetype.get(role.archetype) ?? [];
    const match = candidates.find((a) => !claimed.has(a.id)) ?? null;
    if (match) claimed.add(match.id);

    const color = archetypeColor(role.archetype);
    if (match) {
      return {
        key: `agent:${match.id}`,
        archetype: role.archetype,
        roleLabel: role.roleLabel,
        name: match.name,
        status: mapAgentStatus(match.status),
        task: match.currentTask ?? null,
        modelId: match.modelId || null,
        color: match.color || color,
        live: true,
        agent: match,
      };
    }
    return {
      key: `role:${role.archetype}:${i}`,
      archetype: role.archetype,
      roleLabel: role.roleLabel,
      name: ARCHETYPE_FALLBACK_NAME[role.archetype],
      status: derivedSlotStatus(role, ctx.project, i, plan.length),
      task: null,
      modelId: null,
      color,
      live: false,
      agent: null,
    };
  });

  return slots;
}

export function workflowLabel(kind: WorkflowKind): string {
  switch (kind) {
    case "analytical-banker":     return "The Analytical Banker";
    case "sme-analytics":         return "SME Analytics Weekly";
    case "startup-due-diligence": return "Startup Due Diligence";
    case "public-company-thesis": return "Public Company Thesis Review";
    default:                      return "General Project";
  }
}

export const FATCAT_STATUS_META: Record<FatCatStatus, { label: string; color: string }> = {
  idle:      { label: "Idle",      color: "#475569" },
  working:   { label: "Working",   color: "#10b981" },
  verifying: { label: "Verifying", color: "#f59e0b" },
  blocked:   { label: "Blocked",   color: "#ef4444" },
  complete:  { label: "Complete",  color: "#06b6d4" },
};

// Which statuses earn a persistent (quiet) overlay marker over the artwork.
// Idle / waiting / pending cats stay completely unmarked so the approved art is
// left clean; "complete" is also quiet by default (it's a settled, not live,
// state) and only surfaces when the seat is hovered/focused/selected. Only the
// genuinely live states get the tiny status dot.
export function isActiveStatus(status: FatCatStatus): boolean {
  return status === "working" || status === "verifying" || status === "blocked";
}
