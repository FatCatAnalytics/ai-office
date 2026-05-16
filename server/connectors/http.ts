// Stage 6: small HTTP helpers with a sane default timeout and a polite UA.
// Connectors funnel all network access through these so we have one place to
// tune retries, headers, and the abort-controller timeout pattern.

const DEFAULT_TIMEOUT_MS = 10_000;
const USER_AGENT = "Axl.ai/0.6 (+https://github.com/FatCatAnalytics/ai-office)";

export interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export async function safeFetch(url: string, opts: FetchOpts = {}): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": USER_AGENT, ...(opts.headers ?? {}) },
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function safeFetchText(url: string, opts: FetchOpts = {}): Promise<string | null> {
  const res = await safeFetch(url, opts);
  if (!res || !res.ok) return null;
  try { return await res.text(); } catch { return null; }
}

export async function safeFetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  const res = await safeFetch(url, { ...opts, headers: { accept: "application/json", ...(opts.headers ?? {}) } });
  if (!res || !res.ok) return null;
  try { return (await res.json()) as T; } catch { return null; }
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
