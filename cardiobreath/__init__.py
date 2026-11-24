"""CardioBreath: Standalone Single-Lead ECG Sleep Apnea Pre-Screening Package.

Bundles the 5-fold calibrated ONNX Dual-Stream 1D-CNN + BiGRU ensemble, biomedical
DSP front-end (EDR + RRI + SQI noise abstention gate), and CLI.
"""

from __future__ import annotations

from cardiobreath.predictor import (
    CardioBreathPredictor,
    ScreeningResult,
    predict_array,
    predict_csv,
)

__version__ = "0.1.0"

__all__ = [
    "CardioBreathPredictor",
    "ScreeningResult",
    "__version__",
    "predict_array",
    "predict_csv",
]
