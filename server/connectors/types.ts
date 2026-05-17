// Stage 6: Connector types
//
// A connector fetches from a single public data source and returns one or
// more `ConnectorResult`s. Each result carries the full source metadata
// required for evidence storage (title, url, sourceType, publisher, domain,
// publishedDate, retrievedDate, raw/extracted text, reliability).
//
// Connectors must NEVER throw — return [] on failure so the workflow can
// continue with whatever it managed to gather. Network calls use AbortSignal
// with a per-connector timeout (default 10s).

export type SourceType =
  | "sec_filing"
  | "companies_house"
  | "gleif"
  | "gdelt"
  | "news_rss"
  | "openalex"
  | "arxiv"
  | "website"
  | "market_data"
  | "deck"
  | "other";

export interface ConnectorResult {
  title: string;
  url: string;
  sourceType: SourceType;
  publisher?: string;
  domain?: string;
  publishedDate?: number;       // unix ms
  rawText?: string;
  extractedText?: string;
  reliabilityScore: number;     // 0..1, baseline per publisher
  metadata?: Record<string, unknown>;
}

export interface ConnectorContext {
  companyName: string;
  website?: string;
  ticker?: string;
  cik?: string;
  companiesHouseNumber?: string;
  lei?: string;
  timeoutMs?: number;
}

export interface Connector {
  name: string;
  sourceType: SourceType;
  reliabilityBaseline: number;
  fetch(ctx: ConnectorContext): Promise<ConnectorResult[]>;
}

export function domainFromUrl(url: string): string | undefined {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return undefined; }
}
