// ─── Unified streaming LLM adapter ────────────────────────────────────────────
// Wraps Anthropic, OpenAI, Google Gemini, and Kimi (Moonshot) under a single
// streamCompletion() interface. Each provider uses its native HTTP streaming
// protocol (SSE), parsed inline so we don't need provider SDKs.
//
// All providers stream incremental text deltas via the `onDelta` callback and
// return final token counts. Token usage is reported via onUsage, which the
// caller persists and broadcasts to the Budget tab.
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = "anthropic" | "openai" | "google" | "kimi";

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
}

export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onUsage?: (usage: { tokensIn: number; tokensOut: number }) => void;
}

export interface StreamResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

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
async function streamKimi(req: StreamRequest, handlers: StreamHandlers): Promise<StreamResult> {
  const body = {
    model: req.modelId,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 2048,
    stream: true,
  };

  const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
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
    throw new Error(`Kimi API ${res.status}: ${errText.slice(0, 200)}`);
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

// ─── Public API ─────────────────────────────────────────────────────────────
export async function streamCompletion(
  req: StreamRequest,
  handlers: StreamHandlers = {}
): Promise<StreamResult> {
  if (!req.apiKey) {
    throw new Error(`Missing API key for provider "${req.provider}"`);
  }

  switch (req.provider) {
    case "anthropic": return streamAnthropic(req, handlers);
    case "openai":    return streamOpenAI(req, handlers);
    case "google":    return streamGoogle(req, handlers);
    case "kimi":      return streamKimi(req, handlers);
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
