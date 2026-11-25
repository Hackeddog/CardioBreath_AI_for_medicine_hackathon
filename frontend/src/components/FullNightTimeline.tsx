"use client";

import React, { useState } from "react";
import type { FullNightAnalysis, MinutePoint } from "@/lib/types";

interface FullNightTimelineProps {
  analysis: FullNightAnalysis;
  selectedMinute: number;
  onSelectMinute: (minute: number) => void;
  showBaseline: boolean;
}

function status(pt: MinutePoint) {
  return !pt.sqi_pass ? "Deferred (low signal quality)" : pt.pred === 1 ? "Apnea" : "Normal";
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
  const hasRef = timeline.some((t) => t.ground_truth !== null);

  const width = 920;
  const padL = 84;
  const padR = 12;
  const padT = 24;
  const plotW = width - padL - padR;
  const plotH = 100;
  const stripH = 16;
  const modelY = padT + plotH + 12;
  const refY = modelY + stripH + 6;
  const axisY = (hasRef ? refY : modelY) + stripH + 18;
  const height = axisY + 6;

  const xOf = (m: number) => padL + (m / Math.max(n - 1, 1)) * plotW;
  const yOf = (p: number) => padT + (1 - Math.min(1, Math.max(0, p))) * plotH;
  const barW = Math.max(plotW / n, 1.2) + 0.4;

  const path = (get: (pt: MinutePoint) => number) =>
    timeline.map((pt, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(get(pt)).toFixed(1)}`).join(" ");
  const probPath = path((pt) => pt.prob);
  const basePath = showBaseline && timeline[0]?.baseline_prob != null ? path((pt) => pt.baseline_prob ?? 0) : null;

  const select = (m: number) => onSelectMinute(Math.min(n - 1, Math.max(0, m)));

  const jumpToPeakApnea = () => {
    const usable = timeline.filter((t) => t.sqi_pass);
    if (usable.length) select(usable.reduce((a, b) => (b.prob > a.prob ? b : a)).minute);
  };
  const firstDeferred = timeline.find((t) => !t.sqi_pass);

  const minuteAt = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    return Math.round(Math.min(1, Math.max(0, (relX - padL) / plotW)) * (n - 1));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };
    if (e.key in step) select(selectedMinute + step[e.key]);
    else if (e.key === "Home") select(0);
    else if (e.key === "End") select(n - 1);
    else return;
    e.preventDefault();
  };

  const thrY = yOf(analysis.threshold_used);
  const hourTicks = Array.from({ length: Math.ceil(n / 60) }, (_, h) => h);
  const sel = timeline[selectedMinute];

  // Plain-language takeaway: how much apnea, and the longest uninterrupted stretch.
  const usableMin = timeline.filter((t) => t.sqi_pass).length;
  const apneaMin = timeline.filter((t) => t.sqi_pass && t.pred === 1).length;
  let best = { start: 0, len: 0 };
  let runStart = -1;
  timeline.forEach((t, i) => {
    const on = t.sqi_pass && t.pred === 1;
    if (on && runStart < 0) runStart = i;
    if (runStart >= 0 && (!on || i === timeline.length - 1)) {
      const len = (on ? i + 1 : i) - runStart;
      if (len > best.len) best = { start: runStart, len };
      runStart = -1;
    }
  });
  const runEnd = timeline[best.start + best.len - 1];
  const summary =
    apneaMin === 0
      ? `No apnea minutes detected in ${usableMin} usable minutes.`
      : `Apnea in ${apneaMin} of ${usableMin} usable minutes (${Math.round((apneaMin / Math.max(usableMin, 1)) * 100)}%). Longest stretch ${timeline[best.start].time_label} to ${runEnd.time_label} (${best.len} min).`;

  const hours = hourTicks.map((h) => {
    const slice = timeline.slice(h * 60, h * 60 + 60);
    return {
      h,
      minutes: slice.length,
      apnea: slice.filter((t) => t.sqi_pass && t.pred === 1).length,
      deferred: slice.filter((t) => !t.sqi_pass).length,
      ref: hasRef ? slice.filter((t) => t.ground_truth === 1).length : null,
    };
  });

  return (
    <section aria-labelledby="timeline-title" className="card p-5 sm:p-6 short:py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="timeline-title" className="text-xl font-semibold tracking-tight">
            The night, minute by minute
          </h2>
          <p className="mt-1 max-w-[60ch] tabular-nums">{summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={jumpToPeakApnea} className="btn-secondary">
            Peak apnea
          </button>
          {firstDeferred && (
            <button type="button" onClick={() => select(firstDeferred.minute)} className="btn-secondary">
              First deferred minute
            </button>
          )}
        </div>
      </div>

      <div className="-mx-5 mt-3 overflow-x-auto px-5 sm:-mx-6 sm:px-6" data-hscroll>
        <div
          id="timeline-chart"
          role="slider"
          tabIndex={0}
          aria-label="Selected minute of the night"
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={selectedMinute}
          aria-valuetext={sel ? `${sel.time_label}, ${status(sel)}, probability ${sel.prob.toFixed(2)}` : undefined}
          onKeyDown={onKeyDown}
          className="relative min-w-[640px] rounded-lg"
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full cursor-crosshair select-none"
            aria-hidden
            onClick={(e) => select(minuteAt(e))}
            onMouseMove={(e) => setHovered(timeline[minuteAt(e)] ?? null)}
            onMouseLeave={() => setHovered(null)}
          >
            <defs>
              <pattern id="cb-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="5" height="5" style={{ fill: "var(--surface-2)" }} />
                <line x1="0" y1="0" x2="0" y2="5" strokeWidth="2.5" style={{ stroke: "var(--strip-deferred)" }} />
              </pattern>
            </defs>

            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <line x1={padL} y1={yOf(v)} x2={width - padR} y2={yOf(v)} className="stroke-grid" strokeWidth="1" />
                <text x={padL - 8} y={yOf(v) + 4} textAnchor="end" fontSize="12" className="fill-muted tabular-nums">
                  {v.toFixed(1)}
                </text>
              </g>
            ))}
            <text x={padL} y={12} fontSize="12" className="fill-muted">
              Apnea probability per minute
            </text>

            {basePath && <path d={basePath} fill="none" strokeWidth="1.2" strokeDasharray="4 3" className="stroke-muted" />}
            {/* Re-draws only for a new night or noise level, not on cutoff changes (the curve itself is unchanged). */}
            <path
              key={`${analysis.case_id}-${analysis.noise_snr_db}`}
              d={probPath}
              pathLength={1}
              fill="none"
              strokeWidth="1.4"
              className="draw stroke-trace"
            />
            <line
              x1={padL}
              y1={thrY}
              x2={width - padR}
              y2={thrY}
              strokeWidth="1.2"
              strokeDasharray="6 4"
              className="stroke-primary"
            />
            <text x={width - padR} y={12} textAnchor="end" fontSize="12" fontWeight="600" className="fill-primary">
              cutoff {analysis.threshold_used.toFixed(2)}
            </text>

            <text x={padL - 8} y={modelY + 12} textAnchor="end" fontSize="12" className="fill-ink">
              Model
            </text>
            {timeline.map((pt, i) => (
              <rect
                key={`m-${i}`}
                x={xOf(i)}
                y={modelY}
                width={barW}
                height={stripH}
                fill={!pt.sqi_pass ? "url(#cb-hatch)" : undefined}
                className={!pt.sqi_pass ? undefined : pt.pred === 1 ? "fill-severe" : "fill-[var(--strip-normal)]"}
              />
            ))}

            {hasRef && (
              <>
                <text x={padL - 8} y={refY + 12} textAnchor="end" fontSize="12" className="fill-ink">
                  Sleep lab
                </text>
                {timeline.map((pt, i) => (
                  <rect
                    key={`r-${i}`}
                    x={xOf(i)}
                    y={refY}
                    width={barW}
                    height={stripH}
                    className={pt.ground_truth === 1 ? "fill-severe" : "fill-[var(--strip-normal)]"}
                  />
                ))}
              </>
            )}

            <rect
              x={Math.max(padL, xOf(Math.max(0, selectedMinute - 2)))}
              y={padT - 4}
              width={Math.max(8, xOf(Math.min(n - 1, selectedMinute + 2)) - xOf(Math.max(0, selectedMinute - 2)))}
              height={(hasRef ? refY : modelY) + stripH - padT + 8}
              rx="3"
              fillOpacity="0.12"
              strokeWidth="2"
              className="fill-primary stroke-ink"
            />

            {hourTicks.map((h) => (
              <text key={h} x={xOf(h * 60)} y={axisY} textAnchor="middle" fontSize="12" className="fill-muted tabular-nums">
                {String(h).padStart(2, "0")}:00
              </text>
            ))}
          </svg>

          {hovered && (
            <div className="pointer-events-none absolute right-2 top-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs tabular-nums shadow-sm">
              {hovered.time_label} · p {hovered.prob.toFixed(2)} ± {hovered.prob_std.toFixed(2)} · {status(hovered)}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-muted" aria-label="Legend">
          <li className="flex items-center gap-2">
            <span className="h-3 w-5 rounded-sm bg-[var(--strip-normal)]" aria-hidden />
            Normal minute
          </li>
          <li className="flex items-center gap-2">
            <span className="h-3 w-5 rounded-sm bg-severe" aria-hidden />
            Apnea minute
          </li>
          <li className="flex items-center gap-2">
            <svg className="h-3 w-5 rounded-sm" aria-hidden>
              <rect width="100%" height="100%" fill="url(#cb-hatch)" />
            </svg>
            Deferred, low signal quality
          </li>
          {basePath && (
            <li className="flex items-center gap-2">
              <span className="w-5 border-t-2 border-dashed border-muted" aria-hidden />
              Baseline model
            </li>
          )}
        </ul>
        {sel && (
          <p className="font-medium tabular-nums">
            Selected {sel.time_label} · {status(sel)}
          </p>
        )}
      </div>

      <details className="mt-4 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">
          Show hourly summary as a table
        </summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-left tabular-nums">
            <caption className="sr-only">Apnea and deferred minutes per hour of the night</caption>
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-4 font-medium">Hour</th>
                <th scope="col" className="py-2 pr-4 font-medium">Minutes</th>
                <th scope="col" className="py-2 pr-4 font-medium">Apnea (model)</th>
                {hasRef && <th scope="col" className="py-2 pr-4 font-medium">Apnea (sleep lab)</th>}
                <th scope="col" className="py-2 font-medium">Deferred</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((r) => (
                <tr key={r.h} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {String(r.h).padStart(2, "0")}:00
                  </th>
                  <td className="py-2 pr-4">{r.minutes}</td>
                  <td className="py-2 pr-4">{r.apnea}</td>
                  {hasRef && <td className="py-2 pr-4">{r.ref}</td>}
                  <td className="py-2">{r.deferred}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
