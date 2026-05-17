// Stage 6: SEC EDGAR connector (free, public, no key required).
//
// EDGAR requires a descriptive User-Agent. We set one via http.ts (env-driven
// AXL_HTTP_USER_AGENT / AXL_HTTP_FROM) and also pass an explicit `from` header
// here as a belt-and-braces.
//
// Stage 6.x.1 hardening:
//   - Resolve preferentially via ticker; only fall back to a strict name
//     match. Substring matching is gone — Apple no longer matches Apple
//     Hospitality REIT.
//   - Cache company_tickers.json in memory with a TTL (default 12h) and
//     dedupe in-flight refreshes so we don't refetch the 10 MB file per run.
//   - Surface the cache via `__resetTickerMapCache` for tests.
//
// Reliability baseline: 0.9. SEC filings are primary-source, regulator-verified
// material — about the strongest evidence we can cite.

import { Connector, ConnectorContext, ConnectorResult } from "./types";
import { safeFetchJson } from "./http";

interface EdgarTickerEntry { cik_str: number; ticker: string; title: string }
interface EdgarSubmissions {
  cik?: string;
  name?: string;
  sicDescription?: string;
  filings?: { recent?: { form: string[]; primaryDocument: string[]; accessionNumber: string[]; filingDate: string[]; primaryDocDescription?: string[] } };
}

const SEC_HEADERS: Record<string, string> = {
  from: process.env.AXL_SEC_FROM || process.env.AXL_HTTP_FROM || "research@axl.ai",
};

const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const TICKER_CACHE_TTL_MS = parseInt(
  process.env.AXL_SEC_TICKER_TTL_MS || `${12 * 60 * 60 * 1000}`,
  10,
);

interface TickerIndex {
  byTicker: Map<string, { cik: number; title: string }>;
  byNormalisedTitle: Map<string, number[]>; // normalised title → list of CIKs (1 = unique)
  fetchedAt: number;
}
let cachedIndex: TickerIndex | null = null;
let inFlight: Promise<TickerIndex | null> | null = null;

export const secEdgarConnector: Connector = {
  name: "sec_edgar",
  sourceType: "sec_filing",
  reliabilityBaseline: 0.9,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    const cik = ctx.cik
      ?? (await resolveCikFromTicker(ctx.ticker))
      ?? (await resolveCikFromName(ctx.companyName));
    if (!cik) return [];
    const padded = String(parseInt(cik, 10)).padStart(10, "0");
    const subs = await safeFetchJson<EdgarSubmissions>(
      `https://data.sec.gov/submissions/CIK${padded}.json`,
      { headers: SEC_HEADERS, timeoutMs: ctx.timeoutMs ?? 12_000 },
    );
    if (!subs?.filings?.recent) return [];
    const r = subs.filings.recent;
    const limit = Math.min(5, r.form.length);
    const results: ConnectorResult[] = [];
    for (let i = 0; i < limit; i++) {
      const form = r.form[i];
      const accNoRaw = r.accessionNumber[i];
      const accNo = accNoRaw.replace(/-/g, "");
      const doc = r.primaryDocument[i];
      const date = r.filingDate[i];
      const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNo}/${doc}`;
      results.push({
        title: `${subs.name ?? ctx.companyName} — ${form} (${date})`,
        url,
        sourceType: "sec_filing",
        publisher: "SEC EDGAR",
        domain: "sec.gov",
        publishedDate: parseDate(date),
        reliabilityScore: 0.92,
        metadata: {
          form,
          accessionNumber: accNoRaw,
          cik: padded,
          docDescription: r.primaryDocDescription?.[i],
        },
      });
    }
    return results;
  },
};

export async function resolveCikFromTicker(ticker?: string): Promise<string | undefined> {
  if (!ticker) return undefined;
  const idx = await getTickerIndex();
  if (!idx) return undefined;
  const hit = idx.byTicker.get(ticker.toUpperCase());
  return hit ? String(hit.cik) : undefined;
}

/**
 * Conservative name → CIK resolution.
 *
 * Returns a CIK only when the normalised legal title matches exactly, or when
 * exactly one company in EDGAR has the same normalised title after stripping
 * common corporate suffixes. Substring matching is intentionally NOT used
 * (the old behaviour matched "apple" against "Apple Hospitality REIT").
 *
 * When ambiguous, returns undefined so the caller can fall through to other
 * connectors instead of pulling the wrong company's filings.
 */
export async function resolveCikFromName(name: string): Promise<string | undefined> {
  if (!name || name.length < 2) return undefined;
  const idx = await getTickerIndex();
  if (!idx) return undefined;
  const candidates = [normaliseName(name), stripCorpSuffixes(normaliseName(name))];
  for (const needle of candidates) {
    if (!needle) continue;
    const hits = idx.byNormalisedTitle.get(needle);
    if (hits && hits.length === 1) return String(hits[0]);
  }
  return undefined;
}

async function getTickerIndex(): Promise<TickerIndex | null> {
  const now = Date.now();
  if (cachedIndex && now - cachedIndex.fetchedAt < TICKER_CACHE_TTL_MS) {
    return cachedIndex;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const data = await safeFetchJson<Record<string, EdgarTickerEntry>>(
      TICKER_MAP_URL,
      { headers: SEC_HEADERS, maxBytes: 25 * 1024 * 1024 },
    );
    inFlight = null;
    if (!data) return cachedIndex; // fall back to stale cache if present
    const byTicker = new Map<string, { cik: number; title: string }>();
    const byNormalisedTitle = new Map<string, number[]>();
    for (const k of Object.keys(data)) {
      const e = data[k];
      if (!e || typeof e.cik_str !== "number") continue;
      const ticker = String(e.ticker || "").toUpperCase();
      const title = String(e.title || "");
      if (ticker) byTicker.set(ticker, { cik: e.cik_str, title });
      const fullKey = normaliseName(title);
      const strippedKey = stripCorpSuffixes(fullKey);
      const keys = strippedKey && strippedKey !== fullKey ? [fullKey, strippedKey] : [fullKey];
      for (const key of keys) {
        if (!key) continue;
        const arr = byNormalisedTitle.get(key);
        if (arr) arr.push(e.cik_str);
        else byNormalisedTitle.set(key, [e.cik_str]);
      }
    }
    cachedIndex = { byTicker, byNormalisedTitle, fetchedAt: Date.now() };
    return cachedIndex;
  })();
  return inFlight;
}

export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[‘’‚‛'`]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CORP_SUFFIXES = [
  "inc", "incorporated", "corp", "corporation", "co", "company",
  "ltd", "limited", "plc", "llc", "lp", "lllp", "sa", "se", "ag", "nv",
  "holdings", "holding", "group", "trust", "reit", "n v", "s a", "s p a", "spa",
];

export function stripCorpSuffixes(s: string): string {
  const tokens = s.split(" ").filter(Boolean);
  while (tokens.length > 1 && CORP_SUFFIXES.includes(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/** Test-only: clear the ticker cache. */
export function __resetTickerMapCache(): void {
  cachedIndex = null;
  inFlight = null;
}

function parseDate(d: string): number | undefined {
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : undefined;
}
