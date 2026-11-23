"""Biomedical DSP front-end for CardioBreath.

Extracts:
  1. Zero-phase bandpass-filtered ECG (0.5–40 Hz)
  2. Cleaned R-peaks + ectopic/artifact RR rejection
  3. Uniform 4 Hz ECG-Derived Respiration (EDR) & RR-Interval (RRI) streams
  4. Per-minute Signal Quality Index (SQI) abstention mask & non-sinus rhythm flag
  5. 22 clinical HRV + EDR + cardiopulmonary coupling features (Baseline 1)
  6. Synthetic motion-artifact + baseline-wander injector for SNR stress testing
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import interpolate, signal

HRV_FEATURE_NAMES: list[str] = [
    "rri_mean_ms",
    "rri_std_ms",
    "rri_rmssd_ms",
    "rri_pnn50",
    "rri_iqr_ms",
    "rri_min_ms",
    "rri_max_ms",
    "rri_vlf_power",
    "rri_lf_power",
    "rri_hf_power",
    "rri_lf_hf_ratio",
    "rri_total_power",
    "edr_std",
    "edr_iqr",
    "edr_resp_power",
    "edr_low_power",
    "edr_peak_freq_hz",
    "edr_flatness_ratio",
    "cpc_max_coherence",
    "cpc_mean_coherence_vlf",
    "cpc_mean_coherence_resp",
    "minute_sqi_score",
]


@dataclass
class DSPResult:
    ecg_clean: np.ndarray
    rpeaks: np.ndarray
    edr_4hz: np.ndarray
    rri_4hz: np.ndarray
    edr_raw_4hz: np.ndarray
    rri_raw_4hz: np.ndarray
    sqi_score: np.ndarray
    sqi_pass: np.ndarray
    rhythm_irregular: bool
    rhythm_rmssd_ratio: float
    usable_ratio: float


def bandpass_ecg(
    ecg: np.ndarray,
    fs: float = 100.0,
    low_hz: float = 0.5,
    high_hz: float = 40.0,
    order: int = 4,
) -> np.ndarray:
    """Zero-phase Butterworth bandpass filter preserving QRS & respiratory amplitude modulation."""
    ecg = np.asarray(ecg, dtype=np.float64)
    nyq = 0.5 * fs
    low = max(low_hz / nyq, 1e-4)
    high = min(high_hz / nyq, 0.99)
    sos = signal.butter(order, [low, high], btype="bandpass", output="sos")
    filtered = signal.sosfiltfilt(sos, ecg)
    return filtered.astype(np.float32)


def _pan_tompkins_fallback(ecg_clean: np.ndarray, fs: float = 100.0) -> np.ndarray:
    """Lightweight deterministic Pan-Tompkins R-peak detector fallback."""
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

    # Refine each peak to the local maximum of |ecg_clean| within +-80 ms
    half_ref = max(round(0.08 * fs), 2)
    refined: list[int] = []
    n = len(x)
    # Determine dominant R-peak polarity from global extremes
    polarity = 1.0 if abs(np.percentile(x, 99.5)) >= abs(np.percentile(x, 0.5)) else -1.0
    directed = x * polarity
    for p in coarse_peaks:
        lo = max(0, p - half_ref)
        hi = min(n, p + half_ref + 1)
        idx = lo + int(np.argmax(directed[lo:hi]))
        if not refined or (idx - refined[-1]) >= min_dist:
            refined.append(idx)
    return np.asarray(refined, dtype=np.int64)


def detect_rpeaks_and_clean(
    ecg_clean: np.ndarray,
    fs: float = 100.0,
    prefer_neurokit: bool = True,
) -> np.ndarray:
    """Detect R-peaks using NeuroKit2 (when available) with deterministic Pan-Tompkins fallback."""
    rpeaks: np.ndarray | None = None
    if prefer_neurokit:
        try:
            import neurokit2 as nk

            _, info = nk.ecg_peaks(ecg_clean, sampling_rate=round(fs), method="neurokit")
            pts = np.asarray(info.get("ECG_R_Peaks", []), dtype=np.int64)
            pts = pts[(pts >= 0) & (pts < len(ecg_clean))]
            if len(pts) >= 5:
                rpeaks = np.unique(pts)
        except (ImportError, ValueError, RuntimeError, IndexError, KeyError):
            rpeaks = None

    if rpeaks is None or len(rpeaks) < 5:
        rpeaks = _pan_tompkins_fallback(ecg_clean, fs=fs)

    # Refine peak locations onto exact local extremum (+/- 40 ms) so R-peak amplitude EDR is sharp
    if len(rpeaks) >= 3:
        x = np.asarray(ecg_clean, dtype=np.float64)
        polarity = 1.0 if np.median(x[rpeaks]) >= 0 else -1.0
        directed = x * polarity
        half = max(round(0.04 * fs), 1)
        n = len(x)
        snapped = np.empty_like(rpeaks)
        for i, p in enumerate(rpeaks):
            lo = max(0, int(p) - half)
            hi = min(n, int(p) + half + 1)
            snapped[i] = lo + int(np.argmax(directed[lo:hi]))
        rpeaks = np.unique(snapped)

    return rpeaks


def clean_rr_intervals(
    rpeaks: np.ndarray,
    fs: float = 100.0,
    rr_min_sec: float = 0.30,
    rr_max_sec: float = 2.00,
    rel_tol: float = 0.25,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute cleaned beat-to-beat RR intervals (ms), beat mid-times (sec), and valid beat mask."""
    if len(rpeaks) < 3:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64), np.array([], dtype=bool)

    times = rpeaks.astype(np.float64) / fs
    rr_sec = np.diff(times)
    rr_times = 0.5 * (times[:-1] + times[1:])

    # Physiological range mask
    valid = (rr_sec >= rr_min_sec) & (rr_sec <= rr_max_sec)

    # Local median ectopic/artifact rejection
    if valid.sum() >= 5:
        rr_filled = rr_sec.copy()
        med_global = float(np.median(rr_sec[valid]))
        rr_filled[~valid] = med_global
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
    """Per-recording robust z-score using median and MAD to prevent cross-patient amplitude shift."""
    x = np.asarray(x, dtype=np.float64)
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med)))
    scale = 1.4826 * mad
    if scale < 1e-6:
        scale = float(np.std(x))
    if scale < 1e-6:
        return np.zeros_like(x, dtype=np.float32)
    z = (x - med) / scale
    return np.clip(z, -clip, clip).astype(np.float32)


def extract_edr_rri_4hz(
    ecg_clean: np.ndarray,
    rpeaks: np.ndarray,
    total_samples: int,
    fs: float = 100.0,
    target_fs: float = 4.0,
    edr_low_hz: float = 0.08,
    edr_high_hz: float = 0.60,
    rr_min_sec: float = 0.30,
    rr_max_sec: float = 2.00,
    rr_outlier_rel_tol: float = 0.25,
    zscore_clip: float = 5.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Extract aligned 4 Hz EDR and RRI streams (both normalized and physical-unit versions)."""
    duration_sec = total_samples / fs
    n_out = round(duration_sec * target_fs)
    t_grid = np.arange(n_out, dtype=np.float64) / target_fs

    rr_ms_clean, rr_times, _valid_rr = clean_rr_intervals(
        rpeaks,
        fs=fs,
        rr_min_sec=rr_min_sec,
        rr_max_sec=rr_max_sec,
        rel_tol=rr_outlier_rel_tol,
    )

    if len(rr_times) < 4:
        zeros = np.zeros(n_out, dtype=np.float32)
        return zeros, zeros, zeros, zeros

    # 1. RRI 4 Hz cubic spline (clamped at boundaries so edge extrapolation never explodes)
    rr_cs = interpolate.CubicSpline(rr_times, rr_ms_clean, bc_type="natural", extrapolate=False)
    rri_raw = rr_cs(t_grid)
    nan_mask = np.isnan(rri_raw)
    if nan_mask.any():
        rri_raw = np.interp(t_grid, rr_times, rr_ms_clean)
    rri_raw = np.clip(rri_raw, rr_min_sec * 1000.0, rr_max_sec * 1000.0)

    # 2. EDR via R-peak amplitude relative to local QRS baseline (50-120 ms before R-peak)
    x = np.asarray(ecg_clean, dtype=np.float64)
    beat_times = rpeaks.astype(np.float64) / fs
    pre_lo = round(0.12 * fs)
    pre_hi = round(0.05 * fs)
    r_amps = np.empty(len(rpeaks), dtype=np.float64)
    for i, p in enumerate(rpeaks):
        p_int = int(p)
        b_lo = max(0, p_int - pre_lo)
        b_hi = max(b_lo + 1, p_int - pre_hi)
        baseline = float(np.median(x[b_lo:b_hi])) if b_hi > b_lo else 0.0
        r_amps[i] = float(x[p_int]) - baseline

    # Reject extreme amplitude glitches (motion spikes) before spline interpolation
    med_amp = float(np.median(r_amps))
    mad_amp = max(1.4826 * float(np.median(np.abs(r_amps - med_amp))), 1e-4)
    good_amp = np.abs(r_amps - med_amp) <= 4.0 * mad_amp
    if good_amp.sum() >= 4:
        r_amps_clean = np.interp(beat_times, beat_times[good_amp], r_amps[good_amp])
    else:
        r_amps_clean = r_amps

    edr_cs = interpolate.CubicSpline(beat_times, r_amps_clean, bc_type="natural", extrapolate=False)
    edr_raw = edr_cs(t_grid)
    if np.isnan(edr_raw).any():
        edr_raw = np.interp(t_grid, beat_times, r_amps_clean)

    # Bandpass EDR into physiological respiratory band (0.08–0.60 Hz -> 4.8–36 breaths/min)
    nyq_t = 0.5 * target_fs
    sos_edr = signal.butter(
        3, [max(edr_low_hz / nyq_t, 1e-3), min(edr_high_hz / nyq_t, 0.95)], btype="bandpass", output="sos"
    )
    if len(edr_raw) > 24:
        edr_raw = signal.sosfiltfilt(sos_edr, edr_raw)

    edr_norm = robust_zscore(edr_raw, clip=zscore_clip)
    rri_norm = robust_zscore(rri_raw, clip=zscore_clip)
    return edr_norm, rri_norm, edr_raw.astype(np.float32), rri_raw.astype(np.float32)


def compute_minute_sqi_and_rhythm(
    ecg_raw: np.ndarray,
    ecg_clean: np.ndarray,
    rpeaks: np.ndarray,
    n_minutes: int,
    fs: float = 100.0,
    min_hr_bpm: float = 30.0,
    max_hr_bpm: float = 180.0,
    min_valid_ratio: float = 0.75,
    min_std_mv: float = 0.02,
    max_abs_mv: float = 8.0,
    pass_threshold: float = 0.65,
    afib_rmssd_ratio_threshold: float = 0.22,
) -> tuple[np.ndarray, np.ndarray, bool, float]:
    """Compute per-minute Signal Quality Index (SQI) [0, 1], pass mask, and non-sinus rhythm flag."""
    samples_per_min = round(60.0 * fs)
    sqi_score = np.zeros(n_minutes, dtype=np.float32)

    # Pre-build a clean global QRS template from median beats to detect motion-corrupted epochs
    half_qrs = round(0.15 * fs)
    valid_beats_list = []
    for p in rpeaks[:: max(1, len(rpeaks) // 300)]:
        p_int = int(p)
        if p_int >= half_qrs and p_int + half_qrs < len(ecg_clean):
            seg = ecg_clean[p_int - half_qrs : p_int + half_qrs]
            std = float(np.std(seg))
            if std > 1e-4:
                valid_beats_list.append((seg - np.mean(seg)) / std)
    template = np.median(valid_beats_list, axis=0) if len(valid_beats_list) >= 5 else None
    if template is not None:
        t_norm = float(np.linalg.norm(template))
        template = template / max(t_norm, 1e-6)

    for m in range(n_minutes):
        lo = m * samples_per_min
        hi = min(len(ecg_raw), (m + 1) * samples_per_min)
        if hi - lo < int(0.8 * samples_per_min):
            sqi_score[m] = 0.0
            continue

        seg_raw = ecg_raw[lo:hi]
        seg_clean = ecg_clean[lo:hi]

        # 1. Flatline & NaN/saturation gate
        if not np.isfinite(seg_raw).all():
            sqi_score[m] = 0.0
            continue
        seg_std = float(np.std(seg_clean))
        if seg_std < min_std_mv:
            sqi_score[m] = 0.0
            continue
        extreme_frac = float(np.mean(np.abs(seg_raw - np.median(seg_raw)) > max_abs_mv))
        if extreme_frac > 0.05:
            sqi_score[m] = 0.05
            continue

        # 2. High-frequency EMG noise (32-48 Hz) vs. physiological QRS energy (5-30 Hz)
        # Sharp physiological QRS complexes naturally carry energy up to ~30 Hz, while
        # EMG/motion artifacts inject broadband power above 32 Hz and degrade EDR amplitudes.
        freqs, psd = signal.welch(seg_raw - np.mean(seg_raw), fs=fs, nperseg=min(512, len(seg_raw)))
        qrs_band = float(np.trapezoid(psd[(freqs >= 5.0) & (freqs <= 30.0)]))
        hf_band = float(np.trapezoid(psd[(freqs >= 32.0) & (freqs <= 48.0)]))
        snr_ratio = qrs_band / max(hf_band, 1e-9)
        snr_subscore = float(np.clip((snr_ratio - 1.2) / 3.0, 0.0, 1.0))

        # 3. Physiological HR & RR interval validity inside this minute
        m_peaks = rpeaks[(rpeaks >= lo) & (rpeaks < hi)]
        n_beats = len(m_peaks)
        hr_ok = 1.0 if (min_hr_bpm <= n_beats <= max_hr_bpm) else 0.0
        if n_beats >= 5:
            rr_m = np.diff(m_peaks) / fs
            med_rr = float(np.median(rr_m))
            valid_rr_ratio = float(
                np.mean((rr_m >= 0.30) & (rr_m <= 2.00) & (np.abs(rr_m - med_rr) <= 0.35 * max(med_rr, 0.3)))
            )
            rr_subscore = float(np.clip(valid_rr_ratio / min_valid_ratio, 0.0, 1.0))
        else:
            rr_subscore = 0.0

        # 4. Beat-template correlation check
        corr_subscore = 1.0
        if template is not None and n_beats >= 5:
            corrs = []
            for p in m_peaks[:: max(1, n_beats // 15)]:
                p_int = int(p)
                if p_int >= half_qrs and p_int + half_qrs < len(ecg_clean):
                    b = ecg_clean[p_int - half_qrs : p_int + half_qrs]
                    b = b - np.mean(b)
                    bn = float(np.linalg.norm(b))
                    if bn > 1e-6:
                        corrs.append(float(np.dot(b / bn, template)))
            if corrs:
                med_corr = float(np.median(corrs))
                corr_subscore = float(np.clip((med_corr - 0.40) / 0.45, 0.0, 1.0))

        # Multiplicative gating: severe EMG noise or destroyed beat morphology vetoes clean HR
        base_score = 0.25 * hr_ok + 0.25 * rr_subscore + 0.25 * snr_subscore + 0.25 * corr_subscore
        noise_gate = min(1.0, 0.25 + 0.75 * snr_subscore) * min(1.0, 0.25 + 0.75 * corr_subscore)
        score = base_score * noise_gate
        if extreme_frac > 0.01:
            score *= 0.5
        sqi_score[m] = float(np.clip(score, 0.0, 1.0))

    sqi_pass = sqi_score >= pass_threshold

    # Recording-level non-sinus / AFib irregularity screen over clean beats
    rr_ms, _, valid = clean_rr_intervals(rpeaks, fs=fs)
    if valid.sum() >= 30:
        rr_valid = rr_ms[valid]
        rmssd = float(np.sqrt(np.mean(np.diff(rr_valid) ** 2)))
        mean_rr = max(float(np.mean(rr_valid)), 300.0)
        rmssd_ratio = rmssd / mean_rr
    else:
        rmssd_ratio = 0.0
    rhythm_irregular = bool(rmssd_ratio > afib_rmssd_ratio_threshold)

    return sqi_score, sqi_pass, rhythm_irregular, float(rmssd_ratio)


def inject_motion_artifact(
    ecg: np.ndarray,
    snr_db: float,
    fs: float = 100.0,
    seed: int = 42,
    burst_fraction: float = 1.0,
) -> np.ndarray:
    """Inject realistic baseline wander + EMG motion bursts calibrated to target SNR (dB)."""
    rng = np.random.default_rng(seed)
    x = np.asarray(ecg, dtype=np.float64)
    n = len(x)
    t = np.arange(n, dtype=np.float64) / fs

    # Low-frequency electrode motion wander (0.15 - 0.45 Hz) + high-frequency EMG noise (20 - 45 Hz)
    wander = 0.6 * np.sin(2 * np.pi * 0.22 * t + rng.uniform(0, 2 * np.pi)) + 0.4 * np.sin(
        2 * np.pi * 0.37 * t + rng.uniform(0, 2 * np.pi)
    )
    white = rng.standard_normal(n)
    nyq = 0.5 * fs
    sos_emg = signal.butter(3, [20.0 / nyq, min(46.0 / nyq, 0.96)], btype="bandpass", output="sos")
    emg = signal.sosfiltfilt(sos_emg, white)
    noise = 0.45 * (wander / max(np.std(wander), 1e-6)) + 0.85 * (emg / max(np.std(emg), 1e-6))

    if burst_fraction < 1.0:
        mask = np.zeros(n, dtype=np.float64)
        burst_len = max(round(60 * fs), 100)
        n_bursts = max(1, round((n * burst_fraction) / burst_len))
        starts = rng.integers(0, max(1, n - burst_len), size=n_bursts)
        for s in starts:
            mask[s : s + burst_len] = 1.0
        noise = noise * mask

    sig_power = float(np.mean((x - np.mean(x)) ** 2))
    noise_power = float(np.mean(noise**2))
    if noise_power < 1e-12 or sig_power < 1e-12:
        return x.astype(np.float32)

    target_noise_power = sig_power / (10.0 ** (snr_db / 10.0))
    scaled_noise = noise * np.sqrt(target_noise_power / noise_power)
    return (x + scaled_noise).astype(np.float32)


def slice_windows(
    edr_4hz: np.ndarray,
    rri_4hz: np.ndarray,
    ecg_clean: np.ndarray,
    n_minutes: int,
    context_minutes: int = 5,
    target_fs: float = 4.0,
    raw_fs: float = 100.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Slice centered 5-min dual-stream (N, 2, 1200) and 1-min raw ECG (N, 1, 6000) windows."""
    pts_per_min_4hz = round(60.0 * target_fs)
    win_len_4hz = context_minutes * pts_per_min_4hz
    half_pad_min = context_minutes // 2
    pad_4hz = half_pad_min * pts_per_min_4hz

    # Ensure length covers all n_minutes
    req_4hz = n_minutes * pts_per_min_4hz
    if len(edr_4hz) < req_4hz:
        edr_4hz = np.pad(edr_4hz, (0, req_4hz - len(edr_4hz)), mode="edge")
        rri_4hz = np.pad(rri_4hz, (0, req_4hz - len(rri_4hz)), mode="edge")

    edr_pad = np.pad(edr_4hz[:req_4hz], (pad_4hz, pad_4hz), mode="reflect")
    rri_pad = np.pad(rri_4hz[:req_4hz], (pad_4hz, pad_4hz), mode="reflect")

    dual = np.empty((n_minutes, 2, win_len_4hz), dtype=np.float32)
    for m in range(n_minutes):
        start = m * pts_per_min_4hz
        end = start + win_len_4hz
        dual[m, 0] = edr_pad[start:end]
        dual[m, 1] = rri_pad[start:end]

    pts_per_min_raw = round(60.0 * raw_fs)
    req_raw = n_minutes * pts_per_min_raw
    if len(ecg_clean) < req_raw:
        ecg_clean = np.pad(ecg_clean, (0, req_raw - len(ecg_clean)), mode="edge")
    raw_1min = ecg_clean[:req_raw].reshape(n_minutes, 1, pts_per_min_raw).astype(np.float32)
    return dual, raw_1min


def extract_hrv_features_per_minute(
    rri_raw_4hz: np.ndarray,
    edr_raw_4hz: np.ndarray,
    sqi_score: np.ndarray,
    n_minutes: int,
    context_minutes: int = 5,
    target_fs: float = 4.0,
) -> np.ndarray:
    """Extract 22 clinical HRV, spectral, EDR, and cardiopulmonary coupling features per minute."""
    pts_per_min = round(60.0 * target_fs)
    win_len = context_minutes * pts_per_min
    pad = (context_minutes // 2) * pts_per_min
    req = n_minutes * pts_per_min

    if len(rri_raw_4hz) < req:
        rri_raw_4hz = np.pad(rri_raw_4hz, (0, req - len(rri_raw_4hz)), mode="edge")
        edr_raw_4hz = np.pad(edr_raw_4hz, (0, req - len(edr_raw_4hz)), mode="edge")

    rri_pad = np.pad(rri_raw_4hz[:req], (pad, pad), mode="reflect")
    edr_pad = np.pad(edr_raw_4hz[:req], (pad, pad), mode="reflect")

    feats = np.zeros((n_minutes, len(HRV_FEATURE_NAMES)), dtype=np.float32)

    for m in range(n_minutes):
        s = m * pts_per_min
        e = s + win_len
        rri_w = rri_pad[s:e].astype(np.float64)
        edr_w = edr_pad[s:e].astype(np.float64)

        diffs = np.diff(rri_w)
        rri_mean = float(np.mean(rri_w))
        rri_std = float(np.std(rri_w))
        rri_rmssd = float(np.sqrt(np.mean(diffs**2)))
        rri_pnn50 = float(np.mean(np.abs(diffs) > 50.0))
        rri_iqr = float(np.percentile(rri_w, 75) - np.percentile(rri_w, 25))
        rri_min = float(np.min(rri_w))
        rri_max = float(np.max(rri_w))

        # Welch PSD on RRI & EDR (4 Hz -> Nyquist = 2 Hz)
        nperseg = min(256, len(rri_w))
        f_r, p_r = signal.welch(rri_w - rri_mean, fs=target_fs, nperseg=nperseg)
        vlf = float(np.trapezoid(p_r[(f_r >= 0.003) & (f_r < 0.04)], f_r[(f_r >= 0.003) & (f_r < 0.04)]))
        lf = float(np.trapezoid(p_r[(f_r >= 0.04) & (f_r < 0.15)], f_r[(f_r >= 0.04) & (f_r < 0.15)]))
        hf = float(np.trapezoid(p_r[(f_r >= 0.15) & (f_r <= 0.40)], f_r[(f_r >= 0.15) & (f_r <= 0.40)]))
        tot = vlf + lf + hf + 1e-8
        lf_hf = lf / max(hf, 1e-6)

        edr_std = float(np.std(edr_w))
        edr_iqr = float(np.percentile(edr_w, 75) - np.percentile(edr_w, 25))
        f_e, p_e = signal.welch(edr_w - np.mean(edr_w), fs=target_fs, nperseg=nperseg)
        resp_mask = (f_e >= 0.15) & (f_e <= 0.45)
        low_mask = (f_e >= 0.01) & (f_e < 0.15)
        edr_resp_p = float(np.trapezoid(p_e[resp_mask], f_e[resp_mask])) if resp_mask.any() else 0.0
        edr_low_p = float(np.trapezoid(p_e[low_mask], f_e[low_mask])) if low_mask.any() else 0.0
        edr_peak_f = float(f_e[resp_mask][np.argmax(p_e[resp_mask])]) if resp_mask.any() and p_e[resp_mask].size else 0.25

        # Center-minute amplitude vs. 5-minute envelope (detects sudden respiratory flattening!)
        c_lo = (context_minutes // 2) * pts_per_min
        c_hi = c_lo + pts_per_min
        edr_flatness = float(np.std(edr_w[c_lo:c_hi])) / max(edr_std, 1e-6)

        # Cardiopulmonary coupling (magnitude-squared coherence between RRI & EDR)
        with np.errstate(divide="ignore", invalid="ignore"):
            f_c, coh = signal.coherence(rri_w - rri_mean, edr_w - np.mean(edr_w), fs=target_fs, nperseg=nperseg)
        coh = np.nan_to_num(coh, nan=0.0, posinf=0.0, neginf=0.0)
        vlf_c_mask = (f_c >= 0.01) & (f_c < 0.10)
        resp_c_mask = (f_c >= 0.15) & (f_c <= 0.45)
        cpc_max = float(np.max(coh)) if coh.size else 0.0
        cpc_vlf = float(np.mean(coh[vlf_c_mask])) if vlf_c_mask.any() else 0.0
        cpc_resp = float(np.mean(coh[resp_c_mask])) if resp_c_mask.any() else 0.0

        feats[m] = [
            rri_mean,
            rri_std,
            rri_rmssd,
            rri_pnn50,
            rri_iqr,
            rri_min,
            rri_max,
            np.log1p(max(vlf, 0.0)),
            np.log1p(max(lf, 0.0)),
            np.log1p(max(hf, 0.0)),
            float(np.clip(lf_hf, 0.0, 50.0)),
            np.log1p(max(tot, 0.0)),
            edr_std,
            edr_iqr,
            np.log1p(max(edr_resp_p, 0.0)),
            np.log1p(max(edr_low_p, 0.0)),
            edr_peak_f,
            float(np.clip(edr_flatness, 0.0, 5.0)),
            cpc_max,
            cpc_vlf,
            cpc_resp,
            float(sqi_score[m]),
        ]

    return np.nan_to_num(feats, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)


def run_dsp_pipeline(
    ecg_raw: np.ndarray,
    fs: float = 100.0,
    n_minutes: int | None = None,
    dsp_cfg: dict[str, Any] | None = None,
    prefer_neurokit: bool = True,
) -> DSPResult:
    """Execute the full biomedical DSP front-end on a single-lead ECG recording."""
    cfg = dsp_cfg or {}
    if fs != 100.0:
        # Resample arbitrary uploaded ECGs to standard 100 Hz
        n_target = round(len(ecg_raw) * 100.0 / fs)
        ecg_raw = signal.resample(ecg_raw, n_target).astype(np.float32)
        fs = 100.0

    if n_minutes is None:
        n_minutes = max(1, len(ecg_raw) // round(60.0 * fs))

    ecg_clean = bandpass_ecg(
        ecg_raw,
        fs=fs,
        low_hz=float(cfg.get("bandpass_low_hz", 0.5)),
        high_hz=float(cfg.get("bandpass_high_hz", 40.0)),
        order=int(cfg.get("bandpass_order", 4)),
    )
    rpeaks = detect_rpeaks_and_clean(ecg_clean, fs=fs, prefer_neurokit=prefer_neurokit)
    edr_4hz, rri_4hz, edr_raw_4hz, rri_raw_4hz = extract_edr_rri_4hz(
        ecg_clean=ecg_clean,
        rpeaks=rpeaks,
        total_samples=len(ecg_clean),
        fs=fs,
        target_fs=float(cfg.get("sampling_rate_dsp", 4.0)),
        edr_low_hz=float(cfg.get("edr_low_hz", 0.08)),
        edr_high_hz=float(cfg.get("edr_high_hz", 0.60)),
        rr_min_sec=float(cfg.get("rr_min_sec", 0.30)),
        rr_max_sec=float(cfg.get("rr_max_sec", 2.00)),
        rr_outlier_rel_tol=float(cfg.get("rr_outlier_rel_tol", 0.25)),
        zscore_clip=float(cfg.get("zscore_clip", 5.0)),
    )
    sqi_score, sqi_pass, rhythm_irregular, rmssd_ratio = compute_minute_sqi_and_rhythm(
        ecg_raw=ecg_raw,
        ecg_clean=ecg_clean,
        rpeaks=rpeaks,
        n_minutes=n_minutes,
        fs=fs,
        min_hr_bpm=float(cfg.get("sqi_min_hr_bpm", 30.0)),
        max_hr_bpm=float(cfg.get("sqi_max_hr_bpm", 180.0)),
        min_valid_ratio=float(cfg.get("sqi_min_valid_ratio", 0.75)),
        min_std_mv=float(cfg.get("sqi_min_std_mv", 0.02)),
        max_abs_mv=float(cfg.get("sqi_max_abs_mv", 8.0)),
        pass_threshold=float(cfg.get("sqi_pass_threshold", 0.65)),
        afib_rmssd_ratio_threshold=float(cfg.get("afib_rmssd_ratio_threshold", 0.22)),
    )
    usable_ratio = float(np.mean(sqi_pass)) if len(sqi_pass) else 0.0
    return DSPResult(
        ecg_clean=ecg_clean,
        rpeaks=rpeaks,
        edr_4hz=edr_4hz,
        rri_4hz=rri_4hz,
        edr_raw_4hz=edr_raw_4hz,
        rri_raw_4hz=rri_raw_4hz,
        sqi_score=sqi_score,
        sqi_pass=sqi_pass,
        rhythm_irregular=rhythm_irregular,
        rhythm_rmssd_ratio=rmssd_ratio,
        usable_ratio=usable_ratio,
    )
