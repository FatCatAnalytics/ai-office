// ─── Live AI Orchestrator ─────────────────────────────────────────────────────
// Stage 4: Parallel execution + replanning + real PDF/XLSX outputs.
//
// Flow:
//   1. Manager LLM call decomposes the project into 3-9 tasks, each with an
//      optional `dependsOn` array referencing planner-local task keys ("t1",
//      "t2", …). The orchestrator topologically sorts the tasks into "waves"
//      where every task in a wave can run concurrently.
//   2. Tasks are written to the DB (with `dependsOn` and `waveIndex`) and
//      broadcast to the Kanban board.
//   3. Workers in the same wave run in parallel under a small concurrency cap
//      so we don't blast through API rate limits. As each wave finishes, its
//      outputs become part of the shared context for the next wave.
//   4. If a task fails, the manager gets ONE chance to replan the remaining
//      work given the failure context. If the replan also fails, the project
//      finishes in `blocked` state with whatever was completed.
//   5. Outputs are persisted as real PDF (pdfkit) / XLSX (exceljs) files where
//      requested; markdown / json / csv / python paths are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { storage, toolsForAgent } from "./storage";
import { streamCompletion, calculateCost, settingKeyForProvider, type Provider, type LLMMessage } from "./llm";
import { renderPdf, renderXlsx, type RenderMeta } from "./renderers";
import { routeForComplexity, routeForCriticalCall, normaliseComplexity, type Complexity } from "./modelRouter";
import { reviewProjectQA } from "./qaReviewer";
import { resolveTools, tavilyConfigured } from "./tools";
import type { Agent, Task, Project } from "@shared/schema";

export interface LiveOrchestratorDeps {
  broadcast: (data: unknown) => void;
  emitEvent: (
    projectId: number,
    agentId: string,
    agentName: string,
    action: string,
    detail: string,
    status?: "info" | "success" | "warning" | "error"
  ) => void;
  setAgentStatus: (
    agentId: string,
    status: "idle" | "working" | "thinking" | "blocked" | "done",
    currentTask?: string | null
  ) => void;
  generateSimulatedFiles: (projectId: number, task: Task, agent: Agent) => void;
}

// Cap shared context size to keep prompts cheap. ~16k chars ≈ ~4k tokens.
const SHARED_CONTEXT_CHAR_BUDGET = 16_000;
// Max workers in a single wave running concurrently.
const WAVE_CONCURRENCY = 3;
// Max replans the manager is allowed per project.
const MAX_REPLANS = 1;

// Truncate a long string with an indicator, preserving start + end.
function trimToBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const headLen = Math.floor(budget * 0.65);
  const tailLen = budget - headLen - 30;
  return `${text.slice(0, headLen)}\n\n[... ${text.length - headLen - tailLen} chars truncated ...]\n\n${text.slice(-tailLen)}`;
}

interface PriorOutput { task: Task; agent: Agent; output: string; }

function buildSharedContext(priorOutputs: PriorOutput[]): string {
  if (priorOutputs.length === 0) return "";
  const lines: string[] = ["## Prior Task Outputs (shared context)\n"];
  const reserved: string[] = [];
  let used = 0;
  for (let i = priorOutputs.length - 1; i >= 0; i--) {
    const { task, agent, output } = priorOutputs[i];
    const remaining = SHARED_CONTEXT_CHAR_BUDGET - used;
    if (remaining <= 200) break;
    const perItem = Math.min(remaining, Math.max(800, Math.floor(remaining / Math.max(1, i + 1))));
    const trimmed = trimToBudget(output, perItem);
    const block = `\n### ${agent.name} — "${task.title}"\n${trimmed}\n`;
    reserved.unshift(block);
    used += block.length;
  }
  return lines.concat(reserved).join("");
}

// Robust JSON extraction — LLMs sometimes wrap JSON in markdown fences.
function extractJSON<T = unknown>(raw: string): T | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try { return JSON.parse(candidate) as T; } catch { /* fall through */ }
  for (const opener of ["[", "{"]) {
    const start = candidate.indexOf(opener);
    if (start === -1) continue;
    const closer = opener === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === opener) depth++;
      else if (ch === closer) {
        depth--;
        if (depth === 0) {
          const slice = candidate.slice(start, i + 1);
          try { return JSON.parse(slice) as T; } catch { /* try next */ }
        }
      }
    }
  }
  return null;
}

function resolveAgentKey(agent: Agent): { apiKey: string; provider: Provider } {
  const provider = (agent.provider as Provider) ?? "anthropic";
  const key = storage.getSetting(settingKeyForProvider(provider));
  if (!key) throw new Error(`No API key configured for ${provider} (${agent.name})`);
  return { apiKey: key, provider };
}

function recordUsage(
  agent: Agent,
  projectId: number,
  tokensIn: number,
  tokensOut: number,
  deps: LiveOrchestratorDeps,
  override?: { provider: Provider; modelId: string }
): number {
  const provider = override?.provider ?? (agent.provider as Provider);
  const modelId = override?.modelId ?? agent.modelId;
  const costUsd = calculateCost(modelId, tokensIn, tokensOut);
  storage.recordTokenUsage({
    provider, modelId, agentId: agent.id,
    projectId, tokensIn, tokensOut, costUsd,
  });
  deps.broadcast({ type: "budget_update", summary: storage.getBudgetSummary() });
  return costUsd;
}

// ─── Output persistence ─────────────────────────────────────────────────────
// Async because PDF/XLSX rendering is async. Markdown/json/csv/python are
// fast string ops and remain effectively synchronous.

const EXT_BY_FORMAT: Record<string, { ext: string; mime: string }> = {
  pdf:      { ext: "pdf",  mime: "application/pdf" },
  csv:      { ext: "csv",  mime: "text/csv" },
  excel:    { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  python:   { ext: "py",   mime: "text/x-python" },
  json:     { ext: "json", mime: "application/json" },
  markdown: { ext: "md",   mime: "text/markdown" },
};

const AGENT_DEFAULT_FORMAT: Record<string, string> = {
  manager:       "markdown",
  frontend:      "python",
  backend:       "python",
  devops:        "python",
  qa:            "markdown",
  uiux:          "markdown",
  dbarchitect:   "python",
  datascientist: "csv",
  secengineer:   "markdown",
  pm:            "markdown",
};

async function saveLiveOutput(
  projectId: number,
  task: Task,
  agent: Agent,
  rawOutput: string,
  deps: LiveOrchestratorDeps
): Promise<void> {
  const project = storage.getProject(projectId);
  if (!project) return;

  let formats: string[];
  try { formats = JSON.parse(project.outputFormats ?? "[]"); } catch { formats = []; }
  if (formats.length === 0) {
    formats = [AGENT_DEFAULT_FORMAT[agent.id] ?? AGENT_DEFAULT_FORMAT[agent.spriteType] ?? "markdown"];
  }

  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  const meta: RenderMeta = {
    projectName: project.name,
    projectDescription: project.description,
    taskTitle: task.title,
    agentName: agent.name,
    modelId: agent.modelId,
    generatedAt: new Date(),
  };

  for (const fmt of formats) {
    const extMime = EXT_BY_FORMAT[fmt];
    if (!extMime) continue;

    let content: Buffer | string = rawOutput;
    try {
      if (fmt === "json") {
        const parsed = extractJSON(rawOutput);
        content = parsed ? JSON.stringify(parsed, null, 2) : rawOutput;
      } else if (fmt === "csv") {
        const fenceCsv = rawOutput.match(/```(?:csv)?\s*([\s\S]*?)```/);
        content = fenceCsv ? fenceCsv[1].trim() : rawOutput;
      } else if (fmt === "python") {
        const fencePy = rawOutput.match(/```(?:python|py)?\s*([\s\S]*?)```/);
        content = fencePy ? fencePy[1].trim() : rawOutput;
      } else if (fmt === "markdown") {
        content = `# ${task.title}\n\n**Project:** ${project.name}  \n**Agent:** ${agent.name} (\`${agent.modelId}\`)  \n**Mode:** Live AI  \n**Completed:** ${new Date().toLocaleString()}\n\n---\n\n${rawOutput.trim()}\n`;
      } else if (fmt === "pdf") {
        content = await renderPdf(rawOutput, meta);
      } else if (fmt === "excel") {
        content = await renderXlsx(rawOutput, meta);
      }

      const filename = `${slug}_${agent.id}.${extMime.ext}`;
      const saved = storage.saveProjectFile(
        {
          projectId, taskId: task.id, agentId: agent.id,
          filename, fileType: fmt, mimeType: extMime.mime,
          filePath: "", description: `${agent.name}: ${task.title}`,
        },
        content
      );
      deps.broadcast({ type: "file_created", projectId, file: saved });
      deps.emitEvent(
        projectId, agent.id, agent.name, "saved file",
        `📄 ${saved.filename} (${(saved.sizeBytes / 1024).toFixed(1)} KB)`, "success"
      );
    } catch (e) {
      console.error(`[live] ${fmt} render/save error:`, e);
      deps.emitEvent(
        projectId, agent.id, agent.name, "save failed",
        `${fmt}: ${(e as Error).message ?? e}`, "warning"
      );
    }
  }
}

// ─── Stream coalescer ───────────────────────────────────────────────────────
function makeStreamCoalescer(
  projectId: number,
  agent: Agent,
  taskTitle: string,
  deps: LiveOrchestratorDeps
) {
  let buffer = "";
  let lastFlush = Date.now();
  const FLUSH_CHARS = 60;
  const FLUSH_MS = 250;

  function flush(force = false) {
    const now = Date.now();
    if (!buffer) return;
    if (!force && buffer.length < FLUSH_CHARS && now - lastFlush < FLUSH_MS) return;
    deps.broadcast({
      type: "stream", projectId,
      agentId: agent.id, agentName: agent.name,
      taskTitle, delta: buffer,
    });
    buffer = "";
    lastFlush = now;
  }

  return {
    push(delta: string) { buffer += delta; flush(false); },
    end() { flush(true); },
  };
}

// ─── Manager planner ────────────────────────────────────────────────────────

interface PlannedTask {
  // Planner-local key used by other tasks to declare dependencies.
  // Manager emits "t1", "t2", …; orchestrator maps these to real DB ids.
  key: string;
  title: string;
  description: string;
  assignedTo: string;
  priority: "critical" | "high" | "normal" | "low";
  dependsOn: string[]; // planner-local keys
  complexity: Complexity; // low | medium | high — drives cost-aware routing
}

function buildManagerPrompt(project: Project, subAgents: Agent[]): LLMMessage[] {
  const agentList = subAgents.map(a => {
    const caps: string[] = (() => { try { return JSON.parse(a.capabilities); } catch { return []; } })();
    return `- ${a.id}: "${a.name}" — ${a.role}. Capabilities: ${caps.join(", ") || "general"}`;
  }).join("\n");

  const formats = (() => { try { return JSON.parse(project.outputFormats); } catch { return []; } })();
  const formatLine = formats.length > 0 ? `\n\nRequested output formats: ${formats.join(", ")}` : "";

  return [
    {
      role: "system",
      content: `You are the AI Office Manager. You receive a project and break it into 3-9 concrete tasks. Each task is assigned to exactly ONE agent on your team based on capability. Tasks may depend on the OUTPUTS of earlier tasks; tasks with no dependencies will run in parallel.

You must respond with ONLY a JSON array — no prose, no markdown fences. Each entry must be:
{
  "key": "t1" | "t2" | ... (unique stable id within this plan),
  "title": "<short imperative title, max 70 chars>",
  "description": "<one paragraph describing what should be done and what the deliverable looks like>",
  "assignedTo": "<exact agent id from the team list>",
  "priority": "critical" | "high" | "normal" | "low",
  "complexity": "low" | "medium" | "high",
  "dependsOn": ["t1", "t3", ...] (keys of tasks that must finish first; empty array if independent)
}

Complexity guidance (used for cost routing — cost optimisation matters):
- "low"    → mechanical: formatting, extraction, summarisation, boilerplate, file conversion, simple lookups.
- "medium" → standard knowledge work: drafting, normal coding, structured analysis, ordinary research.
- "high"   → reasoning-heavy: architecture, multi-step logic, security review, complex algorithms, ambiguous problems.
Most tasks are "medium". Use "high" sparingly — only when the task genuinely needs a top-tier model.

Planning rules:
- Maximize parallelism. Tasks that can run independently MUST have empty dependsOn arrays so they execute concurrently.
- Discovery / planning / requirements come BEFORE design.
- Design / architecture come BEFORE implementation.
- Implementation comes BEFORE testing.
- Testing comes BEFORE deployment.
- Don't invent fake dependencies — only declare a dependency if the assigned agent genuinely needs the prior task's output.
- The "manager" agent does NOT receive sub-tasks.
- Keys must be unique. dependsOn must reference only keys that exist in this plan and must not form a cycle.`,
    },
    {
      role: "user",
      content: `Team available:\n${agentList}\n\nProject: "${project.name}"\nDescription: ${project.description || "(no description provided)"}\nPriority: ${project.priority}${formatLine}\n\nReturn the JSON array of tasks now.`,
    },
  ];
}

// Validate planner output: shape, valid agent ids, dependency keys, no cycles.
function validatePlan(parsed: unknown, validAgentIds: Set<string>): PlannedTask[] {
  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  const cleaned: PlannedTask[] = [];
  const usedKeys = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    const t = parsed[i] as Record<string, unknown> | null;
    if (!t || typeof t !== "object") continue;

    const key = String(t.key ?? `t${i + 1}`).trim().slice(0, 24) || `t${i + 1}`;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);

    const title = String(t.title ?? "").trim().slice(0, 200);
    if (!title) continue;

    const description = String(t.description ?? "").trim();
    const assignedToRaw = String(t.assignedTo ?? "");
    const assignedTo = validAgentIds.has(assignedToRaw)
      ? assignedToRaw
      : Array.from(validAgentIds)[0];
    if (!assignedTo) continue;

    const priority = ["critical", "high", "normal", "low"].includes(t.priority as string)
      ? (t.priority as PlannedTask["priority"])
      : "normal";

    const depsRaw = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    const dependsOn = depsRaw
      .map(d => String(d).trim())
      .filter(d => d.length > 0 && d !== key);

    const complexity = normaliseComplexity(t.complexity);

    cleaned.push({ key, title, description, assignedTo, priority, dependsOn, complexity });
  }

  // Drop dangling dep references (refer to non-existent keys)
  const allKeys = new Set(cleaned.map(t => t.key));
  for (const t of cleaned) {
    t.dependsOn = t.dependsOn.filter(d => allKeys.has(d));
  }

  // Detect + break cycles via DFS. Any task on a cycle has its deps cleared
  // so the plan is salvageable rather than rejected.
  const onStack = new Set<string>();
  const visited = new Set<string>();
  const map = new Map(cleaned.map(t => [t.key, t]));

  function dfs(key: string): boolean {
    if (onStack.has(key)) return true; // cycle!
    if (visited.has(key)) return false;
    visited.add(key); onStack.add(key);
    const t = map.get(key);
    if (t) {
      for (const dep of [...t.dependsOn]) {
        if (dfs(dep)) {
          // break the cycle by removing this back-edge
          t.dependsOn = t.dependsOn.filter(d => d !== dep);
        }
      }
    }
    onStack.delete(key);
    return false;
  }
  for (const t of cleaned) dfs(t.key);

  return cleaned;
}

// Wave-based topological sort.
// Wave 0 = tasks with no remaining deps. Wave N = tasks whose deps all
// completed in waves < N. Returns array of task arrays grouped by wave.
function planWaves(plan: PlannedTask[]): PlannedTask[][] {
  const remaining = new Map(plan.map(t => [t.key, new Set(t.dependsOn)]));
  const byKey = new Map(plan.map(t => [t.key, t]));
  const waves: PlannedTask[][] = [];
  const done = new Set<string>();

  while (remaining.size > 0) {
    const wave: PlannedTask[] = [];
    Array.from(remaining.entries()).forEach(([key, deps]) => {
      if (deps.size === 0) wave.push(byKey.get(key)!);
    });
    if (wave.length === 0) {
      // Should be impossible after validatePlan removes cycles, but guard anyway.
      // Drop everything left as a single final wave.
      Array.from(remaining.keys()).forEach(key => wave.push(byKey.get(key)!));
    }
    for (const t of wave) {
      remaining.delete(t.key);
      done.add(t.key);
    }
    Array.from(remaining.values()).forEach(deps => {
      Array.from(done).forEach(k => deps.delete(k));
    });
    waves.push(wave);
  }
  return waves;
}

async function callManagerLLM(
  project: Project,
  manager: Agent,
  messages: LLMMessage[],
  deps: LiveOrchestratorDeps,
  label: string
): Promise<string> {
  // Manager planning + replan are the most consequential calls in the system
  // — they decide what every other agent will do. Always route through the
  // high-tier path (Opus → GPT-5.5 → Sonnet → …) regardless of how the
  // "manager" agent row was seeded. Operator pin in the registry overrides.
  const routed = routeForCriticalCall(manager);
  const apiKey = storage.getSetting(settingKeyForProvider(routed.provider));
  if (!apiKey) {
    throw new Error(`No API key configured for ${routed.provider} (Manager planning)`);
  }

  deps.setAgentStatus("manager", "thinking", label);
  deps.emitEvent(
    project.id, "manager", manager.name,
    "calling LLM",
    `[LIVE] ${routed.provider}/${routed.modelId} — ${label} (${routed.reason})`,
    "info"
  );

  const stream = makeStreamCoalescer(project.id, manager, label, deps);
  let result;
  try {
    result = await streamCompletion(
      { provider: routed.provider, modelId: routed.modelId, apiKey, messages, maxTokens: 2048, temperature: 0.4 },
      { onDelta: (d) => stream.push(d) }
    );
  } finally {
    stream.end();
  }
  recordUsage(manager, project.id, result.tokensIn, result.tokensOut, deps, {
    provider: routed.provider,
    modelId: routed.modelId,
  });
  return result.text;
}

async function planProjectLive(
  project: Project,
  agents: Agent[],
  deps: LiveOrchestratorDeps
): Promise<PlannedTask[]> {
  const manager = agents.find(a => a.id === "manager")!;
  const subAgents = agents.filter(a => a.id !== "manager");
  const validIds = new Set(subAgents.map(a => a.id));

  const messages = buildManagerPrompt(project, subAgents);
  const text = await callManagerLLM(project, manager, messages, deps, "Planning project tasks");
  const parsed = extractJSON(text);
  const plan = validatePlan(parsed, validIds);
  if (plan.length === 0) throw new Error("Manager output produced no valid tasks");
  return plan;
}

// Replan after a task failure. Manager sees the original plan, what completed,
// what failed and why, then emits a revised plan for the REMAINING work.
async function replanAfterFailure(
  project: Project,
  agents: Agent[],
  failed: { task: Task; reason: string },
  completed: PriorOutput[],
  remaining: Task[],
  deps: LiveOrchestratorDeps
): Promise<PlannedTask[] | null> {
  const manager = agents.find(a => a.id === "manager")!;
  const subAgents = agents.filter(a => a.id !== "manager");
  const validIds = new Set(subAgents.map(a => a.id));

  const agentList = subAgents.map(a => {
    const caps: string[] = (() => { try { return JSON.parse(a.capabilities); } catch { return []; } })();
    return `- ${a.id}: "${a.name}" — ${a.role}. Capabilities: ${caps.join(", ") || "general"}`;
  }).join("\n");

  const completedSummary = completed.length === 0
    ? "(none yet)"
    : completed.map(c => `- ${c.agent.name}: "${c.task.title}" ✓`).join("\n");

  const remainingSummary = remaining.length === 0
    ? "(none)"
    : remaining.map(r => `- "${r.title}" (assigned to ${r.assignedTo})`).join("\n");

  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You are the AI Office Manager performing a REPLAN after a task failure. Same JSON output format as before (array of task objects with key, title, description, assignedTo, priority, dependsOn). Only return tasks for the REMAINING work — do not repeat completed tasks. You may merge, drop, or reassign remaining tasks. Maximize parallelism.`,
    },
    {
      role: "user",
      content: `Team available:\n${agentList}\n\nProject: "${project.name}"\nDescription: ${project.description || "(no description)"}\n\nCompleted so far:\n${completedSummary}\n\nFailed task:\n- "${failed.task.title}" (was assigned to ${failed.task.assignedTo})\n  Reason: ${failed.reason}\n\nRemaining (currently planned but not yet executed):\n${remainingSummary}\n\nReturn a fresh JSON array describing how to finish the remaining work, accounting for the failure.`,
    },
  ];

  let text: string;
  try {
    text = await callManagerLLM(project, manager, messages, deps, "Replanning after failure");
  } catch (e) {
    deps.emitEvent(project.id, "manager", manager.name, "replan failed", `${(e as Error).message ?? e}`, "error");
    return null;
  }

  const parsed = extractJSON(text);
  const plan = validatePlan(parsed, validIds);
  return plan.length > 0 ? plan : null;
}

// ─── Worker execution ───────────────────────────────────────────────────────

async function runWorkerTask(
  project: Project,
  task: Task,
  agent: Agent,
  priorOutputs: PriorOutput[],
  deps: LiveOrchestratorDeps
): Promise<string> {
  const sharedContext = buildSharedContext(priorOutputs);

  // ── Cost-aware routing ──
  // The planner tagged each task with a complexity tier (low/medium/high).
  // Route to the cheapest model that meets the tier; fall back to the agent's
  // own configured model if no preferred provider has a key.
  const complexity = (task.complexity as Complexity) ?? "medium";
  const routed = routeForComplexity(complexity, agent);
  const apiKey = storage.getSetting(settingKeyForProvider(routed.provider));
  if (!apiKey) {
    throw new Error(`No API key configured for ${routed.provider} (needed for ${complexity}-tier task)`);
  }

  // Persist the actual model used so the dashboard reflects routing decisions.
  storage.updateTask(task.id, { modelUsed: routed.modelId });

  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `${agent.systemPrompt}\n\nYou are working as part of an AI team on the project "${project.name}". The Manager has assigned you a specific task. Produce a complete, professional deliverable. Be concrete: include code snippets, lists, tables, or structured output as appropriate. Do NOT include filler like "I'll start by..." — go straight to the deliverable.`,
    },
    {
      role: "user",
      content: `## Project\n**${project.name}** — priority: ${project.priority}\n\n${project.description || "(no description provided)"}\n\n${sharedContext}\n\n## Your Task\n**${task.title}** (priority: ${task.priority})\n\n${task.description}\n\nProduce the deliverable now.`,
    },
  ];

  // ── Stage 4.13 tool wiring ──
  // Research agents get Tavily web tools. We resolve them here so a missing
  // TAVILY_API_KEY surfaces as a single warning event instead of a per-call
  // 401 cascade.
  const toolNames = toolsForAgent(agent.id);
  const tools = toolNames.length > 0 && tavilyConfigured()
    ? resolveTools(toolNames)
    : [];
  if (toolNames.length > 0 && tools.length === 0) {
    deps.emitEvent(
      project.id, agent.id, agent.name, "tools disabled",
      "TAVILY_API_KEY not set — agent will run without web tools and may produce empty results", "warning"
    );
  }

  deps.setAgentStatus(agent.id, "working", task.title);
  deps.emitEvent(
    project.id, agent.id, agent.name, "started task",
    `[LIVE] ${routed.provider}/${routed.modelId} — ${task.title} (${complexity}${tools.length > 0 ? " · web tools on" : ""})`,
    "info"
  );

  const stream = makeStreamCoalescer(project.id, agent, task.title, deps);
  let result;
  try {
    result = await streamCompletion(
      {
        provider: routed.provider,
        modelId: routed.modelId,
        apiKey,
        messages,
        maxTokens: 3072,
        temperature: 0.7,
        tools: tools.length > 0 ? tools : undefined,
      },
      {
        onDelta: (d) => stream.push(d),
        onToolCall: ({ name, args, result }) => {
          // Surface tool activity in the live event feed so operators can see
          // exactly which queries / URLs the agent is hitting.
          let argSummary = args;
          try {
            const parsed = JSON.parse(args);
            if (parsed.query) argSummary = `"${String(parsed.query).slice(0, 120)}"`;
            else if (parsed.urls) argSummary = (parsed.urls as string[]).slice(0, 3).join(", ");
          } catch { /* keep raw args */ }
          const ok = !result.startsWith("Error:");
          deps.emitEvent(
            project.id, agent.id, agent.name,
            ok ? "used tool" : "tool error",
            `🔍 ${name}(${argSummary}) → ${result.length.toLocaleString()} chars`,
            ok ? "info" : "warning"
          );
        },
      }
    );
  } finally {
    stream.end();
  }

  const cost = recordUsage(agent, project.id, result.tokensIn, result.tokensOut, deps, { provider: routed.provider, modelId: routed.modelId });
  deps.emitEvent(
    project.id, agent.id, agent.name, "model response",
    `${result.tokensIn.toLocaleString()} in / ${result.tokensOut.toLocaleString()} out · $${cost.toFixed(4)} · ${routed.modelId}`,
    "info"
  );
  return result.text;
}

// Run a list of tasks under a concurrency cap. Returns successes + failures.
async function runWaveConcurrent(
  project: Project,
  tasksInWave: Task[],
  agents: Agent[],
  priorOutputs: PriorOutput[],
  deps: LiveOrchestratorDeps,
  waveIndex: number
): Promise<{ successes: PriorOutput[]; failures: { task: Task; reason: string }[] }> {
  const successes: PriorOutput[] = [];
  const failures: { task: Task; reason: string }[] = [];

  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= tasksInWave.length) return;
      const task = tasksInWave[idx];
      const agent = agents.find(a => a.id === task.assignedTo);
      if (!agent) {
        storage.updateTask(task.id, { status: "blocked", blockedReason: "Assignee not found" });
        deps.broadcast({ type: "task_update", task: { ...task, status: "blocked" } });
        failures.push({ task, reason: "Assignee not found" });
        continue;
      }
      storage.updateTask(task.id, { status: "in_progress" });
      deps.broadcast({ type: "task_update", task: { ...task, status: "in_progress", waveIndex } });
      try {
        const output = await runWorkerTask(project, task, agent, priorOutputs, deps);
        storage.updateTask(task.id, { status: "done" });
        deps.broadcast({ type: "task_update", task: { ...task, status: "done", waveIndex } });
        deps.setAgentStatus(agent.id, "done", null);
        deps.emitEvent(
          project.id, agent.id, agent.name, "completed task",
          `✓ Finished: ${task.title}`, "success"
        );
        await saveLiveOutput(project.id, task, agent, output, deps);
        successes.push({ task, agent, output });
        // Brief idle gap so the UI can settle the "done" pulse before reset
        setTimeout(() => deps.setAgentStatus(agent.id, "idle", null), 600);
      } catch (e) {
        const reason = (e as Error)?.message ?? String(e);
        storage.updateTask(task.id, { status: "blocked", blockedReason: reason });
        deps.broadcast({ type: "task_update", task: { ...task, status: "blocked", blockedReason: reason, waveIndex } });
        deps.setAgentStatus(agent.id, "blocked", task.title);
        deps.emitEvent(project.id, agent.id, agent.name, "blocked", reason, "error");
        failures.push({ task, reason });
      }
    }
  }

  // Spawn capped concurrent workers
  const N = Math.min(WAVE_CONCURRENCY, tasksInWave.length);
  await Promise.all(Array.from({ length: N }, () => worker()));

  return { successes, failures };
}

// ─── Orchestrator entry point ───────────────────────────────────────────────

export async function runLiveOrchestration(
  projectId: number,
  deps: LiveOrchestratorDeps
): Promise<void> {
  const project = storage.getProject(projectId);
  if (!project) return;
  const agents = storage.getAgents();
  const manager = agents.find(a => a.id === "manager");
  if (!manager) return;

  storage.updateProject(projectId, { status: "planning" });
  deps.broadcast({ type: "project_update", projectId, status: "planning" });

  // ── Phase 1: Manager plans ────────────────────────────────────────────
  let plan: PlannedTask[];
  try {
    plan = await planProjectLive(project, agents, deps);
  } catch (e) {
    deps.emitEvent(projectId, "manager", manager.name, "planning failed", `${(e as Error).message ?? e}`, "error");
    deps.setAgentStatus("manager", "idle", null);
    storage.updateProject(projectId, { status: "blocked" });
    deps.broadcast({ type: "project_update", projectId, status: "blocked" });
    return;
  }

  // ── Phase 2: Persist tasks with dependency metadata ───────────────────
  const waves = planWaves(plan);
  const keyToTaskId = new Map<string, number>();
  const keyToTask = new Map<string, Task>();
  const allCreated: Task[] = [];

  for (let wIdx = 0; wIdx < waves.length; wIdx++) {
    for (const planned of waves[wIdx]) {
      const dependsOnIds = planned.dependsOn
        .map(k => keyToTaskId.get(k))
        .filter((v): v is number => typeof v === "number");

      const created = storage.createTask({
        title: planned.title,
        description: planned.description,
        projectId,
        assignedTo: planned.assignedTo,
        assignedBy: "manager",
        status: "todo",
        priority: planned.priority,
        dependsOn: JSON.stringify(dependsOnIds),
        waveIndex: wIdx,
        complexity: planned.complexity,
      });
      keyToTaskId.set(planned.key, created.id);
      keyToTask.set(planned.key, created);
      allCreated.push(created);

      const assignee = agents.find(a => a.id === planned.assignedTo);
      const depLabel = dependsOnIds.length > 0 ? ` (after ${dependsOnIds.length} dep${dependsOnIds.length > 1 ? "s" : ""})` : "";
      deps.emitEvent(
        projectId, "manager", manager.name, "assigned task",
        `→ ${assignee?.name ?? planned.assignedTo}: "${planned.title}" [wave ${wIdx + 1}, ${planned.complexity}]${depLabel}`, "info"
      );
      deps.broadcast({ type: "task_created", task: created });
    }
  }

  storage.updateProject(projectId, {
    status: "active",
    tasksTotal: allCreated.length,
    tasksCompleted: 0,
  });
  deps.broadcast({ type: "project_update", projectId, status: "active", tasksTotal: allCreated.length });

  deps.setAgentStatus("manager", "working", "Monitoring team progress");
  deps.emitEvent(
    projectId, "manager", manager.name, "plan complete",
    `Delegated ${allCreated.length} tasks across ${new Set(allCreated.map(t => t.assignedTo)).size} agents in ${waves.length} wave${waves.length > 1 ? "s" : ""}`,
    "success"
  );

  // ── Phase 3: Run waves with optional replan on failure ────────────────
  const priorOutputs: PriorOutput[] = [];
  const allFailures: { task: Task; reason: string }[] = [];
  let completedCount = 0;
  let replansUsed = 0;

  // We work over a mutable list of "remaining waves" so a replan can replace it.
  let remainingWaves: Task[][] = waves.map(w => w.map(p => keyToTask.get(p.key)!).filter(Boolean));

  while (remainingWaves.length > 0) {
    const wave = remainingWaves.shift()!;
    if (wave.length === 0) continue;

    const waveIdx = waves.length - remainingWaves.length - 1; // best-effort label
    deps.emitEvent(
      projectId, "manager", manager.name, "wave start",
      `Wave ${waveIdx + 1}: ${wave.length} task${wave.length > 1 ? "s" : ""} running in parallel (cap ${WAVE_CONCURRENCY})`,
      "info"
    );

    const { successes, failures } = await runWaveConcurrent(project, wave, agents, priorOutputs, deps, waveIdx);
    priorOutputs.push(...successes);
    allFailures.push(...failures);
    completedCount += successes.length;

    // Update progress
    const total = allCreated.length;
    const progress = Math.round((completedCount / Math.max(1, total)) * 100);
    const usageRows = storage.getTokenUsage().filter(u => u.projectId === projectId);
    const tokensUsed = usageRows.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0);
    const costToday = parseFloat(usageRows.reduce((s, r) => s + r.costUsd, 0).toFixed(4));
    storage.updateProject(projectId, { progress, tasksCompleted: completedCount, tokensUsed, costToday });
    deps.broadcast({ type: "project_update", projectId, progress, tasksCompleted: completedCount, tokensUsed, costToday });

    // If anything failed AND we still have replans available, try once.
    if (failures.length > 0 && replansUsed < MAX_REPLANS && remainingWaves.length > 0) {
      replansUsed++;
      const flatRemaining = remainingWaves.flat();
      deps.emitEvent(
        projectId, "manager", manager.name, "replanning",
        `${failures.length} task${failures.length > 1 ? "s" : ""} failed — manager attempting replan ${replansUsed}/${MAX_REPLANS}`,
        "warning"
      );

      const newPlan = await replanAfterFailure(
        project, agents,
        failures[0], // pass the most informative failure
        priorOutputs, flatRemaining, deps
      );

      if (newPlan && newPlan.length > 0) {
        // Mark old remaining tasks as cancelled-by-replan (status: blocked w/ reason)
        for (const t of flatRemaining) {
          storage.updateTask(t.id, { status: "blocked", blockedReason: "Superseded by replan" });
          deps.broadcast({ type: "task_update", task: { ...t, status: "blocked", blockedReason: "Superseded by replan" } });
        }

        // Create the replanned tasks fresh
        const newWaves = planWaves(newPlan);
        const newKeyToTask = new Map<string, Task>();
        const newKeyToId = new Map<string, number>();
        for (let wIdx = 0; wIdx < newWaves.length; wIdx++) {
          for (const planned of newWaves[wIdx]) {
            const depIds = planned.dependsOn.map(k => newKeyToId.get(k)).filter((v): v is number => typeof v === "number");
            const created = storage.createTask({
              title: planned.title,
              description: planned.description,
              projectId,
              assignedTo: planned.assignedTo,
              assignedBy: "manager",
              status: "todo",
              priority: planned.priority,
              dependsOn: JSON.stringify(depIds),
              waveIndex: wIdx,
              complexity: planned.complexity,
            });
            newKeyToId.set(planned.key, created.id);
            newKeyToTask.set(planned.key, created);
            allCreated.push(created);
            deps.broadcast({ type: "task_created", task: created });
            const assignee = agents.find(a => a.id === planned.assignedTo);
            deps.emitEvent(
              projectId, "manager", manager.name, "replanned task",
              `→ ${assignee?.name ?? planned.assignedTo}: "${planned.title}" [replan wave ${wIdx + 1}]`, "info"
            );
          }
        }

        // Replace remaining waves with the replan
        remainingWaves = newWaves.map(w => w.map(p => newKeyToTask.get(p.key)!).filter(Boolean));
        storage.updateProject(projectId, { tasksTotal: allCreated.length });
        deps.broadcast({ type: "project_update", projectId, tasksTotal: allCreated.length });
      } else {
        deps.emitEvent(
          projectId, "manager", manager.name, "replan failed",
          "Manager could not produce a viable replan — continuing with remaining waves",
          "warning"
        );
      }
    }
  }

  // ── Phase 4: QA sign-off (only when every task finished cleanly) ──
  const total = allCreated.length;
  const allDone = allFailures.length === 0 && completedCount === total;

  if (allDone) {
    await runQaSignOff(projectId, agents, deps);
  } else {
    storage.updateProject(projectId, {
      status: "blocked",
      progress: Math.round((completedCount / Math.max(1, total)) * 100),
    });
    deps.broadcast({ type: "project_update", projectId, status: "blocked" });
    deps.emitEvent(
      projectId, "manager", manager.name, "project incomplete",
      `${completedCount}/${total} tasks completed — review blocked tasks`, "warning"
    );
    deps.setAgentStatus("manager", "idle", null);
  }
}

// ─── QA sign-off helper ─────────────────────────────────────────────────────
// Runs the QA agent against the original brief + delivered outputs. The verdict
// drives the project's final status: signed-off → "completed", otherwise the
// project goes "blocked" and the user can hit Resume after addressing issues.
async function runQaSignOff(
  projectId: number,
  agents: Agent[],
  deps: LiveOrchestratorDeps
): Promise<void> {
  const project = storage.getProject(projectId);
  if (!project) return;
  const qaAgent = agents.find(a => a.id === "qa");
  const manager = agents.find(a => a.id === "manager")!;
  if (!qaAgent) {
    // No QA agent configured — just mark complete without sign-off.
    storage.updateProject(projectId, { status: "completed", progress: 100 });
    deps.broadcast({ type: "project_update", projectId, status: "completed" });
    return;
  }

  storage.updateProject(projectId, { status: "qa_review" });
  deps.broadcast({ type: "project_update", projectId, status: "qa_review" });
  deps.emitEvent(projectId, "qa", qaAgent.name, "qa review", "Reviewing deliverables against original brief…", "info");
  deps.setAgentStatus("qa", "thinking", "Reviewing project");

  try {
    const verdict = await reviewProjectQA(project, qaAgent, deps, recordUsage);
    const finalStatus = verdict.signedOff ? "completed" : "blocked";
    storage.updateProject(projectId, { status: finalStatus, progress: 100 });
    deps.broadcast({ type: "project_update", projectId, status: finalStatus });
    deps.broadcast({ type: "qa_review", projectId, verdict });

    deps.emitEvent(
      projectId, "qa", qaAgent.name,
      verdict.signedOff ? "signed off" : "flagged issues",
      verdict.signedOff
        ? `✓ Project signed off — ${verdict.summary.slice(0, 140)}`
        : `✗ ${verdict.issues.length} issue${verdict.issues.length !== 1 ? "s" : ""} — recommendation: ${verdict.recommendation}`,
      verdict.signedOff ? "success" : "warning"
    );
    deps.setAgentStatus("qa", verdict.signedOff ? "done" : "idle", null);
    if (verdict.signedOff) {
      deps.emitEvent(projectId, "manager", manager.name, "project complete", "All deliverables signed off by QA ✓", "success");
      deps.setAgentStatus("manager", "done", "All tasks complete");
      setTimeout(() => deps.setAgentStatus("manager", "idle", null), 3000);
    } else {
      deps.setAgentStatus("manager", "idle", null);
    }
  } catch (e) {
    const reason = (e as Error)?.message ?? String(e);
    deps.emitEvent(projectId, "qa", qaAgent.name, "qa failed", reason, "error");
    // QA failure shouldn't sink a successful run — mark complete without sign-off.
    storage.updateProject(projectId, { status: "completed", progress: 100 });
    deps.broadcast({ type: "project_update", projectId, status: "completed" });
    deps.setAgentStatus("qa", "idle", null);
    deps.setAgentStatus("manager", "idle", null);
  }
}

// ─── Resume orchestration ───────────────────────────────────────────────────
//
// Re-runs blocked / todo tasks for an existing project, reusing previously
// completed task outputs as shared context. Wave structure is rebuilt from
// each task's existing `dependsOn` ids, so the parallelism shape from the
// original plan is preserved.
//
export async function resumeLiveOrchestration(
  projectId: number,
  deps: LiveOrchestratorDeps
): Promise<void> {
  const project = storage.getProject(projectId);
  if (!project) return;
  const agents = storage.getAgents();
  const manager = agents.find(a => a.id === "manager");
  if (!manager) return;

  const resumable = storage.getResumableTasks(projectId);
  if (resumable.length === 0) {
    deps.emitEvent(
      projectId, "manager", manager.name, "resume skipped",
      "No tasks to resume — project has nothing pending or blocked", "warning"
    );
    return;
  }

  // Reset blocked tasks back to "todo" so they re-run cleanly.
  for (const t of resumable) {
    if (t.status === "blocked" || t.status === "in_progress") {
      storage.updateTask(t.id, { status: "todo", blockedReason: null });
      deps.broadcast({ type: "task_update", task: { ...t, status: "todo", blockedReason: null } });
    }
  }

  // Reload after status reset.
  const tasksToRun = storage.getResumableTasks(projectId);

  // Rebuild waves from existing dependsOn ids. Tasks completed previously
  // satisfy any dependency they appear in, so they don't block resume tasks.
  const completedTaskIds = new Set(
    storage.getTasks(projectId)
      .filter(t => t.status === "done")
      .map(t => t.id)
  );
  const idToTask = new Map(tasksToRun.map(t => [t.id, t]));

  const parseDeps = (t: Task): number[] => {
    try {
      const arr = JSON.parse(t.dependsOn || "[]");
      return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === "number") : [];
    } catch { return []; }
  };

  // Topo sort the resume tasks into waves.
  const remaining = new Map(tasksToRun.map(t => [t.id, t]));
  const waves: Task[][] = [];
  let safety = 20;
  while (remaining.size > 0 && safety-- > 0) {
    const wave: Task[] = [];
    for (const t of Array.from(remaining.values())) {
      const taskDeps = parseDeps(t);
      // A dep is "satisfied" if it's already done, or it's not in the resume set
      // (which means it was completed before, or never existed).
      const blocked = taskDeps.some(depId => idToTask.has(depId) && remaining.has(depId) && !completedTaskIds.has(depId));
      if (!blocked) wave.push(t);
    }
    if (wave.length === 0) {
      // Cycle / unresolved dep — flush remainder as a final wave.
      wave.push(...Array.from(remaining.values()));
    }
    for (const t of wave) remaining.delete(t.id);
    waves.push(wave);
  }

  // Mark project active.
  storage.updateProject(projectId, { status: "active" });
  deps.broadcast({ type: "project_update", projectId, status: "active" });
  deps.emitEvent(
    projectId, "manager", manager.name, "resuming project",
    `Replaying ${tasksToRun.length} task${tasksToRun.length > 1 ? "s" : ""} across ${waves.length} wave${waves.length > 1 ? "s" : ""}`,
    "info"
  );
  deps.setAgentStatus("manager", "working", "Resuming team progress");

  // Seed prior outputs from previously completed tasks (reads from saved files).
  const priorOutputs: PriorOutput[] = [];
  for (const { task, output } of storage.getCompletedTasksWithFiles(projectId)) {
    const agent = agents.find(a => a.id === task.assignedTo);
    if (agent) priorOutputs.push({ task, agent, output });
  }

  // Run the waves.
  let completedCount = completedTaskIds.size;
  const allFailures: { task: Task; reason: string }[] = [];
  const total = storage.getTasks(projectId)
    .filter(t => t.blockedReason !== "Superseded by replan").length;

  for (let wIdx = 0; wIdx < waves.length; wIdx++) {
    const wave = waves[wIdx];
    if (wave.length === 0) continue;

    deps.emitEvent(
      projectId, "manager", manager.name, "wave start",
      `Resume wave ${wIdx + 1}: ${wave.length} task${wave.length > 1 ? "s" : ""} running in parallel (cap ${WAVE_CONCURRENCY})`,
      "info"
    );

    const { successes, failures } = await runWaveConcurrent(project, wave, agents, priorOutputs, deps, wIdx);
    priorOutputs.push(...successes);
    allFailures.push(...failures);
    completedCount += successes.length;

    const progress = Math.round((completedCount / Math.max(1, total)) * 100);
    const usageRows = storage.getTokenUsage().filter(u => u.projectId === projectId);
    const tokensUsed = usageRows.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0);
    const costToday = parseFloat(usageRows.reduce((s, r) => s + r.costUsd, 0).toFixed(4));
    storage.updateProject(projectId, { progress, tasksCompleted: completedCount, tokensUsed, costToday });
    deps.broadcast({ type: "project_update", projectId, progress, tasksCompleted: completedCount, tokensUsed, costToday });
  }

  // Wrap up — if everything finished cleanly, run QA sign-off; otherwise block.
  const allDone = allFailures.length === 0 && completedCount >= total;
  if (allDone) {
    await runQaSignOff(projectId, agents, deps);
  } else {
    storage.updateProject(projectId, {
      status: "blocked",
      progress: Math.round((completedCount / Math.max(1, total)) * 100),
    });
    deps.broadcast({ type: "project_update", projectId, status: "blocked" });
    deps.emitEvent(
      projectId, "manager", manager.name, "resume incomplete",
      `${completedCount}/${total} tasks completed after resume — review blocked tasks`, "warning"
    );
    deps.setAgentStatus("manager", "idle", null);
  }
}
