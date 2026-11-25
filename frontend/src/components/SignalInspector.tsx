"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import type { WindowInspectorData } from "@/lib/types";

interface SignalInspectorProps {
  data: WindowInspectorData | null;
  loading: boolean;
  threshold: number;
  controls?: React.ReactNode; // e.g. the minute stepper, shown in the header row
}

// Viridis: perceptually uniform and colorblind-safe, readable in both themes.
const VIRIDIS = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"];
function viridis(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS[i].match(/\w\w/g)!.map((h) => parseInt(h, 16));
  const b = VIRIDIS[i + 1].match(/\w\w/g)!.map((h) => parseInt(h, 16));
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

function polyline(times: number[], values: number[], tMin: number, tMax: number, vMin: number, vMax: number, x0: number, w: number, y0: number, h: number) {
  const spanT = Math.max(tMax - tMin, 1e-6);
  const spanV = Math.max(vMax - vMin, 1e-6);
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(x0 + ((times[i] - tMin) / spanT) * w).toFixed(1)},${(y0 + (1 - (v - vMin) / spanV) * h).toFixed(1)}`)
    .join(" ");
}

function Track({ y, h, x0, w, title, top, bottom, children }: { y: number; h: number; x0: number; w: number; title: string; top: string; bottom: string; children: React.ReactNode }) {
  const gridYs = [0.25, 0.5, 0.75].map((f) => y + f * h);
  return (
    <g>
      <rect x={x0} y={y} width={w} height={h} rx="4" className="fill-surface stroke-grid" />
      {gridYs.map((gy) => (
        <line key={gy} x1={x0} x2={x0 + w} y1={gy} y2={gy} className="stroke-grid" strokeWidth="1" />
      ))}
      {Array.from({ length: 9 }, (_, k) => x0 + ((k + 1) / 10) * w).map((gx) => (
        <line key={gx} y1={y} y2={y + h} x1={gx} x2={gx} className="stroke-grid" strokeWidth="1" />
      ))}
      <text x={x0} y={y - 8} fontSize="13" fontWeight="600" className="fill-ink">
        {title}
      </text>
      <text x={x0 - 8} y={y + 12} textAnchor="end" fontSize="12" className="fill-muted tabular-nums">
        {top}
      </text>
      <text x={x0 - 8} y={y + h - 2} textAnchor="end" fontSize="12" className="fill-muted tabular-nums">
        {bottom}
      </text>
      {children}
    </g>
  );
}

export default function SignalInspector({ data, loading, threshold, controls }: SignalInspectorProps) {
  if (!data) {
    return (
      <section className="card p-6" aria-labelledby="inspector-title">
        <h2 id="inspector-title" className="text-xl font-semibold tracking-tight">
          Signal inspector
        </h2>
        {loading ? (
          <div className="skeleton mt-4 h-64 w-full" aria-hidden />
        ) : (
          <p className="mt-2 text-muted">Select a minute on the timeline to see its ECG, breathing and heart-rate signals.</p>
        )}
      </section>
    );
  }

  const width = 920;
  const padL = 56;
  const padR = 12;
  const plotW = width - padL - padR;
  const t1Y = 26, t1H = 64;
  const t2Y = t1Y + t1H + 34, t2H = 64;
  const t3Y = t2Y + t2H + 34, t3H = 64;
  const salY = t3Y + t3H + 30, salH = 14;
  const totalH = salY + salH + 26;

  const ecgMin = Math.min(...data.ecg_mv, -0.5);
  const ecgMax = Math.max(...data.ecg_mv, 0.5);
  const edrMin = Math.min(...data.edr_z, -2.5);
  const edrMax = Math.max(...data.edr_z, 2.5);
  const bpmMin = Math.max(35, Math.min(...data.rri_bpm, 50) - 4);
  const bpmMax = Math.min(150, Math.max(...data.rri_bpm, 85) + 4);
  const ecgT0 = data.ecg_time_sec[0] ?? 135;
  const ecgT1 = data.ecg_time_sec[data.ecg_time_sec.length - 1] ?? 165;

  const ecgPath = polyline(data.ecg_time_sec, data.ecg_mv, ecgT0, ecgT1, ecgMin, ecgMax, padL, plotW, t1Y, t1H);
  const edrPath = polyline(data.edr_time_sec, data.edr_z, 0, 300, edrMin, edrMax, padL, plotW, t2Y, t2H);
  const rriPath = polyline(data.edr_time_sec, data.rri_bpm, 0, 300, bpmMin, bpmMax, padL, plotW, t3Y, t3H);

  const heatBins = 60;
  const binSize = Math.max(1, Math.floor(data.gradcam_saliency.length / heatBins));
  const heat = Array.from({ length: heatBins }, (_, b) => {
    const s = data.gradcam_saliency.slice(b * binSize, (b + 1) * binSize);
    return s.length ? s.reduce((a, c) => a + c, 0) / s.length : 0;
  });
  const hMax = Math.max(...heat, 1e-6);
  const peakBin = heat.indexOf(Math.max(...heat));
  const colW = plotW / heatBins;
  const targetX = padL + (120 / 300) * plotW;
  const targetW = (60 / 300) * plotW;

  const isApnea = data.sqi_pass && data.apnea_prob >= threshold;
  const hrMin = Math.round(Math.min(...data.rri_bpm));
  const hrMax = Math.round(Math.max(...data.rri_bpm));
  const verdict = !data.sqi_pass ? "Deferred, low signal quality" : isApnea ? "Apnea" : "Normal";

  return (
    <section aria-labelledby="inspector-title" aria-busy={loading} className="card relative p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="inspector-title" className="text-xl font-semibold tracking-tight">
            Signal inspector · <span className="font-sans text-xl tabular-nums">{data.time_window_label}</span>
          </h2>
          <p className="text-sm text-muted">Five minutes around the selected minute, which is outlined.</p>
        </div>
        {controls}
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium leading-none ${
            !data.sqi_pass ? "bg-mild-soft text-mild-fg" : isApnea ? "bg-severe-soft text-severe-fg" : "bg-normal-soft text-normal-fg"
          }`}
        >
          {!data.sqi_pass && <AlertTriangle className="h-4 w-4" aria-hidden />}
          {verdict} · p {data.apnea_prob.toFixed(2)} · quality {data.sqi_score.toFixed(2)}
        </span>
      </div>

      <figure id="inspector-figure" className="mt-3">
        <div data-hscroll className={`-mx-5 overflow-x-auto px-5 transition-opacity duration-200 sm:-mx-6 sm:px-6 ${loading ? "opacity-50" : ""}`}>
          <svg viewBox={`0 0 ${width} ${totalH}`} className="h-auto w-full min-w-[640px] select-none" aria-hidden>
            <Track y={t1Y} h={t1H} x0={padL} w={plotW} title={`ECG, mV (centre 30 s: ${ecgT0.toFixed(0)} to ${ecgT1.toFixed(0)} s)`} top={ecgMax.toFixed(1)} bottom={ecgMin.toFixed(1)}>
              <path d={ecgPath} fill="none" strokeWidth="1" className="stroke-trace" />
            </Track>
            <Track y={t2Y} h={t2H} x0={padL} w={plotW} title="Breathing derived from ECG (EDR), z-score" top={`+${edrMax.toFixed(1)}`} bottom={edrMin.toFixed(1)}>
              <rect x={targetX} y={t2Y} width={targetW} height={t2H} fill="none" strokeWidth="1.5" strokeDasharray="4 3" className="stroke-muted" />
              <path d={edrPath} fill="none" strokeWidth="1.25" className="stroke-trace" />
            </Track>
            <Track y={t3Y} h={t3H} x0={padL} w={plotW} title="Heart rate from beat intervals (RRI), bpm" top={String(Math.round(bpmMax))} bottom={String(Math.round(bpmMin))}>
              <rect x={targetX} y={t3Y} width={targetW} height={t3H} fill="none" strokeWidth="1.5" strokeDasharray="4 3" className="stroke-muted" />
              <path d={rriPath} fill="none" strokeWidth="1.25" className="stroke-trace" />
            </Track>

            <text x={padL} y={salY - 8} fontSize="13" fontWeight="600" className="fill-ink">
              Model attention (Grad-CAM)
            </text>
            {heat.map((v, i) => (
              <rect key={i} x={padL + i * colW} y={salY} width={colW + 0.5} height={salH} fill={viridis(v / hMax)} />
            ))}
            {[0, 60, 120, 180, 240, 300].map((sec) => (
              <text key={sec} x={padL + (sec / 300) * plotW} y={totalH - 4} textAnchor={sec === 300 ? "end" : "middle"} fontSize="12" className="fill-muted tabular-nums">
                {sec} s
              </text>
            ))}
          </svg>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span className="flex items-center gap-2">
            Low
            <span className="h-3 w-28 rounded-sm" style={{ background: `linear-gradient(90deg, ${VIRIDIS.join(",")})` }} aria-hidden />
            High attention
          </span>
        </div>
        <figcaption className="mt-2 text-sm text-muted tabular-nums">
          Summary: {verdict.toLowerCase()} at probability {data.apnea_prob.toFixed(2)} (cutoff {threshold.toFixed(2)}). Heart
          rate ranged {hrMin} to {hrMax} bpm. The model attended most to {peakBin * 5} to {peakBin * 5 + 5} s of the window.
        </figcaption>
      </figure>
    </section>
  );
}
