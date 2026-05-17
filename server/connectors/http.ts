// Stage 6: small HTTP helpers with a sane default timeout and a polite UA.
// Connectors funnel all network access through these so we have one place to
// tune retries, headers, and the abort-controller timeout pattern.
//
// Stage 6.x.1 hardening: every outbound request goes through assertSafePublicUrl
// first, redirects are followed manually with a low limit so each hop is
// re-validated, and response size + content-type are capped to prevent abuse.

import { assertSafePublicUrl, UrlSafetyOptions } from "./urlSafety";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT =
  process.env.AXL_HTTP_USER_AGENT ||
  "Axl.ai/0.6 (+https://github.com/FatCatAnalytics/ai-office; contact: research@axl.ai)";
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;        // 5 MiB
const DEFAULT_MAX_REDIRECTS = 3;

export interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  maxBytes?: number;
  maxRedirects?: number;
  /** Restrict accepted Content-Type prefixes (case-insensitive). */
  allowedContentTypes?: string[];
  /** Bypass for trusted hostnames (e.g. SEC EDGAR). Use sparingly. */
  urlSafety?: UrlSafetyOptions;
}

export interface SafeFetchOutcome {
  res: Response | null;
  reason?: string;        // populated when res === null and we want a user-visible reason
}

export async function safeFetch(url: string, opts: FetchOpts = {}): Promise<Response | null> {
  const out = await safeFetchDetailed(url, opts);
  return out.res;
}

export async function safeFetchDetailed(url: string, opts: FetchOpts = {}): Promise<SafeFetchOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const headers = {
    "user-agent": DEFAULT_USER_AGENT,
    ...(process.env.AXL_HTTP_FROM ? { from: process.env.AXL_HTTP_FROM } : {}),
    ...(opts.headers ?? {}),
  };

  let currentUrl = url;
  let hop = 0;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { res: null, reason: "request timed out" };

    const safety = await assertSafePublicUrl(currentUrl, opts.urlSafety);
    if (!safety.ok) return { res: null, reason: safety.reason };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), remaining);
    let res: Response;
    try {
      res = await fetch(safety.url.toString(), {
        signal: ctrl.signal,
        headers,
        redirect: "manual",
      });
    } catch {
      clearTimeout(timer);
      return { res: null, reason: "network error" };
    }
    clearTimeout(timer);

    // 3xx with a Location header → re-validate and continue.
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      hop++;
      if (hop > maxRedirects) return { res: null, reason: "too many redirects" };
      const loc = res.headers.get("location") || "";
      try { currentUrl = new URL(loc, safety.url).toString(); }
      catch { return { res: null, reason: "invalid redirect target" }; }
      // Drain body to free socket; ignore errors.
      try { await res.body?.cancel(); } catch { /* noop */ }
      continue;
    }

    return { res };
  }
}

export async function safeFetchText(url: string, opts: FetchOpts = {}): Promise<string | null> {
  const { res } = await safeFetchDetailed(url, opts);
  if (!res || !res.ok) return null;
  return await readBodyWithLimits(res, opts) ?? null;
}

export async function safeFetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  const merged: FetchOpts = {
    ...opts,
    headers: { accept: "application/json", ...(opts.headers ?? {}) },
    allowedContentTypes: opts.allowedContentTypes ?? ["application/json", "text/json", "application/vnd.api+json"],
  };
  const text = await safeFetchText(url, merged);
  if (text == null) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

async function readBodyWithLimits(res: Response, opts: FetchOpts): Promise<string | null> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (opts.allowedContentTypes && opts.allowedContentTypes.length > 0) {
    const ok = opts.allowedContentTypes.some((p) => ct.startsWith(p.toLowerCase()));
    if (!ok) {
      try { await res.body?.cancel(); } catch { /* noop */ }
      return null;
    }
  }
  // Honour Content-Length pre-check when present.
  const cl = res.headers.get("content-length");
  if (cl) {
    const n = parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      try { await res.body?.cancel(); } catch { /* noop */ }
      return null;
    }
  }

  if (!res.body) {
    try { return await res.text(); } catch { return null; }
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* noop */ }
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  // Decode as UTF-8 (best-effort; non-UTF-8 sources will still produce something usable for stripHtml).
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: false }).decode(buf); } catch { return null; }
}

// Strip HTML to plain text — enough for claim extraction in the MVP.
// Drops <script>/<style> blocks and collapses whitespace; we don't try to
// preserve structure here.
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, " ") : undefined;
}

export function extractMetaDescription(html: string): string | undefined {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  return m ? m[1].trim() : undefined;
}

// Stage 6.3: structured text extraction for richer official-site evidence.
//
// extractReadable() strips chrome (nav/header/footer/aside/cookie banners),
// then pulls the main readable content as a deterministic block of plain
// text. Each section is separated by a newline so claim extraction can split
// reliable sentences. We keep this rule-based — no DOM parser dependency.
export interface ReadableExtraction {
  title?: string;
  description?: string;
  h1: string[];
  h2: string[];
  paragraphs: string[];
  listItems: string[];
  language?: string;
  canonicalUrl?: string;
  hreflang: Array<{ lang: string; href: string }>;
  text: string;             // composed plain-text body, capped
}

const READABLE_TEXT_CAP = 20_000;
const READABLE_PARA_CAP = 60;
const READABLE_LIST_CAP = 80;

export function extractReadable(html: string, baseUrl?: string): ReadableExtraction {
  if (!html) {
    return { h1: [], h2: [], paragraphs: [], listItems: [], hreflang: [], text: "" };
  }

  const language = extractHtmlLang(html);
  const canonicalUrl = extractCanonical(html, baseUrl);
  const hreflang = extractHreflang(html, baseUrl);

  // Strip chrome and noisy regions before tag extraction. We do this on the
  // raw HTML so the per-tag regexes don't pick up nav links.
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    // Common cookie banners and dialogs (id/class hints).
    .replace(/<[^>]+(id|class)=["'][^"']*(cookie|consent|onetrust|gdpr|banner)[^"']*["'][\s\S]*?<\/[^>]+>/gi, " ");

  const title = extractTitle(html);
  const description = extractMetaDescription(html);

  const h1 = collectTagText(cleaned, "h1", 6);
  const h2 = collectTagText(cleaned, "h2", 12);
  const paragraphs = collectTagText(cleaned, "p", READABLE_PARA_CAP)
    .filter((s) => s.length >= 30);
  const listItems = collectTagText(cleaned, "li", READABLE_LIST_CAP)
    .filter((s) => s.length >= 12 && s.length <= 400);

  const blocks: string[] = [];
  if (description) blocks.push(description);
  if (h1.length) blocks.push(h1.join("\n"));
  if (h2.length) blocks.push(h2.join("\n"));
  if (paragraphs.length) blocks.push(paragraphs.join("\n"));
  if (listItems.length) blocks.push(listItems.map((s) => `• ${s}`).join("\n"));
  const text = blocks.join("\n\n").slice(0, READABLE_TEXT_CAP);

  return {
    title,
    description,
    h1,
    h2,
    paragraphs,
    listItems,
    language,
    canonicalUrl,
    hreflang,
    text,
  };
}

function collectTagText(html: string, tag: string, max: number): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of Array.from(html.matchAll(re))) {
    const text = stripHtml(m[1]).trim();
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function extractHtmlLang(html: string): string | undefined {
  const m = html.match(/<html[^>]*\blang=["']([^"']+)["']/i);
  return m ? m[1].trim().toLowerCase() : undefined;
}

function extractCanonical(html: string, baseUrl?: string): string | undefined {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  if (!m) return undefined;
  try { return baseUrl ? new URL(m[1], baseUrl).toString() : m[1]; }
  catch { return undefined; }
}

export function extractHreflang(html: string, baseUrl?: string): Array<{ lang: string; href: string }> {
  const out: Array<{ lang: string; href: string }> = [];
  const re = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
  for (const m of Array.from(html.matchAll(re))) {
    const tag = m[0];
    const lang = (tag.match(/\bhreflang=["']([^"']+)["']/i) || [])[1];
    const href = (tag.match(/\bhref=["']([^"']+)["']/i) || [])[1];
    if (!lang || !href) continue;
    try {
      const abs = baseUrl ? new URL(href, baseUrl).toString() : href;
      out.push({ lang: lang.toLowerCase(), href: abs });
    } catch { /* skip */ }
  }
  return out;
}

/**
 * Extract all anchor hrefs from HTML, resolved against `baseUrl` when given.
 * Returns absolute URLs; relative or javascript: / mailto: targets are dropped.
 */
export function extractAnchorHrefs(html: string, baseUrl?: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of Array.from(html.matchAll(re))) {
    const raw = m[1].trim();
    if (!raw || /^(javascript:|mailto:|tel:|#)/i.test(raw)) continue;
    try {
      const abs = baseUrl ? new URL(raw, baseUrl).toString() : raw;
      if (!/^https?:/i.test(abs)) continue;
      const text = stripHtml(m[2]).trim();
      out.push({ href: abs, text });
    } catch { /* skip */ }
  }
  return out;
}
