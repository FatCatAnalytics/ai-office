// Stage 6: GDELT 2.0 DOC API connector.
//
// Free public API. We use the article-list mode keyed by company name and
// return the top 5 recent items. Useful for sentiment and unusual-coverage
// detection beyond the curated Google News set.
// Reliability baseline: 0.55 — GDELT mirrors the open web indiscriminately.

import { Connector, ConnectorContext, ConnectorResult, domainFromUrl } from "./types";
import { safeFetchJson } from "./http";

interface GdeltResponse {
  articles?: Array<{
    url?: string;
    title?: string;
    domain?: string;
    sourcecountry?: string;
    seendate?: string;
    socialimage?: string;
  }>;
}

export const gdeltConnector: Connector = {
  name: "gdelt",
  sourceType: "gdelt",
  reliabilityBaseline: 0.55,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    const q = encodeURIComponent(`"${ctx.companyName}"`);
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&maxrecords=10&sort=DateDesc`;
    const data = await safeFetchJson<GdeltResponse>(url, { timeoutMs: ctx.timeoutMs ?? 10_000 });
    const items = (data?.articles ?? []).slice(0, 5);
    return items
      .filter((it) => it.url)
      .map((it) => ({
        title: it.title ?? "Untitled",
        url: it.url!,
        sourceType: "gdelt" as const,
        publisher: it.domain ?? domainFromUrl(it.url!),
        domain: it.domain ?? domainFromUrl(it.url!),
        publishedDate: it.seendate ? parseGdeltDate(it.seendate) : undefined,
        reliabilityScore: 0.55,
        metadata: { sourcecountry: it.sourcecountry },
      }));
  },
};

function parseGdeltDate(d: string): number | undefined {
  if (d.length === 14 && /^\d+$/.test(d)) {
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}Z`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : undefined;
  }
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : undefined;
}
