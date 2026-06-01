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
import { resolveProviderKey, type Provider } from "./llm";
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
  // Stage 6.13: Perplexity Sonar sits immediately after Anthropic in every
  // tier as the preferred backup (the PERPLEXITY_API_KEY is already wired for
  // the research connector), with OpenAI next after that. High-tier uses
  // sonar-reasoning-pro (advanced multi-step CoT reasoning); medium/low use
  // sonar-pro (faster, no reasoning-token overhead).
  low: [
    { provider: "deepseek",  modelId: "deepseek-v4-flash", reason: "low-tier → DeepSeek V4-Flash (cheapest)" },
    { provider: "kimi",      modelId: "moonshot-v1-32k",   reason: "low-tier → Kimi fallback (DeepSeek key missing)" },
    { provider: "anthropic", modelId: "claude-haiku-4-5",  reason: "low-tier → Haiku fallback" },
    { provider: "perplexity",modelId: "sonar-pro",         reason: "low-tier → Perplexity Sonar Pro fallback" },
    { provider: "openai",    modelId: "gpt-4.1-mini",      reason: "low-tier → gpt-4.1-mini fallback" },
    { provider: "google",    modelId: "gemini-2.5-flash",  reason: "low-tier → Gemini Flash fallback" },
  ],
  medium: [
    { provider: "anthropic", modelId: "claude-haiku-4-5",  reason: "medium-tier → Haiku" },
    { provider: "perplexity",modelId: "sonar-pro",         reason: "medium-tier → Perplexity Sonar Pro fallback" },
    { provider: "openai",    modelId: "gpt-4.1-mini",      reason: "medium-tier → gpt-4.1-mini" },
    { provider: "deepseek",  modelId: "deepseek-v4-flash", reason: "medium-tier → DeepSeek V4-Flash fallback" },
    { provider: "kimi",      modelId: "moonshot-v1-128k",  reason: "medium-tier → Kimi 128k fallback" },
    { provider: "google",    modelId: "gemini-2.5-flash",  reason: "medium-tier → Gemini Flash fallback" },
  ],
  // Frontier reasoning. Used for the Manager (planning + delegation), the QA
  // sign-off agent, and any task the planner tags as high complexity.
  high: [
    { provider: "anthropic", modelId: "claude-opus-4-7",   reason: "high-tier → Opus (frontier reasoning)" },
    { provider: "perplexity",modelId: "sonar-reasoning-pro",reason: "high-tier → Perplexity Sonar Reasoning Pro fallback" },
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
  // Env-aware: a key saved in settings OR present as the conventional env var
  // (e.g. PERPLEXITY_API_KEY) counts. This keeps the fallback chain in sync
  // with how keys are actually configured.
  return Boolean(resolveProviderKey(provider, (k) => storage.getSetting(k)));
}

// Stage 5.x.26 — operator-driven failover layer. COMPLEMENTS the Stage 6.11
// quota-aware callWithFallback walk: instead of waiting for a runtime
// quota/credit error, the chain builder below proactively (a) prepends any
// substitute the operator picked in the FailoverModal and (b) skips any
// provider currently flagged unusable (monthly cap exhausted OR forceFailover
// bit set by the modal). The existing auto-failover walk still runs on top of
// this filtered chain, so the two layers stack: operator pick first, then
// hardcoded tier preferences, with dead providers pruned from both.

// Walk every provider_balances row that is currently flagged unusable (cap
// exhausted OR forceFailover set by the modal) and collect their fallback
// chains, in row-update order. Each entry is a canonical "provider:modelId"
// tag. Returns parsed { provider, modelId } pairs filtered to providers we
// know how to call. Step 0 of routeForComplexityChain so the operator's
// substitute selection actually wins.
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

// Report whether a provider is currently unusable. Reads the provider_balances
// row directly so the router doesn't pull in the orchestrator's deps. Treats
// both monthly-cap exhaustion and operator-set forceFailover as unusable.
export function isProviderUnusable(provider: Provider): boolean {
  try {
    const row = storage.getProviderBalance(`${provider}:*`);
    if (!row) return false;
    if (row.capUsd > 0 && row.usedUsd >= row.capUsd) return true;
    if (row.forceFailover) return true;
  } catch { /* row missing — treat as usable */ }
  return false;
}

// Pick a model based on complexity. Resolution order:
//   1. Operator's pinned default for the tier (preferredFor === complexity).
//   2. Any other pool member for the tier (operator-enabled multi-select).
//   3. Hardcoded TIER_PREFERENCES fall-through (first provider with a key).
//   4. The agent's own modelId.
export function routeForComplexity(complexity: Complexity, fallbackAgent: Agent): RoutedModel {
  const chain = routeForComplexityChain(complexity, fallbackAgent);
  return chain[0];
}

// Stage 6.11 — fit-for-purpose routing with explicit fallback chain.
//
// Same resolution order as routeForComplexity, but returns EVERY candidate
// the caller could try, in priority order, with duplicate (provider+modelId)
// entries de-duplicated. The orchestrator's callWithFallback wrapper walks
// this list when a call fails with a quota/credits/auth-style error, so
// agents pick the cheapest fit-for-purpose model first and only escalate to
// a more expensive backup when the cheaper one is actually unavailable.
//
// Each entry's `reason` carries the resolution stage so the activity feed
// shows WHY a particular model was chosen on the wire (operator default vs
// pool member vs hardcoded preference vs agent-default last-resort).
export function routeForComplexityChain(
  complexity: Complexity,
  fallbackAgent: Agent,
): RoutedModel[] {
  const out: RoutedModel[] = [];
  const seen = new Set<string>(); // provider:modelId
  const push = (entry: RoutedModel) => {
    const key = `${entry.provider}:${entry.modelId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  // Stage 5.x.26 — usable === has a key AND not currently flagged unusable
  // (cap exhausted or operator forceFailover). Steps 0–3 prune dead providers
  // up front so the operator-picked substitute and the live tier preferences
  // both skip a provider the FailoverModal just took out of rotation.
  const usable = (provider: Provider): boolean => hasKey(provider) && !isProviderUnusable(provider);

  // 0. Operator-set fallback chain (Stage 5.x.26). Any substitute the operator
  //    picked in the FailoverModal is recorded on the capped provider's row;
  //    surface it at the head of the chain so callWithFallback tries it first.
  for (const cand of operatorChainCandidates()) {
    if (usable(cand.provider)) {
      push({
        provider: cand.provider,
        modelId: cand.modelId,
        reason: `${complexity}-tier → operator failover substitute (${cand.modelId} via ${cand.sourceProvider} chain)`,
      });
    }
  }

  // 1. Operator-pinned DEFAULT for the tier.
  try {
    const pinned = storage.getPreferredModelForTier(complexity);
    if (pinned && usable(pinned.provider as Provider)) {
      push({
        provider: pinned.provider as Provider,
        modelId: pinned.modelId,
        reason: `${complexity}-tier → operator default (${pinned.displayName || pinned.modelId})`,
      });
    }
  } catch { /* registry not yet migrated; fall through */ }

  // 2. Any other model the operator added to this tier's pool.
  try {
    const pool = storage.getPoolModelsForTier(complexity);
    for (const m of pool) {
      if (usable(m.provider as Provider)) {
        push({
          provider: m.provider as Provider,
          modelId: m.modelId,
          reason: `${complexity}-tier → pool member (${m.displayName || m.modelId})`,
        });
      }
    }
  } catch { /* migration race; fall through */ }

  // 3. Hardcoded preference chain — every preference whose provider key is
  //    configured AND not flagged unusable. This is the bulk of the fallback
  //    chain in practice: the operator typically pins one model and the rest
  //    of the chain comes from these hardcoded sensible defaults.
  const prefs = TIER_PREFERENCES[complexity] ?? TIER_PREFERENCES.medium;
  for (const pick of prefs) {
    if (usable(pick.provider)) push(pick);
  }

  // 4. Agent default — last resort. Always present so a configured agent
  //    always has *something* to call, even if every other lookup fails (the
  //    orchestrator's pre-call check surfaces the FailoverModal before this
  //    last-resort entry actually spends on an unusable provider).
  push({
    provider: (fallbackAgent.provider as Provider) ?? "anthropic",
    modelId: fallbackAgent.modelId,
    reason: `${complexity}-tier → agent default ${fallbackAgent.modelId} (last resort)`,
  });

  return out;
}

// Manager planning + QA review always go to a high-tier model (Sonnet first).
// The fallbackAgent.provider key is honored if everything else is missing.
export function routeForCriticalCall(fallbackAgent: Agent): RoutedModel {
  return routeForComplexity("high", fallbackAgent);
}

// Stage 6.11 — chain variant of routeForCriticalCall. Used by the
// orchestrator's manager-planning + QA-review paths to walk the high-tier
// fallback list on quota errors.
export function routeForCriticalCallChain(fallbackAgent: Agent): RoutedModel[] {
  return routeForComplexityChain("high", fallbackAgent);
}

// Stage 6.11 — classify an LLM error as "should we walk the fallback
// chain?" or "fail clean". The orchestrator's runWorkerTask / callManagerLLM
// catch the streamCompletion rejection and ask this predicate whether
// retrying with the next chain entry is appropriate.
//
// We TRY the next model when:
//   • status is 429 / 402 / 401 / 403 (rate-limit, payment-required,
//     unauthorised, forbidden — the provider is refusing the call for
//     account-level reasons, NOT for our prompt content).
//   • the error message mentions credits / quota / billing / not enough
//     funds / insufficient balance / payment required.
//   • the error message mentions model-not-found / unsupported model —
//     the configured model id is wrong for that provider but the next
//     provider's model id will likely work.
//
// We DO NOT walk the chain on:
//   • AbortError (operator pressed Stop).
//   • 4xx other than the codes above (probably a malformed request —
//     trying again with a different provider will just fail the same way).
//   • Transient errors (5xx / network); streamCompletion already retries
//     those internally via fetchWithRetry. By the time we see the
//     exception, the call has exhausted its in-provider retries.
export function isQuotaOrCreditError(err: unknown): boolean {
  if (err == null) return false;
  const e = err as { name?: string; message?: string };
  if (e?.name === "AbortError") return false;
  const msg = String(e?.message ?? err).toLowerCase();
  // HTTP status patterns surfaced by the provider edges (Anthropic / OpenAI
  // / Google / Kimi / DeepSeek format the status as `<Provider> API <status>`).
  if (/\bapi\s+(429|402|401|403)\b/.test(msg)) return true;
  // Phrase patterns — covers the natural-language explanations providers
  // bundle in the response body when status is generic 4xx/5xx.
  const phrases = [
    "rate limit",
    "rate-limit",
    "quota",
    "credits",
    "billing",
    "insufficient balance",
    "insufficient_quota",
    "payment required",
    "out of credit",
    "exceeded your current quota",
    "model not found",
    "model_not_found",
    "unsupported model",
    "no credit",
    "no credits",
    // Account-level usage caps. Anthropic surfaces these as a 400
    // invalid_request_error whose message reads "You have reached your
    // specified API usage limits. You will regain access on <date>."
    // The 400 status is otherwise treated as a clean-fail, so we match the
    // wording explicitly to walk the fallback chain to another provider.
    "usage limit",
    "usage limits",
    "usage_limit",
    "reached your specified api usage",
    "regain access on",
    "spending limit",
    "spend limit",
  ];
  for (const p of phrases) {
    if (msg.includes(p)) return true;
  }
  return false;
}

// Map a free-form complexity hint from the planner to the canonical tier.
export function normaliseComplexity(raw: unknown): Complexity {
  const v = String(raw ?? "").toLowerCase().trim();
  if (v === "low" || v === "simple" || v === "trivial" || v === "easy") return "low";
  if (v === "high" || v === "hard" || v === "complex" || v === "difficult") return "high";
  return "medium";
}
