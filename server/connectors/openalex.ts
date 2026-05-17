// Stage 6: OpenAlex connector
//
// Free, no key. Returns up to 5 recent works mentioning the company name —
// useful for early-stage diligence on research-heavy startups (anything that
// touches academic literature, drug discovery, materials, AI, etc.).
// Reliability baseline: 0.75 (peer-reviewed academic record).

import { Connector, ConnectorContext, ConnectorResult } from "./types";
import { safeFetchJson } from "./http";

interface OpenAlexResponse {
  results?: Array<{
    id?: string;
    title?: string;
    display_name?: string;
    doi?: string;
    publication_date?: string;
    host_venue?: { display_name?: string };
    primary_location?: { source?: { display_name?: string } };
    abstract_inverted_index?: Record<string, number[]>;
  }>;
}

export const openAlexConnector: Connector = {
  name: "openalex",
  sourceType: "openalex",
  reliabilityBaseline: 0.75,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    // Stage 6.1: phrase-quote the company name so we don't get works that
    // only contain one of the tokens. Still permissive — the workflow
    // applies a relevance gate to drop unrelated academic hits before
    // persisting them as sources.
    const phrased = `"${ctx.companyName.replace(/"/g, '')}"`;
    const q = encodeURIComponent(phrased);
    const url = `https://api.openalex.org/works?search=${q}&per_page=5&sort=publication_date:desc`;
    const data = await safeFetchJson<OpenAlexResponse>(url, { timeoutMs: ctx.timeoutMs ?? 10_000 });
    const items = data?.results ?? [];
    return items.map((w) => {
      const link = w.doi ? `https://doi.org/${w.doi.replace(/^https?:\/\/doi\.org\//, "")}` : (w.id ?? "");
      const venue = w.host_venue?.display_name ?? w.primary_location?.source?.display_name;
      return {
        title: w.title ?? w.display_name ?? "Untitled work",
        url: link,
        sourceType: "openalex" as const,
        publisher: venue ?? "OpenAlex",
        domain: "openalex.org",
        publishedDate: w.publication_date ? Date.parse(w.publication_date) || undefined : undefined,
        extractedText: w.abstract_inverted_index ? rebuildAbstract(w.abstract_inverted_index) : "",
        reliabilityScore: 0.75,
        metadata: { doi: w.doi, venue },
      };
    }).filter((r) => r.url);
  },
};

function rebuildAbstract(inv: Record<string, number[]>): string {
  const positions: Array<[number, string]> = [];
  for (const [word, idxs] of Object.entries(inv)) {
    for (const i of idxs) positions.push([i, word]);
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(" ").slice(0, 4_000);
}
