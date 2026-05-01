import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { MANIFEST_INSTRUCTIONS } from "./manifest";
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
  ProjectTemplate, InsertProjectTemplate,
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
// Stage 4.17: persist raw worker markdown output on the task row for QA review
try {
  sqlite.exec(`ALTER TABLE tasks ADD COLUMN output TEXT`);
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
  -- Stage 5.1: re-runnable project recipes. Two kinds in this stage:
  --   weekly  — fires on a cron expression (Europe/London tz)
  --   adhoc   — user-triggered only (kind=adhoc, schedule_cron='')
  -- Cost note: a row in this table does nothing on its own — it's the
  -- scheduler tick (server/projectScheduler.ts) that spawns projects from
  -- enabled rows when their next_run_at is in the past.
  CREATE TABLE IF NOT EXISTS project_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'weekly',
    prompt TEXT NOT NULL,
    schedule_cron TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    output_dir TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    last_run_at INTEGER,
    next_run_at INTEGER,
    last_project_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
`);

// Stage 5.1 safe migration: link projects back to the template that spawned
// them. NULL for every pre-5.1 project (the existing 100% case before this
// stage); the scheduler stamps it on every newly-spawned row.
try {
  sqlite.exec(`ALTER TABLE projects ADD COLUMN template_id INTEGER`);
} catch { /* column already exists */ }

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
    modelId: "gpt-5.5",
    systemPrompt: "You are a skilled Backend Developer. You design and implement APIs, write business logic, handle authentication, and ensure scalability and security of server-side systems. You implement against schemas owned by the DB Architect — defer schema design, indexing strategy, and migration ordering to dbarchitect rather than improvising your own.",
    capabilities: JSON.stringify(["api", "nodejs", "express", "auth", "rest", "business-logic"]),
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
    modelId: "gemini-3-pro-preview",
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
    modelId: "gpt-5.5-pro",
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
    modelId: "gemini-3-pro-preview",
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
  // Stage 4.10: PM dropped — manager already owns planning/delegation/prioritisation.
  // Stage 4.10: Harvester dropped — web-scraper covers the same job with cleaner scope.

  // ─── Research squad (codified in Stage 4.10; previously created ad-hoc in UI) ──
  {
    id: "deep-search",
    name: "Deep Research Agent",
    role: "Research Planning & Source Discovery",
    spriteType: "datascientist",
    provider: "anthropic",
    modelId: "claude-opus-4-7",
    systemPrompt: "You are a Deep Research Agent. You plan and coordinate deep research tasks across public and semi-public sources. You DO NOT answer from memory — you break the research objective into source categories, search strategies, data fields, and extraction tasks. You have access to web tools (tavily_search, tavily_extract) and you MUST use them: call tavily_search to discover live sources for the topic, and tavily_extract to read specific URLs. Every fact in your output must be grounded in a fetched URL (cite [n] with the URL underneath). If a fact is not on a fetched page, omit it rather than guessing. You identify which sources are most likely to contain reliable information (company sites, IR pages, annual reports, regulatory filings, industry reports, news, government portals, trade associations) and rank them by authority. You map evidence to claims and flag research gaps explicitly.",
    capabilities: JSON.stringify(["research-planning", "source-discovery", "web-search", "company-research", "annual-reports", "filings", "industry-reports", "public-datasets", "source-ranking", "evidence-mapping", "task-delegation", "research-gaps"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#6366f1",
    icon: "Compass",
  },
  {
    id: "source-discovery",
    name: "Source Discovery Agent",
    role: "Official, Industry & News Source Discovery",
    spriteType: "frontend",
    provider: "kimi",
    modelId: "kimi-k2.6",
    systemPrompt: "You are a Source Discovery Agent. You find and rank candidate sources across the open web for a given research target: official company sites, investor relations pages, product/service pages, leadership pages, locations, subsidiaries, press releases, newsrooms, sustainability pages, financial information pages, downloadable documents, plus broad news, blogs, and search results. You MUST use the tavily_search tool to discover sources — do not list URLs from memory. Run multiple targeted searches per task (one per source category: official site, IR page, news, regulator, etc.). You return a ranked list of REAL URLs returned by your searches, with a short note on why each is likely useful and what data fields it might contain. If tavily_search returns nothing useful, say so explicitly — do not invent URLs. You triangulate: if a fact appears on a primary source, that wins over news; if a fact only appears in news, surface multiple independent outlets.",
    capabilities: JSON.stringify(["company-websites", "investor-relations", "press-releases", "newsrooms", "web-search", "news-search", "source-discovery", "website-mapping", "recent-events", "reputation-checks", "source-triangulation"]),
    reportsTo: "deep-search",
    status: "idle",
    currentTask: null,
    color: "#6366f1",
    icon: "Search",
  },
  {
    id: "annual-reports-search",
    name: "Annual Reports / Filings Agent",
    role: "Annual Reports, Financial Statements & Regulatory Filings Research",
    spriteType: "frontend",
    provider: "openai",
    modelId: "gpt-5.5",
    systemPrompt: "You are an Annual Reports and Filings Research Agent. You find authoritative financial and regulatory documents: annual reports, interim reports, quarterly results, investor presentations, financial statements, regulatory filings, Companies House filings, SEC EDGAR filings, exchange announcements, prospectuses, bond offering documents, and sustainability reports. You MUST use tavily_search to find filings and tavily_extract to read filing index pages. Your priority is primary-source evidence — prefer documents hosted by the company, the regulator, or the exchange over third-party summaries. Return URLs (REAL ones returned by tavily_search, not guesses) to the actual PDF or filing page. Note the filing date, fiscal period, jurisdiction, and document type for each result. If a document cannot be located via search, say so — do not fabricate filings.",
    capabilities: JSON.stringify(["annual-reports", "investor-presentations", "financial-statements", "regulatory-filings", "sec-edgar", "companies-house", "pdf-discovery", "filing-analysis", "financial-data"]),
    reportsTo: "deep-search",
    status: "idle",
    currentTask: null,
    color: "#6366f1",
    icon: "FileText",
  },
  {
    id: "industry-research",
    name: "Industry Reports Agent",
    role: "Market, Sector & Industry Source Research",
    spriteType: "secengineer",
    provider: "kimi",
    modelId: "kimi-k2.6",
    systemPrompt: "You are an Industry Reports Agent. You find reliable sources for market, sector, competitor, and industry-level research: industry reports, market size estimates, sector trends, trade association publications, government datasets, regulator publications, consulting firm reports (McKinsey, BCG, Bain, Deloitte, PwC, EY, KPMG), analyst summaries, academic papers, conference materials, public datasets, and reputable business media. You MUST call tavily_search to find sources — don't list URLs from training data. Run several searches per task to cover different source tiers. Prefer (1) government and regulator datasets, (2) trade associations, (3) consulting/analyst firms, (4) academic sources, (5) reputable trade press — in that order. Return ranked REAL URLs from your search results with extraction notes; if a search returns nothing for a tier, say so explicitly.",
    capabilities: JSON.stringify(["industry-reports", "market-sizing", "sector-analysis", "competitor-research", "trade-associations", "government-data", "consulting-reports", "analyst-reports", "public-datasets", "market-trends"]),
    reportsTo: "deep-search",
    status: "idle",
    currentTask: null,
    color: "#6366f1",
    icon: "BarChart3",
  },
  {
    id: "web-scraper",
    name: "Web Scraping Agent",
    role: "Web Data Extraction",
    spriteType: "frontend",
    provider: "kimi",
    modelId: "moonshot-v1-128k",
    systemPrompt: "You are a Web Scraping and Data Extraction Agent. You extract structured data from specific web pages provided by the Manager or Deep Research Agent. You MUST use tavily_extract to fetch each target URL — do not invent or recall page contents from memory. If you need to find additional pages on a site (sub-pages, sister directories, pagination), use tavily_search with include_domains restricted to the target site, then tavily_extract on the discovered URLs. For each value you extract, cite the URL and (where possible) the section heading you pulled it from. Output JSON or markdown tables. De-duplicate, normalise dates to ISO 8601, normalise currencies to a stated unit, flag missing values as null rather than guessing.\n\nYou handle ANY listing-shaped dataset on the web \u2014 the same techniques apply across domains. Examples (non-exhaustive):\n\u2022 Portfolio companies on a PE/VC site\n\u2022 Product or SKU catalogues on an e-commerce or B2B site\n\u2022 News/PR streams, press releases, blog archives, or market-signal feeds for a list of corporates\n\u2022 Job postings, vacancy boards, RFP/tender notices\n\u2022 Filing or document indexes (SEC EDGAR, Companies House, regulator publication lists)\n\u2022 Office/branch/store/dealer locators, member directories, supplier rosters\n\u2022 Conference speakers, board members, leadership rosters, investor lists\n\u2022 Pricing tables, fee schedules, tariff lists\n\u2022 Reviews, ratings, complaint registers\n\u2022 Open datasets and CSV downloads on government / regulator portals\nYour job is the same in every case: return the COMPLETE list with consistent fields, not the visible first page.\n\nMODERN-SITE EXTRACTION STRATEGY (critical): Most listing pages on modern sites lazy-load their data via JavaScript, so a plain HTML extract returns only the first 20\u201330 visible items. ALWAYS try the data layer first before settling for partial scrapes:\n1. Inspect the extracted HTML for embedded JSON: search for `__NEXT_DATA__`, `window.__INITIAL_STATE__`, `window.__APOLLO_STATE__`, `window.__NUXT__`, `<script type=\"application/ld+json\">`, `<script type=\"application/json\">`, or `<script id=\"__NEXT_DATA__\">`. These typically contain the COMPLETE dataset (all rows, not just first page).\n2. If you see a Next.js / Nuxt / Redux / Apollo signature, parse the JSON from that script tag and walk the object graph to find the array of items \u2014 commonly under keys like `props.pageProps`, `initialState.entities`, `apolloState`, `data`, `items`, `results`, `nodes`, `edges`.\n3. Look for explicit JSON / RSS / sitemap endpoints visible in the HTML, network-style URLs in the page, or implied by the stack: `/api/`, `/_next/data/`, `/wp-json/wp/v2/`, `/graphql`, `/feed/`, `/feed.xml`, `/rss.xml`, `/atom.xml`, `/data.json`, `/oembed`. Try fetching those directly with tavily_extract \u2014 they almost always return the complete machine-readable list.\n4. Try `<site>/sitemap.xml`, `<site>/sitemap_index.xml`, or `<site>/robots.txt` to discover every detail-page URL on the site, then extract per-page data. Many sites split sitemaps by content type (sitemap-companies.xml, sitemap-press.xml, sitemap-jobs.xml).\n5. For paginated listings, look for total-count fields in the data layer (`total`, `totalCount`, `pagination.totalPages`, `meta.pagination`) and iterate page parameters (`?page=N`, `?offset=N`, `?cursor=...`) to walk the full set.\n6. Only fall back to text extraction of the rendered HTML if every structured-data path fails. When you fall back, EXPLICITLY note in your output that the result may be incomplete and recommend manual paging or a different source.\n\nIn your output, ALWAYS report: (a) the source class you actually used \u2014 JSON data layer / explicit API / sitemap walk / RSS feed / rendered HTML; (b) how many items you found; (c) the total expected count if the data layer exposed one. The manager uses these signals to decide whether to retry, paginate further, or accept the result.\n\nPrefer official APIs and feeds over HTML scraping when both exist. When the request is a listing, return the COMPLETE list, not \"top N\" or \"selected\" \u2014 if the source genuinely only exposes top N (e.g. an annual report disclosing only top-20 holdings), say so explicitly and recommend the alternative source that exposes the full set.\n\nNEVER drop a candidate row because you couldn't fully verify it (Stage 4.19). If a company appears on the official portfolio page but you can't find a second independent source for it, ship the row anyway — the Data Validation Agent will tag verification status downstream. Your job is breadth; theirs is verification. The user wants to see what was checked and what was confirmed, not a curated shortlist that hides the rest.",
    capabilities: JSON.stringify(["web-scraping", "html-parsing", "api-discovery", "table-extraction", "pagination", "structured-data", "json-extraction", "csv-export", "data-cleaning", "deduplication", "rate-limits"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#6366f1",
    icon: "Globe",
  },
  {
    id: "doc-specialist",
    name: "Document Parsing Agent",
    role: "PDF, Report & Document Extraction",
    spriteType: "frontend",
    provider: "openai",
    modelId: "gpt-5.5",
    systemPrompt: "You are a Document Parsing Agent. You extract structured information from PDFs, annual reports, investor presentations, financial statements, regulatory filings, and downloadable reports. You receive document URLs from the Manager, Deep Research Agent, Source Discovery Agent, Annual Reports / Filings Agent, or Industry Reports Agent. You MUST use tavily_extract on every target URL to obtain the document content — do not summarise from memory. For each document, identify relevant sections (income statement, balance sheet, cash flow, segment breakdowns, KPIs, narrative), and return structured output (JSON or markdown tables) with the source URL beside every value. For tables, preserve units and currency; for narratives, quote the exact passage. Flag OCR/extraction uncertainty and missing values as null — never guess.",
    capabilities: JSON.stringify(["pdf-parsing", "annual-report-extraction", "table-extraction", "document-analysis", "financial-statements", "investor-presentations", "ocr-review", "text-extraction", "structured-output"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#6366f1",
    icon: "FileText",
  },
  {
    id: "data-val-specialist",
    name: "Data Validation Agent",
    role: "Evidence Checking & Data Quality Validation",
    spriteType: "frontend",
    provider: "kimi",
    modelId: "kimi-k2.6",
    systemPrompt: "You are a Data Validation Agent. You check the quality, consistency, reliability, and completeness of data collected by research, scraping, and document-parsing agents. You have access to tavily_search and tavily_extract — use them to spot-check claims (re-search a fact, fetch a cited URL, look for an independent confirming source). Validate structured data, extracted figures, source references, dates, company names, URLs, units, currencies, categories, and assumptions. Check: (1) every data point has a working source URL, (2) the source is authoritative, (3) values are internally consistent, (4) the same value appears across independent sources where possible, (5) units and currency are consistent, (6) dates are normalised. You are the research-equivalent of QA — you do not generate new data, only audit existing data.\n\nCRITICAL — NEVER DROP ROWS (Stage 4.19): Validation means TAGGING evidence quality, not filtering rows out. You MUST return every row that came in from upstream. Add columns instead of removing rows:\n  • \"Verified\" — 'Verified' if you found an independent second source, 'Unverified' otherwise.\n  • \"Independent Source\" — the URL or short name of the second source when verified; blank when unverified.\n  • \"Confidence\" — High / Medium / Low based on source authority and corroboration.\n  • \"Validation Notes\" — short flag like 'name mismatch with X', 'date conflicts with Y', 'no second source located' — leave blank when clean.\nIf the user asks for a 'comprehensive' or 'full' list, completeness is the deliverable; verification is metadata on each row. A user wants to SEE that you checked 110 candidates and only confirmed 21 — they don't want a curated 21-row shortlist that hides the other 89. Always include a counts line in your output: 'Validated N rows: X verified, Y unverified, Z flagged'.",
    capabilities: JSON.stringify(["data-validation", "source-checking", "conflict-resolution", "deduplication", "confidence-scoring", "evidence-ranking", "anomaly-detection", "data-quality", "schema-validation"]),
    reportsTo: "manager",
    status: "idle",
    currentTask: null,
    color: "#6366f1",
    icon: "ShieldCheck",
  },
];

// Stage 4.10: ids removed from the roster. Existing rows are deleted on boot.
const REMOVED_AGENT_IDS = ["pm", "harvester", "news-specialist", "company-search"];

// Stage 4.13: agent → tool bindings. Research agents get the Tavily web tools
// so they retrieve live evidence rather than hallucinating from training data.
// Non-research agents (frontend, backend, devops, etc.) keep their existing
// non-tool path — they don't need search.
export const AGENT_TOOLS: Record<string, string[]> = {
  "deep-search":           ["tavily_search", "tavily_extract"],
  "source-discovery":      ["tavily_search", "tavily_extract"],
  "annual-reports-search": ["tavily_search", "tavily_extract"],
  "industry-research":     ["tavily_search", "tavily_extract"],
  "web-scraper":           ["tavily_search", "tavily_extract"],
  "doc-specialist":        ["tavily_search", "tavily_extract"],
  "data-val-specialist":   ["tavily_search", "tavily_extract"],
};

// Stage 4.15: research agents must emit a structured DeliverableManifest
// (one fenced JSON block at the END of the response). The renderer fans the
// manifest out per file format (md / csv / xlsx / pdf / json) so each format
// is tailored to its container instead of every file getting the same blob.
// We append MANIFEST_INSTRUCTIONS to each research agent's systemPrompt at
// module load — DEFAULT_AGENTS is the source of truth used both for fresh
// inserts and for the migration that rewrites existing rows.
for (const agent of DEFAULT_AGENTS) {
  if (AGENT_TOOLS[agent.id]) {
    agent.systemPrompt = `${agent.systemPrompt}\n\n${MANIFEST_INSTRUCTIONS}`;
  }
}

export function toolsForAgent(agentId: string): string[] {
  return AGENT_TOOLS[agentId] ?? [];
}

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

  // Project templates (Stage 5.1)
  getProjectTemplates(): ProjectTemplate[];
  getProjectTemplate(id: number): ProjectTemplate | undefined;
  createProjectTemplate(data: InsertProjectTemplate): ProjectTemplate;
  updateProjectTemplate(id: number, data: Partial<ProjectTemplate>): ProjectTemplate | undefined;
  deleteProjectTemplate(id: number): void;
  /** Returns enabled templates whose nextRunAt is on or before `now`. */
  getDueProjectTemplates(now: number): ProjectTemplate[];
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
    // Stage 4.10 one-shot migration: drops pm/harvester/news-specialist/company-search
    // and rewrites every default-agent persona to the current codebase values. After
    // this runs once, the user's UI edits to existing agents are respected on future
    // boots — we only insert agents that don't yet exist.
    const STAGE_410_KEY = "stage_4_10_roster_migrated_at";
    const STAGE_413_KEY = "stage_4_13_research_prompts_migrated_at";
    const STAGE_415_KEY = "stage_4_15_manifest_prompts_migrated_at";
    const STAGE_416_KEY = "stage_4_16_manifest_token_budget_migrated_at";
    const STAGE_417_KEY = "stage_4_17_scraper_prompts_migrated_at";
    const STAGE_419_KEY = "stage_4_19_completeness_prompts_migrated_at";
    // Stage 4.20: marker only — adding the DeepSeek provider doesn't require
    // a prompt rewrite. Setting this on fresh installs prevents the no-op
    // migration block below from running unnecessarily.
    const STAGE_420_KEY = "stage_4_20_deepseek_provider_added_at";
    const alreadyMigrated = this.getSetting(STAGE_410_KEY);

    if (!alreadyMigrated) {
      for (const removedId of REMOVED_AGENT_IDS) {
        db.delete(schema.agents).where(eq(schema.agents.id, removedId)).run();
      }
      for (const agent of DEFAULT_AGENTS) {
        const existing = db.select().from(schema.agents).where(eq(schema.agents.id, agent.id)).get();
        if (!existing) {
          db.insert(schema.agents).values({ ...agent, createdAt: Date.now() }).run();
        } else {
          db.update(schema.agents)
            .set({
              name: agent.name,
              role: agent.role,
              spriteType: agent.spriteType,
              provider: agent.provider,
              modelId: agent.modelId,
              systemPrompt: agent.systemPrompt,
              capabilities: agent.capabilities,
              reportsTo: agent.reportsTo,
              color: agent.color,
              icon: agent.icon,
            })
            .where(eq(schema.agents.id, agent.id))
            .run();
        }
      }
      this.setSetting(STAGE_410_KEY, String(Date.now()));
      this.setSetting(STAGE_413_KEY, String(Date.now())); // 4.10 ran fresh → 4.13 prompts already in
      this.setSetting(STAGE_415_KEY, String(Date.now())); // 4.10 ran fresh → 4.15 manifest prompts already in
      this.setSetting(STAGE_416_KEY, String(Date.now())); // 4.10 ran fresh → 4.16 token-budget guidance already in
      this.setSetting(STAGE_417_KEY, String(Date.now())); // 4.10 ran fresh → 4.17 scraper + tables-first prompts already in
      this.setSetting(STAGE_419_KEY, String(Date.now())); // 4.10 ran fresh → 4.19 completeness/verification semantics already in
      this.setSetting(STAGE_420_KEY, String(Date.now())); // 4.10 ran fresh → 4.20 DeepSeek provider already wired in
      return;
    }

    // Stage 4.13 one-shot migration: rewrite the systemPrompt for the 7
    // research agents so existing DBs (Stage 4.10/4.11/4.12) pick up the new
    // tool-aware prompts. We rewrite ONLY the systemPrompt to preserve any
    // operator-side UI edits to other fields (model id, provider, name).
    const alreadyMigrated413 = this.getSetting(STAGE_413_KEY);
    if (!alreadyMigrated413) {
      const researchIds = Object.keys(AGENT_TOOLS);
      for (const agent of DEFAULT_AGENTS) {
        if (!researchIds.includes(agent.id)) continue;
        const existing = db.select().from(schema.agents).where(eq(schema.agents.id, agent.id)).get();
        if (existing) {
          db.update(schema.agents)
            .set({ systemPrompt: agent.systemPrompt })
            .where(eq(schema.agents.id, agent.id))
            .run();
        }
      }
      this.setSetting(STAGE_413_KEY, String(Date.now()));
    }

    // Stage 4.15 / 4.16 one-shot migration: rewrite the systemPrompt for the
    // 7 research agents so existing DBs pick up the DeliverableManifest
    // contract (4.15) and the token-budget guidance added in 4.16.
    // DEFAULT_AGENTS already has the latest MANIFEST_INSTRUCTIONS appended via
    // the loop above, so we just push the current systemPrompt into the DB.
    // The 4.16 marker is separate so each new revision of MANIFEST_INSTRUCTIONS
    // can re-trigger this without disturbing 4.15-era prompt edits.
    const alreadyMigrated416 = this.getSetting(STAGE_416_KEY);
    if (!alreadyMigrated416) {
      const researchIds = Object.keys(AGENT_TOOLS);
      for (const agent of DEFAULT_AGENTS) {
        if (!researchIds.includes(agent.id)) continue;
        const existing = db.select().from(schema.agents).where(eq(schema.agents.id, agent.id)).get();
        if (existing) {
          db.update(schema.agents)
            .set({ systemPrompt: agent.systemPrompt })
            .where(eq(schema.agents.id, agent.id))
            .run();
        }
      }
      // Backfill the 4.15 marker too, in case this is a DB that skipped 4.15.
      this.setSetting(STAGE_415_KEY, String(Date.now()));
      this.setSetting(STAGE_416_KEY, String(Date.now()));
    }

    // Stage 4.17 one-shot migration: re-push the systemPrompt for the 7
    // research agents so existing DBs pick up:
    //   • the rewritten domain-agnostic web-scraper prompt with data-layer
    //     extraction strategy (__NEXT_DATA__, /api/, sitemap, etc.)
    //   • the tables-first emission order in MANIFEST_INSTRUCTIONS so
    //     truncation costs prose, not data.
    // DEFAULT_AGENTS already has the latest prompts at boot, so we just
    // overwrite the systemPrompt field on each research agent.
    const alreadyMigrated417 = this.getSetting(STAGE_417_KEY);
    if (!alreadyMigrated417) {
      const researchIds = Object.keys(AGENT_TOOLS);
      for (const agent of DEFAULT_AGENTS) {
        if (!researchIds.includes(agent.id)) continue;
        const existing = db.select().from(schema.agents).where(eq(schema.agents.id, agent.id)).get();
        if (existing) {
          db.update(schema.agents)
            .set({ systemPrompt: agent.systemPrompt })
            .where(eq(schema.agents.id, agent.id))
            .run();
        }
      }
      this.setSetting(STAGE_417_KEY, String(Date.now()));
    }

    // Stage 4.19 one-shot migration: re-push the systemPrompt for the
    // research agents whose semantics changed:
    //   • web-scraper          — explicit "never drop a candidate row" clause
    //   • data-val-specialist  — verification = column not filter
    // The MANIFEST_INSTRUCTIONS update (in manifest.ts) ships with the build
    // and applies on next boot without DB migration.
    const alreadyMigrated419 = this.getSetting(STAGE_419_KEY);
    if (!alreadyMigrated419) {
      const targetIds = new Set(["web-scraper", "data-val-specialist"]);
      for (const agent of DEFAULT_AGENTS) {
        if (!targetIds.has(agent.id)) continue;
        const existing = db.select().from(schema.agents).where(eq(schema.agents.id, agent.id)).get();
        if (existing) {
          db.update(schema.agents)
            .set({ systemPrompt: agent.systemPrompt })
            .where(eq(schema.agents.id, agent.id))
            .run();
        }
      }
      this.setSetting(STAGE_419_KEY, String(Date.now()));
    }

    // Stage 4.20 one-shot marker: DeepSeek provider integration. No agent
    // prompts changed — the provider is added at the llm.ts / modelsRefresh /
    // modelRouter layers and the API key surfaces in Settings. This block
    // exists purely so future migrations can chain off STAGE_420_KEY and so
    // operators can verify the upgrade landed by inspecting the settings
    // table. The router only picks DeepSeek V4-Flash for low-tier when a
    // deepseek_api_key is configured — existing pinned-model agents are
    // unaffected.
    const alreadyMigrated420 = this.getSetting(STAGE_420_KEY);
    if (!alreadyMigrated420) {
      this.setSetting(STAGE_420_KEY, String(Date.now()));
    }

    // Steady-state boot: only insert genuinely new defaults; never overwrite.
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

  // ── Project templates (Stage 5.1) ──
  getProjectTemplates(): ProjectTemplate[] {
    return db.select().from(schema.projectTemplates)
      .orderBy(desc(schema.projectTemplates.createdAt))
      .all();
  }
  getProjectTemplate(id: number): ProjectTemplate | undefined {
    return db.select().from(schema.projectTemplates)
      .where(eq(schema.projectTemplates.id, id))
      .get();
  }
  createProjectTemplate(data: InsertProjectTemplate): ProjectTemplate {
    const now = Date.now();
    return db.insert(schema.projectTemplates)
      .values({ ...data, createdAt: now, updatedAt: now })
      .returning().get()!;
  }
  updateProjectTemplate(id: number, data: Partial<ProjectTemplate>): ProjectTemplate | undefined {
    return db.update(schema.projectTemplates)
      .set({ ...data, updatedAt: Date.now() })
      .where(eq(schema.projectTemplates.id, id))
      .returning().get();
  }
  deleteProjectTemplate(id: number): void {
    db.delete(schema.projectTemplates)
      .where(eq(schema.projectTemplates.id, id))
      .run();
  }
  getDueProjectTemplates(now: number): ProjectTemplate[] {
    // Drizzle's lt/and combo would work here, but a hand-written prepared
    // query is faster for a hot path that runs every minute. We keep the
    // result set small by indexing logically on (enabled, next_run_at) —
    // SQLite is happy without an explicit index at our scale (<100 rows).
    return db.select().from(schema.projectTemplates).all().filter((t) =>
      t.enabled === 1
      && t.nextRunAt != null
      && t.nextRunAt <= now,
    );
  }
}

export const storage = new SQLiteStorage();

// Seed default agents on boot
storage.initDefaultAgents();

// Stage 5.1: seed the heartbeat smoke-test template on first boot only. We
// gate on "zero templates exist" rather than a STAGE_510 marker so the user
// can DELETE the seed and never see it again — the alternative would be the
// scheduler re-seeding it on every restart, which is a bad UX. Disabled by
// default so a fresh deploy doesn't burn API credits every 5 minutes; the
// user flips `enabled` in the UI when they want to test the loop.
if (storage.getProjectTemplates().length === 0) {
  storage.createProjectTemplate({
    name: "Scheduler heartbeat (smoke test)",
    description:
      "5.1 smoke test — fires every 5 minutes when enabled. Spawns a tiny project " +
      "that proves the cron loop is alive end-to-end. Safe to delete after first run.",
    kind: "weekly",
    prompt:
      "Heartbeat ping. Write a single sentence that says 'Scheduler alive at {{now}}'. " +
      "Save the sentence as a markdown file. Do not invoke any tools. Do not search the web.",
    scheduleCron: "*/5 * * * *",
    enabled: 0,
    outputDir: "output/heartbeat",
    metadata: "{}",
    lastRunAt: null,
    nextRunAt: null,
    lastProjectId: null,
  });
}
