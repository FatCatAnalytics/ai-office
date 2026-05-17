// Stage 6.1 smoke test for source-relevance scoring + claim sanitization.
//
// Run as `tsx script/test-evidence-quality.ts`. Exits non-zero on first
// failure. Deterministic — no network calls.
//
// Includes a Stripe regression suite to ensure the OpenAlex/news noise that
// surfaced in the Stage 6 live smoke test is filtered out, and that raw
// HTML / Google-redirect strings never become claims.

import {
  scoreSourceRelevance,
  shouldKeepSource,
  isScientificContext,
  isAmbiguousRegistryCandidate,
} from "../server/evidence/relevance";
import { sanitizeForClaims, looksLikeJunk, cleanEvidenceQuote } from "../server/evidence/sanitize";
import { extractClaims } from "../server/evidence/extractClaims";
import type { ConnectorResult } from "../server/connectors/types";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function eq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }
function truthy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: true }); }
function falsy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: false }); }

const stripeCtx = {
  companyName: "Stripe",
  website: "https://stripe.com",
  domain: "stripe.com",
  objective: "Online payments infrastructure for businesses",
};

// ── Source relevance: Stripe regression ─────────────────────────────────────

// Irrelevant OpenAlex paper that only mentions "stripe" in seismology context.
const seismicPaper: ConnectorResult & { connector: string } = {
  title: "Stripe formation in seismic reflection data of the North Sea",
  url: "https://doi.org/10.1234/xyz",
  sourceType: "openalex",
  publisher: "Journal of Geophysics",
  domain: "doi.org",
  reliabilityScore: 0.75,
  extractedText: "We analysed stripe-like patterns in seismic reflectors collected offshore.",
  metadata: {},
  connector: "openalex",
};
const seismicVerdict = scoreSourceRelevance(seismicPaper, stripeCtx);
eq("stripe-seismic OpenAlex paper category", seismicVerdict.category, "irrelevant");
falsy("stripe-seismic OpenAlex paper should NOT be kept", shouldKeepSource(seismicVerdict, "openalex"));

// Hip-hop / fashion paper that only mentions "stripes" generically.
const fashionPaper: ConnectorResult & { connector: string } = {
  title: "Hip-hop fashion: stripes, monograms, and identity",
  url: "https://doi.org/10.1234/abc",
  sourceType: "openalex",
  publisher: "Journal of Cultural Studies",
  domain: "doi.org",
  reliabilityScore: 0.75,
  extractedText: "The use of stripes in hip-hop fashion is closely tied to brand identity.",
  metadata: {},
  connector: "openalex",
};
const fashionVerdict = scoreSourceRelevance(fashionPaper, stripeCtx);
falsy("stripe fashion OpenAlex paper kept", shouldKeepSource(fashionVerdict, "openalex"));

// A legitimate Stripe Inc. SEC filing should always be kept (primary source).
const filing: ConnectorResult & { connector: string } = {
  title: "Form D — Stripe, Inc.",
  url: "https://www.sec.gov/cgi-bin/browse-edgar?cik=0001620333",
  sourceType: "sec_filing",
  publisher: "SEC EDGAR",
  domain: "sec.gov",
  reliabilityScore: 0.95,
  metadata: {},
  connector: "sec",
};
const filingVerdict = scoreSourceRelevance(filing, stripeCtx);
eq("SEC filing category primary", filingVerdict.category, "primary");
truthy("SEC filing kept", shouldKeepSource(filingVerdict, "sec_filing"));

// stripe.com website should be a primary source.
const website: ConnectorResult & { connector: string } = {
  title: "Stripe | Financial Infrastructure for the Internet",
  url: "https://stripe.com/",
  sourceType: "website",
  publisher: "stripe.com",
  domain: "stripe.com",
  reliabilityScore: 0.45,
  metadata: {},
  connector: "website",
};
const webVerdict = scoreSourceRelevance(website, stripeCtx);
eq("stripe.com website primary", webVerdict.category, "primary");

// A Reuters article about Stripe Inc. should be kept; the relevance scorer
// can see the multi-word company name in the title plus the reputable
// publisher.
const reuters: ConnectorResult & { connector: string } = {
  title: "Stripe valued at $70B in tender offer, sources say",
  url: "https://www.reuters.com/business/finance/stripe-tender-offer/",
  sourceType: "news_rss",
  publisher: "reuters.com",
  domain: "reuters.com",
  reliabilityScore: 0.6,
  metadata: {},
  connector: "news_rss",
};
const reutersVerdict = scoreSourceRelevance(reuters, stripeCtx);
truthy("Reuters Stripe story kept", shouldKeepSource(reutersVerdict, "news_rss"));

// Multi-word company should not get an ambiguity penalty.
const acmeCtx = { companyName: "Acme Robotics", website: "https://acme.example", domain: "acme.example" };
const acmePaper: ConnectorResult & { connector: string } = {
  title: "Acme Robotics announces autonomous arm series",
  url: "https://example.com/post",
  sourceType: "news_rss",
  publisher: "robotics.example",
  domain: "robotics.example",
  reliabilityScore: 0.6,
  metadata: {},
  connector: "news_rss",
};
const acmeVerdict = scoreSourceRelevance(acmePaper, acmeCtx);
truthy("multi-word company name news kept", shouldKeepSource(acmeVerdict, "news_rss"));

// isScientificContext for Stripe should be false; for a biotech-described
// company it should be true.
falsy("isScientific Stripe false", isScientificContext({ companyName: "Stripe", description: "Online payments for the internet" }));
truthy("isScientific biotech true", isScientificContext({ companyName: "Foo Bio", description: "We develop oncology drugs and run clinical trials." }));

// ── Stage 6.2: Registry entity resolution (Companies House / GLEIF) ────────

// 1) Unrelated UK company that happens to contain "stripe" as a substring —
//    "SBH TAMWORTH LIMITED" with no jurisdiction/identifier signals other
//    than appearing in a substring search. Must NOT be kept.
const chTamworth: ConnectorResult & { connector: string } = {
  title: "Companies House — SBH TAMWORTH LIMITED (08123456)",
  url: "https://find-and-update.company-information.service.gov.uk/company/08123456",
  sourceType: "companies_house",
  publisher: "Companies House",
  domain: "find-and-update.company-information.service.gov.uk",
  reliabilityScore: 0.82,
  metadata: { legalName: "SBH TAMWORTH LIMITED", companyNumber: "08123456", jurisdiction: "gb" },
  connector: "companies_house",
};
const chTamworthVerdict = scoreSourceRelevance(chTamworth, stripeCtx);
falsy("CH SBH TAMWORTH not kept for Stripe", shouldKeepSource(chTamworthVerdict, "companies_house"));

// 2) Generic "STRIPE LTD" — substring match on a common single-token name
//    with no LEI / CH number / domain link. Should be filtered as ambiguous.
const chStripeLtd: ConnectorResult & { connector: string } = {
  title: "Companies House — STRIPE LTD (12345678)",
  url: "https://find-and-update.company-information.service.gov.uk/company/12345678",
  sourceType: "companies_house",
  publisher: "Companies House",
  domain: "find-and-update.company-information.service.gov.uk",
  reliabilityScore: 0.82,
  metadata: { legalName: "STRIPE LTD", companyNumber: "12345678", jurisdiction: "gb" },
  connector: "companies_house",
};
const chStripeLtdVerdict = scoreSourceRelevance(chStripeLtd, stripeCtx);
falsy("CH STRIPE LTD ambiguous → not kept for Stripe (no identifier)", shouldKeepSource(chStripeLtdVerdict, "companies_house"));
truthy("CH STRIPE LTD flagged as ambiguous registry candidate", isAmbiguousRegistryCandidate(chStripeLtdVerdict, "companies_house"));

// 3) Wholly-unrelated company on a substring match — "BEYOND AMAZING LIMITED"
//    shouldn't even be in the result set, but if it appears it must drop.
const chBeyond: ConnectorResult & { connector: string } = {
  title: "Companies House — BEYOND AMAZING LIMITED (99887766)",
  url: "https://find-and-update.company-information.service.gov.uk/company/99887766",
  sourceType: "companies_house",
  publisher: "Companies House",
  domain: "find-and-update.company-information.service.gov.uk",
  reliabilityScore: 0.82,
  metadata: { legalName: "BEYOND AMAZING LIMITED", companyNumber: "99887766", jurisdiction: "gb" },
  connector: "companies_house",
};
const chBeyondVerdict = scoreSourceRelevance(chBeyond, stripeCtx);
falsy("CH BEYOND AMAZING LIMITED not kept for Stripe", shouldKeepSource(chBeyondVerdict, "companies_house"));

// 4) GLEIF "Stripe 157" / "Stripe 158" — numbered entities with no
//    identifier match must be rejected.
const gleifNumbered: ConnectorResult & { connector: string } = {
  title: "GLEIF — Stripe 157 (LEI 549300XXXXXXXXXXXXX1)",
  url: "https://search.gleif.org/#/record/549300XXXXXXXXXXXXX1",
  sourceType: "gleif",
  publisher: "GLEIF",
  domain: "gleif.org",
  reliabilityScore: 0.88,
  metadata: { lei: "549300XXXXXXXXXXXXX1", legalName: "Stripe 157", country: "KY", status: "ACTIVE" },
  connector: "gleif",
};
const gleifNumberedVerdict = scoreSourceRelevance(gleifNumbered, stripeCtx);
falsy("GLEIF 'Stripe 157' not kept for Stripe", shouldKeepSource(gleifNumberedVerdict, "gleif"));
const gleifNumbered158: ConnectorResult & { connector: string } = {
  ...gleifNumbered,
  title: "GLEIF — Stripe 158 (LEI 549300XXXXXXXXXXXXX2)",
  url: "https://search.gleif.org/#/record/549300XXXXXXXXXXXXX2",
  metadata: { lei: "549300XXXXXXXXXXXXX2", legalName: "Stripe 158", country: "KY", status: "ACTIVE" },
};
const gleifNumbered158Verdict = scoreSourceRelevance(gleifNumbered158, stripeCtx);
falsy("GLEIF 'Stripe 158' not kept for Stripe", shouldKeepSource(gleifNumbered158Verdict, "gleif"));

// 5) GLEIF — legitimate "Stripe, Inc." record. Exact normalized legal-name
//    match. Should be kept as primary/secondary.
const gleifStripeInc: ConnectorResult & { connector: string } = {
  title: "GLEIF — Stripe, Inc. (LEI 549300ABCDEFGHIJKL01)",
  url: "https://search.gleif.org/#/record/549300ABCDEFGHIJKL01",
  sourceType: "gleif",
  publisher: "GLEIF",
  domain: "gleif.org",
  reliabilityScore: 0.88,
  metadata: { lei: "549300ABCDEFGHIJKL01", legalName: "Stripe, Inc.", country: "US", status: "ACTIVE", jurisdiction: "US-DE" },
  connector: "gleif",
};
const gleifStripeIncVerdict = scoreSourceRelevance(gleifStripeInc, stripeCtx);
truthy("GLEIF 'Stripe, Inc.' kept for Stripe (exact legal-name)", shouldKeepSource(gleifStripeIncVerdict, "gleif"));

// 6) Companies House with caller-provided CH number that exactly matches
//    → always kept (identifier match).
const ctxWithCh = { ...stripeCtx, companiesHouseNumber: "08400096" };
const chWithIdentifier: ConnectorResult & { connector: string } = {
  title: "Companies House — STRIPE PAYMENTS UK LTD (08400096)",
  url: "https://find-and-update.company-information.service.gov.uk/company/08400096",
  sourceType: "companies_house",
  publisher: "Companies House",
  domain: "find-and-update.company-information.service.gov.uk",
  reliabilityScore: 0.85,
  metadata: { legalName: "STRIPE PAYMENTS UK LTD", companyNumber: "08400096", jurisdiction: "gb", status: "active" },
  connector: "companies_house",
};
const chWithIdentifierVerdict = scoreSourceRelevance(chWithIdentifier, ctxWithCh);
eq("CH identifier-match → primary", chWithIdentifierVerdict.category, "primary");
truthy("CH identifier-match kept", shouldKeepSource(chWithIdentifierVerdict, "companies_house"));

// 7) stripe.com website always kept (domain-match secondary route).
const websiteVerdict2 = scoreSourceRelevance(website, stripeCtx);
truthy("stripe.com website still kept (Stage 6.2 didn't regress website path)",
  shouldKeepSource(websiteVerdict2, "website"));

// 8) Ambiguous single-token "Block" → unrelated CH entries must drop.
const blockCtx = { companyName: "Block", website: "https://block.xyz", domain: "block.xyz" };
const chBlockNoise: ConnectorResult & { connector: string } = {
  title: "Companies House — BLOCK BUILDERS LTD (10000001)",
  url: "https://find-and-update.company-information.service.gov.uk/company/10000001",
  sourceType: "companies_house",
  publisher: "Companies House",
  domain: "find-and-update.company-information.service.gov.uk",
  reliabilityScore: 0.82,
  metadata: { legalName: "BLOCK BUILDERS LTD", companyNumber: "10000001", jurisdiction: "gb" },
  connector: "companies_house",
};
const chBlockNoiseVerdict = scoreSourceRelevance(chBlockNoise, blockCtx);
falsy("CH 'BLOCK BUILDERS LTD' not kept for Block (substring noise)",
  shouldKeepSource(chBlockNoiseVerdict, "companies_house"));

// 9) Multi-word company name — exact registry match still works.
const acmeRegCtx = { companyName: "Acme Robotics", website: "https://acme.example", domain: "acme.example" };
const acmeRegistry: ConnectorResult & { connector: string } = {
  title: "Companies House — ACME ROBOTICS LTD (11111111)",
  url: "https://find-and-update.company-information.service.gov.uk/company/11111111",
  sourceType: "companies_house",
  publisher: "Companies House",
  domain: "find-and-update.company-information.service.gov.uk",
  reliabilityScore: 0.85,
  metadata: { legalName: "ACME ROBOTICS LTD", companyNumber: "11111111", jurisdiction: "gb", status: "active" },
  connector: "companies_house",
};
const acmeRegistryVerdict = scoreSourceRelevance(acmeRegistry, acmeRegCtx);
truthy("CH 'ACME ROBOTICS LTD' kept for Acme Robotics (brand+suffix)",
  shouldKeepSource(acmeRegistryVerdict, "companies_house"));

// ── Sanitization: HTML/CSS/redirect blobs ──────────────────────────────────

const htmlBlob = `<script>alert(1)</script><div class="hero" style="color:red">Stripe powers payments</div> for <a href="https://t.co/abcdef">internet businesses</a>.`;
const cleanHtml = sanitizeForClaims(htmlBlob);
eq("strip script block", cleanHtml.includes("alert(1)"), false);
eq("strip div tag", cleanHtml.includes("<div"), false);
eq("strip raw URL", cleanHtml.includes("https://t.co"), false);
eq("keep visible link text", cleanHtml.includes("internet businesses"), true);

// Google News redirect string should not survive as a claim.
const googleRedirect = `https://news.google.com/articles/CBMiVGh0dHBzOi8vd3d3LnJldXRlcnMuY29tL2J1c2luZXNzL2ZpbmFuY2Uvc3RyaXBlLXRlbmRlci1vZmZlci0yMDI1LTAxLTE10gEA?oc=5&sa=X&ved=2ahUKEwj`;
truthy("google redirect detected as junk", looksLikeJunk(googleRedirect));

// Markdown link blob from a deck.
const markdownLink = `[See full PDF](https://example.com/deck.pdf?utm_source=email&utm_campaign=Q1)`;
const cleanMd = sanitizeForClaims(markdownLink);
eq("md link reduced to label", cleanMd.trim(), "See full PDF");

// A real sentence from a company website should NOT be junk.
const realSentence = "We raised $600 million in our Series H round at a $50 billion valuation.";
falsy("real sentence flagged as junk", looksLikeJunk(realSentence));

// A clean evidence quote is at most 280 chars and HTML-free.
const longProse = "Stripe reported strong growth across all geographies, with annual revenue climbing past fourteen billion dollars and customers in over one hundred countries. ".repeat(4);
const dirtyQuote = `<p>${longProse}</p>`;
eq("cleanEvidenceQuote length cap", cleanEvidenceQuote(dirtyQuote).length, 280);

// ── End-to-end: extractClaims rejects Google redirect blobs ─────────────────

const noisyText = `
<html><body>
<script>var x = 1;</script>
<a href="https://news.google.com/articles/CBMiVGh0dHBzOi8vd3d3LnJldXRlcnMuY29tL2J1c2luZXNzL2ZpbmFuY2Uvc3RyaXBlLXRlbmRlci1vZmZlci0yMDI1LTAxLTE10gEA?oc=5&sa=X&ved=2ahUKEwj">Reuters: Stripe valued at $70B</a>
<p>Stripe reported $14 billion in annual revenue in 2024, up 38% year over year.</p>
<style>.x{color:red}</style>
</body></html>
`;
const claims = extractClaims(noisyText);
// We expect at least the $14 billion revenue claim and the 38% growth claim,
// and zero claims whose evidenceQuote contains "google.com/articles" or "<".
eq("claims extracted from noisy html", claims.length > 0, true);
const anyJunkQuote = claims.some((c) =>
  c.evidenceQuote.includes("google.com/articles") ||
  c.evidenceQuote.includes("<") ||
  c.evidenceQuote.includes("CBMiVGh"),
);
eq("no claim quotes contain redirect/html junk", anyJunkQuote, false);

// Deck-style pasted markdown should not surface a claim that is just a URL.
const deckBlob = `
# Stripe — internal memo
- [Deck PDF](https://drive.google.com/file/d/abcdef/view?usp=sharing)
- Founded in 2010 by Patrick and John Collison.
- We have $14 billion of annualised revenue and 8000 employees.
`;
const deckClaims = extractClaims(deckBlob);
const deckJunk = deckClaims.some((c) => c.evidenceQuote.includes("drive.google.com") || c.evidenceQuote.includes("https://"));
eq("no deck claim quotes contain raw URL", deckJunk, false);
const hasHeadcount = deckClaims.some((c) => c.subject === "headcount" && c.numericValue === 8000);
truthy("deck headcount extracted", hasHeadcount);

// ── Report ─────────────────────────────────────────────────────────────────
let failed = 0;
for (const c of cases) {
  const ok = c.got === c.want;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${c.name}  got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);
  if (!ok) failed++;
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
