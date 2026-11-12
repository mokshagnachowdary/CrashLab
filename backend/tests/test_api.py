import pytest
from fastapi.testclient import TestClient

@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os
    d = tmp_path_factory.mktemp("art"); os.environ["DATABASE_URL"] = f"sqlite:///{d}/t.db"
    from crashlab import pipeline, service, config
    import crashlab.db as db; db.DATA_DIR = d
    pipeline.run(quick=True, out_dir=d) if False else None
    from crashlab.data import load_dataset
    import crashlab.api as api
    from pathlib import Path
    src = Path(config.ARTIFACT_DIR)
    assert (src / "cvae.pt").exists(), "run `python -m crashlab.pipeline` first"
    api.STATE = service.State(src).load(); db.init_db()
    (config.DATA_DIR / "simulations").mkdir(parents=True, exist_ok=True)
    return TestClient(api.app)

def test_cors_preflight_and_frontend_gets(client):
    origins = (
        "https://crashlab-qrqs.onrender.com",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )
    for origin in origins:
        preflight = client.options("/api/health", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type,authorization",
        })
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == origin
        assert "GET" in preflight.headers["access-control-allow-methods"]
        assert "POST" in preflight.headers["access-control-allow-methods"]
        for method in ("PUT", "PATCH", "DELETE", "OPTIONS"):
            assert method in preflight.headers["access-control-allow-methods"]
        assert "authorization" in preflight.headers["access-control-allow-headers"].lower()
        assert "content-type" in preflight.headers["access-control-allow-headers"].lower()
        assert preflight.headers.get("access-control-allow-credentials") != "true"

    for path in ("/api/health", "/api/data/overview", "/api/models", "/api/scenarios?limit=20"):
        response = client.get(path, headers={"Origin": origins[-1]})
        assert response.status_code == 200, (path, response.text)
        assert response.headers["access-control-allow-origin"] == origins[-1]

    limited = client.get("/api/health", headers={"Origin": origins[-1], "content-length": "200001"})
    assert limited.status_code == 413
    assert limited.headers["access-control-allow-origin"] == origins[-1]

def test_full_workflow(client):
    import time
    h = client.get("/api/health").json(); assert h["api"] == "ok" and h["models_loaded"]
    p = client.post("/api/scenarios/parse", json={"text": "NIFTY falls 15% over 10 trading days, rupee depreciates 4%"}).json()
    assert p["shocks"]["NIFTY"] == -.15 and not p["validation_errors"]
    missing_preset_name = client.post(
        "/api/scenarios/generate",
        json={"source": "preset", "n": 1},
    )
    assert missing_preset_name.status_code == 422
    unexpected_preset_name = client.post(
        "/api/scenarios/generate",
        json={"source": "custom", "preset_name": "Banking Crisis", "n": 1},
    )
    assert unexpected_preset_name.status_code == 422
    ids = {}
    for m in ("cvae", "t_copula", "fhs"):
        request = {"model": m, "horizon": p["horizon"], "n": 1000, "shocks": p["shocks"], "regime": "extreme"}
        if m == "cvae":
            request.update({"source": "preset", "preset_name": "Banking Crisis"})
        r = client.post("/api/scenarios/generate", json=request)
        assert r.status_code == 202; ids[m] = r.json()["id"]
    for m, i in ids.items():
        for _ in range(120):
            s = client.get(f"/api/scenarios/{i}").json()
            if s["status"] in ("completed", "failed"): break
            time.sleep(.5)
        assert s["status"] == "completed", s.get("error")
        assert s["meta"]["constraint_report"] and len(s["summary"]["bands"]["NIFTY"]["50"]) == 11
        if m == "cvae":
            assert s["request"]["source"] == "preset"
            assert s["request"]["preset_name"] == "Banking Crisis"
        else:
            assert s["request"]["source"] == "custom"
            assert s["request"]["preset_name"] is None
    pf = client.post("/api/portfolios", json={"weights": {"NIFTY": 3, "GOLD": 1, "CASH": 1}, "normalize": True, "initial_value": 500000}).json()
    st = client.post(f"/api/portfolios/{pf['id']}/stress-test", json={"simulation_id": ids["cvae"]}).json()
    m = st["metrics"]; assert m["var_99"] >= m["var_95"] and m["es_95"] >= m["var_95"] and m["v0"] == 500000
    assert client.get(f"/api/risk/{ids['cvae']}").status_code == 200
    assert client.get(f"/api/scenarios/{ids['cvae']}/export?format=csv").text.startswith("scenario,day")
    assert client.post("/api/portfolios", json={"weights": {"NIFTY": .5}}).status_code == 422
    assert client.post("/api/scenarios/generate", json={"n": 10**9}).status_code == 422
    hr = client.get("/api/data/history-ref?asset=NIFTY&horizon=10").json(); assert len(hr["path"]) == 11 and hr["path"][0] == 0 and min(hr["path"]) < 0
    assert client.get("/api/data/history-ref?asset=XXX").status_code == 422
    assert all(m["trained_at"] and m["validation"] for m in client.get("/api/models").json()["models"])
    assert client.get("/api/models/comparison").status_code == 200 and client.get("/api/backtesting/cvae").status_code == 200


def test_every_model_produces_a_saved_scenario(client):
    import time

    expected_models = {"cvae", "fhs", "gaussian", "gaussian_copula", "t_copula"}
    assert {model["id"] for model in client.get("/api/models").json()["models"]} == expected_models

    for model in sorted(expected_models):
        response = client.post(
            "/api/scenarios/generate",
            json={
                "name": f"model check: {model}",
                "model": model,
                "horizon": 5,
                "n": 25,
                "source": "custom",
            },
        )
        assert response.status_code == 202
        scenario_id = response.json()["id"]

        for _ in range(100):
            scenario = client.get(f"/api/scenarios/{scenario_id}").json()
            if scenario["status"] in ("completed", "failed"):
                break
            time.sleep(.1)

        assert scenario["status"] == "completed", scenario.get("error")
        assert scenario["request"]["model"] == model
        assert scenario["meta"]["model"] == model
        assert scenario["summary"]["n"] == 25


def test_delete_only_removes_finished_custom_scenarios(client):
    import uuid
    from crashlab import db
    import crashlab.api as api

    simulations_dir = api.DATA_DIR / "simulations"
    simulations_dir.mkdir(parents=True, exist_ok=True)
    custom_id, preset_id, active_id = (uuid.uuid4().hex for _ in range(3))
    artifact = simulations_dir / f"{custom_id}.npz"
    artifact.write_bytes(b"test artifact")
    with db.SessionLocal() as session:
        session.add_all([
            db.SimulationJob(
                id=custom_id,
                name="custom scenario",
                request={"source": "custom"},
                status="completed",
                array_path=str(artifact),
            ),
            db.SimulationJob(
                id=preset_id,
                name="built-in scenario",
                request={"source": "preset", "preset_name": "Banking Crisis"},
                status="completed",
            ),
            db.SimulationJob(
                id=active_id,
                name="active custom scenario",
                request={"source": "custom"},
                status="running",
            ),
        ])
        session.commit()

    deleted = client.delete(f"/api/scenarios/{custom_id}")
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": custom_id}
    assert not artifact.exists()
    assert client.get(f"/api/scenarios/{custom_id}").status_code == 404
    assert client.delete(f"/api/scenarios/{preset_id}").status_code == 403
    assert client.delete(f"/api/scenarios/{active_id}").status_code == 409
