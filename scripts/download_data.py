"""Download and verify PhysioNet Apnea-ECG v1.0.0 + Challenge 2000 held-out test labels.

Uses the fast AWS Open Data S3 mirror (`physionet-open.s3.amazonaws.com`) with automatic
fallback to `physionet.org`, exponential retry backoff, and parallel resumable downloads.
"""

from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import requests
from tqdm import tqdm

from src.config import load_config, resolve_path
from src.data_io import RESP_BELT_RECORDS, TEST_RECORDS, TRAIN_RECORDS, parse_event2_answers

APNEA_ECG_MIRRORS = [
    "https://physionet-open.s3.amazonaws.com/apnea-ecg/1.0.0",
    "https://physionet.org/files/apnea-ecg/1.0.0",
]
EVENT2_URLS = [
    "https://physionet-open.s3.amazonaws.com/challenge-2000/1.0.0/event-2-answers",
    "https://physionet.org/files/challenge-2000/1.0.0/event-2-answers",
]


def _required_files() -> list[str]:
    files: list[str] = []
    for rec in TRAIN_RECORDS:
        files.extend([f"{rec}.hea", f"{rec}.dat", f"{rec}.apn"])
    for rec in TEST_RECORDS:
        files.extend([f"{rec}.hea", f"{rec}.dat"])
    for rec in RESP_BELT_RECORDS:
        files.extend([f"{rec}r.hea", f"{rec}r.dat"])
    return files


def _download_with_retry(urls: list[str], dest: Path, force: bool = False, retries: int = 4) -> Path:
    if not force and dest.exists() and dest.stat().st_size > 0:
        return dest

    tmp = dest.with_suffix(dest.suffix + ".part")
    last_err: Exception | None = None
    for url in urls:
        for attempt in range(retries):
            try:
                with requests.get(url, stream=True, timeout=(10, 60)) as resp:
                    if resp.status_code in (429, 500, 502, 503, 504):
                        raise requests.HTTPError(f"HTTP {resp.status_code} for {url}")
                    resp.raise_for_status()
                    with tmp.open("wb") as f:
                        for chunk in resp.iter_content(chunk_size=1024 * 128):
                            if chunk:
                                f.write(chunk)
                tmp.replace(dest)
                return dest
            except (requests.RequestException, OSError) as exc:
                last_err = exc
                if tmp.exists():
                    tmp.unlink(missing_ok=True)
                time.sleep(min(2.0**attempt, 8.0))
    raise RuntimeError(f"Failed to download {dest.name} from all mirrors: {last_err}")


def download_apnea_ecg(raw_dir: Path, force: bool = False, workers: int = 6) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    req_files = _required_files()

    to_fetch = [f for f in req_files if force or not (raw_dir / f).exists() or (raw_dir / f).stat().st_size == 0]
    if to_fetch:
        print(f"[download] Fetching {len(to_fetch)}/{len(req_files)} Apnea-ECG files into {raw_dir} ...")
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(
                    _download_with_retry,
                    [f"{base}/{fname}" for base in APNEA_ECG_MIRRORS],
                    raw_dir / fname,
                    force,
                ): fname
                for fname in to_fetch
            }
            for fut in tqdm(as_completed(futures), total=len(futures), desc="Apnea-ECG"):
                fut.result()
    else:
        print(f"[download] All {len(req_files)} Apnea-ECG files already cached in {raw_dir}.")

    answers_path = raw_dir / "event-2-answers.txt"
    if force or not answers_path.exists() or answers_path.stat().st_size == 0:
        print("[download] Fetching Challenge 2000 held-out test labels (event-2-answers) ...")
        _download_with_retry(EVENT2_URLS, answers_path, force=force)
    else:
        print(f"[download] Held-out test labels already present: {answers_path}")

    # Integrity verification
    missing_train = [r for r in TRAIN_RECORDS if not (raw_dir / f"{r}.dat").exists()]
    missing_apn = [r for r in TRAIN_RECORDS if not (raw_dir / f"{r}.apn").exists()]
    missing_test = [r for r in TEST_RECORDS if not (raw_dir / f"{r}.dat").exists()]
    missing_resp = [r for r in RESP_BELT_RECORDS if not (raw_dir / f"{r}r.dat").exists()]
    test_labels = parse_event2_answers(answers_path)

    print("\n=== Dataset Integrity Summary ===")
    print(f"Learning ECGs found : {len(TRAIN_RECORDS) - len(missing_train)}/{len(TRAIN_RECORDS)}")
    print(f"Learning .apn found : {len(TRAIN_RECORDS) - len(missing_apn)}/{len(TRAIN_RECORDS)}")
    print(f"Held-out ECGs found : {len(TEST_RECORDS) - len(missing_test)}/{len(TEST_RECORDS)}")
    print(f"Held-out labels     : {len(test_labels)}/{len(TEST_RECORDS)} records ({sum(len(v) for v in test_labels.values()):,} minutes)")
    print(f"Resp-belt records   : {len(RESP_BELT_RECORDS) - len(missing_resp)}/{len(RESP_BELT_RECORDS)}")

    if missing_train or missing_apn or missing_test or missing_resp or len(test_labels) != len(TEST_RECORDS):
        raise RuntimeError(
            f"Incomplete download: missing_train={missing_train}, missing_apn={missing_apn}, "
            f"missing_test={missing_test}, missing_resp={missing_resp}, parsed_test_labels={len(test_labels)}"
        )
    print("[OK] PhysioNet Apnea-ECG dataset and held-out labels verified successfully.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download PhysioNet Apnea-ECG v1.0.0 + test answers.")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--force", action="store_true", help="Re-download even if files exist.")
    parser.add_argument("--workers", type=int, default=6, help="Parallel download threads.")
    args = parser.parse_args()

    cfg = load_config(args.config)
    raw_dir = resolve_path(cfg["paths"]["raw_dir"])
    download_apnea_ecg(raw_dir, force=args.force, workers=args.workers)


if __name__ == "__main__":
    main()
