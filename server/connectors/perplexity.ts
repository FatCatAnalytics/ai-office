// Stage 6.8: Perplexity research connector.
//
// Wraps the shared Perplexity client (server/research/perplexity.ts) and
// shapes each returned citation into a ConnectorResult so the investment-
// intelligence pipeline can persist it alongside SEC / Companies House /
// news evidence. Each citation is gated through the existing Stage 6.1 /
// 6.2 relevance scorer downstream — this connector does not bypass any
// evidence rules.
//
// When the API key is missing the connector returns [] silently, matching
// the pattern set by companiesHouseConnector when COMPANIES_HOUSE_API_KEY
// is unset.

import { Connector, ConnectorContext, ConnectorResult, domainFromUrl } from "./types";
import { runResearch, isConfigured } from "../research/perplexity";

const RELIABILITY_BASELINE = 0.6;

function composeQuery(ctx: ConnectorContext): string {
  const parts: string[] = [`"${ctx.companyName}"`];
  if (ctx.ticker) parts.push(`ticker ${ctx.ticker}`);
  if (ctx.website) {
    try { parts.push(`site:${new URL(ctx.website).hostname}`); } catch { /* ignore */ }
  }
  parts.push("recent news, regulatory filings, financial performance, key risks");
  return parts.join(" ");
}

function parseDate(d?: string): number | undefined {
  if (!d) return undefined;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : undefined;
}

export const perplexityConnector: Connector = {
  name: "perplexity",
  sourceType: "perplexity",
  reliabilityBaseline: RELIABILITY_BASELINE,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    if (!isConfigured()) return [];

    const outcome = await runResearch({
      query: composeQuery(ctx),
      timeoutMs: ctx.timeoutMs,
      system:
        "You are an investment-research assistant. Surface concrete, factual public-web evidence about the " +
        "company in question: filings, financial performance, leadership changes, product launches, partnerships, " +
        "regulatory issues, and recent news. Prefer primary sources. Cite every claim. Be terse.",
    });

    if (!outcome.ok) return [];

    const synthesis: ConnectorResult = {
      title: `Perplexity research synthesis — ${ctx.companyName}`,
      // Sentinel URL marks the synthesis row as Perplexity-authored. The
      // relevance gate handles entity matching by name + objective.
      url: `https://www.perplexity.ai/?q=${encodeURIComponent(ctx.companyName)}`,
      sourceType: "perplexity",
      publisher: "Perplexity",
      domain: "perplexity.ai",
      publishedDate: Date.now(),
      extractedText: outcome.content,
      rawText: outcome.content,
      reliabilityScore: RELIABILITY_BASELINE,
      metadata: {
        model: outcome.model,
        citationCount: outcome.citations.length,
        kind: "synthesis",
      },
    };

    const citationResults: ConnectorResult[] = outcome.citations.map((c) => {
      const domain = domainFromUrl(c.url);
      return {
        title: c.title ?? c.url,
        url: c.url,
        sourceType: "perplexity" as const,
        publisher: domain,
        domain,
        publishedDate: parseDate(c.publishedDate),
        extractedText: c.snippet ?? "",
        rawText: c.snippet ?? "",
        // Citations from web search are less reliable than the synthesis row,
        // and they still pass through the same relevance gate as GDELT/news.
        reliabilityScore: 0.5,
        metadata: { kind: "citation", model: outcome.model },
      };
    });

    return [synthesis, ...citationResults];
  },
};
