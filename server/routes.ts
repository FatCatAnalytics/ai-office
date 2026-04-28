import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import type { Agent, Task, Project } from "@shared/schema";
import { runLiveOrchestration, resumeLiveOrchestration, cancelProject, isProjectRunning } from "./liveOrchestrator";
import { refreshAllProviders } from "./modelsRefresh";
import { handleLogin, handleLogout, handleMe, isWsUpgradeAuthenticated } from "./auth";

// ─── WebSocket broadcast ───────────────────────────────────────────────────────
const wsClients = new Set<WebSocket>();

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ─── Manager Orchestration Engine ─────────────────────────────────────────────
// When a project is submitted, the Manager:
//   1. Plans tasks based on project description + agent capabilities
//   2. Creates real Task rows in DB, assigned to agents
//   3. Runs a simulation timeline: agents work, report back, manager reviews
//   4. Manager can reassign blocked tasks
// ─────────────────────────────────────────────────────────────────────────────

let activeSimulation: NodeJS.Timeout | null = null;
let currentProjectId: number | null = null;

function clearSim() {
  if (activeSimulation) {
    clearTimeout(activeSimulation);
    activeSimulation = null;
  }
}

// Generate tasks for a project based on available agents and project description
function planProjectTasks(project: Project, agents: Agent[]): Array<{
  title: string;
  description: string;
  assignedTo: string;
  priority: "critical" | "high" | "normal" | "low";
}> {
  const subAgents = agents.filter((a) => a.id !== "manager");

  // Capability-based task planning
  const taskTemplates: Array<{
    capability: string;
    title: string;
    descFn: (p: Project) => string;
    priority: "critical" | "high" | "normal" | "low";
  }> = [
    {
      capability: "product",
      title: "Define requirements & user stories",
      descFn: (p) => `Break down "${p.name}" into user stories, acceptance criteria and success metrics.`,
      priority: "critical",
    },
    {
      capability: "design",
      title: "Create wireframes & design system",
      descFn: (p) => `Design UI wireframes, component library and design tokens for "${p.name}".`,
      priority: "high",
    },
    {
      capability: "schema-design",
      title: "Design database schema",
      descFn: (p) => `Design normalized schema, relationships and migration plan for "${p.name}".`,
      priority: "high",
    },
    {
      capability: "react",
      title: "Build frontend components",
      descFn: (p) => `Implement React components, routing and state management for "${p.name}".`,
      priority: "normal",
    },
    {
      capability: "api",
      title: "Implement backend API",
      descFn: (p) => `Build REST/GraphQL endpoints, middleware and business logic for "${p.name}".`,
      priority: "normal",
    },
    {
      capability: "security",
      title: "Security review & hardening",
      descFn: (p) => `Threat modeling, auth review, dependency audit and OWASP checks for "${p.name}".`,
      priority: "high",
    },
    {
      capability: "ml",
      title: "Analytics & instrumentation",
      descFn: (p) => `Define KPIs, implement tracking, build dashboards and reports for "${p.name}".`,
      priority: "normal",
    },
    {
      capability: "testing",
      title: "QA & integration tests",
      descFn: (p) => `Write unit tests, integration tests and E2E test suite for "${p.name}".`,
      priority: "normal",
    },
    {
      capability: "ci-cd",
      title: "CI/CD pipeline & deployment",
      descFn: (p) => `Set up GitHub Actions, Docker, staging and production deployment for "${p.name}".`,
      priority: "normal",
    },
  ];

  const assignedTasks: Array<{
    title: string;
    description: string;
    assignedTo: string;
    priority: "critical" | "high" | "normal" | "low";
  }> = [];

  for (const tmpl of taskTemplates) {
    // Find an agent with this capability
    const capable = subAgents.find((a) => {
      const caps: string[] = JSON.parse(a.capabilities || "[]");
      return caps.includes(tmpl.capability);
    });
    if (capable) {
      assignedTasks.push({
        title: tmpl.title,
        description: tmpl.descFn(project),
        assignedTo: capable.id,
        priority: tmpl.priority,
      });
    }
  }

  // If very few agents, fallback: assign to available subagents round-robin
  if (assignedTasks.length === 0 && subAgents.length > 0) {
    const fallbackTasks = [
      "Analyse requirements and plan approach",
      "Implement core functionality",
      "Review and test implementation",
    ];
    fallbackTasks.forEach((t, i) => {
      assignedTasks.push({
        title: t,
        description: `${t} for "${project.name}"`,
        assignedTo: subAgents[i % subAgents.length].id,
        priority: "normal",
      });
    });
  }

  return assignedTasks;
}

// Post a WebSocket event + persist to DB
function emitEvent(
  projectId: number,
  agentId: string,
  agentName: string,
  action: string,
  detail: string,
  status: "info" | "success" | "warning" | "error" = "info"
) {
  const event = storage.createEvent({
    projectId,
    agentId,
    agentName,
    action,
    detail,
    status,
    timestamp: Date.now(),
  });
  broadcast({ type: "event", event });
  return event;
}

// Update agent status in DB + broadcast
function setAgentStatus(
  agentId: string,
  status: "idle" | "working" | "thinking" | "blocked" | "done",
  currentTask: string | null = null
) {
  storage.updateAgent(agentId, { status, currentTask });
  broadcast({ type: "agent_update", agentId, status, currentTask });
}

// Main simulation: Manager orchestrates tasks through the team
function runManagerOrchestration(projectId: number) {
  clearSim();
  currentProjectId = projectId;

  const project = storage.getProject(projectId);
  if (!project) return;
  const agents = storage.getAgents();
  const manager = agents.find((a) => a.id === "manager");
  if (!manager) return;

  // Check agent mode — "live" runs real AI calls (Stage 3); simulation uses mocks
  const agentMode = storage.getSetting("agent_mode") ?? "simulation";
  const managerKeySetting = `${manager.provider}_api_key`;
  const managerKey = storage.getSetting(managerKeySetting);
  const isLiveMode = agentMode === "live" && !!managerKey;

  // Phase 0: Manager starts planning
  setAgentStatus("manager", "thinking", "Analysing project requirements");
  emitEvent(projectId, "manager", manager.name, "received project",
    isLiveMode
      ? `[LIVE] ${manager.provider}/${manager.modelId} — analysing "${project.name}" with real AI...`
      : `[SIM] Analysing "${project.name}" — breaking down into tasks for the team`, "info");

  // ── Live mode: hand off to the live orchestrator ─────────────────────
  if (isLiveMode) {
    runLiveOrchestration(projectId, {
      broadcast,
      emitEvent,
      setAgentStatus,
      generateSimulatedFiles,
    }).catch((err) => {
      console.error("[live] orchestration error:", err);
      emitEvent(projectId, "manager", manager.name, "orchestration error",
        String(err?.message ?? err), "error");
      setAgentStatus("manager", "idle", null);
      storage.updateProject(projectId, { status: "blocked" });
      broadcast({ type: "project_update", projectId, status: "blocked" });
    });
    return;
  }

  // ── Simulation mode (Stage 2 path) ──────────────────────────────────
  if (agentMode === "live" && !managerKey) {
    emitEvent(projectId, "manager", manager.name, "missing API key",
      `Live mode requires a ${manager.provider} API key — falling back to simulation. Add a key in Settings.`,
      "warning");
  }

  storage.updateProject(projectId, { status: "planning" });
  broadcast({ type: "project_update", projectId, status: "planning" });

  // Phase 1: Plan and create tasks (with delay to simulate thinking)
  activeSimulation = setTimeout(() => {
    const taskPlans = planProjectTasks(project, agents);
    const createdTasks: Task[] = [];

    for (const plan of taskPlans) {
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

      const assignee = agents.find((a) => a.id === plan.assignedTo);
      emitEvent(projectId, "manager", manager.name, "assigned task",
        `→ ${assignee?.name ?? plan.assignedTo}: "${plan.title}"`, "info");
      broadcast({ type: "task_created", task });
    }

    // Update project task total
    storage.updateProject(projectId, {
      status: "active",
      tasksTotal: createdTasks.length,
      tasksCompleted: 0,
    });
    broadcast({ type: "project_update", projectId, status: "active", tasksTotal: createdTasks.length });

    setAgentStatus("manager", "working", "Monitoring team progress");
    emitEvent(projectId, "manager", manager.name, "plan complete",
      `Delegated ${createdTasks.length} tasks across ${new Set(createdTasks.map(t => t.assignedTo)).size} agents`, "success");

    // Phase 2: Run tasks in waves
    runTaskWaves(projectId, createdTasks, agents);
  }, 2500 + Math.random() * 1500);
}

function runTaskWaves(projectId: number, tasks: Task[], agents: Agent[]) {
  const priorities = ["critical", "high", "normal", "low"];
  let completedCount = 0;
  const totalTasks = tasks.length;

  // Group tasks by priority order
  const ordered = [...tasks].sort((a, b) =>
    priorities.indexOf(a.priority) - priorities.indexOf(b.priority)
  );

  let waveIndex = 0;

  // Process tasks one at a time with delays to simulate real work
  function processNextTask() {
    if (waveIndex >= ordered.length) {
      // All tasks done — project complete
      allTasksDone(projectId, agents);
      return;
    }

    const task = ordered[waveIndex];
    waveIndex++;

    const assignee = agents.find((a) => a.id === task.assignedTo);
    const agentName = assignee?.name ?? task.assignedTo;

    // Mark task in_progress
    storage.updateTask(task.id, { status: "in_progress" });
    broadcast({ type: "task_update", task: { ...task, status: "in_progress" } });

    setAgentStatus(task.assignedTo, "working", task.title);
    emitEvent(projectId, task.assignedTo, agentName, "started task",
      `Working on: ${task.title}`, "info");

    // Simulate work duration based on priority
    const durations: Record<string, number> = {
      critical: 4000 + Math.random() * 3000,
      high: 3000 + Math.random() * 2500,
      normal: 2000 + Math.random() * 2000,
      low: 1500 + Math.random() * 1500,
    };
    const workTime = durations[task.priority] ?? 3000;

    // 15% chance of a blocking event
    const willBlock = Math.random() < 0.15;

    if (willBlock) {
      activeSimulation = setTimeout(() => {
        const blockReason = randomBlockReason();
        storage.updateTask(task.id, { status: "blocked", blockedReason: blockReason });
        broadcast({ type: "task_update", task: { ...task, status: "blocked", blockedReason: blockReason } });

        setAgentStatus(task.assignedTo, "blocked", task.title);
        emitEvent(projectId, task.assignedTo, agentName, "blocked",
          `Blocked: ${blockReason}`, "warning");

        // Manager notices and reassigns after a moment
        activeSimulation = setTimeout(() => {
          const manager = agents.find((a) => a.id === "manager");
          emitEvent(projectId, "manager", manager?.name ?? "Manager Agent", "detected block",
            `${agentName} is blocked — unblocking and reassigning`, "warning");

          setAgentStatus(task.assignedTo, "idle", null);

          // Unblock: reset to in_progress and retry
          storage.updateTask(task.id, { status: "in_progress", blockedReason: null });
          broadcast({ type: "task_update", task: { ...task, status: "in_progress" } });

          setAgentStatus(task.assignedTo, "working", task.title);
          emitEvent(projectId, task.assignedTo, agentName, "resumed",
            `Unblocked — resuming "${task.title}"`, "info");

          // Complete after additional time
          activeSimulation = setTimeout(() => {
            completeTask(projectId, task, agentName, agents, ++completedCount, totalTasks);
            processNextTask();
          }, workTime * 0.7);
        }, 2000 + Math.random() * 1500);
      }, workTime * 0.4);
    } else {
      activeSimulation = setTimeout(() => {
        completedCount++;
        completeTask(projectId, task, agentName, agents, completedCount, totalTasks);
        processNextTask();
      }, workTime);
    }
  }

  processNextTask();
}

// Approximate cost per 1K tokens by model (USD) — used for simulation estimates
const MODEL_COST_PER_1K: Record<string, { in: number; out: number }> = {
  "claude-opus-4-7":   { in: 0.015,   out: 0.075 },
  "claude-sonnet-4-6": { in: 0.003,   out: 0.015 },
  "claude-haiku-4-5":  { in: 0.001,   out: 0.005 },
  "gpt-4.1":           { in: 0.002,   out: 0.008 },
  "gpt-4.1-mini":      { in: 0.0004,  out: 0.0016 },
  "o4-mini":           { in: 0.0011,  out: 0.0044 },
  "o3":                { in: 0.01,    out: 0.04 },
  "gemini-2.5-pro":    { in: 0.00125, out: 0.005 },
  "gemini-2.5-flash":  { in: 0.00015, out: 0.0006 },
  "gemini-2.0-flash":  { in: 0.0001,  out: 0.0004 },
  "moonshot-v1-128k":  { in: 0.0012,  out: 0.0012 },
  "moonshot-v1-32k":   { in: 0.0008,  out: 0.0008 },
};

function recordSimulatedTokens(agent: Agent, projectId: number) {
  const tokensIn  = Math.floor(800  + Math.random() * 3200);
  const tokensOut = Math.floor(200  + Math.random() * 1800);
  const rates = MODEL_COST_PER_1K[agent.modelId] ?? { in: 0.002, out: 0.008 };
  const costUsd = parseFloat(((tokensIn / 1000) * rates.in + (tokensOut / 1000) * rates.out).toFixed(6));
  storage.recordTokenUsage({
    provider: agent.provider,
    modelId: agent.modelId,
    agentId: agent.id,
    projectId,
    tokensIn,
    tokensOut,
    costUsd,
  });
  broadcast({ type: "budget_update", summary: storage.getBudgetSummary() });
}

// ── Simulation file generation ─────────────────────────────────────────────────────────
const FILE_TEMPLATES: Record<string, { ext: string; mime: string; generate: (task: Task, agent: Agent, project: Project) => string }> = {
  pdf: {
    ext: "pdf", mime: "application/pdf",
    generate: (task, agent, project) =>
      `%PDF-1.4\n% Simulated output — ${project.name}\n% Task: ${task.title}\n% Agent: ${agent.name} (${agent.modelId})\n% Generated: ${new Date().toISOString()}\n\nExecutive Summary\n=================\n${task.description || task.title}\n\nThis document was generated by ${agent.name} as part of the "${project.name}" project.\nIn live mode this would contain the actual AI-generated content.\n`,
  },
  csv: {
    ext: "csv", mime: "text/csv",
    generate: (task, agent, project) =>
      `project,task,agent,model,status,created_at\n"${project.name}","${task.title}","${agent.name}","${agent.modelId}","done","${new Date().toISOString()}"\n"Sample row 1","data point A","${agent.name}","","",""\n"Sample row 2","data point B","${agent.name}","","",""\n`,
  },
  excel: {
    ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    generate: (task, agent, project) =>
      `Placeholder XLSX: ${project.name} / ${task.title} by ${agent.name}. Install exceljs in Stage 3 for real output.`,
  },
  python: {
    ext: "py", mime: "text/x-python",
    generate: (task, agent, project) =>
      `# ${task.title}\n# Project: ${project.name}\n# Agent: ${agent.name} (${agent.modelId})\n# Generated: ${new Date().toISOString()}\n\n"""
${task.description || task.title}\n"""
\nimport os\nimport json\nfrom typing import Any, Dict, List, Optional\n\n\ndef main() -> None:\n    """Entry point — replace with actual implementation in live mode."""\n    print(f"Running task: ${task.title}")\n    # TODO: implement real logic using live AI output\n\n\nif __name__ == "__main__":\n    main()\n`,
  },
  json: {
    ext: "json", mime: "application/json",
    generate: (task, agent, project) =>
      JSON.stringify({ project: project.name, task: task.title, agent: agent.name, model: agent.modelId, status: "done", output: "Simulated output — real content generated in live mode", timestamp: new Date().toISOString() }, null, 2),
  },
  markdown: {
    ext: "md", mime: "text/markdown",
    generate: (task, agent, project) =>
      `# ${task.title}\n\n**Project:** ${project.name}  \n**Agent:** ${agent.name} (\`${agent.modelId}\`)  \n**Completed:** ${new Date().toLocaleString()}\n\n## Summary\n\n${task.description || task.title}\n\n## Notes\n\nThis file was generated by the simulation engine. In live mode, ${agent.name} would produce actual AI-generated content here based on the task requirements.\n\n---\n*Generated by AI Office — ${project.name}*\n`,
  },
};

// Map agent roles to most-relevant output types
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

function generateSimulatedFiles(projectId: number, task: Task, agent: Agent): void {
  const project = storage.getProject(projectId);
  if (!project) return;

  // Determine which formats to generate
  let formats: string[];
  try { formats = JSON.parse(project.outputFormats ?? "[]"); } catch { formats = []; }
  if (formats.length === 0) {
    // Fall back to agent-role default
    formats = [AGENT_DEFAULT_FORMAT[agent.id] ?? AGENT_DEFAULT_FORMAT[agent.spriteType] ?? "markdown"];
  }

  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);

  for (const fmt of formats) {
    const tmpl = FILE_TEMPLATES[fmt];
    if (!tmpl) continue;
    try {
      const content = tmpl.generate(task, agent, project);
      const filename = `${slug}_${agent.id}.${tmpl.ext}`;
      const saved = storage.saveProjectFile(
        { projectId, taskId: task.id, agentId: agent.id, filename, fileType: fmt, mimeType: tmpl.mime, filePath: "", description: `${agent.name}: ${task.title}` },
        content
      );
      broadcast({ type: "file_created", projectId, file: saved });
      emitEvent(projectId, agent.id, agent.name, "saved file",
        `📄 ${saved.filename} (${(saved.sizeBytes / 1024).toFixed(1)} KB)`, "success");
    } catch (e) {
      console.error("[sim] file gen error:", e);
    }
  }
}

function completeTask(
  projectId: number,
  task: Task,
  agentName: string,
  agents: Agent[],
  completedCount: number,
  totalTasks: number
) {
  storage.updateTask(task.id, { status: "done" });
  broadcast({ type: "task_update", task: { ...task, status: "done" } });

  setAgentStatus(task.assignedTo, "done", null);
  emitEvent(projectId, task.assignedTo, agentName, "completed task",
    `✓ Finished: ${task.title}`, "success");

  // Record simulated token usage for this agent's model
  const agent = agents.find((a) => a.id === task.assignedTo);
  if (agent) {
    recordSimulatedTokens(agent, projectId);
    // Generate output files based on project's requested formats
    generateSimulatedFiles(projectId, task, agent);
  }

  // Manager acknowledges progress
  const progress = Math.round((completedCount / totalTasks) * 100);
  storage.updateProject(projectId, {
    progress,
    tasksCompleted: completedCount,
    tokensUsed: Math.floor(Math.random() * 30000) + 50000 * completedCount,
    costToday: parseFloat((0.3 + completedCount * 0.5 + Math.random() * 0.2).toFixed(2)),
    avgResponseTime: parseFloat((1.2 + Math.random() * 1.8).toFixed(1)),
  });
  broadcast({ type: "project_update", projectId, progress, tasksCompleted: completedCount });

  // After a moment, set agent back to idle
  setTimeout(() => setAgentStatus(task.assignedTo, "idle", null), 1500);
}

function allTasksDone(projectId: number, agents: Agent[]) {
  const manager = agents.find((a) => a.id === "manager");
  storage.updateProject(projectId, { status: "completed", progress: 100 });
  broadcast({ type: "project_update", projectId, status: "completed", progress: 100 });

  emitEvent(projectId, "manager", manager?.name ?? "Manager Agent", "project complete",
    "All tasks delivered — project marked done ✓", "success");

  setAgentStatus("manager", "done", "All tasks complete");
  setTimeout(() => setAgentStatus("manager", "idle", null), 3000);
  activeSimulation = null;
}

function randomBlockReason(): string {
  const reasons = [
    "Waiting for API credentials from DevOps",
    "Design spec not finalised yet",
    "Database migration conflict — needs resolution",
    "Dependency not yet available from another agent",
    "Insufficient permissions on staging server",
    "Rate limit hit on external API",
    "Test environment down — awaiting restart",
  ];
  return reasons[Math.floor(Math.random() * reasons.length)];
}

// ─── Route registration ────────────────────────────────────────────────────────
export function registerRoutes(httpServer: Server, app: Express) {
  // ── Auth endpoints (whitelisted in requireAuth middleware) ─────────────────
  app.post("/api/auth/login", handleLogin);
  app.post("/api/auth/logout", handleLogout);
  app.get("/api/auth/me", handleMe);

  // ── WebSocket (Stage 4.18: handshake gated by session cookie) ─────────────
  // Use noServer mode so we can authenticate the upgrade request before
  // promoting it. Without this, an unauthenticated client could connect to
  // /ws and receive the agents + projects init payload.
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws" && !req.url?.startsWith("/ws?")) return;
    if (!isWsUpgradeAuthenticated(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    wsClients.add(ws);

    // Send full init payload
    const agents = storage.getAgents();
    const projects = storage.getProjects();
    ws.send(JSON.stringify({ type: "init", agents, projects }));

    if (currentProjectId) {
      const project = storage.getProject(currentProjectId);
      const tasks = storage.getTasks(currentProjectId);
      const events = storage.getEvents(currentProjectId, 50);
      if (project) {
        ws.send(JSON.stringify({ type: "project_init", project, tasks, events }));
      }
    }

    ws.on("close", () => wsClients.delete(ws));
  });

  // ── Agents ──────────────────────────────────────────────────────────────────

  app.get("/api/agents", (_req, res) => {
    res.json(storage.getAgents());
  });

  app.get("/api/agents/:id", (req, res) => {
    const agent = storage.getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(agent);
  });

  app.post("/api/agents", (req, res) => {
    const { id, name, role, spriteType, provider, modelId, systemPrompt, capabilities, reportsTo, color, icon } = req.body;
    if (!id || !name || !role || !spriteType || !color || !icon) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const existing = storage.getAgent(id);
    if (existing) return res.status(409).json({ error: "Agent ID already exists" });

    const agent = storage.createAgent({
      id,
      name,
      role,
      spriteType: spriteType || "manager",
      provider: provider || "anthropic",
      modelId: modelId || "claude-opus-4-7",
      systemPrompt: systemPrompt || "",
      capabilities: JSON.stringify(capabilities || []),
      reportsTo: reportsTo || null,
      status: "idle",
      currentTask: null,
      color,
      icon,
    });
    broadcast({ type: "agent_created", agent });
    res.json(agent);
  });

  app.patch("/api/agents/:id", (req, res) => {
    const { id } = req.params;
    const data = req.body;
    // Don't allow direct status/currentTask manipulation via this endpoint (that's internal)
    const { status, currentTask, ...safeData } = data;
    if (safeData.capabilities && Array.isArray(safeData.capabilities)) {
      safeData.capabilities = JSON.stringify(safeData.capabilities);
    }
    const agent = storage.updateAgent(id, safeData);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    broadcast({ type: "agent_updated", agent });
    res.json(agent);
  });

  app.delete("/api/agents/:id", (req, res) => {
    const { id } = req.params;
    if (id === "manager") return res.status(400).json({ error: "Cannot delete the Manager" });
    storage.deleteAgent(id);
    broadcast({ type: "agent_deleted", agentId: id });
    res.json({ ok: true });
  });

  // ── Projects ─────────────────────────────────────────────────────────────────

  app.get("/api/projects", (_req, res) => {
    res.json(storage.getProjects());
  });

  app.get("/api/projects/:id", (req, res) => {
    const project = storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Not found" });
    res.json(project);
  });

  app.post("/api/projects", (req, res) => {
    const { name, description, priority, deadline, outputFormats } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });

    const project = storage.createProject({
      name: name.trim(),
      description: description?.trim() || "",
      priority: priority || "normal",
      status: "planning",
      progress: 0,
      deadline: deadline || null,
      outputFormats: JSON.stringify(Array.isArray(outputFormats) ? outputFormats : []),
      tasksTotal: 0,
      tasksCompleted: 0,
      tokensUsed: 0,
      costToday: 0,
      avgResponseTime: 0,
    });

    // Reset all agents to idle
    const agents = storage.getAgents();
    for (const agent of agents) {
      storage.updateAgent(agent.id, { status: "idle", currentTask: null });
    }

    broadcast({ type: "new_project", project });
    res.json(project);

    // Kick off Manager orchestration after response is sent
    setImmediate(() => runManagerOrchestration(project.id));
  });

  app.patch("/api/projects/:id", (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid project id" });

    const existing = storage.getProject(id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    // Refuse to edit while a project is mid-run — prevents racing the orchestrator.
    if (existing.status === "active" || existing.status === "planning" || existing.status === "qa_review") {
      return res.status(409).json({
        error: `Cannot edit while project is ${existing.status}. Wait for it to finish or block.`,
      });
    }

    // Whitelist editable fields only.
    const { name, description, priority, outputFormats, deadline } = req.body ?? {};
    const update: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) update.name = name.trim();
    if (typeof description === "string") update.description = description.trim();
    if (typeof priority === "string") update.priority = priority;
    if (Array.isArray(outputFormats)) update.outputFormats = JSON.stringify(outputFormats);
    if (deadline === null || typeof deadline === "number") update.deadline = deadline;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "No editable fields supplied" });
    }

    const project = storage.updateProject(id, update);
    if (!project) return res.status(404).json({ error: "Not found" });
    broadcast({ type: "project_update", projectId: project.id, ...project });
    res.json(project);
  });

  app.delete("/api/projects/:id", (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid project id" });

    const existing = storage.getProject(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status === "active" || existing.status === "planning" || existing.status === "qa_review") {
      return res.status(409).json({
        error: `Cannot delete while project is ${existing.status}. Wait for it to finish or block.`,
      });
    }

    const counts = storage.deleteProject(id);
    broadcast({ type: "project_deleted", projectId: id });
    res.json({ ok: true, deleted: counts });
  });

  // Stage 4.14: stop a running project mid-flight to halt token spend.
  // Aborts every active LLM/tool fetch and marks the project as cancelled.
  app.post("/api/projects/:id/cancel", (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid project id" });

    const existing = storage.getProject(id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    // Cancellation is only meaningful while the orchestrator is running.
    const cancellableStates = ["planning", "active", "qa_review"] as const;
    if (!cancellableStates.includes(existing.status as typeof cancellableStates[number])) {
      return res.status(409).json({
        error: `Cannot cancel a ${existing.status} project. Only running projects (planning/active/qa_review) can be stopped.`,
      });
    }

    if (!isProjectRunning(id)) {
      // Status says it's running but we have no controller — server probably
      // restarted with a stale row. Mark cancelled directly so the UI unsticks.
      storage.updateProject(id, { status: "cancelled" });
      broadcast({ type: "project_update", projectId: id, status: "cancelled" });
      return res.json({ ok: true, cancelled: true, note: "Project was not actively running; flagged as cancelled." });
    }

    const cancelled = cancelProject(id, {
      broadcast,
      emitEvent,
      setAgentStatus,
      generateSimulatedFiles,
    });
    res.json({ ok: true, cancelled });
  });

  app.post("/api/projects/:id/resume", (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid project id" });

    const existing = storage.getProject(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status !== "blocked") {
      return res.status(409).json({
        error: `Resume is only valid for blocked projects (current status: ${existing.status}).`,
      });
    }

    res.json({ ok: true, resumed: true });

    // Kick off resume asynchronously so the response returns immediately.
    setImmediate(() => {
      resumeLiveOrchestration(id, {
        broadcast,
        emitEvent,
        setAgentStatus,
        generateSimulatedFiles,
      }).catch((e) => {
        const manager = storage.getAgent("manager");
        emitEvent(id, "manager", manager?.name ?? "Manager Agent", "resume error",
          `${(e as Error).message ?? e}`, "error");
        setAgentStatus("manager", "idle", null);
        storage.updateProject(id, { status: "blocked" });
        broadcast({ type: "project_update", projectId: id, status: "blocked" });
      });
    });
  });

  app.get("/api/projects/:id/events", (req, res) => {
    const id = parseInt(req.params.id);
    const limit = parseInt(req.query.limit as string) || 100;
    res.json(storage.getEvents(id, limit));
  });

  app.get("/api/projects/:id/tasks", (req, res) => {
    const id = parseInt(req.params.id);
    res.json(storage.getTasks(id));
  });

  // ── Tasks ────────────────────────────────────────────────────────────────────

  app.get("/api/tasks", (req, res) => {
    const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
    res.json(storage.getTasks(projectId));
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const { id } = req.params;
    const task = storage.updateTask(parseInt(id), req.body);
    if (!task) return res.status(404).json({ error: "Task not found" });
    broadcast({ type: "task_update", task });
    res.json(task);
  });

  // Manager reassignment
  app.post("/api/tasks/:id/reassign", (req, res) => {
    const { id } = req.params;
    const { assignedTo } = req.body;
    if (!assignedTo) return res.status(400).json({ error: "assignedTo required" });

    const agent = storage.getAgent(assignedTo);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const task = storage.updateTask(parseInt(id), {
      assignedTo,
      status: "todo",
      blockedReason: null,
    });
    if (!task) return res.status(404).json({ error: "Task not found" });

    // Log manager reassignment event
    const manager = storage.getAgent("manager");
    emitEvent(task.projectId, "manager", manager?.name ?? "Manager Agent", "reassigned task",
      `"${task.title}" → ${agent.name}`, "info");

    broadcast({ type: "task_update", task });
    res.json(task);
  });

  // ── Settings ─────────────────────────────────────────────────────────────────

  app.get("/api/settings", (_req, res) => {
    res.json(storage.getAllSettings());
  });

  app.post("/api/settings", (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).json({ error: "key and value required" });
    storage.setSetting(key, String(value));
    res.json({ ok: true });
  });

  app.patch("/api/settings", (req, res) => {
    // Bulk update
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      storage.setSetting(key, String(value));
      // Broadcast mode changes immediately so UI updates
      if (key === "agent_mode") {
        broadcast({ type: "mode_update", agentMode: String(value) });
      }
    }
    res.json({ ok: true });
  });

  // ── Project files ─────────────────────────────────────────────────────────

  app.get("/api/projects/:id/files", (req, res) => {
    const projectId = parseInt(req.params.id);
    if (isNaN(projectId)) return res.status(400).json({ error: "invalid project id" });
    res.json(storage.getProjectFiles(projectId));
  });

  app.delete("/api/files/:id", (req, res) => {
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) return res.status(400).json({ error: "invalid file id" });
    storage.deleteProjectFile(fileId);
    res.json({ ok: true });
  });

  app.get("/api/files/:id/download", (req, res) => {
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) return res.status(400).json({ error: "invalid file id" });
    const file = storage.getProjectFile(fileId);
    if (!file) return res.status(404).json({ error: "file not found" });
    if (!fs.existsSync(file.filePath)) return res.status(404).json({ error: "file missing from disk" });
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", file.sizeBytes);
    fs.createReadStream(file.filePath).pipe(res);
  });

  // ── Budget / token usage ────────────────────────────────────────────────────────

  app.get("/api/budget", (_req, res) => {
    res.json(storage.getBudgetSummary());
  });

  app.get("/api/budget/raw", (req, res) => {
    const since = req.query.since ? parseInt(String(req.query.since)) : undefined;
    res.json(storage.getTokenUsage(since));
  });

  app.post("/api/budget/record", (req, res) => {
    const { provider, modelId, agentId, projectId, tokensIn, tokensOut, costUsd } = req.body;
    if (!provider || !modelId || !agentId) return res.status(400).json({ error: "provider, modelId and agentId required" });
    const record = storage.recordTokenUsage({ provider, modelId, agentId, projectId, tokensIn: tokensIn ?? 0, tokensOut: tokensOut ?? 0, costUsd: costUsd ?? 0 });
    broadcast({ type: "budget_update", summary: storage.getBudgetSummary() });
    res.json(record);
  });

  // ── Models registry (latest-models checker) ───────────────────────────────────

  app.get("/api/models", (_req, res) => {
    res.json(storage.getModels());
  });

  app.post("/api/models/refresh", async (_req, res) => {
    try {
      const summary = await refreshAllProviders();
      broadcast({ type: "models_refreshed", summary });
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/models/acknowledge", (_req, res) => {
    storage.acknowledgeNewModels();
    res.json(storage.getModels());
  });

  app.patch("/api/models/:id", (req, res) => {
    const id = req.params.id;
    const { tier, enabled, preferredFor, poolTiers } = req.body ?? {};
    let updated;
    if (typeof tier === "string") {
      if (!["low", "medium", "high"].includes(tier)) return res.status(400).json({ error: "tier must be low|medium|high" });
      updated = storage.setModelTier(id, tier);
    }
    if (typeof enabled === "boolean") {
      updated = storage.setModelEnabled(id, enabled);
    }
    if (typeof preferredFor === "string") {
      if (!["low", "medium", "high", "none"].includes(preferredFor)) {
        return res.status(400).json({ error: "preferredFor must be low|medium|high|none" });
      }
      updated = storage.setModelPreferredFor(id, preferredFor);
    }
    // Stage 4.9: tier pool membership (multi-select). Accepts an array of tier
    // names; each must be one of low|medium|high. An empty array clears all
    // pool memberships for this model (and clears its default if it had one).
    if (Array.isArray(poolTiers)) {
      const bad = poolTiers.find((t) => typeof t !== "string" || !["low", "medium", "high"].includes(t));
      if (bad !== undefined) {
        return res.status(400).json({ error: "poolTiers entries must each be low|medium|high" });
      }
      updated = storage.setModelPoolTiers(id, poolTiers as string[]);
    }
    if (!updated) return res.status(404).json({ error: "model not found" });
    res.json(updated);
  });

  // ── QA review ─────────────────────────────────────────────────────────────────

  app.get("/api/projects/:id/qa-review", (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) return res.status(400).json({ error: "invalid project id" });
    const review = storage.getLatestQaReview(projectId);
    if (!review) return res.status(404).json({ error: "no qa review yet" });
    res.json(review);
  });
}
