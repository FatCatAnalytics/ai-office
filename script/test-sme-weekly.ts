// Stage 6.11 — Weekly SME Analytics issue template tests.
//
// Run as `tsx script/test-sme-weekly.ts`. Exits non-zero on first failure.
// Deterministic — no network, no DB.
//
// Covers the contract that makes SME Analytics generate a publishable
// newsletter issue (mirror of The Analytical Banker), not a generic
// report project:
//
//   - The seeded reference plan emits the 6-task graph (research → angle
//     → draft → qa → factcheck → final) with the same agent assignments
//     as the banker plan, plus the sme-only audience pin.
//   - The brief classifier still labels the template as sme-analytics.
//   - sme-issue-*.md and sme-runner-up-*.md filenames are recognised by
//     the novelty / publishable-file guards.
//   - The Stage 6.9 sufficiency gate still trips for SME briefs on zero
//     sources / Tavily quota / meta-failure language, and writes the
//     research-blocked diagnostic instead of a publishable file.
//   - The final-output guard rejects sme-issue-*.md with zero links or
//     meta-failure language (same shape as banker issue-*.md).
//   - Banker and SME filenames don't collide.

import {
  WEEKLY_SME_ANALYTICS_PROMPT,
  WEEKLY_SME_ANALYTICS_REFERENCE_PLAN,
  WEEKLY_ANALYTICAL_BANKER_REFERENCE_PLAN,
  EDITORIAL_LEAD_PROMPT,
  OPENER_VARIETY_GUIDANCE,
  BRAND_FINGERPRINT,
} from "../server/voiceLab";
import {
  isIssueFilename,
  isRunnerUpFilename,
  isBankerIssueFilename,
  isBankerRunnerUpFilename,
  isSmeIssueFilename,
  isSmeRunnerUpFilename,
  isAnalyticalBankerTemplate,
  isSmeAnalyticsTemplate,
  isWeeklyNewsletterTemplate,
} from "../server/editorial/novelty";
import {
  classifyResearchBrief,
  requiresSourcedResearch,
  evaluateResearchSufficiency,
  evaluatePublishableOutput,
} from "../server/editorial/researchGate";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function eq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }
function truthy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: true }); }
function falsy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: false }); }

// ── 1) Reference plan shape ───────────────────────────────────────────────

const smePlan = JSON.parse(WEEKLY_SME_ANALYTICS_REFERENCE_PLAN) as Array<{
  key: string;
  title: string;
  description: string;
  assignedTo: string;
  priority: string;
  complexity: string;
  dependsOn: string[];
}>;

eq("SME plan has six tasks", smePlan.length, 6);
eq(
  "SME plan keys are research → angle → draft → qa → factcheck → final",
  smePlan.map(t => t.key),
  ["research", "angle", "draft", "qa", "factcheck", "final"],
);

eq(
  "SME research task is assigned to deep-search",
  smePlan.find(t => t.key === "research")?.assignedTo,
  "deep-search",
);
eq(
  "SME angle task is assigned to editorial-lead (NOT generic qa)",
  smePlan.find(t => t.key === "angle")?.assignedTo,
  "editorial-lead",
);
eq(
  "SME qa task is assigned to editorial-lead (NOT generic qa)",
  smePlan.find(t => t.key === "qa")?.assignedTo,
  "editorial-lead",
);
eq(
  "SME factcheck task is assigned to deep-search",
  smePlan.find(t => t.key === "factcheck")?.assignedTo,
  "deep-search",
);
eq(
  "SME final task is assigned to editorial-lead (NOT technical-writer)",
  smePlan.find(t => t.key === "final")?.assignedTo,
  "editorial-lead",
);

eq(
  "SME qa task is high complexity (matches banker QA fix)",
  smePlan.find(t => t.key === "qa")?.complexity,
  "high",
);

// Audience is fixed to sme — angle task description must say so.
truthy(
  "SME angle description fixes audience to 'sme'",
  /audience\s+is\s+always\s+'sme'/i.test(
    smePlan.find(t => t.key === "angle")?.description ?? "",
  ),
);
truthy(
  "SME angle description names the *For growing businesses* sub-line",
  smePlan
    .find(t => t.key === "angle")
    ?.description.includes("*For growing businesses*"),
);

// Final task emits the SME file blocks (not banker filenames).
const finalDesc = smePlan.find(t => t.key === "final")?.description ?? "";
truthy(
  "SME final task references sme-issue-{{week}}.md (not issue-{{week}}.md)",
  finalDesc.includes("sme-issue-{{week}}.md"),
);
truthy(
  "SME final task references sme-runner-up-{{week}}.md",
  finalDesc.includes("sme-runner-up-{{week}}.md"),
);
falsy(
  "SME final task does NOT reference banker issue-{{week}}.md alone",
  /\bname="issue-\{\{week\}\}\.md"/i.test(finalDesc),
);

// The prompt itself must read like a newsletter brief, not a generic report.
truthy(
  "SME prompt mentions £2M–£20M business audience",
  WEEKLY_SME_ANALYTICS_PROMPT.includes("£2M–£20M"),
);
truthy(
  "SME prompt commits to ONE strongest angle, not a roundup",
  /\bnot\s+writing\s+a\s+roundup\b/i.test(WEEKLY_SME_ANALYTICS_PROMPT),
);
truthy(
  "SME prompt mentions the SME-specific issue filename",
  WEEKLY_SME_ANALYTICS_PROMPT.includes("sme-issue-{{week}}.md"),
);

// ── 2) Filename recognition ───────────────────────────────────────────────

truthy("isIssueFilename matches banker issue-22.md", isIssueFilename("issue-22.md"));
truthy("isIssueFilename matches sme-issue-22.md (Stage 6.11)", isIssueFilename("sme-issue-22.md"));
truthy(
  "isRunnerUpFilename matches sme-runner-up-22.md (Stage 6.11)",
  isRunnerUpFilename("sme-runner-up-22.md"),
);
falsy(
  "isIssueFilename does NOT match sme-runner-up-22.md",
  isIssueFilename("sme-runner-up-22.md"),
);
falsy("isIssueFilename does NOT match research-blocked-2026-W21.md", isIssueFilename("research-blocked-2026-W21.md"));

// Banker-only and SME-only predicates keep the pools separated.
truthy("isBankerIssueFilename matches issue-22.md", isBankerIssueFilename("issue-22.md"));
falsy("isBankerIssueFilename rejects sme-issue-22.md", isBankerIssueFilename("sme-issue-22.md"));
truthy("isSmeIssueFilename matches sme-issue-22.md", isSmeIssueFilename("sme-issue-22.md"));
falsy("isSmeIssueFilename rejects issue-22.md", isSmeIssueFilename("issue-22.md"));
truthy(
  "isBankerRunnerUpFilename matches runner-up-22.md",
  isBankerRunnerUpFilename("runner-up-22.md"),
);
falsy(
  "isBankerRunnerUpFilename rejects sme-runner-up-22.md",
  isBankerRunnerUpFilename("sme-runner-up-22.md"),
);
truthy(
  "isSmeRunnerUpFilename matches sme-runner-up-22.md",
  isSmeRunnerUpFilename("sme-runner-up-22.md"),
);

// Same-issue-number on the two newsletters does NOT collide — they live in
// orthogonal filename namespaces.
falsy("issue-22.md and sme-issue-22.md are different files (bypass via lowercase)",
  "issue-22.md" === "sme-issue-22.md"); // trivially true; sanity check
eq("isSme vs isBanker keep file pools orthogonal",
  [isBankerIssueFilename("issue-22.md"), isSmeIssueFilename("issue-22.md"),
   isBankerIssueFilename("sme-issue-22.md"), isSmeIssueFilename("sme-issue-22.md")],
  [true, false, false, true]);

// ── 3) Template predicates ────────────────────────────────────────────────

truthy(
  "isSmeAnalyticsTemplate recognises 'Weekly SME Analytics'",
  isSmeAnalyticsTemplate({ name: "Weekly SME Analytics" }),
);
truthy(
  "isSmeAnalyticsTemplate recognises 'SME Analytics Weekly Report'",
  isSmeAnalyticsTemplate({ name: "SME Analytics Weekly Report" }),
);
falsy(
  "isSmeAnalyticsTemplate rejects 'The Analytical Banker — Weekly'",
  isSmeAnalyticsTemplate({ name: "The Analytical Banker — Weekly" }),
);
truthy(
  "isAnalyticalBankerTemplate recognises 'The Analytical Banker — Weekly'",
  isAnalyticalBankerTemplate({ name: "The Analytical Banker — Weekly" }),
);
falsy(
  "isAnalyticalBankerTemplate rejects 'Weekly SME Analytics'",
  isAnalyticalBankerTemplate({ name: "Weekly SME Analytics" }),
);
truthy(
  "isWeeklyNewsletterTemplate fires for either banker or SME",
  isWeeklyNewsletterTemplate({ name: "The Analytical Banker — Weekly" }) &&
    isWeeklyNewsletterTemplate({ name: "Weekly SME Analytics" }),
);
falsy(
  "isWeeklyNewsletterTemplate rejects unrelated templates",
  isWeeklyNewsletterTemplate({ name: "Generic Internal Tool" }),
);

// ── 4) Research sufficiency gate still applies to SME ─────────────────────

eq(
  "Weekly SME Analytics template still classifies as sme-analytics brief",
  classifyResearchBrief({ name: "Weekly SME Analytics" }, []),
  "sme-analytics",
);
truthy(
  "requiresSourcedResearch true for SME weekly",
  requiresSourcedResearch({ name: "Weekly SME Analytics" }, []),
);

// Zero source URLs → blocked.
const smeZeroSources = evaluateResearchSufficiency(
  [
    {
      taskTitle: "Identify candidate SME-analytics stories",
      assignedTo: "deep-search",
      // No URLs anywhere, but enough prose to bypass the empty-output check.
      output:
        "I was unable to identify candidate stories this week. " +
        "Several search calls were attempted but none returned usable content. " +
        "This summary is being generated from scratch with no fetched sources.",
    },
  ],
  "sme-analytics",
);
falsy("SME zero-source research is blocked", smeZeroSources.ok);
truthy(
  "SME zero-source report mentions 'zero source URLs'",
  smeZeroSources.reason.toLowerCase().includes("zero source urls"),
);

// Meta-failure language (Tavily quota / 433) → blocked even with URLs.
const smeQuotaFail = evaluateResearchSufficiency(
  [
    {
      taskTitle: "Identify candidate SME-analytics stories",
      assignedTo: "deep-search",
      output:
        "The pipeline came back empty this week — Tavily quota was exhausted " +
        "and every search call failed with HTTP 433. https://www.example.com/ " +
        "was the placeholder I used. Without fresh sources, I'm pivoting to " +
        "a methodology piece.",
    },
  ],
  "sme-analytics",
);
falsy("SME quota-exhausted research is blocked", smeQuotaFail.ok);
truthy(
  "SME quota-exhausted report includes meta-failure detail",
  smeQuotaFail.metaFailureHits.length > 0,
);

// Valid sourced research passes.
const smeValid = evaluateResearchSufficiency(
  [
    {
      taskTitle: "Identify candidate SME-analytics stories",
      assignedTo: "deep-search",
      output:
        "## Candidates\n\n" +
        "1. [Bank of England SME credit conditions Q1 2026](https://www.bankofengland.co.uk/credit-conditions-survey/2026/q1) — " +
        "tightening in lending appetite to small businesses.\n" +
        "2. [ONS small business cashflow release](https://www.ons.gov.uk/businessindustryandtrade/business/sme) — " +
        "median DSO crept up 4 days year on year.\n" +
        "3. [HMRC Making Tax Digital roadmap](https://www.gov.uk/government/publications/mtd-2026) — " +
        "VAT reporting changes hit £20M-band businesses first.\n",
    },
  ],
  "sme-analytics",
);
truthy("SME valid sourced research passes the gate", smeValid.ok);

// ── 5) Final-output guard rejects sme-issue with no links / meta-failure ─

const smeBadIssueNoLinks = evaluatePublishableOutput(
  // Length is well above the 600-char floor (~1200 chars), prose body, but
  // ZERO markdown links — the guard MUST flag this as unsourced.
  "# The week SME credit got harder\n*For growing businesses*\n\n" +
  "Something happened with SME credit this week. I'm going to be honest — " +
  "I couldn't find a usable primary source within the timebox. The takeaway " +
  "is that you should keep an eye on it. The pricing situation for " +
  "small-business overdrafts is more complicated than it was a year ago, " +
  "and FDs at growing businesses need to think carefully about how their " +
  "cashflow holds up if their main lender repriced overnight.\n\n" +
  "## The shape of the problem\n\n" +
  "A few of my clients have noted that their bank is asking for fresh " +
  "management accounts more often than they used to. That is not always " +
  "a bad sign; sometimes it is just a refreshed credit committee. But " +
  "when several mid-market lenders all start doing it in the same quarter, " +
  "it usually means something is moving in their internal models.\n\n" +
  "## Where the risk lives\n\n" +
  "If you bought working-capital cover three years ago and have not " +
  "renegotiated since, you are paying yesterday's price for today's risk.\n\n" +
  "## The takeaway\n\n" +
  "Pull last month's DSO trend, your largest five customer concentration, " +
  "and your covenant headroom. Compare those three numbers to the same " +
  "three numbers a year ago. If two of them have moved against you, get " +
  "your relationship manager on a call.\n\n— Aksel",
  { kind: "issue" },
);
falsy("sme-issue with zero markdown links is rejected", smeBadIssueNoLinks.ok);
truthy(
  "sme-issue no-link rejection mentions zero markdown links",
  smeBadIssueNoLinks.reason.toLowerCase().includes("zero markdown links"),
);

const smeMetaFailureIssue = evaluatePublishableOutput(
  "# Pipeline came back empty this week\n*For growing businesses*\n\n" +
  "I won't sugar-coat it — the research came back empty this week. Tavily " +
  "quota was exhausted, every search call failed, no pages fetched. I'd " +
  "normally cover SME credit but data didn't arrive, so this is a brief " +
  "methodology note instead. See [a source](https://www.example.com/x).\n\n" +
  "## The takeaway\nGet your search provider fixed before next Monday.\n\n— Aksel",
  { kind: "issue" },
);
falsy("sme-issue with meta-failure language is rejected", smeMetaFailureIssue.ok);

// A clean sme-issue with real links and decent length should pass.
const smeOkIssue = evaluatePublishableOutput(
  "# The week SME credit got harder\n*For growing businesses*\n\n" +
  "The [Bank of England's credit conditions survey](https://www.bankofengland.co.uk/credit-conditions-survey/2026/q1) " +
  "shipped on Friday with the usual table of net percentage balances. " +
  "Lending appetite to small businesses tightened again. That's the third " +
  "consecutive quarter of tightening, and the [ONS small-business cashflow " +
  "release](https://www.ons.gov.uk/businessindustryandtrade/business/sme) " +
  "from the same week shows median DSO crept up four days year-on-year.\n\n" +
  "## What this means on the ground\n\n" +
  "If you're an FD at a £5M-£15M business, two of your three biggest risks " +
  "just got a little worse at the same time. The bank is going to be slower " +
  "to extend headroom, and your customers are going to be slower to pay you. " +
  "Both compress the cash you have to spend on the rest of the business.\n\n" +
  "## The takeaway\n\n" +
  "Pull last month's DSO report on Monday. If it's worse than the rolling " +
  "twelve-month average, you've got a problem you don't yet have a name for.\n\n" +
  "— Aksel",
  { kind: "issue" },
);
truthy("clean sourced sme-issue passes the final-output guard", smeOkIssue.ok);

// ── 6) No collision between banker and SME plans ─────────────────────────

const bankerPlan = JSON.parse(WEEKLY_ANALYTICAL_BANKER_REFERENCE_PLAN) as Array<{
  key: string; description: string;
}>;
const bankerFinal = bankerPlan.find(t => t.key === "final")?.description ?? "";
truthy(
  "Banker final task still references issue-{{week}}.md",
  bankerFinal.includes("issue-{{week}}.md"),
);
falsy(
  "Banker final task does NOT reference sme-issue-{{week}}.md",
  bankerFinal.includes("sme-issue-{{week}}.md"),
);

// ── 7) Opener variety guidance (Stage 6.13) ──────────────────────────────
//
// Both weekly newsletters kept opening with near-identical "here's a quick
// exercise" / "think about the last time" hooks. The OPENER_VARIETY_GUIDANCE
// block demotes that shape to a rare fallback and offers a menu of
// alternatives. It must be folded into the editorial-lead prompt and both
// draft task descriptions, and the brand fingerprint must no longer present
// the exercise opener as a co-equal default.

// The guidance lists the alternative opener shapes the brief asks for.
for (const shape of [
  "Scene",
  "Sourced fact",
  "Operator pain moment",
  "Contrarian observation",
  "Meeting question",
  "Recent event hook",
  "Data plumbing failure",
  "Confession",
  "Mini-dialogue",
]) {
  truthy(
    `OPENER_VARIETY_GUIDANCE offers the '${shape}' opener shape`,
    OPENER_VARIETY_GUIDANCE.includes(shape),
  );
}

truthy(
  "OPENER_VARIETY_GUIDANCE marks quick-exercise openers as a rare fallback",
  /rare fallback/i.test(OPENER_VARIETY_GUIDANCE),
);
truthy(
  "OPENER_VARIETY_GUIDANCE forbids repeating the opener shape back-to-back",
  /do not (repeat|reuse).*(opener|shape)/is.test(OPENER_VARIETY_GUIDANCE),
);

truthy(
  "EDITORIAL_LEAD_PROMPT embeds the opener-variety guidance",
  EDITORIAL_LEAD_PROMPT.includes(OPENER_VARIETY_GUIDANCE),
);

// The brand fingerprint must no longer present "a small exercise" as a
// co-equal default opener.
falsy(
  "BRAND_FINGERPRINT no longer offers 'a small exercise' as a default opener",
  /open with a concrete moment\s+or a small exercise/i.test(BRAND_FINGERPRINT),
);
truthy(
  "BRAND_FINGERPRINT flags quick-exercise openers as a rare fallback",
  /rare fallback/i.test(BRAND_FINGERPRINT),
);

// Both draft tasks must carry the opener-variety guidance.
const smeDraftDesc = smePlan.find(t => t.key === "draft")?.description ?? "";
truthy(
  "SME draft task embeds the opener-variety guidance",
  smeDraftDesc.includes(OPENER_VARIETY_GUIDANCE),
);

const bankerDraftDesc =
  (JSON.parse(WEEKLY_ANALYTICAL_BANKER_REFERENCE_PLAN) as Array<{
    key: string; description: string;
  }>).find(t => t.key === "draft")?.description ?? "";
truthy(
  "Banker draft task embeds the opener-variety guidance",
  bankerDraftDesc.includes(OPENER_VARIETY_GUIDANCE),
);

// Output contracts are preserved — the SME draft still forbids <file> blocks
// at the draft stage and the file-block contract is unchanged downstream.
truthy(
  "SME draft task still defers <file> blocks to the final task",
  /no <file> blocks at this stage/i.test(smeDraftDesc),
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
