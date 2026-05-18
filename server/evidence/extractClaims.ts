// Stage 6: Heuristic claim extractor.
//
// Pulls structured numeric and qualitative claims out of source text using
// regular expressions. The MVP intentionally avoids an LLM here — every claim
// we surface has a quoted evidence snippet that the user can verify. The LLM
// is reserved for memo synthesis later in the workflow.
//
// Returns an array of `ExtractedClaim` with:
//   - subject: short slug ("revenue", "headcount", "valuation", ...)
//   - statement: human-readable claim
//   - numericValue/unit when extractable
//   - evidenceQuote: the surrounding sentence
//
// The status field is left to the caller — the workflow assigns
// "company_claimed" for website sources, "third_party_reported" for news, etc.
//
// Stage 6.1: sanitize source text before sentence-splitting and reject
// junk-looking sentences (raw HTML/CSS, Google redirect URL blobs,
// base64-ish chunks). The Stripe smoke test was producing "claims" that
// were literally Google News redirect URLs and pasted markdown link
// snippets — the sanitisation layer kills that class of bug.
//
// Stage 6.5: monetary parsing supports US$ prefix and trillion/tn/billion/
// bn/million/mn suffixes, case-insensitive. Monetary claims are classified
// by surrounding context (payment_volume, valuation, customer_metric,
// funding_amount, revenue, ARR, MRR, market_size, burn, cash, runway) so
// that contradiction detection can compare apples to apples instead of
// flagging payment-processing volume against company valuation as a
// "contradiction".
//
// Stage 6.6: monetary claims also carry an optional scope + period when
// detectable from the surrounding sentence. Scope buckets:
//   - annual / yearly_aggregate  (e.g. "in 2025", "annual", "fiscal 2024")
//   - event_window               (e.g. "Black Friday through Cyber Monday")
//   - monthly                    (e.g. "in November", "per month")
//   - quarterly                  (e.g. "in Q3 2025")
//   - cumulative                 (e.g. "all-time", "since inception")
// Periods are normalised labels: "2025", "BFCM 2025", "Q3 2025", etc.
// Contradiction detection compares only claims whose (scope, period)
// pairs are compatible, so an annual aggregate and an event-window
// figure never contradict.

import { sanitizeForClaims, looksLikeJunk, cleanEvidenceQuote } from "./sanitize";

export interface ExtractedClaim {
  subject: string;
  statement: string;
  numericValue?: number;
  unit?: string;
  evidenceQuote: string;
  /**
   * Stage 6.5: contextual subject + lower confidence for monetary claims
   * where we cannot pin a specific metric. Empty string when the claim was
   * confidently classified.
   */
  contextNote?: string;
  /** When set, the named customer/case-study the figure belongs to. */
  customerContext?: string;
  /** 0..1 — caller blends with source reliability; defaults to 1 if unset. */
  confidenceMultiplier?: number;
  /**
   * Stage 6.6: scope bucket for monetary metrics. One of
   *   "annual" | "event_window" | "monthly" | "quarterly" | "cumulative"
   * when detectable; omitted when scope is unknown so contradiction
   * detection can stay conservative.
   */
  scope?: string;
  /**
   * Stage 6.6: normalised period label paired with the scope, e.g.
   *   "2025", "BFCM 2025", "Q3 2025", "November 2025", "all-time".
   * Different periods within the same scope are not contradictions.
   */
  period?: string;
}

// Stage 6.5: money regex now accepts an optional `US` (or `U.S.` / `CA` /
// `AU` / `NZ`) prefix in front of the currency symbol so "US$1.9tn" parses
// as a single token. Suffix list expanded to include `mn`, `bn`, `tn`, and
// the bare letters `b` / `t` (word-boundary anchored to avoid eating real
// words like "transaction"). Made case-insensitive.
const CURRENCY_PREFIX_RE_SRC =
  "(?:(?:US|U\\.S\\.|CA|AU|NZ|HK|SG)\\s*)?[\\$£€]";
const MONEY_RE = new RegExp(
  `(${CURRENCY_PREFIX_RE_SRC})\\s?([\\d,]+(?:\\.\\d+)?)\\s?(trillion|billion|million|thousand|tn|bn|mn|tr|tril|bil|mil|t|b|m|k)?\\b`,
  "gi",
);
const PERCENT_RE = /(\d+(?:\.\d+)?)\s?%/g;
const HEADCOUNT_RE = /\b(\d{1,5})\s+(?:employees|engineers|people|staff|team\s+members)\b/gi;
const CUSTOMERS_RE = /\b(\d{1,3}(?:,\d{3})*|\d+)\s+(?:customers|users|clients|paying customers|enterprise customers|businesses|merchants)\b/gi;
const FOUNDED_RE = /\b(?:founded|established|incorporated)\s+in\s+(\d{4})\b/gi;
const GROWTH_RE = /\b(\d{1,4}(?:\.\d+)?)\s?%?\s*(?:y\/y|yoy|year-over-year|growth)\b/gi;
const MARKET_SIZE_RE = new RegExp(
  `\\b(?:TAM|total addressable market|market size)\\s*(?:of)?\\s*(${CURRENCY_PREFIX_RE_SRC})?\\s?([\\d,.]+)\\s?(trillion|billion|million|thousand|tn|bn|mn|tr|tril|bil|mil|t|b|m|k)?\\b`,
  "gi",
);

// Stage 6.3: official-site factual extractors.
const COUNTRIES_RE = /\b(?:in|across|to|supports?|available\s+in|operate(?:s|d)?\s+in|serve(?:s|d)?\s+(?:customers?\s+in|merchants?\s+in)?)\s+(?:over\s+|more\s+than\s+|than\s+)?(\d{1,3})\s+(?:countries|markets|regions|jurisdictions)\b/gi;
const PAYMENT_METHODS_RE = /\b(?:accept|support|process|handle)s?\s+(?:over\s+|more\s+than\s+)?(\d{1,4})\s+(?:payment\s+(?:methods|options|types)|currencies|local\s+payment\s+methods)\b/gi;
const PRICING_PERCENT_RE = /\b(\d+(?:\.\d+)?)\s?%(?:\s*\+\s*[\$£€]?[\d.]+)?\s+per\s+(?:successful\s+)?(?:transaction|charge|sale|payment|card\s+payment)\b/gi;
const PRICING_FLAT_RE = /(\$|£|€)\s?([\d]+(?:\.\d+)?)\s+per\s+(?:successful\s+)?(?:transaction|charge|sale|payment|card\s+payment)\b/gi;
const HQ_RE = /\b(?:headquartered|based)\s+in\s+([A-Z][A-Za-z .'-]{2,40}(?:,\s*[A-Z][A-Za-z .'-]{2,40})?)/g;
const HIRING_RE = /\b(?:we['']re|currently)\s+hiring\b|\bopen\s+(?:positions|roles)\b|\bjoin\s+our\s+team\b|\bview\s+open\s+jobs\b/gi;
const LAUNCH_RE = /\b(?:launched|announces?|introduced|unveiled|released)\s+([A-Z][A-Za-z0-9 ]{2,60})\s+(?:on|in)?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|\d{4})/g;

export interface ExtractClaimsOpts {
  maxClaims?: number;
  /**
   * When set, extract additional official-website facts (countries supported,
   * payment methods, pricing, HQ, hiring, launches). The default behaviour
   * stays focused on monetary / scale claims to avoid noise on news/research
   * sources where these patterns can mis-fire.
   */
  officialSite?: boolean;
  /**
   * Stage 6.5: name of the subject company being diligenced. When provided
   * and the surrounding sentence mentions a *different* company in a
   * customer-story shape ("Acme Inc. grew with Stripe"), the claim is
   * classified as customer_context rather than as a claim *about* the
   * subject company. Optional — older callers keep working.
   */
  subjectCompany?: string;
}

export function extractClaims(text: string, opts: ExtractClaimsOpts = {}): ExtractedClaim[] {
  const max = opts.maxClaims ?? 25;
  const claims: ExtractedClaim[] = [];
  const cleaned = sanitizeForClaims(text);
  if (!cleaned) return claims;
  const sentences = splitSentences(cleaned).filter((s) => !looksLikeJunk(s));

  for (const sentence of sentences) {
    if (claims.length >= max) break;

    for (const m of Array.from(sentence.matchAll(MONEY_RE))) {
      const value = scaleMoney(m[2], m[3]);
      if (value == null) continue;
      const classified = classifyMonetary(sentence, opts.subjectCompany);
      claims.push({
        subject: classified.subject,
        statement: buildMonetaryStatement(classified, m[0].trim(), value),
        numericValue: value,
        unit: currencyFromMatch(m[1]),
        evidenceQuote: cleanEvidenceQuote(sentence),
        contextNote: classified.contextNote,
        customerContext: classified.customerContext,
        confidenceMultiplier: classified.confidenceMultiplier,
        scope: classified.scope,
        period: classified.period,
      });
      if (claims.length >= max) break;
    }

    for (const m of Array.from(sentence.matchAll(HEADCOUNT_RE))) {
      const n = parseInt(m[1].replace(/,/g, ""), 10);
      claims.push({
        subject: "headcount",
        statement: `Headcount: ${n} per source text.`,
        numericValue: n,
        unit: "people",
        evidenceQuote: cleanEvidenceQuote(sentence),
      });
      if (claims.length >= max) break;
    }

    for (const m of Array.from(sentence.matchAll(CUSTOMERS_RE))) {
      const n = parseInt(m[1].replace(/,/g, ""), 10);
      claims.push({
        subject: "customers",
        statement: `Customer count: ${n} per source text.`,
        numericValue: n,
        unit: "customers",
        evidenceQuote: cleanEvidenceQuote(sentence),
      });
      if (claims.length >= max) break;
    }

    for (const m of Array.from(sentence.matchAll(FOUNDED_RE))) {
      claims.push({
        subject: "founded_year",
        statement: `Founded in ${m[1]} per source text.`,
        numericValue: parseInt(m[1], 10),
        unit: "year",
        evidenceQuote: cleanEvidenceQuote(sentence),
      });
      if (claims.length >= max) break;
    }

    for (const m of Array.from(sentence.matchAll(GROWTH_RE))) {
      const v = parseFloat(m[1]);
      claims.push({
        subject: "growth_yoy",
        statement: `Claimed growth ${v}% YoY (per source text).`,
        numericValue: v,
        unit: "%",
        evidenceQuote: cleanEvidenceQuote(sentence),
      });
      if (claims.length >= max) break;
    }

    for (const m of Array.from(sentence.matchAll(MARKET_SIZE_RE))) {
      const v = scaleMoney(m[2], m[3]);
      if (v == null) continue;
      claims.push({
        subject: "market_size",
        statement: `Claimed TAM/market size: ${m[0].trim()}`,
        numericValue: v,
        unit: currencyFromMatch(m[1]),
        evidenceQuote: cleanEvidenceQuote(sentence),
      });
      if (claims.length >= max) break;
    }

    if (opts.officialSite) {
      for (const m of Array.from(sentence.matchAll(COUNTRIES_RE))) {
        const n = parseInt(m[1], 10);
        if (!Number.isFinite(n) || n < 2 || n > 250) continue;
        claims.push({
          subject: "countries_supported",
          statement: `Stated availability in ${n} countries/markets per source text.`,
          numericValue: n,
          unit: "countries",
          evidenceQuote: cleanEvidenceQuote(sentence),
        });
        if (claims.length >= max) break;
      }
      for (const m of Array.from(sentence.matchAll(PAYMENT_METHODS_RE))) {
        const n = parseInt(m[1], 10);
        if (!Number.isFinite(n) || n < 2 || n > 500) continue;
        claims.push({
          subject: "payment_methods",
          statement: `Stated support for ${n} payment methods/currencies per source text.`,
          numericValue: n,
          unit: "methods",
          evidenceQuote: cleanEvidenceQuote(sentence),
        });
        if (claims.length >= max) break;
      }
      for (const m of Array.from(sentence.matchAll(PRICING_PERCENT_RE))) {
        const pct = parseFloat(m[1]);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 50) continue;
        claims.push({
          subject: "pricing_pct",
          statement: `Stated pricing of ${m[0].trim()} per source text.`,
          numericValue: pct,
          unit: "%",
          evidenceQuote: cleanEvidenceQuote(sentence),
        });
        if (claims.length >= max) break;
      }
      for (const m of Array.from(sentence.matchAll(PRICING_FLAT_RE))) {
        const v = parseFloat(m[2]);
        if (!Number.isFinite(v) || v <= 0 || v > 1_000) continue;
        claims.push({
          subject: "pricing_flat",
          statement: `Stated per-transaction flat fee of ${m[0].trim()} per source text.`,
          numericValue: v,
          unit: currencyFromMatch(m[1]),
          evidenceQuote: cleanEvidenceQuote(sentence),
        });
        if (claims.length >= max) break;
      }
      for (const m of Array.from(sentence.matchAll(HQ_RE))) {
        const loc = m[1].trim().replace(/[.,;]\s*$/, "");
        if (!loc || loc.length > 60) continue;
        claims.push({
          subject: "headquarters",
          statement: `Stated headquarters: ${loc}.`,
          evidenceQuote: cleanEvidenceQuote(sentence),
        });
        if (claims.length >= max) break;
      }
      if (HIRING_RE.test(sentence)) {
        HIRING_RE.lastIndex = 0;
        claims.push({
          subject: "hiring_signal",
          statement: `Careers/hiring signal present in source text.`,
          evidenceQuote: cleanEvidenceQuote(sentence),
        });
        if (claims.length >= max) break;
      }
      HIRING_RE.lastIndex = 0;
      for (const m of Array.from(sentence.matchAll(LAUNCH_RE))) {
        const productLike = m[1].trim();
        if (!productLike || productLike.length > 80) continue;
        claims.push({
          subject: "launch",
          statement: `Launch/newsroom mention: ${productLike}.`,
          evidenceQuote: cleanEvidenceQuote(sentence),
        });
        if (claims.length >= max) break;
      }
    }
  }

  return dedupe(claims);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$£€])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8 && s.length < 600);
}

/**
 * Stage 6.5: scale a monetary number string by an optional magnitude
 * suffix. Accepts trillion/tn/tr/t, billion/bn/bil/b, million/mn/mil/m,
 * thousand/k. The bare single-letter suffixes are only recognised by the
 * regex when followed by a word boundary, so "$40b" → 40e9 but
 * "$2 budget" doesn't mistakenly become 2e9 (the word boundary catches
 * the trailing letters).
 */
function scaleMoney(raw: string, scale?: string): number | undefined {
  const n = parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  if (!scale) return n;
  const s = scale.toLowerCase().trim();
  if (s === "trillion" || s === "tn" || s === "tr" || s === "tril" || s === "t") return n * 1e12;
  if (s === "billion" || s === "bn" || s === "bil" || s === "b") return n * 1e9;
  if (s === "million" || s === "mn" || s === "mil" || s === "m") return n * 1e6;
  if (s === "thousand" || s === "k") return n * 1e3;
  return n;
}

/**
 * Stage 6.5: extract a currency code from the full matched prefix (e.g.
 * "US$", "$", "£", "€", "CA$"). We don't distinguish USD vs CAD vs AUD
 * vs HKD/SGD here yet — they all resolve to their base currency for now —
 * but the prefix is preserved in the statement so the user can see it.
 */
function currencyFromMatch(prefix?: string): string {
  if (!prefix) return "USD";
  if (/£/.test(prefix)) return "GBP";
  if (/€/.test(prefix)) return "EUR";
  // $ with or without a country prefix → USD for now (CAD/AUD/HKD/SGD all
  // share the $ glyph and would need explicit handling, which is
  // overkill for the Stage 6.5 monetary-semantics scope).
  return "USD";
}

interface MonetaryClassification {
  subject: string;
  contextNote?: string;
  customerContext?: string;
  confidenceMultiplier?: number;
  /** Stage 6.6 — see ExtractedClaim.scope. */
  scope?: string;
  /** Stage 6.6 — see ExtractedClaim.period. */
  period?: string;
}

/**
 * Stage 6.5: classify a monetary mention by the words in its sentence.
 *
 * Returns a structured subject (`payment_volume`, `valuation`,
 * `customer_metric`, `funding_amount`, `revenue`, `arr`, `mrr`,
 * `market_size`, `burn`, `cash`, `runway`) when context is unambiguous;
 * otherwise falls back to `monetary_claim` with a `contextNote` and a
 * lower confidence multiplier so contradiction detection skips it.
 *
 * If a different company name appears in the sentence and the sentence
 * is in customer-story shape ("X grew with Stripe", "X processes
 * payments on Stripe"), the claim is tagged with `customerContext` so
 * the contradiction detector knows not to compare it against the
 * subject company's corporate metrics.
 */
function classifyMonetary(sentence: string, subjectCompany?: string): MonetaryClassification {
  const s = sentence.toLowerCase();
  const scoping = detectScopeAndPeriod(sentence);

  // 1) Customer case-study detection has to come before everything else,
  //    because "ElevenLabs grows to a US$3bn valuation on Stripe" matches
  //    `valuation` but the figure isn't Stripe's valuation.
  const customer = detectCustomerContext(sentence, subjectCompany);
  if (customer) {
    return {
      subject: "customer_metric",
      customerContext: customer.name,
      contextNote: customer.kind ? `customer ${customer.kind}` : "customer story",
      // Customer-story numbers shouldn't drive subject-company calcs.
      confidenceMultiplier: 0.4,
      scope: scoping.scope,
      period: scoping.period,
    };
  }

  // 2) Payment processing volume (large dollar figures associated with
  //    payments going through the platform, not the platform's revenue).
  if (
    /\b(?:total payment volume|payment volume|payments? volume|tpv|processed (?:more than |over )?(?:us\$|\$|£|€)|processes?(?:ed)? (?:over |more than |approximately |about )?(?:us\$|\$|£|€)|transactions? volume)\b/i.test(sentence) ||
    /\b(?:businesses|merchants|customers)\s+on\s+\w+\s+generat(?:ed|e)\b/i.test(sentence) ||
    /\bblack\s+friday\b/i.test(sentence) ||
    /\bcyber\s+monday\b/i.test(sentence) ||
    /\bgenerated\s+(?:more than |over |about )?(?:us\$|\$|£|€)/i.test(sentence)
  ) {
    return { subject: "payment_volume", scope: scoping.scope, period: scoping.period };
  }

  // 3) Specific revenue subtypes first, before generic "revenue".
  if (/\barr\b|annual recurring revenue/.test(s)) return { subject: "arr", scope: scoping.scope, period: scoping.period };
  if (/\bmrr\b|monthly recurring revenue/.test(s)) return { subject: "mrr", scope: scoping.scope, period: scoping.period };

  // 4) Valuation context.
  if (/\bvaluation\b|\bvalued at\b|\bpost-?money\b|\bpre-?money\b|\bworth (?:approximately |about |around )?(?:us\$|\$|£|€)/i.test(sentence)) {
    return { subject: "valuation", scope: scoping.scope, period: scoping.period };
  }

  // 5) Funding / fundraising.
  if (/\braised\b|\bseries\s+[a-k]\b|\bseed\s+round\b|\bfunding\s+round\b|\bclosed\s+(?:a\s+)?(?:us\$|\$|£|€)/i.test(sentence) ||
      /\bin\s+funding\b/i.test(sentence)) {
    return { subject: "funding_amount", scope: scoping.scope, period: scoping.period };
  }

  // 6) Revenue (after ARR/MRR).
  if (/\brevenue\b|\btop[- ]?line\b|\bnet sales\b/i.test(sentence)) {
    return { subject: "revenue", scope: scoping.scope, period: scoping.period };
  }

  // 7) Burn / cash / runway.
  if (/\bcash\s+burn\b|\bmonthly\s+burn\b|\bnet\s+burn\b/i.test(sentence)) {
    return { subject: "burn", scope: scoping.scope, period: scoping.period };
  }
  if (/\bcash\s+on\s+hand\b|\bcash\s+balance\b|\bcash\s+position\b/i.test(sentence)) {
    return { subject: "cash", scope: scoping.scope, period: scoping.period };
  }
  if (/\brunway\b/i.test(sentence)) {
    return { subject: "runway" };
  }

  // 8) Market size / TAM (the MARKET_SIZE_RE handles the canonical form,
  //    but plain "$1.5 trillion market" gets caught here).
  if (/\b(?:tam|sam|som|addressable market|market opportunity|market size)\b/i.test(sentence)) {
    return { subject: "market_size", scope: scoping.scope, period: scoping.period };
  }

  // 9) Pricing context (e.g. "starts at $99/month") — when paired with
  //    a money figure we mark it as pricing_flat so it doesn't pollute
  //    revenue.
  if (/\bper\s+(?:month|user|seat|year)\b|\bstarts\s+at\s+(?:us\$|\$|£|€)|\bplans?\s+(?:start|begin)\s+at\b/i.test(sentence)) {
    return { subject: "pricing_flat" };
  }

  // 10) Generated/earned framing without a clear metric — likely a
  //     business outcome figure, classify as payment_volume only when
  //     payments-flavoured words are present.
  if (/\bpayments?\b|\bcheckout\b|\bcharges\b|\btransactions?\b/i.test(sentence) &&
      /\bgenerated\b|\bprocessed\b|\bhandled\b/i.test(sentence)) {
    return { subject: "payment_volume", scope: scoping.scope, period: scoping.period };
  }

  // Fallback — unclassified monetary figure. We mark it with a lower
  // confidence multiplier so contradiction detection skips it relative
  // to classified metrics. Subject stays `monetary_claim` for back-
  // compat with existing callers.
  return {
    subject: "monetary_claim",
    contextNote: "unclassified — generic monetary mention",
    confidenceMultiplier: 0.6,
  };
}

interface ScopeAndPeriod { scope?: string; period?: string }

/**
 * Stage 6.6: detect scope (annual, event_window, monthly, quarterly,
 * cumulative) and a normalised period label from a sentence.
 *
 * Detection is intentionally conservative: when the sentence has no
 * temporal anchor we leave both undefined, and the contradiction
 * detector treats unknown-scope claims as not-safe-to-compare against
 * scoped claims.
 *
 * Detection precedence (first match wins):
 *   1. Event-window phrases (Black Friday, Cyber Monday, BFCM, holiday
 *      weekend) → event_window + e.g. "BFCM 2025".
 *   2. Explicit cumulative wording ("all-time", "since inception",
 *      "cumulative", "to date", "lifetime") → cumulative.
 *   3. Quarterly markers ("Q1 2025", "first quarter of 2025",
 *      "this quarter") → quarterly.
 *   4. Monthly markers ("in November 2025", "per month") → monthly.
 *   5. Annual markers ("in 2025", "fiscal 2024", "annual", "yearly",
 *      bare 4-digit year that looks like a financial year) → annual.
 */
function detectScopeAndPeriod(sentence: string): ScopeAndPeriod {
  const s = sentence;
  // 1) Event window: Black Friday / Cyber Monday / BFCM / holiday
  //    weekend / boxing day / prime day / singles day. Anchored to
  //    avoid false positives on unrelated weekend mentions.
  const bfcm = /\b(?:black\s+friday(?:\s+(?:through|to|–|-)\s+cyber\s+monday)?|cyber\s+monday|bfcm|cyber\s+week)\b/i.test(s);
  const otherEvent = /\b(?:boxing\s+day|prime\s+day|singles[''']?\s+day|holiday\s+weekend|holiday\s+shopping\s+(?:season|weekend))\b/i.test(s);
  if (bfcm || otherEvent) {
    const year = extractYear(s);
    const label = bfcm
      ? `BFCM${year ? ` ${year}` : ""}`
      : otherEvent
        ? `event${year ? ` ${year}` : ""}`
        : undefined;
    return { scope: "event_window", period: label };
  }

  // 2) Cumulative / lifetime / all-time.
  if (/\b(?:all[- ]time|since\s+inception|cumulative(?:ly)?|to\s+date|lifetime|inception\s+to\s+date)\b/i.test(s)) {
    return { scope: "cumulative", period: "all-time" };
  }

  // 3) Quarterly markers.
  const qMatch = s.match(/\bQ([1-4])\s*(\d{4})\b/i)
    || s.match(/\b(?:first|second|third|fourth)\s+quarter(?:\s+of)?\s+(\d{4})\b/i);
  if (qMatch) {
    // Normalise.
    const m1 = qMatch[1];
    const m2 = qMatch[2];
    if (m2 && /^\d$/.test(m1)) {
      return { scope: "quarterly", period: `Q${m1} ${m2}` };
    }
    const ord = s.match(/\b(first|second|third|fourth)\s+quarter(?:\s+of)?\s+(\d{4})\b/i);
    if (ord) {
      const map: Record<string, string> = { first: "Q1", second: "Q2", third: "Q3", fourth: "Q4" };
      return { scope: "quarterly", period: `${map[ord[1].toLowerCase()]} ${ord[2]}` };
    }
  }
  if (/\b(?:this|last|previous|past)\s+quarter\b/i.test(s)) {
    return { scope: "quarterly" };
  }

  // 4) Monthly markers — explicit named month + year, or "per month",
  //    "monthly", "MRR" already handled upstream so don't re-tag here.
  const monthMatch = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b(?:\s+(\d{4}))?/i);
  const perMonth = /\bper\s+month\b|\b(?:monthly|each\s+month|every\s+month)\b/i.test(s);
  if (monthMatch || perMonth) {
    // Make sure the month wasn't part of a larger annual phrase like
    // "fiscal year ending December 2025" — too rare to be worth special-
    // casing, fall through normally.
    if (monthMatch) {
      const yr = monthMatch[2] || extractYear(s) || "";
      return { scope: "monthly", period: `${capitalize(monthMatch[1].toLowerCase())}${yr ? ` ${yr}` : ""}`.trim() };
    }
    return { scope: "monthly" };
  }

  // 5) Annual / yearly aggregate.
  const annualPhrase = /\b(?:annual(?:ly)?|yearly|per\s+year|each\s+year|every\s+year|fiscal\s+year|fy\s*\d{2,4}|fiscal\s+\d{4})\b/i.test(s);
  const inYear = extractYear(s);
  if (annualPhrase || inYear) {
    return { scope: "annual", period: inYear ?? undefined };
  }

  return {};
}

function extractYear(sentence: string): string | undefined {
  // Prefer "in YYYY" / "for YYYY" / "fiscal YYYY" / "FY YYYY" anchors.
  const explicit = sentence.match(/\b(?:in|for|fiscal|fy)\s*(\d{4})\b/i);
  if (explicit) {
    const y = parseInt(explicit[1], 10);
    if (y >= 1990 && y <= 2100) return explicit[1];
  }
  // Otherwise pick a bare 4-digit year that looks plausible (2000-2100)
  // and is not part of a larger number. Avoid years that immediately
  // follow a $/£/€ to dodge collisions with money amounts.
  const m = sentence.match(/(?<![\$£€\d,.])\b(20\d{2}|19\d{2})\b/);
  if (m) return m[1];
  return undefined;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

interface CustomerContext { name: string; kind?: string }

/**
 * Stage 6.5: detect when a monetary figure belongs to a named customer
 * rather than the subject company being diligenced.
 *
 * Triggers when:
 *   (a) the subject company name appears in the sentence ALONGSIDE
 *       another capitalised company-like token in customer-story shape
 *       ("on <Subject>", "with <Subject>", "uses <Subject>", "powered
 *       by <Subject>"), or
 *   (b) the sentence opens with `<Customer> + verb + monetary figure`
 *       and includes a "case study / customer story / customers" header
 *       hint, OR includes the subject company name elsewhere.
 *
 * Returns the *customer* name (not the subject company). We're
 * conservative — a single capitalised token followed by a common verb
 * is not enough; the subject company must also appear, OR a strong
 * customer-story phrase must be present.
 */
function detectCustomerContext(sentence: string, subjectCompany?: string): CustomerContext | undefined {
  // Strong customer-story phrases: "<X> grew with <subject>",
  // "<X> grew into a $Y leader with <subject>", "<X> processes ... on
  // <subject>", "<X>, a <subject> customer", "ElevenLabs · Customers".
  // We look for the subject company name as the "on/with" partner.
  const subj = (subjectCompany ?? "").trim();
  const subjRe = subj
    ? new RegExp(`\\b${escapeRe(subj)}\\b`, "i")
    : null;

  // Heuristic A: "<Customer> ... (with|on|powered by|using|via) <Subject>"
  if (subj && subjRe?.test(sentence)) {
    const partner = new RegExp(
      `([A-Z][A-Za-z0-9&.\\-]+(?:\\s+[A-Z][A-Za-z0-9&.\\-]+){0,3})\\s+(?:grew|grows|grew into|grows into|scaled|scales|launched|builds?|built|raised|processes?|processed|generates?|generated|reached|hit|crossed|achieved|expanded|saved|earns?|earned)\\b[^.]{0,160}\\b(?:with|on|using|via|powered\\s+by|through|alongside)\\s+${escapeRe(subj)}\\b`,
      "i",
    );
    const m = sentence.match(partner);
    if (m) {
      const name = m[1].trim();
      if (name.toLowerCase() !== subj.toLowerCase() && !isCommonProperNoun(name)) {
        return { name, kind: inferCustomerKind(sentence) };
      }
    }
    // Heuristic B: "<Subject> customers like <Customer>", "case study:
    // <Customer>", "story: <Customer>".
    const tail = new RegExp(
      `(?:customer|case\\s+study|story|spotlight)s?[: ]+\\s*([A-Z][A-Za-z0-9&.\\-]+(?:\\s+[A-Z][A-Za-z0-9&.\\-]+){0,3})`,
      "i",
    );
    const t = sentence.match(tail);
    if (t) {
      const name = t[1].trim();
      if (name.toLowerCase() !== subj.toLowerCase() && !isCommonProperNoun(name)) {
        return { name, kind: inferCustomerKind(sentence) };
      }
    }
    // Heuristic C: "<Customer> grows into a $Xbn ... leader with <Subject>"
    // covers the ElevenLabs example exactly.
    const elevenLike = new RegExp(
      `^\\s*([A-Z][A-Za-z0-9&.\\-]+(?:\\s+[A-Z][A-Za-z0-9&.\\-]+){0,3})\\s+(?:grows?|grew|expands?|scales?)\\s+into\\b`,
      "i",
    );
    const e = sentence.match(elevenLike);
    if (e) {
      const name = e[1].trim();
      if (name.toLowerCase() !== subj.toLowerCase() && !isCommonProperNoun(name)) {
        return { name, kind: inferCustomerKind(sentence) };
      }
    }
  }

  return undefined;
}

function inferCustomerKind(sentence: string): string | undefined {
  if (/\bvaluation\b|\bvalued at\b|\bworth\b/i.test(sentence)) return "valuation";
  if (/\braised\b|\bin\s+funding\b/i.test(sentence)) return "funding";
  if (/\brevenue\b|\barr\b/i.test(sentence)) return "revenue";
  if (/\bprocessed\b|\bpayment\s+volume\b|\btransactions?\b/i.test(sentence)) return "payment volume";
  return undefined;
}

function isCommonProperNoun(name: string): boolean {
  // Words like "January", "Series", "Black", "Cyber" can match the
  // capitalised-token shape but aren't customers. We block a small set
  // so the heuristic doesn't tag "Black Friday" as a customer named
  // "Black".
  return /^(?:January|February|March|April|May|June|July|August|September|October|November|December|Series|Round|Black|Cyber|Friday|Monday|Q[1-4])$/i.test(name.split(" ")[0]);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMonetaryStatement(c: MonetaryClassification, raw: string, value: number): string {
  const pretty = formatMoneyValue(value);
  const scopeTail = scopeLabel(c);
  if (c.customerContext) {
    const kind = c.contextNote ? c.contextNote.replace(/^customer\s+/i, "") : "metric";
    return `Customer story: ${c.customerContext} ${kind} ${raw} (≈ ${pretty})${scopeTail} — not a subject-company metric.`;
  }
  switch (c.subject) {
    case "payment_volume": {
      const noun = c.scope === "event_window"
        ? "event-window processing volume"
        : c.scope === "annual"
          ? "annual payment volume"
          : c.scope === "monthly"
            ? "monthly payment volume"
            : c.scope === "quarterly"
              ? "quarterly payment volume"
              : c.scope === "cumulative"
                ? "cumulative payment volume"
                : "payment/processing volume";
      return `Reported ${noun} of ${raw} (≈ ${pretty})${scopeTail}.`;
    }
    case "valuation":
      return `Reported valuation of ${raw} (≈ ${pretty})${scopeTail}.`;
    case "funding_amount":
      return `Reported funding amount of ${raw} (≈ ${pretty})${scopeTail}.`;
    case "revenue":
      return `Reported revenue of ${raw} (≈ ${pretty})${scopeTail}.`;
    case "arr":
      return `Reported ARR of ${raw} (≈ ${pretty})${scopeTail}.`;
    case "mrr":
      return `Reported MRR of ${raw} (≈ ${pretty})${scopeTail}.`;
    case "market_size":
      return `Reported market size / TAM of ${raw} (≈ ${pretty}).`;
    case "burn":
      return `Reported cash burn of ${raw} (≈ ${pretty})${scopeTail}.`;
    case "cash":
      return `Reported cash position of ${raw} (≈ ${pretty}).`;
    case "runway":
      return `Reported runway figure ${raw}.`;
    case "pricing_flat":
      return `Reported pricing figure of ${raw}.`;
    default:
      return `Unclassified monetary figure of ${raw} (≈ ${pretty}) — context did not pin a specific metric.`;
  }
}

function scopeLabel(c: MonetaryClassification): string {
  if (c.period && c.scope) return ` [${c.scope} · ${c.period}]`;
  if (c.period) return ` [${c.period}]`;
  if (c.scope) return ` [${c.scope}]`;
  return "";
}

function formatMoneyValue(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)} trillion`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)} billion`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)} million`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(2)} thousand`;
  return v.toString();
}

function dedupe(items: ExtractedClaim[]): ExtractedClaim[] {
  const seen = new Set<string>();
  const out: ExtractedClaim[] = [];
  for (const c of items) {
    const stmtKey = c.numericValue == null ? c.statement.toLowerCase().slice(0, 80) : "";
    const k = `${c.subject}|${c.numericValue ?? ""}|${c.unit ?? ""}|${c.customerContext ?? ""}|${c.scope ?? ""}|${c.period ?? ""}|${stmtKey}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
