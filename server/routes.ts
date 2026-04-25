import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import type { Agent, Task, Project } from "@shared/schema";

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

  // Phase 0: Manager starts planning
  setAgentStatus("manager", "thinking", "Analysing project requirements");
  emitEvent(projectId, "manager", manager.name, "received project",
    `Analysing "${project.name}" — breaking down into tasks for the team`, "info");

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
  // WebSocket
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

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
      modelId: modelId || "claude-opus-4-5",
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
    const { name, description, priority, deadline } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });

    const project = storage.createProject({
      name: name.trim(),
      description: description?.trim() || "",
      priority: priority || "normal",
      status: "planning",
      progress: 0,
      deadline: deadline || null,
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
    const project = storage.updateProject(parseInt(req.params.id), req.body);
    if (!project) return res.status(404).json({ error: "Not found" });
    broadcast({ type: "project_update", projectId: project.id, ...project });
    res.json(project);
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
    }
    res.json({ ok: true });
  });
}
