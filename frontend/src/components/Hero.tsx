"use client";

import React from "react";
import { Upload } from "lucide-react";
import type { EvaluationPayload, FullNightAnalysis, WindowInspectorData } from "@/lib/types";
import { Reveal, SeverityBadge, sentenceCase } from "./ui";

interface HeroProps {
  analysis: FullNightAnalysis | null;
  ecg: WindowInspectorData | null;
  onTrySample: () => void;
  onUpload: () => void;
  onTour: () => void;
  onSeeNight: () => void;
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
    .map(([s, v], i) => `${i ? "L" : "M"}${(((s - t0) / STRIP_SECONDS) * W).toFixed(1)},${(H * 0.14 + (1 - (v - lo) / Math.max(hi - lo, 1e-6)) * H * 0.72).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden>
      <path d={d} pathLength={1} fill="none" strokeWidth="2.5" strokeLinejoin="round" className="draw phosphor stroke-primary" style={{ animationDuration: "2.6s" }} />
    </svg>
  );
}

export default function Hero({ analysis, ecg, onTrySample, onUpload, onTour, onSeeNight }: HeroProps) {
  const center = ecg?.time_window_label.match(/Center:\s*([\d:]+)/)?.[1];
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
        {/* Dark dialog panel so the copy never sits directly on neon windows */}
        <div className="card p-6 sm:p-8 lg:col-span-6" style={{ background: "rgb(13 10 38 / 0.86)" }}>
          <h1 id="hero-title" className="font-pixel text-[1.9rem] font-bold leading-[1.15] sm:text-5xl short:sm:text-4xl">
            Sleep apnea screening from a <span className="text-primary">single-lead ECG</span>
          </h1>
          <p className="mt-6 max-w-[50ch] text-lg text-muted short:mt-4">
            CardioBreath reads breathing out of an ordinary overnight ECG, scores every minute of the night, and tells
            you who should go to the sleep lab first.
          </p>
          <div className="mt-9 flex flex-wrap gap-4 short:mt-5">
            {/* The play glyph is the one arrow-like mark: it starts the sample night. */}
            <button type="button" onClick={onTrySample} className="btn-primary px-6 text-lg">
              <span aria-hidden>▶</span> Try a sample night
            </button>
            <button type="button" onClick={onTour} className="btn-secondary px-5 text-lg text-gold">
              Take the guided tour
            </button>
          </div>
          <button
            type="button"
            onClick={onUpload}
            className="mt-3 inline-flex min-h-11 items-center gap-2 font-hud text-xl leading-none text-muted hover:text-ink"
          >
            <Upload className="h-4 w-4" aria-hidden />
            Or upload your own ECG (CSV)
          </button>
          <p className="mt-7 max-w-[50ch] text-sm text-muted short:mt-3">
            <strong className="font-semibold text-ink">Screening aid, not a diagnosis.</strong> Results support referral
            decisions and must be confirmed by polysomnography.
          </p>
        </div>

        <figure className="relative lg:col-span-6">
          <div className="card-raised p-3">
            <div className="flex items-center justify-between px-1 pb-2 font-hud text-xl leading-none">
              <span className="text-coral">
                <span aria-hidden>♥ </span>
                {analysis && !analysis.case_id.startsWith("upload_") ? `Night ${analysis.case_id}` : "Sample night"}
              </span>
              <span className="text-muted">{center ? `${STRIP_SECONDS} s around ${center}` : "Loading…"}</span>
            </div>
            <div className="ecg-paper overflow-hidden">
              {ecg ? (
                <EcgStrip ecg={ecg} />
              ) : (
                <div className="grid aspect-[10/3] place-items-center font-hud text-2xl text-primary">Loading the sample night…</div>
              )}
            </div>
            {analysis && !analysis.case_id.startsWith("upload_") && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3">
                <span className="flex items-baseline gap-2">
                  <span className="font-hud text-4xl leading-none text-ink">eAHI {analysis.eahi_pred.toFixed(1)}</span>
                  <SeverityBadge tier={analysis.severity_tier} />
                </span>
                <button
                  type="button"
                  onClick={onSeeNight}
                  className="min-h-11 px-2 font-hud text-2xl leading-none text-primary underline-offset-4 hover:underline"
                >
                  See the full night →
                </button>
                <span className="w-full text-sm font-medium">{sentenceCase(analysis.triage_action)}</span>
              </div>
            )}
          </div>
        </figure>
      </div>
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
    <section id="evidence" aria-label="Method and evidence" className="grid gap-8 lg:grid-cols-12 lg:gap-12">
      <Reveal className="lg:col-span-7">
        <h2 className="font-pixel text-2xl font-bold">What it reads in one night</h2>
        <ol className="mt-6 space-y-5 short:mt-4 short:space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[5.5rem_1fr] gap-x-3">
              <span className="font-hud text-2xl leading-6 text-gold">Stage {i + 1}</span>
              <div>
                <p className="font-semibold">{s.title}</p>
                <p className="mt-1 max-w-[56ch] text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Reveal>

      <Reveal className="lg:col-span-5">
        <div className="card p-6">
          <h2 className="font-pixel text-xl font-bold">How well, on 35 nights it never saw</h2>
          <div className="mt-6 space-y-5 short:mt-3 short:space-y-3">
            {(stats ?? [null, null, null]).map((s, i) =>
              s ? (
                <div key={i} className="border-t-[3px] border-dashed border-line pt-3">
                  <p className="font-hud text-6xl leading-none text-primary short:text-5xl">{s.value}</p>
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
              className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
            >
              Full benchmark and limitations
            </button>
          </p>
        </div>
      </Reveal>
    </section>
  );
}
