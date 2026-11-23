"""Unit tests for clinical metrics, eAHI math, ensemble uncertainty, and subject-clustered bootstrap CIs."""

from __future__ import annotations

import numpy as np

from src.calibration import aggregate_ensemble_predictions, expected_calibration_error
from src.metrics import (
    classify_severity_tier,
    compute_decision_curve,
    compute_eahi,
    compute_minute_metrics,
    compute_recording_eahi_metrics,
    compute_subject_clustered_bootstrap_ci,
)


def test_eahi_excludes_low_sqi_deferred_minutes() -> None:
    # 120 total minutes (2 hours), but 60 minutes are low-SQI deferred.
    # Remaining 60 usable minutes (1 hour) have 18 apnea minutes -> eAHI must be 18.0!
    preds = np.zeros(120, dtype=np.int64)
    preds[:18] = 1
    preds[60:120] = 1  # noisy deferred block should NOT inflate eAHI
    sqi = np.array([True] * 60 + [False] * 60)

    assert compute_eahi(preds, sqi_pass=sqi) == 18.0
    assert classify_severity_tier(3.2) == "Normal"
    assert classify_severity_tier(10.0) == "Mild"
    assert classify_severity_tier(18.0) == "Moderate"
    assert classify_severity_tier(35.0) == "Severe"


def test_ensemble_aggregation_produces_valid_ci_and_deferred_count() -> None:
    rng = np.random.default_rng(42)
    # 5 folds x 240 minutes (4 hrs), 20 minutes deferred
    fold_probs = np.clip(rng.uniform(0.1, 0.9, size=(5, 240)), 0.0, 1.0)
    sqi = np.array([True] * 220 + [False] * 20)

    out = aggregate_ensemble_predictions(fold_probs, sqi_pass=sqi, threshold=0.5)
    assert out["usable_minutes"] == 220
    assert out["deferred_minutes"] == 20
    assert out["eahi_ci90_low"] <= out["eahi_pred"] <= out["eahi_ci90_high"]
    assert out["p_mean"].shape == (240,)
    assert out["p_std"].shape == (240,)


def test_recording_metrics_and_subject_clustered_bootstrap_ci() -> None:
    rng = np.random.default_rng(42)
    records = {}
    for i in range(10):
        # 5 apnea nights, 5 normal nights (120 mins each) with realistic imperfect predictions
        is_apnea_night = i < 5
        y = (rng.random(120) < (0.60 if is_apnea_night else 0.03)).astype(np.int64)
        p = np.clip(y * 0.72 + (1 - y) * 0.22 + rng.normal(0, 0.18, size=120), 0.01, 0.99)
        sqi = np.ones(120, dtype=bool)
        records[f"r{i:02d}"] = {"labels": y, "probs": p, "sqi_pass": sqi}

    rec_m = compute_recording_eahi_metrics(records, threshold=0.5)
    assert rec_m["n_recordings"] == 10
    assert rec_m["eahi_pearson_r"] > 0.90
    assert rec_m["screening_cutoff_5"]["sensitivity"] == 1.0
    assert rec_m["bland_altman_loa_low"] < rec_m["bland_altman_loa_high"]

    ci = compute_subject_clustered_bootstrap_ci(records, threshold=0.5, n_resamples=200, seed=42)
    for key in ("auroc", "accuracy", "eahi_mae"):
        assert ci[key]["ci95_low"] <= ci[key]["median"] <= ci[key]["ci95_high"]

    yt = np.concatenate([d["labels"] for d in records.values()])
    yp = np.concatenate([d["probs"] for d in records.values()])
    mm = compute_minute_metrics(yt, yp, threshold=0.5)
    assert mm["auroc"] > 0.90
    assert 0.0 <= expected_calibration_error(yt, yp) <= 1.0

    dca = compute_decision_curve(yt, yp)
    assert len(dca["thresholds"]) == len(dca["net_benefit_model"])
