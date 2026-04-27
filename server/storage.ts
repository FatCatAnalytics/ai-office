import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import type {
  Agent, InsertAgent,
  Project, InsertProject,
  Task, InsertTask,
  AgentEvent, InsertAgentEvent,
  Setting,
  TokenUsage, InsertTokenUsage,
  ProjectFile, InsertProjectFile,
  Model, InsertModel,
  QaReview, InsertQaReview,
} from "@shared/schema";

const sqlite = new Database("data.db");
export const db = drizzle(sqlite, { schema });

// Stage 4.9: parse the pool_tiers JSON column safely. Older rows may contain
// the legacy default '[]' or even an empty string after a partial migration.
function parsePoolTiers(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

// Initialize tables (CREATE IF NOT EXISTS — safe to run every boot)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    sprite_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'anthropic',
    model_id TEXT NOT NULL DEFAULT 'claude-opus-4-7',
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
    depends_on TEXT NOT NULL DEFAULT '[]',
    wave_index INTEGER,
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
  CREATE TABLE IF NOT EXISTS project_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    task_id INTEGER,
    agent_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    file_path TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  -- Add output_formats column to projects if it doesn't exist (safe migration)
  PRAGMA table_info(projects);
`);

// Safe migration: add output_formats column if missing
try {
  sqlite.exec(`ALTER TABLE projects ADD COLUMN output_formats TEXT NOT NULL DEFAULT '[]'`);
} catch { /* column already exists */ }

// Stage 4 safe migrations: parallel-execution columns on tasks
try {
  sqlite.exec(`ALTER TABLE tasks ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]'`);
} catch { /* column already exists */ }
try {
  sqlite.exec(`ALTER TABLE tasks ADD COLUMN wave_index INTEGER`);
} catch { /* column already exists */ }

// Stage 4.6 safe migrations: cost-routing + model registry + qa reviews
try {
  sqlite.exec(`ALTER TABLE tasks ADD COLUMN complexity TEXT NOT NULL DEFAULT 'medium'`);
} catch { /* column already exists */ }
try {
  sqlite.exec(`ALTER TABLE tasks ADD COLUMN model_used TEXT`);
} catch { /* column already exists */ }
// Stage 4.7: pin a model as the operator's preferred choice for a complexity tier.
try {
  sqlite.exec(`ALTER TABLE models ADD COLUMN preferred_for TEXT NOT NULL DEFAULT 'none'`);
} catch { /* column already exists */ }
// Stage 4.9: enroll a model in MULTIPLE tier pools (the router rotates through
// any pool member when no default is pinned). preferred_for stays as the single
// default per tier; pool_tiers is a JSON array of tier names this model belongs to.
try {
  sqlite.exec(`ALTER TABLE models ADD COLUMN pool_tiers TEXT NOT NULL DEFAULT '[]'`);
} catch { /* column already exists */ }
// One-shot: any existing pinned model is auto-enrolled in its pinned tier so
// upgraded DBs keep their previous behaviour.
try {
  sqlite.exec(
    `UPDATE models SET pool_tiers = json_array(preferred_for)
     WHERE pool_tiers IN ('[]','') AND preferred_for IN ('low','medium','high')`,
  );
} catch { /* json1 missing or already migrated */ }
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    context_window INTEGER,
    cost_per_1k_in REAL,
    cost_per_1k_out REAL,
    tier TEXT NOT NULL DEFAULT 'medium',
    preferred_for TEXT NOT NULL DEFAULT 'none',
    pool_tiers TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    is_new INTEGER NOT NULL DEFAULT 0,
    discovered_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    last_checked_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS qa_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    signed_off INTEGER NOT NULL DEFAULT 0,
    recommendation TEXT NOT NULL DEFAULT 'ship',
    summary TEXT NOT NULL DEFAULT '',
    coverage TEXT NOT NULL DEFAULT '[]',
    issues TEXT NOT NULL DEFAULT '[]',
    model_used TEXT NOT NULL DEFAULT '',
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
`);

// Stage 4.5 safe migrations: existing rows with retired Anthropic model ids.
// Older seeds used "claude-opus-4-5" / "claude-sonnet-4-5" / "claude-haiku-3-5",
// none of which exist in the public Anthropic API. Map them forward to the
// current canonical ids so live calls don't 404. Idempotent.
try {
  sqlite.exec(`UPDATE agents SET model_id = 'claude-opus-4-7'   WHERE model_id = 'claude-opus-4-5'`);
  sqlite.exec(`UPDATE agents SET model_id = 'claude-sonnet-4-6' WHERE model_id = 'claude-sonnet-4-5'`);
  sqlite.exec(`UPDATE agents SET model_id = 'claude-haiku-4-5'  WHERE model_id = 'claude-haiku-3-5'`);
} catch (e) {
  console.warn("[migration] failed to remap retired Anthropic model ids:", e);
}

// Ensure projects storage dir exists
export const PROJECTS_DIR = process.env.PROJECTS_DIR ?? path.join(process.cwd(), "projects");
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// ─── Default agents (seed) ───────────────────────────────────────────────────
const DEFAULT_AGENTS: InsertAgent[] = [
  {
    id: "manager",
    name: "Manager Agent",
    role: "Orchestrator",
    spriteType: "manager",
    provider: "anthropic",
    modelId: "claude-opus-4-7",
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
    modelId: "claude-sonnet-4-6",
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
    modelId: "claude-haiku-4-5",
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
    modelId: "claude-sonnet-4-6",
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
    modelId: "claude-opus-4-7",
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
  // Stage 4.8: Data Harvester — long-context extraction specialist. Defaults to
  // Kimi (cheapest long-context model) because the work is extraction/parsing,
  // not novel reasoning. Operator can pin a different low-tier model in Settings.
  {
    id: "harvester",
    name: "Data Harvester",
    role: "Research & Extraction",
    spriteType: "harvester", // own slot — sprite falls back to datascientist art
    provider: "kimi",
    modelId: "moonshot-v1-128k",
    systemPrompt: [
      "You are the Data Harvester. You collect, extract, and structure data from any source: web pages, HTML, JSON APIs, RSS feeds, PDFs, sitemaps, search results, public datasets, GitHub repos, social profiles, and bulk text dumps.",
      "",
      "Operating principles:",
      "• Always cite the URL and the exact field/selector you pulled each value from.",
      "• Output structured data (JSON or markdown tables) by default — never prose-only when a table is possible.",
      "• When given a URL, return what is actually there. If you cannot fetch it, say so explicitly with the reason; do not invent values.",
      "• De-duplicate, normalise dates to ISO 8601, normalise currencies to a stated unit, and flag missing values as null rather than guessing.",
      "• For multi-page sources, paginate methodically and report when more pages exist.",
      "• Respect robots.txt and obvious rate-limit signals. Prefer official APIs and feeds over HTML scraping when both exist.",
      "• You are cost-optimised: keep output dense and structured. Long prose is the wrong shape.",
    ].join("\n"),
    capabilities: JSON.stringify([
      "web-scraping", "html-parsing", "json-extraction", "rss", "sitemaps",
      "pdf-extraction", "data-cleaning", "deduplication", "normalisation",
      "research", "api-collection", "bulk-extraction", "structured-output",
    ]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#84cc16", // lime — distinct from datascientist orange + data-zone purple
    icon: "Globe",
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
  deleteProject(id: number): { tasks: number; events: number; files: number; tokenUsage: number } | undefined;

  // Tasks
  getTasks(projectId?: number): Task[];
  getTask(id: number): Task | undefined;
  createTask(data: InsertTask): Task;
  updateTask(id: number, data: Partial<Task>): Task | undefined;
  deleteTask(id: number): void;
  getResumableTasks(projectId: number): Task[];
  getCompletedTasksWithFiles(projectId: number): { task: Task; output: string }[];

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

  // Project files
  saveProjectFile(data: InsertProjectFile, content: Buffer | string): ProjectFile;
  getProjectFiles(projectId: number): ProjectFile[];
  getProjectFile(fileId: number): ProjectFile | undefined;
  deleteProjectFile(fileId: number): void;
  ensureProjectDir(projectId: number): string;

  // Models registry
  getModels(): Model[];
  upsertModel(data: InsertModel): Model;
  setModelTier(id: string, tier: string): Model | undefined;
  setModelEnabled(id: string, enabled: boolean): Model | undefined;
  setModelPreferredFor(id: string, preferredFor: string): Model | undefined;
  getPreferredModelForTier(tier: "low" | "medium" | "high"): Model | undefined;
  // Stage 4.9: tier pool membership (multi-select per tier).
  setModelPoolTiers(id: string, tiers: string[]): Model | undefined;
  getPoolModelsForTier(tier: "low" | "medium" | "high"): Model[];
  acknowledgeNewModels(): void;

  // QA reviews
  getLatestQaReview(projectId: number): QaReview | undefined;
  createQaReview(data: InsertQaReview): QaReview;
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
  deleteProject(id: number): { tasks: number; events: number; files: number; tokenUsage: number } | undefined {
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    if (!project) return undefined;

    // Delete tasks
    const taskRows = db.delete(schema.tasks).where(eq(schema.tasks.projectId, id)).run();

    // Delete agent events
    const eventRows = db.delete(schema.agentEvents).where(eq(schema.agentEvents.projectId, id)).run();

    // Delete project file rows + their on-disk files
    const files = db.select().from(schema.projectFiles).where(eq(schema.projectFiles.projectId, id)).all();
    for (const f of files) {
      try { fs.unlinkSync(f.filePath); } catch { /* already gone */ }
    }
    const fileRows = db.delete(schema.projectFiles).where(eq(schema.projectFiles.projectId, id)).run();

    // Delete token usage rows for this project
    const tokenRows = db.delete(schema.tokenUsage).where(eq(schema.tokenUsage.projectId, id)).run();

    // Remove project filesystem dir (best-effort)
    try {
      const dir = path.join(PROJECTS_DIR, String(id));
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }

    // Finally remove project row
    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();

    return {
      tasks: taskRows.changes ?? 0,
      events: eventRows.changes ?? 0,
      files: fileRows.changes ?? 0,
      tokenUsage: tokenRows.changes ?? 0,
    };
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
  getResumableTasks(projectId: number): Task[] {
    // Tasks that haven't completed and weren't superseded by a replan.
    return db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .all()
      .filter((t) => {
        if (t.status === "todo" || t.status === "in_progress") return true;
        if (t.status === "blocked" && t.blockedReason !== "Superseded by replan") return true;
        return false;
      });
  }
  getCompletedTasksWithFiles(projectId: number): { task: Task; output: string }[] {
    const tasks = db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.status, "done")))
      .all();
    const out: { task: Task; output: string }[] = [];
    for (const task of tasks) {
      // Find the most-relevant file for this task (markdown preferred, else any).
      const files = db
        .select()
        .from(schema.projectFiles)
        .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.taskId, task.id)))
        .all();
      if (files.length === 0) continue;
      const md = files.find((f) => f.fileType === "markdown") ?? files[0];
      try {
        const content = fs.readFileSync(md.filePath, "utf8");
        out.push({ task, output: content });
      } catch {
        /* file gone — skip */
      }
    }
    return out;
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

  // ── Project files ──
  ensureProjectDir(projectId: number): string {
    const dir = path.join(PROJECTS_DIR, String(projectId));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  saveProjectFile(data: InsertProjectFile, content: Buffer | string): ProjectFile {
    const dir = this.ensureProjectDir(data.projectId);
    // Sanitise filename
    const safeName = data.filename.replace(/[^a-zA-Z0-9._\-]/g, "_");
    const filePath = path.join(dir, safeName);
    fs.writeFileSync(filePath, content);
    const sizeBytes = fs.statSync(filePath).size;
    return db.insert(schema.projectFiles).values({
      ...data,
      filename: safeName,
      filePath,
      sizeBytes,
      createdAt: Date.now(),
    }).returning().get()!;
  }

  getProjectFiles(projectId: number): ProjectFile[] {
    return db.select().from(schema.projectFiles)
      .where(eq(schema.projectFiles.projectId, projectId))
      .orderBy(desc(schema.projectFiles.createdAt))
      .all();
  }

  getProjectFile(fileId: number): ProjectFile | undefined {
    return db.select().from(schema.projectFiles)
      .where(eq(schema.projectFiles.id, fileId))
      .get();
  }

  deleteProjectFile(fileId: number): void {
    const file = this.getProjectFile(fileId);
    if (file) {
      try { fs.unlinkSync(file.filePath); } catch { /* already gone */ }
      db.delete(schema.projectFiles).where(eq(schema.projectFiles.id, fileId)).run();
    }
  }

  // ── Models registry ──
  getModels(): Model[] {
    return db.select().from(schema.models)
      .orderBy(desc(schema.models.discoveredAt))
      .all();
  }

  upsertModel(data: InsertModel): Model {
    const id = data.id || `${data.provider}:${data.modelId}`;
    const existing = db.select().from(schema.models).where(eq(schema.models.id, id)).get();
    const now = Date.now();
    if (existing) {
      // Update last-checked + any provided pricing/context fields, keep tier/enabled.
      return db.update(schema.models).set({
        displayName: data.displayName ?? existing.displayName,
        contextWindow: data.contextWindow ?? existing.contextWindow,
        costPer1kIn: data.costPer1kIn ?? existing.costPer1kIn,
        costPer1kOut: data.costPer1kOut ?? existing.costPer1kOut,
        lastCheckedAt: now,
      }).where(eq(schema.models.id, id)).returning().get()!;
    }
    // First sighting → mark as new for the UI badge.
    return db.insert(schema.models).values({
      ...data,
      id,
      isNew: 1,
      discoveredAt: now,
      lastCheckedAt: now,
    }).returning().get()!;
  }

  setModelTier(id: string, tier: string): Model | undefined {
    return db.update(schema.models).set({ tier }).where(eq(schema.models.id, id)).returning().get();
  }

  setModelEnabled(id: string, enabled: boolean): Model | undefined {
    return db.update(schema.models).set({ enabled: enabled ? 1 : 0 }).where(eq(schema.models.id, id)).returning().get();
  }

  setModelPreferredFor(id: string, preferredFor: string): Model | undefined {
    // Pinning a model as DEFAULT for a tier clears any other model's default for
    // that tier so there is exactly one default per tier at any time.
    if (preferredFor === "low" || preferredFor === "medium" || preferredFor === "high") {
      db.update(schema.models)
        .set({ preferredFor: "none" })
        .where(eq(schema.models.preferredFor, preferredFor))
        .run();
      // Also auto-enroll this model in the tier pool. The router treats the
      // default as the preferred pick within its pool, so being default implies
      // membership.
      const row = db.select().from(schema.models).where(eq(schema.models.id, id)).get();
      if (row) {
        const current = parsePoolTiers(row.poolTiers);
        if (!current.includes(preferredFor)) {
          const next = [...current, preferredFor];
          db.update(schema.models)
            .set({ poolTiers: JSON.stringify(next) })
            .where(eq(schema.models.id, id))
            .run();
        }
      }
    }
    return db.update(schema.models).set({ preferredFor }).where(eq(schema.models.id, id)).returning().get();
  }

  getPreferredModelForTier(tier: "low" | "medium" | "high"): Model | undefined {
    return db.select().from(schema.models)
      .where(and(eq(schema.models.preferredFor, tier), eq(schema.models.enabled, 1)))
      .limit(1)
      .get();
  }

  // ── Stage 4.9: tier pool membership ──
  // A model can be enrolled in any subset of {low, medium, high}. The router
  // first tries the operator-pinned default for the tier; if that's missing or
  // its provider key is unset, it falls back to any other pool member with a
  // configured provider key.
  setModelPoolTiers(id: string, tiers: string[]): Model | undefined {
    const cleaned = Array.from(new Set(
      tiers.filter((t): t is "low" | "medium" | "high" =>
        t === "low" || t === "medium" || t === "high"),
    ));
    const row = db.select().from(schema.models).where(eq(schema.models.id, id)).get();
    if (!row) return undefined;
    // If the model was the default for a tier it just got removed from, drop
    // the default flag (a default must always be a pool member).
    let nextPreferred = row.preferredFor;
    if ((row.preferredFor === "low" || row.preferredFor === "medium" || row.preferredFor === "high")
        && !cleaned.includes(row.preferredFor)) {
      nextPreferred = "none";
    }
    return db.update(schema.models)
      .set({ poolTiers: JSON.stringify(cleaned), preferredFor: nextPreferred })
      .where(eq(schema.models.id, id))
      .returning()
      .get();
  }

  getPoolModelsForTier(tier: "low" | "medium" | "high"): Model[] {
    // Pull every enabled model that lists `tier` in its pool_tiers JSON array.
    // We do the JSON parse in JS rather than in SQL to avoid relying on the
    // optional json1 extension at query time.
    const rows = db.select().from(schema.models)
      .where(eq(schema.models.enabled, 1))
      .all();
    return rows.filter((r) => parsePoolTiers(r.poolTiers).includes(tier));
  }

  acknowledgeNewModels(): void {
    db.update(schema.models).set({ isNew: 0 }).run();
  }

  // ── QA reviews ──
  getLatestQaReview(projectId: number): QaReview | undefined {
    return db.select().from(schema.qaReviews)
      .where(eq(schema.qaReviews.projectId, projectId))
      .orderBy(desc(schema.qaReviews.createdAt))
      .limit(1)
      .get();
  }

  createQaReview(data: InsertQaReview): QaReview {
    return db.insert(schema.qaReviews).values({ ...data, createdAt: Date.now() }).returning().get()!;
  }
}

export const storage = new SQLiteStorage();

// Seed default agents on boot
storage.initDefaultAgents();
