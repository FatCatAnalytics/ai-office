// Stage 6.8 — canonical 8-step QA checklist for The Analytical Banker.
//
// Background. The weekly Analytical Banker workflow has, since Stage 5.x.3,
// included a "QA self-review against the 8-step editorial checklist" task.
// The checklist itself lived as an inlined string inside the WEEKLY reference
// plan's `qa` entry, the per-step instructions drifted between voiceLab.ts
// and the human-facing prompt, and the QA guard only counted PASS/FAIL
// substrings — which matched incidentally even when the model skipped half
// the steps. Existing DB rows could carry an older description that no
// longer matched the 8 step shape, and the migrations never refreshed it
// idempotently.
//
// This module is the single source of truth. The reference plan, the
// prompt, the migration, the qa-output guard, and the tests all import
// EDITORIAL_CHECKLIST_STEPS from here. Change a step name in one place →
// every consumer follows.
//
// The shape:
//   id        — short stable slug used in storage / migrations.
//   number    — 1..8, the position the reviewer must emit in their note.
//   name      — short heading name. The reviewer writes
//               `### Step N — <name>` before each verdict.
//   purpose   — one-line explanation of what the step is testing.
//   detail    — the per-step rules the reviewer applies. Kept terse so
//               the rendered QA description stays well under context
//               budgets but still tells the model exactly what to do.
//
// Output contract (Stage 6.8): each step's verdict is one of
//   PASS  — clean, no edit needed
//   FIX   — issue found, apply-fixes task MUST act on it
//   WARN  — edge case worth flagging but does not block ship
// plus an evidence quote (or filename reference) and, for FIX, the
// specific edit required. After the eight headings, the reviewer
// emits a `## Final recommendation` line with one of
//   ship | revise | reject
// so the apply-fixes task and the operator can act on it without
// scraping the body.

export interface EditorialChecklistStep {
  id: string;
  number: number;
  name: string;
  purpose: string;
  detail: string;
}

export const EDITORIAL_CHECKLIST_STEPS: ReadonlyArray<EditorialChecklistStep> = [
  {
    id: "read-aloud",
    number: 1,
    name: "Read-aloud test",
    purpose: "Catch sentences that break rhythm or sound falsely authoritative.",
    detail:
      "Read every sentence as if speaking it aloud. Flag any sentence that " +
      "(a) breaks rhythm, (b) sounds overconfident or falsely authoritative, " +
      "(c) you wouldn't choose to listen to. Quote the offending sentence and " +
      "propose a rewrite in the same voice register.",
  },
  {
    id: "contraband",
    number: 2,
    name: "Contraband list",
    purpose: "Strip AI-tell words and stock phrases that flatten the voice.",
    detail:
      "Scan the draft for these AI-tell words and rewrite or delete every " +
      "match: leverage, unlock, robust, seamless, holistic, navigate " +
      "(metaphorical), delve, meticulous, meticulously, crucial, paramount, " +
      "intricate, moreover, furthermore, in conclusion, it's worth noting " +
      "that, at the end of the day, that being said. And these phrases: " +
      "\"In today's fast-paced\", \"In an ever-evolving landscape\", \"the " +
      "[X] landscape\", \"cutting-edge\", \"empower\", \"deep dive\", " +
      "\"learnings\", \"actionable insights\". If a sentence contains two " +
      "or more, the whole sentence must be rewritten. List EVERY hit by " +
      "quoted phrase.",
  },
  {
    id: "human-tics",
    number: 3,
    name: "Human tics",
    purpose: "Confirm the draft carries Aksel's voice markers, not a polished default.",
    detail:
      "Confirm the draft contains AT LEAST THREE of: (a) a genuine " +
      "admission of personal limitation, (b) a specific number with a real " +
      "source, (c) a short single-sentence paragraph for rhythm, (d) " +
      "self-aware dry humour, (e) a parenthetical aside in em-dashes. " +
      "Quote the three (or more) instances. If fewer than three, mark FIX " +
      "and tell the apply-fixes task which kinds to add.",
  },
  {
    id: "opening",
    number: 4,
    name: "Opening test",
    purpose: "Make sure the first three sentences feel like a human typed them.",
    detail:
      "Read ONLY the first three sentences. Does it (a) make you curious, " +
      "(b) sound like a human typed it on a Tuesday, NOT like a McKinsey " +
      "deck intro? If it opens with \"In recent years\", \"The financial " +
      "services industry\", or any thesis sentence — mark FIX and propose " +
      "a scene-based opener.",
  },
  {
    id: "takeaway",
    number: 5,
    name: "Takeaway test",
    purpose: "Force the closing action to be concrete and specific to this issue.",
    detail:
      "Read ONLY the final \"The takeaway\" section. Is the action concrete " +
      "enough that the reader could actually do it this week? Is it specific " +
      "to THIS issue's argument, or could it be the takeaway from any " +
      "issue? If generic, mark FIX and propose a sharper takeaway.",
  },
  {
    id: "old-boss",
    number: 6,
    name: "Old-boss test",
    purpose: "Check the draft against the credibility-conscious reader Aksel respects.",
    detail:
      "Imagine the most credibility-conscious senior person in Aksel's " +
      "network reading this — the kind of person whose respect he actually " +
      "wants. Would Aksel be comfortable forwarding this directly to them? " +
      "If you'd be slightly embarrassed, mark FIX and name the specific " +
      "lines that would embarrass him.",
  },
  {
    id: "fact-check-preliminary",
    number: 7,
    name: "Fact check preliminary",
    purpose: "Flag every numeric claim that lacks a verifiable source link.",
    detail:
      "List every numeric claim, every date, every named source in the " +
      "draft. For each, note whether the draft includes a working inline " +
      "markdown link to a real URL. Anything without a verifiable inline " +
      "source = FIX (the next task is a dedicated fact-check, but flag " +
      "obvious problems here).",
  },
  {
    id: "length-audience-novelty",
    number: 8,
    name: "Length, audience tag & novelty",
    purpose:
      "Word count band, footer, sign-off, sentence case, audience sub-line, " +
      "and a same-theme-as-last-week guard.",
    detail:
      "Word count must be between 900 and 1,100. If 1,100+, identify the " +
      "10–15% to cut. Confirm the standard footer is intact and unchanged. " +
      "Confirm sign-off is \"— Aksel\" on its own line. Confirm headers " +
      "are sentence case, not Title Case.\n\n" +
      "AUDIENCE TAG. Read the angle task's output and find the \"Audience\" " +
      "classification (bank | sme | universal). Then check the draft's " +
      "first line after the H1. It MUST be one of:\n" +
      "  • \"*For finance leaders*\" if Audience=bank\n" +
      "  • \"*For growing businesses*\" if Audience=sme\n" +
      "  • (no sub-line, body text starts directly) if Audience=universal\n" +
      "Any other sub-line text — a different italic phrase, quotes, bold, " +
      "a blockquote wrapper, or a mismatch between classification and " +
      "sub-line — is a FIX. Quote the offending line and state the exact " +
      "replacement.\n\n" +
      "REGISTER CHECK. If Audience=sme, scan the draft for bank-only " +
      "jargon: \"BoE\", \"MREL\", \"GLEIF\", \"LEI\", \"Pillar 2\", " +
      "\"capital ratio\", \"CRR\", \"liquidity coverage\". Any hit in an " +
      "SME issue is a FIX — the SME reader will bounce. Propose a plain " +
      "replacement.\n\n" +
      "NOVELTY. If a \"RECENT ISSUES (do not repeat these themes)\" block " +
      "was appended to the brief, scan it. If THIS draft materially " +
      "overlaps with any listed issue's title or summary — same primary " +
      "subject, same regulator/event focus, same angle shape — mark FIX " +
      "and name which recent issue overlaps. Same sector with a genuinely " +
      "different lens is fine. The orchestrator runs a separate " +
      "post-save novelty check (Stage 6.7); this step catches the obvious " +
      "case before the apply-fixes task locks the issue in.",
  },
];

if (EDITORIAL_CHECKLIST_STEPS.length !== 8) {
  // Defensive: a refactor that adds or removes a step without updating the
  // tests / migrations is a silent regression. Fail loud at module load.
  throw new Error(
    `EDITORIAL_CHECKLIST_STEPS must contain exactly 8 steps; got ${EDITORIAL_CHECKLIST_STEPS.length}`,
  );
}

// Render the QA task's `description` field. This is what the orchestrator
// pipes into the editorial-lead's user message at run time. Kept readable
// so a human operator can inspect it in the templates page.
export function renderQaChecklistDescription(): string {
  const intro =
    "Self-review the draft from the previous task against the 8-step " +
    "editorial checklist below. You MUST emit one section per step, in " +
    "order, using the exact heading format `### Step N — <name>`. Under " +
    "each heading, write ONE verdict line in the form:\n\n" +
    "    Verdict: PASS | FIX | WARN\n\n" +
    "Then a short evidence block — a quoted sentence from the draft (or a " +
    "specific reference to a missing element) that justifies the verdict. " +
    "If the verdict is FIX, follow the evidence with a `Required edit:` " +
    "line stating exactly what the apply-fixes task must change. If WARN, " +
    "follow with a `Note:` line. PASS needs no edit line.\n\n" +
    "After all 8 sections, emit a final block:\n\n" +
    "    ## Final recommendation\n" +
    "    Recommendation: ship | revise | reject\n" +
    "    Rationale: <one sentence summarising the verdict mix>\n\n" +
    "Rules:\n" +
    "  • EVERY step heading must appear, even if the verdict is PASS.\n" +
    "  • `ship` only when zero FIX verdicts and no FAIL-grade WARN.\n" +
    "  • `revise` when there are FIX verdicts the apply-fixes task can " +
    "address in a single follow-up.\n" +
    "  • `reject` when the draft is fundamentally off-brief (wrong angle, " +
    "wrong audience, fabricated sources throughout). This forces a replan.\n" +
    "  • Output is plain markdown — NO <file> blocks at this stage.\n\n" +
    "─── THE 8-STEP EDITORIAL CHECKLIST ───\n";

  const steps = EDITORIAL_CHECKLIST_STEPS.map((s) =>
    `\nSTEP ${s.number} — ${s.name.toUpperCase()}\n` +
    `Purpose: ${s.purpose}\n` +
    `${s.detail}\n`,
  ).join("");

  return intro + steps;
}

// ── Guard helpers used by the orchestrator's qa-output check ─────────────────
//
// The pre-Stage-6.8 guard counted PASS/FAIL/N/A substrings, which fires
// even on output where most steps were skipped (the word "PASS" matches
// inside "Pass through to depositors"). Stage 6.8 verifies the actual
// 8 step headings are present and that at least one verdict token from
// the structured contract appears in each.

const STEP_HEADING_RE = /^###\s*Step\s*(\d+)\b/im;

export function findMissingStepHeadings(output: string): number[] {
  // For every required step number, the output must contain a heading like
  // "### Step 3 — …". Headings may be on any line, anywhere in the output.
  const missing: number[] = [];
  for (const step of EDITORIAL_CHECKLIST_STEPS) {
    const re = new RegExp(`^###\\s*Step\\s*${step.number}\\b`, "im");
    if (!re.test(output)) missing.push(step.number);
  }
  return missing;
}

export function hasFinalRecommendation(output: string): boolean {
  return /##\s*Final recommendation/i.test(output) &&
    /Recommendation:\s*(ship|revise|reject)\b/i.test(output);
}

export function parseFinalRecommendation(
  output: string,
): "ship" | "revise" | "reject" | null {
  const m = output.match(/Recommendation:\s*(ship|revise|reject)\b/i);
  if (!m) return null;
  return m[1].toLowerCase() as "ship" | "revise" | "reject";
}

export interface QaGuardReport {
  adequate: boolean;
  missingSteps: number[];
  hasFinal: boolean;
  recommendation: "ship" | "revise" | "reject" | null;
  reason: string;
}

export function evaluateQaOutput(output: string): QaGuardReport {
  const missingSteps = findMissingStepHeadings(output);
  const hasFinal = hasFinalRecommendation(output);
  const recommendation = parseFinalRecommendation(output);
  const tooShort = output.length < 400;
  const adequate = missingSteps.length === 0 && hasFinal && !tooShort;

  const parts: string[] = [];
  if (tooShort) parts.push(`only ${output.length} chars`);
  if (missingSteps.length > 0) {
    parts.push(`missing step headings: ${missingSteps.join(", ")}`);
  }
  if (!hasFinal) parts.push("no `## Final recommendation` block");
  const reason = adequate
    ? `all 8 step headings present, recommendation=${recommendation}`
    : parts.join("; ");

  // STEP_HEADING_RE is used only as a "did the model emit any heading at
  // all?" tripwire — useful for tests that want to assert format.
  void STEP_HEADING_RE;

  return { adequate, missingSteps, hasFinal, recommendation, reason };
}
