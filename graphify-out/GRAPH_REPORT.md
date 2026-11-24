# Graph Report - CardioBreath_AI_for_medicine_hackathon  (2026-11-24)

## Corpus Check
- 54 files · ~407,895 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 20 file(s) not represented in the graph (top: .onnx 10, .npz 4, (none) 3)
- WARNING: 20 of 94 files seen (21%) have no supported extractor and are missing from this graph entirely. It may look complete while representing only part of the codebase.

## Summary
- 513 nodes · 1131 edges · 24 communities (17 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `358585dd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- preprocess.py
- main.py
- inference.py
- numpy
- build_model
- train.py
- package.json
- page.tsx
- evaluate.py
- dsp
- compilerOptions
- model
- paths
- clinical
- cardiobreath
- default.yaml
- postcss.config.mjs
- CardioBreath
- benchmark_table_test.md
- benchmark_table_val.md

## God Nodes (most connected - your core abstractions)
1. `run_dsp_pipeline()` - 21 edges
2. `dsp` - 20 edges
3. `build_model()` - 19 edges
4. `main()` - 18 edges
5. `load_config()` - 18 edges
6. `apply_temperature()` - 17 edges
7. `evaluate_noise_robustness()` - 16 edges
8. `compilerOptions` - 16 edges
9. `train_lgbm_cv()` - 14 edges
10. `predict_lgbm_ensemble()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `CachedNightBundle` --uses--> `DSPResult`  [INFERRED]
  backend/app/inference.py → src/dsp.py
- `test_evaluation_endpoint_exposes_locked_test_results()` --calls--> `get_evaluation()`  [EXTRACTED]
  tests/test_api.py → backend/app/main.py
- `_predict_pytorch_ensemble_on_record()` --calls--> `apply_temperature()`  [EXTRACTED]
  evaluate.py → src/calibration.py
- `_predict_pytorch_ensemble_on_record()` --calls--> `build_model()`  [EXTRACTED]
  evaluate.py → src/models.py
- `collect_test_records()` --calls--> `predict_lgbm_ensemble()`  [EXTRACTED]
  evaluate.py → src/baselines.py

## Import Cycles
- None detected.

## Communities (24 total, 7 thin omitted)

### Community 0 - "preprocess.py"
Cohesion: 0.06
Nodes (24): download_apnea_ecg(), _download_with_retry(), main(), _required_files(), export_checkpoints(), export_single_model_to_onnx(), main(), export_demo_bundle() (+16 more)

### Community 1 - "main.py"
Cohesion: 0.09
Nodes (23): CachedNightBundle, CardioBreathInferenceEngine, _format_hhmm(), analyze_case(), get_cases(), get_evaluation(), get_health(), inspect_window() (+15 more)

### Community 2 - "inference.py"
Cohesion: 0.09
Nodes (18): _triage_action_for_tier(), bandpass_ecg(), clean_rr_intervals(), compute_minute_sqi_and_rhythm(), detect_rpeaks_and_clean(), DSPResult, extract_edr_rri_4hz(), extract_hrv_features_per_minute() (+10 more)

### Community 3 - "numpy"
Cohesion: 0.12
Nodes (18): aggregate_ensemble_predictions(), apply_temperature(), binary_nll(), brier_score(), expected_calibration_error(), fit_temperature_scaling(), objective(), sigmoid() (+10 more)

### Community 4 - "build_model"
Cohesion: 0.06
Nodes (10): build_model(), CardioBreathNet, compute_gradcam_1d(), MultiScaleBlock1D, RawECGCNN, SqueezeExcite1D, TemporalAttentionPool, test_all_model_forward_shapes_and_finiteness() (+2 more)

### Community 5 - "train.py"
Cohesion: 0.07
Nodes (11): find_optimal_threshold(), load_lgbm_boosters(), predict_lgbm_ensemble(), _prob_to_logit(), train_lgbm_cv(), seed_everything(), ApneaWindowDataset, main() (+3 more)

### Community 6 - "package.json"
Cohesion: 0.06
Nodes (35): nextConfig, dependencies, lucide-react@^0.469.0, next@15.1.6, react@^19.0.0, react-dom@^19.0.0, devDependencies, autoprefixer@^10.4.20 (+27 more)

### Community 7 - "page.tsx"
Cohesion: 0.14
Nodes (33): HomePage(), FullNightTimeline(), FullNightTimelineProps, Navbar(), NavbarProps, NOISE_OPTIONS, DISPLAY_NAMES, FIGURE_CARDS (+25 more)

### Community 8 - "evaluate.py"
Cohesion: 0.15
Nodes (14): collect_test_records(), collect_val_records(), evaluate_noise_robustness(), main(), _plot_bland_altman(), _plot_calibration(), _plot_failure_cases(), _plot_noise_robustness() (+6 more)

### Community 9 - "dsp"
Cohesion: 0.10
Nodes (20): dsp, afib_rmssd_ratio_threshold, bandpass_high_hz, bandpass_low_hz, bandpass_order, context_minutes, edr_high_hz, edr_low_hz (+12 more)

### Community 10 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 11 - "model"
Cohesion: 0.18
Nodes (11): model, batch_size, cnn_channels, cnn_kernels, dropout, early_stop_patience, gru_hidden, gru_layers (+3 more)

### Community 12 - "paths"
Cohesion: 0.25
Nodes (8): paths, checkpoints_dir, demo_dir, folds_path, onnx_dir, processed_dir, raw_dir, reports_dir

### Community 13 - "clinical"
Cohesion: 0.29
Nodes (7): clinical, bootstrap_resamples, eahi_moderate_cutoff, eahi_screening_cutoff, eahi_severe_cutoff, fn_to_fp_cost_ratio, noise_stress_snr_db

### Community 14 - "cardiobreath"
Cohesion: 0.29
Nodes (6): build, environment, ports, restart, services, cardiobreath

### Community 15 - "default.yaml"
Cohesion: 0.50
Nodes (3): project, name, seed

### Community 21 - "CardioBreath"
Cohesion: 0.17
Nodes (11): 1. The Clinical Problem & Target Beneficiary, 2. Technical Architecture, 3. Held-Out Evaluation (`x01–x35`, 35 Unseen Nights, 17,248 Minutes), 4. Clinical Honesty: Who Benefits, Who Could Be Harmed & Failure Analysis, 5. Reproducibility & Quickstart, 6. Attribution & AI Tool Disclosure, CardioBreath, Reproduce Full Training & Locked Held-Out Evaluation From Scratch (+3 more)

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `build_model()` connect `build_model` to `preprocess.py`, `inference.py`, `numpy`, `train.py`, `evaluate.py`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `preprocess.py` be split into smaller, more focused modules?**
  _Cohesion score 0.060641627543035995 - nodes in this community are weakly interconnected._
- **Why does `compute_gradcam_1d()` connect `build_model` to `main.py`, `inference.py`, `numpy`, `train.py`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Should `main.py` be split into smaller, more focused modules?**
  _Cohesion score 0.08705882352941176 - nodes in this community are weakly interconnected._
- **Why does `ApneaWindowDataset` connect `train.py` to `evaluate.py`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Should `inference.py` be split into smaller, more focused modules?**
  _Cohesion score 0.08879492600422834 - nodes in this community are weakly interconnected._
- **Should `numpy` be split into smaller, more focused modules?**
  _Cohesion score 0.1173054587688734 - nodes in this community are weakly interconnected._