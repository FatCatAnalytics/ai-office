// ─── Provider balance fetcher (Stage 5.x.12) ────────────────────────────────
// Tracks credit/budget remaining per provider so the dashboard can warn before
// a run hits the wall. Two data sources, picked per provider:
//
//   live    — provider exposes a real-time balance API. As of 2026-05 only
//             DeepSeek does this (https://api.deepseek.com/user/balance).
//             We hit it once per refresh and persist `balanceUsd` directly.
//   tracked — every other provider (Anthropic, OpenAI, Google, Kimi). We sum
//             `token_usage.cost_usd` for the current calendar month and
//             compute remaining = max(0, capUsd - usedUsd). The operator sets
//             capUsd in Settings; if 0, the row only reports usedUsd and is
//             treated as "no cap" by the failover logic.
//
// The fetcher is idempotent and side-effect-free except for upsert into
// provider_balances. Callers can run it on a timer, on a manual refresh
// click, or right before a high-tier model call to make sure cap checks
// are fresh.
// ────────────────────────────────────────────────────────────────────────────

import { storage, db } from "./storage";
import * as schema from "@shared/schema";
import { settingKeyForProvider, type Provider } from "./llm";

export type BalanceSource = "live" | "tracked" | "manual";

export interface BalanceFetchResult {
  id: string;            // canonical "<provider>:<modelId>"
  provider: Provider;
  modelId: string;       // "*" for whole-provider bucket
  capUsd: number;
  usedUsd: number;
  balanceUsd: number;    // remaining — either live or capUsd - usedUsd
  source: BalanceSource;
  error: string | null;
  alertThreshold: number;
  failoverMode: string;
  fallbackChain: string[];
}

// Providers we track. Whole-provider bucket only — per-model caps can be
// added later by upserting rows with a non-"*" modelId.
const TRACKED_PROVIDERS: Provider[] = [
  "anthropic",
  "openai",
  "google",
  "kimi",
  "deepseek",
];

// First day of the current calendar month (UTC). All tracked-spend math is
// scoped to this window so caps reset monthly without an explicit cron.
function startOfCurrentMonth(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
}

// Sum token_usage.cost_usd for `provider` since `since` (Unix ms). modelId
// "*" sums the whole provider; any other value scopes to that single model.
function spentSince(provider: string, modelId: string, since: number): number {
  const rows = db.select().from(schema.tokenUsage).all();
  let total = 0;
  for (const r of rows) {
    if (r.provider !== provider) continue;
    if (modelId !== "*" && r.modelId !== modelId) continue;
    if (r.timestamp < since) continue;
    total += r.costUsd;
  }
  // Round to 6dp to keep storage tidy and avoid float-noise diffs in the UI.
  return Math.round(total * 1e6) / 1e6;
}

// DeepSeek is the only provider in our matrix with a public balance API.
// The endpoint returns an array of balance entries (USD + CNY); we pick the
// USD one. Any error is non-fatal — we fall back to tracked spend.
async function fetchDeepSeekBalance(apiKey: string, signal?: AbortSignal): Promise<number | null> {
  const r = await fetch("https://api.deepseek.com/user/balance", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!r.ok) {
    throw new Error(`DeepSeek balance API ${r.status}: ${await r.text().catch(() => "")}`);
  }
  const data = await r.json() as {
    is_available?: boolean;
    balance_infos?: Array<{ currency?: string; total_balance?: string }>;
  };
  const usd = (data.balance_infos ?? []).find((b) => (b.currency ?? "").toUpperCase() === "USD");
  if (!usd || usd.total_balance == null) return null;
  const n = parseFloat(usd.total_balance);
  return Number.isFinite(n) ? n : null;
}

// Refresh balances for every provider with a configured key. For each:
//   1. Read or create the whole-provider row (modelId = "*"). If the operator
//      hasn't set a cap or fallback yet, sensible defaults are written.
//   2. Compute spent-this-month.
//   3. If the provider has a live API and the call succeeds, persist the live
//      balance and source = "live". Otherwise compute capUsd - usedUsd and
//      persist source = "tracked".
//
// The function NEVER throws — provider-specific errors are captured per row
// in `fetchError`. The operator sees them in the Budget UI.
export async function refreshProviderBalances(opts?: { signal?: AbortSignal }): Promise<BalanceFetchResult[]> {
  const out: BalanceFetchResult[] = [];
  const monthStart = startOfCurrentMonth();

  for (const provider of TRACKED_PROVIDERS) {
    const id = `${provider}:*`;
    let row = storage.getProviderBalance(id);
    if (!row) {
      // First sighting — seed an empty row with sensible defaults so the
      // operator can flip it on from the UI without a separate "create" step.
      row = storage.upsertProviderBalance({
        id,
        provider,
        modelId: "*",
        capUsd: 0,
        balanceUsd: 0,
        usedUsd: 0,
        source: "tracked",
        alertThreshold: 0.85,
        failoverMode: "ask",
        fallbackChain: "[]",
        lastFetchedAt: null,
        fetchError: null,
      });
    }

    const usedUsd = spentSince(provider, "*", monthStart);
    let balanceUsd = row.capUsd > 0 ? Math.max(0, row.capUsd - usedUsd) : 0;
    let source: BalanceSource = "tracked";
    let error: string | null = null;

    // Live API path — DeepSeek only for now. Expand here as more providers
    // ship balance endpoints.
    if (provider === "deepseek") {
      const apiKey = storage.getSetting(settingKeyForProvider(provider));
      if (apiKey) {
        try {
          const live = await fetchDeepSeekBalance(apiKey, opts?.signal);
          if (live != null) {
            balanceUsd = live;
            source = "live";
          }
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
      }
    }

    // Persist the spent + balance + source. usedUsd is always tracked-from-DB
    // so the UI can render "used / cap" bars even when source === "live".
    const updated = storage.upsertProviderBalance({
      id,
      provider,
      modelId: "*",
      capUsd: row.capUsd,
      balanceUsd,
      usedUsd,
      source,
      alertThreshold: row.alertThreshold,
      failoverMode: row.failoverMode,
      fallbackChain: row.fallbackChain,
      lastFetchedAt: Date.now(),
      fetchError: error,
    });

    let chain: string[] = [];
    try {
      const parsed = JSON.parse(updated.fallbackChain);
      if (Array.isArray(parsed)) chain = parsed.filter((x): x is string => typeof x === "string");
    } catch { /* leave empty */ }

    out.push({
      id: updated.id,
      provider: updated.provider as Provider,
      modelId: updated.modelId,
      capUsd: updated.capUsd,
      usedUsd: updated.usedUsd,
      balanceUsd: updated.balanceUsd,
      source: updated.source as BalanceSource,
      error,
      alertThreshold: updated.alertThreshold,
      failoverMode: updated.failoverMode,
      fallbackChain: chain,
    });
  }

  return out;
}

// Sync read used by the orchestrator's pre-call cap check. Pulls the current
// row out of SQLite (no network) and tells the caller whether it's safe to
// spend on this provider. "Safe" === capUsd === 0 (no cap) OR usedUsd <
// capUsd. This deliberately does NOT auto-refresh — the routes layer + the
// scheduler handle that — so the hot path stays fast.
//
// Stage 5.x.26: also reports `forceFailover` (set by the failover modal after
// a runtime credit-exhaust error). Routing should treat the provider as
// unusable when EITHER overCap OR forceFailover is true.
export function isProviderOverCap(provider: Provider): {
  overCap: boolean;
  forceFailover: boolean;
  unusable: boolean;
  capUsd: number;
  usedUsd: number;
  failoverMode: string;
  fallbackChain: string[];
} {
  const row = storage.getProviderBalance(`${provider}:*`);
  if (!row) {
    return { overCap: false, forceFailover: false, unusable: false, capUsd: 0, usedUsd: 0, failoverMode: "ask", fallbackChain: [] };
  }
  let chain: string[] = [];
  try {
    const parsed = JSON.parse(row.fallbackChain);
    if (Array.isArray(parsed)) chain = parsed.filter((x): x is string => typeof x === "string");
  } catch { /* default to empty */ }
  const overCap = row.capUsd > 0 && row.usedUsd >= row.capUsd;
  const forceFailover = Boolean(row.forceFailover);
  return {
    overCap,
    forceFailover,
    unusable: overCap || forceFailover,
    capUsd: row.capUsd,
    usedUsd: row.usedUsd,
    failoverMode: row.failoverMode,
    fallbackChain: chain,
  };
}

// Lightweight error classifier used by the orchestrator's catch block to
// decide whether a streamCompletion failure was a credit-exhaustion (and
// therefore deserves the failover modal) vs a generic provider error. We
// match on common substrings across the providers we wire up — providers
// don't agree on a single status code or error code for "out of money".
export function isCreditExhaustionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("insufficient_quota") ||
    msg.includes("insufficient quota") ||
    msg.includes("billing_hard_limit_reached") ||
    msg.includes("you exceeded your current quota") ||
    msg.includes("credit balance is too low") ||
    msg.includes("payment required") ||
    msg.includes("402") ||
    msg.includes("insufficient balance")
  );
}
