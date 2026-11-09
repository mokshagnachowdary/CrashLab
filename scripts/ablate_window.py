"""Training-window-length ablation; merges results into artifacts/research_results.json. Run from backend/."""
import json, sys
sys.path.insert(0, ".")
from crashlab.pipeline import test_windows, distribution_metrics, H_EVAL
from crashlab.models.cvae import CVAEConfig, CVAEModel
from crashlab.service import State
from crashlab.features import RegimeModel
S = State().load(); R = S.returns; sp = S.manifest["split"]; n_tr, n_va = sp["n_train"], sp["n_train"] + sp["n_val"]
regimes = S.regime.label(R); real = test_windows(R.values, n_va, len(R), H_EVAL)
res = json.loads((S.art / "research_results.json").read_text()); base = res["cvae"]["config"]
out = []
for label, length in [("last 600 days", 600), ("last 1200 days", 1200), ("full train (%d days)" % n_tr, n_tr)]:
    cfg = CVAEConfig(**{**base, "horizons": tuple(base["horizons"]), "train_start": max(0, n_tr - length)})
    m = CVAEModel(cfg).fit(R, regimes, n_tr, n_va); dm = distribution_metrics(real, m.simulate(len(real), H_EVAL, 99))
    out.append({"variant": f"train window: {label}", "best_val_loss": m.best_val_loss, "epochs_run": len(m.history), "oos_wasserstein_mean": dm["wasserstein_mean"],
                "oos_corr_frobenius": dm["corr_frobenius"], "oos_tail_dep_nifty_bank": dm["tail_dep_lower_q05"]["NIFTY-BANK"]["model"], "train_seconds": m.train_seconds})
    print(out[-1])
res["ablations"] = [a for a in res.get("ablations", []) if not a["variant"].startswith("train window")] + out
(S.art / "research_results.json").write_text(json.dumps(res, indent=1, default=float))
