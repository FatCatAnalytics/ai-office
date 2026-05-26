// Stage 6.10 smoke test for the Perplexity research fallback.
//
// Run as `tsx script/test-perplexity-fallback.ts`. Exits non-zero on first
// failure. Deterministic — global fetch is stubbed; no real network is hit
// and no API keys are required.
//
// Regression baseline (matches the user's complaint that "Analytical Banker
// tasks are blocked because research outputs contain zero URLs due to HTTP
// 433 quota/rate limit"):
//
//   • Tavily HTTP 433 quota + Perplexity configured → execTavilySearch falls
//     back automatically and returns sourced citations the Stage 6.9
//     sufficiency gate will accept (real URLs, Provider: perplexity (fallback…)
//     label, Results section present).
//   • Tavily HTTP 433 quota + Perplexity unconfigured → execTavilySearch
//     surfaces the original `Error: Tavily …433…` string so the orchestrator
//     can fail closed with a clear diagnostic.
//   • Tavily 200 with zero results + Perplexity configured → fallback fires
//     anyway so the agent gets sourced material instead of an empty turn.
//   • Tavily 200 with zero results + Perplexity also returns zero citations
//     → fallback declines (returns null internally) and we surface the
//     Tavily empty-results response unchanged. We NEVER invent sources.
//   • execPerplexityResearch direct call returns formatted Answer +
//     Citations and preserves URL / title / snippet / publishedDate.
//   • isTavilyFallbackError correctly classifies 4xx / quota / rate-limit
//     strings as fall-back-worthy and caller-aborted as non-fallback.
//   • formatPerplexityForTool / Tavily-fallback responses include a
//     `Provider:` line so an operator inspecting the tool-call event feed
//     can tell which backend actually answered.

import process from "process";

// ──────────────────────────────────────────────────────────────────────────
// Test harness
// ──────────────────────────────────────────────────────────────────────────
interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function eq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }
function truthy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: true }); }
function falsy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: false }); }
function contains(name: string, hay: string, needle: string) {
  cases.push({ name, got: hay.includes(needle), want: true });
}
function notContains(name: string, hay: string, needle: string) {
  cases.push({ name, got: hay.includes(needle), want: false });
}

// ──────────────────────────────────────────────────────────────────────────
// Fetch stub. Each test installs the response (or sequence of responses)
// it needs. We resolve URL + body shape to decide which mock to serve.
// ──────────────────────────────────────────────────────────────────────────
type MockResponse = { status: number; body: unknown };
type RequestHandler = (url: string, body: unknown) => MockResponse | Promise<MockResponse>;

let handler: RequestHandler | null = null;
const calls: Array<{ url: string; body: unknown }> = [];

const realFetch = globalThis.fetch;
// @ts-expect-error — overriding fetch for the test
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : (input as URL).toString();
  let body: unknown = undefined;
  if (init?.body) {
    try { body = JSON.parse(String(init.body)); } catch { body = init.body; }
  }
  calls.push({ url, body });
  if (!handler) throw new Error(`Unexpected fetch in test: ${url}`);
  const resp = await handler(url, body);
  return new Response(JSON.stringify(resp.body), {
    status: resp.status,
    headers: { "content-type": "application/json" },
  });
};

function resetStub() { handler = null; calls.length = 0; }

// ──────────────────────────────────────────────────────────────────────────
// Wire keys via env (the module reads on call, not at import time, so we
// can flip them between tests).
// ──────────────────────────────────────────────────────────────────────────
process.env.TAVILY_API_KEY = "test_tavily_key_long_enough";
process.env.PERPLEXITY_API_KEY = "test_perplexity_key_long_enough";

// Modules under test — imported AFTER env is set and AFTER fetch is stubbed.
// storage.ts touches sqlite at import time; the in-memory DB is fine.
const tools = await import("../server/tools");
const perplexity = await import("../server/research/perplexity");

// ──────────────────────────────────────────────────────────────────────────
// Sanity: classifier
// ──────────────────────────────────────────────────────────────────────────
truthy("isTavilyFallbackError flags 433",       tools.isTavilyFallbackError(new Error("Tavily /search 433: quota exceeded"), false));
truthy("isTavilyFallbackError flags 429",       tools.isTavilyFallbackError(new Error("Tavily /search 429: rate limit"), false));
truthy("isTavilyFallbackError flags TavilyQuotaError class", tools.isTavilyFallbackError(new tools.TavilyQuotaError(433, "x"), false));
truthy("isTavilyFallbackError flags rate-limit",tools.isTavilyFallbackError(new Error("rate-limited again"), false));
truthy("isTavilyFallbackError flags AbortError noise", tools.isTavilyFallbackError(new Error("AbortError: timeout"), false));
falsy("isTavilyFallbackError does NOT fall back when caller aborted", tools.isTavilyFallbackError(new Error("AbortError"), true));
falsy("isTavilyFallbackError ignores 5xx",       tools.isTavilyFallbackError(new Error("Tavily /search 503: bad gateway"), false));

// ──────────────────────────────────────────────────────────────────────────
// Test 1: Tavily 433 quota + Perplexity OK → fallback returns sources.
// ──────────────────────────────────────────────────────────────────────────
{
  resetStub();
  handler = async (url) => {
    if (url.includes("api.tavily.com")) {
      return { status: 433, body: { error: "quota_exceeded" } };
    }
    if (url.includes("api.perplexity.ai")) {
      return {
        status: 200,
        body: {
          choices: [{ message: { content: "Aksel's company filed its 2024 annual report on 2025-03-15.\n\nKey takeaways: revenue grew 20%, costs flat." } }],
          search_results: [
            { url: "https://www.sec.gov/edgar/example/0001234567.htm", title: "10-K filing", date: "2025-03-15", snippet: "Annual report excerpt." },
            { url: "https://reuters.com/business/example-results-2025", title: "Reuters coverage", snippet: "Revenue up 20%." },
          ],
          model: "sonar",
          usage: { prompt_tokens: 12, completion_tokens: 64 },
        },
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const out = await tools.execTavilySearch({ query: "Example Corp 2024 annual report" });
  contains("[1] tavily 433 → fallback fires perplexity",        out, "Provider: perplexity (fallback for tavily_search)");
  contains("[1] fallback response preserves the query",          out, "Example Corp 2024 annual report");
  contains("[1] fallback includes SEC URL (real source)",        out, "https://www.sec.gov/edgar/example/0001234567.htm");
  contains("[1] fallback includes Reuters URL (real source)",    out, "https://reuters.com/business/example-results-2025");
  contains("[1] fallback preserves citation title",              out, "10-K filing");
  contains("[1] fallback preserves publication date",            out, "2025-03-15");
  notContains("[1] fallback does NOT leak api key",              out, "test_perplexity_key_long_enough");
  eq("[1] fetch hit both providers (tavily then perplexity)", calls.length, 2);
  truthy("[1] first call was tavily",      calls[0].url.includes("api.tavily.com"));
  truthy("[1] second call was perplexity", calls[1].url.includes("api.perplexity.ai"));
}

// ──────────────────────────────────────────────────────────────────────────
// Test 2: Tavily 433 + Perplexity unconfigured → surface original error.
// ──────────────────────────────────────────────────────────────────────────
{
  resetStub();
  const savedKey = process.env.PERPLEXITY_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  handler = async (url) => {
    if (url.includes("api.tavily.com")) return { status: 433, body: { error: "quota_exceeded" } };
    throw new Error(`unexpected url ${url}`);
  };
  const out = await tools.execTavilySearch({ query: "anything" });
  contains("[2] tavily 433 + no perplexity → returns Error string", out, "Error:");
  contains("[2] tavily 433 + no perplexity → mentions 433",         out, "433");
  notContains("[2] tavily 433 + no perplexity → does NOT pretend to have sources", out, "Provider: perplexity");
  eq("[2] fallback did not call perplexity", calls.filter(c => c.url.includes("perplexity")).length, 0);
  process.env.PERPLEXITY_API_KEY = savedKey;
}

// ──────────────────────────────────────────────────────────────────────────
// Test 3: Tavily 200 with zero results + Perplexity OK → fallback fires.
// ──────────────────────────────────────────────────────────────────────────
{
  resetStub();
  let perplexityCalled = false;
  handler = async (url) => {
    if (url.includes("api.tavily.com")) {
      return { status: 200, body: { query: "x", results: [], answer: "" } };
    }
    if (url.includes("api.perplexity.ai")) {
      perplexityCalled = true;
      return {
        status: 200,
        body: {
          choices: [{ message: { content: "Found two relevant sources." } }],
          search_results: [{ url: "https://example.com/a", title: "A" }],
          model: "sonar",
        },
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  const out = await tools.execTavilySearch({ query: "obscure thing 2099" });
  truthy("[3] tavily zero-results → perplexity called",   perplexityCalled);
  contains("[3] tavily zero-results → returns fallback",  out, "Provider: perplexity (fallback for tavily_search)");
  contains("[3] tavily zero-results → cites the URL",     out, "https://example.com/a");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 4: Tavily zero results AND Perplexity zero citations → fail closed.
// ──────────────────────────────────────────────────────────────────────────
{
  resetStub();
  handler = async (url) => {
    if (url.includes("api.tavily.com")) {
      return { status: 200, body: { query: "x", results: [], answer: "" } };
    }
    if (url.includes("api.perplexity.ai")) {
      return {
        status: 200,
        body: {
          choices: [{ message: { content: "Could not find sources." } }],
          search_results: [],
          model: "sonar",
        },
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  const out = await tools.execTavilySearch({ query: "even more obscure" });
  notContains("[4] both empty → no Provider: perplexity claim",     out, "Provider: perplexity (fallback");
  // The Tavily response itself is "Results (0):", which is what the agent
  // sees. The Stage 6.9 sufficiency gate will see zero URLs in the overall
  // research output and fail closed.
  contains("[4] both empty → surfaces tavily empty response",       out, "Results (0):");
  notContains("[4] both empty → does NOT invent example.com",       out, "example.com");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 5: execPerplexityResearch direct call preserves metadata.
// ──────────────────────────────────────────────────────────────────────────
{
  resetStub();
  handler = async (url, body) => {
    eq("[5] perplexity request uses chat/completions", url.includes("/chat/completions"), true);
    truthy("[5] perplexity body carries query as user message",
      Array.isArray((body as { messages?: Array<{ role: string; content: string }> }).messages) &&
      (body as { messages: Array<{ role: string; content: string }> }).messages.some(m => m.role === "user" && m.content.includes("Stripe payments")));
    return {
      status: 200,
      body: {
        choices: [{ message: { content: "Stripe processed $1T in payments in 2024." } }],
        search_results: [
          { url: "https://stripe.com/about", title: "About Stripe", date: "2024-12-01", snippet: "Total payment volume reached $1T." },
        ],
        citations: ["https://blog.stripe.com/recap-2024"],
        model: "sonar-pro",
        usage: { prompt_tokens: 5, completion_tokens: 23 },
      },
    };
  };
  const out = await tools.execPerplexityResearch({
    query: "What was Stripe payments TPV in 2024?",
    search_recency_filter: "month",
  });
  contains("[5] direct perplexity call returns Answer",       out, "Stripe processed $1T");
  contains("[5] direct call shows Provider: perplexity",      out, "Provider: perplexity");
  contains("[5] direct call lists primary citation",          out, "https://stripe.com/about");
  contains("[5] direct call lists snippet",                   out, "Total payment volume");
  contains("[5] direct call preserves date",                  out, "2024-12-01");
  contains("[5] direct call merges flat citations",           out, "https://blog.stripe.com/recap-2024");
  contains("[5] direct call shows model",                     out, "model: sonar-pro");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 6: perplexity_research not configured → graceful error string.
// ──────────────────────────────────────────────────────────────────────────
{
  resetStub();
  const saved = process.env.PERPLEXITY_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  const out = await tools.execPerplexityResearch({ query: "anything" });
  contains("[6] not configured → Error: not configured", out, "Error:");
  contains("[6] not configured → mentions PERPLEXITY_API_KEY", out, "PERPLEXITY_API_KEY");
  eq("[6] not configured → never hit network", calls.length, 0);
  process.env.PERPLEXITY_API_KEY = saved;
}

// ──────────────────────────────────────────────────────────────────────────
// Test 7: getPerplexityStatus never leaks the key.
// ──────────────────────────────────────────────────────────────────────────
{
  const status = perplexity.getPerplexityStatus();
  truthy("[7] status.configured is true when env is set",   status.configured);
  truthy("[7] status reports a model",                       typeof status.model === "string" && status.model.length > 0);
  truthy("[7] status reports a baseUrl",                     typeof status.baseUrl === "string" && status.baseUrl.startsWith("https://"));
  truthy("[7] status reports a timeoutMs",                   typeof status.timeoutMs === "number" && status.timeoutMs > 0);
  notContains("[7] status JSON does NOT leak the key",       JSON.stringify(status), "test_perplexity_key_long_enough");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 8: Perplexity HTTP error → structured failure, no thrown exception.
// ──────────────────────────────────────────────────────────────────────────
{
  resetStub();
  handler = async () => ({ status: 500, body: { error: "internal" } });
  const outcome = await perplexity.runResearch({ query: "ignored" });
  falsy("[8] perplexity 500 → outcome.ok false", outcome.ok);
  if (!outcome.ok) {
    eq("[8] perplexity 500 → reason http_error", outcome.reason, "http_error");
    contains("[8] perplexity 500 → message includes HTTP 500", outcome.message, "500");
    notContains("[8] perplexity 500 → message does NOT leak key", outcome.message, "test_perplexity_key_long_enough");
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Test 9: tavily_extract failure with perplexity ok → fallback summary.
// ──────────────────────────────────────────────────────────────────────────
{
  resetStub();
  handler = async (url) => {
    if (url.includes("api.tavily.com")) return { status: 433, body: { error: "quota_exceeded" } };
    if (url.includes("api.perplexity.ai")) {
      return {
        status: 200,
        body: {
          choices: [{ message: { content: "Summary of the requested URLs." } }],
          search_results: [{ url: "https://example.com/article", title: "Article" }],
          model: "sonar",
        },
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  const out = await tools.execTavilyExtract({ urls: ["https://example.com/article"] });
  contains("[9] extract 433 → perplexity fallback engaged",      out, "Provider: perplexity (fallback for tavily_extract)");
  contains("[9] extract 433 fallback → cites the requested URL", out, "https://example.com/article");
}

// ──────────────────────────────────────────────────────────────────────────
// Restore real fetch and print results.
// ──────────────────────────────────────────────────────────────────────────
// @ts-expect-error — restore
globalThis.fetch = realFetch;

let failed = 0;
for (const c of cases) {
  const ok = JSON.stringify(c.got) === JSON.stringify(c.want);
  if (!ok) {
    failed++;
    console.log(`✗ ${c.name}\n   got:  ${JSON.stringify(c.got)}\n   want: ${JSON.stringify(c.want)}`);
  } else {
    console.log(`✓ ${c.name}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
