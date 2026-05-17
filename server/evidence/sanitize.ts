// Stage 6.1: Text sanitization helpers shared by the website extractor and
// the claim extractor.
//
// The Stage 6 smoke test against Stripe surfaced two classes of garbage that
// were ending up as "claims":
//   - Raw HTML chunks (script blocks, CSS, inline style attributes, markdown
//     link blobs from pasted decks).
//   - Google News redirect URLs with encoded parameters that happened to
//     contain digit sequences our regexes matched as money.
//
// sanitizeForClaims() returns a cleaned text where we have a fighting chance
// of extracting legitimate sentences. looksLikeJunk() is a per-sentence guard
// the claim extractor calls before pushing a candidate.

const HTML_TAG_RE = /<[^>]+>/g;
const HTML_ENTITY_RE = /&[a-zA-Z#0-9]+;/g;
const SCRIPT_BLOCK_RE = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK_RE = /<style[\s\S]*?<\/style>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const MARKDOWN_LINK_RE = /\[([^\]]{0,80})\]\((?:[^)]+)\)/g;
const DATA_URI_RE = /\bdata:[^\s;]+;[^\s,]+,[A-Za-z0-9+/=]+/g;
const BASE64_BLOB_RE = /[A-Za-z0-9+/]{60,}={0,2}/g;
const CSS_DECL_RE = /\b[a-z-]+\s*:\s*[^;{}]+;/gi;

const ENTITY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#39;/gi, "'"],
  [/&apos;/gi, "'"],
];

export function decodeEntities(s: string): string {
  let out = s;
  for (const [re, sub] of ENTITY_REPLACEMENTS) out = out.replace(re, sub);
  // Drop residual entities we don't translate.
  out = out.replace(HTML_ENTITY_RE, " ");
  return out;
}

/**
 * Heavy-handed sanitiser used before claim extraction. Removes script/style
 * blocks, comments, HTML tags, CSS declarations, raw URLs, markdown link
 * blobs, base64-ish chunks, and collapses whitespace. The goal is plain
 * prose. We accept losing some legitimate URLs in citations — the source row
 * still has the canonical `url` field for citation.
 */
export function sanitizeForClaims(input: string): string {
  if (!input) return "";
  let t = input;
  t = t.replace(SCRIPT_BLOCK_RE, " ");
  t = t.replace(STYLE_BLOCK_RE, " ");
  t = t.replace(HTML_COMMENT_RE, " ");
  // Replace markdown links with their visible text, dropping the URL.
  t = t.replace(MARKDOWN_LINK_RE, (_m, label) => (label ? String(label) : " "));
  // Strip remaining HTML tags.
  t = t.replace(HTML_TAG_RE, " ");
  t = decodeEntities(t);
  // Drop data URIs, base64 blobs, and CSS declarations that might survive a
  // markdown paste.
  t = t.replace(DATA_URI_RE, " ");
  t = t.replace(BASE64_BLOB_RE, " ");
  t = t.replace(CSS_DECL_RE, " ");
  // Strip raw URLs (Google redirect blobs are the worst offender).
  t = t.replace(URL_RE, " ");
  // Collapse whitespace.
  t = t.replace(/[ \t\r\n]+/g, " ");
  t = t.replace(/\s{2,}/g, " ");
  return t.trim();
}

/**
 * Reject sentences that are clearly not human-readable claims. Returns true
 * when the candidate should be skipped. We're conservative: better to drop a
 * borderline sentence than to surface a Google redirect URL as a "claim".
 */
export function looksLikeJunk(sentence: string): boolean {
  if (!sentence) return true;
  const s = sentence.trim();
  if (s.length < 12 || s.length > 600) return true;

  // Anything that still has obvious HTML/CSS markup in it.
  if (/<\/?[a-z][^>]*>/i.test(s)) return true;
  if (/\bclass\s*=|style\s*=|aria-/i.test(s)) return true;
  if (/\bfunction\s*\(|\bvar\s+\w+\s*=|\bconst\s+\w+\s*=/i.test(s)) return true;

  // Raw URLs in the middle of a sentence.
  if (URL_RE.test(s)) return true;
  URL_RE.lastIndex = 0;

  // Markdown link syntax.
  if (/\]\(\s*http/i.test(s)) return true;

  // Google redirect-style noise: long base64-ish chunks, ?url=, ?sa=, ?ved=.
  if (/[?&](?:url|sa|ved|usg|q)=/i.test(s)) return true;
  if (BASE64_BLOB_RE.test(s)) {
    BASE64_BLOB_RE.lastIndex = 0;
    return true;
  }
  BASE64_BLOB_RE.lastIndex = 0;

  // Density checks. A real human sentence has lots of letters relative to
  // punctuation/digits and few "weird" characters.
  const total = s.length;
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  const digits = (s.match(/\d/g) ?? []).length;
  const punct = (s.match(/[^\w\s]/g) ?? []).length;
  const spaces = (s.match(/\s/g) ?? []).length;
  if (letters / total < 0.55) return true;
  if (punct / total > 0.18) return true;
  if (digits / total > 0.35) return true;

  // A real sentence has multiple words.
  if (spaces < 2) return true;

  // Sentence-ending punctuation OR at least 5 words. Single fragments without
  // terminators tend to be navigation/CTA strings.
  const wordCount = s.split(/\s+/).length;
  if (wordCount < 4) return true;

  return false;
}

/**
 * Build a clean, short evidence quote from a sentence — used in claim
 * `evidenceQuote` and memo output.
 */
export function cleanEvidenceQuote(sentence: string, maxLen = 280): string {
  return sanitizeForClaims(sentence).slice(0, maxLen);
}
