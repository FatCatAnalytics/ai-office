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
  // Stage 5.1: when this project was spawned by a recurring template, this
  // links back to the project_templates row that produced it. NULL for
  // user-created (one-shot) projects — the existing 100% case before 5.1.
  templateId: integer("template_id"),
  // Stage 5.x.12: per-project failover behaviour when a model hits its cap.
  //   ask   — pause the project and emit a `failover_required` ws event so
  //           the operator picks the substitute model (default).
  //   auto  — silently pick the next entry in the model's fallbackChain that
  //           still has budget + a configured API key.
  //   block — error out the task and leave the project blocked.
  failoverMode: text("failover_mode").notNull().default("ask"),
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

// ─── Project templates (Stage 5.1) ──────────────────────────────────
// A template is a re-runnable project recipe. Two kinds in 5.1:
//   weekly  — fires on a cron expression (Europe/London tz). Stage 5.2 wires
//             the real Analytical Banker editorial agents on top of these.
//   adhoc   — user clicks "Run now" with optional inputs (e.g. a public
//             GitHub repo URL). Lands in Stage 5.3.
// The scheduler advances `nextRunAt` after each tick; `lastRunAt` records
// the most recent fire so the UI can show "Last run: 2 days ago".
// `metadata` is a freeform JSON blob — individual template kinds use it for
// their own settings (e.g. weekly newsletter source list, adhoc repo URL).
export const projectTemplates = sqliteTable("project_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  kind: text("kind").notNull().default("weekly"),         // weekly | adhoc
  prompt: text("prompt").notNull(),                        // the project description handed to the Manager
  // Cron expression in standard 5-field form: "m h dom mon dow" (Europe/London).
  // Examples:
  //   "0 18 * * 0"   — Sundays at 18:00 UK
  //   "*/5 * * * *"  — every 5 minutes (used by the heartbeat smoke-test seed)
  // Empty string is allowed for kind=adhoc (templates that only run on demand).
  scheduleCron: text("schedule_cron").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),       // 1 = scheduler will fire it
  // Where the spawned project should write its final files. Path is relative
  // to the configured output root (server/index.ts), or absolute if it
  // starts with "/". Used by Stage 5.2 to route newsletters into
  // /srv/aioffice/output/newsletters/.
  outputDir: text("output_dir").notNull().default(""),
  // JSON object — kind-specific config. weekly: { sources: string[] };
  // adhoc: { repoUrl?: string }. Optional, defaults to "{}".
  metadata: text("metadata").notNull().default("{}"),
  // Stage 5.x.2 — deterministic task graph. When set, the orchestrator
  // SKIPS manager planning entirely and inserts these tasks verbatim on
  // every fire of the template. Format: JSON array of
  // { key, title, description, assignedTo, priority?, dependsOn?, complexity? }
  // Each `key` is referenced by `dependsOn` of later tasks (planner-local
  // ids, mapped to real DB ids by the orchestrator). Empty string means
  // "no reference plan, use the manager."
  //
  // Why this exists: as of Stage 5.x.2 the manager LLM kept ignoring the
  // 'use this exact task list' instructions baked into the brief and
  // re-decomposing the work along its own preferred lines (assigning QA
  // to the generic qa agent, splitting research into 4 sub-tasks, etc.).
  // For repeatable runs (weekly newsletter), determinism beats LLM
  // creativity — the LLM is still used inside each task for the actual
  // work, just not for graph planning.
  referencePlan: text("reference_plan").notNull().default(""),
  // Bookkeeping. Both Unix ms; nullable until first fire / first scheduling.
  lastRunAt: integer("last_run_at"),
  nextRunAt: integer("next_run_at"),
  // ID of the most recent project this template spawned. The Templates UI
  // uses it to deep-link "View last run".
  lastProjectId: integer("last_project_id"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});

export const insertProjectTemplateSchema = createInsertSchema(projectTemplates).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertProjectTemplate = z.infer<typeof insertProjectTemplateSchema>;
export type ProjectTemplate = typeof projectTemplates.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// Stage 6: Axl.ai — Investment Intelligence
// ═══════════════════════════════════════════════════════════════════════════
// Public-data-first, evidence-grounded investment workflows. Companies are
// the canonical entity. Sources, claims, calculations and contradictions
// feed the diligence run; the run produces an investment memo.

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  website: text("website"),
  domain: text("domain"),                                  // example.com (derived)
  kind: text("kind").notNull().default("startup"),         // startup | public | private | nonprofit
  ticker: text("ticker"),                                  // e.g. AAPL
  exchange: text("exchange"),                              // NYSE | NASDAQ | LSE | ...
  cik: text("cik"),                                        // SEC EDGAR identifier
  lei: text("lei"),                                        // GLEIF
  companiesHouseNumber: text("companies_house_number"),    // UK CH number
  country: text("country"),
  sector: text("sector"),
  industry: text("industry"),
  foundedYear: integer("founded_year"),
  description: text("description").notNull().default(""),
  metadata: text("metadata").notNull().default("{}"),      // freeform JSON
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// Every external piece of evidence we pulled in. URL + retrievedAt is the
// audit trail; the raw text lets us re-extract without re-fetching.
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id"),
  diligenceRunId: integer("diligence_run_id"),
  title: text("title").notNull().default(""),
  url: text("url").notNull(),
  sourceType: text("source_type").notNull(),               // sec_filing | companies_house | gleif | gdelt | news_rss | openalex | arxiv | website | market_data | deck | other
  publisher: text("publisher"),
  domain: text("domain"),
  publishedDate: integer("published_date"),                // unix ms if known
  retrievedDate: integer("retrieved_date").notNull().$defaultFn(() => Date.now()),
  rawText: text("raw_text").notNull().default(""),
  extractedText: text("extracted_text").notNull().default(""),
  reliabilityScore: real("reliability_score").notNull().default(0.5), // 0..1
  metadata: text("metadata").notNull().default("{}"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertSourceSchema = createInsertSchema(sources).omit({ id: true, createdAt: true });
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type Source = typeof sources.$inferSelect;

// Atomic factual claim about a company. Linked to one source (where it was
// extracted from) and optionally other supporting sources via supportingSourceIds.
// status must be one of:
//   verified | company_claimed | third_party_reported | calculated |
//   inferred | unverified | contradicted | outdated
export const claims = sqliteTable("claims", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  diligenceRunId: integer("diligence_run_id"),
  sourceId: integer("source_id"),                          // primary source
  supportingSourceIds: text("supporting_source_ids").notNull().default("[]"), // JSON int[]
  statement: text("statement").notNull(),                  // natural-language claim
  subject: text("subject").notNull().default(""),          // optional: "revenue", "team-size", etc.
  numericValue: real("numeric_value"),                     // if claim is numeric
  unit: text("unit"),                                      // e.g. USD, %, headcount
  status: text("status").notNull().default("company_claimed"),
  confidence: real("confidence").notNull().default(0.5),   // 0..1
  evidenceQuote: text("evidence_quote").notNull().default(""),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertClaimSchema = createInsertSchema(claims).omit({ id: true, createdAt: true });
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claims.$inferSelect;

// A deterministic calculation performed against one or more claims. Done in
// code (analytics-service or TS), never by the LLM. Storing inputs + formula
// lets a reader audit-replay the math.
export const calculations = sqliteTable("calculations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  diligenceRunId: integer("diligence_run_id"),
  name: text("name").notNull(),                            // e.g. "valuation_to_arr"
  formula: text("formula").notNull().default(""),          // human-readable formula
  inputs: text("inputs").notNull().default("{}"),          // JSON object of named inputs
  inputClaimIds: text("input_claim_ids").notNull().default("[]"), // JSON int[]
  resultValue: real("result_value"),
  resultText: text("result_text").notNull().default(""),
  unit: text("unit"),
  explanation: text("explanation").notNull().default(""),
  status: text("status").notNull().default("ok"),          // ok | error | warning
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertCalculationSchema = createInsertSchema(calculations).omit({ id: true, createdAt: true });
export type InsertCalculation = z.infer<typeof insertCalculationSchema>;
export type Calculation = typeof calculations.$inferSelect;

// Recorded when two claims (or a claim and a calculation) disagree.
export const contradictions = sqliteTable("contradictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  diligenceRunId: integer("diligence_run_id"),
  claimAId: integer("claim_a_id").notNull(),
  claimBId: integer("claim_b_id"),                         // null when contradicted by a calculation
  calculationId: integer("calculation_id"),
  severity: text("severity").notNull().default("medium"),  // low | medium | high
  description: text("description").notNull().default(""),
  resolved: integer("resolved").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertContradictionSchema = createInsertSchema(contradictions).omit({ id: true, createdAt: true });
export type InsertContradiction = z.infer<typeof insertContradictionSchema>;
export type Contradiction = typeof contradictions.$inferSelect;

// A diligence run ties a company to a workflow execution. Tracks lifecycle
// for the UI and stores the final salience/confidence scores.
export const diligenceRuns = sqliteTable("diligence_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  kind: text("kind").notNull().default("startup"),         // startup | public_equity | thesis_review
  status: text("status").notNull().default("queued"),      // queued | running | completed | failed | cancelled
  summary: text("summary").notNull().default(""),
  inputs: text("inputs").notNull().default("{}"),          // user-supplied: deck text, model link, etc.
  salienceScore: real("salience_score"),
  confidenceScore: real("confidence_score"),
  scoreBreakdown: text("score_breakdown").notNull().default("{}"),
  redFlags: text("red_flags").notNull().default("[]"),     // JSON string[]
  openQuestions: text("open_questions").notNull().default("[]"),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  error: text("error"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertDiligenceRunSchema = createInsertSchema(diligenceRuns).omit({ id: true, createdAt: true });
export type InsertDiligenceRun = z.infer<typeof insertDiligenceRunSchema>;
export type DiligenceRun = typeof diligenceRuns.$inferSelect;

export const investmentMemos = sqliteTable("investment_memos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  diligenceRunId: integer("diligence_run_id").notNull(),
  companyId: integer("company_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),                 // markdown
  recommendation: text("recommendation").notNull().default("watch"), // pursue | watch | pass | hold | buy | sell
  thesisSummary: text("thesis_summary").notNull().default(""),
  citedSourceIds: text("cited_source_ids").notNull().default("[]"),
  citedClaimIds: text("cited_claim_ids").notNull().default("[]"),
  disclaimer: text("disclaimer").notNull().default(""),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertInvestmentMemoSchema = createInsertSchema(investmentMemos).omit({ id: true, createdAt: true });
export type InsertInvestmentMemo = z.infer<typeof insertInvestmentMemoSchema>;
export type InvestmentMemo = typeof investmentMemos.$inferSelect;

export const watchlists = sqliteTable("watchlists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  thesis: text("thesis").notNull().default(""),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertWatchlistSchema = createInsertSchema(watchlists).omit({ id: true, createdAt: true });
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type Watchlist = typeof watchlists.$inferSelect;

export const watchlistItems = sqliteTable("watchlist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  watchlistId: integer("watchlist_id").notNull(),
  companyId: integer("company_id").notNull(),
  note: text("note").notNull().default(""),
  addedAt: integer("added_at").notNull().$defaultFn(() => Date.now()),
});
export const insertWatchlistItemSchema = createInsertSchema(watchlistItems).omit({ id: true, addedAt: true });
export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
export type WatchlistItem = typeof watchlistItems.$inferSelect;

export const marketSignals = sqliteTable("market_signals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id"),                        // optional — signal can be sector-wide
  kind: text("kind").notNull(),                            // news | filing | price_move | volume_spike | sentiment | anomaly
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  url: text("url"),
  severity: text("severity").notNull().default("info"),    // info | low | medium | high
  publishedAt: integer("published_at"),
  capturedAt: integer("captured_at").notNull().$defaultFn(() => Date.now()),
  metadata: text("metadata").notNull().default("{}"),
});
export const insertMarketSignalSchema = createInsertSchema(marketSignals).omit({ id: true, capturedAt: true });
export type InsertMarketSignal = z.infer<typeof insertMarketSignalSchema>;
export type MarketSignal = typeof marketSignals.$inferSelect;

export const CLAIM_STATUSES = [
  "verified",
  "company_claimed",
  "third_party_reported",
  "calculated",
  "inferred",
  "unverified",
  "contradicted",
  "outdated",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// ─── Provider balances table (Stage 5.x.12) ──────────────────────────────────
// Per-provider credit/budget tracking so the dashboard can warn before a run
// hits the wall and the orchestrator can fail over. Three sources:
//   live    — provider exposes a real-time balance API (DeepSeek today).
//   tracked — computed locally from token_usage × cost vs. the configured cap.
//   manual  — operator typed the balance in by hand.
//
// `balanceUsd` is the credit/budget REMAINING in USD. `capUsd` is the period
// budget. `usedUsd` is what we've spent in the current period. The fetcher
// (server/providerBalances.ts) keeps these in sync and broadcasts updates
// over websocket so the UI stays live.
export const providerBalances = sqliteTable("provider_balances", {
  id: text("id").primaryKey(),                          // canonical "<provider>:<modelId>"
  provider: text("provider").notNull(),                 // anthropic | openai | google | kimi | deepseek
  modelId: text("model_id").notNull().default("*"),     // "*" = whole-provider bucket; otherwise a specific model id
  capUsd: real("cap_usd").notNull().default(0),         // operator-set monthly USD cap; 0 = no cap
  balanceUsd: real("balance_usd").notNull().default(0), // remaining balance (live or computed)
  usedUsd: real("used_usd").notNull().default(0),       // spent this period
  source: text("source").notNull().default("tracked"),  // live | tracked | manual
  alertThreshold: real("alert_threshold").notNull().default(0.85), // 0–1; warn when usedUsd/capUsd > threshold
  failoverMode: text("failover_mode").notNull().default("ask"),    // ask | auto | block
  // JSON array of fallback models in preference order, e.g.
  //   ["openai:gpt-5.5", "google:gemini-3-pro", "deepseek:deepseek-v4-pro"]
  // When the cap is hit and failoverMode === 'auto', the orchestrator picks
  // the first chain entry whose provider key is configured AND has remaining
  // budget. Empty "[]" means "use the default tier chain".
  fallbackChain: text("fallback_chain").notNull().default("[]"),
  // Stage 5.x.26: when 1, the router treats this provider as unusable
  // regardless of cap state — set by the failover modal when the operator
  // picks a substitute after a runtime credit-exhaust error (where the
  // provider hasn't actually hit a configured monthly cap, so usedUsd >=
  // capUsd is false but Anthropic/OpenAI/etc still rejected the call).
  // The router consults fallbackChain on rows where forceFailover is set.
  // Cleared by the operator in the budget UI or by a successful balance
  // refresh that returns positive credit.
  forceFailover: integer("force_failover", { mode: "boolean" }).notNull().default(false),
  lastFetchedAt: integer("last_fetched_at"),
  fetchError: text("fetch_error"),                      // last fetch error message, if any
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});

export const insertProviderBalanceSchema = createInsertSchema(providerBalances).omit({ updatedAt: true });
export type InsertProviderBalance = z.infer<typeof insertProviderBalanceSchema>;
export type ProviderBalance = typeof providerBalances.$inferSelect;
