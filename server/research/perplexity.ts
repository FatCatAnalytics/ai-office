// Stage 6.8: Perplexity API client.
//
// Centralises every call to Perplexity's chat-completions endpoint so the
// agent tool layer (server/tools.ts) and the public-evidence connector
// (server/connectors/perplexity.ts) share one transport, one set of
// safeguards, and one source of truth for env-driven configuration.
//
// Design rules:
//   • API key is read from process.env (PERPLEXITY_API_KEY) or, optionally,
//     the storage settings table — never a request header, never logged, and
//     never returned to a client.
//   • If the key is missing the module exposes `isConfigured() === false`
//     and `runResearch()` resolves to a structured "not configured" outcome
//     instead of throwing. Callers branch on that so agents/workflows
//     degrade gracefully rather than crashing.
//   • Errors raised internally are sanitised before they leave the module:
//     the key is stripped from any message we surface.
//   • Citations are normalised across the two formats Perplexity has shipped
//     (a flat `citations: string[]` and the newer `search_results` array).

import { storage } from "../storage";

/** Default model — Perplexity's Sonar tier is purpose-built for research / web search. */
const DEFAULT_MODEL = "sonar";
const DEFAULT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_TIMEOUT_MS = 25_000;

/** Hard upper bound on returned content. Tool callers will further clip. */
const MAX_CONTENT_CHARS = 16_000;
const MAX_CITATIONS = 25;

export interface PerplexityCitation {
  url: string;
  title?: string;
  publishedDate?: string;       // ISO 8601 when provided
  snippet?: string;
}

export interface PerplexityResearchInput {
  query: string;
  /** Optional system prompt override. Defaults to a research-focused instruction. */
  system?: string;
  /** Override the configured model for this call. */
  model?: string;
  /** Override the per-call wall-clock timeout. */
  timeoutMs?: number;
  /** Restrict / amplify domains the search should consider, when supported by the model. */
  searchDomainFilter?: string[];
  /** "month" | "week" | "day" | "hour" — recency window when supported. */
  searchRecencyFilter?: string;
  /** Optional abort signal from the caller (used by tool execution). */
  signal?: AbortSignal;
  /** Maximum tokens for the model's answer. */
  maxTokens?: number;
}

export interface PerplexityResearchOk {
  ok: true;
  content: string;
  citations: PerplexityCitation[];
  model: string;
  /** When the response carried `usage` we forward it for budgeting. */
  usage?: { tokensIn: number; tokensOut: number };
}

export interface PerplexityResearchFail {
  ok: false;
  /** Stable machine-readable code. UI / agents key off this. */
  reason: "not_configured" | "timeout" | "http_error" | "invalid_response" | "aborted";
  message: string;
}

export type PerplexityResearchOutcome = PerplexityResearchOk | PerplexityResearchFail;

/** Try storage first (so the existing Office Floor → Settings flow still works), env second. */
function resolveApiKey(): string | undefined {
  try {
    const fromSettings = storage.getSetting("perplexity_api_key");
    if (fromSettings && fromSettings.length > 8) return fromSettings;
  } catch {
    /* storage not initialised in some test paths — fall through to env. */
  }
  const fromEnv = process.env.PERPLEXITY_API_KEY;
  if (fromEnv && fromEnv.length > 8) return fromEnv;
  return undefined;
}

function resolveModel(): string {
  const m = process.env.PERPLEXITY_MODEL;
  if (m && m.trim().length > 0) return m.trim();
  return DEFAULT_MODEL;
}

function resolveBaseUrl(): string {
  const u = process.env.PERPLEXITY_BASE_URL;
  if (u && /^https?:\/\//i.test(u)) return u.replace(/\/+$/, "");
  return DEFAULT_BASE_URL;
}

function resolveTimeoutMs(): number {
  const raw = process.env.PERPLEXITY_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1_000 || n > 120_000) return DEFAULT_TIMEOUT_MS;
  return n;
}

/** Public: integration status. Safe for /api/integrations/perplexity. */
export interface PerplexityStatus {
  configured: boolean;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

export function getPerplexityStatus(): PerplexityStatus {
  return {
    configured: !!resolveApiKey(),
    model: resolveModel(),
    baseUrl: resolveBaseUrl(),
    timeoutMs: resolveTimeoutMs(),
  };
}

export function isConfigured(): boolean {
  return !!resolveApiKey();
}

/** Belt-and-braces: strip the key out of any string before we log or surface it. */
function redact(s: string): string {
  const key = resolveApiKey();
  if (!key) return s;
  return s.split(key).join("[REDACTED]");
}

interface PerplexityChatChoiceMessage {
  role?: string;
  content?: string;
}

interface PerplexityChatChoice {
  message?: PerplexityChatChoiceMessage;
}

interface PerplexitySearchResult {
  url?: string;
  title?: string;
  date?: string;
  snippet?: string;
}

interface PerplexityChatResponse {
  choices?: PerplexityChatChoice[];
  citations?: string[];
  search_results?: PerplexitySearchResult[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function normaliseCitations(raw: PerplexityChatResponse): PerplexityCitation[] {
  const out: PerplexityCitation[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw.search_results)) {
    for (const r of raw.search_results) {
      if (!r || typeof r.url !== "string") continue;
      const url = r.url.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({
        url,
        title: typeof r.title === "string" ? r.title : undefined,
        publishedDate: typeof r.date === "string" ? r.date : undefined,
        snippet: typeof r.snippet === "string" ? r.snippet : undefined,
      });
      if (out.length >= MAX_CITATIONS) return out;
    }
  }

  if (Array.isArray(raw.citations)) {
    for (const u of raw.citations) {
      if (typeof u !== "string") continue;
      const url = u.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url });
      if (out.length >= MAX_CITATIONS) return out;
    }
  }

  return out;
}

/**
 * Main entry point. Resolves to a structured outcome; never throws.
 * Callers MUST check `outcome.ok` before reading content / citations.
 */
export async function runResearch(
  input: PerplexityResearchInput,
): Promise<PerplexityResearchOutcome> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      ok: false,
      reason: "not_configured",
      message:
        "Perplexity API key not configured. Set PERPLEXITY_API_KEY in the environment to enable Perplexity research.",
    };
  }

  const query = (input.query ?? "").trim();
  if (!query) {
    return { ok: false, reason: "invalid_response", message: "Perplexity research requires a non-empty query." };
  }

  const model = (input.model ?? "").trim() || resolveModel();
  const baseUrl = resolveBaseUrl();
  const timeoutMs = input.timeoutMs ?? resolveTimeoutMs();

  const systemPrompt =
    input.system?.trim() ||
    "You are a meticulous research assistant. Answer the user's question using up-to-date public web sources. " +
      "Return concise, factual prose. Cite every concrete claim using the inline source numbering Perplexity provides. " +
      "If you are unsure or sources disagree, say so explicitly rather than guessing.";

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
    max_tokens: typeof input.maxTokens === "number" && input.maxTokens > 0 ? input.maxTokens : 1_024,
    temperature: 0.2,
    return_citations: true,
  };
  if (Array.isArray(input.searchDomainFilter) && input.searchDomainFilter.length > 0) {
    body.search_domain_filter = input.searchDomainFilter.slice(0, 8);
  }
  if (input.searchRecencyFilter) {
    body.search_recency_filter = input.searchRecencyFilter;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("perplexity-timeout"), timeoutMs);
  const onCallerAbort = () => ctrl.abort("perplexity-aborted");
  if (input.signal) {
    if (input.signal.aborted) {
      clearTimeout(timer);
      return { ok: false, reason: "aborted", message: "Perplexity call aborted before send." };
    }
    input.signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Authorization header is the ONLY place the key appears. We never log
        // request headers anywhere, and we never echo this object back out.
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onCallerAbort);
    const aborted = (e as { name?: string })?.name === "AbortError" || ctrl.signal.aborted;
    if (aborted) {
      const reason = (ctrl.signal.reason ?? "") === "perplexity-aborted" ? "aborted" : "timeout";
      return {
        ok: false,
        reason,
        message: reason === "timeout"
          ? `Perplexity request exceeded ${timeoutMs}ms wall-clock.`
          : "Perplexity request aborted by caller.",
      };
    }
    return { ok: false, reason: "http_error", message: redact(`Perplexity network error: ${(e as Error)?.message ?? e}`) };
  }
  clearTimeout(timer);
  input.signal?.removeEventListener("abort", onCallerAbort);

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 400); } catch { /* ignore */ }
    return {
      ok: false,
      reason: "http_error",
      message: redact(`Perplexity HTTP ${res.status}${detail ? `: ${detail}` : ""}`),
    };
  }

  let parsed: PerplexityChatResponse;
  try {
    parsed = (await res.json()) as PerplexityChatResponse;
  } catch (e) {
    return { ok: false, reason: "invalid_response", message: redact(`Perplexity JSON parse error: ${(e as Error)?.message ?? e}`) };
  }

  const rawContent = parsed.choices?.[0]?.message?.content ?? "";
  const content = typeof rawContent === "string" ? rawContent.slice(0, MAX_CONTENT_CHARS) : "";
  if (!content) {
    return { ok: false, reason: "invalid_response", message: "Perplexity returned no content." };
  }

  const usage = parsed.usage
    ? {
        tokensIn: parsed.usage.prompt_tokens ?? 0,
        tokensOut: parsed.usage.completion_tokens ?? 0,
      }
    : undefined;

  return {
    ok: true,
    content,
    citations: normaliseCitations(parsed),
    model: parsed.model ?? model,
    usage,
  };
}
