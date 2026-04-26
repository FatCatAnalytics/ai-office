// Latest-models checker. Polls each provider's "list models" endpoint, upserts
// the registry via storage.upsertModel(), and tags first-time sightings so the
// UI can flag them. Runs daily via a setInterval scheduled from server/index.ts
// and on demand via POST /api/models/refresh.

import { storage } from "./storage";
import { settingKeyForProvider } from "./llm";
import type { InsertModel, Model } from "@shared/schema";

export type Provider = "anthropic" | "openai" | "google" | "kimi";

export interface RefreshSummary {
  ranAt: number;
  totals: Record<Provider, { discovered: number; updated: number; error?: string }>;
  models: Model[];
}

// Best-effort tier classification from model name. Operators can override per
// model via PATCH /api/models/:id once a new model is acknowledged.
export function classifyTier(modelId: string): "low" | "medium" | "high" {
  const id = modelId.toLowerCase();
  if (/(haiku|flash|mini|nano|small|moonshot-v1-(8k|32k))/.test(id)) return "low";
  if (/(sonnet|opus|gpt-4\.1(?!-mini)|gpt-5|gemini-2\.5-pro|2\.5-pro|o3|o4|moonshot-v1-128k|kimi-k2)/.test(id)) return "high";
  return "medium";
}

function displayNameFor(provider: Provider, modelId: string): string {
  return `${provider} · ${modelId}`;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 15_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Provider listers ──────────────────────────────────────────────────────
async function listAnthropic(apiKey: string): Promise<string[]> {
  const data = await fetchJson("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  return Array.isArray(data?.data) ? data.data.map((m: any) => m.id).filter(Boolean) : [];
}

async function listOpenAI(apiKey: string): Promise<string[]> {
  const data = await fetchJson("https://api.openai.com/v1/models", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const ids = Array.isArray(data?.data) ? data.data.map((m: any) => m.id).filter(Boolean) : [];
  // Filter to actual chat-capable families to keep registry focused.
  return ids.filter((id: string) => /^(gpt-|o[134])/.test(id));
}

async function listGoogle(apiKey: string): Promise<string[]> {
  const data = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`,
    {},
  );
  const ids = Array.isArray(data?.models)
    ? data.models.map((m: any) => String(m?.name || "").replace(/^models\//, "")).filter(Boolean)
    : [];
  return ids.filter((id: string) => id.startsWith("gemini-"));
}

async function listKimi(apiKey: string): Promise<string[]> {
  const data = await fetchJson("https://api.moonshot.cn/v1/models", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  return Array.isArray(data?.data) ? data.data.map((m: any) => m.id).filter(Boolean) : [];
}

const PROVIDER_LISTERS: Record<Provider, (apiKey: string) => Promise<string[]>> = {
  anthropic: listAnthropic,
  openai: listOpenAI,
  google: listGoogle,
  kimi: listKimi,
};

// ─── Refresh job ───────────────────────────────────────────────────────────
export async function refreshAllProviders(): Promise<RefreshSummary> {
  const providers: Provider[] = ["anthropic", "openai", "google", "kimi"];
  const totals: RefreshSummary["totals"] = {
    anthropic: { discovered: 0, updated: 0 },
    openai: { discovered: 0, updated: 0 },
    google: { discovered: 0, updated: 0 },
    kimi: { discovered: 0, updated: 0 },
  };

  const before = new Map(storage.getModels().map((m) => [m.id, m]));

  await Promise.all(
    providers.map(async (provider) => {
      const apiKey = storage.getSetting(settingKeyForProvider(provider));
      if (!apiKey) {
        totals[provider].error = "no api key configured";
        return;
      }
      try {
        const ids = await PROVIDER_LISTERS[provider](apiKey);
        for (const modelId of ids) {
          const id = `${provider}:${modelId}`;
          const wasKnown = before.has(id);
          const insert: InsertModel = {
            id,
            provider,
            modelId,
            displayName: displayNameFor(provider, modelId),
            tier: wasKnown ? before.get(id)!.tier : classifyTier(modelId),
            enabled: wasKnown ? before.get(id)!.enabled : 1,
            isNew: wasKnown ? before.get(id)!.isNew : 1,
            contextWindow: wasKnown ? before.get(id)!.contextWindow ?? null : null,
            costPer1kIn: wasKnown ? before.get(id)!.costPer1kIn ?? null : null,
            costPer1kOut: wasKnown ? before.get(id)!.costPer1kOut ?? null : null,
          };
          storage.upsertModel(insert);
          if (wasKnown) totals[provider].updated += 1;
          else totals[provider].discovered += 1;
        }
      } catch (err) {
        totals[provider].error = err instanceof Error ? err.message : String(err);
      }
    }),
  );

  return {
    ranAt: Date.now(),
    totals,
    models: storage.getModels(),
  };
}

// ─── Daily scheduler ───────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
let scheduled = false;

export function scheduleDailyModelRefresh(log: (msg: string) => void = () => {}) {
  if (scheduled) return;
  scheduled = true;

  // Run once at boot (after a short delay so the server is ready) and then daily.
  setTimeout(() => {
    refreshAllProviders()
      .then((s) => log(`models refresh complete · ${JSON.stringify(s.totals)}`))
      .catch((e) => log(`models refresh failed · ${e instanceof Error ? e.message : e}`));
  }, 30_000);

  setInterval(() => {
    refreshAllProviders()
      .then((s) => log(`models refresh (daily) complete · ${JSON.stringify(s.totals)}`))
      .catch((e) => log(`models refresh (daily) failed · ${e instanceof Error ? e.message : e}`));
  }, DAY_MS);
}
