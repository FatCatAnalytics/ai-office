// Stage 6: SEC EDGAR connector (free, public, no key required).
//
// EDGAR requires a descriptive User-Agent. We set one via http.ts and add an
// extra "From" header here because the EDGAR docs explicitly request it.
// Looks up the company by name via the company_tickers.json endpoint, then
// fetches the most recent submissions for a CIK.
//
// Reliability baseline: 0.9. SEC filings are primary-source, regulator-verified
// material — about the strongest evidence we can cite.

import { Connector, ConnectorContext, ConnectorResult } from "./types";
import { safeFetchJson } from "./http";

interface EdgarTickerEntry { cik_str: number; ticker: string; title: string }
interface EdgarSubmissions {
  cik?: string;
  name?: string;
  sicDescription?: string;
  filings?: { recent?: { form: string[]; primaryDocument: string[]; accessionNumber: string[]; filingDate: string[]; primaryDocDescription?: string[] } };
}

const SEC_HEADERS = { from: "research@axl.ai" };

export const secEdgarConnector: Connector = {
  name: "sec_edgar",
  sourceType: "sec_filing",
  reliabilityBaseline: 0.9,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult[]> {
    const cik = ctx.cik ?? await resolveCikFromTicker(ctx.ticker)
      ?? await resolveCikFromName(ctx.companyName);
    if (!cik) return [];
    const padded = String(parseInt(cik, 10)).padStart(10, "0");
    const subs = await safeFetchJson<EdgarSubmissions>(
      `https://data.sec.gov/submissions/CIK${padded}.json`,
      { headers: SEC_HEADERS, timeoutMs: ctx.timeoutMs ?? 12_000 },
    );
    if (!subs?.filings?.recent) return [];
    const r = subs.filings.recent;
    const limit = Math.min(5, r.form.length);
    const results: ConnectorResult[] = [];
    for (let i = 0; i < limit; i++) {
      const form = r.form[i];
      const accNoRaw = r.accessionNumber[i];
      const accNo = accNoRaw.replace(/-/g, "");
      const doc = r.primaryDocument[i];
      const date = r.filingDate[i];
      const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNo}/${doc}`;
      results.push({
        title: `${subs.name ?? ctx.companyName} — ${form} (${date})`,
        url,
        sourceType: "sec_filing",
        publisher: "SEC EDGAR",
        domain: "sec.gov",
        publishedDate: parseDate(date),
        reliabilityScore: 0.92,
        metadata: {
          form,
          accessionNumber: accNoRaw,
          cik: padded,
          docDescription: r.primaryDocDescription?.[i],
        },
      });
    }
    return results;
  },
};

async function resolveCikFromTicker(ticker?: string): Promise<string | undefined> {
  if (!ticker) return undefined;
  const data = await safeFetchJson<Record<string, EdgarTickerEntry>>(
    "https://www.sec.gov/files/company_tickers.json",
    { headers: SEC_HEADERS },
  );
  if (!data) return undefined;
  const upper = ticker.toUpperCase();
  for (const k of Object.keys(data)) {
    if (data[k].ticker.toUpperCase() === upper) return String(data[k].cik_str);
  }
  return undefined;
}

async function resolveCikFromName(name: string): Promise<string | undefined> {
  const data = await safeFetchJson<Record<string, EdgarTickerEntry>>(
    "https://www.sec.gov/files/company_tickers.json",
    { headers: SEC_HEADERS },
  );
  if (!data) return undefined;
  const needle = name.toLowerCase();
  for (const k of Object.keys(data)) {
    if (data[k].title.toLowerCase().includes(needle)) return String(data[k].cik_str);
  }
  return undefined;
}

function parseDate(d: string): number | undefined {
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : undefined;
}
