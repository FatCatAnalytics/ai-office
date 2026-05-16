"""Stage 6: Axl.ai analytics-service entrypoint.

A small FastAPI app exposing deterministic calculators to the Node.js
diligence workflow. Default port 8765 (overridable via $AXL_ANALYTICS_PORT).

Run locally:
    uvicorn main:app --host 0.0.0.0 --port 8765 --reload

Endpoints (all POST, application/json):
    /calculate/startup-metrics
    /calculate/public-company-metrics
    /calculate/valuation
    /calculate/portfolio-risk
    /calculate/anomaly-score
    /validate/financial-model

Each endpoint accepts a flat `inputs` dict, runs the relevant calculator
suite, and returns { "results": [CalcResult, ...] }.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from calculators.startup import run_all_startup
from calculators.public_company import run_all_public
from calculators.valuation import run_all_valuation
from calculators.portfolio import run_all_portfolio
from calculators.anomaly import max_z_in_window


app = FastAPI(title="Axl.ai analytics-service", version="0.6.0")


class Inputs(BaseModel):
    """Catch-all input model. Accepts arbitrary keys; the calculators pick
    out only what they need so older callers stay compatible as we add
    fields."""
    model_config = {"extra": "allow"}


def _payload(model: Inputs) -> dict[str, Any]:
    return model.model_dump(exclude_unset=False)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/calculate/startup-metrics")
def startup_metrics(inputs: Inputs) -> dict[str, Any]:
    return {"results": run_all_startup(_payload(inputs))}


@app.post("/calculate/public-company-metrics")
def public_company_metrics(inputs: Inputs) -> dict[str, Any]:
    return {"results": run_all_public(_payload(inputs))}


@app.post("/calculate/valuation")
def valuation(inputs: Inputs) -> dict[str, Any]:
    return {"results": run_all_valuation(_payload(inputs))}


@app.post("/calculate/portfolio-risk")
def portfolio_risk(inputs: Inputs) -> dict[str, Any]:
    return {"results": run_all_portfolio(_payload(inputs))}


@app.post("/calculate/anomaly-score")
def anomaly_score(inputs: Inputs) -> dict[str, Any]:
    data = _payload(inputs)
    series = data.get("series") or []
    window = int(data.get("window", 20))
    r = max_z_in_window(series, window=window)
    return {"results": [r] if r is not None else []}


class ValidateModelInputs(BaseModel):
    """Inputs for the /validate/financial-model endpoint.

    `stated` is the company's claimed value for a metric; `inputs` carries the
    raw inputs the company says produce that value. We run the matching
    calculator and report the absolute and relative divergence between the
    stated and computed values.
    """
    metric: str
    stated: float
    tolerance: float = 0.05
    model_config = {"extra": "allow"}


@app.post("/validate/financial-model")
def validate_financial_model(payload: ValidateModelInputs) -> dict[str, Any]:
    body = payload.model_dump(exclude_unset=False)
    metric = body["metric"]
    stated = float(body["stated"])
    tolerance = float(body.get("tolerance", 0.05))
    inputs = {k: v for k, v in body.items() if k not in ("metric", "stated", "tolerance")}

    suite_results: list[dict[str, Any]] = []
    if metric in {"arr_from_mrr", "yoy_growth_arr", "yoy_growth_revenue", "gross_margin", "runway_months", "valuation_to_arr", "ltv_cac_ratio", "burn_multiple", "implied_market_share", "cac_payback_months", "customers_required"}:
        suite_results = run_all_startup(inputs)
    elif metric in {"operating_margin", "net_margin", "pe_ratio", "ev_ebitda", "price_to_sales", "annualised_volatility", "max_drawdown", "total_return"} or metric.startswith("ma_"):
        suite_results = run_all_public(inputs)
    elif metric in {"dcf_lite", "multiple_valuation"}:
        suite_results = run_all_valuation(inputs)

    match = next((r for r in suite_results if r["name"] == metric), None)
    if match is None or match["resultValue"] is None:
        return {"ok": False, "reason": f"could not recompute metric '{metric}' from provided inputs", "stated": stated, "computed": None}

    computed = float(match["resultValue"])
    denom = max(abs(stated), abs(computed), 1e-12)
    delta_abs = computed - stated
    delta_rel = delta_abs / denom
    within = abs(delta_rel) <= tolerance
    return {
        "ok": within,
        "metric": metric,
        "stated": stated,
        "computed": computed,
        "absoluteDelta": delta_abs,
        "relativeDelta": delta_rel,
        "tolerance": tolerance,
        "explanation": match["explanation"],
        "formula": match["formula"],
    }
