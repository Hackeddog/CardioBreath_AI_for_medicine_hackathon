"use client";

import React, { useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, Check, CheckCircle2, Info, X } from "lucide-react";
import { ApiError } from "@/lib/api";

/* ---------- Severity tiers: color is never the only cue (icon + label + range) ---------- */

export const TIERS = {
  Normal: { icon: CheckCircle2, range: "below 5", cls: "bg-normal-soft text-normal-fg", bar: "bg-normal" },
  Mild: { icon: Info, range: "5 to 15", cls: "bg-mild-soft text-mild-fg", bar: "bg-mild" },
  Moderate: { icon: AlertTriangle, range: "15 to 30", cls: "bg-moderate-soft text-moderate-fg", bar: "bg-moderate" },
  Severe: { icon: AlertOctagon, range: "30 or more", cls: "bg-severe-soft text-severe-fg", bar: "bg-severe" },
} as const;

export type TierName = keyof typeof TIERS;

export function tierOf(name: string): TierName {
  return name in TIERS ? (name as TierName) : "Normal";
}

export function SeverityBadge({ tier, size = "md" }: { tier: string; size?: "md" | "lg" }) {
  const t = TIERS[tierOf(tier)];
  const Icon = t.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${t.cls} ${
        size === "lg" ? "px-3.5 py-1.5 text-base" : "px-2.5 py-1 text-sm"
      }`}
    >
      <Icon className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} aria-hidden />
      {tierOf(tier)}
    </span>
  );
}

/** Backend triage strings are ALL CAPS; sentence case reads faster. Keeps clinical acronyms. */
export function sentenceCase(s: string): string {
  const lower = s.toLowerCase().replace(/\b(psg|ecg|ahi|afib)\b/g, (m) => m.toUpperCase());
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/* ---------- Plain-language errors ---------- */

export interface Notice {
  title: string;
  body: string;
  showCsvFormat?: boolean;
}

export function friendlyError(err: unknown, ctx: "upload" | "analysis" | "window", caseId?: string): Notice {
  if (err instanceof ApiError) {
    if (err.status === 400 && ctx === "upload") {
      return {
        title: "We couldn't read this ECG file",
        body: err.detail || "The file doesn't contain a usable ECG column.",
        showCsvFormat: true,
      };
    }
    if (err.status === 413) {
      return { title: "This file is too large", body: err.detail || "Please upload a smaller file." };
    }
    if (err.status === 404 && caseId?.startsWith("upload_")) {
      return {
        title: "This upload has expired",
        body: "Only the most recent uploads are kept in memory. Please upload the file again.",
      };
    }
    if (err.status === 400) {
      return { title: "This request couldn't be processed", body: err.detail || "Please check the input and try again." };
    }
    return { title: "Something went wrong on our side", body: "The analysis didn't complete. Please try again in a moment." };
  }
  return { title: "Can't reach the analysis server", body: "Check that the CardioBreath server is running, then try again." };
}

export function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div role="alert" className="card flex gap-3 border-severe bg-severe-soft p-4 text-severe-fg">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{notice.title}</p>
        <p className="mt-0.5 text-sm">{notice.body}</p>
        {notice.showCsvFormat && (
          <div className="mt-3 text-sm text-ink">
            <p className="font-medium">Expected format: a CSV with a numeric ECG column (mV), optionally a time column in seconds.</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 text-xs leading-relaxed tabular-nums">
              {"time,ecg\n0.00,-0.260\n0.01,-0.065\n0.02,-0.230"}
            </pre>
            <p className="mt-1 text-muted">At least 60 seconds of signal, sampled at 25 to 2000 Hz.</p>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-surface/60"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/* ---------- Analysis progress ---------- */

// shortcut: steps advance on a timer (the API reports no progress), tuned to the ~7.5 s CPU run.
const STEPS = [
  { label: "Processing signal", at: 0 },
  { label: "Running model", at: 2000 },
  { label: "Building timeline", at: 5500 },
];

export function AnalysisProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(id);
  }, []);
  const current = STEPS.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);

  return (
    <div role="status" aria-live="polite" className="card p-5">
      <p className="font-semibold">Analyzing the night</p>
      <p className="text-sm text-muted">This takes about 8 seconds on a CPU.</p>
      <ol className="mt-4 flex flex-col gap-3 sm:flex-row sm:gap-6">
        {STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.label} className="flex items-center gap-2 text-sm" aria-current={active ? "step" : undefined}>
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold tabular-nums ${
                  done ? "bg-primary text-primary-ink" : active ? "bg-primary-soft text-ink ring-2 ring-primary" : "bg-surface-2 text-muted"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={active ? "font-semibold" : done ? "" : "text-muted"}>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function WorkbenchSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12" aria-hidden>
      <div className="card space-y-4 p-6 lg:col-span-4">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-14 w-32" />
        <div className="skeleton h-4 w-56" />
        <div className="skeleton h-16 w-full" />
      </div>
      <div className="space-y-6 lg:col-span-8">
        <div className="card p-6">
          <div className="skeleton h-5 w-64" />
          <div className="skeleton mt-4 h-40 w-full" />
        </div>
        <div className="card p-6">
          <div className="skeleton h-5 w-52" />
          <div className="skeleton mt-4 h-64 w-full" />
        </div>
      </div>
    </div>
  );
}
