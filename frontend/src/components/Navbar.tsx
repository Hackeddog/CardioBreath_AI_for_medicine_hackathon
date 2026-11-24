"use client";

import React, { useEffect, useState } from "react";
import type { HealthStatus } from "@/lib/types";

export type Tab = "workbench" | "research";

interface NavbarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  health: HealthStatus | null;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "workbench", label: "Screening" },
  { id: "research", label: "Research" },
];

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
const FILL: Record<string, string> = { H: "var(--coral)", S: "#c2405e", W: "#fff3f5" };

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

function CrtToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(document.documentElement.dataset.crt !== "off"), []);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="CRT scanlines"
      onClick={() => {
        const next = !on;
        if (next) delete document.documentElement.dataset.crt;
        else document.documentElement.dataset.crt = "off";
        localStorage.setItem("cb-crt", next ? "on" : "off");
        setOn(next);
      }}
      className={`min-h-11 shrink-0 px-2 font-hud text-xl leading-none sm:px-3 ${on ? "text-primary" : "text-muted"} hover:text-ink`}
      style={{ boxShadow: "inset 0 0 0 2px var(--border-strong)" }}
    >
      CRT {on ? "ON" : "OFF"}
    </button>
  );
}

export default function Navbar({ activeTab, onTabChange, health }: NavbarProps) {
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-line bg-bg">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <a href="#top" aria-label="CardioBreath, back to top" className="flex min-h-11 shrink-0 items-center gap-3">
          <BrandMark className="h-8 w-10" />
          <span className="hidden font-pixel text-lg font-bold sm:inline" aria-hidden>
            <span className="text-coral">Cardio</span>
            <span className="text-primary">Breath</span>
          </span>
        </a>

        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              aria-current={activeTab === t.id ? "page" : undefined}
              className={`min-h-11 px-2 font-hud text-2xl leading-none sm:px-4 ${
                activeTab === t.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
              }`}
              style={activeTab === t.id ? { boxShadow: "inset 0 -3px 0 0 var(--primary)" } : undefined}
            >
              {t.label}
            </button>
          ))}
          <span className="mx-2 hidden items-center gap-2 font-hud text-lg leading-none text-muted md:inline-flex" role="status">
            <span className={`h-2 w-2 ${health ? "bg-primary" : "bg-gold"}`} aria-hidden />
            {health ? `Model ready · ${health.n_onnx_folds} models` : "Connecting…"}
          </span>
          <CrtToggle />
        </nav>
      </div>
    </header>
  );
}
