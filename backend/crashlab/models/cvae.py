"""Conditional GRU-VAE generating multivariate return trajectories under scenario constraints.

Representation: a window of h<=20 days of per-asset standardised log returns (padded, with a validity mask).
Condition vector c = [masked cumulative-return targets in sd*sqrt(h) units (N), constraint masks (N),
                      h/max_h, one-hot volatility regime (3)].
Constraint masks are randomly dropped in training so one network serves unconditional AND partially/fully
conditional generation. Generation never rescales outputs to hit targets: constraint satisfaction is measured.
"""
from __future__ import annotations

import copy
import math
import os
import time
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.nn.utils.rnn import pack_padded_sequence

from .base import ScenarioModel

N_REG = 3
DEFAULT_INFERENCE_BATCH_SIZE = int(os.getenv("CRASHLAB_SIM_BATCH_SIZE", "256"))
if DEFAULT_INFERENCE_BATCH_SIZE < 1:
    raise ValueError("CRASHLAB_SIM_BATCH_SIZE must be positive")


@dataclass
class CVAEConfig:
    hidden: int = 64
    latent: int = 8
    max_h: int = 20
    horizons: tuple = (5, 10, 15, 20)
    epochs: int = 120
    batch: int = 256
    lr: float = 2e-3
    beta_max: float = 0.3      # KL weight (beta-VAE). <1 keeps latent informative -> cross-asset structure
    warmup: int = 30           # linear KL annealing epochs
    patience: int = 20
    clip: float = 1.0
    lam_cum: float = 1.0       # auxiliary penalty tying decoded cumulative return to the constraint
    conditional: bool = True   # False = plain VAE ablation (condition vector zeroed)
    tail_aware: bool = False   # Student-t reconstruction likelihood (ablation; kept only if validation says so)
    t_df: float = 4.0
    mask_p: float = 0.5
    seed: int = 7
    train_start: int = 0       # first training row used (training-window-length ablation)


def make_windows(R: np.ndarray, regimes: np.ndarray, lo: int, hi: int, horizons, max_h: int):
    """All windows [s, s+h) fully inside [lo, hi); regime = label known at end of day s-1."""
    X, H, G, S = [], [], [], []
    for h in horizons:
        for s in range(max(lo, 21), hi - h + 1):
            w = np.zeros((max_h, R.shape[1])); w[:h] = R[s:s + h]
            X.append(w); H.append(h); G.append(regimes[s - 1]); S.append(s)
    return np.array(X, np.float32), np.array(H), np.array(G), np.array(S)


class CVAENet(nn.Module):
    def __init__(self, n_assets: int, cfg: CVAEConfig):
        super().__init__()
        self.cfg, self.N = cfg, n_assets
        self.cdim = 2 * n_assets + 1 + N_REG
        H, L = cfg.hidden, cfg.latent
        self.enc = nn.GRU(n_assets, H, batch_first=True)
        self.enc_head = nn.Sequential(nn.Linear(H + self.cdim, H), nn.Tanh(), nn.Linear(H, 2 * L))
        self.dec_init = nn.Linear(L + self.cdim, H)
        self.dec = nn.GRU(L + self.cdim, H, batch_first=True)
        self.out = nn.Linear(H, n_assets)
        self.N = n_assets
        self.L_raw = nn.Parameter(torch.zeros(n_assets, n_assets))   # learned full-covariance residual (Cholesky)
        with torch.no_grad(): self.L_raw.diagonal().fill_(-0.3)

    def chol(self):
        L = torch.tril(self.L_raw, -1) + torch.diag(torch.exp(self.L_raw.diagonal()))
        return L

    def encode(self, x, h, c):
        packed = pack_padded_sequence(x, h.cpu(), batch_first=True, enforce_sorted=False)
        _, hn = self.enc(packed)
        mu, logvar = self.enc_head(torch.cat([hn[0], c], -1)).chunk(2, -1)
        return mu, logvar.clamp(-8, 4)

    def decode(self, z, c):
        zc = torch.cat([z, c], -1)
        h0 = torch.tanh(self.dec_init(zc)).unsqueeze(0)
        out, _ = self.dec(zc.unsqueeze(1).expand(-1, self.cfg.max_h, -1).contiguous(), h0)
        return self.out(out)

    def forward(self, x, h, c):
        mu, logvar = self.encode(x, h, c)
        z = mu + torch.randn_like(mu) * torch.exp(0.5 * logvar)   # reparameterisation trick
        return self.decode(z, c), mu, logvar


class CVAEModel(ScenarioModel):
    name = "cvae"
    supports_conditioning = True

    def __init__(self, cfg: CVAEConfig | None = None, device: str | None = None):
        self.cfg = cfg or CVAEConfig()
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.net = None
        self.history: list[dict] = []
        self.train_seconds = None

    # ---- conditioning ---------------------------------------------------------------------------------
    def _cond(self, cum_z, mask, h, reg):
        B = len(h)
        oh = torch.zeros(B, N_REG, device=cum_z.device); oh[torch.arange(B), reg] = 1
        c = torch.cat([cum_z * mask, mask, (h.float() / self.cfg.max_h).unsqueeze(1), oh], 1)
        return c if self.cfg.conditional else torch.zeros_like(c)

    def _loss(self, net, x, h, c, cum_z, mask, beta):
        xh, mu, logvar = net(x, h, c)
        valid = (torch.arange(self.cfg.max_h, device=x.device)[None] < h[:, None]).float().unsqueeze(-1)
        L = net.chol()
        B, T, N = x.shape
        w = torch.linalg.solve_triangular(L, (x - xh).reshape(-1, N).T, upper=False).T.reshape(B, T, N)  # L^-1 err
        logdet = torch.log(L.diagonal()).sum()
        if self.cfg.tail_aware:
            nu = self.cfg.t_df
            nll = (nu + N) / 2 * torch.log1p((w ** 2).sum(-1, keepdim=True) / nu) + logdet
        else:
            nll = 0.5 * (w ** 2).sum(-1, keepdim=True) + logdet
        recon = (nll * valid).sum((1, 2))
        kl = -0.5 * (1 + logvar - mu ** 2 - logvar.exp()).sum(1)
        dec_cum = ((xh * self.sd + self.mu) * valid).sum(1) / (self.sd * h.float().sqrt()[:, None])
        cum_pen = (mask * (dec_cum - cum_z) ** 2).sum(1)
        total = recon + beta * kl + self.cfg.lam_cum * cum_pen * h.float()
        return total.mean(), recon.mean().item(), kl.mean().item()

    # ---- training -------------------------------------------------------------------------------------
    def fit(self, returns: pd.DataFrame, regimes: np.ndarray, n_train: int, n_val_end: int, verbose=False, **kw):
        cfg = self.cfg
        torch.manual_seed(cfg.seed); np.random.seed(cfg.seed)
        Rv = returns.values
        self.assets = list(returns.columns)
        mu_np, sd_np = Rv[:n_train].mean(0), Rv[:n_train].std(0)       # scaler fitted on TRAIN only
        self.mu = torch.tensor(mu_np, dtype=torch.float32, device=self.device)
        self.sd = torch.tensor(sd_np, dtype=torch.float32, device=self.device)
        Z = (Rv - mu_np) / sd_np
        self.regime_freq = np.bincount(regimes[:n_train], minlength=N_REG) / n_train
        tr = make_windows(Z, regimes, cfg.train_start, n_train, cfg.horizons, cfg.max_h)
        va = make_windows(Z, regimes, n_train, n_val_end, cfg.horizons, cfg.max_h)
        N = Rv.shape[1]
        self.net = CVAENet(N, cfg).to(self.device)
        opt = torch.optim.Adam(self.net.parameters(), lr=cfg.lr)

        def tens(d):
            x, h, g, s = d
            x_t = torch.tensor(x, device=self.device); h_t = torch.tensor(h, device=self.device)
            raw_sum = torch.stack([torch.tensor(Rv[si:si + hi].sum(0), dtype=torch.float32) for si, hi in zip(s, h)]).to(self.device)
            cum_z = raw_sum / (self.sd * h_t.float().sqrt()[:, None])
            return x_t, h_t, torch.tensor(g, device=self.device), cum_z
        TR, VA = tens(tr), tens(va)
        t0, best, best_state, bad = time.time(), math.inf, None, 0
        gv = torch.Generator(device="cpu").manual_seed(123)
        val_mask = (torch.rand(len(VA[1]), N, generator=gv) < cfg.mask_p).float().to(self.device)
        for ep in range(cfg.epochs):
            beta = cfg.beta_max * min(1.0, (ep + 1) / cfg.warmup)       # KL annealing
            self.net.train()
            perm = torch.randperm(len(TR[1]), device=self.device)
            tl, nb = 0.0, 0
            for i in range(0, len(perm), cfg.batch):
                b = perm[i:i + cfg.batch]
                x, h, g, cz = (t[b] for t in TR)
                mask = (torch.rand(len(b), N, device=self.device) < cfg.mask_p).float()
                mask = mask * (torch.rand(len(b), 1, device=self.device) > 0.2).float()  # 20% fully unconditional
                loss, _, _ = self._loss(self.net, x, h, self._cond(cz, mask, h, g), cz, mask, beta)
                opt.zero_grad(); loss.backward()
                nn.utils.clip_grad_norm_(self.net.parameters(), cfg.clip)
                opt.step(); tl += loss.item(); nb += 1
            self.net.eval()
            with torch.no_grad():
                x, h, g, cz = VA
                vloss, vrec, vkl = self._loss(self.net, x, h, self._cond(cz, val_mask, h, g), cz, val_mask, cfg.beta_max)
            self.history.append({"epoch": ep + 1, "train_loss": tl / nb, "val_loss": vloss.item(),
                                 "val_recon": vrec, "val_kl": vkl, "beta": beta})
            if verbose and ep % 10 == 0: print(self.history[-1])
            if ep + 1 >= cfg.warmup:  # compare val loss only at full KL weight
                if vloss.item() < best - 1e-4: best, best_state, bad = vloss.item(), copy.deepcopy(self.net.state_dict()), 0
                else: bad += 1
                if bad >= cfg.patience: break
        if best_state is not None: self.net.load_state_dict(best_state)
        self.best_val_loss, self.train_seconds = best, time.time() - t0
        self.n_windows = {"train": len(TR[1]), "val": len(VA[1])}
        return self

    # ---- inference (independent of the training loop) ------------------------------------------------------
    @torch.inference_mode()
    def simulate(self, n, horizon, seed, regime=None, constraints=None, batch_size=None):
        """constraints: {asset_name: cumulative LOG return over `horizon`}. Unlisted assets are unconstrained."""
        cfg = self.cfg
        assert 1 <= horizon <= cfg.max_h, f"horizon must be in [1,{cfg.max_h}]"
        inference_batch_size = (
            DEFAULT_INFERENCE_BATCH_SIZE if batch_size is None else int(batch_size)
        )
        if inference_batch_size < 1:
            raise ValueError("inference batch_size must be positive")
        g = torch.Generator(device="cpu").manual_seed(seed)
        self.net.eval()
        N = len(self.assets)
        cum_z, mask = torch.zeros(1, N), torch.zeros(1, N)
        for a, v in (constraints or {}).items():
            j = self.assets.index(a)
            cum_z[0, j] = v / (self.sd[j].item() * math.sqrt(horizon)); mask[0, j] = 1
        cum_z, mask = cum_z.to(self.device).expand(n, -1), mask.to(self.device).expand(n, -1)
        h = torch.full((n,), horizon, device=self.device)
        if regime is None:
            reg = torch.tensor(np.random.default_rng(seed).choice(N_REG, n, p=self.regime_freq), device=self.device)
        else:
            reg = torch.full((n,), regime, device=self.device)
        c = self._cond(cum_z, mask, h, reg)
        z = torch.randn(n, cfg.latent, generator=g).to(self.device)
        eps = torch.randn((n, cfg.max_h, N), generator=g)
        chi = None
        if cfg.tail_aware:
            chi = torch.distributions.Chi2(torch.tensor(cfg.t_df)).sample((n, 1, 1))
        out = np.empty((n, horizon, N), dtype=np.float64)
        chol = self.net.chol()
        for start in range(0, n, inference_batch_size):
            end = min(start + inference_batch_size, n)
            xh = self.net.decode(z[start:end], c[start:end])
            eps_batch = eps[start:end].to(self.device)
            if chi is not None:
                eps_batch = eps_batch / torch.sqrt(chi[start:end].to(self.device) / cfg.t_df)
            x = xh + eps_batch @ chol.T
            out[start:end] = ((x * self.sd + self.mu)[:, :horizon]).cpu().numpy()
        assert np.isfinite(out).all(), "non-finite values generated"
        return out

    def save(self, path):
        torch.save({"state": self.net.state_dict(), "cfg": asdict(self.cfg), "assets": self.assets,
                    "mu": self.mu.cpu().numpy(), "sd": self.sd.cpu().numpy(), "freq": self.regime_freq,
                    "history": self.history, "train_seconds": self.train_seconds}, path)

    @classmethod
    def load(cls, path, device="cpu"):
        d = torch.load(path, map_location=device, weights_only=False)
        cfg = CVAEConfig(**{k: (tuple(v) if k == "horizons" else v) for k, v in d["cfg"].items()})
        m = cls(cfg, device)
        m.assets, m.history, m.train_seconds, m.regime_freq = d["assets"], d["history"], d["train_seconds"], d["freq"]
        m.mu, m.sd = torch.tensor(d["mu"]).to(m.device), torch.tensor(d["sd"]).to(m.device)
        m.net = CVAENet(len(m.assets), cfg).to(m.device); m.net.load_state_dict(d["state"]); m.net.eval()
        return m
