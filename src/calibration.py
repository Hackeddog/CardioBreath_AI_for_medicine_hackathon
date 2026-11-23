"""Post-hoc Temperature Scaling, calibration diagnostics, and 5-fold Deep Ensemble aggregation."""

from __future__ import annotations

import numpy as np
from scipy import optimize


def sigmoid(logits: np.ndarray) -> np.ndarray:
    x = np.clip(np.asarray(logits, dtype=np.float64), -40.0, 40.0)
    return 1.0 / (1.0 + np.exp(-x))


def binary_nll(logits: np.ndarray, y_true: np.ndarray) -> float:
    x = np.asarray(logits, dtype=np.float64)
    y = np.asarray(y_true, dtype=np.float64)
    # Numerically stable BCE with logits: max(x, 0) - x*y + log(1 + exp(-|x|))
    loss = np.maximum(x, 0.0) - x * y + np.log1p(np.exp(-np.abs(x)))
    return float(np.mean(loss))


def fit_temperature_scaling(val_logits: np.ndarray, val_labels: np.ndarray) -> float:
    """Fit scalar temperature T > 0 minimizing out-of-fold validation NLL via deterministic L-BFGS-B."""
    logits = np.asarray(val_logits, dtype=np.float64)
    labels = np.asarray(val_labels, dtype=np.float64)

    def objective(log_t: np.ndarray) -> float:
        temp = float(np.exp(log_t[0]))
        return binary_nll(logits / temp, labels)

    res = optimize.minimize(
        objective,
        x0=np.array([0.0]),
        method="L-BFGS-B",
        bounds=[(-2.5, 2.5)],  # T in [0.082, 12.18]
    )
    return float(np.exp(res.x[0]))


def apply_temperature(logits: np.ndarray, temperature: float) -> np.ndarray:
    """Apply scalar temperature scaling to raw logits and return calibrated probabilities."""
    t = max(float(temperature), 1e-4)
    return sigmoid(np.asarray(logits, dtype=np.float64) / t).astype(np.float32)


def expected_calibration_error(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 15) -> float:
    """Compute Expected Calibration Error (ECE) over equal-width probability bins."""
    y_t = np.asarray(y_true, dtype=np.float64)
    y_p = np.clip(np.asarray(y_prob, dtype=np.float64), 0.0, 1.0)
    if len(y_t) == 0:
        return 0.0
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    n = len(y_t)
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (y_p >= lo) & (y_p <= hi if i == n_bins - 1 else y_p < hi)
        if np.any(mask):
            acc = float(np.mean(y_t[mask]))
            conf = float(np.mean(y_p[mask]))
            ece += (np.sum(mask) / n) * abs(acc - conf)
    return float(ece)


def brier_score(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    y_t = np.asarray(y_true, dtype=np.float64)
    y_p = np.asarray(y_prob, dtype=np.float64)
    return float(np.mean((y_p - y_t) ** 2)) if len(y_t) else 0.0


def aggregate_ensemble_predictions(
    fold_probs: np.ndarray,
    sqi_pass: np.ndarray,
    threshold: float = 0.5,
) -> dict[str, np.ndarray | float]:
    """Aggregate 5-fold calibrated probabilities into per-minute mean/std and recording eAHI + 90% CI.

    Args:
        fold_probs: Array of shape `(K_folds, N_minutes)` with calibrated probabilities in `[0, 1]`.
        sqi_pass: Boolean array of shape `(N_minutes,)` marking usable (non-deferred) epochs.
        threshold: Decision cutoff tuned strictly on CV.
    """
    fp = np.asarray(fold_probs, dtype=np.float64)
    if fp.ndim == 1:
        fp = fp[None, :]
    sqi = np.asarray(sqi_pass, dtype=bool)
    n_min = fp.shape[1]

    p_mean = np.mean(fp, axis=0)
    p_std = np.std(fp, axis=0, ddof=1) if fp.shape[0] > 1 else np.zeros(n_min, dtype=np.float64)

    usable_n = int(np.sum(sqi))
    if usable_n == 0:
        return {
            "p_mean": p_mean.astype(np.float32),
            "p_std": p_std.astype(np.float32),
            "eahi_pred": 0.0,
            "eahi_ci90_low": 0.0,
            "eahi_ci90_high": 0.0,
            "usable_minutes": 0,
            "deferred_minutes": int(n_min),
        }

    usable_hours = usable_n / 60.0
    # Per-fold eAHI estimates (epistemic spread across ensemble members)
    fold_eahis = np.array([np.sum(fp[k, sqi] >= threshold) / usable_hours for k in range(fp.shape[0])])
    eahi_pred = float(np.sum(p_mean[sqi] >= threshold) / usable_hours)
    epistemic_var = float(np.var(fold_eahis, ddof=1)) if len(fold_eahis) > 1 else 0.0

    # Aleatoric Bernoulli count variance over usable minutes converted to events/hr
    p_u = np.clip(p_mean[sqi], 1e-6, 1.0 - 1e-6)
    aleatoric_var = float(np.sum(p_u * (1.0 - p_u))) / (usable_hours**2)
    total_se = float(np.sqrt(epistemic_var + aleatoric_var))

    ci_lo = max(0.0, eahi_pred - 1.645 * total_se)
    ci_hi = min(60.0, eahi_pred + 1.645 * total_se)

    return {
        "p_mean": p_mean.astype(np.float32),
        "p_std": p_std.astype(np.float32),
        "eahi_pred": round(eahi_pred, 2),
        "eahi_ci90_low": round(ci_lo, 2),
        "eahi_ci90_high": round(ci_hi, 2),
        "usable_minutes": usable_n,
        "deferred_minutes": int(n_min - usable_n),
    }
