"""PyTorch Dataset and matrix loaders for cached PhysioNet Apnea-ECG tensors."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import numpy as np
import torch
from torch.utils.data import Dataset

InputMode = Literal["dual_5min", "rri_only", "edr_only", "dual_1min", "raw_1min"]

MODEL_TO_MODE: dict[str, InputMode] = {
    "cardiobreath": "dual_5min",
    "ablation_rri": "rri_only",
    "ablation_edr": "edr_only",
    "ablation_1min": "dual_1min",
    "raw_cnn": "raw_1min",
}


def load_processed_record(record_id: str, split_dir: str | Path) -> dict[str, np.ndarray]:
    """Load a preprocessed `.npz` recording into memory."""
    path = Path(split_dir) / f"{record_id}.npz"
    if not path.exists():
        raise FileNotFoundError(f"Preprocessed record not found: {path}. Run scripts/preprocess.py first.")
    with np.load(path, allow_pickle=False) as data:
        return {k: data[k] for k in data.files}


def load_hrv_dataset(
    record_ids: list[str], split_dir: str | Path
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Load stacked (X_hrv, y, sqi_pass, rec_per_minute) for Baseline 1 (LightGBM)."""
    xs, ys, sqis, recs = [], [], [], []
    for rec_id in record_ids:
        d = load_processed_record(rec_id, split_dir)
        n = len(d["labels"])
        xs.append(d["hrv_features"].astype(np.float32))
        ys.append(d["labels"].astype(np.int64))
        sqis.append(d["sqi_pass"].astype(bool))
        recs.extend([rec_id] * n)
    return (
        np.concatenate(xs, axis=0),
        np.concatenate(ys, axis=0),
        np.concatenate(sqis, axis=0),
        recs,
    )


def select_mode_array(rec_dict: dict[str, np.ndarray], mode: InputMode) -> np.ndarray:
    """Slice the exact input tensor array corresponding to a model/ablation mode."""
    if mode == "dual_5min":
        return rec_dict["dual_windows"].astype(np.float32)  # (N, 2, 1200)
    if mode == "edr_only":
        return rec_dict["dual_windows"][:, 0:1, :].astype(np.float32)  # (N, 1, 1200)
    if mode == "rri_only":
        return rec_dict["dual_windows"][:, 1:2, :].astype(np.float32)  # (N, 1, 1200)
    if mode == "dual_1min":
        # Center 60 seconds (240 points @ 4 Hz) out of the 1,200-point 5-min window
        return rec_dict["dual_windows"][:, :, 480:720].astype(np.float32)  # (N, 2, 240)
    if mode == "raw_1min":
        return rec_dict["raw_1min"].astype(np.float32)  # (N, 1, 6000)
    raise ValueError(f"Unsupported input mode: {mode}")


class ApneaWindowDataset(Dataset):
    """Subject-disjoint PyTorch Dataset over cached minute-level ECG/EDR/RRI windows."""

    def __init__(
        self,
        record_ids: list[str],
        split_dir: str | Path,
        mode: InputMode = "dual_5min",
        augment: bool = False,
        only_usable: bool = False,
        seed: int = 42,
    ) -> None:
        self.mode = mode
        self.augment = augment
        self.rng = np.random.default_rng(seed)

        x_list, y_list, sqi_list, rec_list, min_idx_list = [], [], [], [], []
        for rec_id in record_ids:
            d = load_processed_record(rec_id, split_dir)
            x_arr = select_mode_array(d, mode)
            y_arr = d["labels"].astype(np.float32)
            sqi_arr = d["sqi_pass"].astype(bool)
            idx_arr = np.arange(len(y_arr), dtype=np.int64)

            if only_usable and sqi_arr.any():
                x_arr = x_arr[sqi_arr]
                y_arr = y_arr[sqi_arr]
                idx_arr = idx_arr[sqi_arr]
                sqi_arr = sqi_arr[sqi_arr]

            x_list.append(x_arr)
            y_list.append(y_arr)
            sqi_list.append(sqi_arr)
            rec_list.extend([rec_id] * len(y_arr))
            min_idx_list.append(idx_arr)

        self.x = np.concatenate(x_list, axis=0)
        self.y = np.concatenate(y_list, axis=0)
        self.sqi_pass = np.concatenate(sqi_list, axis=0)
        self.record_ids = rec_list
        self.minute_indices = np.concatenate(min_idx_list, axis=0)

    def __len__(self) -> int:
        return len(self.y)

    def _augment_window(self, x: np.ndarray) -> np.ndarray:
        out = x.copy()
        # 1. Mild per-channel amplitude scaling (+/- 10%)
        scales = self.rng.uniform(0.90, 1.10, size=(out.shape[0], 1)).astype(np.float32)
        out *= scales
        # 2. Small time shift (+/- 4s for 4 Hz signals, +/- 1s for 100 Hz raw ECG)
        max_shift = 16 if out.shape[-1] <= 1200 else 100
        shift = int(self.rng.integers(-max_shift, max_shift + 1))
        if shift != 0:
            out = np.roll(out, shift=shift, axis=-1)
        # 3. Light additive sensor jitter
        noise_std = 0.03 if self.mode != "raw_1min" else 0.015
        out += self.rng.normal(0.0, noise_std, size=out.shape).astype(np.float32)
        return out

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.x[idx]
        if self.augment:
            x = self._augment_window(x)
        return torch.from_numpy(np.ascontiguousarray(x)), torch.tensor(self.y[idx], dtype=torch.float32)
