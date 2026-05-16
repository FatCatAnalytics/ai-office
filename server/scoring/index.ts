// Stage 6: Axl scoring — explainable, deterministic.
//
// Both scores live in 0..1 and ship with a breakdown blob so any number on the
// UI can be traced back to its inputs. Importantly: this is NOT model-driven.
// The LLM produces the memo; the scoring is pure functions over evidence so a
// reader can reproduce the result.

import type { Claim, Source, Calculation, Contradiction } from "@shared/schema";

export interface SalienceInputs {
  materiality: number;          // 0..1
  novelty: number;              // 0..1
  sourceCredibility: number;    // 0..1
  thesisRelevance: number;      // 0..1
  timeSensitivity: number;      // 0..1
  contradictionImpact: number;  // 0..1
}

export interface SalienceResult {
  score: number;
  components: SalienceInputs;
  explanation: string;
}

// AXL Salience = product of six 0..1 components.
// Multiplicative is intentional — any single zero kills the score, which
// matches investor intuition (an irrelevant signal with perfect data is
// still useless).
export function salienceScore(i: SalienceInputs): SalienceResult {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const c = {
    materiality: clamp(i.materiality),
    novelty: clamp(i.novelty),
    sourceCredibility: clamp(i.sourceCredibility),
    thesisRelevance: clamp(i.thesisRelevance),
    timeSensitivity: clamp(i.timeSensitivity),
    contradictionImpact: clamp(i.contradictionImpact),
  };
  const score = c.materiality * c.novelty * c.sourceCredibility * c.thesisRelevance * c.timeSensitivity * c.contradictionImpact;
  return {
    score,
    components: c,
    explanation:
      `salience = materiality(${c.materiality.toFixed(2)}) × novelty(${c.novelty.toFixed(2)}) × ` +
      `sourceCredibility(${c.sourceCredibility.toFixed(2)}) × thesisRelevance(${c.thesisRelevance.toFixed(2)}) × ` +
      `timeSensitivity(${c.timeSensitivity.toFixed(2)}) × contradictionImpact(${c.contradictionImpact.toFixed(2)}) = ${score.toFixed(4)}`,
  };
}

export interface ConfidenceInputs {
  evidenceStrength: number;        // 0..1
  sourceQuality: number;           // 0..1
  calculationConsistency: number;  // 0..1
  crossSourceAgreement: number;    // 0..1
  dataFreshness: number;           // 0..1
  contradictionPenalty: number;    // 0..1
  assumptionFragility: number;     // 0..1
  uncertaintyPenalty: number;      // 0..1
}

export interface ConfidenceResult {
  score: number;
  components: ConfidenceInputs;
  explanation: string;
}

// AXL Confidence = sum of positives − sum of penalties, normalised by max
// possible positive contribution (5). Always clamped to 0..1.
export function confidenceScore(i: ConfidenceInputs): ConfidenceResult {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const c = {
    evidenceStrength: clamp(i.evidenceStrength),
    sourceQuality: clamp(i.sourceQuality),
    calculationConsistency: clamp(i.calculationConsistency),
    crossSourceAgreement: clamp(i.crossSourceAgreement),
    dataFreshness: clamp(i.dataFreshness),
    contradictionPenalty: clamp(i.contradictionPenalty),
    assumptionFragility: clamp(i.assumptionFragility),
    uncertaintyPenalty: clamp(i.uncertaintyPenalty),
  };
  const positives = c.evidenceStrength + c.sourceQuality + c.calculationConsistency + c.crossSourceAgreement + c.dataFreshness;
  const penalties = c.contradictionPenalty + c.assumptionFragility + c.uncertaintyPenalty;
  const raw = (positives - penalties) / 5;
  const score = Math.max(0, Math.min(1, raw));
  return {
    score,
    components: c,
    explanation:
      `confidence = ((evidenceStrength + sourceQuality + calcConsistency + crossSourceAgreement + dataFreshness) ` +
      `− (contradictionPenalty + assumptionFragility + uncertaintyPenalty)) / 5 = ` +
      `(${positives.toFixed(2)} − ${penalties.toFixed(2)}) / 5 = ${score.toFixed(4)}`,
  };
}

// Heuristic input derivation from a diligence run's gathered evidence. Used
// when the workflow doesn't have richer per-component data and needs sensible
// defaults to compute an initial score.
export function deriveScoreInputs(args: {
  sources: Source[];
  claims: Claim[];
  calculations: Calculation[];
  contradictions: Contradiction[];
  now?: number;
}): { salience: SalienceInputs; confidence: ConfidenceInputs } {
  const now = args.now ?? Date.now();
  const n = args.sources.length;
  const avgReliability = n > 0
    ? args.sources.reduce((s, x) => s + (x.reliabilityScore ?? 0.5), 0) / n
    : 0.4;
  const distinctDomains = new Set(args.sources.map((s) => s.domain ?? "").filter(Boolean)).size;
  const dated = args.sources.filter((s) => s.publishedDate);
  const avgAgeDays = dated.length
    ? dated.reduce((s, x) => s + (now - (x.publishedDate ?? now)) / (1000 * 60 * 60 * 24), 0) / dated.length
    : 180;
  const freshness = clamp01(1 - avgAgeDays / 730); // half-decays over ~2 years

  const verifiedClaims = args.claims.filter((c) => c.status === "verified" || c.status === "calculated").length;
  const verifiedRatio = args.claims.length > 0 ? verifiedClaims / args.claims.length : 0.2;
  const contradictionImpact = clamp01(1 - args.contradictions.length * 0.15);
  const calcOk = args.calculations.filter((c) => c.status === "ok").length;
  const calcConsistency = args.calculations.length > 0 ? calcOk / args.calculations.length : 0.5;

  const salience: SalienceInputs = {
    materiality: clamp01(0.4 + 0.6 * Math.min(1, args.claims.length / 10)),
    novelty: clamp01(0.4 + 0.1 * Math.min(6, distinctDomains)),
    sourceCredibility: avgReliability,
    thesisRelevance: 0.8,
    timeSensitivity: freshness,
    contradictionImpact,
  };
  const confidence: ConfidenceInputs = {
    evidenceStrength: clamp01(0.3 + 0.4 * verifiedRatio + 0.3 * Math.min(1, n / 8)),
    sourceQuality: avgReliability,
    calculationConsistency: calcConsistency,
    crossSourceAgreement: clamp01(distinctDomains / 5),
    dataFreshness: freshness,
    contradictionPenalty: clamp01(args.contradictions.length * 0.15),
    assumptionFragility: clamp01(0.4 - verifiedRatio * 0.3),
    uncertaintyPenalty: clamp01(0.3 - Math.min(0.3, n / 30)),
  };
  return { salience, confidence };
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
