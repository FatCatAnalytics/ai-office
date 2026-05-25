// Stage 6.7 smoke test for the Analytical Banker novelty guard.
//
// Run as `tsx script/test-banker-novelty.ts`. Exits non-zero on first
// failure. Deterministic — no network, no DB, no filesystem (uses an
// injected file reader).
//
// Regression baseline (matches the user's complaint):
//   - This week's suggested article on the same theme/angle as last week's
//     issue MUST be flagged as too similar.
//   - Same bank-sector theme with a materially different angle MUST pass.
//   - Unrelated topic (e.g. SME owner-operator dashboards vs bank NII)
//     MUST pass.
//   - Runner-up MUST also be checked against (a) the chosen article and
//     (b) recent issues.

import {
  SIMILARITY_THRESHOLD,
  extractIssueSignature,
  similarityScore,
  findTooSimilar,
  findAllTooSimilar,
  summariseRecentTopics,
  buildRecentIssuesFromFiles,
  isIssueFilename,
  isRunnerUpFilename,
  isAnalyticalBankerTemplate,
  formatNoveltyMatch,
} from "../server/editorial/novelty";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function eq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }
function truthy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: true }); }
function falsy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: false }); }
function approx(name: string, got: number, want: number, tol = 0.05) {
  cases.push({ name, got: Math.abs(got - want) <= tol, want: true });
}

// ── Fixtures — three real-ish weekly issues ────────────────────────────────

// "Last week" — the issue the user is complaining we are about to repeat.
const lastWeekIssue = `# The quiet risk in mid-market net interest margins

*For finance leaders*

Banks are quietly watching net interest margin compression eat into
quarterly results. The Bank of England's latest stability report names
deposit beta as the sharpest pressure point for mid-market lenders, and
the data backs it up — UK banks reported a 38bp NIM contraction in Q3.

## What the FPC actually said

The FPC noted that mid-market lenders are most exposed because their
funding mix skews toward retail deposits with sticky pricing.

## Why deposit beta matters here

When base rates fall, deposit costs lag — but on the way down the lag
runs the wrong direction for margins.

## The takeaway

Run a deposit beta sensitivity this week. If your model assumes 45%
pass-through and your actuals are 70%, your NIM forecast is wrong.

— Aksel
`;

// "This week's suggestion" — same theme, same angle, slightly different
// headline. This is exactly the case the user wants caught.
const thisWeekRepeat = `# Mid-market NIM compression isn't going away

*For finance leaders*

The Bank of England's stability report this week names net interest margin
compression as the dominant pressure on mid-market lenders. Deposit beta
is the culprit — banks reported another 30bp of NIM contraction this
quarter, and the FPC is warning that funding mix matters more than rate
direction.

## What the FPC actually said this time

The FPC again flagged that mid-market lenders are most exposed because
their funding mix skews toward retail deposits.

## Deposit beta is still the story

Pass-through to depositors lags base rate moves, and the lag works
against margins on the way down.

## The takeaway

Re-run last week's deposit beta sensitivity with the latest base-rate
expectations.

— Aksel
`;

// "Same theme, different angle" — also about UK banks and the FPC, but
// the angle is governance / board reporting, not NIM/deposit-beta. This
// should pass the novelty check.
const sameThemeDifferentAngle = `# What your board actually wants from the FPC report

*For finance leaders*

Most finance leaders read the FPC report once and file it. The board
will ask three questions about it within a week, and "I'll get back to
you" is the wrong answer. Here's the three-slide pack that survives a
non-executive's stare.

## Slide one — what changed

A one-sentence summary of the FPC's three new asks.

## Slide two — what it means for us

Your exposures, named.

## Slide three — what we're doing about it

Two concrete actions, one timeline.

## The takeaway

Build the three-slide deck before the next board meeting, not after.

— Aksel
`;

// "Unrelated topic" — SME owner-operator dashboard piece, no overlap
// with bank NIM or the FPC. Should pass cleanly.
const unrelatedTopic = `# The dashboard your FD won't ask for but actually needs

*For growing businesses*

If you run a £5M business, your FD is probably tracking cash and
revenue. Useful, not sufficient. The dashboard that actually changes
decisions tracks gross margin by product line and the trailing 13-week
cash burn.

## Why the standard P&L isn't enough

A monthly P&L tells you what happened. It doesn't tell you which
product is killing margin or which customer cohort is bleeding cash.

## The 13-week cash view

Roll a 13-week cash forecast every Friday afternoon.

## The takeaway

Build the gross-margin-by-product view this week. It's a half-day job
and it will outlive every other dashboard you have.

— Aksel
`;

// Another bank issue from two weeks ago — about Pillar 2 capital, not NIM.
// Used to verify that "same sector" doesn't trigger false positives.
const twoWeeksAgo = `# Why Pillar 2 buffers got expensive

*For finance leaders*

The PRA quietly raised its Pillar 2A expectation for several mid-market
lenders this quarter, and the cost of holding that buffer has crept up
with funding spreads.

## What the PRA actually wrote

A one-paragraph explanation of the Pillar 2A delta.

## The takeaway

Re-baseline your capital plan against the new Pillar 2A expectation.

— Aksel
`;

// ── 1) Signature extraction sanity checks ─────────────────────────────────

const sigLast = extractIssueSignature(lastWeekIssue, "issue-21.md");
eq("title parsed from H1",
   sigLast.title, "the quiet risk in mid-market net interest margins");
truthy("headings parsed", sigLast.headings.length >= 3);
truthy("summary captured", sigLast.summary.length > 50);
truthy("terms include 'margin'", sigLast.terms.has("margin"));
truthy("terms exclude stopwords", !sigLast.terms.has("the"));
truthy("bigrams include 'deposit beta'", sigLast.bigrams.has("deposit beta"));

// ── 2) Similarity scoring — the user's regression ─────────────────────────

const sigRepeat   = extractIssueSignature(thisWeekRepeat, "candidate.md");
const sigDistinct = extractIssueSignature(sameThemeDifferentAngle, "candidate.md");
const sigUnrelated = extractIssueSignature(unrelatedTopic, "candidate.md");
const sigP2       = extractIssueSignature(twoWeeksAgo, "issue-20.md");

const repeatScore     = similarityScore(sigLast, sigRepeat);
const distinctScore   = similarityScore(sigLast, sigDistinct);
const unrelatedScore  = similarityScore(sigLast, sigUnrelated);
const p2Score         = similarityScore(sigLast, sigP2);

truthy(`repeat score above threshold (got ${repeatScore.toFixed(3)})`,
       repeatScore >= SIMILARITY_THRESHOLD);
truthy(`distinct-angle score below threshold (got ${distinctScore.toFixed(3)})`,
       distinctScore < SIMILARITY_THRESHOLD);
truthy(`unrelated score well below threshold (got ${unrelatedScore.toFixed(3)})`,
       unrelatedScore < 0.20);
truthy(`pillar-2 score below threshold (got ${p2Score.toFixed(3)})`,
       p2Score < SIMILARITY_THRESHOLD);

// Score ordering — repeat must be the most similar of the four.
truthy("repeat > distinct angle", repeatScore > distinctScore);
truthy("repeat > unrelated",      repeatScore > unrelatedScore);
truthy("repeat > pillar-2",       repeatScore > p2Score);

// ── 3) findTooSimilar against a recent-issues list ────────────────────────

const recents = [
  { signature: sigLast, filename: "issue-21.md", projectId: 101, createdAt: 1700000000000 },
  { signature: sigP2,   filename: "issue-20.md", projectId: 100, createdAt: 1699400000000 },
];

const repeatMatch   = findTooSimilar(sigRepeat,    recents);
const distinctMatch = findTooSimilar(sigDistinct,  recents);
const unrelatedMatch = findTooSimilar(sigUnrelated, recents);

truthy("repeat candidate flagged", repeatMatch);
eq("repeat matched against issue-21.md", repeatMatch?.recent.filename, "issue-21.md");
falsy("distinct-angle candidate not flagged", distinctMatch);
falsy("unrelated candidate not flagged", unrelatedMatch);

// findAllTooSimilar returns multiple — repeat against last week only.
const allRepeat = findAllTooSimilar(sigRepeat, recents);
eq("findAllTooSimilar returns 1 match for repeat", allRepeat.length, 1);

// ── 4) Runner-up must also be distinct ────────────────────────────────────
// User goal: runner-up is backup-only — it must not be a near-duplicate of
// the main issue we just chose, nor of recent issues.

const chosenIssue = sigDistinct; // assume this week we picked the board-pack angle
const runnerUpSameAsMain = extractIssueSignature(
  // Same article re-skinned — a real failure mode where the model
  // produces a runner-up that's just a tighter version of the main.
  `# Three slides the board will demand from the FPC report

*For finance leaders*

The FPC report is going to come up in your next board meeting. The board
will ask three questions, and three slides survive the conversation.

## Slide one — what changed in the report
## Slide two — what it means for our exposures
## Slide three — what we're doing about it

## The takeaway
Build the three-slide deck before the next board meeting.
— Aksel
`, "runner-up-22.md");

const runnerVsMain = similarityScore(chosenIssue, runnerUpSameAsMain);
truthy(`runner-up vs main flagged when duplicating angle (got ${runnerVsMain.toFixed(3)})`,
       runnerVsMain >= SIMILARITY_THRESHOLD);

const distinctRunnerUp = extractIssueSignature(unrelatedTopic, "runner-up-22.md");
const distinctRunnerVsMain = similarityScore(chosenIssue, distinctRunnerUp);
truthy(`distinct runner-up vs main not flagged (got ${distinctRunnerVsMain.toFixed(3)})`,
       distinctRunnerVsMain < SIMILARITY_THRESHOLD);

// Runner-up vs recent-issues sweep — duplicating last week as the runner-up
// should also flag.
const runnerUpDupOfLastWeek = extractIssueSignature(thisWeekRepeat, "runner-up-22.md");
const runnerVsRecents = findTooSimilar(runnerUpDupOfLastWeek, recents);
truthy("runner-up flagged against recent issues when duplicating last week",
       runnerVsRecents);
eq("runner-up matched against issue-21.md",
   runnerVsRecents?.recent.filename, "issue-21.md");

// ── 5) Filename predicates ────────────────────────────────────────────────

truthy("isIssueFilename: issue-17.md",    isIssueFilename("issue-17.md"));
truthy("isIssueFilename: issue-01.md",    isIssueFilename("issue-01.md"));
falsy ("isIssueFilename: runner-up-17.md", isIssueFilename("runner-up-17.md"));
falsy ("isIssueFilename: notes.md",       isIssueFilename("notes.md"));
truthy("isRunnerUpFilename: runner-up-17.md", isRunnerUpFilename("runner-up-17.md"));
falsy ("isRunnerUpFilename: issue-17.md",  isRunnerUpFilename("issue-17.md"));

// ── 6) buildRecentIssuesFromFiles — pure, with injected reader ────────────

const fakeFiles = [
  { filename: "issue-21.md",     filePath: "/fake/21/issue-21.md",     projectId: 101, createdAt: 1700000000000 },
  { filename: "runner-up-21.md", filePath: "/fake/21/runner-up-21.md", projectId: 101, createdAt: 1700000000000 },
  { filename: "issue-20.md",     filePath: "/fake/20/issue-20.md",     projectId: 100, createdAt: 1699400000000 },
  { filename: "draft.md",        filePath: "/fake/21/draft.md",        projectId: 101, createdAt: 1699999999000 },
];
const fakeReader = (p: string): string | null => {
  if (p.endsWith("issue-21.md")) return lastWeekIssue;
  if (p.endsWith("issue-20.md")) return twoWeeksAgo;
  if (p.endsWith("runner-up-21.md")) return unrelatedTopic;
  return null;
};

const builtIssues = buildRecentIssuesFromFiles(fakeFiles, { readFile: fakeReader });
eq("buildRecentIssuesFromFiles picks 2 issue-*.md files", builtIssues.length, 2);
eq("newest-first ordering", builtIssues[0].filename, "issue-21.md");

const builtRunners = buildRecentIssuesFromFiles(fakeFiles, {
  match: isRunnerUpFilename, readFile: fakeReader,
});
eq("buildRecentIssuesFromFiles can filter to runner-ups", builtRunners.length, 1);
eq("runner-up filename", builtRunners[0].filename, "runner-up-21.md");

// excludeProjectId — used when checking THIS week's runner-up vs recent
// issues without comparing it to its own issue.
const excludeBuilt = buildRecentIssuesFromFiles(fakeFiles, {
  readFile: fakeReader,
  excludeProjectId: 101,
});
eq("excludeProjectId drops project-101 issues", excludeBuilt.length, 1);
eq("excludeProjectId keeps project-100 issue", excludeBuilt[0].filename, "issue-20.md");

// ── 7) Prompt summariser ───────────────────────────────────────────────────

const promptBlock = summariseRecentTopics(builtIssues);
truthy("prompt block mentions RECENT ISSUES", promptBlock.includes("RECENT ISSUES"));
truthy("prompt block lists issue-21.md", promptBlock.includes("issue-21.md"));
truthy("prompt block lists issue-20.md", promptBlock.includes("issue-20.md"));
truthy("prompt block tells model to pick a distinct angle",
       /materially distinct/i.test(promptBlock));
eq("empty input yields empty block", summariseRecentTopics([]), "");

// ── 8) Template predicate ──────────────────────────────────────────────────

truthy("Analytical Banker template detected",
       isAnalyticalBankerTemplate({ name: "The Analytical Banker — Weekly" }));
truthy("case-insensitive",
       isAnalyticalBankerTemplate({ name: "the analytical banker — weekly" }));
falsy("other template names not detected",
      isAnalyticalBankerTemplate({ name: "Scheduler heartbeat (smoke test)" }));
falsy("null template handled",
      isAnalyticalBankerTemplate(null));
falsy("missing name handled",
      isAnalyticalBankerTemplate({ name: undefined }));

// ── 9) Event-message formatter ─────────────────────────────────────────────

const msg = formatNoveltyMatch({ recent: recents[0], score: 0.72 });
truthy("event message mentions 'Rejected'", msg.includes("Rejected"));
truthy("event message includes filename",   msg.includes("issue-21.md"));
truthy("event message includes percentage", /\d+%/.test(msg));

// ── Report ────────────────────────────────────────────────────────────────

let failed = 0;
for (const c of cases) {
  const pass = JSON.stringify(c.got) === JSON.stringify(c.want);
  if (!pass) {
    failed++;
    console.error(`FAIL: ${c.name}\n  got:  ${JSON.stringify(c.got)}\n  want: ${JSON.stringify(c.want)}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed}/${cases.length} tests failed`);
  process.exit(1);
}
console.log(`✓ ${cases.length} tests passed`);
