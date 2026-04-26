import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import type {
  Agent, InsertAgent,
  Project, InsertProject,
  Task, InsertTask,
  AgentEvent, InsertAgentEvent,
  Setting,
  TokenUsage, InsertTokenUsage,
} from "@shared/schema";

const sqlite = new Database("data.db");
export const db = drizzle(sqlite, { schema });

// Initialize tables (CREATE IF NOT EXISTS — safe to run every boot)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    sprite_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'anthropic',
    model_id TEXT NOT NULL DEFAULT 'claude-opus-4-5',
    system_prompt TEXT NOT NULL DEFAULT '',
    capabilities TEXT NOT NULL DEFAULT '[]',
    reports_to TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    current_task TEXT,
    color TEXT NOT NULL,
    icon TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'planning',
    progress INTEGER NOT NULL DEFAULT 0,
    deadline INTEGER,
    tasks_total INTEGER NOT NULL DEFAULT 0,
    tasks_completed INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    cost_today REAL NOT NULL DEFAULT 0,
    avg_response_time REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    project_id INTEGER NOT NULL,
    assigned_to TEXT NOT NULL,
    assigned_by TEXT NOT NULL DEFAULT 'manager',
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'normal',
    deadline INTEGER,
    blocked_reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
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
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    project_id INTEGER,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
`);

// ─── Default agents (seed) ───────────────────────────────────────────────────
const DEFAULT_AGENTS: InsertAgent[] = [
  {
    id: "manager",
    name: "Manager Agent",
    role: "Orchestrator",
    spriteType: "manager",
    provider: "anthropic",
    modelId: "claude-opus-4-5",
    systemPrompt: "You are the AI Office Manager. You receive projects, break them into tasks, delegate to the right agents based on their capabilities, monitor progress, and reassign blocked tasks. You see everything and coordinate the whole team.",
    capabilities: JSON.stringify(["orchestration", "planning", "delegation", "review"]),
    reportsTo: null,
    status: "idle",
    currentTask: null,
    color: "#6366f1",
    icon: "Crown",
  },
  {
    id: "frontend",
    name: "Frontend Dev",
    role: "UI Engineer",
    spriteType: "frontend",
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    systemPrompt: "You are a skilled Frontend Developer. You build React components, implement UI designs, handle routing, state management, and ensure pixel-perfect rendering across devices.",
    capabilities: JSON.stringify(["react", "typescript", "css", "ui", "components", "routing"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#22c55e",
    icon: "Monitor",
  },
  {
    id: "backend",
    name: "Backend Dev",
    role: "API Engineer",
    spriteType: "backend",
    provider: "openai",
    modelId: "gpt-4o",
    systemPrompt: "You are a skilled Backend Developer. You design and implement APIs, manage databases, write business logic, handle authentication, and ensure scalability and security of server-side systems.",
    capabilities: JSON.stringify(["api", "nodejs", "express", "databases", "auth", "migrations", "rest"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#3b82f6",
    icon: "Server",
  },
  {
    id: "qa",
    name: "QA Engineer",
    role: "Quality Assurance",
    spriteType: "qa",
    provider: "anthropic",
    modelId: "claude-haiku-3-5",
    systemPrompt: "You are a thorough QA Engineer. You write and run tests, find bugs, validate requirements, test edge cases, and ensure nothing ships broken. You catch what others miss.",
    capabilities: JSON.stringify(["testing", "e2e", "integration", "unit-tests", "bug-finding", "qa"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#f59e0b",
    icon: "Bug",
  },
  {
    id: "uiux",
    name: "UI/UX Designer",
    role: "Product Design",
    spriteType: "uiux",
    provider: "google",
    modelId: "gemini-2.5-pro",
    systemPrompt: "You are a creative UI/UX Designer. You create wireframes, design systems, user flows, and ensure products are intuitive, beautiful, and accessible. You think in design tokens and components.",
    capabilities: JSON.stringify(["design", "wireframes", "prototyping", "accessibility", "design-system", "ux"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#ec4899",
    icon: "Palette",
  },
  {
    id: "devops",
    name: "DevOps Engineer",
    role: "Infrastructure",
    spriteType: "devops",
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    systemPrompt: "You are a seasoned DevOps Engineer. You manage CI/CD pipelines, container orchestration, cloud infrastructure, monitoring, and deployment strategies. You make things scale reliably.",
    capabilities: JSON.stringify(["docker", "ci-cd", "kubernetes", "nginx", "monitoring", "deployment", "linux"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#14b8a6",
    icon: "Rocket",
  },
  {
    id: "dbarchitect",
    name: "DB Architect",
    role: "Database Design",
    spriteType: "dbarchitect",
    provider: "openai",
    modelId: "gpt-4o",
    systemPrompt: "You are a Database Architect. You design schemas, optimize queries, manage migrations, plan indexing strategies, and ensure data integrity and performance at scale.",
    capabilities: JSON.stringify(["sql", "migrations", "schema-design", "indexing", "postgres", "sqlite", "performance"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#a855f7",
    icon: "Database",
  },
  {
    id: "datascientist",
    name: "Data Scientist",
    role: "ML & Analytics",
    spriteType: "datascientist",
    provider: "google",
    modelId: "gemini-2.5-pro",
    systemPrompt: "You are a Data Scientist. You analyze data, build ML models, create dashboards, run A/B tests, and surface insights that drive decisions. You turn raw data into business value.",
    capabilities: JSON.stringify(["ml", "python", "pandas", "visualization", "analytics", "statistics", "a-b-testing"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#f97316",
    icon: "BarChart3",
  },
  {
    id: "secengineer",
    name: "Security Engineer",
    role: "AppSec & Infra",
    spriteType: "secengineer",
    provider: "anthropic",
    modelId: "claude-opus-4-5",
    systemPrompt: "You are a Security Engineer. You perform threat modeling, code security reviews, pen testing, implement auth & encryption, and ensure the stack is hardened against attacks.",
    capabilities: JSON.stringify(["security", "auth", "encryption", "pentest", "owasp", "ssl", "firewall"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#ef4444",
    icon: "Shield",
  },
  {
    id: "pm",
    name: "Product Manager",
    role: "Product Strategy",
    spriteType: "pm",
    provider: "openai",
    modelId: "gpt-4o",
    systemPrompt: "You are a Product Manager. You define requirements, maintain the roadmap, write user stories, prioritize backlogs, communicate with stakeholders, and ensure the team builds the right things.",
    capabilities: JSON.stringify(["product", "roadmap", "requirements", "user-stories", "prioritization", "stakeholders"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#0ea5e9",
    icon: "Briefcase",
  },
];

// ─── Storage interface ────────────────────────────────────────────────────────
export interface IStorage {
  // Agents
  getAgents(): Agent[];
  getAgent(id: string): Agent | undefined;
  createAgent(data: InsertAgent): Agent;
  updateAgent(id: string, data: Partial<Agent>): Agent | undefined;
  deleteAgent(id: string): void;
  initDefaultAgents(): void;

  // Projects
  getProjects(): Project[];
  getProject(id: number): Project | undefined;
  createProject(data: InsertProject): Project;
  updateProject(id: number, data: Partial<Project>): Project | undefined;

  // Tasks
  getTasks(projectId?: number): Task[];
  getTask(id: number): Task | undefined;
  createTask(data: InsertTask): Task;
  updateTask(id: number, data: Partial<Task>): Task | undefined;
  deleteTask(id: number): void;

  // Events
  getEvents(projectId: number, limit?: number): AgentEvent[];
  createEvent(data: InsertAgentEvent): AgentEvent;

  // Settings
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
  getAllSettings(): Record<string, string>;

  // Token usage / budget
  recordTokenUsage(data: InsertTokenUsage): TokenUsage;
  getTokenUsage(since?: number): TokenUsage[];
  getBudgetSummary(): BudgetModelRow[];
}

export interface BudgetModelRow {
  provider: string;
  modelId: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  costUsd: number;
}

class SQLiteStorage implements IStorage {
  // ── Agents ──
  getAgents(): Agent[] {
    return db.select().from(schema.agents).all();
  }
  getAgent(id: string): Agent | undefined {
    return db.select().from(schema.agents).where(eq(schema.agents.id, id)).get();
  }
  createAgent(data: InsertAgent): Agent {
    return db.insert(schema.agents).values(data).returning().get();
  }
  updateAgent(id: string, data: Partial<Agent>): Agent | undefined {
    return db.update(schema.agents).set(data).where(eq(schema.agents.id, id)).returning().get();
  }
  deleteAgent(id: string): void {
    db.delete(schema.agents).where(eq(schema.agents.id, id)).run();
  }
  initDefaultAgents(): void {
    for (const agent of DEFAULT_AGENTS) {
      const existing = db.select().from(schema.agents).where(eq(schema.agents.id, agent.id)).get();
      if (!existing) {
        db.insert(schema.agents).values({ ...agent, createdAt: Date.now() }).run();
      }
    }
  }

  // ── Projects ──
  getProjects(): Project[] {
    return db.select().from(schema.projects).all();
  }
  getProject(id: number): Project | undefined {
    return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  }
  createProject(data: InsertProject): Project {
    return db.insert(schema.projects).values({ ...data, createdAt: Date.now() }).returning().get();
  }
  updateProject(id: number, data: Partial<Project>): Project | undefined {
    return db.update(schema.projects).set(data).where(eq(schema.projects.id, id)).returning().get();
  }

  // ── Tasks ──
  getTasks(projectId?: number): Task[] {
    if (projectId !== undefined) {
      return db.select().from(schema.tasks).where(eq(schema.tasks.projectId, projectId)).all();
    }
    return db.select().from(schema.tasks).all();
  }
  getTask(id: number): Task | undefined {
    return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
  }
  createTask(data: InsertTask): Task {
    const now = Date.now();
    return db.insert(schema.tasks).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
  }
  updateTask(id: number, data: Partial<Task>): Task | undefined {
    return db.update(schema.tasks).set({ ...data, updatedAt: Date.now() }).where(eq(schema.tasks.id, id)).returning().get();
  }
  deleteTask(id: number): void {
    db.delete(schema.tasks).where(eq(schema.tasks.id, id)).run();
  }

  // ── Events ──
  getEvents(projectId: number, limit = 100): AgentEvent[] {
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

  // ── Settings ──
  getSetting(key: string): string | undefined {
    return db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value;
  }
  setSetting(key: string, value: string): void {
    const existing = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
    if (existing) {
      db.update(schema.settings).set({ value, updatedAt: Date.now() }).where(eq(schema.settings.key, key)).run();
    } else {
      db.insert(schema.settings).values({ key, value, updatedAt: Date.now() }).run();
    }
  }
  getAllSettings(): Record<string, string> {
    const rows = db.select().from(schema.settings).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // ── Token usage ──
  recordTokenUsage(data: InsertTokenUsage): TokenUsage {
    return db.insert(schema.tokenUsage).values({
      ...data,
      timestamp: Date.now(),
    }).returning().get()!;
  }

  getTokenUsage(since?: number): TokenUsage[] {
    const rows = db.select().from(schema.tokenUsage)
      .orderBy(desc(schema.tokenUsage.timestamp))
      .all();
    if (since) return rows.filter(r => r.timestamp >= since);
    return rows;
  }

  getBudgetSummary(): BudgetModelRow[] {
    const rows = db.select().from(schema.tokenUsage).all();
    const map = new Map<string, BudgetModelRow>();
    for (const r of rows) {
      const key = `${r.provider}::${r.modelId}`;
      const existing = map.get(key);
      if (existing) {
        existing.requests += 1;
        existing.tokensIn += r.tokensIn;
        existing.tokensOut += r.tokensOut;
        existing.totalTokens += r.tokensIn + r.tokensOut;
        existing.costUsd += r.costUsd;
      } else {
        map.set(key, {
          provider: r.provider,
          modelId: r.modelId,
          requests: 1,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          totalTokens: r.tokensIn + r.tokensOut,
          costUsd: r.costUsd,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.costUsd - a.costUsd);
  }
}

export const storage = new SQLiteStorage();

// Seed default agents on boot
storage.initDefaultAgents();
