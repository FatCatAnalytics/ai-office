import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertProjectSchema } from "@shared/schema";

// Fake event scenarios for each project stage
const EVENT_SCENARIOS: Record<string, { agentId: string; agentName: string; action: string; detail: string; status: string }[][]> = {
  phases: [
    // Phase 0: Manager assigns
    [
      { agentId: "manager", agentName: "Manager Agent", action: "assigned task", detail: "Analyzing requirements and delegating to team", status: "info" },
    ],
    // Phase 1: Frontend + Backend start
    [
      { agentId: "frontend", agentName: "Frontend Dev", action: "started UI", detail: "Setting up React components and routing", status: "info" },
      { agentId: "backend", agentName: "Backend Dev", action: "started API", detail: "Scaffolding FastAPI endpoints", status: "info" },
      { agentId: "uiux", agentName: "UI/UX Designer", action: "designing layout", detail: "Creating wireframes and component specs", status: "info" },
    ],
    // Phase 2: Progress updates
    [
      { agentId: "frontend", agentName: "Frontend Dev", action: "built component", detail: "AuthForm and Dashboard skeleton complete", status: "success" },
      { agentId: "backend", agentName: "Backend Dev", action: "built endpoints", detail: "/api/auth, /api/users, /api/projects wired", status: "success" },
      { agentId: "uiux", agentName: "UI/UX Designer", action: "uploaded components", detail: "Design tokens and new component library pushed", status: "success" },
    ],
    // Phase 3: QA enters
    [
      { agentId: "qa", agentName: "QA Engineer", action: "started testing", detail: "Running integration tests on auth flow", status: "info" },
      { agentId: "manager", agentName: "Manager Agent", action: "updated plan", detail: "Phase 2 on track — frontend 68% complete", status: "info" },
    ],
    // Phase 4: QA finds bugs
    [
      { agentId: "qa", agentName: "QA Engineer", action: "found 2 bugs", detail: "Login redirect broken on mobile, token expiry not handled", status: "warning" },
      { agentId: "frontend", agentName: "Frontend Dev", action: "fixing bug", detail: "Patching mobile redirect issue in AuthGuard", status: "warning" },
      { agentId: "backend", agentName: "Backend Dev", action: "fixing bug", detail: "Added token refresh endpoint and expiry handler", status: "warning" },
    ],
    // Phase 5: Fixes land, DevOps enters
    [
      { agentId: "frontend", agentName: "Frontend Dev", action: "bug fixed", detail: "Mobile redirect now working — tests passing", status: "success" },
      { agentId: "devops", agentName: "DevOps Engineer", action: "setting up CI/CD", detail: "GitHub Actions pipeline for staging deploy", status: "info" },
      { agentId: "qa", agentName: "QA Engineer", action: "testing user flows", detail: "Running E2E tests: login, dashboard, settings", status: "info" },
    ],
    // Phase 6: Deploy
    [
      { agentId: "devops", agentName: "DevOps Engineer", action: "deployed to staging", detail: "Build passed — staging.example.com live", status: "success" },
      { agentId: "qa", agentName: "QA Engineer", action: "sign-off", detail: "All critical paths passing — cleared for production", status: "success" },
      { agentId: "manager", agentName: "Manager Agent", action: "project complete", detail: "All milestones hit — marking project done", status: "success" },
    ],
  ],
};

// WebSocket clients
const wsClients = new Set<WebSocket>();
let activeSimulation: NodeJS.Timeout | null = null;
let currentProjectId: number | null = null;

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

function getAgentTaskForPhase(agentId: string, phase: number): string | null {
  const tasks: Record<string, string[]> = {
    manager: ["Analyzing requirements", "Coordinating team", "Reviewing progress", "Updating roadmap", "Final review"],
    frontend: ["Setting up React", "Building components", "Fixing mobile bug", "Polish & testing", "Complete"],
    backend: ["Scaffolding API", "Building endpoints", "Fixing token expiry", "API hardening", "Complete"],
    qa: [null, null, "Running integration tests", "Testing E2E flows", "Sign-off complete"],
    uiux: ["Creating wireframes", "Designing tokens", "Component library", "Visual QA", "Complete"],
    devops: [null, null, null, "Setting up CI/CD", "Deployed to staging"],
  };
  const list = tasks[agentId] || [];
  return list[Math.min(phase, list.length - 1)] ?? null;
}

function getAgentStatusForPhase(agentId: string, phase: number): string {
  const statuses: Record<string, string[]> = {
    manager: ["thinking", "working", "working", "thinking", "done"],
    frontend: ["idle", "working", "working", "working", "done"],
    backend: ["idle", "working", "working", "working", "done"],
    qa: ["idle", "idle", "working", "working", "done"],
    uiux: ["idle", "working", "working", "working", "done"],
    devops: ["idle", "idle", "idle", "working", "done"],
  };
  const list = statuses[agentId] || [];
  return list[Math.min(phase, list.length - 1)] ?? "idle";
}

function runSimulation(projectId: number) {
  if (activeSimulation) {
    clearTimeout(activeSimulation);
    activeSimulation = null;
  }
  currentProjectId = projectId;

  const phases = EVENT_SCENARIOS.phases;
  let phaseIndex = 0;
  let totalEvents = 0;
  let totalPhases = phases.length;

  function runNextPhase() {
    if (phaseIndex >= phases.length) {
      // Done
      storage.updateProject(projectId, { status: "completed", progress: 100 });
      broadcast({ type: "project_update", projectId, status: "completed", progress: 100 });
      activeSimulation = null;
      return;
    }

    const phaseEvents = phases[phaseIndex];
    let eventIndex = 0;

    function emitNextEvent() {
      if (eventIndex >= phaseEvents.length) {
        // Update project progress
        const progress = Math.min(100, Math.round(((phaseIndex + 1) / totalPhases) * 100));
        const tasksCompleted = phaseIndex + 1;
        storage.updateProject(projectId, {
          progress,
          tasksCompleted,
          tokensUsed: Math.floor(Math.random() * 50000) + 100000 * (phaseIndex + 1),
          costToday: parseFloat((0.5 + phaseIndex * 0.8 + Math.random() * 0.3).toFixed(2)),
          avgResponseTime: parseFloat((1.5 + Math.random() * 1.5).toFixed(1)),
        });
        broadcast({
          type: "project_update",
          projectId,
          progress,
          tasksCompleted,
        });

        phaseIndex++;
        const delay = 3000 + Math.random() * 2000;
        activeSimulation = setTimeout(runNextPhase, delay);
        return;
      }

      const ev = phaseEvents[eventIndex];
      const event = storage.createEvent({
        projectId,
        agentId: ev.agentId,
        agentName: ev.agentName,
        action: ev.action,
        detail: ev.detail,
        status: ev.status,
        timestamp: Date.now(),
      });

      // Update agent state
      const task = getAgentTaskForPhase(ev.agentId, phaseIndex);
      const status = getAgentStatusForPhase(ev.agentId, phaseIndex);
      storage.updateAgentState(ev.agentId, {
        status,
        currentTask: task,
      });

      broadcast({ type: "event", event });
      broadcast({
        type: "agent_update",
        agentId: ev.agentId,
        status,
        currentTask: task,
      });

      totalEvents++;
      eventIndex++;
      const delay = 1200 + Math.random() * 1800;
      activeSimulation = setTimeout(emitNextEvent, delay);
    }

    emitNextEvent();
  }

  // Kick off
  runNextPhase();
}

export function registerRoutes(httpServer: Server, app: Express) {
  // WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    // Send current state on connect
    const agents = storage.getAgentStates();
    ws.send(JSON.stringify({ type: "init", agents }));

    if (currentProjectId) {
      const project = storage.getProject(currentProjectId);
      if (project) {
        ws.send(JSON.stringify({ type: "project_init", project }));
      }
    }

    ws.on("close", () => wsClients.delete(ws));
  });

  // GET /api/projects
  app.get("/api/projects", (_req, res) => {
    res.json(storage.getProjects());
  });

  // POST /api/projects
  app.post("/api/projects", (req, res) => {
    const parsed = insertProjectSchema.safeParse({
      ...req.body,
      status: "active",
      progress: 0,
      tasksTotal: 7,
      tasksCompleted: 0,
      tokensUsed: 0,
      costToday: 0,
      avgResponseTime: 0,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const project = storage.createProject(parsed.data);

    // Reset all agents to idle
    const agents = storage.getAgentStates();
    for (const agent of agents) {
      storage.updateAgentState(agent.id, { status: "idle", currentTask: null });
    }

    // Start simulation
    runSimulation(project.id);

    broadcast({ type: "new_project", project });
    res.json(project);
  });

  // GET /api/projects/:id/events
  app.get("/api/projects/:id/events", (req, res) => {
    const id = parseInt(req.params.id);
    res.json(storage.getEvents(id, 100));
  });

  // GET /api/agents
  app.get("/api/agents", (_req, res) => {
    res.json(storage.getAgentStates());
  });
}
