"""Baseline 1: Classical HRV + EDR + Cardiopulmonary Coupling features -> LightGBM (5-fold CV)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
from sklearn.metrics import f1_score, roc_auc_score

from src.calibration import apply_temperature, fit_temperature_scaling
from src.datasets import load_hrv_dataset


def _prob_to_logit(p: np.ndarray) -> np.ndarray:
    p_clip = np.clip(np.asarray(p, dtype=np.float64), 1e-6, 1.0 - 1e-6)
    return np.log(p_clip / (1.0 - p_clip))


def find_optimal_threshold(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Select decision threshold maximizing F1 strictly on out-of-fold validation predictions."""
    best_thr, best_f1 = 0.5, -1.0
    for thr in np.linspace(0.25, 0.75, 51):
        score = float(f1_score(y_true, (y_prob >= thr).astype(int), zero_division=0))
        if score > best_f1:
            best_f1 = score
            best_thr = float(thr)
    return round(best_thr, 3)


def train_lgbm_cv(
    folds_cfg: dict[str, Any],
    train_dir: str | Path,
    out_dir: str | Path,
    seed: int = 42,
) -> dict[str, Any]:
    """Train 5-fold subject-disjoint LightGBM baseline and save models + OOF predictions."""
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    folds = folds_cfg["folds"]
    oof_logits: list[np.ndarray] = []
    oof_labels: list[np.ndarray] = []
    oof_sqi: list[np.ndarray] = []
    oof_records: list[str] = []
    fold_aucs: list[float] = []

    for fold_idx in range(5):
        split = folds[f"fold_{fold_idx}"]
        x_tr, y_tr, sqi_tr, _ = load_hrv_dataset(split["train"], train_dir)
        x_va, y_va, sqi_va, rec_va = load_hrv_dataset(split["val"], train_dir)

        # Train on usable signal epochs to prevent label noise from flatlines/motion
        if sqi_tr.any():
            x_tr, y_tr = x_tr[sqi_tr], y_tr[sqi_tr]

        pos_weight = float(np.sum(y_tr == 0) / max(np.sum(y_tr == 1), 1))
        clf = lgb.LGBMClassifier(
            n_estimators=500,
            learning_rate=0.03,
            num_leaves=31,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_samples=40,
            reg_alpha=0.5,
            reg_lambda=1.0,
            scale_pos_weight=pos_weight,
            random_state=seed + fold_idx,
            n_jobs=-1,
            verbose=-1,
        )
        clf.fit(
            x_tr,
            y_tr,
            eval_set=[(x_va, y_va)],
            callbacks=[lgb.early_stopping(stopping_rounds=40, verbose=False)],
        )
        clf.booster_.save_model(str(out_path / f"fold_{fold_idx}.txt"))

        va_prob = clf.predict_proba(x_va)[:, 1]
        va_logit = _prob_to_logit(va_prob)
        auc = float(roc_auc_score(y_va, va_prob))
        fold_aucs.append(auc)

        oof_logits.append(va_logit)
        oof_labels.append(y_va)
        oof_sqi.append(sqi_va)
        oof_records.extend(rec_va)
        print(f"  [lgbm] fold_{fold_idx}: val_auroc={auc:.4f} (best_iter={clf.best_iteration_})")

    all_logits = np.concatenate(oof_logits)
    all_labels = np.concatenate(oof_labels)
    all_sqi = np.concatenate(oof_sqi)

    temp = fit_temperature_scaling(all_logits, all_labels)
    all_probs = apply_temperature(all_logits, temp)
    best_thr = find_optimal_threshold(all_labels, all_probs)
    oof_auc = float(roc_auc_score(all_labels, all_probs))

    np.savez_compressed(
        out_path / "oof_predictions.npz",
        logits=all_logits.astype(np.float32),
        probs=all_probs.astype(np.float32),
        labels=all_labels.astype(np.int64),
        sqi_pass=all_sqi.astype(bool),
        record_ids=np.array(oof_records),
    )

    meta = {
        "model": "lgbm",
        "seed": seed,
        "temperature": round(temp, 5),
        "threshold": best_thr,
        "oof_auroc": round(oof_auc, 4),
        "fold_aurocs": [round(a, 4) for a in fold_aucs],
    }
    (out_path / "cv_summary.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def predict_lgbm_ensemble(model_dir: str | Path, x_hrv: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Predict calibrated probabilities using the 5 saved LightGBM fold boosters."""
    mdir = Path(model_dir)
    meta = json.loads((mdir / "cv_summary.json").read_text(encoding="utf-8"))
    temp = float(meta.get("temperature", 1.0))

    fold_probs = []
    for k in range(5):
        booster = lgb.Booster(model_file=str(mdir / f"fold_{k}.txt"))
        raw_p = booster.predict(x_hrv)
        logits = _prob_to_logit(raw_p)
        fold_probs.append(apply_temperature(logits, temp))

    stacked = np.stack(fold_probs, axis=0)  # (5, N)
    return np.mean(stacked, axis=0).astype(np.float32), stacked.astype(np.float32)
