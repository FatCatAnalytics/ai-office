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
import { perplexityConnector } from "./perplexity";

export const CONNECTORS: Connector[] = [
  websiteConnector,
  secEdgarConnector,
  companiesHouseConnector,
  gleifConnector,
  newsRssConnector,
  gdeltConnector,
  openAlexConnector,
  marketDataConnector,
  // Stage 6.8: Perplexity is optional — the connector self-skips when
  // PERPLEXITY_API_KEY is unset, so leaving it in the default list is safe.
  perplexityConnector,
];

export interface GatherOutcome {
  results: Array<ConnectorResult & { connector: string }>;
  errors: Array<{ connector: string; error: string }>;
  durationsMs: Record<string, number>;
}

// Stage 6.x.1: ceiling per connector so one slow/hung source cannot stall a
// diligence run. The per-connector network calls already have their own
// AbortController timeouts; this is the outer wall-clock guard.
const CONNECTOR_WALL_CLOCK_MS = parseInt(
  process.env.AXL_CONNECTOR_WALL_CLOCK_MS || "20000",
  10,
);

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
      const items = await withWallClock(c.name, c.fetch(ctx), CONNECTOR_WALL_CLOCK_MS);
      for (const r of items) outcome.results.push({ ...r, connector: c.name });
    } catch (e) {
      outcome.errors.push({ connector: c.name, error: String((e as Error)?.message ?? e) });
    } finally {
      outcome.durationsMs[c.name] = Date.now() - t0;
    }
  }));
  return outcome;
}

function withWallClock<T>(name: string, p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} exceeded ${ms}ms wall-clock`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export type { Connector, ConnectorContext, ConnectorResult };
