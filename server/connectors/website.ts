// Stage 6: Website connector
//
// Stage 6 fetched only the company's homepage. The Stage 6.2 Stripe smoke
// test showed why that's insufficient: localised homepages (e.g. the German
// stripe.com page returned "Online-Bezahldienst und Zahlungsdienstleister |
// Stripe") leak almost no structured content into claim extraction.
//
// Stage 6.3 expands the connector into a *bounded same-domain crawl*:
//   1. Fetch the homepage.
//   2. Inspect <link rel="canonical">, <link rel="alternate" hreflang="...">,
//      and the homepage <html lang>. If a clearly-English canonical URL
//      exists on the same registrable domain, swap to it as the seed page.
//   3. Generate a small candidate-path list ("/about", "/customers", ...) +
//      anchor links from the seed page that match obvious about/customers/
//      news/pricing/careers patterns.
//   4. Fetch up to MAX_PAGES same-domain pages, http/https only, each going
//      through assertSafePublicUrl + redirect-safe safeFetchText.
//   5. De-duplicate identical pages by URL and by readable-text hash.
//   6. Return one ConnectorResult per page (sourceType "website").
//
// Reliability baseline: 0.45. Company-owned pages are "company_claimed"
// evidence — partisan but useful for company-side facts (products supported,
// stated scale, pricing, careers signals).

import { Connector, ConnectorContext, ConnectorResult, domainFromUrl } from "./types";
import {
  safeFetchText,
  stripHtml,
  extractTitle,
  extractMetaDescription,
  extractReadable,
  extractAnchorHrefs,
  extractHreflang,
  ReadableExtraction,
} from "./http";
import { assertSafePublicUrl } from "./urlSafety";

const WEBSITE_TIMEOUT_MS = 8_000;
const WEBSITE_MAX_BYTES = 1_500_000;

/** Hard ceiling on the number of pages we'll fetch per company. */
const MAX_PAGES = Math.max(
  1,
  Math.min(parseInt(process.env.AXL_WEBSITE_MAX_PAGES || "8", 10) || 8, 10),
);

/**
 * Candidate paths to probe on the brand domain. Kept short, conservative,
 * and free of query-strings so we don't trigger infinite crawls.
 */
const CANDIDATE_PATHS = [
  "/",
  "/en",
  "/en-us",
  "/en-gb",
  "/about",
  "/about-us",
  "/company",
  "/customers",
  "/pricing",
  "/news",
  "/newsroom",
  "/press",
  "/careers",
  "/jobs",
  "/enterprise",
  "/products",
];

/** Hints we look for in anchor href / link text to discover useful subpages. */
const DISCOVERY_HINTS: Array<{ kind: string; re: RegExp }> = [
  { kind: "about",     re: /\b(about|company|who-we-are|our[-_]story)\b/i },
  { kind: "customers", re: /\b(customers|case[-_ ]?stud(y|ies)|stories)\b/i },
  { kind: "pricing",   re: /\bpricing\b/i },
  { kind: "news",      re: /\b(news|newsroom|press|media)\b/i },
  { kind: "careers",   re: /\b(careers?|jobs|hiring|join[-_]us)\b/i },
  { kind: "products",  re: /\b(products?|solutions|platform)\b/i },
  { kind: "enterprise",re: /\b(enterprise|partners?|developers?)\b/i },
];

export const websiteConnector: Connector = {
  name: "website",
  sourceType: "website",
  reliabilityBaseline: 0.45,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    if (!ctx.website) return [];
    const seed = normaliseUrl(ctx.website);
    const safety = await assertSafePublicUrl(seed);
    if (!safety.ok) return [];
    const seedUrl = safety.url.toString();
    const baseDomain = domainFromUrl(seedUrl);
    if (!baseDomain) return [];

    const timeoutMs = ctx.timeoutMs ?? WEBSITE_TIMEOUT_MS;
    const fetchedHtml = new Map<string, string>();   // URL → HTML
    const fetchedText = new Map<string, string>();   // URL → readable text hash key

    const homepageHtml = await safeFetchText(seedUrl, {
      timeoutMs,
      maxBytes: WEBSITE_MAX_BYTES,
      allowedContentTypes: ["text/html", "application/xhtml+xml", "text/plain"],
    });
    if (!homepageHtml) return [];
    fetchedHtml.set(seedUrl, homepageHtml);

    // Decide whether to swap to an English canonical/hreflang variant.
    const englishSeed = pickEnglishVariant(seedUrl, homepageHtml, baseDomain);
    let primaryUrl = seedUrl;
    let primaryHtml = homepageHtml;
    if (englishSeed && englishSeed !== seedUrl) {
      const englishSafety = await assertSafePublicUrl(englishSeed);
      if (englishSafety.ok) {
        const candidateUrl = englishSafety.url.toString();
        if (sameRegistrableDomain(candidateUrl, baseDomain)) {
          const html = await safeFetchText(candidateUrl, {
            timeoutMs,
            maxBytes: WEBSITE_MAX_BYTES,
            allowedContentTypes: ["text/html", "application/xhtml+xml", "text/plain"],
          });
          if (html) {
            fetchedHtml.set(candidateUrl, html);
            primaryUrl = candidateUrl;
            primaryHtml = html;
          }
        }
      }
    }

    // Build candidate URL set.
    const candidates = new Set<string>();
    candidates.add(primaryUrl);
    for (const path of CANDIDATE_PATHS) {
      try { candidates.add(new URL(path, primaryUrl).toString()); }
      catch { /* ignore */ }
    }
    for (const a of extractAnchorHrefs(primaryHtml, primaryUrl)) {
      if (!sameRegistrableDomain(a.href, baseDomain)) continue;
      // Drop URLs with query strings or fragments — keep it simple.
      let cleaned: string;
      try {
        const u = new URL(a.href);
        u.hash = "";
        u.search = "";
        cleaned = u.toString();
      } catch { continue; }
      // Drop file extensions we can't usefully strip (PDFs etc. require
      // separate handling and aren't HTML).
      if (/\.(pdf|zip|csv|xls[x]?|docx?|png|jpe?g|gif|webp|mp4|mov|svg)(\/|$)/i.test(cleaned)) {
        continue;
      }
      const blob = `${a.text} ${a.href}`;
      if (DISCOVERY_HINTS.some(({ re }) => re.test(blob))) {
        candidates.add(cleaned);
      }
      if (candidates.size > MAX_PAGES * 4) break; // bound exploration cost
    }

    const ordered = orderCandidates(Array.from(candidates), primaryUrl);
    const pages: Array<{ url: string; html: string }> = [];
    for (const candidate of ordered) {
      if (pages.length >= MAX_PAGES) break;
      if (!sameRegistrableDomain(candidate, baseDomain)) continue;
      let html = fetchedHtml.get(candidate) ?? null;
      if (!html) {
        const safetyCheck = await assertSafePublicUrl(candidate);
        if (!safetyCheck.ok) continue;
        html = await safeFetchText(safetyCheck.url.toString(), {
          timeoutMs,
          maxBytes: WEBSITE_MAX_BYTES,
          allowedContentTypes: ["text/html", "application/xhtml+xml", "text/plain"],
        });
        if (!html) continue;
        fetchedHtml.set(candidate, html);
      }
      // De-dupe by text hash: bail if the readable content matches a prior page.
      const readable = extractReadable(html, candidate);
      const key = readableHash(readable);
      if (key && fetchedText.has(key)) continue;
      if (key) fetchedText.set(key, candidate);
      pages.push({ url: candidate, html });
    }

    if (pages.length === 0) return [];

    const results: ConnectorResult[] = [];
    let pageIndex = 0;
    for (const { url, html } of pages) {
      const readable = extractReadable(html, url);
      const title = readable.title || extractTitle(html) || `${ctx.companyName} — website`;
      const description = readable.description || extractMetaDescription(html) || "";
      const domain = domainFromUrl(url);
      const text = readable.text || stripHtml(html).slice(0, 20_000);
      const path = pathOf(url) || "/";
      const pageKind = classifyPath(path);
      results.push({
        title: pageKind === "homepage" ? title : `${title} — ${path}`,
        url,
        sourceType: "website",
        publisher: domain,
        domain,
        rawText: html.slice(0, 40_000),
        extractedText: description ? `${description}\n\n${text}` : text,
        reliabilityScore: 0.45,
        metadata: {
          description,
          pagePath: path,
          pageIndex,
          pageKind,
          canonicalUrl: readable.canonicalUrl,
          language: readable.language,
          hreflangCount: readable.hreflang.length,
          h1: readable.h1.slice(0, 4),
          h2: readable.h2.slice(0, 8),
          listItemCount: readable.listItems.length,
          paragraphCount: readable.paragraphs.length,
        },
      });
      pageIndex++;
    }
    return results;
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

/**
 * Pick an English-language canonical/hreflang variant when the homepage
 * appears localised. Returns the original seed URL when nothing better is
 * available. Always restricted to the same registrable domain so we don't
 * follow cross-domain canonical links.
 */
export function pickEnglishVariant(seedUrl: string, html: string, baseDomain: string): string | undefined {
  const langMatch = html.match(/<html[^>]*\blang=["']([^"']+)["']/i);
  const lang = (langMatch?.[1] || "").toLowerCase();
  const homepageIsEnglish = lang.startsWith("en");

  // Canonical link is the most authoritative hint.
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i))?.[1];

  const hreflangs = extractHreflang(html, seedUrl);
  const englishAlt = hreflangs.find((h) => h.lang === "en" || h.lang === "x-default" || h.lang.startsWith("en-"));

  // If homepage is already English, prefer it unless canonical points to a
  // distinctly different same-domain English URL we should follow.
  if (homepageIsEnglish) {
    if (canonical) {
      try {
        const abs = new URL(canonical, seedUrl).toString();
        if (sameRegistrableDomain(abs, baseDomain) && abs !== seedUrl) return abs;
      } catch { /* ignore */ }
    }
    return seedUrl;
  }

  // Homepage is non-English (or unknown). Prefer hreflang=en, then canonical.
  if (englishAlt) {
    try {
      const abs = new URL(englishAlt.href, seedUrl).toString();
      if (sameRegistrableDomain(abs, baseDomain)) return abs;
    } catch { /* ignore */ }
  }
  if (canonical) {
    try {
      const abs = new URL(canonical, seedUrl).toString();
      if (sameRegistrableDomain(abs, baseDomain)) return abs;
    } catch { /* ignore */ }
  }
  return seedUrl;
}

function sameRegistrableDomain(url: string, baseDomain: string): boolean {
  const d = domainFromUrl(url);
  if (!d || !baseDomain) return false;
  return d === baseDomain || d.endsWith(`.${baseDomain}`) || baseDomain.endsWith(`.${d}`);
}

function pathOf(url: string): string {
  try { return new URL(url).pathname.replace(/\/+$/, "") || "/"; }
  catch { return "/"; }
}

function classifyPath(path: string): string {
  const p = path.toLowerCase();
  if (p === "/" || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/.test(p)) return "homepage";
  if (/about|company|story/.test(p)) return "about";
  if (/customer|case-?stud|stories/.test(p)) return "customers";
  if (/pricing/.test(p)) return "pricing";
  if (/news|press|newsroom|media/.test(p)) return "news";
  if (/career|job|hiring/.test(p)) return "careers";
  if (/product|solution|platform/.test(p)) return "products";
  if (/enterprise|partner|developer/.test(p)) return "enterprise";
  return "other";
}

/**
 * Order candidates with the homepage first, then by classification priority,
 * to ensure that when we hit MAX_PAGES we've kept the most valuable ones.
 */
function orderCandidates(urls: string[], primary: string): string[] {
  const priority: Record<string, number> = {
    homepage: 0, about: 1, customers: 2, pricing: 3, products: 4,
    news: 5, careers: 6, enterprise: 7, other: 8,
  };
  return urls
    .map((u) => ({ u, kind: u === primary ? "homepage" : classifyPath(pathOf(u)) }))
    .sort((a, b) => (priority[a.kind] ?? 9) - (priority[b.kind] ?? 9))
    .map(({ u }) => u);
}

function readableHash(r: ReadableExtraction): string {
  // Stable but cheap text key for dedup. Title + first 400 chars of body.
  const body = (r.text || "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (!body) return "";
  return `${(r.title || "").trim()}::${body}`;
}
