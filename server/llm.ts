// ─── Unified streaming LLM adapter ────────────────────────────────────────────
// Wraps Anthropic, OpenAI, Google Gemini, Kimi (Moonshot), and DeepSeek under a
// single streamCompletion() interface. Each provider uses its native HTTP
// streaming protocol (SSE), parsed inline so we don't need provider SDKs.
//
// All providers stream incremental text deltas via the `onDelta` callback and
// return final token counts. Token usage is reported via onUsage, which the
// caller persists and broadcasts to the Budget tab.
//
// Stage 4.13: when `tools` is set on the request the adapter switches into
// non-streaming tool-loop mode — it lets the model emit tool_calls, executes
// them, and re-prompts with the tool results until the model returns a final
// text answer. Token usage is summed across the whole loop.
// ─────────────────────────────────────────────────────────────────────────────

import { executeTool, type ToolDefinition } from "./tools";

export type Provider = "anthropic" | "openai" | "google" | "kimi" | "deepseek";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamRequest {
  provider: Provider;
  modelId: string;
  apiKey: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  // Stage 4.13: optional tool definitions. When set, the adapter routes through
  // the tool-loop path for the chosen provider. The loop runs the model,
  // executes any tool_calls server-side, feeds results back, and repeats until
  // the model emits a final answer (or MAX_TOOL_ITERS is hit).
  tools?: ToolDefinition[];
}

export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onUsage?: (usage: { tokensIn: number; tokensOut: number }) => void;
  // Stage 4.13: emitted when the model invokes a tool. Useful for the
  // activity feed so operators see what the agent is fetching.
  onToolCall?: (info: { name: string; args: string; result: string }) => void;
}

export interface StreamResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

// Maximum tool-call rounds per request. Each iteration is one model call +
// one tool execution. Keeps runaway loops bounded.
// Stage 4.15: bumped 6 → 12. Research tasks routinely need 8–10 tool calls
// (search, then extract several URLs, then maybe re-search). The previous cap
// of 6 caused tool-loop runaway: agents would burn iterations on searches and
// hit the cap before synthesising, returning a placeholder string. Combined
// with forceSynthesisRound() below, we now cap calls AND guarantee a
// deliverable on every code path.
const MAX_TOOL_ITERS = 12;

// Stage 4.15: when we hit the iteration cap, OR Anthropic returns
// stop_reason="max_tokens" mid-tool-loop, we run ONE final round with tools
// disabled so the model is forced to write a deliverable from whatever it has
// already gathered. This replaces the previous behaviour of returning a
// literal placeholder string ("Tool-call loop hit the iteration cap...")
// which propagated into saved files.
const SYNTHESIS_NUDGE =
  "You have reached the tool-call budget for this task. STOP calling tools. " +
  "Using only the search results and extracted content already gathered in " +
  "this conversation, produce the final deliverable now. Follow the output " +
  "contract from your system prompt exactly — prose summary plus the fenced " +
  "JSON manifest. Do not call any more tools.";

// ─── Cost rates (USD per 1K tokens) ─────────────────────────────────────────
// Used for per-call cost calculation. Keep in sync with MODEL_COST_PER_1K
// in routes.ts. Unknown models fall back to a moderate default.
const COST_PER_1K: Record<string, { in: number; out: number }> = {
  // Anthropic
  "claude-opus-4-7":   { in: 0.015,   out: 0.075 },
  "claude-sonnet-4-6": { in: 0.003,   out: 0.015 },
  "claude-haiku-4-5":  { in: 0.001,   out: 0.005 },
  // OpenAI
  "gpt-4.1":           { in: 0.002,   out: 0.008 },
  "gpt-4.1-mini":      { in: 0.0004,  out: 0.0016 },
  "gpt-4o":            { in: 0.0025,  out: 0.01 },
  "o4-mini":           { in: 0.0011,  out: 0.0044 },
  "o3":                { in: 0.01,    out: 0.04 },
  // Google
  "gemini-2.5-pro":    { in: 0.00125, out: 0.005 },
  "gemini-2.5-flash":  { in: 0.00015, out: 0.0006 },
  "gemini-2.0-flash":  { in: 0.0001,  out: 0.0004 },
  // Kimi
  "moonshot-v1-128k":  { in: 0.0012,  out: 0.0012 },
  "moonshot-v1-32k":   { in: 0.0008,  out: 0.0008 },
  // DeepSeek (V4 family released 2026-04-24, OpenAI-compatible API)
  // V4-Flash is the cheapest credible production model in our catalogue —
  // hence its position at the top of the low-tier router fallback chain.
  // Pro pricing is approximate (frontier tier) — refresh if DeepSeek
  // publishes official rates.
  "deepseek-v4-flash": { in: 0.00014, out: 0.00028 },
  "deepseek-v4-pro":   { in: 0.0014,  out: 0.0056 },
  // Legacy aliases — DeepSeek routes both to V4-Flash internally.
  "deepseek-chat":     { in: 0.00014, out: 0.00028 },
  "deepseek-reasoner": { in: 0.00014, out: 0.00028 },
};

export function calculateCost(modelId: string, tokensIn: number, tokensOut: number): number {
  const rates = COST_PER_1K[modelId] ?? { in: 0.002, out: 0.008 };
  return parseFloat(((tokensIn / 1000) * rates.in + (tokensOut / 1000) * rates.out).toFixed(6));
}

// ─── SSE line parser ────────────────────────────────────────────────────────
// Yields complete SSE events from a streaming Response body.
async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
        buffer = buffer.slice(nlIdx + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
      }
    }
    if (buffer.trim().startsWith("data:")) {
      yield buffer.trim().slice(5).trim();
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Anthropic ──────────────────────────────────────────────────────────────
async function streamAnthropic(req: StreamRequest, handlers: StreamHandlers): Promise<StreamResult> {
  // Anthropic separates system from messages
  const system = req.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const messages = req.messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role, content: m.content }));

  const body = {
    model: req.modelId,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature ?? 0.7,
    stream: true,
    ...(system ? { system } : {}),
    messages,
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": req.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`);
  }

  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for await (const data of parseSSE(res.body)) {
    if (!data || data === "[DONE]") continue;
    let evt: any;
    try { evt = JSON.parse(data); } catch { continue; }

    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
      const delta = evt.delta.text ?? "";
      text += delta;
      handlers.onDelta?.(delta);
    } else if (evt.type === "message_start" && evt.message?.usage) {
      tokensIn = evt.message.usage.input_tokens ?? 0;
    } else if (evt.type === "message_delta" && evt.usage) {
      tokensOut = evt.usage.output_tokens ?? tokensOut;
    }
  }

  handlers.onUsage?.({ tokensIn, tokensOut });
  return { text, tokensIn, tokensOut };
}

// ─── OpenAI ─────────────────────────────────────────────────────────────────
async function streamOpenAI(req: StreamRequest, handlers: StreamHandlers): Promise<StreamResult> {
  const body = {
    model: req.modelId,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 2048,
    stream: true,
    stream_options: { include_usage: true },
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 200)}`);
  }

  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for await (const data of parseSSE(res.body)) {
    if (!data || data === "[DONE]") continue;
    let evt: any;
    try { evt = JSON.parse(data); } catch { continue; }

    const delta = evt.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      text += delta;
      handlers.onDelta?.(delta);
    }
    if (evt.usage) {
      tokensIn = evt.usage.prompt_tokens ?? tokensIn;
      tokensOut = evt.usage.completion_tokens ?? tokensOut;
    }
  }

  handlers.onUsage?.({ tokensIn, tokensOut });
  return { text, tokensIn, tokensOut };
}

// ─── Google Gemini ──────────────────────────────────────────────────────────
async function streamGoogle(req: StreamRequest, handlers: StreamHandlers): Promise<StreamResult> {
  // Gemini API: separate systemInstruction; map other messages to contents
  const systemMsgs = req.messages.filter(m => m.role === "system");
  const otherMsgs = req.messages.filter(m => m.role !== "system");

  const contents = otherMsgs.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: any = {
    contents,
    generationConfig: {
      temperature: req.temperature ?? 0.7,
      maxOutputTokens: req.maxTokens ?? 2048,
    },
  };
  if (systemMsgs.length > 0) {
    body.systemInstruction = { parts: [{ text: systemMsgs.map(m => m.content).join("\n\n") }] };
  }

  // Use streamGenerateContent with SSE
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(req.apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Google API ${res.status}: ${errText.slice(0, 200)}`);
  }

  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for await (const data of parseSSE(res.body)) {
    if (!data) continue;
    let evt: any;
    try { evt = JSON.parse(data); } catch { continue; }

    const parts = evt.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p.text === "string" && p.text.length > 0) {
        text += p.text;
        handlers.onDelta?.(p.text);
      }
    }
    if (evt.usageMetadata) {
      tokensIn = evt.usageMetadata.promptTokenCount ?? tokensIn;
      tokensOut = evt.usageMetadata.candidatesTokenCount ?? tokensOut;
    }
  }

  handlers.onUsage?.({ tokensIn, tokensOut });
  return { text, tokensIn, tokensOut };
}

// ─── Kimi (Moonshot) — OpenAI-compatible API ────────────────────────────────
// Primary endpoint is api.moonshot.ai (international, full catalogue including
// kimi-k2.6). On HTTP 401 we retry once on api.moonshot.cn for legacy
// China-region keys.
async function callKimiHost(
  host: string,
  body: unknown,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ res: Response; errText?: string }> {
  const res = await fetch(`https://${host}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    return { res, errText };
  }
  return { res };
}

// Reasoning-tier Kimi models (kimi-k2.x and newer) require temperature = 1.
// Non-reasoning models (moonshot-v1-*) accept the standard 0–1 range.
function kimiTemperatureFor(modelId: string, requested: number | undefined): number {
  if (/^kimi-k\d/i.test(modelId) || /^kimi-2\.[5-9]/i.test(modelId) || /^moonshot-v[2-9]/i.test(modelId)) {
    return 1;
  }
  return requested ?? 0.7;
}

async function streamKimi(req: StreamRequest, handlers: StreamHandlers): Promise<StreamResult> {
  const body = {
    model: req.modelId,
    messages: req.messages,
    temperature: kimiTemperatureFor(req.modelId, req.temperature),
    max_tokens: req.maxTokens ?? 2048,
    stream: true,
  };

  // Try international endpoint first.
  let attempt = await callKimiHost("api.moonshot.ai", body, req.apiKey, req.signal);
  let res = attempt.res;
  let errText = attempt.errText;

  // Legacy China-region key fallback on 401.
  if (!res.ok && res.status === 401) {
    const fallback = await callKimiHost("api.moonshot.cn", body, req.apiKey, req.signal);
    if (fallback.res.ok && fallback.res.body) {
      res = fallback.res;
      errText = undefined;
    } else {
      // Keep the .ai 401 as the surfaced error (more actionable), but note we tried .cn.
      errText = errText ?? fallback.errText;
    }
  }

  if (!res.ok || !res.body) {
    const snippet = (errText ?? "").slice(0, 200);
    if (res.status === 401) {
      throw new Error(
        `Kimi API 401 (auth): key rejected by both api.moonshot.ai and api.moonshot.cn. ` +
          `Verify the key at platform.kimi.ai/console/api-keys (or platform.moonshot.ai). ` +
          `Detail: ${snippet}`,
      );
    }
    if (res.status === 429) {
      throw new Error(
        `Kimi API 429 (billing/quota): account is rate-limited or out of credit. ` +
          `Check balance at platform.kimi.ai. Detail: ${snippet}`,
      );
    }
    throw new Error(`Kimi API ${res.status} (transient): ${snippet}`);
  }

  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for await (const data of parseSSE(res.body)) {
    if (!data || data === "[DONE]") continue;
    let evt: any;
    try { evt = JSON.parse(data); } catch { continue; }

    const delta = evt.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      text += delta;
      handlers.onDelta?.(delta);
    }
    if (evt.usage) {
      tokensIn = evt.usage.prompt_tokens ?? tokensIn;
      tokensOut = evt.usage.completion_tokens ?? tokensOut;
    }
  }

  // Kimi sometimes only returns usage in the final non-stream chunk; fall back to
  // a token estimate (≈ 4 chars/token) if not provided.
  if (tokensIn === 0) {
    const promptChars = req.messages.reduce((sum, m) => sum + m.content.length, 0);
    tokensIn = Math.ceil(promptChars / 4);
  }
  if (tokensOut === 0) {
    tokensOut = Math.ceil(text.length / 4);
  }

  handlers.onUsage?.({ tokensIn, tokensOut });
  return { text, tokensIn, tokensOut };
}

// ─── DeepSeek — OpenAI-compatible API ─────────────────────────────────
// Stage 4.20: DeepSeek's V4 family (released 2026-04-24) ships with a fully
// OpenAI-compatible Chat Completions endpoint at api.deepseek.com. There's no
// regional fallback (single global endpoint), no special temperature rule
// (standard 0–1 range), and tool calling follows the OpenAI shape exactly.
// We keep the streaming path symmetrical with streamKimi for parity.
async function streamDeepSeek(req: StreamRequest, handlers: StreamHandlers): Promise<StreamResult> {
  const body = {
    model: req.modelId,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 2048,
    stream: true,
  };

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    const snippet = errText.slice(0, 200);
    if (res.status === 401) {
      throw new Error(
        `DeepSeek API 401 (auth): key rejected. Verify the key at ` +
          `platform.deepseek.com/api_keys. Detail: ${snippet}`,
      );
    }
    if (res.status === 429) {
      throw new Error(
        `DeepSeek API 429 (billing/quota): account is rate-limited or out of credit. ` +
          `Check balance at platform.deepseek.com. Detail: ${snippet}`,
      );
    }
    throw new Error(`DeepSeek API ${res.status} (transient): ${snippet}`);
  }

  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for await (const data of parseSSE(res.body)) {
    if (!data || data === "[DONE]") continue;
    let evt: any;
    try { evt = JSON.parse(data); } catch { continue; }

    const delta = evt.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      text += delta;
      handlers.onDelta?.(delta);
    }
    if (evt.usage) {
      tokensIn = evt.usage.prompt_tokens ?? tokensIn;
      tokensOut = evt.usage.completion_tokens ?? tokensOut;
    }
  }

  // Same fallback heuristic as Kimi: estimate tokens (≈4 chars/token) when
  // the provider doesn't include usage on the final stream chunk.
  if (tokensIn === 0) {
    const promptChars = req.messages.reduce((sum, m) => sum + m.content.length, 0);
    tokensIn = Math.ceil(promptChars / 4);
  }
  if (tokensOut === 0) {
    tokensOut = Math.ceil(text.length / 4);
  }

  handlers.onUsage?.({ tokensIn, tokensOut });
  return { text, tokensIn, tokensOut };
}

// ─── Stage 4.13 — tool-call loops per provider ─────────────────────────────
// All four loops follow the same shape:
//   1. Send the conversation + tool definitions to the provider (non-streaming)
//   2. If the model returns a final text answer → done
//   3. If it returns tool_calls → execute them, append the assistant turn and
//      tool result(s) to the conversation, loop
// We cap iterations at MAX_TOOL_ITERS to bound cost and latency.
// Token usage is summed across every round so the budget tab stays accurate.
// On the FINAL iteration (or when we hit the iteration cap) we ask the model
// to produce a written deliverable, streaming the result so the activity feed
// still gets live tokens.

// ─── OpenAI / Kimi (OpenAI-compatible) ─────────────────────────────────────
interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
interface OpenAIChoiceMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  // Kimi reasoning models (kimi-k*, kimi-2.5+, moonshot-v2+) return a separate
  // `reasoning_content` field alongside `content`. When the assistant turn
  // contains tool_calls, Moonshot REQUIRES this field to be echoed back on
  // the next request — otherwise the API rejects with:
  //   "thinking is enabled but reasoning_content is missing in assistant
  //    tool call message at index N"
  reasoning_content?: string | null;
}

// Stage 4.17: transient-error retry. Provider edges (Moonshot/Cloudflare,
// Anthropic, Gemini) occasionally return 502/503/504 or hard timeout for a
// few seconds. We retry up to 3 times with exponential backoff (1s, 2s, 4s)
// before surfacing the error. 4xx errors (auth, bad request, rate-limit)
// pass through immediately — retry won't help and just burns time.
//
// Aborts (the user pressing Stop) bypass retry: if AbortError fires we throw
// it back up immediately so cancelProject() stays snappy.
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init);
      // 502/503/504 — transient gateway errors. Retry.
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        const body = await res.text().catch(() => "");
        lastErr = new Error(`${url} ${res.status}: ${body.slice(0, 200)}`);
        if (attempt < RETRY_MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          continue;
        }
        throw lastErr;
      }
      return res;
    } catch (e) {
      // AbortError (user-cancel) bypasses retry.
      if ((e as Error)?.name === "AbortError") throw e;
      lastErr = e;
      // Network error / DNS failure / fetch threw — also transient.
      if (attempt < RETRY_MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error("fetchWithRetry: exhausted attempts");
}

async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ message: OpenAIChoiceMessage; tokensIn: number; tokensOut: number }> {
  const res = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`${endpoint} ${res.status}: ${err.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const message: OpenAIChoiceMessage = json.choices?.[0]?.message ?? { role: "assistant", content: "" };
  return {
    message,
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
  };
}

async function runOpenAIWithTools(
  req: StreamRequest,
  handlers: StreamHandlers,
  flavour: "openai" | "kimi" | "deepseek",
): Promise<StreamResult> {
  // OpenAI, Kimi, and DeepSeek all accept the same tools shape.
  const toolsParam = (req.tools ?? []).map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  // Working conversation. We mutate this as we loop.
  const convo: any[] = req.messages.map(m => ({ role: m.role, content: m.content }));

  let totalIn = 0;
  let totalOut = 0;

  // Choose endpoint + temperature handling per flavour.
  const buildEndpointAndTemp = () => {
    if (flavour === "kimi") {
      return {
        endpoint: "https://api.moonshot.ai/v1/chat/completions",
        fallback: "https://api.moonshot.cn/v1/chat/completions",
        temperature: kimiTemperatureFor(req.modelId, req.temperature),
      };
    }
    if (flavour === "deepseek") {
      // Stage 4.20: single global endpoint, standard temperature handling,
      // no regional fallback. Keeps the loop logic identical to OpenAI.
      return {
        endpoint: "https://api.deepseek.com/v1/chat/completions",
        fallback: undefined as string | undefined,
        temperature: req.temperature ?? 0.7,
      };
    }
    return {
      endpoint: "https://api.openai.com/v1/chat/completions",
      fallback: undefined as string | undefined,
      temperature: req.temperature ?? 0.7,
    };
  };

  const cfg = buildEndpointAndTemp();

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    const isLast = iter === MAX_TOOL_ITERS - 1;
    const body: Record<string, unknown> = {
      model: req.modelId,
      messages: convo,
      temperature: cfg.temperature,
      max_tokens: req.maxTokens ?? 2048,
      tools: toolsParam,
      // Force a final answer on the last permitted round.
      tool_choice: isLast ? "none" : "auto",
    };

    let resp;
    try {
      resp = await callOpenAICompatible(cfg.endpoint, req.apiKey, body, req.signal);
    } catch (e) {
      if (cfg.fallback && /401/.test((e as Error).message)) {
        resp = await callOpenAICompatible(cfg.fallback, req.apiKey, body, req.signal);
      } else {
        throw e;
      }
    }
    totalIn += resp.tokensIn;
    totalOut += resp.tokensOut;

    const msg = resp.message;
    const toolCalls = msg.tool_calls ?? [];

    if (toolCalls.length === 0) {
      // Final answer. Stream it out as one delta so the UI gets the text.
      const text = msg.content ?? "";
      if (text) handlers.onDelta?.(text);
      handlers.onUsage?.({ tokensIn: totalIn, tokensOut: totalOut });
      return { text, tokensIn: totalIn, tokensOut: totalOut };
    }

    // Append assistant turn (with tool_calls) so the next round has context.
    // Kimi reasoning models require us to echo back `reasoning_content` when
    // the assistant message contains tool_calls (see OpenAIChoiceMessage).
    const assistantTurn: Record<string, unknown> = {
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: toolCalls,
    };
    if (flavour === "kimi" && msg.reasoning_content != null) {
      assistantTurn.reasoning_content = msg.reasoning_content;
    }
    convo.push(assistantTurn);

    // Execute each tool call serially. Tavily is fast; serialising keeps the
    // logs readable and avoids blasting their rate limit.
    for (const tc of toolCalls) {
      const name = tc.function?.name ?? "";
      const argsStr = tc.function?.arguments ?? "{}";
      const result = await executeTool(name, argsStr, req.signal);
      handlers.onToolCall?.({ name, args: argsStr, result });
      convo.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  // Stage 4.15: cap reached without a final text answer. Force one synthesis
  // round with tool_choice="none" + an explicit user-message nudge. This
  // produces a real deliverable instead of a placeholder string.
  convo.push({ role: "user", content: SYNTHESIS_NUDGE });
  const synthBody: Record<string, unknown> = {
    model: req.modelId,
    messages: convo,
    temperature: cfg.temperature,
    max_tokens: req.maxTokens ?? 2048,
    tool_choice: "none",
  };
  let synth;
  try {
    synth = await callOpenAICompatible(cfg.endpoint, req.apiKey, synthBody, req.signal);
  } catch (e) {
    if (cfg.fallback && /401/.test((e as Error).message)) {
      synth = await callOpenAICompatible(cfg.fallback, req.apiKey, synthBody, req.signal);
    } else {
      throw e;
    }
  }
  totalIn += synth.tokensIn;
  totalOut += synth.tokensOut;
  const synthText = synth.message.content ?? "";
  if (synthText) handlers.onDelta?.(synthText);
  handlers.onUsage?.({ tokensIn: totalIn, tokensOut: totalOut });
  return { text: synthText, tokensIn: totalIn, tokensOut: totalOut };
}

// ─── Anthropic ─────────────────────────────────────────────────────────────
// Anthropic's tools shape: { name, description, input_schema }.
// Tool calls come back as content blocks of type "tool_use" { id, name, input }.
// Tool results are appended as a USER turn with content [{ type:"tool_result",
// tool_use_id, content }].

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface AnthropicTextBlock { type: "text"; text: string; }
type AnthropicContentBlock = AnthropicToolUseBlock | AnthropicTextBlock;

async function callAnthropicWithTools(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ content: AnthropicContentBlock[]; tokensIn: number; tokensOut: number; stopReason: string }> {
  // Stage 4.17: fetchWithRetry handles transient 502/503/504 from
  // Anthropic's edge (rare but happens during their incident windows).
  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`);
  }
  const json: any = await res.json();
  return {
    content: (json.content ?? []) as AnthropicContentBlock[],
    tokensIn: json.usage?.input_tokens ?? 0,
    tokensOut: json.usage?.output_tokens ?? 0,
    stopReason: json.stop_reason ?? "",
  };
}

async function runAnthropicWithTools(req: StreamRequest, handlers: StreamHandlers): Promise<StreamResult> {
  const system = req.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  // Anthropic conversation: array of { role, content } where content can be a
  // string or an array of blocks. We start from the non-system messages.
  const convo: any[] = req.messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role, content: m.content }));

  const toolsParam = (req.tools ?? []).map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  let totalIn = 0;
  let totalOut = 0;

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    const body: Record<string, unknown> = {
      model: req.modelId,
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0.7,
      ...(system ? { system } : {}),
      messages: convo,
      tools: toolsParam,
    };

    const resp = await callAnthropicWithTools(req.apiKey, body, req.signal);
    totalIn += resp.tokensIn;
    totalOut += resp.tokensOut;

    const toolUses = resp.content.filter((b): b is AnthropicToolUseBlock => b.type === "tool_use");
    const textBlocks = resp.content.filter((b): b is AnthropicTextBlock => b.type === "text");

    if (toolUses.length === 0 || resp.stopReason === "end_turn") {
      const text = textBlocks.map(b => b.text).join("");
      if (text) handlers.onDelta?.(text);
      handlers.onUsage?.({ tokensIn: totalIn, tokensOut: totalOut });
      return { text, tokensIn: totalIn, tokensOut: totalOut };
    }

    // Stage 4.15: Anthropic returned tool_use blocks BUT was cut off by
    // max_tokens mid-thought. The captured tool_use blocks are unusable
    // (their ids may not match a complete request), and the truncated text
    // often contains internal-monologue garbage (foreign-language scratch
    // pads, raw ":functions." tokens). Drop the partial turn and force a
    // synthesis round with tools disabled, working from earlier tool results.
    if (resp.stopReason === "max_tokens") {
      break;
    }

    // Push assistant turn with the original content blocks intact (Anthropic
    // requires the exact tool_use blocks back in the conversation).
    convo.push({ role: "assistant", content: resp.content });

    // Execute each tool_use and reply with one user turn carrying tool_result
    // blocks (one per tool_use, same order).
    const resultBlocks: any[] = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input as Record<string, unknown>, req.signal);
      handlers.onToolCall?.({ name: tu.name, args: JSON.stringify(tu.input), result });
      resultBlocks.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    convo.push({ role: "user", content: resultBlocks });
  }

  // Stage 4.15: cap reached or max_tokens early-exit. Force one final
  // synthesis round with NO tools so Claude must write the deliverable from
  // gathered context. This is the fix for test3 file 97 (Arabic/Chinese
  // internal monologue + raw ":functions.tavily_search:5)..." leakage).
  convo.push({ role: "user", content: SYNTHESIS_NUDGE });
  const synthBody: Record<string, unknown> = {
    model: req.modelId,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature ?? 0.7,
    ...(system ? { system } : {}),
    messages: convo,
    // No `tools` field at all — Claude can't call tools if it doesn't know
    // they exist for this turn.
  };
  const synth = await callAnthropicWithTools(req.apiKey, synthBody, req.signal);
  totalIn += synth.tokensIn;
  totalOut += synth.tokensOut;
  const synthText = synth.content
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map(b => b.text)
    .join("");
  if (synthText) handlers.onDelta?.(synthText);
  handlers.onUsage?.({ tokensIn: totalIn, tokensOut: totalOut });
  return { text: synthText, tokensIn: totalIn, tokensOut: totalOut };
}

// ─── Google Gemini ─────────────────────────────────────────────────────────
// Gemini tools: tools=[{ functionDeclarations:[{ name, description, parameters }]}]
// Function calls come back as parts with `functionCall: { name, args }`.
// Tool results are sent back as a part with `functionResponse: { name, response }`.

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

async function callGoogleWithTools(
  modelId: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ parts: GeminiPart[]; tokensIn: number; tokensOut: number; finishReason: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  // Stage 4.17: fetchWithRetry handles transient gateway errors.
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Google API ${res.status}: ${err.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const cand = json.candidates?.[0];
  return {
    parts: (cand?.content?.parts ?? []) as GeminiPart[],
    tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
    finishReason: cand?.finishReason ?? "",
  };
}

async function runGoogleWithTools(req: StreamRequest, handlers: StreamHandlers): Promise<StreamResult> {
  const systemMsgs = req.messages.filter(m => m.role === "system");
  const otherMsgs = req.messages.filter(m => m.role !== "system");

  // Build the contents array. We'll mutate it across iterations.
  const contents: any[] = otherMsgs.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const tools = [{
    functionDeclarations: (req.tools ?? []).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  }];

  let totalIn = 0;
  let totalOut = 0;

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.maxTokens ?? 2048,
      },
      tools,
    };
    if (systemMsgs.length > 0) {
      body.systemInstruction = { parts: [{ text: systemMsgs.map(m => m.content).join("\n\n") }] };
    }

    const resp = await callGoogleWithTools(req.modelId, req.apiKey, body, req.signal);
    totalIn += resp.tokensIn;
    totalOut += resp.tokensOut;

    const fnCalls = resp.parts.filter(p => !!p.functionCall);
    const textParts = resp.parts.filter(p => typeof p.text === "string" && p.text.length > 0);

    if (fnCalls.length === 0) {
      const text = textParts.map(p => p.text!).join("");
      if (text) handlers.onDelta?.(text);
      handlers.onUsage?.({ tokensIn: totalIn, tokensOut: totalOut });
      return { text, tokensIn: totalIn, tokensOut: totalOut };
    }

    // Push the model turn (including function calls) so it has continuity.
    contents.push({ role: "model", parts: resp.parts });

    // Execute each function call and reply in a single user turn carrying
    // functionResponse parts (one per call).
    const responseParts: GeminiPart[] = [];
    for (const p of fnCalls) {
      const fc = p.functionCall!;
      const result = await executeTool(fc.name, fc.args ?? {}, req.signal);
      handlers.onToolCall?.({ name: fc.name, args: JSON.stringify(fc.args ?? {}), result });
      responseParts.push({
        functionResponse: {
          name: fc.name,
          // Gemini wants `response` to be a JSON object, not a bare string.
          response: { content: result },
        },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  // Stage 4.15: cap reached. Force one synthesis round with NO tools so
  // Gemini writes the deliverable from gathered context.
  contents.push({ role: "user", parts: [{ text: SYNTHESIS_NUDGE }] });
  const synthBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: req.temperature ?? 0.7,
      maxOutputTokens: req.maxTokens ?? 2048,
    },
    // No `tools` field — forces a text-only response.
  };
  if (systemMsgs.length > 0) {
    synthBody.systemInstruction = { parts: [{ text: systemMsgs.map(m => m.content).join("\n\n") }] };
  }
  const synth = await callGoogleWithTools(req.modelId, req.apiKey, synthBody, req.signal);
  totalIn += synth.tokensIn;
  totalOut += synth.tokensOut;
  const synthText = synth.parts
    .filter(p => typeof p.text === "string" && p.text.length > 0)
    .map(p => p.text!)
    .join("");
  if (synthText) handlers.onDelta?.(synthText);
  handlers.onUsage?.({ tokensIn: totalIn, tokensOut: totalOut });
  return { text: synthText, tokensIn: totalIn, tokensOut: totalOut };
}

// ─── Public API ─────────────────────────────────────────────────────────────
export async function streamCompletion(
  req: StreamRequest,
  handlers: StreamHandlers = {}
): Promise<StreamResult> {
  if (!req.apiKey) {
    throw new Error(`Missing API key for provider "${req.provider}"`);
  }

  // Stage 4.13: route tool-enabled calls through the per-provider tool loop.
  // The non-tool path (fast, streaming) is preserved for everything else.
  if (req.tools && req.tools.length > 0) {
    switch (req.provider) {
      case "anthropic": return runAnthropicWithTools(req, handlers);
      case "openai":    return runOpenAIWithTools(req, handlers, "openai");
      case "kimi":      return runOpenAIWithTools(req, handlers, "kimi");
      case "deepseek":  return runOpenAIWithTools(req, handlers, "deepseek");
      case "google":    return runGoogleWithTools(req, handlers);
      default:
        throw new Error(`Unknown provider "${(req as StreamRequest).provider}"`);
    }
  }

  switch (req.provider) {
    case "anthropic": return streamAnthropic(req, handlers);
    case "openai":    return streamOpenAI(req, handlers);
    case "google":    return streamGoogle(req, handlers);
    case "kimi":      return streamKimi(req, handlers);
    case "deepseek":  return streamDeepSeek(req, handlers);
    default:
      throw new Error(`Unknown provider "${(req as StreamRequest).provider}"`);
  }
}

// ─── Setting key resolver ──────────────────────────────────────────────────
export function settingKeyForProvider(p: string): string {
  // Settings table convention: <provider>_api_key
  // Note: Google key was stored under "google_api_key" historically, even though
  // the env var is GEMINI_API_KEY in the SettingsPage UI.
  return `${p}_api_key`;
}
