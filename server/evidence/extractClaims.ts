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
const CUSTOMERS_RE = /\b(\d{1,3}(?:,\d{3})*|\d+)\s+(?:customers|users|clients|paying customers|enterprise customers)\b/gi;
const FOUNDED_RE = /\b(?:founded|established|incorporated)\s+in\s+(\d{4})\b/gi;
const GROWTH_RE = /\b(\d{1,4}(?:\.\d+)?)\s?%?\s*(?:y\/y|yoy|year-over-year|growth)\b/gi;
const MARKET_SIZE_RE = /\b(?:TAM|total addressable market|market size)\s*(?:of)?\s*(\$|£|€)?\s?([\d,.]+)\s?(million|billion|trillion|m|bn|k|thousand)?/gi;

export function extractClaims(text: string, opts: { maxClaims?: number } = {}): ExtractedClaim[] {
  const max = opts.maxClaims ?? 25;
  const claims: ExtractedClaim[] = [];
  const sentences = splitSentences(text);

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
        evidenceQuote: sentence,
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
        evidenceQuote: sentence,
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
        evidenceQuote: sentence,
      });
      if (claims.length >= max) break;
    }

    for (const m of Array.from(sentence.matchAll(FOUNDED_RE))) {
      claims.push({
        subject: "founded_year",
        statement: `Founded in ${m[1]} per source text.`,
        numericValue: parseInt(m[1], 10),
        unit: "year",
        evidenceQuote: sentence,
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
        evidenceQuote: sentence,
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
        evidenceQuote: sentence,
      });
      if (claims.length >= max) break;
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
    const k = `${c.subject}|${c.numericValue ?? ""}|${c.unit ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
