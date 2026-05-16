// Stage 6: connector registry + parallel runner.
//
// `gatherPublicEvidence` runs every connector in parallel against the given
// context. Each connector is wrapped in a try/catch so one slow connector
// can never block the rest of the run. Returns one flat list of results
// ready to be persisted as `sources` rows.

import { Connector, ConnectorContext, ConnectorResult } from "./types";
import { websiteConnector } from "./website";
import { secEdgarConnector } from "./sec";
import { companiesHouseConnector } from "./companiesHouse";
import { gleifConnector } from "./gleif";
import { newsRssConnector } from "./newsRss";
import { gdeltConnector } from "./gdelt";
import { openAlexConnector } from "./openalex";
import { marketDataConnector } from "./marketData";

export const CONNECTORS: Connector[] = [
  websiteConnector,
  secEdgarConnector,
  companiesHouseConnector,
  gleifConnector,
  newsRssConnector,
  gdeltConnector,
  openAlexConnector,
  marketDataConnector,
];

export interface GatherOutcome {
  results: Array<ConnectorResult & { connector: string }>;
  errors: Array<{ connector: string; error: string }>;
  durationsMs: Record<string, number>;
}

export async function gatherPublicEvidence(
  ctx: ConnectorContext,
  selected?: string[],
): Promise<GatherOutcome> {
  const targets = selected
    ? CONNECTORS.filter((c) => selected.includes(c.name))
    : CONNECTORS;
  const outcome: GatherOutcome = { results: [], errors: [], durationsMs: {} };
  await Promise.all(targets.map(async (c) => {
    const t0 = Date.now();
    try {
      const items = await c.fetch(ctx);
      for (const r of items) outcome.results.push({ ...r, connector: c.name });
    } catch (e) {
      outcome.errors.push({ connector: c.name, error: String((e as Error)?.message ?? e) });
    } finally {
      outcome.durationsMs[c.name] = Date.now() - t0;
    }
  }));
  return outcome;
}

export type { Connector, ConnectorContext, ConnectorResult };
