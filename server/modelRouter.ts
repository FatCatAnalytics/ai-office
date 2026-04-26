// ─── Cost-aware model router ────────────────────────────────────────────────
// Stage 4.6. Routes a task to the cheapest model that meets its complexity tier.
//
// Complexity tiers (set by the planner per task):
//   low    → cheap & fast: Kimi Moonshot v1-32k. Formatting, extraction,
//            summarisation, simple transforms. ~10x cheaper than Sonnet.
//   medium → Anthropic Haiku 4-5. Most "normal" knowledge work.
//   high   → Frontier reasoning model: Opus → GPT-5.5 → Sonnet → Gemini 3 Pro.
//            Used for code, analysis, AND for Manager planning + QA sign-off.
//
// Resolution order for every routing call:
//   1. Operator pin in the models registry (preferredFor === tier && enabled).
//   2. Hardcoded preference chain below — first provider with a configured key.
//   3. The agent's own modelId as a last resort so a configured agent always
//      has *something* to call.
// QA review and Manager planning always go through the high-tier path.
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
// Operator can override per tier via Settings → Models registry → Pin for tier.
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
  // Frontier reasoning. Used for the Manager (planning + delegation), the QA
  // sign-off agent, and any task the planner tags as high complexity.
  high: [
    { provider: "anthropic", modelId: "claude-opus-4-7",   reason: "high-tier → Opus (frontier reasoning)" },
    { provider: "openai",    modelId: "gpt-5.5",           reason: "high-tier → GPT-5.5 fallback" },
    { provider: "openai",    modelId: "gpt-5",             reason: "high-tier → GPT-5 fallback" },
    { provider: "anthropic", modelId: "claude-sonnet-4-6", reason: "high-tier → Sonnet fallback" },
    { provider: "google",    modelId: "gemini-3-pro",      reason: "high-tier → Gemini 3 Pro fallback" },
    { provider: "google",    modelId: "gemini-2.5-pro",    reason: "high-tier → Gemini 2.5 Pro fallback" },
    { provider: "openai",    modelId: "gpt-4.1",           reason: "high-tier → gpt-4.1 fallback" },
  ],
};

function hasKey(provider: Provider): boolean {
  return Boolean(storage.getSetting(settingKeyForProvider(provider)));
}

// Pick a model based on complexity. Resolution order:
//   1. Operator pin in the models registry (preferredFor === complexity).
//   2. Hardcoded TIER_PREFERENCES fall-through (first provider with a key).
//   3. The agent's own modelId.
export function routeForComplexity(complexity: Complexity, fallbackAgent: Agent): RoutedModel {
  // 1. Operator pin from the registry takes precedence so newly-released models
  //    (Opus 4-7, GPT-5.5, Gemini 3 Pro, kimi-k2.6…) can be promoted from the UI
  //    without a code change.
  try {
    const pinned = storage.getPreferredModelForTier(complexity);
    if (pinned && hasKey(pinned.provider as Provider)) {
      return {
        provider: pinned.provider as Provider,
        modelId: pinned.modelId,
        reason: `${complexity}-tier → operator pin (${pinned.displayName || pinned.modelId})`,
      };
    }
  } catch { /* registry not yet migrated; fall through */ }

  // 2. Hardcoded preference chain.
  const prefs = TIER_PREFERENCES[complexity] ?? TIER_PREFERENCES.medium;
  for (const pick of prefs) {
    if (hasKey(pick.provider)) return pick;
  }

  // 3. Agent default.
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
