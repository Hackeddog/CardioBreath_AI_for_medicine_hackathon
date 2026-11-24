from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.image as mpimg
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

MODEL_LABELS = {
    "lgbm": "Baseline 1: HRV + LightGBM",
    "raw_cnn": "Baseline 2: Raw 1-min ECG CNN",
    "ablation_rri": "Ablation A: RRI-Only (5-min)",
    "ablation_edr": "Ablation B: EDR-Only (5-min)",
    "ablation_1min": "Ablation C: Dual-Stream (1-min)",
    "cardiobreath": "CardioBreath (Dual-Stream 5-Fold)",
}

TEST_FIGURES = [
    ("ROC & Precision-Recall Curves (Test)", "roc_pr_curves_test.png"),
    ("Bland-Altman eAHI Agreement (Test)", "bland_altman_eahi_test.png"),
    ("Calibration Reliability (Test)", "calibration_reliability_test.png"),
    ("Motion-Noise SQI Robustness (Test)", "noise_robustness_sqi_test.png"),
    ("8-Night Physical EDR Belt Validation", "edr_belt_validation.png"),
    ("Held-Out Failure Case Analysis (Test)", "failure_cases_test.png"),
]


def _benchmark_rows(summary: dict) -> list[list[str]]:
    rows = []
    for key, label in MODEL_LABELS.items():
        if key not in summary.get("models", {}):
            continue
        m = summary["models"][key]["minute_metrics"]
        r = summary["models"][key]["recording_metrics"]
        s5 = r["screening_cutoff_5"]["sensitivity"]
        rows.append(
            [
                label,
                f"{m['auroc']:.3f}",
                f"{m['auprc']:.3f}",
                f"{m['accuracy']:.3f}",
                f"{m['sensitivity']:.3f}",
                f"{m['specificity']:.3f}",
                f"{m['f1']:.3f}",
                f"{r['eahi_mae']:.2f}",
                f"{r['eahi_pearson_r']:.3f}",
                f"{s5:.3f}",
                f"{m['ece']:.3f}",
            ]
        )
    return rows


def _render_table(ax: plt.Axes, title: str, cols: list[str], rows: list[list[str]], font_size: float = 8.0) -> None:
    ax.axis("off")
    ax.set_title(title, fontsize=11, fontweight="bold", loc="left", pad=8, color="#0F2942")
    tbl = ax.table(cellText=rows, colLabels=cols, loc="center", cellLoc="center")
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(font_size)
    tbl.scale(1.0, 1.35)
    for (r_idx, c_idx), cell in tbl.get_celld().items():
        cell.set_edgecolor("#CBD5E1")
        if r_idx == 0:
            cell.set_facecolor("#0F2942")
            cell.set_text_props(color="white", fontweight="bold")
        else:
            if c_idx == 0:
                cell.set_text_props(ha="left")
            if r_idx == len(rows):
                cell.set_facecolor("#CCFBF1")
                cell.set_text_props(fontweight="bold")
            elif r_idx % 2 == 0:
                cell.set_facecolor("#F8FAFC")


def export_pdf(reports_dir: Path, output_path: Path, include_figures: bool = True) -> Path:
    test_path = reports_dir / "metrics_summary_test.json"
    val_path = reports_dir / "metrics_summary_val.json"
    belt_path = reports_dir / "edr_belt_validation.json"

    test_data = json.loads(test_path.read_text(encoding="utf-8"))
    val_data = json.loads(val_path.read_text(encoding="utf-8")) if val_path.exists() else None
    belt_data = json.loads(belt_path.read_text(encoding="utf-8")) if belt_path.exists() else None

    bench_cols = ["Model", "AUROC", "AUPRC", "Acc", "Sens", "Spec", "F1", "eAHI MAE", "r", "Scr>=5", "ECE"]
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with PdfPages(output_path) as pdf:
        fig = plt.figure(figsize=(11, 8.5))
        fig.suptitle(
            "CardioBreath — Evaluation Results Summary",
            fontsize=15,
            fontweight="bold",
            color="#0F2942",
            y=0.97,
        )

        ax1 = fig.add_axes([0.04, 0.54, 0.92, 0.34])
        _render_table(ax1, "Locked Held-Out Test Set (x01–x35, 35 Nights)", bench_cols, _benchmark_rows(test_data))

        if val_data is not None:
            ax2 = fig.add_axes([0.04, 0.16, 0.92, 0.34])
            _render_table(ax2, "5-Fold Subject-Disjoint CV (a01–c10, 35 Nights)", bench_cols, _benchmark_rows(val_data))

        if belt_data is not None:
            footer = (
                f"Physical EDR Belt Validation ({belt_data['n_records_validated']} nights): "
                f"Breathing Rate MAE = {belt_data['mean_breathing_rate_mae_bpm']:.2f} bpm | "
                f"Mean Best-60s Corr = {belt_data['mean_best_60s_abs_corr']:.3f}"
            )
            fig.text(0.04, 0.06, footer, fontsize=9.5, color="#0D9488", fontweight="bold")

        pdf.savefig(fig)
        plt.close(fig)

        cb_records = test_data["models"]["cardiobreath"]["recording_metrics"]["per_record"]
        rec_cols = ["Record", "Minutes", "Usable %", "True eAHI", "Pred eAHI", "Abs Err", "True Tier", "Pred Tier", "Min Acc"]
        rec_rows = [
            [
                rec["record_id"],
                str(rec["n_minutes"]),
                f"{rec['usable_ratio'] * 100:.1f}%",
                f"{rec['true_eahi']:.2f}",
                f"{rec['pred_eahi']:.2f}",
                f"{rec['abs_err_eahi']:.2f}",
                rec["true_tier"],
                rec["pred_tier"],
                f"{rec['minute_acc']:.3f}",
            ]
            for rec in cb_records
        ]

        fig = plt.figure(figsize=(8.5, 11))
        ax = fig.add_axes([0.05, 0.04, 0.90, 0.90])
        ax.axis("off")
        ax.set_title(
            "CardioBreath Per-Night Test Results (x01–x35)",
            fontsize=13,
            fontweight="bold",
            loc="left",
            pad=10,
            color="#0F2942",
        )
        tbl = ax.table(cellText=rec_rows, colLabels=rec_cols, loc="center", cellLoc="center")
        tbl.auto_set_font_size(False)
        tbl.set_fontsize(7.5)
        tbl.scale(1.0, 1.18)
        for (r_idx, _), cell in tbl.get_celld().items():
            cell.set_edgecolor("#CBD5E1")
            if r_idx == 0:
                cell.set_facecolor("#0F2942")
                cell.set_text_props(color="white", fontweight="bold")
            elif r_idx % 2 == 0:
                cell.set_facecolor("#F8FAFC")
        pdf.savefig(fig)
        plt.close(fig)

        if include_figures:
            fig_dir = reports_dir / "figures"
            for title, fname in TEST_FIGURES:
                fpath = fig_dir / fname
                if not fpath.exists():
                    continue
                img = mpimg.imread(fpath)
                fig, ax = plt.subplots(figsize=(11, 8.5))
                ax.imshow(img)
                ax.axis("off")
                ax.set_title(title, fontsize=13, fontweight="bold", color="#0F2942", pad=12)
                fig.tight_layout()
                pdf.savefig(fig)
                plt.close(fig)

    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Export CardioBreath evaluation metrics and figures to PDF.")
    parser.add_argument("--reports-dir", type=Path, default=Path("reports"))
    parser.add_argument("--output", type=Path, default=Path("reports/cardiobreath_results.pdf"))
    parser.add_argument("--no-figures", action="store_true")
    args = parser.parse_args()

    out = export_pdf(args.reports_dir, args.output, include_figures=not args.no_figures)
    print(f"[OK] Wrote PDF report to {out.resolve()}")


if __name__ == "__main__":
    main()
