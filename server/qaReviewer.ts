// ─── QA Reviewer ────────────────────────────────────────────────────────────
// Stage 4.6. After every regular task completes, the QA agent reviews the
// project against its original brief and returns a structured verdict.
//
// The verdict drives the project's final status:
//   signedOff: true  → project moves to "completed"
//   signedOff: false → project moves to "blocked" so the user can address
//                      issues and hit Resume.
//
// QA uses the high-tier router so accuracy isn't traded away on the most
// consequential check. Cost is recorded in the qa_reviews row + token_usage.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import { storage } from "./storage";
import { streamCompletion, settingKeyForProvider, type LLMMessage } from "./llm";
import { routeForCriticalCall } from "./modelRouter";
import type { Agent, Project, ProjectFile } from "@shared/schema";
import type { LiveOrchestratorDeps } from "./liveOrchestrator";

export interface QaVerdict {
  signedOff: boolean;
  recommendation: "ship" | "fix-and-resume" | "replan";
  summary: string;
  coverage: { ask: string; met: boolean; evidence: string }[];
  issues: string[];
  modelUsed: string;
  costUsd: number;
}

// Robust JSON extraction (LLMs sometimes wrap output in ```json fences).
function extractJSON<T = unknown>(raw: string): T | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try { return JSON.parse(candidate) as T; } catch { /* fall through */ }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)) as T; } catch { /* fall */ }
  }
  return null;
}

// Stage 5.x.8: bumped from 2,500 → 12,000 default. Issue-*.md files routinely
// run 8-11 KB; the old cap meant the QA reviewer never saw the back half of
// the article and defaulted to "fix-and-resume" because it couldn't confirm
// coverage on the unread tail. Final-task issue files get a higher cap below.
function readFileSafe(p: string, max = 12_000): string {
  try {
    const buf = fs.readFileSync(p);
    const text = buf.toString("utf8");
    return text.length > max ? text.slice(0, max) + `\n\n[... ${text.length - max} chars truncated ...]` : text;
  } catch {
    return "";
  }
}

// Stage 5.x.8: when a single task saves multiple markdown files (e.g. the
// editorial-lead's `final` task emits both issue-*.md and runner-up-*.md),
// prefer issue-*.md as the canonical deliverable and surface the others
// alongside it. The previous `files.find(...)` call against a desc(createdAt)
// list could return whichever file the LLM emitted last, often the runner-up
// — so the QA reviewer summarised the planning artefact instead of the
// newsletter and then hallucinated discrepancies.
function pickTaskFiles(taskId: number, files: ProjectFile[]): ProjectFile[] {
  const mds = files.filter(f => f.taskId === taskId && f.fileType === "markdown");
  if (mds.length === 0) return [];
  const issue = mds.find(f => /^issue-\d+\.md$/i.test(f.filename));
  if (issue) {
    return [issue, ...mds.filter(f => f !== issue)];
  }
  return mds;
}

export async function reviewProjectQA(
  project: Project,
  qaAgent: Agent,
  deps: LiveOrchestratorDeps,
  recordUsage: (
    agent: Agent, projectId: number, tokensIn: number, tokensOut: number,
    deps: LiveOrchestratorDeps, override?: { provider: any; modelId: string },
  ) => number,
): Promise<QaVerdict> {
  const routed = routeForCriticalCall(qaAgent);
  const apiKey = storage.getSetting(settingKeyForProvider(routed.provider));
  if (!apiKey) {
    throw new Error(`No API key for ${routed.provider} (QA review)`);
  }

  // Gather everything QA needs to make a verdict.
  const tasks = storage.getTasks(project.id)
    .filter(t => t.status === "done" && t.blockedReason !== "Superseded by replan");
  const files = storage.getProjectFiles(project.id);
  let outputFormats: string[] = [];
  try { outputFormats = JSON.parse(project.outputFormats || "[]"); } catch { outputFormats = []; }

  // Per-task deliverable summary. For each task we include EVERY markdown
  // file it produced, each labelled with its filename so the LLM can map
  // task → file unambiguously. Final-task issue files get a 16K cap so the
  // reviewer can see the entire newsletter (typical size 8-11 KB).
  const deliverables = tasks.map(t => {
    const taskFiles = pickTaskFiles(t.id, files);
    const agentTag = t.assignedTo ?? "?";
    if (taskFiles.length === 0) {
      return `### Task: "${t.title}" (${t.complexity ?? "medium"} · ${t.modelUsed ?? "?"} · agent: ${agentTag})\n(no markdown output captured)`;
    }
    const blocks = taskFiles.map(f => {
      const cap = /^issue-\d+\.md$/i.test(f.filename) ? 16_000 : 12_000;
      const body = readFileSafe(f.filePath, cap);
      return `#### File: ${f.filename}\n\n${body}`;
    }).join("\n\n");
    return `### Task: "${t.title}" (${t.complexity ?? "medium"} · ${t.modelUsed ?? "?"} · agent: ${agentTag})\n${blocks}`;
  }).join("\n\n");

  const fileSummary = files.length === 0
    ? "(none)"
    : files.map(f => `- ${f.filename} (${f.fileType}, ${(f.sizeBytes / 1024).toFixed(1)} KB)`).join("\n");

  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You are the QA Reviewer for an AI office. A team of agents has completed a multi-task project. Your job: compare the original ask to what was actually delivered, and decide whether to sign off.

EVIDENCE RULE (mandatory):
For every entry in "issues", you must include a short verbatim quote (≤200 chars) from one of the deliverable files demonstrating the defect, and reference the filename. If you cannot quote the file to support an issue, do not list it. Reports without quoted evidence will be rejected.
For every "coverage" entry, "evidence" should similarly cite a filename or a short verbatim phrase from the relevant file.

Respond with ONLY a JSON object — no prose, no markdown fences:
{
  "signedOff": true | false,
  "recommendation": "ship" | "fix-and-resume" | "replan",
  "summary": "<1-3 sentence executive summary of what shipped and whether it meets the ask>",
  "coverage": [
    { "ask": "<one specific requirement from the brief>", "met": true | false, "evidence": "<filename + quoted phrase, or why it isn't met>" }
  ],
  "issues": [ "<defect — must include filename and quoted excerpt>", ... ]
}

Rules:
- Be specific. "Met" means there is concrete evidence in a delivered task or file. Vague claims do not count.
- Each requested output format (PDF, Excel, etc.) is its own coverage item.
- "ship" only when every coverage item is met and there are no significant issues.
- "fix-and-resume" when issues are addressable by re-running 1-2 tasks AND each issue carries a quoted excerpt proving it.
- "replan" when the deliverables fundamentally miss the brief.
- Issues array can be empty. Coverage array must have at least 1 item.
- Be honest. False sign-offs cost more than false rejections — but unfounded fix-and-resume reports waste a full re-run, so do not invent issues.`,
    },
    {
      role: "user",
      content: `## Original Brief
**Project name:** ${project.name}
**Description:** ${project.description || "(no description provided)"}
**Priority:** ${project.priority}
**Requested output formats:** ${outputFormats.length > 0 ? outputFormats.join(", ") : "(none specified)"}

## Files Produced (${files.length})
${fileSummary}

## Task Deliverables
${deliverables || "(no deliverables produced)"}

Return your JSON verdict now.`,
    },
  ];

  let result;
  try {
    result = await streamCompletion(
      { provider: routed.provider, modelId: routed.modelId, apiKey, messages, maxTokens: 2048, temperature: 0.2 },
      {},
    );
  } catch (e) {
    throw new Error(`QA model call failed: ${(e as Error).message ?? e}`);
  }

  const cost = recordUsage(qaAgent, project.id, result.tokensIn, result.tokensOut, deps, {
    provider: routed.provider, modelId: routed.modelId,
  });

  const parsed = extractJSON<{
    signedOff?: boolean;
    recommendation?: string;
    summary?: string;
    coverage?: { ask?: string; met?: boolean; evidence?: string }[];
    issues?: string[];
  }>(result.text);

  // Defensive defaults — if QA returned malformed JSON, treat as not signed off.
  const verdict: QaVerdict = {
    signedOff: Boolean(parsed?.signedOff),
    recommendation: (["ship", "fix-and-resume", "replan"].includes(parsed?.recommendation as string)
      ? parsed!.recommendation
      : (parsed?.signedOff ? "ship" : "fix-and-resume")) as QaVerdict["recommendation"],
    summary: String(parsed?.summary ?? "QA returned no summary").slice(0, 1000),
    coverage: Array.isArray(parsed?.coverage)
      ? parsed!.coverage.map(c => ({
          ask: String(c?.ask ?? "").slice(0, 300),
          met: Boolean(c?.met),
          evidence: String(c?.evidence ?? "").slice(0, 500),
        })).filter(c => c.ask)
      : [],
    issues: Array.isArray(parsed?.issues)
      ? parsed!.issues.map(s => String(s).slice(0, 500)).filter(s => s.length > 0)
      : [],
    modelUsed: routed.modelId,
    costUsd: cost,
  };

  // Persist the verdict so the UI can render it later.
  storage.createQaReview({
    projectId: project.id,
    signedOff: verdict.signedOff ? 1 : 0,
    recommendation: verdict.recommendation,
    summary: verdict.summary,
    coverage: JSON.stringify(verdict.coverage),
    issues: JSON.stringify(verdict.issues),
    modelUsed: verdict.modelUsed,
    costUsd: verdict.costUsd,
  });

  return verdict;
}
