// Stage 6: UK Companies House connector
//
// The public search endpoint at https://find-and-update.company-information.service.gov.uk/
// returns HTML; the API at api.company-information.service.gov.uk requires a key.
// For the MVP we use the public search HTML and link out — no key required.
// If the user supplies COMPANIES_HOUSE_API_KEY in env, we use the real API.
//
// Reliability baseline: 0.85. Registered-entity data is regulator-verified
// but can lag reality (directors, registered address) by weeks.

import { Connector, ConnectorContext, ConnectorResult } from "./types";
import { safeFetchJson, safeFetchText, stripHtml } from "./http";

const PUBLIC_SEARCH = "https://find-and-update.company-information.service.gov.uk/search/companies";

export const companiesHouseConnector: Connector = {
  name: "companies_house",
  sourceType: "companies_house",
  reliabilityBaseline: 0.85,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    const key = process.env.COMPANIES_HOUSE_API_KEY;
    if (key) return fetchViaApi(ctx, key);
    return fetchViaPublicSearch(ctx);
  },
};

async function fetchViaApi(ctx: ConnectorContext, key: string): Promise<ConnectorResult[]> {
  const number = ctx.companiesHouseNumber;
  if (number) {
    const url = `https://api.company-information.service.gov.uk/company/${encodeURIComponent(number)}`;
    const data = await safeFetchJson<Record<string, unknown>>(url, {
      headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
    });
    if (!data) return [];
    return [{
      title: `Companies House — ${data.company_name ?? ctx.companyName} (${number})`,
      url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(number)}`,
      sourceType: "companies_house",
      publisher: "Companies House",
      domain: "find-and-update.company-information.service.gov.uk",
      extractedText: JSON.stringify(data),
      reliabilityScore: 0.88,
      metadata: data,
    }];
  }
  const q = encodeURIComponent(ctx.companyName);
  const data = await safeFetchJson<Record<string, unknown>>(
    `https://api.company-information.service.gov.uk/search/companies?q=${q}&items_per_page=3`,
    { headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` } },
  );
  const items = ((data?.items as Array<Record<string, unknown>>) ?? []).slice(0, 3);
  return items.map((it) => ({
    title: `Companies House — ${it.title}`,
    url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(String(it.company_number))}`,
    sourceType: "companies_house" as const,
    publisher: "Companies House",
    domain: "find-and-update.company-information.service.gov.uk",
    extractedText: JSON.stringify(it),
    reliabilityScore: 0.85,
    metadata: it,
  }));
}

async function fetchViaPublicSearch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
  const q = encodeURIComponent(ctx.companyName);
  const url = `${PUBLIC_SEARCH}?q=${q}`;
  const html = await safeFetchText(url, { timeoutMs: ctx.timeoutMs ?? 10_000 });
  if (!html) return [];
  // Match the first 3 company links. The result HTML uses /company/{number} links.
  const matches = Array.from(html.matchAll(/<a[^>]+href="\/company\/([A-Z0-9]+)"[^>]*>([^<]+)<\/a>/g));
  const seen = new Set<string>();
  const results: ConnectorResult[] = [];
  for (const m of matches) {
    const num = m[1];
    if (seen.has(num)) continue;
    seen.add(num);
    const title = stripHtml(m[2]).trim();
    if (!title) continue;
    results.push({
      title: `Companies House — ${title} (${num})`,
      url: `https://find-and-update.company-information.service.gov.uk/company/${num}`,
      sourceType: "companies_house",
      publisher: "Companies House",
      domain: "find-and-update.company-information.service.gov.uk",
      reliabilityScore: 0.82,
      metadata: { companyNumber: num, name: title },
    });
    if (results.length >= 3) break;
  }
  return results;
}
