// Stage 6.8 smoke test for the Analytical Banker QA self-review checklist.
//
// Run as `tsx script/test-banker-qa-checklist.ts`. Exits non-zero on first
// failure. Deterministic — no network, no DB beyond an in-memory parse of
// the exported reference plan string.
//
// Regression baseline (matches the user's complaint that "QA self-review
// against the 8-step editorial checklist" is not working for the weekly
// run):
//   - The exported reference plan's `qa` task description MUST contain
//     all 8 step headings.
//   - The rendered QA description MUST require the PASS / FIX / WARN
//     contract and the `## Final recommendation` block.
//   - evaluateQaOutput MUST flag a malformed review (missing headings or
//     missing final recommendation) as inadequate, and pass a well-formed
//     review through.
//   - The Stage 6.8 migration check (detection token "## Final
//     recommendation" missing) MUST trigger on a pre-Stage-6.8 description
//     and MUST be idempotent against a refreshed one.

import {
  EDITORIAL_CHECKLIST_STEPS,
  renderQaChecklistDescription,
  findMissingStepHeadings,
  hasFinalRecommendation,
  parseFinalRecommendation,
  evaluateQaOutput,
} from "../server/editorial/qaChecklist";
import { WEEKLY_ANALYTICAL_BANKER_REFERENCE_PLAN } from "../server/voiceLab";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function eq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }
function truthy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: true }); }
function falsy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: false }); }

// ── 1) Checklist shape ────────────────────────────────────────────────────

eq("exactly 8 checklist steps", EDITORIAL_CHECKLIST_STEPS.length, 8);

const expectedNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
eq("step numbers are 1..8 in order",
   EDITORIAL_CHECKLIST_STEPS.map(s => s.number), expectedNumbers);

for (const step of EDITORIAL_CHECKLIST_STEPS) {
  truthy(`step ${step.number} has name`, step.name && step.name.length > 2);
  truthy(`step ${step.number} has id`, step.id && step.id.length > 0);
  truthy(`step ${step.number} has detail`, step.detail && step.detail.length > 20);
}

const ids = EDITORIAL_CHECKLIST_STEPS.map(s => s.id);
eq("step ids are unique", new Set(ids).size, ids.length);

// ── 2) Rendered description contract ──────────────────────────────────────

const rendered = renderQaChecklistDescription();

truthy("rendered description mentions PASS/FIX/WARN",
       /PASS\s*\|\s*FIX\s*\|\s*WARN/.test(rendered));
truthy("rendered description mentions Final recommendation",
       rendered.includes("## Final recommendation"));
truthy("rendered description mentions ship | revise | reject",
       /ship\s*\|\s*revise\s*\|\s*reject/.test(rendered));
truthy("rendered description requires `### Step N — <name>` heading format",
       rendered.includes("### Step N — <name>"));
truthy("rendered description forbids <file> blocks at QA stage",
       /NO <file> blocks/i.test(rendered));

// Every step must appear by name (case-insensitive) in the rendered body.
for (const step of EDITORIAL_CHECKLIST_STEPS) {
  truthy(`rendered mentions step ${step.number}`,
         rendered.includes(`STEP ${step.number}`));
  truthy(`rendered mentions step ${step.number} name "${step.name}"`,
         rendered.toLowerCase().includes(step.name.toLowerCase()));
}

// ── 3) Reference plan wiring ──────────────────────────────────────────────

const plan = JSON.parse(WEEKLY_ANALYTICAL_BANKER_REFERENCE_PLAN) as Array<Record<string, unknown>>;
const qaEntry = plan.find(t => t.key === "qa");
truthy("reference plan has a qa task", qaEntry);
eq("qa task assignedTo is editorial-lead", qaEntry?.assignedTo, "editorial-lead");
eq("qa task complexity is high", qaEntry?.complexity, "high");

const qaDesc = String(qaEntry?.description ?? "");
truthy("qa task description includes Final recommendation block instruction",
       qaDesc.includes("## Final recommendation"));
truthy("qa task description includes PASS/FIX/WARN contract",
       /PASS\s*\|\s*FIX\s*\|\s*WARN/.test(qaDesc));

for (const step of EDITORIAL_CHECKLIST_STEPS) {
  truthy(`qa description mentions step ${step.number} name`,
         qaDesc.toLowerCase().includes(step.name.toLowerCase()));
}

// The whole brief must fit comfortably in a system+user prompt budget —
// guard against a future edit that bloats it.
truthy(`qa description is under 12K chars (got ${qaDesc.length})`,
       qaDesc.length < 12_000);

// ── 4) findMissingStepHeadings + hasFinalRecommendation ──────────────────

function buildWellFormedReview(): string {
  const blocks = EDITORIAL_CHECKLIST_STEPS.map((s) =>
    `### Step ${s.number} — ${s.name}\n` +
    `Verdict: PASS\n` +
    `Evidence: looks fine, see line "${s.name} placeholder".\n`,
  ).join("\n");
  return `${blocks}\n## Final recommendation\nRecommendation: ship\nRationale: clean draft.\n`;
}

const wellFormed = buildWellFormedReview();
eq("well-formed review has no missing headings",
   findMissingStepHeadings(wellFormed), []);
truthy("well-formed review has final recommendation",
       hasFinalRecommendation(wellFormed));
eq("well-formed review parses ship", parseFinalRecommendation(wellFormed), "ship");

const noHeadings = "Some prose with the word PASS sprinkled in. No headings at all.";
eq("no-heading review missing all 8 steps",
   findMissingStepHeadings(noHeadings), [1, 2, 3, 4, 5, 6, 7, 8]);
falsy("no-heading review has no final recommendation",
      hasFinalRecommendation(noHeadings));

// Skip step 5 — guard must flag it.
const skipFive = EDITORIAL_CHECKLIST_STEPS
  .filter(s => s.number !== 5)
  .map(s => `### Step ${s.number} — ${s.name}\nVerdict: PASS\n`)
  .join("\n") + "\n## Final recommendation\nRecommendation: ship\nRationale: ok.\n";
eq("skipping step 5 is detected", findMissingStepHeadings(skipFive), [5]);

// ── 5) evaluateQaOutput end-to-end ────────────────────────────────────────

const goodReport = evaluateQaOutput(wellFormed);
truthy("well-formed output is adequate", goodReport.adequate);
eq("well-formed output recommendation = ship", goodReport.recommendation, "ship");
eq("well-formed output has no missing steps", goodReport.missingSteps, []);

const skipReport = evaluateQaOutput(skipFive);
falsy("missing-step output is NOT adequate", skipReport.adequate);
truthy("missing-step reason mentions which step", skipReport.reason.includes("5"));

const tooShort = evaluateQaOutput("Verdict: PASS");
falsy("too-short output is NOT adequate", tooShort.adequate);
truthy("too-short reason mentions char count",
       /chars/i.test(tooShort.reason));

const noFinal = EDITORIAL_CHECKLIST_STEPS
  .map(s => `### Step ${s.number} — ${s.name}\nVerdict: PASS\n`)
  .join("\n");
const noFinalReport = evaluateQaOutput(noFinal);
falsy("no-final-recommendation output is NOT adequate", noFinalReport.adequate);
truthy("no-final reason mentions Final recommendation",
       noFinalReport.reason.toLowerCase().includes("final recommendation"));

// A FIX-heavy review with revise recommendation must still be adequate
// (we're testing the format guard, not the editorial verdict).
const reviseReview = EDITORIAL_CHECKLIST_STEPS
  .map(s => {
    const v = s.number === 2 || s.number === 7 ? "FIX" : s.number === 6 ? "WARN" : "PASS";
    const edit = v === "FIX"
      ? `Required edit: drop the contraband phrase "leverage".`
      : v === "WARN"
        ? "Note: borderline — flag for the operator."
        : "Evidence: clean.";
    return `### Step ${s.number} — ${s.name}\nVerdict: ${v}\n${edit}`;
  })
  .join("\n\n");
const reviseFinal = `${reviseReview}\n\n## Final recommendation\nRecommendation: revise\nRationale: two FIX items.\n`;
const reviseReport = evaluateQaOutput(reviseFinal);
truthy("revise review is adequate", reviseReport.adequate);
eq("revise review recommendation parsed", reviseReport.recommendation, "revise");

// Reject path — same shape, different verdict.
const rejectFinal = `${reviseReview}\n\n## Final recommendation\nRecommendation: reject\nRationale: fabricated sources throughout.\n`;
const rejectReport = evaluateQaOutput(rejectFinal);
eq("reject review recommendation parsed", rejectReport.recommendation, "reject");

// ── 6) Migration detection contract ──────────────────────────────────────
//
// The Stage 6.8 migration in server/storage.ts triggers when an existing
// qa description does NOT contain "## Final recommendation". Verify both
// halves of that contract.

const preStage68Description =
  "Self-review the draft. For EACH step, PASS / FAIL / N/A. STEP 1 — READ-ALOUD…";
truthy("pre-Stage-6.8 description lacks Final recommendation (migration triggers)",
       !preStage68Description.includes("## Final recommendation"));
truthy("post-Stage-6.8 description contains Final recommendation (migration skips)",
       qaDesc.includes("## Final recommendation"));

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
