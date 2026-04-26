// ─── Cost-aware model router ────────────────────────────────────────────────
// Stage 4.6. Routes a task to the cheapest model that meets its complexity tier.
//
// Complexity tiers (set by the planner per task):
//   low    → cheap & fast: Kimi Moonshot v1-32k. Formatting, extraction,
//            summarisation, simple transforms. ~10x cheaper than Sonnet.
//   medium → Anthropic Haiku 4-5. Most "normal" knowledge work.
//   high   → Anthropic Sonnet 4-6. Reasoning, code, analysis, planning.
//
// QA review and Manager planning always use Sonnet regardless of tier so
// accuracy is not traded away on the most consequential calls.
//
// The router checks for an API key for the preferred provider before returning
// it. If the key is missing it falls back through the chain so a user with
// only Anthropic configured still gets a working app.
// ─────────────────────────────────────────────────────────────────────────────

import { storage } from "./storage";
import { settingKeyForProvider, type Provider } from "./llm";
import type { Agent } from "@shared/schema";

export type Complexity = "low" | "medium" | "high";

export interface RoutedModel {
  provider: Provider;
  modelId: string;
  reason: string;
}

// Ordered preference per tier. First entry whose provider key is configured wins.
const TIER_PREFERENCES: Record<Complexity, RoutedModel[]> = {
  low: [
    { provider: "kimi",      modelId: "moonshot-v1-32k",   reason: "low-tier → Kimi (cheapest)" },
    { provider: "anthropic", modelId: "claude-haiku-4-5",  reason: "low-tier → Haiku (Kimi key missing)" },
    { provider: "openai",    modelId: "gpt-4.1-mini",      reason: "low-tier → gpt-4.1-mini fallback" },
    { provider: "google",    modelId: "gemini-2.5-flash",  reason: "low-tier → Gemini Flash fallback" },
  ],
  medium: [
    { provider: "anthropic", modelId: "claude-haiku-4-5",  reason: "medium-tier → Haiku" },
    { provider: "openai",    modelId: "gpt-4.1-mini",      reason: "medium-tier → gpt-4.1-mini" },
    { provider: "kimi",      modelId: "moonshot-v1-128k",  reason: "medium-tier → Kimi 128k fallback" },
    { provider: "google",    modelId: "gemini-2.5-flash",  reason: "medium-tier → Gemini Flash fallback" },
  ],
  high: [
    { provider: "anthropic", modelId: "claude-sonnet-4-6", reason: "high-tier → Sonnet" },
    { provider: "openai",    modelId: "gpt-4.1",           reason: "high-tier → gpt-4.1 fallback" },
    { provider: "google",    modelId: "gemini-2.5-pro",    reason: "high-tier → Gemini Pro fallback" },
  ],
};

function hasKey(provider: Provider): boolean {
  return Boolean(storage.getSetting(settingKeyForProvider(provider)));
}

// Pick a model based on complexity. Falls through providers if the preferred
// key isn't configured. Returns the agent's own model as a last resort so a
// configured agent always has *something* to call.
export function routeForComplexity(complexity: Complexity, fallbackAgent: Agent): RoutedModel {
  const prefs = TIER_PREFERENCES[complexity] ?? TIER_PREFERENCES.medium;
  for (const pick of prefs) {
    if (hasKey(pick.provider)) return pick;
  }
  return {
    provider: (fallbackAgent.provider as Provider) ?? "anthropic",
    modelId: fallbackAgent.modelId,
    reason: `no preferred provider keys configured — using agent default ${fallbackAgent.modelId}`,
  };
}

// Manager planning + QA review always go to a high-tier model (Sonnet first).
// The fallbackAgent.provider key is honored if everything else is missing.
export function routeForCriticalCall(fallbackAgent: Agent): RoutedModel {
  return routeForComplexity("high", fallbackAgent);
}

// Map a free-form complexity hint from the planner to the canonical tier.
export function normaliseComplexity(raw: unknown): Complexity {
  const v = String(raw ?? "").toLowerCase().trim();
  if (v === "low" || v === "simple" || v === "trivial" || v === "easy") return "low";
  if (v === "high" || v === "hard" || v === "complex" || v === "difficult") return "high";
  return "medium";
}
