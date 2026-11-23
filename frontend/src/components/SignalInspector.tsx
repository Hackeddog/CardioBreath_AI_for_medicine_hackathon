"use client";

import React from "react";
import { AlertTriangle, Eye, Sparkles } from "lucide-react";
import type { WindowInspectorData } from "@/lib/types";

interface SignalInspectorProps {
  data: WindowInspectorData | null;
  loading: boolean;
  threshold: number;
}

function buildPolyline(
  times: number[],
  values: number[],
  tMin: number,
  tMax: number,
  vMin: number,
  vMax: number,
  x0: number,
  plotW: number,
  y0: number,
  plotH: number
): string {
  const spanT = Math.max(tMax - tMin, 1e-6);
  const spanV = Math.max(vMax - vMin, 1e-6);
  return values
    .map((v, i) => {
      const x = x0 + ((times[i] - tMin) / spanT) * plotW;
      const y = y0 + (1 - (v - vMin) / spanV) * plotH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function SignalInspector({ data, loading, threshold }: SignalInspectorProps) {
  if (!data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
        Select a minute on the overnight timeline to inspect cardiopulmonary waveforms and 1D Grad-CAM.
      </div>
    );
  }

  const width = 920;
  const padL = 56;
  const padR = 16;
  const plotW = width - padL - padR;

  // Track Y offsets
  const t1Y = 20;
  const t1H = 74; // Center 30s high-res ECG
  const t2Y = 122;
  const t2H = 82; // 5-min EDR breathing envelope + Grad-CAM
  const t3Y = 232;
  const t3H = 82; // 5-min RRI heart-rate BPM + Grad-CAM
  const totalH = 338;

  // Compute safe ranges
  const ecgMin = Math.min(...data.ecg_mv, -0.5);
  const ecgMax = Math.max(...data.ecg_mv, 0.5);
  const edrMin = Math.min(...data.edr_z, -2.5);
  const edrMax = Math.max(...data.edr_z, 2.5);
  const bpmMin = Math.max(35, Math.min(...data.rri_bpm, 50) - 4);
  const bpmMax = Math.min(150, Math.max(...data.rri_bpm, 85) + 4);

  const ecgPath = buildPolyline(
    data.ecg_time_sec,
    data.ecg_mv,
    data.ecg_time_sec[0] ?? 135,
    data.ecg_time_sec[data.ecg_time_sec.length - 1] ?? 165,
    ecgMin,
    ecgMax,
    padL,
    plotW,
    t1Y,
    t1H
  );

  const edrPath = buildPolyline(
    data.edr_time_sec,
    data.edr_z,
    0,
    300,
    edrMin,
    edrMax,
    padL,
    plotW,
    t2Y,
    t2H
  );

  const rriPath = buildPolyline(
    data.edr_time_sec,
    data.rri_bpm,
    0,
    300,
    bpmMin,
    bpmMax,
    padL,
    plotW,
    t3Y,
    t3H
  );

  // Downsample Grad-CAM into 60 crisp 5-second vertical heat bands across the 5-min window
  const heatBins = 60;
  const binSize = Math.max(1, Math.floor(data.gradcam_saliency.length / heatBins));
  const heatCols = Array.from({ length: heatBins }, (_, b) => {
    const slice = data.gradcam_saliency.slice(b * binSize, (b + 1) * binSize);
    const avg = slice.length ? slice.reduce((a, c) => a + c, 0) / slice.length : 0;
    return avg;
  });
  const colW = plotW / heatBins;

  const isApnea = data.sqi_pass && data.apnea_prob >= threshold;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm relative">
      {loading && (
        <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-xl">
          <span className="px-3 py-1.5 rounded-lg bg-[#0F2942] text-white text-xs font-semibold shadow">
            Computing 1D Grad-CAM saliency...
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <div>
          <h2 className="text-sm font-extrabold text-[#0F2942] flex items-center gap-1.5">
            <Eye className="h-4 w-4 text-teal-600" />
            Explainable 3-Track Cardiopulmonary Inspector — {data.time_window_label}
          </h2>
          <p className="text-[11px] text-slate-500">
            Coral heatmap bands highlight the exact seconds where the Multi-Scale 1D-CNN + BiGRU
            focused (1D Grad-CAM).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!data.sqi_pass ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold">
              <AlertTriangle className="h-3.5 w-3.5" />
              DEFERRED · Low SQI ({data.sqi_score.toFixed(2)})
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                isApnea
                  ? "bg-rose-100 border border-rose-300 text-rose-800"
                  : "bg-emerald-100 border border-emerald-300 text-emerald-800"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isApnea ? "APNEA DETECTED" : "NORMAL EPOCH"} · p={data.apnea_prob.toFixed(2)} · SQI=
              {data.sqi_score.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${totalH}`} className="w-full h-auto select-none">
        {/* === TRACK 1: Center 30-Second Raw Filtered ECG (Peak-Preserved QRS) === */}
        <rect
          x={padL}
          y={t1Y}
          width={plotW}
          height={t1H}
          rx="4"
          fill="#F8FAFC"
          stroke="#E2E8F0"
        />
        <text x={padL + 8} y={t1Y + 13} fontSize="9.5" fontWeight="700" fill="#0F2942">
          1. FILTERED SINGLE-LEAD ECG (Center 30s QRS Morphology, mV)
        </text>
        <text x={padL - 8} y={t1Y + 14} textAnchor="end" fontSize="8.5" fill="#64748B" fontFamily="monospace">
          {ecgMax.toFixed(1)}
        </text>
        <text x={padL - 8} y={t1Y + t1H - 3} textAnchor="end" fontSize="8.5" fill="#64748B" fontFamily="monospace">
          {ecgMin.toFixed(1)}
        </text>
        <path d={ecgPath} fill="none" stroke="#1E293B" strokeWidth="1.25" />

        {/* === TRACK 2: 5-Minute ECG-Derived Respiration (EDR) + Grad-CAM === */}
        <rect
          x={padL}
          y={t2Y}
          width={plotW}
          height={t2H}
          rx="4"
          fill="#FFFFFF"
          stroke="#CBD5E1"
        />
        {/* Grad-CAM Saliency Heat Bands on EDR */}
        {heatCols.map((val, idx) => (
          <rect
            key={`h2-${idx}`}
            x={padL + idx * colW}
            y={t2Y}
            width={colW + 0.5}
            height={t2H}
            fill="#E11D48"
            opacity={val > 0.25 ? (val - 0.2) * 0.45 : 0}
          />
        ))}
        {/* Center Target Minute Highlight */}
        <rect
          x={padL + (120 / 300) * plotW}
          y={t2Y}
          width={(60 / 300) * plotW}
          height={t2H}
          fill="none"
          stroke="#0F2942"
          strokeWidth="1.2"
          strokeDasharray="4 3"
        />
        <text x={padL + 8} y={t2Y + 13} fontSize="9.5" fontWeight="700" fill="#0F766E">
          2. ECG-DERIVED RESPIRATION — EDR (5-Min Breathing Wave @ 4 Hz, z-score)
        </text>
        <text x={padL - 8} y={t2Y + 14} textAnchor="end" fontSize="8.5" fill="#64748B" fontFamily="monospace">
          +{edrMax.toFixed(1)}
        </text>
        <text x={padL - 8} y={t2Y + t2H - 3} textAnchor="end" fontSize="8.5" fill="#64748B" fontFamily="monospace">
          {edrMin.toFixed(1)}
        </text>
        <path d={edrPath} fill="none" stroke="#0D9488" strokeWidth="1.75" />

        {/* === TRACK 3: 5-Minute Beat-to-Beat Heart Rate (CVHR) + Grad-CAM === */}
        <rect
          x={padL}
          y={t3Y}
          width={plotW}
          height={t3H}
          rx="4"
          fill="#FFFFFF"
          stroke="#CBD5E1"
        />
        {/* Grad-CAM Saliency Heat Bands on RRI */}
        {heatCols.map((val, idx) => (
          <rect
            key={`h3-${idx}`}
            x={padL + idx * colW}
            y={t3Y}
            width={colW + 0.5}
            height={t3H}
            fill="#E11D48"
            opacity={val > 0.25 ? (val - 0.2) * 0.45 : 0}
          />
        ))}
        <rect
          x={padL + (120 / 300) * plotW}
          y={t3Y}
          width={(60 / 300) * plotW}
          height={t3H}
          fill="none"
          stroke="#0F2942"
          strokeWidth="1.2"
          strokeDasharray="4 3"
        />
        <text x={padL + 8} y={t3Y + 13} fontSize="9.5" fontWeight="700" fill="#BE123C">
          3. CYCLIC HEART RATE COUPLING — RRI TACHOGRAM (5-Min Heart Rate, BPM)
        </text>
        <text x={padL - 8} y={t3Y + 14} textAnchor="end" fontSize="8.5" fill="#64748B" fontFamily="monospace">
          {Math.round(bpmMax)}
        </text>
        <text x={padL - 8} y={t3Y + t3H - 3} textAnchor="end" fontSize="8.5" fill="#64748B" fontFamily="monospace">
          {Math.round(bpmMin)}
        </text>
        <path d={rriPath} fill="none" stroke="#E11D48" strokeWidth="1.75" />

        {/* Shared 5-Minute Time Axis */}
        {[0, 60, 120, 180, 240, 300].map((sec) => {
          const x = padL + (sec / 300) * plotW;
          const lbl = sec === 120 ? "120s (Target Start)" : sec === 180 ? "180s (Target End)" : `${sec}s`;
          return (
            <text
              key={sec}
              x={x}
              y={totalH - 6}
              textAnchor="middle"
              fontSize="9"
              fill={sec === 120 || sec === 180 ? "#0F2942" : "#64748B"}
              fontWeight={sec === 120 || sec === 180 ? "700" : "400"}
              fontFamily="monospace"
            >
              {lbl}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
