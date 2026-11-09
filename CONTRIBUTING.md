# Contributing
1. `cd backend && pip install -r requirements.txt && python -m crashlab.pipeline --quick && pytest -q`
2. `cd frontend && npm ci && npm run build`
3. Rules: no hard-coded results, no random splits of time series, no fitting on test data, report negative results. New data providers subclass `crashlab.data.DataProvider`; new generators subclass `crashlab.models.base.ScenarioModel`.
