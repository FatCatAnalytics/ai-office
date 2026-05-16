import numpy as np

from calculators.portfolio import portfolio_volatility, sharpe_ratio, concentration_hhi
from calculators.anomaly import z_score_anomaly, max_z_in_window


def test_portfolio_volatility_two_assets():
    rng = np.random.default_rng(42)
    R = rng.normal(0, 0.01, size=(2, 250)).tolist()
    v = portfolio_volatility(R, [0.5, 0.5])
    assert v is not None and v["resultValue"] > 0


def test_sharpe_ratio_positive_for_positive_drift():
    # Construct a deterministic series with strong positive drift so the
    # Sharpe is unambiguously positive (no RNG-dependent flakiness).
    rets = [0.001 + 0.005 * ((-1) ** i) for i in range(250)]
    s = sharpe_ratio(rets)
    assert s is not None and s["resultValue"] > 0


def test_concentration_hhi_extremes():
    assert concentration_hhi([1.0])["resultValue"] == 1.0
    hhi_eq = concentration_hhi([1.0, 1.0, 1.0, 1.0])
    assert abs(hhi_eq["resultValue"] - 0.25) < 1e-9


def test_zscore_anomaly():
    series = [10.0] * 30 + [50.0]  # one big spike at the end
    z = max_z_in_window(series, window=10)
    assert z is not None
    # spike must be flagged as warning
    assert z["status"] == "warning"
    assert abs(z["resultValue"]) > 3
