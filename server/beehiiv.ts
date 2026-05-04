// ─── Beehiiv draft hookup — Stage 5.3 / 5.x.7 ────────────────────────────────
// When the editorial-lead's `final` task emits an issue-*.md file block, we
// POST it to Beehiiv as a draft post via the v2 Posts API. The user reviews
// the draft inside Beehiiv and presses Send when they want it to ship — we
// never auto-publish.
//
// API contract (Beehiiv API v2):
//   POST https://api.beehiiv.com/v2/publications/{publication_id}/posts
//   Headers: Authorization: Bearer <api_key>
//            Content-Type: application/json
//   Body:    { title, body_content (HTML), status: "draft" }
//
// Plan note (Stage 5.x.7): the Posts API is enterprise-only. Standard, Scale,
// and Max plans get HTTP 403 SEND_API_NOT_ENTERPRISE_PLAN even when posting
// status: "draft" — Beehiiv has no parallel non-enterprise endpoint. We still
// attempt the call (forward-compat for enterprise upgrades), and on 403 with
// that specific error code we surface a `planRestricted` outcome so the
// orchestrator can emit a benign info event rather than a scary warning. The
// issue markdown is already on disk either way.
//
// Key/Publication-ID resolution mirrors the Tavily pattern: settings first
// (Office Floor → Settings), then process env fallback, friendly error
// messages when missing.
// ─────────────────────────────────────────────────────────────────────────────

import { storage } from "./storage";

// Resolve the Beehiiv API key. Settings UI takes precedence over env so the
// user can rotate without redeploying. Same pattern as resolveTavilyKey().
function resolveBeehiivKey(): string | undefined {
  const fromSettings = storage.getSetting("beehiiv_api_key");
  if (fromSettings && fromSettings.length > 10) return fromSettings;
  const fromEnv = process.env.BEEHIIV_API_KEY;
  if (fromEnv && fromEnv.length > 10) return fromEnv;
  return undefined;
}

// Publication ID is not a secret (it identifies which publication owns the
// draft) but lives in settings for the same UX reason: rotate without redeploy.
function resolveBeehiivPubId(): string | undefined {
  const fromSettings = storage.getSetting("beehiiv_publication_id");
  if (fromSettings && fromSettings.length > 5) return fromSettings;
  const fromEnv = process.env.BEEHIIV_PUBLICATION_ID;
  if (fromEnv && fromEnv.length > 5) return fromEnv;
  return undefined;
}

export function beehiivConfigured(): boolean {
  return !!resolveBeehiivKey() && !!resolveBeehiivPubId();
}

// ─── Markdown → HTML (intentionally tiny) ────────────────────────────────────
// We control the markdown shape (it's the editorial-lead's output following a
// fixed template), so a 60-line converter beats a 300-KB dependency. Handles
// every construct the editorial template emits:
//   • H1, H2, H3 sentence-case headers
//   • Italic sub-line (audience tag)
//   • Italic blockquote diagnostic
//   • Inline links [text](url)
//   • Inline emphasis *italic* and **bold**
//   • Em-dash, en-dash unchanged
//   • Paragraph breaks on blank lines
//   • Standard footer paragraph
// Anything fancier (tables, code blocks, images) is intentionally not in the
// editorial brand voice — if the agent emits some, they pass through as plain
// text rather than crash.
export function markdownToHtml(md: string): string {
  if (!md) return "";

  // Normalise line endings, then split on blank lines into "blocks".
  const text = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const blocks = text.split(/\n\s*\n/);

  const inline = (s: string): string => {
    // Order matters: escape, then bold (before italic so ** doesn't get
    // chewed by the * regex), then italic, then links.
    let out = s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // Bold: **text** → <strong>text</strong>
    out = out.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
    // Italic: *text* → <em>text</em>  (must not match leftover ** which we
    // already replaced; the regex requires non-* characters between markers).
    out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
    // Inline link: [text](url)
    out = out.replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_m, label, url) =>
        `<a href="${url}" target="_blank" rel="noopener">${label}</a>`,
    );
    return out;
  };

  const htmlBlocks: string[] = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    // Headers
    const h1 = block.match(/^# (.+)$/);
    if (h1) { htmlBlocks.push(`<h1>${inline(h1[1])}</h1>`); continue; }
    const h2 = block.match(/^## (.+)$/);
    if (h2) { htmlBlocks.push(`<h2>${inline(h2[1])}</h2>`); continue; }
    const h3 = block.match(/^### (.+)$/);
    if (h3) { htmlBlocks.push(`<h3>${inline(h3[1])}</h3>`); continue; }

    // Blockquote (handles the italic diagnostic question — single or multi-line)
    if (block.startsWith("> ")) {
      const inner = block
        .split("\n")
        .map(l => l.replace(/^>\s?/, ""))
        .join(" ")
        .trim();
      htmlBlocks.push(`<blockquote><p>${inline(inner)}</p></blockquote>`);
      continue;
    }

    // Bullet list (rare in this voice but support it)
    if (/^(\s*[-*]\s)/.test(block)) {
      const items = block
        .split("\n")
        .filter(l => /^\s*[-*]\s/.test(l))
        .map(l => `<li>${inline(l.replace(/^\s*[-*]\s/, ""))}</li>`);
      htmlBlocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Default: paragraph. Convert any remaining single line breaks to <br/>.
    const para = block.split("\n").map(inline).join("<br/>");
    htmlBlocks.push(`<p>${para}</p>`);
  }

  return htmlBlocks.join("\n");
}

// ─── Title & body extraction from the issue markdown ────────────────────────
// The editorial-lead emits:
//   # <issue title>
//   *For finance leaders*  (or *For growing businesses*, or omitted)
//
//   <body...>
//
// We pull the H1 as the Beehiiv post title (Beehiiv stores its own subtitle
// field separately; for now the audience sub-line stays in the body so it
// renders inside the email itself). Future: split it out into a Beehiiv
// `subtitle` when we confirm that field name in the API.
export function extractTitleAndBody(md: string): { title: string; body: string } {
  const text = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const m = text.match(/^# (.+)\n([\s\S]*)$/);
  if (!m) {
    // No H1 — fall back to whole content with a generic title so the user can
    // still see the draft in Beehiiv and rename it manually.
    return { title: "Untitled draft", body: text };
  }
  return { title: m[1].trim(), body: m[2].trim() };
}

// ─── Post the draft ─────────────────────────────────────────────────────────
export interface BeehiivPostResult {
  ok: true;
  postId?: string;
  webUrl?: string;
}
export interface BeehiivPostError {
  ok: false;
  error: string;
  // Stage 5.x.7: distinguish plan-restricted (HTTP 403 with
  // SEND_API_NOT_ENTERPRISE_PLAN) from generic failures so the orchestrator
  // can degrade gracefully — the markdown is already saved to disk, the user
  // just has to paste it into Beehiiv by hand on standard plans because the
  // Posts API is enterprise-only.
  planRestricted?: boolean;
}

export async function postBeehiivDraft(
  issueMarkdown: string,
  signal?: AbortSignal,
): Promise<BeehiivPostResult | BeehiivPostError> {
  const apiKey = resolveBeehiivKey();
  const pubId = resolveBeehiivPubId();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Beehiiv API key not configured. Paste it into Office Floor → Settings → Beehiiv.",
    };
  }
  if (!pubId) {
    return {
      ok: false,
      error:
        "Beehiiv Publication ID not configured. Paste it into Office Floor → Settings → Beehiiv.",
    };
  }

  const { title, body } = extractTitleAndBody(issueMarkdown);
  const bodyHtml = markdownToHtml(body);

  const url = `https://api.beehiiv.com/v2/publications/${encodeURIComponent(pubId)}/posts`;
  const payload = {
    title,
    body_content: bodyHtml,
    status: "draft",
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e) {
    return {
      ok: false,
      error: `Beehiiv network error: ${(e as Error).message ?? e}`,
    };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const planRestricted =
      res.status === 403 && /SEND_API_NOT_ENTERPRISE_PLAN/i.test(detail);
    return {
      ok: false,
      error: `Beehiiv ${res.status}: ${detail.slice(0, 300) || res.statusText}`,
      planRestricted,
    };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: true }; // 200 but non-JSON — still consider it success
  }

  // Beehiiv responses vary; pull the post ID and any web URL we can find for
  // the user to click through to the draft inside Beehiiv.
  const obj = (json as { data?: Record<string, unknown> })?.data ?? json;
  const postId = (obj as Record<string, unknown> | undefined)?.id as
    | string
    | undefined;
  const webUrl = ((obj as Record<string, unknown> | undefined)?.web_url ??
    (obj as Record<string, unknown> | undefined)?.preview_url) as
    | string
    | undefined;
  return { ok: true, postId, webUrl };
}
