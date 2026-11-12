import numpy as np, pandas as pd, pytest
from crashlab import backtest, risk
from crashlab.config import ASSETS
from crashlab.data import build_dataset, SyntheticProvider, split_indices
from crashlab.features import build_features, Scaler, RegimeModel
from crashlab.models.copula import CopulaModel, GaussianModel, nearest_psd_corr
from crashlab.models.fhs import FHSModel
from crashlab.models.cvae import CVAEModel, CVAEConfig
from crashlab.parser import parse_story
from crashlab.scenarios import ScenarioSpec, generate, constraint_report

@pytest.fixture(scope="module")
def ds():
    return build_dataset(SyntheticProvider(3).fetch_all("2015-01-01", "2022-12-31"), "SYNTHETIC_DEV_DATA", True)

def test_log_returns_and_alignment():
    idx = pd.to_datetime(["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-06"])
    raw = {a: pd.DataFrame({"close": [100., 110., 121., 133.1]}, index=idx) for a in ASSETS}
    raw["GOLD"] = raw["GOLD"].drop(idx[1])               # holiday for one asset
    raw["BANK"] = pd.concat([raw["BANK"], raw["BANK"].iloc[[0]]])   # duplicate
    d = build_dataset(raw, "t", False)
    assert len(d.returns) == 2 and d.quality["assets"]["BANK"]["duplicates_removed"] == 1
    assert np.isclose(d.returns["NIFTY"].iloc[0], np.log(121 / 100))  # gap return spans the missing day, no ffill
    assert np.allclose(d.returns["NIFTY"].iloc[1], np.log(133.1 / 121))

def test_features_no_lookahead(ds):
    R = ds.returns; f1 = build_features(R)
    R2 = R.copy(); R2.iloc[-1] += 0.5                  # perturb the last day only
    f2 = build_features(R2)
    assert f1.iloc[:-1].fillna(-9).equals(f2.iloc[:-1].fillna(-9))

def test_scaler_train_only_and_regimes(ds):
    n_tr, _ = split_indices(len(ds.returns), .6, .2)
    sc = Scaler.fit(ds.returns.values[:n_tr])
    assert np.allclose(sc.mean, ds.returns.values[:n_tr].mean(0))
    rm = RegimeModel.fit(ds.returns.iloc[:n_tr]); lab = rm.label(ds.returns)
    assert set(np.unique(lab)) <= {0, 1, 2} and rm.q_extreme > rm.q_elevated

def test_fhs_filtering_and_sync(ds):
    m = FHSModel().fit(ds.returns); sim = m.simulate(500, 10, 1)
    assert sim.shape == (500, 10, 6) and np.isfinite(sim).all()
    assert np.allclose(m.Z.mean(0), 0, atol=1e-8) and np.allclose(m.Z.std(0), 1)
    corr_real, corr_sim = np.corrcoef(ds.returns.values.T), np.corrcoef(sim.reshape(-1, 6).T)
    assert np.abs(corr_real - corr_sim).max() < .25
    assert np.array_equal(m.simulate(50, 5, 7), m.simulate(50, 5, 7))

def test_copula_dependence_and_psd(ds):
    t, g = CopulaModel("t").fit(ds.returns), CopulaModel("gaussian").fit(ds.returns)
    st, sg = t.simulate(40000, 1, 0)[:, 0], g.simulate(40000, 1, 0)[:, 0]
    def tail(x): q = x[:, 0] <= np.quantile(x[:, 0], .01); return (x[q, 1] <= np.quantile(x[:, 1], .01)).mean()
    assert tail(st) >= tail(sg) - 0.03 and t.nu >= 2.5
    bad = np.array([[1, .99, -.99], [.99, 1, .99], [-.99, .99, 1.]]); assert np.linalg.eigvalsh(nearest_psd_corr(bad)).min() > 0

@pytest.fixture(scope="module")
def cv(ds):
    R = ds.returns; n_tr, n_va = split_indices(len(R), .6, .2)
    reg = RegimeModel.fit(R.iloc[:n_tr]).label(R)
    return CVAEModel(CVAEConfig(epochs=6, warmup=2, hidden=24, latent=4), "cpu").fit(R, reg, n_tr, n_va)

def test_cvae_inference_reproducible_and_conditioned(cv, tmp_path):
    a, b = cv.simulate(200, 10, 5, 2, {"NIFTY": -.1}), cv.simulate(200, 10, 5, 2, {"NIFTY": -.1})
    assert np.array_equal(a, b) and a.shape == (200, 10, 6) and np.isfinite(a).all()
    cv.save(tmp_path / "m.pt"); m2 = CVAEModel.load(tmp_path / "m.pt")
    assert np.allclose(m2.simulate(50, 10, 5, 2, {"NIFTY": -.1}), cv.simulate(50, 10, 5, 2, {"NIFTY": -.1}), atol=1e-5)
    assert len(cv.history) >= 1 and "val_loss" in cv.history[0]


def test_cvae_batched_inference_is_reproducible_and_statistically_consistent(cv):
    constraints = {"NIFTY": -.1, "USDINR": .03}
    whole_batch = cv.simulate(512, 10, 91, 2, constraints, batch_size=512)
    batched = cv.simulate(512, 10, 91, 2, constraints, batch_size=32)
    repeated = cv.simulate(512, 10, 91, 2, constraints, batch_size=32)

    assert np.array_equal(batched, repeated)
    assert np.allclose(batched.mean((0, 1)), whole_batch.mean((0, 1)), atol=1e-3)
    assert np.allclose(batched.std((0, 1)), whole_batch.std((0, 1)), rtol=.05)
    assert np.abs(
        np.corrcoef(batched.reshape(-1, 6).T)
        - np.corrcoef(whole_batch.reshape(-1, 6).T)
    ).max() < .05


def test_constraint_report_no_forcing(cv, ds):
    spec = ScenarioSpec(horizon=10, n=300, regime="extreme", shocks={"NIFTY": -.15}, seed=1)
    g = generate(cv, spec, ds.returns.std().values)
    r = g["meta"]["constraint_report"][0]
    assert g["meta"]["conditioning"] == "native_kernel_resampling"
    assert g["meta"]["target_semantics"] == "probabilistic"
    assert not g["meta"]["hard_constraints_enforced"]
    assert 0 <= r["share_within_tolerance"] <= 1
    assert len(r["share_within_tolerance_ci95"]) == 2
    assert len(r["realised_median_ci95_simple"]) == 2
    assert r["predictive_interval"] == "5th–95th percentile"
    assert r["violation_count"] + round(r["share_within_tolerance"] * 300) == 300
    assert g["sim"].shape == (300, 10, 6)
    assert ScenarioSpec(horizon=99).validate() and ScenarioSpec(shocks={"X": .1}).validate()


def test_kernel_conditioning_improves_target_without_changing_paths(cv):
    from crashlab.scenarios import kernel_resample

    targets = {"NIFTY": float(np.log1p(-.12)), "USDINR": float(np.log1p(.03))}
    pool = cv.simulate(6000, 10, 12, 2, targets)
    selected, info = kernel_resample(pool, targets, 300, 104741)
    direct_hits = []
    selected_hits = []
    proposal_cum, selected_cum = pool.sum(1), selected.sum(1)
    for asset, target in targets.items():
        j = ASSETS.index(asset)
        tol = max(.01, .15 * abs(target))
        direct_hits.append(np.mean(np.abs(proposal_cum[:, j] - target) <= tol))
        selected_hits.append(np.mean(np.abs(selected_cum[:, j] - target) <= tol))
    assert min(selected_hits) > min(direct_hits) + .1
    assert info["proposal_pool_size"] == len(pool)
    assert info["kernel_effective_sample_size"] > 0
    assert np.isfinite(selected).all()
    # Resampling must return original paths, not alter returns to hit targets.
    pool_rows = {row.tobytes() for row in pool}
    assert all(row.tobytes() in pool_rows for row in selected)
    repeated, _ = kernel_resample(pool, targets, 300, 104741)
    assert np.array_equal(selected, repeated)
    assert np.abs(np.corrcoef(pool.reshape(-1, 6).T) -
                  np.corrcoef(selected.reshape(-1, 6).T)).max() < .2
    assert np.allclose(selected.std((0, 1)), pool.std((0, 1)), rtol=.2)


def test_constraint_report_explains_unsupported_targets():
    from crashlab.scenarios import constraint_report

    proposal = np.zeros((100, 2, 6))
    sim = proposal.copy()
    report = constraint_report(sim, {"NIFTY": np.log1p(.5)}, proposal)[0]
    assert report["proposal_target_position"] == "outside_proposal_1_99"
    assert report["proposal_share_within_tolerance"] == 0
    assert report["share_within_tolerance"] == 0
    assert report["violation_rate"] == 1
    assert any("weak support" in item for item in report["diagnostics"])

def test_portfolio_valuation_exact():
    sim = np.zeros((2, 2, 6)); sim[0, :, 0] = np.log(0.9) / 2     # NIFTY -10% over 2 days
    v = risk.portfolio_values(sim, {"NIFTY": .5, "CASH": .5}, 1000.)
    assert np.allclose(v[0], [1000, 500 * (.9 ** .5) + 500, 950]) and np.allclose(v[1], 1000)
    assert risk.validate_weights({"NIFTY": 2, "CASH": 2}, normalize=True) == {"NIFTY": .5, "CASH": .5}
    for bad in ({"NIFTY": .5}, {"NIFTY": 1.2, "CASH": -.2}, {"FOO": 1.}):
        with pytest.raises(ValueError): risk.validate_weights(bad)

def test_var_es_known_values():
    loss = np.arange(1, 101) / 100.
    var, es = risk.var_es(loss, .95)
    assert np.isclose(var, np.quantile(loss, .95)) and es >= var and np.isclose(es, loss[loss >= var].mean())
    vals = np.array([[100, 120, 60, 90]]); assert np.isclose(risk.risk_metrics(vals)["max_drawdown_worst"], .5)

def test_contributions_sum_to_es():
    rng = np.random.default_rng(0); sim = rng.normal(0, .02, (4000, 5, 6)); w = {"NIFTY": .5, "GOLD": .3, "CASH": .2}
    c = risk.loss_contributions(sim, w, .95); vals = risk.portfolio_values(sim, w, 1.)
    assert np.isclose(sum(c.values()), risk.risk_metrics(vals)["es_95"], atol=1e-9)

def test_kupiec_christoffersen_as():
    rng = np.random.default_rng(1); exc = rng.random(2000) < .05
    assert backtest.kupiec_pof(exc, .05)["p_value"] > .01
    assert backtest.kupiec_pof(np.ones(100, bool), .05)["p_value"] < 1e-6
    clustered = np.zeros(500, bool); clustered[100:140] = True
    assert backtest.christoffersen(clustered, .08)["p_ind"] < .01
    T = 500; loss = rng.normal(0, 1, T); var = np.full(T, 1.645); es = np.full(T, 2.063)
    s = rng.normal(0, 1, (T, 300)); r = backtest.acerbi_szekely_z2(loss, var, es, .95, s, n_mc=400)
    assert abs(r["z2"]) < .6 and r["p_value"] > .01
    assert backtest.acerbi_szekely_z2(loss * 2, var, es, .95)["z2"] > 1       # under-estimated ES => Z2 > 0

def test_parser_story_example():
    p = parse_story("NIFTY falls 15% over 10 trading days, the rupee depreciates 4%, banking stocks experience high volatility, and crude oil increases 12%.")
    assert p["shocks"] == {"USDINR": .04, "CRUDE": .12, "NIFTY": -.15} and p["horizon"] == 10 and p["regime"] == "elevated"
    assert parse_story("blah blah")["warnings"]

def test_parser_infers_plain_language_market_scenarios():
    recession = parse_story("The economy implodes into a global recession.")
    assert recession["shocks"] == {"NIFTY": -.12, "BANK": -.15, "IT": -.10, "GOLD": .05, "CRUDE": -.15, "USDINR": .04}
    assert recession["regime"] == "extreme" and any("illustrative recession template" in w for w in recession["warnings"])

    qualitative = parse_story("Stocks tank, gold moons and crude crashes.")
    assert qualitative["shocks"]["NIFTY"] == -.10
    assert qualitative["shocks"]["GOLD"] == .08
    assert qualitative["shocks"]["CRUDE"] == -.12
    assert np.isclose(parse_story("rupee appreciates 4%")["shocks"]["USDINR"], -.04 / 1.04)
    assert parse_story("USDINR falls 4%")["shocks"]["USDINR"] == -.04
    assert parse_story("blorptastic nonsense")["shocks"] == {}


def test_parser_ignores_negated_market_moves_and_events():
    negated = parse_story(
        "NIFTY does not fall 10%, the rupee does not depreciate 5%, "
        "no recession is expected, and a war is not expected."
    )
    assert negated["shocks"] == {}
    assert negated["regime"] is None

    mixed = parse_story("Stocks are not falling 10%, but gold rises 5%.")
    assert mixed["shocks"] == {"GOLD": .05}

    asserted = parse_story("NIFTY falls 12%, but not 20%; gold rises 5%.")
    assert asserted["shocks"]["NIFTY"] == -.12
    assert asserted["shocks"]["GOLD"] == .05
