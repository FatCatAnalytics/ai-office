// Stage 6: Contradiction detection.
//
// Pairs claims sharing the same subject and unit, flagging any with > 25%
// relative divergence. Returns suggested contradictions for the workflow to
// persist. Conservative thresholds avoid false-positive noise — we'd rather
// miss a small disagreement than flag every rounding difference.
//
// Stage 6.5: only compares claims that
//   (a) share the same `subject` (metric name),
//   (b) have compatible units,
//   (c) sit in the same entity context — i.e. neither side is tagged as a
//       customer case-study figure, OR both refer to the same customer,
//   (d) sit in compatible periods when periods are known (incompatible
//       periods do not trigger a contradiction).
//
// `monetary_claim` (the unclassified bucket) is intentionally NOT compared
// against itself or against any classified metric. This kills the false
// "Reported $1.9tn in 2025" vs "valuation $70b" red flag that the Stripe
// live smoke surfaced in Stage 6.4.
//
// Stage 6.6: scope-aware comparison. When both claims declare a scope
// (annual / event_window / monthly / quarterly / cumulative), they only
// contradict if the scopes match. When *one* side declares a scope and
// the other doesn't, we stay conservative and skip the comparison
// instead of flagging — an unknown-scope payment-volume figure can be
// either annual or event-window, so we'd rather miss a contradiction
// than fabricate one. This eliminates the live-smoke false positive of
// US$1.9tn annual 2025 payment_volume vs US$40bn BFCM 2025 event
// payment_volume, while still catching two real annual-2025 numbers
// that genuinely disagree.

import type { Claim } from "@shared/schema";

export interface ContradictionFinding {
  claimAId: number;
  claimBId: number;
  severity: "low" | "medium" | "high";
  description: string;
}

interface ClaimMeta {
  customerContext?: string;
  contextNote?: string;
  period?: string;
  /** Stage 6.6 — scope bucket (annual / event_window / monthly / quarterly / cumulative). */
  scope?: string;
}

function readMeta(c: Claim): ClaimMeta {
  try {
    const m = JSON.parse(c.metadata ?? "{}");
    return {
      customerContext: typeof m?.customerContext === "string" ? m.customerContext : undefined,
      contextNote: typeof m?.contextNote === "string" ? m.contextNote : undefined,
      period: typeof m?.period === "string" ? m.period : undefined,
      scope: typeof m?.scope === "string" ? m.scope : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Stage 6.6: metric subjects where scope mismatch is meaningful enough
 * that we should refuse to compare unknown-scope vs scoped claims. For
 * `payment_volume`, an unknown-scope figure could be annual OR event-
 * window, so we don't know what to compare against — better to miss a
 * contradiction than flag one. For metrics like `valuation` or
 * `funding_amount`, scope is mostly point-in-time and unknown-scope is
 * still safe to compare with another unknown-scope figure.
 */
const SCOPE_SENSITIVE_SUBJECTS = new Set<string>([
  "payment_volume",
  "revenue",
  "arr",
  "mrr",
  "burn",
]);

/**
 * Stage 6.5: subjects we never compare for contradictions, even when they
 * match each other. `monetary_claim` is the catch-all bucket for figures
 * we couldn't pin to a specific metric; comparing them just produces
 * noise. `customer_metric` is per-customer and is already handled by the
 * entity-context check below, but listing it here makes the intent
 * explicit (two different customer stories with different numbers are
 * NOT a contradiction of the subject company).
 */
const SUBJECTS_TO_SKIP = new Set<string>([
  "monetary_claim",
  "customer_metric",
  "hiring_signal",
  "launch",
  "headquarters",
]);

/** Compatible-unit groups — claims in the same group are unit-comparable. */
function unitGroup(unit: string | null | undefined): string {
  const u = (unit ?? "").trim().toUpperCase();
  if (u === "USD" || u === "GBP" || u === "EUR") return "currency";
  if (u === "%") return "percent";
  if (u === "PEOPLE") return "people";
  if (u === "CUSTOMERS") return "customers";
  if (u === "COUNTRIES") return "countries";
  if (u === "METHODS") return "methods";
  if (u === "YEAR") return "year";
  return u || "_";
}

export function detectContradictions(claims: Claim[]): ContradictionFinding[] {
  const findings: ContradictionFinding[] = [];
  const numeric = claims.filter(
    (c) => c.numericValue != null && c.subject && !SUBJECTS_TO_SKIP.has(c.subject),
  );
  for (let i = 0; i < numeric.length; i++) {
    for (let j = i + 1; j < numeric.length; j++) {
      const a = numeric[i];
      const b = numeric[j];
      if (a.subject !== b.subject) continue;
      // Stage 6.5: compatible units, not literal-equal units. USD vs USD
      // still passes the old test; the change only matters when we
      // later record both an explicit currency and a generic "money"
      // bucket — both fall into the `currency` group.
      if (unitGroup(a.unit) !== unitGroup(b.unit)) continue;

      const metaA = readMeta(a);
      const metaB = readMeta(b);

      // Entity context — different customers, or one is a customer
      // figure and the other is the subject company, must NOT be
      // compared. (The subject-side has empty customerContext.)
      if ((metaA.customerContext ?? "") !== (metaB.customerContext ?? "")) continue;

      // Period compatibility — when both sides declare a period, only
      // compare when those periods match. When at most one side has a
      // period, fall through (older claims without period metadata
      // shouldn't suddenly stop being compared).
      if (metaA.period && metaB.period && metaA.period !== metaB.period) continue;

      // Stage 6.6: scope compatibility.
      //  - If both sides declare a scope and they differ → not a
      //    contradiction (annual vs event-window are incomparable).
      //  - If one side has a scope and the other doesn't, and the
      //    metric is scope-sensitive (payment_volume, revenue, ARR,
      //    MRR, burn), refuse to compare — the unknown-scope figure
      //    could be from a different aggregation window.
      if (metaA.scope && metaB.scope && metaA.scope !== metaB.scope) continue;
      if (
        SCOPE_SENSITIVE_SUBJECTS.has(a.subject) &&
        Boolean(metaA.scope) !== Boolean(metaB.scope)
      ) {
        continue;
      }

      const av = a.numericValue!;
      const bv = b.numericValue!;
      if (av === 0 && bv === 0) continue;
      const denom = Math.max(Math.abs(av), Math.abs(bv));
      const delta = Math.abs(av - bv) / denom;
      if (delta < 0.25) continue;
      const sev: "low" | "medium" | "high" = delta > 0.6 ? "high" : delta > 0.4 ? "medium" : "low";
      const scopeNote = metaA.scope || metaB.scope
        ? ` [${metaA.scope ?? metaB.scope}${(metaA.period ?? metaB.period) ? ` · ${metaA.period ?? metaB.period}` : ""}]`
        : "";
      findings.push({
        claimAId: a.id,
        claimBId: b.id,
        severity: sev,
        description: `Two claims on "${a.subject}"${scopeNote} diverge by ${(delta * 100).toFixed(0)}% (${av} ${a.unit ?? ""} vs ${bv} ${b.unit ?? ""}).`,
      });
    }
  }
  return findings;
}
