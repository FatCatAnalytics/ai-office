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
import type { Agent, Project } from "@shared/schema";
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

function readFileSafe(p: string, max = 4_000): string {
  try {
    const buf = fs.readFileSync(p);
    const text = buf.toString("utf8");
    return text.length > max ? text.slice(0, max) + `\n\n[... ${text.length - max} chars truncated ...]` : text;
  } catch {
    return "";
  }
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

  // Per-task deliverable summary — read the markdown output if available, else fall back to title only.
  const deliverables = tasks.map(t => {
    const md = files.find(f => f.taskId === t.id && f.fileType === "markdown");
    const body = md ? readFileSafe(md.filePath, 2_500) : "(no markdown output captured)";
    return `### Task: "${t.title}" (${t.complexity ?? "medium"} · ${t.modelUsed ?? "?"})\n${body}`;
  }).join("\n\n");

  const fileSummary = files.length === 0
    ? "(none)"
    : files.map(f => `- ${f.filename} (${f.fileType}, ${(f.sizeBytes / 1024).toFixed(1)} KB)`).join("\n");

  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You are the QA Reviewer for an AI office. A team of agents has completed a multi-task project. Your job: compare the original ask to what was actually delivered, and decide whether to sign off.

Respond with ONLY a JSON object — no prose, no markdown fences:
{
  "signedOff": true | false,
  "recommendation": "ship" | "fix-and-resume" | "replan",
  "summary": "<1-3 sentence executive summary of what shipped and whether it meets the ask>",
  "coverage": [
    { "ask": "<one specific requirement from the brief>", "met": true | false, "evidence": "<which task/file addresses it, or why it isn't met>" }
  ],
  "issues": [ "<concrete gap, quality concern, or missing deliverable>", ... ]
}

Rules:
- Be specific. "Met" means there is concrete evidence in a delivered task or file. Vague claims do not count.
- Each requested output format (PDF, Excel, etc.) is its own coverage item.
- "ship" only when every coverage item is met and there are no significant issues.
- "fix-and-resume" when issues are addressable by re-running 1-2 tasks.
- "replan" when the deliverables fundamentally miss the brief.
- Issues array can be empty. Coverage array must have at least 1 item.
- Be honest. False sign-offs cost more than false rejections.`,
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
