"""End-to-end API & inference engine tests verifying ONNX 5-fold scoring, SQI abstention,
1D Grad-CAM saliency, CSV upload, Pydantic schema validation, and FastAPI route wiring.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from fastapi.testclient import TestClient

import backend.app.main as main_mod
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


def test_path_traversal_case_id_rejected() -> None:
    with pytest.raises(ValueError, match="Invalid case_id"):
        engine._load_raw_case("../x08")

    client = TestClient(app)
    resp = client.post("/api/analyze/case/..%2F..%2Fconfigs%2Fdefault", json={})
    assert resp.status_code in (400, 404, 405)

    win_resp = client.post("/api/analyze/window", json={"case_id": "../x08", "minute_index": 0})
    assert win_resp.status_code == 400


def test_upload_exceeding_max_size_returns_413(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main_mod, "MAX_UPLOAD_BYTES", 1024)
    client = TestClient(app)
    resp = client.post(
        "/api/analyze/upload",
        files={"file": ("big.csv", b"time,ecg\n" + b"0.00,0.1\n" * 200, "text/csv")},
    )
    assert resp.status_code == 413


def test_upload_invalid_threshold_returns_422() -> None:
    client = TestClient(app)
    for bad_thr in (0.99, 0.01):
        resp = client.post(
            f"/api/analyze/upload?threshold={bad_thr}",
            files={"file": ("small.csv", b"time,ecg\n0.00,0.1\n", "text/csv")},
        )
        assert resp.status_code == 422


def test_concurrent_window_inspect_gradcam_thread_safe() -> None:
    req = WindowInspectorRequest(case_id="x08", minute_index=120)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: inspect_window(req), range(6)))

    ref = np.asarray(results[0]["gradcam_saliency"], dtype=np.float32)
    assert len(ref) == 600
    assert np.all(np.isfinite(ref))
    assert float(ref.min()) >= 0.0 and float(ref.max()) <= 1.0
    for res in results[1:]:
        cur = np.asarray(res["gradcam_saliency"], dtype=np.float32)
        assert np.allclose(cur, ref, atol=1e-5)


def test_cors_wildcard_disables_credentials() -> None:
    client = TestClient(app)
    resp = client.options(
        "/api/health",
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.headers.get("access-control-allow-origin") == "*"
    assert resp.headers.get("access-control-allow-credentials") != "true"


def test_csv_upload_non_100hz_sampling_rate() -> None:
    fs = 250
    n = 180 * fs
    t = np.arange(n) / fs
    ecg = np.zeros(n, dtype=np.float32)
    for beat_t in np.arange(0.5, 179.5, 0.9):
        idx = round(beat_t * fs)
        lo, hi = max(0, idx - 15), min(n, idx + 16)
        dt = (np.arange(lo, hi) - idx) / fs
        ecg[lo:hi] += np.exp(-0.5 * (dt / 0.015) ** 2)
    lines = ["time,ecg"] + [f"{ti:.3f},{vi:.4f}" for ti, vi in zip(t, ecg)]
    csv_bytes = "\n".join(lines).encode("utf-8")

    case_id = engine.register_uploaded_csv(csv_bytes, "ecg_250hz.csv")
    body = FullNightAnalysisResponse(
        **engine.analyze_case(case_id=case_id, compare_baseline=True)
    )
    assert body.duration_minutes == 3

    win = WindowInspectorResponse(
        **inspect_window(WindowInspectorRequest(case_id=case_id, minute_index=1))
    )
    assert len(win.ecg_mv) >= 500
    assert 135.0 <= win.ecg_time_sec[0] < win.ecg_time_sec[-1] <= 166.0


def test_upload_non_numeric_ecg_column_returns_400() -> None:
    client = TestClient(app)
    rows = "".join(f"{i / 100:.2f},bad\n" for i in range(6100))
    resp = client.post(
        "/api/analyze/upload",
        files={"file": ("text.csv", ("time,ecg\n" + rows).encode(), "text/csv")},
    )
    assert resp.status_code == 400


def test_csv_fallback_column_never_picks_time() -> None:
    from src.data_io import load_uploaded_csv_ecg

    ecg, fs = load_uploaded_csv_ecg(b"mV,time\n0.5,0.00\n0.6,0.01\n0.7,0.02\n0.8,0.03\n")
    assert fs == 100.0
    assert np.allclose(ecg, [0.5, 0.6, 0.7, 0.8])
