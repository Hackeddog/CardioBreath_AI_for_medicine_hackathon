export interface HealthStatus {
  status: string;
  model_name: string;
  n_onnx_folds: number;
  smoke_weights: boolean;
  temperature: number;
  default_threshold: number;
  lgbm_baseline_available: boolean;
  gradcam_available: boolean;
  bench_500min_per_fold_ms: number | null;
}

export interface DemoCaseInfo {
  case_id: string;
  split: string;
  duration_minutes: number;
  duration_hours: number;
  true_eahi: number;
  clinical_tier: string;
}

export interface MinutePoint {
  minute: number;
  time_label: string;
  prob: number;
  prob_std: number;
  pred: number; // 1=apnea, 0=normal, -1=deferred (low SQI)
  sqi_score: number;
  sqi_pass: boolean;
  baseline_prob: number | null;
  ground_truth: number | null;
}

export interface FullNightAnalysis {
  case_id: string;
  duration_minutes: number;
  duration_hours: number;
  eahi_pred: number;
  eahi_ci90_low: number;
  eahi_ci90_high: number;
  severity_tier: "Normal" | "Mild" | "Moderate" | "Severe" | string;
  triage_action: string;
  usable_ratio: number;
  usable_minutes: number;
  deferred_minutes: number;
  rhythm_irregular: boolean;
  rhythm_rmssd_ratio: number;
  threshold_used: number;
  temperature_used: number;
  noise_snr_db: number | null;
  inference_ms: number;
  true_eahi: number | null;
  minute_acc: number | null;
  baseline_eahi: number | null;
  baseline_minute_acc: number | null;
  default_inspect_minute: number;
  timeline: MinutePoint[];
}

export interface WindowInspectorData {
  case_id: string;
  minute_index: number;
  time_window_label: string;
  apnea_prob: number;
  sqi_score: number;
  sqi_pass: boolean;
  ecg_time_sec: number[];
  ecg_mv: number[];
  edr_time_sec: number[];
  edr_z: number[];
  rri_bpm: number[];
  gradcam_saliency: number[];
}

export interface ModelEvalEntry {
  minute_metrics: {
    auroc: number;
    auprc: number;
    accuracy: number;
    sensitivity: number;
    specificity: number;
    f1: number;
    ece: number;
    brier: number;
  };
  recording_metrics: {
    eahi_mae: number;
    eahi_rmse: number;
    eahi_pearson_r: number;
    bland_altman_bias: number;
    bland_altman_loa_low: number;
    bland_altman_loa_high: number;
    screening_cutoff_5: { accuracy: number; sensitivity: number; specificity: number };
    moderate_cutoff_15: { accuracy: number; sensitivity: number; specificity: number };
  };
  bootstrap_ci_95: {
    auroc: { ci95_low: number; ci95_high: number };
    eahi_mae: { ci95_low: number; ci95_high: number };
  };
}

export interface EvaluationPayload {
  test: {
    split: string;
    primary_model: string;
    models: Record<string, ModelEvalEntry>;
    failure_cases?: {
      fn_recording?: { record_id: string; true_eahi: number; pred_eahi: number };
      worst_fp_epoch?: { record_id: string; minute_idx: number; prob: number; sqi_pass: boolean };
    };
  } | null;
  edr_belt_validation: {
    n_records_validated: number;
    mean_breathing_rate_mae_bpm: number;
    mean_best_60s_abs_corr: number;
    mean_peak_resp_coherence: number;
  } | null;
  figures: string[];
}
