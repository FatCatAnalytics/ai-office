// Stage 6.11 — model router + fallback chain tests.
//
// Run as `tsx script/test-model-router.ts`. Exits non-zero on first failure.
// Deterministic — uses an isolated in-memory sqlite via the same storage
// module the prod code uses; we only write to settings keys and read them
// back, which has no cross-test fallout.
//
// Covers the contract that:
//   - The cheapest fit-for-purpose model is picked per tier (low → DeepSeek
//     flash / Haiku / Gemini-flash class; medium → Haiku class; high →
//     Opus class) when its provider key is configured.
//   - Operator-pinned default wins over the hardcoded preferences.
//   - The fallback chain skips entries with no key, dedupes duplicates,
//     and ends with the agent's own modelId so a configured agent always
//     has *something* to call.
//   - isQuotaOrCreditError distinguishes "walk the fallback chain" from
//     "fail fast" (AbortError, malformed request, transient 5xx).
//   - Critical-call routing (Manager planning, QA sign-off) always lands
//     on the high tier regardless of the fallback agent's tier.

import {
  routeForComplexity,
  routeForComplexityChain,
  routeForCriticalCall,
  routeForCriticalCallChain,
  isQuotaOrCreditError,
  normaliseComplexity,
} from "../server/modelRouter";
import { storage } from "../server/storage";
import { settingKeyForProvider } from "../server/llm";
import type { Agent } from "@shared/schema";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function eq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }
function truthy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: true }); }
function falsy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: false }); }

// Stash original setting values so the test leaves the db clean.
const PROVIDERS = ["anthropic", "openai", "google", "kimi", "deepseek"] as const;
type ProviderKey = typeof PROVIDERS[number];

const original = new Map<string, string | undefined>();
function setKey(provider: ProviderKey, value: string | undefined) {
  const key = settingKeyForProvider(provider);
  if (!original.has(key)) original.set(key, storage.getSetting(key) ?? undefined);
  if (value === undefined) {
    // No deleteSetting in the storage API — overwrite with empty string. The
    // router's hasKey() check uses Boolean(), so "" is treated as missing.
    storage.setSetting(key, "");
  } else {
    storage.setSetting(key, value);
  }
}
function restoreKeys() {
  for (const [k, v] of original.entries()) {
    storage.setSetting(k, v ?? "");
  }
}

// Standard test agent — provider+modelId here are the LAST-RESORT entry
// in any returned chain (the "agent default" fallback).
const agent: Agent = {
  id: "test-editor",
  name: "Test Editor",
  role: "editor",
  systemPrompt: "test",
  capabilities: "[]",
  provider: "anthropic",
  modelId: "claude-sonnet-4-6",
  status: "idle",
  currentTaskId: null,
  zone: null,
  x: null,
  y: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
} as Agent;

// ── 1) Tier-based fit-for-purpose selection ───────────────────────────────

// Wipe every provider key, then turn them on one at a time so the
// hardcoded preference chain is observable.
for (const p of PROVIDERS) setKey(p, undefined);

// With NO keys: routeForComplexity falls all the way through to the agent
// default. The chain still includes the agent default as last resort.
const lowNoKeys = routeForComplexity("low", agent);
eq(
  "low-tier with no keys falls back to agent default",
  { provider: lowNoKeys.provider, modelId: lowNoKeys.modelId },
  { provider: "anthropic", modelId: "claude-sonnet-4-6" },
);

// Turn on DeepSeek only → low tier should pick DeepSeek V4-Flash (cheapest).
setKey("deepseek", "test-key");
eq(
  "low-tier picks DeepSeek V4-Flash when only DeepSeek has a key",
  routeForComplexity("low", agent).modelId,
  "deepseek-v4-flash",
);

// Add OpenAI → low tier still prefers DeepSeek (higher in the chain).
setKey("openai", "test-key");
eq(
  "low-tier still prefers DeepSeek over OpenAI when both have keys",
  routeForComplexity("low", agent).modelId,
  "deepseek-v4-flash",
);

// Wipe DeepSeek → low tier should fall to the next configured entry. The
// hardcoded chain order is deepseek → kimi → anthropic → openai → google,
// so with only OpenAI configured low-tier lands on gpt-4.1-mini.
setKey("deepseek", undefined);
setKey("openai", "test-key");
eq(
  "low-tier without DeepSeek and only OpenAI lands on gpt-4.1-mini",
  routeForComplexity("low", agent).modelId,
  "gpt-4.1-mini",
);

// Medium tier prefers Haiku.
for (const p of PROVIDERS) setKey(p, undefined);
setKey("anthropic", "test-key");
eq(
  "medium-tier prefers Anthropic Haiku when only Anthropic has a key",
  routeForComplexity("medium", agent).modelId,
  "claude-haiku-4-5",
);

// High tier prefers Opus.
setKey("anthropic", "test-key");
eq(
  "high-tier prefers Claude Opus when Anthropic has a key",
  routeForComplexity("high", agent).modelId,
  "claude-opus-4-7",
);

// Critical-call routing is always high tier.
eq(
  "routeForCriticalCall always routes to high tier",
  routeForCriticalCall(agent).modelId,
  "claude-opus-4-7",
);

// ── 2) Fallback chain shape ──────────────────────────────────────────────

// With all five providers configured, the high-tier chain should expose
// every entry from TIER_PREFERENCES.high whose provider has a key (plus
// the agent default as last resort).
for (const p of PROVIDERS) setKey(p, "test-key");
const highChain = routeForComplexityChain("high", agent);
truthy("high-tier chain has more than one entry when all keys configured",
  highChain.length > 1);
eq("high-tier chain starts with Opus", highChain[0].modelId, "claude-opus-4-7");
truthy(
  "high-tier chain contains GPT-5.5 as a secondary",
  highChain.some(e => e.modelId === "gpt-5.5"),
);
truthy(
  "high-tier chain contains Sonnet as a tertiary",
  highChain.some(e => e.modelId === "claude-sonnet-4-6"),
);
// The agent default IS appended to the chain, but if its provider+modelId
// duplicates a hardcoded entry (here Sonnet is already in the high-tier
// preference chain), dedup keeps the earlier reason. The important
// guarantee is that the chain never crashes for any agent — there is
// always at least one entry on the agent's own provider+modelId path,
// either as a preference entry or as the appended last-resort.
truthy(
  "high-tier chain contains the agent's provider+modelId at least once",
  highChain.some(e => e.provider === "anthropic" && e.modelId === "claude-sonnet-4-6"),
);

// Chain dedupes by provider+modelId. The hardcoded preference list ALREADY
// contains claude-sonnet-4-6 (high-tier fallback). Even though the agent
// default would push it again, the chain should only contain it once.
const sonnetEntries = highChain.filter(e => e.modelId === "claude-sonnet-4-6");
eq("high-tier chain does not duplicate claude-sonnet-4-6", sonnetEntries.length, 1);

// Critical-call chain is identical to the high-tier chain.
const criticalChain = routeForCriticalCallChain(agent);
eq(
  "routeForCriticalCallChain returns the high-tier chain",
  criticalChain.map(e => e.modelId),
  highChain.map(e => e.modelId),
);

// Chain DROPS entries whose provider has no key (except the agent default
// last-resort).
for (const p of PROVIDERS) setKey(p, undefined);
setKey("anthropic", "test-key");
const onlyAnthChain = routeForComplexityChain("high", agent);
const providersInChain = onlyAnthChain.map(e => e.provider);
truthy(
  "high-tier chain with only Anthropic key contains only anthropic entries (plus agent default)",
  providersInChain.every(p => p === "anthropic"),
);
// When only Anthropic is configured, the chain entries are all anthropic
// entries from the hardcoded preference list. The agent default is also
// anthropic, so it dedupes against the Sonnet entry already in the chain
// — but the agent's modelId is still reachable as a chain entry.
truthy(
  "Anthropic-only chain still includes the agent's modelId",
  onlyAnthChain.some(e => e.modelId === "claude-sonnet-4-6"),
);

// A non-anthropic agent forces a true agent-default tail entry, since
// no hardcoded preference will dedup against it. The router suffix is
// "(last resort)" — assert that wording so future refactors don't
// silently drop the diagnostic.
const oddAgent: Agent = { ...agent, provider: "kimi", modelId: "moonshot-v1-128k-custom" } as Agent;
const oddChain = routeForComplexityChain("high", oddAgent);
truthy(
  "non-stock agent default lands at the tail of the chain as 'last resort'",
  oddChain[oddChain.length - 1].modelId === "moonshot-v1-128k-custom" &&
    /last\s+resort/i.test(oddChain[oddChain.length - 1].reason),
);

// ── 3) Quota / credit error classification ────────────────────────────────

truthy(
  "isQuotaOrCreditError matches a 429 rate-limit error",
  isQuotaOrCreditError(new Error("Anthropic API 429: too many requests")),
);
truthy(
  "isQuotaOrCreditError matches an OpenAI API 402 payment-required",
  isQuotaOrCreditError(new Error("OpenAI API 402: payment required")),
);
truthy(
  "isQuotaOrCreditError matches DeepSeek out-of-credit message",
  isQuotaOrCreditError(new Error("DeepSeek API 400: account out of credit")),
);
truthy(
  "isQuotaOrCreditError matches an 'insufficient_quota' phrase",
  isQuotaOrCreditError(new Error("insufficient_quota — please add funds")),
);
truthy(
  "isQuotaOrCreditError matches 'model_not_found'",
  isQuotaOrCreditError(new Error("model_not_found: claude-opus-4-7")),
);
falsy(
  "isQuotaOrCreditError does NOT match AbortError",
  isQuotaOrCreditError(Object.assign(new Error("aborted"), { name: "AbortError" })),
);
falsy(
  "isQuotaOrCreditError does NOT match a malformed-request 400",
  isQuotaOrCreditError(new Error("Anthropic API 400: invalid messages format")),
);
falsy(
  "isQuotaOrCreditError does NOT match a transient 500",
  isQuotaOrCreditError(new Error("Anthropic API 500: internal server error")),
);
falsy("isQuotaOrCreditError returns false for null", isQuotaOrCreditError(null));

// ── 4) Manual override / agent default precedence ────────────────────────

// When the agent.provider key IS configured and EVERY chain provider is
// configured too, the operator's pin (if any) takes precedence — but in
// the absence of a pin the hardcoded preference order wins. The router
// does not blindly use the agent's modelId; it picks the cheapest fit
// for the tier. The agent default is ONLY the last-resort fallback.
//
// In other words: a Sonnet-pinned agent on a low-complexity task gets
// DeepSeek-flash, not Sonnet (the whole point of the router).
for (const p of PROVIDERS) setKey(p, "test-key");
eq(
  "low-tier overrides a Sonnet-pinned agent down to DeepSeek-flash",
  routeForComplexity("low", agent).modelId,
  "deepseek-v4-flash",
);

// But the agent's own modelId IS the last entry in the chain — present
// for "everything else failed" cases, not for default cost-aware routing.
const lowChain = routeForComplexityChain("low", agent);
eq(
  "agent default sits at the END of the chain, not the start",
  lowChain[lowChain.length - 1].modelId,
  "claude-sonnet-4-6",
);

// ── 5) normaliseComplexity ─────────────────────────────────────────────────

eq("normaliseComplexity 'simple' → 'low'", normaliseComplexity("simple"), "low");
eq("normaliseComplexity 'easy' → 'low'", normaliseComplexity("easy"), "low");
eq("normaliseComplexity 'hard' → 'high'", normaliseComplexity("hard"), "high");
eq("normaliseComplexity 'complex' → 'high'", normaliseComplexity("complex"), "high");
eq("normaliseComplexity undefined → 'medium'", normaliseComplexity(undefined), "medium");
eq("normaliseComplexity 'gibberish' → 'medium'", normaliseComplexity("gibberish"), "medium");
eq("normaliseComplexity 'LOW' → 'low' (case insensitive)", normaliseComplexity("LOW"), "low");

// ── Cleanup + report ─────────────────────────────────────────────────────

restoreKeys();

let failed = 0;
for (const c of cases) {
  const pass = JSON.stringify(c.got) === JSON.stringify(c.want);
  if (!pass) {
    failed++;
    console.error(`FAIL: ${c.name}\n  got:  ${JSON.stringify(c.got)}\n  want: ${JSON.stringify(c.want)}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed}/${cases.length} tests failed`);
  process.exit(1);
}
console.log(`✓ ${cases.length} tests passed`);
