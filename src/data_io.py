"""PhysioNet Apnea-ECG data loaders, Challenge 2000 label parser, and CSV upload loader."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd

TRAIN_RECORDS: list[str] = (
    [f"a{i:02d}" for i in range(1, 21)]
    + [f"b{i:02d}" for i in range(1, 6)]
    + [f"c{i:02d}" for i in range(1, 11)]
)
TEST_RECORDS: list[str] = [f"x{i:02d}" for i in range(1, 36)]
RESP_BELT_RECORDS: list[str] = ["a01", "a02", "a03", "a04", "b01", "c01", "c02", "c03"]


def load_ecg_record(record_id: str, raw_dir: str | Path) -> tuple[np.ndarray, float]:
    """Load single-lead ECG signal (float32, mV) and sampling frequency (Hz) from PhysioNet WFDB."""
    import wfdb

    rec_path = str(Path(raw_dir) / record_id)
    rec = wfdb.rdrecord(rec_path)
    ecg = rec.p_signal[:, 0].astype(np.float32)
    # Replace any isolated NaNs via linear interpolation so DSP remains finite
    if np.isnan(ecg).any():
        ecg = pd.Series(ecg).interpolate(limit_direction="both").to_numpy(dtype=np.float32)
    return ecg, float(rec.fs)


def load_train_labels(record_id: str, raw_dir: str | Path) -> np.ndarray:
    """Load minute-by-minute .apn annotations (A -> 1, N -> 0) for a learning-set recording."""
    import wfdb

    rec_path = str(Path(raw_dir) / record_id)
    ann = wfdb.rdann(rec_path, "apn")
    labels = [1 if sym == "A" else 0 for sym in ann.symbol if sym in ("A", "N")]
    return np.asarray(labels, dtype=np.int64)


def parse_event2_answers(answers_path: str | Path) -> dict[str, np.ndarray]:
    """Parse PhysioNet Challenge 2000 `event-2-answers` into {record_id: int64 array (A=1, N=0)}.

    Supports the official Challenge 2000 text structure where each block begins with a record
    header (`x01`..`x35`) followed by lines of `[offset] A N A ...` or contiguous `ANANA...` tokens.
    """
    path = Path(answers_path)
    if not path.exists():
        raise FileNotFoundError(f"Test labels file not found: {path}")

    text = path.read_text(encoding="utf-8", errors="ignore")
    parsed: dict[str, list[int]] = {}
    current_rec: str | None = None
    rec_header_re = re.compile(r"^\s*(x\d{2})\b", re.IGNORECASE)

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        m = rec_header_re.match(line)
        if m:
            current_rec = m.group(1).lower()
            parsed.setdefault(current_rec, [])
            remainder = line[m.end() :].strip()
            if remainder:
                _extract_an_symbols(remainder, parsed[current_rec])
            continue

        if current_rec is not None:
            _extract_an_symbols(line, parsed[current_rec])

    return {rec: np.asarray(vals, dtype=np.int64) for rec, vals in parsed.items() if vals}


def _extract_an_symbols(line: str, target: list[int]) -> None:
    """Extract A/N annotation tokens from a Challenge 2000 line, ignoring numeric minute offsets."""
    # Ignore leading minute index or timestamps like "0" or "60" or "00:00"
    tokens = line.split()
    for tok in tokens:
        if re.fullmatch(r"[AN]+", tok):
            for ch in tok:
                target.append(1 if ch == "A" else 0)


def load_respiratory_signals(
    record_id: str, raw_dir: str | Path
) -> tuple[dict[str, np.ndarray], float]:
    """Load concurrent Resp C, Resp A, Resp N, SpO2 signals from `a01r`..`c03r` multi-sensor files."""
    import wfdb

    r_name = f"{record_id}r"
    rec_path = Path(raw_dir) / r_name
    if not rec_path.with_suffix(".hea").exists():
        raise FileNotFoundError(f"Respiratory record header missing: {rec_path}.hea")

    rec = wfdb.rdrecord(str(rec_path))
    signals: dict[str, np.ndarray] = {}
    for idx, sig_name in enumerate(rec.sig_name):
        arr = rec.p_signal[:, idx].astype(np.float32)
        if np.isnan(arr).any():
            arr = pd.Series(arr).interpolate(limit_direction="both").to_numpy(dtype=np.float32)
        signals[sig_name] = arr
    return signals, float(rec.fs)


def load_uploaded_csv_ecg(csv_bytes_or_path: bytes | str | Path) -> tuple[np.ndarray, float]:
    """Load a user-uploaded single-lead ECG CSV (columns: `ecg`, or `time,ecg`, or 1st numeric col)."""
    if isinstance(csv_bytes_or_path, (bytes, bytearray)):
        from io import BytesIO

        df = pd.read_csv(BytesIO(csv_bytes_or_path))
    else:
        df = pd.read_csv(csv_bytes_or_path)

    cols_lower = {c.strip().lower(): c for c in df.columns}
    fs = 100.0

    if "time" in cols_lower and len(df) > 2:
        t = pd.to_numeric(df[cols_lower["time"]], errors="coerce").dropna().to_numpy()
        if len(t) > 2:
            dt = float(np.median(np.diff(t)))
            if dt > 0:
                fs = round(1.0 / dt, 2)

    ecg_col = None
    for candidate in ("ecg", "voltage", "signal", "lead1", "mlii", "value"):
        if candidate in cols_lower:
            ecg_col = cols_lower[candidate]
            break
    if ecg_col is None:
        numeric_cols = [c for c in df.select_dtypes(include=[np.number]).columns if c != cols_lower.get("time")]
        if not numeric_cols:
            raise ValueError("Uploaded CSV contains no numeric ECG column.")
        ecg_col = numeric_cols[-1]

    ecg = pd.to_numeric(df[ecg_col], errors="coerce").interpolate(limit_direction="both").to_numpy(dtype=np.float32)
    return ecg, fs
