// Stage 6: Startup Due Diligence workflow.
//
// End-to-end MVP that:
//   1. Resolves or creates a Company row from the user's input.
//   2. Spins up a DiligenceRun (status="running").
//   3. Gathers public evidence via the connector layer in parallel.
//   4. Persists each connector result as a Source row.
//   5. Runs the heuristic claim extractor over every source.
//   6. Persists claims with appropriate statuses (company_claimed for the
//      website, third_party_reported for news/GDELT, etc.).
//   7. Calls the analytics-service for deterministic startup metrics where
//      we have enough numeric claims; falls back to a local mini-calculator
//      when the service is unreachable so the workflow still completes.
//   8. Detects contradictions across claims.
//   9. Computes salience + confidence scores.
//  10. Writes a markdown InvestmentMemo via the LLM (renderer.ts in the repo
//      already wires the model router).
//
// The workflow never throws past its boundary — any failed step is logged on
// the run row's `error` and the run is still finalised so the UI shows what
// was gathered. This matches the user-facing requirement that even partial
// public data should be useful.

import { gatherPublicEvidence } from "../connectors";
import { extractClaims } from "../evidence/extractClaims";
import { detectContradictions } from "../evidence/contradictions";
import {
  scoreSourceRelevance,
  shouldKeepSource,
  isScientificContext,
  isAmbiguousRegistryCandidate,
  type RelevanceContext,
  type RelevanceVerdict,
} from "../evidence/relevance";
import { deriveScoreInputs, salienceScore, confidenceScore } from "../scoring";
import { investmentStorage } from "../investment/storage";
import { storage } from "../storage";
import { startupCalculators, type StartupInputs } from "./startupCalculators";
import type { Company, DiligenceRun, Claim, Source } from "@shared/schema";

const ANALYTICS_URL = process.env.AXL_ANALYTICS_URL ?? "http://localhost:8765";
const DISCLAIMER =
  "This memo is research and analysis only. It is not personalized financial advice, " +
  "an offer to buy or sell any security, or a recommendation tailored to your circumstances. " +
  "All figures are derived from public sources and may be incomplete, lagged, or contradicted by " +
  "future information. Verify every cited fact independently before acting.";

export interface StartStartupDiligenceInput {
  companyName: string;
  website?: string;
  ticker?: string;
  deckText?: string;
  modelLink?: string;
  /** Stage 6.4: user-supplied research objective / investment question. */
  objective?: string;
  /** When the caller has already created the run row (recommended). */
  existingRunId?: number;
  /** When the caller has already resolved the company row. */
  existingCompanyId?: number;
}

const MAX_INLINE_DECK_BYTES = 32_768;

export async function runStartupDiligence(input: StartStartupDiligenceInput): Promise<DiligenceRun> {
  const company = input.existingCompanyId
    ? investmentStorage.getCompany(input.existingCompanyId) ?? resolveCompany(input)
    : resolveCompany(input);

  const truncatedDeck =
    input.deckText && input.deckText.length > MAX_INLINE_DECK_BYTES
      ? input.deckText.slice(0, MAX_INLINE_DECK_BYTES)
      : input.deckText;
  const objectiveText = (input.objective ?? "").trim().slice(0, 4_000);
  const inputsForStorage = {
    companyName: input.companyName,
    website: input.website,
    ticker: input.ticker,
    modelLink: input.modelLink,
    objective: objectiveText,
    workflowType: "startup_due_diligence" as const,
    deckTextLength: input.deckText?.length ?? 0,
    deckTextExcerpt: truncatedDeck ? truncatedDeck.slice(0, 4_000) : undefined,
    deckTextTruncated:
      input.deckText != null && input.deckText.length > MAX_INLINE_DECK_BYTES,
  };

  let run: DiligenceRun;
  if (input.existingRunId) {
    const existing = investmentStorage.getDiligenceRun(input.existingRunId);
    if (existing) {
      run = investmentStorage.updateDiligenceRun(existing.id, {
        status: "running",
        summary: "Collecting public evidence…",
        inputs: JSON.stringify(inputsForStorage),
        startedAt: existing.startedAt ?? Date.now(),
      }) ?? existing;
    } else {
      run = investmentStorage.createDiligenceRun({
        companyId: company.id,
        kind: "startup",
        status: "running",
        summary: "Collecting public evidence…",
        inputs: JSON.stringify(inputsForStorage),
        startedAt: Date.now(),
      });
    }
  } else {
    run = investmentStorage.createDiligenceRun({
      companyId: company.id,
      kind: "startup",
      status: "running",
      summary: "Collecting public evidence…",
      inputs: JSON.stringify(inputsForStorage),
      startedAt: Date.now(),
    });
  }

  try {
    // ── Phase 1: gather evidence ────────────────────────────────────────────
    const ctx = {
      companyName: company.name,
      website: company.website ?? input.website,
      ticker: company.ticker ?? input.ticker,
      cik: company.cik ?? undefined,
      lei: company.lei ?? undefined,
      companiesHouseNumber: company.companiesHouseNumber ?? undefined,
    };
    const gathered = await gatherPublicEvidence(ctx);
    // Stage 6.1: gate every connector hit through the relevance scorer
    // before storing. Discovery feeds (OpenAlex, GDELT, news_rss) routinely
    // return papers/articles that only contain the company name in a
    // generic context — the gate keeps the source set explainable and
    // prevents irrelevant claims from leaking downstream.
    // Stage 6.4: prefer the user-supplied objective when present; fall back to
    // company description + deck excerpt so older runs (no objective) keep
    // their current relevance signal.
    const objectiveText = [
      inputsForStorage.objective,
      company.description,
      company.sector,
      company.industry,
      inputsForStorage.deckTextExcerpt,
    ].filter(Boolean).join(" ");
    const isScientific = isScientificContext({
      companyName: company.name,
      objective: objectiveText,
      description: company.description,
      sector: company.sector ?? undefined,
      industry: company.industry ?? undefined,
    });
    const relevanceCtx: RelevanceContext = {
      companyName: company.name,
      website: company.website ?? input.website,
      domain: company.domain ?? undefined,
      ticker: company.ticker ?? input.ticker,
      cik: company.cik ?? undefined,
      lei: company.lei ?? undefined,
      companiesHouseNumber: company.companiesHouseNumber ?? undefined,
      objective: objectiveText,
      isScientific,
    };

    const persistedSources: Source[] = [];
    const filteredSources: Array<{
      title: string; url: string; sourceType: string; connector: string;
      score: number; reasons: string[]; ambiguousRegistry?: boolean;
    }> = [];
    let filteredByType: Record<string, number> = {};
    const ambiguousRegistryCandidates: Array<{
      title: string; url: string; sourceType: string; score: number; reasons: string[];
    }> = [];

    for (const r of gathered.results) {
      const verdict: RelevanceVerdict = scoreSourceRelevance(r, relevanceCtx);
      if (!shouldKeepSource(verdict, r.sourceType)) {
        const ambiguousRegistry = isAmbiguousRegistryCandidate(verdict, r.sourceType);
        filteredSources.push({
          title: r.title, url: r.url, sourceType: r.sourceType,
          connector: r.connector, score: verdict.score, reasons: verdict.reasons,
          ambiguousRegistry,
        });
        filteredByType[r.sourceType] = (filteredByType[r.sourceType] ?? 0) + 1;
        if (ambiguousRegistry) {
          ambiguousRegistryCandidates.push({
            title: r.title, url: r.url, sourceType: r.sourceType,
            score: verdict.score, reasons: verdict.reasons,
          });
        }
        continue;
      }
      // Adjust reliability by relevance — high-reliability publishers that
      // are off-topic should not contribute as much confidence.
      const blendedReliability = clamp01(
        r.reliabilityScore * (0.4 + 0.6 * verdict.score),
      );
      const s = investmentStorage.createSource({
        companyId: company.id,
        diligenceRunId: run.id,
        title: r.title,
        url: r.url,
        sourceType: r.sourceType,
        publisher: r.publisher,
        domain: r.domain,
        publishedDate: r.publishedDate,
        retrievedDate: Date.now(),
        rawText: r.rawText ?? "",
        extractedText: r.extractedText ?? "",
        reliabilityScore: blendedReliability,
        metadata: JSON.stringify({
          ...r.metadata,
          connector: r.connector,
          relevanceScore: verdict.score,
          relevanceCategory: verdict.category,
          relevanceReasons: verdict.reasons,
          baselineReliability: r.reliabilityScore,
        }),
      });
      persistedSources.push(s);
    }

    // Stage 6: include the user-supplied deck text as a `deck` source so it
    // joins the claim-extraction pass on equal footing with web evidence.
    // Stage 6.x.1: cap raw deck text to keep diligenceRuns.inputs small;
    // the deck source itself stores up to MAX_INLINE_DECK_BYTES.
    if (truncatedDeck && truncatedDeck.trim().length > 30) {
      const deckSource = investmentStorage.createSource({
        companyId: company.id,
        diligenceRunId: run.id,
        title: `${company.name} — user-supplied deck`,
        url: input.modelLink ?? "user-upload://deck",
        sourceType: "deck",
        publisher: company.name,
        domain: company.domain ?? undefined,
        retrievedDate: Date.now(),
        rawText: truncatedDeck,
        extractedText: truncatedDeck.slice(0, 20_000),
        reliabilityScore: 0.5,
        metadata: JSON.stringify({ origin: "user_upload", truncated: inputsForStorage.deckTextTruncated }),
      });
      persistedSources.push(deckSource);
    }

    // ── Phase 2: extract claims from each source ────────────────────────────
    const persistedClaims: Claim[] = [];
    for (const src of persistedSources) {
      const text = src.extractedText || src.rawText;
      if (!text || text.length < 50) continue;
      const status = statusForSource(src.sourceType);
      const claims = extractClaims(text, {
        officialSite: src.sourceType === "website",
        subjectCompany: company.name,
      });
      for (const c of claims) {
        const claimMeta: Record<string, unknown> = {};
        if (c.contextNote) claimMeta.contextNote = c.contextNote;
        if (c.customerContext) claimMeta.customerContext = c.customerContext;
        // Stage 6.5: lower confidence for unclassified monetary mentions
        // and customer-story figures so they don't drive subject-company
        // calculations / scoring.
        const mult = c.confidenceMultiplier ?? 1;
        const claim = investmentStorage.createClaim({
          companyId: company.id,
          diligenceRunId: run.id,
          sourceId: src.id,
          supportingSourceIds: "[]",
          statement: c.statement,
          subject: c.subject,
          numericValue: c.numericValue,
          unit: c.unit,
          status,
          confidence: clamp01(src.reliabilityScore * mult),
          evidenceQuote: c.evidenceQuote.slice(0, 600),
          metadata: JSON.stringify(claimMeta),
        });
        persistedClaims.push(claim);
      }
    }

    // ── Phase 3: deterministic calculators ─────────────────────────────────
    const numericByKey = pickLatestNumeric(persistedClaims);
    const startupInputs: StartupInputs = {
      arr: numericByKey.arr,
      mrr: numericByKey.mrr,
      revenue: numericByKey.revenue,
      previousArr: undefined,
      previousRevenue: undefined,
      grossProfit: undefined,
      monthlyBurn: numericByKey.burn,
      cashOnHand: undefined,
      valuation: numericByKey.valuation,
      headcount: numericByKey.headcount,
      customers: numericByKey.customers,
      // Stage 6.5: TAM/market_size renamed; keep `tam` for back-compat.
      tam: numericByKey.market_size ?? numericByKey.tam,
      cac: undefined,
      ltv: undefined,
      paybackMonths: undefined,
    };
    const localCalcs = startupCalculators(startupInputs);
    const remoteCalcs = await tryRemoteCalculators(startupInputs);
    const finalCalcs = remoteCalcs.length > 0 ? remoteCalcs : localCalcs;

    for (const calc of finalCalcs) {
      investmentStorage.createCalculation({
        companyId: company.id,
        diligenceRunId: run.id,
        name: calc.name,
        formula: calc.formula,
        inputs: JSON.stringify(calc.inputs),
        inputClaimIds: "[]",
        resultValue: calc.resultValue ?? undefined,
        resultText: calc.resultText ?? "",
        unit: calc.unit ?? undefined,
        explanation: calc.explanation,
        status: calc.status,
      });
    }

    // ── Phase 4: contradictions ────────────────────────────────────────────
    const contradictionFindings = detectContradictions(persistedClaims);
    for (const f of contradictionFindings) {
      investmentStorage.createContradiction({
        companyId: company.id,
        diligenceRunId: run.id,
        claimAId: f.claimAId,
        claimBId: f.claimBId,
        severity: f.severity,
        description: f.description,
      });
      // Flag involved claims as contradicted.
      investmentStorage.updateClaim(f.claimAId, { status: "contradicted" });
      investmentStorage.updateClaim(f.claimBId, { status: "contradicted" });
    }

    // ── Phase 5: scoring ───────────────────────────────────────────────────
    const allClaims = investmentStorage.listClaims({ diligenceRunId: run.id });
    const allCalcs = investmentStorage.listCalculations({ diligenceRunId: run.id });
    const allContras = investmentStorage.listContradictions({ diligenceRunId: run.id });
    const scoringInputs = deriveScoreInputs({
      sources: persistedSources,
      claims: allClaims,
      calculations: allCalcs,
      contradictions: allContras,
    });
    const sal = salienceScore(scoringInputs.salience);
    const conf = confidenceScore(scoringInputs.confidence);

    // ── Phase 6: red flags + open questions (heuristic) ────────────────────
    const redFlags = buildRedFlags(allClaims, allContras, finalCalcs);
    const openQuestions = buildOpenQuestions(allClaims, persistedSources);

    // ── Phase 7: memo body (deterministic, evidence-quoted) ────────────────
    const memoBody = renderMemoBody({
      company,
      objective: inputsForStorage.objective,
      sources: persistedSources,
      claims: allClaims,
      calcs: finalCalcs,
      contradictions: allContras,
      salience: sal,
      confidence: conf,
      redFlags,
      openQuestions,
      filteredCount: filteredSources.length,
      filteredByType,
      ambiguousRegistryCount: ambiguousRegistryCandidates.length,
    });

    investmentStorage.createMemo({
      diligenceRunId: run.id,
      companyId: company.id,
      title: `Diligence Memo — ${company.name}`,
      body: memoBody,
      recommendation: deriveRecommendation(sal.score, conf.score, allContras.length),
      thesisSummary: summariseThesis(company, allClaims),
      citedSourceIds: JSON.stringify(persistedSources.map((s) => s.id)),
      citedClaimIds: JSON.stringify(allClaims.map((c) => c.id)),
      disclaimer: DISCLAIMER,
    });

    // ── Phase 8: also publish a market signal so the run shows up downstream ─
    investmentStorage.createSignal({
      companyId: company.id,
      kind: "filing",
      title: `New diligence run completed for ${company.name}`,
      detail: `Confidence ${(conf.score * 100).toFixed(0)}% · Salience ${(sal.score * 100).toFixed(0)}% · ${allClaims.length} claims · ${allContras.length} contradictions`,
      severity: allContras.length > 0 ? "medium" : "info",
      publishedAt: Date.now(),
      metadata: JSON.stringify({ diligenceRunId: run.id }),
    });

    const finalised = investmentStorage.updateDiligenceRun(run.id, {
      status: "completed",
      completedAt: Date.now(),
      summary: `Gathered ${persistedSources.length} sources, ${allClaims.length} claims, ${finalCalcs.length} calcs, ${allContras.length} contradictions. Filtered ${filteredSources.length} low-relevance candidates.`,
      salienceScore: sal.score,
      confidenceScore: conf.score,
      scoreBreakdown: JSON.stringify({
        salience: sal,
        confidence: conf,
        connectorTimings: gathered.durationsMs,
        connectorErrors: gathered.errors,
        relevance: {
          kept: persistedSources.length,
          filtered: filteredSources.length,
          filteredByType,
          isScientific,
          examples: filteredSources.slice(0, 10),
          ambiguousRegistry: {
            count: ambiguousRegistryCandidates.length,
            examples: ambiguousRegistryCandidates.slice(0, 10),
          },
        },
      }),
      redFlags: JSON.stringify(redFlags),
      openQuestions: JSON.stringify(openQuestions),
    });
    return finalised ?? run;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return investmentStorage.updateDiligenceRun(run.id, {
      status: "failed",
      completedAt: Date.now(),
      error: msg.slice(0, 600),
    }) ?? run;
  }
}

function resolveCompany(input: StartStartupDiligenceInput): Company {
  const existing = investmentStorage.findCompanyByName(input.companyName);
  if (existing) {
    if (input.website && !existing.website) {
      const updated = investmentStorage.updateCompany(existing.id, { website: input.website });
      if (updated) return updated;
    }
    return existing;
  }
  const domain = input.website ? domainOf(input.website) : undefined;
  return investmentStorage.createCompany({
    name: input.companyName,
    website: input.website,
    domain,
    kind: "startup",
    ticker: input.ticker,
    description: "",
    metadata: "{}",
  });
}

function domainOf(url: string): string | undefined {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
  catch { return undefined; }
}

function statusForSource(t: string): "company_claimed" | "third_party_reported" | "unverified" {
  if (t === "website" || t === "deck") return "company_claimed";
  if (t === "sec_filing" || t === "companies_house" || t === "gleif") return "third_party_reported";
  if (t === "news_rss" || t === "gdelt" || t === "openalex" || t === "arxiv") return "third_party_reported";
  return "unverified";
}

function pickLatestNumeric(claims: Claim[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  for (const c of claims) {
    if (c.numericValue == null) continue;
    // Stage 6.5: skip claims tagged as customer case-study figures or as
    // unclassified monetary mentions — they shouldn't drive deterministic
    // subject-company calculators (valuation/ARR/etc.). The metadata is a
    // JSON string on Claim; we parse defensively.
    try {
      const m = JSON.parse(c.metadata ?? "{}");
      if (m && typeof m === "object" && (m as Record<string, unknown>).customerContext) continue;
    } catch { /* ignore — old rows have no metadata */ }
    if (c.subject === "monetary_claim" || c.subject === "customer_metric") continue;
    if (!(c.subject in out)) out[c.subject] = c.numericValue;
  }
  return out;
}

async function tryRemoteCalculators(inputs: StartupInputs): Promise<Array<{
  name: string; formula: string; inputs: Record<string, unknown>; resultValue?: number | null;
  resultText?: string; unit?: string | null; explanation: string; status: string;
}>> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(`${ANALYTICS_URL}/calculate/startup-metrics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inputs),
      signal: ctrl.signal,
    }).catch(() => null);
    clearTimeout(timer);
    if (!res || !res.ok) return [];
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.results)) return [];
    return data.results;
  } catch {
    return [];
  }
}

function buildRedFlags(claims: Claim[], contras: Array<{ description: string; severity: string }>, calcs: Array<{ name: string; resultValue?: number | null; status: string }>): string[] {
  const flags: string[] = [];
  for (const c of contras) flags.push(`Contradiction (${c.severity}): ${c.description}`);
  const burn = calcs.find((c) => c.name === "runway_months");
  if (burn && burn.resultValue != null && burn.resultValue < 9) {
    flags.push(`Runway estimated at ${burn.resultValue.toFixed(1)} months — sub-9-month runway is a financing risk.`);
  }
  const sub = new Set(claims.map((c) => c.subject));
  if (!sub.has("revenue") && !sub.has("arr") && !sub.has("mrr")) {
    flags.push("No revenue, ARR, or MRR figure extracted from public evidence.");
  }
  if (!sub.has("headcount")) {
    flags.push("No team-size signal extracted from public evidence.");
  }
  return flags.slice(0, 12);
}

function buildOpenQuestions(claims: Claim[], sources: Source[]): string[] {
  const qs: string[] = [];
  const sub = new Set(claims.map((c) => c.subject));
  if (!sub.has("valuation")) qs.push("What is the current post-money valuation and round terms?");
  if (!sub.has("burn")) qs.push("What is monthly net burn and current cash position?");
  if (!sub.has("customers")) qs.push("How many paying customers and what concentration risk exists?");
  if (!sources.some((s) => s.sourceType === "sec_filing" || s.sourceType === "companies_house")) {
    qs.push("Provide a recent regulatory filing (SEC 10-Q/K or UK Companies House accounts) for primary-source numbers.");
  }
  qs.push("Disclose any pending litigation, regulatory action, or material customer churn.");
  qs.push("Share independent customer references and a recent cohort retention curve.");
  return qs.slice(0, 10);
}

function deriveRecommendation(salience: number, confidence: number, contradictions: number): "pursue" | "watch" | "pass" {
  if (contradictions > 2 || confidence < 0.35) return "pass";
  if (salience * confidence > 0.25) return "pursue";
  return "watch";
}

function summariseThesis(company: Company, claims: Claim[]): string {
  const subs = new Set(claims.map((c) => c.subject));
  const drivers: string[] = [];
  if (subs.has("arr") || subs.has("revenue") || subs.has("mrr")) drivers.push("revenue traction");
  if (subs.has("growth_yoy")) drivers.push("growth claims");
  if (subs.has("tam") || subs.has("market_size")) drivers.push("stated TAM");
  if (subs.has("valuation")) drivers.push("valuation context");
  if (subs.has("payment_volume")) drivers.push("payment/processing volume");
  return `Initial diligence on ${company.name} grounded in public evidence — drivers reviewed: ${drivers.join(", ") || "qualitative public data only"}.`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Exported for the Stage 6.4 smoke test (`script/test-diligence-form.ts`).
// Pure function, no I/O — safe to call from tests.
export function renderMemoBody(args: {
  company: Company;
  objective?: string;
  sources: Source[];
  claims: Claim[];
  calcs: Array<{ name: string; formula: string; resultValue?: number | null; resultText?: string; unit?: string | null; explanation: string; status: string }>;
  contradictions: Array<{ description: string; severity: string }>;
  salience: { score: number; explanation: string };
  confidence: { score: number; explanation: string };
  redFlags: string[];
  openQuestions: string[];
  filteredCount?: number;
  filteredByType?: Record<string, number>;
  ambiguousRegistryCount?: number;
}): string {
  const { company } = args;
  const lines: string[] = [];
  lines.push(`# Diligence Memo — ${company.name}`);
  lines.push("");
  lines.push(`> ${DISCLAIMER}`);
  lines.push("");
  lines.push("## Snapshot");
  lines.push(`- **Company:** ${company.name}`);
  if (company.website) lines.push(`- **Website:** ${company.website}`);
  if (company.ticker) lines.push(`- **Ticker:** ${company.ticker}`);
  // Stage 6.4: surface the user-supplied research objective in Snapshot so
  // readers can judge whether the memo answered the actual question.
  lines.push(`- **Research objective:** ${args.objective?.trim() ? args.objective.trim() : "General public-data diligence."}`);
  lines.push(`- **Workflow:** Startup Due Diligence`);
  lines.push(`- **Confidence score:** ${(args.confidence.score * 100).toFixed(0)}%`);
  lines.push(`- **Salience score:** ${(args.salience.score * 100).toFixed(0)}%`);
  lines.push("");
  lines.push("## Key claims (with status)");
  if (args.claims.length === 0) {
    lines.push("_No structured claims extracted from public sources._");
  } else {
    for (const c of args.claims.slice(0, 15)) {
      const val = c.numericValue != null ? ` — ${c.numericValue} ${c.unit ?? ""}` : "";
      const label = stageSixFiveClaimLabel(c);
      lines.push(`- **[${c.status}]** ${label}${val}: ${c.statement}`);
      if (c.evidenceQuote) lines.push(`  > ${c.evidenceQuote.slice(0, 280)}`);
    }
  }
  lines.push("");
  lines.push("## Deterministic calculations");
  if (args.calcs.length === 0) {
    lines.push("_Insufficient numeric claims for deterministic calculation._");
  } else {
    for (const calc of args.calcs) {
      const v = calc.resultValue != null ? `${calc.resultValue} ${calc.unit ?? ""}` : (calc.resultText ?? "n/a");
      lines.push(`- **${calc.name}** = ${v} _(${calc.formula})_`);
      if (calc.explanation) lines.push(`  > ${calc.explanation}`);
    }
  }
  lines.push("");
  lines.push("## Contradictions");
  if (args.contradictions.length === 0) lines.push("_None detected._");
  else for (const c of args.contradictions) lines.push(`- (${c.severity}) ${c.description}`);
  lines.push("");
  lines.push("## Red flags");
  if (args.redFlags.length === 0) lines.push("_None surfaced by heuristic pass._");
  else for (const f of args.redFlags) lines.push(`- ${f}`);
  lines.push("");
  lines.push("## Open questions for the company");
  for (const q of args.openQuestions) lines.push(`- ${q}`);
  lines.push("");
  lines.push("## Evidence / sources");
  for (const s of args.sources) {
    const date = s.publishedDate ? new Date(s.publishedDate).toISOString().slice(0, 10) : "n/d";
    const relevance = extractRelevance(s.metadata);
    const relSuffix = relevance != null ? ` · relevance ${relevance.toFixed(2)}` : "";
    lines.push(`- [${s.sourceType}] ${s.title} — ${s.publisher ?? s.domain ?? "unknown"} (${date}) · reliability ${s.reliabilityScore.toFixed(2)}${relSuffix} — <${s.url}>`);
  }
  if ((args.filteredCount ?? 0) > 0) {
    const byType = args.filteredByType ?? {};
    const parts = Object.entries(byType).map(([t, n]) => `${t}=${n}`).join(", ");
    lines.push("");
    lines.push(`_${args.filteredCount} low-relevance source candidates were filtered out before claim extraction${parts ? ` (${parts})` : ""}._`);
  }
  if ((args.ambiguousRegistryCount ?? 0) > 0) {
    lines.push(`_${args.ambiguousRegistryCount} registry candidates (Companies House / GLEIF) were excluded as ambiguous or unconfirmed — they matched the company name as a substring but lacked an identifier (LEI / CH number), exact legal-name, or domain relationship to disambiguate._`);
  }
  lines.push("");
  lines.push("## Scoring breakdown");
  lines.push(`- Salience: ${args.salience.explanation}`);
  lines.push(`- Confidence: ${args.confidence.explanation}`);
  return lines.join("\n");
}

function extractRelevance(metadataJson: string): number | null {
  try {
    const m = JSON.parse(metadataJson ?? "{}");
    return typeof m?.relevanceScore === "number" ? m.relevanceScore : null;
  } catch { return null; }
}

// Stage 6.5: render a clearer memo label for monetary claims. Payment
// volume is no longer surfaced as a generic "monetary_claim", valuation
// is distinguishable from revenue, and customer-story figures clearly
// say so. Falls back to the bare subject for non-monetary claims.
function stageSixFiveClaimLabel(c: { subject: string; metadata?: string | null }): string {
  let customer = "";
  let note = "";
  try {
    const m = JSON.parse(c.metadata ?? "{}");
    if (typeof m?.customerContext === "string") customer = m.customerContext;
    if (typeof m?.contextNote === "string") note = m.contextNote;
  } catch { /* old rows had {} */ }
  switch (c.subject) {
    case "payment_volume": return "payment / processing volume";
    case "valuation": return "valuation";
    case "funding_amount": return "funding raised";
    case "revenue": return "revenue";
    case "arr": return "ARR";
    case "mrr": return "MRR";
    case "market_size": return "market size / TAM";
    case "burn": return "cash burn";
    case "cash": return "cash position";
    case "runway": return "runway";
    case "pricing_flat": return "pricing (flat)";
    case "pricing_pct": return "pricing (%)";
    case "customer_metric":
      return customer ? `customer context — ${customer}` : "customer context";
    case "monetary_claim":
      return note ? `monetary claim (${note})` : "monetary claim (unclassified)";
    default: return c.subject;
  }
}
