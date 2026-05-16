"""Stage 6: Lightweight anomaly scoring.

Two methods exposed:
  - z_score_anomaly(series): per-observation z-score
  - max_z_in_window(series, window): the largest absolute z-score in the
    most recent `window` observations — useful as a single 'anomaly_score'.

Inputs are plain Python lists of floats to keep the API JSON-friendly.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from .startup import _ok


def z_score_anomaly(series: list[float]) -> Optional[list[float]]:
    if len(series) < 5: return None
    arr = np.asarray(series, dtype=float)
    mu = float(np.mean(arr))
    sd = float(np.std(arr, ddof=1))
    if sd == 0: return None
    return [(float(x) - mu) / sd for x in arr]


def max_z_in_window(series: list[float], window: int = 20) -> Optional[dict[str, Any]]:
    if len(series) < 5 or window <= 0: return None
    zs = z_score_anomaly(series)
    if zs is None: return None
    tail = zs[-window:]
    idx_in_tail = max(range(len(tail)), key=lambda i: abs(tail[i]))
    z = tail[idx_in_tail]
    return _ok(
        "anomaly_score",
        "score = max(|z|) over last N observations",
        {"window": window, "observations": len(series)},
        z, "z",
        f"Largest |z| in last {min(window, len(series))} observations: {z:+.2f}σ.",
        status="warning" if abs(z) > 3 else "ok",
    )
