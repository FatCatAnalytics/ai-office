// Stage 6: Website connector
//
// Fetches the company website homepage, strips HTML, and returns the page as
// a `website` source. The extracted text feeds claim extraction (we look for
// numeric claims, marketing assertions, and team-size statements).
//
// Reliability baseline: 0.45. Company-owned pages are by definition partisan
// — they're "company_claimed" evidence, not third-party verification.
//
// Stage 6.x.1 hardening: every fetch goes through assertSafePublicUrl (no
// internal/private IPs), redirects are bounded and re-validated, response is
// capped at 1.5 MiB, and only HTML-ish content types are accepted.

import { Connector, ConnectorContext, ConnectorResult, domainFromUrl } from "./types";
import { safeFetchText, stripHtml, extractTitle, extractMetaDescription } from "./http";
import { assertSafePublicUrl } from "./urlSafety";

const WEBSITE_TIMEOUT_MS = 8_000;
const WEBSITE_MAX_BYTES = 1_500_000;

export const websiteConnector: Connector = {
  name: "website",
  sourceType: "website",
  reliabilityBaseline: 0.45,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    if (!ctx.website) return [];
    const raw = normaliseUrl(ctx.website);
    const safety = await assertSafePublicUrl(raw);
    if (!safety.ok) return [];
    const url = safety.url.toString();
    const html = await safeFetchText(url, {
      timeoutMs: ctx.timeoutMs ?? WEBSITE_TIMEOUT_MS,
      maxBytes: WEBSITE_MAX_BYTES,
      allowedContentTypes: ["text/html", "application/xhtml+xml", "text/plain"],
    });
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

/**
 * Pre-flight URL check used by /api/investment/data-sources/probe and by
 * any other route that wants to surface a user-readable reason when a URL
 * is rejected. Public so the routes layer can reuse the same policy.
 */
export async function previewWebsiteUrl(input: string): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const raw = normaliseUrl(input);
  const safety = await assertSafePublicUrl(raw);
  if (!safety.ok) return { ok: false, reason: safety.reason };
  return { ok: true, url: safety.url.toString() };
}

function normaliseUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}
