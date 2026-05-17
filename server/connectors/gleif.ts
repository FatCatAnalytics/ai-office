// Stage 6: GLEIF (Global Legal Entity Identifier Foundation) connector.
//
// Free public API, no key. Useful for confirming legal entity name, jurisdiction,
// and corporate group structure on a publicly-registered company.
// Reliability baseline: 0.88 (regulator-curated registry).

import { Connector, ConnectorContext, ConnectorResult } from "./types";
import { safeFetchJson } from "./http";

interface GleifResponse {
  data?: Array<{
    id: string;
    attributes?: {
      entity?: {
        legalName?: { name?: string };
        legalAddress?: { country?: string };
        legalJurisdiction?: string;
        status?: string;
      };
      registration?: { initialRegistrationDate?: string; lastUpdateDate?: string };
    };
  }>;
}

export const gleifConnector: Connector = {
  name: "gleif",
  sourceType: "gleif",
  reliabilityBaseline: 0.88,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    const q = encodeURIComponent(ctx.companyName);
    const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${q}&page[size]=3`;
    const data = await safeFetchJson<GleifResponse>(url, { timeoutMs: ctx.timeoutMs ?? 10_000 });
    const items = data?.data ?? [];
    return items.slice(0, 5).map((it) => {
      const lei = it.id;
      const name = it.attributes?.entity?.legalName?.name ?? ctx.companyName;
      const country = it.attributes?.entity?.legalAddress?.country;
      const status = it.attributes?.entity?.status;
      const jurisdiction = it.attributes?.entity?.legalJurisdiction;
      return {
        title: `GLEIF — ${name} (LEI ${lei})`,
        url: `https://search.gleif.org/#/record/${lei}`,
        sourceType: "gleif" as const,
        publisher: "GLEIF",
        domain: "gleif.org",
        extractedText: JSON.stringify({ lei, name, country, status, jurisdiction }),
        reliabilityScore: 0.88,
        metadata: {
          lei,
          legalName: name,
          country,
          status,
          jurisdiction,
        },
      };
    });
  },
};
