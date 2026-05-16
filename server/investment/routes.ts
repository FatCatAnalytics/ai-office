// Stage 6: investment-intelligence routes
//
// Mounts everything under /api/investment so the AI Office API surface
// stays clean. Registered from server/routes.ts via registerInvestmentRoutes().
//
// Endpoints are deliberately conservative — we expose CRUD for the lists
// and lifecycle endpoints for diligence runs. Heavy work (gathering
// public evidence, scoring) runs asynchronously inside runStartupDiligence
// after we return the queued run row.

import type { Express } from "express";
import { investmentStorage } from "./storage";
import { runStartupDiligence } from "../workflows/startupDiligence";
import { gatherPublicEvidence, CONNECTORS } from "../connectors";

export function registerInvestmentRoutes(app: Express): void {
  // ── Companies ────────────────────────────────────────────────────────────
  app.get("/api/investment/companies", (_req, res) => {
    res.json(investmentStorage.listCompanies());
  });

  app.get("/api/investment/companies/:id", (req, res) => {
    const c = investmentStorage.getCompany(parseInt(req.params.id, 10));
    if (!c) return res.status(404).json({ error: "Company not found" });
    res.json(c);
  });

  app.post("/api/investment/companies", (req, res) => {
    const { name } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name is required" });
    const existing = investmentStorage.findCompanyByName(name);
    if (existing) return res.json(existing);
    const created = investmentStorage.createCompany({
      name,
      legalName: req.body.legalName,
      website: req.body.website,
      domain: req.body.domain,
      kind: req.body.kind ?? "startup",
      ticker: req.body.ticker,
      exchange: req.body.exchange,
      cik: req.body.cik,
      lei: req.body.lei,
      companiesHouseNumber: req.body.companiesHouseNumber,
      country: req.body.country,
      sector: req.body.sector,
      industry: req.body.industry,
      foundedYear: req.body.foundedYear,
      description: req.body.description ?? "",
      metadata: typeof req.body.metadata === "string" ? req.body.metadata : JSON.stringify(req.body.metadata ?? {}),
    });
    res.json(created);
  });

  app.patch("/api/investment/companies/:id", (req, res) => {
    const updated = investmentStorage.updateCompany(parseInt(req.params.id, 10), req.body);
    if (!updated) return res.status(404).json({ error: "Company not found" });
    res.json(updated);
  });

  // ── Diligence runs ───────────────────────────────────────────────────────
  app.get("/api/investment/diligence", (req, res) => {
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;
    res.json(investmentStorage.listDiligenceRuns({ companyId }));
  });

  app.get("/api/investment/diligence/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = investmentStorage.getDiligenceRun(id);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const company = investmentStorage.getCompany(run.companyId);
    const sources = investmentStorage.listSources({ diligenceRunId: id });
    const claims = investmentStorage.listClaims({ diligenceRunId: id });
    const calculations = investmentStorage.listCalculations({ diligenceRunId: id });
    const contradictions = investmentStorage.listContradictions({ diligenceRunId: id });
    const memos = investmentStorage.listMemos({ diligenceRunId: id });
    res.json({ run, company, sources, claims, calculations, contradictions, memos });
  });

  // Kick off a startup diligence run. Returns the queued run immediately and
  // does the work in the background.
  app.post("/api/investment/diligence/startup", (req, res) => {
    const { companyName, website, ticker, deckText, modelLink } = req.body ?? {};
    if (!companyName) return res.status(400).json({ error: "companyName is required" });
    // Run async — don't await. The UI polls /api/investment/diligence/:id.
    runStartupDiligence({ companyName, website, ticker, deckText, modelLink })
      .then((run) => {
        // Log a soft success — real notification is via polling.
        console.log(`[axl] diligence run #${run.id} finished with status=${run.status}`);
      })
      .catch((e) => {
        console.error("[axl] diligence run failed:", e);
      });
    // The workflow has already created the run row by the time it yields the
    // first await, but to avoid a race we look it up by latest-for-company.
    setTimeout(() => {
      const company = investmentStorage.findCompanyByName(companyName);
      if (!company) return res.status(202).json({ status: "queued", companyName });
      const runs = investmentStorage.listDiligenceRuns({ companyId: company.id });
      const newest = runs[0];
      res.status(202).json({ status: "queued", run: newest, company });
    }, 50);
  });

  // ── Sources / claims / calculations / contradictions / memos ─────────────
  app.get("/api/investment/sources", (req, res) => {
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;
    const diligenceRunId = req.query.diligenceRunId ? parseInt(String(req.query.diligenceRunId), 10) : undefined;
    res.json(investmentStorage.listSources({ companyId, diligenceRunId }));
  });
  app.get("/api/investment/claims", (req, res) => {
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;
    const diligenceRunId = req.query.diligenceRunId ? parseInt(String(req.query.diligenceRunId), 10) : undefined;
    res.json(investmentStorage.listClaims({ companyId, diligenceRunId }));
  });
  app.get("/api/investment/calculations", (req, res) => {
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;
    const diligenceRunId = req.query.diligenceRunId ? parseInt(String(req.query.diligenceRunId), 10) : undefined;
    res.json(investmentStorage.listCalculations({ companyId, diligenceRunId }));
  });
  app.get("/api/investment/contradictions", (req, res) => {
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;
    const diligenceRunId = req.query.diligenceRunId ? parseInt(String(req.query.diligenceRunId), 10) : undefined;
    res.json(investmentStorage.listContradictions({ companyId, diligenceRunId }));
  });
  app.get("/api/investment/memos", (req, res) => {
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;
    const diligenceRunId = req.query.diligenceRunId ? parseInt(String(req.query.diligenceRunId), 10) : undefined;
    res.json(investmentStorage.listMemos({ companyId, diligenceRunId }));
  });
  app.get("/api/investment/memos/:id", (req, res) => {
    const m = investmentStorage.getMemo(parseInt(req.params.id, 10));
    if (!m) return res.status(404).json({ error: "Memo not found" });
    res.json(m);
  });

  // ── Watchlists ───────────────────────────────────────────────────────────
  app.get("/api/investment/watchlists", (_req, res) => {
    const lists = investmentStorage.listWatchlists();
    res.json(lists.map((w) => ({ ...w, items: investmentStorage.listWatchlistItems(w.id) })));
  });
  app.post("/api/investment/watchlists", (req, res) => {
    const { name, description, thesis } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name is required" });
    res.json(investmentStorage.createWatchlist({ name, description: description ?? "", thesis: thesis ?? "" }));
  });
  app.delete("/api/investment/watchlists/:id", (req, res) => {
    investmentStorage.deleteWatchlist(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });
  app.post("/api/investment/watchlists/:id/items", (req, res) => {
    const watchlistId = parseInt(req.params.id, 10);
    const { companyId, note } = req.body ?? {};
    if (!companyId) return res.status(400).json({ error: "companyId is required" });
    res.json(investmentStorage.addWatchlistItem({ watchlistId, companyId, note: note ?? "" }));
  });
  app.delete("/api/investment/watchlist-items/:id", (req, res) => {
    investmentStorage.removeWatchlistItem(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ── Market signals ───────────────────────────────────────────────────────
  app.get("/api/investment/signals", (req, res) => {
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    res.json(investmentStorage.listSignals({ companyId, limit }));
  });

  // ── Data sources catalog (read-only — the connector registry) ───────────
  app.get("/api/investment/data-sources", (_req, res) => {
    res.json(CONNECTORS.map((c) => ({
      name: c.name,
      sourceType: c.sourceType,
      reliabilityBaseline: c.reliabilityBaseline,
      requiresKey: connectorRequiresKey(c.name),
      keyConfigured: connectorKeyConfigured(c.name),
    })));
  });

  // ── Quick connector probe (debug / Data Sources page) ───────────────────
  app.post("/api/investment/data-sources/probe", async (req, res) => {
    const { companyName, connector, website, ticker } = req.body ?? {};
    if (!companyName) return res.status(400).json({ error: "companyName is required" });
    const outcome = await gatherPublicEvidence(
      { companyName, website, ticker },
      connector ? [connector] : undefined,
    );
    res.json(outcome);
  });
}

function connectorRequiresKey(name: string): boolean {
  return false; // Stage 6: every connector ships keyless
}
function connectorKeyConfigured(name: string): boolean {
  if (name === "companies_house") return Boolean(process.env.COMPANIES_HOUSE_API_KEY);
  return true; // keyless connectors are always "configured"
}
