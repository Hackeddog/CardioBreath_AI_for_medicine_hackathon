"""CPU ONNX 5-fold Deep Ensemble inference engine + LightGBM baseline + live 1D Grad-CAM."""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

import numpy as np
import onnxruntime as ort
import torch

from src.baselines import load_lgbm_boosters, predict_lgbm_ensemble
from src.calibration import aggregate_ensemble_predictions, apply_temperature
from src.config import load_config, resolve_path
from src.data_io import load_uploaded_csv_ecg
from src.dsp import (
    DSPResult,
    extract_hrv_features_per_minute,
    inject_motion_artifact,
    run_dsp_pipeline,
    slice_windows,
)
from src.metrics import classify_severity_tier, compute_eahi
from src.models import build_model, compute_gradcam_1d

_CASE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@dataclass
class CachedNightBundle:
    case_id: str
    ecg_raw: np.ndarray
    fs: float
    labels: np.ndarray | None
    dsp: DSPResult
    dual_windows: np.ndarray  # (N, 2, 1200)
    hrv_features: np.ndarray  # (N, 22)
    fold_probs: np.ndarray  # (K, N)
    p_mean: np.ndarray  # (N,)
    p_std: np.ndarray  # (N,)
    baseline_probs: np.ndarray | None  # (N,)
    inference_ms: float


def _format_hhmm(minute: int) -> str:
    hrs = minute // 60
    mins = minute % 60
    return f"{hrs:02d}:{mins:02d}"


def _triage_action_for_tier(tier: str, usable_ratio: float, rhythm_irregular: bool) -> str:
    if usable_ratio < 0.50:
        return "INSUFFICIENT SIGNAL — REPEAT RECORDING / CLINICIAN REVIEW"
    if rhythm_irregular:
        return "NON-SINUS RHYTHM DETECTED — REFER FULL PSG (ECG UNRELIABLE)"
    if tier in ("Severe", "Moderate"):
        return f"{tier.upper()} BURDEN — PRIORITY PSG REFERRAL RECOMMENDED"
    if tier == "Mild":
        return "MILD / BORDERLINE — CLINICAL CORRELATION & FOLLOW-UP"
    return "LOW APNEA BURDEN — ROUTINE FOLLOW-UP IF SYMPTOMATIC"


class CardioBreathInferenceEngine:
    """Thread-safe CPU inference engine serving ONNX 5-fold ensemble, LightGBM baseline, and Grad-CAM."""

    def __init__(self, config_path: str = "configs/default.yaml") -> None:
        self.cfg = load_config(config_path)
        self.dsp_cfg = self.cfg["dsp"]
        self.demo_dir = resolve_path(self.cfg["paths"]["demo_dir"])
        self.onnx_dir = resolve_path(self.cfg["paths"]["onnx_dir"]) / "cardiobreath"
        self.ckpt_dir = resolve_path(self.cfg["paths"]["checkpoints_dir"])
        self.reports_dir = resolve_path(self.cfg["paths"]["reports_dir"])

        # Load deployment metadata & 5-fold ONNX Runtime CPU sessions
        meta_path = self.onnx_dir / "deploy_metadata.json"
        self.deploy_meta: dict[str, Any] = (
            json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        )
        self.temperature = float(self.deploy_meta.get("temperature", 1.0))
        self.default_threshold = float(self.deploy_meta.get("threshold", 0.5))
        self.smoke_weights = bool(self.deploy_meta.get("smoke", False))

        self.onnx_sessions: list[ort.InferenceSession] = []
        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = 4
        for fold_idx in range(5):
            fpath = self.onnx_dir / f"cardiobreath_fold_{fold_idx}.onnx"
            if fpath.exists():
                self.onnx_sessions.append(
                    ort.InferenceSession(str(fpath), sess_options=sess_opts, providers=["CPUExecutionProvider"])
                )

        # Load Baseline 1 (LightGBM) boosters once at startup (CRLF-safe & thread-safe)
        self.lgbm_dir = self.ckpt_dir / "lgbm"
        self.lgbm_available = (self.lgbm_dir / "cv_summary.json").exists() and (self.lgbm_dir / "fold_0.txt").exists()
        self.lgbm_threshold = 0.5
        self.lgbm_boosters = None
        self.lgbm_temperature = 1.0
        if self.lgbm_available:
            lgbm_meta = json.loads((self.lgbm_dir / "cv_summary.json").read_text(encoding="utf-8"))
            self.lgbm_threshold = float(lgbm_meta.get("threshold", 0.5))
            self.lgbm_boosters, self.lgbm_temperature = load_lgbm_boosters(self.lgbm_dir)

        # Load fold_0 PyTorch checkpoint for exact 1D Grad-CAM saliency attribution
        self.gradcam_model: torch.nn.Module | None = None
        pt_fold0 = self.ckpt_dir / "cardiobreath" / "fold_0.pt"
        if pt_fold0.exists():
            ckpt = torch.load(pt_fold0, map_location="cpu", weights_only=False)
            m = build_model("cardiobreath", {"model": ckpt.get("model_config", self.cfg["model"])})
            m.load_state_dict(ckpt["state_dict"])
            m.eval()
            self.gradcam_model = m

        # Load demo manifest & thread-safe LRU analysis cache
        manifest_path = self.demo_dir / "manifest.json"
        self.demo_manifest: list[dict[str, Any]] = (
            json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else []
        )
        self._lock = threading.RLock()
        self._gradcam_lock = threading.Lock()
        self._cache: OrderedDict[tuple[str, float | None], CachedNightBundle] = OrderedDict()
        self._uploads: OrderedDict[str, tuple[np.ndarray, float]] = OrderedDict()
        self._max_cache = 16

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok" if self.onnx_sessions else "degraded",
            "model_name": "CardioBreath (Dual-Stream Multi-Scale 1D-CNN + BiGRU)",
            "n_onnx_folds": len(self.onnx_sessions),
            "smoke_weights": self.smoke_weights,
            "temperature": round(self.temperature, 4),
            "default_threshold": round(self.default_threshold, 3),
            "lgbm_baseline_available": self.lgbm_available,
            "gradcam_available": self.gradcam_model is not None,
            "bench_500min_per_fold_ms": self.deploy_meta.get("bench_500min_per_fold_ms"),
        }

    def list_cases(self) -> list[dict[str, Any]]:
        return self.demo_manifest

    def _load_raw_case(self, case_id: str) -> tuple[np.ndarray, float, np.ndarray | None]:
        if not _CASE_ID_RE.fullmatch(case_id):
            raise ValueError(f"Invalid case_id: {case_id}")
        with self._lock:
            if case_id in self._uploads:
                ecg, fs = self._uploads[case_id]
                return ecg, fs, None
        demo_root = self.demo_dir.resolve()
        npz_path = (demo_root / f"{case_id}.npz").resolve()
        if not npz_path.is_relative_to(demo_root):
            raise ValueError(f"Invalid case_id path: {case_id}")
        if not npz_path.exists():
            raise FileNotFoundError(f"Unknown case_id: {case_id}")
        with np.load(npz_path, allow_pickle=False) as d:
            ecg = d["ecg_100hz"].astype(np.float32)
            fs = float(d["fs"])
            labels = d["labels"].astype(np.int64) if "labels" in d else None
        return ecg, fs, labels

    def _run_onnx_ensemble(self, dual_windows: np.ndarray) -> np.ndarray:
        if not self.onnx_sessions:
            raise RuntimeError("No ONNX models loaded in artifacts/onnx/cardiobreath.")
        fold_probs = []
        x = dual_windows.astype(np.float32)
        for sess in self.onnx_sessions:
            logits = sess.run(["logits"], {"signals": x})[0]
            fold_probs.append(apply_temperature(logits, self.temperature))
        return np.stack(fold_probs, axis=0).astype(np.float32)

    def _get_or_compute_bundle(
        self, case_id: str, inject_noise_snr_db: float | None = None
    ) -> CachedNightBundle:
        snr_key = round(float(inject_noise_snr_db), 1) if inject_noise_snr_db is not None else None
        cache_key = (case_id, snr_key)
        with self._lock:
            if cache_key in self._cache:
                self._cache.move_to_end(cache_key)
                return self._cache[cache_key]

        ecg_raw, fs, labels = self._load_raw_case(case_id)
        if snr_key is not None:
            ecg_proc_in = inject_motion_artifact(ecg_raw, snr_db=snr_key, fs=fs, seed=42, burst_fraction=0.65)
        else:
            ecg_proc_in = ecg_raw

        n_minutes = len(labels) if labels is not None else max(1, len(ecg_proc_in) // round(60.0 * fs))

        t0 = time.perf_counter()
        dsp_res = run_dsp_pipeline(
            ecg_proc_in,
            fs=fs,
            n_minutes=n_minutes,
            dsp_cfg=self.dsp_cfg,
            prefer_neurokit=False,  # Fast deterministic Pan-Tompkins (<200 ms for 8 hrs!)
        )
        dual_windows, _ = slice_windows(
            dsp_res.edr_4hz,
            dsp_res.rri_4hz,
            dsp_res.ecg_clean,
            n_minutes=n_minutes,
            context_minutes=int(self.dsp_cfg.get("context_minutes", 5)),
            target_fs=float(self.dsp_cfg.get("sampling_rate_dsp", 4.0)),
            raw_fs=100.0,  # run_dsp_pipeline resamples ecg_clean to 100 Hz
        )
        hrv_feats = extract_hrv_features_per_minute(
            dsp_res.rri_raw_4hz,
            dsp_res.edr_raw_4hz,
            dsp_res.sqi_score,
            n_minutes=n_minutes,
            context_minutes=int(self.dsp_cfg.get("context_minutes", 5)),
            target_fs=float(self.dsp_cfg.get("sampling_rate_dsp", 4.0)),
        )
        fold_probs = self._run_onnx_ensemble(dual_windows)
        inference_ms = (time.perf_counter() - t0) * 1000.0

        p_mean = np.mean(fold_probs, axis=0).astype(np.float32)
        p_std = (
            np.std(fold_probs, axis=0, ddof=1).astype(np.float32)
            if fold_probs.shape[0] > 1
            else np.zeros(n_minutes, dtype=np.float32)
        )

        baseline_probs = None
        if self.lgbm_available and self.lgbm_boosters is not None:
            baseline_probs, _ = predict_lgbm_ensemble(
                self.lgbm_dir,
                hrv_feats,
                boosters=self.lgbm_boosters,
                temperature=self.lgbm_temperature,
            )

        bundle = CachedNightBundle(
            case_id=case_id,
            ecg_raw=ecg_proc_in,
            fs=fs,
            labels=labels,
            dsp=dsp_res,
            dual_windows=dual_windows,
            hrv_features=hrv_feats,
            fold_probs=fold_probs,
            p_mean=p_mean,
            p_std=p_std,
            baseline_probs=baseline_probs,
            inference_ms=inference_ms,
        )
        # Heavy DSP/ONNX work runs outside the lock so one cache miss does not block every request;
        # two simultaneous misses on the same key just compute twice and the last write wins.
        with self._lock:
            self._cache[cache_key] = bundle
            if len(self._cache) > self._max_cache:
                self._cache.popitem(last=False)
        return bundle

    def analyze_case(
        self,
        case_id: str,
        threshold: float | None = None,
        inject_noise_snr_db: float | None = None,
        compare_baseline: bool = True,
    ) -> dict[str, Any]:
        bundle = self._get_or_compute_bundle(case_id, inject_noise_snr_db=inject_noise_snr_db)
        thr = float(threshold if threshold is not None else self.default_threshold)
        sqi = bundle.dsp.sqi_pass
        agg = aggregate_ensemble_predictions(bundle.fold_probs, sqi_pass=sqi, threshold=thr)

        eahi_pred = float(agg["eahi_pred"])
        tier = classify_severity_tier(eahi_pred)
        triage_action = _triage_action_for_tier(tier, bundle.dsp.usable_ratio, bundle.dsp.rhythm_irregular)

        n_min = len(bundle.p_mean)
        true_eahi = None
        minute_acc = None
        if bundle.labels is not None:
            true_eahi = round(compute_eahi(bundle.labels, sqi_pass=None), 2)
            mask = sqi if np.any(sqi) else np.ones(n_min, dtype=bool)
            minute_acc = round(float(np.mean((bundle.p_mean[mask] >= thr).astype(int) == bundle.labels[mask])), 4)

        baseline_eahi = None
        baseline_acc = None
        if compare_baseline and bundle.baseline_probs is not None:
            mask = sqi if np.any(sqi) else np.ones(n_min, dtype=bool)
            baseline_eahi = round(
                compute_eahi((bundle.baseline_probs >= self.lgbm_threshold).astype(int), sqi_pass=mask), 2
            )
            if bundle.labels is not None:
                baseline_acc = round(
                    float(
                        np.mean(
                            (bundle.baseline_probs[mask] >= self.lgbm_threshold).astype(int) == bundle.labels[mask]
                        )
                    ),
                    4,
                )

        # Pick the most clinically illustrative usable minute as initial Signal Inspector target
        usable_idxs = np.where(sqi)[0]
        if len(usable_idxs) > 0:
            high_apnea = usable_idxs[bundle.p_mean[usable_idxs] >= thr]
            if len(high_apnea) > 0:
                best_min = int(high_apnea[np.argmax(bundle.p_mean[high_apnea])])
            else:
                best_min = int(usable_idxs[len(usable_idxs) // 2])
        else:
            best_min = min(n_min // 2, max(n_min - 1, 0))

        timeline = []
        for m in range(n_min):
            p = float(bundle.p_mean[m])
            timeline.append(
                {
                    "minute": m,
                    "time_label": _format_hhmm(m),
                    "prob": round(p, 4),
                    "prob_std": round(float(bundle.p_std[m]), 4),
                    "pred": int(p >= thr) if bool(sqi[m]) else -1,
                    "sqi_score": round(float(bundle.dsp.sqi_score[m]), 3),
                    "sqi_pass": bool(sqi[m]),
                    "baseline_prob": round(float(bundle.baseline_probs[m]), 4)
                    if (compare_baseline and bundle.baseline_probs is not None)
                    else None,
                    "ground_truth": int(bundle.labels[m]) if bundle.labels is not None else None,
                }
            )

        return {
            "case_id": case_id,
            "duration_minutes": n_min,
            "duration_hours": round(n_min / 60.0, 2),
            "eahi_pred": eahi_pred,
            "eahi_ci90_low": float(agg["eahi_ci90_low"]),
            "eahi_ci90_high": float(agg["eahi_ci90_high"]),
            "severity_tier": tier,
            "triage_action": triage_action,
            "usable_ratio": round(bundle.dsp.usable_ratio, 4),
            "usable_minutes": int(agg["usable_minutes"]),
            "deferred_minutes": int(agg["deferred_minutes"]),
            "rhythm_irregular": bundle.dsp.rhythm_irregular,
            "rhythm_rmssd_ratio": round(bundle.dsp.rhythm_rmssd_ratio, 4),
            "threshold_used": round(thr, 3),
            "temperature_used": round(self.temperature, 4),
            "noise_snr_db": inject_noise_snr_db,
            "inference_ms": round(bundle.inference_ms, 1),
            "true_eahi": true_eahi,
            "minute_acc": minute_acc,
            "baseline_eahi": baseline_eahi,
            "baseline_minute_acc": baseline_acc,
            "default_inspect_minute": best_min,
            "timeline": timeline,
        }

    def inspect_window(
        self,
        case_id: str,
        minute_index: int,
        inject_noise_snr_db: float | None = None,
    ) -> dict[str, Any]:
        bundle = self._get_or_compute_bundle(case_id, inject_noise_snr_db=inject_noise_snr_db)
        n_min = len(bundle.p_mean)
        m = int(np.clip(minute_index, 0, n_min - 1))

        # 5-minute dual-stream window (1200 pts @ 4 Hz -> downsample 2x to 600 pts @ 2 Hz for silky 60fps chart)
        win_dual = bundle.dual_windows[m]  # (2, 1200)
        if self.gradcam_model is not None:
            x_t = torch.from_numpy(win_dual).unsqueeze(0)
            with self._gradcam_lock:
                saliency_1200 = compute_gradcam_1d(self.gradcam_model, x_t)
        else:
            saliency_1200 = np.zeros(1200, dtype=np.float32)

        # Compute physical BPM from RRI_raw around the 5-minute window
        pts_per_min_4hz = 240
        pad_4hz = 2 * pts_per_min_4hz
        req_4hz = n_min * pts_per_min_4hz
        rri_raw = bundle.dsp.rri_raw_4hz
        if len(rri_raw) < req_4hz:
            rri_raw = np.pad(rri_raw, (0, req_4hz - len(rri_raw)), mode="edge")
        rri_pad = np.pad(rri_raw[:req_4hz], (pad_4hz, pad_4hz), mode="reflect")
        rri_win_ms = rri_pad[m * pts_per_min_4hz : m * pts_per_min_4hz + 1200]
        hr_bpm_1200 = 60000.0 / np.clip(rri_win_ms, 300.0, 2000.0)

        step_4hz = 2  # 600 points across 300 seconds (0.5s resolution)
        edr_t = [round(i * 0.25, 2) for i in range(0, 1200, step_4hz)]
        edr_z = [round(float(v), 3) for v in win_dual[0, ::step_4hz]]
        rri_bpm = [round(float(v), 2) for v in hr_bpm_1200[::step_4hz]]
        saliency = [round(float(v), 3) for v in saliency_1200[::step_4hz]]

        ecg_start = max(0, m * 6000 + 1500)
        ecg_end = min(len(bundle.dsp.ecg_clean), ecg_start + 3000)
        ecg_seg = bundle.dsp.ecg_clean[ecg_start:ecg_end]
        n_bins = len(ecg_seg) // 5
        if n_bins > 0:
            blocks = ecg_seg[: n_bins * 5].reshape(n_bins, 5)
            idx_max = np.argmax(np.abs(blocks), axis=1)
            ecg_vis = blocks[np.arange(n_bins), idx_max]
        else:
            ecg_vis = ecg_seg
        ecg_t = [round(135.0 + i * 0.05, 2) for i in range(len(ecg_vis))]
        ecg_mv = [round(float(v), 3) for v in ecg_vis]

        lo_min = max(0, m - 2)
        hi_min = min(n_min, m + 3)
        return {
            "case_id": case_id,
            "minute_index": m,
            "time_window_label": f"{_format_hhmm(lo_min)} – {_format_hhmm(hi_min)} (Center: {_format_hhmm(m)})",
            "apnea_prob": round(float(bundle.p_mean[m]), 4),
            "sqi_score": round(float(bundle.dsp.sqi_score[m]), 3),
            "sqi_pass": bool(bundle.dsp.sqi_pass[m]),
            "ecg_time_sec": ecg_t,
            "ecg_mv": ecg_mv,
            "edr_time_sec": edr_t,
            "edr_z": edr_z,
            "rri_bpm": rri_bpm,
            "gradcam_saliency": saliency,
        }

    def register_uploaded_csv(self, csv_bytes: bytes, filename: str) -> str:
        ecg, fs = load_uploaded_csv_ecg(csv_bytes)
        if not (25.0 <= fs <= 2000.0):
            raise ValueError(f"Unsupported sampling rate: {fs} Hz (expected 25–2000 Hz).")
        if len(ecg) < round(60 * fs):
            raise ValueError("Uploaded ECG must contain at least 60 seconds (1 minute) of samples.")
        if not np.all(np.isfinite(ecg)):
            raise ValueError("Uploaded ECG column contains no numeric samples or infinite values.")
        case_id = f"upload_{uuid.uuid4().hex[:8]}"
        with self._lock:
            self._uploads[case_id] = (ecg, fs)
            # shortcut: only the last 6 uploads stay in RAM (older ones 404 on re-analysis),
            # persist them to disk once real users upload
            if len(self._uploads) > 6:
                self._uploads.popitem(last=False)
        return case_id

    def get_evaluation_report(self) -> dict[str, Any]:
        test_path = self.reports_dir / "metrics_summary_test.json"
        val_path = self.reports_dir / "metrics_summary_val.json"
        belt_path = self.reports_dir / "edr_belt_validation.json"
        fig_dir = self.reports_dir / "figures"

        figures = sorted(p.name for p in fig_dir.glob("*.png")) if fig_dir.exists() else []
        return {
            "test": json.loads(test_path.read_text(encoding="utf-8")) if test_path.exists() else None,
            "val": json.loads(val_path.read_text(encoding="utf-8")) if val_path.exists() else None,
            "edr_belt_validation": json.loads(belt_path.read_text(encoding="utf-8")) if belt_path.exists() else None,
            "figures": [f"/api/figures/{name}" for name in figures],
        }
