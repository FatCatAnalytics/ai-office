// Stage 6.3 smoke test for website canonical-page picker, readable-text
// extraction, link discovery, and official-site claim extraction.
//
// Run as `tsx script/test-website-extraction.ts`. Exits non-zero on first
// failure. Deterministic — no network calls. Fixtures simulate a Stripe-like
// localised homepage with an English hreflang/canonical link, plus a few
// on-domain about/customers/pricing/news/careers pages.

import {
  extractReadable,
  extractAnchorHrefs,
  extractHreflang,
  extractTitle,
  extractMetaDescription,
} from "../server/connectors/http";
import { pickEnglishVariant } from "../server/connectors/website";
import { extractClaims } from "../server/evidence/extractClaims";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];
function eq(name: string, got: unknown, want: unknown) { cases.push({ name, got, want }); }
function truthy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: true }); }
function falsy(name: string, got: unknown) { cases.push({ name, got: Boolean(got), want: false }); }

// ── Fixture 1: German homepage with English hreflang/canonical ─────────────
const germanHomepage = `<!doctype html>
<html lang="de">
<head>
  <title>Online-Bezahldienst und Zahlungsdienstleister | Stripe</title>
  <meta name="description" content="Stripe ist ein Online-Bezahldienst." />
  <link rel="canonical" href="https://stripe.com/en" />
  <link rel="alternate" hreflang="en" href="https://stripe.com/en" />
  <link rel="alternate" hreflang="en-gb" href="https://stripe.com/en-gb" />
  <link rel="alternate" hreflang="de" href="https://stripe.com/de" />
  <link rel="alternate" hreflang="x-default" href="https://stripe.com/en" />
</head>
<body>
  <nav>
    <a href="https://stripe.com/de/about">Über uns</a>
    <a href="https://stripe.com/de/customers">Kunden</a>
  </nav>
  <main>
    <p>Bezahlinfrastruktur für das Internet.</p>
  </main>
</body>
</html>`;

const englishPicked = pickEnglishVariant("https://stripe.com/de", germanHomepage, "stripe.com");
eq("German homepage → picks https://stripe.com/en", englishPicked, "https://stripe.com/en");

const hreflangParsed = extractHreflang(germanHomepage, "https://stripe.com/de");
truthy("hreflang en parsed", hreflangParsed.some((h) => h.lang === "en" && h.href === "https://stripe.com/en"));
truthy("hreflang en-gb parsed", hreflangParsed.some((h) => h.lang === "en-gb" && h.href === "https://stripe.com/en-gb"));
truthy("hreflang x-default parsed", hreflangParsed.some((h) => h.lang === "x-default"));

// ── Fixture 2: English homepage already, canonical → self should not loop ──
const englishHomepage = `<!doctype html>
<html lang="en">
<head>
  <title>Stripe | Financial Infrastructure for the Internet</title>
  <meta name="description" content="Millions of businesses use Stripe." />
  <link rel="canonical" href="https://stripe.com/" />
</head>
<body>
<main>
  <h1>Financial infrastructure for the internet</h1>
  <h2>Powering payments for 100+ countries</h2>
  <p>Stripe powers online and in-person payment processing and financial solutions for businesses of all sizes.</p>
  <p>Available in 46 countries, supporting 135+ currencies and many local payment methods.</p>
  <p>We process billions of API requests for millions of businesses worldwide.</p>
  <ul>
    <li>Accept 25 payment methods including cards, wallets, and bank debits.</li>
    <li>Stripe is headquartered in San Francisco, California and Dublin, Ireland.</li>
  </ul>
  <a href="/about">About Stripe</a>
  <a href="/customers">Customers</a>
  <a href="/pricing">Pricing</a>
  <a href="/news">Newsroom</a>
  <a href="/careers">Careers</a>
  <a href="/enterprise">Enterprise</a>
  <a href="https://github.com/stripe">GitHub</a>
  <a href="https://twitter.com/stripe">Twitter</a>
  <a href="/login?return=/dashboard">Sign in</a>
  <a href="javascript:void(0)">Open modal</a>
  <a href="mailto:hello@stripe.com">Contact</a>
  <a href="/whitepaper.pdf">PDF whitepaper</a>
</main>
</body>
</html>`;

const englishSeed = pickEnglishVariant("https://stripe.com/", englishHomepage, "stripe.com");
// Canonical is the same as the seed, so no change is expected.
truthy("English homepage picker stays on same domain", englishSeed?.startsWith("https://stripe.com"));

const anchors = extractAnchorHrefs(englishHomepage, "https://stripe.com/");
truthy("anchor extraction picks up /about", anchors.some((a) => a.href === "https://stripe.com/about"));
truthy("anchor extraction picks up /customers", anchors.some((a) => a.href === "https://stripe.com/customers"));
truthy("anchor extraction picks up /pricing", anchors.some((a) => a.href === "https://stripe.com/pricing"));
truthy("anchor extraction picks up /news", anchors.some((a) => a.href === "https://stripe.com/news"));
truthy("anchor extraction picks up /careers", anchors.some((a) => a.href === "https://stripe.com/careers"));
falsy("anchor extraction drops javascript: links", anchors.some((a) => a.href.startsWith("javascript:")));
falsy("anchor extraction drops mailto: links", anchors.some((a) => a.href.startsWith("mailto:")));

// ── Fixture 3: readable extraction strips chrome, keeps semantic blocks ────
const richPage = `<!doctype html>
<html lang="en">
<head>
  <title>About — Stripe</title>
  <meta name="description" content="Stripe builds economic infrastructure for the internet." />
</head>
<body>
  <header><nav><a href="/login">Sign in</a></nav></header>
  <div id="cookie-banner">We use cookies. <a href="/cookies">Manage</a></div>
  <main>
    <h1>About Stripe</h1>
    <h2>Our mission is to increase the GDP of the internet.</h2>
    <p>Stripe is a financial infrastructure platform for businesses. Millions of companies, from the world's largest enterprises to the most ambitious startups, use Stripe to accept payments and grow their revenue.</p>
    <p>We are headquartered in San Francisco, California and Dublin, Ireland.</p>
    <p>Stripe supports 135+ currencies and is available in 46 countries.</p>
    <ul>
      <li>We process payments in over 100 currencies for businesses of every size.</li>
      <li>We accept 25 payment methods including credit cards, debit cards, and digital wallets.</li>
    </ul>
    <script>tracker.init();</script>
    <style>.x{color:red}</style>
  </main>
  <footer>© Stripe 2025 — <a href="/privacy">Privacy</a></footer>
</body>
</html>`;

const readable = extractReadable(richPage, "https://stripe.com/about");
eq("title parsed", readable.title, "About — Stripe");
eq("meta description parsed", readable.description, "Stripe builds economic infrastructure for the internet.");
truthy("h1 captured", readable.h1.some((s) => s.toLowerCase().includes("about stripe")));
truthy("h2 captured", readable.h2.some((s) => s.toLowerCase().includes("mission")));
truthy("paragraph captured", readable.paragraphs.some((s) => s.toLowerCase().includes("infrastructure platform")));
truthy("list item captured", readable.listItems.some((s) => s.toLowerCase().includes("payment methods")));
falsy("nav/header text leaked", readable.text.toLowerCase().includes("sign in"));
falsy("footer text leaked", readable.text.toLowerCase().includes("© stripe"));
falsy("cookie banner text leaked", readable.text.toLowerCase().includes("we use cookies"));
falsy("script content leaked", readable.text.includes("tracker.init"));
falsy("style content leaked", readable.text.includes("color:red"));

// ── Fixture 4: official-site claim extraction on the rich page ─────────────
const officialClaims = extractClaims(readable.text, { officialSite: true });
truthy("countries claim found", officialClaims.some((c) => c.subject === "countries_supported" && c.numericValue === 46));
truthy("payment_methods claim found", officialClaims.some((c) => c.subject === "payment_methods" && c.numericValue === 25));
truthy("headquarters claim found", officialClaims.some((c) => c.subject === "headquarters" && /san francisco/i.test(c.statement)));
// All evidence quotes should be clean strings (no raw HTML).
falsy("any claim quote has <tag>", officialClaims.some((c) => /<\/?[a-z]/i.test(c.evidenceQuote)));
falsy("any claim quote is raw url", officialClaims.some((c) => /^https?:\/\//.test(c.evidenceQuote)));

// Without officialSite flag, the same countries/payment-method patterns must NOT
// fire (we want to keep regex misfires off news/research sources).
const defaultClaims = extractClaims(readable.text);
falsy("countries claim suppressed without officialSite", defaultClaims.some((c) => c.subject === "countries_supported"));
falsy("payment_methods claim suppressed without officialSite", defaultClaims.some((c) => c.subject === "payment_methods"));

// ── Fixture 5: localised title alone should not survive as the only signal ──
const onlyLocalizedHomepage = `<!doctype html>
<html lang="de">
<head>
  <title>Online-Bezahldienst und Zahlungsdienstleister | Stripe</title>
</head>
<body><main><p>Stripe ist ein Online-Bezahldienst.</p></main></body>
</html>`;
const titleOnly = extractTitle(onlyLocalizedHomepage);
eq("localized title parsed", titleOnly, "Online-Bezahldienst und Zahlungsdienstleister | Stripe");
const readableLocalized = extractReadable(onlyLocalizedHomepage, "https://stripe.com/de");
// We should be picking up the paragraph too — title alone is not the only output.
truthy("paragraph captured from localized page", readableLocalized.paragraphs.length > 0);

// ── Fixture 6: pricing claims (Stripe-like flat + percentage) ──────────────
const pricingSentence = "Pay 2.9% + $0.30 per successful card payment, with no setup or monthly fees.";
const pricingClaims = extractClaims(pricingSentence, { officialSite: true });
truthy("pricing pct claim", pricingClaims.some((c) => c.subject === "pricing_pct" && Math.abs((c.numericValue ?? 0) - 2.9) < 0.01));
truthy("pricing flat claim", pricingClaims.some((c) => c.subject === "pricing_flat" && Math.abs((c.numericValue ?? 0) - 0.30) < 0.01));

// ── Fixture 7: launch / careers signals ────────────────────────────────────
const launchSentence = "We launched Stripe Atlas in February 2016 to help founders incorporate online.";
const launchClaims = extractClaims(launchSentence, { officialSite: true });
truthy("launch claim detected", launchClaims.some((c) => c.subject === "launch" && /atlas/i.test(c.statement)));

const careersSentence = "We're hiring across engineering, product, and design — view open positions in San Francisco and Dublin.";
const careerClaims = extractClaims(careersSentence, { officialSite: true });
truthy("hiring signal detected", careerClaims.some((c) => c.subject === "hiring_signal"));

// ── Fixture 8: same-registrable-domain helper via canonical resolution ─────
// (Indirectly via pickEnglishVariant: a cross-domain canonical must not be
// returned.)
const crossDomain = `<!doctype html><html lang="de"><head>
  <title>Bezahl</title>
  <link rel="canonical" href="https://example.org/en" />
</head><body><p>x</p></body></html>`;
const crossPick = pickEnglishVariant("https://stripe.com/de", crossDomain, "stripe.com");
// Should fall back to the seed because the canonical is off-domain.
eq("cross-domain canonical rejected", crossPick, "https://stripe.com/de");

// ── Fixture 9: title-only homepage's extractedText doesn't reduce to the title alone ──
// (Verifies that even when meta-description is missing, paragraphs survive.)
truthy("readableLocalized.text is non-empty",
  (readableLocalized.text ?? "").trim().length > 0);
truthy("readableLocalized.text is not just the localized title",
  (readableLocalized.text ?? "").trim() !== (titleOnly ?? "").trim());

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
