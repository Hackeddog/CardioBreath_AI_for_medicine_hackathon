"""Sync trained ONNX models into `cardiobreath/assets/` and build a standalone `.whl` package."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = REPO_ROOT / "cardiobreath" / "assets"
ONNX_SRC = REPO_ROOT / "artifacts" / "onnx" / "cardiobreath"
CFG_SRC = REPO_ROOT / "configs" / "default.yaml"
DIST_DIR = REPO_ROOT / "dist"


def main() -> int:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    copied = 0
    for fold in range(5):
        src = ONNX_SRC / f"cardiobreath_fold_{fold}.onnx"
        if not src.exists():
            raise FileNotFoundError(f"Missing trained ONNX fold model: {src}")
        shutil.copy2(src, ASSETS_DIR / src.name)
        copied += 1

    meta_src = ONNX_SRC / "deploy_metadata.json"
    if meta_src.exists():
        shutil.copy2(meta_src, ASSETS_DIR / meta_src.name)
    if CFG_SRC.exists():
        shutil.copy2(CFG_SRC, ASSETS_DIR / "default.yaml")

    print(f"[OK] Bundled {copied} ONNX fold models + metadata into {ASSETS_DIR}")

    # Build wheel using local setuptools without needing internet access
    cmd_wheel = [
        sys.executable,
        "-m",
        "pip",
        "wheel",
        str(REPO_ROOT),
        "--no-build-isolation",
        "--no-deps",
        "-w",
        str(DIST_DIR),
    ]
    subprocess.run(cmd_wheel, check=True)

    wheels = sorted(DIST_DIR.glob("cardiobreath-*.whl"))
    if not wheels:
        raise RuntimeError("Wheel build completed, but no cardiobreath-*.whl found in dist/.")
    whl_path = wheels[-1]

    # Install built wheel into active venv (with --no-deps since runtime deps are already installed)
    cmd_install = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--force-reinstall",
        "--no-deps",
        str(whl_path),
    ]
    subprocess.run(cmd_install, check=True)
    size_mb = whl_path.stat().st_size / (1024 * 1024)
    print(f"[OK] Built & installed standalone wheel: {whl_path} ({size_mb:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
