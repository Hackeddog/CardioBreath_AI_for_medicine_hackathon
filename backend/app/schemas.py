"""Pydantic v2 request and response schemas for the CardioBreath clinical triage API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    model_name: str
    n_onnx_folds: int
    smoke_weights: bool
    temperature: float
    default_threshold: float
    lgbm_baseline_available: bool
    gradcam_available: bool
    bench_500min_per_fold_ms: float | None = None


class DemoCaseInfo(BaseModel):
    case_id: str
    split: str
    duration_minutes: int
    duration_hours: float
    true_eahi: float
    clinical_tier: str


class AnalyzeCaseRequest(BaseModel):
    threshold: float | None = Field(default=None, ge=0.1, le=0.9)
    inject_noise_snr_db: float | None = Field(default=None, ge=-5.0, le=30.0)
    compare_baseline: bool = True


class MinutePoint(BaseModel):
    minute: int
    time_label: str
    prob: float
    prob_std: float
    pred: int
    sqi_score: float
    sqi_pass: bool
    baseline_prob: float | None = None
    ground_truth: int | None = None


class FullNightAnalysisResponse(BaseModel):
    case_id: str
    duration_minutes: int
    duration_hours: float
    eahi_pred: float
    eahi_ci90_low: float
    eahi_ci90_high: float
    severity_tier: str
    triage_action: str
    usable_ratio: float
    usable_minutes: int
    deferred_minutes: int
    rhythm_irregular: bool
    rhythm_rmssd_ratio: float
    threshold_used: float
    temperature_used: float
    noise_snr_db: float | None = None
    inference_ms: float
    true_eahi: float | None = None
    minute_acc: float | None = None
    baseline_eahi: float | None = None
    baseline_minute_acc: float | None = None
    default_inspect_minute: int
    timeline: list[MinutePoint]


class WindowInspectorRequest(BaseModel):
    case_id: str
    minute_index: int = Field(ge=0)
    inject_noise_snr_db: float | None = Field(default=None, ge=-5.0, le=30.0)


class WindowInspectorResponse(BaseModel):
    case_id: str
    minute_index: int
    time_window_label: str
    apnea_prob: float
    sqi_score: float
    sqi_pass: bool
    ecg_time_sec: list[float]
    ecg_mv: list[float]
    edr_time_sec: list[float]
    edr_z: list[float]
    rri_bpm: list[float]
    gradcam_saliency: list[float]
