"""Single-command reproducible clinical evaluation suite for CardioBreath.

Generates:
  - reports/metrics_summary_{split}.json
  - reports/benchmark_table_{split}.md
  - reports/figures/roc_pr_curves_{split}.png
  - reports/figures/bland_altman_eahi_{split}.png
  - reports/figures/calibration_reliability_{split}.png
  - reports/figures/noise_robustness_sqi_{split}.png
  - reports/figures/failure_cases_{split}.png
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
import torch
from sklearn.metrics import precision_recall_curve, roc_curve
from torch.utils.data import DataLoader

matplotlib.use("Agg")
import matplotlib.pyplot as plt

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.baselines import predict_lgbm_ensemble
from src.calibration import apply_temperature
from src.config import load_config, load_folds, resolve_path, seed_everything
from src.data_io import load_ecg_record
from src.datasets import MODEL_TO_MODE, ApneaWindowDataset, load_processed_record, select_mode_array
from src.dsp import inject_motion_artifact, run_dsp_pipeline, slice_windows
from src.metrics import (
    compute_decision_curve,
    compute_minute_metrics,
    compute_recording_eahi_metrics,
    compute_subject_clustered_bootstrap_ci,
)
from src.models import build_model

MODEL_DISPLAY_NAMES = {
    "lgbm": "Baseline 1: HRV + LightGBM",
    "raw_cnn": "Baseline 2: Raw 1-min ECG CNN",
    "ablation_rri": "Ablation A: RRI-Only (5-min)",
    "ablation_edr": "Ablation B: EDR-Only (5-min)",
    "ablation_1min": "Ablation C: Dual-Stream (1-min)",
    "cardiobreath": "CardioBreath (Dual-Stream 5-Fold)",
}


@torch.no_grad()
def _predict_pytorch_ensemble_on_record(
    model_name: str,
    ckpt_dir: Path,
    x_arr: np.ndarray,
    temperature: float,
    device: torch.device,
    batch_size: int = 256,
) -> tuple[np.ndarray, np.ndarray]:
    ckpt_files = sorted(ckpt_dir.glob("fold_*.pt"))
    if not ckpt_files:
        raise FileNotFoundError(f"No checkpoints found in {ckpt_dir}")

    fold_probs = []
    for ckpt_path in ckpt_files:
        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        model = build_model(model_name, {"model": ckpt["model_config"]}).to(device)
        model.load_state_dict(ckpt["state_dict"])
        model.eval()

        logits_chunks = []
        for i in range(0, len(x_arr), batch_size):
            xb = torch.from_numpy(x_arr[i : i + batch_size]).to(device)
            logits_chunks.append(model(xb).cpu().numpy())
        logits = np.concatenate(logits_chunks, axis=0)
        fold_probs.append(apply_temperature(logits, temperature))

    stacked = np.stack(fold_probs, axis=0)
    return np.mean(stacked, axis=0).astype(np.float32), stacked.astype(np.float32)


def collect_val_records(model_name: str, ckpt_dir: Path) -> tuple[dict[str, dict[str, np.ndarray]], dict[str, Any]]:
    """Load out-of-fold validation predictions grouped by recording."""
    meta = json.loads((ckpt_dir / "cv_summary.json").read_text(encoding="utf-8"))
    with np.load(ckpt_dir / "oof_predictions.npz", allow_pickle=False) as d:
        probs = d["probs"]
        labels = d["labels"]
        sqi = d["sqi_pass"]
        rec_ids = d["record_ids"]

    records: dict[str, dict[str, np.ndarray]] = {}
    for rid in sorted(set(rec_ids.tolist())):
        mask = rec_ids == rid
        records[rid] = {"probs": probs[mask], "labels": labels[mask], "sqi_pass": sqi[mask]}
    return records, meta


def collect_test_records(
    model_name: str,
    ckpt_dir: Path,
    test_dir: Path,
    test_ids: list[str],
    device: torch.device,
) -> tuple[dict[str, dict[str, np.ndarray]], dict[str, Any]]:
    """Evaluate a frozen model / 5-fold ensemble strictly on the locked held-out test set (x01-x35)."""
    meta = json.loads((ckpt_dir / "cv_summary.json").read_text(encoding="utf-8"))
    temp = float(meta.get("temperature", 1.0))
    records: dict[str, dict[str, np.ndarray]] = {}

    if model_name == "lgbm":
        for rid in test_ids:
            d = load_processed_record(rid, test_dir)
            probs, _ = predict_lgbm_ensemble(ckpt_dir, d["hrv_features"].astype(np.float32))
            records[rid] = {"probs": probs, "labels": d["labels"], "sqi_pass": d["sqi_pass"]}
        return records, meta

    mode = MODEL_TO_MODE[model_name]
    ckpt_files = sorted(ckpt_dir.glob("fold_*.pt"))
    models = []
    for ckpt_path in ckpt_files:
        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        m = build_model(model_name, {"model": ckpt["model_config"]}).to(device)
        m.load_state_dict(ckpt["state_dict"])
        m.eval()
        models.append(m)

    for rid in test_ids:
        ds = ApneaWindowDataset([rid], test_dir, mode=mode, augment=False, only_usable=False)
        loader = DataLoader(ds, batch_size=256, shuffle=False, num_workers=0)
        fold_probs = []
        with torch.no_grad():
            for m in models:
                chunks = [m(xb.to(device)).cpu().numpy() for xb, _ in loader]
                logits = np.concatenate(chunks, axis=0)
                fold_probs.append(apply_temperature(logits, temp))
        probs = np.mean(np.stack(fold_probs, axis=0), axis=0).astype(np.float32)
        records[rid] = {"probs": probs, "labels": ds.y.astype(np.int64), "sqi_pass": ds.sqi_pass}

    return records, meta


def evaluate_noise_robustness(
    model_name: str,
    ckpt_dir: Path,
    raw_dir: Path,
    split_dir: Path,
    record_ids: list[str],
    cfg: dict[str, Any],
    device: torch.device,
) -> list[dict[str, Any]]:
    """Measure un-gated vs. SQI-gated accuracy and coverage across SNR clean -> 0 dB."""
    meta = json.loads((ckpt_dir / "cv_summary.json").read_text(encoding="utf-8"))
    temp = float(meta.get("temperature", 1.0))
    thr = float(meta.get("threshold", 0.5))
    dsp_cfg = cfg["dsp"]
    sample_recs = record_ids[:4]  # Fast representative subset spanning nights
    snrs: list[float | None] = [None, *[float(s) for s in cfg["clinical"]["noise_stress_snr_db"]]]
    rows = []

    for snr in snrs:
        y_all, p_all, sqi_all = [], [], []
        for rid in sample_recs:
            proc = load_processed_record(rid, split_dir)
            labels = proc["labels"]
            n_min = len(labels)
            if snr is None:
                x_arr = select_mode_array(proc, MODEL_TO_MODE[model_name]) if model_name != "lgbm" else proc["hrv_features"]
                sqi_pass = proc["sqi_pass"]
            else:
                ecg_raw, fs = load_ecg_record(rid, raw_dir)
                noisy = inject_motion_artifact(ecg_raw, snr_db=snr, fs=fs, seed=42)
                res = run_dsp_pipeline(noisy, fs=fs, n_minutes=n_min, dsp_cfg=dsp_cfg, prefer_neurokit=False)
                dual, raw_1m = slice_windows(res.edr_4hz, res.rri_4hz, res.ecg_clean, n_minutes=n_min)
                sqi_pass = res.sqi_pass
                if model_name == "lgbm":
                    from src.dsp import extract_hrv_features_per_minute

                    x_arr = extract_hrv_features_per_minute(res.rri_raw_4hz, res.edr_raw_4hz, res.sqi_score, n_min)
                else:
                    x_arr = select_mode_array({"dual_windows": dual, "raw_1min": raw_1m}, MODEL_TO_MODE[model_name])

            if model_name == "lgbm":
                probs, _ = predict_lgbm_ensemble(ckpt_dir, x_arr.astype(np.float32))
            else:
                probs, _ = _predict_pytorch_ensemble_on_record(model_name, ckpt_dir, x_arr, temp, device)

            y_all.append(labels)
            p_all.append(probs)
            sqi_all.append(sqi_pass)

        yt = np.concatenate(y_all)
        yp = np.concatenate(p_all)
        sq = np.concatenate(sqi_all)
        ungated = compute_minute_metrics(yt, yp, threshold=thr, sqi_pass=None)
        gated = compute_minute_metrics(yt, yp, threshold=thr, sqi_pass=sq) if np.any(sq) else ungated
        rows.append(
            {
                "snr_label": "Clean" if snr is None else f"{int(snr)} dB",
                "snr_db": snr,
                "coverage": round(float(np.mean(sq)), 4),
                "ungated_acc": ungated["accuracy"],
                "gated_acc": gated["accuracy"] if np.any(sq) else None,
                "ungated_auroc": ungated["auroc"],
                "gated_auroc": gated["auroc"] if np.any(sq) else None,
            }
        )
    return rows


def _plot_roc_pr(all_results: dict[str, dict], raw_preds: dict[str, tuple[np.ndarray, np.ndarray]], out_path: Path) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10.5, 4.4), dpi=160)
    palette = ["#0F2942", "#64748B", "#F59E0B", "#3B82F6", "#8B5CF6", "#0D9488"]

    for idx, (mname, (yt, yp)) in enumerate(raw_preds.items()):
        color = "#0D9488" if mname == "cardiobreath" else palette[idx % len(palette)]
        lw = 2.4 if mname == "cardiobreath" else 1.5
        fpr, tpr, _ = roc_curve(yt, yp)
        prec, rec, _ = precision_recall_curve(yt, yp)
        auc = all_results[mname]["minute_metrics"]["auroc"]
        ap = all_results[mname]["minute_metrics"]["auprc"]
        label = MODEL_DISPLAY_NAMES.get(mname, mname)
        ax1.plot(fpr, tpr, color=color, lw=lw, label=f"{label} (AUC={auc:.3f})")
        ax2.plot(rec, prec, color=color, lw=lw, label=f"{label} (AP={ap:.3f})")

    ax1.plot([0, 1], [0, 1], "k--", lw=1, alpha=0.4)
    ax1.set_title("Per-Minute ROC Curve", fontweight="bold", color="#0F2942")
    ax1.set_xlabel("False Positive Rate")
    ax1.set_ylabel("True Positive Rate (Sensitivity)")
    ax1.legend(loc="lower right", fontsize=7.5)
    ax1.grid(alpha=0.25)

    ax2.set_title("Per-Minute Precision-Recall Curve", fontweight="bold", color="#0F2942")
    ax2.set_xlabel("Recall (Sensitivity)")
    ax2.set_ylabel("Precision")
    ax2.legend(loc="lower left", fontsize=7.5)
    ax2.grid(alpha=0.25)

    plt.tight_layout()
    fig.savefig(out_path, bbox_inches="tight")
    plt.close(fig)


def _plot_bland_altman(primary_name: str, rec_metrics: dict[str, Any], out_path: Path) -> None:
    rows = rec_metrics["per_record"]
    t_vals = np.array([r["true_eahi"] for r in rows])
    p_vals = np.array([r["pred_eahi"] for r in rows])
    means = 0.5 * (t_vals + p_vals)
    diffs = p_vals - t_vals

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10.5, 4.3), dpi=160)
    ax1.scatter(t_vals, p_vals, color="#0D9488", edgecolor="#0F2942", s=45, alpha=0.85)
    lim = max(60.0, float(max(t_vals.max(), p_vals.max()) + 3))
    ax1.plot([0, lim], [0, lim], "k--", lw=1.2, alpha=0.6, label="Identity (y = x)")
    ax1.axvline(5.0, color="#F59E0B", ls=":", lw=1, label="Screening Cutoff (eAHI = 5)")
    ax1.axhline(5.0, color="#F59E0B", ls=":", lw=1)
    ax1.set_title(
        f"{MODEL_DISPLAY_NAMES.get(primary_name, primary_name)}\nPredicted vs. True eAHI (MAE={rec_metrics['eahi_mae']:.2f}, r={rec_metrics['eahi_pearson_r']:.3f})",
        fontsize=9.5,
        fontweight="bold",
        color="#0F2942",
    )
    ax1.set_xlabel("True Minute-eAHI (events/hr)")
    ax1.set_ylabel("Predicted Minute-eAHI (events/hr)")
    ax1.legend(loc="upper left", fontsize=8)
    ax1.grid(alpha=0.25)

    bias = rec_metrics["bland_altman_bias"]
    loa_lo = rec_metrics["bland_altman_loa_low"]
    loa_hi = rec_metrics["bland_altman_loa_high"]
    ax2.scatter(means, diffs, color="#0F2942", alpha=0.8, s=45)
    ax2.axhline(bias, color="#0D9488", lw=1.8, label=f"Mean Bias = {bias:+.2f}")
    ax2.axhline(loa_hi, color="#E11D48", ls="--", lw=1.3, label=f"+1.96 SD = {loa_hi:+.2f}")
    ax2.axhline(loa_lo, color="#E11D48", ls="--", lw=1.3, label=f"-1.96 SD = {loa_lo:+.2f}")
    ax2.set_title("Bland-Altman Agreement (eAHI, events/hr)", fontsize=9.5, fontweight="bold", color="#0F2942")
    ax2.set_xlabel("Mean of True & Predicted eAHI (events/hr)")
    ax2.set_ylabel("Predicted − True eAHI (events/hr)")
    ax2.legend(loc="upper right", fontsize=8)
    ax2.grid(alpha=0.25)

    plt.tight_layout()
    fig.savefig(out_path, bbox_inches="tight")
    plt.close(fig)


def _plot_calibration(primary_name: str, yt: np.ndarray, yp: np.ndarray, ece: float, out_path: Path) -> None:
    edges = np.linspace(0.0, 1.0, 11)
    confs, accs = [], []
    for i in range(10):
        m = (yp >= edges[i]) & (yp <= edges[i + 1] if i == 9 else yp < edges[i + 1])
        if np.any(m):
            confs.append(float(np.mean(yp[m])))
            accs.append(float(np.mean(yt[m])))

    fig, ax = plt.subplots(figsize=(5.5, 4.4), dpi=160)
    ax.plot([0, 1], [0, 1], "k--", lw=1.2, alpha=0.5, label="Perfect Calibration")
    ax.plot(confs, accs, marker="o", color="#0D9488", lw=2.2, label=f"{MODEL_DISPLAY_NAMES.get(primary_name, primary_name)} (ECE={ece:.3f})")
    ax.set_title("Reliability Diagram (Post-Temperature Scaling)", fontweight="bold", color="#0F2942")
    ax.set_xlabel("Mean Predicted Apnea Probability")
    ax.set_ylabel("Observed Apnea Fraction")
    ax.legend(loc="upper left", fontsize=8.5)
    ax.grid(alpha=0.25)
    plt.tight_layout()
    fig.savefig(out_path, bbox_inches="tight")
    plt.close(fig)


def _plot_noise_robustness(rows: list[dict[str, Any]], out_path: Path) -> None:
    labels = [r["snr_label"] for r in rows]
    x = np.arange(len(labels))
    ungated = [r["ungated_acc"] for r in rows]
    gated = [r["gated_acc"] if r["gated_acc"] is not None else np.nan for r in rows]
    cov = [r["coverage"] for r in rows]

    fig, ax1 = plt.subplots(figsize=(7.5, 4.2), dpi=160)
    ax1.plot(x, ungated, marker="s", color="#E11D48", lw=2, ls="--", label="Un-Gated Accuracy (All Minutes)")
    ax1.plot(x, gated, marker="o", color="#0D9488", lw=2.4, label="SQI-Gated Accuracy (Accepted Minutes)")
    ax1.set_xticks(x)
    ax1.set_xticklabels(labels)
    ax1.set_ylim(0.4, 1.02)
    ax1.set_ylabel("Per-Minute Accuracy")
    ax1.set_xlabel("Synthetic Motion / EMG Noise Severity")
    ax1.grid(alpha=0.25)

    ax2 = ax1.twinx()
    ax2.bar(x, cov, width=0.35, alpha=0.22, color="#0F2942", label="Usable Coverage (1 - Deferred)")
    ax2.set_ylim(0.0, 1.15)
    ax2.set_ylabel("Accepted Signal Coverage", color="#0F2942")

    lines1, l1 = ax1.get_legend_handles_labels()
    lines2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, l1 + l2, loc="lower left", fontsize=8)
    ax1.set_title("Motion-Artifact Stress Test: SQI Gate Protects Accuracy via Abstention", fontweight="bold", color="#0F2942")
    plt.tight_layout()
    fig.savefig(out_path, bbox_inches="tight")
    plt.close(fig)


def _plot_failure_cases(
    primary_records: dict[str, dict[str, np.ndarray]],
    rec_metrics: dict[str, Any],
    split_dir: Path,
    threshold: float,
    out_path: Path,
) -> dict[str, Any]:
    """Automatically surface and plot 2 honest failure cases: worst FN night + worst noisy FP minute."""
    per_rec = rec_metrics["per_record"]
    # 1. Hardest false-negative / under-predicted apnea recording (true_eahi >= 5)
    apnea_recs = [r for r in per_rec if r["true_eahi"] >= 5.0]
    fn_case = min(apnea_recs, key=lambda r: r["pred_eahi"] - r["true_eahi"]) if apnea_recs else per_rec[0]

    # 2. Hardest false-positive minute across control/low-apnea recordings
    fp_info = None
    best_fp_prob = -1.0
    for rid, d in primary_records.items():
        fp_mask = (d["labels"] == 0) & (d["probs"] >= threshold)
        if np.any(fp_mask):
            idx = int(np.argmax(np.where(fp_mask, d["probs"], -1.0)))
            prob = float(d["probs"][idx])
            if prob > best_fp_prob:
                best_fp_prob = prob
                fp_info = {"record_id": rid, "minute_idx": idx, "prob": round(prob, 3), "sqi_pass": bool(d["sqi_pass"][idx])}

    fig, axes = plt.subplots(2, 1, figsize=(10, 5.2), dpi=160)

    # Panel 1: FN recording probability timeline vs ground truth
    fn_rid = fn_case["record_id"]
    fn_d = primary_records[fn_rid]
    mins = np.arange(len(fn_d["labels"])) / 60.0
    axes[0].fill_between(mins, 0, fn_d["labels"], alpha=0.22, color="#E11D48", label="Ground-Truth Apnea")
    axes[0].plot(mins, fn_d["probs"], color="#0F2942", lw=1.1, label="Predicted Apnea Prob.")
    axes[0].axhline(threshold, color="#0D9488", ls="--", lw=1, label=f"Threshold ({threshold:.2f})")
    axes[0].set_title(
        f"Failure Case 1 (Under-Predicted Apnea Night): {fn_rid} — True eAHI={fn_case['true_eahi']:.1f} vs. Pred eAHI={fn_case['pred_eahi']:.1f}",
        fontsize=9.5,
        fontweight="bold",
        color="#9F1239",
    )
    axes[0].set_xlabel("Sleep Time (hours)")
    axes[0].set_ylabel("Probability / Label")
    axes[0].legend(loc="upper right", fontsize=8)
    axes[0].grid(alpha=0.25)

    # Panel 2: Worst FP 5-minute dual-stream window (EDR + RRI)
    if fp_info is not None:
        proc = load_processed_record(fp_info["record_id"], split_dir)
        win = proc["dual_windows"][fp_info["minute_idx"]]  # (2, 1200)
        t = np.arange(win.shape[-1]) / 4.0
        axes[1].plot(t, win[0], color="#0D9488", lw=1.3, label="EDR (Normalized)")
        axes[1].plot(t, win[1], color="#E11D48", lw=1.3, alpha=0.85, label="RRI Tachogram (Normalized)")
        axes[1].axvspan(120, 180, color="#FEF3C7", alpha=0.5, label="Target Minute (False Positive)")
        axes[1].set_title(
            f"Failure Case 2 (High-Confidence False Positive): {fp_info['record_id']} @ min {fp_info['minute_idx']} "
            f"(p={fp_info['prob']:.2f}, sqi_pass={fp_info['sqi_pass']})",
            fontsize=9.5,
            fontweight="bold",
            color="#9F1239",
        )
        axes[1].set_xlabel("5-Minute Context Window (seconds)")
        axes[1].set_ylabel("Robust Z-Score")
        axes[1].legend(loc="upper right", fontsize=8)
        axes[1].grid(alpha=0.25)
    else:
        axes[1].text(0.5, 0.5, "No false-positive epochs above threshold.", ha="center", va="center")

    plt.tight_layout()
    fig.savefig(out_path, bbox_inches="tight")
    plt.close(fig)
    return {"fn_recording": fn_case, "worst_fp_epoch": fp_info}


def write_markdown_table(split: str, all_results: dict[str, dict], out_path: Path) -> None:
    lines = [
        f"# CardioBreath Benchmark Summary (`split={split}`)",
        "",
        "| Model | AUROC (95% CI) | AUPRC | Accuracy | Sens | Spec | F1 | eAHI MAE (events/hr) | eAHI Pearson *r* | Screen Sens (`>=5`) | ECE |",
        "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    ]
    for mname, res in all_results.items():
        mm = res["minute_metrics"]
        rm = res["recording_metrics"]
        ci = res["bootstrap_ci_95"]
        auc_ci = f"{mm['auroc']:.3f} [{ci['auroc']['ci95_low']:.3f}, {ci['auroc']['ci95_high']:.3f}]"
        mae_ci = f"{rm['eahi_mae']:.2f} [{ci['eahi_mae']['ci95_low']:.2f}, {ci['eahi_mae']['ci95_high']:.2f}]"
        lines.append(
            f"| **{MODEL_DISPLAY_NAMES.get(mname, mname)}** | {auc_ci} | {mm['auprc']:.3f} | "
            f"{mm['accuracy']:.3f} | {mm['sensitivity']:.3f} | {mm['specificity']:.3f} | "
            f"{mm['f1']:.3f} | {mae_ci} | {rm['eahi_pearson_r']:.3f} | "
            f"{rm['screening_cutoff_5']['sensitivity']:.3f} | {mm['ece']:.3f} |"
        )
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run reproducible clinical evaluation for CardioBreath.")
    parser.add_argument("--split", default="val", choices=["val", "test"])
    parser.add_argument("--models", default="auto", help="Comma-separated models or `auto` to scan checkpoints.")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--bootstrap", type=int, default=None, help="Override bootstrap resamples.")
    parser.add_argument("--skip-noise", action="store_true", help="Skip motion-noise stress test.")
    args = parser.parse_args()

    cfg = load_config(args.config)
    folds_cfg = load_folds(cfg["paths"]["folds_path"])
    seed_everything(args.seed)

    ckpt_root = resolve_path(cfg["paths"]["checkpoints_dir"])
    proc_root = resolve_path(cfg["paths"]["processed_dir"])
    raw_dir = resolve_path(cfg["paths"]["raw_dir"])
    reports_dir = resolve_path(cfg["paths"]["reports_dir"])
    fig_dir = reports_dir / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)

    device = torch.device("cuda" if (args.device == "auto" and torch.cuda.is_available()) else ("cpu" if args.device == "auto" else args.device))
    n_boot = int(args.bootstrap if args.bootstrap is not None else cfg["clinical"]["bootstrap_resamples"])

    ordered = ["lgbm", "raw_cnn", "ablation_rri", "ablation_edr", "ablation_1min", "cardiobreath"]
    if args.models == "auto":
        models_to_eval = [m for m in ordered if (ckpt_root / m / "cv_summary.json").exists()]
    else:
        models_to_eval = [m.strip() for m in args.models.split(",") if m.strip()]

    if not models_to_eval:
        raise RuntimeError(f"No trained models found in {ckpt_root}. Run train.py first.")

    split_dir = proc_root / ("train" if args.split == "val" else "test")
    test_ids = folds_cfg["held_out_test"]

    all_results: dict[str, dict[str, Any]] = {}
    raw_preds: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    all_records_by_model: dict[str, dict[str, dict[str, np.ndarray]]] = {}

    for mname in models_to_eval:
        ckpt_dir = ckpt_root / mname
        if args.split == "val":
            records, meta = collect_val_records(mname, ckpt_dir)
        else:
            records, meta = collect_test_records(mname, ckpt_dir, split_dir, test_ids, device)

        thr = float(meta.get("threshold", 0.5))
        yt = np.concatenate([d["labels"] for d in records.values()])
        yp = np.concatenate([d["probs"] for d in records.values()])
        sq = np.concatenate([d["sqi_pass"] for d in records.values()])

        mm = compute_minute_metrics(yt, yp, threshold=thr, sqi_pass=sq)
        mm_all = compute_minute_metrics(yt, yp, threshold=thr, sqi_pass=None)
        rm = compute_recording_eahi_metrics(records, threshold=thr, use_sqi_mask=True)
        ci = compute_subject_clustered_bootstrap_ci(records, threshold=thr, n_resamples=n_boot, seed=args.seed)
        dca = compute_decision_curve(yt[sq] if np.any(sq) else yt, yp[sq] if np.any(sq) else yp)

        all_results[mname] = {
            "meta": meta,
            "minute_metrics": mm,
            "minute_metrics_ungated": mm_all,
            "recording_metrics": rm,
            "bootstrap_ci_95": ci,
            "decision_curve": dca,
        }
        raw_preds[mname] = (yt[sq] if np.any(sq) else yt, yp[sq] if np.any(sq) else yp)
        all_records_by_model[mname] = records

        print(
            f"[{args.split.upper()}] {MODEL_DISPLAY_NAMES.get(mname, mname):34s} | "
            f"AUROC={mm['auroc']:.4f} | Acc={mm['accuracy']:.4f} | F1={mm['f1']:.4f} | "
            f"eAHI MAE={rm['eahi_mae']:.2f} (r={rm['eahi_pearson_r']:.3f}) | ECE={mm['ece']:.4f}"
        )

    primary = "cardiobreath" if "cardiobreath" in all_results else models_to_eval[-1]
    _plot_roc_pr(all_results, raw_preds, fig_dir / f"roc_pr_curves_{args.split}.png")
    _plot_bland_altman(primary, all_results[primary]["recording_metrics"], fig_dir / f"bland_altman_eahi_{args.split}.png")
    _plot_calibration(
        primary,
        raw_preds[primary][0],
        raw_preds[primary][1],
        all_results[primary]["minute_metrics"]["ece"],
        fig_dir / f"calibration_reliability_{args.split}.png",
    )

    failure_summary = _plot_failure_cases(
        all_records_by_model[primary],
        all_results[primary]["recording_metrics"],
        split_dir=split_dir,
        threshold=float(all_results[primary]["meta"].get("threshold", 0.5)),
        out_path=fig_dir / f"failure_cases_{args.split}.png",
    )

    noise_rows: list[dict[str, Any]] = []
    if not args.skip_noise and raw_dir.exists():
        rec_subset = sorted(all_records_by_model[primary].keys())
        noise_rows = evaluate_noise_robustness(
            primary, ckpt_root / primary, raw_dir, split_dir, rec_subset, cfg, device
        )
        _plot_noise_robustness(noise_rows, fig_dir / f"noise_robustness_sqi_{args.split}.png")

    report_payload = {
        "split": args.split,
        "seed": args.seed,
        "primary_model": primary,
        "models": all_results,
        "noise_robustness": noise_rows,
        "failure_cases": failure_summary,
    }
    (reports_dir / f"metrics_summary_{args.split}.json").write_text(
        json.dumps(report_payload, indent=2), encoding="utf-8"
    )
    write_markdown_table(args.split, all_results, reports_dir / f"benchmark_table_{args.split}.md")
    print(f"\n[OK] Saved evaluation summary & figures into {reports_dir}")


if __name__ == "__main__":
    main()
