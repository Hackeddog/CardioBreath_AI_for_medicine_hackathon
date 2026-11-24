"use client";

import React from "react";
import { ArrowDown, Upload } from "lucide-react";
import type { EvaluationPayload, FullNightAnalysis, WindowInspectorData } from "@/lib/types";
import { Reveal, SeverityBadge, sentenceCase } from "./ui";

interface HeroProps {
  analysis: FullNightAnalysis | null;
  ecg: WindowInspectorData | null;
  onTrySample: () => void;
  onUpload: () => void;
}

const STRIP_SECONDS = 10; // a classic rhythm-strip length; 30 s is too dense to read at hero size

function EcgStrip({ ecg }: { ecg: WindowInspectorData }) {
  const t = ecg.ecg_time_sec;
  const mid = (t[0] + t[t.length - 1]) / 2;
  const t0 = mid - STRIP_SECONDS / 2;
  const pts = ecg.ecg_mv.map((v, i) => [t[i], v] as const).filter(([s]) => s >= t0 && s <= t0 + STRIP_SECONDS);
  const vs = pts.map(([, v]) => v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const W = 1000;
  const H = 300;
  const d = pts
    .map(([s, v], i) => `${i ? "L" : "M"}${(((s - t0) / STRIP_SECONDS) * W).toFixed(1)},${(H * 0.12 + (1 - (v - lo) / Math.max(hi - lo, 1e-6)) * H * 0.76).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden>
      <path d={d} pathLength={1} fill="none" strokeWidth="2" strokeLinejoin="round" className="draw stroke-trace" style={{ animationDuration: "2.6s" }} />
    </svg>
  );
}

export default function Hero({ analysis, ecg, onTrySample, onUpload }: HeroProps) {
  return (
    <section aria-labelledby="hero-title" className="grid items-center gap-10 pb-14 pt-10 sm:pt-16 lg:grid-cols-12">
      <div className="lg:col-span-6">
        <h1 id="hero-title" className="font-serif text-[2.6rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl">
          Sleep apnea screening from a single-lead ECG
        </h1>
        <p className="mt-6 max-w-[52ch] text-lg text-muted">
          CardioBreath reads breathing out of an ordinary overnight ECG, estimates apnea burden, and tells you who
          should go to the sleep lab first.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={onTrySample} className="btn-primary px-6 text-base">
            Try a sample night
          </button>
          <button type="button" onClick={onUpload} className="btn-secondary px-5 text-base">
            <Upload className="h-4 w-4" aria-hidden />
            Upload ECG
          </button>
        </div>
        <p className="mt-6 max-w-[52ch] text-sm text-muted">
          <strong className="font-semibold text-ink">Screening aid, not a diagnosis.</strong> Results support referral
          decisions and must be confirmed by polysomnography.
        </p>
      </div>

      <figure className="lg:col-span-6">
        <div className="ecg-paper overflow-hidden rounded-xl border border-line">
          {ecg ? (
            <EcgStrip ecg={ecg} />
          ) : (
            <div className="grid aspect-[10/3] place-items-center text-sm text-muted">Loading the sample night…</div>
          )}
        </div>
        <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
          {analysis && !analysis.case_id.startsWith("upload_") ? (
            <>
              <span className="text-muted tabular-nums">
                Night {analysis.case_id}, {STRIP_SECONDS} s of ECG around{" "}
                {ecg?.time_window_label.match(/Center:\s*([\d:]+)/)?.[1] ?? "…"}
              </span>
              <span className="flex items-center gap-3">
                <span className="font-semibold tabular-nums">eAHI {analysis.eahi_pred.toFixed(1)}</span>
                <SeverityBadge tier={analysis.severity_tier} />
              </span>
              <span className="w-full font-medium">{sentenceCase(analysis.triage_action)}</span>
              <button
                type="button"
                onClick={onTrySample}
                className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-semibold text-primary hover:underline"
              >
                See the full night
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
            </>
          ) : (
            <span className="text-muted">Single-lead ECG from a held-out test night.</span>
          )}
        </figcaption>
      </figure>
    </section>
  );
}

const STEPS = [
  {
    title: "A night of single-lead ECG",
    body: "From a patch or Holter, the recording many clinics already make. No belts, no sleep lab.",
  },
  {
    title: "Breathing and heart rate, derived",
    body: "Respiration (EDR) and beat-to-beat heart rate (RRI) are pulled out of the ECG for every minute.",
  },
  {
    title: "Five models and a quality gate",
    body: "Five calibrated models score each minute. Minutes with too much noise are deferred instead of guessed.",
  },
  {
    title: "A triage call with its uncertainty",
    body: "Overnight apnea burden (eAHI), a 90% interval, and whether to prioritize a sleep study.",
  },
];

/** Method and evidence, after the tool, so returning users reach the workbench first. */
export function Evidence({ evaluation, onOpenResearch }: { evaluation: EvaluationPayload | null; onOpenResearch: () => void }) {
  const cb = evaluation?.test?.models?.cardiobreath;
  const stats = cb
    ? [
        { value: cb.minute_metrics.auroc.toFixed(3), label: "AUROC, per minute" },
        { value: cb.recording_metrics.eahi_mae.toFixed(2), label: "eAHI mean absolute error, apnea-min/hr" },
        { value: `${(cb.recording_metrics.screening_cutoff_5.sensitivity * 100).toFixed(0)}%`, label: "of apnea patients flagged at eAHI ≥ 5" },
      ]
    : null;

  return (
    <section aria-label="Method and evidence" className="grid gap-12 border-t border-line py-16 lg:grid-cols-12">
      <Reveal className="lg:col-span-7">
        <h2 className="font-serif text-3xl font-semibold tracking-tight">What it reads in one night</h2>
        <ol className="mt-8 space-y-7">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[2.5rem_1fr] gap-x-2">
              <span className="font-serif text-2xl leading-none text-muted tabular-nums" aria-hidden>
                {i + 1}
              </span>
              <div>
                <p className="font-semibold">{s.title}</p>
                <p className="mt-1 max-w-[56ch] text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Reveal>

      <Reveal className="lg:col-span-5">
        <h2 className="font-serif text-3xl font-semibold tracking-tight">How well, on 35 nights it never saw</h2>
        <div className="mt-8 space-y-6">
          {(stats ?? [null, null, null]).map((s, i) =>
            s ? (
              <div key={i} className="border-t-2 border-ink pt-3">
                <p className="text-5xl font-semibold tabular-nums tracking-tight">{s.value}</p>
                <p className="mt-1 text-muted">{s.label}</p>
              </div>
            ) : (
              <div key={i} className="skeleton h-20 w-48" aria-hidden />
            )
          )}
        </div>
        <p className="mt-6 text-sm text-muted">
          Locked held-out test set x01 to x35, PhysioNet Apnea-ECG (Penzel et al., 2000).{" "}
          <button
            type="button"
            onClick={onOpenResearch}
            className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline"
          >
            Full benchmark and limitations
          </button>
        </p>
      </Reveal>
    </section>
  );
}
