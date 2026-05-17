// Stage 6: Google News RSS connector
//
// Google News exposes a free RSS feed per search query at news.google.com/rss/search.
// No key required. Returns up to 5 recent items as `news_rss` sources.
// Reliability baseline: 0.6 — varies wildly per publisher, downstream code can
// adjust based on the `publisher` domain.

import { Connector, ConnectorContext, ConnectorResult, domainFromUrl } from "./types";
import { safeFetchText, stripHtml } from "./http";

export const newsRssConnector: Connector = {
  name: "news_rss",
  sourceType: "news_rss",
  reliabilityBaseline: 0.6,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    const q = encodeURIComponent(`"${ctx.companyName}"`);
    const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
    const xml = await safeFetchText(url, { timeoutMs: ctx.timeoutMs ?? 10_000 });
    if (!xml) return [];
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, 5);
    return items.map((m) => parseItem(m[1])).filter((x): x is ConnectorResult => x != null);
  },
};

function parseItem(block: string): ConnectorResult | null {
  const title = matchTag(block, "title");
  const link = matchTag(block, "link");
  const pub = matchTag(block, "pubDate");
  const source = matchTag(block, "source");
  const description = stripHtml(matchTag(block, "description") ?? "");
  if (!title || !link) return null;
  const domain = domainFromUrl(link);
  const publishedDate = pub ? Date.parse(pub) || undefined : undefined;
  return {
    title: stripHtml(title),
    url: link,
    sourceType: "news_rss",
    publisher: source ?? domain,
    domain,
    publishedDate,
    extractedText: description,
    reliabilityScore: 0.6,
  };
}

function matchTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return undefined;
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}
