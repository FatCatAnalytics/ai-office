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

  // Stage 5.x.13: bumped from 2048 → 4096 default. The reviewer must emit a
  // structured JSON with a coverage matrix + quoted-evidence issues array; on
  // a Medium-length newsletter that easily runs 1500-2500 output tokens. The
  // previous 2048 cap was hitting max_tokens mid-JSON, leaving the reviewer
  // stuck on the defensive default ("QA returned no summary") and then the
  // run was forced into fix-and-resume on no real grounds.
  type QaParsedShape = {
    signedOff?: boolean;
    recommendation?: string;
    summary?: string;
    coverage?: { ask?: string; met?: boolean; evidence?: string }[];
    issues?: string[];
  };

  let result;
  try {
    result = await streamCompletion(
      // Stage 5.x.17: QA initial cap 4096 → 8192. The 5.x.13 bump fixed the
      // common case but a coverage matrix with 8 quoted-evidence rows over
      // a long technical article was still hitting the cap. Doubling the
      // initial budget keeps cost low for short reviews (we only pay for
      // emitted tokens) while removing the truncation pressure.
      { provider: routed.provider, modelId: routed.modelId, apiKey, messages, maxTokens: 8192, temperature: 0.2 },
      {},
    );
  } catch (e) {
    throw new Error(`QA model call failed: ${(e as Error).message ?? e}`);
  }

  let totalTokensIn = result.tokensIn;
  let totalTokensOut = result.tokensOut;
  let parsed = extractJSON<QaParsedShape>(result.text);
  let rawForFallback = result.text;
  let stopReasonForFallback = result.stopReason ?? "";

  // Stage 5.x.13: retry once with a much larger output budget if either the
  // model was truncated (stop_reason=max_tokens) OR the response wasn't valid
  // JSON. Both symptoms map to the same operator-visible bug — "QA returned
  // no summary" — so we treat them identically.
  const truncated = result.stopReason === "max_tokens";
  if ((!parsed || truncated) && result.text.trim().length > 0) {
    deps.emitEvent(
      project.id, "qa", qaAgent.name, "qa retry",
      truncated
        ? `Initial QA response truncated at 8192 tokens (stop_reason=max_tokens) — retrying with 16384-token budget`
        : `Initial QA response wasn't valid JSON — retrying with 16384-token budget and a tighter format prompt`,
      "info",
    );
    // Tighten the prompt for the retry: the model still sees the original
    // brief + deliverables, but we strip the long evidence-rule preamble
    // that pushed many models to write 600+ token coverage entries last
    // time. We instead nudge the model to keep the JSON compact.
    const retryMessages: LLMMessage[] = [
      messages[0], // keep the QA system prompt
      messages[1], // keep the user payload (brief + deliverables)
      {
        role: "user",
        content:
          "Your previous response was either truncated or not valid JSON. Reply ONLY with the QA verdict JSON object " +
          "described in the system prompt. Keep evidence quotes under 120 chars and limit coverage to 8 items maximum. " +
          "No prose, no markdown fences — a single { ... } object.",
      },
    ];
    try {
      const retry = await streamCompletion(
        { provider: routed.provider, modelId: routed.modelId, apiKey, messages: retryMessages, maxTokens: 16384, temperature: 0.1 },
        {},
      );
      totalTokensIn  += retry.tokensIn;
      totalTokensOut += retry.tokensOut;
      const retryParsed = extractJSON<QaParsedShape>(retry.text);
      if (retryParsed) {
        parsed = retryParsed;
        rawForFallback = retry.text;
        stopReasonForFallback = retry.stopReason ?? stopReasonForFallback;
      } else {
        // Keep the longer text from whichever attempt produced more output,
        // so the operator-visible fallback summary has more context.
        if (retry.text.length > rawForFallback.length) rawForFallback = retry.text;
        if (retry.stopReason) stopReasonForFallback = retry.stopReason;
      }
    } catch (e) {
      // Don't fail the whole QA run on a retry error — fall through to the
      // defensive fallback below with the original (truncated) text.
      deps.emitEvent(
        project.id, "qa", qaAgent.name, "qa retry failed",
        `Retry call errored: ${(e as Error)?.message ?? String(e)}`,
        "warning",
      );
    }
  }

  const cost = recordUsage(qaAgent, project.id, totalTokensIn, totalTokensOut, deps, {
    provider: routed.provider, modelId: routed.modelId,
  });

  // Defensive defaults — if QA still returned malformed JSON after the
  // retry, build a fallback summary that surfaces WHY (instead of the
  // cryptic "QA returned no summary"). Operators have been hitting this
  // exact failure mode in production; the empty summary made it impossible
  // to tell whether the reviewer actually saw the deliverables. We now
  // include the stop_reason and the head of whatever raw text the model
  // did produce so the next QA run is debuggable from the UI.
  let fallbackSummary = "QA returned no summary";
  if (!parsed) {
    const head = rawForFallback.trim().replace(/\s+/g, " ").slice(0, 240);
    const reasonNote = stopReasonForFallback === "max_tokens"
      ? "output cap was hit even after retry"
      : stopReasonForFallback && stopReasonForFallback !== "end_turn"
        ? `stop_reason=${stopReasonForFallback}`
        : "response was not valid JSON";
    fallbackSummary = head
      ? `QA verdict could not be parsed (${reasonNote}). Model said: “${head}…”`
      : `QA verdict could not be parsed (${reasonNote}); model returned no usable text.`;
  }

  const verdict: QaVerdict = {
    signedOff: Boolean(parsed?.signedOff),
    recommendation: (["ship", "fix-and-resume", "replan"].includes(parsed?.recommendation as string)
      ? parsed!.recommendation
      : (parsed?.signedOff ? "ship" : "fix-and-resume")) as QaVerdict["recommendation"],
    summary: String(parsed?.summary ?? fallbackSummary).slice(0, 1000),
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

  if (!parsed) {
    // Surface the parse-failure event explicitly so it shows up in the
    // project event log next to the verdict — makes future incidents
    // ("QA returned no summary") instantly diagnosable.
    deps.emitEvent(
      project.id, "qa", qaAgent.name, "qa parse failed",
      `Could not parse QA verdict JSON (stop_reason=${stopReasonForFallback || "unknown"}, ${totalTokensOut} output tokens).`,
      "error",
    );
  }

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
