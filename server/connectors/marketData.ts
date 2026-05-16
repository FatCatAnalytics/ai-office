// Stage 6: Public market data connector (Stooq).
//
// Stooq exposes CSV quotes at /q/d/l for any ticker, no key required.
// We fetch the last ~90 trading days for one ticker and return a single
// `market_data` source. Stage 6 is read-only — the analytics-service does the
// actual indicator math; the source row preserves the raw CSV for audit.
//
// Reliability baseline: 0.7. Stooq is reliable but lagged; for live equity
// thesis review (Milestone 2) we'd swap in yfinance or a paid feed.

import { Connector, ConnectorContext, ConnectorResult } from "./types";
import { safeFetchText } from "./http";

export const marketDataConnector: Connector = {
  name: "market_data",
  sourceType: "market_data",
  reliabilityBaseline: 0.7,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    if (!ctx.ticker) return [];
    // Stooq uses lowercase ticker, .us suffix for US equities. We try both.
    const variants = [
      `${ctx.ticker.toLowerCase()}.us`,
      ctx.ticker.toLowerCase(),
    ];
    for (const v of variants) {
      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(v)}&i=d`;
      const csv = await safeFetchText(url, { timeoutMs: ctx.timeoutMs ?? 10_000 });
      if (csv && csv.startsWith("Date,") && csv.length > 100) {
        const lines = csv.trim().split("\n");
        const tail = lines.slice(-90).join("\n");
        const header = lines[0];
        const last = lines[lines.length - 1];
        return [{
          title: `Stooq EOD prices — ${ctx.ticker.toUpperCase()} (last ${Math.min(90, lines.length - 1)} sessions)`,
          url,
          sourceType: "market_data",
          publisher: "Stooq",
          domain: "stooq.com",
          extractedText: `${header}\n${tail}`,
          reliabilityScore: 0.7,
          metadata: { lastRow: last, rowCount: lines.length - 1 },
        }];
      }
    }
    return [];
  },
};
