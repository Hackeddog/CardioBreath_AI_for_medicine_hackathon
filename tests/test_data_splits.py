"""Tests verifying strict subject-disjoint splits, zero test leakage, and label parsing."""

from __future__ import annotations

from pathlib import Path

from src.config import load_config, load_folds
from src.data_io import RESP_BELT_RECORDS, TEST_RECORDS, TRAIN_RECORDS, parse_event2_answers


def test_five_fold_subject_disjoint_and_zero_leakage() -> None:
    folds_cfg = load_folds("configs/folds.json")
    folds = folds_cfg["folds"]
    held_out = set(folds_cfg["held_out_test"])

    assert len(folds) == 5
    assert held_out == set(TEST_RECORDS)
    assert len(held_out) == 35

    all_val: list[str] = []
    for fold_name, split in folds.items():
        tr = set(split["train"])
        va = set(split["val"])
        # Zero overlap between train and val inside every fold
        assert tr.isdisjoint(va), f"Leakage inside {fold_name}"
        # Zero overlap with held-out test set
        assert tr.isdisjoint(held_out), f"Train leaks held-out test in {fold_name}"
        assert va.isdisjoint(held_out), f"Val leaks held-out test in {fold_name}"
        # Union equals full 35-record learning set
        assert tr | va == set(TRAIN_RECORDS)
        # Stratified: exactly 4 apnea (a), 1 borderline (b), 2 control (c) per val fold
        assert sum(r.startswith("a") for r in va) == 4
        assert sum(r.startswith("b") for r in va) == 1
        assert sum(r.startswith("c") for r in va) == 2
        all_val.extend(va)

    # Every training record appears in validation exactly once
    assert len(all_val) == 35
    assert set(all_val) == set(TRAIN_RECORDS)


def test_config_loads_and_resp_belt_records_present() -> None:
    cfg = load_config("configs/default.yaml")
    assert cfg["project"]["seed"] == 42
    assert cfg["dsp"]["sampling_rate_raw"] == 100
    assert cfg["dsp"]["sampling_rate_dsp"] == 4
    assert cfg["dsp"]["context_minutes"] == 5

    folds_cfg = load_folds("configs/folds.json")
    assert folds_cfg["respiratory_belt_records"] == RESP_BELT_RECORDS


def test_event2_answers_parser_handles_challenge_format(tmp_path: Path) -> None:
    sample = tmp_path / "event-2-answers.txt"
    sample.write_text(
        "x01\n"
        "0   NNNNN AAAAA\n"
        "10  ANANA\n"
        "\n"
        "x02\n"
        "0   N N A A\n",
        encoding="utf-8",
    )
    parsed = parse_event2_answers(sample)
    assert set(parsed.keys()) == {"x01", "x02"}
    assert parsed["x01"].tolist() == [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1]
    assert parsed["x02"].tolist() == [0, 0, 1, 1]


def test_real_event2_answers_when_downloaded() -> None:
    real_path = Path("data/raw/apnea-ecg/event-2-answers.txt")
    if not real_path.exists():
        return
    parsed = parse_event2_answers(real_path)
    assert set(parsed.keys()) == set(TEST_RECORDS)
    assert sum(len(v) for v in parsed.values()) == 17268

