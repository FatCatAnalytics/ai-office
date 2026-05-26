// Stage 6.9 — fail-closed research sufficiency gate tests.
//
// Run as `tsx script/test-research-gate.ts`. Exits non-zero on first
// failure. Deterministic — no network, no DB.
//
// Regression baseline (matches the user's complaint that the Analytical
// Banker weekly run on 2026-05-24 produced issue-22.md + runner-up-22.md
// even though every Tavily call failed with HTTP 433):
//   - Zero candidates / no source URLs  → gate fails closed.
//   - All Tavily calls failed (research output mentions HTTP 433 / quota /
//     "data didn't arrive") → gate fails closed.
//   - Final/issue file with zero markdown links → rejected by output guard.
//   - Final/issue file that is a meta essay about a failed pipeline →
//     rejected by output guard.
//   - Valid sourced research with at least one usable candidate passes.
//   - Brief classification triggers for both Analytical Banker (by template
//     name) AND a SME Analytics-style manager-LLM brief (by task shape).

import {
  classifyResearchBrief,
  requiresSourcedResearch,
  evaluateResearchSufficiency,
  evaluatePublishableOutput,
  isResearchTask,
  isDownstreamPublishableTask,
  renderResearchBlockedDiagnostic,
  blockedDiagnosticFilename,
  weekLabelFromDate,
  __internal,
  type BriefKind,
  type ResearchInput,
} from "../server/editorial/researchGate";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function eq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }
function truthy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: true }); }
function falsy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: false }); }

// ── 1) Brief classification ───────────────────────────────────────────────

eq(
  "Analytical Banker template classifies as analytical-banker",
  classifyResearchBrief({ name: "The Analytical Banker — Weekly" }, []),
  "analytical-banker",
);

eq(
  "Analytical Banker template classifies case-insensitively",
  classifyResearchBrief({ name: "the analytical banker" }, []),
  "analytical-banker",
);

eq(
  "SME Analytics template classifies as sme-analytics",
  classifyResearchBrief({ name: "Weekly SME Analytics" }, []),
  "sme-analytics",
);

eq(
  "SME Analytics report template classifies as sme-analytics",
  classifyResearchBrief({ name: "SME Analytics Weekly Report" }, []),
  "sme-analytics",
);

eq(
  "Unknown template + research+publishable tasks classifies as generic-research",
  classifyResearchBrief(null, [
    { title: "Research the market landscape this week", assignedTo: "deep-search" },
    { title: "Draft the final report", assignedTo: "editorial-lead" },
  ]),
  "generic-research",
);

eq(
  "Unknown template + only frontend tasks classifies null",
  classifyResearchBrief(null, [
    { title: "Build the dashboard", assignedTo: "frontend" },
    { title: "Add unit tests", assignedTo: "qa" },
  ]),
  null,
);

truthy(
  "requiresSourcedResearch true for Analytical Banker",
  requiresSourcedResearch({ name: "The Analytical Banker — Weekly" }, []),
);
falsy(
  "requiresSourcedResearch false for unrelated software project",
  requiresSourcedResearch({ name: "Generic Internal Tool" }, [
    { title: "Build the dashboard", assignedTo: "frontend" },
  ]),
);

// ── 2) isResearchTask + isDownstreamPublishableTask ───────────────────────

truthy(
  "isResearchTask true when planner key is 'research'",
  isResearchTask({ title: "Identify candidates", assignedTo: "deep-search" }, "research"),
);
truthy(
  "isResearchTask true for deep-search agent without planner key",
  isResearchTask({ title: "Research the topic", assignedTo: "deep-search" }),
);
truthy(
  "isResearchTask true on title hint",
  isResearchTask({ title: "Identify candidate stories from last week", assignedTo: "writer" }),
);
falsy(
  "isResearchTask false for editorial-lead drafting",
  isResearchTask({ title: "Draft the newsletter", assignedTo: "editorial-lead" }, "draft"),
);

truthy(
  "isDownstreamPublishableTask true for planner key 'final'",
  isDownstreamPublishableTask({ title: "Apply fixes & emit final files", assignedTo: "editorial-lead" }, "final"),
);
truthy(
  "isDownstreamPublishableTask true for planner key 'angle'",
  isDownstreamPublishableTask({ title: "Pick angle", assignedTo: "editorial-lead" }, "angle"),
);
truthy(
  "isDownstreamPublishableTask true for title containing 'issue'",
  isDownstreamPublishableTask({ title: "Draft this week's issue", assignedTo: "editorial-lead" }),
);
falsy(
  "isDownstreamPublishableTask false for research-flavoured title",
  isDownstreamPublishableTask({ title: "Discover sources", assignedTo: "deep-search" }),
);

// ── 3) evaluateResearchSufficiency — failure modes ────────────────────────

const bankerKind: BriefKind = "analytical-banker";
const smeKind: BriefKind = "sme-analytics";

const emptyReport = evaluateResearchSufficiency([], bankerKind);
falsy("zero research outputs fails closed", emptyReport.ok);
truthy(
  "zero outputs reason mentions empty research",
  emptyReport.reason.toLowerCase().includes("no upstream") ||
    emptyReport.reason.toLowerCase().includes("cannot evaluate"),
);

const noLinkReport = evaluateResearchSufficiency(
  [
    {
      taskTitle: "Identify candidates",
      assignedTo: "deep-search",
      output:
        "I attempted to search the web this week but every call failed. I will summarise from memory: there were several stories about UK banks and pensions. " +
        "But I have nothing concrete to cite.".repeat(2),
    },
  ],
  bankerKind,
);
falsy("research with zero source URLs fails closed", noLinkReport.ok);
truthy(
  "no-link failure reason mentions zero source URLs",
  noLinkReport.reason.toLowerCase().includes("zero source url"),
);

const allTavilyFailReport = evaluateResearchSufficiency(
  [
    {
      taskTitle: "Identify candidates",
      assignedTo: "deep-search",
      output:
        "Tavily API quota exhausted. Every search call failed with HTTP 433 across the board. " +
        "The pipeline came back empty — zero pages fetched. Data didn't arrive in time.",
    },
  ],
  bankerKind,
);
falsy("all-Tavily-fail research fails closed", allTavilyFailReport.ok);

const metaButLinkedReport = evaluateResearchSufficiency(
  [
    {
      taskTitle: "Identify candidates",
      assignedTo: "deep-search",
      output:
        "Initial Tavily quota exhausted. Despite that, I retried and pulled https://www.bankofengland.co.uk/news/2026/q1 with a story about NII compression. " +
        "There is also https://www.fca.org.uk/news/regulatory-update with a second candidate.",
    },
  ],
  bankerKind,
);
// Tavily quota mention should trip meta-failure detection even with two
// links — the brief explicitly says meta-failure language is a block.
falsy("meta-failure language blocks even when some links present", metaButLinkedReport.ok);
truthy(
  "meta-failure reason mentions meta-failure",
  metaButLinkedReport.reason.toLowerCase().includes("meta-failure"),
);

// ── 4) evaluateResearchSufficiency — pass cases ───────────────────────────

const wellFormedBanker = evaluateResearchSufficiency(
  [
    {
      taskTitle: "Identify candidate stories",
      assignedTo: "deep-search",
      output: `## Candidate stories

1. NII compression at UK mid-tier banks — Bank of England Q1 review.
   Source: https://www.bankofengland.co.uk/news/2026/q1-review
   Why it matters: every mid-market lender is calling about it.

2. FCA review of SME lending criteria — FCA newsroom.
   Source: https://www.fca.org.uk/news/sme-lending-criteria-2026
   Why it matters: this is going to change pricing for everyone.

3. ONS productivity stats land Thursday — ONS bulletin.
   Source: https://www.ons.gov.uk/economy/productivity
   Why it matters: leadership are going to ask about it.

4. PRA Pillar 2 update — PRA newsroom.
   Source: https://www.bankofengland.co.uk/pra/2026/pillar-2-update
   Why it matters: capital planning team needs to know.

5. BIS quarterly review piece on UK credit — BIS bulletin.
   Source: https://www.bis.org/publ/qtrpdf/r_qt2603.htm
   Why it matters: cross-border lending impact.`,
    },
  ],
  bankerKind,
);
truthy(
  "well-formed banker research with 5 sourced candidates passes",
  wellFormedBanker.ok,
);
truthy(
  `well-formed banker reports usableCandidates >= 5 (got ${wellFormedBanker.usableCandidates})`,
  wellFormedBanker.usableCandidates >= 5,
);

const oneLinkPasses = evaluateResearchSufficiency(
  [
    {
      taskTitle: "Identify candidates",
      assignedTo: "deep-search",
      output:
        "The biggest story this week is the Bank of England's quarterly review. " +
        "I pulled it from https://www.bankofengland.co.uk/news/2026/q1-review — full body fetched. " +
        "The summary is detailed enough to write a draft from. " +
        "Specifically, the report covers UK midmarket lending stress, NII compression, and the implications for capital planning teams in the next year.",
    },
  ],
  bankerKind,
);
// Single sourced candidate passes the hard minimum but should trigger the
// soft warning (below the 5–8 target band).
truthy("single sourced candidate passes hard minimum", oneLinkPasses.ok);
truthy(
  "single sourced candidate triggers soft warning under target band",
  oneLinkPasses.reason.toLowerCase().includes("thin side") ||
    oneLinkPasses.reason.toLowerCase().includes("5–8") ||
    oneLinkPasses.reason.includes("5-8"),
);

const smeOneSource = evaluateResearchSufficiency(
  [
    {
      taskTitle: "Map the SME analytics landscape last week",
      assignedTo: "deep-search",
      output:
        "Top SME pain point this week was forecasting cash with no analytics stack. " +
        "Coverage at https://www.smeweekly.example.com/cash-forecasting-2026 explains it well. " +
        "Multiple founders quoted struggling with manual spreadsheets. The piece maps neatly onto a Fatcat Analytics solution for cashflow visibility.",
    },
  ],
  smeKind,
);
truthy("SME single sourced candidate passes the gate", smeOneSource.ok);

// ── 5) evaluatePublishableOutput — final output guard ─────────────────────

const noLinksIssue = `# This week's lessons from the data pipeline

*For finance leaders*

This week, the research pipeline came back empty. Rather than fabricate sources, I want to share some thoughts on what we usually do when the data doesn't arrive. The takeaway is to fall back to first principles.

— Aksel`.repeat(3);
const noLinksReport = evaluatePublishableOutput(noLinksIssue, { kind: "issue" });
falsy("issue with zero markdown links is rejected", noLinksReport.ok);
truthy(
  "no-links rejection reason mentions zero markdown links",
  noLinksReport.reason.toLowerCase().includes("zero markdown links") ||
    noLinksReport.reason.toLowerCase().includes("meta-failure"),
);

const metaEssayIssue = `# Lessons from a quiet research week

*For finance leaders*

Every search call failed this week with HTTP 433. Tavily API quota was exhausted. Rather than fabricate a story, here is what we should do when the pipeline came back empty and zero pages were fetched. The first lesson is humility.

The second lesson is to have backup providers. The third lesson is to plan for graceful degradation. Aksel, signing off.

[A real link to the BoE](https://www.bankofengland.co.uk/news/2026/q1) for context only.

— Aksel`.repeat(3);
const metaEssayReport = evaluatePublishableOutput(metaEssayIssue, { kind: "issue" });
falsy("meta-essay issue is rejected even with a token link", metaEssayReport.ok);
truthy(
  "meta-essay rejection mentions meta-failure",
  metaEssayReport.reason.toLowerCase().includes("meta-failure"),
);

const tooShortIssue = `# Tiny

Too short.`;
const tooShortReport = evaluatePublishableOutput(tooShortIssue, { kind: "issue" });
falsy("implausibly short issue is rejected", tooShortReport.ok);
truthy(
  "too-short rejection mentions length",
  tooShortReport.reason.toLowerCase().includes("too short") ||
    tooShortReport.reason.toLowerCase().includes("chars"),
);

const wellFormedIssue = `# The quiet risk the FPC just named

*For finance leaders*

The Financial Policy Committee published [its quarterly summary on Tuesday](https://www.bankofengland.co.uk/financial-policy-summary/2026/q1). Most of the coverage missed the key line: deposit beta assumptions look stale.

## Why this matters
The [PRA's stress-test update](https://www.bankofengland.co.uk/pra/2026/stress-update) confirms the same trend. Midmarket banks should re-test their assumptions this week.

> Is your deposit beta still set at 2023's number?

## The takeaway
Re-run your beta sensitivity this week. One concrete check: pull last 90 days of retail saver behaviour and compare to the FPC's central case.

— Aksel`.repeat(3);
const goodReport = evaluatePublishableOutput(wellFormedIssue, { kind: "issue" });
truthy("well-formed sourced issue passes the output guard", goodReport.ok);
truthy(
  `well-formed issue has link count > 0 (got ${goodReport.linkCount})`,
  goodReport.linkCount > 0,
);

// Runner-up guard relaxes link/length minimums but still rejects meta-essay.
const runnerUpOK = evaluatePublishableOutput(
  "The runner-up this week was the FCA's SME lending review. Worth holding for next week — it deserves its own treatment.",
  { kind: "runner-up" },
);
truthy("clean short runner-up passes", runnerUpOK.ok);

const runnerUpMeta = evaluatePublishableOutput(
  "The runner-up isn't really anything — Tavily API quota was exhausted and zero pages fetched.",
  { kind: "runner-up" },
);
falsy("meta-failure runner-up is rejected", runnerUpMeta.ok);

const runnerUpTooShort = evaluatePublishableOutput(".", { kind: "runner-up" });
falsy("empty runner-up is rejected", runnerUpTooShort.ok);

// ── 6) Diagnostic file rendering ──────────────────────────────────────────

const diagnostic = renderResearchBlockedDiagnostic(
  { name: "The Analytical Banker — Weekly", description: "Weekly newsletter" },
  bankerKind,
  noLinkReport,
  [
    {
      taskTitle: "Identify candidates",
      assignedTo: "deep-search",
      output: "Sample failed output with no sources.",
    },
  ],
  "2026-W21",
);
truthy("diagnostic mentions the week label", diagnostic.includes("2026-W21"));
truthy("diagnostic mentions the project name", diagnostic.includes("The Analytical Banker"));
truthy("diagnostic mentions Tavily / quota check",
  diagnostic.toLowerCase().includes("tavily"));
truthy(
  "diagnostic mentions no publishable issue was emitted",
  diagnostic.toLowerCase().includes("no publishable issue"),
);

eq(
  "blockedDiagnosticFilename for banker is research-blocked-<week>.md",
  blockedDiagnosticFilename(bankerKind, "2026-W21"),
  "research-blocked-2026-W21.md",
);
eq(
  "blockedDiagnosticFilename for sme is research-blocked-<week>.md",
  blockedDiagnosticFilename(smeKind, "2026-W21"),
  "research-blocked-2026-W21.md",
);
eq(
  "blockedDiagnosticFilename for generic is issue-blocked-<week>.md",
  blockedDiagnosticFilename("generic-research", "2026-W21"),
  "issue-blocked-2026-W21.md",
);

// ── 7) weekLabelFromDate is YYYY-WNN ──────────────────────────────────────

const wk = weekLabelFromDate(new Date(Date.UTC(2026, 4, 26))); // 2026-05-26
truthy(`weekLabelFromDate looks like YYYY-WNN (got ${wk})`, /^\d{4}-W\d{2}$/.test(wk));

// ── 8) Internal sanity ────────────────────────────────────────────────────

truthy(
  "internal meta-failure phrase list non-empty",
  __internal.META_FAILURE_PHRASES.length > 5,
);
truthy(
  "extractLinks pulls https URLs from markdown",
  __internal.extractLinks(
    "See [BoE](https://www.bankofengland.co.uk/x) and bare https://www.fca.org.uk/y.",
  ).length === 2,
);
truthy(
  "countUsableCandidates returns 0 for empty input",
  __internal.countUsableCandidates("") === 0,
);

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

// Suppress unused parameter for the ResearchInput type import.
const _: ResearchInput[] = [];
void _;
