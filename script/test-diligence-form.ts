// Stage 6.4 smoke test — verifies that the Research objective + workflow type
// are wired through the memo renderer.
//
// Run as `tsx script/test-diligence-form.ts`. Deterministic — no network, no DB.

import { renderMemoBody } from "../server/workflows/startupDiligence";
import type { Company } from "@shared/schema";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function truthy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: true }); }
function eq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }

const company: Company = {
  id: 1,
  name: "Acme Robotics",
  legalName: null,
  website: "https://acme.example",
  domain: "acme.example",
  kind: "startup",
  ticker: null,
  exchange: null,
  cik: null,
  lei: null,
  companiesHouseNumber: null,
  country: null,
  sector: null,
  industry: null,
  foundedYear: null,
  description: "",
  metadata: "{}",
  createdAt: 0,
  updatedAt: 0,
};

const baseArgs = {
  company,
  sources: [],
  claims: [],
  calcs: [],
  contradictions: [],
  salience: { score: 0.5, explanation: "" },
  confidence: { score: 0.5, explanation: "" },
  redFlags: [],
  openQuestions: [],
};

// 1. Objective supplied → memo Snapshot shows it verbatim.
const objective = "Assess Acme as a late-stage robotics diligence candidate, focusing on hardware margins.";
const memoWithObj = renderMemoBody({ ...baseArgs, objective });
truthy("memo contains Research objective label", memoWithObj.includes("**Research objective:**"));
truthy("memo contains the supplied objective text", memoWithObj.includes(objective));
truthy("memo contains Workflow line", memoWithObj.includes("**Workflow:** Startup Due Diligence"));
truthy("Snapshot precedes Key claims", memoWithObj.indexOf("## Snapshot") < memoWithObj.indexOf("## Key claims"));

// 2. Objective blank → memo Snapshot shows the fallback string.
const memoNoObj = renderMemoBody({ ...baseArgs, objective: "" });
truthy("blank objective falls back to General public-data diligence.", memoNoObj.includes("General public-data diligence."));

// 3. Objective omitted → same fallback.
const memoUndef = renderMemoBody({ ...baseArgs });
truthy("undefined objective falls back to General public-data diligence.", memoUndef.includes("General public-data diligence."));

// 4. Whitespace-only objective → fallback.
const memoWs = renderMemoBody({ ...baseArgs, objective: "   \n\t  " });
truthy("whitespace objective falls back", memoWs.includes("General public-data diligence."));

// Report.
let failed = 0;
for (const c of cases) {
  const ok = JSON.stringify(c.got) === JSON.stringify(c.want);
  if (!ok) {
    failed++;
    console.log(`FAIL ${c.name}: got ${JSON.stringify(c.got)}, want ${JSON.stringify(c.want)}`);
  } else {
    console.log(`ok   ${c.name}`);
  }
}
eq; // suppress unused-warning in strict builds
if (failed > 0) {
  console.error(`\n${failed}/${cases.length} cases failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
