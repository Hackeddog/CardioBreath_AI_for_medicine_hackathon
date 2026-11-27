"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { WindowInspectorData } from "@/lib/types";

interface SignalInspectorProps {
  data: WindowInspectorData | null;
  loading: boolean;
  threshold: number;
  controls?: React.ReactNode; // e.g. the minute stepper, shown in the header row
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
const heatBins = 60;

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

function nearestIndex(times: number[], targetSec: number): number {
  const n = times.length;
  if (n === 0) return -1;
  if (targetSec <= times[0]) return 0;
  if (targetSec >= times[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < targetSec) lo = mid + 1;
    else hi = mid;
  }
  return Math.abs(times[lo - 1] - targetSec) <= Math.abs(times[lo] - targetSec) ? lo - 1 : lo;
}

function formatClock(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "Pre-start";
  const s = Math.floor(totalSec);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function yCoord(v: number, vMin: number, vMax: number, y0: number, h: number): number {
  const spanV = Math.max(vMax - vMin, 1e-6);
  return y0 + (1 - Math.min(1, Math.max(0, (v - vMin) / spanV))) * h;
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    setHoverIdx(null);
  }, [data?.case_id]);

  const chart = useMemo(() => {
    if (!data) return null;

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
    const hrMin = Math.round(Math.min(...data.rri_bpm));
    const hrMax = Math.round(Math.max(...data.rri_bpm));

    const staticSvg = (
      <g>
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
      </g>
    );

    return { edrMin, edrMax, bpmMin, bpmMax, heat, hMax, peakBin, hrMin, hrMax, staticSvg };
  }, [data]);

  if (!data || !chart) {
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

  const isApnea = data.sqi_pass && data.apnea_prob >= threshold;
  const verdict = !data.sqi_pass ? "Deferred, low signal quality" : isApnea ? "Apnea" : "Normal";

  const inspected = (() => {
    if (hoverIdx === null || data.edr_time_sec.length === 0) return null;
    const idx = Math.min(Math.max(0, hoverIdx), data.edr_time_sec.length - 1);
    const rawT = data.edr_time_sec[idx];
    const tSec = Number.isFinite(rawT) ? Math.min(300, Math.max(0, rawT)) : 0;
    const cx = padL + (tSec / 300) * plotW;
    const edrVal = idx < data.edr_z.length && Number.isFinite(data.edr_z[idx]) ? data.edr_z[idx] : null;
    const rriVal = idx < data.rri_bpm.length && Number.isFinite(data.rri_bpm[idx]) ? data.rri_bpm[idx] : null;
    const heatBin = Math.min(heatBins - 1, Math.max(0, Math.floor((tSec / 300) * heatBins)));
    const attVal = chart.heat.length > 0 && Number.isFinite(chart.heat[heatBin]) && chart.hMax > 1e-6 ? chart.heat[heatBin] / chart.hMax : null;
    const clock = formatClock((data.minute_index - 2) * 60 + tSec);
    const isDeferredWindow = !data.sqi_pass && tSec >= 120 && tSec <= 180;
    const edrCy = edrVal !== null ? yCoord(edrVal, chart.edrMin, chart.edrMax, t2Y, t2H) : null;
    const rriCy = rriVal !== null ? yCoord(rriVal, chart.bpmMin, chart.bpmMax, t3Y, t3H) : null;
    return { idx, tSec, cx, edrVal, rriVal, attVal, clock, isDeferredWindow, edrCy, rriCy };
  })();

  const inspectPointer = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg || data.edr_time_sec.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    const sec = Math.min(300, Math.max(0, ((svgX - padL) / plotW) * 300));
    const idx = nearestIndex(data.edr_time_sec, sec);
    if (idx >= 0) setHoverIdx((prev) => (prev === idx ? prev : idx));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const n = data.edr_time_sec.length;
    if (n === 0) return;
    const curIdx = hoverIdx !== null ? Math.min(Math.max(0, hoverIdx), n - 1) : nearestIndex(data.edr_time_sec, 150);
    const curSec = data.edr_time_sec[curIdx] ?? 150;
    let nextIdx: number | null = null;
    if (e.key === "ArrowLeft") nextIdx = e.shiftKey ? Math.max(0, curIdx - 1) : nearestIndex(data.edr_time_sec, curSec - 5);
    else if (e.key === "ArrowRight") nextIdx = e.shiftKey ? Math.min(n - 1, curIdx + 1) : nearestIndex(data.edr_time_sec, curSec + 5);
    else if (e.key === "PageDown") nextIdx = nearestIndex(data.edr_time_sec, curSec - 30);
    else if (e.key === "PageUp") nextIdx = nearestIndex(data.edr_time_sec, curSec + 30);
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = n - 1;
    else if (e.key === "Escape") {
      setHoverIdx(null);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    if (nextIdx >= 0) setHoverIdx(nextIdx);
  };

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
          <div
            className="relative min-w-[640px]"
            role="slider"
            tabIndex={0}
            aria-label="Inspect 5-minute signal values"
            aria-valuemin={0}
            aria-valuemax={300}
            aria-valuenow={inspected ? Number(inspected.tSec.toFixed(1)) : 150}
            aria-valuetext={
              inspected
                ? `${inspected.tSec.toFixed(1)} seconds, ${inspected.clock}, heart rate ${inspected.rriVal !== null ? `${inspected.rriVal.toFixed(1)} bpm` : "not available"}, breathing ${inspected.edrVal !== null ? `${inspected.edrVal.toFixed(2)} z-score` : "not available"}`
                : "Move pointer or press arrow keys to inspect 0 to 300 seconds"
            }
            onFocus={() => setHoverIdx((prev) => prev ?? (data.edr_time_sec.length ? nearestIndex(data.edr_time_sec, 150) : null))}
            onBlur={() => setHoverIdx(null)}
            onKeyDown={onKeyDown}
          >
            <svg viewBox={`0 0 ${width} ${totalH}`} className="h-auto w-full select-none" aria-hidden>
              {chart.staticSvg}
              {inspected && (
                <g pointerEvents="none">
                  <line x1={inspected.cx} x2={inspected.cx} y1={t2Y} y2={t2Y + t2H} strokeWidth="1.25" strokeDasharray="3 2" className="stroke-primary" />
                  <line x1={inspected.cx} x2={inspected.cx} y1={t3Y} y2={t3Y + t3H} strokeWidth="1.25" strokeDasharray="3 2" className="stroke-primary" />
                  <line x1={inspected.cx} x2={inspected.cx} y1={salY} y2={salY + salH} strokeWidth="1.25" strokeDasharray="3 2" className="stroke-primary" />
                  {inspected.edrCy !== null && <circle cx={inspected.cx} cy={inspected.edrCy} r="3.5" strokeWidth="1.5" className="fill-primary stroke-surface" />}
                  {inspected.rriCy !== null && <circle cx={inspected.cx} cy={inspected.rriCy} r="3.5" strokeWidth="1.5" className="fill-primary stroke-surface" />}
                </g>
              )}
              <rect
                x={padL}
                y={t2Y}
                width={plotW}
                height={salY + salH - t2Y}
                fill="transparent"
                className="cursor-crosshair"
                onPointerDown={inspectPointer}
                onPointerMove={inspectPointer}
                onPointerLeave={() => setHoverIdx(null)}
                onPointerCancel={() => setHoverIdx(null)}
              />
            </svg>

            {inspected && (
              <div
                className="pointer-events-none absolute z-20 whitespace-nowrap border-2 border-line-strong bg-bg px-3 py-2 text-xs text-ink tabular-nums shadow-[4px_4px_0_0_rgba(0,0,0,0.45)]"
                style={
                  inspected.tSec > 180
                    ? { top: `${((t2Y + 4) / totalH) * 100}%`, right: `calc(${100 - (inspected.cx / width) * 100}% + 10px)` }
                    : { top: `${((t2Y + 4) / totalH) * 100}%`, left: `calc(${(inspected.cx / width) * 100}% + 10px)` }
                }
              >
                <div className="flex items-center gap-2 border-b border-line pb-1 font-medium text-ink">
                  <span>
                    {inspected.tSec.toFixed(1)} s · {inspected.clock}
                  </span>
                  {inspected.isDeferredWindow && <span className="text-mild-fg">Deferred</span>}
                </div>
                <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <span className="text-muted">RRI</span>
                  <span className="text-right font-semibold text-ink">{inspected.rriVal !== null ? `${inspected.rriVal.toFixed(1)} bpm` : "N/A"}</span>
                  <span className="text-muted">EDR</span>
                  <span className="text-right font-semibold text-ink">
                    {inspected.edrVal !== null ? `${inspected.edrVal >= 0 ? "+" : ""}${inspected.edrVal.toFixed(2)} z` : "N/A"}
                  </span>
                  <span className="text-muted">Attention</span>
                  <span className="text-right font-semibold text-primary">{inspected.attVal !== null ? inspected.attVal.toFixed(2) : "N/A"}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span className="flex items-center gap-2">
            Low
            <span className="h-3 w-28 rounded-sm" style={{ background: `linear-gradient(90deg, ${VIRIDIS.join(",")})` }} aria-hidden />
            High attention
          </span>
          <span className="text-xs text-muted">Hover or use arrow keys on 300 s tracks to inspect</span>
        </div>
        <figcaption className="mt-2 text-sm text-muted tabular-nums">
          Summary: {verdict.toLowerCase()} at probability {data.apnea_prob.toFixed(2)} (cutoff {threshold.toFixed(2)}). Heart
          rate ranged {chart.hrMin} to {chart.hrMax} bpm. The model attended most to {chart.peakBin * 5} to {chart.peakBin * 5 + 5} s of the window.
        </figcaption>
      </figure>
    </section>
  );
}
