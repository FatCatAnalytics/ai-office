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

import { sanitizeForClaims, looksLikeJunk, cleanEvidenceQuote } from "./sanitize";

export interface ExtractedClaim {
  subject: string;
  statement: string;
  numericValue?: number;
  unit?: string;
  evidenceQuote: string;
}

const MONEY_RE = /(\$|£|€)\s?([\d,]+(?:\.\d+)?)\s?(million|billion|trillion|m|bn|k|thousand)?/gi;
const PERCENT_RE = /(\d+(?:\.\d+)?)\s?%/g;
const HEADCOUNT_RE = /\b(\d{1,5})\s+(?:employees|engineers|people|staff|team\s+members)\b/gi;
const CUSTOMERS_RE = /\b(\d{1,3}(?:,\d{3})*|\d+)\s+(?:customers|users|clients|paying customers|enterprise customers|businesses|merchants)\b/gi;
const FOUNDED_RE = /\b(?:founded|established|incorporated)\s+in\s+(\d{4})\b/gi;
const GROWTH_RE = /\b(\d{1,4}(?:\.\d+)?)\s?%?\s*(?:y\/y|yoy|year-over-year|growth)\b/gi;
const MARKET_SIZE_RE = /\b(?:TAM|total addressable market|market size)\s*(?:of)?\s*(\$|£|€)?\s?([\d,.]+)\s?(million|billion|trillion|m|bn|k|thousand)?/gi;

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
      claims.push({
        subject: guessMoneySubject(sentence),
        statement: `Reported ${guessMoneySubject(sentence)} of ${m[0].trim()} (per source text).`,
        numericValue: value,
        unit: currencyFromSymbol(m[1]),
        evidenceQuote: cleanEvidenceQuote(sentence),
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
        subject: "tam",
        statement: `Claimed TAM/market size: ${m[0].trim()}`,
        numericValue: v,
        unit: currencyFromSymbol(m[1]),
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
          unit: currencyFromSymbol(m[1]),
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

function scaleMoney(raw: string, scale?: string): number | undefined {
  const n = parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  if (!scale) return n;
  const s = scale.toLowerCase();
  if (s === "trillion") return n * 1e12;
  if (s === "billion" || s === "bn") return n * 1e9;
  if (s === "million" || s === "m") return n * 1e6;
  if (s === "thousand" || s === "k") return n * 1e3;
  return n;
}

function currencyFromSymbol(sym?: string): string {
  if (sym === "£") return "GBP";
  if (sym === "€") return "EUR";
  return "USD";
}

function guessMoneySubject(sentence: string): string {
  const s = sentence.toLowerCase();
  if (/\barr\b|annual recurring revenue/.test(s)) return "arr";
  if (/\bmrr\b|monthly recurring revenue/.test(s)) return "mrr";
  if (/\brevenue\b/.test(s)) return "revenue";
  if (/raised|series [a-f]|seed round|funding/.test(s)) return "funding_raised";
  if (/valuation|valued at|post-money|pre-money/.test(s)) return "valuation";
  if (/burn|cash burn/.test(s)) return "burn";
  if (/runway/.test(s)) return "runway";
  return "monetary_claim";
}

function dedupe(items: ExtractedClaim[]): ExtractedClaim[] {
  const seen = new Set<string>();
  const out: ExtractedClaim[] = [];
  for (const c of items) {
    const stmtKey = c.numericValue == null ? c.statement.toLowerCase().slice(0, 80) : "";
    const k = `${c.subject}|${c.numericValue ?? ""}|${c.unit ?? ""}|${stmtKey}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
