from calculators.startup import (
    arr_from_mrr, yoy_growth, gross_margin, runway_months,
    valuation_to_arr, ltv_cac, burn_multiple, customers_required,
    cac_payback_months, implied_market_share, run_all_startup,
)


def test_arr_from_mrr():
    r = arr_from_mrr(100_000)
    assert r["resultValue"] == 1_200_000
    assert arr_from_mrr(None) is None


def test_yoy_growth():
    r = yoy_growth(120, 100)
    assert abs(r["resultValue"] - 0.20) < 1e-9
    assert yoy_growth(100, 0) is None  # divide-by-zero guard


def test_gross_margin_warns_on_negative():
    r = gross_margin(-10, 100)
    assert r["status"] == "warning"
    assert r["resultValue"] == -0.1


def test_runway_warns_below_9_months():
    r = runway_months(50_000, 10_000)
    assert r["resultValue"] == 5.0
    assert r["status"] == "warning"
    r = runway_months(200_000, 10_000)
    assert r["status"] == "ok"


def test_valuation_multiple():
    r = valuation_to_arr(10_000_000, 1_000_000)
    assert r["resultValue"] == 10.0
    assert r["unit"] == "x"


def test_ltv_cac_warns_below_one():
    assert ltv_cac(100, 200)["status"] == "warning"
    assert ltv_cac(400, 100)["status"] == "ok"


def test_burn_multiple_returns_none_on_no_growth():
    assert burn_multiple(100_000, 1_000_000, 1_000_000) is None


def test_customers_required_and_implied_share():
    assert customers_required(1_000_000, 100)["resultValue"] == 10_000
    assert abs(implied_market_share(1_000_000, 100_000_000)["resultValue"] - 0.01) < 1e-9


def test_cac_payback():
    r = cac_payback_months(1000, 100)
    assert r["resultValue"] == 10
    r2 = cac_payback_months(3000, 100)
    assert r2["status"] == "warning"  # > 24 months


def test_run_all_startup_filters_nones():
    res = run_all_startup({"arr": 1_000_000, "previousArr": 800_000, "valuation": 12_000_000})
    names = {r["name"] for r in res}
    assert "yoy_growth_arr" in names
    assert "valuation_to_arr" in names
    # absent inputs => calculation skipped
    assert "runway_months" not in names
