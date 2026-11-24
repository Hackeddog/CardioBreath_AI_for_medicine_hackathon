"""High-level Python predictor API wrapping the bundled 5-fold ONNX CardioBreath ensemble."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
import pandas as pd
import yaml

from cardiobreath._dsp import load_csv_ecg, run_dsp, slice_dual_windows

ASSETS_DIR = Path(__file__).resolve().parent / "assets"


def _sigmoid_temp(logits: np.ndarray, temperature: float) -> np.ndarray:
    t = max(float(temperature), 1e-4)
    x = np.clip(np.asarray(logits, dtype=np.float64) / t, -40.0, 40.0)
    return (1.0 / (1.0 + np.exp(-x))).astype(np.float32)


def _classify_tier(eahi: float) -> str:
    if eahi >= 30.0:
        return "Severe"
    if eahi >= 15.0:
        return "Moderate"
    if eahi >= 5.0:
        return "Mild"
    return "Normal"


def _triage_action(tier: str, usable_ratio: float, rhythm_irregular: bool) -> str:
    if usable_ratio < 0.50:
        return "INSUFFICIENT SIGNAL — REPEAT RECORDING / CLINICIAN REVIEW"
    if rhythm_irregular:
        return "NON-SINUS RHYTHM DETECTED — REFER FULL PSG (ECG UNRELIABLE)"
    if tier in ("Severe", "Moderate"):
        return f"{tier.upper()} BURDEN — PRIORITY PSG REFERRAL RECOMMENDED"
    if tier == "Mild":
        return "MILD / BORDERLINE — CLINICAL CORRELATION & FOLLOW-UP"
    return "LOW APNEA BURDEN — ROUTINE FOLLOW-UP IF SYMPTOMATIC"


@dataclass
class ScreeningResult:
    """Structured sleep apnea pre-screening result for an overnight or multi-minute ECG."""

    duration_minutes: int
    eahi_pred: float
    eahi_ci90_low: float
    eahi_ci90_high: float
    severity_tier: str
    triage_action: str
    threshold_used: float
    temperature: float
    usable_minutes: int
    deferred_minutes: int
    usable_ratio: float
    rhythm_irregular: bool
    rhythm_rmssd_ratio: float
    inference_ms: float
    minute_probs: np.ndarray
    minute_std: np.ndarray
    minute_preds: np.ndarray
    sqi_score: np.ndarray
    sqi_pass: np.ndarray

    def to_dict(self) -> dict[str, Any]:
        return {
            "duration_minutes": self.duration_minutes,
            "eahi_pred": self.eahi_pred,
            "eahi_ci90": [self.eahi_ci90_low, self.eahi_ci90_high],
            "severity_tier": self.severity_tier,
            "triage_action": self.triage_action,
            "threshold_used": self.threshold_used,
            "temperature": self.temperature,
            "usable_minutes": self.usable_minutes,
            "deferred_minutes": self.deferred_minutes,
            "usable_ratio": round(self.usable_ratio, 4),
            "rhythm_irregular": self.rhythm_irregular,
            "rhythm_rmssd_ratio": round(self.rhythm_rmssd_ratio, 4),
            "inference_ms": round(self.inference_ms, 2),
            "disclaimer": "Pre-screening triage estimate (eAHI) only — not a standalone clinical diagnosis.",
        }

    def to_dataframe(self) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "minute": np.arange(self.duration_minutes, dtype=int),
                "prob_apnea": np.round(self.minute_probs, 4),
                "prob_std": np.round(self.minute_std, 4),
                "pred_label": self.minute_preds,
                "sqi_score": np.round(self.sqi_score, 3),
                "sqi_pass": self.sqi_pass,
            }
        )


class CardioBreathPredictor:
    """Standalone CPU sleep apnea pre-screening engine backed by the 5-fold ONNX ensemble."""

    def __init__(
        self,
        model_dir: str | Path | None = None,
        threshold: float | None = None,
        num_threads: int = 4,
    ) -> None:
        if model_dir is not None:
            base_dir = Path(model_dir)
        elif (ASSETS_DIR / "cardiobreath_fold_0.onnx").exists():
            base_dir = ASSETS_DIR
        else:
            # Fallback when imported directly from a source git checkout before `build_package.py`
            repo_root = Path(__file__).resolve().parent.parent
            base_dir = repo_root / "artifacts" / "onnx" / "cardiobreath"

        meta_path = base_dir / "deploy_metadata.json"
        cfg_path = (
            base_dir / "default.yaml"
            if (base_dir / "default.yaml").exists()
            else Path(__file__).resolve().parent.parent / "configs" / "default.yaml"
        )

        self.metadata: dict[str, Any] = (
            json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        )
        full_cfg: dict[str, Any] = (
            yaml.safe_load(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
        )
        self.dsp_cfg: dict[str, Any] = full_cfg.get("dsp", {})
        self.temperature = float(self.metadata.get("temperature", 1.835))
        self.default_threshold = float(
            threshold if threshold is not None else self.metadata.get("threshold", 0.60)
        )

        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = max(1, int(num_threads))
        self.sessions: list[ort.InferenceSession] = []
        for fold in range(5):
            onnx_file = base_dir / f"cardiobreath_fold_{fold}.onnx"
            if onnx_file.exists():
                self.sessions.append(
                    ort.InferenceSession(str(onnx_file), sess_options=sess_opts, providers=["CPUExecutionProvider"])
                )
        if not self.sessions:
            raise FileNotFoundError(f"No CardioBreath ONNX fold models found in {base_dir}")

    def predict_windows(self, dual_windows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Score pre-sliced `(N, 2, 1200)` 4 Hz `[EDR, RRI]` windows and return `(p_mean, p_std)`."""
        x = np.asarray(dual_windows, dtype=np.float32)
        if x.ndim != 3 or x.shape[1:] != (2, 1200):
            raise ValueError(f"Expected dual_windows shape (N, 2, 1200), got {x.shape}")
        fold_probs = np.stack(
            [_sigmoid_temp(sess.run(["logits"], {"signals": x})[0], self.temperature) for sess in self.sessions],
            axis=0,
        )
        p_mean = np.mean(fold_probs, axis=0).astype(np.float32)
        p_std = (
            np.std(fold_probs, axis=0, ddof=1).astype(np.float32)
            if fold_probs.shape[0] > 1
            else np.zeros(len(p_mean), dtype=np.float32)
        )
        return p_mean, p_std

    def predict_array(
        self,
        ecg: np.ndarray,
        fs: float = 100.0,
        threshold: float | None = None,
    ) -> ScreeningResult:
        """Run end-to-end DSP + SQI noise gate + 5-fold ONNX screening on a raw 1D ECG array."""
        x = np.asarray(ecg, dtype=np.float32).reshape(-1)
        if len(x) < round(60.0 * fs):
            raise ValueError("ECG recording must be at least 60 seconds (1 minute) long.")
        if not np.all(np.isfinite(x)):
            raise ValueError("ECG recording contains no numeric samples or infinite values.")

        thr = float(threshold if threshold is not None else self.default_threshold)
        t0 = time.perf_counter()
        dsp_out = run_dsp(x, fs=fs, dsp_cfg=self.dsp_cfg)
        n_min = len(dsp_out.sqi_pass)
        dual_windows = slice_dual_windows(
            dsp_out.edr_4hz,
            dsp_out.rri_4hz,
            n_minutes=n_min,
            context_minutes=int(self.dsp_cfg.get("context_minutes", 5)),
            target_fs=float(self.dsp_cfg.get("sampling_rate_dsp", 4.0)),
        )

        fold_probs = np.stack(
            [
                _sigmoid_temp(sess.run(["logits"], {"signals": dual_windows})[0], self.temperature)
                for sess in self.sessions
            ],
            axis=0,
        )
        inference_ms = (time.perf_counter() - t0) * 1000.0

        sqi = dsp_out.sqi_pass
        p_mean = np.mean(fold_probs, axis=0).astype(np.float32)
        p_std = (
            np.std(fold_probs, axis=0, ddof=1).astype(np.float32)
            if fold_probs.shape[0] > 1
            else np.zeros(n_min, dtype=np.float32)
        )

        usable_n = int(np.sum(sqi))
        if usable_n == 0:
            eahi_pred, ci_lo, ci_hi = 0.0, 0.0, 0.0
        else:
            usable_hours = usable_n / 60.0
            fold_eahis = np.array(
                [np.sum(fold_probs[k, sqi] >= thr) / usable_hours for k in range(fold_probs.shape[0])]
            )
            eahi_pred = round(float(np.sum(p_mean[sqi] >= thr) / usable_hours), 2)
            epistemic_var = float(np.var(fold_eahis, ddof=1)) if len(fold_eahis) > 1 else 0.0
            p_u = np.clip(p_mean[sqi].astype(np.float64), 1e-6, 1.0 - 1e-6)
            aleatoric_var = float(np.sum(p_u * (1.0 - p_u))) / (usable_hours**2)
            total_se = float(np.sqrt(epistemic_var + aleatoric_var))
            ci_lo = round(max(0.0, eahi_pred - 1.645 * total_se), 2)
            ci_hi = round(min(60.0, eahi_pred + 1.645 * total_se), 2)

        preds = np.where(sqi, (p_mean >= thr).astype(np.int32), -1)
        tier = _classify_tier(eahi_pred)
        action = _triage_action(tier, dsp_out.usable_ratio, dsp_out.rhythm_irregular)

        return ScreeningResult(
            duration_minutes=n_min,
            eahi_pred=eahi_pred,
            eahi_ci90_low=ci_lo,
            eahi_ci90_high=ci_hi,
            severity_tier=tier,
            triage_action=action,
            threshold_used=thr,
            temperature=self.temperature,
            usable_minutes=usable_n,
            deferred_minutes=int(n_min - usable_n),
            usable_ratio=dsp_out.usable_ratio,
            rhythm_irregular=dsp_out.rhythm_irregular,
            rhythm_rmssd_ratio=dsp_out.rhythm_rmssd_ratio,
            inference_ms=inference_ms,
            minute_probs=p_mean,
            minute_std=p_std,
            minute_preds=preds,
            sqi_score=dsp_out.sqi_score,
            sqi_pass=sqi,
        )

    def predict_csv(
        self,
        csv_path: str | Path,
        default_fs: float = 100.0,
        threshold: float | None = None,
    ) -> ScreeningResult:
        """Load a single-lead ECG CSV file and run full 5-fold CardioBreath screening."""
        ecg, fs = load_csv_ecg(csv_path, default_fs=default_fs)
        return self.predict_array(ecg, fs=fs, threshold=threshold)


_DEFAULT_PREDICTOR: CardioBreathPredictor | None = None


def _get_default_predictor() -> CardioBreathPredictor:
    global _DEFAULT_PREDICTOR
    if _DEFAULT_PREDICTOR is None:
        _DEFAULT_PREDICTOR = CardioBreathPredictor()
    return _DEFAULT_PREDICTOR


def predict_array(ecg: np.ndarray, fs: float = 100.0, threshold: float | None = None) -> ScreeningResult:
    """Convenience function to screen a 1D NumPy ECG waveform using the cached 5-fold ensemble."""
    return _get_default_predictor().predict_array(ecg, fs=fs, threshold=threshold)


def predict_csv(
    csv_path: str | Path,
    default_fs: float = 100.0,
    threshold: float | None = None,
) -> ScreeningResult:
    """Convenience function to screen a single-lead ECG CSV file using the cached 5-fold ensemble."""
    return _get_default_predictor().predict_csv(csv_path, default_fs=default_fs, threshold=threshold)
