from calculators.valuation import dcf_lite, multiple_valuation


def test_multiple_valuation():
    v = multiple_valuation(1_000_000, 12, "ARR")
    assert v["resultValue"] == 12_000_000


def test_dcf_lite_returns_positive_for_growing_cf():
    v = dcf_lite(1_000_000, 0.10, 0.12, years=5, terminal_growth=0.025)
    assert v is not None and v["resultValue"] > 1_000_000


def test_dcf_lite_guards_invalid_discount():
    assert dcf_lite(1_000_000, 0.10, 0.02, years=5, terminal_growth=0.025) is None
