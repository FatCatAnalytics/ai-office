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
import { runResearch as runPerplexityResearch, isConfigured as perplexityConfigured } from "./research/perplexity";

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

// Stage 6.8: Perplexity research tool. The Perplexity API combines web search
// + LLM synthesis in a single call and returns inline citations, which makes
// it well-suited for source-discovery and claim-verification turns. The tool
// is in addition to Tavily — agents pick whichever fits the sub-task (Tavily
// for breadth + per-URL extraction, Perplexity for synthesised answers with
// citations). When PERPLEXITY_API_KEY is unset the tool is omitted entirely
// from the agent's resolved tool set.
export const PERPLEXITY_RESEARCH_TOOL: ToolDefinition = {
  name: "perplexity_research",
  description:
    "Ask Perplexity a focused research question. Returns a concise synthesised answer with a numbered list of source URLs (citations). Use this for: (a) up-to-date public-web facts about companies/people/products, (b) discovering authoritative sources for a topic, (c) cross-checking a claim against multiple independent outlets. Prefer concrete, one-sentence questions over broad keywords. The answer comes back grounded in citations — quote the URLs directly when you reuse a fact.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The research question, in natural language. Keep it under 500 characters.",
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
    throw new Error(`Tavily ${path} ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
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

// ─── tool: perplexity_research ──────────────────────────────────────────────
// Stage 6.8: agent-facing entry point for the shared Perplexity client.
// Output is shaped for an LLM consumer: the synthesised answer first, then a
// numbered citation list. We clip the answer to PER_RESULT_CHAR_CAP × 2 so
// long syntheses don't blow the tool-response budget, and trim total citations
// to a sane upper bound. Errors come back as `Error: …` strings rather than
// thrown exceptions so the tool-loop in llm.ts can feed them back to the
// model unchanged.
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
  const maxTokens = typeof args.max_tokens === "number" ? Math.min(4096, Math.max(128, args.max_tokens)) : undefined;

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

  const lines: string[] = [];
  lines.push(`Answer (model: ${outcome.model}):`);
  lines.push(clipContent(outcome.content, PER_RESULT_CHAR_CAP * 2));
  if (outcome.citations.length > 0) {
    lines.push("\nCitations:");
    outcome.citations.forEach((c, i) => {
      const title = c.title ? ` ${c.title}` : "";
      lines.push(`[${i + 1}] ${c.url}${title}`);
    });
  } else {
    lines.push("\nNo citations were returned for this query.");
  }
  return clipPayload(lines.join("\n"));
}

// ─── Configuration helper ───────────────────────────────────────────────────
// Stage 6.8: same shape as tavilyConfigured() so the live orchestrator can
// emit a single warning event when the key is absent instead of hitting a 401
// per call.
export { perplexityConfigured };

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
