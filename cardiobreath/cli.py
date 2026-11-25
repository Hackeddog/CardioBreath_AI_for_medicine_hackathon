"""Command-line interface (`cardiobreath`) for standalone sleep apnea pre-screening."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cardiobreath import __version__
from cardiobreath.predictor import CardioBreathPredictor


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cardiobreath",
        description="CardioBreath — Single-Lead ECG Sleep Apnea Pre-Screening (5-Fold ONNX Ensemble)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("info", help="Display bundled ONNX model info and calibration metadata.")

    p_pred = sub.add_parser("predict", help="Screen a single-lead ECG CSV file.")
    p_pred.add_argument("csv_path", type=Path, help="Path to single-lead ECG .csv (`ecg` or `time,ecg`).")
    p_pred.add_argument("--fs", type=float, default=100.0, help="Fallback sampling rate in Hz (default: 100).")
    p_pred.add_argument("--threshold", type=float, default=None, help="Override CV decision cutoff (0.60).")
    p_pred.add_argument("--json", action="store_true", help="Print structured JSON summary.")
    p_pred.add_argument("--out-csv", type=Path, default=None, help="Save minute-by-minute timeline CSV.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    predictor = CardioBreathPredictor()

    if args.command == "info":
        payload = {
            "package": "cardiobreath",
            "version": __version__,
            "n_onnx_folds": len(predictor.sessions),
            "temperature": round(predictor.temperature, 4),
            "default_threshold": round(predictor.default_threshold, 4),
            "held_out_test_auroc": 0.972,  # reports/metrics_summary_test.json
            "held_out_eahi_mae": 3.52,
        }
        print(json.dumps(payload, indent=2))
        return 0

    if args.command == "predict":
        if not args.csv_path.exists():
            print(f"Error: CSV file not found: {args.csv_path}", file=sys.stderr)
            return 1

        res = predictor.predict_csv(args.csv_path, default_fs=args.fs, threshold=args.threshold)
        if args.out_csv is not None:
            res.to_dataframe().to_csv(args.out_csv, index=False)

        if args.json:
            print(json.dumps(res.to_dict(), indent=2))
        else:
            print("=" * 64)
            print(f"CardioBreath Pre-Screening Summary — {args.csv_path.name}")
            print("=" * 64)
            print(
                f"Estimated Apnea Burden (eAHI): {res.eahi_pred:.1f} /hr "
                f"(90% CI [{res.eahi_ci90_low:.1f}, {res.eahi_ci90_high:.1f}])"
            )
            print(f"Severity Tier:                 {res.severity_tier}")
            print(f"Triage Recommendation:         {res.triage_action}")
            print(
                f"Signal Quality Coverage:       {res.usable_minutes}/{res.duration_minutes} min "
                f"({res.usable_ratio * 100:.1f}% usable, {res.deferred_minutes} deferred)"
            )
            rhythm_lbl = "Irregular / Suspect AFib" if res.rhythm_irregular else "Sinus"
            print(f"Rhythm Confounder Check:       {rhythm_lbl} (RMSSD/RR={res.rhythm_rmssd_ratio:.3f})")
            print(f"5-Fold ONNX CPU Runtime:       {res.inference_ms:.1f} ms")
            if args.out_csv is not None:
                print(f"Saved Minute Timeline CSV:     {args.out_csv}")
            print("-" * 64)
            print("Note: Pre-screening triage estimate only — not clinical diagnosis.")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
