// Stage 6.9 — fail-closed research sufficiency gate.
//
// The weekly Analytical Banker run on 2026-05-24 produced issue-22.md and
// runner-up-22.md even though every Tavily deep-search call had been rate-
// limited (HTTP 433) and the research task returned zero candidates. The
// editorial-lead pivoted to a meta-essay about its own pipeline failure
// ("data didn't arrive, so this week is a methodology piece") and the
// orchestrator persisted it as a publishable issue. The same shape failed
// on the SME Analytics weekly run.
//
// Two safeguards live in this module:
//   1. RESEARCH SUFFICIENCY GATE — after upstream research tasks finish,
//      we count usable candidate stories / sourced evidence in their output.
//      For briefs flagged as requiring recent/news/current research, "zero
//      sources" or "all tool calls failed" blocks the downstream
//      angle/draft/final tasks before any publishable file is emitted.
//   2. FINAL OUTPUT GUARD — the file blocks the editorial-lead emits get
//      sanity-checked: must contain at least one usable markdown link, must
//      not be a meta-essay about the API failure, must not contain the
//      tell-tale "rate-limited" / "Tavily quota" / "data didn't arrive"
//      phrases that show the model fell back to prose instead of failing
//      closed.
//
// Both safeguards are deliberately deterministic — no LLM call, no
// regex-on-regex. They run alongside (not in place of) the existing QA
// checklist, fact-check pass, and novelty guard. When they trip, the
// orchestrator emits a `research blocked` event, marks the project blocked,
// optionally writes a `research-blocked-{week}.md` diagnostic file, and
// skips the publishable issue-*.md / runner-up-*.md outputs entirely.

import type { Project, ProjectTemplate, Task } from "@shared/schema";

// ── Tunables ───────────────────────────────────────────────────────────────

// A "usable candidate" needs at least one inline link to a real http(s) URL
// AND some prose/context around it (title, summary, snippet) — a bare URL is
// just a citation, not a story.
const MIN_USABLE_CANDIDATES_FOR_BANKER = 1;
const TARGET_CANDIDATES_FOR_BANKER_MIN = 5;
const TARGET_CANDIDATES_FOR_BANKER_MAX = 8;
const MIN_USABLE_CANDIDATES_FOR_GENERIC = 1;
const MIN_FINAL_LINKS = 1;

// Phrases that strongly indicate the agent gave up on real research and
// emitted a meta-essay about the API failure. Matching is case-insensitive
// and substring-based — the cost of a false positive (operator rerun) is
// much lower than the cost of publishing a failure post-mortem as a real
// newsletter issue.
const META_FAILURE_PHRASES: ReadonlyArray<string> = [
  "pipeline came back empty",
  "rate-limited across the board",
  "rate limited across the board",
  "zero pages fetched",
  "no pages fetched",
  "data didn't arrive",
  "data did not arrive",
  "tavily api quota",
  "tavily quota",
  "tavily rate limit",
  "tavily rate-limit",
  "http 433",
  "status 433",
  "search api was unavailable",
  "search api is unavailable",
  "research api failed",
  "all our search calls failed",
  "every search call failed",
  "all search calls failed",
  "our research tools failed",
  "our research tools were unavailable",
  "no candidates were returned",
  "candidate pipeline returned zero",
  "without fresh sources",
  "without any fetched sources",
  "this week's research came back empty",
  "research came back empty this week",
  "couldn't fetch any sources",
  "could not fetch any sources",
  "we were unable to fetch",
  "search quota was exhausted",
  "search quota exhausted",
];

// Detect a successful tool call signature in the research output. Research
// agents emit `tool_calls` summaries / inline citations like
// `[1] https://www.bankofengland.co.uk/...` or proper markdown links. We
// don't trust the agent to self-report failure — we look for positive
// evidence of fetched URLs instead.
const URL_REGEX = /https?:\/\/[^\s)>\]"]+/gi;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

// Domains that signal a real publisher/source, not an internal scratch URL.
// Used only as a tie-breaker — we don't reject a link for being on a
// substack, but a link to localhost / example.com / 127.0.0.1 doesn't count.
const NON_USABLE_HOSTS = new Set<string>([
  "example.com", "example.org", "example.net",
  "localhost", "127.0.0.1", "0.0.0.0",
]);

// ── Brief classification ───────────────────────────────────────────────────
// Should this project enforce the sufficiency gate? Yes when:
//   • Template is The Analytical Banker (any weekly variant).
//   • Template name mentions "sme analytics" / "weekly analytics" / similar
//     research-required briefs. We match loosely so a "Weekly SME Analytics"
//     name and a "SME Analytics Report" name both trigger.
//   • OR a research-flavoured task exists in the plan (any task assigned to
//     a known research agent OR titled "research"/"identify candidate
//     stories"/"deep-search" etc.) AND a publishable downstream exists
//     (planner key "final" or task title containing "issue"/"newsletter"/
//     "report"/"final"). This is the generic catch-all so manager-LLM-
//     planned projects also gate, not only the seeded reference plans.

const RESEARCH_AGENT_IDS = new Set([
  "deep-search",
  "source-discovery",
  "annual-reports-search",
  "industry-research",
  "web-scraper",
  "doc-specialist",
  "data-val-specialist",
]);

const PUBLISHABLE_TITLE_HINT_RE = /\b(issue|newsletter|report|final|publish|memo|brief)\b/i;
const RESEARCH_TITLE_HINT_RE = /\b(research|deep[\s-]search|identify candidate|candidate stor(?:y|ies)|web search|sources?|landscape)\b/i;

export type BriefKind = "analytical-banker" | "sme-analytics" | "generic-research" | null;

export function classifyResearchBrief(
  template: { name?: string | null } | null | undefined,
  tasks: Pick<Task, "title" | "assignedTo">[] = [],
): BriefKind {
  const name = (template?.name ?? "").trim().toLowerCase();

  if (name.startsWith("the analytical banker")) {
    return "analytical-banker";
  }
  if (
    name.includes("sme analytics") ||
    name.includes("sme-analytics") ||
    name.includes("smeanalytics") ||
    (name.includes("weekly") && name.includes("sme"))
  ) {
    return "sme-analytics";
  }

  // Manager-LLM-planned generic detection: needs at least one research
  // agent + one publishable downstream task.
  const hasResearch = tasks.some(
    (t) =>
      RESEARCH_AGENT_IDS.has(t.assignedTo) ||
      RESEARCH_TITLE_HINT_RE.test(t.title ?? ""),
  );
  const hasPublishable = tasks.some((t) =>
    PUBLISHABLE_TITLE_HINT_RE.test(t.title ?? ""),
  );
  if (hasResearch && hasPublishable) return "generic-research";

  return null;
}

// Convenience predicate — true for any project whose template+tasks should
// run through the sufficiency gate.
export function requiresSourcedResearch(
  template: { name?: string | null } | null | undefined,
  tasks: Pick<Task, "title" | "assignedTo">[] = [],
): boolean {
  return classifyResearchBrief(template, tasks) !== null;
}

// ── Research output evaluation ─────────────────────────────────────────────
// Walks the upstream research task outputs and counts usable sourced
// candidates. A candidate is "usable" when its surrounding text contains a
// real http(s) URL and has at least some accompanying prose. We don't try
// to LLM-parse the candidate list — the heuristic is "did any tool actually
// return content, and is that content visible in the agent's writeup?"

export interface ResearchInput {
  taskTitle: string;
  assignedTo: string;
  output: string;
}

export interface SufficiencyReport {
  // True when the downstream publishable tasks may proceed.
  ok: boolean;
  // Human-readable reason emitted to the activity feed.
  reason: string;
  // Counts that drove the verdict.
  usableCandidates: number;
  totalLinks: number;
  // The matched meta-failure phrases (if any) found inside the *research*
  // output — separate from the final-output guard further down. Surface as
  // diagnostic detail in the blocked event.
  metaFailureHits: string[];
  // Brief kind we evaluated against — useful for tests + events.
  briefKind: BriefKind;
}

function extractLinks(text: string): string[] {
  const links = new Set<string>();
  let m: RegExpExecArray | null;

  // Pull markdown-link URLs first (they implicitly carry context).
  const mdRe = new RegExp(MARKDOWN_LINK_REGEX.source, "g");
  while ((m = mdRe.exec(text)) !== null) {
    links.add(m[2]);
  }
  // Then bare URLs.
  const urlRe = new RegExp(URL_REGEX.source, "gi");
  while ((m = urlRe.exec(text)) !== null) {
    links.add(m[0].replace(/[.,;:)\]>]+$/, ""));
  }

  return Array.from(links).filter((u) => {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      return !NON_USABLE_HOSTS.has(host);
    } catch {
      return false;
    }
  });
}

// A "candidate" in the research output is a markdown bullet, numbered list
// item, or `### ` block that contains at least one URL. We don't require
// the exact "1. Title — Source — Date" shape because the seeded prompt is
// looser than that. Counting unique URLs is a noisier but more conservative
// proxy than parsing structure.
function countUsableCandidates(text: string): number {
  // Group by URL — duplicates within the same writeup don't count as new
  // candidates.
  const links = extractLinks(text);
  if (links.length === 0) return 0;

  // If we have N unique URLs and the body is non-trivial (>200 chars),
  // assume the writer paired each with a description. We deliberately
  // don't try to bisect bullets — the editorial-lead prompts shift wording
  // weekly and any parser would drift.
  if (text.trim().length < 200) return 0;
  return links.length;
}

function findMetaFailureHits(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const phrase of META_FAILURE_PHRASES) {
    if (lower.includes(phrase)) hits.push(phrase);
  }
  return hits;
}

export function evaluateResearchSufficiency(
  inputs: ResearchInput[],
  briefKind: BriefKind,
): SufficiencyReport {
  // Aggregate over every research task output. We collapse the per-task
  // breakdown so the gate fires on the *project's* research evidence, not
  // any single task's. This means a project with five research tasks where
  // one returned a working URL will pass the minimum gate (matches the
  // user's brief: "at minimum at least one usable candidate").
  let usableCandidates = 0;
  let totalLinks = 0;
  const metaHits = new Set<string>();
  let combinedLen = 0;

  for (const input of inputs) {
    const text = input.output ?? "";
    combinedLen += text.length;
    const links = extractLinks(text);
    totalLinks += links.length;
    usableCandidates += countUsableCandidates(text);
    for (const h of findMetaFailureHits(text)) metaHits.add(h);
  }

  const metaFailureHits = Array.from(metaHits);
  const minRequired =
    briefKind === "analytical-banker"
      ? MIN_USABLE_CANDIDATES_FOR_BANKER
      : MIN_USABLE_CANDIDATES_FOR_GENERIC;

  // Block conditions — any one of these trips the gate.
  if (inputs.length === 0) {
    return {
      ok: false,
      briefKind,
      usableCandidates: 0,
      totalLinks: 0,
      metaFailureHits,
      reason: "No upstream research task outputs were captured — cannot evaluate sourced evidence.",
    };
  }
  if (combinedLen < 100) {
    return {
      ok: false,
      briefKind,
      usableCandidates,
      totalLinks,
      metaFailureHits,
      reason: `Research outputs are nearly empty (${combinedLen} chars) — upstream tools likely failed.`,
    };
  }
  if (totalLinks === 0) {
    return {
      ok: false,
      briefKind,
      usableCandidates,
      totalLinks,
      metaFailureHits,
      reason: "Research outputs contain zero source URLs — every fetched-source claim must be linkable. Likely cause: every search/extract call failed (HTTP 433 / quota / rate limit).",
    };
  }
  if (usableCandidates < minRequired) {
    return {
      ok: false,
      briefKind,
      usableCandidates,
      totalLinks,
      metaFailureHits,
      reason: `Only ${usableCandidates} usable sourced candidate${usableCandidates === 1 ? "" : "s"} found (minimum ${minRequired} required for ${briefKind ?? "this brief"}).`,
    };
  }
  if (metaFailureHits.length > 0) {
    return {
      ok: false,
      briefKind,
      usableCandidates,
      totalLinks,
      metaFailureHits,
      reason: `Research output contains meta-failure language (${metaFailureHits.slice(0, 3).map((h) => `"${h}"`).join(", ")}) — the agent appears to be describing its own pipeline failure rather than reporting real sources.`,
    };
  }

  // Soft warning for Analytical Banker when below the 5–8 target band but
  // above the hard minimum. We pass the gate but surface the count so the
  // operator can see the run is on the thin side.
  if (
    briefKind === "analytical-banker" &&
    usableCandidates < TARGET_CANDIDATES_FOR_BANKER_MIN
  ) {
    return {
      ok: true,
      briefKind,
      usableCandidates,
      totalLinks,
      metaFailureHits,
      reason: `Only ${usableCandidates} candidates found (Analytical Banker brief expects ${TARGET_CANDIDATES_FOR_BANKER_MIN}–${TARGET_CANDIDATES_FOR_BANKER_MAX}). Continuing on the thin side; consider rerunning research if quality looks off.`,
    };
  }

  return {
    ok: true,
    briefKind,
    usableCandidates,
    totalLinks,
    metaFailureHits,
    reason: `Research sufficient: ${usableCandidates} sourced candidate${usableCandidates === 1 ? "" : "s"}, ${totalLinks} link${totalLinks === 1 ? "" : "s"} across ${inputs.length} research task${inputs.length === 1 ? "" : "s"}.`,
  };
}

// ── Final output guard ─────────────────────────────────────────────────────
// Sanity-check a single saved markdown file (issue-*.md or generic
// publishable output). The guard fires when:
//   • the file has fewer than MIN_FINAL_LINKS markdown links, OR
//   • the file contains any meta-failure phrase, OR
//   • the file body is implausibly short for a publishable issue
//     (< 600 chars — a real Analytical Banker issue is 5–7 KB).

export interface FinalOutputReport {
  ok: boolean;
  reason: string;
  linkCount: number;
  metaFailureHits: string[];
  // Optional extras callers can surface in events.
  charLength: number;
}

const PUBLISHABLE_MIN_CHARS = 600;

export function evaluatePublishableOutput(
  content: string,
  opts: { kind?: "issue" | "runner-up" | "generic" } = {},
): FinalOutputReport {
  const text = content ?? "";
  const charLength = text.length;
  const kind = opts.kind ?? "issue";

  const links: string[] = [];
  let m: RegExpExecArray | null;
  const mdRe = new RegExp(MARKDOWN_LINK_REGEX.source, "g");
  while ((m = mdRe.exec(text)) !== null) {
    try {
      const host = new URL(m[2]).hostname.toLowerCase();
      if (!NON_USABLE_HOSTS.has(host)) links.push(m[2]);
    } catch {
      // Skip malformed URLs silently.
    }
  }

  const metaFailureHits = findMetaFailureHits(text);

  // Runner-ups are explicitly one short paragraph in the brief — relax the
  // link requirement and the minimum length for them, but still reject
  // meta-failure phrases.
  if (kind === "runner-up") {
    if (metaFailureHits.length > 0) {
      return {
        ok: false,
        reason: `Runner-up contains meta-failure language: ${metaFailureHits.slice(0, 2).map((h) => `"${h}"`).join(", ")}.`,
        linkCount: links.length,
        metaFailureHits,
        charLength,
      };
    }
    if (charLength < 50) {
      return {
        ok: false,
        reason: `Runner-up is implausibly short (${charLength} chars) — likely truncated or empty.`,
        linkCount: links.length,
        metaFailureHits,
        charLength,
      };
    }
    return {
      ok: true,
      reason: "Runner-up OK.",
      linkCount: links.length,
      metaFailureHits,
      charLength,
    };
  }

  if (metaFailureHits.length > 0) {
    return {
      ok: false,
      reason: `Publishable output contains meta-failure language (${metaFailureHits.slice(0, 3).map((h) => `"${h}"`).join(", ")}) — looks like the agent narrated its own pipeline failure instead of producing a sourced story.`,
      linkCount: links.length,
      metaFailureHits,
      charLength,
    };
  }
  if (charLength < PUBLISHABLE_MIN_CHARS) {
    return {
      ok: false,
      reason: `Publishable output is too short (${charLength} chars; expected ≥ ${PUBLISHABLE_MIN_CHARS}).`,
      linkCount: links.length,
      metaFailureHits,
      charLength,
    };
  }
  if (links.length < MIN_FINAL_LINKS) {
    return {
      ok: false,
      reason: `Publishable output has zero markdown links — every factual/sourced claim must link to its primary source.`,
      linkCount: links.length,
      metaFailureHits,
      charLength,
    };
  }

  return {
    ok: true,
    reason: `Publishable output OK (${links.length} link${links.length === 1 ? "" : "s"}, ${charLength} chars).`,
    linkCount: links.length,
    metaFailureHits,
    charLength,
  };
}

// ── Helpers used by the orchestrator to identify research / publishable tasks ─

// Planner-key "research" maps cleanly to Analytical Banker's reference plan.
// For generic / manager-LLM-planned briefs we also treat anything whose
// assigned agent is in RESEARCH_AGENT_IDS as a research task. The
// orchestrator passes the planner-key map in when available.
export function isResearchTask(
  task: Pick<Task, "title" | "assignedTo">,
  plannerKey?: string,
): boolean {
  if (plannerKey === "research" || plannerKey === "factcheck") return true;
  if (RESEARCH_AGENT_IDS.has(task.assignedTo)) return true;
  return RESEARCH_TITLE_HINT_RE.test(task.title ?? "");
}

// Planner-key "final" / "draft" / "angle" are the downstream publishable
// steps for the Analytical Banker. For generic briefs, any task title
// hinting at a publishable artefact is downstream — we'll block it.
export function isDownstreamPublishableTask(
  task: Pick<Task, "title" | "assignedTo">,
  plannerKey?: string,
): boolean {
  if (plannerKey === "angle" || plannerKey === "draft" || plannerKey === "final" || plannerKey === "qa") {
    return true;
  }
  return PUBLISHABLE_TITLE_HINT_RE.test(task.title ?? "");
}

// ── Diagnostic file rendering ───────────────────────────────────────────────
// When the gate trips, we drop a research-blocked-{week}.md (or
// issue-blocked-{week}.md for generic briefs) so an operator opening the
// project's Files tab sees exactly why no publishable issue was produced.
// The body is plain markdown — easy to diff and easy to email.

export function renderResearchBlockedDiagnostic(
  project: { name: string; description?: string | null },
  briefKind: BriefKind,
  report: SufficiencyReport,
  inputs: ResearchInput[],
  weekLabel: string,
): string {
  const lines: string[] = [];
  lines.push(`# Research blocked — ${weekLabel}`);
  lines.push("");
  lines.push(
    `The ${briefKind ?? "research"} workflow for **${project.name}** was halted ` +
    `before any publishable issue/report was emitted, because upstream research ` +
    `did not return usable sourced evidence.`,
  );
  lines.push("");
  lines.push(`## Why the run was blocked`);
  lines.push("");
  lines.push(`- **Reason:** ${report.reason}`);
  lines.push(`- **Usable sourced candidates:** ${report.usableCandidates}`);
  lines.push(`- **Distinct source links across research outputs:** ${report.totalLinks}`);
  if (report.metaFailureHits.length > 0) {
    lines.push(
      `- **Meta-failure phrases detected in research output:** ` +
      report.metaFailureHits.map((h) => `\`${h}\``).join(", "),
    );
  }
  lines.push("");
  lines.push(`## What to check next`);
  lines.push("");
  lines.push(`1. Confirm the **Tavily API key** is valid and not over quota / rate-limited.`);
  lines.push(`2. Inspect the activity feed for HTTP 433 / quota / "all calls failed" tool errors.`);
  lines.push(`3. If a backup search provider is configured (e.g. Perplexity), verify it is reachable.`);
  lines.push(`4. Resume the project once the upstream issue is resolved — the research tasks will rerun.`);
  lines.push("");
  lines.push(`## Captured research outputs (for diagnosis)`);
  lines.push("");
  if (inputs.length === 0) {
    lines.push(`_No research task outputs were captured._`);
  } else {
    for (const input of inputs) {
      lines.push(`### ${input.taskTitle} (agent: ${input.assignedTo})`);
      lines.push("");
      const clipped = (input.output ?? "").trim();
      if (!clipped) {
        lines.push(`_(empty)_`);
      } else if (clipped.length > 4000) {
        lines.push("```");
        lines.push(clipped.slice(0, 4000) + "\n[...truncated]");
        lines.push("```");
      } else {
        lines.push("```");
        lines.push(clipped);
        lines.push("```");
      }
      lines.push("");
    }
  }
  lines.push(``);
  lines.push(
    `_This file was emitted by the Stage 6.9 research sufficiency gate. ` +
    `No publishable issue-*.md / runner-up-*.md / final report was produced._`,
  );
  return lines.join("\n") + "\n";
}

// Derive a week label for diagnostic filenames. Prefers a YYYY-WW shape
// from the current date so two runs in the same week overwrite cleanly.
export function weekLabelFromDate(date = new Date()): string {
  // ISO week number — robust against timezone shifts because we work in UTC.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  const yyyy = d.getUTCFullYear();
  const ww = String(week).padStart(2, "0");
  return `${yyyy}-W${ww}`;
}

// Filename helpers — kept here so the orchestrator imports a single source.
export function blockedDiagnosticFilename(briefKind: BriefKind, weekLabel: string): string {
  if (briefKind === "analytical-banker") return `research-blocked-${weekLabel}.md`;
  if (briefKind === "sme-analytics") return `research-blocked-${weekLabel}.md`;
  return `issue-blocked-${weekLabel}.md`;
}

// ── Internal exports for tests ─────────────────────────────────────────────
// Surface the phrase list + tunables so the test suite can assert the
// matrix without re-declaring them.
export const __internal = {
  META_FAILURE_PHRASES,
  MIN_USABLE_CANDIDATES_FOR_BANKER,
  MIN_USABLE_CANDIDATES_FOR_GENERIC,
  MIN_FINAL_LINKS,
  PUBLISHABLE_MIN_CHARS,
  TARGET_CANDIDATES_FOR_BANKER_MIN,
  TARGET_CANDIDATES_FOR_BANKER_MAX,
  RESEARCH_AGENT_IDS,
  extractLinks,
  countUsableCandidates,
  findMetaFailureHits,
};

// Unused-import suppressors for type-only references kept for future use.
void (null as unknown as Project | ProjectTemplate);
