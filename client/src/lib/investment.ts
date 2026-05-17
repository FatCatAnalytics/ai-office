// Stage 6: shared types + helpers for the Axl.ai Investment Intelligence UI.
//
// Mirrors the server-side schema but in TypeScript-only form so the client
// doesn't need to import the Drizzle schema (which pulls in better-sqlite3).

import { apiRequest } from "./queryClient";

export interface Company {
  id: number;
  name: string;
  legalName?: string | null;
  website?: string | null;
  domain?: string | null;
  kind: string;
  ticker?: string | null;
  exchange?: string | null;
  cik?: string | null;
  lei?: string | null;
  companiesHouseNumber?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;
  foundedYear?: number | null;
  description: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}

export interface Source {
  id: number;
  companyId: number | null;
  diligenceRunId: number | null;
  title: string;
  url: string;
  sourceType: string;
  publisher?: string | null;
  domain?: string | null;
  publishedDate?: number | null;
  retrievedDate: number;
  rawText: string;
  extractedText: string;
  reliabilityScore: number;
  metadata: string;
  createdAt: number;
}

export interface Claim {
  id: number;
  companyId: number;
  diligenceRunId: number | null;
  sourceId: number | null;
  supportingSourceIds: string;
  statement: string;
  subject: string;
  numericValue?: number | null;
  unit?: string | null;
  status: string;
  confidence: number;
  evidenceQuote: string;
  metadata: string;
  createdAt: number;
}

export interface Calculation {
  id: number;
  companyId: number;
  diligenceRunId: number | null;
  name: string;
  formula: string;
  inputs: string;
  inputClaimIds: string;
  resultValue?: number | null;
  resultText: string;
  unit?: string | null;
  explanation: string;
  status: string;
  createdAt: number;
}

export interface Contradiction {
  id: number;
  companyId: number;
  diligenceRunId: number | null;
  claimAId: number;
  claimBId: number | null;
  calculationId: number | null;
  severity: string;
  description: string;
  resolved: number;
  createdAt: number;
}

export interface DiligenceRun {
  id: number;
  companyId: number;
  kind: string;
  status: string;
  summary: string;
  inputs: string;
  salienceScore?: number | null;
  confidenceScore?: number | null;
  scoreBreakdown: string;
  redFlags: string;
  openQuestions: string;
  startedAt?: number | null;
  completedAt?: number | null;
  error?: string | null;
  createdAt: number;
}

export interface InvestmentMemo {
  id: number;
  diligenceRunId: number;
  companyId: number;
  title: string;
  body: string;
  recommendation: string;
  thesisSummary: string;
  citedSourceIds: string;
  citedClaimIds: string;
  disclaimer: string;
  createdAt: number;
}

export interface Watchlist {
  id: number;
  name: string;
  description: string;
  thesis: string;
  createdAt: number;
  items: WatchlistItem[];
}

export interface WatchlistItem {
  id: number;
  watchlistId: number;
  companyId: number;
  note: string;
  addedAt: number;
}

export interface MarketSignal {
  id: number;
  companyId: number | null;
  kind: string;
  title: string;
  detail: string;
  url?: string | null;
  severity: string;
  publishedAt?: number | null;
  capturedAt: number;
  metadata: string;
}

export interface DataSource {
  name: string;
  sourceType: string;
  reliabilityBaseline: number;
  requiresKey: boolean;
  keyConfigured: boolean;
}

export const CLAIM_STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  verified:               { bg: "rgba(34,197,94,.1)",  fg: "#22c55e", label: "Verified" },
  company_claimed:        { bg: "rgba(251,191,36,.1)", fg: "#fbbf24", label: "Company-claimed" },
  third_party_reported:   { bg: "rgba(59,130,246,.1)", fg: "#3b82f6", label: "Third-party" },
  calculated:             { bg: "rgba(168,85,247,.1)", fg: "#a855f7", label: "Calculated" },
  inferred:               { bg: "rgba(148,163,184,.1)", fg: "#94a3b8", label: "Inferred" },
  unverified:             { bg: "rgba(148,163,184,.15)", fg: "#cbd5e1", label: "Unverified" },
  contradicted:           { bg: "rgba(239,68,68,.12)",  fg: "#ef4444", label: "Contradicted" },
  outdated:               { bg: "rgba(245,158,11,.12)", fg: "#f59e0b", label: "Outdated" },
};

export function getJson<T = unknown>(url: string): Promise<T> {
  return apiRequest("GET", url).then((r) => r.json());
}

export function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  return apiRequest("POST", url, body).then((r) => r.json());
}

export function fmtScore(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

export function safeParse<T = unknown>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export const INVESTMENT_DISCLAIMER =
  "Research and analysis only. Not personalized financial advice. " +
  "Public data may be incomplete or lagged — verify independently before acting.";
