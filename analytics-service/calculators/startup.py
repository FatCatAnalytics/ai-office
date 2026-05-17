"""Stage 6: Startup metric calculators.

Pure functions. Each calculator returns a `CalcResult` dict (matching the
shape consumed by server/workflows/startupDiligence.ts) when its inputs are
present, otherwise it returns None. The orchestrator filters Nones out.

Why not raise on missing inputs? The diligence run might only have partial
data (e.g. burn but no cash on hand). We still want to compute everything
we CAN compute and let the caller see exactly which calcs were skipped.
"""

from __future__ import annotations

from typing import Any, Optional


CalcResult = dict[str, Any]


def _finite(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and x not in (float("inf"), float("-inf"))


def _ok(name: str, formula: str, inputs: dict[str, Any], value: float, unit: Optional[str], explanation: str, status: str = "ok") -> CalcResult:
    return {
        "name": name,
        "formula": formula,
        "inputs": inputs,
        "resultValue": value,
        "resultText": "",
        "unit": unit,
        "explanation": explanation,
        "status": status,
    }


def arr_from_mrr(mrr: Optional[float]) -> Optional[CalcResult]:
    if not _finite(mrr): return None
    return _ok("arr_from_mrr", "ARR = MRR × 12", {"mrr": mrr}, mrr * 12, "USD", "Annualised from monthly recurring revenue.")


def yoy_growth(now: Optional[float], prev: Optional[float], label: str = "arr") -> Optional[CalcResult]:
    if not (_finite(now) and _finite(prev) and prev > 0): return None
    g = (now / prev) - 1
    return _ok(
        f"yoy_growth_{label}",
        f"growth = {label.upper()}_now / {label.upper()}_prev − 1",
        {"now": now, "prev": prev},
        g, "ratio",
        f"{g*100:.1f}% YoY {label.upper()} growth.",
    )


def cagr(start: Optional[float], end: Optional[float], years: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(start) and _finite(end) and _finite(years) and start > 0 and years > 0): return None
    c = (end / start) ** (1 / years) - 1
    return _ok("cagr", "CAGR = (end/start)^(1/years) − 1", {"start": start, "end": end, "years": years}, c, "ratio", f"{c*100:.1f}% CAGR over {years:g} years.")


def gross_margin(gross_profit: Optional[float], revenue: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(gross_profit) and _finite(revenue) and revenue > 0): return None
    gm = gross_profit / revenue
    status = "warning" if gm < 0 else "ok"
    return _ok("gross_margin", "gross_margin = grossProfit / revenue", {"grossProfit": gross_profit, "revenue": revenue}, gm, "ratio", f"{gm*100:.1f}% gross margin.", status)


def runway_months(cash: Optional[float], burn: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(cash) and _finite(burn) and burn > 0): return None
    months = cash / burn
    status = "warning" if months < 9 else "ok"
    return _ok("runway_months", "runway = cash / monthlyBurn", {"cash": cash, "burn": burn}, months, "months", f"{months:.1f} months of runway at current burn.", status)


def valuation_to_arr(valuation: Optional[float], arr: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(valuation) and _finite(arr) and arr > 0): return None
    mult = valuation / arr
    return _ok("valuation_to_arr", "multiple = valuation / ARR", {"valuation": valuation, "arr": arr}, mult, "x", f"{mult:.1f}× ARR multiple.")


def customers_required(target_revenue: Optional[float], arpu: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(target_revenue) and _finite(arpu) and arpu > 0): return None
    n = target_revenue / arpu
    return _ok("customers_required", "n = targetRevenue / ARPU", {"targetRevenue": target_revenue, "arpu": arpu}, n, "customers", f"~{n:.0f} customers required to hit the target.")


def implied_market_share(revenue: Optional[float], tam: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(revenue) and _finite(tam) and tam > 0): return None
    share = revenue / tam
    return _ok("implied_market_share", "share = revenue / TAM", {"revenue": revenue, "tam": tam}, share, "ratio", f"Currently {share*100:.3f}% of the stated TAM.")


def cac_payback_months(cac: Optional[float], monthly_gross_profit_per_customer: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(cac) and _finite(monthly_gross_profit_per_customer) and monthly_gross_profit_per_customer > 0): return None
    months = cac / monthly_gross_profit_per_customer
    return _ok("cac_payback_months", "payback = CAC / monthlyGrossProfitPerCustomer", {"cac": cac, "monthlyGP": monthly_gross_profit_per_customer}, months, "months", f"{months:.1f}-month CAC payback.", "warning" if months > 24 else "ok")


def ltv_cac(ltv: Optional[float], cac: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(ltv) and _finite(cac) and cac > 0): return None
    ratio = ltv / cac
    return _ok("ltv_cac_ratio", "ratio = LTV / CAC", {"ltv": ltv, "cac": cac}, ratio, "ratio", f"{ratio:.2f}× LTV/CAC.", "warning" if ratio < 1 else "ok")


def burn_multiple(monthly_burn: Optional[float], arr_now: Optional[float], arr_prev: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(monthly_burn) and _finite(arr_now) and _finite(arr_prev)): return None
    net_new_arr = arr_now - arr_prev
    if net_new_arr <= 0: return None
    bm = (monthly_burn * 12) / net_new_arr
    return _ok("burn_multiple", "burn_multiple = (monthlyBurn × 12) / (ARR_now − ARR_prev)", {"monthlyBurn": monthly_burn, "arrNow": arr_now, "arrPrev": arr_prev}, bm, "x", f"{bm:.2f}× burn multiple.", "warning" if bm > 2 else "ok")


def run_all_startup(inputs: dict[str, Any]) -> list[CalcResult]:
    def g(k: str) -> Optional[float]:
        v = inputs.get(k)
        return v if _finite(v) else None
    results: list[Optional[CalcResult]] = [
        arr_from_mrr(g("mrr")) if g("arr") is None else None,
        yoy_growth(g("arr"), g("previousArr"), "arr"),
        yoy_growth(g("revenue"), g("previousRevenue"), "revenue"),
        cagr(g("revenueStart"), g("revenueEnd"), g("years")),
        gross_margin(g("grossProfit"), g("revenue")),
        runway_months(g("cashOnHand"), g("monthlyBurn")),
        valuation_to_arr(g("valuation"), g("arr")),
        customers_required(g("targetRevenue"), g("arpu")),
        implied_market_share(g("revenue"), g("tam")),
        cac_payback_months(g("cac"), g("monthlyGrossProfitPerCustomer")),
        ltv_cac(g("ltv"), g("cac")),
        burn_multiple(g("monthlyBurn"), g("arr"), g("previousArr")),
    ]
    return [r for r in results if r is not None]
