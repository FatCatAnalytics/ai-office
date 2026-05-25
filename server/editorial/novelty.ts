// Stage 6.7 — Anti-repeat / novelty guard for The Analytical Banker weekly
// article suggestion + final issue pipeline.
//
// Why this exists: the editorial-lead kept proposing this week's angle on the
// same shape as last week's (e.g. two consecutive "NII / mid-market lending"
// pieces with near-identical headline framing). The 5.x "rotation bias" hint
// inside the angle task wasn't enough on its own — there was no machine
// check, just a soft instruction. This module gives the orchestrator a
// deterministic similarity score it can use to (a) inject recent topics into
// the angle/final prompts so the LLM avoids them up front, and (b) flag a
// candidate after-the-fact when the chosen angle still ends up too close to
// a recent issue.
//
// Scope: deliberately small. Token-set Jaccard + bigram overlap + title-token
// overlap over the article's title + headings + first paragraph. No external
// deps, no LLM call, no TF-IDF index — just enough signal to catch the
// "this is the same article as last week" case the user complained about.

import type { ProjectFile, Project } from "@shared/schema";

// ── Tunables ───────────────────────────────────────────────────────────────
// Threshold above which a candidate is considered too similar to a recent
// issue. Calibrated against the test fixtures in script/test-banker-novelty.ts
// — same-topic same-angle scores ~0.45–0.65, same-bank-theme-different-angle
// scores ~0.05–0.15, and unrelated topics score < 0.10. We sit at 0.40 so
// the "different angle on the same bank" case has a wide margin (~3-5x)
// while the "this is last week's article with a different headline" case
// still fails reliably. The blended Dice+overlap formulation gives natural
// scores in the 0.40–0.70 band for repeats — lower than pure Jaccard but
// still cleanly separated from genuinely novel candidates.
export const SIMILARITY_THRESHOLD = 0.40;

// How many recent issues to consider when checking for repeats. Stage 6.7
// targets "last 4–8 weeks" per the user's brief; we default to 8 issues and
// 8 runner-ups. The prompt-side recent-topics list is capped at 8 entries so
// the model isn't drowning in context.
export const RECENT_ISSUE_LIMIT = 8;
export const RECENT_TOPICS_PROMPT_LIMIT = 8;

// ── Article signature ──────────────────────────────────────────────────────
// A signature is the small bag-of-features we compare. Computed once per
// candidate or recent issue and reused for every pairwise comparison.

export interface IssueSignature {
  // Source identifier — filename for stored issues, agent task label for
  // a fresh candidate. Used only for event messages / debugging.
  source: string;
  // The article's H1 (no leading "# ", lowercased, whitespace-collapsed).
  // Empty if the file had no H1 or if the candidate is being judged on
  // angle-task output rather than a full draft.
  title: string;
  // Lower-cased ## / ### headings, in order. Often the most discriminating
  // part — two issues on "NII compression" tend to share heading shapes.
  headings: string[];
  // First paragraph after the title (or the whole candidate text, trimmed,
  // for short angle-task outputs). Lower-cased, whitespace-collapsed.
  summary: string;
  // Content-word token set (≥4 chars, stopwords removed). Used for the
  // Jaccard similarity over the combined title + headings + summary surface.
  terms: Set<string>;
  // Adjacent-word bigrams over the same surface, also stopword-filtered.
  // Catches "interest margin" / "margin compression" style phrase repeats
  // that the token set alone misses when synonyms shift slightly.
  bigrams: Set<string>;
}

const STOPWORDS = new Set([
  "the","and","for","with","that","this","from","into","over","under","than",
  "then","when","what","which","while","there","their","they","them","these",
  "those","about","after","again","also","being","could","does","each","ever",
  "every","first","have","here","just","like","make","many","more","most",
  "much","must","only","other","same","some","such","take","very","were",
  "will","would","your","yours","ours","theirs","still","upon","weeks","week",
  "year","years","issue","issues","article","newsletter","banker","analytical",
]);

// Words ≥4 chars, alphanumeric. We keep numbers too (regulatory codes like
// "MREL" or rates like "5.25") since those are highly discriminating.
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w));
}

function bigramsOf(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

// Parse an article (issue-*.md, runner-up-*.md, or a free-form candidate
// description) into the comparable signature. `source` is purely cosmetic —
// it's surfaced in event messages so the operator knows which past issue
// triggered the rejection.
export function extractIssueSignature(content: string, source: string): IssueSignature {
  const text = (content ?? "").replace(/\r\n?/g, "\n").trim();
  const lines = text.split("\n");

  // H1 — first line starting with "# " (single hash). Skip blank lines so
  // a leading "Producing final files for issue-17." preamble doesn't break
  // detection; only an actual "# Title" counts as the title.
  let title = "";
  let titleLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+?)\s*$/);
    if (m) { title = m[1]; titleLineIdx = i; break; }
  }

  // Headings — every ## / ### line (lowercased), in document order.
  const headings: string[] = [];
  for (const line of lines) {
    const m = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (m) headings.push(m[1].toLowerCase().trim());
  }

  // Summary — combine the first several body paragraphs after the title so
  // a short "*For finance leaders*" sub-line doesn't BECOME the summary on
  // its own. We skip the audience-tag italic sub-line, skip headings, and
  // accumulate until we have enough content or run out of lines.
  let summary = "";
  if (titleLineIdx >= 0) {
    const after = lines.slice(titleLineIdx + 1);
    const para: string[] = [];
    let joined = "";
    for (const line of after) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^#{1,6}\s+/.test(trimmed)) continue;
      // Skip the audience-tag italic sub-line ("*For finance leaders*",
      // "*For growing businesses*") — short, italic-wrapped, no other
      // punctuation. Keeping it would let it dominate short fixtures.
      if (/^\*[^*]+\*$/.test(trimmed) && trimmed.length < 50) continue;
      // Strip stray italic wrappers but keep the inner text.
      const stripped = trimmed.replace(/^\*+\s*|\s*\*+$/g, "");
      para.push(stripped);
      joined = para.join(" ");
      if (joined.length > 800) break;
    }
    summary = joined.toLowerCase();
  }
  if (!summary) {
    // No structural title/paragraph — treat the whole text as the summary so
    // angle-task notes still get a meaningful signature.
    summary = text.toLowerCase();
  }

  const surface = `${title.toLowerCase()} ${headings.join(" ")} ${summary}`;
  const tokens = tokenise(surface);
  const terms = new Set(tokens);
  const bigrams = new Set(bigramsOf(tokens));

  return {
    source,
    title: title.toLowerCase().replace(/\s+/g, " ").trim(),
    headings,
    summary: summary.slice(0, 800),
    terms,
    bigrams,
  };
}

// ── Similarity ─────────────────────────────────────────────────────────────
// Three blended signals:
//   1. Token Jaccard on the full surface — broad topical overlap.
//   2. Bigram Jaccard — catches phrase-level repetition (e.g. "interest
//      margin", "deposit beta") that single tokens miss when synonyms shift.
//   3. Title token Jaccard — heavy weight because a near-identical headline
//      is the loudest user-visible signal of "same article as last week".
// Weights sum to 1.0. Calibrated against the fixtures, not theoretical.

function intersectSize<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of smaller) if (larger.has(v)) n++;
  return n;
}

// Sørensen–Dice coefficient: 2 * |A ∩ B| / (|A| + |B|). Reads higher than
// Jaccard for partial overlap, which matches our intuition that two issues
// sharing 60% of content words are "very similar" — Jaccard would only
// report ~43% for that case. We use Dice for the body-term signal because
// even a clear repeat-of-last-week tends to introduce 30-40% fresh words
// from the new news cycle, which Jaccard penalises too aggressively.
function dice<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = intersectSize(a, b);
  const denom = a.size + b.size;
  return denom === 0 ? 0 : (2 * inter) / denom;
}

// Overlap coefficient: |A ∩ B| / min(|A|, |B|). Catches the case where a
// candidate is essentially a subset of last week's content — even if the
// candidate adds material, if it doesn't drop much, this score stays high.
function overlap<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  return intersectSize(a, b) / Math.min(a.size, b.size);
}

export function similarityScore(a: IssueSignature, b: IssueSignature): number {
  // Body terms — blend Dice (symmetric) with overlap (catches subset).
  // Both signals tend to agree, but on a short candidate vs. a long prior
  // issue, overlap is the cleaner read.
  const termDice = dice(a.terms, b.terms);
  const termOverlap = overlap(a.terms, b.terms);
  const termScore = 0.5 * termDice + 0.5 * termOverlap;

  // Bigram Dice — phrase-level repetition. "Deposit beta" / "interest
  // margin" / "stability report" show up in both versions of a repeat
  // article and rarely in unrelated ones, so this signal is sharp.
  const bigramScore = dice(a.bigrams, b.bigrams);

  // Title tokens — pulled from the title strings directly so a missing
  // headline (candidate is just an angle blurb) degrades gracefully to 0.
  const titleA = new Set(tokenise(a.title));
  const titleB = new Set(tokenise(b.title));
  const titleScore = (titleA.size === 0 || titleB.size === 0)
    ? 0
    : dice(titleA, titleB);

  // 55% body terms, 30% bigrams, 15% title. Body terms carry the most
  // weight because they cover the broadest surface; title is the smallest
  // weight because it's often absent on angle-task outputs (no H1 yet)
  // and we don't want a missing title to swing the verdict.
  return 0.55 * termScore + 0.30 * bigramScore + 0.15 * titleScore;
}

// ── Recent-issues loader ───────────────────────────────────────────────────
// Walks every prior project spawned from the same template, collects the
// issue-*.md (and optionally runner-up-*.md) files, and returns their
// signatures newest-first. Excludes the current project so the final task's
// own files don't show up as "recent issues" when we re-check the runner-up
// against the chosen article.

export interface RecentIssue {
  signature: IssueSignature;
  filename: string;
  projectId: number;
  createdAt: number;
}

// Read a file's content. The orchestrator passes us already-loaded project
// files (it owns the storage layer); for testing we accept an explicit
// reader so the tests can build fixtures without touching disk.
export type FileReader = (filePath: string) => string | null;

export interface LoadRecentIssuesOpts {
  // Only consider files matching this predicate. Defaults to issue-*.md.
  match?: (filename: string) => boolean;
  // Cap on number of issues returned.
  limit?: number;
  // Optional file reader override (defaults to fs.readFileSync utf8).
  readFile?: FileReader;
  // Exclude files belonging to this project id (used when checking the
  // runner-up against the freshly-written main issue's recent history).
  excludeProjectId?: number;
}

const ISSUE_FILENAME_RE = /^issue-\d+\.md$/i;
const RUNNER_UP_FILENAME_RE = /^runner-up-\d+\.md$/i;

export function isIssueFilename(name: string): boolean {
  return ISSUE_FILENAME_RE.test(name);
}
export function isRunnerUpFilename(name: string): boolean {
  return RUNNER_UP_FILENAME_RE.test(name);
}

// Pure version — caller supplies the list of candidate files. The
// orchestrator builds this list from storage.getProjects() filtered to the
// same templateId, then storage.getProjectFiles() per project, in
// newest-first order. Splitting the loader keeps this module storage-free
// and trivially unit-testable.
export function buildRecentIssuesFromFiles(
  files: Array<Pick<ProjectFile, "filename" | "filePath" | "projectId" | "createdAt">>,
  opts: LoadRecentIssuesOpts = {},
): RecentIssue[] {
  const match = opts.match ?? isIssueFilename;
  const limit = opts.limit ?? RECENT_ISSUE_LIMIT;
  const read = opts.readFile ?? defaultReadFile;
  const excludeProjectId = opts.excludeProjectId;

  const eligible = files
    .filter(f => match(f.filename))
    .filter(f => excludeProjectId == null || f.projectId !== excludeProjectId)
    // Newest first by createdAt — caller may already have ordered them but
    // we don't trust the caller's order here.
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);

  const recents: RecentIssue[] = [];
  for (const f of eligible) {
    const content = read(f.filePath);
    if (content == null || content.trim() === "") continue;
    recents.push({
      filename: f.filename,
      projectId: f.projectId,
      createdAt: f.createdAt,
      signature: extractIssueSignature(content, f.filename),
    });
  }
  return recents;
}

function defaultReadFile(filePath: string): string | null {
  // Defer the import so this module stays usable from contexts that mock
  // the file system (tests, dry runs).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs") as typeof import("fs");
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

// ── Decision helpers ───────────────────────────────────────────────────────

export interface NoveltyMatch {
  recent: RecentIssue;
  score: number;
}

// Returns the highest-scoring recent issue whose similarity to `candidate`
// is at or above the threshold. Null when nothing crosses the bar.
export function findTooSimilar(
  candidate: IssueSignature,
  recents: RecentIssue[],
  threshold = SIMILARITY_THRESHOLD,
): NoveltyMatch | null {
  let best: NoveltyMatch | null = null;
  for (const r of recents) {
    const score = similarityScore(candidate, r.signature);
    if (score >= threshold && (best == null || score > best.score)) {
      best = { recent: r, score };
    }
  }
  return best;
}

// All matches above threshold, sorted highest-first. Used by the orchestrator
// when it wants to surface every too-close prior issue in a single event,
// not just the worst offender.
export function findAllTooSimilar(
  candidate: IssueSignature,
  recents: RecentIssue[],
  threshold = SIMILARITY_THRESHOLD,
): NoveltyMatch[] {
  const matches: NoveltyMatch[] = [];
  for (const r of recents) {
    const score = similarityScore(candidate, r.signature);
    if (score >= threshold) matches.push({ recent: r, score });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

// ── Prompt injection helper ────────────────────────────────────────────────
// Produces the short "RECENT TOPICS (do not repeat)" block we append to the
// angle / final task descriptions. Keeps it tight — title + one-line summary
// per recent issue, capped at RECENT_TOPICS_PROMPT_LIMIT entries — so the
// LLM has clear signal without burning context on full article bodies.

export function summariseRecentTopics(
  recents: RecentIssue[],
  limit = RECENT_TOPICS_PROMPT_LIMIT,
): string {
  if (recents.length === 0) return "";
  const top = recents.slice(0, limit);
  const lines: string[] = [
    "RECENT ISSUES (do not repeat these themes — pick a materially distinct angle):",
  ];
  for (const r of top) {
    const title = r.signature.title || r.filename;
    // 200-char summary clip — enough to recognise the topic, not enough to
    // anchor the model on phrasing from the prior issue.
    const summary = r.signature.summary
      .replace(/\s+/g, " ")
      .slice(0, 200)
      .trim();
    lines.push(`  • ${r.filename} — "${title}"${summary ? ` — ${summary}` : ""}`);
  }
  lines.push(
    "If your strongest candidate overlaps materially with any of the above, " +
    "choose the next materially distinct angle. The runner-up must also be " +
    "distinct from this week's chosen angle AND from the list above.",
  );
  return lines.join("\n");
}

// Convenience predicate — true when a project's template is the Analytical
// Banker weekly newsletter. Lives here (rather than as a string literal in
// the orchestrator) because the novelty guard is the only consumer of this
// branch — the rest of the orchestrator is template-agnostic.
//
// We accept the template object directly so the orchestrator doesn't need
// to import the constant from storage.ts (which would create a cycle).
export function isAnalyticalBankerTemplate(
  template: { name?: string | null } | null | undefined,
): boolean {
  if (!template || !template.name) return false;
  return template.name.trim().toLowerCase().startsWith("the analytical banker");
}

// Format a NoveltyMatch as a short event-message string for the activity feed.
export function formatNoveltyMatch(match: NoveltyMatch): string {
  const pct = (match.score * 100).toFixed(0);
  const title = match.recent.signature.title || match.recent.filename;
  return `Rejected article candidate as too similar to recent issue: "${title}" (${match.recent.filename}, ${pct}% similar)`;
}
