import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Projects table
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("active"), // active | completed | paused
  progress: integer("progress").notNull().default(0),
  tasksTotal: integer("tasks_total").notNull().default(0),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  costToday: real("cost_today").notNull().default(0),
  avgResponseTime: real("avg_response_time").notNull().default(0),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// Agent events table
export const agentEvents = sqliteTable("agent_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  agentId: text("agent_id").notNull(), // manager | frontend | backend | qa | uiux | devops
  agentName: text("agent_name").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  status: text("status").notNull().default("info"), // info | success | warning | error
  timestamp: integer("timestamp").notNull(), // Unix ms
});

export const insertAgentEventSchema = createInsertSchema(agentEvents).omit({ id: true });
export type InsertAgentEvent = z.infer<typeof insertAgentEventSchema>;
export type AgentEvent = typeof agentEvents.$inferSelect;

// Agent states table (current state of each agent)
export const agentStates = sqliteTable("agent_states", {
  id: text("id").primaryKey(), // manager | frontend | backend | qa | uiux | devops
  name: text("name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("idle"), // idle | working | thinking | blocked | done
  currentTask: text("current_task"),
  color: text("color").notNull(),
  icon: text("icon").notNull(),
});

export const insertAgentStateSchema = createInsertSchema(agentStates);
export type InsertAgentState = z.infer<typeof insertAgentStateSchema>;
export type AgentState = typeof agentStates.$inferSelect;
