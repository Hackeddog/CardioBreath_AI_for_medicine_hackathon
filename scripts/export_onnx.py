"""Export trained PyTorch fold checkpoints to ONNX (+ optional INT8 quantization),
verify numerical parity against PyTorch, and benchmark full-night CPU inference latency.
"""

from __future__ import annotations

import argparse
import inspect
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.config import load_config, resolve_path
from src.models import build_model


def export_single_model_to_onnx(
    model: torch.nn.Module,
    sample_input: torch.Tensor,
    onnx_path: Path,
) -> float:
    """Export PyTorch model to ONNX (opset 17, dynamic batch) and return max abs diff vs PyTorch."""
    model.eval()
    onnx_path.parent.mkdir(parents=True, exist_ok=True)

    export_kwargs: dict = {
        "input_names": ["signals"],
        "output_names": ["logits"],
        "dynamic_axes": {"signals": {0: "batch_size"}, "logits": {0: "batch_size"}},
        "opset_version": 17,
        "do_constant_folding": True,
    }
    if "dynamo" in inspect.signature(torch.onnx.export).parameters:
        export_kwargs["dynamo"] = False

    torch.onnx.export(model, (sample_input,), str(onnx_path), **export_kwargs)

    # Verify numerical parity against PyTorch via ONNX Runtime CPU
    with torch.no_grad():
        pt_out = model(sample_input).cpu().numpy()

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    ort_out = sess.run(["logits"], {"signals": sample_input.cpu().numpy()})[0]
    max_diff = float(np.max(np.abs(pt_out - ort_out)))
    return max_diff


def export_checkpoints(
    model_name: str,
    cfg: dict,
    quantize: bool = False,
) -> dict:
    ckpt_dir = resolve_path(cfg["paths"]["checkpoints_dir"]) / model_name
    onnx_dir = resolve_path(cfg["paths"]["onnx_dir"]) / model_name
    onnx_dir.mkdir(parents=True, exist_ok=True)

    ckpt_files = sorted(ckpt_dir.glob("fold_*.pt"))
    if not ckpt_files:
        raise FileNotFoundError(f"No fold_*.pt checkpoints found in {ckpt_dir}. Run train.py first.")

    in_channels = 1 if model_name in ("ablation_rri", "ablation_edr", "raw_cnn") else 2
    seq_len = 6000 if model_name == "raw_cnn" else (240 if model_name == "ablation_1min" else 1200)
    rng = np.random.default_rng(42)
    sample_x = torch.from_numpy(rng.standard_normal((1, in_channels, seq_len)).astype(np.float32))

    exported = []
    sessions = []
    for ckpt_path in ckpt_files:
        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        model = build_model(model_name, {"model": ckpt.get("model_config", cfg["model"])})
        model.load_state_dict(ckpt["state_dict"])
        model.eval()

        onnx_path = onnx_dir / f"{model_name}_{ckpt_path.stem}.onnx"
        max_diff = export_single_model_to_onnx(model, sample_x, onnx_path)
        size_mb = onnx_path.stat().st_size / (1024 * 1024)
        print(f"  [onnx] {onnx_path.name}: size={size_mb:.2f} MB | parity_max_diff={max_diff:.2e}")
        if max_diff >= 1e-3:
            raise RuntimeError(f"ONNX numerical parity exceeded tolerance: {max_diff}")

        entry = {"fold": ckpt_path.stem, "onnx_file": onnx_path.name, "size_mb": round(size_mb, 3), "max_diff": round(max_diff, 7)}

        if quantize:
            from onnxruntime.quantization import QuantType, quantize_dynamic

            q_path = onnx_dir / f"{model_name}_{ckpt_path.stem}_int8.onnx"
            quantize_dynamic(str(onnx_path), str(q_path), weight_type=QuantType.QInt8)
            entry["int8_file"] = q_path.name
            entry["int8_size_mb"] = round(q_path.stat().st_size / (1024 * 1024), 3)

        exported.append(entry)
        sessions.append(ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"]))

    # Benchmark full 8-hour night (500 minutes) CPU inference latency across the ensemble
    night_x = rng.standard_normal((500, in_channels, seq_len)).astype(np.float32)
    # Warmup
    _ = sessions[0].run(["logits"], {"signals": night_x[:16]})
    t0 = time.perf_counter()
    for sess in sessions:
        _ = sess.run(["logits"], {"signals": night_x})
    total_ms = (time.perf_counter() - t0) * 1000.0
    per_fold_ms = total_ms / len(sessions)

    # Copy calibration metadata alongside ONNX weights for self-contained backend loading
    cv_summary_path = ckpt_dir / "cv_summary.json"
    cv_meta = json.loads(cv_summary_path.read_text(encoding="utf-8")) if cv_summary_path.exists() else {}
    deploy_meta = {
        "model": model_name,
        "smoke": cv_meta.get("smoke", False),
        "n_folds": len(exported),
        "in_channels": in_channels,
        "seq_len": seq_len,
        "temperature": cv_meta.get("temperature", 1.0),
        "threshold": cv_meta.get("threshold", 0.5),
        "oof_auroc": cv_meta.get("oof_auroc"),
        "bench_500min_total_ms": round(total_ms, 1),
        "bench_500min_per_fold_ms": round(per_fold_ms, 1),
        "exports": exported,
    }
    (onnx_dir / "deploy_metadata.json").write_text(json.dumps(deploy_meta, indent=2), encoding="utf-8")
    print(
        f"[OK] Exported {len(exported)} ONNX models to {onnx_dir} | "
        f"500-min CPU latency: {per_fold_ms:.1f} ms/fold ({total_ms:.1f} ms full ensemble)"
    )
    return deploy_meta


def main() -> None:
    parser = argparse.ArgumentParser(description="Export CardioBreath checkpoints to ONNX.")
    parser.add_argument("--model", default="cardiobreath")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--quantize", action="store_true", help="Also emit dynamic INT8 quantized ONNX.")
    args = parser.parse_args()

    cfg = load_config(args.config)
    export_checkpoints(args.model, cfg, quantize=args.quantize)


if __name__ == "__main__":
    main()
