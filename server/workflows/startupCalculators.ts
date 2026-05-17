// Stage 6: Local TypeScript mirror of the Python analytics-service startup
// calculators. Used as a fallback when the analytics-service is offline so
// the diligence workflow still produces useful math. The Python service is
// the source of truth for production; this exists to keep the MVP self-
// contained and to give us something to test in TypeScript-only CI.

export interface StartupInputs {
  arr?: number;
  mrr?: number;
  revenue?: number;
  previousArr?: number;
  previousRevenue?: number;
  grossProfit?: number;
  monthlyBurn?: number;
  cashOnHand?: number;
  valuation?: number;
  headcount?: number;
  customers?: number;
  tam?: number;
  cac?: number;
  ltv?: number;
  paybackMonths?: number;
}

export interface CalcResult {
  name: string;
  formula: string;
  inputs: Record<string, unknown>;
  resultValue?: number | null;
  resultText?: string;
  unit?: string | null;
  explanation: string;
  status: "ok" | "warning" | "error";
}

function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function startupCalculators(i: StartupInputs): CalcResult[] {
  const out: CalcResult[] = [];

  // ARR from MRR ──────────────────────────────────────────────────────────
  if (!finite(i.arr) && finite(i.mrr)) {
    out.push({
      name: "arr_from_mrr",
      formula: "ARR = MRR × 12",
      inputs: { mrr: i.mrr },
      resultValue: i.mrr * 12,
      unit: "USD",
      explanation: "Annualised from monthly recurring revenue.",
      status: "ok",
    });
  }

  // CAGR ──────────────────────────────────────────────────────────────────
  if (finite(i.arr) && finite(i.previousArr) && i.previousArr > 0) {
    const cagr = (i.arr / i.previousArr) - 1;
    out.push({
      name: "yoy_growth_arr",
      formula: "growth = ARR_now / ARR_prev − 1",
      inputs: { arr: i.arr, previousArr: i.previousArr },
      resultValue: cagr,
      unit: "ratio",
      explanation: `${(cagr * 100).toFixed(1)}% YoY ARR growth.`,
      status: "ok",
    });
  }

  // Gross margin ─────────────────────────────────────────────────────────
  if (finite(i.grossProfit) && finite(i.revenue) && i.revenue > 0) {
    const gm = i.grossProfit / i.revenue;
    out.push({
      name: "gross_margin",
      formula: "gross_margin = grossProfit / revenue",
      inputs: { grossProfit: i.grossProfit, revenue: i.revenue },
      resultValue: gm,
      unit: "ratio",
      explanation: `${(gm * 100).toFixed(1)}% gross margin.`,
      status: gm < 0 ? "warning" : "ok",
    });
  }

  // Runway ────────────────────────────────────────────────────────────────
  if (finite(i.cashOnHand) && finite(i.monthlyBurn) && i.monthlyBurn > 0) {
    const months = i.cashOnHand / i.monthlyBurn;
    out.push({
      name: "runway_months",
      formula: "runway = cash / monthlyBurn",
      inputs: { cash: i.cashOnHand, burn: i.monthlyBurn },
      resultValue: months,
      unit: "months",
      explanation: `${months.toFixed(1)} months of runway at current burn.`,
      status: months < 9 ? "warning" : "ok",
    });
  }

  // Valuation / ARR multiple ─────────────────────────────────────────────
  if (finite(i.valuation) && finite(i.arr) && i.arr > 0) {
    const mult = i.valuation / i.arr;
    out.push({
      name: "valuation_to_arr",
      formula: "multiple = valuation / ARR",
      inputs: { valuation: i.valuation, arr: i.arr },
      resultValue: mult,
      unit: "x",
      explanation: `${mult.toFixed(1)}× ARR multiple.`,
      status: "ok",
    });
  }

  // Implied market share if valuation justified by TAM ──────────────────
  if (finite(i.revenue) && finite(i.tam) && i.tam > 0) {
    const share = i.revenue / i.tam;
    out.push({
      name: "implied_market_share",
      formula: "share = revenue / TAM",
      inputs: { revenue: i.revenue, tam: i.tam },
      resultValue: share,
      unit: "ratio",
      explanation: `Currently ${(share * 100).toFixed(3)}% of the stated TAM.`,
      status: "ok",
    });
  }

  // LTV / CAC ─────────────────────────────────────────────────────────────
  if (finite(i.ltv) && finite(i.cac) && i.cac > 0) {
    const ratio = i.ltv / i.cac;
    out.push({
      name: "ltv_cac_ratio",
      formula: "ratio = LTV / CAC",
      inputs: { ltv: i.ltv, cac: i.cac },
      resultValue: ratio,
      unit: "ratio",
      explanation: `${ratio.toFixed(2)}× LTV/CAC.`,
      status: ratio < 1 ? "warning" : "ok",
    });
  }

  // CAC payback months ────────────────────────────────────────────────────
  if (finite(i.paybackMonths)) {
    out.push({
      name: "cac_payback_months",
      formula: "given",
      inputs: { paybackMonths: i.paybackMonths },
      resultValue: i.paybackMonths,
      unit: "months",
      explanation: `${i.paybackMonths.toFixed(1)}-month CAC payback per source.`,
      status: i.paybackMonths > 24 ? "warning" : "ok",
    });
  }

  // Burn multiple ─────────────────────────────────────────────────────────
  if (finite(i.monthlyBurn) && finite(i.arr) && finite(i.previousArr) && i.arr - i.previousArr > 0) {
    const annualNetBurn = i.monthlyBurn * 12;
    const netNewArr = i.arr - i.previousArr;
    const bm = annualNetBurn / netNewArr;
    out.push({
      name: "burn_multiple",
      formula: "burn_multiple = (monthlyBurn × 12) / (ARR_now − ARR_prev)",
      inputs: { monthlyBurn: i.monthlyBurn, arr: i.arr, previousArr: i.previousArr },
      resultValue: bm,
      unit: "x",
      explanation: `${bm.toFixed(2)}× burn multiple.`,
      status: bm > 2 ? "warning" : "ok",
    });
  }

  return out;
}
