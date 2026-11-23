"use client";

import React, { useState } from "react";
import { AlertCircle, Crosshair } from "lucide-react";
import type { FullNightAnalysis, MinutePoint } from "@/lib/types";

interface FullNightTimelineProps {
  analysis: FullNightAnalysis;
  selectedMinute: number;
  onSelectMinute: (minute: number) => void;
  showBaseline: boolean;
}

export default function FullNightTimeline({
  analysis,
  selectedMinute,
  onSelectMinute,
  showBaseline,
}: FullNightTimelineProps) {
  const [hovered, setHovered] = useState<MinutePoint | null>(null);
  const timeline = analysis.timeline;
  const n = Math.max(timeline.length, 1);

  const width = 920;
  const height = 148;
  const padL = 38;
  const padR = 14;
  const padT = 14;
  const plotW = width - padL - padR;
  const plotH = 82;
  const stripY = padT + plotH + 8;
  const stripH = 18;

  const xOf = (m: number) => padL + (m / Math.max(n - 1, 1)) * plotW;
  const yOf = (p: number) => padT + (1 - Math.min(1, Math.max(0, p))) * plotH;

  // Build SVG path strings for ensemble probability & optional LightGBM baseline
  const probPath = timeline
    .map((pt, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(pt.prob).toFixed(1)}`)
    .join(" ");

  const basePath =
    showBaseline && timeline[0]?.baseline_prob !== null
      ? timeline
          .map(
            (pt, i) =>
              `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(pt.baseline_prob ?? 0).toFixed(1)}`
          )
          .join(" ")
      : null;

  const jumpToPeakApnea = () => {
    const usable = timeline.filter((t) => t.sqi_pass);
    if (!usable.length) return;
    const best = usable.reduce((a, b) => (b.prob > a.prob ? b : a), usable[0]);
    onSelectMinute(best.minute);
  };

  const jumpToDeferred = () => {
    const firstDef = timeline.find((t) => !t.sqi_pass);
    if (firstDef) onSelectMinute(firstDef.minute);
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const frac = Math.min(1, Math.max(0, (relX - padL) / plotW));
    onSelectMinute(Math.round(frac * (n - 1)));
  };

  const handleSvgMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const frac = Math.min(1, Math.max(0, (relX - padL) / plotW));
    const idx = Math.round(frac * (n - 1));
    setHovered(timeline[idx] ?? null);
  };

  const barW = Math.max(plotW / n, 1.2);
  const thrY = yOf(analysis.threshold_used);
  const hourTicks = Array.from({ length: Math.ceil(analysis.duration_hours) + 1 }, (_, h) => h).filter(
    (h) => h * 60 < n
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <h2 className="text-sm font-extrabold text-[#0F2942]">
            Full-Night Apnea Probability Timeline ({analysis.duration_hours.toFixed(1)} hrs ·{" "}
            {analysis.duration_minutes} min)
          </h2>
          <p className="text-[11px] text-slate-500">
            Click anywhere along the night to inspect synchronized ECG, EDR breathing, RRI heart rate,
            and 1D Grad-CAM saliency.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={jumpToPeakApnea}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-50 hover:bg-rose-100 border border-rose-200 text-[11px] font-bold text-rose-700 transition"
          >
            <Crosshair className="h-3 w-3" />
            Peak Apnea
          </button>
          {analysis.deferred_minutes > 0 && (
            <button
              type="button"
              onClick={jumpToDeferred}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 border border-amber-200 text-[11px] font-bold text-amber-800 transition"
            >
              <AlertCircle className="h-3 w-3" />
              Deferred Noise ({analysis.deferred_minutes}m)
            </button>
          )}
        </div>
      </div>

      {/* Interactive SVG Timeline */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto cursor-crosshair select-none"
          onClick={handleSvgClick}
          onMouseMove={handleSvgMove}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Y Gridlines */}
          {[0, 0.5, 1.0].map((v) => (
            <g key={v}>
              <line
                x1={padL}
                y1={yOf(v)}
                x2={width - padR}
                y2={yOf(v)}
                stroke="#E2E8F0"
                strokeWidth="1"
              />
              <text
                x={padL - 6}
                y={yOf(v) + 3.5}
                textAnchor="end"
                fontSize="9.5"
                fill="#64748B"
                fontFamily="monospace"
              >
                {v.toFixed(1)}
              </text>
            </g>
          ))}

          {/* Ground-truth background apnea clusters (subtle rose tint for held-out demo nights) */}
          {timeline.map((pt, i) =>
            pt.ground_truth === 1 ? (
              <rect
                key={`gt-${i}`}
                x={xOf(i)}
                y={padT}
                width={barW + 0.4}
                height={plotH}
                fill="#FFE4E6"
                opacity="0.55"
              />
            ) : null
          )}

          {/* Baseline HRV Probability Curve (optional dashed slate) */}
          {basePath && (
            <path
              d={basePath}
              fill="none"
              stroke="#94A3B8"
              strokeWidth="1.2"
              strokeDasharray="3 2"
              opacity="0.85"
            />
          )}

          {/* CardioBreath Calibrated Probability Curve */}
          <path d={probPath} fill="none" stroke="#0F2942" strokeWidth="1.7" />

          {/* Decision Threshold Line */}
          <line
            x1={padL}
            y1={thrY}
            x2={width - padR}
            y2={thrY}
            stroke="#0D9488"
            strokeWidth="1.2"
            strokeDasharray="5 3"
          />

          {/* Discrete Color-Coded Sleep Classification Strip */}
          {timeline.map((pt, i) => {
            const fill = !pt.sqi_pass
              ? "#F59E0B"
              : pt.pred === 1
                ? "#E11D48"
                : "#10B981";
            return (
              <rect
                key={`st-${i}`}
                x={xOf(i)}
                y={stripY}
                width={barW + 0.4}
                height={stripH}
                fill={fill}
                opacity={!pt.sqi_pass ? 0.95 : 0.86}
              />
            );
          })}

          {/* Selected 5-Minute Inspection Window Highlight */}
          <rect
            x={Math.max(padL, xOf(Math.max(0, selectedMinute - 2)))}
            y={padT - 2}
            width={Math.max(10, xOf(Math.min(n - 1, selectedMinute + 2)) - xOf(Math.max(0, selectedMinute - 2)))}
            height={plotH + stripH + 12}
            rx="3"
            fill="#0D9488"
            fillOpacity="0.12"
            stroke="#0F2942"
            strokeWidth="1.8"
          />

          {/* X-Axis Hour Labels */}
          {hourTicks.map((h) => (
            <text
              key={`hr-${h}`}
              x={xOf(h * 60)}
              y={height - 4}
              textAnchor="middle"
              fontSize="9.5"
              fill="#475569"
              fontFamily="monospace"
            >
              {String(h).padStart(2, "0")}:00
            </text>
          ))}
        </svg>

        {/* Live Hover Readout Pill */}
        {hovered && (
          <div className="absolute top-1 right-2 bg-[#0F2942]/95 text-white text-[11px] font-mono px-2.5 py-1 rounded-md shadow pointer-events-none">
            {hovered.time_label} (min {hovered.minute}) · p={hovered.prob.toFixed(2)} ±{" "}
            {hovered.prob_std.toFixed(2)} · SQI={hovered.sqi_score.toFixed(2)}{" "}
            {!hovered.sqi_pass ? "[DEFERRED]" : hovered.pred === 1 ? "[APNEA]" : "[NORMAL]"}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            Normal Sleep
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-600" />
            Detected Apnea (p &ge; {analysis.threshold_used.toFixed(2)})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
            Low SQI (Abstained)
          </span>
          {analysis.true_eahi !== null && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-200 border border-rose-300" />
              Expert Ground Truth
            </span>
          )}
          {showBaseline && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-slate-400" />
              HRV LightGBM Baseline
            </span>
          )}
        </div>
        <span className="font-mono text-[#0F2942] font-bold">
          Selected: min {selectedMinute} ({timeline[selectedMinute]?.time_label ?? "00:00"})
        </span>
      </div>
    </div>
  );
}
