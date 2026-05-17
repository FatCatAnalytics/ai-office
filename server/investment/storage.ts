// Stage 6: Axl.ai — Investment Intelligence storage layer
//
// Lives alongside the legacy SQLiteStorage in server/storage.ts. Reuses the
// same database connection (`db` is exported from storage.ts) and the same
// drizzle schema, but groups all investment-domain CRUD here so the AI
// Office storage stays untouched.

import { eq, desc, and, isNull, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import type {
  Company, InsertCompany,
  Source, InsertSource,
  Claim, InsertClaim,
  Calculation, InsertCalculation,
  Contradiction, InsertContradiction,
  DiligenceRun, InsertDiligenceRun,
  InvestmentMemo, InsertInvestmentMemo,
  Watchlist, InsertWatchlist,
  WatchlistItem, InsertWatchlistItem,
  MarketSignal, InsertMarketSignal,
} from "@shared/schema";
import { db } from "../storage";

export const investmentStorage = {
  // ── Companies ─────────────────────────────────────────────────────────────
  listCompanies(): Company[] {
    return db.select().from(schema.companies).orderBy(desc(schema.companies.createdAt)).all();
  },
  getCompany(id: number): Company | undefined {
    return db.select().from(schema.companies).where(eq(schema.companies.id, id)).get();
  },
  findCompanyByName(name: string): Company | undefined {
    return db.select().from(schema.companies).where(eq(schema.companies.name, name)).get();
  },
  createCompany(data: InsertCompany): Company {
    const now = Date.now();
    return db.insert(schema.companies).values({ ...data, createdAt: now, updatedAt: now }).returning().get()!;
  },
  updateCompany(id: number, data: Partial<Company>): Company | undefined {
    return db.update(schema.companies).set({ ...data, updatedAt: Date.now() })
      .where(eq(schema.companies.id, id)).returning().get();
  },
  deleteCompany(id: number): void {
    db.delete(schema.companies).where(eq(schema.companies.id, id)).run();
  },
  upsertCompanyByName(name: string, data: Partial<InsertCompany>): Company {
    const existing = this.findCompanyByName(name);
    if (existing) {
      const merged: Partial<Company> = { ...data };
      return this.updateCompany(existing.id, merged) ?? existing;
    }
    return this.createCompany({ name, ...data } as InsertCompany);
  },

  // ── Sources ───────────────────────────────────────────────────────────────
  listSources(filter: { companyId?: number; diligenceRunId?: number } = {}): Source[] {
    const rows = db.select().from(schema.sources).orderBy(desc(schema.sources.retrievedDate)).all();
    return rows.filter((s) =>
      (filter.companyId == null || s.companyId === filter.companyId)
      && (filter.diligenceRunId == null || s.diligenceRunId === filter.diligenceRunId),
    );
  },
  getSource(id: number): Source | undefined {
    return db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
  },
  createSource(data: InsertSource): Source {
    return db.insert(schema.sources).values(data).returning().get()!;
  },

  // ── Claims ────────────────────────────────────────────────────────────────
  listClaims(filter: { companyId?: number; diligenceRunId?: number } = {}): Claim[] {
    const rows = db.select().from(schema.claims).orderBy(desc(schema.claims.createdAt)).all();
    return rows.filter((c) =>
      (filter.companyId == null || c.companyId === filter.companyId)
      && (filter.diligenceRunId == null || c.diligenceRunId === filter.diligenceRunId),
    );
  },
  createClaim(data: InsertClaim): Claim {
    return db.insert(schema.claims).values(data).returning().get()!;
  },
  updateClaim(id: number, data: Partial<Claim>): Claim | undefined {
    return db.update(schema.claims).set(data).where(eq(schema.claims.id, id)).returning().get();
  },

  // ── Calculations ──────────────────────────────────────────────────────────
  listCalculations(filter: { companyId?: number; diligenceRunId?: number } = {}): Calculation[] {
    const rows = db.select().from(schema.calculations).orderBy(desc(schema.calculations.createdAt)).all();
    return rows.filter((c) =>
      (filter.companyId == null || c.companyId === filter.companyId)
      && (filter.diligenceRunId == null || c.diligenceRunId === filter.diligenceRunId),
    );
  },
  createCalculation(data: InsertCalculation): Calculation {
    return db.insert(schema.calculations).values(data).returning().get()!;
  },

  // ── Contradictions ────────────────────────────────────────────────────────
  listContradictions(filter: { companyId?: number; diligenceRunId?: number } = {}): Contradiction[] {
    const rows = db.select().from(schema.contradictions).orderBy(desc(schema.contradictions.createdAt)).all();
    return rows.filter((c) =>
      (filter.companyId == null || c.companyId === filter.companyId)
      && (filter.diligenceRunId == null || c.diligenceRunId === filter.diligenceRunId),
    );
  },
  createContradiction(data: InsertContradiction): Contradiction {
    return db.insert(schema.contradictions).values(data).returning().get()!;
  },

  // ── Diligence runs ────────────────────────────────────────────────────────
  listDiligenceRuns(filter: { companyId?: number } = {}): DiligenceRun[] {
    const rows = db.select().from(schema.diligenceRuns).orderBy(desc(schema.diligenceRuns.createdAt)).all();
    return filter.companyId == null ? rows : rows.filter((r) => r.companyId === filter.companyId);
  },
  getDiligenceRun(id: number): DiligenceRun | undefined {
    return db.select().from(schema.diligenceRuns).where(eq(schema.diligenceRuns.id, id)).get();
  },
  createDiligenceRun(data: InsertDiligenceRun): DiligenceRun {
    return db.insert(schema.diligenceRuns).values(data).returning().get()!;
  },
  updateDiligenceRun(id: number, data: Partial<DiligenceRun>): DiligenceRun | undefined {
    return db.update(schema.diligenceRuns).set(data).where(eq(schema.diligenceRuns.id, id)).returning().get();
  },

  // ── Investment memos ──────────────────────────────────────────────────────
  listMemos(filter: { companyId?: number; diligenceRunId?: number } = {}): InvestmentMemo[] {
    const rows = db.select().from(schema.investmentMemos).orderBy(desc(schema.investmentMemos.createdAt)).all();
    return rows.filter((m) =>
      (filter.companyId == null || m.companyId === filter.companyId)
      && (filter.diligenceRunId == null || m.diligenceRunId === filter.diligenceRunId),
    );
  },
  getMemo(id: number): InvestmentMemo | undefined {
    return db.select().from(schema.investmentMemos).where(eq(schema.investmentMemos.id, id)).get();
  },
  createMemo(data: InsertInvestmentMemo): InvestmentMemo {
    return db.insert(schema.investmentMemos).values(data).returning().get()!;
  },

  // ── Watchlists ────────────────────────────────────────────────────────────
  listWatchlists(): Watchlist[] {
    return db.select().from(schema.watchlists).orderBy(desc(schema.watchlists.createdAt)).all();
  },
  getWatchlist(id: number): Watchlist | undefined {
    return db.select().from(schema.watchlists).where(eq(schema.watchlists.id, id)).get();
  },
  createWatchlist(data: InsertWatchlist): Watchlist {
    return db.insert(schema.watchlists).values(data).returning().get()!;
  },
  deleteWatchlist(id: number): void {
    // Delete child rows before the parent so there is never a transient
    // window with orphaned watchlist_items rows pointing at a missing
    // watchlist. Wrapped in a single SQLite transaction so the operation
    // either fully succeeds or fully rolls back.
    db.transaction((tx) => {
      tx.delete(schema.watchlistItems).where(eq(schema.watchlistItems.watchlistId, id)).run();
      tx.delete(schema.watchlists).where(eq(schema.watchlists.id, id)).run();
    });
  },
  listWatchlistItems(watchlistId: number): WatchlistItem[] {
    return db.select().from(schema.watchlistItems).where(eq(schema.watchlistItems.watchlistId, watchlistId)).all();
  },
  addWatchlistItem(data: InsertWatchlistItem): WatchlistItem {
    return db.insert(schema.watchlistItems).values(data).returning().get()!;
  },
  removeWatchlistItem(id: number): void {
    db.delete(schema.watchlistItems).where(eq(schema.watchlistItems.id, id)).run();
  },

  // ── Market signals ────────────────────────────────────────────────────────
  listSignals(filter: { companyId?: number; limit?: number } = {}): MarketSignal[] {
    const rows = db.select().from(schema.marketSignals).orderBy(desc(schema.marketSignals.capturedAt)).all();
    const filtered = filter.companyId == null ? rows : rows.filter((s) => s.companyId === filter.companyId);
    return filter.limit ? filtered.slice(0, filter.limit) : filtered;
  },
  createSignal(data: InsertMarketSignal): MarketSignal {
    return db.insert(schema.marketSignals).values(data).returning().get()!;
  },
};

export type InvestmentStorage = typeof investmentStorage;
