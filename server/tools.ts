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
import {
  runResearch as runPerplexityResearch,
  isConfigured as perplexityConfigured,
} from "./research/perplexity";

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

// Stage 6.10: Perplexity research tool. Web search + LLM synthesis in a
// single call with inline citations. Available to research agents alongside
// Tavily; also acts as the automatic fallback when Tavily hits a quota/rate
// limit (see execTavilySearch). When PERPLEXITY_API_KEY is unset the tool
// short-circuits to a structured "not configured" error string so the agent
// can degrade gracefully.
export const PERPLEXITY_RESEARCH_TOOL: ToolDefinition = {
  name: "perplexity_research",
  description:
    "Ask Perplexity a focused research question. Returns a concise synthesised answer plus a numbered list of source URLs (citations). Use this for: (a) up-to-date public-web facts about companies/people/products, (b) discovering authoritative sources for a topic, (c) cross-checking a claim against multiple independent outlets, (d) when Tavily has hit its quota. Prefer concrete, one-sentence questions over broad keywords. Always quote the returned URLs directly when you reuse a fact — do not invent sources.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Research question in natural language. Keep it under 500 characters.",
      },
      search_domain_filter: {
        type: "array",
        description: "Optional list of up to 8 domains to restrict the search to (e.g. ['sec.gov','companieshouse.gov.uk']). Use sparingly — overconstraining yields empty results.",
        items: { type: "string" },
      },
      search_recency_filter: {
        type: "string",
        description: "Optional recency window for the search. Use only when the question is time-sensitive.",
        enum: ["hour", "day", "week", "month"],
      },
      max_tokens: {
        type: "integer",
        description: "Maximum length of Perplexity's answer in tokens (default 1024).",
        minimum: 128,
        maximum: 4096,
      },
    },
    required: ["query"],
  },
};

export const ALL_TOOLS: Record<string, ToolDefinition> = {
  tavily_search: TAVILY_SEARCH_TOOL,
  tavily_extract: TAVILY_EXTRACT_TOOL,
  perplexity_research: PERPLEXITY_RESEARCH_TOOL,
};

export { perplexityConfigured };

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

// Stage 6.10: Tavily transport errors carry a stable shape so callers can
// detect quota/rate-limit failures and fall back to Perplexity. The
// observed quota / "all calls failed" failure mode on this VPS is an HTTP
// 433, so we treat any 4xx as a "provider-unavailable" signal; 5xx is
// transient and surfaces unchanged.
export class TavilyQuotaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TavilyQuotaError";
    this.status = status;
  }
}

async function callTavily<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const apiKey = resolveTavilyKey();
  if (!apiKey) {
    throw new Error(
      "Tavily API key not configured. Set TAVILY_API_KEY in the VPS env or paste it into Office Floor → Settings → Web Search Tools.",
    );
  }
  const res = await fetch(`https://api.tavily.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, api_key: apiKey }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 4xx (quota / rate limit / auth / all-calls-failed) — make this
    // detectable by the fallback wrapper without a fragile string match.
    if (res.status >= 400 && res.status < 500) {
      throw new TavilyQuotaError(res.status, `Tavily ${path} ${res.status}: ${detail.slice(0, 200)}`);
    }
    throw new Error(`Tavily ${path} ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// Stage 6.10: classify a thrown error from Tavily as "should we fall back?"
// We fall back on HTTP 4xx (quota/rate limit/auth) and on AbortError-aren't-
// caller-aborted (timeouts). Plain network errors also fall back — better to
// surface Perplexity sources than to give the agent an empty turn.
export function isTavilyFallbackError(e: unknown, callerAborted: boolean): boolean {
  if (callerAborted) return false;
  if (e instanceof TavilyQuotaError) return true;
  const msg = (e as Error)?.message ?? "";
  if (/^Tavily .*4\d\d:/i.test(msg)) return true;
  if (/quota|rate.?limit|429|433/i.test(msg)) return true;
  if (/AbortError|timeout|fetch failed|ENETUNREACH|ECONNRESET/i.test(msg)) return true;
  return false;
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
  const includeDomains = Array.isArray(args.include_domains) && args.include_domains.length > 0
    ? (args.include_domains as unknown[]).map(String).slice(0, 20)
    : undefined;
  if (includeDomains) body.include_domains = includeDomains;
  if (Array.isArray(args.exclude_domains) && args.exclude_domains.length > 0) {
    body.exclude_domains = (args.exclude_domains as unknown[]).map(String).slice(0, 20);
  }

  let resp: TavilySearchResponse;
  try {
    resp = await callTavily<TavilySearchResponse>("/search", body, signal);
  } catch (e) {
    // Stage 6.10: on quota / rate-limit / transient failure, fall back to
    // Perplexity automatically (if configured). This keeps the agent's tool
    // turn productive — the alternative is an empty turn that propagates to
    // the Stage 6.9 fail-closed gate and blocks the whole project.
    const aborted = !!signal?.aborted;
    if (!aborted && perplexityConfigured() && isTavilyFallbackError(e, aborted)) {
      const fallback = await fallbackThroughPerplexity({
        query,
        searchDomainFilter: includeDomains,
        signal,
        reason: (e as Error)?.message ?? String(e),
        toolName: "tavily_search",
      });
      if (fallback) return fallback;
    }
    return `Error: ${(e as Error).message ?? e}`;
  }

  // Stage 6.10: also fall back if Tavily returned 200 but no usable results.
  // This is the "zero usable sourced results" branch from the spec — the
  // research wave is otherwise about to emit an unsourced output that the
  // Stage 6.9 gate will block.
  if ((resp.results?.length ?? 0) === 0 && perplexityConfigured() && !signal?.aborted) {
    const fallback = await fallbackThroughPerplexity({
      query,
      searchDomainFilter: includeDomains,
      signal,
      reason: "Tavily returned zero results",
      toolName: "tavily_search",
    });
    if (fallback) return fallback;
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
    // Stage 6.10: extract has no natural fallback (Perplexity can't fetch a
    // specific URL on demand) but we can still ask Perplexity to research the
    // URLs as a topic so the agent gets *some* sourced material instead of
    // an empty turn that will trip the fail-closed gate.
    const aborted = !!signal?.aborted;
    if (!aborted && perplexityConfigured() && isTavilyFallbackError(e, aborted)) {
      const q = `Summarise the most important factual content available at these URLs: ${urls.join(", ")}. Cite each source.`;
      const fallback = await fallbackThroughPerplexity({
        query: q,
        signal,
        reason: (e as Error)?.message ?? String(e),
        toolName: "tavily_extract",
      });
      if (fallback) return fallback;
    }
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

// ─── tool: perplexity_research ──────────────────────────────────────────────
// Stage 6.10: agent-facing entry point for the shared Perplexity client.
// Output is shaped for an LLM consumer: synthesised answer first, then a
// numbered citation list (the format the Stage 6.9 sufficiency gate already
// understands as sourced output). Errors come back as `Error: …` strings
// rather than thrown exceptions so the tool-loop in llm.ts can feed them
// back to the model unchanged. When the key is unset the tool emits a
// clear "not configured" error string — the agent prompt instructs it to
// degrade gracefully without flagging this as a hard failure.
export async function execPerplexityResearch(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return "Error: perplexity_research requires a non-empty 'query' argument.";

  const searchDomainFilter = Array.isArray(args.search_domain_filter)
    ? (args.search_domain_filter as unknown[])
        .filter((d): d is string => typeof d === "string" && d.length > 0)
    : undefined;
  const searchRecencyFilter = typeof args.search_recency_filter === "string"
    ? args.search_recency_filter
    : undefined;
  const maxTokens = typeof args.max_tokens === "number"
    ? Math.min(4096, Math.max(128, args.max_tokens))
    : undefined;

  const outcome = await runPerplexityResearch({
    query,
    searchDomainFilter,
    searchRecencyFilter,
    maxTokens,
    signal,
  });

  if (!outcome.ok) {
    return `Error: ${outcome.message}`;
  }

  return formatPerplexityForTool(query, outcome, "perplexity_research");
}

// Stage 6.10: shared formatter. Used directly by execPerplexityResearch and
// indirectly by the Tavily fallback path so the LLM sees the same shape no
// matter which provider produced the sources.
function formatPerplexityForTool(
  query: string,
  outcome: Awaited<ReturnType<typeof runPerplexityResearch>> & { ok: true },
  toolName: string,
): string {
  const lines: string[] = [];
  lines.push(`Query: ${query}`);
  lines.push(`Provider: ${toolName === "perplexity_research" ? "perplexity" : `perplexity (fallback for ${toolName})`}`);
  lines.push(`Answer (model: ${outcome.model}):`);
  lines.push(clipContent(outcome.content, PER_RESULT_CHAR_CAP * 2));
  if (outcome.citations.length > 0) {
    lines.push("\nResults (citations):");
    outcome.citations.forEach((c, i) => {
      const title = c.title ?? "(no title)";
      const published = c.publishedDate ? `\nPublished: ${c.publishedDate}` : "";
      const snippet = c.snippet ? `\nContent:\n${clipContent(c.snippet)}` : "";
      lines.push(`\n[${i + 1}] ${title}\nURL: ${c.url}${published}${snippet}`);
    });
  } else {
    lines.push("\nNo citations were returned for this query.");
  }
  return clipPayload(lines.join("\n"));
}

// Stage 6.10: shared fallback path. Returns null when fallback also failed
// or returned zero URLs — the caller then surfaces the original Tavily error
// so the Stage 6.9 fail-closed gate still triggers (we never invent sources).
interface FallbackInput {
  query: string;
  searchDomainFilter?: string[];
  signal?: AbortSignal;
  reason: string;
  toolName: string;
}

async function fallbackThroughPerplexity(input: FallbackInput): Promise<string | null> {
  const outcome = await runPerplexityResearch({
    query: input.query,
    searchDomainFilter: input.searchDomainFilter,
    signal: input.signal,
    system:
      "You are a research assistant filling in for a web-search tool that just failed. " +
      "Answer the user's query concisely and CITE every concrete claim. Prefer primary sources. " +
      "Do not invent sources — if you cannot find a reliable source, say so.",
  });
  if (!outcome.ok) return null;
  // Stage 6.9 gate requires real URLs. If Perplexity also returned zero,
  // surface the original Tavily error instead of pretending we succeeded.
  if (outcome.citations.length === 0) return null;
  return formatPerplexityForTool(input.query, outcome, input.toolName);
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
    case "tavily_search":        return execTavilySearch(args, signal);
    case "tavily_extract":       return execTavilyExtract(args, signal);
    case "perplexity_research":  return execPerplexityResearch(args, signal);
    default:                     return `Error: unknown tool "${name}"`;
  }
}

// Resolve a list of tool names to their definitions. Unknown names are
// silently dropped so a typo in storage.ts doesn't crash a run.
export function resolveTools(names: string[] | undefined): ToolDefinition[] {
  if (!names || names.length === 0) return [];
  return names.map(n => ALL_TOOLS[n]).filter((t): t is ToolDefinition => !!t);
}
