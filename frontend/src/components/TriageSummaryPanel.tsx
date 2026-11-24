"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, HeartPulse, RotateCcw, Signal } from "lucide-react";
import type { FullNightAnalysis } from "@/lib/types";
import { SeverityBadge, SeverityScale, TIERS, sentenceCase, tierOf } from "./ui";

interface TriageSummaryPanelProps {
  analysis: FullNightAnalysis;
  threshold: number;
  defaultThreshold: number;
  onThresholdChange: (thr: number) => void;
  compareBaseline: boolean;
  onToggleBaseline: (val: boolean) => void;
  updating: boolean;
}

function quality(pct: number) {
  if (pct >= 85) return { label: "Good", cls: "text-normal-fg", bar: "bg-normal", Icon: CheckCircle2 };
  if (pct >= 50) return { label: "Fair", cls: "text-mild-fg", bar: "bg-mild", Icon: AlertTriangle };
  return { label: "Poor", cls: "text-severe-fg", bar: "bg-severe", Icon: AlertTriangle };
}

export default function TriageSummaryPanel({
  analysis,
  threshold,
  defaultThreshold,
  onThresholdChange,
  compareBaseline,
  onToggleBaseline,
  updating,
}: TriageSummaryPanelProps) {
  const tier = tierOf(analysis.severity_tier);
  const usablePct = Math.round(analysis.usable_ratio * 1000) / 10;
  const q = quality(usablePct);
  const poorSignal = analysis.usable_ratio < 0.5;
  const isDefault = Math.abs(threshold - defaultThreshold) < 0.005;

  return (
    <div className="space-y-6">
      <section aria-labelledby="triage-title" aria-busy={updating} className="card overflow-hidden">
        <div className={`h-1.5 ${TIERS[tier].bar}`} aria-hidden />
        <div className="p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="triage-title" tabIndex={-1} className="eyebrow">
              Screening result
            </h2>
            <span className="text-sm text-muted tabular-nums">
              {analysis.case_id.startsWith("upload_") ? "Uploaded ECG" : analysis.case_id} ·{" "}
              {analysis.duration_hours.toFixed(1)} h
            </span>
          </div>

          <div className={`mt-4 transition-opacity duration-200 ${updating ? "opacity-50" : ""}`}>
            <SeverityBadge tier={tier} size="lg" />
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-6xl font-semibold tabular-nums tracking-tight">{analysis.eahi_pred.toFixed(1)}</span>
              <span className="text-sm text-muted">
                eAHI, apnea-min/hr
              </span>
            </p>
            <p className="mt-1 text-sm tabular-nums">
              90% interval {analysis.eahi_ci90_low.toFixed(1)} to {analysis.eahi_ci90_high.toFixed(1)}
              {analysis.true_eahi !== null && (
                <span className="text-muted"> · Sleep-lab reference {analysis.true_eahi.toFixed(1)}</span>
              )}
            </p>
            <SeverityScale value={analysis.eahi_pred} low={analysis.eahi_ci90_low} high={analysis.eahi_ci90_high} />

            <p className={`mt-5 rounded-xl p-4 font-semibold ${TIERS[tier].cls}`}>{sentenceCase(analysis.triage_action)}</p>
          </div>

          <p className="mt-2 min-h-5 text-sm text-muted tabular-nums" role="status" aria-live="polite">
            {updating
              ? "Updating result…"
              : `Analyzed in ${(analysis.inference_ms / 1000).toFixed(1)} s on CPU · cutoff ${analysis.threshold_used.toFixed(2)}`}
          </p>

          {poorSignal && (
            <div className="mt-2 flex gap-2 rounded-xl border border-severe p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-severe-fg" aria-hidden />
              <p>
                <strong className="font-semibold">Not enough clean signal for a reliable estimate.</strong> Only{" "}
                {usablePct.toFixed(0)}% of the night passed the quality check. Repeat the recording or review it
                manually.
              </p>
            </div>
          )}

          <div className="mt-4 border-t border-line pt-5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Signal className="h-4 w-4 text-muted" aria-hidden />
                Signal quality
              </span>
              <span className={`flex items-center gap-1.5 font-semibold tabular-nums ${q.cls}`}>
                <q.Icon className="h-4 w-4" aria-hidden />
                {q.label} · {usablePct.toFixed(1)}% usable
              </span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
              role="img"
              aria-label={`${usablePct.toFixed(1)} percent of the night usable`}
            >
              <div className={`h-full ${q.bar}`} style={{ width: `${Math.min(100, Math.max(0, usablePct))}%` }} />
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Deferred minutes (low quality)</dt>
                <dd className="font-medium tabular-nums">
                  {analysis.deferred_minutes} of {analysis.duration_minutes}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-muted">
                  <HeartPulse className="h-4 w-4" aria-hidden />
                  Heart rhythm
                </dt>
                <dd className={`font-medium ${analysis.rhythm_irregular ? "text-severe-fg" : ""}`}>
                  {analysis.rhythm_irregular ? "Irregular, possible AFib" : "Regular (sinus)"}
                </dd>
              </div>
              {analysis.noise_snr_db !== null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Stress-test noise added</dt>
                  <dd className="font-medium tabular-nums">{analysis.noise_snr_db} dB SNR</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </section>

      <section aria-labelledby="cutoff-title" className="card p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 id="cutoff-title" className="font-semibold">
            Decision cutoff
          </h2>
          {isDefault ? (
            <span className="text-sm text-muted">Validated default</span>
          ) : (
            <button
              type="button"
              onClick={() => onThresholdChange(defaultThreshold)}
              className="-mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary hover:underline"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset to {defaultThreshold.toFixed(2)}
            </button>
          )}
        </div>
        <label htmlFor="threshold" className="mt-3 flex items-baseline justify-between text-sm">
          <span className="text-muted">Minute counts as apnea when probability ≥</span>
          <span className="text-2xl font-semibold tabular-nums">{threshold.toFixed(2)}</span>
        </label>
        <input
          id="threshold"
          type="range"
          min={0.25}
          max={0.8}
          step={0.01}
          value={threshold}
          aria-valuetext={`${threshold.toFixed(2)}${isDefault ? ", validated default" : ""}`}
          onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
          className="mt-3 h-11 w-full cursor-pointer accent-[var(--primary)]"
        />
        <div className="flex justify-between text-xs text-muted">
          <span>More sensitive</span>
          <span>More specific</span>
        </div>
      </section>

      <section aria-labelledby="baseline-title" className="card p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 id="baseline-title" className="font-semibold">
            Compared with a classical baseline
          </h2>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-primary-soft p-3">
            <dt className="text-muted">CardioBreath</dt>
            <dd className="text-xl font-semibold tabular-nums">{analysis.eahi_pred.toFixed(1)}</dd>
            {analysis.minute_acc !== null && (
              <dd className="tabular-nums text-muted">{(analysis.minute_acc * 100).toFixed(1)}% minutes correct</dd>
            )}
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <dt className="text-muted">HRV + LightGBM</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {analysis.baseline_eahi !== null ? analysis.baseline_eahi.toFixed(1) : "Off"}
            </dd>
            {analysis.baseline_minute_acc !== null && (
              <dd className="tabular-nums text-muted">
                {(analysis.baseline_minute_acc * 100).toFixed(1)}% minutes correct
              </dd>
            )}
          </div>
        </dl>
        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={compareBaseline}
            onChange={(e) => onToggleBaseline(e.target.checked)}
            className="h-5 w-5 accent-[var(--primary)]"
          />
          Show baseline on the timeline
        </label>
      </section>
    </div>
  );
}
