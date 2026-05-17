# axl analytics-service

Deterministic financial calculators for Axl.ai. Used by the Node.js diligence
workflow (`server/workflows/startupDiligence.ts`) and any other module that
needs auditable math.

## Run

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8765
```

Set `AXL_ANALYTICS_URL` in the Node side if you change the port.

## Endpoints

| Path                                | Purpose                                       |
| ----------------------------------- | --------------------------------------------- |
| `POST /calculate/startup-metrics`   | ARR, growth, runway, valuation/ARR, etc.      |
| `POST /calculate/public-company-metrics` | margins, multiples, MAs, volatility, drawdown |
| `POST /calculate/valuation`         | DCF-lite, multiple-based valuation            |
| `POST /calculate/portfolio-risk`    | vol, Sharpe, HHI concentration                |
| `POST /calculate/anomaly-score`     | max |z| over recent observations              |
| `POST /validate/financial-model`    | Reconcile a company's stated metric vs computed |
| `GET  /healthz`                     | Liveness probe                                |

## Tests

```bash
pytest -q
```

All calculators are pure functions and return JSON-shaped dicts that the
Node side persists directly into the `calculations` table.
