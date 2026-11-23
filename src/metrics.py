"""Clinical evaluation metrics: per-minute, patient-level eAHI, Bland-Altman,
subject-clustered bootstrap 95% CIs, and cost-weighted decision curve analysis.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    roc_auc_score,
)

from src.calibration import brier_score, expected_calibration_error


def classify_severity_tier(eahi: float) -> str:
    """Map estimated Apnea-Hypopnea Index (events/hr) to standard clinical screening tier."""
    if eahi >= 30.0:
        return "Severe"
    if eahi >= 15.0:
        return "Moderate"
    if eahi >= 5.0:
        return "Mild"
    return "Normal"


def compute_eahi(binary_preds_or_labels: np.ndarray, sqi_pass: np.ndarray | None = None) -> float:
    """Compute minute-based Estimated Apnea Burden (eAHI, apnea-min/hr) over usable minutes."""
    arr = np.asarray(binary_preds_or_labels, dtype=np.float64)
    if sqi_pass is not None:
        mask = np.asarray(sqi_pass, dtype=bool)
        arr = arr[mask]
    if len(arr) == 0:
        return 0.0
    hours = len(arr) / 60.0
    return float(np.sum(arr > 0.5) / hours)


def compute_minute_metrics(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    threshold: float = 0.5,
    sqi_pass: np.ndarray | None = None,
) -> dict[str, float]:
    """Compute per-minute classification & calibration metrics (optionally restricted to SQI-passing epochs)."""
    yt = np.asarray(y_true, dtype=np.int64)
    yp = np.asarray(y_prob, dtype=np.float64)
    coverage = 1.0

    if sqi_pass is not None:
        mask = np.asarray(sqi_pass, dtype=bool)
        coverage = float(np.mean(mask)) if len(mask) else 0.0
        if np.any(mask):
            yt = yt[mask]
            yp = yp[mask]

    y_hat = (yp >= threshold).astype(np.int64)
    tn, fp, fn, tp = confusion_matrix(yt, y_hat, labels=[0, 1]).ravel()
    sens = float(tp / max(tp + fn, 1))
    spec = float(tn / max(tn + fp, 1))
    has_both = len(np.unique(yt)) == 2

    return {
        "n_minutes": len(yt),
        "coverage": round(coverage, 4),
        "accuracy": round(float(accuracy_score(yt, y_hat)), 4),
        "sensitivity": round(sens, 4),
        "specificity": round(spec, 4),
        "precision": round(float(precision_score(yt, y_hat, zero_division=0)), 4),
        "f1": round(float(f1_score(yt, y_hat, zero_division=0)), 4),
        "auroc": round(float(roc_auc_score(yt, yp)) if has_both else 0.5, 4),
        "auprc": round(float(average_precision_score(yt, yp)) if has_both else 0.0, 4),
        "ece": round(expected_calibration_error(yt, yp), 4),
        "brier": round(brier_score(yt, yp), 4),
    }


def compute_recording_eahi_metrics(
    records: dict[str, dict[str, np.ndarray]],
    threshold: float = 0.5,
    use_sqi_mask: bool = True,
) -> dict[str, Any]:
    """Compute patient-level clinical eAHI MAE/RMSE, Bland-Altman LoA, and triage cutoff accuracy.

    Args:
        records: `{rec_id: {"labels": (N,), "probs": (N,), "sqi_pass": (N,)}}`.
    """
    rec_ids = sorted(records.keys())
    true_eahis, pred_eahis = [], []
    per_record: list[dict[str, Any]] = []

    for rec_id in rec_ids:
        d = records[rec_id]
        labels = np.asarray(d["labels"], dtype=np.int64)
        probs = np.asarray(d["probs"], dtype=np.float64)
        sqi = np.asarray(d.get("sqi_pass", np.ones(len(labels), dtype=bool)), dtype=bool)
        mask = sqi if (use_sqi_mask and np.any(sqi)) else np.ones(len(labels), dtype=bool)

        t_eahi = compute_eahi(labels, sqi_pass=None)
        p_eahi = compute_eahi((probs >= threshold).astype(int), sqi_pass=mask)
        true_eahis.append(t_eahi)
        pred_eahis.append(p_eahi)

        y_hat = (probs[mask] >= threshold).astype(int)
        min_acc = float(accuracy_score(labels[mask], y_hat))
        per_record.append(
            {
                "record_id": rec_id,
                "n_minutes": len(labels),
                "usable_ratio": round(float(np.mean(sqi)), 4),
                "true_eahi": round(t_eahi, 2),
                "pred_eahi": round(p_eahi, 2),
                "abs_err_eahi": round(abs(p_eahi - t_eahi), 2),
                "true_tier": classify_severity_tier(t_eahi),
                "pred_tier": classify_severity_tier(p_eahi),
                "minute_acc": round(min_acc, 4),
            }
        )

    t_arr = np.asarray(true_eahis, dtype=np.float64)
    p_arr = np.asarray(pred_eahis, dtype=np.float64)
    diff = p_arr - t_arr
    mae = float(np.mean(np.abs(diff)))
    rmse = float(np.sqrt(np.mean(diff**2)))
    bias = float(np.mean(diff))
    sd_diff = float(np.std(diff, ddof=1)) if len(diff) > 1 else 0.0
    corr = float(np.corrcoef(t_arr, p_arr)[0, 1]) if (np.std(t_arr) > 1e-6 and np.std(p_arr) > 1e-6) else 0.0

    def _cutoff_stats(cutoff: float) -> dict[str, float]:
        yt = (t_arr >= cutoff).astype(int)
        yp = (p_arr >= cutoff).astype(int)
        tn, fp, fn, tp = confusion_matrix(yt, yp, labels=[0, 1]).ravel()
        return {
            "accuracy": round(float((tp + tn) / max(len(yt), 1)), 4),
            "sensitivity": round(float(tp / max(tp + fn, 1)), 4),
            "specificity": round(float(tn / max(tn + fp, 1)), 4),
        }

    return {
        "n_recordings": len(rec_ids),
        "eahi_mae": round(mae, 2),
        "eahi_rmse": round(rmse, 2),
        "eahi_pearson_r": round(corr, 4),
        "bland_altman_bias": round(bias, 2),
        "bland_altman_loa_low": round(bias - 1.96 * sd_diff, 2),
        "bland_altman_loa_high": round(bias + 1.96 * sd_diff, 2),
        "screening_cutoff_5": _cutoff_stats(5.0),
        "moderate_cutoff_15": _cutoff_stats(15.0),
        "per_record": per_record,
    }


def compute_subject_clustered_bootstrap_ci(
    records: dict[str, dict[str, np.ndarray]],
    threshold: float = 0.5,
    n_resamples: int = 1000,
    seed: int = 42,
    use_sqi_mask: bool = True,
) -> dict[str, dict[str, float]]:
    """Compute subject-clustered 95% bootstrap confidence intervals by resampling whole nights."""
    rec_ids = sorted(records.keys())
    n_subj = len(rec_ids)
    rng = np.random.default_rng(seed)

    # Pre-cache arrays per subject for fast resampling
    cached = []
    for rid in rec_ids:
        d = records[rid]
        y = np.asarray(d["labels"], dtype=np.int64)
        p = np.asarray(d["probs"], dtype=np.float64)
        sqi = np.asarray(d.get("sqi_pass", np.ones(len(y), dtype=bool)), dtype=bool)
        mask = sqi if (use_sqi_mask and np.any(sqi)) else np.ones(len(y), dtype=bool)
        t_eahi = compute_eahi(y, sqi_pass=None)
        p_eahi = compute_eahi((p >= threshold).astype(int), sqi_pass=mask)
        cached.append((y[mask], p[mask], abs(p_eahi - t_eahi)))

    metrics_boot: dict[str, list[float]] = {
        "accuracy": [],
        "sensitivity": [],
        "specificity": [],
        "f1": [],
        "auroc": [],
        "auprc": [],
        "eahi_mae": [],
    }

    for _ in range(n_resamples):
        idxs = rng.integers(0, n_subj, size=n_subj)
        ys = np.concatenate([cached[i][0] for i in idxs])
        ps = np.concatenate([cached[i][1] for i in idxs])
        errs = [cached[i][2] for i in idxs]
        yhat = (ps >= threshold).astype(np.int64)

        tn, fp, fn, tp = confusion_matrix(ys, yhat, labels=[0, 1]).ravel()
        metrics_boot["accuracy"].append(float((tp + tn) / max(len(ys), 1)))
        metrics_boot["sensitivity"].append(float(tp / max(tp + fn, 1)))
        metrics_boot["specificity"].append(float(tn / max(tn + fp, 1)))
        metrics_boot["f1"].append(float(f1_score(ys, yhat, zero_division=0)))
        if len(np.unique(ys)) == 2:
            metrics_boot["auroc"].append(float(roc_auc_score(ys, ps)))
            metrics_boot["auprc"].append(float(average_precision_score(ys, ps)))
        metrics_boot["eahi_mae"].append(float(np.mean(errs)))

    summary: dict[str, dict[str, float]] = {}
    for key, vals in metrics_boot.items():
        arr = np.asarray(vals, dtype=np.float64)
        lo, med, hi = np.percentile(arr, [2.5, 50.0, 97.5])
        summary[key] = {
            "mean": round(float(np.mean(arr)), 4),
            "median": round(float(med), 4),
            "ci95_low": round(float(lo), 4),
            "ci95_high": round(float(hi), 4),
        }
    return summary


def compute_decision_curve(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    thresholds: np.ndarray | None = None,
) -> dict[str, list[float]]:
    """Compute Clinical Net Benefit across probability thresholds vs. Treat-All and Treat-None."""
    yt = np.asarray(y_true, dtype=np.int64)
    yp = np.asarray(y_prob, dtype=np.float64)
    n = max(len(yt), 1)
    prevalence = float(np.mean(yt))
    if thresholds is None:
        thresholds = np.linspace(0.05, 0.80, 31)

    nb_model, nb_all = [], []
    for pt in thresholds:
        odds = pt / max(1.0 - pt, 1e-6)
        pred_pos = yp >= pt
        tp = float(np.sum((yt == 1) & pred_pos))
        fp = float(np.sum((yt == 0) & pred_pos))
        nb_model.append(round((tp / n) - (fp / n) * odds, 4))
        nb_all.append(round(prevalence - (1.0 - prevalence) * odds, 4))

    return {
        "thresholds": [round(float(t), 3) for t in thresholds],
        "net_benefit_model": nb_model,
        "net_benefit_refer_all": nb_all,
        "net_benefit_refer_none": [0.0] * len(thresholds),
    }
