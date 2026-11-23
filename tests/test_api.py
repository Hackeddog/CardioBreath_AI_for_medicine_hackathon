"""End-to-end API & inference engine tests verifying ONNX 5-fold scoring, SQI abstention,
1D Grad-CAM saliency, CSV upload, Pydantic schema validation, and FastAPI route wiring.
"""

from __future__ import annotations

import numpy as np

from backend.app.main import (
    analyze_case,
    app,
    engine,
    get_cases,
    get_evaluation,
    get_health,
    inspect_window,
)
from backend.app.schemas import (
    AnalyzeCaseRequest,
    DemoCaseInfo,
    FullNightAnalysisResponse,
    HealthResponse,
    WindowInspectorRequest,
    WindowInspectorResponse,
)


def test_fastapi_routes_registered() -> None:
    paths = {getattr(r, "path", "") for r in app.routes}
    assert "/api/health" in paths
    assert "/api/cases" in paths
    assert "/api/analyze/case/{case_id}" in paths
    assert "/api/analyze/window" in paths
    assert "/api/analyze/upload" in paths
    assert "/api/evaluation" in paths


def test_health_reports_five_onnx_folds_and_gradcam() -> None:
    body = HealthResponse(**get_health())
    assert body.status == "ok"
    assert body.n_onnx_folds == 5
    assert body.smoke_weights is False
    assert body.lgbm_baseline_available is True
    assert body.gradcam_available is True


def test_cases_lists_all_four_held_out_severity_tiers() -> None:
    cases = [DemoCaseInfo(**c) for c in get_cases()]
    ids = [c.case_id for c in cases]
    assert ids == ["x08", "x09", "x21", "x04"]


def test_analyze_severe_and_normal_held_out_nights() -> None:
    sev = FullNightAnalysisResponse(
        **analyze_case("x08", AnalyzeCaseRequest(compare_baseline=True))
    )
    assert sev.severity_tier == "Severe"
    assert sev.eahi_pred >= 30.0
    assert sev.eahi_ci90_low <= sev.eahi_pred <= sev.eahi_ci90_high
    assert sev.baseline_eahi is not None
    assert len(sev.timeline) == sev.duration_minutes

    norm = FullNightAnalysisResponse(
        **analyze_case("x04", AnalyzeCaseRequest(compare_baseline=True))
    )
    assert norm.severity_tier == "Normal"
    assert norm.eahi_pred < 5.0


def test_motion_noise_stress_triggers_sqi_abstention() -> None:
    clean = analyze_case("x08", AnalyzeCaseRequest(compare_baseline=False))
    noisy = analyze_case(
        "x08",
        AnalyzeCaseRequest(inject_noise_snr_db=0.0, compare_baseline=False),
    )
    assert noisy["deferred_minutes"] > clean["deferred_minutes"]
    assert noisy["usable_ratio"] < clean["usable_ratio"]


def test_window_inspector_returns_synced_signals_and_gradcam() -> None:
    win = WindowInspectorResponse(
        **inspect_window(WindowInspectorRequest(case_id="x08", minute_index=120))
    )
    assert len(win.edr_time_sec) == 600
    assert len(win.edr_z) == 600
    assert len(win.rri_bpm) == 600
    assert len(win.gradcam_saliency) == 600
    assert len(win.ecg_mv) > 100
    assert min(win.gradcam_saliency) >= 0.0
    assert max(win.gradcam_saliency) <= 1.0


def test_csv_upload_runs_end_to_end() -> None:
    # Synthesize 3 minutes of 100 Hz clean ECG CSV
    fs = 100
    n = 180 * fs
    t = np.arange(n) / fs
    ecg = np.zeros(n, dtype=np.float32)
    for beat_t in np.arange(0.5, 179.5, 0.9):
        idx = round(beat_t * fs)
        lo, hi = max(0, idx - 8), min(n, idx + 9)
        dt = (np.arange(lo, hi) - idx) / fs
        ecg[lo:hi] += np.exp(-0.5 * (dt / 0.015) ** 2)
    lines = ["time,ecg"] + [f"{ti:.2f},{vi:.4f}" for ti, vi in zip(t, ecg)]
    csv_bytes = "\n".join(lines).encode("utf-8")

    case_id = engine.register_uploaded_csv(csv_bytes, "sample_ecg.csv")
    body = FullNightAnalysisResponse(
        **engine.analyze_case(case_id=case_id, compare_baseline=True)
    )
    assert body.case_id.startswith("upload_")
    assert body.duration_minutes == 3


def test_evaluation_endpoint_exposes_locked_test_results() -> None:
    body = get_evaluation()
    assert body["test"]["models"]["cardiobreath"]["minute_metrics"]["auroc"] > 0.96
    assert len(body["figures"]) >= 5
