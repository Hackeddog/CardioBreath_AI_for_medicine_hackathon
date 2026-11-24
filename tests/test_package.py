"""Unit tests for the standalone installable `cardiobreath` Python package and CLI."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

import cardiobreath
from cardiobreath.cli import main as cli_main


def _make_synthetic_ecg(minutes: int = 3, fs: float = 100.0) -> np.ndarray:
    n = round(minutes * 60 * fs)
    t = np.arange(n, dtype=np.float64) / fs
    # Clean 66 bpm synthetic QRS train with mild respiratory modulation (0.25 Hz)
    resp = 1.0 + 0.18 * np.sin(2 * np.pi * 0.25 * t)
    beat_period = 60.0 / 66.0
    phase = np.mod(t, beat_period)
    qrs = np.exp(-((phase - 0.15) ** 2) / (2 * 0.012**2)) * resp
    return qrs.astype(np.float32)


def test_package_predictor_array_and_windows() -> None:
    predictor = cardiobreath.CardioBreathPredictor()
    assert len(predictor.sessions) == 5

    ecg = _make_synthetic_ecg(minutes=3, fs=100.0)
    res = predictor.predict_array(ecg, fs=100.0)
    assert res.duration_minutes == 3
    assert 0.0 <= res.eahi_pred <= 60.0
    assert res.severity_tier in {"Normal", "Mild", "Moderate", "Severe"}
    df = res.to_dataframe()
    assert len(df) == 3

    dummy_win = np.zeros((2, 2, 1200), dtype=np.float32)
    p_mean, p_std = predictor.predict_windows(dummy_win)
    assert p_mean.shape == (2,)
    assert p_std.shape == (2,)


def test_package_cli_info_and_predict(tmp_path: Path, capsys) -> None:
    rc_info = cli_main(["info"])
    assert rc_info == 0
    info_json = json.loads(capsys.readouterr().out)
    assert info_json["n_onnx_folds"] == 5

    ecg = _make_synthetic_ecg(minutes=2, fs=100.0)
    csv_file = tmp_path / "test_ecg.csv"
    out_csv = tmp_path / "timeline.csv"
    pd.DataFrame({"ecg": ecg}).to_csv(csv_file, index=False)

    rc_pred = cli_main(["predict", str(csv_file), "--json", "--out-csv", str(out_csv)])
    assert rc_pred == 0
    pred_json = json.loads(capsys.readouterr().out)
    assert pred_json["duration_minutes"] == 2
    assert out_csv.exists()
