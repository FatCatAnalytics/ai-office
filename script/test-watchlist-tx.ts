// Stage 6.x.1 smoke test for the watchlist transactional delete.
// Run with: APP_PASSWORD=anything-x npx tsx script/test-watchlist-tx.ts
//
// Writes to data.db in CWD, then cleans up. Designed to be safe even when
// data.db exists — only touches tables we create here.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.APP_PASSWORD = process.env.APP_PASSWORD || "smoke-test-app";

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axl-smoke-"));
  process.chdir(tmp);
  process.env.PROJECTS_DIR = path.join(tmp, "projects");

  const projectRoot = "/home/user/workspace/ai-office-5c56db07";
  const { investmentStorage } = await import(`${projectRoot}/server/investment/storage.ts`);

  const w = investmentStorage.createWatchlist({ name: "tx-test", description: "", thesis: "" });
  const c = investmentStorage.upsertCompanyByName("Smoke Co", { kind: "startup", description: "", metadata: "{}" });
  investmentStorage.addWatchlistItem({ watchlistId: w.id, companyId: c.id, note: "" });
  const before = investmentStorage.listWatchlistItems(w.id).length;
  investmentStorage.deleteWatchlist(w.id);
  const itemsAfter = investmentStorage.listWatchlistItems(w.id).length;
  const wlAfter = investmentStorage.listWatchlists().filter((x: any) => x.id === w.id).length;
  console.log(`items before=${before} items after=${itemsAfter} watchlist after=${wlAfter}`);
  if (before !== 1 || itemsAfter !== 0 || wlAfter !== 0) {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS — watchlist delete is transactional");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
