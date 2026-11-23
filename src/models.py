"""Deep learning architectures for CardioBreath + 1D Grad-CAM explainability.

Includes:
  - CardioBreathNet: Dual-Stream (EDR + RRI) Multi-Scale 1D-CNN + 2-Layer BiGRU + Temporal Attention
  - RawECGCNN: Baseline 2 end-to-end 1D-CNN on raw 1-minute 100 Hz ECG
  - compute_gradcam_1d: Clean hook-based 1D Grad-CAM saliency attribution for dashboard overlays
"""

from __future__ import annotations

from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn


class SqueezeExcite1D(nn.Module):
    """Channel attention gating across multi-scale convolutional feature maps."""

    def __init__(self, channels: int, reduction: int = 4) -> None:
        super().__init__()
        mid = max(channels // reduction, 8)
        self.fc1 = nn.Linear(channels, mid)
        self.fc2 = nn.Linear(mid, channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        w = x.mean(dim=-1)
        w = torch.sigmoid(self.fc2(F.gelu(self.fc1(w)))).unsqueeze(-1)
        return x * w


class MultiScaleBlock1D(nn.Module):
    """Parallel multi-scale 1D convolutions capturing ~5s, ~15s, and ~31s apnea/breathing cycles."""

    def __init__(
        self,
        in_channels: int,
        branch_channels: int = 32,
        kernels: tuple[int, ...] = (5, 15, 31),
        dropout: float = 0.2,
    ) -> None:
        super().__init__()
        self.branches = nn.ModuleList(
            [
                nn.Sequential(
                    nn.Conv1d(in_channels, branch_channels, kernel_size=k, padding=k // 2, bias=False),
                    nn.BatchNorm1d(branch_channels),
                    nn.GELU(),
                )
                for k in kernels
            ]
        )
        out_ch = branch_channels * len(kernels)
        self.se = SqueezeExcite1D(out_ch)
        self.proj = nn.Sequential(
            nn.Conv1d(out_ch, out_ch, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm1d(out_ch),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.skip = (
            nn.Conv1d(in_channels, out_ch, kernel_size=1, bias=False)
            if in_channels != out_ch
            else nn.Identity()
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        feats = torch.cat([b(x) for b in self.branches], dim=1)
        feats = self.se(feats)
        return self.proj(feats) + self.skip(x)


class TemporalAttentionPool(nn.Module):
    """Learned attention pooling across compressed temporal steps (focusing on apnea-arousal cycles)."""

    def __init__(self, hidden_dim: int) -> None:
        super().__init__()
        self.attn = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.Tanh(),
            nn.Linear(hidden_dim // 2, 1),
        )

    def forward(self, seq: torch.Tensor) -> torch.Tensor:
        # seq: (B, T, D)
        scores = self.attn(seq)  # (B, T, 1)
        weights = torch.softmax(scores, dim=1)
        return torch.sum(seq * weights, dim=1)


class CardioBreathNet(nn.Module):
    """Dual-Stream Multi-Scale 1D-CNN + BiGRU hybrid for cardiopulmonary sleep apnea detection.

    Supports both dual-stream `(B, 2, 1200)` / `(B, 2, 240)` and single-stream ablations `(B, 1, 1200)`.
    """

    def __init__(
        self,
        in_channels: int = 2,
        cnn_channels: int = 32,
        kernels: tuple[int, ...] = (5, 15, 31),
        gru_hidden: int = 96,
        gru_layers: int = 2,
        dropout: float = 0.30,
    ) -> None:
        super().__init__()
        self.in_channels = in_channels

        # Separate modality stems when both EDR and RRI are present; shared stem for 1-ch ablations
        if in_channels == 2:
            stem_ch = max(cnn_channels // 2, 16)
            self.edr_stem = self._make_stem(1, stem_ch)
            self.rri_stem = self._make_stem(1, stem_ch)
            fused_in = stem_ch * 2
        else:
            self.shared_stem = self._make_stem(in_channels, cnn_channels)
            fused_in = cnn_channels

        # Multi-Scale 1D-CNN operating at 1 Hz effective rate (1200 -> 300 after /4 stem)
        self.multiscale = MultiScaleBlock1D(
            in_channels=fused_in,
            branch_channels=cnn_channels,
            kernels=kernels,
            dropout=dropout * 0.6,
        )
        ms_out = cnn_channels * len(kernels)

        # Target convolutional layer for 1D Grad-CAM saliency attribution (300 -> 75 steps)
        self.gradcam_layer = nn.Sequential(
            nn.Conv1d(ms_out, ms_out, kernel_size=5, stride=2, padding=2, bias=False),
            nn.BatchNorm1d(ms_out),
            nn.GELU(),
            nn.AvgPool1d(kernel_size=2, stride=2),
            nn.Dropout(dropout * 0.5),
        )

        self.gru = nn.GRU(
            input_size=ms_out,
            hidden_size=gru_hidden,
            num_layers=gru_layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout if gru_layers > 1 else 0.0,
        )
        self.pool = TemporalAttentionPool(gru_hidden * 2)
        self.head = nn.Sequential(
            nn.LayerNorm(gru_hidden * 2),
            nn.Dropout(dropout),
            nn.Linear(gru_hidden * 2, 1),
        )

    @staticmethod
    def _make_stem(in_ch: int, out_ch: int) -> nn.Sequential:
        # Downsamples 4 Hz -> 1 Hz (/4) cleanly while preserving beat-to-beat breathing envelopes
        return nn.Sequential(
            nn.Conv1d(in_ch, out_ch, kernel_size=7, stride=2, padding=3, bias=False),
            nn.BatchNorm1d(out_ch),
            nn.GELU(),
            nn.MaxPool1d(kernel_size=2, stride=2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.in_channels == 2:
            h_edr = self.edr_stem(x[:, 0:1, :])
            h_rri = self.rri_stem(x[:, 1:2, :])
            h = torch.cat([h_edr, h_rri], dim=1)
        else:
            h = self.shared_stem(x)

        h = self.multiscale(h)
        h = self.gradcam_layer(h)  # (B, C, T_down)
        seq = h.transpose(1, 2)  # (B, T_down, C)
        # Explicitly build h0 from dynamic batch size so ONNX Runtime supports arbitrary batch sizes
        num_dirs = 2 if self.gru.bidirectional else 1
        h0 = seq.new_zeros(self.gru.num_layers * num_dirs, seq.size(0), self.gru.hidden_size)
        out, _ = self.gru(seq, h0)  # (B, T_down, 2*H)
        pooled = self.pool(out)  # (B, 2*H)
        return self.head(pooled).squeeze(-1)  # (B,)


class RawECGCNN(nn.Module):
    """Baseline 2: End-to-end 1D-CNN operating directly on raw 1-minute 100 Hz ECG `(B, 1, 6000)`."""

    def __init__(self, dropout: float = 0.30) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv1d(1, 24, kernel_size=15, stride=2, padding=7, bias=False),
            nn.BatchNorm1d(24),
            nn.GELU(),
            nn.MaxPool1d(4),  # 6000 -> 750
            nn.Conv1d(24, 48, kernel_size=11, stride=2, padding=5, bias=False),
            nn.BatchNorm1d(48),
            nn.GELU(),
            nn.MaxPool1d(4),  # 750 -> 93
            nn.Conv1d(48, 96, kernel_size=7, stride=2, padding=3, bias=False),
            nn.BatchNorm1d(96),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
        )
        self.gradcam_layer = nn.Sequential(
            nn.Conv1d(96, 128, kernel_size=5, padding=2, bias=False),
            nn.BatchNorm1d(128),
            nn.GELU(),
        )
        self.head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(256, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.gradcam_layer(self.features(x))
        avg_p = h.mean(dim=-1)
        max_p = h.amax(dim=-1)
        return self.head(torch.cat([avg_p, max_p], dim=1)).squeeze(-1)


def build_model(model_name: str, cfg: dict[str, Any] | None = None) -> nn.Module:
    """Instantiate a CardioBreath or baseline/ablation PyTorch model from config."""
    mcfg = (cfg or {}).get("model", {})
    cnn_ch = int(mcfg.get("cnn_channels", 32))
    kernels = tuple(int(k) for k in mcfg.get("cnn_kernels", [5, 15, 31]))
    gru_hidden = int(mcfg.get("gru_hidden", 96))
    gru_layers = int(mcfg.get("gru_layers", 2))
    dropout = float(mcfg.get("dropout", 0.30))

    if model_name in ("cardiobreath", "ablation_1min"):
        return CardioBreathNet(
            in_channels=2,
            cnn_channels=cnn_ch,
            kernels=kernels,
            gru_hidden=gru_hidden,
            gru_layers=gru_layers,
            dropout=dropout,
        )
    if model_name in ("ablation_rri", "ablation_edr"):
        return CardioBreathNet(
            in_channels=1,
            cnn_channels=cnn_ch,
            kernels=kernels,
            gru_hidden=gru_hidden,
            gru_layers=gru_layers,
            dropout=dropout,
        )
    if model_name == "raw_cnn":
        return RawECGCNN(dropout=dropout)
    raise ValueError(f"Unknown PyTorch model name: {model_name}")


def compute_gradcam_1d(model: nn.Module, x_tensor: torch.Tensor) -> np.ndarray:
    """Compute normalized `[0, 1]` 1D Grad-CAM saliency map aligned to `x_tensor.shape[-1]`.

    Uses temporary forward/backward hooks on `model.gradcam_layer` and always removes them.
    """
    if not hasattr(model, "gradcam_layer"):
        raise AttributeError("Model must expose `gradcam_layer` for 1D Grad-CAM.")

    was_training = model.training
    # Note: CuDNN RNN backward requires train mode when on CUDA; eval mode works on CPU,
    # while freezing BatchNorm/Dropout updates via zero_grad + eval on BN/Dropout.
    model.eval()
    activations: list[torch.Tensor] = []
    gradients: list[torch.Tensor] = []

    def fwd_hook(_mod: nn.Module, _inp: tuple, out: torch.Tensor) -> None:
        activations.append(out.detach())

    def bwd_hook(_mod: nn.Module, _gin: tuple, gout: tuple[torch.Tensor, ...]) -> None:
        gradients.append(gout[0].detach())

    target_layer: nn.Module = model.gradcam_layer
    h_fwd = target_layer.register_forward_hook(fwd_hook)
    h_bwd = target_layer.register_full_backward_hook(bwd_hook)
    try:
        x_in = x_tensor.detach().clone()
        if x_in.ndim == 2:
            x_in = x_in.unsqueeze(0)
        x_in.requires_grad_(True)
        model.zero_grad(set_to_none=True)

        # Ensure RNN backward succeeds on CUDA too by enabling grad cleanly
        with torch.enable_grad():
            logit = model(x_in)
            score = logit.sum()
            score.backward()

        act = activations[0]  # (1, C, T_down)
        grad = gradients[0]  # (1, C, T_down)
        weights = grad.mean(dim=-1, keepdim=True)  # (1, C, 1)
        cam = F.relu((weights * act).sum(dim=1, keepdim=True))  # (1, 1, T_down)
        cam_up = F.interpolate(cam, size=x_in.shape[-1], mode="linear", align_corners=False)
        saliency = cam_up.squeeze().cpu().numpy().astype(np.float32)

        lo, hi = float(np.min(saliency)), float(np.max(saliency))
        if hi - lo > 1e-8:
            saliency = (saliency - lo) / (hi - lo)
        else:
            saliency = np.zeros_like(saliency, dtype=np.float32)
        return np.clip(saliency, 0.0, 1.0)
    finally:
        h_fwd.remove()
        h_bwd.remove()
        model.zero_grad(set_to_none=True)
        if was_training:
            model.train()
