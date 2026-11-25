"use client";

import React, { useEffect, useRef, useState } from "react";
import type { HealthStatus } from "@/lib/types";
import { Lullaby } from "@/lib/lullaby";

export const PAGES = [
  { id: "start", label: "Start" },
  { id: "result", label: "Result" },
  { id: "night", label: "Night" },
  { id: "signals", label: "Signals" },
  { id: "how", label: "How it works" },
  { id: "research", label: "Research" },
] as const;
export type PageId = (typeof PAGES)[number]["id"];

interface NavbarProps {
  page: number;
  onPage: (i: number) => void;
  health: HealthStatus | null;
  onTour: () => void;
  scenePaused: boolean;
  onToggleScene: () => void;
  clinical: boolean;
  onToggleClinical: () => void;
}

/* Pixel heart, 13 x 11 on a 16 x 13 canvas. H = heart, S = shaded heart, W = glint. */
const HEART = [
  "................",
  "...HHH...HHH....",
  "..HWHHH.HHHHH...",
  ".HHHHHHHHHHHHH..",
  ".HHHHHHHHHHHHH..",
  ".HHHHHHHHHHHHH..",
  "..HHHHHHHHHHH...",
  "...SSSSSSSSS....",
  "....SSSSSSS.....",
  ".....SSSSS......",
  "......SSS.......",
  ".......S........",
  "................",
];
// The ECG beat that becomes a breath wave: flat, spike, dip, then a slow rise and fall.
const TRACE: [number, number][] = [
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 5], [5, 2], [5, 3], [5, 4], [5, 5],
  [6, 3], [6, 4], [6, 5], [6, 6], [6, 7], [6, 8], [7, 6], [8, 6], [9, 5], [10, 4], [11, 4], [12, 5], [13, 6], [14, 6], [15, 6],
];
const FILL: Record<string, string> = { H: "var(--coral)", S: "#b07f78", W: "#fbf2ea" };

export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 13" className={className} shapeRendering="crispEdges" aria-hidden>
      {HEART.flatMap((row, y) =>
        [...row].map((c, x) => (c in FILL ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={FILL[c]} /> : null))
      )}
      {TRACE.map(([x, y]) => (
        <rect key={`t${x}-${y}`} x={x} y={y} width="1" height="1" fill="var(--primary)" />
      ))}
    </svg>
  );
}

const chip = "min-h-11 shrink-0 px-2 text-sm font-medium leading-none hover:text-ink sm:px-3";
const chipFrame = { boxShadow: "inset 0 0 0 2px var(--border-strong)" };

/** Off until clicked: browsers block autoplay, and sound should never surprise someone in a clinic.
 * Unmounting (Clinical mode) stops it. */
function MusicToggle() {
  const engine = useRef<Lullaby | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => () => engine.current?.stop(), []);
  return (
    <button
      type="button"
      aria-pressed={on}
      data-music={on ? "playing" : "off"}
      onClick={async () => {
        engine.current ??= new Lullaby();
        if (on) engine.current.stop();
        else await engine.current.start();
        setOn(!on);
      }}
      className={`${chip} ${on ? "text-coral" : "text-muted"}`}
      style={chipFrame}
    >
      <span aria-hidden>♪ </span>Music
    </button>
  );
}

export default function Navbar({ page, onPage, health, onTour, scenePaused, onToggleScene, clinical, onToggleClinical }: NavbarProps) {
  return (
    <header className="relative z-40 h-[var(--header-h)] border-b-[3px] border-line bg-bg">
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between gap-2 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => onPage(0)}
          aria-label="CardioBreath, go to start"
          className="flex min-h-11 shrink-0 items-center gap-3"
        >
          <BrandMark className="h-8 w-10" />
          <span className="hidden font-pixel text-lg font-bold sm:inline" aria-hidden>
            <span className="text-coral">Cardio</span>
            <span className="text-primary">Breath</span>
          </span>
        </button>

        <nav aria-label="Stages" className="hidden items-center gap-1 lg:flex">
          {PAGES.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPage(i)}
              aria-current={page === i ? "page" : undefined}
              className={`min-h-11 px-3 text-base font-semibold leading-none ${page === i ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
              style={page === i ? { boxShadow: "inset 0 -3px 0 0 var(--primary)" } : undefined}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span className="mr-1 hidden items-center gap-2 text-sm font-medium leading-none text-muted xl:inline-flex" role="status">
            <span className={`h-2 w-2 ${health ? "bg-primary" : "bg-gold"}`} aria-hidden />
            {health ? "Model ready" : "Connecting…"}
          </span>
          <button type="button" onClick={onTour} className={`${chip} text-gold`} style={chipFrame}>
            Tour
          </button>
          {!clinical && (
            <>
              <MusicToggle />
              <button
                type="button"
                title={scenePaused ? "Play scene" : "Pause scene"}
                onClick={onToggleScene}
                className={`${chip} ${scenePaused ? "text-muted" : "text-primary"}`}
                style={chipFrame}
              >
                <span aria-hidden>{scenePaused ? "▶" : "❚❚"}</span>
                <span className="sr-only">{scenePaused ? "Play scene" : "Pause scene"}</span>
              </button>
            </>
          )}
          {/* Plain view for clinical review: no scene, no music, plain type. */}
          <button
            type="button"
            aria-pressed={clinical}
            aria-label="Clinical mode"
            onClick={onToggleClinical}
            className={`${chip} ${clinical ? "bg-primary text-primary-ink hover:text-primary-ink" : "text-muted"}`}
            style={chipFrame}
          >
            Clinical<span className="hidden sm:inline"> mode</span>
          </button>
        </div>
      </div>
    </header>
  );
}
