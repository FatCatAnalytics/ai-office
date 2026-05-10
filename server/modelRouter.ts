// ─── Cost-aware model router ────────────────────────────────────────────────
// Stage 4.6. Routes a task to the cheapest model that meets its complexity tier.
//
// Complexity tiers (set by the planner per task):
//   low    → cheap & fast: DeepSeek V4-Flash (Stage 4.20 — cheapest credible
//            production model, $0.14/$0.28 per 1M tokens). Formatting,
//            extraction, summarisation, simple transforms.
//   medium → Anthropic Haiku 4-5. Most "normal" knowledge work.
//   high   → Frontier reasoning model: Opus → GPT-5.5 → Sonnet → Gemini 3 Pro
//            → DeepSeek V4-Pro. Used for code, analysis, AND for Manager
//            planning + QA sign-off.
//
// Resolution order for every routing call (Stage 4.9):
//   1. Operator-pinned DEFAULT for the tier (preferredFor === tier && enabled).
//   2. Any other model enrolled in the tier pool (multi-select per tier).
//   3. Hardcoded preference chain below — first provider with a configured key.
//   4. The agent's own modelId as a last resort so a configured agent always
//      has *something* to call.
// QA review and Manager planning always go through the high-tier path.
// ─────────────────────────────────────────────────────────────────────────────

import { storage } from "./storage";
import { settingKeyForProvider, type Provider } from "./llm";
import { isProviderOverCap } from "./providerBalances";
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
  // Stage 4.20: DeepSeek V4-Flash sits at the top of the low-tier chain. At
  // $0.14 / $0.28 per 1M tokens it's the cheapest credible production model
  // we support — roughly 6× cheaper than Kimi Moonshot v1-32k while still
  // supporting tool calling and a 1M context window. Existing pinned-model
  // agents are unaffected; this only changes the dynamic routing default.
  low: [
    { provider: "deepseek",  modelId: "deepseek-v4-flash", reason: "low-tier → DeepSeek V4-Flash (cheapest)" },
    { provider: "kimi",      modelId: "moonshot-v1-32k",   reason: "low-tier → Kimi fallback (DeepSeek key missing)" },
    { provider: "anthropic", modelId: "claude-haiku-4-5",  reason: "low-tier → Haiku fallback" },
    { provider: "openai",    modelId: "gpt-4.1-mini",      reason: "low-tier → gpt-4.1-mini fallback" },
    { provider: "google",    modelId: "gemini-2.5-flash",  reason: "low-tier → Gemini Flash fallback" },
  ],
  medium: [
    { provider: "anthropic", modelId: "claude-haiku-4-5",  reason: "medium-tier → Haiku" },
    { provider: "openai",    modelId: "gpt-4.1-mini",      reason: "medium-tier → gpt-4.1-mini" },
    { provider: "deepseek",  modelId: "deepseek-v4-flash", reason: "medium-tier → DeepSeek V4-Flash fallback" },
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
    { provider: "deepseek",  modelId: "deepseek-v4-pro",   reason: "high-tier → DeepSeek V4-Pro fallback" },
    { provider: "openai",    modelId: "gpt-4.1",           reason: "high-tier → gpt-4.1 fallback" },
  ],
};

function hasKey(provider: Provider): boolean {
  return Boolean(storage.getSetting(settingKeyForProvider(provider)));
}

// Stage 5.x.26: walk every provider_balances row that is currently flagged
// unusable (cap exhausted OR forceFailover set by the failover modal) and
// collect their fallback chains, in row-update order. Each entry is a
// canonical "provider:modelId" tag. Returns parsed { provider, modelId }
// pairs filtered to the providers we know how to call. Used as Step 0 of
// every routing call so the operator's substitute selection actually wins.
function operatorChainCandidates(): Array<{ provider: Provider; modelId: string; sourceProvider: Provider }> {
  const candidates: Array<{ provider: Provider; modelId: string; sourceProvider: Provider }> = [];
  let rows;
  try { rows = storage.getProviderBalances(); } catch { return candidates; }
  for (const row of rows) {
    const overCap = row.capUsd > 0 && row.usedUsd >= row.capUsd;
    const forceFailover = Boolean(row.forceFailover);
    if (!overCap && !forceFailover) continue;
    let chain: string[] = [];
    try {
      const parsed = JSON.parse(row.fallbackChain);
      if (Array.isArray(parsed)) chain = parsed.filter((x): x is string => typeof x === "string");
    } catch { /* skip unparseable chain */ }
    for (const tag of chain) {
      const idx = tag.indexOf(":");
      if (idx <= 0) continue;
      const provider = tag.slice(0, idx) as Provider;
      const modelId = tag.slice(idx + 1);
      if (!modelId || modelId === "*") continue;
      // Don't propose the same provider that's marked unusable — the chain
      // exists exactly to escape it.
      if (provider === row.provider) continue;
      candidates.push({ provider, modelId, sourceProvider: row.provider as Provider });
    }
  }
  return candidates;
}

// Stage 5.x.26: report whether a provider is currently unusable. Mirrors
// providerBalances.isProviderOverCap but read directly from the row so the
// router doesn't pull in the orchestrator's deps. Treat both overCap and
// operator-set forceFailover as unusable.
function isProviderUnusable(provider: Provider): boolean {
  try {
    const row = storage.getProviderBalance(`${provider}:*`);
    if (!row) return false;
    if (row.capUsd > 0 && row.usedUsd >= row.capUsd) return true;
    if (row.forceFailover) return true;
  } catch { /* row missing — treat as usable */ }
  return false;
}

// Pick a model based on complexity. Resolution order:
//   0. (Stage 5.x.26) Operator-set fallback chain on any unusable provider —
//      so a substitute picked in the FailoverModal actually wins on the next
//      worker pickup, instead of being silently overruled by the pinned
//      default that's still pointing at the dead provider.
//   1. Operator's pinned default for the tier (preferredFor === complexity).
//   2. Any other pool member for the tier (operator-enabled multi-select).
//   3. Hardcoded TIER_PREFERENCES fall-through (first provider with a key).
//   4. The agent's own modelId.
// Each step skips providers that are currently unusable (cap exhausted OR
// forceFailover set by the modal). The agent default fallback at the end is
// honoured even when unusable as a last-ditch "something is better than
// nothing" — the orchestrator's per-call cap check catches that case and
// re-routes via routeWithFailover before actually spending.
export function routeForComplexity(complexity: Complexity, fallbackAgent: Agent): RoutedModel {
  // 0. Operator-set fallback chain (Stage 5.x.26). Walk every chain entry,
  //    in declared order, and use the first one whose provider has a key
  //    AND isn't itself unusable. This is the path that honours a substitute
  //    picked in the FailoverModal.
  for (const cand of operatorChainCandidates()) {
    if (hasKey(cand.provider) && !isProviderUnusable(cand.provider)) {
      return {
        provider: cand.provider,
        modelId: cand.modelId,
        reason: `${complexity}-tier → operator failover substitute (${cand.modelId} via ${cand.sourceProvider} chain)`,
      };
    }
  }

  // 1. Operator-pinned DEFAULT for the tier — BUT only if its provider isn't
  //    currently unusable. Without this skip, a pinned Anthropic default
  //    would defeat the operator's substitute every time on the resume path.
  try {
    const pinned = storage.getPreferredModelForTier(complexity);
    if (pinned && hasKey(pinned.provider as Provider) && !isProviderUnusable(pinned.provider as Provider)) {
      return {
        provider: pinned.provider as Provider,
        modelId: pinned.modelId,
        reason: `${complexity}-tier → operator default (${pinned.displayName || pinned.modelId})`,
      };
    }
  } catch { /* registry not yet migrated; fall through */ }

  // 2. Any other model the operator added to this tier's pool. Picking the
  //    first one with a configured provider key keeps things deterministic for
  //    a given key set, while still letting operators stage multiple choices.
  try {
    const pool = storage.getPoolModelsForTier(complexity);
    for (const m of pool) {
      if (hasKey(m.provider as Provider) && !isProviderUnusable(m.provider as Provider)) {
        return {
          provider: m.provider as Provider,
          modelId: m.modelId,
          reason: `${complexity}-tier → pool member (${m.displayName || m.modelId})`,
        };
      }
    }
  } catch { /* migration race; fall through */ }

  // 3. Hardcoded preference chain — also skip unusable providers.
  const prefs = TIER_PREFERENCES[complexity] ?? TIER_PREFERENCES.medium;
  for (const pick of prefs) {
    if (hasKey(pick.provider) && !isProviderUnusable(pick.provider)) return pick;
  }

  // 4. Agent default — honoured even if unusable so the orchestrator's
  //    cap-check path can detect the situation and surface the modal again.
  //    Without a final answer here, callers would crash on null and we'd
  //    lose the operator's chance to pick another substitute.
  return {
    provider: (fallbackAgent.provider as Provider) ?? "anthropic",
    modelId: fallbackAgent.modelId,
    reason: `no usable provider keys configured — using agent default ${fallbackAgent.modelId}`,
  };
}

// Manager planning + QA review always go to a high-tier model (Sonnet first).
// The fallbackAgent.provider key is honored if everything else is missing.
export function routeForCriticalCall(fallbackAgent: Agent): RoutedModel {
  return routeForComplexity("high", fallbackAgent);
}

// Stage 5.x.12: routing variant that knows about provider caps. Same
// resolution order as routeForComplexity, but every step skips:
//   • providers whose monthly cap is exhausted (per provider_balances.usedUsd
//     >= provider_balances.capUsd, when capUsd > 0), AND
//   • any model id explicitly listed in `excluded` (used by the orchestrator
//     after a runtime credit-exhaust error so we don't immediately re-route
//     back to the same dead model).
// The third resolution layer (TIER_PREFERENCES) ALWAYS gets a chance even when
// the operator's pinned default is excluded — the whole point of a fallback
// chain is to keep the project moving.
export function routeWithFailover(
  complexity: Complexity,
  fallbackAgent: Agent,
  excluded: Set<string> = new Set(),
): RoutedModel | null {
  const isUsable = (provider: Provider, modelId: string): boolean => {
    if (!hasKey(provider)) return false;
    if (excluded.has(`${provider}:${modelId}`)) return false;
    if (excluded.has(`${provider}:*`)) return false;
    try {
      // Stage 5.x.26: routing-time "unusable" covers both monthly-cap
      // exhaustion AND operator-set forceFailover from the modal.
      if (isProviderOverCap(provider).unusable) return false;
    } catch { /* balance row not yet seeded — treat as not-over-cap */ }
    return true;
  };

  // 0. Operator-set fallback chain (Stage 5.x.26). Same idea as in
  //    routeForComplexity: a substitute picked in the modal must win.
  //    `excluded` from the caller still applies (so the empty/garbled-output
  //    retry can still hop off the chain target if it itself misbehaved).
  for (const cand of operatorChainCandidates()) {
    if (isUsable(cand.provider, cand.modelId)) {
      return {
        provider: cand.provider,
        modelId: cand.modelId,
        reason: `${complexity}-tier → operator failover substitute (${cand.modelId} via ${cand.sourceProvider} chain) (failover-aware)`,
      };
    }
  }

  // 1. Operator-pinned default for the tier.
  try {
    const pinned = storage.getPreferredModelForTier(complexity);
    if (pinned && isUsable(pinned.provider as Provider, pinned.modelId)) {
      return {
        provider: pinned.provider as Provider,
        modelId: pinned.modelId,
        reason: `${complexity}-tier → operator default w/ budget (${pinned.displayName || pinned.modelId})`,
      };
    }
  } catch { /* registry not yet migrated; fall through */ }

  // 2. Pool members for the tier.
  try {
    const pool = storage.getPoolModelsForTier(complexity);
    for (const m of pool) {
      if (isUsable(m.provider as Provider, m.modelId)) {
        return {
          provider: m.provider as Provider,
          modelId: m.modelId,
          reason: `${complexity}-tier → pool member w/ budget (${m.displayName || m.modelId})`,
        };
      }
    }
  } catch { /* migration race; fall through */ }

  // 3. Hardcoded fallback chain.
  const prefs = TIER_PREFERENCES[complexity] ?? TIER_PREFERENCES.medium;
  for (const pick of prefs) {
    if (isUsable(pick.provider, pick.modelId)) {
      return { ...pick, reason: `${pick.reason} (failover-aware)` };
    }
  }

  // 4. Agent default — only if we haven't excluded it.
  const agentProvider = (fallbackAgent.provider as Provider) ?? "anthropic";
  if (isUsable(agentProvider, fallbackAgent.modelId)) {
    return {
      provider: agentProvider,
      modelId: fallbackAgent.modelId,
      reason: `failover → agent default ${fallbackAgent.modelId}`,
    };
  }

  // 5. Truly nothing left. Caller must pause the project / surface the modal.
  return null;
}

// Map a free-form complexity hint from the planner to the canonical tier.
export function normaliseComplexity(raw: unknown): Complexity {
  const v = String(raw ?? "").toLowerCase().trim();
  if (v === "low" || v === "simple" || v === "trivial" || v === "easy") return "low";
  if (v === "high" || v === "hard" || v === "complex" || v === "difficult") return "high";
  return "medium";
}
