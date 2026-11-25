"use client";

import React, { useState } from "react";

const SECTIONS = [
  { id: "benchmark", label: "Benchmark" },
  { id: "model", label: "Model and limits" },
  { id: "figures", label: "Figures" },
] as const;
import { apiUrl } from "@/lib/api";
import type { EvaluationPayload, HealthStatus } from "@/lib/types";

interface ResearchBenchmarkViewProps {
  evaluation: EvaluationPayload | null;
  health: HealthStatus | null;
}

const DISPLAY_NAMES: Record<string, string> = {
  lgbm: "Baseline: HRV + LightGBM",
  raw_cnn: "Baseline: raw 1-min ECG CNN",
  ablation_rri: "Ablation: RRI only (5-min)",
  ablation_edr: "Ablation: EDR only (5-min)",
  ablation_1min: "Ablation: dual-stream (1-min)",
  cardiobreath: "CardioBreath (dual-stream, 5-fold)",
};

const ORDER = ["lgbm", "raw_cnn", "ablation_rri", "ablation_edr", "ablation_1min", "cardiobreath"];

const FIGURE_CARDS = [
  {
    file: "roc_pr_curves_test.png",
    title: "ROC and precision-recall curves",
    caption: "Minute-level discrimination on the 35 held-out nights (x01 to x35), against each baseline and ablation.",
  },
  {
    file: "bland_altman_eahi_test.png",
    title: "eAHI agreement (Bland-Altman)",
    caption: "Predicted vs. reference minute-based eAHI per night.",
  },
  {
    file: "edr_belt_validation.png",
    title: "ECG-derived breathing vs. respiratory belt",
    caption: "Independent check on 8 PhysioNet nights with belt recordings (a01r to c03r).",
  },
  {
    file: "noise_robustness_sqi_test.png",
    title: "Motion-artifact stress test",
    caption: "As noise rises from clean to 0 dB SNR, the quality gate defers minutes instead of raising false apnea calls.",
  },
  {
    file: "calibration_reliability_test.png",
    title: "Calibration after temperature scaling",
    caption: "Reliability diagram for out-of-fold temperature-scaled probabilities.",
  },
  {
    file: "failure_cases_test.png",
    title: "Error analysis",
    caption: "The most under-predicted night (x25, still triaged for referral) and the worst false-positive minute (x30).",
  },
];

function Metric({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="card p-4">
      <p className="font-hud text-5xl leading-none text-primary">{value}</p>
      <p className="mt-1 text-sm font-medium">{label}</p>
      <p className="text-sm text-muted tabular-nums">{note}</p>
    </div>
  );
}

export default function ResearchBenchmarkView({ evaluation, health }: ResearchBenchmarkViewProps) {
  const models = evaluation?.test?.models ?? {};
  const cb = models["cardiobreath"];
  const belt = evaluation?.edr_belt_validation;
  // Three short sections instead of one long scroll.
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("benchmark");

  return (
    <div className="space-y-6 short:space-y-4">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[70ch]">
          <h2 id="research-title" className="font-pixel text-2xl font-bold sm:text-3xl">
            Validation and limitations
          </h2>
          <p className="mt-2 text-muted short:text-sm">
            Locked held-out test set: 35 PhysioNet Apnea-ECG nights (x01 to x35), never seen in training or tuning.
            95% subject-clustered bootstrap CIs (1,000 resamples).
          </p>
        </div>
        <div className="flex shrink-0 gap-1 bg-surface-2 p-1" role="group" aria-label="Research section">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={section === s.id}
              onClick={() => setSection(s.id)}
              className={`min-h-11 px-3 font-hud text-xl leading-none ${section === s.id ? "bg-primary text-primary-ink" : "text-muted hover:text-ink"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {section === "benchmark" && (
      <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          value={cb ? cb.minute_metrics.auroc.toFixed(3) : "…"}
          label="AUROC per minute"
          note={cb ? `95% CI ${cb.bootstrap_ci_95.auroc.ci95_low.toFixed(3)} to ${cb.bootstrap_ci_95.auroc.ci95_high.toFixed(3)}` : "Loading…"}
        />
        <Metric
          value={cb ? cb.recording_metrics.eahi_mae.toFixed(2) : "…"}
          label="eAHI mean absolute error"
          note={`apnea-min/hr · Pearson r ${cb ? cb.recording_metrics.eahi_pearson_r.toFixed(3) : "…"}`}
        />
        <Metric
          value={cb ? `${(cb.recording_metrics.screening_cutoff_5.sensitivity * 100).toFixed(1)}%` : "…"}
          label="Screening sensitivity at eAHI ≥ 5"
          note="Per night, on 35 held-out nights"
        />
        <Metric
          value={belt ? `${belt.mean_breathing_rate_mae_bpm.toFixed(2)} bpm` : "…"}
          label="Breathing-rate error vs. belt"
          note={`Across ${belt?.n_records_validated ?? 8} nights with belt recordings`}
        />
      </div>

      <section aria-labelledby="bench-title" className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
          <h2 id="bench-title" className="text-lg font-semibold tracking-tight">
            Benchmark on held-out nights
          </h2>
          <p className="text-sm text-muted">Minute-level and per-night metrics, seed 42.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">Model</th>
                <th scope="col" className="px-3 py-2 font-medium">AUROC (95% CI)</th>
                <th scope="col" className="px-3 py-2 font-medium">AUPRC</th>
                <th scope="col" className="px-3 py-2 font-medium">Accuracy</th>
                <th scope="col" className="px-3 py-2 font-medium">Sens. / Spec.</th>
                <th scope="col" className="px-3 py-2 font-medium">eAHI MAE</th>
                <th scope="col" className="px-3 py-2 font-medium">Pearson r</th>
                <th scope="col" className="px-3 py-2 font-medium">Screen sens. (≥ 5)</th>
                <th scope="col" className="px-5 py-2 font-medium">ECE</th>
              </tr>
            </thead>
            <tbody>
              {ORDER.filter((k) => models[k]).map((key) => {
                const e = models[key];
                const main = key === "cardiobreath";
                return (
                  <tr key={key} className={`border-t border-line ${main ? "bg-primary-soft font-semibold" : ""}`}>
                    <th scope="row" className="whitespace-nowrap px-5 py-2 font-medium">
                      {DISPLAY_NAMES[key] ?? key}
                    </th>
                    <td className="whitespace-nowrap px-3 py-2">
                      {e.minute_metrics.auroc.toFixed(3)}{" "}
                      <span className="font-normal text-muted">
                        ({e.bootstrap_ci_95.auroc.ci95_low.toFixed(3)} to {e.bootstrap_ci_95.auroc.ci95_high.toFixed(3)})
                      </span>
                    </td>
                    <td className="px-3 py-2">{e.minute_metrics.auprc.toFixed(3)}</td>
                    <td className="px-3 py-2">{(e.minute_metrics.accuracy * 100).toFixed(1)}%</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {(e.minute_metrics.sensitivity * 100).toFixed(1)}% / {(e.minute_metrics.specificity * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2">{e.recording_metrics.eahi_mae.toFixed(2)}</td>
                    <td className="px-3 py-2">{e.recording_metrics.eahi_pearson_r.toFixed(3)}</td>
                    <td className="px-3 py-2">{(e.recording_metrics.screening_cutoff_5.sensitivity * 100).toFixed(1)}%</td>
                    <td className="px-5 py-2">{e.minute_metrics.ece.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      </>
      )}

      {section === "model" && (
      <section aria-labelledby="model-title" className="grid gap-4 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-1">
          <h2 id="model-title" className="text-lg font-semibold tracking-tight">
            Model
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ["Architecture", "Multi-scale 1D-CNN + BiGRU on EDR and RRI streams (5-min context)"],
              ["Ensemble", health ? `${health.n_onnx_folds} cross-validation folds, ONNX on CPU` : "5 cross-validation folds, ONNX on CPU"],
              ["Calibration", health ? `Temperature scaling, T = ${health.temperature.toFixed(3)}` : "Temperature scaling"],
              ["Default cutoff", health ? health.default_threshold.toFixed(2) : "…"],
              ["Explainability", "1D Grad-CAM per 5-minute window"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="card p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold tracking-tight">Who benefits, who could be harmed</h2>
          <p className="mt-3 text-sm">
            <strong className="font-semibold">Intended use:</strong> prioritizing sleep-study referrals for adults with
            suspected sleep apnea, using inexpensive single-lead patch or Holter ECG where overnight polysomnography is
            scarce. It does not replace PSG.
          </p>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <strong className="font-semibold">Arrhythmia (e.g. AFib):</strong> irregular beat intervals can mimic
              apnea. Non-sinus rhythm is flagged and the recommendation switches to direct PSG referral.
            </li>
            <li>
              <strong className="font-semibold">Minute-based eAHI is not event AHI:</strong> labels mark apnea per
              minute, so eAHI measures apnea burden per hour, not a count of apneas and hypopneas.
            </li>
            <li>
              <strong className="font-semibold">Under-estimation:</strong> nights with mild heart-rate cycling (e.g.
              x25) can be under-scored at high-specificity cutoffs. The 90% interval and the adjustable cutoff exist for
              this.
            </li>
            <li>
              <strong className="font-semibold">Dataset scope:</strong> 70 nights from one public database (Penzel et
              al., 2000). Performance on other devices and populations is not yet established.
            </li>
          </ul>
        </div>
      </section>
      )}

      {section === "figures" && (
      <section aria-label="Figures">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIGURE_CARDS.map((fc) => (
            <figure key={fc.file} className="card p-3">
              {/* Figures are rendered on white; keep a light panel so they read in dark mode too. */}
              <img
                src={apiUrl(`/api/figures/${fc.file}`)}
                alt={`${fc.title}. ${fc.caption}`}
                loading="lazy"
                className="h-auto w-full rounded-lg bg-white"
              />
              <figcaption className="mt-2">
                <p className="text-sm font-semibold">{fc.title}</p>
                <p className="text-xs text-muted">{fc.caption}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      )}
    </div>
  );
}
