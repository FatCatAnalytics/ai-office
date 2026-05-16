// Stage 6: Website connector
//
// Fetches the company website homepage, strips HTML, and returns the page as
// a `website` source. The extracted text feeds claim extraction (we look for
// numeric claims, marketing assertions, and team-size statements).
//
// Reliability baseline: 0.45. Company-owned pages are by definition partisan
// — they're "company_claimed" evidence, not third-party verification.

import { Connector, ConnectorContext, ConnectorResult, domainFromUrl } from "./types";
import { safeFetchText, stripHtml, extractTitle, extractMetaDescription } from "./http";

export const websiteConnector: Connector = {
  name: "website",
  sourceType: "website",
  reliabilityBaseline: 0.45,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    if (!ctx.website) return [];
    const url = normaliseUrl(ctx.website);
    const html = await safeFetchText(url, { timeoutMs: ctx.timeoutMs ?? 10_000 });
    if (!html) return [];
    const text = stripHtml(html).slice(0, 20_000);
    const title = extractTitle(html) || `${ctx.companyName} — website`;
    const description = extractMetaDescription(html) ?? "";
    const domain = domainFromUrl(url);
    return [{
      title,
      url,
      sourceType: "website",
      publisher: domain,
      domain,
      rawText: html.slice(0, 40_000),
      extractedText: description ? `${description}\n\n${text}` : text,
      reliabilityScore: 0.45,
      metadata: { description },
    }];
  },
};

function normaliseUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}
