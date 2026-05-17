"""Stage 6: public-company calculators — growth, margins, multiples,
drawdown, volatility, MAs, returns.

The price-series helpers accept a list of floats (most-recent last) so the
caller can pass anything from Stooq CSV (server/connectors/marketData.ts)
or another EOD feed without forcing pandas.
"""

from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

from .startup import _finite, _ok, gross_margin, yoy_growth


CalcResult = dict[str, Any]


def operating_margin(operating_income: Optional[float], revenue: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(operating_income) and _finite(revenue) and revenue > 0): return None
    om = operating_income / revenue
    return _ok("operating_margin", "operating_margin = operatingIncome / revenue", {"operatingIncome": operating_income, "revenue": revenue}, om, "ratio", f"{om*100:.1f}% operating margin.")


def net_margin(net_income: Optional[float], revenue: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(net_income) and _finite(revenue) and revenue > 0): return None
    nm = net_income / revenue
    return _ok("net_margin", "net_margin = netIncome / revenue", {"netIncome": net_income, "revenue": revenue}, nm, "ratio", f"{nm*100:.1f}% net margin.")


def pe_ratio(price: Optional[float], eps: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(price) and _finite(eps) and eps != 0): return None
    pe = price / eps
    return _ok("pe_ratio", "P/E = price / EPS", {"price": price, "eps": eps}, pe, "x", f"{pe:.1f}× P/E.")


def ev_ebitda(ev: Optional[float], ebitda: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(ev) and _finite(ebitda) and ebitda != 0): return None
    m = ev / ebitda
    return _ok("ev_ebitda", "EV/EBITDA = EV / EBITDA", {"ev": ev, "ebitda": ebitda}, m, "x", f"{m:.1f}× EV/EBITDA.")


def price_to_sales(market_cap: Optional[float], revenue: Optional[float]) -> Optional[CalcResult]:
    if not (_finite(market_cap) and _finite(revenue) and revenue > 0): return None
    m = market_cap / revenue
    return _ok("price_to_sales", "P/S = marketCap / revenue", {"marketCap": market_cap, "revenue": revenue}, m, "x", f"{m:.1f}× P/S.")


def daily_returns(prices: list[float]) -> list[float]:
    if len(prices) < 2: return []
    arr = np.asarray(prices, dtype=float)
    return list(np.diff(arr) / arr[:-1])


def annualised_volatility(prices: list[float]) -> Optional[CalcResult]:
    rets = daily_returns(prices)
    if len(rets) < 5: return None
    vol = float(np.std(rets, ddof=1) * math.sqrt(252))
    return _ok("annualised_volatility", "vol = stdev(daily_returns) × √252", {"observations": len(rets)}, vol, "ratio", f"{vol*100:.1f}% annualised volatility.")


def max_drawdown(prices: list[float]) -> Optional[CalcResult]:
    if len(prices) < 2: return None
    arr = np.asarray(prices, dtype=float)
    peak = np.maximum.accumulate(arr)
    dd = (arr - peak) / peak
    mdd = float(dd.min())
    return _ok("max_drawdown", "mdd = min((p_t − peak_t) / peak_t)", {"observations": len(arr)}, mdd, "ratio", f"Peak-to-trough drawdown {mdd*100:.1f}%.")


def moving_average(prices: list[float], window: int) -> Optional[CalcResult]:
    if len(prices) < window or window <= 0: return None
    ma = float(np.mean(prices[-window:]))
    return _ok(f"ma_{window}", f"MA{window} = mean(last {window} closes)", {"window": window, "observations": len(prices)}, ma, "price", f"{window}-period moving average: {ma:.2f}.")


def total_return(prices: list[float]) -> Optional[CalcResult]:
    if len(prices) < 2 or prices[0] <= 0: return None
    r = (prices[-1] / prices[0]) - 1
    return _ok("total_return", "return = last/first − 1", {"first": prices[0], "last": prices[-1]}, r, "ratio", f"{r*100:.1f}% total return over {len(prices)} observations.")


def run_all_public(inputs: dict[str, Any]) -> list[CalcResult]:
    prices = inputs.get("prices") or []
    out: list[Optional[CalcResult]] = [
        yoy_growth(inputs.get("revenue"), inputs.get("previousRevenue"), "revenue"),
        gross_margin(inputs.get("grossProfit"), inputs.get("revenue")),
        operating_margin(inputs.get("operatingIncome"), inputs.get("revenue")),
        net_margin(inputs.get("netIncome"), inputs.get("revenue")),
        pe_ratio(inputs.get("price"), inputs.get("eps")),
        ev_ebitda(inputs.get("ev"), inputs.get("ebitda")),
        price_to_sales(inputs.get("marketCap"), inputs.get("revenue")),
        annualised_volatility(prices),
        max_drawdown(prices),
        moving_average(prices, 50),
        moving_average(prices, 200),
        total_return(prices),
    ]
    return [r for r in out if r is not None]
