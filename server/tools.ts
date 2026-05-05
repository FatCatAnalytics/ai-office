// ─── Agent tools — Stage 4.13 ────────────────────────────────────────────────
// Web research tools backed by the Tavily API. Tavily is purpose-built for
// LLM agents: it returns cleaned, ready-to-reason content per result so agents
// don't have to chain search → fetch → extract → readability themselves.
//
// Two tools are exposed:
//   • tavily_search(query, max_results=5, search_depth="advanced") — agent
//     search; returns title, URL, and cleaned content snippets per hit, plus
//     an optional synthesised answer.
//   • tavily_extract(url) — readability-style extraction of a specific URL,
//     for when the agent already has a target (e.g. a "Portfolio" page).
//
// The schemas below are emitted in the OpenAI function-calling format. The
// llm.ts adapter translates them per-provider (Anthropic uses a slightly
// different `tools` shape, Gemini uses `functionDeclarations`, Kimi accepts
// the OpenAI shape verbatim).
// ─────────────────────────────────────────────────────────────────────────────

import { storage } from "./storage";

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema for the function arguments
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TAVILY_SEARCH_TOOL: ToolDefinition = {
  name: "tavily_search",
  description:
    "Search the open web via Tavily and return ranked results with cleaned content. Use this BEFORE answering any factual question that depends on data outside your training cut-off, or when the user asks about specific companies, people, products, dates, prices, or recent events. Each result includes a URL, title, and an extracted content snippet you can quote directly. Prefer this over guessing from memory.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query, e.g. 'CVC Capital Partners portfolio companies 2025' or 'BlackRock 2024 annual report PDF'. Keep it under 400 characters.",
      },
      max_results: {
        type: "integer",
        description:
          "How many results to return (1-10, default 5). Use 8-10 for broad discovery, 3-5 for targeted lookups.",
        minimum: 1,
        maximum: 10,
      },
      search_depth: {
        type: "string",
        description:
          "'basic' is fast and shallow; 'advanced' invests more crawl + extraction effort and is the default for research tasks.",
        enum: ["basic", "advanced"],
      },
      include_domains: {
        type: "array",
        description:
          "Optional whitelist of domains to restrict the search to, e.g. ['sec.gov', 'companieshouse.gov.uk'].",
        items: { type: "string" },
      },
      exclude_domains: {
        type: "array",
        description: "Optional list of domains to exclude (low-quality aggregators, paywalls).",
        items: { type: "string" },
      },
    },
    required: ["query"],
  },
};

export const TAVILY_EXTRACT_TOOL: ToolDefinition = {
  name: "tavily_extract",
  description:
    "Fetch and extract the readable main content of a specific URL via Tavily. Use this when you already have a target URL (e.g. a company's 'Portfolio' page, an annual-report PDF, a regulator filing) and need its full content. Returns cleaned text suitable for direct quotation.",
  parameters: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        description:
          "1-5 URLs to extract. Pass each URL as a fully-qualified https:// link.",
        items: { type: "string" },
        minItems: 1,
        maxItems: 5,
      },
    },
    required: ["urls"],
  },
};

export const ALL_TOOLS: Record<string, ToolDefinition> = {
  tavily_search: TAVILY_SEARCH_TOOL,
  tavily_extract: TAVILY_EXTRACT_TOOL,
};

// Resolve the Tavily key — try the storage setting first (Office Floor → Settings),
// then the process env so VPS-level config still works.
function resolveTavilyKey(): string | undefined {
  const fromSettings = storage.getSetting("tavily_api_key");
  if (fromSettings && fromSettings.length > 5) return fromSettings;
  const fromEnv = process.env.TAVILY_API_KEY;
  if (fromEnv && fromEnv.length > 5) return fromEnv;
  return undefined;
}

export function tavilyConfigured(): boolean {
  return !!resolveTavilyKey();
}

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  response_time?: number;
}

interface TavilyExtractItem {
  url: string;
  raw_content?: string;
  content?: string;
}

interface TavilyExtractResponse {
  results: TavilyExtractItem[];
  failed_results?: Array<{ url: string; error: string }>;
}

// Trim per-result content so a single tool response doesn't blow the context
// budget. ~4 chars/token, so 4k chars per hit ≈ 1k tokens.
const PER_RESULT_CHAR_CAP = 4000;
const MAX_TOTAL_CHARS = 28_000;

function clipContent(text: string, cap = PER_RESULT_CHAR_CAP): string {
  if (!text) return "";
  if (text.length <= cap) return text;
  return text.slice(0, cap) + "\n[...truncated]";
}

// Cap the whole tool-response payload too. We trim from the bottom (lowest-
// ranked / last-extracted) so the most relevant content survives.
function clipPayload(text: string): string {
  if (text.length <= MAX_TOTAL_CHARS) return text;
  return text.slice(0, MAX_TOTAL_CHARS) + "\n\n[...response truncated to fit context]";
}

// Stage 5.x.14: retry policy for Tavily.
//
// Before this stage, callTavily was a single fetch() with no timeout and no
// retries. A transient network blip during wave-1 of a research project
// (cold TLS, DNS warm-up, Cloudflare in-between bouncing a connection)
// would surface as a literal Node.js "fetch failed" error, which the
// orchestrator caught and used to mark the task blocked. The manager's
// replanner then routed around the failure on the next try — but the dead
// card stayed visible on the kanban, scaring operators into thinking the
// run was broken when it had actually self-healed.
//
// New behaviour: every Tavily call gets up to TAVILY_MAX_ATTEMPTS attempts
// with exponential backoff (300ms → 900ms → 2.7s) plus jitter, and a
// 30-second per-attempt timeout via AbortController. We retry only on
// transient classes (network errors, 408/425/429/5xx). Permanent errors
// (400/401/403/404) bail out immediately so we don't burn budget retrying
// a bad request.
const TAVILY_MAX_ATTEMPTS = 3;
const TAVILY_TIMEOUT_MS = 30_000;
const TAVILY_BACKOFF_MS = [300, 900, 2700];

function isTransientStatus(status: number): boolean {
  // 408 Request Timeout, 425 Too Early, 429 Too Many Requests, any 5xx.
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function isTransientNetworkError(err: unknown): boolean {
  // Node's undici surfaces network/DNS/TLS issues as a TypeError with the
  // message "fetch failed" and (often) a `cause` chain. Treat anything that
  // smells like a network error as retryable; an AbortError due to our own
  // timeout signal is also retryable.
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name ?? "";
  const msg  = (err as { message?: string }).message ?? "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|UND_ERR/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callTavily<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const apiKey = resolveTavilyKey();
  if (!apiKey) {
    throw new Error(
      "Tavily API key not configured. Set TAVILY_API_KEY in the VPS env or paste it into Office Floor → Settings → Web Search Tools.",
    );
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < TAVILY_MAX_ATTEMPTS; attempt++) {
    // Per-attempt timeout. We compose with the caller's signal so a worker
    // cancellation still aborts mid-flight without waiting for the timeout.
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(), TAVILY_TIMEOUT_MS);
    const onCallerAbort = () => timeoutCtl.abort();
    if (signal) {
      if (signal.aborted) timeoutCtl.abort();
      else signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    try {
      const res = await fetch(`https://api.tavily.com${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, api_key: apiKey }),
        signal: timeoutCtl.signal,
      });

      if (res.ok) {
        return (await res.json()) as T;
      }

      const detail = await res.text().catch(() => "");
      const errMsg = `Tavily ${path} ${res.status}: ${detail.slice(0, 200)}`;

      // Permanent failure — don't retry.
      if (!isTransientStatus(res.status)) {
        throw new Error(errMsg);
      }
      // Transient HTTP failure — record + fall through to retry.
      lastErr = new Error(errMsg);
    } catch (err) {
      // If the caller's signal aborted (worker cancellation), don't retry.
      if (signal?.aborted) throw err;
      // Treat our own timeout as a transient error worth retrying.
      if (!isTransientNetworkError(err)) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onCallerAbort);
    }

    // Sleep with a small jitter (±25%) before the next attempt, unless this
    // was the last attempt.
    if (attempt < TAVILY_MAX_ATTEMPTS - 1) {
      const base = TAVILY_BACKOFF_MS[attempt] ?? 1000;
      const jitter = Math.floor(base * 0.25 * (Math.random() * 2 - 1));
      await sleep(base + jitter);
    }
  }

  // Exhausted retries — surface the last error with attempt context so the
  // operator-facing event log makes the failure mode legible.
  const lastMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Tavily ${path} failed after ${TAVILY_MAX_ATTEMPTS} attempts: ${lastMsg}`);
}

// ─── tool: tavily_search ────────────────────────────────────────────────────
export async function execTavilySearch(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const query = String(args.query ?? "").slice(0, 400);
  if (!query) return "Error: tavily_search requires a non-empty 'query' argument.";

  const max_results = Math.min(10, Math.max(1, Number(args.max_results ?? 5)));
  const search_depth = (args.search_depth === "basic" ? "basic" : "advanced") as "basic" | "advanced";

  const body: Record<string, unknown> = {
    query,
    max_results,
    search_depth,
    include_answer: true,
    include_raw_content: false,
  };
  if (Array.isArray(args.include_domains) && args.include_domains.length > 0) {
    body.include_domains = (args.include_domains as unknown[]).map(String).slice(0, 20);
  }
  if (Array.isArray(args.exclude_domains) && args.exclude_domains.length > 0) {
    body.exclude_domains = (args.exclude_domains as unknown[]).map(String).slice(0, 20);
  }

  let resp: TavilySearchResponse;
  try {
    resp = await callTavily<TavilySearchResponse>("/search", body, signal);
  } catch (e) {
    return `Error: ${(e as Error).message ?? e}`;
  }

  const lines: string[] = [];
  lines.push(`Query: ${query}`);
  if (resp.answer) lines.push(`\nTavily synthesised answer:\n${clipContent(resp.answer, 1500)}`);
  lines.push(`\nResults (${resp.results.length}):`);
  resp.results.forEach((r, i) => {
    lines.push(
      `\n[${i + 1}] ${r.title || "(no title)"}\nURL: ${r.url}${
        r.published_date ? `\nPublished: ${r.published_date}` : ""
      }\nContent:\n${clipContent(r.content || "")}`,
    );
  });
  return clipPayload(lines.join("\n"));
}

// ─── tool: tavily_extract ───────────────────────────────────────────────────
export async function execTavilyExtract(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const rawUrls = Array.isArray(args.urls) ? args.urls : args.url ? [args.url] : [];
  const urls = rawUrls.map(u => String(u).trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 5);
  if (urls.length === 0) return "Error: tavily_extract requires a 'urls' array of http(s) URLs.";

  let resp: TavilyExtractResponse;
  try {
    resp = await callTavily<TavilyExtractResponse>("/extract", { urls }, signal);
  } catch (e) {
    return `Error: ${(e as Error).message ?? e}`;
  }

  const lines: string[] = [];
  resp.results.forEach((r, i) => {
    const content = r.raw_content || r.content || "";
    lines.push(`\n[${i + 1}] ${r.url}\n${clipContent(content)}`);
  });
  if (resp.failed_results && resp.failed_results.length > 0) {
    lines.push("\nFailed:");
    resp.failed_results.forEach(f => lines.push(`- ${f.url}: ${f.error}`));
  }
  if (lines.length === 0) return "No content extracted.";
  return clipPayload(lines.join("\n"));
}

// ─── Dispatch ──────────────────────────────────────────────────────────────
// Look up the tool implementation by name and invoke it. Always returns a
// string (errors are stringified) — the LLM tool-call loop expects a single
// text response per tool call.
export async function executeTool(
  name: string,
  rawArgs: string | Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  let args: Record<string, unknown>;
  if (typeof rawArgs === "string") {
    try { args = JSON.parse(rawArgs || "{}"); } catch { args = {}; }
  } else {
    args = rawArgs ?? {};
  }
  switch (name) {
    case "tavily_search":  return execTavilySearch(args, signal);
    case "tavily_extract": return execTavilyExtract(args, signal);
    default:               return `Error: unknown tool "${name}"`;
  }
}

// Resolve a list of tool names to their definitions. Unknown names are
// silently dropped so a typo in storage.ts doesn't crash a run.
export function resolveTools(names: string[] | undefined): ToolDefinition[] {
  if (!names || names.length === 0) return [];
  return names.map(n => ALL_TOOLS[n]).filter((t): t is ToolDefinition => !!t);
}
