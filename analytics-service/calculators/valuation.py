"""Stage 6: Valuation helpers — DCF lite + comparable-multiple valuation."""

from __future__ import annotations

from typing import Any, Optional

from .startup import _finite, _ok


def dcf_lite(fcf_year_one: Optional[float], growth: Optional[float], discount: Optional[float], years: int = 5, terminal_growth: float = 0.025) -> Optional[dict[str, Any]]:
    if not (_finite(fcf_year_one) and _finite(growth) and _finite(discount)): return None
    if discount <= terminal_growth: return None
    npv = 0.0
    cf = fcf_year_one
    for t in range(1, years + 1):
        npv += cf / ((1 + discount) ** t)
        cf = cf * (1 + growth)
    terminal_cf = cf  # cf at start of year (years+1)
    terminal_value = terminal_cf / (discount - terminal_growth)
    npv_terminal = terminal_value / ((1 + discount) ** years)
    total = npv + npv_terminal
    return _ok(
        "dcf_lite",
        "NPV = Σ CFᵗ / (1+r)ᵗ + TV / (1+r)ⁿ, TV = CFₙ₊₁ / (r − g_term)",
        {"fcf1": fcf_year_one, "growth": growth, "discount": discount, "years": years, "terminalGrowth": terminal_growth},
        total, "USD",
        f"DCF-lite NPV ≈ {total:,.0f}.",
    )


def multiple_valuation(metric_value: Optional[float], multiple: Optional[float], metric_name: str = "ARR") -> Optional[dict[str, Any]]:
    if not (_finite(metric_value) and _finite(multiple)): return None
    v = metric_value * multiple
    return _ok(
        "multiple_valuation",
        f"value = {metric_name} × multiple",
        {"metric": metric_name, "metricValue": metric_value, "multiple": multiple},
        v, "USD",
        f"Implied value ≈ {v:,.0f} at {multiple:.1f}× {metric_name}.",
    )


def run_all_valuation(inputs: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    a = dcf_lite(inputs.get("fcfYearOne"), inputs.get("growth"), inputs.get("discount"), int(inputs.get("years", 5)), float(inputs.get("terminalGrowth", 0.025)))
    if a: out.append(a)
    b = multiple_valuation(inputs.get("metricValue"), inputs.get("multiple"), str(inputs.get("metricName", "ARR")))
    if b: out.append(b)
    return out
