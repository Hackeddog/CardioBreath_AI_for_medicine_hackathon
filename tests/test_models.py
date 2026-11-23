"""Unit tests for CardioBreath PyTorch architectures, 1D Grad-CAM, Temperature Scaling, and ONNX export."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import torch

from scripts.export_onnx import export_single_model_to_onnx
from src.calibration import apply_temperature, binary_nll, fit_temperature_scaling
from src.models import build_model, compute_gradcam_1d


@pytest.mark.parametrize(
    ("model_name", "shape"),
    [
        ("cardiobreath", (4, 2, 1200)),
        ("ablation_rri", (4, 1, 1200)),
        ("ablation_edr", (4, 1, 1200)),
        ("ablation_1min", (4, 2, 240)),
        ("raw_cnn", (4, 1, 6000)),
    ],
)
def test_all_model_forward_shapes_and_finiteness(model_name: str, shape: tuple[int, int, int]) -> None:
    torch.manual_seed(42)
    model = build_model(model_name)
    model.eval()
    x = torch.randn(*shape)
    with torch.no_grad():
        logits = model(x)
    assert logits.shape == (shape[0],)
    assert torch.isfinite(logits).all()


def test_gradcam_1d_returns_normalized_saliency_and_cleans_hooks() -> None:
    torch.manual_seed(42)
    model = build_model("cardiobreath")
    x = torch.randn(1, 2, 1200)

    saliency = compute_gradcam_1d(model, x)
    assert saliency.shape == (1200,)
    assert np.isfinite(saliency).all()
    assert float(saliency.min()) >= 0.0
    assert float(saliency.max()) <= 1.0
    # Confirm no dangling hooks left attached
    assert len(model.gradcam_layer._forward_hooks) == 0
    assert len(model.gradcam_layer._backward_hooks) == 0


def test_temperature_scaling_improves_overconfident_nll() -> None:
    rng = np.random.default_rng(42)
    y = rng.integers(0, 2, size=500)
    # Construct deliberately 4x overconfident logits (~78% accuracy but huge logit magnitude)
    base = np.where(y == 1, 1.0, -1.0) + rng.normal(0.0, 1.3, size=500)
    logits = 4.0 * base

    nll_before = binary_nll(logits, y)
    temp = fit_temperature_scaling(logits, y)
    nll_after = binary_nll(logits / temp, y)
    probs = apply_temperature(logits, temp)

    assert temp > 1.5
    assert nll_after < nll_before
    assert float(probs.min()) > 0.0 and float(probs.max()) < 1.0


def test_onnx_export_parity_within_tolerance(tmp_path: Path) -> None:
    import onnxruntime as ort

    torch.manual_seed(42)
    model = build_model("cardiobreath")
    model.eval()
    x_export = torch.randn(1, 2, 1200)
    onnx_path = tmp_path / "cardiobreath_test.onnx"

    max_diff = export_single_model_to_onnx(model, x_export, onnx_path)
    assert onnx_path.exists()
    assert max_diff < 1e-4, f"Expected ONNX parity < 1e-4, got {max_diff}"

    # Verify dynamic batch size works cleanly (export with B=1, run with B=7)
    x_dyn = torch.randn(7, 2, 1200)
    with torch.no_grad():
        pt_dyn = model(x_dyn).numpy()
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    ort_dyn = sess.run(["logits"], {"signals": x_dyn.numpy()})[0]
    assert ort_dyn.shape == (7,)
    assert float(np.max(np.abs(pt_dyn - ort_dyn))) < 1e-4
