"""Self-contained biomedical DSP utilities for the standalone `cardiobreath` package."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy import interpolate, signal


@dataclass
class DSPOutput:
    ecg_clean: np.ndarray
    rpeaks: np.ndarray
    edr_4hz: np.ndarray
    rri_4hz: np.ndarray
    sqi_score: np.ndarray
    sqi_pass: np.ndarray
    rhythm_irregular: bool
    rhythm_rmssd_ratio: float
    usable_ratio: float


def load_csv_ecg(csv_bytes_or_path: bytes | str | Path, default_fs: float = 100.0) -> tuple[np.ndarray, float]:
    """Load a single-lead ECG CSV (`ecg` column, `time,ecg`, or last numeric column)."""
    if isinstance(csv_bytes_or_path, (bytes, bytearray)):
        df = pd.read_csv(BytesIO(csv_bytes_or_path))
    else:
        df = pd.read_csv(csv_bytes_or_path)

    cols_lower = {c.strip().lower(): c for c in df.columns}
    fs = float(default_fs)

    if "time" in cols_lower and len(df) > 2:
        t = pd.to_numeric(df[cols_lower["time"]], errors="coerce").dropna().to_numpy()
        if len(t) > 2:
            dt = float(np.median(np.diff(t)))
            if dt > 0:
                fs = round(1.0 / dt, 2)

    ecg_col = None
    for candidate in ("ecg", "voltage", "signal", "lead1", "mlii", "value"):
        if candidate in cols_lower:
            ecg_col = cols_lower[candidate]
            break
    if ecg_col is None:
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        if not numeric_cols:
            raise ValueError("Uploaded CSV contains no numeric ECG column.")
        ecg_col = numeric_cols[-1]

    ecg = (
        pd.to_numeric(df[ecg_col], errors="coerce")
        .interpolate(limit_direction="both")
        .to_numpy(dtype=np.float32)
    )
    return ecg, fs


def bandpass_ecg(
    ecg: np.ndarray,
    fs: float = 100.0,
    low_hz: float = 0.5,
    high_hz: float = 40.0,
    order: int = 4,
) -> np.ndarray:
    x = np.asarray(ecg, dtype=np.float64)
    nyq = 0.5 * fs
    low = max(low_hz / nyq, 1e-4)
    high = min(high_hz / nyq, 0.99)
    sos = signal.butter(order, [low, high], btype="bandpass", output="sos")
    return signal.sosfiltfilt(sos, x).astype(np.float32)


def _pan_tompkins_rpeaks(ecg_clean: np.ndarray, fs: float = 100.0) -> np.ndarray:
    x = np.asarray(ecg_clean, dtype=np.float64)
    nyq = 0.5 * fs
    sos = signal.butter(3, [5.0 / nyq, min(18.0 / nyq, 0.95)], btype="bandpass", output="sos")
    qrs = signal.sosfiltfilt(sos, x)
    diff_sq = np.diff(qrs, prepend=qrs[0]) ** 2
    win = max(round(0.15 * fs), 3)
    mwi = np.convolve(diff_sq, np.ones(win) / win, mode="same")

    min_dist = max(round(0.32 * fs), 1)
    prom = max(float(np.percentile(mwi, 85)) * 0.25, 1e-6)
    coarse_peaks, _ = signal.find_peaks(mwi, distance=min_dist, prominence=prom)

    half_ref = max(round(0.08 * fs), 2)
    refined: list[int] = []
    n = len(x)
    polarity = 1.0 if abs(np.percentile(x, 99.5)) >= abs(np.percentile(x, 0.5)) else -1.0
    directed = x * polarity
    for p in coarse_peaks:
        lo = max(0, int(p) - half_ref)
        hi = min(n, int(p) + half_ref + 1)
        idx = lo + int(np.argmax(directed[lo:hi]))
        if not refined or (idx - refined[-1]) >= min_dist:
            refined.append(idx)
    return np.asarray(refined, dtype=np.int64)


def clean_rr_intervals(
    rpeaks: np.ndarray,
    fs: float = 100.0,
    rr_min_sec: float = 0.30,
    rr_max_sec: float = 2.00,
    rel_tol: float = 0.25,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if len(rpeaks) < 3:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64), np.array([], dtype=bool)

    times = rpeaks.astype(np.float64) / fs
    rr_sec = np.diff(times)
    rr_times = 0.5 * (times[:-1] + times[1:])
    valid = (rr_sec >= rr_min_sec) & (rr_sec <= rr_max_sec)

    if valid.sum() >= 5:
        rr_filled = rr_sec.copy()
        rr_filled[~valid] = float(np.median(rr_sec[valid]))
        k = min(11, len(rr_filled) if len(rr_filled) % 2 == 1 else len(rr_filled) - 1)
        if k >= 3:
            local_med = signal.medfilt(rr_filled, kernel_size=k)
            valid &= np.abs(rr_sec - local_med) <= (rel_tol * np.maximum(local_med, 0.3))

    rr_ms = rr_sec * 1000.0
    if valid.sum() >= 2:
        rr_ms_clean = np.interp(rr_times, rr_times[valid], rr_ms[valid])
    elif len(rr_ms) > 0:
        rr_ms_clean = np.clip(rr_ms, rr_min_sec * 1000.0, rr_max_sec * 1000.0)
    else:
        rr_ms_clean = np.array([], dtype=np.float64)

    return rr_ms_clean, rr_times, valid


def robust_zscore(x: np.ndarray, clip: float = 5.0) -> np.ndarray:
    arr = np.asarray(x, dtype=np.float64)
    med = float(np.median(arr))
    scale = 1.4826 * float(np.median(np.abs(arr - med)))
    if scale < 1e-6:
        scale = float(np.std(arr))
    if scale < 1e-6:
        return np.zeros_like(arr, dtype=np.float32)
    return np.clip((arr - med) / scale, -clip, clip).astype(np.float32)


def run_dsp(ecg_raw: np.ndarray, fs: float = 100.0, dsp_cfg: dict[str, Any] | None = None) -> DSPOutput:
    """Run full bandpass + R-peak + 4 Hz EDR/RRI + SQI gate pipeline."""
    cfg = dsp_cfg or {}
    x_raw = np.asarray(ecg_raw, dtype=np.float32).reshape(-1)
    if fs != 100.0:
        n_target = round(len(x_raw) * 100.0 / fs)
        x_raw = signal.resample(x_raw, n_target).astype(np.float32)
        fs = 100.0

    n_minutes = max(1, len(x_raw) // round(60.0 * fs))
    ecg_clean = bandpass_ecg(
        x_raw,
        fs=fs,
        low_hz=float(cfg.get("bandpass_low_hz", 0.5)),
        high_hz=float(cfg.get("bandpass_high_hz", 40.0)),
        order=int(cfg.get("bandpass_order", 4)),
    )
    rpeaks = _pan_tompkins_rpeaks(ecg_clean, fs=fs)

    target_fs = float(cfg.get("sampling_rate_dsp", 4.0))
    n_out = round((len(ecg_clean) / fs) * target_fs)
    t_grid = np.arange(n_out, dtype=np.float64) / target_fs

    rr_min = float(cfg.get("rr_min_sec", 0.30))
    rr_max = float(cfg.get("rr_max_sec", 2.00))
    rr_tol = float(cfg.get("rr_outlier_rel_tol", 0.25))
    z_clip = float(cfg.get("zscore_clip", 5.0))

    rr_ms_clean, rr_times, valid_rr = clean_rr_intervals(
        rpeaks, fs=fs, rr_min_sec=rr_min, rr_max_sec=rr_max, rel_tol=rr_tol
    )
    if len(rr_times) < 4:
        edr_norm = np.zeros(n_out, dtype=np.float32)
        rri_norm = np.zeros(n_out, dtype=np.float32)
    else:
        rr_cs = interpolate.CubicSpline(rr_times, rr_ms_clean, bc_type="natural", extrapolate=False)
        rri_raw = rr_cs(t_grid)
        if np.isnan(rri_raw).any():
            rri_raw = np.interp(t_grid, rr_times, rr_ms_clean)
        rri_raw = np.clip(rri_raw, rr_min * 1000.0, rr_max * 1000.0)

        x64 = ecg_clean.astype(np.float64)
        beat_times = rpeaks.astype(np.float64) / fs
        pre_lo = round(0.12 * fs)
        pre_hi = round(0.05 * fs)
        r_amps = np.empty(len(rpeaks), dtype=np.float64)
        for i, p in enumerate(rpeaks):
            pi = int(p)
            b_lo = max(0, pi - pre_lo)
            b_hi = max(b_lo + 1, pi - pre_hi)
            baseline = float(np.median(x64[b_lo:b_hi])) if b_hi > b_lo else 0.0
            r_amps[i] = float(x64[pi]) - baseline

        med_amp = float(np.median(r_amps))
        mad_amp = max(1.4826 * float(np.median(np.abs(r_amps - med_amp))), 1e-4)
        good_amp = np.abs(r_amps - med_amp) <= 4.0 * mad_amp
        r_amps_clean = np.interp(beat_times, beat_times[good_amp], r_amps[good_amp]) if good_amp.sum() >= 4 else r_amps

        edr_cs = interpolate.CubicSpline(beat_times, r_amps_clean, bc_type="natural", extrapolate=False)
        edr_raw = edr_cs(t_grid)
        if np.isnan(edr_raw).any():
            edr_raw = np.interp(t_grid, beat_times, r_amps_clean)

        nyq_t = 0.5 * target_fs
        edr_lo = float(cfg.get("edr_low_hz", 0.08))
        edr_hi = float(cfg.get("edr_high_hz", 0.60))
        sos_edr = signal.butter(
            3, [max(edr_lo / nyq_t, 1e-3), min(edr_hi / nyq_t, 0.95)], btype="bandpass", output="sos"
        )
        if len(edr_raw) > 24:
            edr_raw = signal.sosfiltfilt(sos_edr, edr_raw)

        edr_norm = robust_zscore(edr_raw, clip=z_clip)
        rri_norm = robust_zscore(rri_raw, clip=z_clip)

    # Compute per-minute SQI & rhythm confounder flag
    samples_per_min = round(60.0 * fs)
    sqi_score = np.zeros(n_minutes, dtype=np.float32)
    half_qrs = round(0.15 * fs)
    beats = []
    for p in rpeaks[:: max(1, len(rpeaks) // 300)]:
        pi = int(p)
        if pi >= half_qrs and pi + half_qrs < len(ecg_clean):
            seg = ecg_clean[pi - half_qrs : pi + half_qrs]
            std = float(np.std(seg))
            if std > 1e-4:
                beats.append((seg - np.mean(seg)) / std)
    template = np.median(beats, axis=0) if len(beats) >= 5 else None
    if template is not None:
        template = template / max(float(np.linalg.norm(template)), 1e-6)

    min_hr = float(cfg.get("sqi_min_hr_bpm", 30.0))
    max_hr = float(cfg.get("sqi_max_hr_bpm", 180.0))
    min_valid_ratio = float(cfg.get("sqi_min_valid_ratio", 0.75))
    min_std_mv = float(cfg.get("sqi_min_std_mv", 0.02))
    max_abs_mv = float(cfg.get("sqi_max_abs_mv", 8.0))
    pass_thr = float(cfg.get("sqi_pass_threshold", 0.65))

    for m in range(n_minutes):
        lo = m * samples_per_min
        hi = min(len(x_raw), (m + 1) * samples_per_min)
        if hi - lo < int(0.8 * samples_per_min):
            continue
        seg_raw = x_raw[lo:hi]
        seg_clean = ecg_clean[lo:hi]
        if not np.isfinite(seg_raw).all() or float(np.std(seg_clean)) < min_std_mv:
            continue
        extreme_frac = float(np.mean(np.abs(seg_raw - np.median(seg_raw)) > max_abs_mv))
        if extreme_frac > 0.05:
            sqi_score[m] = 0.05
            continue

        freqs, psd = signal.welch(seg_raw - np.mean(seg_raw), fs=fs, nperseg=min(512, len(seg_raw)))
        qrs_band = float(np.trapezoid(psd[(freqs >= 5.0) & (freqs <= 30.0)]))
        hf_band = float(np.trapezoid(psd[(freqs >= 32.0) & (freqs <= 48.0)]))
        snr_subscore = float(np.clip(((qrs_band / max(hf_band, 1e-9)) - 1.2) / 3.0, 0.0, 1.0))

        m_peaks = rpeaks[(rpeaks >= lo) & (rpeaks < hi)]
        n_beats = len(m_peaks)
        hr_ok = 1.0 if (min_hr <= n_beats <= max_hr) else 0.0
        if n_beats >= 5:
            rr_m = np.diff(m_peaks) / fs
            med_rr = float(np.median(rr_m))
            v_ratio = float(
                np.mean((rr_m >= 0.30) & (rr_m <= 2.00) & (np.abs(rr_m - med_rr) <= 0.35 * max(med_rr, 0.3)))
            )
            rr_subscore = float(np.clip(v_ratio / min_valid_ratio, 0.0, 1.0))
        else:
            rr_subscore = 0.0

        corr_subscore = 1.0
        if template is not None and n_beats >= 5:
            corrs = []
            for p in m_peaks[:: max(1, n_beats // 15)]:
                pi = int(p)
                if pi >= half_qrs and pi + half_qrs < len(ecg_clean):
                    b = ecg_clean[pi - half_qrs : pi + half_qrs]
                    b = b - np.mean(b)
                    bn = float(np.linalg.norm(b))
                    if bn > 1e-6:
                        corrs.append(float(np.dot(b / bn, template)))
            if corrs:
                corr_subscore = float(np.clip((float(np.median(corrs)) - 0.40) / 0.45, 0.0, 1.0))

        base = 0.25 * hr_ok + 0.25 * rr_subscore + 0.25 * snr_subscore + 0.25 * corr_subscore
        gate = min(1.0, 0.25 + 0.75 * snr_subscore) * min(1.0, 0.25 + 0.75 * corr_subscore)
        score = base * gate * (0.5 if extreme_frac > 0.01 else 1.0)
        sqi_score[m] = float(np.clip(score, 0.0, 1.0))

    sqi_pass = sqi_score >= pass_thr
    if valid_rr.sum() >= 30:
        rr_valid = rr_ms_clean[valid_rr]
        rmssd_ratio = float(np.sqrt(np.mean(np.diff(rr_valid) ** 2))) / max(float(np.mean(rr_valid)), 300.0)
    else:
        rmssd_ratio = 0.0
    rhythm_irregular = bool(rmssd_ratio > float(cfg.get("afib_rmssd_ratio_threshold", 0.22)))

    return DSPOutput(
        ecg_clean=ecg_clean,
        rpeaks=rpeaks,
        edr_4hz=edr_norm,
        rri_4hz=rri_norm,
        sqi_score=sqi_score,
        sqi_pass=sqi_pass,
        rhythm_irregular=rhythm_irregular,
        rhythm_rmssd_ratio=float(rmssd_ratio),
        usable_ratio=float(np.mean(sqi_pass)) if len(sqi_pass) else 0.0,
    )


def slice_dual_windows(
    edr_4hz: np.ndarray,
    rri_4hz: np.ndarray,
    n_minutes: int,
    context_minutes: int = 5,
    target_fs: float = 4.0,
) -> np.ndarray:
    """Slice centered 5-minute dual-stream `(N_minutes, 2, 1200)` windows."""
    pts_per_min = round(60.0 * target_fs)
    win_len = context_minutes * pts_per_min
    pad_len = (context_minutes // 2) * pts_per_min
    req_len = n_minutes * pts_per_min

    if len(edr_4hz) < req_len:
        edr_4hz = np.pad(edr_4hz, (0, req_len - len(edr_4hz)), mode="edge")
        rri_4hz = np.pad(rri_4hz, (0, req_len - len(rri_4hz)), mode="edge")

    edr_pad = np.pad(edr_4hz[:req_len], (pad_len, pad_len), mode="reflect")
    rri_pad = np.pad(rri_4hz[:req_len], (pad_len, pad_len), mode="reflect")

    dual = np.empty((n_minutes, 2, win_len), dtype=np.float32)
    for m in range(n_minutes):
        s = m * pts_per_min
        dual[m, 0] = edr_pad[s : s + win_len]
        dual[m, 1] = rri_pad[s : s + win_len]
    return dual
