"""Stage 6: portfolio/risk calculators.

Sharpe-style metrics over a portfolio of historical returns, plus a simple
correlation / weight-based concentration check. Inputs come either as
{ "returns": [[...], ...] } (matrix N x T, one row per asset) or
{ "prices": [[...], ...] } (we convert to returns internally).
"""

from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

from .startup import _ok


def _to_returns(prices_matrix: list[list[float]]) -> np.ndarray:
    arr = np.asarray(prices_matrix, dtype=float)
    if arr.ndim != 2 or arr.shape[1] < 2:
        return np.empty((0, 0))
    return np.diff(arr, axis=1) / arr[:, :-1]


def portfolio_volatility(returns: list[list[float]], weights: list[float]) -> Optional[dict[str, Any]]:
    if not returns or not weights or len(returns) != len(weights):
        return None
    R = np.asarray(returns, dtype=float)
    if R.shape[1] < 2: return None
    w = np.asarray(weights, dtype=float)
    cov = np.cov(R, ddof=1)
    if cov.ndim == 0:
        # single asset edge case
        var = float(cov)
    else:
        var = float(w @ cov @ w)
    vol = math.sqrt(max(0.0, var)) * math.sqrt(252)
    return _ok("portfolio_volatility", "vol = sqrt(wᵀ Σ w) × √252", {"weights": list(w)}, vol, "ratio", f"{vol*100:.2f}% annualised portfolio volatility.")


def sharpe_ratio(returns: list[float], risk_free_daily: float = 0.0) -> Optional[dict[str, Any]]:
    r = np.asarray(returns, dtype=float)
    if r.size < 5: return None
    excess = r - risk_free_daily
    sd = float(np.std(excess, ddof=1))
    if sd == 0: return None
    sr = float(np.mean(excess) / sd) * math.sqrt(252)
    return _ok("sharpe_ratio", "Sharpe = mean(excess) / stdev(excess) × √252", {"observations": int(r.size), "rf_daily": risk_free_daily}, sr, "ratio", f"{sr:.2f} annualised Sharpe.")


def concentration_hhi(weights: list[float]) -> Optional[dict[str, Any]]:
    if not weights: return None
    w = np.asarray(weights, dtype=float)
    if w.sum() <= 0: return None
    w = w / w.sum()
    hhi = float(np.sum(w * w))
    return _ok("concentration_hhi", "HHI = Σ wᵢ²", {"n": int(w.size)}, hhi, "ratio", f"HHI {hhi:.3f} (1.0 = single asset, 1/n = equal weights).")


def run_all_portfolio(inputs: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[Optional[dict[str, Any]]] = []
    weights = inputs.get("weights") or []
    if "prices" in inputs and inputs["prices"]:
        R = _to_returns(inputs["prices"]).tolist()
        out.append(portfolio_volatility(R, weights))
    elif "returns" in inputs and inputs["returns"]:
        out.append(portfolio_volatility(inputs["returns"], weights))
    if "portfolioReturns" in inputs and inputs["portfolioReturns"]:
        out.append(sharpe_ratio(inputs["portfolioReturns"], float(inputs.get("riskFreeDaily", 0.0))))
    if weights:
        out.append(concentration_hhi(weights))
    return [r for r in out if r is not None]
