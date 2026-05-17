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
import { previewWebsiteUrl } from "../connectors/website";

const MAX_INLINE_DECK_BYTES = 32_768;

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

  // Kick off a startup diligence run.
  //
  // Stage 6.x.1: create company + run row synchronously, return the run id
  // deterministically, then run heavy work in the background using that
  // existing run id. Concurrent submissions for the same company now each
  // get their own run row, and the response never returns someone else's
  // newest row by accident.
  app.post("/api/investment/diligence/startup", async (req, res) => {
    const { companyName, website, ticker, deckText, modelLink, objective, workflowType } = req.body ?? {};
    if (!companyName || typeof companyName !== "string") {
      return res.status(400).json({ error: "companyName is required" });
    }

    // Stage 6.4: only Startup Due Diligence is implemented; the form may
    // submit a workflowType but anything other than startup_due_diligence
    // is silently coerced (the UI marks them as "planned"). Persisting the
    // requested value keeps the audit trail honest.
    const requestedWorkflow = typeof workflowType === "string" ? workflowType : "startup_due_diligence";
    const effectiveWorkflow = "startup_due_diligence";
    const objectiveText =
      typeof objective === "string" ? objective.trim().slice(0, 4_000) : "";

    if (website && typeof website === "string") {
      const verdict = await previewWebsiteUrl(website);
      if (!verdict.ok) {
        return res.status(400).json({
          error: "website URL rejected by safety check",
          detail: verdict.reason,
        });
      }
    }

    const company =
      investmentStorage.findCompanyByName(companyName) ??
      investmentStorage.createCompany({
        name: companyName,
        website: typeof website === "string" ? website : undefined,
        kind: "startup",
        ticker: typeof ticker === "string" ? ticker : undefined,
        description: "",
        metadata: "{}",
      });

    const truncatedDeck =
      typeof deckText === "string" && deckText.length > MAX_INLINE_DECK_BYTES
        ? deckText.slice(0, MAX_INLINE_DECK_BYTES)
        : (typeof deckText === "string" ? deckText : undefined);
    const inputsSnapshot = {
      companyName,
      website,
      ticker,
      modelLink,
      objective: objectiveText,
      workflowType: effectiveWorkflow,
      requestedWorkflowType: requestedWorkflow,
      deckTextLength: typeof deckText === "string" ? deckText.length : 0,
      deckTextExcerpt: truncatedDeck ? truncatedDeck.slice(0, 4_000) : undefined,
      deckTextTruncated:
        typeof deckText === "string" && deckText.length > MAX_INLINE_DECK_BYTES,
    };

    const run = investmentStorage.createDiligenceRun({
      companyId: company.id,
      kind: "startup",
      status: "queued",
      summary: "Queued — gathering public evidence will begin shortly.",
      inputs: JSON.stringify(inputsSnapshot),
      startedAt: Date.now(),
    });

    // Hand off to the workflow with the run row we just created.
    void runStartupDiligence({
      companyName,
      website,
      ticker,
      deckText: truncatedDeck,
      modelLink,
      objective: objectiveText || undefined,
      existingRunId: run.id,
      existingCompanyId: company.id,
    })
      .then((finished) => {
        console.log(`[axl] diligence run #${finished.id} finished with status=${finished.status}`);
      })
      .catch((e) => {
        const msg = String((e as Error)?.message ?? e).slice(0, 600);
        console.error("[axl] diligence run failed:", msg);
        investmentStorage.updateDiligenceRun(run.id, {
          status: "failed",
          completedAt: Date.now(),
          summary: "Background processing failed — see error field.",
          error: msg,
        });
      });

    return res.status(202).json({ status: "queued", run, company });
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
    if (website && typeof website === "string") {
      const verdict = await previewWebsiteUrl(website);
      if (!verdict.ok) {
        return res.status(400).json({
          error: "website URL rejected by safety check",
          detail: verdict.reason,
        });
      }
    }
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
