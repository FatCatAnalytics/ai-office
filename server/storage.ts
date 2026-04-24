import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import type { Project, InsertProject, AgentEvent, InsertAgentEvent, AgentState, InsertAgentState } from "@shared/schema";

const sqlite = new Database("data.db");
export const db = drizzle(sqlite, { schema });

// Initialize tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    progress INTEGER NOT NULL DEFAULT 0,
    tasks_total INTEGER NOT NULL DEFAULT 0,
    tasks_completed INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    cost_today REAL NOT NULL DEFAULT 0,
    avg_response_time REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'info',
    timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_states (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    current_task TEXT,
    color TEXT NOT NULL,
    icon TEXT NOT NULL
  );
`);

export interface IStorage {
  // Projects
  getProjects(): Project[];
  getProject(id: number): Project | undefined;
  createProject(data: InsertProject): Project;
  updateProject(id: number, data: Partial<Project>): Project | undefined;

  // Agent events
  getEvents(projectId: number, limit?: number): AgentEvent[];
  createEvent(data: InsertAgentEvent): AgentEvent;

  // Agent states
  getAgentStates(): AgentState[];
  upsertAgentState(data: InsertAgentState): AgentState;
  updateAgentState(id: string, data: Partial<AgentState>): AgentState | undefined;
  initAgentStates(): void;
}

class SQLiteStorage implements IStorage {
  getProjects(): Project[] {
    return db.select().from(schema.projects).all();
  }

  getProject(id: number): Project | undefined {
    return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  }

  createProject(data: InsertProject): Project {
    return db.insert(schema.projects).values(data).returning().get();
  }

  updateProject(id: number, data: Partial<Project>): Project | undefined {
    return db.update(schema.projects).set(data).where(eq(schema.projects.id, id)).returning().get();
  }

  getEvents(projectId: number, limit = 50): AgentEvent[] {
    return db
      .select()
      .from(schema.agentEvents)
      .where(eq(schema.agentEvents.projectId, projectId))
      .orderBy(desc(schema.agentEvents.timestamp))
      .limit(limit)
      .all();
  }

  createEvent(data: InsertAgentEvent): AgentEvent {
    return db.insert(schema.agentEvents).values(data).returning().get();
  }

  getAgentStates(): AgentState[] {
    return db.select().from(schema.agentStates).all();
  }

  upsertAgentState(data: InsertAgentState): AgentState {
    // Try update first, then insert
    const existing = db.select().from(schema.agentStates).where(eq(schema.agentStates.id, data.id)).get();
    if (existing) {
      return db.update(schema.agentStates).set(data).where(eq(schema.agentStates.id, data.id)).returning().get()!;
    }
    return db.insert(schema.agentStates).values(data).returning().get();
  }

  updateAgentState(id: string, data: Partial<AgentState>): AgentState | undefined {
    return db.update(schema.agentStates).set(data).where(eq(schema.agentStates.id, id)).returning().get();
  }

  initAgentStates(): void {
    const agents: InsertAgentState[] = [
      { id: "manager", name: "Manager Agent", role: "Delegating", status: "idle", currentTask: null, color: "#6366f1", icon: "Crown" },
      { id: "frontend", name: "Frontend Dev", role: "UI Engineer", status: "idle", currentTask: null, color: "#22c55e", icon: "Monitor" },
      { id: "backend", name: "Backend Dev", role: "API Engineer", status: "idle", currentTask: null, color: "#3b82f6", icon: "Server" },
      { id: "qa", name: "QA Engineer", role: "Testing", status: "idle", currentTask: null, color: "#f59e0b", icon: "Bug" },
      { id: "uiux", name: "UI/UX Designer", role: "Designing", status: "idle", currentTask: null, color: "#ec4899", icon: "Palette" },
      { id: "devops", name: "DevOps Engineer", role: "Infrastructure", status: "idle", currentTask: null, color: "#14b8a6", icon: "Rocket" },
    ];
    for (const agent of agents) {
      const existing = db.select().from(schema.agentStates).where(eq(schema.agentStates.id, agent.id)).get();
      if (!existing) {
        db.insert(schema.agentStates).values(agent).run();
      }
    }
  }
}

export const storage = new SQLiteStorage();
storage.initAgentStates();
