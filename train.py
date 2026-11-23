"""Unified deterministic 5-fold subject-disjoint training CLI for CardioBreath & baselines."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sklearn.metrics import roc_auc_score
from torch import nn
from torch.utils.data import DataLoader

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.baselines import find_optimal_threshold, train_lgbm_cv
from src.calibration import apply_temperature, fit_temperature_scaling
from src.config import load_config, load_folds, resolve_path, seed_everything
from src.datasets import MODEL_TO_MODE, ApneaWindowDataset
from src.models import build_model

ALL_MODELS = ["lgbm", "cardiobreath", "ablation_rri", "ablation_edr", "ablation_1min", "raw_cnn"]


def resolve_device(device_arg: str) -> torch.device:
    if device_arg == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(device_arg)


@torch.no_grad()
def predict_logits(model: nn.Module, loader: DataLoader, device: torch.device) -> np.ndarray:
    model.eval()
    outs: list[np.ndarray] = []
    for xb, _ in loader:
        xb = xb.to(device, non_blocking=True)
        logits = model(xb)
        outs.append(logits.detach().cpu().numpy())
    return np.concatenate(outs, axis=0).astype(np.float32)


def train_pytorch_cv(
    model_name: str,
    cfg: dict[str, Any],
    folds_cfg: dict[str, Any],
    train_dir: Path,
    out_dir: Path,
    device: torch.device,
    seed: int = 42,
    fold_indices: list[int] | None = None,
    smoke: bool = False,
) -> dict[str, Any]:
    """Train a PyTorch model across subject-disjoint folds with early stopping & temperature scaling."""
    out_dir.mkdir(parents=True, exist_ok=True)
    mode = MODEL_TO_MODE[model_name]
    mcfg = cfg["model"]

    batch_size = int(mcfg["batch_size"])
    max_epochs = 2 if smoke else int(mcfg["max_epochs"])
    patience = 2 if smoke else int(mcfg["early_stop_patience"])
    lr = float(mcfg["lr"])
    weight_decay = float(mcfg["weight_decay"])
    selected_folds = fold_indices if fold_indices is not None else [0, 1, 2, 3, 4]

    oof_logits: list[np.ndarray] = []
    oof_labels: list[np.ndarray] = []
    oof_sqi: list[np.ndarray] = []
    oof_records: list[str] = []
    fold_aucs: list[float] = []

    print(
        f"\n=== Training `{model_name}` (mode={mode}, device={device}, "
        f"epochs={max_epochs}, folds={selected_folds}, smoke={smoke}) ==="
    )

    for fold_idx in selected_folds:
        t0 = time.perf_counter()
        seed_everything(seed + fold_idx)
        split = folds_cfg["folds"][f"fold_{fold_idx}"]

        tr_recs = split["train"][:4] if smoke else split["train"]
        va_recs = split["val"][:3] if smoke else split["val"]

        ds_tr = ApneaWindowDataset(
            tr_recs, train_dir, mode=mode, augment=True, only_usable=True, seed=seed + fold_idx
        )
        ds_va = ApneaWindowDataset(
            va_recs, train_dir, mode=mode, augment=False, only_usable=False, seed=seed + fold_idx
        )

        # Keep num_workers=0 on Windows for zero multiprocessing overhead & deterministic seeding
        tr_loader = DataLoader(ds_tr, batch_size=batch_size, shuffle=True, drop_last=False, num_workers=0)
        va_loader = DataLoader(ds_va, batch_size=batch_size * 2, shuffle=False, num_workers=0)

        model = build_model(model_name, cfg).to(device)
        n_pos = float(np.sum(ds_tr.y > 0.5))
        n_neg = float(np.sum(ds_tr.y <= 0.5))
        pos_weight = torch.tensor([n_neg / max(n_pos, 1.0)], dtype=torch.float32, device=device)

        criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
        optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(max_epochs, 1))

        best_auc = -1.0
        best_state: dict[str, torch.Tensor] | None = None
        best_va_logits: np.ndarray | None = None
        stale_epochs = 0

        for epoch in range(1, max_epochs + 1):
            model.train()
            running_loss = 0.0
            n_batches = 0
            for xb, yb in tr_loader:
                xb = xb.to(device, non_blocking=True)
                yb = yb.to(device, non_blocking=True)
                optimizer.zero_grad(set_to_none=True)
                logits = model(xb)
                loss = criterion(logits, yb)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()
                running_loss += float(loss.item())
                n_batches += 1
            scheduler.step()

            va_logits = predict_logits(model, va_loader, device)
            va_y = ds_va.y.astype(np.int64)
            va_auc = float(roc_auc_score(va_y, va_logits)) if len(np.unique(va_y)) == 2 else 0.5

            if va_auc > best_auc:
                best_auc = va_auc
                best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
                best_va_logits = va_logits
                stale_epochs = 0
            else:
                stale_epochs += 1

            if epoch == 1 or epoch == max_epochs or epoch % 5 == 0 or stale_epochs == 0:
                print(
                    f"  [{model_name} fold_{fold_idx}] ep {epoch:02d}/{max_epochs} "
                    f"loss={running_loss / max(n_batches, 1):.4f} val_auroc={va_auc:.4f} (best={best_auc:.4f})"
                )

            if stale_epochs >= patience:
                print(f"  [{model_name} fold_{fold_idx}] Early stopping at epoch {epoch}.")
                break

        assert best_state is not None and best_va_logits is not None
        ckpt_path = out_dir / f"fold_{fold_idx}.pt"
        torch.save(
            {
                "model_name": model_name,
                "mode": mode,
                "fold": fold_idx,
                "seed": seed,
                "val_auroc": best_auc,
                "model_config": mcfg,
                "state_dict": best_state,
            },
            ckpt_path,
        )

        elapsed = time.perf_counter() - t0
        fold_aucs.append(best_auc)
        oof_logits.append(best_va_logits)
        oof_labels.append(ds_va.y.astype(np.int64))
        oof_sqi.append(ds_va.sqi_pass.astype(bool))
        oof_records.extend(ds_va.record_ids)
        print(f"  [OK] Saved {ckpt_path.name} | best_val_auroc={best_auc:.4f} | elapsed={elapsed:.1f}s")

    all_logits = np.concatenate(oof_logits)
    all_labels = np.concatenate(oof_labels)
    all_sqi = np.concatenate(oof_sqi)

    temp = fit_temperature_scaling(all_logits, all_labels)
    all_probs = apply_temperature(all_logits, temp)
    best_thr = find_optimal_threshold(all_labels, all_probs)
    oof_auc = float(roc_auc_score(all_labels, all_probs)) if len(np.unique(all_labels)) == 2 else 0.5

    np.savez_compressed(
        out_dir / "oof_predictions.npz",
        logits=all_logits.astype(np.float32),
        probs=all_probs.astype(np.float32),
        labels=all_labels.astype(np.int64),
        sqi_pass=all_sqi.astype(bool),
        record_ids=np.array(oof_records),
    )

    meta = {
        "model": model_name,
        "mode": mode,
        "seed": seed,
        "smoke": smoke,
        "folds_trained": selected_folds,
        "temperature": round(temp, 5),
        "threshold": best_thr,
        "oof_auroc": round(oof_auc, 4),
        "fold_aurocs": [round(a, 4) for a in fold_aucs],
    }
    (out_dir / "cv_summary.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"[DONE] {model_name}: OOF AUROC={oof_auc:.4f}, Temp={temp:.3f}, Thr={best_thr:.3f}")
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description="Train CardioBreath models and baselines (5-fold subject CV).")
    parser.add_argument("--model", default="cardiobreath", choices=[*ALL_MODELS, "all"])
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--folds", default="0,1,2,3,4", help="Comma-separated fold indices.")
    parser.add_argument("--smoke", action="store_true", help="Fast 2-epoch subset smoke test on local CPU.")
    args = parser.parse_args()

    cfg = load_config(args.config)
    folds_cfg = load_folds(cfg["paths"]["folds_path"])
    seed = int(args.seed if args.seed is not None else cfg["project"]["seed"])
    seed_everything(seed)

    train_dir = resolve_path(cfg["paths"]["processed_dir"]) / "train"
    ckpt_root = resolve_path(cfg["paths"]["checkpoints_dir"])
    device = resolve_device(args.device)
    fold_indices = [int(f.strip()) for f in args.folds.split(",") if f.strip()]

    targets = ALL_MODELS if args.model == "all" else [args.model]
    for target in targets:
        out_dir = ckpt_root / target
        if target == "lgbm":
            print(f"\n=== Training Baseline 1: `lgbm` (5-fold subject-disjoint CV, seed={seed}) ===")
            meta = train_lgbm_cv(folds_cfg, train_dir, out_dir, seed=seed)
            print(
                f"[DONE] lgbm: OOF AUROC={meta['oof_auroc']:.4f}, "
                f"Temp={meta['temperature']:.3f}, Thr={meta['threshold']:.3f}"
            )
        else:
            train_pytorch_cv(
                model_name=target,
                cfg=cfg,
                folds_cfg=folds_cfg,
                train_dir=train_dir,
                out_dir=out_dir,
                device=device,
                seed=seed,
                fold_indices=fold_indices,
                smoke=args.smoke,
            )


if __name__ == "__main__":
    main()
