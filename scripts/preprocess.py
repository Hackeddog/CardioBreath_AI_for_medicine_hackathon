"""Preprocess PhysioNet Apnea-ECG recordings into cached 4 Hz dual-stream tensors,
validate EDR physically against the 8 respiratory-belt recordings, and bundle demo nights.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import matplotlib
import numpy as np
from scipy import signal
from tqdm import tqdm

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from src.config import load_config, resolve_path, seed_everything
from src.data_io import (
    RESP_BELT_RECORDS,
    TEST_RECORDS,
    TRAIN_RECORDS,
    load_ecg_record,
    load_respiratory_signals,
    load_train_labels,
    parse_event2_answers,
)
from src.dsp import extract_hrv_features_per_minute, run_dsp_pipeline, slice_windows

# Held-out test recordings spanning all 4 clinical severity tiers for the zero-install dashboard:
# x08 (Severe), x09 (Moderate), x21 (Mild/Borderline), x04 (Normal)
DEMO_CASES = ["x08", "x09", "x21", "x04"]


def process_single_record(
    record_id: str,
    raw_dir: Path,
    labels: np.ndarray,
    out_path: Path,
    dsp_cfg: dict,
    save_raw_1min: bool = True,
) -> dict:
    ecg_raw, fs = load_ecg_record(record_id, raw_dir)
    n_min_signal = len(ecg_raw) // round(60.0 * fs)
    n_minutes = min(len(labels), n_min_signal)
    labels = labels[:n_minutes]

    res = run_dsp_pipeline(ecg_raw, fs=fs, n_minutes=n_minutes, dsp_cfg=dsp_cfg)
    dual, raw_1min = slice_windows(
        edr_4hz=res.edr_4hz,
        rri_4hz=res.rri_4hz,
        ecg_clean=res.ecg_clean,
        n_minutes=n_minutes,
        context_minutes=int(dsp_cfg.get("context_minutes", 5)),
        target_fs=float(dsp_cfg.get("sampling_rate_dsp", 4.0)),
        raw_fs=float(dsp_cfg.get("sampling_rate_raw", 100.0)),
    )
    hrv_feats = extract_hrv_features_per_minute(
        rri_raw_4hz=res.rri_raw_4hz,
        edr_raw_4hz=res.edr_raw_4hz,
        sqi_score=res.sqi_score,
        n_minutes=n_minutes,
        context_minutes=int(dsp_cfg.get("context_minutes", 5)),
        target_fs=float(dsp_cfg.get("sampling_rate_dsp", 4.0)),
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "record_id": np.array(record_id),
        "dual_windows": dual,
        "hrv_features": hrv_feats,
        "labels": labels.astype(np.int64),
        "sqi_score": res.sqi_score.astype(np.float32),
        "sqi_pass": res.sqi_pass.astype(bool),
        "rhythm_irregular": np.array(res.rhythm_irregular),
        "rhythm_rmssd_ratio": np.array(res.rhythm_rmssd_ratio, dtype=np.float32),
    }
    if save_raw_1min:
        payload["raw_1min"] = raw_1min
    np.savez_compressed(out_path, **payload)

    apnea_min = int(labels.sum())
    eahi_true = apnea_min / max(n_minutes / 60.0, 1e-6)
    return {
        "record_id": record_id,
        "n_minutes": int(n_minutes),
        "apnea_minutes": apnea_min,
        "true_eahi": round(eahi_true, 2),
        "usable_ratio": round(res.usable_ratio, 4),
        "rhythm_irregular": res.rhythm_irregular,
        "rhythm_rmssd_ratio": round(res.rhythm_rmssd_ratio, 4),
    }


def validate_edr_against_belts(raw_dir: Path, reports_dir: Path, dsp_cfg: dict) -> dict:
    """Validate ECG-Derived Respiration (EDR) against true Resp C / Resp A belts on 8 recordings."""
    results = []
    target_fs = float(dsp_cfg.get("sampling_rate_dsp", 4.0))
    plot_sample = None

    for rec_id in RESP_BELT_RECORDS:
        try:
            ecg_raw, fs = load_ecg_record(rec_id, raw_dir)
            resp_dict, resp_fs = load_respiratory_signals(rec_id, raw_dir)
        except FileNotFoundError:
            continue

        belt_name = "Resp C" if "Resp C" in resp_dict else ("Resp A" if "Resp A" in resp_dict else next(iter(resp_dict)))
        belt = resp_dict[belt_name].astype(np.float64)

        # Align length to minimum shared duration
        min_sec = min(len(ecg_raw) / fs, len(belt) / resp_fs)
        ecg_trim = ecg_raw[: int(min_sec * fs)]
        belt_trim = belt[: int(min_sec * resp_fs)]

        res = run_dsp_pipeline(ecg_trim, fs=fs, dsp_cfg=dsp_cfg)
        edr_4hz = res.edr_4hz.astype(np.float64)

        # Resample ground-truth respiratory belt to 4 Hz and bandpass into respiratory band
        n_4hz = len(edr_4hz)
        belt_4hz = signal.resample(belt_trim, n_4hz)
        sos = signal.butter(3, [0.08 / (0.5 * target_fs), 0.60 / (0.5 * target_fs)], btype="bandpass", output="sos")
        belt_4hz = signal.sosfiltfilt(sos, belt_4hz)
        belt_4hz = (belt_4hz - np.median(belt_4hz)) / max(1.4826 * np.median(np.abs(belt_4hz - np.median(belt_4hz))), 1e-6)

        # Compute magnitude-squared coherence & peak respiratory frequency agreement over clean 60s windows
        freqs, coh = signal.coherence(edr_4hz, belt_4hz, fs=target_fs, nperseg=256)
        resp_band = (freqs >= 0.15) & (freqs <= 0.45)
        peak_coh = float(np.max(coh[resp_band]))
        mean_coh = float(np.mean(coh[resp_band]))

        # Dominant breathing rate comparison (breaths/min) via Welch PSD
        f_e, p_e = signal.welch(edr_4hz, fs=target_fs, nperseg=512)
        f_b, p_b = signal.welch(belt_4hz, fs=target_fs, nperseg=512)
        rb = (f_e >= 0.15) & (f_e <= 0.45)
        br_edr_bpm = float(f_e[rb][np.argmax(p_e[rb])] * 60.0)
        br_belt_bpm = float(f_b[rb][np.argmax(p_b[rb])] * 60.0)
        br_err_bpm = abs(br_edr_bpm - br_belt_bpm)

        # Best 60-second clean window absolute Pearson correlation (accounting for polarity inversion)
        win = int(60 * target_fs)
        best_r = 0.0
        best_start = 0
        for start in range(win * 10, max(win * 11, n_4hz - win), win * 5):
            e_seg = edr_4hz[start : start + win]
            b_seg = belt_4hz[start : start + win]
            if np.std(e_seg) > 1e-4 and np.std(b_seg) > 1e-4:
                # Allow +/- 1s phase lag from chest-wall mechanical delay
                xc = signal.correlate(e_seg - e_seg.mean(), b_seg - b_seg.mean(), mode="full")
                lags = signal.correlation_lags(win, win, mode="full")
                mask = np.abs(lags) <= int(1.5 * target_fs)
                r = float(np.max(np.abs(xc[mask])) / (win * np.std(e_seg) * np.std(b_seg)))
                if r > best_r:
                    best_r = r
                    best_start = start

        row = {
            "record_id": rec_id,
            "belt_channel": belt_name,
            "peak_resp_coherence": round(peak_coh, 4),
            "mean_resp_coherence": round(mean_coh, 4),
            "edr_breathing_rate_bpm": round(br_edr_bpm, 2),
            "belt_breathing_rate_bpm": round(br_belt_bpm, 2),
            "breathing_rate_abs_err_bpm": round(br_err_bpm, 2),
            "best_60s_abs_corr": round(best_r, 4),
        }
        results.append(row)

        if rec_id == "c01" or plot_sample is None:
            plot_sample = (rec_id, belt_name, edr_4hz[best_start : best_start + win], belt_4hz[best_start : best_start + win], row)

    summary = {
        "n_records_validated": len(results),
        "mean_peak_resp_coherence": round(float(np.mean([r["peak_resp_coherence"] for r in results])), 4) if results else 0.0,
        "mean_breathing_rate_mae_bpm": round(float(np.mean([r["breathing_rate_abs_err_bpm"] for r in results])), 2) if results else 0.0,
        "mean_best_60s_abs_corr": round(float(np.mean([r["best_60s_abs_corr"] for r in results])), 4) if results else 0.0,
        "per_record": results,
    }

    reports_dir.mkdir(parents=True, exist_ok=True)
    fig_dir = reports_dir / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)
    (reports_dir / "edr_belt_validation.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    if plot_sample is not None:
        rec_id, belt_name, e_seg, b_seg, row = plot_sample
        # Flip EDR visually if anti-correlated (electrode axis polarity)
        if np.corrcoef(e_seg, b_seg)[0, 1] < 0:
            e_seg = -e_seg
        t = np.arange(len(e_seg)) / target_fs

        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 5.2), dpi=160)
        ax1.plot(t, b_seg, label=f"Ground-Truth Respiratory Belt ({belt_name})", color="#0F2942", lw=1.8)
        ax1.plot(t, e_seg, label="CardioBreath ECG-Derived Respiration (EDR)", color="#0D9488", lw=1.6, ls="--")
        ax1.set_title(
            f"Physical EDR Validation on PhysioNet {rec_id}r — Peak Resp Coherence: {row['peak_resp_coherence']:.2f}, "
            f"Breathing Rate Error: {row['breathing_rate_abs_err_bpm']:.2f} bpm",
            fontsize=10.5,
            fontweight="bold",
            color="#0F2942",
        )
        ax1.set_xlabel("Time (seconds)")
        ax1.set_ylabel("Normalized Amplitude (z)")
        ax1.legend(loc="upper right", frameon=True)
        ax1.grid(alpha=0.25)

        rec_names = [r["record_id"] for r in results]
        cohs = [r["peak_resp_coherence"] for r in results]
        bars = ax2.bar(rec_names, cohs, color="#0D9488", edgecolor="#0F2942", linewidth=0.8)
        ax2.axhline(summary["mean_peak_resp_coherence"], color="#E11D48", ls="--", lw=1.3, label=f"Mean Peak Coherence = {summary['mean_peak_resp_coherence']:.2f}")
        ax2.set_ylim(0, 1.05)
        ax2.set_ylabel("Peak Resp-Band Coherence")
        ax2.set_title("EDR vs. Ground-Truth Respiratory Belt Coherence Across All 8 Multi-Sensor Nights", fontsize=10, fontweight="bold", color="#0F2942")
        ax2.legend(loc="upper right", frameon=True)
        ax2.grid(axis="y", alpha=0.25)
        for bar, val in zip(bars, cohs):
            ax2.text(bar.get_x() + bar.get_width() / 2, val + 0.02, f"{val:.2f}", ha="center", va="bottom", fontsize=8)

        plt.tight_layout()
        fig.savefig(fig_dir / "edr_belt_validation.png", bbox_inches="tight")
        plt.close(fig)

    return summary


def export_demo_bundle(raw_dir: Path, test_labels: dict[str, np.ndarray], demo_dir: Path, dsp_cfg: dict) -> None:
    """Export lightweight held-out demo nights (100 Hz ECG downsampled to float16 + labels) for zero-install UI."""
    demo_dir.mkdir(parents=True, exist_ok=True)
    for old_npz in demo_dir.glob("*.npz"):
        if old_npz.stem not in DEMO_CASES:
            old_npz.unlink()
    manifest = []
    for rec_id in DEMO_CASES:
        if not (raw_dir / f"{rec_id}.dat").exists() or rec_id not in test_labels:
            continue
        ecg_raw, fs = load_ecg_record(rec_id, raw_dir)
        labels = test_labels[rec_id]
        n_min = min(len(labels), len(ecg_raw) // round(60 * fs))
        ecg_trim = ecg_raw[: n_min * round(60 * fs)].astype(np.float16)
        labels = labels[:n_min].astype(np.int8)
        np.savez_compressed(
            demo_dir / f"{rec_id}.npz",
            record_id=np.array(rec_id),
            ecg_100hz=ecg_trim,
            fs=np.array(fs, dtype=np.float32),
            labels=labels,
        )
        apnea_min = int(labels.sum())
        eahi = round(apnea_min / max(n_min / 60.0, 1e-6), 2)
        tier = "Severe" if eahi >= 30 else ("Moderate" if eahi >= 15 else ("Mild/Borderline" if eahi >= 5 else "Normal"))
        manifest.append(
            {
                "case_id": rec_id,
                "split": "held_out_test",
                "duration_minutes": int(n_min),
                "duration_hours": round(n_min / 60.0, 2),
                "true_eahi": eahi,
                "clinical_tier": tier,
            }
        )
    (demo_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Preprocess PhysioNet Apnea-ECG recordings.")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--limit", type=int, default=None, help="Limit recordings per split for quick smoke test.")
    parser.add_argument("--skip-raw-1min", action="store_true", help="Skip saving 1-min raw ECG arrays.")
    parser.add_argument("--skip-belt-val", action="store_true", help="Skip 8-record EDR belt validation.")
    args = parser.parse_args()

    cfg = load_config(args.config)
    seed_everything(int(cfg["project"]["seed"]))

    raw_dir = resolve_path(cfg["paths"]["raw_dir"])
    proc_dir = resolve_path(cfg["paths"]["processed_dir"])
    reports_dir = resolve_path(cfg["paths"]["reports_dir"])
    demo_dir = resolve_path(cfg["paths"]["demo_dir"])
    dsp_cfg = cfg["dsp"]

    test_labels = parse_event2_answers(raw_dir / "event-2-answers.txt")

    train_recs = TRAIN_RECORDS[: args.limit] if args.limit else TRAIN_RECORDS
    test_recs = TEST_RECORDS[: args.limit] if args.limit else TEST_RECORDS

    summary: dict[str, list[dict]] = {"train": [], "test": []}

    print(f"[preprocess] Processing {len(train_recs)} learning recordings ...")
    for rec_id in tqdm(train_recs, desc="Train DSP"):
        labels = load_train_labels(rec_id, raw_dir)
        meta = process_single_record(
            rec_id,
            raw_dir=raw_dir,
            labels=labels,
            out_path=proc_dir / "train" / f"{rec_id}.npz",
            dsp_cfg=dsp_cfg,
            save_raw_1min=not args.skip_raw_1min,
        )
        summary["train"].append(meta)

    print(f"[preprocess] Processing {len(test_recs)} LOCKED held-out test recordings ...")
    for rec_id in tqdm(test_recs, desc="Test DSP "):
        labels = test_labels[rec_id]
        meta = process_single_record(
            rec_id,
            raw_dir=raw_dir,
            labels=labels,
            out_path=proc_dir / "test" / f"{rec_id}.npz",
            dsp_cfg=dsp_cfg,
            save_raw_1min=not args.skip_raw_1min,
        )
        summary["test"].append(meta)

    reports_dir.mkdir(parents=True, exist_ok=True)
    (reports_dir / "preprocess_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    if not args.skip_belt_val:
        print("[preprocess] Running physical EDR validation against 8 respiratory-belt recordings ...")
        belt_summary = validate_edr_against_belts(raw_dir, reports_dir, dsp_cfg)
        print(
            f"[OK] EDR Belt Validation ({belt_summary['n_records_validated']} records): "
            f"Mean Peak Resp Coherence = {belt_summary['mean_peak_resp_coherence']:.3f}, "
            f"Breathing Rate MAE = {belt_summary['mean_breathing_rate_mae_bpm']:.2f} bpm"
        )

    export_demo_bundle(raw_dir, test_labels, demo_dir, dsp_cfg)
    print(f"[OK] Preprocessing complete. Cached tensors written to {proc_dir} and demo bundle to {demo_dir}.")


if __name__ == "__main__":
    main()
