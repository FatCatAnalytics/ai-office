// Stage 6.1: Source-relevance scoring + gating.
//
// Stage 6 pulled in every connector hit indiscriminately. For common-word
// company names like "Stripe", OpenAlex / GDELT / Google News routinely
// returned unrelated papers and articles (hip-hop fashion, seismology, etc.)
// that only mentioned the company name as a generic adjective.
//
// scoreSourceRelevance returns a 0..1 score and a short explanation. The
// workflow uses it to (a) drop sources below a low floor before persisting,
// and (b) attach the score + reasons to source metadata so the memo can show
// reviewers why a noisy hit was kept or filtered.
//
// Signals (weighted):
//   - exact company name in title / domain / url / publisher
//   - website domain match (strongest signal — confirms entity)
//   - ticker / legal-identifier match (CIK, LEI, CH number)
//   - registry / SEC / official source types (auto-relevant)
//   - sector / objective keyword overlap
//   - negative ambiguity penalty for common-English-word company names
//   - publisher type heuristics (high-quality vs broad academic / aggregator)

import type { ConnectorResult } from "../connectors/types";

export interface RelevanceContext {
  companyName: string;
  website?: string;
  domain?: string;
  ticker?: string;
  cik?: string;
  lei?: string;
  companiesHouseNumber?: string;
  /** Optional free-form objective text (sector, thesis) — used for keyword overlap. */
  objective?: string;
  /** Hints about whether this is a technical/scientific company (drives OpenAlex policy). */
  isScientific?: boolean;
}

export interface RelevanceVerdict {
  score: number;          // 0..1
  reasons: string[];      // explanation tokens for transparency
  category: "primary" | "secondary" | "weak" | "irrelevant";
}

/**
 * Common English words that are also company names. Hits containing only the
 * bare word with no domain/ticker/url match should be downranked sharply,
 * since OpenAlex/GDELT/news love to return papers like "stripe formation in
 * seismic data" for "Stripe".
 */
const AMBIGUOUS_NAMES = new Set<string>([
  "stripe", "apple", "amazon", "block", "uber", "lyft", "square", "wave",
  "shop", "shopify", "target", "gap", "ford", "tesla", "snap", "twitter",
  "x", "meta", "alphabet", "google", "ring", "anchor", "match", "open",
  "live", "now", "global", "core", "atlas", "bolt", "fast", "lime",
  "loop", "north", "post", "rocket", "scale", "sense", "shift", "spark",
  "stack", "swift", "wire", "zoom",
]);

/**
 * Source types that are auto-relevant: they're keyed by entity identifier
 * (CIK, ticker) and inherently can't return unrelated hits.
 *
 * NOTE: companies_house and gleif used to live here, but Stage 6.2 found
 * that their public-search endpoints return name-substring matches that are
 * frequently unrelated entities (e.g. "STRIPE LTD", "SBH TAMWORTH LIMITED",
 * GLEIF "Stripe 157/158"). They're now scored by registry-specific signals
 * — see scoreRegistryEntry.
 */
const PRIMARY_SOURCE_TYPES = new Set<string>([
  "sec_filing", "market_data", "deck",
]);

const REGISTRY_SOURCE_TYPES = new Set<string>([
  "companies_house", "gleif",
]);

const SECONDARY_SOURCE_TYPES = new Set<string>([
  "website",
]);

/**
 * Lower-reliability discovery feeds where false positives are common.
 */
const NOISY_SOURCE_TYPES = new Set<string>([
  "openalex", "arxiv", "gdelt", "news_rss",
  // Stage 6.8: Perplexity citations are themselves search-derived web pages,
  // so they get the same false-positive treatment as GDELT / news_rss. The
  // gate ensures off-topic citations (the failure mode the relevance scorer
  // was built for) don't leak into the evidence store.
  "perplexity",
]);

const STOPWORDS = new Set<string>([
  "the", "and", "for", "with", "from", "that", "this", "into", "over",
  "your", "their", "about", "after", "above", "again", "below", "before",
  "have", "has", "are", "was", "were", "will", "what", "when", "where",
  "which", "who", "whom", "how", "of", "to", "in", "on", "at", "by", "as",
  "is", "be", "an", "a", "or", "not", "no",
]);

export function scoreSourceRelevance(
  r: ConnectorResult & { connector?: string },
  ctx: RelevanceContext,
): RelevanceVerdict {
  const reasons: string[] = [];
  let score = 0;

  const companyNameLc = (ctx.companyName || "").trim().toLowerCase();
  const companyTokens = tokenize(companyNameLc);
  const ambiguous =
    companyTokens.length === 1 && AMBIGUOUS_NAMES.has(companyTokens[0]);

  // Primary sources are inherently entity-locked.
  if (PRIMARY_SOURCE_TYPES.has(r.sourceType)) {
    reasons.push(`primary-source(${r.sourceType})`);
    return { score: 0.95, reasons, category: "primary" };
  }

  // Registry sources (Companies House, GLEIF) need active disambiguation —
  // their search endpoints frequently return substring matches that are not
  // the target entity (Stripe → SBH TAMWORTH LIMITED, GLEIF Stripe 157, …).
  if (REGISTRY_SOURCE_TYPES.has(r.sourceType)) {
    return scoreRegistryEntry(r, ctx, companyNameLc, companyTokens, ambiguous);
  }

  // Website / deck: high relevance when domain matches.
  if (r.sourceType === "website") {
    if (matchesDomain(r, ctx)) {
      reasons.push("domain-match");
      return { score: 0.9, reasons, category: "primary" };
    }
    reasons.push("website-no-domain-match");
    return { score: 0.5, reasons, category: "secondary" };
  }

  // Discovery feeds — score by entity signals.
  const haystack = [r.title, r.publisher, r.url, r.extractedText, r.rawText]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .join("  ");

  // Strongest signals first.
  if (ctx.ticker && new RegExp(`\\$${ctx.ticker.toLowerCase()}\\b|\\b${ctx.ticker.toLowerCase()}\\b`).test(haystack)) {
    score += 0.4;
    reasons.push("ticker-match");
  }
  if (ctx.cik && haystack.includes(ctx.cik.toLowerCase())) {
    score += 0.4;
    reasons.push("cik-match");
  }
  if (ctx.lei && haystack.includes(ctx.lei.toLowerCase())) {
    score += 0.4;
    reasons.push("lei-match");
  }
  if (ctx.companiesHouseNumber && haystack.includes(ctx.companiesHouseNumber.toLowerCase())) {
    score += 0.4;
    reasons.push("ch-number-match");
  }
  if (matchesDomain(r, ctx)) {
    score += 0.35;
    reasons.push("website-domain-match");
  }

  // Title containment of the company name (multi-word: very strong; single-word: weak).
  const titleLc = (r.title ?? "").toLowerCase();
  const titleHasName =
    companyNameLc.length > 0 && titleLc.includes(companyNameLc);
  if (titleHasName) {
    if (companyTokens.length >= 2) {
      score += 0.45;
      reasons.push("title-name-multiword");
    } else if (!ambiguous) {
      score += 0.25;
      reasons.push("title-name-singleton");
    } else {
      // Common-word singleton like "Stripe" — title mention alone is weak.
      score += 0.1;
      reasons.push("title-name-ambiguous");
    }
  }

  // Body containment of the multi-word name is meaningful, less so for single words.
  if (!titleHasName && companyNameLc && haystack.includes(companyNameLc)) {
    if (companyTokens.length >= 2) {
      score += 0.2;
      reasons.push("body-name-multiword");
    } else if (!ambiguous) {
      score += 0.08;
      reasons.push("body-name-singleton");
    } else {
      reasons.push("body-name-ambiguous-noop");
    }
  }

  // Objective / sector keyword overlap.
  if (ctx.objective) {
    const objTokens = tokenize(ctx.objective.toLowerCase())
      .filter((t) => !STOPWORDS.has(t) && t.length > 3);
    const matches = objTokens.filter((t) => haystack.includes(t));
    if (matches.length > 0) {
      score += Math.min(0.2, matches.length * 0.04);
      reasons.push(`objective-overlap(${matches.length})`);
    }
  }

  // Ambiguity penalty: a single-word common name with NO entity signal beyond
  // a title mention should be treated as noise. Stripe regression lives here.
  const hasEntitySignal =
    reasons.some((r) =>
      r === "ticker-match" || r === "cik-match" || r === "lei-match" ||
      r === "ch-number-match" || r === "website-domain-match" ||
      r === "title-name-multiword" || r === "body-name-multiword",
    );
  if (ambiguous && !hasEntitySignal) {
    score -= 0.35;
    reasons.push("ambiguity-penalty");
  }

  // OpenAlex policy: irrelevant unless we have a clear technical/scientific
  // angle OR a primary entity signal. This is where the seismology/hip-hop
  // papers got filtered out for Stripe.
  if (r.sourceType === "openalex" || r.sourceType === "arxiv") {
    if (!ctx.isScientific && !hasEntitySignal) {
      score = Math.min(score, 0.1);
      reasons.push("academic-no-technical-context");
    }
  }

  // News from a reputable business publisher gets a small bump, and for
  // ambiguous single-word names the publisher reputation + URL-slug name
  // can carry the story past the gate.
  if (r.sourceType === "news_rss" || r.sourceType === "gdelt") {
    const reputable = reputableBusinessPublisher(r);
    if (reputable) {
      score += 0.2;
      reasons.push("reputable-publisher");
    }
    if (ambiguous && reputable && companyNameLc) {
      const urlLc = (r.url ?? "").toLowerCase();
      // URL slug typically uses dashes — "stripe-tender-offer", "stripe/"
      const slugHit =
        new RegExp(`(^|[/_-])${escapeRe(companyNameLc)}([/_-]|$)`).test(urlLc) ||
        urlLc.includes(`/${companyNameLc}/`);
      if (slugHit) {
        score += 0.25;
        reasons.push("reputable-slug-match");
      }
    }
    // Business/financial keyword co-occurrence with the name in the title
    // is a strong disambiguator for common-word names.
    if (titleHasName) {
      const tl = titleLc;
      const business = /(\$|£|€|\bvalu(e|ed|ation)\b|\brevenue\b|\bfunding\b|\bipo\b|\bacquir(e|ed|es|ing|ition)\b|\bseries [a-h]\b|\blayoff\b|\bhiring\b|\bceo\b|\bfiling\b|\bpartnership\b)/i;
      if (business.test(tl)) {
        score += 0.2;
        reasons.push("business-context-in-title");
      }
    }
  }

  // Clamp.
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(1, score));

  const category: RelevanceVerdict["category"] =
    score >= 0.7 ? "primary" :
    score >= 0.45 ? "secondary" :
    score >= 0.25 ? "weak" :
    "irrelevant";

  return { score, reasons, category };
}

/**
 * Decide whether to keep a source after scoring. Discovery feeds need a
 * higher floor than directly-fetched primary sources.
 */
export function shouldKeepSource(verdict: RelevanceVerdict, sourceType: string): boolean {
  if (PRIMARY_SOURCE_TYPES.has(sourceType)) return true;
  if (SECONDARY_SOURCE_TYPES.has(sourceType)) return verdict.score >= 0.2;
  // Registry sources require active disambiguation — only "secondary" or
  // better passes (i.e. identifier match, exact legal-name, or brand+suffix
  // with a corroborating signal).
  if (REGISTRY_SOURCE_TYPES.has(sourceType)) return verdict.score >= 0.45;
  // Discovery / noisy feeds.
  if (NOISY_SOURCE_TYPES.has(sourceType)) return verdict.score >= 0.4;
  return verdict.score >= 0.3;
}

/**
 * Whether a verdict counts as "ambiguous registry candidate" — i.e. a
 * registry hit that we filtered out for disambiguation reasons rather than
 * because it was outright unrelated. The workflow surfaces these as a
 * transparent count in the memo / scoreBreakdown.
 */
export function isAmbiguousRegistryCandidate(
  verdict: RelevanceVerdict,
  sourceType: string,
): boolean {
  if (!REGISTRY_SOURCE_TYPES.has(sourceType)) return false;
  if (verdict.score >= 0.45) return false; // accepted
  // Outright unrelated (no name match) is not "ambiguous", it's just wrong.
  return verdict.reasons.some((r) =>
    r === "registry-substring-ambiguous" ||
    r === "registry-substring-singleton" ||
    r === "registry-substring-multiword" ||
    r === "registry-numbered-entity" ||
    r === "registry-legal-name-exact-ambiguous" ||
    r === "registry-legal-name-brand+suffix-ambiguous" ||
    r === "registry-legal-name-brand+suffix",
  );
}

/**
 * Stage 6.2: Registry-specific scoring for Companies House / GLEIF candidates.
 *
 * Public registry search returns substring/name-only matches that are often
 * unrelated entities. We require a stronger signal beyond "title contains the
 * company name":
 *   - exact identifier match (LEI / CH number) — accept as primary
 *   - normalized legal-name equality (after stripping suffixes) — strong
 *     primary signal IF jurisdiction also matches or no jurisdiction given
 *   - jurisdiction match + non-trivial name overlap — secondary
 *   - website/domain relationship (registered office links to brand domain)
 *   - otherwise treat as weak / irrelevant (will be excluded from claims)
 *
 * Penalties:
 *   - "numbered" entities like "Stripe 157", "Acme 12" without identifiers
 *   - generic single-token substring matches with no other signal
 *   - status != active / inactive registry status weakens score
 */
function scoreRegistryEntry(
  r: ConnectorResult,
  ctx: RelevanceContext,
  companyNameLc: string,
  companyTokens: string[],
  ambiguous: boolean,
): RelevanceVerdict {
  const reasons: string[] = [];
  let score = 0;

  const md = (r.metadata ?? {}) as Record<string, unknown>;
  const legalNameRaw = pickString(md, [
    "legalName", "legal_name", "name", "company_name", "title",
  ]) ?? extractNameFromTitle(r.title);
  const legalNameLc = (legalNameRaw ?? "").trim().toLowerCase();
  const normalizedRegistry = normalizeLegalName(legalNameLc);
  const normalizedQuery = normalizeLegalName(companyNameLc);

  const jurisdiction = pickString(md, ["jurisdiction", "legalJurisdiction", "country"])?.toLowerCase();
  const status = pickString(md, ["status", "company_status"])?.toLowerCase();
  const lei = pickString(md, ["lei"]);
  const chNumber = pickString(md, ["companyNumber", "company_number"]);
  const registryDomain = pickString(md, ["website", "homepage", "url", "domain"]);

  // Identifier-level match: caller already knows the LEI / CH number.
  if (ctx.lei && lei && ctx.lei.toLowerCase() === lei.toLowerCase()) {
    reasons.push("registry-lei-match");
    return { score: 0.95, reasons, category: "primary" };
  }
  if (
    ctx.companiesHouseNumber && chNumber &&
    ctx.companiesHouseNumber.toLowerCase() === chNumber.toLowerCase()
  ) {
    reasons.push("registry-ch-number-match");
    return { score: 0.95, reasons, category: "primary" };
  }

  // Numbered entity penalty — "Stripe 157", "Stripe 158", "Foo 12 LLC".
  // These are GLEIF/CH artefacts (often dissolved subsidiaries or fund
  // numbering schemes) that should never count as evidence for the brand
  // unless an identifier directly ties them to the queried company.
  const looksNumbered = /\b\d{1,4}\b/.test(normalizedRegistry) &&
    !/\b\d{4}\b/.test(normalizedQuery); // queries with embedded year are fine
  if (looksNumbered) {
    reasons.push("registry-numbered-entity");
    score -= 0.5;
  }

  // Exact normalized legal-name equality.
  const exactName =
    normalizedRegistry.length > 0 &&
    normalizedRegistry === normalizedQuery;
  // Strong "starts with the brand and has only a corporate suffix" match.
  const brandPlusSuffix =
    !exactName &&
    normalizedRegistry.length > 0 &&
    normalizedQuery.length > 0 &&
    isBrandPlusSuffix(normalizedRegistry, normalizedQuery);

  if (exactName) {
    // Ambiguous single-token names ("Stripe", "Block") match any registry
    // entry that normalizes to the same token. Demand a corroborating
    // signal before treating the registry hit as primary evidence.
    if (ambiguous) {
      reasons.push("registry-legal-name-exact-ambiguous");
      score += 0.35;
    } else {
      reasons.push("registry-legal-name-exact");
      score += 0.7;
    }
  } else if (brandPlusSuffix) {
    if (ambiguous) {
      reasons.push("registry-legal-name-brand+suffix-ambiguous");
      score += 0.3;
    } else {
      reasons.push("registry-legal-name-brand+suffix");
      score += 0.55;
    }
  } else if (companyNameLc && legalNameLc.includes(companyNameLc)) {
    // Substring-only — weak; ambiguous single-token names should not even
    // qualify for the secondary tier on this alone.
    if (ambiguous) {
      reasons.push("registry-substring-ambiguous");
      score += 0.05;
    } else if (companyTokens.length >= 2) {
      reasons.push("registry-substring-multiword");
      score += 0.2;
    } else {
      reasons.push("registry-substring-singleton");
      score += 0.1;
    }
  } else if (!exactName && !brandPlusSuffix) {
    // No name match at all → almost certainly an unrelated entity.
    reasons.push("registry-no-name-match");
    score -= 0.3;
  }

  // Jurisdiction tag is informational only for ambiguous single-token names —
  // a GB registration tells us nothing about whether this is *the* Stripe.
  // For non-ambiguous, multi-word, or brand+suffix names a small boost is
  // safe.
  if (jurisdiction && (exactName || brandPlusSuffix) && !ambiguous) {
    reasons.push(`registry-jurisdiction(${jurisdiction})`);
    score += 0.1;
  } else if (jurisdiction) {
    reasons.push(`registry-jurisdiction(${jurisdiction})-noop`);
  }

  // Domain relationship: registry record's homepage / referenced URL matches
  // the brand domain. This is the strongest disambiguator after identifiers.
  const ctxDomain = (ctx.domain || (ctx.website ? safeDomain(ctx.website) : "")).toLowerCase();
  if (ctxDomain && registryDomain) {
    const regDom = safeDomain(registryDomain);
    if (regDom && (regDom === ctxDomain || regDom.endsWith(`.${ctxDomain}`) || ctxDomain.endsWith(`.${regDom}`))) {
      reasons.push("registry-domain-match");
      score += 0.35;
    }
  }

  // Status hints: inactive/dissolved entries are less likely to be the
  // current operating entity. Don't reject outright (could legitimately be
  // a former parent), but downweight.
  if (status && /(dissolved|inactive|liquidation|removed|expired|lapsed)/.test(status)) {
    reasons.push(`registry-status(${status})`);
    score -= 0.15;
  }
  const activeStatus = !!status && /(active|issued|registered|lapsed)/.test(status);

  // For ambiguous-single-token exact matches, an active LEI/CH identifier
  // on a non-numbered, non-dissolved record is enough corroboration to keep
  // the entry as secondary evidence (we can't tell it's the right Stripe
  // entity, but it's the *kind* of registry hit a reviewer would want to
  // see — "GLEIF — Stripe, Inc." surfaces with the legal name and LEI).
  if (
    exactName && ambiguous && !looksNumbered &&
    (lei || chNumber) && activeStatus
  ) {
    reasons.push("registry-active-identifier-bump");
    score += 0.15;
  }

  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(1, score));

  const category: RelevanceVerdict["category"] =
    score >= 0.7 ? "primary" :
    score >= 0.45 ? "secondary" :
    score >= 0.25 ? "weak" :
    "irrelevant";

  return { score, reasons, category };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (v && typeof v === "object") {
      // GLEIF nests: attributes.entity.legalName.name etc.
      const nested = (v as Record<string, unknown>).name;
      if (typeof nested === "string" && nested.trim().length > 0) return nested.trim();
    }
  }
  return undefined;
}

function extractNameFromTitle(title: string): string | undefined {
  // Connector titles look like "Companies House — STRIPE LTD (12345678)" or
  // "GLEIF — Stripe, Inc. (LEI ...)". Strip prefix and trailing identifier.
  if (!title) return undefined;
  const m = title.match(/^(?:Companies House|GLEIF)\s*[—-]\s*(.+?)(?:\s*\([^)]*\))?\s*$/i);
  return m ? m[1].trim() : title;
}

const CORP_SUFFIXES = [
  "ltd", "limited", "plc", "llp", "lp", "llc", "inc", "incorporated",
  "corp", "corporation", "co", "company", "gmbh", "ag", "sa", "sas",
  "sarl", "srl", "spa", "bv", "nv", "kk", "pty", "oy", "ab", "as",
  "holdings", "holding", "group", "international", "intl",
];

function normalizeLegalName(s: string): string {
  if (!s) return "";
  let out = s.toLowerCase();
  // Replace punctuation with spaces.
  out = out.replace(/[.,'"&\/\\()]/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  // Strip trailing corporate suffixes (potentially multiple, e.g. "inc holdings").
  const tokens = out.split(" ");
  while (tokens.length > 1 && CORP_SUFFIXES.includes(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ").trim();
}

function isBrandPlusSuffix(registry: string, query: string): boolean {
  if (!registry || !query) return false;
  if (!registry.startsWith(query)) return false;
  const tail = registry.slice(query.length).trim();
  if (!tail) return true;
  const tailTokens = tail.split(/\s+/);
  // Allow short tails that are entirely corporate suffix tokens.
  return tailTokens.every((t) => CORP_SUFFIXES.includes(t));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenize(s: string): string[] {
  return s.split(/[^a-z0-9]+/i).filter(Boolean);
}

function matchesDomain(r: ConnectorResult, ctx: RelevanceContext): boolean {
  const target = (ctx.domain || (ctx.website ? safeDomain(ctx.website) : "")).toLowerCase();
  if (!target) return false;
  const hits = [r.domain, r.url].filter(Boolean).map((x) => String(x).toLowerCase());
  return hits.some((h) => h.includes(target));
}

function safeDomain(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const REPUTABLE_PUBLISHERS = [
  "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "nytimes.com",
  "economist.com", "axios.com", "techcrunch.com", "theinformation.com",
  "forbes.com", "cnbc.com", "bbc.com", "bbc.co.uk", "theguardian.com",
  "businesswire.com", "prnewswire.com", "sec.gov",
];

function reputableBusinessPublisher(r: ConnectorResult): boolean {
  const haystack = `${r.publisher ?? ""} ${r.domain ?? ""} ${r.url ?? ""}`.toLowerCase();
  return REPUTABLE_PUBLISHERS.some((d) => haystack.includes(d));
}

/**
 * Quick "is this company plausibly scientific/technical?" heuristic, used to
 * decide whether OpenAlex/arXiv hits should even be considered. Conservative
 * by default — Stripe (a payments company) should land as false.
 */
export function isScientificContext(input: {
  companyName: string;
  objective?: string;
  description?: string;
  sector?: string;
  industry?: string;
}): boolean {
  const text = [
    input.objective, input.description, input.sector, input.industry,
  ].filter(Boolean).join(" ").toLowerCase();
  if (!text) return false;
  const scientificCues = [
    "biotech", "biology", "pharma", "drug", "vaccine", "clinical", "trial",
    "genomic", "genome", "protein", "molecule", "materials science",
    "semiconductor", "quantum", "physics", "chemistry", "chemical",
    "battery", "fusion", "nuclear", "robotics", "robotic", "neural",
    "machine learning", "deep learning", "ai research", "model training",
    "research lab", "academic", "university spinout", "paper", "preprint",
    "phd", "scientist", "rna", "dna", "crispr", "oncology", "cardiology",
  ];
  return scientificCues.some((c) => text.includes(c));
}
