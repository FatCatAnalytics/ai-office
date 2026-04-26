// ─── Live AI Orchestrator ─────────────────────────────────────────────────────
// Stage 3: Real LLM calls drive the agent simulation.
//
// Flow:
//   1. Manager LLM call decomposes the project into ordered tasks (JSON).
//   2. Tasks are written to the DB and Kanban broadcast.
//   3. Worker tasks run sequentially. Each agent receives:
//        - their system prompt
//        - the project description
//        - prior task outputs (shared context, bounded)
//        - their assigned task
//      Streaming tokens are forwarded to the activity feed in real time.
//   4. Each completed task records token usage + cost (Budget tab) and saves
//      the agent output as a project file (FilesPage).
// ─────────────────────────────────────────────────────────────────────────────

import { storage } from "./storage";
import { streamCompletion, calculateCost, settingKeyForProvider, type Provider, type LLMMessage } from "./llm";
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

// Truncate a long string with an indicator, preserving start + end.
function trimToBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const headLen = Math.floor(budget * 0.65);
  const tailLen = budget - headLen - 30;
  return `${text.slice(0, headLen)}\n\n[... ${text.length - headLen - tailLen} chars truncated ...]\n\n${text.slice(-tailLen)}`;
}

// Build shared-context block from prior task outputs for this project.
function buildSharedContext(priorOutputs: Array<{ task: Task; agent: Agent; output: string }>): string {
  if (priorOutputs.length === 0) return "";

  // Allocate budget per prior output (most recent get more room)
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

  // Strip ```json ... ``` fence
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try { return JSON.parse(candidate) as T; } catch { /* fall through */ }

  // Find the first balanced JSON object/array in the string
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

// Resolve an agent's API key and validate provider/model.
function resolveAgentKey(agent: Agent): { apiKey: string; provider: Provider } {
  const provider = (agent.provider as Provider) ?? "anthropic";
  const key = storage.getSetting(settingKeyForProvider(provider));
  if (!key) {
    throw new Error(`No API key configured for ${provider} (${agent.name})`);
  }
  return { apiKey: key, provider };
}

// Record token usage + persist + broadcast budget update.
function recordUsage(
  agent: Agent,
  projectId: number,
  tokensIn: number,
  tokensOut: number,
  deps: LiveOrchestratorDeps
): number {
  const costUsd = calculateCost(agent.modelId, tokensIn, tokensOut);
  storage.recordTokenUsage({
    provider: agent.provider,
    modelId: agent.modelId,
    agentId: agent.id,
    projectId,
    tokensIn,
    tokensOut,
    costUsd,
  });
  deps.broadcast({ type: "budget_update", summary: storage.getBudgetSummary() });
  return costUsd;
}

// File-extension lookup matching Stage 2's FILE_TEMPLATES set.
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

// Persist live agent output as one or more files matching project format prefs.
function saveLiveOutput(
  projectId: number,
  task: Task,
  agent: Agent,
  rawOutput: string,
  deps: LiveOrchestratorDeps
): void {
  const project = storage.getProject(projectId);
  if (!project) return;

  let formats: string[];
  try { formats = JSON.parse(project.outputFormats ?? "[]"); } catch { formats = []; }
  if (formats.length === 0) {
    formats = [AGENT_DEFAULT_FORMAT[agent.id] ?? AGENT_DEFAULT_FORMAT[agent.spriteType] ?? "markdown"];
  }

  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);

  for (const fmt of formats) {
    const meta = EXT_BY_FORMAT[fmt];
    if (!meta) continue;

    let content = rawOutput;
    // For structured formats, extract just the relevant block from the LLM output
    if (fmt === "json") {
      const parsed = extractJSON(rawOutput);
      if (parsed) content = JSON.stringify(parsed, null, 2);
    } else if (fmt === "csv") {
      // Extract first ```csv``` fence or any ``` fenced block; otherwise use as-is.
      const fenceCsv = rawOutput.match(/```(?:csv)?\s*([\s\S]*?)```/);
      if (fenceCsv) content = fenceCsv[1].trim();
    } else if (fmt === "python") {
      const fencePy = rawOutput.match(/```(?:python|py)?\s*([\s\S]*?)```/);
      if (fencePy) content = fencePy[1].trim();
    } else if (fmt === "markdown") {
      // Add a small live-mode header so the saved file is self-describing
      content = `# ${task.title}\n\n**Project:** ${project.name}  \n**Agent:** ${agent.name} (\`${agent.modelId}\`)  \n**Mode:** Live AI  \n**Completed:** ${new Date().toLocaleString()}\n\n---\n\n${rawOutput.trim()}\n`;
    } else if (fmt === "pdf") {
      // We don't generate real PDFs in Stage 3; write a text PDF placeholder
      // with the live content embedded so it remains useful.
      content = `%PDF-1.4\n% AI Office — Live output\n% Project: ${project.name}\n% Task: ${task.title}\n% Agent: ${agent.name} (${agent.modelId})\n% Generated: ${new Date().toISOString()}\n\n${rawOutput.trim()}\n`;
    } else if (fmt === "excel") {
      // Same caveat — Stage 3 does not create real .xlsx; store as plain text
      // with a clear note. (Stage 4 todo: ship exceljs integration.)
      content = `AI Office live output — placeholder XLSX\nProject: ${project.name}\nTask: ${task.title}\nAgent: ${agent.name} (${agent.modelId})\n\n${rawOutput.trim()}`;
    }

    try {
      const filename = `${slug}_${agent.id}.${meta.ext}`;
      const saved = storage.saveProjectFile(
        {
          projectId,
          taskId: task.id,
          agentId: agent.id,
          filename,
          fileType: fmt,
          mimeType: meta.mime,
          filePath: "",
          description: `${agent.name}: ${task.title}`,
        },
        content
      );
      deps.broadcast({ type: "file_created", projectId, file: saved });
      deps.emitEvent(
        projectId, agent.id, agent.name, "saved file",
        `📄 ${saved.filename} (${(saved.sizeBytes / 1024).toFixed(1)} KB)`, "success"
      );
    } catch (e) {
      console.error("[live] file save error:", e);
    }
  }
}

// Stream-broadcast helper. Coalesces tiny token deltas (every ~50 chars or
// 250ms) into "stream" events to keep the activity feed readable.
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
      type: "stream",
      projectId,
      agentId: agent.id,
      agentName: agent.name,
      taskTitle,
      delta: buffer,
    });
    buffer = "";
    lastFlush = now;
  }

  return {
    push(delta: string) {
      buffer += delta;
      flush(false);
    },
    end() { flush(true); },
  };
}

// ─── Manager planner ────────────────────────────────────────────────────────
// Calls the Manager LLM to break the project into 3-9 ordered tasks, each
// assigned to a specific sub-agent by ID. Falls back to capability-based
// planning on parse failure or LLM error.

interface PlannedTask {
  title: string;
  description: string;
  assignedTo: string;
  priority: "critical" | "high" | "normal" | "low";
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
      content: `You are the AI Office Manager. You receive a project and break it into 3-9 concrete, ordered tasks. Each task is assigned to exactly ONE agent on your team based on their capabilities. You must respond with ONLY a JSON array — no prose, no markdown fences. Each entry must be:\n{\n  "title": "<short imperative title, max 70 chars>",\n  "description": "<one paragraph describing what should be done and what the deliverable looks like>",\n  "assignedTo": "<exact agent id from the team list>",\n  "priority": "critical" | "high" | "normal" | "low"\n}\n\nOrdering rules:\n- Put discovery / planning / requirements tasks FIRST.\n- Put design / architecture tasks BEFORE implementation.\n- Put implementation BEFORE testing.\n- Put testing BEFORE deployment.\n- The "manager" agent does NOT receive sub-tasks — they only orchestrate.`,
    },
    {
      role: "user",
      content: `Team available:\n${agentList}\n\nProject: "${project.name}"\nDescription: ${project.description || "(no description provided)"}\nPriority: ${project.priority}${formatLine}\n\nReturn the JSON array of tasks now.`,
    },
  ];
}

async function planProjectLive(
  project: Project,
  agents: Agent[],
  deps: LiveOrchestratorDeps
): Promise<PlannedTask[]> {
  const manager = agents.find(a => a.id === "manager");
  if (!manager) throw new Error("Manager agent not found");

  const subAgents = agents.filter(a => a.id !== "manager");
  const { apiKey, provider } = resolveAgentKey(manager);

  deps.setAgentStatus("manager", "thinking", "Planning project tasks");
  deps.emitEvent(
    project.id, "manager", manager.name,
    "calling LLM",
    `[LIVE] ${provider}/${manager.modelId} — decomposing "${project.name}"`,
    "info"
  );

  const messages = buildManagerPrompt(project, subAgents);
  const stream = makeStreamCoalescer(project.id, manager, "Planning tasks", deps);

  let result;
  try {
    result = await streamCompletion(
      { provider, modelId: manager.modelId, apiKey, messages, maxTokens: 2048, temperature: 0.4 },
      { onDelta: (d) => stream.push(d) }
    );
  } catch (e: any) {
    stream.end();
    throw new Error(`Manager LLM call failed: ${e?.message ?? e}`);
  }
  stream.end();

  recordUsage(manager, project.id, result.tokensIn, result.tokensOut, deps);

  const parsed = extractJSON<PlannedTask[]>(result.text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Manager output was not a valid JSON array of tasks");
  }

  // Validate + sanitise each task
  const validIds = new Set(subAgents.map(a => a.id));
  const cleaned: PlannedTask[] = [];
  for (const t of parsed) {
    if (!t || typeof t !== "object") continue;
    const title = String(t.title ?? "").trim().slice(0, 200);
    const description = String(t.description ?? "").trim();
    const assignedTo = validIds.has(String(t.assignedTo)) ? String(t.assignedTo) : subAgents[0]?.id;
    const priority = ["critical", "high", "normal", "low"].includes(t.priority as string)
      ? (t.priority as PlannedTask["priority"])
      : "normal";
    if (title && assignedTo) cleaned.push({ title, description, assignedTo, priority });
  }
  if (cleaned.length === 0) throw new Error("No valid tasks parsed from Manager output");

  return cleaned;
}

// ─── Worker execution ───────────────────────────────────────────────────────
// Run a single task with a sub-agent. Streams output, records usage, saves files.

async function runWorkerTask(
  project: Project,
  task: Task,
  agent: Agent,
  priorOutputs: Array<{ task: Task; agent: Agent; output: string }>,
  deps: LiveOrchestratorDeps
): Promise<string> {
  const { apiKey, provider } = resolveAgentKey(agent);

  const sharedContext = buildSharedContext(priorOutputs);

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

  deps.setAgentStatus(agent.id, "working", task.title);
  deps.emitEvent(
    project.id, agent.id, agent.name, "started task",
    `[LIVE] ${provider}/${agent.modelId} — ${task.title}`,
    "info"
  );

  const stream = makeStreamCoalescer(project.id, agent, task.title, deps);

  let result;
  try {
    result = await streamCompletion(
      { provider, modelId: agent.modelId, apiKey, messages, maxTokens: 3072, temperature: 0.7 },
      { onDelta: (d) => stream.push(d) }
    );
  } catch (e: any) {
    stream.end();
    throw new Error(`${agent.name} LLM call failed: ${e?.message ?? e}`);
  }
  stream.end();

  const cost = recordUsage(agent, project.id, result.tokensIn, result.tokensOut, deps);
  deps.emitEvent(
    project.id, agent.id, agent.name, "model response",
    `${result.tokensIn.toLocaleString()} in / ${result.tokensOut.toLocaleString()} out · $${cost.toFixed(4)}`,
    "info"
  );

  return result.text;
}

// ─── Orchestrator entry point ───────────────────────────────────────────────
// Replaces simulation when agent_mode === "live" and the Manager has an API key.

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
  let plans: PlannedTask[];
  try {
    plans = await planProjectLive(project, agents, deps);
  } catch (e: any) {
    deps.emitEvent(
      projectId, "manager", manager.name, "planning failed",
      `${e?.message ?? e}`, "error"
    );
    deps.setAgentStatus("manager", "idle", null);
    storage.updateProject(projectId, { status: "blocked" });
    deps.broadcast({ type: "project_update", projectId, status: "blocked" });
    return;
  }

  // ── Phase 2: Persist tasks ────────────────────────────────────────────
  const createdTasks: Task[] = [];
  for (const plan of plans) {
    const task = storage.createTask({
      title: plan.title,
      description: plan.description,
      projectId,
      assignedTo: plan.assignedTo,
      assignedBy: "manager",
      status: "todo",
      priority: plan.priority,
    });
    createdTasks.push(task);
    const assignee = agents.find(a => a.id === plan.assignedTo);
    deps.emitEvent(
      projectId, "manager", manager.name, "assigned task",
      `→ ${assignee?.name ?? plan.assignedTo}: "${plan.title}"`, "info"
    );
    deps.broadcast({ type: "task_created", task });
  }

  storage.updateProject(projectId, {
    status: "active",
    tasksTotal: createdTasks.length,
    tasksCompleted: 0,
  });
  deps.broadcast({ type: "project_update", projectId, status: "active", tasksTotal: createdTasks.length });

  deps.setAgentStatus("manager", "working", "Monitoring team progress");
  deps.emitEvent(
    projectId, "manager", manager.name, "plan complete",
    `Delegated ${createdTasks.length} tasks across ${new Set(createdTasks.map(t => t.assignedTo)).size} agents`,
    "success"
  );

  // ── Phase 3: Run tasks sequentially with shared context ───────────────
  const priorOutputs: Array<{ task: Task; agent: Agent; output: string }> = [];
  let completedCount = 0;

  for (const task of createdTasks) {
    const agent = agents.find(a => a.id === task.assignedTo);
    if (!agent) {
      storage.updateTask(task.id, { status: "blocked", blockedReason: "Assignee not found" });
      deps.broadcast({ type: "task_update", task: { ...task, status: "blocked" } });
      continue;
    }

    storage.updateTask(task.id, { status: "in_progress" });
    deps.broadcast({ type: "task_update", task: { ...task, status: "in_progress" } });

    let output: string;
    try {
      output = await runWorkerTask(project, task, agent, priorOutputs, deps);
    } catch (e: any) {
      const reason = e?.message ?? String(e);
      storage.updateTask(task.id, { status: "blocked", blockedReason: reason });
      deps.broadcast({ type: "task_update", task: { ...task, status: "blocked", blockedReason: reason } });
      deps.setAgentStatus(agent.id, "blocked", task.title);
      deps.emitEvent(projectId, agent.id, agent.name, "blocked", reason, "error");
      // Continue with remaining tasks rather than aborting the whole project
      continue;
    }

    // Persist completion + outputs
    storage.updateTask(task.id, { status: "done" });
    const completedTask = { ...task, status: "done" as const };
    deps.broadcast({ type: "task_update", task: completedTask });

    deps.setAgentStatus(agent.id, "done", null);
    deps.emitEvent(
      projectId, agent.id, agent.name, "completed task",
      `✓ Finished: ${task.title}`, "success"
    );

    saveLiveOutput(projectId, task, agent, output, deps);
    priorOutputs.push({ task, agent, output });

    completedCount++;
    const progress = Math.round((completedCount / createdTasks.length) * 100);

    // Aggregate token totals from this project's runs for project stats
    const usageRows = storage.getTokenUsage().filter(u => u.projectId === projectId);
    const tokensUsed = usageRows.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0);
    const costToday = parseFloat(usageRows.reduce((s, r) => s + r.costUsd, 0).toFixed(4));

    storage.updateProject(projectId, {
      progress,
      tasksCompleted: completedCount,
      tokensUsed,
      costToday,
    });
    deps.broadcast({ type: "project_update", projectId, progress, tasksCompleted: completedCount, tokensUsed, costToday });

    // Brief idle gap so the UI can settle the "done" pulse before the next agent lights up
    await new Promise(r => setTimeout(r, 600));
    deps.setAgentStatus(agent.id, "idle", null);
  }

  // ── Phase 4: Wrap up ─────────────────────────────────────────────────
  const finalStatus = completedCount === createdTasks.length ? "completed" : "blocked";
  storage.updateProject(projectId, {
    status: finalStatus,
    progress: Math.round((completedCount / createdTasks.length) * 100),
  });
  deps.broadcast({ type: "project_update", projectId, status: finalStatus });

  if (finalStatus === "completed") {
    deps.emitEvent(
      projectId, "manager", manager.name, "project complete",
      `All ${completedCount} tasks delivered — project marked done ✓`, "success"
    );
    deps.setAgentStatus("manager", "done", "All tasks complete");
    setTimeout(() => deps.setAgentStatus("manager", "idle", null), 3000);
  } else {
    deps.emitEvent(
      projectId, "manager", manager.name, "project incomplete",
      `${completedCount}/${createdTasks.length} tasks completed — review blocked tasks`, "warning"
    );
    deps.setAgentStatus("manager", "idle", null);
  }
}
