"""FastAPI server for CardioBreath clinical triage API and static Next.js production hosting."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.inference import CardioBreathInferenceEngine
from backend.app.schemas import (
    AnalyzeCaseRequest,
    DemoCaseInfo,
    FullNightAnalysisResponse,
    HealthResponse,
    WindowInspectorRequest,
    WindowInspectorResponse,
)

app = FastAPI(
    title="CardioBreath Clinical Triage API",
    description="Single-Lead ECG Sleep Apnea Screening via Cardiopulmonary Coupling (5-Fold ONNX Ensemble).",
    version="1.0.0",
)

MAX_UPLOAD_BYTES = int(os.getenv("CARDIOBREATH_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
UPLOAD_CHUNK_BYTES = 1024 * 1024

_raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "*").strip()
_allow_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()] or ["*"]
_allow_credentials = "*" not in _allow_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

engine = CardioBreathInferenceEngine()


@app.get("/api/health", response_model=HealthResponse)
def get_health() -> dict:
    return engine.health()


@app.get("/api/cases", response_model=list[DemoCaseInfo])
def get_cases() -> list[dict]:
    return engine.list_cases()


@app.post("/api/analyze/case/{case_id}", response_model=FullNightAnalysisResponse)
def analyze_case(case_id: str, req: AnalyzeCaseRequest) -> dict:
    try:
        return engine.analyze_case(
            case_id=case_id,
            threshold=req.threshold,
            inject_noise_snr_db=req.inject_noise_snr_db,
            compare_baseline=req.compare_baseline,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/analyze/window", response_model=WindowInspectorResponse)
def inspect_window(req: WindowInspectorRequest) -> dict:
    try:
        return engine.inspect_window(
            case_id=req.case_id,
            minute_index=req.minute_index,
            inject_noise_snr_db=req.inject_noise_snr_db,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/analyze/upload", response_model=FullNightAnalysisResponse)
async def upload_ecg(
    file: Annotated[UploadFile, File(...)],
    threshold: Annotated[float | None, Query(ge=0.1, le=0.9)] = None,
) -> dict:
    try:
        buf = bytearray()
        while True:
            chunk = await file.read(UPLOAD_CHUNK_BYTES)
            if not chunk:
                break
            buf.extend(chunk)
            if len(buf) > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Uploaded file exceeds maximum allowed size of {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
                )
        content = bytes(buf)
        # CPU-bound parsing + DSP + ONNX must not run on the event loop, or every other request stalls
        case_id = await run_in_threadpool(engine.register_uploaded_csv, content, file.filename or "upload.csv")
        return await run_in_threadpool(
            engine.analyze_case, case_id=case_id, threshold=threshold, compare_baseline=True
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/evaluation")
def get_evaluation() -> dict:
    return engine.get_evaluation_report()


# Serve real evaluation PNG figures directly for the Research & Clinical Honesty tab
figures_dir = REPO_ROOT / "reports" / "figures"
if figures_dir.exists():
    app.mount("/api/figures", StaticFiles(directory=str(figures_dir)), name="figures")

# Serve compiled Next.js static export (`frontend/out`) on root when present (Hugging Face Spaces Docker)
frontend_out = REPO_ROOT / "frontend" / "out"
if frontend_out.exists():
    app.mount("/", StaticFiles(directory=str(frontend_out), html=True), name="frontend")
