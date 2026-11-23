"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  GitCompare,
  HeartPulse,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { FullNightAnalysis } from "@/lib/types";

interface TriageSummaryPanelProps {
  analysis: FullNightAnalysis;
  threshold: number;
  defaultThreshold: number;
  onThresholdChange: (thr: number) => void;
  compareBaseline: boolean;
  onToggleBaseline: (val: boolean) => void;
}

function tierStyles(tier: string) {
  switch (tier) {
    case "Severe":
      return {
        bg: "bg-rose-50",
        border: "border-rose-200",
        badge: "bg-rose-600 text-white",
        value: "text-rose-700",
        label: "text-rose-900",
      };
    case "Moderate":
      return {
        bg: "bg-orange-50",
        border: "border-orange-200",
        badge: "bg-orange-600 text-white",
        value: "text-orange-700",
        label: "text-orange-900",
      };
    case "Mild":
      return {
        bg: "bg-amber-50",
        border: "border-amber-200",
        badge: "bg-amber-500 text-slate-950",
        value: "text-amber-700",
        label: "text-amber-900",
      };
    default:
      return {
        bg: "bg-emerald-50",
        border: "border-emerald-200",
        badge: "bg-emerald-600 text-white",
        value: "text-emerald-700",
        label: "text-emerald-900",
      };
  }
}

export default function TriageSummaryPanel({
  analysis,
  threshold,
  defaultThreshold,
  onThresholdChange,
  compareBaseline,
  onToggleBaseline,
}: TriageSummaryPanelProps) {
  const st = tierStyles(analysis.severity_tier);
  const usablePct = Math.round(analysis.usable_ratio * 1000) / 10;

  return (
    <div className="space-y-4">
      {/* 1. Primary Screening Triage Card */}
      <div className={`rounded-xl border ${st.border} ${st.bg} p-4 shadow-sm`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className={`text-[11px] font-extrabold uppercase tracking-wider ${st.label}`}>
            Screening Triage Result
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/80 border border-slate-200 text-[11px] font-mono text-slate-600">
            <Clock className="h-3 w-3 text-teal-600" />
            {analysis.inference_ms.toFixed(0)} ms CPU
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-extrabold tabular-nums tracking-tight ${st.value}`}>
            eAHI: {analysis.eahi_pred.toFixed(1)}
          </span>
          <span className="text-xs font-semibold text-slate-600">apnea-min / hr</span>
        </div>

        <div className="mt-1.5 text-xs text-slate-600 font-mono tabular-nums">
          90% Ensemble CI: [{analysis.eahi_ci90_low.toFixed(1)}, {analysis.eahi_ci90_high.toFixed(1)}]
          {analysis.true_eahi !== null && (
            <span className="ml-2 text-slate-500">
              · Ground Truth: <strong className="text-slate-800">{analysis.true_eahi.toFixed(1)}</strong>
            </span>
          )}
        </div>

        <div className={`mt-3 rounded-lg px-3 py-2 text-[11px] font-bold tracking-wide text-center ${st.badge}`}>
          {analysis.triage_action}
        </div>

        {/* Clinician Operating Threshold Slider */}
        <div className="mt-3 pt-3 border-t border-slate-200/80">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="font-semibold text-slate-700">
              Decision Cutoff: <code className="font-mono font-bold">{threshold.toFixed(2)}</code>
            </span>
            {Math.abs(threshold - defaultThreshold) > 0.005 ? (
              <button
                type="button"
                onClick={() => onThresholdChange(defaultThreshold)}
                className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 font-semibold"
              >
                <RotateCcw className="h-3 w-3" />
                Reset CV ({defaultThreshold.toFixed(2)})
              </button>
            ) : (
              <span className="text-teal-700 font-semibold">CV-Locked Optimal</span>
            )}
          </div>
          <input
            type="range"
            min={0.25}
            max={0.8}
            step={0.05}
            value={threshold}
            onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
            className="w-full accent-teal-600 cursor-pointer h-1.5"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
            <span>Higher Sensitivity (0.25)</span>
            <span>Higher Specificity (0.80)</span>
          </div>
        </div>
      </div>

      {/* 2. Signal Quality & Clinical Honesty Gate Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#0F2942] flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-teal-600" />
            Signal Quality &amp; Honesty Gate
          </span>
          {analysis.noise_snr_db !== null && (
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
              NOISE {analysis.noise_snr_db} dB
            </span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs mb-1">
          <span className="font-semibold text-slate-700">Usable Signal Coverage</span>
          <span
            className={`font-mono font-bold tabular-nums ${
              usablePct >= 85 ? "text-emerald-700" : usablePct >= 50 ? "text-amber-600" : "text-rose-600"
            }`}
          >
            {usablePct.toFixed(1)}%
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden mb-3">
          <div
            className={`h-full transition-all duration-300 ${
              usablePct >= 85 ? "bg-emerald-500" : usablePct >= 50 ? "bg-amber-500" : "bg-rose-500"
            }`}
            style={{ width: `${Math.min(100, Math.max(0, usablePct))}%` }}
          />
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-600 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Deferred / Abstained (Low SQI)
            </span>
            <span className="font-mono font-bold text-amber-700 tabular-nums">
              {analysis.deferred_minutes} min ({((analysis.deferred_minutes / Math.max(analysis.duration_minutes, 1)) * 100).toFixed(1)}%)
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-600 flex items-center gap-1.5">
              <HeartPulse className="h-3.5 w-3.5 text-teal-600" />
              Rhythm Confounder Check
            </span>
            {analysis.rhythm_irregular ? (
              <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[11px]">
                Irregular / Suspect AFib
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sinus (RMSSD/RR {analysis.rhythm_rmssd_ratio.toFixed(3)})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Live Model vs. Classical Baseline Comparison Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#0F2942] flex items-center gap-1.5">
            <GitCompare className="h-4 w-4 text-teal-600" />
            CardioBreath vs. Baseline HRV
          </span>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={compareBaseline}
              onChange={(e) => onToggleBaseline(e.target.checked)}
              className="accent-teal-600 rounded"
            />
            Overlay
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div className="rounded-lg bg-teal-50/70 border border-teal-200 p-2.5">
            <div className="text-[10px] font-bold uppercase text-teal-800">CardioBreath 5-Fold</div>
            <div className="text-lg font-extrabold text-[#0F2942] tabular-nums mt-0.5">
              {analysis.eahi_pred.toFixed(1)}
              <span className="text-[10px] font-medium text-slate-500 ml-1">eAHI</span>
            </div>
            {analysis.minute_acc !== null && (
              <div className="text-[11px] font-semibold text-teal-700 mt-0.5 tabular-nums">
                {(analysis.minute_acc * 100).toFixed(1)}% min-acc
              </div>
            )}
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
            <div className="text-[10px] font-bold uppercase text-slate-500">HRV + LightGBM Base</div>
            <div className="text-lg font-extrabold text-slate-700 tabular-nums mt-0.5">
              {analysis.baseline_eahi !== null ? analysis.baseline_eahi.toFixed(1) : "—"}
              <span className="text-[10px] font-medium text-slate-400 ml-1">eAHI</span>
            </div>
            {analysis.baseline_minute_acc !== null && (
              <div className="text-[11px] font-semibold text-slate-600 mt-0.5 tabular-nums">
                {(analysis.baseline_minute_acc * 100).toFixed(1)}% min-acc
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
