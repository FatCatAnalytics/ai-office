import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Agents table (full Stage 2) ──────────────────────────────────────────────
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(), // "manager" | "frontend" | "backend" | "qa" | "uiux" | "devops" | "dbarchitect" | "datascientist" | "secengineer" | "pm" | custom
  name: text("name").notNull(),
  role: text("role").notNull(),
  spriteType: text("sprite_type").notNull(), // matches sprite filename key
  provider: text("provider").notNull().default("anthropic"), // anthropic | openai | google | kimi
  modelId: text("model_id").notNull().default("claude-opus-4-7"),
  systemPrompt: text("system_prompt").notNull().default(""),
  capabilities: text("capabilities").notNull().default("[]"), // JSON array of strings
  reportsTo: text("reports_to"), // agentId or null (null = top-level, reports to Manager)
  status: text("status").notNull().default("idle"), // idle | working | thinking | blocked | done
  currentTask: text("current_task"),
  color: text("color").notNull(),
  icon: text("icon").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

export const insertAgentSchema = createInsertSchema(agents).omit({ createdAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

// ─── Projects table (extended) ─────────────────────────────────────────────────
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("normal"), // critical | high | normal | low
  status: text("status").notNull().default("planning"), // planning | active | blocked | completed | cancelled
  progress: integer("progress").notNull().default(0),
  deadline: integer("deadline"), // Unix ms, optional
  outputFormats: text("output_formats").notNull().default("[]"), // JSON array: pdf | csv | excel | python | json | markdown
  tasksTotal: integer("tasks_total").notNull().default(0),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  costToday: real("cost_today").notNull().default(0),
  avgResponseTime: real("avg_response_time").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// ─── Tasks table (new) ────────────────────────────────────────────────────────
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  projectId: integer("project_id").notNull(),
  assignedTo: text("assigned_to").notNull(), // agentId
  assignedBy: text("assigned_by").notNull().default("manager"), // always manager for now
  status: text("status").notNull().default("todo"), // todo | in_progress | blocked | done
  priority: text("priority").notNull().default("normal"), // critical | high | normal | low
  deadline: integer("deadline"), // Unix ms, optional
  blockedReason: text("blocked_reason"),
  // JSON string array of task IDs (or planner-local string keys) this task depends on.
  // Empty array ("[]") means no dependencies — the task can run in the first wave.
  dependsOn: text("depends_on").notNull().default("[]"),
  // 0-based wave index assigned by the topological sort. NULL until planning completes.
  waveIndex: integer("wave_index"),
  // Cost-routing tier set by the planner: low | medium | high.
  // low → cheap fast model (Kimi); medium → Haiku; high → Sonnet.
  complexity: text("complexity").notNull().default("medium"),
  // The actual modelId used for execution (after routing override). NULL until executed.
  modelUsed: text("model_used"),
  // Raw markdown output from the worker agent (Stage 4.17). Captured for QA review and debugging.
  // NULL until the task completes successfully.
  output: text("output"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// ─── Agent events table (unchanged) ───────────────────────────────────────────
export const agentEvents = sqliteTable("agent_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  agentId: text("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  status: text("status").notNull().default("info"), // info | success | warning | error
  timestamp: integer("timestamp").notNull(),
});

export const insertAgentEventSchema = createInsertSchema(agentEvents).omit({ id: true });
export type InsertAgentEvent = z.infer<typeof insertAgentEventSchema>;
export type AgentEvent = typeof agentEvents.$inferSelect;

// ─── Settings table (API keys per provider) ────────────────────────────────────
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});

export type Setting = typeof settings.$inferSelect;

// ─── Token usage table (per-model cost tracking) ──────────────────────────────────────────
export const tokenUsage = sqliteTable("token_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),    // anthropic | openai | google | kimi
  modelId: text("model_id").notNull(),     // e.g. claude-opus-4-7
  agentId: text("agent_id").notNull(),     // which agent made the call
  projectId: integer("project_id"),        // associated project (optional)
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  timestamp: integer("timestamp").notNull().$defaultFn(() => Date.now()),
});

export const insertTokenUsageSchema = createInsertSchema(tokenUsage).omit({ id: true, timestamp: true });
export type InsertTokenUsage = z.infer<typeof insertTokenUsageSchema>;
export type TokenUsage = typeof tokenUsage.$inferSelect;

// ─── Project files table (agent-generated outputs) ───────────────────────────────────
export const projectFiles = sqliteTable("project_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  taskId: integer("task_id"),                          // optional link to source task
  agentId: text("agent_id").notNull(),
  filename: text("filename").notNull(),
  fileType: text("file_type").notNull(),               // pdf | csv | excel | python | json | markdown | code
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  filePath: text("file_path").notNull(),               // absolute path on VPS
  description: text("description").notNull().default(""),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

export const insertProjectFileSchema = createInsertSchema(projectFiles).omit({ id: true, createdAt: true });
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;

// ─── Models registry (latest-models checker) ─────────────────────────────────
// Tracks every model id seen across providers. Refresh job upserts this and
// flips `isNew=true` on first sighting so the UI can flag fresh releases.
export const models = sqliteTable("models", {
  id: text("id").primaryKey(),                         // canonical "<provider>:<modelId>"
  provider: text("provider").notNull(),                // anthropic | openai | google | kimi
  modelId: text("model_id").notNull(),                 // e.g. claude-sonnet-4-6
  displayName: text("display_name").notNull().default(""),
  contextWindow: integer("context_window"),            // tokens, optional
  costPer1kIn: real("cost_per_1k_in"),                 // optional pricing snapshot
  costPer1kOut: real("cost_per_1k_out"),
  tier: text("tier").notNull().default("medium"),      // low | medium | high — heuristic classification
  preferredFor: text("preferred_for").notNull().default("none"), // low|medium|high|none — operator-pinned DEFAULT for that tier
  poolTiers: text("pool_tiers").notNull().default("[]"),         // JSON array of tiers this model is enrolled in (low|medium|high)
  enabled: integer("enabled").notNull().default(1),    // 1 = available for routing
  isNew: integer("is_new").notNull().default(0),       // 1 until acknowledged in UI
  discoveredAt: integer("discovered_at").notNull().$defaultFn(() => Date.now()),
  lastCheckedAt: integer("last_checked_at").notNull().$defaultFn(() => Date.now()),
});

export const insertModelSchema = createInsertSchema(models).omit({ discoveredAt: true, lastCheckedAt: true });
export type InsertModel = z.infer<typeof insertModelSchema>;
export type Model = typeof models.$inferSelect;

// ─── QA reviews (project sign-off) ───────────────────────────────────────────
// Auto-created when every regular task in a project finishes. The QA agent
// compares the original brief to delivered outputs and returns a structured
// verdict that drives the project's final status.
export const qaReviews = sqliteTable("qa_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  signedOff: integer("signed_off").notNull().default(0),  // 1 = ship, 0 = issues
  recommendation: text("recommendation").notNull().default("ship"), // ship | fix-and-resume | replan
  summary: text("summary").notNull().default(""),
  coverage: text("coverage").notNull().default("[]"),     // JSON: [{ask, met, evidence}]
  issues: text("issues").notNull().default("[]"),         // JSON: string[]
  modelUsed: text("model_used").notNull().default(""),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

export const insertQaReviewSchema = createInsertSchema(qaReviews).omit({ id: true, createdAt: true });
export type InsertQaReview = z.infer<typeof insertQaReviewSchema>;
export type QaReview = typeof qaReviews.$inferSelect;
