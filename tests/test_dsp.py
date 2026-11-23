"""Unit tests for CardioBreath biomedical DSP front-end (bandpass, EDR, RRI, SQI, slicing)."""

from __future__ import annotations

import numpy as np
from scipy import signal

from src.dsp import (
    HRV_FEATURE_NAMES,
    bandpass_ecg,
    extract_hrv_features_per_minute,
    inject_motion_artifact,
    run_dsp_pipeline,
    slice_windows,
)


def _synthesize_breathing_modulated_ecg(
    duration_sec: int = 360,
    fs: float = 100.0,
    hr_bpm: float = 66.0,
    resp_hz: float = 0.25,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate a synthetic ECG whose R-peak amplitude is modulated by a known sine breathing wave."""
    n = int(duration_sec * fs)
    t = np.arange(n, dtype=np.float64) / fs
    true_resp = np.sin(2.0 * np.pi * resp_hz * t)

    ecg = np.zeros(n, dtype=np.float64)
    # Place Gaussian-like QRS complexes modulated by breathing amplitude + mild RSA
    curr_t = 0.5
    rng = np.random.default_rng(42)
    while curr_t < duration_sec - 0.5:
        idx = round(curr_t * fs)
        amp = 1.2 * (1.0 + 0.30 * np.sin(2.0 * np.pi * resp_hz * curr_t))
        lo = max(0, idx - 12)
        hi = min(n, idx + 13)
        dt = (np.arange(lo, hi) - idx) / fs
        # Sharp R-wave + subtle Q and S troughs
        qrs = amp * np.exp(-0.5 * (dt / 0.014) ** 2) - 0.22 * amp * np.exp(-0.5 * ((dt - 0.03) / 0.015) ** 2)
        ecg[lo:hi] += qrs
        # Mild respiratory sinus arrhythmia (~5% RR variation)
        rr = (60.0 / hr_bpm) * (1.0 - 0.05 * np.sin(2.0 * np.pi * resp_hz * curr_t))
        curr_t += rr

    # Add realistic slow baseline drift (0.05 Hz) + light sensor noise
    ecg += 0.25 * np.sin(2.0 * np.pi * 0.05 * t) + 0.015 * rng.standard_normal(n)
    return ecg.astype(np.float32), true_resp.astype(np.float32)


def test_bandpass_suppresses_baseline_drift_and_preserves_qrs() -> None:
    fs = 100.0
    t = np.arange(int(60 * fs)) / fs
    drift = 2.0 * np.sin(2 * np.pi * 0.05 * t)
    qrs_tone = 1.0 * np.sin(2 * np.pi * 10.0 * t)
    high_noise = 1.5 * np.sin(2 * np.pi * 47.0 * t)

    filtered = bandpass_ecg(drift + qrs_tone + high_noise, fs=fs, low_hz=0.5, high_hz=40.0)
    # Trim filter edge transients (3s)
    core = filtered[300:-300]
    freqs, psd = signal.welch(core, fs=fs, nperseg=512)
    p_drift = psd[freqs < 0.25].max()
    p_qrs = psd[(freqs >= 8.0) & (freqs <= 12.0)].max()
    p_high = psd[freqs > 44.0].max()

    assert p_qrs > 20.0 * p_drift
    assert p_qrs > 20.0 * p_high


def test_edr_recovers_synthetic_breathing_waveform() -> None:
    ecg, true_resp_100hz = _synthesize_breathing_modulated_ecg(duration_sec=360, fs=100.0, resp_hz=0.25)
    res = run_dsp_pipeline(ecg, fs=100.0, n_minutes=6, prefer_neurokit=False)

    # Downsample ground-truth breathing wave to 4 Hz and compare inside stable middle 4 minutes
    true_resp_4hz = signal.resample(true_resp_100hz, len(res.edr_4hz))
    e_mid = res.edr_4hz[240:-240]
    r_mid = true_resp_4hz[240:-240]
    corr = float(abs(np.corrcoef(e_mid, r_mid)[0, 1]))

    assert corr > 0.85, f"Expected synthetic EDR correlation > 0.85, got {corr:.3f}"
    assert res.usable_ratio >= 0.80
    assert not res.rhythm_irregular


def test_sqi_rejects_flatline_and_severe_motion_noise() -> None:
    ecg_clean, _ = _synthesize_breathing_modulated_ecg(duration_sec=360, fs=100.0)
    # Corrupt minute 2 with flatline and minute 4 with extreme 0 dB EMG/motion burst
    corrupted = ecg_clean.copy()
    corrupted[2 * 6000 : 3 * 6000] = 0.0
    corrupted[4 * 6000 : 5 * 6000] = inject_motion_artifact(
        corrupted[4 * 6000 : 5 * 6000], snr_db=-4.0, fs=100.0, seed=7
    )

    res = run_dsp_pipeline(corrupted, fs=100.0, n_minutes=6, prefer_neurokit=False)
    assert bool(res.sqi_pass[0]) is True
    assert bool(res.sqi_pass[1]) is True
    assert bool(res.sqi_pass[2]) is False, "Flatline minute must be rejected by SQI gate"
    assert bool(res.sqi_pass[4]) is False, "Severe motion-artifact minute must be rejected by SQI gate"


def test_window_slicing_and_hrv_feature_shapes() -> None:
    ecg, _ = _synthesize_breathing_modulated_ecg(duration_sec=360, fs=100.0)
    res = run_dsp_pipeline(ecg, fs=100.0, n_minutes=6, prefer_neurokit=False)

    dual, raw_1min = slice_windows(res.edr_4hz, res.rri_4hz, res.ecg_clean, n_minutes=6, context_minutes=5)
    feats = extract_hrv_features_per_minute(res.rri_raw_4hz, res.edr_raw_4hz, res.sqi_score, n_minutes=6)

    assert dual.shape == (6, 2, 1200)
    assert raw_1min.shape == (6, 1, 6000)
    assert feats.shape == (6, len(HRV_FEATURE_NAMES))
    assert np.isfinite(dual).all()
    assert np.isfinite(feats).all()
