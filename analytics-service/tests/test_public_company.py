from calculators.public_company import (
    operating_margin, net_margin, pe_ratio, ev_ebitda, price_to_sales,
    annualised_volatility, max_drawdown, moving_average, total_return,
    run_all_public,
)


def test_margins():
    assert operating_margin(20, 100)["resultValue"] == 0.2
    assert net_margin(-5, 100)["resultValue"] == -0.05


def test_multiples():
    assert pe_ratio(100, 5)["resultValue"] == 20
    assert ev_ebitda(1000, 100)["resultValue"] == 10
    assert price_to_sales(2000, 500)["resultValue"] == 4


def test_volatility_and_drawdown():
    prices = [100.0 + i * 0.5 for i in range(30)] + [80.0]  # nice rise then a crash
    v = annualised_volatility(prices)
    assert v is not None and v["resultValue"] > 0
    dd = max_drawdown(prices)
    assert dd is not None and dd["resultValue"] < 0


def test_moving_average_and_total_return():
    prices = [10.0, 11.0, 12.0, 13.0, 14.0]
    ma = moving_average(prices, 3)
    assert ma is not None and abs(ma["resultValue"] - 13.0) < 1e-9
    tr = total_return(prices)
    assert tr is not None and abs(tr["resultValue"] - 0.4) < 1e-9


def test_run_all_public_filters_nones():
    res = run_all_public({"revenue": 100, "grossProfit": 60, "previousRevenue": 80, "prices": [10, 11, 9, 12, 8, 14]})
    names = {r["name"] for r in res}
    assert "gross_margin" in names
    assert "yoy_growth_revenue" in names
