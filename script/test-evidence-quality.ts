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
