// Stage 6.8 smoke test for server/research/perplexity.ts +
// server/connectors/perplexity.ts + server/tools.ts perplexity_research.
//
// Runs as `tsx script/test-perplexity.ts`. Exits non-zero on first failure.
//
// We can't pull in a real test runner (none in package.json), so this script
// follows the same monkey-patch / expectEq pattern as the other
// script/test-*.ts files. The Perplexity client is exercised through a
// stubbed global fetch so no network access is required and no real API key
// is ever sent.

import {
  runResearch,
  isConfigured,
  getPerplexityStatus,
} from "../server/research/perplexity";
import { perplexityConnector } from "../server/connectors/perplexity";
import { executeTool } from "../server/tools";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function expectEq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }
function expectTrue(name: string, got: boolean) { expectEq(name, got, true); }

type FetchFn = typeof fetch;
const realFetch: FetchFn = globalThis.fetch.bind(globalThis);

interface FetchCall { url: string; init?: RequestInit; }
function installFetchStub(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const call: FetchCall = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { calls, restore: () => { (globalThis as { fetch: FetchFn }).fetch = realFetch; } };
}

function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

(async () => {
  const KEY = "pplx-test-XXXXXXXXXXXXXXXX";

  // ── 1. Missing key → not_configured, no network ─────────────────────────
  {
    delete process.env.PERPLEXITY_API_KEY;
    const stub = installFetchStub(() => { throw new Error("must not call fetch when unconfigured"); });
    try {
      expectEq("isConfigured() false when key missing", isConfigured(), false);
      const status = getPerplexityStatus();
      expectEq("getPerplexityStatus configured=false", status.configured, false);
      expectTrue("status.model defaults to sonar", status.model.length > 0);
      const out = await runResearch({ query: "anything" });
      expectEq("runResearch ok=false when unconfigured", out.ok, false);
      if (!out.ok) expectEq("runResearch reason=not_configured", out.reason, "not_configured");
      expectEq("no fetch calls when unconfigured", stub.calls.length, 0);
      // Connector also self-skips.
      const items = await perplexityConnector.fetch({ companyName: "Stripe" });
      expectEq("connector returns [] when unconfigured", items.length, 0);
      // Agent tool returns a sanitised error string, not a thrown exception.
      const toolOut = await executeTool("perplexity_research", { query: "hi" });
      expectTrue(
        "tool returns Error: not configured prefix",
        typeof toolOut === "string" && toolOut.startsWith("Error:") && /not configured/i.test(toolOut),
      );
    } finally {
      stub.restore();
    }
  }

  // ── 2. Successful response + citation normalisation ─────────────────────
  {
    process.env.PERPLEXITY_API_KEY = KEY;
    const fakeBody = {
      model: "sonar",
      choices: [{ message: { role: "assistant", content: "Stripe is a payments platform. [1][2]" } }],
      citations: ["https://stripe.com/about", "https://stripe.com/about"], // duplicate
      search_results: [
        { url: "https://www.sec.gov/cgi-bin/browse-edgar?CIK=0001234", title: "EDGAR – Stripe", date: "2025-01-15" },
        { url: "https://www.bloomberg.com/news/stripe", title: "Bloomberg coverage", snippet: "Snippet" },
      ],
      usage: { prompt_tokens: 24, completion_tokens: 80 },
    };

    const stub = installFetchStub(() => makeJsonResponse(fakeBody));
    try {
      const out = await runResearch({ query: "Tell me about Stripe", searchRecencyFilter: "month" });
      expectEq("happy-path ok=true", out.ok, true);
      if (out.ok) {
        expectEq("happy-path model echo", out.model, "sonar");
        expectEq("happy-path tokensIn", out.usage?.tokensIn, 24);
        expectTrue("happy-path content non-empty", out.content.length > 0);
        // search_results first, then any non-duplicate flat citations.
        expectEq("happy-path citation count (deduped)", out.citations.length, 3);
        expectEq("happy-path first citation is SEC", out.citations[0]?.url, "https://www.sec.gov/cgi-bin/browse-edgar?CIK=0001234");
        expectEq("happy-path first citation has title", out.citations[0]?.title, "EDGAR – Stripe");
        expectEq("happy-path first citation has date", out.citations[0]?.publishedDate, "2025-01-15");
      }
      // Verify the API key was sent in the Authorization header and NOT in the body.
      const sentInit = stub.calls[0]?.init;
      const authHeader = (sentInit?.headers as Record<string, string> | undefined)?.["authorization"]
        ?? (sentInit?.headers as Record<string, string> | undefined)?.["Authorization"];
      expectEq("authorization header is Bearer <key>", authHeader, `Bearer ${KEY}`);
      const sentBody = typeof sentInit?.body === "string" ? sentInit.body : "";
      expectEq("body does not contain the key", sentBody.includes(KEY), false);
      // Domain / recency filters should be forwarded only when set.
      expectEq("body forwards search_recency_filter", sentBody.includes("\"search_recency_filter\":\"month\""), true);
    } finally {
      stub.restore();
    }
  }

  // ── 3. Connector shapes synthesis + citation rows ────────────────────────
  {
    process.env.PERPLEXITY_API_KEY = KEY;
    const fakeBody = {
      model: "sonar",
      choices: [{ message: { content: "Synthesised answer about Acme." } }],
      search_results: [
        { url: "https://acme.example/about", title: "Acme – About", date: "2025-02-01" },
      ],
    };
    const stub = installFetchStub(() => makeJsonResponse(fakeBody));
    try {
      const rows = await perplexityConnector.fetch({ companyName: "Acme Inc." });
      expectEq("connector returns synthesis + 1 citation = 2 rows", rows.length, 2);
      expectEq("first row is synthesis", (rows[0]?.metadata as { kind?: string } | undefined)?.kind, "synthesis");
      expectEq("synthesis publisher=Perplexity", rows[0]?.publisher, "Perplexity");
      expectEq("citation row uses citation domain", rows[1]?.domain, "acme.example");
      expectEq("citation row carries snippet/title", rows[1]?.title, "Acme – About");
    } finally {
      stub.restore();
    }
  }

  // ── 4. HTTP error path is sanitised + leaks no key ──────────────────────
  {
    process.env.PERPLEXITY_API_KEY = KEY;
    const stub = installFetchStub(() => new Response(`secret context with ${KEY} embedded`, {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "content-type": "text/plain" },
    }));
    try {
      const out = await runResearch({ query: "boom" });
      expectEq("502 → ok=false", out.ok, false);
      if (!out.ok) {
        expectEq("502 reason=http_error", out.reason, "http_error");
        expectEq("error message redacts the API key", out.message.includes(KEY), false);
        expectTrue("error message mentions HTTP 502", /502/.test(out.message));
      }
    } finally {
      stub.restore();
    }
  }

  // ── 5. Timeout path returns reason=timeout ──────────────────────────────
  {
    process.env.PERPLEXITY_API_KEY = KEY;
    const stub = installFetchStub((call) => new Promise<Response>((_resolve, reject) => {
      // Simulate fetch that hangs until aborted. AbortController fires the
      // signal; we reject with an AbortError so the client treats it as a
      // timeout (matches real-world fetch behaviour).
      const signal = call.init?.signal as AbortSignal | undefined;
      const onAbort = () => {
        const err = new Error("aborted");
        (err as Error & { name: string }).name = "AbortError";
        reject(err);
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    }));
    try {
      const out = await runResearch({ query: "slow", timeoutMs: 1_000 });
      expectEq("timeout → ok=false", out.ok, false);
      if (!out.ok) {
        expectEq("timeout reason=timeout", out.reason, "timeout");
        expectEq("timeout message redacts key", out.message.includes(KEY), false);
      }
    } finally {
      stub.restore();
    }
  }

  // ── 6. Invalid response (no choices) ────────────────────────────────────
  {
    process.env.PERPLEXITY_API_KEY = KEY;
    const stub = installFetchStub(() => makeJsonResponse({ choices: [] }));
    try {
      const out = await runResearch({ query: "x" });
      expectEq("no choices → ok=false", out.ok, false);
      if (!out.ok) expectEq("no choices reason=invalid_response", out.reason, "invalid_response");
    } finally {
      stub.restore();
    }
  }

  // ── 7. Tool dispatch happy path formats citations as numbered list ──────
  {
    process.env.PERPLEXITY_API_KEY = KEY;
    const fakeBody = {
      model: "sonar",
      choices: [{ message: { content: "Answer." } }],
      citations: ["https://example.com/a", "https://example.com/b"],
    };
    const stub = installFetchStub(() => makeJsonResponse(fakeBody));
    try {
      const toolOut = await executeTool("perplexity_research", { query: "what is X?" });
      expectTrue("tool output mentions model", typeof toolOut === "string" && toolOut.includes("sonar"));
      expectTrue("tool output includes [1]", typeof toolOut === "string" && /\[1\]/.test(toolOut));
      expectTrue("tool output includes [2]", typeof toolOut === "string" && /\[2\]/.test(toolOut));
      expectEq("tool output does NOT leak key", (toolOut as string).includes(KEY), false);
    } finally {
      stub.restore();
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────
  let failed = 0;
  for (const c of cases) {
    const ok = c.got === c.want;
    const tag = ok ? "PASS" : "FAIL";
    console.log(`${tag}  ${c.name}  got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} checks passed`);
  process.exit(0);
})().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
