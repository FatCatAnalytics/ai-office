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
  modelId: text("model_id").notNull().default("claude-opus-4-5"),
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
