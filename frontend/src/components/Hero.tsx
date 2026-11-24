"use client";

import React from "react";
import { ArrowDown, ArrowRight, ShieldAlert, Upload } from "lucide-react";
import type { EvaluationPayload, FullNightAnalysis } from "@/lib/types";
import { SeverityBadge, SeverityScale, sentenceCase } from "./ui";

interface HeroProps {
  analysis: FullNightAnalysis | null;
  onTrySample: () => void;
  onUpload: () => void;
}

const STEPS = [
  { title: "Single-lead ECG", body: "A night of ECG from a patch or Holter, the kind clinics already record." },
  { title: "Breathing from the heart signal", body: "Respiration (EDR) and beat-to-beat heart rate (RRI) are derived from the ECG." },
  { title: "Ensemble with a quality gate", body: "Five calibrated models score each minute. Noisy minutes are deferred, not guessed." },
  { title: "Triage, with uncertainty", body: "An overnight apnea burden (eAHI), a 90% interval, and a referral recommendation." },
];

export default function Hero({ analysis, onTrySample, onUpload }: HeroProps) {
  return (
    <section aria-labelledby="hero-title" className="pb-10 pt-8 sm:pt-14">
      <div className="grid items-center gap-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="eyebrow">Sleep apnea screening aid</p>
          <h1 id="hero-title" className="mt-3 text-[2.25rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Sleep apnea screening from a single-lead ECG
          </h1>
          <p className="mt-5 max-w-[60ch] text-lg text-muted">
            CardioBreath estimates overnight apnea burden from an ordinary ECG recording and shows which patients
            should be prioritized for a sleep study, with the evidence behind every minute.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" onClick={onTrySample} className="btn-primary px-5 text-base">
              Try a sample night
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={onUpload} className="btn-secondary px-5 text-base">
              <Upload className="h-4 w-4" aria-hidden />
              Upload ECG
            </button>
          </div>
          <p className="mt-6 flex max-w-[60ch] items-start gap-2 text-sm text-muted">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ink" aria-hidden />
            <span>
              <strong className="font-semibold text-ink">Screening aid, not a diagnosis.</strong> Results support
              referral decisions and must be confirmed by polysomnography (PSG).
            </span>
          </p>
        </div>

        <div className="lg:col-span-5">
          <div className="card p-6">
            <p className="eyebrow">
              {analysis?.case_id.startsWith("upload_") ? "Your upload" : `Sample night${analysis ? ` · ${analysis.case_id}` : ""}`}
            </p>
            {analysis ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-5xl font-semibold tabular-nums tracking-tight">{analysis.eahi_pred.toFixed(1)}</span>
                  <span className="text-sm text-muted">
                    eAHI
                    <br />
                    apnea-min/hr
                  </span>
                  <span className="ml-auto">
                    <SeverityBadge tier={analysis.severity_tier} />
                  </span>
                </div>
                <SeverityScale value={analysis.eahi_pred} low={analysis.eahi_ci90_low} high={analysis.eahi_ci90_high} />
                <p className="mt-3 text-sm tabular-nums">
                  90% interval {analysis.eahi_ci90_low.toFixed(1)} to {analysis.eahi_ci90_high.toFixed(1)}
                  {analysis.true_eahi !== null && (
                    <span className="text-muted"> · Sleep-lab reference {analysis.true_eahi.toFixed(1)}</span>
                  )}
                </p>
                <p className="mt-3 text-sm font-medium">{sentenceCase(analysis.triage_action)}</p>
                <button
                  type="button"
                  onClick={onTrySample}
                  className="-ml-2 mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary hover:underline"
                >
                  See the full night
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </button>
              </>
            ) : (
              <div className="mt-3 space-y-3" aria-hidden>
                <div className="skeleton h-12 w-40" />
                <div className="skeleton h-16 w-full" />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Evidence and method, placed after the tool so returning users reach the workbench first. */
export function Evidence({ evaluation }: { evaluation: EvaluationPayload | null }) {
  const cb = evaluation?.test?.models?.cardiobreath;
  const stats = cb
    ? [
        { value: cb.minute_metrics.auroc.toFixed(3), label: "AUROC per minute", note: "35 held-out nights" },
        { value: cb.recording_metrics.eahi_mae.toFixed(2), label: "eAHI mean abs. error", note: "apnea-min/hr" },
        {
          value: `${(cb.recording_metrics.screening_cutoff_5.sensitivity * 100).toFixed(0)}%`,
          label: "Screening sensitivity",
          note: "at eAHI ≥ 5",
        },
      ]
    : null;

  return (
    <section aria-labelledby="evidence-title" className="border-t border-line py-12">
      <h2 id="evidence-title" className="text-xl font-semibold tracking-tight">
        How it works, and how well
      </h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="card p-5">
            <span className="text-sm font-semibold tabular-nums text-primary">0{i + 1}</span>
            <p className="mt-2 font-semibold">{s.title}</p>
            <p className="mt-1 text-sm text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(stats ?? [null, null, null]).map((s, i) => (
          <div key={i} className="border-t border-line pt-4">
            {s ? (
              <>
                <p className="text-3xl font-semibold tabular-nums tracking-tight">{s.value}</p>
                <p className="mt-1 text-sm">
                  {s.label} <span className="text-muted">· {s.note}</span>
                </p>
              </>
            ) : (
              <div className="skeleton h-14 w-40" aria-hidden />
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">
        Trained and evaluated on the PhysioNet Apnea-ECG database (Penzel et al., 2000). Full benchmark, calibration
        and limitations are on the Research tab.
      </p>
    </section>
  );
}
